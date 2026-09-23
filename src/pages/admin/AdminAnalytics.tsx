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
import { adminService, TimelinePoint, ActivityRow } from '../../services/adminService';
import { ExportButton } from '../../components/admin/ExportButton';
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
    const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
    const [activity, setActivity] = useState<ActivityRow[]>([]);
    const [range, setRange] = useState<TimeRange>('24hour');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');

    // Top-lists controls — owner-chosen count + optional calendar window. (v11.46)

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

    const loadRange = useCallback(async () => {
        if (!rangeFrom || !rangeTo) return;
        setRangeLoading(true);
        const f = new Date(rangeFrom + 'T00:00:00');
        const t = new Date(rangeTo + 'T00:00:00'); t.setDate(t.getDate() + 1);
        setRangeData(await adminService.getRangeSummary(f, t));
        setRangeLoading(false);
    }, [rangeFrom, rangeTo]);

    // أوّل تحميل لسجلّ التدقيق
    useEffect(() => { refreshActivity(); }, [refreshActivity]);


    // Custom-period report re-fetches whenever the calendar changes.
    useEffect(() => { loadRange(); }, [loadRange]);

    // 🪤 v14.89 — كان النداءان (`get_live_stats` و`get_recent_activity`)
    // يتكرّران **كل ثلاث ثوانٍ** هنا، بينما «الرئيسية» تناديهما كل خمس:
    // أي ألفٌ ومئتا نداءٍ في الساعة من شاشةٍ لا تعرض رقماً لحظياً أصلاً.
    // وسجلّ تعديلات المسؤولين ليس عدّاداً حيّاً — دقيقةٌ تكفيه.
    useEffect(() => {
        const id = setInterval(() => { refreshActivity(); }, 60000);
        return () => clearInterval(id);
    }, [refreshActivity]);

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

            {/* v12.52 — دليل مبسّط (طلب ناصر: «لست خبيراً مالياً») — ماذا يعني كل رقم؟ */}
            <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-3">
                <div className="text-xs font-extrabold text-[var(--text-primary)] mb-1.5">📖 دليل سريع — كل تبويب وتخصصه (بلا مصطلحات):</div>
                <ul className="text-[11px] font-bold text-[var(--text-secondary)] space-y-1 leading-relaxed">
                    <li>📊 <b className="text-[var(--text-primary)]">التحليلات (هنا)</b>: نبض المنصة الآن — كم حجزاً وكم مستخدماً وكم ريالاً، لحظة بلحظة.</li>
                    <li>🧠 <b className="text-[var(--text-primary)]">المحلل الذكي</b>: يحلل <b>التجار والسوق</b> — من يضعف، أين الفرص، وماذا تفعل حياله.</li>
                    <li>👥 <b className="text-[var(--text-primary)]">جمهور المدن</b>: يحلل <b>المشترين</b> — كم مسجّلاً في كل منطقة ومدينة ومتى يدخلون.</li>
                </ul>
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

            {/* 🪤 v14.89 — حُذف «⚡ المؤشرات اللحظية» من هنا: كان أربع بطاقاتٍ
                تنادي نفس `get_live_stats(5)` التي تناديها «الرئيسية» وتعرض
                منها حقولاً أخرى — فبطاقة «مستخدم نشط الآن» كانت مكرّرةً
                حرفياً في شاشتين بنفس الرقم. «الآن» مكانه الرئيسية، وهذه
                الشاشة **عن فترةٍ تختارها**. */}
            <div
                style={{
                    display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
                    padding: '11px 13px', borderRadius: 'var(--adm-r-sm)',
                    background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)',
                }}
            >
                <span style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--adm-fg-2)', flex: 1, minWidth: 180 }}>
                    الأرقام اللحظية (من على المنصّة الآن) في شاشة «الرئيسية». هذه الشاشة عن فترةٍ تختارها.
                </span>
            </div>

            {/* Time Range Filter */}
            <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm space-y-3">
                <div className="text-sm font-bold text-[var(--text-primary)]">⏰ الفترة الزمنية</div>
                <div className="flex flex-wrap gap-2">
                    {(Object.keys(TIME_RANGES) as TimeRange[]).map((r) => (
                        <button
                            key={r}
                            onClick={() => setRange(r)}
                            className="adm-focusable px-4 py-2 text-sm font-bold transition-all"
                            style={range === r
                                ? { background: 'var(--adm-fg)', color: 'var(--adm-surface)', border: '1px solid transparent', borderRadius: 'var(--adm-r-sm)' }
                                : { background: 'var(--adm-surface)', color: 'var(--adm-fg-2)', border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)' }}
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

            {/* 🪤 v14.89 — حُذفت من هنا قائمتا «🏆 أعلى البائعين» و«💎 أعلى
                المشترين» ومنتقي فترتهما. السبب: لوحة «الأعلى مبيعاً»
                (TopActivityPanel) أعلى هذه الصفحة تجيب السؤال نفسه — بدالّةٍ
                أخرى (`admin_top_activity` تعدّ من جدول الحجوزات حيّاً) وبفترةٍ
                وعددٍ حرّين. أي أن الصفحة كانت تعرض **ترتيبين للتجار قد
                يتناقضان** على شاشةٍ واحدة. وتصدير CSV انتقل إلى تلك اللوحة
                فلم تُفقد قدرة. */}

            {/* 🪤 v14.89 — كان هنا «⚡ النشاط اللحظي» نفسه المعروض في
                «الرئيسية» (نفس `get_recent_activity`، ٣٠ صفّاً بدل ٢٠)
                ومعه مفتاحٌ يحوّله إلى سجلّ تعديلات الأدمن. النشاط العام
                يبقى في مكانٍ واحد (الرئيسية)، وما يبقى هنا هو **سجلّ
                التدقيق**: ما عدّله المسؤولون — وهو سؤالٌ آخر تماماً. */}
            <AdminAuditLog activity={activity} />

        </div>
    );
};

// ============================================================
// AdminAuditLog — ما عدّله المسؤولون وحدهم (v14.89)
// النشاط العام للمستخدمين معروضٌ في «الرئيسية»، فلا يُكرَّر هنا.
// ============================================================
const AdminAuditLog = memo<{
    activity: ActivityRow[];
}>(({ activity }) => {
    const filtered = useMemo(
        () => activity.filter((r) => isAdminAction(r.action)),
        [activity],
    );
    return (
        <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <h3 className="font-bold text-[var(--text-primary)] flex items-center gap-2">
                    👑 سجلّ تعديلات المسؤولين
                    <span
                        style={{
                            fontSize: '.7rem', fontWeight: 800, padding: '2px 9px', borderRadius: 999,
                            background: 'var(--adm-info-bg)', color: 'var(--adm-info-fg)',
                        }}
                    >
                        {filtered.length} عملية
                    </span>
                </h3>
                <div className="flex items-center gap-2">
                    <ExportButton
                        rows={filtered}
                        columns={ACTIVITY_CSV_COLUMNS}
                        filenameStem="taki-admin-audit"
                        label="📥 CSV"
                        accent="emerald"
                        tooltip="تنزيل سجلّ تعديلات المسؤولين كملف CSV — للأرشيف والمراجعات"
                    />
                </div>
            </div>
            <div className="divide-y divide-[var(--border-color)] max-h-96 overflow-y-auto">
                {filtered.length === 0 ? (
                    <div className="p-8 text-center text-[var(--gray-400)] text-sm font-bold">
                        لا تعديلات من المسؤولين في هذه الفترة.
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
AdminAuditLog.displayName = 'AdminAuditLog';

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
