import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import OperatorIdentityBlock from './OperatorIdentityBlock';

/**
 * SiteFooter — تذييلُ الموقع (v15.74)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 لم يكن للموقع تذييلٌ إطلاقاً، فلم يكن للوثائق القانونيّة طريقٌ ثابتٌ من
 *    أيّ صفحة — ومراجعُ متجرِ التطبيقات وجهةٌ رقابيّةٌ كلاهما يبحث عن ذلك
 *    أوّلاً. (ويُلزم قوقل بلاي برابط سياسةِ خصوصيّةٍ ظاهر.)
 *
 * 🪤 و**`info@` وحده** هنا — بأمر ناصر: «ضع فقط info في الفوتر، والشكوى
 *    خلّها لما يرفع شكوى». والسببُ سليمٌ تماماً: عنوانُ شكاوى في تذييل كلّ
 *    صفحةٍ يُحوِّل الشكاوى من قناةٍ لها سجلٌّ ومهلةُ ردٍّ وإشعارٌ، إلى بريدٍ
 *    بلا تتبُّعٍ ولا مهلة. فعنوانُ الشكاوى يُعرض **في لحظة رفع الشكوى** وحدها.
 *
 * 🪤 ولا يُعرض في مساحات العمل (`/admin` و`/seller`): تلك شاشاتُ عملٍ لا
 *    صفحاتٌ عامّة، وتذييلٌ قانونيٌّ فيها ضجيج. (نفسُ ما يفعله `SeasonFX`.)
 * 🪤 وفسحةٌ سفليّةٌ تُجنّب الشريطَ السفليّ: `.bottom-nav` ثابتٌ عند الأسفل
 *    (`position: fixed`)، فتذييلٌ بلا فسحةٍ يختفي نصفُه تحته.
 * 🪤 ولا يُعرض بريدٌ لم يُؤكَّد صندوقُه: `contactEmails.info` فارغٌ افتراضاً
 *    فتُخفى الخانة. عنوانٌ بلا صندوقٍ أسوأُ من غيابه.
 */
const SiteFooter: React.FC = () => {
    const { language, platformSettings } = useApp();
    const location = useLocation();
    const isRTL = language === 'ar';
    const t = (ar: string, en: string) => (isRTL ? ar : en);

    // 🪤 والحدُّ صريحٌ لا `startsWith` عارياً: `startsWith('/seller')` يُطابق
    //    **`/sellers`** أيضاً (قِيس بالتجربة على المنطق نفسِه)، و`sellers_public`
    //    موجودٌ كعرضٍ عامٍّ فدليلُ تجّارٍ محتمل — فكان التذييلُ سيختفي منه
    //    صامتاً يومَ يُضاف. ولا مسارَ كذلك اليوم، فالخللُ كامنٌ لا حيّ،
    //    وتصحيحُه حرفان.
    const WORKSPACES = ['/admin', '/seller'];
    const p = location.pathname;
    if (WORKSPACES.some((w) => p === w || p.startsWith(w + '/'))) return null;

    const info = platformSettings.contactEmails.info;
    const year = new Date().getFullYear();
    const links: Array<[string, string, string]> = [
        ['/terms', 'الشروط والأحكام', 'Terms of Use'],
        ['/privacy', 'سياسة الخصوصية', 'Privacy Policy'],
        ['/refund', 'سياسة الاسترداد', 'Refund Policy'],
        ['/faq', 'الأسئلة الشائعة', 'FAQ'],
        ['/contact', 'اتصل بنا', 'Contact us'],
        ['/about', 'عن تاكي', 'About TAKI'],
        // 🔴 أمرُ ناصر (١١ نوفمبر ٢٠٢٦): **لا رابطَ حذفٍ في تذييل كلّ صفحة** —
        //    زرٌّ مدمِّرٌ على مرمى إصبعٍ من كلّ زائر. والمسارُ `/delete-account`
        //    **باقٍ كما هو** (شرطُ قوقل بلاي عنوانٌ عامّ يُعلَن في «أمان
        //    البيانات»، لا رابطٌ في التذييل)، ويصل إليه المستخدم من ثلاثة
        //    مواضع: سؤالُ «هل يمكنني حذف حسابي؟» في الأسئلة الشائعة، و«حسابي»
        //    أسفلَ الصفحة، والقائمةُ الجانبية (☰) — وهي الثلاثةُ التي تَعِد
        //    بها الأسئلةُ الشائعة نصّاً، فلم يَنكسر وعد.
    ];

    return (
        <footer dir={isRTL ? 'rtl' : 'ltr'}
            style={{
                marginTop: 28,
                padding: '20px 16px calc(env(safe-area-inset-bottom, 0px) + 104px)',
                background: 'var(--card-bg)',
                borderTop: '1px solid var(--border-color)',
                fontFamily: 'inherit',
            }}>
            <nav aria-label={t('روابط قانونية', 'Legal links')}
                style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 18px', justifyContent: 'center' }}>
                {links.map(([to, ar, en]) => (
                    <Link key={to} to={to}
                        style={{ color: 'var(--text-secondary)', fontSize: '0.8rem',
                                 fontWeight: 700, textDecoration: 'none' }}>
                        {t(ar, en)}
                    </Link>
                ))}
            </nav>

            {info && (
                <p style={{ textAlign: 'center', marginTop: 14, fontSize: '0.8rem',
                            color: 'var(--text-secondary)' }}>
                    {t('للاستفسارات: ', 'Enquiries: ')}
                    <a href={`mailto:${info}`}
                        style={{ color: 'var(--primary)', fontWeight: 800 }}>{info}</a>
                </p>
            )}

            {/* 🔴 v15.81 — هويّةُ المُشغِّل. كان التذييلُ يحمل شعاراً تجارياً
                وحده، والمنصّةُ تُلزم تجّارها بسجلٍّ تجاريٍّ موثَّقٍ ولا تُفصح
                عن سجلّها — فالزائرُ بلا حسابٍ **لا خصمَ معلومَ الهويّة له**.
                🪤 ويُصيَّر `null` ما لم تكتمل القيمُ الثلاث، فلا تظهر لافتةٌ
                   فارغة: التذييلُ اليومَ يطابق سابقَه بايتاً ببايت. */}
            <OperatorIdentityBlock variant="line" />

            <p style={{ textAlign: 'center', marginTop: 12, fontSize: '0.72rem',
                        color: 'var(--text-secondary)', opacity: 0.8 }}>
                {t(`تاكي — منصّة حجز التخفيضات في السعودية · ${year}`,
                   `TAKI — deal booking platform in Saudi Arabia · ${year}`)}
            </p>
        </footer>
    );
};

export default SiteFooter;
