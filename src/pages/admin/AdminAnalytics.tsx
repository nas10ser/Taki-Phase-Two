/**
 * AdminAnalytics — التحليلات اللحظية المتقدمة
 *
 * الميزات:
 *  - عداد لحظي للمستخدمين النشطين الآن (من user_sessions)
 *  - فلاتر زمنية: 5 دقائق / ساعة / 24 ساعة / 7 أيام / 30 يوم / مخصص
 *  - فلتر تاريخ مخصص (من / إلى)
 *  - رسم بياني للحجوزات بالساعة/الدقيقة/اليوم
 *  - أعلى 10 بائعين، أعلى 10 مشترين
 *  - معدل التحويل (مشاهدات → حجوزات)
 *  - تغذية لحظية لما يفعله المستخدمون الآن
 */

import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { adminService, LiveStats, TimelinePoint, ActivityRow } from '../../services/adminService';
import { ExportButton } from '../../components/admin/ExportButton';
import { Tooltip } from '../../components/admin/Tooltip';
import { CsvColumn } from '../../utils/csvExport';
import { AdvancedAnalytics } from '../../components/admin/AdvancedAnalytics';
import { InvestorPack } from '../../components/admin/InvestorPack';
import { BotAnalytics } from '../../components/admin/BotAnalytics';
import { AuthenticityPanel } from '../../components/admin/AuthenticityPanel';
import { TopActivityPanel } from '../../components/admin/TopActivityPanel';
import { ReferralPanel } from '../../components/admin/ReferralPanel';
import { FirstMembersPanel } from '../../components/admin/FirstMembersPanel';

type TimeRange = '5min' | '1hour' | '24hour' | '7day' | '30day' | 'custom';

const TIME_RANGES: Record<TimeRange, { label: string; minutes: number; bucket: 'minute' | 'hour' | 'day' }> = {
    '5min':   { label: '5 دقائق',   minutes: 5,           bucket: 'minute' },
    '1hour':  { label: 'ساعة',      minutes: 60,          bucket: 'minute' },
    '24hour': { label: '24 ساعة',   minutes: 60 * 24,     bucket: 'hour' },
    '7day':   { label: '7 أيام',    minutes: 60 * 24 * 7, bucket: 'day' },
    '30day':  { label: '30 يوم',    minutes: 60 * 24 * 30,bucket: 'day' },
    'custom': { label: 'مخصص',      minutes: 60 * 24,     bucket: 'hour' },
};

// ============================================================
// SVG Sparkline Chart — خفيف جداً، لا يحتاج مكتبة
// ============================================================
const SparkChart = memo<{
    data: TimelinePoint[];
    height?: number;
}>(({ data, height = 220 }) => {
    if (!data || data.length === 0) {
        return (
            <div className="h-56 flex items-center justify-center text-[var(--gray-400)] text-sm">
                لا توجد بيانات في هذه الفترة
            </div>
        );
    }

    const max = Math.max(...data.map((d) => d.count), 1);
    const width = 100; // viewBox %
    const stepX = data.length > 1 ? width / (data.length - 1) : 0;

    const points = data.map((d, i) => {
        const x = i * stepX;
        const y = height - (d.count / max) * (height - 30);
        return `${x},${y}`;
    });

    const path = `M ${points[0]} L ${points.slice(1).join(' L ')}`;
    const fillPath = `${path} L ${(data.length - 1) * stepX},${height} L 0,${height} Z`;

    return (
        <svg
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            className="w-full h-56"
        >
            <defs>
                <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style={{ stopColor: 'var(--chart-violet)', stopOpacity: 0.38 }} />
                    <stop offset="100%" style={{ stopColor: 'var(--chart-violet)', stopOpacity: 0 }} />
                </linearGradient>
            </defs>
            <path d={fillPath} fill="url(#sparkGrad)" />
            <path d={path} fill="none" strokeWidth="0.7" strokeLinejoin="round" style={{ stroke: 'var(--chart-violet)' }} />
            {data.map((d, i) => {
                const x = i * stepX;
                const y = height - (d.count / max) * (height - 30);
                return (
                    <g key={i}>
                        <circle cx={x} cy={y} r="0.8" style={{ fill: 'var(--chart-violet)' }} />
                    </g>
                );
            })}
        </svg>
    );
});
SparkChart.displayName = 'SparkChart';

// ============================================================
// Live Counter (مع animation)
// ============================================================
const LiveCounter = memo<{ value: number; label: string; gradient: string }>(({ value, label, gradient }) => (
    <div
        className={`relative overflow-hidden rounded-2xl p-5 text-white shadow-lg ${gradient}`}
    >
        <div className="absolute top-2 right-2 flex items-center gap-1.5 text-[10px] font-bold bg-white/20 backdrop-blur-sm px-2 py-1 rounded-full">
            <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--card-bg)] opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--card-bg)]"></span>
            </span>
            LIVE
        </div>
        <div className="text-4xl font-extrabold tabular-nums mb-1">{value}</div>
        <div className="text-sm opacity-90 font-medium">{label}</div>
    </div>
));
LiveCounter.displayName = 'LiveCounter';

// Activity is an admin action when its name starts with `admin_`. That's
// the convention the DB triggers + RPCs use when logging actions taken
// from this panel.
const isAdminAction = (a: string) => typeof a === 'string' && a.startsWith('admin_');

const ACTIVITY_CSV_COLUMNS: CsvColumn<ActivityRow>[] = [
    { header: 'الوقت',         accessor: (r) => r.created_at },
    { header: 'المستخدم',      accessor: (r) => r.user_name ?? '' },
    { header: 'نوع الحساب',    accessor: (r) => r.user_type ?? '' },
    { header: 'الإجراء',       accessor: (r) => r.action },
    { header: 'النوع',         accessor: (r) => r.entity_type ?? '' },
    { header: 'معرّف العنصر',  accessor: (r) => r.entity_id ?? '' },
    { header: 'بيانات إضافية', accessor: (r) => r.metadata ? JSON.stringify(r.metadata) : '' },
];

const TOP_PERF_CSV_COLUMNS: CsvColumn<any>[] = [
    { header: 'الترتيب',       accessor: (_r: any) => '' }, // filled by caller
    { header: 'الاسم',         accessor: (r: any) => r.shop ?? r.name ?? '' },
    { header: 'الجوال',        accessor: (r: any) => r.phone ?? '' },
    { header: 'عدد الحجوزات',  accessor: (r: any) => r.bookings_count ?? 0 },
    { header: 'عدد العروض',    accessor: (r: any) => r.deals_count ?? '' },
    { header: 'المعرّف',        accessor: (r: any) => r.id },
];

// Local calendar date → YYYY-MM-DD (offset-safe so the picker shows the day
// the admin actually sees, not a UTC-shifted one).
const isoDate = (d: Date) => {
    const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
};

interface RangeSummary {
    new_buyers: number; new_sellers: number; new_users: number;
    bookings: number; completed_bookings: number; cancelled_bookings: number;
    gmv: number; new_subscriptions: number;
}

const RANGE_CSV_COLUMNS: CsvColumn<any>[] = [
    { header: 'الفترة',          accessor: (r) => r.period ?? '' },
    { header: 'مشترون جدد',      accessor: (r) => r.new_buyers ?? 0 },
    { header: 'بائعون جدد',      accessor: (r) => r.new_sellers ?? 0 },
    { header: 'مستخدمون جدد',    accessor: (r) => r.new_users ?? 0 },
    { header: 'حجوزات',          accessor: (r) => r.bookings ?? 0 },
    { header: 'حجوزات مكتملة',   accessor: (r) => r.completed_bookings ?? 0 },
    { header: 'حجوزات ملغاة',    accessor: (r) => r.cancelled_bookings ?? 0 },
    { header: 'إجمالي المبيعات', accessor: (r) => r.gmv ?? 0 },
    { header: 'اشتراكات جديدة',  accessor: (r) => r.new_subscriptions ?? 0 },
];

const StatBox: React.FC<{ label: string; value: number | string }> = ({ label, value }) => (
    <div className="bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl p-3 text-center">
        <div className="text-xl font-extrabold text-[var(--text-primary)] tabular-nums">{value}</div>
        <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{label}</div>
    </div>
);

const RangePreset: React.FC<{ label: string; onClick: () => void }> = ({ label, onClick }) => (
    <button onClick={onClick} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-purple-300 transition-colors">
        {label}
    </button>
);

// ============================================================
// Main Component
// ============================================================
const AdminAnalytics: React.FC = () => {
    const [stats, setStats] = useState<LiveStats | null>(null);
    const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
    const [activity, setActivity] = useState<ActivityRow[]>([]);
    const [topSellers, setTopSellers] = useState<any[]>([]);
    const [topBuyers, setTopBuyers] = useState<any[]>([]);
    const [range, setRange] = useState<TimeRange>('24hour');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const [auditOnly, setAuditOnly] = useState(false);

    // Top-lists controls — owner-chosen count + optional calendar window. (v11.46)
    const [topLimit, setTopLimit] = useState(10);
    const [topMode, setTopMode] = useState<'all' | 'day' | 'range'>('all');
    const [topDay, setTopDay] = useState('');
    const [topFrom, setTopFrom] = useState('');
    const [topTo, setTopTo] = useState('');

    // Custom-period summary report (calendar from → to).
    const [rangeFrom, setRangeFrom] = useState(() => isoDate(new Date(Date.now() - 29 * 864e5)));
    const [rangeTo, setRangeTo] = useState(() => isoDate(new Date()));
    const [rangeData, setRangeData] = useState<RangeSummary | null>(null);
    const [rangeLoading, setRangeLoading] = useState(false);

    // Compute timeline range
    const { from, to, bucket } = useMemo(() => {
        if (range === 'custom' && customFrom && customTo) {
            return {
                from: new Date(customFrom),
                to: new Date(customTo),
                bucket: 'hour' as const,
            };
        }
        const cfg = TIME_RANGES[range];
        return {
            from: new Date(Date.now() - cfg.minutes * 60 * 1000),
            to: new Date(),
            bucket: cfg.bucket,
        };
    }, [range, customFrom, customTo]);

    const refreshLive = useCallback(async () => {
        const s = await adminService.getLiveStats(5, false);
        if (s) setStats(s);
    }, []);

    const refreshTimeline = useCallback(async () => {
        const data = await adminService.getBookingsTimeline(from, to, bucket);
        setTimeline(data);
    }, [from, to, bucket]);

    const refreshActivity = useCallback(async () => {
        const a = await adminService.getRecentActivity(30);
        setActivity(a);
    }, []);

    // [from, to) booking window for the top lists, derived from the calendar
    // controls. null = all-time (matches the previous behaviour).
    const topWindow = useMemo<{ from: Date | null; to: Date | null }>(() => {
        if (topMode === 'day' && topDay) {
            const f = new Date(topDay + 'T00:00:00');
            const t = new Date(f); t.setDate(t.getDate() + 1);
            return { from: f, to: t };
        }
        if (topMode === 'range' && topFrom && topTo) {
            const f = new Date(topFrom + 'T00:00:00');
            const t = new Date(topTo + 'T00:00:00'); t.setDate(t.getDate() + 1);
            return { from: f, to: t };
        }
        return { from: null, to: null };
    }, [topMode, topDay, topFrom, topTo]);

    const refreshTops = useCallback(async () => {
        const [s, b] = await Promise.all([
            adminService.getTopSellers(topLimit, topWindow.from, topWindow.to),
            adminService.getTopBuyers(topLimit, topWindow.from, topWindow.to),
        ]);
        setTopSellers(s);
        setTopBuyers(b);
    }, [topLimit, topWindow]);

    const loadRange = useCallback(async () => {
        if (!rangeFrom || !rangeTo) return;
        setRangeLoading(true);
        const f = new Date(rangeFrom + 'T00:00:00');
        const t = new Date(rangeTo + 'T00:00:00'); t.setDate(t.getDate() + 1);
        setRangeData(await adminService.getRangeSummary(f, t));
        setRangeLoading(false);
    }, [rangeFrom, rangeTo]);

    // Initial load (live + activity)
    useEffect(() => {
        refreshLive();
        refreshActivity();
    }, [refreshLive, refreshActivity]);

    // Top lists re-fetch whenever the count or calendar window changes.
    useEffect(() => { refreshTops(); }, [refreshTops]);

    // Custom-period report re-fetches whenever the calendar changes.
    useEffect(() => { loadRange(); }, [loadRange]);

    // Live polling (3 ثوانٍ)
    useEffect(() => {
        const id = setInterval(() => {
            refreshLive();
            refreshActivity();
        }, 3000);
        return () => clearInterval(id);
    }, [refreshLive, refreshActivity]);

    // Timeline updates when range changes
    useEffect(() => {
        refreshTimeline();
    }, [refreshTimeline]);

    return (
        <div className="space-y-5 animate-fade-in" dir="rtl">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                    📊 التحليلات اللحظية
                    <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        Live
                    </span>
                </h1>
                <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                    مراقبة لحظية لكل ما يحدث على المنصة الآن
                </p>
            </div>

            {/* Investor Pack — the headline metrics every VC asks for in the
                first call (GMV, AOV, MAU, stickiness, conversion %, MoM growth,
                retention curve, geographic spread). Sits at the very top because
                this is what Nasser uses to *raise money* — everything else is
                operational detail behind it. */}
            <InvestorPack />

            {/* World-class advanced analytics (v10.98). Lives below the investor
                pack — operational metrics for running the platform day-to-day:
                funnel, heatmap, churn, lifecycle, browse-no-book, etc. */}
            <div className="border-t-2 border-dashed border-[var(--border-color)] pt-6 mt-6">
                <AdvancedAnalytics />
            </div>

            {/* Bot analytics — links the admin center to the Telegram + WhatsApp
                bots: adoption + true channel attribution of bookings/deals. (v12.00) */}
            <div className="border-t-2 border-dashed border-[var(--border-color)] pt-6 mt-6">
                <BotAnalytics />
            </div>

            {/* Authenticity — النسبة العامة حقيقي/شكلي بتواريخ مرنة + ترتيب حر (v12.30) */}
            <div className="border-t-2 border-dashed border-[var(--border-color)] pt-6 mt-6">
                <AuthenticityPanel />
            </div>

            {/* الأعلى مبيعاً — متاجر/مشترون بأي عدد وأي فترة (v12.30) */}
            <div className="border-t-2 border-dashed border-[var(--border-color)] pt-6 mt-6">
                <TopActivityPanel />
            </div>

            {/* الإحالات — «من أين سمعت عنا» + أعلى المتاجر في روابط الدعوة (v12.30) */}
            <div className="border-t-2 border-dashed border-[var(--border-color)] pt-6 mt-6">
                <ReferralPanel />
            </div>

            {/* أوائل المشتركين — أول N بالتاريخ والوقت بالثانية + فترة محددة (v12.31) */}
            <div className="border-t-2 border-dashed border-[var(--border-color)] pt-6 mt-6">
                <FirstMembersPanel />
            </div>

            {/* Live Counters */}
            <div className="border-t border-[var(--border-color)] pt-5">
                <h2 className="text-xl font-extrabold text-[var(--text-primary)] mb-3">⚡ المؤشرات اللحظية</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <LiveCounter
                    value={stats?.active_users ?? 0}
                    label="مستخدم نشط الآن"
                    gradient="bg-gradient-to-br from-emerald-500 to-green-600"
                />
                <LiveCounter
                    value={stats?.active_buyers ?? 0}
                    label="مشتري متصل"
                    gradient="bg-gradient-to-br from-blue-500 to-indigo-600"
                />
                <LiveCounter
                    value={stats?.active_sellers ?? 0}
                    label="بائع متصل"
                    gradient="bg-gradient-to-br from-purple-500 to-fuchsia-600"
                />
                <LiveCounter
                    value={stats?.bookings_5min ?? 0}
                    label="حجز في آخر 5 دقائق"
                    gradient="bg-gradient-to-br from-amber-500 to-orange-600"
                />
            </div>

            {/* Time Range Filter */}
            <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm space-y-3">
                <div className="text-sm font-bold text-[var(--text-primary)]">⏰ الفترة الزمنية</div>
                <div className="flex flex-wrap gap-2">
                    {(Object.keys(TIME_RANGES) as TimeRange[]).map((r) => (
                        <button
                            key={r}
                            onClick={() => setRange(r)}
                            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                                range === r
                                    ? 'bg-gradient-to-r from-purple-500 to-fuchsia-600 text-white shadow-md'
                                    : 'bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-purple-300'
                            }`}
                        >
                            {TIME_RANGES[r].label}
                        </button>
                    ))}
                </div>

                {range === 'custom' && (
                    <div className="grid grid-cols-2 gap-3 pt-2">
                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">من</label>
                            <input
                                type="datetime-local"
                                value={customFrom}
                                onChange={(e) => setCustomFrom(e.target.value)}
                                className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">إلى</label>
                            <input
                                type="datetime-local"
                                value={customTo}
                                onChange={(e) => setCustomTo(e.target.value)}
                                className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Bookings Chart */}
            <div className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">🎟️ منحنى الحجوزات</h2>
                    <div className="text-xs text-[var(--text-secondary)]">
                        {timeline.reduce((s, t) => s + t.count, 0)} حجز في هذه الفترة
                    </div>
                </div>
                <SparkChart data={timeline} />
            </div>

            {/* Custom-period report — pick any two calendar dates and read the
                exact counts for that window (also exportable as CSV). v11.46 */}
            <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">🗓️ تقرير فترة مخصّصة</h2>
                    <ExportButton
                        rows={rangeData ? [{ ...rangeData, period: `${rangeFrom} → ${rangeTo}` }] : []}
                        columns={RANGE_CSV_COLUMNS}
                        filenameStem={`taki-report-${rangeFrom}_${rangeTo}`}
                        label="تصدير التقرير"
                        accent="purple"
                        tooltip="تنزيل أرقام هذه الفترة كملف CSV"
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">من تاريخ</label>
                        <input type="date" value={rangeFrom} max={rangeTo} onChange={(e) => setRangeFrom(e.target.value)} className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)]" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">إلى تاريخ</label>
                        <input type="date" value={rangeTo} min={rangeFrom} max={isoDate(new Date())} onChange={(e) => setRangeTo(e.target.value)} className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)]" />
                    </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    <RangePreset label="اليوم" onClick={() => { const t = isoDate(new Date()); setRangeFrom(t); setRangeTo(t); }} />
                    <RangePreset label="أمس" onClick={() => { const y = isoDate(new Date(Date.now() - 864e5)); setRangeFrom(y); setRangeTo(y); }} />
                    <RangePreset label="آخر 7 أيام" onClick={() => { setRangeFrom(isoDate(new Date(Date.now() - 6 * 864e5))); setRangeTo(isoDate(new Date())); }} />
                    <RangePreset label="آخر 30 يوم" onClick={() => { setRangeFrom(isoDate(new Date(Date.now() - 29 * 864e5))); setRangeTo(isoDate(new Date())); }} />
                    <RangePreset label="هذا الشهر" onClick={() => { const n = new Date(); setRangeFrom(isoDate(new Date(n.getFullYear(), n.getMonth(), 1))); setRangeTo(isoDate(n)); }} />
                </div>
                {rangeLoading ? (
                    <div className="h-24 bg-[var(--gray-100)] rounded-xl animate-pulse" />
                ) : rangeData ? (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <StatBox label="مشترون جدد" value={rangeData.new_buyers} />
                        <StatBox label="بائعون جدد" value={rangeData.new_sellers} />
                        <StatBox label="مستخدمون جدد" value={rangeData.new_users} />
                        <StatBox label="اشتراكات جديدة" value={rangeData.new_subscriptions} />
                        <StatBox label="حجوزات" value={rangeData.bookings} />
                        <StatBox label="حجوزات مكتملة" value={rangeData.completed_bookings} />
                        <StatBox label="حجوزات ملغاة" value={rangeData.cancelled_bookings} />
                        <StatBox label="إجمالي المبيعات" value={`${Math.round(Number(rangeData.gmv) || 0).toLocaleString('en-US')} ر.س`} />
                    </div>
                ) : (
                    <div className="text-sm text-[var(--gray-400)] text-center py-4">اختر فترة لعرض الأرقام</div>
                )}
            </div>

            {/* Top-lists controls — owner-chosen count + optional calendar window */}
            <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm space-y-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">🏆 أعلى القوائم</h2>
                    <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[var(--text-secondary)]">كم عدد تريد؟</span>
                        <input type="number" min={1} max={500} value={topLimit} onChange={(e) => setTopLimit(Math.min(500, Math.max(1, Number(e.target.value) || 1)))} className="w-20 px-2 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-lg text-center font-bold text-[var(--text-primary)] outline-none" />
                    </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {([['all', 'كل الفترات'], ['day', 'يوم محدّد'], ['range', 'من–إلى']] as const).map(([m, label]) => (
                        <button key={m} onClick={() => setTopMode(m)} className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${topMode === m ? 'bg-gradient-to-r from-purple-500 to-fuchsia-600 text-white shadow' : 'bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-secondary)]'}`}>{label}</button>
                    ))}
                </div>
                {topMode === 'day' && (
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">اليوم</label>
                        <input type="date" value={topDay} max={isoDate(new Date())} onChange={(e) => setTopDay(e.target.value)} className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)]" />
                    </div>
                )}
                {topMode === 'range' && (
                    <div className="grid grid-cols-2 gap-3">
                        <div><label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">من</label><input type="date" value={topFrom} max={topTo || isoDate(new Date())} onChange={(e) => setTopFrom(e.target.value)} className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)]" /></div>
                        <div><label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">إلى</label><input type="date" value={topTo} min={topFrom} max={isoDate(new Date())} onChange={(e) => setTopTo(e.target.value)} className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)]" /></div>
                    </div>
                )}
                <div className="text-[11px] text-[var(--text-secondary)]">
                    {topMode === 'all' ? 'يشمل كل الفترات' : topMode === 'day' ? (topDay ? `ليوم ${topDay}` : 'اختر يوماً') : (topFrom && topTo ? `من ${topFrom} إلى ${topTo}` : 'اختر بداية ونهاية')}
                    {` · يعرض ${topLimit} لكل قائمة`}
                </div>
            </div>

            {/* Two columns: Top Sellers + Top Buyers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm">
                    <h3 className="font-bold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                        🏆 أعلى البائعين
                    </h3>
                    {topSellers.length === 0 ? (
                        <div className="text-sm text-[var(--gray-400)] text-center py-6">لا بيانات</div>
                    ) : (
                        <div className="space-y-2">
                            {topSellers.map((s, i) => (
                                <div
                                    key={s.id}
                                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-[var(--body-bg)]"
                                >
                                    <div
                                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                            i === 0
                                                ? 'bg-yellow-100 text-yellow-700'
                                                : i === 1
                                                ? 'bg-[var(--gray-100)] text-[var(--text-primary)]'
                                                : i === 2
                                                ? 'bg-orange-100 text-orange-700'
                                                : 'bg-[var(--body-bg)] text-[var(--text-secondary)]'
                                        }`}
                                    >
                                        {i + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-sm truncate">{s.shop ?? s.name}</div>
                                        <div className="text-xs text-[var(--text-secondary)]">{s.deals_count} عرض</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-bold text-emerald-600">
                                            {s.bookings_count}
                                        </div>
                                        <div className="text-[10px] text-[var(--text-secondary)]">حجز</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm">
                    <h3 className="font-bold text-[var(--text-primary)] mb-3 flex items-center gap-2">
                        💎 أعلى المشترين
                    </h3>
                    {topBuyers.length === 0 ? (
                        <div className="text-sm text-[var(--gray-400)] text-center py-6">لا بيانات</div>
                    ) : (
                        <div className="space-y-2">
                            {topBuyers.map((b, i) => (
                                <div
                                    key={b.id}
                                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-[var(--body-bg)]"
                                >
                                    <div
                                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                            i === 0
                                                ? 'bg-yellow-100 text-yellow-700'
                                                : i === 1
                                                ? 'bg-[var(--gray-100)] text-[var(--text-primary)]'
                                                : i === 2
                                                ? 'bg-orange-100 text-orange-700'
                                                : 'bg-[var(--body-bg)] text-[var(--text-secondary)]'
                                        }`}
                                    >
                                        {i + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-sm truncate">{b.name}</div>
                                        <div className="text-xs text-[var(--text-secondary)]" dir="ltr">{b.phone}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-bold text-blue-600">
                                            {b.bookings_count}
                                        </div>
                                        <div className="text-[10px] text-[var(--text-secondary)]">حجز</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Activity Feed + Audit Log toggle */}
            <ActivityFeed
                activity={activity}
                auditOnly={auditOnly}
                onToggleAuditOnly={() => setAuditOnly((v) => !v)}
            />

            {/* Top performers — exportable */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 -mt-2">
                <ExportButton
                    rows={topSellers.map((s: any, i: number) => ({ ...s, rank: i + 1 }))}
                    columns={[
                        { header: 'الترتيب',       accessor: (r: any) => r.rank },
                        { header: 'اسم المتجر',    accessor: (r: any) => r.shop ?? r.name ?? '' },
                        { header: 'الجوال',        accessor: (r: any) => r.phone ?? '' },
                        { header: 'عدد العروض',    accessor: (r: any) => r.deals_count ?? 0 },
                        { header: 'عدد الحجوزات',  accessor: (r: any) => r.bookings_count ?? 0 },
                        { header: 'المعرّف',        accessor: (r: any) => r.id },
                    ]}
                    filenameStem="taki-top-sellers"
                    label="🏆 تصدير أعلى البائعين"
                    accent="purple"
                    tooltip={`تنزيل القائمة الظاهرة (${topSellers.length}) كـCSV — حسب العدد والفترة المختارة`}
                />
                <ExportButton
                    rows={topBuyers.map((b: any, i: number) => ({ ...b, rank: i + 1 }))}
                    columns={[
                        { header: 'الترتيب',       accessor: (r: any) => r.rank },
                        { header: 'الاسم',         accessor: (r: any) => r.name ?? '' },
                        { header: 'الجوال',        accessor: (r: any) => r.phone ?? '' },
                        { header: 'عدد الحجوزات',  accessor: (r: any) => r.bookings_count ?? 0 },
                        { header: 'المعرّف',        accessor: (r: any) => r.id },
                    ]}
                    filenameStem="taki-top-buyers"
                    label="💎 تصدير أعلى المشترين"
                    accent="blue"
                    tooltip={`تنزيل القائمة الظاهرة (${topBuyers.length}) كـCSV — حسب العدد والفترة المختارة`}
                />
            </div>
        </div>
    );
};

// ============================================================
// ActivityFeed — shows all activity OR admin-only "audit log"
// ============================================================
const ActivityFeed = memo<{
    activity: ActivityRow[];
    auditOnly: boolean;
    onToggleAuditOnly: () => void;
}>(({ activity, auditOnly, onToggleAuditOnly }) => {
    const filtered = useMemo(
        () => (auditOnly ? activity.filter((r) => isAdminAction(r.action)) : activity),
        [activity, auditOnly],
    );
    return (
        <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <h3 className="font-bold text-[var(--text-primary)] flex items-center gap-2">
                    {auditOnly ? '👑 سجل تعديلات الأدمن' : '⚡ النشاط اللحظي'}
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        auditOnly ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                        {auditOnly ? `${filtered.length} عملية` : 'Live'}
                    </span>
                </h3>
                <div className="flex items-center gap-2">
                    <Tooltip text={auditOnly ? 'اعرض كل نشاطات المستخدمين' : 'اعرض فقط ما عدّله الأدمن (اشتراكات، حسابات، إعدادات)'}>
                        <button
                            onClick={onToggleAuditOnly}
                            className={`px-3 h-9 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 ${
                                auditOnly
                                    ? 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow'
                                    : 'bg-[var(--gray-100)] text-[var(--text-secondary)] hover:bg-[var(--gray-200)]'
                            }`}
                        >
                            {auditOnly ? '✓ أدمن فقط' : '👑 تعديلات الأدمن فقط'}
                        </button>
                    </Tooltip>
                    <ExportButton
                        rows={filtered}
                        columns={ACTIVITY_CSV_COLUMNS}
                        filenameStem={auditOnly ? 'taki-admin-audit' : 'taki-activity'}
                        label="📥 CSV"
                        accent="emerald"
                        tooltip={auditOnly
                            ? 'تنزيل سجل تعديلات الأدمن كملف CSV — مفيد للأرشيف والمراجعات'
                            : 'تنزيل سجل النشاط الكامل كملف CSV'}
                    />
                </div>
            </div>
            <div className="divide-y divide-[var(--border-color)] max-h-96 overflow-y-auto">
                {filtered.length === 0 ? (
                    <div className="p-8 text-center text-[var(--gray-400)] text-sm font-bold">
                        {auditOnly
                            ? 'لا توجد تعديلات أدمن في الفترة الحالية'
                            : 'في انتظار النشاطات...'}
                    </div>
                ) : (
                    filtered.map((row) => (
                        <div key={row.id} className="flex gap-3 p-3 text-sm">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-base ${
                                isAdminAction(row.action) ? 'bg-indigo-50' : 'bg-purple-50'
                            }`}>
                                {actionIcon(row.action)}
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-[var(--text-primary)] truncate">
                                    {row.user_name ?? 'زائر'}
                                    <span className="font-normal text-[var(--text-secondary)] ml-1">
                                        {' '}
                                        {actionLabel(row.action)}
                                    </span>
                                </div>
                                {row.entity_id && (
                                    <div className="text-[10px] text-[var(--gray-400)] truncate mt-0.5" dir="ltr">
                                        {row.entity_type} · {row.entity_id.slice(0, 24)}
                                    </div>
                                )}
                            </div>
                            <div className="text-xs text-[var(--gray-400)] self-center tabular-nums whitespace-nowrap">
                                {timeAgo(row.created_at)}
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
});
ActivityFeed.displayName = 'ActivityFeed';

function actionIcon(a: string): string {
    const map: Record<string, string> = {
        login: '🔓', register: '✨', book: '🎟️', cancel_booking: '❌',
        view_deal: '👀', add_deal: '➕', edit_deal: '✏️', delete_deal: '🗑️',
        follow: '⭐', rate: '💬',
        // Admin actions — distinct icons to make audit log scannable.
        admin_apply_subscription: '👑',
        admin_update_user: '🛠️',
        admin_soft_delete_user: '🗑️',
        admin_set_report_status: '🚩',
        admin_set_complaint_status: '📣',
        admin_set_platform_setting: '⚙️',
        admin_bulk_subscription: '⚡',
    };
    return map[a] ?? (a.startsWith('admin_') ? '👑' : '•');
}
function actionLabel(a: string): string {
    const map: Record<string, string> = {
        login: 'سجّل دخول',
        register: 'سجّل حساب جديد',
        book: 'حجز عرضاً',
        cancel_booking: 'ألغى حجزاً',
        view_deal: 'شاهد عرض',
        add_deal: 'أضاف عرضاً',
        edit_deal: 'عدّل عرضاً',
        delete_deal: 'حذف عرضاً',
        follow: 'تابع متجراً',
        rate: 'قيّم عرضاً',
        // Admin labels — used by the audit log view.
        admin_apply_subscription: 'طبّق اشتراكاً',
        admin_update_user: 'عدّل بيانات مستخدم',
        admin_soft_delete_user: 'حذف مستخدم',
        admin_set_report_status: 'غيّر حالة بلاغ',
        admin_set_complaint_status: 'غيّر حالة شكوى',
        admin_set_platform_setting: 'عدّل إعداد منصة',
        admin_bulk_subscription: 'طبّق اشتراكاً جماعياً',
    };
    return map[a] ?? a;
}
function timeAgo(iso: string): string {
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return `${sec}ث`;
    if (sec < 3600) return `${Math.floor(sec / 60)}د`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}س`;
    return `${Math.floor(sec / 86400)}ي`;
}

export default memo(AdminAnalytics);
