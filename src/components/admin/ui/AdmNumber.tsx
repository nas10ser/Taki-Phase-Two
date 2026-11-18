import React, { useEffect, useRef, useState } from 'react';
import { normalizeArabicNumerals } from '../../../utils/helpers';

/**
 * AdmNumber — حقلٌ رقميٌّ في لوحة الإدارة **يقبل المسح ويقبل العربية** (v16.36)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبان اللذان يسدّهما (بلاغُ ناصر بلقطةٍ مُعلَّمة، ١٧ نوفمبر ٢٠٢٦):
 *    «عند محاوله مسح عدد الايام في بعض التحليلات يجبرني ان يكون رقم واحد بحيث
 *     يعيني عند المسح ولا يمسح رقم واحد، وايضا اريد الادخال يدعم اللغة العربيه
 *     كسائر الموقع».
 *
 *    ① **لا يُمسح.** كان النمطُ المنسوخ في **تسعة عشر موضعاً** في اللوحة:
 *           onChange={e => setDays(Math.max(1, Math.min(3650,
 *                               Number(e.target.value) || 1)))}
 *       فحين يمسح المستخدم الخانةَ تصير `e.target.value` نصّاً فارغاً، و
 *       `Number('')` صفرٌ، و`0 || 1` واحد ⇒ **يرتدّ الحقلُ إلى ١ فوراً**.
 *       فلا يستطيع أن يُفرغه ليكتب رقماً آخر: كلُّ مسحةٍ تُعيد «١».
 *       والقصُّ هنا **في غير موضعه** أصلاً: كلُّ المنادين يقصّون عند
 *       الاستهلاك (`Math.max(1, days)`)، فالقصُّ أثناء الكتابة زائدٌ ومؤذٍ.
 *
 *    ② **لا يقبل العربية.** `type="number"` يرفض «٣٠» في سفاري iOS فتعود
 *       القيمةُ فارغةً — وهو نفسُ سبب وجود `NumericField` في شاشات التاجر
 *       منذ v12.86. واللوحةُ لم تستعمله **ولا مرّة**: صفرُ استيرادٍ له في
 *       `src/components/admin/` كلِّه، وثلاثةٌ وثلاثون حقلَ `type="number"`.
 *
 * ⇒ القاعدة هنا: **الكتابةُ حرّة، والقصُّ عند الخروج من الحقل.**
 *    أثناء الكتابة يبقى ما يكتبه المستخدم كما هو (أرقامٌ فقط، بعد تعريب)،
 *    وعند `blur` يُقصّ إلى [min, max] أو يعود إلى `fallback` إن تُرك فارغاً.
 *
 * 🪤 ولا يُقصّ إلى `max` أثناء الكتابة: من يكتب «٣٠» وحدُّه ٢٠ كان سيرى «٢»
 *    تصير «٢» ثمّ «٢٠» ثمّ تُقصّ — فلا يصل إلى ٣٠ أبداً ولا يفهم لماذا.
 * 🪤 و`value` من الأب تُزامَن فقط حين يختلف **معناها الرقميّ** عن المكتوب،
 *    وإلّا مُسح ما يكتبه المستخدم تحت يده عند كلّ إعادة تصيير.
 */
/**
 * تنقيةُ ما يُكتب **أثناء** الكتابة: تعريبُ الأرقام ثمّ الأرقامُ وحدها.
 * 🔴 والفراغُ يعود فراغاً — وهذا هو العيبُ الذي شكا منه ناصر: النمطُ القديم
 *    كان يحوّل الفراغ إلى «١» فيستحيل مسحُ الخانة.
 */
export const admNumSanitize = (raw: string): string =>
    normalizeArabicNumerals(raw ?? '').replace(/[^\d]/g, '');

/** القصُّ **عند الخروج** من الحقل: الفراغُ يعود إلى `fallback` (أو `min`). */
export const admNumCommit = (
    buf: string, o: { min?: number; max?: number; fallback?: number } = {},
): number => {
    const min = o.min ?? 0;
    const floor = o.fallback ?? min;
    const raw = (buf ?? '').trim();
    if (raw === '') return floor;
    let n = Number(raw);
    if (!Number.isFinite(n)) return floor;
    if (n < min) n = min;
    if (o.max !== undefined && n > o.max) n = o.max;
    return n;
};

export const AdmNumber: React.FC<{
    value: number;
    onChange: (n: number) => void;
    /** أصغرُ قيمةٍ مقبولة عند الخروج من الحقل. */
    min?: number;
    /** أكبرُ قيمةٍ مقبولة عند الخروج من الحقل. */
    max?: number;
    /** ما يعود إليه الحقلُ إن تُرك فارغاً. الافتراض: `min`. */
    fallback?: number;
    /**
     * لا يُبلَّغ الأبُ إلّا عند الخروج من الحقل أو Enter.
     * 🪤 لازمةٌ حين يُطلق التغييرُ **نداءَ شبكة**: بلا ذلك يكتب المستخدم «٣٠»
     *    فتُجلب التحليلاتُ مرّتين (عند «٣» ثمّ عند «٣٠») — ونصفُها لرقمٍ
     *    لم يقصده أحد.
     */
    commitOnly?: boolean;
    disabled?: boolean;
    className?: string;
    style?: React.CSSProperties;
    'aria-label'?: string;
    title?: string;
}> = ({ value, onChange, min = 0, max, fallback, commitOnly, disabled, className, style, title, ...aria }) => {
    const [buf, setBuf] = useState<string>(String(value ?? ''));
    // المرجعُ يمنع المزامنةَ من دهس ما يُكتب: تُقارَن القيمةُ الرقميّة لا النصّ.
    const lastEmitted = useRef<number>(value);

    useEffect(() => {
        if (value !== lastEmitted.current) {
            lastEmitted.current = value;
            setBuf(String(value ?? ''));
        }
    }, [value]);

    const commit = () => {
        const n = admNumCommit(buf, { min, max, fallback });
        lastEmitted.current = n;
        setBuf(String(n));
        onChange(n);
    };

    return (
        <input
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={buf}
            disabled={disabled}
            className={className}
            style={style}
            title={title}
            {...aria}
            onChange={(e) => {
                // تعريبٌ ثمّ أرقامٌ فقط — والفراغُ **مسموح** أثناء الكتابة.
                const cleaned = admNumSanitize(e.target.value);
                setBuf(cleaned);
                if (commitOnly) return;               // الإبلاغُ عند الخروج وحده
                if (cleaned === '') return;          // لا نُبلّغ الأبَ بفراغ
                const n = Number(cleaned);
                if (!Number.isFinite(n)) return;
                lastEmitted.current = n;
                onChange(n);                          // بلا قصّ — القصُّ عند الخروج
            }}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit(); }}
        />
    );
};

export default AdmNumber;
