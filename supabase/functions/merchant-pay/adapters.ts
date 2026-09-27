/**
 * adapters.ts — طبقة «مهايئ المزود» الموحدة (v12.81)
 *
 * القاعدة الذهبية (من المخطط المعتمد): الكود العام لا يعرف اسم أي مزود.
 * كل مزود ملف/كائن واحد يلتزم الواجهة الإلزامية:
 *   createHostedPayment(cfg, ctx) → { url, ref }
 *   verifyCredentials(cfg)        → { ok, error? }
 *   confirmPayment(cfg, ref, barcode) → { paid, amountSar?, ref? }   ← نداء خادم→خادم دائماً
 *   verifyWebhook(cfg, evt)       → { sigOk, ref?, barcode? }
 *   refundPayment(cfg, ref, amountSar, reason, barcode?) → { ok, refundRef?, reason? }  (v14.96)
 *
 * قواعد أمان مشتركة ينفذها الموجّه (index.ts) فوق هذه الطبقة:
 *  - التأكيد النهائي حصراً بنداء خادم→خادم (لا يُصدَّق رد متصفح المشتري)
 *  - مطابقة المبلغ والعملة مع الحجز قبل التعليم كمدفوع
 *  - idempotency عبر UNIQUE(provider, payment_ref) في قاعدة البيانات
 *  - وللاسترداد: قفلٌ ذرّي في القاعدة **قبل** نداء المزوّد — فلا شيء في هذه
 *    الطبقة يمنع نداءين من ردّ المال مرّتين (v14.96)
 *
 * إضافة مزود جديد = كائن جديد هنا + سطر في ADAPTERS. لا شيء آخر
 * (v12.83: هكذا أُضيف 'sim' التجريبي — الوعد تحقق حرفياً).
 */

import { basicAuth, hmacSha256Hex, round2, sha256Hex, timingSafeEqual, toMinor } from './helpers.ts';

export interface GatewayCfg {
    provider: string;
    publishable_key: string | null;
    secret_key: string | null;
    webhook_secret: string | null;
    extra_config: Record<string, unknown>;
}

export interface PayCtx {
    barcode: string;
    amountSar: number;
    description: string;
    merchantId: string;
    buyerName: string;
    buyerEmail: string;
    /** عودة المتصفح بعد الدفع (تمر عبر op=return للتأكيد الخادمي ثم التحويل للموقع) */
    returnUrl: string;
    /** استقبال إشعارات المزود خادم→خادم */
    webhookUrl: string;
    /** صفحة وسيطة نستضيفها (payfort/hyperpay/sim) — موقّعة HMAC */
    pageUrl: string;
    lang: 'ar' | 'en';
}

export interface CreatedPayment { url: string; ref: string; }
export interface ConfirmResult { paid: boolean; amountSar?: number; ref?: string; reason?: string; }
export interface WebhookEvt {
    headers: Record<string, string>;
    rawBody: string;
    body: Record<string, unknown>;
    query: URLSearchParams;
}
export interface WebhookCheck { sigOk: boolean; ref?: string; barcode?: string; reason?: string; }

/**
 * نتيجة استرداد لدى المزوّد (v14.96) — **عقدٌ ثلاثيّ لا ثنائيّ**، وهذا هو
 * الفرق بين «ردّ المال مرّة» و«ردّه مرّتين»:
 *
 *  • `{ ok: true }`  ⇒ المزوّد **قَبِل** الاسترداد (نُفّذ، أو دخل طابور تنفيذه).
 *                       لا يُعاد النداء بعدها أبداً.
 *  • `{ ok: false }` ⇒ رفضٌ **قاطع**، لم يتحرّك ريالٌ واحد ⇒ يجوز فكّ القفل
 *                       وإعادة المحاولة.
 *  • `throw`         ⇒ النتيجة **غير معلومة** (انقطاع شبكة، أو حالة غامضة من
 *                       المزوّد) ⇒ 🔴 لا يُفكّ القفل: فكّه يفتح باب استردادٍ
 *                       مزدوج، والمال هنا مال التاجر لا مال تاكي.
 */
export interface RefundResult { ok: boolean; refundRef?: string; reason?: string; }

export interface ProviderAdapter {
    createHostedPayment(cfg: GatewayCfg, ctx: PayCtx): Promise<CreatedPayment>;
    verifyCredentials(cfg: GatewayCfg): Promise<{ ok: boolean; error?: string }>;
    confirmPayment(cfg: GatewayCfg, ref: string, barcode: string): Promise<ConfirmResult>;
    verifyWebhook(cfg: GatewayCfg, evt: WebhookEvt): Promise<WebhookCheck>;
    /** payfort/hyperpay/sim: صفحة وسيطة — البقية لا تحتاجها */
    renderPage?(cfg: GatewayCfg, ctx: PayCtx): Promise<string>;
    /**
     * استرداد فعليّ لدى المزوّد — «يردّ التاجر المال بنقرة واحدة» (v14.96).
     *
     * 🪤 **الاسترداد ليس خاملَ التكرار عند أيّ مزوّد في هذا الملف**: نداءان
     *    يعنيان استردادين. ميسر وتاب وبيتابس وهايبر باي بلا مفتاح تكرارٍ
     *    إطلاقاً؛ وتشيك‑أوت وبيفورت وحدهما يقبلان مفتاحاً نرسله ثابتاً مشتقّاً
     *    من رقم الطلب. فالحارس الحقيقي هو قفل القاعدة
     *    `taki_claim_booking_refund` **قبل** النداء — لا شيء في هذه الطبقة.
     * 🪤 و«٢٠٠ بجسمٍ فاشل» ليس نجاحاً: كل تطبيقٍ هنا يقرأ حقل الحالة نفسه.
     *
     * @param ref       مرجع الدفعة المخزَّن (`bookings.payment_ref`)
     * @param amountSar المبلغ بالريال — الجزئيّ ممكنٌ ببنيته، والمنادي يرسل الكامل
     * @param reason    سبب التاجر (يُرسل للمزوّد حيث يقبل وصفاً)
     * @param barcode   رقم الطلب — بيفورت وبيتابس يطلبانه مرجعاً للعملية الأصلية
     */
    refundPayment?(cfg: GatewayCfg, ref: string, amountSar: number, reason: string, barcode?: string): Promise<RefundResult>;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

// ============================================================
// Sim (🧪 الوضع التجريبي) — محاكاة دفع كاملة بلا أموال حقيقية (v12.83)
// لعدم امتلاك ناصر وثيقة عمل حر بعد: نفس القناة الآمنة حرفياً
// (صفحة موقّعة HMAC بمفتاح الخادم + «تأكيد خادمي» عبر رمز لا يمكن
// للمتصفح تزويره + سجل + إشعارات مصرّحة أنها تجريبية) — والتحول
// لمزود حقيقي لاحقاً لا يغيّر أي سطر خارج هذا الكائن.
// ============================================================
const simKey = () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const sim: ProviderAdapter = {
    async createHostedPayment(_cfg, ctx) {
        // صفحة الدفع التجريبية = صفحتنا الوسيطة الموقعة (op=page)
        return { url: ctx.pageUrl, ref: `SIM-${ctx.barcode}` };
    },
    async renderPage(_cfg, ctx) {
        // رمز نجاح موقّع بمفتاح الخادم — «التأكيد» لاحقاً يتحقق منه خادمياً،
        // فلا يستطيع متصفحٌ تعليم حجز كمدفوع بمجرد فتح رابط العودة.
        const exp = String(Date.now() + 30 * 60_000);
        const sig = await hmacSha256Hex(simKey(), `simpay|${ctx.barcode}|${exp}`);
        const payUrl = `${ctx.returnUrl}&simref=${exp}.${sig}`;
        const esc = (s: string) => s.replace(/"/g, '&quot;');
        return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>محاكاة دفع — تاكي</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:-apple-system,Tahoma,sans-serif;margin:0;background:#f1f5f9;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px">
<div style="background:#fff;border-radius:24px;box-shadow:0 20px 60px rgba(0,0,0,0.12);max-width:420px;width:100%;padding:28px 24px;text-align:center">
  <div style="font-size:2.6rem">🧪</div>
  <h2 style="margin:8px 0 4px;font-size:1.15rem;font-weight:900;color:#0f172a">صفحة دفع تجريبية</h2>
  <div style="display:inline-block;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:999px;padding:6px 14px;font-size:0.72rem;font-weight:800;margin-bottom:14px">
    وضع محاكاة — لن يُخصم أي مبلغ حقيقي
  </div>
  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:16px;margin-bottom:16px">
    <div style="font-size:0.72rem;font-weight:800;color:#64748b">المبلغ</div>
    <div style="font-size:1.8rem;font-weight:900;color:#0d9488">${ctx.amountSar.toFixed(2)} <span style="font-size:0.9rem">ر.س</span></div>
    <div style="font-size:0.7rem;font-weight:700;color:#64748b;margin-top:6px">رقم الحجز: <b style="font-family:monospace">${esc(ctx.barcode)}</b></div>
  </div>
  <p style="font-size:0.72rem;font-weight:700;color:#64748b;line-height:1.8;margin:0 0 18px">
    هذه محاكاة كاملة لتجربة نظام الدفع المباشر قبل ربط بوابة حقيقية —
    كل الخطوات تعمل (التأكيد، السجل، الإشعارات) دون أي عملية مالية.
  </p>
  <a href="${esc(payUrl)}" style="display:block;background:linear-gradient(135deg,#059669,#0d9488);color:#fff;border-radius:14px;padding:15px;font-weight:900;font-size:1rem;text-decoration:none;box-shadow:0 8px 20px rgba(13,148,136,0.35)">✅ إتمام الدفع (محاكاة)</a>
  <a href="${esc(ctx.returnUrl)}" style="display:block;margin-top:10px;color:#64748b;font-weight:800;font-size:0.8rem;text-decoration:none;padding:10px">إلغاء والعودة</a>
  <div style="margin-top:14px;font-size:0.62rem;font-weight:700;color:#94a3b8">🔒 قناة مؤمّنة بتوقيع خادمي — منصة تاكي</div>
</div></body></html>`;
    },
    async verifyCredentials() {
        // لا مفاتيح خارجية في المحاكاة — «اختبار الاتصال» ينجح فوراً
        return { ok: true };
    },
    async confirmPayment(_cfg, ref, barcode) {
        // ref = "<exp>.<sig>" من زر المحاكاة — HMAC بمفتاح الخادم لا يُزوَّر
        const dot = String(ref).indexOf('.');
        if (dot < 1) return { paid: false, reason: 'sim_no_token' };
        const exp = String(ref).slice(0, dot);
        const sig = String(ref).slice(dot + 1);
        if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return { paid: false, reason: 'sim_token_expired' };
        const calc = await hmacSha256Hex(simKey(), `simpay|${barcode}|${exp}`);
        if (!timingSafeEqual(calc, sig)) return { paid: false, reason: 'sim_bad_token' };
        return { paid: true, ref: `SIM-${barcode}` };
    },
    async verifyWebhook() {
        // لا webhooks في المحاكاة — مسار العودة الموقّع هو التأكيد الوحيد
        return { sigOk: false, reason: 'sim_no_webhooks' };
    },
    async refundPayment(_cfg, ref, amountSar, _reason, barcode) {
        // 🧪 **لا يتحرّك أي مال هنا — ولا ريالٌ واحد.** الدفعة نفسها كانت محاكاة
        // (رمزاً موقّعاً بمفتاح الخادم لا خصماً من بطاقة)، فالاسترداد محاكاةٌ
        // مثلها. تُرجع نجاحاً كي تسير بقيّة السلسلة — القفل، التسوية، السجل،
        // الإشعار — كما تسير حرفياً مع مزوّدٍ حقيقي، فيُختبر المسار كاملاً.
        // 🔴 ولذلك يبقى تفعيل `sim` على متجرٍ حيّ ممنوعاً: دفعٌ بلا مال ⇐
        //    استردادٌ بلا مال، وكلاهما يكذب على التاجر والمشتري معاً.
        return { ok: true, refundRef: `SIMRF-${barcode || ref || 'x'}-${toMinor(amountSar)}` };
    },
};

// ============================================================
// Moyasar (ميسر) — فواتير مستضافة، Basic auth بالمفتاح السري
// ============================================================
const moyasar: ProviderAdapter = {
    async createHostedPayment(cfg, ctx) {
        const r = await fetch('https://api.moyasar.com/v1/invoices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: basicAuth(cfg.secret_key || '') },
            body: JSON.stringify({
                amount: toMinor(ctx.amountSar),
                currency: 'SAR',
                description: ctx.description,
                callback_url: ctx.webhookUrl,
                success_url: ctx.returnUrl,
                metadata: { barcode: ctx.barcode, merchant_id: ctx.merchantId },
            }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.url || !j?.id) throw new Error(`moyasar_create_failed:${r.status}:${str(j?.message)}`);
        return { url: String(j.url), ref: String(j.id) };
    },
    async verifyCredentials(cfg) {
        const r = await fetch('https://api.moyasar.com/v1/invoices?limit=1', {
            headers: { Authorization: basicAuth(cfg.secret_key || '') },
        });
        return r.ok ? { ok: true } : { ok: false, error: `moyasar_auth_${r.status}` };
    },
    async confirmPayment(cfg, ref) {
        const r = await fetch(`https://api.moyasar.com/v1/invoices/${encodeURIComponent(ref)}`, {
            headers: { Authorization: basicAuth(cfg.secret_key || '') },
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return { paid: false, reason: `moyasar_fetch_${r.status}` };
        return { paid: j?.status === 'paid', amountSar: round2(Number(j?.amount || 0) / 100), ref };
    },
    async verifyWebhook(cfg, evt) {
        // ميسر يرسل secret_token في الحمولة — ثم التأكيد الفعلي بجلب الفاتورة (server→server)
        const token = str(evt.body?.secret_token);
        if (cfg.webhook_secret && (!token || !timingSafeEqual(token, cfg.webhook_secret))) {
            return { sigOk: false, reason: 'bad_secret_token' };
        }
        const data = (evt.body?.data || {}) as Record<string, unknown>;
        const ref = str(data?.invoice_id) || str(data?.id) || str(evt.body?.id);
        const meta = (data?.metadata || {}) as Record<string, unknown>;
        return { sigOk: true, ref, barcode: str(meta?.barcode) };
    },
    /**
     * 📄 https://docs.moyasar.com/api/payments/05-refund-payment/
     *    `POST /v1/payments/{id}/refund` — المبلغ بالهللات (وحذفه = استرداد كامل)،
     *    والحالة بعده `refunded`، وحقل `refunded` يحمل المبلغ المسترَدّ فعلاً.
     * 🪤 ومرجعنا المخزَّن **فاتورة لا دفعة** (أنشأنا `invoice` في
     *    `createHostedPayment`) ونقطةُ الاسترداد على الدفعة — فنجلب الفاتورة
     *    ونأخذ دفعتها المدفوعة أوّلاً:
     *    📄 https://docs.moyasar.com/api/invoices/04-show-invoice/ (مصفوفة `payments`)
     * 🪤 ولا مفتاح تكرار عند ميسر: نداءان = استردادان.
     */
    async refundPayment(cfg, ref, amountSar) {
        const auth = basicAuth(cfg.secret_key || '');
        let paymentId = '';
        const inv = await fetch(`https://api.moyasar.com/v1/invoices/${encodeURIComponent(ref)}`, {
            headers: { Authorization: auth },
        });
        if (inv.ok) {
            const ij = await inv.json().catch(() => ({}));
            const list = (Array.isArray(ij?.payments) ? ij.payments : []) as Record<string, unknown>[];
            const paid = list.find((p) => p?.status === 'paid' || p?.status === 'captured');
            const already = list.find((p) => p?.status === 'refunded');
            // مسترَدّة أصلاً عند ميسر: نجاحٌ صادق لا رفضٌ يُبقي التاجر في حلقة إعادة
            if (!paid && already) return { ok: true, refundRef: str(already.id) };
            paymentId = str(paid?.id);
            if (!paymentId) return { ok: false, reason: 'moyasar_no_payment_on_invoice' };
        } else if (inv.status === 404) {
            paymentId = ref; // المرجع دفعة مباشرة لا فاتورة
        } else if (inv.status === 401 || inv.status === 403) {
            return { ok: false, reason: `moyasar_auth_${inv.status}` };
        } else {
            // لا نعرف حال الفاتورة ⇒ لا نُقدِم، ولا يُفكّ القفل
            throw new Error(`moyasar_invoice_lookup_${inv.status}`);
        }
        const r = await fetch(`https://api.moyasar.com/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: auth },
            body: JSON.stringify({ amount: toMinor(amountSar) }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status >= 500) throw new Error(`moyasar_refund_${r.status}`);
        if (!r.ok) return { ok: false, reason: `moyasar_refund_${r.status}:${str(j?.message) || str(j?.type)}`.slice(0, 160) };
        // ٢٠٠ بجسمٍ فاشل ليس نجاحاً — الحكم على الحالة والمبلغ المسترَدّ وحدهما
        const okBody = str(j?.status) === 'refunded' || Number(j?.refunded || 0) >= toMinor(amountSar);
        if (!okBody) return { ok: false, reason: `moyasar_status_${str(j?.status) || 'unknown'}` };
        return { ok: true, refundRef: str(j?.id) || paymentId };
    },
};

// ============================================================
// Tap (تاب) — charges API + صفحة دفع مستضافة
// ============================================================
const tap: ProviderAdapter = {
    async createHostedPayment(cfg, ctx) {
        const r = await fetch('https://api.tap.company/v2/charges/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.secret_key || ''}` },
            body: JSON.stringify({
                amount: ctx.amountSar,
                currency: 'SAR',
                description: ctx.description,
                customer: { first_name: ctx.buyerName || 'TAKI', email: ctx.buyerEmail },
                source: { id: 'src_all' },
                redirect: { url: ctx.returnUrl },
                post: { url: ctx.webhookUrl },
                reference: { transaction: ctx.barcode, order: ctx.barcode },
                metadata: { barcode: ctx.barcode, merchant_id: ctx.merchantId },
            }),
        });
        const j = await r.json().catch(() => ({}));
        const url = j?.transaction?.url;
        if (!r.ok || !url || !j?.id) throw new Error(`tap_create_failed:${r.status}:${str(j?.errors?.[0]?.description)}`);
        return { url: String(url), ref: String(j.id) };
    },
    async verifyCredentials(cfg) {
        const r = await fetch('https://api.tap.company/v2/charges/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.secret_key || ''}` },
            body: JSON.stringify({ limit: 1 }),
        });
        return r.ok ? { ok: true } : { ok: false, error: `tap_auth_${r.status}` };
    },
    async confirmPayment(cfg, ref) {
        const r = await fetch(`https://api.tap.company/v2/charges/${encodeURIComponent(ref)}`, {
            headers: { Authorization: `Bearer ${cfg.secret_key || ''}` },
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return { paid: false, reason: `tap_fetch_${r.status}` };
        return { paid: j?.status === 'CAPTURED', amountSar: round2(Number(j?.amount || 0)), ref };
    },
    async verifyWebhook(cfg, evt) {
        // تاب يرسل hashstring — لكن الحكم النهائي دائماً لجلب الـcharge بمفتاحنا
        // السري (لا يمكن لمهاجم أن يجعل API تاب يقول CAPTURED عن عملية وهمية).
        const id = str(evt.body?.id);
        const meta = (evt.body?.metadata || {}) as Record<string, unknown>;
        const refObj = (evt.body?.reference || {}) as Record<string, unknown>;
        if (!id) return { sigOk: false, reason: 'no_charge_id' };
        return { sigOk: true, ref: id, barcode: str(meta?.barcode) || str(refObj?.order) };
    },
    /**
     * 📄 https://developers.tap.company/reference/create-a-refund
     *    `POST https://api.tap.company/v2/refunds` بـ `{ charge_id, amount, currency, reason }`.
     *    والمبلغ **بوحدات كبرى عشرية** كما في إنشاء الـcharge حرفياً (الوثيقة:
     *    «حتى منزلتين عشريتين» لغير BHD/KWD/OMR) — لا بالهللات.
     *    و`reason` من مجموعة مغلقة: `duplicate | fraudulent | requested_by_customer`.
     * 📄 الحالات: https://developers.tap.company/reference/refunds
     *    REFUNDED/ACCEPTED/PENDING/IN_PROGRESS = قُبل ⇒ لا يُعاد أبداً.
     *    DECLINED/REJECTED/FAILED/RESTRICTED = رفضٌ قاطع.
     *    وTIMED_OUT/UNKNOWN غامضتان ⇒ استثناء يُبقي القفل (لا استرداد مزدوج).
     * 🪤 لا مفتاح تكرار عند تاب: نداءان = استردادان.
     */
    async refundPayment(cfg, ref, amountSar, reason, barcode) {
        const r = await fetch('https://api.tap.company/v2/refunds', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.secret_key || ''}` },
            body: JSON.stringify({
                charge_id: ref,
                amount: round2(amountSar),
                currency: 'SAR',
                reason: 'requested_by_customer',
                description: reason.slice(0, 200),
                reference: { merchant: barcode || ref },
                metadata: { barcode: barcode || '' },
            }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status >= 500) throw new Error(`tap_refund_${r.status}`);
        if (!r.ok) {
            return { ok: false, reason: `tap_refund_${r.status}:${str(j?.errors?.[0]?.description) || str(j?.message)}`.slice(0, 160) };
        }
        const st = str(j?.status).toUpperCase();
        if (/^(REFUNDED|ACCEPTED|PENDING|IN_PROGRESS)$/.test(st)) return { ok: true, refundRef: str(j?.id) || ref };
        if (/^(DECLINED|REJECTED|FAILED|RESTRICTED)$/.test(st)) {
            return { ok: false, reason: `tap_${st}:${str(j?.response?.message)}`.slice(0, 160) };
        }
        throw new Error(`tap_refund_unclear_${st || 'no_status'}`);
    },
};

// ============================================================
// PayTabs (بيتابس) — hosted page + توقيع server-key للـcallback
// ============================================================
const paytabs: ProviderAdapter = {
    async createHostedPayment(cfg, ctx) {
        const r = await fetch('https://secure.paytabs.sa/payment/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: cfg.secret_key || '' },
            body: JSON.stringify({
                profile_id: Number(str(cfg.extra_config?.profile_id)) || undefined,
                tran_type: 'sale',
                tran_class: 'ecom',
                cart_id: ctx.barcode,
                cart_currency: 'SAR',
                cart_amount: ctx.amountSar,
                cart_description: ctx.description,
                paypage_lang: ctx.lang,
                hide_shipping: true,
                callback: ctx.webhookUrl,
                return: ctx.returnUrl,
                customer_details: { name: ctx.buyerName || 'TAKI', email: ctx.buyerEmail, country: 'SA' },
            }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.redirect_url || !j?.tran_ref) throw new Error(`paytabs_create_failed:${r.status}:${str(j?.message)}`);
        return { url: String(j.redirect_url), ref: String(j.tran_ref) };
    },
    async verifyCredentials(cfg) {
        // استعلام عن مرجع وهمي: 401 = مفاتيح خاطئة؛ أي رد آخر = المصادقة سليمة
        const r = await fetch('https://secure.paytabs.sa/payment/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: cfg.secret_key || '' },
            body: JSON.stringify({ profile_id: Number(str(cfg.extra_config?.profile_id)) || 0, tran_ref: 'TST0000000000000' }),
        });
        if (r.status === 401 || r.status === 403) return { ok: false, error: `paytabs_auth_${r.status}` };
        return { ok: true };
    },
    async confirmPayment(cfg, ref) {
        const r = await fetch('https://secure.paytabs.sa/payment/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: cfg.secret_key || '' },
            body: JSON.stringify({ profile_id: Number(str(cfg.extra_config?.profile_id)) || 0, tran_ref: ref }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return { paid: false, reason: `paytabs_query_${r.status}` };
        const ok = j?.payment_result?.response_status === 'A';
        return { paid: ok, amountSar: round2(Number(j?.cart_amount || 0)), ref };
    },
    async verifyWebhook(cfg, evt) {
        // HMAC-SHA256 للجسم الخام بمفتاح الخادم — ثم استعلام تأكيدي server→server
        const sig = str(evt.headers['signature']);
        if (sig) {
            const calc = await hmacSha256Hex(cfg.secret_key || '', evt.rawBody);
            if (!timingSafeEqual(calc.toLowerCase(), sig.toLowerCase())) return { sigOk: false, reason: 'bad_signature' };
        }
        const ref = str(evt.body?.tran_ref) || str(evt.body?.tranRef);
        const barcode = str(evt.body?.cart_id) || str(evt.body?.cartId);
        if (!ref) return { sigOk: false, reason: 'no_tran_ref' };
        return { sigOk: true, ref, barcode };
    },
    /**
     * 📄 https://docs.paytabs.com/PT2-API-Endpoints/Integration-Types-Manuals/Own-Form/Own-Form-Step-7-Manage-Transactions/Own-Form-Step-7-Refund-Transaction/
     *    نفس نقطة `/payment/request` بـ `tran_type:'refund'` و`tran_ref` = مرجع
     *    البيع الأصلي، والمبلغ `cart_amount` **بوحدات كبرى** (ريال) كما في الإنشاء.
     *    والنجاح `payment_result.response_status = 'A'` وحدها؛ و`'P'` قيد التنفيذ
     *    (قُبل ⇒ لا يُعاد)، و`'H'` معلّقٌ لمراجعة ⇒ غامض فيُرفع استثناء.
     * 🪤 لا مفتاح تكرار: نداءان = استردادان.
     */
    async refundPayment(cfg, ref, amountSar, reason, barcode) {
        const r = await fetch('https://secure.paytabs.sa/payment/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: cfg.secret_key || '' },
            body: JSON.stringify({
                profile_id: Number(str(cfg.extra_config?.profile_id)) || undefined,
                tran_type: 'refund',
                tran_class: 'ecom',
                tran_ref: ref,
                cart_id: barcode || ref,
                cart_currency: 'SAR',
                cart_amount: round2(amountSar),
                cart_description: `TAKI refund ${barcode || ref} — ${reason}`.slice(0, 90),
            }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status >= 500) throw new Error(`paytabs_refund_${r.status}`);
        if (!r.ok) return { ok: false, reason: `paytabs_refund_${r.status}:${str(j?.message)}`.slice(0, 160) };
        const st = str(j?.payment_result?.response_status).toUpperCase();
        const msg = str(j?.payment_result?.response_message) || str(j?.message);
        if (st === 'A' || st === 'P') return { ok: true, refundRef: str(j?.tran_ref) || ref };
        if (!st || st === 'H') throw new Error(`paytabs_refund_unclear_${st || 'no_status'}:${msg}`.slice(0, 160));
        return { ok: false, reason: `paytabs_${st}:${msg}`.slice(0, 160) };
    },
};

// ============================================================
// Amazon Payment Services «بيفورت — PayFort سابقاً»
// توقيع SHA-256 بعبارتي request/response (تُخزنان في Vault)
// secret_key = SHA Request Phrase / webhook_secret = SHA Response Phrase
// extra_config: access_code, merchant_identifier, test_mode
// ============================================================
async function payfortSign(phrase: string, fields: Record<string, string>): Promise<string> {
    const keys = Object.keys(fields).filter((k) => k !== 'signature').sort();
    return await sha256Hex(phrase + keys.map((k) => `${k}=${fields[k]}`).join('') + phrase);
}
const payfortHost = (cfg: GatewayCfg) =>
    cfg.extra_config?.test_mode ? 'https://sbcheckout.payfort.com' : 'https://checkout.payfort.com';
const payfortApiHost = (cfg: GatewayCfg) =>
    cfg.extra_config?.test_mode ? 'https://sbpaymentservices.payfort.com' : 'https://paymentservices.payfort.com';

const payfort: ProviderAdapter = {
    async createHostedPayment(_cfg, ctx) {
        // بيفورت يتطلب POST لنموذج موقّع — الرابط يمر عبر صفحتنا الوسيطة الموقعة
        return { url: ctx.pageUrl, ref: ctx.barcode };
    },
    async renderPage(cfg, ctx) {
        const fields: Record<string, string> = {
            command: 'PURCHASE',
            access_code: str(cfg.extra_config?.access_code),
            merchant_identifier: str(cfg.extra_config?.merchant_identifier),
            merchant_reference: ctx.barcode,
            amount: String(toMinor(ctx.amountSar)),
            currency: 'SAR',
            language: ctx.lang,
            customer_email: ctx.buyerEmail,
            return_url: ctx.returnUrl,
        };
        fields.signature = await payfortSign(cfg.secret_key || '', fields);
        const inputs = Object.entries(fields)
            .map(([k, v]) => `<input type="hidden" name="${k}" value="${v.replace(/"/g, '&quot;')}">`)
            .join('\n');
        return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>تحويل آمن للدفع…</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family:-apple-system,Tahoma,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f8fafc">
<div style="text-align:center"><div style="font-size:2.5rem">🔒</div>
<p style="font-weight:800">جاري تحويلك لصفحة الدفع الآمنة…</p>
<form id="pf" method="post" action="${payfortHost(cfg)}/FortAPI/paymentPage">${inputs}</form>
<script>document.getElementById('pf').submit();</script></div></body></html>`;
    },
    async verifyCredentials(cfg) {
        const fields: Record<string, string> = {
            query_command: 'CHECK_STATUS',
            access_code: str(cfg.extra_config?.access_code),
            merchant_identifier: str(cfg.extra_config?.merchant_identifier),
            merchant_reference: 'TAKI-VERIFY',
            language: 'en',
        };
        fields.signature = await payfortSign(cfg.secret_key || '', fields);
        const r = await fetch(`${payfortApiHost(cfg)}/FortAPI/paymentApi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
        });
        const j = await r.json().catch(() => ({}));
        const msg = str(j?.response_message);
        if (!msg) return { ok: false, error: 'payfort_no_response' };
        if (/signature|access code|merchant identifier/i.test(msg) && !/success|no.*record/i.test(msg)) {
            return { ok: false, error: `payfort_${msg}` };
        }
        return { ok: true };
    },
    async confirmPayment(cfg, _ref, barcode) {
        const fields: Record<string, string> = {
            query_command: 'CHECK_STATUS',
            access_code: str(cfg.extra_config?.access_code),
            merchant_identifier: str(cfg.extra_config?.merchant_identifier),
            merchant_reference: barcode,
            language: 'en',
        };
        fields.signature = await payfortSign(cfg.secret_key || '', fields);
        const r = await fetch(`${payfortApiHost(cfg)}/FortAPI/paymentApi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
        });
        const j = await r.json().catch(() => ({}));
        // transaction_status '14' = Purchase Success — والمبلغ محمي أصلاً لأنه
        // مُوقَّع داخل نموذج الإنشاء (تغييره يبطل التوقيع)، فالمطابقة تتم هناك.
        const paid = str(j?.transaction_status) === '14';
        const fortId = str(j?.fort_id);
        return { paid, ref: fortId || barcode };
    },
    async verifyWebhook(cfg, evt) {
        // إشعار بيفورت (feed/return) موقّع بعبارة الـresponse — نتحقق بإعادة الحساب
        const params: Record<string, string> = {};
        for (const [k, v] of Object.entries(evt.body)) params[k] = str(v);
        for (const [k, v] of evt.query.entries()) if (!(k in params)) params[k] = v;
        delete params.op; delete params.provider; delete params.m; delete params.barcode;
        const given = str(params.signature);
        if (!given) return { sigOk: false, reason: 'no_signature' };
        const calc = await payfortSign(cfg.webhook_secret || '', params);
        if (!timingSafeEqual(calc.toLowerCase(), given.toLowerCase())) return { sigOk: false, reason: 'bad_signature' };
        return { sigOk: true, ref: str(params.fort_id) || str(params.merchant_reference), barcode: str(params.merchant_reference) };
    },
    /**
     * 📄 https://paymentservices.amazon.com/docs/api/managing-payments/refund
     *    `command='REFUND'` على نفس `FortAPI/paymentApi`، والمبلغ **بأصغر وحدة**
     *    (هللات)، والتوقيع بعبارة الطلب (SHA Request Phrase = `secret_key` عندنا،
     *    وهي نفسها المستعملة في `PURCHASE` و`CHECK_STATUS`).
     *    و`fort_id` أو `merchant_reference` — «واحدٌ منهما يكفي» ونرسل الاثنين.
     * 📄 والنجاح `status = '06'`:
     *    https://paymentservices.amazon.com/docs/managing-payments/refunding-payment
     * ✅ `maintenance_reference` مفتاح تكرارٍ حقيقي عند المزوّد نفسه («يسمح بإعادة
     *    المحاولة بنفس المرجع») — نشتقّه ثابتاً من رقم الطلب، فإعادةُ محاولةٍ
     *    بنفسه لا تُنتج استرداداً ثانياً. وهو وتشيك‑أوت الوحيدان بهذه الحماية.
     */
    async refundPayment(cfg, ref, amountSar, _reason, barcode) {
        const mref = barcode || ref;
        const fields: Record<string, string> = {
            command: 'REFUND',
            access_code: str(cfg.extra_config?.access_code),
            merchant_identifier: str(cfg.extra_config?.merchant_identifier),
            merchant_reference: mref,
            amount: String(toMinor(amountSar)),
            currency: 'SAR',
            language: 'ar',
            maintenance_reference: `TKRF-${mref}`,
            // 🪤 لا نصّ حرّ (ولا عربيّ) داخل حقلٍ **مُوقَّع**: التوقيع يُحسب على
            //    القيمة الخام، وأي اختلاف ترميزٍ بيننا وبين المزوّد يُبطله
            //    فيُرفض الاسترداد بلا سببٍ ظاهر. السبب محفوظ عندنا في القاعدة.
            order_description: `TAKI refund ${mref}`.slice(0, 150),
        };
        if (ref && ref !== mref) fields.fort_id = ref;
        fields.signature = await payfortSign(cfg.secret_key || '', fields);
        const r = await fetch(`${payfortApiHost(cfg)}/FortAPI/paymentApi`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status >= 500) throw new Error(`payfort_refund_${r.status}`);
        const st = str(j?.status);
        const msg = str(j?.response_message);
        if (st === '06') return { ok: true, refundRef: str(j?.fort_id) || `TKRF-${mref}` };
        // '08' استرداد فاشل · '00' طلب غير صالح — رفضٌ قاطع بلا حركة مال
        if (st === '08' || st === '00') return { ok: false, reason: `payfort_${st}:${msg}`.slice(0, 160) };
        throw new Error(`payfort_refund_unclear_${st || 'no_status'}:${msg}`.slice(0, 160));
    },
};

// ============================================================
// HyperPay (هايبر باي) — CopyandPay: التأكيد حصراً بالاستعلام عن
// resourcePath بسر الحساب — لا اعتماد على أي رد راجع للمتصفح
// extra_config: entity_id, test_mode
// ============================================================
const hyperpayHost = (cfg: GatewayCfg) =>
    cfg.extra_config?.test_mode ? 'https://eu-test.oppwa.com' : 'https://eu-prod.oppwa.com';
const HYPERPAY_OK = /^(000\.000\.|000\.100\.1|000\.[36])/;

const hyperpay: ProviderAdapter = {
    async createHostedPayment(_cfg, ctx) {
        // الودجت يحتاج صفحة تستضيف paymentWidgets.js — عبر صفحتنا الوسيطة الموقعة
        return { url: ctx.pageUrl, ref: ctx.barcode };
    },
    async renderPage(cfg, ctx) {
        const host = hyperpayHost(cfg);
        const body = new URLSearchParams({
            entityId: str(cfg.extra_config?.entity_id),
            amount: ctx.amountSar.toFixed(2),
            currency: 'SAR',
            paymentType: 'DB',
            merchantTransactionId: ctx.barcode,
        });
        const r = await fetch(`${host}/v1/checkouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${cfg.secret_key || ''}` },
            body: body.toString(),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.id) throw new Error(`hyperpay_checkout_failed:${r.status}:${str(j?.result?.description)}`);
        return `<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>الدفع الآمن</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="${host}/v1/paymentWidgets.js?checkoutId=${encodeURIComponent(String(j.id))}"></script></head>
<body style="font-family:-apple-system,Tahoma,sans-serif;margin:0;background:#f8fafc;padding:24px 12px">
<div style="max-width:480px;margin:0 auto"><h3 style="text-align:center">💳 أكمل الدفع بأمان</h3>
<form action="${ctx.returnUrl.replace(/"/g, '&quot;')}" class="paymentWidgets" data-brands="MADA VISA MASTER"></form>
</div></body></html>`;
    },
    async verifyCredentials(cfg) {
        // إنشاء جلسة checkout بريال واحد = فحص مصادقة نظيف (لا يُحصَّل أي مبلغ)
        const host = hyperpayHost(cfg);
        const body = new URLSearchParams({
            entityId: str(cfg.extra_config?.entity_id),
            amount: '1.00',
            currency: 'SAR',
            paymentType: 'DB',
            merchantTransactionId: 'TAKI-VERIFY',
        });
        const r = await fetch(`${host}/v1/checkouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${cfg.secret_key || ''}` },
            body: body.toString(),
        });
        const j = await r.json().catch(() => ({}));
        return r.ok && j?.id ? { ok: true } : { ok: false, error: `hyperpay_${r.status}_${str(j?.result?.description)}` };
    },
    async confirmPayment(cfg, ref, barcode) {
        const host = hyperpayHost(cfg);
        const entity = encodeURIComponent(str(cfg.extra_config?.entity_id));
        // ref هنا = resourcePath القادم من مسار العودة (المصدر المعتمد)
        if (ref && ref.startsWith('/')) {
            const r = await fetch(`${host}${ref}?entityId=${entity}`, {
                headers: { Authorization: `Bearer ${cfg.secret_key || ''}` },
            });
            const j = await r.json().catch(() => ({}));
            const code = str(j?.result?.code);
            return {
                paid: HYPERPAY_OK.test(code),
                amountSar: round2(Number(j?.amount || 0)),
                ref: str(j?.id) || barcode,
                reason: code || undefined,
            };
        }
        // بديل: استعلام التقارير برقم عمليتنا
        const r = await fetch(`${host}/v1/query?entityId=${entity}&merchantTransactionId=${encodeURIComponent(barcode)}`, {
            headers: { Authorization: `Bearer ${cfg.secret_key || ''}` },
        });
        const j = await r.json().catch(() => ({}));
        const p = Array.isArray(j?.payments) ? j.payments[0] : null;
        const code = str(p?.result?.code);
        return { paid: HYPERPAY_OK.test(code), amountSar: round2(Number(p?.amount || 0)), ref: str(p?.id) || barcode, reason: code || undefined };
    },
    async verifyWebhook(_cfg, evt) {
        // إشعارات هايبر باي مشفّرة — القاعدة المعتمدة: الاستعلام server→server
        // فقط؛ نتعامل مع الإشعار كمنبّه لإعادة الاستعلام بالمرجع إن وُجد.
        const barcode = str((evt.body?.payload as Record<string, unknown>)?.merchantTransactionId);
        return { sigOk: true, ref: '', barcode };
    },
    /**
     * 📄 استرداد الـback‑office على منصّة OPPWA/ACI التي يقوم عليها هايبر باي:
     *    `POST {host}/v1/payments/{paymentId}` بـ `paymentType=RF` مع `entityId`
     *    و`amount` (وحدات كبرى بمنزلتين) و`currency` — والمصادقة `Bearer`
     *    بالمفتاح السري، أي نفس قناة التحصيل حرفياً. (نموذج الوثيقة الرسمي:
     *    `-d "entityId=…" -d "amount=10.00" -d "currency=…" -d "paymentType=RF"`.)
     * 🪤 و`ref` هنا يجب أن يكون **معرّف دفعة** (يخزّنه `confirmPayment` من
     *    `j.id`)؛ فإن كان مساراً (`resourcePath`) أو رقم الطلب نفسه فلا استرداد
     *    ممكن — ونقولها صراحةً بدل نجاحٍ كاذب.
     * 🪤 ولا مفتاح تكرار: نداءان = استردادان.
     */
    async refundPayment(cfg, ref, amountSar, _reason, barcode) {
        if (!ref || ref.startsWith('/') || (barcode && ref === barcode)) {
            return { ok: false, reason: 'hyperpay_no_payment_id' };
        }
        const host = hyperpayHost(cfg);
        const body = new URLSearchParams({
            entityId: str(cfg.extra_config?.entity_id),
            amount: round2(amountSar).toFixed(2),
            currency: 'SAR',
            paymentType: 'RF',
        });
        const r = await fetch(`${host}/v1/payments/${encodeURIComponent(ref)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Bearer ${cfg.secret_key || ''}` },
            body: body.toString(),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status >= 500) throw new Error(`hyperpay_refund_${r.status}`);
        const code = str(j?.result?.code);
        const desc = str(j?.result?.description);
        // نجاح، أو `000.200.*` «قيد المعالجة» — وكلاهما **قُبل** فلا يُعاد أبداً
        if (HYPERPAY_OK.test(code) || /^000\.200/.test(code)) return { ok: true, refundRef: str(j?.id) || ref };
        // `900.*`/`999.*` خلل اتصالٍ بالمستحوِذ ⇒ النتيجة غير معلومة
        if (!code || /^(900\.|999\.)/.test(code)) throw new Error(`hyperpay_refund_unclear_${code || r.status}`);
        return { ok: false, reason: `hyperpay_${code}:${desc}`.slice(0, 160) };
    },
};

// ============================================================
// Checkout.com — Hosted Payments Page + HMAC webhook
// ============================================================
const checkoutHost = (cfg: GatewayCfg) =>
    (cfg.secret_key || '').startsWith('sk_sbox_') ? 'https://api.sandbox.checkout.com' : 'https://api.checkout.com';

const checkout: ProviderAdapter = {
    async createHostedPayment(cfg, ctx) {
        const payload: Record<string, unknown> = {
            amount: toMinor(ctx.amountSar),
            currency: 'SAR',
            reference: ctx.barcode,
            description: ctx.description,
            billing: { address: { country: 'SA' } },
            success_url: ctx.returnUrl,
            failure_url: ctx.returnUrl,
            cancel_url: ctx.returnUrl,
            metadata: { barcode: ctx.barcode, merchant_id: ctx.merchantId },
        };
        const channel = str(cfg.extra_config?.processing_channel_id);
        if (channel) payload.processing_channel_id = channel;
        const r = await fetch(`${checkoutHost(cfg)}/hosted-payments`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.secret_key || ''}` },
            body: JSON.stringify(payload),
        });
        const j = await r.json().catch(() => ({}));
        const url = j?._links?.redirect?.href;
        if (!r.ok || !url || !j?.id) throw new Error(`checkout_create_failed:${r.status}:${str(j?.error_codes?.[0])}`);
        return { url: String(url), ref: String(j.id) };
    },
    async verifyCredentials(cfg) {
        const r = await fetch(`${checkoutHost(cfg)}/event-types`, {
            headers: { Authorization: `Bearer ${cfg.secret_key || ''}` },
        });
        if (r.status === 401 || r.status === 403) return { ok: false, error: `checkout_auth_${r.status}` };
        return { ok: true };
    },
    async confirmPayment(cfg, ref) {
        // يقبل payment id أو cko-session-id
        const r = await fetch(`${checkoutHost(cfg)}/payments/${encodeURIComponent(ref)}`, {
            headers: { Authorization: `Bearer ${cfg.secret_key || ''}` },
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return { paid: false, reason: `checkout_fetch_${r.status}` };
        const status = str(j?.status);
        const paid = j?.approved === true && (status === 'Captured' || status === 'Paid' || status === 'Authorized');
        return { paid, amountSar: round2(Number(j?.amount || 0) / 100), ref: str(j?.id) || ref };
    },
    async verifyWebhook(cfg, evt) {
        const sig = str(evt.headers['cko-signature']);
        if (cfg.webhook_secret) {
            if (!sig) return { sigOk: false, reason: 'no_signature' };
            const calc = await hmacSha256Hex(cfg.webhook_secret, evt.rawBody);
            if (!timingSafeEqual(calc.toLowerCase(), sig.toLowerCase())) return { sigOk: false, reason: 'bad_signature' };
        }
        const data = (evt.body?.data || {}) as Record<string, unknown>;
        const meta = (data?.metadata || {}) as Record<string, unknown>;
        return { sigOk: true, ref: str(data?.id), barcode: str(meta?.barcode) || str(data?.reference) };
    },
    /**
     * 📄 https://www.checkout.com/docs/payments/manage-payments/refund-a-payment/refund-a-payment-with-a-reference
     *    `POST /payments/{id}/refunds` بـ `{ amount (بأصغر وحدة), reference, metadata }`
     *    ⇒ **202** بجسم `{ action_id, reference, _links }`.
     * 🪤 والاسترداد هنا **غير متزامن**: ٢٠٢ تعني «قُبل» لا «تمّ»، والحسم النهائي
     *    يأتي بـwebhook. ولذلك ٢٠٢ عندنا `ok:true` — لأن إعادة النداء بعدها
     *    تُنتج استرداداً ثانياً فعليّاً، وهذا أسوأ من انتظار تأكيد.
     * ✅ والمزوّد الوحيد هنا بمفتاح تكرارٍ معلَن: `Cko-Idempotency-Key`
     *    📄 https://www.checkout.com/docs/developer-resources/api/idempotency
     *    (يُحفظ ٧٢ ساعة) — نشتقّه ثابتاً من الطلب والمرجع والمبلغ، فإعادةُ
     *    محاولةٍ خلال المهلة تعيد نفس الجواب بلا خصمٍ ثانٍ.
     */
    async refundPayment(cfg, ref, amountSar, reason, barcode) {
        const idem = (await sha256Hex(`taki-refund|${barcode || ''}|${ref}|${toMinor(amountSar)}`)).slice(0, 40);
        const r = await fetch(`${checkoutHost(cfg)}/payments/${encodeURIComponent(ref)}/refunds`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${cfg.secret_key || ''}`,
                'Cko-Idempotency-Key': idem,
            },
            body: JSON.stringify({
                amount: toMinor(amountSar),
                reference: barcode || ref,
                metadata: { barcode: barcode || '', taki_reason: reason.slice(0, 120) },
            }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 200 || r.status === 201 || r.status === 202) {
            return { ok: true, refundRef: str(j?.action_id) || str(j?.reference) || idem };
        }
        if (r.status >= 500) throw new Error(`checkout_refund_${r.status}`);
        const codes = Array.isArray(j?.error_codes) ? j.error_codes.join(',') : '';
        return { ok: false, reason: `checkout_refund_${r.status}:${codes || str(j?.error_type)}`.slice(0, 160) };
    },
};

export const ADAPTERS: Record<string, ProviderAdapter> = { sim, moyasar, tap, paytabs, payfort, hyperpay, checkout };
