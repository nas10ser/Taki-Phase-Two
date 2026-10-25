/**
 * stockNotes.ts — ماذا يعني كلُّ وسمِ حالةٍ للتاجر (v15.20)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 ولماذا وُجد هذا الملفّ: تدقيقٌ خصوميٌّ قاس أنّ القاعدة تكتب **أكثر من
 *    عشرين** وسمَ حالة، والشاشةُ كانت تعرف ثلاثةً فقط (OK · NOT_LINKED ·
 *    UNMAPPED). فكلُّ وسمٍ آخر يُصيّر «رسالةً وصلت» بلا أيّ تفسير — ومتجرُ
 *    زدٍّ لا يُزامن شيئاً **يبدو مُزامَناً تماماً**.
 *    وهذا بالضبط أسوأُ ما يمكن أن تفعله شاشة: أن تُسكت خطأً بدل أن تقوله.
 *
 * 🪤 ومصدرٌ واحدٌ لا نسختان: كلُّ وسمٍ تكتبه القاعدة يُضاف هنا، و`npm test`
 *    يقارن القائمتين (`scripts/check-stock-notes.js`) فلا تنحرفان بصمت —
 *    وهو نفسُ درس `notifications_type_check` الذي كان يسمح بستّة أنواع
 *    والمنصّةُ تكتب تسعة.
 */

export type NoteTone = 'ok' | 'warn' | 'bad' | 'info';

export interface NoteDef {
    tone: NoteTone;
    ar: string;
    en: string;
    /** ماذا يفعل التاجر الآن — وبلا هذا يصير الوسمُ شكوى لا إرشاداً. */
    doAr?: string;
    doEn?: string;
}

export const STOCK_NOTES: Record<string, NoteDef> = {
    // ── الطريقُ السليم ───────────────────────────────────────────────────
    OK:        { tone: 'ok',   ar: 'فُهمت وطُبّقت', en: 'understood & applied' },
    SYNCED:    { tone: 'ok',   ar: 'قُرئ الرقم من نظامك وطُبّق', en: 'read from your system and applied' },
    CONNECTED: { tone: 'ok',   ar: 'متّصل', en: 'connected' },
    MAPPED:    { tone: 'ok',   ar: 'رُبطت الحقول', en: 'fields mapped' },

    // ── وصلت ولم تُكتب، ولكلٍّ سببٌ مختلف ────────────────────────────────
    DUPLICATE: {
        tone: 'info', ar: 'تكرارٌ لرسالةٍ سابقة — لم تُطبَّق ثانيةً',
        en: 'a repeat of an earlier message — not applied twice',
        doAr: 'لا شيء. هذا طبيعيّ: نظامُك أعاد الإرسال وتاكي لم تُطبّقه مرّتين.',
        doEn: 'Nothing. Normal: your system retried and TAKI did not apply it twice.',
    },
    NOT_LINKED: {
        tone: 'warn', ar: 'كودُها غير مربوطٍ بأيّ عرض',
        en: 'its code is not linked to any deal',
        doAr: 'اربط هذا الكود بعرضٍ من قائمة «اربط منتجاً» أدناه.',
        doEn: 'Link that code to a deal using «Link a product» below.',
    },
    UNMAPPED: {
        tone: 'warn', ar: 'لم نفهم شكلَ الرسالة',
        en: 'message shape not understood',
        doAr: 'اكتب مكانَ الكود ومكانَ الكمّية داخل الرسالة المعروضة أدناه.',
        doEn: 'Enter where the code and the quantity sit inside the message shown below.',
    },
    PARENT_OR_UNLIMITED: {
        tone: 'info', ar: 'منتجٌ كمّيتُه في أصنافه أو بلا حدّ — فلا رقمَ في جذر الرسالة',
        en: 'stock lives per variant/location or is unlimited — no number at the message root',
        doAr: 'لا شيء: تاكي تقرأ الرقم من واجهة نظامك بعد قليل بدل أن تأخذ صفرَ الجذر.',
        doEn: 'Nothing: TAKI re-reads the number from your system’s API instead of trusting the root zero.',
    },
    NO_EFFECT: {
        tone: 'info', ar: 'الرقمُ نفسُه لم يتغيّر', en: 'the number did not change',
    },
    BODY_NOT_OBJECT: {
        tone: 'warn', ar: 'وصلت رسالةٌ ليست كائنَ JSON',
        en: 'the message was not a JSON object',
        doAr: 'سلّم الرابطَ لمن يبرمج نظامك: الجسمُ يجب أن يكون JSON.',
        doEn: 'Hand the URL to your system’s developer: the body must be JSON.',
    },
    THROTTLED: {
        tone: 'warn', ar: 'رسائلُ نظامك أكثرُ من المسموح — خُنقت مؤقّتاً',
        en: 'your system is sending faster than allowed — temporarily throttled',
        doAr: 'لا شيء عادةً: نظامُك سيُعيد المحاولة. وإن تكرّر، اطلب تقليلَ معدّل الإرسال.',
        doEn: 'Usually nothing: your system will retry. If it persists, ask for a lower send rate.',
    },
    NEW_URL_NOT_TRIED: {
        tone: 'info', ar: 'أُصدر رابطٌ جديد ولم تصل إليه رسالةٌ بعد',
        en: 'a new URL was issued and nothing has arrived on it yet',
        doAr: 'الصق الرابطَ الجديد في نظامك (أو اضغط «اربط متجرك» إن كان سلّة أو زد).',
        doEn: 'Paste the new URL into your system (or press «Connect your store» for Salla/Zid).',
    },

    // ── الربطُ مقطوع ─────────────────────────────────────────────────────
    NOT_CONNECTED: {
        tone: 'bad', ar: 'لم يُسمح لتاكي بقراءة مخزونك بعد',
        en: 'TAKI is not yet allowed to read your stock',
        doAr: 'اضغط «اربط متجرك» وأذِن لتاكي بضغطة.',
        doEn: 'Press «Connect your store» and approve TAKI.',
    },
    TOKEN_REJECTED: {
        tone: 'bad', ar: 'نظامُك رفض إذنَ تاكي',
        en: 'your system rejected TAKI’s token',
        doAr: 'اضغط «أعِد الربط» — سيُطلب إذنُك مرّةً أخرى.',
        doEn: 'Press «Reconnect» — you will be asked to approve again.',
    },
    DISCONNECTED: {
        tone: 'info', ar: 'فصلتَ الربطَ بنفسك', en: 'you disconnected it yourself',
    },
    UNINSTALLED_AT_PROVIDER: {
        tone: 'bad', ar: 'أُزيل تطبيقُ تاكي من متجرك عندهم',
        en: 'the TAKI app was removed from your store on their side',
        doAr: 'ثبّته من جديد ثمّ اضغط «اربط متجرك». وروابطُ منتجاتك محفوظة.',
        doEn: 'Install it again, then press «Connect your store». Your product links are kept.',
    },
    CONNECT_STARTED: {
        tone: 'info', ar: 'بدأ الربطُ وننتظر إذنَك عندهم',
        en: 'connection started, waiting for your approval on their side',
    },

    // ── التجديد: لا إعادةَ محاولةٍ آليّة، فلكلٍّ مخرجٌ بضغطة ──────────────
    REFRESH_REJECTED: {
        tone: 'bad', ar: 'انتهى إذنُ تاكي ورفض نظامُك تجديدَه',
        en: 'TAKI’s permission expired and your system refused to renew it',
        doAr: 'اضغط «أعِد الربط».', doEn: 'Press «Reconnect».',
    },
    REFRESH_UNKNOWN: {
        tone: 'bad', ar: 'انقطع التجديدُ ولا نعرف نتيجتَه — ولا نُعيد المحاولة',
        en: 'the renewal was interrupted with an unknown result — we do not retry',
        doAr: 'اضغط «أعِد الربط». ولا نُعيد المحاولة تلقائياً لأن محاولةً ثانيةً قد تُلغي الربطَ نهائياً.',
        doEn: 'Press «Reconnect». We never retry automatically: a second attempt can void the link for good.',
    },
    REFRESH_STUCK: {
        tone: 'bad', ar: 'عَلِق التجديدُ ولم تصل نتيجة',
        en: 'the renewal stalled with no result',
        doAr: 'اضغط «أعِد الربط».', doEn: 'Press «Reconnect».',
    },
    NO_REFRESH_TOKEN: {
        tone: 'bad', ar: 'لا يملك تاكي ما يُجدّد به الإذن',
        en: 'TAKI holds nothing it can renew the permission with',
        doAr: 'اضغط «أعِد الربط».', doEn: 'Press «Reconnect».',
    },
    REFRESH_SAVE_FAILED: {
        tone: 'bad', ar: 'جُدّد الإذنُ ولم نتمكّن من حفظه',
        en: 'the permission was renewed but could not be saved',
        doAr: 'اضغط «أعِد الربط».', doEn: 'Press «Reconnect».',
    },
    // ── سلّة: توكنٌ وصل ولم نستطع نسبتَه بيقين ─────────────────────────
    // 🔴 و«الوضعُ السهل» عند سلّة لا يُعيد `state` (قِيس من وثيقتهم) فالتوكن
    //    يصل برقم المتجر وحده. وإن التبس لا يُخمَّن: تخمينُ متجرٍ هنا يعني
    //    تسليمَ إذنِ تاجرٍ لتاجرٍ آخر.
    NO_OPEN_CLAIM: {
        tone: 'warn', ar: 'وصل إذنٌ من سلّة ولم يكن أحدٌ قد طلب الربط',
        en: 'a Salla permission arrived with no pending connect request',
        doAr: 'اضغط «اربط متجرك» ثمّ اكتب رقمَ متجرك في سلّة لاستلامه.',
        doEn: 'Press «Connect your store», then enter your Salla store id to claim it.',
    },
    AMBIGUOUS_CLAIM: {
        tone: 'warn', ar: 'وصل إذنٌ من سلّة وكان أكثرُ من متجرٍ ينتظر — فلم نُخمّن',
        en: 'a Salla permission arrived while more than one store was waiting — we did not guess',
        doAr: 'اكتب رقمَ متجرك في سلّة لاستلام إذنك بعينه.',
        doEn: 'Enter your Salla store id to claim your own permission.',
    },
    SECRET_WRITE_FAILED: {
        tone: 'bad', ar: 'تعذّر حفظُ إذنِ نظامك',
        en: 'could not store your system’s permission',
        doAr: 'أعِد المحاولة، وإن تكرّر أبلِغ الدعم.',
        doEn: 'Try again; if it persists, contact support.',
    },
};

/** وسمٌ غيرُ معروفٍ يُقال مجهولاً — ولا يُخفى ولا يُزوَّق. */
export const describeNote = (note: string | null | undefined, isRTL: boolean):
    { tone: NoteTone; text: string; todo?: string } => {
    const k = (note || '').trim();
    if (!k) return { tone: 'info', text: isRTL ? 'لا رسائلَ بعد' : 'nothing yet' };
    const d = STOCK_NOTES[k];
    if (!d) {
        return {
            tone: 'warn',
            text: isRTL ? `حالةٌ غيرُ معروفةٍ في هذه النسخة (${k})` : `state unknown to this version (${k})`,
            todo: isRTL ? 'حدّث الصفحة؛ وإن بقيت فأبلِغ الدعم بهذا الرمز.'
                        : 'Refresh the page; if it persists, report this code to support.',
        };
    }
    return { tone: d.tone, text: isRTL ? d.ar : d.en, todo: isRTL ? d.doAr : d.doEn };
};

export const NOTE_COLOR: Record<NoteTone, string> = {
    ok: 'var(--primary)',
    warn: '#b45309',
    bad: 'var(--danger, #ef4444)',
    info: 'var(--text-secondary)',
};

/**
 * أسبابُ الطابور (`stock_refresh_queue.last_error`) — جوابُ سؤالٍ واحد:
 * **«لماذا لم يتحرّك رقمي؟»**. وهي تُعرض للتاجر كما هي مشروحة.
 * 🪤 ولا تُخلط بأوسمة الاتصال: تلك حالةُ الربط، وهذه نتيجةُ محاولةٍ واحدة.
 */
export const QUEUE_REASONS: Record<string, NoteDef> = {
    // لا شيءَ يُكتب، وذلك صحيح
    UNLIMITED:         { tone: 'info', ar: 'المنتجُ بلا حدٍّ عندهم — فلا رقمَ يُنقل', en: 'the product is unlimited there — no number to copy' },
    NO_EFFECT:         { tone: 'info', ar: 'الرقمُ نفسُه لم يتغيّر', en: 'the number did not change' },
    NO_LINKS:          { tone: 'warn', ar: 'لا منتجَ مربوطاً بعد', en: 'no product linked yet',
                         doAr: 'اربط منتجاً من «اربط منتجاً» أدناه.', doEn: 'Link one using «Link a product» below.' },
    NOT_LINKED:        { tone: 'warn', ar: 'الكودُ غيرُ مربوطٍ بعرض', en: 'the code is not linked to a deal' },
    LOCATION_NOT_FOUND:{ tone: 'warn', ar: 'الفرعُ المربوطُ غيرُ موجودٍ في نظامهم', en: 'the linked branch does not exist there',
                         doAr: 'أعِد ربطَ المنتج بالفرع الصحيح.', doEn: 'Re-link the product to the right branch.' },
    NO_USABLE_RECORD:  { tone: 'warn', ar: 'لا سجلَّ مخزونٍ صالحاً في ردّهم', en: 'no usable stock record in their reply' },
    LINK_VARIANT_MISSING: { tone: 'bad', ar: 'الصنفُ المربوطُ غيرُ موجودٍ في عرضك', en: 'the linked variant does not exist on your deal',
                         doAr: 'أعِد الربط: الصنفُ حُذف من العرض أو تغيّر معرّفُه.', doEn: 'Re-link: the variant was removed or its id changed.' },
    LINK_LOCATION_MISSING: { tone: 'bad', ar: 'الفرعُ المربوطُ غيرُ موجودٍ في عرضك', en: 'the linked branch does not exist on your deal',
                         doAr: 'أعِد الربط بفرعٍ موجودٍ في العرض.', doEn: 'Re-link to a branch that exists on the deal.' },
    // أرقامٌ لا تُقبل
    QTY_NOT_AN_INTEGER:{ tone: 'warn', ar: 'الكمّيةُ ليست عدداً صحيحاً (مثل ١٫٥)', en: 'the quantity is not a whole number (e.g. 1.5)',
                         doAr: 'تاكي تبيع بالقطعة. لبيعٍ بالوزن اجعل الوحدةَ قطعةً (كيلو = قطعة).',
                         doEn: 'TAKI sells by the piece. For weight-based stock, make the unit a piece (1 kg = 1 piece).' },
    QTY_NOT_A_NUMBER:  { tone: 'warn', ar: 'الكمّيةُ ليست رقماً في ردّهم', en: 'the quantity is not a number in their reply' },
    QTY_MISSING:       { tone: 'warn', ar: 'لا كمّيةَ في الرسالة', en: 'no quantity in the message' },
    QTY_NEGATIVE:      { tone: 'warn', ar: 'كمّيةٌ سالبة — لم تُكتب', en: 'negative quantity — not written' },
    QTY_ABSURD:        { tone: 'warn', ar: 'كمّيةٌ أكبرُ من المعقول — لم تُكتب', en: 'implausibly large quantity — not written' },
    STALE_OBSERVATION: { tone: 'info', ar: 'وصل رقمٌ أقدمُ من الموجود — لم يُطبَّق', en: 'an older reading arrived — not applied' },
    // شكلُ الردّ
    NO_DATA:           { tone: 'warn', ar: 'ردُّهم بلا بيانات', en: 'their reply had no data' },
    NO_RESULTS:        { tone: 'warn', ar: 'ردُّهم بلا سجلّات مخزون', en: 'their reply had no stock records' },
    NO_SHAPE:          { tone: 'warn', ar: 'لا نعرف شكلَ ردّ هذا النظام', en: 'we do not know this system’s reply shape' },
    BODY_NOT_OBJECT:   { tone: 'warn', ar: 'الرسالةُ ليست كائنَ JSON', en: 'the message was not a JSON object' },
    BODY_NOT_JSON:     { tone: 'warn', ar: 'ردُّهم ليس JSON', en: 'their reply was not JSON' },
    // الطريقُ والشبكة
    NOT_CONNECTED:     { tone: 'bad',  ar: 'لم يُؤذَن لتاكي بقراءة مخزونك', en: 'TAKI is not allowed to read your stock',
                         doAr: 'اضغط «اربط متجرك».', doEn: 'Press «Connect your store».' },
    TOKEN_REJECTED:    { tone: 'bad',  ar: 'نظامُهم رفض إذنَ تاكي', en: 'their system rejected TAKI’s token',
                         doAr: 'اضغط «أعِد الربط».', doEn: 'Press «Reconnect».' },
    RATE_LIMITED:      { tone: 'info', ar: 'سقفُ نداءاتهم — سنُعيد بعد قليل', en: 'their rate limit — we retry shortly' },
    RESPONSE_LOST:     { tone: 'info', ar: 'لم يصل ردٌّ — سنُعيد', en: 'no reply arrived — we retry' },
    CLAIMED_NOT_SENT:  { tone: 'info', ar: 'انقطع الإرسال — سنُعيد', en: 'the send was interrupted — we retry' },
    FAILED:            { tone: 'warn', ar: 'لم يُكتب، بلا سببٍ محدَّد', en: 'not written, no specific reason' },
    NOT_USABLE:        { tone: 'warn', ar: 'لا رقمَ صالحاً في ردّهم', en: 'no usable number in their reply' },
};

/** وأسبابٌ ديناميكيّة (`HTTP_503` · `NET:…` · `DISPATCH:…`) تُشرح بنمطها. */
export const describeQueueReason = (reason: string | null | undefined, isRTL: boolean):
    { tone: NoteTone; text: string; todo?: string } | null => {
    const k = (reason || '').trim();
    if (!k) return null;
    const d = QUEUE_REASONS[k] || STOCK_NOTES[k];
    if (d) return { tone: d.tone, text: isRTL ? d.ar : d.en, todo: isRTL ? d.doAr : d.doEn };
    if (/^HTTP_\d+$/.test(k)) {
        return { tone: 'warn', text: isRTL ? `ردَّ نظامُهم بالرمز ${k.slice(5)}` : `their system replied ${k.slice(5)}` };
    }
    if (/^NET:/.test(k)) return { tone: 'warn', text: isRTL ? 'تعذّر الوصول إلى نظامهم' : 'could not reach their system' };
    if (/^DISPATCH:/.test(k)) return { tone: 'warn', text: isRTL ? 'تعذّر إرسالُ الطلب — سنُعيد' : 'could not send the request — we retry' };
    return { tone: 'warn', text: isRTL ? `سببٌ غيرُ معروفٍ في هذه النسخة (${k})` : `reason unknown to this version (${k})` };
};

export default STOCK_NOTES;
