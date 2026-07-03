import React, { useMemo, useState } from 'react';
import { Deal, Booking, CATEGORIES, Category } from '../../data/mock';

/**
 * SellerAnalytics (v12.00) — a modern, self-contained analytics suite for the
 * seller dashboard's «التحليلات» tab. Everything is computed CLIENT-SIDE from
 * the deals + bookings already in memory (no new RPC, works instantly), and
 * every chart is hand-rolled SVG (no charting dependency — same approach as the
 * admin panel) so the bundle stays lean.
 *
 * Sections:
 *  1. KPI cards (lifetime): views, bookings, conversion, revenue, savings, active deals
 *  2. Bookings + revenue trend over a selectable window (7 / 30 / 90 days)
 *  3. Peak booking hours (Riyadh wall-clock) — when to be ready
 *  4. Top performing deals (views → bookings → conversion → revenue)
 *  5. Category performance
 *  6. Discount effectiveness (which discount band actually converts)
 *  7. Booking status mix (donut)
 */

const RIYADH_OFFSET_MS = 3 * 3600 * 1000; // KSA is UTC+3, no DST.
// Shift to Riyadh wall-clock then read UTC parts → device-timezone-independent.
const riyadhParts = (ts: number) => {
    const d = new Date(ts + RIYADH_OFFSET_MS);
    return { key: d.toISOString().slice(0, 10), hour: d.getUTCHours() };
};

type RangeDays = 7 | 30 | 90;

interface Props {
    myDeals: Deal[];
    myOrders: Booking[];
    isRTL: boolean;
}

const C = {
    primary: 'var(--primary)',
    violet: '#7c3aed',
    blue: '#2563eb',
    teal: '#0d9488',
    amber: '#f59e0b',
    rose: '#ef4444',
    green: '#10b981',
    slate: '#64748b',
};

const SellerAnalytics: React.FC<Props> = ({ myDeals, myOrders, isRTL }) => {
    const [range, setRange] = useState<RangeDays>(30);
    const t = (ar: string, en: string) => (isRTL ? ar : en);
    const nf = (n: number) => Math.round(n).toLocaleString(isRTL ? 'ar-EG' : 'en-US');
    const money = (n: number) => `${nf(n)} ${t('ر.س', 'SAR')}`;

    // ===== Core aggregates (lifetime) =====
    const valid = useMemo(() => myOrders.filter(o => o.status !== 'cancelled'), [myOrders]);
    const totals = useMemo(() => {
        const views = myDeals.reduce((a, d) => a + (d.views || 0), 0);
        const bookings = valid.length;
        const revenue = valid.reduce((a, o) => a + (o.deal.discountedPrice || 0) * (o.bookedQuantity || 1), 0);
        const savings = valid.reduce((a, o) => a + Math.max(0, (o.deal.originalPrice || 0) - (o.deal.discountedPrice || 0)) * (o.bookedQuantity || 1), 0);
        const completed = valid.filter(o => o.status === 'completed').length;
        const activeDeals = myDeals.filter(d => d.status === 'active').length;
        const conv = views > 0 ? (bookings / views) * 100 : 0;
        return { views, bookings, revenue, savings, completed, activeDeals, conv };
    }, [myDeals, valid]);

    // ===== Trend over the selected window =====
    const trend = useMemo(() => {
        const days: { key: string; label: string }[] = [];
        const now = Date.now();
        for (let i = range - 1; i >= 0; i--) {
            const ts = now - i * 86400000;
            const { key } = riyadhParts(ts);
            const d = new Date(ts + RIYADH_OFFSET_MS);
            days.push({ key, label: `${d.getUTCDate()}/${d.getUTCMonth() + 1}` });
        }
        const idx = new Map(days.map((d, i) => [d.key, i]));
        const bookingsPerDay = new Array(days.length).fill(0);
        const revenuePerDay = new Array(days.length).fill(0);
        for (const o of valid) {
            const { key } = riyadhParts(o.bookedAt || 0);
            const i = idx.get(key);
            if (i === undefined) continue;
            bookingsPerDay[i] += 1;
            revenuePerDay[i] += (o.deal.discountedPrice || 0) * (o.bookedQuantity || 1);
        }
        return {
            days,
            bookingsPerDay,
            revenuePerDay,
            periodBookings: bookingsPerDay.reduce((a: number, b: number) => a + b, 0),
            periodRevenue: revenuePerDay.reduce((a: number, b: number) => a + b, 0),
        };
    }, [valid, range]);

    // ===== Peak hours (0–23, Riyadh) =====
    const hours = useMemo(() => {
        const h = new Array(24).fill(0);
        for (const o of valid) h[riyadhParts(o.bookedAt || 0).hour] += 1;
        return h;
    }, [valid]);
    const peakHour = useMemo(() => hours.indexOf(Math.max(...hours)), [hours]);

    // ===== Top deals =====
    const topDeals = useMemo(() => {
        return myDeals.map(d => {
            const os = valid.filter(o => o.deal.id === d.id);
            const bookings = os.length;
            const revenue = os.reduce((a, o) => a + (d.discountedPrice || 0) * (o.bookedQuantity || 1), 0);
            const conv = (d.views || 0) > 0 ? (bookings / (d.views || 1)) * 100 : 0;
            return { id: d.id, name: d.itemName, image: d.images?.[0], views: d.views || 0, bookings, revenue, conv };
        }).sort((a, b) => b.bookings - a.bookings || b.views - a.views).slice(0, 8);
    }, [myDeals, valid]);

    // ===== Category performance =====
    const catPerf = useMemo(() => {
        const map = new Map<Category, number>();
        for (const o of valid) {
            const c = o.deal.category as Category;
            map.set(c, (map.get(c) || 0) + 1);
        }
        return Array.from(map, ([cat, count]) => {
            const info = CATEGORIES.find(x => x.id === cat);
            return { label: `${info?.emoji || '🏷️'} ${info ? (isRTL ? info.ar : info.en) : cat}`, value: count };
        }).sort((a, b) => b.value - a.value).slice(0, 7);
    }, [valid, isRTL]);

    // ===== Discount effectiveness =====
    const discBands = useMemo(() => {
        const bands = [
            { label: '1–20%', min: 1, max: 20, value: 0 },
            { label: '21–40%', min: 21, max: 40, value: 0 },
            { label: '41–60%', min: 41, max: 60, value: 0 },
            { label: '61%+', min: 61, max: 1000, value: 0 },
        ];
        for (const o of valid) {
            const p = o.deal.discountPercentage || 0;
            const b = bands.find(x => p >= x.min && p <= x.max);
            if (b) b.value += 1;
        }
        return bands;
    }, [valid]);

    // ===== Status mix =====
    const statusMix = useMemo(() => {
        const order: { k: NonNullable<Booking['status']>; label: string; color: string }[] = [
            { k: 'completed', label: t('مكتمل', 'Completed'), color: C.green },
            { k: 'acknowledged', label: t('مؤكَّد', 'Confirmed'), color: C.blue },
            { k: 'pending', label: t('قيد الانتظار', 'Pending'), color: C.amber },
            { k: 'cancelled', label: t('ملغى', 'Cancelled'), color: C.slate },
        ];
        return order.map(s => ({ ...s, value: myOrders.filter(o => (o.status || 'pending') === s.k).length }))
            .filter(s => s.value > 0);
    }, [myOrders, isRTL]);

    // ===================== Render =====================
    if (myDeals.length === 0) {
        return (
            <div style={{ textAlign: 'center', padding: 50, opacity: 0.55 }}>
                <div style={{ fontSize: '3rem', marginBottom: 10 }}>📊</div>
                <div style={{ fontWeight: 800 }}>{t('أضف أول عرض لتبدأ التحليلات', 'Add your first deal to unlock analytics')}</div>
            </div>
        );
    }

    return (
        <div className="animate-fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* KPI grid — كل مؤشر معه شرح مبسّط بلغة التاجر (طلب ناصر v12.15) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <Kpi emoji="👁️" value={nf(totals.views)} label={t('المشاهدات', 'Views')} accent={C.blue}
                    hint={t('كم مرة فتح المتسوقون عروضك', 'Times shoppers opened your deals')} />
                <Kpi emoji="🎟️" value={nf(totals.bookings)} label={t('الحجوزات', 'Bookings')} accent={C.violet}
                    hint={t('كل الحجوزات على عروضك (بدون الملغاة)', 'All bookings except cancelled')} />
                <Kpi emoji="📈" value={`${totals.conv.toFixed(1)}%`} label={t('التحويل', 'Conversion')} accent={C.teal}
                    hint={t('من كل ١٠٠ مشاهدة، كم صارت حجزاً', 'Of 100 views, how many booked')} />
                <Kpi emoji="💰" value={money(totals.revenue)} label={t('المبيعات', 'Revenue')} accent={C.green} small
                    hint={t('سعرك بعد الخصم × الكمية لكل الحجوزات', 'Discounted price × qty, all bookings')} />
                <Kpi emoji="🏷️" value={money(totals.savings)} label={t('وفّرته للعملاء', 'Savings given')} accent={C.amber} small
                    hint={t('(السعر قبل الخصم − بعده) × الكمية — هذا ما كسبه عملاؤك منك', '(Original − discounted) × qty your customers saved')} />
                <Kpi emoji="✅" value={`${nf(totals.completed)}/${nf(totals.bookings)}`} label={t('مكتملة', 'Completed')} accent={C.primary} small
                    hint={t('حجوزات استلمها العميل فعلاً من المجموع', 'Bookings actually picked up, of total')} />
            </div>
            <div style={{ fontSize: '0.68rem', color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.8, background: 'var(--card-bg)', border: '1px dashed var(--border-color)', borderRadius: 14, padding: '10px 14px' }}>
                💡 {t(
                    '«المبيعات» = قيمة كل الحجوزات غير الملغاة بسعرك المخفَّض (تشمل ما لم يُستلم بعد). «وفّرته للعملاء» = فرق التخفيض الذي قدّمته — رقم تسويقي قوي يبيّن قيمة متجرك للمتسوقين.',
                    '"Revenue" = value of all non-cancelled bookings at your discounted price (includes not-yet-picked-up). "Savings given" = the discount value you handed customers — a strong marketing number.'
                )}
            </div>

            {/* Trend */}
            <Section title={t('📅 الحجوزات عبر الوقت', '📅 Bookings over time')}>
                <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
                    {([7, 30, 90] as RangeDays[]).map(r => (
                        <button key={r} onClick={() => setRange(r)}
                            style={{
                                flex: 1, padding: '7px 0', borderRadius: 10, fontSize: '0.72rem', fontWeight: 800,
                                border: '1px solid var(--border-color)', cursor: 'pointer',
                                background: range === r ? 'var(--primary)' : 'transparent',
                                color: range === r ? '#fff' : 'var(--text-secondary)',
                            }}>
                            {t(`آخر ${r} يوم`, `${r}d`)}
                        </button>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
                    <MiniStat value={nf(trend.periodBookings)} label={t('حجوزات الفترة', 'Bookings')} />
                    <MiniStat value={money(trend.periodRevenue)} label={t('مبيعات الفترة', 'Revenue')} />
                </div>
                <AreaChart values={trend.bookingsPerDay} labels={trend.days.map(d => d.label)} isRTL={isRTL} />
            </Section>

            {/* Peak hours */}
            <Section title={t('⏰ أوقات الذروة للحجز', '⏰ Peak booking hours')}
                subtitle={totals.bookings > 0 ? t(`الأكثر ازدحاماً: الساعة ${peakHour}:00`, `Busiest: ${peakHour}:00`) : undefined}>
                <VBars values={hours} color={C.violet} isRTL={isRTL}
                    labelEvery={3} fmtLabel={(i) => `${i}`} />
            </Section>

            {/* Top deals */}
            <Section title={t('🏆 أفضل العروض أداءً', '🏆 Top performing deals')}>
                {topDeals.some(d => d.bookings > 0 || d.views > 0) ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {topDeals.map((d, i) => {
                            const maxB = Math.max(1, ...topDeals.map(x => x.bookings));
                            return (
                                <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <span style={{ fontSize: '0.8rem', fontWeight: 900, color: 'var(--text-secondary)', width: 16 }}>{i + 1}</span>
                                    {d.image && <img src={d.image} alt="" style={{ width: 38, height: 38, borderRadius: 9, objectFit: 'cover', flexShrink: 0 }} />}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: '0.82rem', fontWeight: 800, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.name}</div>
                                        <div style={{ height: 5, background: 'var(--gray-100)', borderRadius: 3, marginTop: 4, overflow: 'hidden' }}>
                                            <div style={{ width: `${(d.bookings / maxB) * 100}%`, height: '100%', background: C.violet, borderRadius: 3 }} />
                                        </div>
                                    </div>
                                    <div style={{ textAlign: isRTL ? 'left' : 'right', flexShrink: 0 }}>
                                        <div style={{ fontSize: '0.8rem', fontWeight: 900, color: 'var(--text-primary)' }}>{nf(d.bookings)} 🎟️</div>
                                        <div style={{ fontSize: '0.62rem', color: 'var(--text-secondary)', fontWeight: 700 }}>{nf(d.views)} 👁️ · {d.conv.toFixed(0)}%</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                ) : <Empty isRTL={isRTL} />}
            </Section>

            {/* Category performance */}
            {catPerf.length > 0 && (
                <Section title={t('🗂️ الأداء حسب التصنيف', '🗂️ Performance by category')}>
                    <HBars data={catPerf} color={C.teal} isRTL={isRTL} fmt={nf} />
                </Section>
            )}

            {/* Discount effectiveness */}
            <Section title={t('💸 فعالية نسبة الخصم', '💸 Discount effectiveness')}
                subtitle={t('أي نسبة خصم تجلب حجوزات أكثر', 'Which discount band converts best')}>
                {discBands.some(b => b.value > 0)
                    ? <VBars values={discBands.map(b => b.value)} color={C.rose} isRTL={isRTL}
                        labelEvery={1} fmtLabel={(i) => discBands[i].label} showValues />
                    : <Empty isRTL={isRTL} />}
            </Section>

            {/* Status mix */}
            {statusMix.length > 0 && (
                <Section title={t('🧾 حالة الحجوزات', '🧾 Booking status')}>
                    <Donut segments={statusMix} isRTL={isRTL} nf={nf} />
                </Section>
            )}
        </div>
    );
};

/* ------------------------------------------------------------------ */
/* Presentational helpers                                              */
/* ------------------------------------------------------------------ */

const Kpi: React.FC<{ emoji: string; value: string; label: string; accent: string; small?: boolean; hint?: string }> = ({ emoji, value, label, accent, small, hint }) => (
    <div style={{ background: 'var(--card-bg)', padding: '14px 10px', borderRadius: 18, border: '1px solid var(--border-color)', textAlign: 'center', boxShadow: 'var(--shadow-sm)', borderTop: `3px solid ${accent}` }}>
        <div style={{ fontSize: '1.25rem', marginBottom: 3 }}>{emoji}</div>
        <div style={{ fontSize: small ? '0.82rem' : '1.15rem', fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1.15 }}>{value}</div>
        <div style={{ fontSize: '0.64rem', fontWeight: 800, color: 'var(--text-secondary)', marginTop: 3 }}>{label}</div>
        {hint && <div style={{ fontSize: '0.56rem', fontWeight: 600, color: 'var(--text-secondary)', opacity: 0.85, marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}
    </div>
);

const Section: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
    <div style={{ background: 'var(--card-bg)', borderRadius: 22, padding: 18, border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
        <h3 style={{ fontSize: '0.95rem', fontWeight: 900, margin: 0, color: 'var(--text-primary)' }}>{title}</h3>
        {subtitle && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: 3 }}>{subtitle}</div>}
        <div style={{ marginTop: 14 }}>{children}</div>
    </div>
);

const MiniStat: React.FC<{ value: string; label: string }> = ({ value, label }) => (
    <div>
        <div style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--text-primary)' }}>{value}</div>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</div>
    </div>
);

const Empty: React.FC<{ isRTL: boolean }> = ({ isRTL }) => (
    <div style={{ textAlign: 'center', padding: '18px 0', opacity: 0.5, fontSize: '0.8rem', fontWeight: 700 }}>
        {isRTL ? 'لا توجد بيانات كافية بعد' : 'Not enough data yet'}
    </div>
);

/** Smooth area+line chart. viewBox space; scales to container width. */
const AreaChart: React.FC<{ values: number[]; labels: string[]; isRTL: boolean }> = ({ values, labels, isRTL }) => {
    const W = 320, H = 110, P = 6;
    const max = Math.max(1, ...values);
    const n = values.length;
    const x = (i: number) => {
        const raw = n <= 1 ? P : P + (i * (W - P * 2)) / (n - 1);
        return isRTL ? W - raw : raw;
    };
    const y = (v: number) => H - P - (v / max) * (H - P * 2 - 10);
    const pts = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    const line = pts.length ? `M ${pts.join(' L ')}` : '';
    const area = pts.length ? `${line} L ${x(n - 1).toFixed(1)},${H - P} L ${x(0).toFixed(1)},${H - P} Z` : '';
    return (
        <div>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} preserveAspectRatio="none">
                <defs>
                    <linearGradient id="sa-area" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity="0.02" />
                    </linearGradient>
                </defs>
                {area && <path d={area} fill="url(#sa-area)" />}
                {line && <path d={line} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
                {values.map((v, i) => v === max && max > 0 ? (
                    <circle key={i} cx={x(i)} cy={y(v)} r={3} fill="var(--primary)" />
                ) : null)}
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: '0.58rem', color: 'var(--text-secondary)', fontWeight: 600, direction: isRTL ? 'rtl' : 'ltr' }}>
                <span>{labels[0]}</span>
                {labels.length > 2 && <span>{labels[Math.floor(labels.length / 2)]}</span>}
                <span>{labels[labels.length - 1]}</span>
            </div>
        </div>
    );
};

/** Vertical bars (peak hours / discount bands). */
const VBars: React.FC<{ values: number[]; color: string; isRTL: boolean; labelEvery: number; fmtLabel: (i: number) => string; showValues?: boolean }> = ({ values, color, isRTL, labelEvery, fmtLabel, showValues }) => {
    const max = Math.max(1, ...values);
    const arr = isRTL ? values.map((_, i) => values.length - 1 - i) : values.map((_, i) => i);
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 96 }}>
                {arr.map((i) => {
                    const v = values[i];
                    return (
                        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }} title={`${fmtLabel(i)} — ${v}`}>
                            {showValues && v > 0 && <span style={{ fontSize: '0.55rem', fontWeight: 800, color: 'var(--text-secondary)', marginBottom: 2 }}>{v}</span>}
                            <div style={{ width: '100%', maxWidth: 26, height: `${(v / max) * 100}%`, minHeight: v > 0 ? 3 : 0, background: color, borderRadius: '4px 4px 0 0', opacity: v > 0 ? 1 : 0.15, transition: 'height 0.3s ease' }} />
                        </div>
                    );
                })}
            </div>
            <div style={{ display: 'flex', gap: 2, marginTop: 5 }}>
                {arr.map((i) => (
                    <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: '0.55rem', color: 'var(--text-secondary)', fontWeight: 600 }}>
                        {i % labelEvery === 0 ? fmtLabel(i) : ''}
                    </div>
                ))}
            </div>
        </div>
    );
};

/** Horizontal labelled bars (category performance). */
const HBars: React.FC<{ data: { label: string; value: number }[]; color: string; isRTL: boolean; fmt: (n: number) => string }> = ({ data, color, fmt }) => {
    const max = Math.max(1, ...data.map(d => d.value));
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {data.map((d, i) => (
                <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>
                        <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</span>
                        <span style={{ color: 'var(--text-secondary)', flexShrink: 0, marginInlineStart: 8 }}>{fmt(d.value)}</span>
                    </div>
                    <div style={{ height: 8, background: 'var(--gray-100)', borderRadius: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${(d.value / max) * 100}%`, height: '100%', background: color, borderRadius: 4 }} />
                    </div>
                </div>
            ))}
        </div>
    );
};

/** Donut chart for status mix. */
const Donut: React.FC<{ segments: { label: string; value: number; color: string }[]; isRTL: boolean; nf: (n: number) => string }> = ({ segments, nf }) => {
    const total = segments.reduce((a, s) => a + s.value, 0) || 1;
    const R = 46, SW = 16, CIRC = 2 * Math.PI * R;
    let acc = 0;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <svg viewBox="0 0 120 120" width={120} height={120} style={{ flexShrink: 0 }}>
                <g transform="rotate(-90 60 60)">
                    {segments.map((s, i) => {
                        const len = (s.value / total) * CIRC;
                        const dash = `${len} ${CIRC - len}`;
                        const off = -acc;
                        acc += len;
                        return <circle key={i} cx={60} cy={60} r={R} fill="none" stroke={s.color} strokeWidth={SW} strokeDasharray={dash} strokeDashoffset={off} />;
                    })}
                </g>
                <text x={60} y={56} textAnchor="middle" style={{ fontSize: 20, fontWeight: 900, fill: 'var(--text-primary)' }}>{nf(total)}</text>
                <text x={60} y={72} textAnchor="middle" style={{ fontSize: 9, fontWeight: 700, fill: 'var(--text-secondary)' }}>الكل</text>
            </svg>
            <div style={{ flex: 1, minWidth: 130, display: 'flex', flexDirection: 'column', gap: 7 }}>
                {segments.map((s, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.76rem', fontWeight: 700 }}>
                        <span style={{ width: 11, height: 11, borderRadius: 3, background: s.color, flexShrink: 0 }} />
                        <span style={{ color: 'var(--text-primary)', flex: 1 }}>{s.label}</span>
                        <span style={{ color: 'var(--text-secondary)' }}>{nf(s.value)} · {Math.round((s.value / total) * 100)}%</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default SellerAnalytics;
