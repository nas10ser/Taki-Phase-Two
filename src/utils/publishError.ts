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

    // ── SUBSCRIPTION_REQUIRED — دائمٌ لا عابر، و«حاول بعد قليل» نصيحةٌ لا تنجح ─
    if (/SUBSCRIPTION_REQUIRED/i.test(raw)) {
        return isRTL
            ? '🔒 اشتراكك منتهي — لا يمكن نشر عرضٍ أو تعديله قبل تجديده.\n\nافتح «حسابي ← الاشتراك» وجدّد باقتك، ثم احفظ مرّةً أخرى.'
            : '🔒 Your subscription has expired — deals cannot be published or edited until it is renewed.\n\nOpen “My account → Subscription”, renew, then save again.';
    }

    // ── P0018 — حسابٌ موقوف. ⛔ لا ⚠️: وقفٌ تامٌّ لا عطلٌ يُعاد معه ───────────
    if (/\bP0018\b/.test(raw) || /حسابك موقوف/.test(n)) {
        return isRTL
            ? '⛔ حسابك موقوف، فلا يمكن نشر العروض ولا تعديلها.\n\nراسل إدارة تاكي من «حسابي ← الدعم» لمعرفة السبب وطلب المراجعة.'
            : '⛔ Your account is suspended, so deals cannot be published or edited.\n\nContact TAKI support from “My account → Support” to ask for a review.';
    }

    // ── 42501 — رفضُ صلاحيّة. دائمٌ كذلك: الجلسةُ لم تعد تخصّ هذا المتجر ────
    if (/\b42501\b/.test(raw) || /row-level security/i.test(raw)) {
        return isRTL
            ? '⚠️ لم يُحفظ — الجلسة لم تَعُد صالحة لهذا المتجر.\n\nاخرج من حسابك ثم ادخل مرّةً أخرى، وأعِد الحفظ.'
            : '⚠️ Not saved — this session is no longer valid for this store.\n\nSign out, sign back in, and save again.';
    }

    return null;
}

/**
 * saveErrorMessage — ما يُعرض للتاجر حين يرفض الخادمُ حفظاً (v15.84)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **أمرُ ناصر (٩ نوفمبر ٢٠٢٦): «قاعدة البيانات» تُحذف من كلّ ما يراه
 *    المستخدم.** كان التاجر يرى: «⚠️ تعذّر حفظ التغيير في قاعدة البيانات.»
 *    ثمّ بين قوسين الجملةَ الوحيدة المفيدة. والجملةُ الأولى لا تقول له شيئاً
 *    يفعله، و«قاعدة البيانات» ليست من شأنه أصلاً.
 *
 * 🔴 **ولا يكفي حذفُ السطر**: لو حُذف وحده لصار التنبيهُ فارغاً حين لا يحمل
 *    الخطأُ نصّاً (شبكةٌ مقطوعة · رفضٌ بلا رسالة)، و«زرٌّ صامت» أسوأ من
 *    مصطلحٍ ثقيل. فالترتيبُ ثلاثُ درجات:
 *      ١) سببٌ معروف  ⇒ `publishErrorMessage` (فيه **الخطوة التالية**).
 *      ٢) رسالةٌ عربيّة من حرّاسنا ⇒ تُعرض كما هي، فهي مكتوبةٌ للتاجر أصلاً.
 *      ٣) غيرُ ذلك (إنجليزيٌّ تقنيّ أو فارغ) ⇒ جملةٌ بشريّةٌ بلا مصطلحات.
 *
 * 🪤 و`hint` تُقرأ مع `message`: PostgREST **لا يُمرّر إلا `P0001`**، وكلُّ
 *    رمزٍ آخر عندنا يسافر داخل `HINT`. فقراءةُ الرسالة وحدها تُضيّع السبب.
 */
export function saveErrorMessage(err: any, isRTL: boolean): string {
    const code = String((err && err.code) || '');
    const msg  = String((err && err.message) || '');
    const hint = String((err && err.hint) || '');

    const known = publishErrorMessage(`${code} ${msg} ${hint}`, isRTL);
    if (known) return known;

    // رسائلُ حرّاسنا مكتوبةٌ بالعربيّة للتاجر — تُعرض وحدها بلا إطارٍ تقنيّ.
    // 🔴 و«فيها حرفٌ عربيّ» **ليست** القاعدة (صُحّح في نفس اليوم بعد قياس):
    //    رسالةُ بوستجرس الإنجليزيّة قد تضمّ قيمةَ المستخدم كما كتبها، فـ
    //    `invalid input syntax for type numeric: "٥٠"` كانت تُعرض وكأنها
    //    نصيحتُنا. والأسوأ أن كتلة `\u0600-\u06FF` **تشمل الأرقام العربيّة**
    //    (٠-٩ عند U+0660)، فرقمٌ واحدٌ كان يكفي لتمريرها.
    //    ⇒ المعيار: حروفٌ عربيّةٌ **صِرفة** (بلا أرقام)، و**أكثر** من اللاتينيّة.
    const arabicWins = (x: string): boolean => {
        const ar = (x.match(/[\u0621-\u064A]/g) || []).length;
        const la = (x.match(/[A-Za-z]/g) || []).length;
        return ar >= 8 && ar > la;
    };
    const human = [msg, hint].map((x) => x.trim()).find(arabicWins);
    if (human) {
        // 🪤 ولا تُضاعَف العلامة: نصُّ القاعدة قد يبدأ برمزٍ أصلاً («🪪» · «⚠️»).
        return /^[A-Za-z\u0600-\u06FF0-9(]/.test(human) ? `⚠️ ${human}` : human;
    }

    return isRTL
        ? '⚠️ لم يُحفظ التغيير — حاول مرّةً أخرى بعد قليل.'
        : '⚠️ The change was not saved — please try again shortly.';
}

export default publishErrorMessage;
