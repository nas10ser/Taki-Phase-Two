import React, { useEffect, useState, useMemo } from 'react';
import { analyticsRepository, StoreFunnel, DailyStat, DealFunnel } from '../repositories/analyticsRepository';
import { useApp } from '../context/AppContext';

interface Props {
    storeId: string;
    isRTL: boolean;
}

/**
 * Phase 2.3.4 — full-funnel analytics dashboard for the merchant.
 * Shows views → clicks → started → abandoned → completed, daily chart,
 * per-deal breakdown, and the abandoned-rate signal so sellers know
 * where shoppers drop off.
 */
const SellerAnalytics: React.FC<Props> = ({ storeId, isRTL }) => {
    const { deals } = useApp();
    const [funnel, setFunnel] = useState<StoreFunnel | null>(null);
    const [daily, setDaily] = useState<DailyStat[]>([]);
    const [dealFunnels, setDealFunnels] = useState<Record<string, DealFunnel>>({});
    const [days, setDays] = useState(30);
    const [loading, setLoading] = useState(true);

    const myDeals = useMemo(() => deals.filter(d => d.storeId === storeId).slice(0, 8), [deals, storeId]);

    useEffect(() => {
        let alive = true;
        const load = async () => {
            setLoading(true);
            const [f, d] = await Promise.all([
                analyticsRepository.getStoreFunnel(storeId, days),
                analyticsRepository.getDaily(storeId, Math.min(days, 30))
            ]);
            if (!alive) return;
            setFunnel(f);
            setDaily(d);
            setLoading(false);
        };
        load();
        return () => { alive = false; };
    }, [storeId, days]);

    useEffect(() => {
        if (myDeals.length === 0) return;
        let alive = true;
        Promise.all(myDeals.map(d => analyticsRepository.getDealFunnel(d.id, days).then(f => [d.id, f] as const)))
            .then(pairs => {
                if (!alive) return;
                const map: Record<string, DealFunnel> = {};
                pairs.forEach(([id, f]) => { if (f) map[id] = f; });
                setDealFunnels(map);
            });
        return () => { alive = false; };
    }, [myDeals, days]);

    const maxDay = Math.max(1, ...daily.map(d => d.views));

    if (loading) {
        return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-secondary)', fontWeight: 700 }}>{isRTL ? 'جاري التحميل…' : 'Loading…'}</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Range selector */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[7, 30, 90].map(n => (
                    <button key={n} onClick={() => setDays(n)} style={{
                        padding: '8px 14px', borderRadius: 999, border: 'none',
                        background: days === n ? '#0f172a' : '#e2e8f0',
                        color: days === n ? 'white' : '#0f172a',
                        fontSize: '0.82rem', fontWeight: 800, cursor: 'pointer'
                    }}>
                        {n === 7 ? (isRTL ? 'آخر أسبوع' : 'Last week') :
                         n === 30 ? (isRTL ? 'آخر شهر' : 'Last month') :
                         (isRTL ? 'آخر 3 أشهر' : 'Last 90 days')}
                    </button>
                ))}
            </div>

            {/* Funnel cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                <Stat label={isRTL ? '👁️ المشاهدات' : '👁️ Views'} value={funnel?.views || 0} color="#3b82f6" />
                <Stat label={isRTL ? '👆 النقرات' : '👆 Clicks'} value={funnel?.clicks || 0} color="#8b5cf6" />
                <Stat label={isRTL ? '🛒 بدأ الحجز' : '🛒 Started'} value={funnel?.bookingStarted || 0} color="#f59e0b" />
                <Stat label={isRTL ? '🚪 ترك الحجز' : '🚪 Abandoned'} value={funnel?.bookingAbandoned || 0} color="#ef4444" />
                <Stat label={isRTL ? '✅ أكمل الحجز' : '✅ Completed'} value={funnel?.bookingCompleted || 0} color="#10b981" />
                <Stat label={isRTL ? '🧍 جلسات فريدة' : '🧍 Sessions'} value={funnel?.uniqueSessions || 0} color="#0ea5e9" />
                <Stat label={isRTL ? '📈 نسبة التحويل' : '📈 Conversion'} value={`${funnel?.conversionRate || 0}%`} color="#16a34a" />
                <Stat label={isRTL ? '📉 نسبة التخلي' : '📉 Abandon rate'} value={`${funnel?.abandonedRate || 0}%`} color="#f97316" />
            </div>

            {/* Daily chart */}
            <div style={{ background: 'var(--card-bg, white)', borderRadius: 16, padding: 18 }}>
                <h3 style={{ margin: '0 0 12px', fontWeight: 900 }}>
                    📅 {isRTL ? 'النشاط اليومي' : 'Daily activity'}
                </h3>
                {daily.length === 0 ? (
                    <div style={{ color: 'var(--text-secondary)', fontWeight: 700, padding: 12 }}>
                        {isRTL ? 'لا توجد بيانات بعد. ستظهر فور بدء الزوار بزيارة عروضك.' : 'No data yet. Will appear once visitors start exploring your deals.'}
                    </div>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140 }}>
                        {daily.map(d => (
                            <div key={d.day} title={`${d.day} • ${d.views} views`} style={{
                                flex: 1, minWidth: 8,
                                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4
                            }}>
                                <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
                                    <div style={{
                                        width: '100%',
                                        height: `${Math.max(4, (d.views / maxDay) * 100)}%`,
                                        background: 'linear-gradient(to top, #3b82f6, #8b5cf6)',
                                        borderRadius: 4
                                    }} />
                                </div>
                                <div style={{ fontSize: '0.6rem', color: 'var(--text-secondary)', fontWeight: 700, transform: 'rotate(-45deg)', whiteSpace: 'nowrap', marginTop: 4 }}>
                                    {(d.day || '').slice(5)}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Per-deal funnel */}
            <div style={{ background: 'var(--card-bg, white)', borderRadius: 16, padding: 18 }}>
                <h3 style={{ margin: '0 0 12px', fontWeight: 900 }}>
                    🔍 {isRTL ? 'أداء كل عرض' : 'Per-deal performance'}
                </h3>
                {myDeals.length === 0 ? (
                    <div style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>{isRTL ? 'لا توجد عروض بعد' : 'No deals yet'}</div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {myDeals.map(d => {
                            const f = dealFunnels[d.id];
                            if (!f) return null;
                            const conv = f.clicks > 0 ? Math.round((f.bookingCompleted / f.clicks) * 100) : 0;
                            return (
                                <div key={d.id} style={{
                                    border: '1px solid var(--border-color)', borderRadius: 12, padding: 12,
                                    display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center'
                                }}>
                                    <div style={{ minWidth: 0 }}>
                                        <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {d.itemName}
                                        </div>
                                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700, marginTop: 4, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                            <span>👁️ {f.views}</span>
                                            <span>👆 {f.clicks}</span>
                                            <span>🛒 {f.bookingStarted}</span>
                                            <span>🚪 {f.bookingAbandoned}</span>
                                            <span>✅ {f.bookingCompleted}</span>
                                            <span>❤️ {f.favorites}</span>
                                            <span>🔗 {f.shares}</span>
                                        </div>
                                    </div>
                                    <div style={{ background: '#dcfce7', color: '#166534', padding: '4px 10px', borderRadius: 999, fontWeight: 900, fontSize: '0.8rem' }}>
                                        {conv}%
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            <div style={{
                background: 'linear-gradient(135deg, #0f172a, #1e293b)',
                color: 'white', borderRadius: 16, padding: 16, lineHeight: 1.6
            }}>
                <div style={{ fontWeight: 900, marginBottom: 6 }}>
                    💡 {isRTL ? 'كيف نقيس؟' : 'How we measure'}
                </div>
                <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
                    {isRTL
                        ? 'نتتبع كل خطوة: المشاهدة، النقرة، فتح نموذج الحجز، التراجع، وإتمام الحجز. نسبة التخلي العالية تعني أن خطوة الحجز تحتاج لتبسيط أو سعرك يحتاج لإعادة نظر.'
                        : 'We track every step: view → click → booking open → abandon → complete. A high abandon rate means the booking step needs simplification or the price needs a second look.'}
                </div>
            </div>
        </div>
    );
};

const Stat: React.FC<{ label: string; value: number | string; color: string }> = ({ label, value, color }) => (
    <div style={{
        background: 'var(--card-bg, white)', borderRadius: 14, padding: 14,
        border: '1px solid var(--border-color)'
    }}>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 800, marginBottom: 6 }}>{label}</div>
        <div style={{ fontSize: '1.4rem', fontWeight: 900, color }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
    </div>
);

export default SellerAnalytics;
