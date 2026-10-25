/**
 * stock-webhook — العنوانُ الذي يُعطيه التاجرُ لنظامه (v15.12 → v15.21)
 * ═══════════════════════════════════════════════════════════════════════════
 * اعتراضُ ناصر: «لم أفهم سبب طلبك للرابط وأيّ رابط تقصد أن يضع».
 * وكان محقّاً: الأنظمةُ (سلّة · زد · أغلب نقاط البيع) **تُرسل** ولا تستقبل،
 * فالصحيح أن تُعطيها تاكي عنواناً يلصقه التاجرُ مرّةً واحدة.
 *
 * 🔴 والعنوانُ صار **مساراً لكلّ متجر** (v15.17):
 *     https://api.takisa.net/functions/v1/stock-webhook/h/<slug>
 *   لأن وثيقةَ زد صريحة: «You cannot recover a webhook by re-using the same
 *   target_url. Zid requires a new URL…» — فخطّافٌ عُطّل (٣٠ فشلاً في ساعة)
 *   لا يُستعاد إلا برابطٍ جديد. وفصلُ العنوان عن السرّ يجعل إعادةَ الإصدار
 *   ضغطةً واحدة بلا كسرِ أيّ نظامٍ آخر يحمل المفتاح.
 *   🪤 والصيغةُ القديمة `?k=<المفتاح>` **تبقى تعمل**: أنظمةٌ لا تسمح بترويسة
 *      ولا بمسار، وكسرُها بلا داعٍ كسرٌ لتجّار.
 *
 * 🔴 وكلُّ سطحٍ عامٍّ على هذا الخادم يرث `VERIFY_JWT=false` — أي يبدأ **بلا
 *    أيّ حماية**. فالحراسةُ هنا صراحةً: هويّةٌ مطلوبة، ومقارنةٌ بالبصمة داخل
 *    القاعدة، وحدُّ معدّل، وسقفٌ لحجم الجسم، وتوقيعُ المنصّة حين يوجد سرُّها.
 *
 * 🪤 ويُردّ 200 حتى على رسالةٍ لم نفهمها: رفضُها يجعل النظامَ المرسِل يُعيدها
 *    إلى الأبد، **وعند زد يُحسب كلُّ ردٍّ غيرِ 2xx فشلاً** فثلاثون منها في
 *    ساعةٍ تُعطّل الخطّاف وتُلغي أحداثَه المعلّقة.
 * 🪤 **إلا الخنق**: يُردّ **429** عمداً — ووثيقةُ زد تقول نصّاً إنّ 429
 *    «are not counted as failures. They are treated as a signal that your
 *    endpoint is alive but rate-limited».
 */

const ALLOW = 'authorization, x-client-info, apikey, content-type, x-taki-key, x-salla-signature, x-salla-security-strategy';
const MAX_BODY = 256 * 1024;   // 🪤 جسمٌ ضخم لا يُقرأ أصلاً: سطحُ إنهاكٍ مجّانيّ

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
            'access-control-allow-headers': ALLOW,
            ...extra,
        },
    });

/** ترويسةٌ بلا حساسيّةٍ لحالة الأحرف — وثيقةُ سلّة تكتب اسمَ ترويستها بالحالتين. */
const hdr = (req: Request, name: string): string =>
    req.headers.get(name) || req.headers.get(name.toLowerCase()) || '';

/** مقارنةٌ ثابتةُ الزمن: مقارنةُ نصٍّ عاديّةٌ تُفشي طولَ البادئة المطابقة. */
function sameSecret(a: string, b: string): boolean {
    const x = new TextEncoder().encode(a);
    const y = new TextEncoder().encode(b);
    if (x.length !== y.length) return false;
    let d = 0;
    for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
    return d === 0;
}

async function hmacHex(secret: string, raw: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function rpc(supa: string, srv: string, fn: string, args: unknown): Promise<Response> {
    return await fetch(`${supa}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', apikey: srv, authorization: `Bearer ${srv}` },
        body: JSON.stringify(args),
    });
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': ALLOW },
        });
    }
    if (req.method !== 'POST') return json(405, { error: 'POST_ONLY' });

    const url = new URL(req.url);
    // الهويّة: مسارُ المتجر أوّلاً (الصيغةُ الموصى بها)، ثمّ ترويسة، ثمّ الرابط.
    // 🪤 ويُقرأ المقطعُ الذي يلي `/h/` لا آخرُ المسار: مسارٌ فيه لاحقةٌ زائدة
    //    (بعض الأنظمة تُلحق `/`) كان سيُنتج مفتاحاً فارغاً.
    const parts = url.pathname.split('/').filter(Boolean);
    const hi = parts.indexOf('h');
    const fromPath = hi >= 0 && parts.length > hi + 1 ? parts[hi + 1] : '';
    const key = (fromPath || hdr(req, 'x-taki-key') || url.searchParams.get('k') || '').trim();
    if (key.length < 20) return json(401, { error: 'KEY_REQUIRED' });

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, { error: 'BODY_TOO_LARGE' });

    let body: unknown;
    try { body = JSON.parse(raw || '{}'); }
    catch { return json(400, { error: 'BAD_JSON' }); }

    const SUPA = Deno.env.get('SUPABASE_URL');
    const SRV = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    // 🪤 يفشل **مغلقاً**: بلا بيئةٍ صحيحة لا يُقال «تمّ» ولا يُبتلع الحدث.
    if (!SUPA || !SRV) return json(500, { error: 'NOT_CONFIGURED' });

    /**
     * v15.21 — التحقّقُ بطريقة كلّ منصّة، **حين يكون عندنا سرُّها**.
     * 🔴 ومقيسٌ من وثيقتَيهما لا مُستنتَج:
     *    • سلّة: HMAC-SHA256 على **الجسم الخام** في `X-Salla-Signature`.
     *      🪤 ومثالُهم بـNode يُجزّئ `JSON.stringify(req.body)` بينما مثالُ PHP
     *         يُجزّئ الجسم الخام — والصحيحُ الخام وحده، فإعادةُ الترميز تغيّر
     *         البايتات فتفشل المطابقة. ولذلك يُوقَّع `raw` لا `JSON.stringify(body)`.
     *    • زد: **لا توقيع إطلاقاً** — `Authorization: Basic` فقط.
     * 🪤 وحين لا يوجد سرٌّ (قبل تسجيل تطبيق تاكي لديهم) يبقى المسارُ هو
     *    الحارس — والشاشةُ تقول ذلك ولا تدّعي توقيعاً.
     */
    let guard: Record<string, unknown> | null = null;
    try {
        const g = await rpc(SUPA, SRV, 'taki_stock_inbound_guard', { p_key: key });
        guard = await g.json().catch(() => null);
    } catch { /* يُترك للنداء التالي أن يفصل */ }
    if (guard && guard.ok !== true) {
        return json(401, { error: String(guard.error || 'REJECTED') });
    }
    const secret = typeof guard?.secret === 'string' ? guard.secret : '';
    const provider = typeof guard?.provider === 'string' ? guard.provider : '';
    if (secret) {
        if (provider === 'salla') {
            const sent = hdr(req, 'X-Salla-Signature').trim().replace(/^sha256=/i, '');
            const want = await hmacHex(secret, raw);
            if (!sent || !sameSecret(sent.toLowerCase(), want)) {
                // 🪤 401 لا 200: توقيعٌ خاطئ ليس رسالةً لم نفهمها — هو رسالةٌ
                //    ليست منهم. وسلّة لا تُعطّل الخطّاف على 401 بخلاف زد.
                return json(401, { error: 'BAD_SIGNATURE' });
            }
        } else if (provider === 'zid') {
            const sent = hdr(req, 'Authorization').trim();
            if (!sent || !sameSecret(sent, secret)) {
                return json(401, { error: 'BAD_BASIC_AUTH' });
            }
        }
    }

    let res: Response;
    try {
        res = await rpc(SUPA, SRV, 'taki_stock_webhook', { p_key: key, p_body: body, p_event_id: null });
    } catch (e) {
        return json(502, { error: 'UPSTREAM', detail: String((e as Error)?.message || e).slice(0, 180) });
    }

    const out = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok) return json(502, { error: 'UPSTREAM', status: res.status });
    if (out?.ok !== true) {
        // مفتاحٌ مجهول أو موقوف — يُقال بوضوح، فنظامُ التاجر يتوقّف عن المحاولة.
        return json(401, { error: String(out?.error || 'REJECTED') });
    }
    // 🔴 الخنقُ 429 عمداً: زد **لا تحسبها فشلاً** (نصُّ وثيقتهم)، بخلاف أيّ
    //    ردٍّ آخر غيرِ 2xx. فهي الطريقةُ الوحيدة لقول «أبطئ» بلا تقريبِ
    //    دائرتهم القاطعة من التعطيل.
    if (out.throttled === true) {
        return json(429, { ok: true, throttled: true }, { 'retry-after': '60' });
    }
    // 🔴 200 حتى للرسالة التي لم تُفهم — وإلّا أعادها المرسِل إلى الأبد.
    return json(200, {
        ok: true,
        applied: out.push ? (out.push as Record<string, unknown>).applied ?? 0 : 0,
        unmapped: out.unmapped === true,
        reason: out.reason ?? undefined,
        hint: out.hint ?? undefined,
    });
});
