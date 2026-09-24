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
import { arCount, HOURS, enCount } from './arPlural';

const arHours = (n: number): string => arCount(n, HOURS);
const arHoursGen = (n: number): string => arCount(n, HOURS, true);
const enHours = (n: number): string => enCount(n, 'hour', 'hours');

/** نصّ المهلة كما يُقرأ في جملة: «ساعتان» / «two hours». */
export const holdLabel = (n: number, isRTL: boolean): string =>
    isRTL ? arHours(n) : enHours(n);

/** نصّ المهلة بعد حرف جرّ: «خلال ساعتين» / «within two hours». */
export const holdLabelGen = (n: number, isRTL: boolean): string =>
    isRTL ? arHoursGen(n) : enHours(n);
