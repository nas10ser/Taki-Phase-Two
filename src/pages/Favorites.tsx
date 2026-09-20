import React, { useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { createT, isDealExpiredByTime } from '../utils/helpers';
import { Deal } from '../data/mock';
import DealCard from '../components/DealCard';
import BottomNav from '../components/BottomNav';

/**
 * Favorites — «المفضلة» (v14.63)
 * ═══════════════════════════════════════════════════════════════════════════
 * قبلها: عنصر «❤️ المفضلة» في القائمة الجانبية كان يفتح **صفحة الحساب**
 * (إعدادات التنبيهات)، والخاصّية كلها ميتة: جدولٌ في القاعدة، ودالةٌ في
 * السياق، ومفتاحٌ في الإعدادات — بلا زرٍّ واحد في المنصّة يضيف عرضاً.
 *
 * 🪤 و`deals` في السياق **نافذةٌ مرقّمة** لا كل العروض: ترشيحُ المصفوفة وحده
 * يُخفي أي مفضلةٍ خارج النافذة. فنجلب المعرّفات صراحةً ونُدخلها في السياق —
 * نفس نمط صفحة المتجر والروابط المباشرة.
 */
const Favorites: React.FC = () => {
    const history = useHistory();
    const { favorites, deals, language, ingestDeals, user, isAuthReady } = useApp();
    const isRTL = language === 'ar';
    const t = createT(isRTL);

    // ⚠️ كل الخطّافات قبل أي `return` مبكّر — فخٌّ موثَّق أسقط الشجرة من قبل.
    const [hydrating, setHydrating] = useState(favorites.length > 0);
    /**
     * 🪤 مفضلة المستخدم المسجَّل تصل **بعد** أول رسم (جولة إلى جدة). بدون هذه
     * المهلة القصيرة تومض الشاشة: «لم تحفظ أي عرض» ⇐ هيكل ⇐ الشبكة. فنمنح
     * الجلب فرصةً قبل أن ننفي وجود شيء. (كشفته المراجعة الخصمية.)
     */
    const [favSettled, setFavSettled] = useState(false);
    useEffect(() => {
        if (!isAuthReady) return;
        if (!user || favorites.length > 0) { setFavSettled(true); return; }
        const timer = setTimeout(() => setFavSettled(true), 900);   // لا تُسمَّ `t` — تُظلّل دالة الترجمة
        return () => clearTimeout(timer);
    }, [isAuthReady, user, favorites.length]);

    useEffect(() => {
        if (!favorites.length) { setHydrating(false); return; }
        let alive = true;
        setHydrating(true);
        import('../repositories/dealRepository')
            .then(({ dealRepository }) => dealRepository.getByIds(favorites))
            .then(list => { if (alive && list.length) ingestDeals(list); })
            .catch(() => { /* غير قاتل: ما في النافذة يُعرض على كل حال */ })
            .finally(() => { if (alive) setHydrating(false); });
        return () => { alive = false; };
    }, [favorites, ingestDeals]);

    const { live, gone } = useMemo(() => {
        const byId = new Map(deals.map(d => [d.id, d]));
        const live: Deal[] = [];
        const gone: Deal[] = [];
        for (const id of favorites) {
            const d = byId.get(id);
            if (!d) continue;                       // حُذف العرض أو لم يصل بعد
            (isDealExpiredByTime(d) || d.status === 'expired' ? gone : live).push(d);
        }
        return { live, gone };
    }, [favorites, deals]);

    const empty = favSettled && !hydrating && live.length === 0 && gone.length === 0;

    return (
        <div className="page-content" style={{ background: 'var(--body-bg)', minHeight: '100vh', direction: isRTL ? 'rtl' : 'ltr' }}>
            <div className="premium-bar" style={{ paddingBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <button
                        onClick={() => history.push('/')}
                        aria-label={t('الرئيسية', 'Home')}
                        style={{
                            background: 'rgba(80, 80, 95, 0.2)', border: 'none', color: 'white',
                            width: 40, height: 40, borderRadius: 12, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1rem',
                        }}
                    >{isRTL ? '➡️' : '⬅️'}</button>
                    <div style={{ flex: 1, fontWeight: 900, fontSize: '1.05rem', color: 'white' }}>
                        🔖 {t('المفضلة', 'Favorites')}
                        {favorites.length > 0 && (
                            <span style={{ fontSize: '0.8rem', fontWeight: 800, opacity: 0.85, marginInlineStart: 8 }}>
                                ({favorites.length})
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div style={{ padding: '18px 16px 120px' }}>
                {(hydrating || !favSettled) ? (
                    <div className="taki-deals-grid" style={{ display: 'grid', gap: 10 }}>
                        {[0, 1, 2, 3].map(i => (
                            <div key={i} style={{ height: 250, borderRadius: 24, background: 'var(--gray-100)' }} className="animate-pulse" />
                        ))}
                    </div>
                ) : empty ? (
                    <div style={{
                        textAlign: 'center', padding: '70px 20px',
                        background: 'var(--card-bg)', borderRadius: 24, border: '1px dashed var(--border-color)',
                    }}>
                        <div style={{ fontSize: '3.4rem', marginBottom: 16 }}>🔖</div>
                        <h2 style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 8 }}>
                            {t('لم تحفظ أي عرض بعد', 'You have not saved any deal yet')}
                        </h2>
                        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.8, marginBottom: 18 }}>
                            {t(
                                'اضغط على علامة الحفظ 🔖 في زاوية أي عرض ليظهر هنا — حتى لو لم تسجّل دخولك.',
                                'Tap the bookmark 🔖 in the corner of any deal and it lands here — even before you sign in.',
                            )}
                        </p>
                        <button
                            onClick={() => history.push('/deals')}
                            style={{
                                padding: '12px 22px', borderRadius: 16, border: 'none', cursor: 'pointer',
                                background: 'var(--primary)', color: '#fff', fontWeight: 900, fontSize: '0.9rem',
                            }}
                        >{t('تصفّح العروض', 'Browse deals')}</button>
                    </div>
                ) : (
                    <>
                        {!user && (
                            <div style={{
                                background: 'var(--card-bg)', border: '1px dashed var(--border-color)',
                                borderRadius: 16, padding: '12px 14px', marginBottom: 14,
                                fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.7,
                            }}>
                                💡 {t(
                                    'مفضلتك محفوظة على هذا الجهاز فقط. سجّل دخولك لتنتقل معك إلى أي جهاز.',
                                    'These are saved on this device only. Sign in and they follow you to any device.',
                                )}
                            </div>
                        )}

                        {live.length > 0 && (
                            <div className="taki-deals-grid" style={{ display: 'grid', gap: 10 }}>
                                {live.map(d => (
                                    <DealCard key={d.id} deal={d} onClick={(id) => history.push(`/deal/${id}`)} />
                                ))}
                            </div>
                        )}

                        {gone.length > 0 && (
                            <>
                                <h3 style={{
                                    fontSize: '0.9rem', fontWeight: 900, color: 'var(--text-secondary)',
                                    margin: '22px 0 10px',
                                }}>
                                    {t(`انتهت (${gone.length})`, `Ended (${gone.length})`)}
                                </h3>
                                <div className="taki-deals-grid" style={{ display: 'grid', gap: 10, opacity: 0.6 }}>
                                    {gone.map(d => (
                                        <DealCard key={d.id} deal={d} onClick={(id) => history.push(`/deal/${id}`)} />
                                    ))}
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>

            <BottomNav />
        </div>
    );
};

export default Favorites;
