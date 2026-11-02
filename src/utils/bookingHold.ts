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
// ومهلة الحجز تقبل ربع ساعة فعلاً. `arCount` تعامل الكسر معاملة المفرد.
import { arCount, HOURS, MINUTES, enCount } from './arPlural';

const arHours = (n: number): string => arCount(n, HOURS);
const arHoursGen = (n: number): string => arCount(n, HOURS, true);
const enHours = (n: number): string => enCount(n, 'hour', 'hours');

/** نصّ المهلة كما يُقرأ في جملة: «ساعتان» / «two hours». */
export const holdLabel = (n: number, isRTL: boolean): string =>
    isRTL ? arHours(n) : enHours(n);

/** نصّ المهلة بعد حرف جرّ: «خلال ساعتين» / «within two hours». */
export const holdLabelGen = (n: number, isRTL: boolean): string =>
    isRTL ? arHoursGen(n) : enHours(n);

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
 * المتبقّي من مهلة الختم الذاتيّ لطلبٍ، نصّاً جاهزاً — أو `null` إن انتهت.
 * 🪤 ويُجبَر على دقيقةٍ واحدة على الأقلّ ما بقي ثانيةٌ: «بعد ٠ دقائق» ثم زرٌّ
 *    لا يظهر = شاشةٌ تكذب. والثواني لا تُعرض — عدّادٌ بالثواني يطلب تحديثاً
 *    كلَّ ثانية بلا فائدة.
 */
export const selfCloseLeft = (
    bookedAt: number | null | undefined, minutes: number, nowMs: number,
): { seconds: number; label: (isRTL: boolean) => string } | null => {
    if (!Number.isFinite(minutes) || minutes <= 0) return null;
    const ready = Number(bookedAt ?? 0) + minutes * 60000;
    const left = Math.round((ready - nowMs) / 1000);
    if (!(left > 0)) return null;
    const mins = Math.max(1, Math.ceil(left / 60));
    return { seconds: left, label: (isRTL: boolean) => minutesLabelGen(mins, isRTL) };
};
