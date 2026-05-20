/**
 * InvestorPack — the headline analytics designed for investor due-diligence.
 *
 * What it shows (in order, because order matters for an investor scan):
 *  1. InvestorKpiHero — GMV, AOV, MAU, stickiness, conversion %, MoM growth
 *  2. DateLookup — choose any day / month / year and read the exact numbers
 *  3. GmvMonthlyChart — 12-month GMV with savings delivered overlay
 *  4. RetentionCurveTable — D1/D7/D30/D60 retention by signup cohort
 *  5. GeographicTable — city × region with bookings, GMV, unique buyers
 *  6. "Download Investor Pack" — one-click CSV bundle of everything
 *
 * Design notes:
 *  - Period selector (7/30/90 days) controls only the KPI hero. Charts
 *    use their own natural windows (12 months, 6 cohort months, etc.)
 *    because investors think in calendar months, not rolling N-day windows.
 *  - All currency rendered with Arabic locale + "ر.س" suffix.
 *  - Charts are pure SVG — zero new bundle weight.
 */

import React, {
    useCallback,
    useEffect,
    useMemo,
    useState,
    memo,
} from 'react';
import { adminService } from '../../services/adminService';
import { Tooltip } from './Tooltip';
import { ExportButton } from './ExportButton';
import { CsvColumn, downloadCsv } from '../../utils/csvExport';

type LookupMode = 'day' | 'month' | 'year';
type Period = 7 | 30 | 90;

const fmtMoney = (v: number | null | undefined) =>
    `${Math.round(v ?? 0).toLocaleString('ar-SA')} ر.س`;
const fmtNum = (v: number | null | undefined) => (v ?? 0).toLocaleString('ar-SA');
const fmtPct = (v: number | null | undefined) => `${(v ?? 0)}%`;
const toDateInput = (d: Date) => d.toISOString().split('T')[0];

// ============================================================
// Types
// ============================================================
interface InvestorKpis {
    period_days: number;
    gmv: number; gmv_completed: number; savings_delivered: number;
    total_bookings: number; completed_bookings: number; cancelled_bookings: number;
    avg_order_value: number;
    dau: number; wau: number; mau: number; stickiness_pct: number;
    total_views: number; unique_viewers: number; conversion_pct: number;
    repeat_customer_rate_pct: number;
    mom_gmv_growth_pct: number; mom_bookings_growth_pct: number; mom_new_users_growth_pct: number;
    new_buyers: number; new_sellers: number; net_active_merchants: number;
}

interface GmvMonth {
    month_key: string; month_label: string;
    gmv: number; completed_gmv: number;
    bookings_count: number; completed_count: number;
    avg_order_value: number; savings_delivered: number; unique_buyers: number;
}

interface GeoRow {
    city: string; region: string;
    bookings_count: number; completed_bookings: number;
    gmv: number; unique_buyers: number; active_stores: number;
}

interface RetentionRow {
    cohort_month: string; cohort_label: string; cohort_size: number;
    d1_pct: number; d7_pct: number; d30_pct: number; d60_pct: number;
}

// ============================================================
// MoM growth chip — green/red/gray pill
// ============================================================
const MomChip = memo<{ pct: number | null | undefined; label?: string }>(({ pct, label }) => {
    const v = pct ?? 0;
    const isUp = v > 0;
    const isDown = v < 0;
    const cls = isUp
        ? 'bg-emerald-100 text-emerald-800'
        : isDown
        ? 'bg-red-100 text-red-800'
        : 'bg-[var(--gray-100)] text-[var(--text-secondary)]';
    const arrow = isUp ? '↑' : isDown ? '↓' : '→';
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-extrabold ${cls}`}>
            {arrow} {Math.abs(v).toLocaleString('ar-SA')}%{label && <span className="opacity-80 mr-1">{label}</span>}
        </span>
    );
});
MomChip.displayName = 'MomChip';

// ============================================================
// 1) Investor KPI hero — the "what is this company?" snapshot
// ============================================================
const InvestorKpiHero = memo<{
    kpis: InvestorKpis | null;
    period: Period;
    onPeriodChange: (p: Period) => void;
}>(({ kpis, period, onPeriodChange }) => (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-2xl">
        <div className="absolute -right-20 -top-20 w-72 h-72 rounded-full bg-emerald-500/20 blur-3xl"></div>
        <div className="absolute -left-20 -bottom-20 w-72 h-72 rounded-full bg-blue-500/20 blur-3xl"></div>

        <div className="relative">
            <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="bg-white/10 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold">
                            🎯 ملف المستثمر
                        </span>
                        <span className="bg-emerald-500/30 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold">
                            Investor Pack
                        </span>
                    </div>
                    <h2 className="text-2xl font-extrabold">المقاييس الاستثمارية</h2>
                    <p className="text-sm opacity-70">الأرقام التي يطلبها المستثمر في أول مكالمة</p>
                </div>
                <div className="inline-flex bg-white/10 backdrop-blur-sm rounded-xl p-1 gap-1">
                    {([7, 30, 90] as Period[]).map((p) => (
                        <button
                            key={p}
                            onClick={() => onPeriodChange(p)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                                period === p
                                    ? 'bg-white text-slate-900 shadow'
                                    : 'text-white/80 hover:bg-white/10'
                            }`}
                        >
                            آخر {p} يوم
                        </button>
                    ))}
                </div>
            </div>

            {/* Headline GMV */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <BigStat
                    label="GMV (إجمالي قيمة الحجوزات)"
                    value={fmtMoney(kpis?.gmv)}
                    sub={`مكتمل: ${fmtMoney(kpis?.gmv_completed)}`}
                    growthPct={kpis?.mom_gmv_growth_pct}
                    growthLabel="vs الفترة السابقة"
                    accent="emerald"
                />
                <BigStat
                    label="MAU — مستخدمين نشطين شهرياً"
                    value={fmtNum(kpis?.mau)}
                    sub={`DAU: ${fmtNum(kpis?.dau)} · WAU: ${fmtNum(kpis?.wau)}`}
                    extra={<span>التماسك (DAU/MAU): <strong>{fmtPct(kpis?.stickiness_pct)}</strong></span>}
                    accent="blue"
                />
                <BigStat
                    label="AOV — متوسط قيمة الحجز"
                    value={fmtMoney(kpis?.avg_order_value)}
                    sub={`${fmtNum(kpis?.completed_bookings)} حجز مكتمل`}
                    accent="amber"
                />
            </div>

            {/* Secondary metrics grid */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <SmallStat label="نسبة التحويل" value={fmtPct(kpis?.conversion_pct)} hint="من شاهد ثم حجز" />
                <SmallStat label="عملاء يعيدون" value={fmtPct(kpis?.repeat_customer_rate_pct)} hint="حجزوا مرتين+" />
                <SmallStat label="مدّخرات للعملاء" value={fmtMoney(kpis?.savings_delivered)} hint="فرق السعر الموزّع" />
                <SmallStat label="حجوزات إجمالية" value={fmtNum(kpis?.total_bookings)}
                    growthPct={kpis?.mom_bookings_growth_pct} />
                <SmallStat label="مشترون جدد" value={fmtNum(kpis?.new_buyers)}
                    growthPct={kpis?.mom_new_users_growth_pct} />
            </div>

            <div className="mt-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                <SmallStat label="تجار جدد" value={fmtNum(kpis?.new_sellers)} hint="انضمّوا في الفترة" />
                <SmallStat label="تجار نشطون" value={fmtNum(kpis?.net_active_merchants)} hint="عندهم حجوزات فعلية" />
                <SmallStat label="مشاهدات" value={fmtNum(kpis?.total_views)} hint={`${fmtNum(kpis?.unique_viewers)} مستخدم فريد`} />
            </div>
        </div>
    </div>
));
InvestorKpiHero.displayName = 'InvestorKpiHero';

const BigStat = memo<{
    label: string;
    value: string;
    sub?: string;
    extra?: React.ReactNode;
    growthPct?: number;
    growthLabel?: string;
    accent: 'emerald' | 'blue' | 'amber';
}>(({ label, value, sub, extra, growthPct, growthLabel, accent }) => {
    const accentBar: Record<string, string> = {
        emerald: 'bg-emerald-400',
        blue: 'bg-blue-400',
        amber: 'bg-amber-400',
    };
    return (
        <div className="bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/10 relative overflow-hidden">
            <div className={`absolute top-0 right-0 left-0 h-1 ${accentBar[accent]}`} />
            <div className="text-xs opacity-80 font-bold mb-1">{label}</div>
            <div className="text-3xl font-extrabold tabular-nums mb-1">{value}</div>
            {sub && <div className="text-xs opacity-70">{sub}</div>}
            {extra && <div className="text-xs opacity-70 mt-1">{extra}</div>}
            {growthPct !== undefined && (
                <div className="mt-2">
                    <MomChip pct={growthPct} label={growthLabel} />
                </div>
            )}
        </div>
    );
});
BigStat.displayName = 'BigStat';

const SmallStat = memo<{
    label: string;
    value: string;
    hint?: string;
    growthPct?: number;
}>(({ label, value, hint, growthPct }) => (
    <div className="bg-white/5 backdrop-blur-md rounded-xl p-2.5 border border-white/5">
        <div className="text-[10px] opacity-70 font-bold mb-0.5">{label}</div>
        <div className="text-base font-extrabold tabular-nums">{value}</div>
        {hint && <div className="text-[10px] opacity-60 mt-0.5">{hint}</div>}
        {growthPct !== undefined && <div className="mt-1"><MomChip pct={growthPct} /></div>}
    </div>
));
SmallStat.displayName = 'SmallStat';

// ============================================================
// 2) Date lookup card — pick a specific day / month / year
// ============================================================
const DateLookupCard: React.FC = () => {
    const today = new Date();
    const [mode, setMode] = useState<LookupMode>('day');
    const [date, setDate] = useState<string>(toDateInput(today));
    const [year, setYear] = useState<number>(today.getFullYear());
    const [month, setMonth] = useState<number>(today.getMonth() + 1);
    const [loading, setLoading] = useState(false);
    const [day, setDay] = useState<any>(null);
    const [mo, setMo] = useState<any>(null);
    const [yr, setYr] = useState<any>(null);

    const run = useCallback(async () => {
        setLoading(true);
        try {
            if (mode === 'day') {
                const d = await adminService.lookupByDate(date);
                setDay(d); setMo(null); setYr(null);
            } else if (mode === 'month') {
                const m = await adminService.lookupByMonth(year, month);
                setMo(m); setDay(null); setYr(null);
            } else {
                const y = await adminService.lookupByYear(year);
                setYr(y); setDay(null); setMo(null);
            }
        } finally { setLoading(false); }
    }, [mode, date, year, month]);

    // Auto-run on mount + whenever the inputs change.
    useEffect(() => { run(); }, [run]);

    const recentYears = useMemo(() => {
        const arr: number[] = [];
        for (let y = today.getFullYear(); y >= today.getFullYear() - 4; y--) arr.push(y);
        return arr;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-start justify-between flex-wrap gap-2 mb-4">
                <div>
                    <h3 className="text-lg font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                        📅 استعلام بتاريخ مخصص
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5 font-bold">
                        اختر يوماً أو شهراً أو سنة لقراءة الأرقام بدقة
                    </p>
                </div>
            </div>

            {/* Mode tabs */}
            <div className="inline-flex bg-[var(--body-bg)] rounded-xl p-1 gap-1 mb-3">
                {([
                    { v: 'day' as LookupMode, label: '📆 يوم' },
                    { v: 'month' as LookupMode, label: '🗓️ شهر' },
                    { v: 'year' as LookupMode, label: '📅 سنة' },
                ]).map((t) => (
                    <button
                        key={t.v}
                        onClick={() => setMode(t.v)}
                        className={`px-4 py-1.5 rounded-lg text-sm font-extrabold transition-all ${
                            mode === t.v
                                ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow'
                                : 'text-[var(--text-secondary)] hover:bg-[var(--gray-100)]'
                        }`}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {/* Inputs */}
            <div className="flex flex-wrap gap-2 items-end mb-4">
                {mode === 'day' && (
                    <div>
                        <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">التاريخ</label>
                        <input
                            type="date"
                            value={date}
                            max={toDateInput(today)}
                            onChange={(e) => setDate(e.target.value)}
                            className="px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold focus:border-indigo-500 outline-none"
                        />
                    </div>
                )}
                {mode === 'month' && (
                    <>
                        <div>
                            <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">الشهر</label>
                            <select
                                value={month}
                                onChange={(e) => setMonth(Number(e.target.value))}
                                className="px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold focus:border-indigo-500 outline-none"
                            >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                    <option key={m} value={m}>
                                        {new Date(2000, m - 1, 1).toLocaleString('ar-SA', { month: 'long' })}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">السنة</label>
                            <select
                                value={year}
                                onChange={(e) => setYear(Number(e.target.value))}
                                className="px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold focus:border-indigo-500 outline-none"
                            >
                                {recentYears.map((y) => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </div>
                    </>
                )}
                {mode === 'year' && (
                    <div>
                        <label className="block text-[10px] font-bold text-[var(--text-secondary)] mb-1">السنة</label>
                        <select
                            value={year}
                            onChange={(e) => setYear(Number(e.target.value))}
                            className="px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold focus:border-indigo-500 outline-none"
                        >
                            {recentYears.map((y) => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </div>
                )}
            </div>

            {/* Results */}
            {loading && (
                <div className="space-y-2">
                    {Array.from({ length: 2 }).map((_, i) => (
                        <div key={i} className="h-20 bg-[var(--gray-100)] rounded-xl animate-pulse" />
                    ))}
                </div>
            )}

            {!loading && mode === 'day' && day && (
                <div>
                    <div className="text-xs font-bold text-[var(--text-secondary)] mb-2">
                        أرقام يوم{' '}
                        <span className="text-[var(--text-primary)] font-extrabold">
                            {new Date(day.target_date).toLocaleDateString('ar-SA')}
                        </span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <ResultCell label="مشاهدات" value={fmtNum(day.views_count)} sub={`${fmtNum(day.unique_viewers)} فريد`} tone="blue" />
                        <ResultCell label="حجوزات" value={fmtNum(day.bookings_count)} sub={`${fmtNum(day.completed_bookings)} مكتمل`} tone="emerald" />
                        <ResultCell label="GMV" value={fmtMoney(day.gmv)} sub={`وفر ${fmtMoney(day.savings_delivered)}`} tone="amber" />
                        <ResultCell label="مستخدمون نشطون" value={fmtNum(day.active_users)} sub={`+${fmtNum(day.new_buyers)} مشتري جديد`} tone="purple" />
                    </div>
                </div>
            )}

            {!loading && mode === 'month' && mo && (
                <div>
                    <div className="text-xs font-bold text-[var(--text-secondary)] mb-2">
                        أرقام شهر <span className="text-[var(--text-primary)] font-extrabold">{mo.label}</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                        <ResultCell label="مشاهدات" value={fmtNum(mo.views_count)} tone="blue" />
                        <ResultCell label="حجوزات" value={fmtNum(mo.bookings_count)} sub={`${fmtNum(mo.completed_bookings)} مكتمل`} tone="emerald" />
                        <ResultCell label="GMV" value={fmtMoney(mo.gmv)} sub={`وفر ${fmtMoney(mo.savings_delivered)}`} tone="amber" />
                        <ResultCell label="مستخدمون نشطون" value={fmtNum(mo.active_users)} sub={`+${fmtNum(mo.new_buyers)} جديد`} tone="purple" />
                    </div>
                    {Array.isArray(mo.daily_breakdown) && mo.daily_breakdown.length > 0 && (
                        <DailyMiniChart points={mo.daily_breakdown} />
                    )}
                </div>
            )}

            {!loading && mode === 'year' && yr && (
                <div>
                    <div className="text-xs font-bold text-[var(--text-secondary)] mb-2">
                        أرقام سنة <span className="text-[var(--text-primary)] font-extrabold">{yr.label}</span>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                        <ResultCell label="مشاهدات" value={fmtNum(yr.views_count)} tone="blue" />
                        <ResultCell label="حجوزات" value={fmtNum(yr.bookings_count)} sub={`${fmtNum(yr.completed_bookings)} مكتمل`} tone="emerald" />
                        <ResultCell label="GMV سنوي" value={fmtMoney(yr.gmv)} sub={`وفر ${fmtMoney(yr.savings_delivered)}`} tone="amber" />
                        <ResultCell label="مستخدمون جدد" value={fmtNum(yr.new_buyers)} sub={`+${fmtNum(yr.new_sellers)} تاجر`} tone="purple" />
                    </div>
                    {Array.isArray(yr.monthly_breakdown) && yr.monthly_breakdown.length > 0 && (
                        <MonthlyMiniChart points={yr.monthly_breakdown} />
                    )}
                </div>
            )}
        </section>
    );
};

const ResultCell = memo<{
    label: string; value: string; sub?: string; tone: 'blue' | 'emerald' | 'amber' | 'purple';
}>(({ label, value, sub, tone }) => {
    const toneCls: Record<string, string> = {
        blue: 'bg-blue-50 border-blue-200 text-blue-900',
        emerald: 'bg-emerald-50 border-emerald-200 text-emerald-900',
        amber: 'bg-amber-50 border-amber-200 text-amber-900',
        purple: 'bg-purple-50 border-purple-200 text-purple-900',
    };
    return (
        <div className={`rounded-xl p-3 border ${toneCls[tone]}`}>
            <div className="text-xs font-bold opacity-70 mb-0.5">{label}</div>
            <div className="text-xl font-extrabold tabular-nums">{value}</div>
            {sub && <div className="text-[10px] opacity-70 mt-0.5">{sub}</div>}
        </div>
    );
});
ResultCell.displayName = 'ResultCell';

// Mini daily bar chart used inside the month breakdown.
const DailyMiniChart = memo<{ points: Array<{ day: string; views: number; books: number }> }>(({ points }) => {
    const max = Math.max(...points.map((p) => Math.max(p.views, p.books)), 1);
    return (
        <div className="bg-[var(--body-bg)] rounded-xl p-3">
            <div className="text-[10px] font-bold text-[var(--text-secondary)] mb-2">تفصيل يومي</div>
            <div className="flex items-end gap-0.5 h-20">
                {points.map((p) => (
                    <Tooltip key={p.day} text={`${p.day}: ${p.views} مشاهدة / ${p.books} حجز`}>
                        <div className="flex-1 flex flex-col items-stretch gap-0.5 h-full justify-end">
                            <div className="bg-blue-400 rounded-t-sm" style={{ height: `${(p.views / max) * 100}%`, minHeight: p.views > 0 ? 1 : 0 }} />
                            <div className="bg-emerald-500 rounded-t-sm" style={{ height: `${(p.books / max) * 100}%`, minHeight: p.books > 0 ? 1 : 0 }} />
                        </div>
                    </Tooltip>
                ))}
            </div>
        </div>
    );
});
DailyMiniChart.displayName = 'DailyMiniChart';

// Monthly mini chart used inside year breakdown.
const MonthlyMiniChart = memo<{ points: Array<{ month: string; month_key: string; views: number; books: number; gmv: number }> }>(({ points }) => {
    const maxGmv = Math.max(...points.map((p) => p.gmv), 1);
    return (
        <div className="bg-[var(--body-bg)] rounded-xl p-3">
            <div className="text-[10px] font-bold text-[var(--text-secondary)] mb-2">تفصيل شهري (GMV)</div>
            <div className="flex items-end gap-1 h-24">
                {points.map((p) => (
                    <Tooltip key={p.month_key} text={`${p.month}: ${fmtMoney(p.gmv)} GMV · ${p.books} حجز`}>
                        <div className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                            <div className="w-full bg-gradient-to-t from-emerald-600 to-emerald-400 rounded-t-md"
                                 style={{ height: `${(p.gmv / maxGmv) * 100}%`, minHeight: p.gmv > 0 ? 2 : 0 }} />
                            <div className="text-[8px] text-[var(--text-secondary)] font-bold whitespace-nowrap">{p.month.split(' ')[0]}</div>
                        </div>
                    </Tooltip>
                ))}
            </div>
        </div>
    );
});
MonthlyMiniChart.displayName = 'MonthlyMiniChart';

// ============================================================
// 3) Monthly GMV chart (12 months)
// ============================================================
const GmvMonthlyChart = memo<{ data: GmvMonth[] }>(({ data }) => {
    if (!data || data.length === 0) {
        return (
            <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
                <h3 className="text-lg font-extrabold mb-3">📊 GMV الشهري (12 شهر)</h3>
                <div className="h-32 flex items-center justify-center text-[var(--gray-400)] font-bold text-sm">
                    لا توجد حجوزات بعد في هذه الفترة
                </div>
            </section>
        );
    }
    const max = Math.max(...data.map((d) => d.gmv), 1);
    const totalGmv = data.reduce((s, d) => s + d.gmv, 0);
    const totalCompleted = data.reduce((s, d) => s + d.completed_gmv, 0);
    const totalSavings = data.reduce((s, d) => s + d.savings_delivered, 0);
    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
                <h3 className="text-lg font-extrabold text-[var(--text-primary)]">📊 GMV الشهري — 12 شهر</h3>
                <div className="text-xs font-bold flex gap-3">
                    <span>إجمالي: <span className="text-emerald-700 font-extrabold tabular-nums">{fmtMoney(totalGmv)}</span></span>
                    <span>مكتمل: <span className="text-emerald-700 font-extrabold tabular-nums">{fmtMoney(totalCompleted)}</span></span>
                    <span>وفر للعملاء: <span className="text-amber-700 font-extrabold tabular-nums">{fmtMoney(totalSavings)}</span></span>
                </div>
            </div>
            <div className="flex items-end gap-1 h-36 mb-1">
                {data.map((d) => (
                    <Tooltip
                        key={d.month_key}
                        text={`${d.month_label}: GMV ${fmtMoney(d.gmv)} · مكتمل ${fmtMoney(d.completed_gmv)} · AOV ${fmtMoney(d.avg_order_value)} · ${d.bookings_count} حجز`}
                    >
                        <div className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                            <div className="w-full bg-emerald-100 rounded-t-md relative overflow-hidden" style={{ height: `${(d.gmv / max) * 100}%`, minHeight: 2 }}>
                                <div className="absolute inset-0 bg-gradient-to-t from-emerald-600 to-emerald-400"
                                     style={{ height: d.gmv > 0 ? `${(d.completed_gmv / d.gmv) * 100}%` : 0 }} />
                            </div>
                            <div className="text-[9px] text-[var(--text-secondary)] font-bold whitespace-nowrap">{d.month_label}</div>
                        </div>
                    </Tooltip>
                ))}
            </div>
            <div className="flex items-center gap-3 text-[10px] text-[var(--text-secondary)] font-bold">
                <span className="flex items-center gap-1"><span className="w-3 h-2 bg-emerald-500 rounded" /> مكتمل</span>
                <span className="flex items-center gap-1"><span className="w-3 h-2 bg-emerald-100 rounded" /> إجمالي (متضمن غير المكتمل)</span>
            </div>
        </section>
    );
});
GmvMonthlyChart.displayName = 'GmvMonthlyChart';

// ============================================================
// 4) Retention curve — D1 / D7 / D30 / D60 by cohort
// ============================================================
const RetentionCurveTable = memo<{ data: RetentionRow[] }>(({ data }) => {
    if (data.length === 0) {
        return (
            <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
                <h3 className="text-lg font-extrabold mb-3">🎯 منحنى الاستبقاء</h3>
                <div className="h-32 flex items-center justify-center text-[var(--gray-400)] font-bold text-sm">
                    سيظهر المنحنى عندما تتراكم بيانات كافية لكل cohort
                </div>
            </section>
        );
    }
    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm overflow-hidden">
            <h3 className="text-lg font-extrabold text-[var(--text-primary)] mb-1">🎯 منحنى الاستبقاء (Retention)</h3>
            <p className="text-xs text-[var(--text-secondary)] mb-3 font-bold">
                لكل شهر تسجيل، نسبة المستخدمين الذين عادوا في اليوم 1 / 7 / 30 / 60
            </p>
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="text-xs text-[var(--text-secondary)] font-bold border-b border-[var(--border-color)]">
                            <th className="text-right py-2">cohort</th>
                            <th className="text-right py-2">العدد</th>
                            <th className="text-right py-2">D1</th>
                            <th className="text-right py-2">D7</th>
                            <th className="text-right py-2">D30</th>
                            <th className="text-right py-2">D60</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((r) => (
                            <tr key={r.cohort_month} className="border-b border-[var(--border-color)]">
                                <td className="py-2 font-bold">{r.cohort_label}</td>
                                <td className="py-2 tabular-nums">{fmtNum(r.cohort_size)}</td>
                                <RetCell pct={r.d1_pct} />
                                <RetCell pct={r.d7_pct} />
                                <RetCell pct={r.d30_pct} />
                                <RetCell pct={r.d60_pct} />
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
});
RetentionCurveTable.displayName = 'RetentionCurveTable';

const RetCell = memo<{ pct: number }>(({ pct }) => {
    const v = Math.max(0, Math.min(100, pct));
    const cls = v >= 50
        ? 'bg-emerald-500 text-white'
        : v >= 25
        ? 'bg-emerald-200 text-emerald-900'
        : v >= 10
        ? 'bg-amber-200 text-amber-900'
        : 'bg-[var(--gray-100)] text-[var(--text-secondary)]';
    return (
        <td className="py-2 pl-1">
            <span className={`inline-block px-2 py-0.5 rounded text-xs font-extrabold tabular-nums ${cls}`}>
                {v}%
            </span>
        </td>
    );
});
RetCell.displayName = 'RetCell';

// ============================================================
// 5) Geographic breakdown — city × region
// ============================================================
const GeographicTable = memo<{ data: GeoRow[] }>(({ data }) => {
    if (data.length === 0) {
        return (
            <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
                <h3 className="text-lg font-extrabold mb-3">🗺️ التوزيع الجغرافي</h3>
                <div className="h-32 flex items-center justify-center text-[var(--gray-400)] font-bold text-sm">
                    لا توجد حجوزات في الفترة المختارة
                </div>
            </section>
        );
    }
    const maxGmv = Math.max(...data.map((d) => d.gmv), 1);
    const totalGmv = data.reduce((s, d) => s + d.gmv, 0);
    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <h3 className="text-lg font-extrabold text-[var(--text-primary)]">🗺️ التوزيع الجغرافي</h3>
                <ExportButton
                    rows={data}
                    columns={[
                        { header: 'المدينة',       accessor: (r: GeoRow) => r.city },
                        { header: 'المنطقة',       accessor: (r: GeoRow) => r.region },
                        { header: 'حجوزات',        accessor: (r: GeoRow) => r.bookings_count },
                        { header: 'مكتملة',        accessor: (r: GeoRow) => r.completed_bookings },
                        { header: 'GMV',           accessor: (r: GeoRow) => r.gmv },
                        { header: 'مشترون فريدون', accessor: (r: GeoRow) => r.unique_buyers },
                        { header: 'متاجر نشطة',    accessor: (r: GeoRow) => r.active_stores },
                    ]}
                    filenameStem="taki-geo-breakdown"
                    accent="blue"
                />
            </div>
            <div className="space-y-2">
                {data.map((r, i) => {
                    const pct = totalGmv > 0 ? Math.round((r.gmv / totalGmv) * 100) : 0;
                    return (
                        <div key={`${r.city}-${r.region}-${i}`} className="bg-[var(--body-bg)] rounded-xl p-3">
                            <div className="flex items-baseline justify-between mb-1">
                                <div className="flex items-baseline gap-2">
                                    <span className="font-extrabold text-sm text-[var(--text-primary)]">{r.city}</span>
                                    <span className="text-[10px] text-[var(--text-secondary)] font-bold">· {r.region}</span>
                                </div>
                                <div className="text-xs tabular-nums">
                                    <span className="font-extrabold text-emerald-700">{fmtMoney(r.gmv)}</span>
                                    <span className="text-[var(--text-secondary)] mr-1">({pct}%)</span>
                                </div>
                            </div>
                            <div className="relative h-2 bg-[var(--card-bg)] rounded-full overflow-hidden">
                                <div className="absolute inset-y-0 right-0 bg-gradient-to-l from-emerald-500 to-emerald-700 rounded-full"
                                     style={{ width: `${(r.gmv / maxGmv) * 100}%` }} />
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-[var(--text-secondary)] font-bold mt-1.5">
                                <span>📋 {fmtNum(r.bookings_count)} حجز</span>
                                <span>✅ {fmtNum(r.completed_bookings)} مكتمل</span>
                                <span>👥 {fmtNum(r.unique_buyers)} مشتري</span>
                                <span>🏪 {fmtNum(r.active_stores)} متجر</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
});
GeographicTable.displayName = 'GeographicTable';

// ============================================================
// Master container
// ============================================================
export const InvestorPack: React.FC = () => {
    const [period, setPeriod] = useState<Period>(30);
    const [kpis, setKpis] = useState<InvestorKpis | null>(null);
    const [gmv, setGmv] = useState<GmvMonth[]>([]);
    const [geo, setGeo] = useState<GeoRow[]>([]);
    const [retention, setRetention] = useState<RetentionRow[]>([]);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        const [k, g, ge, re] = await Promise.all([
            adminService.getInvestorKpis(period),
            adminService.getGmvMonthly(12),
            adminService.getGeographicBreakdown(period, 20),
            adminService.getRetentionCurve(6),
        ]);
        setKpis(k);
        setGmv(g);
        setGeo(ge);
        setRetention(re);
        setLoading(false);
    }, [period]);

    useEffect(() => { refresh(); }, [refresh]);

    // Bundle everything into a single CSV — the "Investor Pack" download.
    const downloadFullPack = useCallback(() => {
        if (!kpis) return;
        // 1) Headline KPIs
        const kpiRows: Array<{ metric: string; value: string | number }> = [
            { metric: 'فترة (أيام)', value: kpis.period_days },
            { metric: 'GMV', value: kpis.gmv },
            { metric: 'GMV مكتمل', value: kpis.gmv_completed },
            { metric: 'وفر للعملاء', value: kpis.savings_delivered },
            { metric: 'إجمالي الحجوزات', value: kpis.total_bookings },
            { metric: 'حجوزات مكتملة', value: kpis.completed_bookings },
            { metric: 'حجوزات ملغاة', value: kpis.cancelled_bookings },
            { metric: 'AOV (متوسط قيمة الحجز)', value: kpis.avg_order_value },
            { metric: 'DAU', value: kpis.dau },
            { metric: 'WAU', value: kpis.wau },
            { metric: 'MAU', value: kpis.mau },
            { metric: 'Stickiness % (DAU/MAU)', value: kpis.stickiness_pct },
            { metric: 'إجمالي المشاهدات', value: kpis.total_views },
            { metric: 'مشاهدون فريدون', value: kpis.unique_viewers },
            { metric: 'نسبة التحويل %', value: kpis.conversion_pct },
            { metric: 'نسبة العملاء المتكررين %', value: kpis.repeat_customer_rate_pct },
            { metric: 'نمو GMV الشهري % (MoM)', value: kpis.mom_gmv_growth_pct },
            { metric: 'نمو الحجوزات الشهري %', value: kpis.mom_bookings_growth_pct },
            { metric: 'نمو المستخدمين الجدد %', value: kpis.mom_new_users_growth_pct },
            { metric: 'مشترون جدد', value: kpis.new_buyers },
            { metric: 'تجار جدد', value: kpis.new_sellers },
            { metric: 'تجار نشطون فعلياً', value: kpis.net_active_merchants },
        ];
        const kpiCols: CsvColumn<{ metric: string; value: string | number }>[] = [
            { header: 'المقياس', accessor: (r) => r.metric },
            { header: 'القيمة', accessor: (r) => r.value },
        ];
        downloadCsv('taki-investor-pack-kpis', kpiRows, kpiCols);
    }, [kpis]);

    return (
        <div className="space-y-5 animate-fade-in" dir="rtl">
            <InvestorKpiHero kpis={kpis} period={period} onPeriodChange={setPeriod} />

            <div className="flex items-center justify-between gap-2 flex-wrap -mt-1">
                <p className="text-xs text-[var(--text-secondary)] font-bold">
                    💡 جميع المقاييس محتسبة بمعايير عالمية: GMV, AOV, MAU/DAU/WAU, Stickiness, Conversion, Retention, MoM Growth.
                </p>
                <div className="flex gap-2">
                    <Tooltip text="تنزيل ملف المستثمر — كل الأرقام في CSV واحد جاهز للإرسال">
                        <button
                            onClick={downloadFullPack}
                            disabled={!kpis}
                            className="px-4 h-10 bg-gradient-to-r from-slate-700 to-slate-900 hover:from-slate-800 hover:to-black text-white font-extrabold rounded-xl text-sm shadow-md disabled:opacity-50 flex items-center gap-2"
                        >
                            📥 تنزيل ملف المستثمر
                        </button>
                    </Tooltip>
                    <Tooltip text="إعادة تحميل كل الأرقام">
                        <button
                            onClick={refresh}
                            disabled={loading}
                            className="h-10 px-3 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl font-bold text-sm disabled:opacity-50"
                        >
                            🔄
                        </button>
                    </Tooltip>
                </div>
            </div>

            <DateLookupCard />

            <GmvMonthlyChart data={gmv} />

            <RetentionCurveTable data={retention} />

            <GeographicTable data={geo} />
        </div>
    );
};

export default InvestorPack;
