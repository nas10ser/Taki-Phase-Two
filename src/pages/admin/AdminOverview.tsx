/**
 * AdminOverview — الصفحة الرئيسية للأدمن
 *
 * تحتوي على:
 *  - ترحيب + معلومات الأدمن
 *  - 3 أزرار كبيرة: المشترون | البائعون | أدوات الإدارة
 *  - بطاقات KPI لحظية (مستخدمين نشطين، حجوزات اليوم، MRR، إلخ)
 *  - Activity feed لحظي
 */

import React, { useEffect, useState, useCallback, memo } from 'react';
import { useHistory } from 'react-router-dom';
import { adminService, LiveStats, ActivityRow } from '../../services/adminService';
import { useApp } from '../../context/AppContext';

// ============================================================
// KPI Card — مكوّن صغير معاد استخدامه
// ============================================================
const KpiCard = memo<{
    icon: string;
    label: string;
    value: string | number;
    subtitle?: string;
    gradient: string;
    pulse?: boolean;
}>(({ icon, label, value, subtitle, gradient, pulse }) => (
    <div
        className={`relative overflow-hidden rounded-2xl p-5 text-white shadow-lg transition-all hover:shadow-xl hover:-translate-y-0.5 ${gradient}`}
    >
        {pulse && (
            <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
            </span>
        )}
        <div className="text-3xl mb-2 opacity-90">{icon}</div>
        <div className="text-3xl font-extrabold tabular-nums">{value}</div>
        <div className="text-sm opacity-90 mt-1 font-medium">{label}</div>
        {subtitle && <div className="text-xs opacity-70 mt-0.5">{subtitle}</div>}
    </div>
));
KpiCard.displayName = 'KpiCard';

// ============================================================
// Big Section Button — الأزرار الكبيرة الـ 3
// ============================================================
const SectionButton = memo<{
    icon: string;
    title: string;
    subtitle: string;
    count?: number | string;
    gradient: string;
    onClick: () => void;
}>(({ icon, title, subtitle, count, gradient, onClick }) => (
    <button
        onClick={onClick}
        className={`group relative overflow-hidden rounded-3xl p-6 text-white shadow-xl transition-all hover:shadow-2xl hover:-translate-y-1 active:translate-y-0 ${gradient} text-right w-full`}
    >
        <div className="absolute -left-8 -bottom-8 w-32 h-32 rounded-full bg-white/10 blur-2xl group-hover:bg-white/20 transition-all"></div>
        <div className="relative">
            <div className="flex items-center justify-between mb-3">
                <div className="text-5xl drop-shadow-md">{icon}</div>
                {count !== undefined && (
                    <div className="bg-white/20 backdrop-blur-sm rounded-full px-4 py-1.5 text-sm font-bold">
                        {count}
                    </div>
                )}
            </div>
            <div className="text-2xl font-extrabold mb-1">{title}</div>
            <div className="text-sm opacity-90 leading-relaxed">{subtitle}</div>
            <div className="mt-4 flex items-center gap-2 text-sm font-bold opacity-90 group-hover:opacity-100">
                <span>دخول الآن</span>
                <span className="group-hover:-translate-x-1 transition-transform">←</span>
            </div>
        </div>
    </button>
));
SectionButton.displayName = 'SectionButton';

// ============================================================
// Activity Feed Item
// ============================================================
const ACTION_ICONS: Record<string, { icon: string; color: string }> = {
    login: { icon: '🔓', color: 'bg-blue-50 text-blue-600' },
    register: { icon: '✨', color: 'bg-green-50 text-green-600' },
    book: { icon: '🎟️', color: 'bg-emerald-50 text-emerald-600' },
    cancel_booking: { icon: '❌', color: 'bg-red-50 text-red-600' },
    view_deal: { icon: '👀', color: 'bg-gray-50 text-gray-600' },
    add_deal: { icon: '➕', color: 'bg-purple-50 text-purple-600' },
    edit_deal: { icon: '✏️', color: 'bg-amber-50 text-amber-600' },
    delete_deal: { icon: '🗑️', color: 'bg-red-50 text-red-600' },
    follow: { icon: '⭐', color: 'bg-yellow-50 text-yellow-600' },
    rate: { icon: '💬', color: 'bg-pink-50 text-pink-600' },
    admin_apply_subscription: { icon: '👑', color: 'bg-indigo-50 text-indigo-600' },
    admin_update_user: { icon: '🛠️', color: 'bg-sky-50 text-sky-600' },
};

const ACTION_LABELS: Record<string, string> = {
    login: 'سجّل دخول',
    register: 'سجّل حساب جديد',
    book: 'حجز عرض',
    cancel_booking: 'ألغى حجزاً',
    view_deal: 'شاهد عرض',
    add_deal: 'أضاف عرضاً',
    edit_deal: 'عدّل عرضاً',
    delete_deal: 'حذف عرضاً',
    follow: 'تابع متجراً',
    rate: 'قيّم عرضاً',
    admin_apply_subscription: 'طبّق اشتراكاً',
    admin_update_user: 'عدّل مستخدماً',
};

const ActivityItem = memo<{ row: ActivityRow }>(({ row }) => {
    const meta = ACTION_ICONS[row.action] ?? { icon: '•', color: 'bg-gray-50 text-gray-600' };
    const label = ACTION_LABELS[row.action] ?? row.action;
    const time = new Date(row.created_at);
    const ago = formatTimeAgo(time);

    return (
        <div className="flex gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors">
            <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg ${meta.color}`}>
                {meta.icon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                    <span className="font-bold text-sm text-gray-800 truncate">
                        {row.user_name ?? 'زائر'}
                    </span>
                    <span className="text-xs text-gray-500">{label}</span>
                </div>
                {row.entity_id && (
                    <div className="text-xs text-gray-400 truncate mt-0.5">
                        {row.entity_type} · {row.entity_id.slice(0, 24)}
                    </div>
                )}
            </div>
            <div className="text-xs text-gray-400 flex-shrink-0 self-center tabular-nums">{ago}</div>
        </div>
    );
});
ActivityItem.displayName = 'ActivityItem';

function formatTimeAgo(date: Date): string {
    const sec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (sec < 60) return `قبل ${sec}ث`;
    if (sec < 3600) return `قبل ${Math.floor(sec / 60)}د`;
    if (sec < 86400) return `قبل ${Math.floor(sec / 3600)}س`;
    return date.toLocaleDateString('ar-SA');
}

// ============================================================
// Main Overview Component
// ============================================================
const AdminOverview: React.FC<{
    onNavigate: (tab: 'buyers' | 'sellers' | 'tools' | 'analytics') => void;
}> = ({ onNavigate }) => {
    const { user } = useApp();
    const history = useHistory();
    const [stats, setStats] = useState<LiveStats | null>(null);
    const [activity, setActivity] = useState<ActivityRow[]>([]);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        const [s, a] = await Promise.all([
            adminService.getLiveStats(5, false),
            adminService.getRecentActivity(20),
        ]);
        if (s) setStats(s);
        setActivity(a);
        setLoading(false);
    }, []);

    useEffect(() => {
        refresh();
        const id = setInterval(refresh, 5000); // كل 5 ثوانٍ
        return () => clearInterval(id);
    }, [refresh]);

    return (
        <div className="space-y-6 animate-fade-in" dir="rtl">
            {/* Hero */}
            <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-500 via-teal-600 to-cyan-700 p-6 text-white shadow-2xl">
                <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-white/10 blur-3xl"></div>
                <div className="absolute -left-16 -bottom-16 w-64 h-64 rounded-full bg-white/5 blur-3xl"></div>
                <div className="relative">
                    <div className="flex items-center gap-2 mb-2">
                        <span className="bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold">
                            👑 وضع الأدمن
                        </span>
                        <span className="bg-green-400/30 backdrop-blur-sm px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1.5">
                            <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-300 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-white"></span>
                            </span>
                            مباشر
                        </span>
                    </div>
                    <h1 className="text-3xl font-extrabold mb-1">مرحباً، {user?.name ?? 'الأدمن'} 👋</h1>
                    <p className="text-sm opacity-90">
                        كل شيء تحت سيطرتك الآن. هذه نبضات منصة TAKI اللحظية.
                    </p>
                </div>
            </div>

            {/* الـ 3 أزرار الكبيرة */}
            <div>
                <h2 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                    🎯 الأقسام الرئيسية
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <SectionButton
                        icon="🛒"
                        title="إدارة المشترين"
                        subtitle="ادخل لأي مشتري، عدّل بياناته، تابع نشاطه"
                        count={stats ? `${stats.total_buyers}` : '...'}
                        gradient="bg-gradient-to-br from-blue-500 to-indigo-600"
                        onClick={() => onNavigate('buyers')}
                    />
                    <SectionButton
                        icon="🏪"
                        title="إدارة البائعين"
                        subtitle="تحكم بالاشتراكات، الباقات، الخصومات بضغطة"
                        count={stats ? `${stats.total_sellers}` : '...'}
                        gradient="bg-gradient-to-br from-purple-500 to-fuchsia-600"
                        onClick={() => onNavigate('sellers')}
                    />
                    <SectionButton
                        icon="🛠️"
                        title="أدوات الإدارة"
                        subtitle="البانرات، الحملات، بوابة الدفع، الإعدادات"
                        gradient="bg-gradient-to-br from-orange-500 to-red-600"
                        onClick={() => onNavigate('tools')}
                    />
                </div>
            </div>

            {/* KPIs اللحظية */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                        📊 المؤشرات اللحظية
                    </h2>
                    <button
                        onClick={() => onNavigate('analytics')}
                        className="text-sm text-emerald-600 font-bold hover:text-emerald-700"
                    >
                        التحليلات الكاملة ←
                    </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <KpiCard
                        icon="🟢"
                        label="مستخدمين نشطين الآن"
                        value={stats?.active_users ?? '...'}
                        subtitle={`آخر 5 دقائق`}
                        gradient="bg-gradient-to-br from-emerald-500 to-green-600"
                        pulse
                    />
                    <KpiCard
                        icon="🎟️"
                        label="حجوزات اليوم"
                        value={stats?.bookings_today ?? '...'}
                        subtitle={`${stats?.bookings_hour ?? 0} في آخر ساعة`}
                        gradient="bg-gradient-to-br from-blue-500 to-indigo-600"
                    />
                    <KpiCard
                        icon="✨"
                        label="مستخدمين جدد اليوم"
                        value={stats?.new_users_today ?? '...'}
                        subtitle={`من ${stats?.total_users ?? 0} إجمالاً`}
                        gradient="bg-gradient-to-br from-purple-500 to-fuchsia-600"
                    />
                    <KpiCard
                        icon="💰"
                        label="إيراد شهري متوقّع"
                        value={`${(stats?.mrr ?? 0).toLocaleString('ar-SA')} ر.س`}
                        subtitle={`${stats?.paying_sellers ?? 0} مشترك مدفوع`}
                        gradient="bg-gradient-to-br from-amber-500 to-orange-600"
                    />
                </div>
            </div>

            {/* Activity Feed */}
            <div>
                <h2 className="text-lg font-bold text-gray-800 mb-3 flex items-center gap-2">
                    ⚡ النشاط اللحظي
                    <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full">
                        Live
                    </span>
                </h2>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
                    {loading ? (
                        <div className="p-8 text-center text-gray-400 text-sm">جاري التحميل...</div>
                    ) : activity.length === 0 ? (
                        <div className="p-8 text-center text-gray-400 text-sm">
                            لا توجد نشاطات حديثة بعد. ستظهر هنا مباشرةً.
                        </div>
                    ) : (
                        activity.map((row) => <ActivityItem key={row.id} row={row} />)
                    )}
                </div>
            </div>
        </div>
    );
};

export default memo(AdminOverview);
