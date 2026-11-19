import React from 'react';

/**
 * AdmCustomRange — حقلا «من تاريخ / إلى تاريخ» في مكانٍ واحد (v16.44)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 أمرُ ناصر (١٩ نوفمبر ٢٠٢٦): «اعمل جرداً شاملاً لكل الموقع وتأكّد أنه لا
 *    يوجد تكرار». والجردُ المقيس وجد **١٧٨ كتلةً مكرّرةً** عبر ملفّين فأكثر،
 *    وأكبرُ عناقيدها لوحاتُ التحليلات الأربع:
 *      `TopActivityPanel` · `ReferralPanel` · `FirstMembersPanel` ·
 *      `AuthenticityPanel`
 *    وكلُّها تحمل **نفس** كتلة التاريخين حرفاً بحرف.
 *
 * 🪤 وثمنُ التكرار مقيسٌ لا نظريّ: حين أُصلح حقلُ «عدد الأيام» في v16.36
 *    (كان لا يُمسح ولا يقبل الأرقام العربية) لزم تعديلُ **أربعة ملفّات**
 *    لعيبٍ واحد — ونسيانُ أحدها كان يترك لوحةً معطوبةً بصمت. فالنسخةُ
 *    الواحدة هنا تُصلَح مرّةً وتُصيب الأربع.
 *
 * 🪤 و`max`/`min` متبادلان بين الحقلين عمداً: بلا ذلك يختار الأدمنُ «من»
 *    بعد «إلى» فيعود الاستعلامُ فارغاً بلا سببٍ ظاهر.
 */
/**
 * اليومُ بصيغة `YYYY-MM-DD` **بتوقيت الجهاز** لا UTC.
 * 🪤 و`toISOString()` تُرجع اليومَ إلى الوراء على توقيت +٣ قبل الثالثة فجراً
 *    (درسٌ مسجَّل في قواعد المشروع) — فتُبنى من الحقول المحلّية.
 * 🪤 وكانت هذه الدالّةُ نفسُها منسوخةً باسمين: `isoDay` في ثلاث لوحات
 *    و`isoDate` في الرابعة — وهو تكرارٌ ثانٍ داخل التكرار الأوّل.
 */
const todayISO = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const AdmCustomRange: React.FC<{
    from: string;
    to: string;
    onFrom: (v: string) => void;
    onTo: (v: string) => void;
    fromLabel?: string;
    toLabel?: string;
}> = ({ from, to, onFrom, onTo, fromLabel = 'من تاريخ', toLabel = 'إلى تاريخ' }) => (
    <div className="grid grid-cols-2 gap-3">
        <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">{fromLabel}</label>
            <input
                type="date" value={from} max={to} onChange={(e) => onFrom(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)]"
            />
        </div>
        <div>
            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">{toLabel}</label>
            <input
                type="date" value={to} min={from} max={todayISO()} onChange={(e) => onTo(e.target.value)}
                className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)]"
            />
        </div>
    </div>
);

export default AdmCustomRange;
