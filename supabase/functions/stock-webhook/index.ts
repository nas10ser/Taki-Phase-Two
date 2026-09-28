/**
 * stock-webhook — العنوانُ الذي يُعطيه التاجرُ لنظامه (v15.12)
 * ═══════════════════════════════════════════════════════════════════════════
 * اعتراضُ ناصر: «لم أفهم سبب طلبك للرابط وأيّ رابط تقصد أن يضع».
 * وكان محقّاً: الأنظمةُ (سلّة · زد · أغلب نقاط البيع) **تُرسل** ولا تستقبل،
 * فالصحيح أن تُعطيها تاكي عنواناً يلصقه التاجرُ مرّةً واحدة:
 *
 *     https://api.takisa.net/functions/v1/stock-webhook?k=<مفتاح التاجر>
 *
 * 🔴 ولماذا دالّةُ حافةٍ هنا بينما الوارد الآخر (`taki_stock_push`) بلا دالّة:
 *    ذاك يُنادى من مبرمجٍ يكتب الطلب بنفسه، فـPostgREST يكفيه. أمّا هذا
 *    فيصل **بجسمٍ خامٍّ بشكل المرسِل** وبترويساته هو، ولا يستطيع أن يُشكّل
 *    نداءً بمعاملاتٍ مسمّاة. فاللازمُ نقطةٌ تقبل أيّ جسمٍ كما هو.
 *
 * 🔴 وكلُّ سطحٍ عامٍّ على هذا الخادم يرث `VERIFY_JWT=false` — أي يبدأ **بلا
 *    أيّ حماية**. فالحراسةُ هنا صراحةً: مفتاحٌ مطلوب، ومقارنةٌ بالبصمة داخل
 *    القاعدة، وحدُّ معدّل، وسقفٌ لحجم الجسم.
 *
 * 🪤 والمفتاح يُقبل في الترويسة **وفي الرابط**: الترويسةُ أسلم (لا تُسجَّل في
 *    سجلّات الوسطاء)، لكنّ أنظمةً كثيرة لا تسمح للتاجر بإضافة ترويسة أصلاً —
 *    فمنعُ الرابط يعني منعَ أغلب التجار. والتخفيفُ: المفتاح يُدوَّر بضغطة.
 *
 * 🪤 ويُردّ 200 حتى على رسالةٍ لم نفهمها: رفضُها يجعل النظامَ المرسِل يُعيدها
 *    إلى الأبد (وبعضُها يُعطّل الخطّاف بعد فشلٍ متكرّر). تُحفظ ويُقال «لم
 *    نفهم» في لوحة التاجر، ويُربط شكلُها من الرسالة الحقيقية.
 */

const ALLOW = 'authorization, x-client-info, apikey, content-type, x-taki-key';
const MAX_BODY = 256 * 1024;   // 🪤 جسمٌ ضخم لا يُقرأ أصلاً: سطحُ إنهاكٍ مجّانيّ

const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
            'access-control-allow-headers': ALLOW,
        },
    });

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', {
            headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': ALLOW },
        });
    }
    if (req.method !== 'POST') return json(405, { error: 'POST_ONLY' });

    // المفتاح: ترويسةً أوّلاً (أسلم)، ثمّ من الرابط لمن لا يستطيع ترويسة.
    const url = new URL(req.url);
    const key = (req.headers.get('x-taki-key') || url.searchParams.get('k') || '').trim();
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
     * v15.13 — التحقّقُ بطريقة كلّ منصّة، حين يكون عندنا سرُّها.
     * 🔴 ومقيسٌ من وثيقتَيهما لا مُستنتَج:
     *    • سلّة: HMAC-SHA256 على **الجسم الخام** في `X-Salla-Signature`.
     *      🪤 ومثالُهم بـNode يُجزّئ `JSON.stringify(req.body)` بينما مثالُ PHP
     *         يُجزّئ الجسم الخام — والصحيحُ الخام وحده، فإعادةُ الترميز تغيّر
     *         البايتات فتفشل المطابقة. ونقارن بلا حساسيةٍ لحالة اسم الترويسة
     *         لأن وثيقتهم تكتبه بالحالتين.
     *    • زد: **لا توقيع إطلاقاً** — `Authorization: Basic` فقط. فرسالتُها
     *      إشارةٌ لا حقيقة، ولا يُبنى عليها رقمٌ بلا إعادة قراءة.
     * 🪤 وحين لا يكون عندنا سرّ (قبل تسجيل تطبيق تاكي لديهم) يبقى المفتاحُ
     *    في الرابط هو الحارس — ويُقال ذلك في الشاشة ولا يُدَّعى غيره.
     */
    // 🪤 ولا تُمرَّر الترويسات إلى القاعدة بعد: التحقّقُ بالتوقيع يحتاج
    //    **الجسم الخام** وهو هنا لا هناك، وسرُّ المنصّة لا يوجد قبل تسجيل
    //    تطبيق تاكي لديها. فيُبنى التحقّق يوم يوجد السرّ، ولا يُدَّعى اليوم.
    let res: Response;
    try {
        res = await fetch(`${SUPA}/rest/v1/rpc/taki_stock_webhook`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', apikey: SRV, authorization: `Bearer ${SRV}` },
            body: JSON.stringify({
                p_key: key, p_body: body, p_event_id: null,
            }),
        });
    } catch (e) {
        return json(502, { error: 'UPSTREAM', detail: String((e as Error)?.message || e).slice(0, 180) });
    }

    const out = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!res.ok) return json(502, { error: 'UPSTREAM', status: res.status });
    if (out?.ok !== true) {
        // مفتاحٌ مجهول أو موقوف — يُقال بوضوح، فنظامُ التاجر يتوقّف عن المحاولة.
        return json(401, { error: String(out?.error || 'REJECTED') });
    }
    // 🔴 200 حتى للرسالة التي لم تُفهم — وإلّا أعادها المرسِل إلى الأبد.
    return json(200, {
        ok: true,
        applied: out.push ? (out.push as Record<string, unknown>).applied ?? 0 : 0,
        unmapped: out.unmapped === true,
        hint: out.hint ?? undefined,
    });
});
