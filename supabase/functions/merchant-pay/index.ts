/**
 * merchant-pay — «الدفع المباشر لحساب التاجر — 0% عمولة» (v12.81)
 *
 * دالة واحدة بموجّه داخلي (صفر تكرار — المهايئات مشتركة بين كل المسارات):
 *   POST ?op=create   إنشاء دفعة مستضافة على حساب التاجر → { url }
 *   POST ?op=verify   «اختبار الاتصال» من بطاقة التاجر → يختم verified_at
 *   POST ?op=confirm  تأكيد server→server بمبادرة العميل (شبكة أمان للـwebhook)
 *   GET  ?op=page     صفحة وسيطة موقّعة HMAC (payfort/hyperpay/sim)
 *   ANY  ?op=webhook  إشعارات المزودين خادم→خادم (توقيع لكل مزود)
 *   ANY  ?op=return   عودة متصفح المشتري → تأكيد خادمي ثم تحويل للموقع
 *
 * v12.82 — تحصينات: مفاتيح المزودين بيد ناصر (enabled_pay_providers)،
 * أثر تدقيق لكل رابط دفع (activity_log مع قناة المصدر web/telegram/whatsapp)،
 * ومسار البوت يتحقق أن الهوية مستخدم حقيقي في القاعدة.
 * v12.83 — المزود السابع 'sim': محاكاة دفع كاملة بلا أموال (رمز موقّع خادمياً).
 *
 * قواعد أمان صلبة (من المخطط المعتمد):
 *  - الأسرار تُفك حصراً هنا عبر RPC ‏_gateway_secrets (service_role فقط)
 *  - لا يُصدَّق أي رد قادم من متصفح المشتري — التأكيد دائماً بنداء خادم→خادم
 *  - المبلغ يُطابَق مع إجمالي الفاتورة (bookings.total_amount) قبل التعليم كمدفوع،
 *    ودفعةٌ أنقص منه لا تُختم «مدفوعة» أبداً (v14.11)
 *  - التكرار يُتجاهل عبر UNIQUE(provider, payment_ref) — _apply_merchant_payment
 *  - بيانات البطاقات لا تلمس تاكي إطلاقاً (Hosted Checkout — نطاق PCI SAQ-A)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { ADAPTERS, GatewayCfg, PayCtx } from './adapters.ts';
import { CORS_HEADERS, hmacSha256Hex, htmlResponse, json, round2, seeOther, timingSafeEqual } from './helpers.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
/**
 * v14.11 — عنوان الدالة **كما يراه المتصفح والمزوّد**، لا العنوان الداخلي.
 * 🪤 مقيس على جدة: `SUPABASE_URL` داخل الحاوية هو `http://kong:8000`، فكان
 * رابط الدفع العائد للجوّال وعناوين العودة والإشعار كلها تشير إلى اسم حاوية
 * لا يصل إليه أحد من خارج الخادم ⇒ زرّ «ادفع الآن» يفتح صفحة لا تُحمَّل.
 * (صفر دفعة في `platform_payment_log` منذ الانتقال للاستضافة الذاتية.)
 */
const API_PUBLIC_URL = (Deno.env.get('API_PUBLIC_URL') || Deno.env.get('SUPABASE_PUBLIC_URL') || SUPABASE_URL).replace(/\/+$/, '');
const FN_BASE = `${API_PUBLIC_URL}/functions/v1/merchant-pay`;
const SITE_ORIGIN = Deno.env.get('SITE_ORIGIN') ?? 'https://www.takisa.net';

const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// rate-limit خفيف داخل الـisolate — يكفي لكبح الإساءة على مسار الإنشاء
const rateMap = new Map<string, number[]>();
function rateLimited(uid: string, max = 8, windowMs = 60_000): boolean {
    const now = Date.now();
    const hits = (rateMap.get(uid) || []).filter((t) => now - t < windowMs);
    hits.push(now);
    rateMap.set(uid, hits);
    return hits.length > max;
}

/** هوية المنادي: JWT مستخدم حقيقي، أو بوت موثوق عبر x-bot-secret (بوابة v12.12).
 *  v12.82 — تحصين مسار البوت: بعد مطابقة السر (مقارنة ثابتة الزمن) نتحقق أن
 *  المعرّف مستخدم حقيقي موجود في القاعدة — سر مسرّب وحده لا يكفي لاختراع هوية. */
async function resolveUid(req: Request, body: Record<string, unknown>): Promise<string | null> {
    const botSecret = req.headers.get('x-bot-secret');
    if (botSecret) {
        const { data } = await service.from('app_secrets').select('value').eq('key', 'bot_gateway_secret').maybeSingle();
        if (data?.value && timingSafeEqual(String(data.value), botSecret)) {
            const uid = String(body?.uid || '').trim();
            if (!uid) return null;
            const { data: urow } = await service.from('users').select('id').eq('id', uid).maybeSingle();
            return urow?.id ? uid : null;
        }
        return null;
    }
    const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!jwt) return null;
    const { data } = await service.auth.getUser(jwt);
    return data?.user?.id ?? null;
}

/** قناة الطلب لسجل التدقيق — لا نثق بقيمة src إلا من بوت موثّق بالسر */
function requestChannel(req: Request, body: Record<string, unknown>): string {
    if (!req.headers.get('x-bot-secret')) return 'web';
    return body?.src === 'whatsapp' ? 'whatsapp' : 'telegram';
}

async function directPayOn(): Promise<boolean> {
    const { data } = await service.from('platform_settings').select('value').eq('key', 'direct_pay_enabled').maybeSingle();
    return data?.value === true;
}

/**
 * v14.11 — هذه الدالة **لا تحسب مالاً**. الصيغة الوحيدة في القاعدة:
 * `taki_booking_amount()` ⇒ (نسخ مختارة أو سعر×كمية) + الإضافات + رسوم التوصيل،
 * مجمَّدة في `bookings.total_amount` لحظة الحجز. فالمبلغ المطلوب هنا هو نفسه
 * المطبوع على الفاتورة وعلى فاتورة البوتين حرفياً — رقم واحد لا ثلاثة.
 *
 * 🪤 الخلل الذي عالجته: كانت النسخة السابقة تحسب البضاعة والإضافات وتُسقط
 * رسوم التوصيل (`grep -c delivery` = صفر)، فيُقبض ٨٠ عن فاتورة ٩٥ ويُختم
 * الطلب «مدفوع بالكامل» — خسارة نقدية مباشرة للتاجر أول يوم مزوّد حقيقي.
 */
async function amountDueSar(barcode: string): Promise<number> {
    const { data, error } = await service.rpc('_booking_amount_due', { p_barcode: barcode });
    if (error) throw new Error(`AMOUNT_RPC_FAILED: ${error.message}`);
    return round2(Number(data) || 0);
}

async function gatewayCfg(merchantId: string): Promise<(GatewayCfg & Record<string, unknown>) | null> {
    const { data, error } = await service.rpc('_gateway_secrets', { p_merchant_id: merchantId });
    if (error || !data) return null;
    return data as GatewayCfg & Record<string, unknown>;
}

/** البوابة صالحة فعلياً لاستقبال دفعات؟ (نفس منطق deal_payment_mode في القاعدة)
 *  v12.82 — يشترط أيضاً أن المزود نفسه مفتوح من ناصر (enabled_pay_providers) */
function gatewayLive(cfg: Record<string, unknown> | null): boolean {
    return !!cfg && cfg.provider_enabled === true &&
        cfg.is_enabled === true && cfg.disabled_by_admin !== true &&
        !!cfg.verified_at && Number(cfg.fail_count || 0) < 5 &&
        (cfg.payment_modes === 'online' || cfg.payment_modes === 'both') && !!cfg.secret_key;
}

async function pageSig(provider: string, barcode: string, m: string, exp: string): Promise<string> {
    return await hmacSha256Hex(SERVICE_KEY, `${provider}|${barcode}|${m}|${exp}`);
}

async function buildCtx(provider: string, booking: Record<string, unknown>, deal: Record<string, unknown>, amountSar: number, lang: 'ar' | 'en'): Promise<PayCtx> {
    const barcode = String(booking.barcode);
    const m = String(booking.store_id);
    const { data: buyer } = await service.from('users').select('name, email').eq('id', String(booking.user_id)).maybeSingle();
    const exp = String(Date.now() + 30 * 60_000);
    const sig = await pageSig(provider, barcode, m, exp);
    const q = (op: string) => `${FN_BASE}?op=${op}&provider=${encodeURIComponent(provider)}&m=${encodeURIComponent(m)}&barcode=${encodeURIComponent(barcode)}`;
    return {
        barcode,
        amountSar,
        description: `TAKI ${String(deal?.item_name || 'booking')} — ${barcode}`.slice(0, 90),
        merchantId: m,
        buyerName: String(buyer?.name || 'TAKI Customer'),
        buyerEmail: String(buyer?.email || `${barcode.toLowerCase()}@taki-app.net`),
        returnUrl: q('return'),
        webhookUrl: q('webhook'),
        pageUrl: `${q('page')}&exp=${exp}&sig=${sig}`,
        lang,
    };
}

async function loadBooking(barcode: string): Promise<Record<string, unknown> | null> {
    const { data } = await service.from('bookings').select('*').eq('barcode', barcode).maybeSingle();
    return data ?? null;
}

/**
 * تطبيق نتيجة تأكيد خادمي على الحجز — **لا يُختم طلبٌ «مدفوع» بأقلّ من فاتورته**.
 *
 * المرجع هو `total_amount` (إجمالي الفاتورة المجمّد لحظة الحجز)، وإن غاب فـ
 * `payment_expected` الذي كُتب عند إنشاء رابط الدفع. ودفعةٌ أنقص من الفاتورة
 * تُسجَّل `amount_mismatch` فيبقى الطلب غير مدفوع ويظهر الفرق في سجل الدفعات —
 * أفضل من ختمٍ كاذب يُخرج بضاعةً بلا مقابلها.
 *
 * 🔵 الزيادة ليست نقصاً: مبلغٌ أكبر من الفاتورة يُقبل مدفوعاً (المال وصل التاجر)،
 *    ويبقى مسجَّلاً بقيمته الفعلية في `paid_amount` وسجلّ الدفعات.
 */
async function applyConfirmed(provider: string, merchantId: string, booking: Record<string, unknown>, ref: string, amountSar: number | undefined): Promise<boolean> {
    const expected = round2(Number(booking.total_amount || 0) || Number(booking.payment_expected || 0));
    // مزوّد لا يُرجع مبلغاً في ردّ التأكيد: نسأل القاعدة لا نفترض النجاح.
    const got = (amountSar === undefined || amountSar === 0) ? expected : round2(amountSar);
    const ok = expected > 0 && (got >= expected - 0.011);
    await service.rpc('_apply_merchant_payment', {
        p_provider: provider,
        p_merchant_id: merchantId,
        p_payment_ref: ref,
        p_amount: got,
        p_barcode: String(booking.barcode),
        p_status: ok ? 'paid' : 'amount_mismatch',
    });
    return ok;
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });

    const url = new URL(req.url);

    // جسم الطلب: JSON أو form-encoded (عودات/إشعارات بعض المزودين نماذج POST)
    let rawBody = '';
    let body: Record<string, unknown> = {};
    if (req.method === 'POST') {
        rawBody = await req.text();
        const ctype = req.headers.get('content-type') || '';
        if (ctype.includes('application/json')) {
            try { body = JSON.parse(rawBody || '{}'); } catch { body = {}; }
        } else if (ctype.includes('form')) {
            body = Object.fromEntries(new URLSearchParams(rawBody).entries());
        } else {
            try { body = JSON.parse(rawBody || '{}'); } catch { body = {}; }
        }
    }
    // supabase.functions.invoke لا يمرر query params — نقبل op من الجسم أيضاً
    const op = url.searchParams.get('op') || String(body?.op || 'create');

    try {
        // ───────────────────────── إنشاء دفعة ─────────────────────────
        if (op === 'create' && req.method === 'POST') {
            const uid = await resolveUid(req, body);
            if (!uid) return json(401, { error: 'AUTH_REQUIRED' });
            if (rateLimited(uid)) return json(429, { error: 'RATE_LIMITED' });
            if (!(await directPayOn())) return json(403, { error: 'DIRECT_PAY_OFF' });

            const barcode = String(body.barcode || '').trim();
            if (!barcode) return json(400, { error: 'BARCODE_REQUIRED' });
            const booking = await loadBooking(barcode);
            if (!booking) return json(404, { error: 'BOOKING_NOT_FOUND' });
            if (String(booking.user_id) !== uid) return json(403, { error: 'NOT_YOUR_BOOKING' });
            if (booking.paid_at) return json(409, { error: 'ALREADY_PAID' });
            const status = String(booking.status);
            if (status !== 'pending' && status !== 'acknowledged') return json(409, { error: 'BOOKING_NOT_ACTIVE' });
            if (status === 'pending' && Number(booking.expiry_time || 0) < Date.now()) return json(409, { error: 'BOOKING_EXPIRED' });

            const merchantId = String(booking.store_id);
            const cfg = await gatewayCfg(merchantId);
            if (!gatewayLive(cfg)) return json(409, { error: 'GATEWAY_UNAVAILABLE' });

            const { data: deal } = await service.from('deals').select('*').eq('id', String(booking.deal_id)).maybeSingle();
            if (!deal) return json(404, { error: 'DEAL_NOT_FOUND' });
            // المبلغ من القاعدة وحدها — لا من المتصفح ولا من حساب محلي.
            const amountSar = await amountDueSar(barcode);
            if (!(amountSar > 0)) return json(409, { error: 'ZERO_AMOUNT' });

            const lang: 'ar' | 'en' = body.lang === 'en' ? 'en' : 'ar';
            const provider = String(cfg!.provider);
            const adapter = ADAPTERS[provider];
            if (!adapter) return json(500, { error: 'NO_ADAPTER' });
            const ctx = await buildCtx(provider, booking, deal, amountSar, lang);

            try {
                const created = await adapter.createHostedPayment(cfg!, ctx);
                await service.from('bookings')
                    .update({ payment_expected: amountSar, payment_ref: created.ref, payment_provider: provider })
                    .eq('barcode', barcode);
                // v12.82 — أثر تدقيق لكل رابط دفع: من طلبه، من أي قناة، لأي حجز وبأي مبلغ
                await service.from('activity_log').insert({
                    user_id: uid,
                    user_type: 'buyer',
                    action: 'pay_link_created',
                    entity_type: 'booking',
                    entity_id: barcode,
                    metadata: { provider, amount: amountSar, channel: requestChannel(req, body), merchant_id: merchantId, ref: created.ref },
                });
                return json(200, { url: created.url, provider, amount: amountSar });
            } catch (e) {
                // فشل الإنشاء يرفع عدّاد الفشل — ٥ متتالية = سقوط تلقائي لعند الاستلام
                await service.rpc('_bump_gateway_fail', { p_merchant_id: merchantId });
                return json(502, { error: 'CREATE_FAILED', detail: String((e as Error)?.message || e).slice(0, 180) });
            }
        }

        // ─────────────────── اختبار الاتصال (بطاقة التاجر) ───────────────────
        if (op === 'verify' && req.method === 'POST') {
            // JWT فقط — لا مسار بوت هنا: التاجر يختبر بوابته من لوحته
            const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
            const { data: u } = await service.auth.getUser(jwt);
            const uid = u?.user?.id;
            if (!uid) return json(401, { error: 'AUTH_REQUIRED' });
            if (rateLimited(`v_${uid}`, 5)) return json(429, { error: 'RATE_LIMITED' });
            const cfg = await gatewayCfg(uid);
            if (!cfg || !cfg.secret_key) return json(409, { error: 'KEYS_REQUIRED' });
            // v12.82 — مزوّد لم يفتحه ناصر بعد: رسالة واضحة بدل فشل غامض
            if (cfg.provider_enabled !== true) return json(200, { ok: false, error: 'PROVIDER_DISABLED' });
            const adapter = ADAPTERS[String(cfg.provider)];
            if (!adapter) return json(500, { error: 'NO_ADAPTER' });
            const res = await adapter.verifyCredentials(cfg);
            if (res.ok) {
                await service.rpc('_stamp_gateway_verified', { p_merchant_id: uid });
                await service.from('activity_log').insert({
                    user_id: uid, user_type: 'seller', action: 'gateway_verified',
                    entity_type: 'merchant_gateway', entity_id: uid,
                    metadata: { provider: String(cfg.provider) },
                });
                return json(200, { ok: true });
            }
            return json(200, { ok: false, error: res.error || 'VERIFY_FAILED' });
        }

        // ──────────── تأكيد بمبادرة العميل (شبكة أمان للـwebhook) ────────────
        if (op === 'confirm' && req.method === 'POST') {
            const uid = await resolveUid(req, body);
            if (!uid) return json(401, { error: 'AUTH_REQUIRED' });
            if (rateLimited(`c_${uid}`, 20)) return json(429, { error: 'RATE_LIMITED' });
            const barcode = String(body.barcode || '').trim();
            const booking = barcode ? await loadBooking(barcode) : null;
            if (!booking) return json(404, { error: 'BOOKING_NOT_FOUND' });
            if (String(booking.user_id) !== uid && String(booking.store_id) !== uid) return json(403, { error: 'NOT_A_PARTY' });
            if (booking.paid_at) return json(200, { paid: true });

            const merchantId = String(booking.store_id);
            const cfg = await gatewayCfg(merchantId);
            if (!cfg || !cfg.secret_key) return json(409, { error: 'GATEWAY_UNAVAILABLE' });
            const provider = String(cfg.provider);
            const adapter = ADAPTERS[provider];
            if (!adapter) return json(500, { error: 'NO_ADAPTER' });

            // hyperpay: المتصفح يمرر resourcePath — لكن الاستعلام نفسه خادمي دائماً
            const resourcePath = String(body.resource_path || '');
            const ref = (resourcePath && resourcePath.startsWith('/')) ? resourcePath : String(booking.payment_ref || '');
            if (!ref) return json(409, { error: 'NO_PAYMENT_REF' });
            const result = await adapter.confirmPayment(cfg, ref, String(booking.barcode));
            if (!result.paid) return json(200, { paid: false, reason: result.reason });
            const ok = await applyConfirmed(provider, merchantId, booking, result.ref || ref, result.amountSar);
            return json(200, { paid: ok });
        }

        // ──────── الصفحة الوسيطة الموقعة (payfort نموذج / hyperpay ودجت / sim محاكاة) ────────
        if (op === 'page' && req.method === 'GET') {
            const provider = url.searchParams.get('provider') || '';
            const barcode = url.searchParams.get('barcode') || '';
            const m = url.searchParams.get('m') || '';
            const exp = url.searchParams.get('exp') || '0';
            const sig = url.searchParams.get('sig') || '';
            const calc = await pageSig(provider, barcode, m, exp);
            if (!timingSafeEqual(calc, sig) || Number(exp) < Date.now()) {
                return htmlResponse('<p style="font-family:sans-serif;text-align:center;margin-top:40px">⏳ انتهت صلاحية رابط الدفع — عد للتطبيق واضغط «ادفع الآن» من جديد.</p>');
            }
            const booking = await loadBooking(barcode);
            if (!booking || booking.paid_at || String(booking.store_id) !== m) return seeOther(`${SITE_ORIGIN}/bookings`);
            const cfg = await gatewayCfg(m);
            const adapter = ADAPTERS[provider];
            if (!gatewayLive(cfg) || !adapter?.renderPage) return seeOther(`${SITE_ORIGIN}/bookings?paid=0`);
            const { data: deal } = await service.from('deals').select('*').eq('id', String(booking.deal_id)).maybeSingle();
            const amountSar = Number(booking.payment_expected || 0) || await amountDueSar(barcode);
            const ctx = await buildCtx(provider, booking, deal || {}, amountSar, 'ar');
            return htmlResponse(await adapter.renderPage(cfg!, ctx));
        }

        // ───────────────── إشعارات المزودين خادم→خادم ─────────────────
        if (op === 'webhook') {
            const provider = url.searchParams.get('provider') || '';
            const m = url.searchParams.get('m') || '';
            const adapter = ADAPTERS[provider];
            const cfg = m ? await gatewayCfg(m) : null;
            if (!adapter || !cfg) return json(200, { ok: true }); // لا نكشف شيئاً للمجهول
            const headers: Record<string, string> = {};
            req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
            const chk = await adapter.verifyWebhook(cfg, { headers, rawBody, body, query: url.searchParams });
            if (!chk.sigOk) return json(401, { error: 'BAD_SIGNATURE' });

            // حل الحجز: بالباركود من الحمولة، أو بالمرجع المخزن عندنا
            let booking: Record<string, unknown> | null = null;
            if (chk.barcode) booking = await loadBooking(chk.barcode);
            if (!booking && chk.ref) {
                const { data } = await service.from('bookings').select('*').eq('payment_ref', chk.ref).eq('store_id', m).maybeSingle();
                booking = data ?? null;
            }
            if (!booking || String(booking.store_id) !== m) return json(200, { ok: true });
            if (booking.paid_at) return json(200, { ok: true, duplicate: true });

            // القاعدة الذهبية: التأكيد النهائي بنداء خادم→خادم — لا نصدق الحمولة
            const ref = chk.ref || String(booking.payment_ref || '');
            const result = await adapter.confirmPayment(cfg, ref, String(booking.barcode));
            if (result.paid) await applyConfirmed(provider, m, booking, result.ref || ref, result.amountSar);
            return json(200, { ok: true });
        }

        // ───────────── عودة المتصفح → تأكيد خادمي ثم تحويل للموقع ─────────────
        if (op === 'return') {
            const provider = url.searchParams.get('provider') || '';
            const m = url.searchParams.get('m') || '';
            const barcode = url.searchParams.get('barcode') || '';
            const back = (paid: boolean) => seeOther(`${SITE_ORIGIN}/bookings?paid=${paid ? 1 : 0}&barcode=${encodeURIComponent(barcode)}`);
            const booking = barcode ? await loadBooking(barcode) : null;
            if (!booking || String(booking.store_id) !== m) return seeOther(`${SITE_ORIGIN}/bookings`);
            if (booking.paid_at) return back(true);
            const cfg = await gatewayCfg(m);
            const adapter = ADAPTERS[provider];
            if (!cfg || !adapter) return back(false);

            // مرجع التأكيد لكل مزود — والاستعلام نفسه خادمي دائماً
            let ref = String(booking.payment_ref || '');
            if (provider === 'sim') {
                // الوضع التجريبي: الرمز الموقّع بمفتاح الخادم هو «تأكيد المزود»
                ref = url.searchParams.get('simref') || '';
            } else if (provider === 'hyperpay') {
                const rp = url.searchParams.get('resourcePath') || '';
                if (rp.startsWith('/')) ref = rp;
            } else if (provider === 'checkout') {
                ref = url.searchParams.get('cko-session-id') || ref;
            } else if (provider === 'payfort') {
                // عودة بيفورت نموذج موقّع بعبارة الـresponse — تحقق ثم CHECK_STATUS
                const headers: Record<string, string> = {};
                req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
                const chk = await adapter.verifyWebhook(cfg, { headers, rawBody, body, query: url.searchParams });
                if (!chk.sigOk) return back(false);
            }
            if (!ref) return back(false);
            const result = await adapter.confirmPayment(cfg, ref, barcode);
            if (!result.paid) return back(false);
            const ok = await applyConfirmed(provider, m, booking, result.ref || ref, result.amountSar);
            return back(ok);
        }

        return json(404, { error: 'UNKNOWN_OP' });
    } catch (e) {
        console.error('merchant-pay error:', e);
        return json(500, { error: 'INTERNAL', detail: String((e as Error)?.message || e).slice(0, 180) });
    }
});
