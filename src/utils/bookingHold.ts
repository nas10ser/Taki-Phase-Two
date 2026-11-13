/**
 * bookingHold.ts — صياغة مهلة الحجز بالكلمات (v14.12)
 *
 * الرقم مصدره واحد: `platform_settings.booking_holds` على القاعدة، يقرؤه
 * `AppContext` ويضبطه ناصر من لوحة المدير. وهذا الملف هو **المكان الوحيد**
 * الذي يتحوّل فيه ذلك الرقم إلى نصّ معروض — فلا تُكتب «ساعتان» حرفياً في صفحة
 * أو شرط أو سؤال شائع، ثم يُغيَّر الرقم فتكذب الصفحة على المشتري.
 *
 * 🪤 الدرس الذي بُني عليه: v14.10 نقلت المهلة إلى صفّ إعدادات واحد، لكن ثلاث
 *    صفحات قانونية وبوتين بقيت تقول «ساعتان» و«ست ساعات» نصّاً جامداً. أي ضبط
 *    من اللوحة كان سيجعل الوعد المكتوب مخالفاً لما تفرضه القاعدة فعلاً.
 */

// v14.93 — محرّك الجمع العربي خرج إلى `arPlural.ts` ليستعمله هذا الملفّ
// والرسائلُ معاً. 🪤 وصُحِّح عيبٌ صامت كان هنا: `n <= 10` تشمل **الكسور**
// وما دون الواحد، فـ«٠٫٥ ساعات» و«٢٫٥ ساعات» كانتا تُكتبان جمعَ قلّة —
// ومهلة الحجز تقبل كسوراً فوق أرضيّتها (١٫٥). `arCount` تعامل الكسر معاملة المفرد.
import { arCount, HOURS, MINUTES, DAYS, enCount } from './arPlural';

const arHours = (n: number): string => arCount(n, HOURS);
const arHoursGen = (n: number): string => arCount(n, HOURS, true);
const enHours = (n: number): string => enCount(n, 'hour', 'hours');

/** نصّ المهلة كما يُقرأ في جملة: «ساعتان» / «two hours». */
export const holdLabel = (n: number, isRTL: boolean): string =>
    isRTL ? arHours(n) : enHours(n);

/** نصّ المهلة بعد حرف جرّ: «خلال ساعتين» / «within two hours». */
export const holdLabelGen = (n: number, isRTL: boolean): string =>
    isRTL ? arHoursGen(n) : enHours(n);

/**
 * مدّةٌ بالساعات تُصاغ **أياماً حين تستحقّ ذلك** (v16.23).
 *
 * 🔴 سببُها مقيس (سؤالُ ناصر ١٣ نوفمبر): مهلةُ مراجعة التوثيق إعدادٌ بالساعات
 *    (١–٧٢٠)، وأراد أن يجعلها عشرة أيام. فلو كتب ٢٤٠ لقال النصُّ للتاجر
 *    «نراجع الطلب خلال ٢٤٠ ساعة» — رقمٌ صحيحٌ وصياغةٌ لا يقولها بشر.
 * ⇒ مضاعفُ اليوم الكامل من يومين فأكثر يُصاغ أياماً، وما دونه يبقى ساعات.
 * 🪤 ولا يُمسّ `holdLabelGen`: مهلُ الحجز ساعاتٌ قليلةٌ (٢ · ٦) وتغييرُ
 *    صياغتها يمسّ نصوصاً قانونيّةً لا علاقة لها بهذا السؤال.
 * 🪤 و«٢٤ ساعة» تبقى ساعاتٍ عمداً: هي الوعدُ القائم اليوم، وتحويلُها إلى
 *    «يوم واحد» تغييرُ نصٍّ ظاهرٍ لم يطلبه أحد.
 */
export const hoursOrDaysGen = (n: number, isRTL: boolean): string => {
    const days = n / 24;
    if (n >= 48 && Number.isInteger(days)) {
        return isRTL ? arCount(days, DAYS, true) : enCount(days, 'day', 'days');
    }
    return holdLabelGen(n, isRTL);
};

// ── v15.42 — مهلةُ الختم بلا كود، بالدقائق ─────────────────────────────────
// 🪤 ولماذا دالّةٌ هنا لا نصٌّ في الشاشة: العربيّةُ تحتاج خمسَ صيغٍ للمعدود،
//    و«١٠ دقيقة» و«1 minutes» كلاهما خطأ — وهو نفسُ العيب الذي صُحّح في
//    الساعات مرّتين (v14.12 · v14.92). ومحرّكُه `arPlural` وحده.
const arMinutes = (n: number): string => arCount(n, MINUTES);
const arMinutesGen = (n: number): string => arCount(n, MINUTES, true);
const enMinutes = (n: number): string => enCount(n, 'minute', 'minutes');

/** «١٠ دقائق» / «10 minutes». */
export const minutesLabel = (n: number, isRTL: boolean): string =>
    isRTL ? arMinutes(n) : enMinutes(n);

/** «بعد ١٠ دقائق» / «after 10 minutes» — بعد حرف الجرّ. */
export const minutesLabelGen = (n: number, isRTL: boolean): string =>
    isRTL ? arMinutesGen(n) : enMinutes(n);

/**
 * حالةُ «الختم بلا كود» لطلبٍ (v15.44).
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر: الساعةُ تبدأ من **تأكيد التاجر** لا من لحظة الحجز.
 *
 * 🔴 ومعها فتحةٌ احتياطيّة، لأن «لا تأكيدَ ⇒ لا زرَّ أبداً» تُسقط المشتري في
 *    الهاوية — وقِيس على جدّة: **١٤٪ من الطلبات المكتملة لم تُؤكَّد قطّ**،
 *    وواحدٌ من الختمين الذاتيّين اللذين وقعا أصلاً كان على طلبٍ غير مؤكَّد.
 *    فالزرُّ يُفتح عند الأسبقِ المعقول: بعد المهلة من التأكيد، أو — إن لم
 *    يؤكّد — في آخر المهلة من عمر الحجز، ولا قبل المهلة من لحظة الحجز أبداً.
 * 🪤 والسببُ يُقال كما هو: المشتري ينتظر **شخصاً** لا **وقتاً**، ورسالةٌ
 *    واحدة لهما تكذب. ولذلك `acknowledged` في الحالة.
 * 🪤 ويطابق `taki_self_close_opens_at` على القاعدة حرفاً بحرف، وحارسُ البناء
 *    يقارن التنفيذين.
 */
export interface SelfCloseWaiting {
    kind: 'waiting';
    seconds: number;
    /** هل أكّد التاجرُ الاستلام؟ منه تُختار الجملة. */
    acknowledged: boolean;
    label: (isRTL: boolean) => string;
}
export type SelfCloseState = SelfCloseWaiting | null;

export interface SelfCloseInput {
    acknowledgedAt?: number | null;
    bookedAt?: number | null;
    expiryTime?: number | null;
    status?: string;
}

/** هل أكّد التاجر؟ (الصفُّ القديم المؤكَّد قبل v15.44 يُعدّ مؤكَّداً.) */
export const isAcknowledged = (b: SelfCloseInput): boolean =>
    b.acknowledgedAt != null || b.status === 'acknowledged';

/**
 * لحظةُ فتح الزرّ بالمللي — توأمُ `taki_self_close_opens_at`، ولا تكون عدماً.
 * 🔴 والسقفُ (`expiry − دقيقة`) ليس تجميلاً: بدونه مهلةُ ١٥ دقيقة مع تأكيدٍ
 *    بعد ٦ تُنتج فتحةً عند +١٦ ومهلةً تنتهي عند +١٥ ⇒ **نافذةٌ خالية**.
 *    وقِيس أن ٩٫١٪ من التأكيدات تقع بعد خمس دقائق.
 */
export const selfCloseOpensAt = (b: SelfCloseInput, minutes: number): number => {
    const ms = minutes * 60000;
    const booked = Number(b.bookedAt ?? 0);
    const expiry = Number(b.expiryTime ?? 0);
    // 🔴 v15.46/47 — صفرٌ يعني «بلا مهلة»، واللحظةُ لا ترجع إلى الوراء:
    //    تأكيدٌ متأخّر كان يسحب زرّاً صار في يد المشتري.
    if (!(minutes > 0)) return booked;
    const ackAt = (b.acknowledgedAt != null && Number.isFinite(Number(b.acknowledgedAt)))
        ? Math.max(booked + ms, Number(b.acknowledgedAt) + ms)
        : b.status === 'acknowledged' ? booked + ms : Number.POSITIVE_INFINITY;
    const fallback = Math.max(booked + ms, (expiry > 0 ? expiry : Number.POSITIVE_INFINITY) - ms);
    const raw = Math.min(ackAt, fallback);
    return expiry > 0 ? Math.min(raw, expiry - 60000) : raw;
};

export const selfCloseState = (
    b: SelfCloseInput, minutes: number, nowMs: number,
): SelfCloseState => {
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    const left = Math.round((selfCloseOpensAt(b, minutes) - nowMs) / 1000);
    if (!(left > 0)) return null;
    const mins = Math.max(1, Math.ceil(left / 60));
    return {
        kind: 'waiting',
        seconds: left,
        acknowledged: isAcknowledged(b),
        label: (isRTL: boolean) => minutesLabelGen(mins, isRTL),
    };
};
