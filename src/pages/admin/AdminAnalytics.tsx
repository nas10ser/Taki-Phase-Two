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
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">
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
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={fillPath} fill="url(#sparkGrad)" />
            <path d={path} fill="none" stroke="#7c3aed" strokeWidth="0.7" strokeLinejoin="round" />
            {data.map((d, i) => {
                const x = i * stepX;
                const y = height - (d.count / max) * (height - 30);
                return (
                    <g key={i}>
                        <circle cx={x} cy={y} r="0.8" fill="#7c3aed" />
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
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
            </span>
            LIVE
        </div>
        <div className="text-4xl font-extrabold tabular-nums mb-1">{value}</div>
        <div className="text-sm opacity-90 font-medium">{label}</div>
    </div>
));
LiveCounter.displayName = 'LiveCounter';

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

    const refreshTops = useCallback(async () => {
        const [s, b] = await Promise.all([
            adminService.getTopSellers(10),
            adminService.getTopBuyers(10),
        ]);
        setTopSellers(s);
        setTopBuyers(b);
    }, []);

    // Initial load
    useEffect(() => {
        refreshLive();
        refreshActivity();
        refreshTops();
    }, [refreshLive, refreshActivity, refreshTops]);

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
                <h1 className="text-2xl font-extrabold text-gray-900 flex items-center gap-2">
                    📊 التحليلات اللحظية
                    <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        Live
                    </span>
                </h1>
                <p className="text-sm text-gray-500 mt-0.5">
                    مراقبة لحظية لكل ما يحدث على المنصة الآن
                </p>
            </div>

            {/* Live Counters */}
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
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm space-y-3">
                <div className="text-sm font-bold text-gray-700">⏰ الفترة الزمنية</div>
                <div className="flex flex-wrap gap-2">
                    {(Object.keys(TIME_RANGES) as TimeRange[]).map((r) => (
                        <button
                            key={r}
                            onClick={() => setRange(r)}
                            className={`px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                                range === r
                                    ? 'bg-gradient-to-r from-purple-500 to-fuchsia-600 text-white shadow-md'
                                    : 'bg-gray-50 border border-gray-200 text-gray-600 hover:border-purple-300'
                            }`}
                        >
                            {TIME_RANGES[r].label}
                        </button>
                    ))}
                </div>

                {range === 'custom' && (
                    <div className="grid grid-cols-2 gap-3 pt-2">
                        <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1.5">من</label>
                            <input
                                type="datetime-local"
                                value={customFrom}
                                onChange={(e) => setCustomFrom(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1.5">إلى</label>
                            <input
                                type="datetime-local"
                                value={customTo}
                                onChange={(e) => setCustomTo(e.target.value)}
                                className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm"
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Bookings Chart */}
            <div className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-bold text-gray-800">🎟️ منحنى الحجوزات</h2>
                    <div className="text-xs text-gray-500">
                        {timeline.reduce((s, t) => s + t.count, 0)} حجز في هذه الفترة
                    </div>
                </div>
                <SparkChart data={timeline} />
            </div>

            {/* Two columns: Top Sellers + Top Buyers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                    <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                        🏆 أعلى البائعين
                    </h3>
                    {topSellers.length === 0 ? (
                        <div className="text-sm text-gray-400 text-center py-6">لا بيانات</div>
                    ) : (
                        <div className="space-y-2">
                            {topSellers.map((s, i) => (
                                <div
                                    key={s.id}
                                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50"
                                >
                                    <div
                                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                            i === 0
                                                ? 'bg-yellow-100 text-yellow-700'
                                                : i === 1
                                                ? 'bg-gray-100 text-gray-700'
                                                : i === 2
                                                ? 'bg-orange-100 text-orange-700'
                                                : 'bg-gray-50 text-gray-500'
                                        }`}
                                    >
                                        {i + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-sm truncate">{s.shop ?? s.name}</div>
                                        <div className="text-xs text-gray-500">{s.deals_count} عرض</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-bold text-emerald-600">
                                            {s.bookings_count}
                                        </div>
                                        <div className="text-[10px] text-gray-500">حجز</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                    <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                        💎 أعلى المشترين
                    </h3>
                    {topBuyers.length === 0 ? (
                        <div className="text-sm text-gray-400 text-center py-6">لا بيانات</div>
                    ) : (
                        <div className="space-y-2">
                            {topBuyers.map((b, i) => (
                                <div
                                    key={b.id}
                                    className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50"
                                >
                                    <div
                                        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                                            i === 0
                                                ? 'bg-yellow-100 text-yellow-700'
                                                : i === 1
                                                ? 'bg-gray-100 text-gray-700'
                                                : i === 2
                                                ? 'bg-orange-100 text-orange-700'
                                                : 'bg-gray-50 text-gray-500'
                                        }`}
                                    >
                                        {i + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-sm truncate">{b.name}</div>
                                        <div className="text-xs text-gray-500" dir="ltr">{b.phone}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-bold text-blue-600">
                                            {b.bookings_count}
                                        </div>
                                        <div className="text-[10px] text-gray-500">حجز</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Activity Feed */}
            <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                <h3 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
                    ⚡ النشاط اللحظي
                    <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full">
                        Live
                    </span>
                </h3>
                <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
                    {activity.length === 0 ? (
                        <div className="p-8 text-center text-gray-400 text-sm">
                            في انتظار النشاطات...
                        </div>
                    ) : (
                        activity.map((row) => (
                            <div key={row.id} className="flex gap-3 p-3 text-sm">
                                <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center flex-shrink-0 text-base">
                                    {actionIcon(row.action)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-gray-800 truncate">
                                        {row.user_name ?? 'زائر'}
                                        <span className="font-normal text-gray-500 ml-1">
                                            {' '}
                                            {actionLabel(row.action)}
                                        </span>
                                    </div>
                                </div>
                                <div className="text-xs text-gray-400 self-center tabular-nums whitespace-nowrap">
                                    {timeAgo(row.created_at)}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
};

function actionIcon(a: string): string {
    const map: Record<string, string> = {
        login: '🔓', register: '✨', book: '🎟️', cancel_booking: '❌',
        view_deal: '👀', add_deal: '➕', edit_deal: '✏️', delete_deal: '🗑️',
        follow: '⭐', rate: '💬', admin_apply_subscription: '👑',
    };
    return map[a] ?? '•';
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
        admin_apply_subscription: 'طبّق اشتراكاً',
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
