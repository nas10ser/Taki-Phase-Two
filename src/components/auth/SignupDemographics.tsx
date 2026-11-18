import React from 'react';

/**
 * SignupDemographics — سؤالا التسجيل: الجنس والفئة العمرية (v16.39)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 طلبُ ناصر (١٧ نوفمبر ٢٠٢٦): «عند التسجيل … أظهر سؤالين: ذكر أو أنثى،
 *    والعمر … وسجّلهم في الداتا بيس إذا كان مسموحاً حسب القانون السعودي.
 *    وأريد تحليلاً شاملاً … أستطيع فلترة الأعمار والذكور أو الإناث ومدنهم».
 *    ثمّ (١٨ نوفمبر): «اجعلها فئة عمرية كل خمس سنوات أو حسب ما تراه في
 *    المواقع العالمية».
 *
 * 🔴 **الفئاتُ ستٌّ لا إحدى عشرة** — وهي فئاتُ Google Analytics وMeta:
 *        18-24 · 25-34 · 35-44 · 45-54 · 55-64 · 65+
 *    ولماذا خالفتُ «كلّ خمس سنوات» حرفياً: نظامُ حماية البيانات الشخصية
 *    السعوديُّ يوجب **تقليلَ البيانات** (لا يُجمع إلّا ما يلزم للغرض)،
 *    والغرضُ تحليلُ سلوكٍ ويتحقّق بستٍّ كما يتحقّق بإحدى عشرة. وفئةٌ ضيّقةٌ
 *    مع المدينة والجنس قد تدلّ على **شخصٍ بعينه** في قاعدةٍ صغيرة.
 *    والحدُّ الأدنى ١٨ لأن المنصّة تشترطه أصلاً.
 *
 * 🔴 **واختياريّان صراحةً** («يمكنك التخطّي»): الموافقةُ شرطُ الجمع، والموافقةُ
 *    المُكرَهة ليست موافقة. ومن يتخطّى يُسجَّل حسابُه كما كان تماماً.
 *
 * 🪤 ومكانُه ملفٌّ مستقلّ: `Register.tsx` **مُعلَنٌ في سقّافة الأحجام** ولا
 *    يُسمح له أن ينمو — فالتوسعةُ تُبنى خارجَه (قاعدةُ المشروع: قلّص لا ترفع).
 */

/** الفئاتُ كما تُخزَّن في القاعدة — ويطابقها قيدُ `users_age_band_check`. */
export const AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'] as const;
export type AgeBand = typeof AGE_BANDS[number];
export type Gender = 'male' | 'female';

const chip = (active: boolean): React.CSSProperties => ({
    padding: '9px 14px', borderRadius: 999, cursor: 'pointer',
    fontSize: '0.82rem', fontWeight: 800,
    border: `1.5px solid ${active ? 'var(--primary)' : 'var(--border-color)'}`,
    background: active ? 'var(--primary)' : 'var(--card-bg)',
    color: active ? '#fff' : 'var(--text-primary)',
});

export const SignupDemographics: React.FC<{
    isRTL: boolean;
    gender: Gender | '';
    ageBand: AgeBand | '';
    onGender: (g: Gender | '') => void;
    onAgeBand: (b: AgeBand | '') => void;
}> = ({ isRTL, gender, ageBand, onGender, onAgeBand }) => {
    const t = (ar: string, en: string) => (isRTL ? ar : en);
    return (
        <div style={{
            background: 'var(--card-bg)', border: '1px solid var(--border-color)',
            borderRadius: 16, padding: '14px 14px 16px', marginBottom: 15,
            display: 'flex', flexDirection: 'column', gap: 12,
        }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                {t('سؤالان اختياريان يساعداننا على عرض عروضٍ أقرب لك — ويمكنك تخطّيهما.',
                   'Two optional questions that help us show you closer deals — you can skip them.')}
            </div>

            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend style={{ fontSize: '0.84rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 8 }}>
                    {t('الجنس', 'Gender')}
                </legend>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {([['male', t('ذكر', 'Male')], ['female', t('أنثى', 'Female')]] as const).map(([v, label]) => (
                        <button
                            key={v} type="button" aria-pressed={gender === v}
                            onClick={() => onGender(gender === v ? '' : (v as Gender))}
                            style={chip(gender === v)}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </fieldset>

            <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend style={{ fontSize: '0.84rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 8 }}>
                    {t('الفئة العمرية', 'Age range')}
                </legend>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {AGE_BANDS.map((b) => (
                        <button
                            key={b} type="button" aria-pressed={ageBand === b}
                            onClick={() => onAgeBand(ageBand === b ? '' : b)}
                            style={{ ...chip(ageBand === b), direction: 'ltr' }}
                        >
                            {b}
                        </button>
                    ))}
                </div>
            </fieldset>
        </div>
    );
};

export default SignupDemographics;
