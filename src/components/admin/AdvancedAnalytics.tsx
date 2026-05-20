/**
 * AdvancedAnalytics — world-class admin analytics panel (v10.98).
 *
 * Renders 12 analytics views in one tab, each backed by a dedicated RPC
 * added in the v10_98_admin_world_class_analytics migration:
 *  1. Revenue forecast hero
 *  2. Booking funnel (view → book)
 *  3. Daily metrics multi-line chart
 *  4. Activity heatmap (7 × 24)
 *  5. Monthly MRR bar chart
 *  6. Subscription growth (new vs churn)
 *  7. Subscription lifecycle donut
 *  8. Cohort retention table
 *  9. Upcoming renewals timeline
 *  10. Churned customers list (win-back)
 *  11. Browse-but-didn't-book leaderboard
 *  12. Category conversion table
 *
 * SVG-only charts — no external libraries — so the bundle stays lean.
 * Everything refreshes together via `refresh()` when the user changes
 * the period (7/30/90 days).
 */

import React, {
    useCallback,
    useEffect,
    useMemo,
    useState,
    memo,
} from 'react';
import { useHistory } from 'react-router-dom';
import { adminService } from '../../services/adminService';
import { Tooltip } from './Tooltip';
import { CopyButton } from './CopyButton';
import { ExportButton } from './ExportButton';
import { CsvColumn } from '../../utils/csvExport';

// ============================================================
// Period selector — drives every section's "last N days" filter
// ============================================================
type Period = 7 | 30 | 90;

// ============================================================
// Tiny shared chart primitives
// ============================================================
const fmtMoney = (v: number) => `${Math.round(v).toLocaleString('ar-SA')} ر.س`;
const fmtNum = (v: number) => v.toLocaleString('ar-SA');
const fmtDate = (iso: string | null) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('ar-SA'); } catch { return iso; }
};
const daysAgo = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    const d = Math.floor(ms / 86400000);
    if (d < 1) return 'اليوم';
    if (d === 1) return 'أمس';
    return `قبل ${d} يوم`;
};

// ============================================================
// 1) Revenue forecast hero
// ============================================================
interface ForecastData {
    monthly_expected: number;
    paying_sellers: number;
    free_sellers: number;
    trial_sellers: number;
    expires_7d: number;
    expires_30d: number;
    avg_arpu: number;
}

const RevenueForecastHero = memo<{ data: ForecastData | null }>(({ data }) => (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-500 via-teal-600 to-cyan-700 p-6 text-white shadow-2xl">
        <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-white/10 blur-3xl"></div>
        <div className="absolute -left-16 -bottom-16 w-64 h-64 rounded-full bg-white/5 blur-3xl"></div>
        <div className="relative">
            <div className="flex items-center gap-2 mb-3">
                <span className="bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold">
                    💰 الإيراد الشهري المتوقّع
                </span>
            </div>
            <div className="text-5xl font-extrabold tabular-nums mb-1">
                {data ? fmtMoney(data.monthly_expected) : '...'}
            </div>
            <div className="text-sm opacity-80 mb-4">
                ARPU = {data ? fmtMoney(data.avg_arpu) : '...'} لكل تاجر مدفوع
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Chip label="مدفوعون"     value={data?.paying_sellers ?? '...'} tone="emerald-strong" />
                <Chip label="تجريبي"      value={data?.trial_sellers ?? '...'}  tone="amber" />
                <Chip label="مجاني"       value={data?.free_sellers ?? '...'}   tone="gray" />
                <Chip label="ينتهي 7 أيام" value={data?.expires_7d ?? '...'}     tone="red" highlight={Boolean(data && data.expires_7d > 0)} />
            </div>
        </div>
    </div>
));
RevenueForecastHero.displayName = 'RevenueForecastHero';

const Chip = memo<{
    label: string;
    value: string | number;
    tone: 'emerald-strong' | 'amber' | 'gray' | 'red' | 'blue';
    highlight?: boolean;
}>(({ label, value, tone, highlight }) => {
    const toneCls: Record<string, string> = {
        'emerald-strong': 'bg-white/25',
        amber: 'bg-amber-300/20',
        gray: 'bg-white/10',
        red: 'bg-red-400/30',
        blue: 'bg-blue-400/30',
    };
    return (
        <div className={`rounded-xl px-3 py-2 backdrop-blur-sm ${toneCls[tone]} ${
            highlight ? 'ring-2 ring-white/40' : ''
        }`}>
            <div className="text-2xl font-extrabold tabular-nums">{value}</div>
            <div className="text-[10px] opacity-90 font-bold">{label}</div>
        </div>
    );
});
Chip.displayName = 'Chip';

// ============================================================
// 2) Booking funnel — view_deal → book
// ============================================================
interface FunnelData {
    total_views: number;
    unique_viewers: number;
    total_bookings: number;
    unique_bookers: number;
    conversion_pct: number;
    avg_views_per_booker: number;
}

const BookingFunnelCard = memo<{ data: FunnelData | null; period: Period }>(({ data, period }) => {
    // Compute bar widths relative to the largest stage so the funnel reads
    // as a true funnel shape (each stage narrower than the prior).
    const max = Math.max(data?.total_views ?? 0, 1);
    const viewsPct = max ? 100 : 0;
    const bookPct = max ? Math.round(((data?.total_bookings ?? 0) / max) * 100) : 0;
    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 className="text-lg font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                    🔥 قمع التحويل
                    <Tooltip text="نسبة من شاهد عرضاً ثم قام بالحجز فعلاً. الـ ROI الأساسي للمنصة.">
                        <span className="text-xs text-[var(--gray-400)] font-bold cursor-help">⓵</span>
                    </Tooltip>
                </h3>
                <span className="text-xs text-[var(--text-secondary)] font-bold">آخر {period} يوم</span>
            </div>
            <div className="space-y-3">
                <FunnelStage
                    label="👀 شاهدوا العرض"
                    primary={fmtNum(data?.total_views ?? 0)}
                    sub={`${fmtNum(data?.unique_viewers ?? 0)} مستخدم فريد`}
                    pct={viewsPct}
                    color="from-blue-500 to-indigo-600"
                />
                <FunnelStage
                    label="🎟️ حجزوا فعلاً"
                    primary={fmtNum(data?.total_bookings ?? 0)}
                    sub={`${fmtNum(data?.unique_bookers ?? 0)} مستخدم فريد`}
                    pct={bookPct}
                    color="from-emerald-500 to-teal-600"
                />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
                <MetricBox
                    label="نسبة التحويل"
                    value={`${data?.conversion_pct ?? 0}%`}
                    sub="من شاهد ثم حجز"
                    tone="emerald"
                />
                <MetricBox
                    label="متوسط المشاهدات"
                    value={fmtNum(data?.avg_views_per_booker ?? 0)}
                    sub="مشاهدة قبل كل حجز"
                    tone="blue"
                />
            </div>
        </section>
    );
});
BookingFunnelCard.displayName = 'BookingFunnelCard';

const FunnelStage = memo<{
    label: string; primary: string; sub: string; pct: number; color: string;
}>(({ label, primary, sub, pct, color }) => (
    <div>
        <div className="flex items-baseline justify-between mb-1">
            <span className="font-bold text-sm text-[var(--text-primary)]">{label}</span>
            <span className="text-xs text-[var(--text-secondary)] font-bold">{sub}</span>
        </div>
        <div className="relative h-12 bg-[var(--body-bg)] rounded-xl overflow-hidden">
            <div
                className={`h-full bg-gradient-to-l ${color} rounded-xl flex items-center justify-end px-4 transition-all`}
                style={{ width: `${Math.max(pct, 8)}%` }}
            >
                <span className="text-white font-extrabold text-base tabular-nums">{primary}</span>
            </div>
        </div>
    </div>
));
FunnelStage.displayName = 'FunnelStage';

const MetricBox = memo<{
    label: string; value: string; sub?: string; tone: 'emerald' | 'blue' | 'red' | 'amber';
}>(({ label, value, sub, tone }) => {
    const toneCls: Record<string, string> = {
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        blue: 'bg-blue-50 text-blue-700 border-blue-200',
        red: 'bg-red-50 text-red-700 border-red-200',
        amber: 'bg-amber-50 text-amber-700 border-amber-200',
    };
    return (
        <div className={`rounded-xl p-3 border ${toneCls[tone]}`}>
            <div className="text-2xl font-extrabold tabular-nums">{value}</div>
            <div className="text-xs font-bold opacity-80">{label}</div>
            {sub && <div className="text-[10px] opacity-70 mt-0.5">{sub}</div>}
        </div>
    );
});
MetricBox.displayName = 'MetricBox';

// ============================================================
// 3) Daily metrics multi-series chart (events / bookings / new users)
// ============================================================
interface DailyPoint {
    day_key: string;
    day_label: string;
    events: number;
    bookings: number;
    new_users: number;
    completed_bookings: number;
    cancelled_bookings: number;
}

const DailyMetricsChart = memo<{ data: DailyPoint[]; period: Period }>(({ data, period }) => {
    if (!data || data.length === 0) {
        return (
            <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
                <h3 className="text-lg font-extrabold mb-3">📈 المقاييس اليومية</h3>
                <div className="h-44 flex items-center justify-center text-[var(--gray-400)] font-bold text-sm">
                    لا توجد بيانات في الفترة المختارة
                </div>
            </section>
        );
    }
    const maxEvents = Math.max(...data.map((d) => d.events), 1);
    const maxBookings = Math.max(...data.map((d) => d.bookings), 1);
    const maxUsers = Math.max(...data.map((d) => d.new_users), 1);

    const W = 100;
    const H = 100;
    const stepX = data.length > 1 ? W / (data.length - 1) : 0;

    const line = (vals: number[], max: number) =>
        vals
            .map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * stepX} ${H - (v / max) * (H - 8)}`)
            .join(' ');

    const totalEvents = data.reduce((s, d) => s + d.events, 0);
    const totalBookings = data.reduce((s, d) => s + d.bookings, 0);
    const totalNewUsers = data.reduce((s, d) => s + d.new_users, 0);

    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h3 className="text-lg font-extrabold text-[var(--text-primary)]">📈 المقاييس اليومية</h3>
                <span className="text-xs text-[var(--text-secondary)] font-bold">آخر {period} يوم</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
                <LegendBlock color="bg-indigo-500" label="أحداث" value={fmtNum(totalEvents)} />
                <LegendBlock color="bg-emerald-500" label="حجوزات" value={fmtNum(totalBookings)} />
                <LegendBlock color="bg-amber-500" label="مستخدمون جدد" value={fmtNum(totalNewUsers)} />
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-44">
                <path d={line(data.map((d) => d.events), maxEvents)} fill="none" stroke="#6366f1" strokeWidth="0.6" strokeLinejoin="round" />
                <path d={line(data.map((d) => d.bookings), maxBookings)} fill="none" stroke="#10b981" strokeWidth="0.6" strokeLinejoin="round" />
                <path d={line(data.map((d) => d.new_users), maxUsers)} fill="none" stroke="#f59e0b" strokeWidth="0.6" strokeLinejoin="round" />
            </svg>
            <div className="flex justify-between text-[10px] text-[var(--gray-400)] font-bold mt-1 tabular-nums" dir="ltr">
                {data.length > 0 && <span>{data[0].day_label}</span>}
                {data.length > 4 && <span>{data[Math.floor(data.length / 2)].day_label}</span>}
                {data.length > 0 && <span>{data[data.length - 1].day_label}</span>}
            </div>
        </section>
    );
});
DailyMetricsChart.displayName = 'DailyMetricsChart';

const LegendBlock = memo<{ color: string; label: string; value: string }>(({ color, label, value }) => (
    <div className="bg-[var(--body-bg)] rounded-xl p-2.5">
        <div className="flex items-center gap-1.5 mb-0.5">
            <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
            <span className="text-[10px] text-[var(--text-secondary)] font-bold">{label}</span>
        </div>
        <div className="text-lg font-extrabold tabular-nums">{value}</div>
    </div>
));
LegendBlock.displayName = 'LegendBlock';

// ============================================================
// 4) Activity heatmap — 7 × 24 grid
// ============================================================
const DAY_LABELS = ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'];

const ActivityHeatmap = memo<{ data: Array<{ dow: number; hour: number; cnt: number }>; period: Period }>(({ data, period }) => {
    const matrix = useMemo(() => {
        const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
        for (const { dow, hour, cnt } of data) {
            if (dow >= 0 && dow < 7 && hour >= 0 && hour < 24) {
                grid[dow][hour] = cnt;
            }
        }
        return grid;
    }, [data]);

    const max = useMemo(() => {
        let m = 0;
        for (const row of matrix) for (const v of row) if (v > m) m = v;
        return m;
    }, [matrix]);

    const peakCell = useMemo(() => {
        let best = { dow: 0, hour: 0, cnt: 0 };
        for (let d = 0; d < 7; d++) {
            for (let h = 0; h < 24; h++) {
                if (matrix[d][h] > best.cnt) best = { dow: d, hour: h, cnt: matrix[d][h] };
            }
        }
        return best;
    }, [matrix]);

    const cellColor = (v: number): string => {
        if (max === 0) return 'bg-[var(--gray-100)]';
        const intensity = v / max;
        if (intensity === 0) return 'bg-[var(--gray-100)]';
        if (intensity < 0.2) return 'bg-emerald-100';
        if (intensity < 0.4) return 'bg-emerald-200';
        if (intensity < 0.6) return 'bg-emerald-400';
        if (intensity < 0.8) return 'bg-emerald-500';
        return 'bg-emerald-600';
    };

    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h3 className="text-lg font-extrabold text-[var(--text-primary)]">
                    🌡️ خريطة النشاط الأسبوعية
                </h3>
                <span className="text-xs text-[var(--text-secondary)] font-bold">آخر {period} يوم · بتوقيت الرياض</span>
            </div>
            {max > 0 && (
                <div className="text-xs text-[var(--text-secondary)] mb-3 font-bold">
                    🏆 أنشط وقت:{' '}
                    <span className="text-emerald-700 font-extrabold">
                        {DAY_LABELS[peakCell.dow]} الساعة {peakCell.hour}:00
                    </span>{' '}
                    ({fmtNum(peakCell.cnt)} حدث)
                </div>
            )}
            <div className="overflow-x-auto">
                <div className="inline-block min-w-full">
                    <div className="flex items-center gap-1 mb-1 text-[10px] text-[var(--gray-400)] font-bold tabular-nums" dir="ltr">
                        <div className="w-12" />
                        {Array.from({ length: 24 }, (_, h) => (
                            <div key={h} className="w-5 text-center">
                                {h % 3 === 0 ? h : ''}
                            </div>
                        ))}
                    </div>
                    {matrix.map((row, dow) => (
                        <div key={dow} className="flex items-center gap-1 mb-1">
                            <div className="w-12 text-[10px] font-bold text-[var(--text-secondary)] text-left">
                                {DAY_LABELS[dow]}
                            </div>
                            {row.map((v, h) => (
                                <Tooltip key={h} text={`${DAY_LABELS[dow]} ${h}:00 — ${fmtNum(v)} حدث`}>
                                    <div
                                        className={`w-5 h-5 rounded ${cellColor(v)} hover:ring-2 hover:ring-emerald-300 cursor-pointer`}
                                    />
                                </Tooltip>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
            <div className="flex items-center gap-2 mt-3 text-[10px] text-[var(--text-secondary)] font-bold">
                <span>أقل</span>
                <div className="flex gap-1">
                    {['bg-[var(--gray-100)]', 'bg-emerald-100', 'bg-emerald-200', 'bg-emerald-400', 'bg-emerald-500', 'bg-emerald-600'].map(
                        (c, i) => <div key={i} className={`w-4 h-3 rounded ${c}`} />
                    )}
                </div>
                <span>أكثر</span>
            </div>
        </section>
    );
});
ActivityHeatmap.displayName = 'ActivityHeatmap';

// ============================================================
// 5) Monthly MRR bar chart (12 months)
// ============================================================
interface MrrPoint { month_key: string; month_label: string; paid_amount: number; paid_count: number; refunded_amount: number; }

const MonthlyMrrChart = memo<{ data: MrrPoint[] }>(({ data }) => {
    if (!data || data.length === 0) {
        return (
            <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
                <h3 className="text-lg font-extrabold mb-2">💰 إيرادات شهرية</h3>
                <div className="h-32 flex items-center justify-center text-[var(--gray-400)] font-bold text-sm">
                    لا توجد دفعات مسجّلة بعد. سيبدأ المخطط بعد أول دفعة من بوابة الدفع.
                </div>
            </section>
        );
    }
    const max = Math.max(...data.map((d) => d.paid_amount), 1);
    const total = data.reduce((s, d) => s + d.paid_amount, 0);
    const currentMonth = data[data.length - 1];
    const prevMonth = data.length > 1 ? data[data.length - 2] : null;
    const monthOverMonth = prevMonth && prevMonth.paid_amount > 0
        ? Math.round(((currentMonth.paid_amount - prevMonth.paid_amount) / prevMonth.paid_amount) * 100)
        : null;
    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-1">
                <h3 className="text-lg font-extrabold text-[var(--text-primary)]">💰 الإيرادات الشهرية</h3>
                <span className="text-sm font-extrabold text-emerald-600 tabular-nums">{fmtMoney(total)} إجمالي</span>
            </div>
            <div className="text-xs text-[var(--text-secondary)] mb-3 font-bold">
                هذا الشهر: <span className="text-[var(--text-primary)] font-extrabold">{fmtMoney(currentMonth.paid_amount)}</span>
                {monthOverMonth !== null && (
                    <span className={`mr-2 ${monthOverMonth >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {monthOverMonth >= 0 ? '↑' : '↓'} {Math.abs(monthOverMonth)}% vs الشهر السابق
                    </span>
                )}
            </div>
            <div className="flex items-end gap-1 h-32">
                {data.map((d) => (
                    <Tooltip key={d.month_key} text={`${d.month_label}: ${fmtMoney(d.paid_amount)} (${d.paid_count} دفعة)`}>
                        <div className="flex-1 flex flex-col items-center gap-1">
                            <div
                                className="w-full bg-gradient-to-t from-emerald-500 to-teal-400 rounded-t-md cursor-pointer hover:from-emerald-600"
                                style={{ height: `${(d.paid_amount / max) * 100}%`, minHeight: 2 }}
                            />
                            <div className="text-[9px] text-[var(--text-secondary)] font-bold whitespace-nowrap">
                                {d.month_label}
                            </div>
                        </div>
                    </Tooltip>
                ))}
            </div>
        </section>
    );
});
MonthlyMrrChart.displayName = 'MonthlyMrrChart';

// ============================================================
// 6) Subscription growth chart (new vs churned per month)
// ============================================================
interface GrowthPoint { month_key: string; month_label: string; new_subs: number; churned_subs: number; net_change: number; }

const SubscriptionGrowthChart = memo<{ data: GrowthPoint[] }>(({ data }) => {
    if (!data || data.length === 0) return null;
    const max = Math.max(...data.flatMap((d) => [d.new_subs, d.churned_subs]), 1);
    const totalNew = data.reduce((s, d) => s + d.new_subs, 0);
    const totalChurn = data.reduce((s, d) => s + d.churned_subs, 0);
    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <h3 className="text-lg font-extrabold text-[var(--text-primary)] mb-1">📊 نمو الاشتراكات شهرياً</h3>
            <div className="text-xs text-[var(--text-secondary)] mb-3 font-bold flex gap-3">
                <span>اشتراكات جديدة: <span className="text-emerald-700 font-extrabold">{fmtNum(totalNew)}</span></span>
                <span>إلغاءات: <span className="text-red-700 font-extrabold">{fmtNum(totalChurn)}</span></span>
                <span>الصافي: <span className={`font-extrabold ${totalNew - totalChurn >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{totalNew - totalChurn >= 0 ? '+' : ''}{fmtNum(totalNew - totalChurn)}</span></span>
            </div>
            <div className="flex items-end gap-2 h-28">
                {data.map((d) => (
                    <Tooltip key={d.month_key} text={`${d.month_label}: +${d.new_subs} جديد / -${d.churned_subs} إلغاء`}>
                        <div className="flex-1 flex flex-col items-center gap-1">
                            <div className="w-full flex gap-0.5 items-end" style={{ height: '100%' }}>
                                <div
                                    className="flex-1 bg-emerald-500 rounded-t-sm"
                                    style={{ height: `${(d.new_subs / max) * 100}%`, minHeight: d.new_subs > 0 ? 2 : 0 }}
                                />
                                <div
                                    className="flex-1 bg-red-500 rounded-t-sm"
                                    style={{ height: `${(d.churned_subs / max) * 100}%`, minHeight: d.churned_subs > 0 ? 2 : 0 }}
                                />
                            </div>
                            <div className="text-[9px] text-[var(--text-secondary)] font-bold">{d.month_label}</div>
                        </div>
                    </Tooltip>
                ))}
            </div>
        </section>
    );
});
SubscriptionGrowthChart.displayName = 'SubscriptionGrowthChart';

// ============================================================
// 7) Lifecycle donut
// ============================================================
const LIFECYCLE_META: Record<string, { label: string; color: string }> = {
    trial:      { label: 'تجريبي',    color: '#f59e0b' },
    active:     { label: 'نشط',       color: '#10b981' },
    past_due:   { label: 'متأخر',     color: '#dc2626' },
    cancelled:  { label: 'ملغي',      color: '#6b7280' },
    gifted:     { label: 'هدية',      color: '#8b5cf6' },
    frozen:     { label: 'مجمّد',     color: '#3b82f6' },
};

const LifecyclePie = memo<{ data: Array<{ status: string; cnt: number }> }>(({ data }) => {
    const total = data.reduce((s, d) => s + d.cnt, 0);
    if (total === 0) {
        return (
            <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
                <h3 className="text-lg font-extrabold mb-3">🍩 دورة حياة الاشتراك</h3>
                <div className="h-40 flex items-center justify-center text-[var(--gray-400)] font-bold text-sm">
                    لا توجد اشتراكات بعد
                </div>
            </section>
        );
    }
    // Build SVG arcs for a donut chart.
    let cum = 0;
    const arcs = data.map((d) => {
        const meta = LIFECYCLE_META[d.status] ?? { label: d.status, color: '#94a3b8' };
        const start = cum / total;
        cum += d.cnt;
        const end = cum / total;
        return { ...d, meta, start, end, pct: Math.round((d.cnt / total) * 100) };
    });
    const polarToCartesian = (cx: number, cy: number, r: number, angle: number) => {
        const a = (angle - 0.25) * 2 * Math.PI; // start at 12 o'clock
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    };
    const arcPath = (start: number, end: number) => {
        if (end - start >= 0.999) {
            // Full circle — draw as two halves.
            return `M 50 5 A 45 45 0 1 1 49.99 5 Z`;
        }
        const p1 = polarToCartesian(50, 50, 45, start);
        const p2 = polarToCartesian(50, 50, 45, end);
        const large = end - start > 0.5 ? 1 : 0;
        return `M ${p1.x} ${p1.y} A 45 45 0 ${large} 1 ${p2.x} ${p2.y}`;
    };

    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <h3 className="text-lg font-extrabold text-[var(--text-primary)] mb-3">🍩 دورة حياة الاشتراك</h3>
            <div className="flex items-center gap-4 flex-wrap">
                <svg viewBox="0 0 100 100" className="w-32 h-32 flex-shrink-0">
                    {arcs.map((a) => (
                        <path
                            key={a.status}
                            d={arcPath(a.start, a.end)}
                            fill="none"
                            stroke={a.meta.color}
                            strokeWidth="12"
                            strokeLinecap="butt"
                        />
                    ))}
                    <text x="50" y="46" textAnchor="middle" className="fill-[var(--text-primary)]" style={{ fontSize: 14, fontWeight: 800 }}>
                        {total}
                    </text>
                    <text x="50" y="58" textAnchor="middle" className="fill-[var(--text-secondary)]" style={{ fontSize: 6, fontWeight: 700 }}>
                        اشتراك
                    </text>
                </svg>
                <div className="flex-1 min-w-0 space-y-1.5">
                    {arcs.map((a) => (
                        <div key={a.status} className="flex items-center gap-2">
                            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: a.meta.color }} />
                            <span className="text-xs font-bold text-[var(--text-primary)] flex-1">{a.meta.label}</span>
                            <span className="text-xs font-extrabold tabular-nums">{a.cnt}</span>
                            <span className="text-[10px] text-[var(--text-secondary)] font-bold tabular-nums">({a.pct}%)</span>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
});
LifecyclePie.displayName = 'LifecyclePie';

// ============================================================
// 8) User cohorts retention table
// ============================================================
const CohortTable = memo<{ data: Array<{ cohort_key: string; cohort_label: string; registered: number; active_now: number; booked_ever: number; retention_pct: number; }> }>(({ data }) => (
    <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm overflow-hidden">
        <h3 className="text-lg font-extrabold text-[var(--text-primary)] mb-1">👥 مجموعات المستخدمين (Cohorts)</h3>
        <p className="text-xs text-[var(--text-secondary)] mb-3 font-bold">
            من سجّل في الشهر، كم منهم لا يزال نشطاً الآن وكم منهم حجز فعلاً
        </p>
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-xs text-[var(--text-secondary)] font-bold border-b border-[var(--border-color)]">
                        <th className="text-right py-2">الشهر</th>
                        <th className="text-right py-2">سجّلوا</th>
                        <th className="text-right py-2">حجزوا</th>
                        <th className="text-right py-2">نشطون الآن</th>
                        <th className="text-right py-2">الاستبقاء</th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((c) => (
                        <tr key={c.cohort_key} className="border-b border-[var(--border-color)] hover:bg-[var(--body-bg)]">
                            <td className="py-2.5 font-bold">{c.cohort_label}</td>
                            <td className="py-2.5 tabular-nums">{fmtNum(c.registered)}</td>
                            <td className="py-2.5 tabular-nums text-emerald-700 font-bold">{fmtNum(c.booked_ever)}</td>
                            <td className="py-2.5 tabular-nums">{fmtNum(c.active_now)}</td>
                            <td className="py-2.5">
                                <RetentionBar pct={c.retention_pct} />
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </section>
));
CohortTable.displayName = 'CohortTable';

const RetentionBar = memo<{ pct: number }>(({ pct }) => {
    const safe = Math.max(0, Math.min(100, pct));
    const color = safe >= 60 ? 'bg-emerald-500' : safe >= 30 ? 'bg-amber-500' : 'bg-red-500';
    return (
        <div className="flex items-center gap-2">
            <div className="relative w-16 h-2 bg-[var(--gray-100)] rounded-full overflow-hidden">
                <div className={`h-full ${color}`} style={{ width: `${safe}%` }} />
            </div>
            <span className="text-xs font-extrabold tabular-nums" style={{ minWidth: 32 }}>{safe}%</span>
        </div>
    );
});
RetentionBar.displayName = 'RetentionBar';

// ============================================================
// 9) Upcoming renewals / subscription timeline
// ============================================================
interface SubTimelineRow {
    store_id: string; name: string; shop: string | null; phone: string | null;
    plan: string; started_at: string | null; expires_at: string | null;
    days_remaining: number | null;
    amount: number; discount: number; net_amount: number;
}

const TIMELINE_CSV_COLUMNS: CsvColumn<SubTimelineRow>[] = [
    { header: 'المتجر', accessor: (r) => r.shop ?? r.name },
    { header: 'الجوال', accessor: (r) => r.phone ?? '' },
    { header: 'الباقة', accessor: (r) => r.plan },
    { header: 'بداية الاشتراك', accessor: (r) => r.started_at ?? '' },
    { header: 'انتهاء الاشتراك', accessor: (r) => r.expires_at ?? '' },
    { header: 'أيام متبقية', accessor: (r) => r.days_remaining ?? '' },
    { header: 'المبلغ', accessor: (r) => r.amount },
    { header: 'الخصم %', accessor: (r) => r.discount },
    { header: 'الصافي', accessor: (r) => r.net_amount },
];

const SubscriptionTimelineSection = memo<{ data: SubTimelineRow[]; onOpenSeller: (id: string, name: string) => void }>(({ data, onOpenSeller }) => {
    // Bucket by urgency.
    const expiringSoon = data.filter((r) => r.days_remaining !== null && r.days_remaining >= 0 && r.days_remaining <= 7);
    const expiringMonth = data.filter((r) => r.days_remaining !== null && r.days_remaining > 7 && r.days_remaining <= 30);
    const expired = data.filter((r) => r.days_remaining !== null && r.days_remaining < 0);
    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <h3 className="text-lg font-extrabold text-[var(--text-primary)]">📅 جدول الاشتراكات</h3>
                <ExportButton
                    rows={data}
                    columns={TIMELINE_CSV_COLUMNS}
                    filenameStem="taki-subscription-timeline"
                    accent="purple"
                    tooltip="تنزيل جدول الاشتراكات كاملاً مع التواريخ والمبالغ"
                />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
                <UrgencyCard
                    label="ينتهي خلال 7 أيام"
                    count={expiringSoon.length}
                    sum={expiringSoon.reduce((s, r) => s + r.net_amount, 0)}
                    tone="red"
                />
                <UrgencyCard
                    label="ينتهي خلال 30 يوم"
                    count={expiringMonth.length}
                    sum={expiringMonth.reduce((s, r) => s + r.net_amount, 0)}
                    tone="amber"
                />
                <UrgencyCard
                    label="منتهٍ بالفعل"
                    count={expired.length}
                    sum={expired.reduce((s, r) => s + r.net_amount, 0)}
                    tone="gray"
                />
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-[var(--border-color)]">
                {data.length === 0 ? (
                    <div className="text-center py-8 text-sm text-[var(--gray-400)] font-bold">لا توجد اشتراكات</div>
                ) : data.slice(0, 25).map((row) => (
                    <TimelineRow key={row.store_id} row={row} onOpen={() => onOpenSeller(row.store_id, row.shop ?? row.name)} />
                ))}
            </div>
        </section>
    );
});
SubscriptionTimelineSection.displayName = 'SubscriptionTimelineSection';

const UrgencyCard = memo<{ label: string; count: number; sum: number; tone: 'red' | 'amber' | 'gray' }>(({ label, count, sum, tone }) => {
    const toneCls: Record<string, string> = {
        red: 'bg-red-50 border-red-200 text-red-700',
        amber: 'bg-amber-50 border-amber-200 text-amber-700',
        gray: 'bg-[var(--body-bg)] border-[var(--border-color)] text-[var(--text-secondary)]',
    };
    return (
        <div className={`rounded-xl border p-3 ${toneCls[tone]}`}>
            <div className="text-2xl font-extrabold tabular-nums">{count}</div>
            <div className="text-xs font-bold mb-1">{label}</div>
            <div className="text-[10px] opacity-80 tabular-nums">{fmtMoney(sum)}/شهر</div>
        </div>
    );
});
UrgencyCard.displayName = 'UrgencyCard';

const TimelineRow = memo<{ row: SubTimelineRow; onOpen: () => void }>(({ row, onOpen }) => {
    const dr = row.days_remaining;
    const urgencyCls =
        dr === null ? 'text-[var(--text-secondary)]' :
        dr < 0 ? 'text-red-700' :
        dr <= 7 ? 'text-red-600' :
        dr <= 30 ? 'text-amber-600' :
        'text-[var(--text-secondary)]';
    return (
        <button onClick={onOpen} className="w-full text-right py-3 px-2 hover:bg-[var(--body-bg)] flex items-center gap-3 transition-colors">
            <div className="flex-1 min-w-0">
                <div className="font-bold text-sm truncate">{row.shop ?? row.name}</div>
                <div className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5" dir="ltr">
                    <span>{row.phone ?? '—'}</span>
                </div>
            </div>
            <div className="text-left flex-shrink-0">
                <div className="text-sm font-extrabold tabular-nums text-emerald-700">{fmtMoney(row.net_amount)}</div>
                <div className={`text-[10px] font-bold ${urgencyCls} tabular-nums`}>
                    {dr === null
                        ? '— بلا انتهاء'
                        : dr < 0
                            ? `منتهٍ منذ ${Math.abs(dr)} يوم`
                            : `${dr} يوم متبقي`}
                </div>
            </div>
        </button>
    );
});
TimelineRow.displayName = 'TimelineRow';

// ============================================================
// 10) Churned customers (win-back list)
// ============================================================
interface ChurnedRow {
    store_id: string; name: string; shop: string | null;
    phone: string | null; plan: string | null;
    ended_at: string; days_since_churn: number; last_amount: number;
}

const ChurnedCustomersSection = memo<{ data: ChurnedRow[]; onOpenSeller: (id: string, name: string) => void }>(({ data, onOpenSeller }) => {
    const totalLost = data.reduce((s, r) => s + r.last_amount, 0);
    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                <h3 className="text-lg font-extrabold text-[var(--text-primary)]">🪦 الاشتراكات المفقودة (للاسترجاع)</h3>
                <ExportButton
                    rows={data}
                    columns={[
                        { header: 'المتجر',       accessor: (r: ChurnedRow) => r.shop ?? r.name },
                        { header: 'الجوال',       accessor: (r: ChurnedRow) => r.phone ?? '' },
                        { header: 'انتهى في',     accessor: (r: ChurnedRow) => r.ended_at },
                        { header: 'أيام منذ الإلغاء', accessor: (r: ChurnedRow) => r.days_since_churn },
                        { header: 'المبلغ المفقود', accessor: (r: ChurnedRow) => r.last_amount },
                    ]}
                    filenameStem="taki-win-back-list"
                    accent="purple"
                />
            </div>
            <div className="text-xs text-[var(--text-secondary)] mb-3 font-bold">
                {data.length} تاجر اشتركوا وتركوا — فرصة استرجاع بـ{' '}
                <span className="text-red-700 font-extrabold">{fmtMoney(totalLost)}</span> شهرياً
            </div>
            <div className="max-h-80 overflow-y-auto divide-y divide-[var(--border-color)]">
                {data.length === 0 ? (
                    <div className="text-center py-8 text-sm text-[var(--gray-400)] font-bold">🎉 لا توجد اشتراكات مفقودة!</div>
                ) : data.map((row) => (
                    <button
                        key={row.store_id}
                        onClick={() => onOpenSeller(row.store_id, row.shop ?? row.name)}
                        className="w-full text-right py-3 px-2 hover:bg-[var(--body-bg)] flex items-center gap-3 transition-colors"
                    >
                        <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center text-red-600 font-bold flex-shrink-0">
                            {(row.shop ?? row.name)?.[0] ?? '?'}
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="font-bold text-sm truncate">{row.shop ?? row.name}</div>
                            <div className="text-xs text-[var(--text-secondary)]" dir="ltr">{row.phone ?? '—'}</div>
                        </div>
                        <div className="text-left flex-shrink-0">
                            <div className="text-xs font-bold text-red-700">منذ {row.days_since_churn} يوم</div>
                            <div className="text-[10px] text-[var(--text-secondary)]">{fmtDate(row.ended_at)}</div>
                        </div>
                    </button>
                ))}
            </div>
        </section>
    );
});
ChurnedCustomersSection.displayName = 'ChurnedCustomersSection';

// ============================================================
// 11) Browse-but-didn't-book list
// ============================================================
interface NoBookRow {
    user_id: string; name: string; phone: string | null;
    views_count: number; last_viewed_at: string; deals_seen: number;
}

const BrowseNoBookSection = memo<{ data: NoBookRow[]; period: Period }>(({ data, period }) => (
    <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
        <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
            <h3 className="text-lg font-extrabold text-[var(--text-primary)]">🎣 شاهدوا ولم يحجزوا</h3>
            <ExportButton
                rows={data}
                columns={[
                    { header: 'الاسم',       accessor: (r: NoBookRow) => r.name },
                    { header: 'الجوال',      accessor: (r: NoBookRow) => r.phone ?? '' },
                    { header: 'مشاهدات',     accessor: (r: NoBookRow) => r.views_count },
                    { header: 'عروض مختلفة', accessor: (r: NoBookRow) => r.deals_seen },
                    { header: 'آخر مشاهدة',  accessor: (r: NoBookRow) => r.last_viewed_at },
                ]}
                filenameStem="taki-browse-no-book"
                accent="blue"
                tooltip="تنزيل قائمة المهتمين الذين لم يحجزوا — للتسويق المستهدف"
            />
        </div>
        <div className="text-xs text-[var(--text-secondary)] mb-3 font-bold">
            مشترون شاهدوا عروضاً خلال آخر {period} يوم بدون حجز — مرشّحون قويّون لإعادة استهداف
        </div>
        <div className="max-h-80 overflow-y-auto divide-y divide-[var(--border-color)]">
            {data.length === 0 ? (
                <div className="text-center py-8 text-sm text-[var(--gray-400)] font-bold">
                    لا توجد بيانات. كل من شاهد قام بحجز فعلاً 👍
                </div>
            ) : data.map((row) => (
                <div key={row.user_id} className="py-3 px-2 flex items-center gap-3 hover:bg-[var(--body-bg)]">
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold flex-shrink-0">
                        {row.name?.[0] ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm truncate">{row.name}</div>
                        <div className="text-xs text-[var(--text-secondary)] flex items-center gap-1.5" dir="ltr">
                            <span>{row.phone ?? '—'}</span>
                            {row.phone && <CopyButton value={row.phone} label="الجوال" size="xs" />}
                        </div>
                    </div>
                    <div className="text-left flex-shrink-0">
                        <div className="text-base font-extrabold text-blue-700 tabular-nums">{row.views_count}</div>
                        <div className="text-[10px] text-[var(--text-secondary)] font-bold">مشاهدة</div>
                        <div className="text-[10px] text-[var(--text-secondary)]">{daysAgo(row.last_viewed_at)}</div>
                    </div>
                </div>
            ))}
        </div>
    </section>
));
BrowseNoBookSection.displayName = 'BrowseNoBookSection';

// ============================================================
// 12) Category conversion table
// ============================================================
const CategoryFunnelTable = memo<{ data: Array<{ category: string; views: number; bookings: number; conversion_pct: number; }> }>(({ data }) => {
    if (data.length === 0) return null;
    const maxViews = Math.max(...data.map((d) => d.views), 1);
    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <h3 className="text-lg font-extrabold text-[var(--text-primary)] mb-3">🏷️ أداء التصنيفات</h3>
            <div className="space-y-2.5">
                {data.map((c) => (
                    <div key={c.category} className="bg-[var(--body-bg)] rounded-xl p-3">
                        <div className="flex items-baseline justify-between mb-1.5">
                            <span className="font-extrabold text-sm">{c.category}</span>
                            <span className="text-xs tabular-nums">
                                <span className="font-extrabold text-emerald-700">{fmtNum(c.bookings)}</span>
                                {' / '}
                                <span className="text-[var(--text-secondary)]">{fmtNum(c.views)}</span>
                                {' · '}
                                <span className="font-extrabold text-blue-700">{c.conversion_pct}%</span>
                            </span>
                        </div>
                        <div className="relative h-2 bg-[var(--card-bg)] rounded-full overflow-hidden">
                            <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-blue-400 to-blue-600 rounded-full"
                                 style={{ width: `${(c.views / maxViews) * 100}%` }} />
                            <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-emerald-500 to-emerald-700 rounded-full"
                                 style={{ width: `${((c.bookings) / maxViews) * 100}%` }} />
                        </div>
                    </div>
                ))}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-[var(--text-secondary)] font-bold mt-3">
                <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-500 rounded" /> مشاهدات</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 bg-emerald-500 rounded" /> حجوزات</span>
            </div>
        </section>
    );
});
CategoryFunnelTable.displayName = 'CategoryFunnelTable';

// ============================================================
// Period chip selector
// ============================================================
const PeriodSelector = memo<{ period: Period; onChange: (p: Period) => void }>(({ period, onChange }) => (
    <div className="inline-flex bg-[var(--card-bg)] rounded-xl border border-[var(--border-color)] p-1 gap-1">
        {([7, 30, 90] as Period[]).map((p) => (
            <button
                key={p}
                onClick={() => onChange(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                    period === p
                        ? 'bg-gradient-to-r from-emerald-500 to-teal-600 text-white shadow'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--gray-100)]'
                }`}
            >
                آخر {p} يوم
            </button>
        ))}
    </div>
));
PeriodSelector.displayName = 'PeriodSelector';

// ============================================================
// Master container — coordinates fetching + period state
// ============================================================
export const AdvancedAnalytics: React.FC = () => {
    const history = useHistory();
    const [period, setPeriod] = useState<Period>(30);

    const [forecast, setForecast] = useState<ForecastData | null>(null);
    const [funnel, setFunnel] = useState<FunnelData | null>(null);
    const [daily, setDaily] = useState<DailyPoint[]>([]);
    const [heatmap, setHeatmap] = useState<Array<{ dow: number; hour: number; cnt: number }>>([]);
    const [mrr, setMrr] = useState<MrrPoint[]>([]);
    const [growth, setGrowth] = useState<GrowthPoint[]>([]);
    const [lifecycle, setLifecycle] = useState<Array<{ status: string; cnt: number }>>([]);
    const [cohorts, setCohorts] = useState<Array<{ cohort_key: string; cohort_label: string; registered: number; active_now: number; booked_ever: number; retention_pct: number }>>([]);
    const [timeline, setTimeline] = useState<SubTimelineRow[]>([]);
    const [churned, setChurned] = useState<ChurnedRow[]>([]);
    const [noBook, setNoBook] = useState<NoBookRow[]>([]);
    const [categories, setCategories] = useState<Array<{ category: string; views: number; bookings: number; conversion_pct: number }>>([]);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        const [
            f, fn, dm, hm, m, g, lc, ch, tl, cs, nb, cf,
        ] = await Promise.all([
            adminService.getRevenueForecast(),
            adminService.getBookingFunnel(period),
            adminService.getDailyMetrics(period),
            adminService.getActivityHeatmap(period),
            adminService.getMrrMonthly(12),
            adminService.getSubscriptionGrowth(12),
            adminService.getSubscriptionLifecycle(),
            adminService.getUserCohorts(6),
            adminService.getSubscriptionTimeline(200),
            adminService.getChurnedSubscribers(90, 100),
            adminService.getBrowseNoBook(period, 50),
            adminService.getCategoryFunnel(period, 12),
        ]);
        setForecast(f);
        setFunnel(fn);
        setDaily(dm);
        setHeatmap(hm);
        setMrr(m);
        setGrowth(g);
        setLifecycle(lc);
        setCohorts(ch);
        setTimeline(tl);
        setChurned(cs);
        setNoBook(nb);
        setCategories(cf);
        setLoading(false);
    }, [period]);

    useEffect(() => { refresh(); }, [refresh]);

    const openSeller = useCallback((id: string, _name: string) => {
        history.push(`/store/${id}`);
    }, [history]);

    return (
        <div className="space-y-5 animate-fade-in" dir="rtl">
            {/* Period selector + refresh */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                    <h2 className="text-2xl font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                        🚀 التحليلات المتقدّمة
                        <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full">
                            نظام عالمي
                        </span>
                    </h2>
                    <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                        كل ما تحتاجه لاتخاذ قرار: قمع تحويل، إيرادات، استبقاء، استرجاع
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <PeriodSelector period={period} onChange={setPeriod} />
                    <Tooltip text="إعادة تحميل كل التحليلات">
                        <button
                            onClick={refresh}
                            disabled={loading}
                            className="h-10 px-4 bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-emerald-300 rounded-xl font-bold text-sm flex items-center gap-2 disabled:opacity-50"
                        >
                            🔄 تحديث
                        </button>
                    </Tooltip>
                </div>
            </div>

            {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-48 bg-[var(--gray-100)] rounded-2xl animate-pulse" />
                    ))}
                </div>
            ) : (
                <>
                    {/* Revenue hero */}
                    <RevenueForecastHero data={forecast} />

                    {/* Funnel + Daily */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <BookingFunnelCard data={funnel} period={period} />
                        <DailyMetricsChart data={daily} period={period} />
                    </div>

                    {/* Heatmap */}
                    <ActivityHeatmap data={heatmap} period={period} />

                    {/* MRR + Growth */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <MonthlyMrrChart data={mrr} />
                        <SubscriptionGrowthChart data={growth} />
                    </div>

                    {/* Lifecycle + Cohorts */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <LifecyclePie data={lifecycle} />
                        <CohortTable data={cohorts} />
                    </div>

                    {/* Subscription timeline */}
                    <SubscriptionTimelineSection data={timeline} onOpenSeller={openSeller} />

                    {/* Churned + Browse-no-book side by side */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <ChurnedCustomersSection data={churned} onOpenSeller={openSeller} />
                        <BrowseNoBookSection data={noBook} period={period} />
                    </div>

                    {/* Categories */}
                    <CategoryFunnelTable data={categories} />
                </>
            )}
        </div>
    );
};

export default AdvancedAnalytics;
