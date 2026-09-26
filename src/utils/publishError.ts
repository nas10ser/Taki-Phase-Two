/**
 * publishError — سببُ رفض النشر، بعبارةٍ يفهمها التاجر (v14.95)
 * ═══════════════════════════════════════════════════════════════════════════
 * حارسا `deals` الجديدان يرفعان استثناءً **بالعربي** من القاعدة، ولو وصل خاماً
 * إلى التاجر لصار «تعذّر حفظ العرض في قاعدة البيانات.» متبوعاً بنصٍّ لا يقول
 * له ماذا يفعل. فهذه الدالّة تحوّل الرمز/النصّ إلى عبارةٍ فيها **الخطوة
 * التالية**، وتُرجع `null` لأي شيءٍ لا تعرفه — فيبقى بديلُ المنادي كما هو.
 *
 * 🪤 لماذا تُطابَق الرموز **والنصّ** معاً: PostgREST يسلّم `code` و`message` في
 *    حقلين، و`dealRepository.save` ترمي الكائن كما هو، فالمنادي قد يمرّر
 *    `error.message` وحده. فمرِّر ما شئت — `msg` أو `` `${code} ${msg}` `` —
 *    والدالّة تلتقط الاثنين. (أرخصُ من فرض شكلٍ على كل منادٍ ثم نسيانه.)
 *
 * 🪤 والتطبيع ليس تجميلاً: نصّ القاعدة يحمل الشدّة («موثّق» · «يُحدَّد»)، وأي
 *    مطابقةٍ حرفيّةٍ تنكسر بحركةٍ واحدة تُضاف أو تُحذف في هجرةٍ لاحقة.
 */

/** يُسقط الحركات والتطويل، ويوحّد الهمزات — مطابقةٌ لا تنكسر بشدّة. */
const norm = (s: string): string =>
    s.replace(/[ً-ْٰـ]/g, '')
     .replace(/[أإآ]/g, 'ا')
     .replace(/\s+/g, ' ')
     .trim();

export function publishErrorMessage(msg: string, isRTL: boolean): string | null {
    const raw = String(msg || '');
    if (!raw) return null;
    const n = norm(raw);

    // ── حدّ المواقع (قائم منذ v12.32) — نفسُ نصّ AppContext حرفاً بحرف ──────
    if (/LOCATION_LIMIT_EXCEEDED/i.test(raw)) {
        return isRTL
            ? '⚠️ وصلت لحد المواقع المسموح في باقتك.\n\nاختر موقعاً من مواقعك الحالية، أو احذف كل منتجات أحد المواقع الشاغرة لتفريغ خانة قبل إضافة موقع جديد. للترقية لباقة أكبر تواصل مع إدارة تاكي.'
            : '⚠️ You\'ve reached your package\'s location limit.\n\nPick one of your existing locations, or free a vacant slot first. Contact TAKI admin to upgrade.';
    }

    // ── P0022 — الحساب ليس حساب تاجر أصلاً ────────────────────────────────
    if (/\bP0022\b/.test(raw) || /ليس حساب تاجر/.test(n)) {
        return isRTL
            ? '⚠️ هذا الحساب ليس حساب تاجر، فلا يُنشر منه عرض.\n\nإن كنت تاجراً فتواصل مع إدارة تاكي لتحويل حسابك إلى حساب متجر.'
            : '⚠️ This is not a merchant account, so it cannot publish a deal.\n\nIf you are a merchant, contact TAKI support to switch your account to a store account.';
    }

    // ── P0024 — متجرٌ غير موثّق (يُفحص قبل P0023: نصّه يذكر «التوثيق» أيضاً) ─
    if (/\bP0024\b/.test(raw) || /غير موثق/.test(n)) {
        return isRTL
            ? '🪪 لم يُنشر عرضك: متجرك غير موثّق بعد.\n\nافتح «حسابي ← لوحة التاجر ← توثيق المتجر» وأرسل رقم سجلك والاسم المسجَّل. تصلك النتيجة إشعاراً، وتُنشر عروضك بضغطة بعدها.\n\n(عروضك المنشورة سابقاً تبقى تعمل كما هي.)'
            : '🪪 Your deal was not published: your store is not verified yet.\n\nOpen “My account → Merchant dashboard → Store verification” and send your registration number and registered name. You will get the result as a notification, and can publish right after.\n\n(Deals already published keep working.)';
    }

    // ── P0023 — رقم السجل لا يُكتب يدوياً ─────────────────────────────────
    if (/\bP0023\b/.test(raw) || /رقم السجل/.test(n)) {
        return isRTL
            ? '🪪 رقم السجل لا يُكتب يدوياً — يُعتمد من طلب التوثيق وحده، لأنه يُطبع على فواتير عملائك.\n\nأرسله من «حسابي ← لوحة التاجر ← توثيق المتجر».'
            : '🪪 The registration number cannot be typed in by hand — it is set only by an approved verification request, because it is printed on your customers’ invoices.\n\nSend it from “My account → Merchant dashboard → Store verification”.';
    }

    return null;
}

export default publishErrorMessage;
