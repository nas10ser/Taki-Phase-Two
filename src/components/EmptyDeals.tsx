/**
 * EmptyDeals — «لماذا الشبكةُ فارغة؟» في موضعٍ واحد (v15.81)
 * ═══════════════════════════════════════════════════════════════════════════
 * ثلاثُ شاشاتٍ تعرض شبكةَ عروض — الرئيسية و«كل العروض» و«حولي» — وكلُّها
 * تحتاج نفسَ الجواب حين تعود الشبكةُ فارغة. وقد كُتب الجوابُ **ثلاث مرّات**،
 * فانحرف: أصلحت v14.63 الرئيسيةَ و«حولي» وبقيت `DealsList` تتّهم «اختياراتك
 * الحالية» أمام زائرٍ لم يختر شيئاً — وهي صفحةٌ في خريطة الموقع بأولويّة ٠٫٩،
 * أي أنها صفحةُ هبوطٍ من جوجل.
 *
 * ⇒ فالعلاجُ ليس نسخةً رابعة بل **استخراج**: الحالاتُ الثلاث تُحسم هنا، وأيُّ
 *   إصلاحٍ قادم يقع في ملفٍّ واحد. (والسقّافة `check-file-size.js` تريد هذا
 *   بالضبط: استخراجٌ لا نموّ — والشاشاتُ الثلاث تنكمش معه.)
 *
 * الحالاتُ ثلاثٌ لا واحدة:
 *   • بحثٌ لم يُطابق        ⇒ «لم نجد عروضاً تطابق بحثك».
 *   • مرشِّحٌ اختاره المستخدم ⇒ «لا توجد عروض ضمن اختياراتك الحالية».
 *   • ولا هذا ولا ذاك       ⇒ `baseline`، وهي صياغةُ كلِّ شاشةٍ لحالتها
 *                             (الرئيسيّةُ «عد قريباً» · «حولي» «في هذا النطاق»).
 *
 * 🔴 وزرُّ «إعادة ضبط الفلاتر» مشروطٌ بـ`canReset` لا بالحالة الفارغة:
 *    زرٌّ يُضغط فلا يتغيّر شيء أسوأُ من غيابه — يقول للزائر إن المشكلةَ في
 *    اختياراتِه وهو لم يختر. و`canReset` تُحسب في كلّ شاشةٍ بما **تملك
 *    إعادةُ الضبط فيها تغييرَه فعلاً** (ومنه «المفتوحة الآن» ونطاقُ «حولي» —
 *    فهما غيرُ مرئيَّين في الرسالة لأنهما افتراضان لا اختيارات، لكنّ إعادةَ
 *    الضبط تغيّرهما حقّاً).
 */
import React from 'react';

/**
 * الحالةُ الثالثةُ الشائعة: لا بحثَ ولا مرشِّح ولا عروضَ — «عد قريباً».
 * تُصدَّر لأن الرئيسيّةَ و«كل العروض» تقولانها بنفس اللفظ، ونسختان من جملةٍ
 * واحدة هي **بذرةُ** العيب الذي أنشأ هذا الملفّ أصلاً. («حولي» لها لفظُها
 * الخاصّ لأن سببَها نطاقٌ لا كتالوج.)
 */
export const BASELINE_NO_DEALS = {
    ar: 'لا توجد عروض متاحة الآن — عد قريباً',
    en: 'No deals available right now — check back soon',
};

export interface EmptyDealsProps {
    isRTL: boolean;
    /** كتب المستخدم نصَّ بحثٍ ⇒ الرسالةُ تتّهم البحثَ لا المرشِّحات. */
    searching?: boolean;
    /** مرشِّحٌ **اختاره المستخدم** حيٌّ (قسم · فئة · موقع · «حقيقية» …). */
    filtered?: boolean;
    /** «المفتوحة الآن» مفعّل ⇒ سطرُ تلميحٍ بالعلاج الصحيح. */
    openNow?: boolean;
    /** الحالةُ الثالثة: لا بحثَ ولا مرشِّح — لكلّ شاشةٍ صياغتُها. */
    baseline: { ar: string; en: string };
    /** الأيقونةُ حين لا بحث (البحثُ له 🔍 دائماً). */
    icon: string;
    /** هل تُغيّر إعادةُ الضبط شيئاً فعلاً؟ الافتراض: بحثٌ أو مرشِّح. */
    canReset?: boolean;
    onReset: () => void;
    /** حاويةُ كلّ شاشة كما هي (`gridColumn` داخل الشبكة، والحشو). */
    style?: React.CSSProperties;
    className?: string;
}

const EmptyDeals: React.FC<EmptyDealsProps> = ({
    isRTL, searching = false, filtered = false, openNow = false,
    baseline, icon, canReset, onReset, style, className,
}) => {
    const t = (ar: string, en: string) => (isRTL ? ar : en);
    const showReset = canReset === undefined ? (searching || filtered) : canReset;

    return (
        <div className={className} style={{ textAlign: 'center', ...style }}>
            <div style={{ fontSize: '3.5rem', marginBottom: 14 }} aria-hidden="true">
                {searching ? '🔍' : icon}
            </div>
            <div style={{ fontWeight: 800, color: 'var(--text-muted)' }}>
                {searching
                    ? t('لم نجد عروضاً تطابق بحثك', 'No deals match your search')
                    : filtered
                        ? t('لا توجد عروض ضمن اختياراتك الحالية', 'No deals match your current filters')
                        : t(baseline.ar, baseline.en)}
            </div>
            {openNow && (
                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.7 }}>
                    {t(
                        '🟢 المعروض الآن هو «المحلات المفتوحة» فقط — جرّب «جميع المحلات».',
                        '🟢 Showing “Open now” only — try “All shops”.',
                    )}
                </div>
            )}
            {showReset && (
                <button
                    type="button"
                    onClick={onReset}
                    style={{
                        marginTop: 16, padding: '12px 24px', background: 'var(--primary)',
                        color: 'white', border: 'none', borderRadius: 12, fontWeight: 800,
                        cursor: 'pointer',
                    }}
                >{t('🔄 إعادة ضبط الفلاتر', '🔄 Reset filters')}</button>
            )}
        </div>
    );
};

export default EmptyDeals;
