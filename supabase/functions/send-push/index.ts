/**
 * send-push — إشعار الجوّال (Web Push) — v14.13
 * ═══════════════════════════════════════════════════════════════════════════
 * يناديها مشغّل `tr_notification_push` على جدول `notifications` عبر pg_net،
 * فتُرسل الإشعار لكل أجهزة صاحب الإشعار المسجّلة في `push_subscriptions`.
 *
 * 🔒 الحراسة: خادم الدوال عندنا يعمل بـ`FUNCTIONS_VERIFY_JWT=false` (لأن
 *    المشغّل لا يحمل JWT)، فلو تُركت الدالة مكشوفة لاستطاع أي أحد أن يدفع
 *    إشعاراً باسم أي مستخدم. لذلك تشترط ترويسة `x-push-secret` مطابقةً لسرّ
 *    الخادم (مقارنة ثابتة الزمن)، والمشغّل وحده يعرفه.
 *
 * 🌐 اللغة: تُحسم **هنا** من `users.preferred_lang`، ويُرسل عنوان ونصّ واحد
 *    جاهزان. كان عامل الخدمة يختار بـ`self.__TAKI_LANG__` وهي غير معرّفة داخله
 *    أبداً ⇒ كل مستخدم يصله العربي مهما كانت لغته.
 *
 * المتغيّرات (على حاوية الدوال، لا في المستودع):
 *   VAPID_PUBLIC_KEY · VAPID_PRIVATE_KEY · VAPID_SUBJECT · PUSH_SHARED_SECRET
 *   SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY
 */

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const VAPID_PUB = Deno.env.get('VAPID_PUBLIC_KEY') ?? '';
const VAPID_PRIV = Deno.env.get('VAPID_PRIVATE_KEY') ?? '';
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:no-reply@takisa.net';
const PUSH_SECRET = Deno.env.get('PUSH_SHARED_SECRET') ?? '';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const vapidReady = !!(VAPID_PUB && VAPID_PRIV);
if (vapidReady) webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUB, VAPID_PRIV);

/** مقارنة ثابتة الزمن — لا تكشف طول التطابق. */
function timingSafeEqual(a: string, b: string): boolean {
    const ea = new TextEncoder().encode(a);
    const eb = new TextEncoder().encode(b);
    if (ea.length !== eb.length) return false;
    let diff = 0;
    for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
    return diff === 0;
}

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
    if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
    // سرّ غير مضبوط = الباب مقفل، لا مفتوح. الفشل الآمن هو الافتراضي.
    if (!PUSH_SECRET) return json(503, { error: 'PUSH_SECRET_UNSET' });
    if (!timingSafeEqual(req.headers.get('x-push-secret') || '', PUSH_SECRET)) {
        return json(401, { error: 'UNAUTHORIZED' });
    }
    if (!vapidReady) return json(503, { error: 'VAPID_UNSET' });

    try {
        const payload = await req.json().catch(() => ({}));
        const userId = String(payload?.userId || '').trim();
        if (!userId) return json(400, { error: 'MISSING_USER' });

        const { data: subs } = await supabase
            .from('push_subscriptions')
            .select('endpoint, p256dh, auth')
            .eq('user_id', userId);
        if (!subs || subs.length === 0) return json(200, { sent: 0, reason: 'NO_SUBSCRIPTIONS' });

        // لغة صاحب الإشعار — نفس العمود الذي يفرّع عليه بريد الحساب (v13.92).
        const { data: u } = await supabase
            .from('users').select('preferred_lang').eq('id', userId).maybeSingle();
        const en = String(u?.preferred_lang || 'ar').toLowerCase().startsWith('en');

        const title = (en ? payload?.titleEn : payload?.titleAr) || payload?.titleAr || 'TAKI';
        const body = (en ? payload?.bodyEn : payload?.bodyAr) || payload?.bodyAr || '';

        const message = JSON.stringify({
            title, body,
            // نُبقي النسختين للتوافق مع نسخ قديمة من عامل الخدمة.
            titleAr: payload?.titleAr, titleEn: payload?.titleEn,
            bodyAr: payload?.bodyAr, bodyEn: payload?.bodyEn,
            type: payload?.type,
            data: payload?.data,
            notifId: payload?.notifId,
        });

        const results = await Promise.allSettled(subs.map((s: any) =>
            webpush.sendNotification(
                { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
                message,
                { TTL: 86400, urgency: 'normal' },
            )
        ));

        // اشتراك رفضه مزوّد الدفع (404/410) = جهاز لم يعد موجوداً — يُحذف فوراً
        // كي لا يبقى الجدول يكبر بأجهزة ميتة ويُبطئ كل إشعار بعدها.
        const dead: string[] = [];
        let sent = 0;
        results.forEach((r, i) => {
            if (r.status === 'fulfilled') { sent++; return; }
            const code = (r.reason as any)?.statusCode;
            if (code === 404 || code === 410) dead.push(subs[i].endpoint);
            else console.warn('push failed:', code, String((r.reason as any)?.body || '').slice(0, 120));
        });
        if (dead.length) await supabase.from('push_subscriptions').delete().in('endpoint', dead);

        return json(200, { sent, failed: results.length - sent, dropped: dead.length, lang: en ? 'en' : 'ar' });
    } catch (e) {
        console.error('send-push error:', e);
        return json(500, { error: 'INTERNAL', detail: String((e as Error)?.message || e).slice(0, 180) });
    }
});
