/**
 * AdminDashboard v9.7 — Premium Admin Center
 *
 * الميزات:
 *  ⚡ سرعة كالبرق:
 *      - React.lazy لكل تاب → التحميل عند الطلب فقط
 *      - Suspense skeleton جميل أثناء التحميل
 *      - Memoized components → 0 re-renders لا داعي لها
 *      - Server-side cached RPC calls (TTL = 3s)
 *
 *  🎨 تصميم 2026:
 *      - Glassmorphism + gradients
 *      - Rounded corners + shadows لطيفة
 *      - Live indicators (pulse animations)
 *
 *  🔒 آمن بالكامل:
 *      - كل RPC تتحقق من user_type='admin' داخل قاعدة البيانات
 *      - RLS policies صارمة
 *      - Activity log لكل عملية أدمن
 *
 *  📊 الميزات:
 *      - 4 صفحات منفصلة: Overview / Buyers / Sellers / Tools / Analytics
 *      - بحث متقدم + فلاتر
 *      - تحكم كامل بالاشتراكات (تاريخ، خصم، مبلغ، باقة) بضغطة
 *      - تحليلات لحظية مع فلاتر زمنية متقدمة
 *      - Activity feed مباشر
 */

import React, { Suspense, lazy, useState, useEffect, useCallback, memo } from 'react';
import { useApp } from '../context/AppContext';
import { adminService } from '../services/adminService';

// ============================================================
// Lazy load all admin tabs — كل تاب ملف منفصل
// التحميل يحدث فقط عند الانتقال إلى التاب
// ============================================================
const AdminOverview  = lazy(() => import('./admin/AdminOverview'));
const AdminBuyers    = lazy(() => import('./admin/AdminBuyers'));
const AdminSellers   = lazy(() => import('./admin/AdminSellers'));
const AdminAnalytics = lazy(() => import('./admin/AdminAnalytics'));
const AdminTools     = lazy(() => import('./admin/AdminTools'));

type Tab = 'overview' | 'buyers' | 'sellers' | 'analytics' | 'tools';

const TABS: Array<{
    value: Tab;
    label: string;
    icon: string;
    gradient: string;
}> = [
    { value: 'overview',  label: 'الرئيسية',   icon: '🏠', gradient: 'from-emerald-500 to-teal-600' },
    { value: 'buyers',    label: 'المشترون',   icon: '🛒', gradient: 'from-blue-500 to-indigo-600' },
    { value: 'sellers',   label: 'البائعون',   icon: '🏪', gradient: 'from-purple-500 to-fuchsia-600' },
    { value: 'analytics', label: 'التحليلات',  icon: '📊', gradient: 'from-amber-500 to-orange-600' },
    { value: 'tools',     label: 'الأدوات',    icon: '🛠️', gradient: 'from-pink-500 to-rose-600' },
];

// ============================================================
// Loading Skeleton — يظهر أثناء lazy loading
// ============================================================
const LoadingSkeleton = memo(() => (
    <div className="space-y-4 animate-pulse">
        <div className="h-32 bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100 rounded-3xl" />
        <div className="grid grid-cols-3 gap-3">
            <div className="h-40 bg-gray-100 rounded-2xl" />
            <div className="h-40 bg-gray-100 rounded-2xl" />
            <div className="h-40 bg-gray-100 rounded-2xl" />
        </div>
        <div className="h-64 bg-gray-100 rounded-2xl" />
    </div>
));
LoadingSkeleton.displayName = 'LoadingSkeleton';

// ============================================================
// Tab Navigation — pill style مع indicators
// ============================================================
const TabNav = memo<{
    active: Tab;
    onChange: (t: Tab) => void;
}>(({ active, onChange }) => (
    <div className="sticky top-0 z-20 -mx-4 px-4 pt-2 pb-3 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
            {TABS.map((tab) => {
                const isActive = active === tab.value;
                return (
                    <button
                        key={tab.value}
                        onClick={() => onChange(tab.value)}
                        className={`flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                            isActive
                                ? `bg-gradient-to-r ${tab.gradient} text-white shadow-md`
                                : 'text-gray-600 hover:bg-gray-50'
                        }`}
                    >
                        <span className="text-lg ml-1">{tab.icon}</span>
                        {tab.label}
                    </button>
                );
            })}
        </div>
    </div>
));
TabNav.displayName = 'TabNav';

// ============================================================
// Main Component
// ============================================================
const AdminDashboard: React.FC = () => {
    const { user } = useApp();
    const [activeTab, setActiveTab] = useState<Tab>('overview');

    // Heartbeat لتتبع جلسة الأدمن
    useEffect(() => {
        if (user?.user_type !== 'admin' && user?.userType !== 'admin') return;
        adminService.heartbeat('/admin');
        const id = setInterval(() => adminService.heartbeat('/admin'), 30000);
        return () => clearInterval(id);
    }, [user]);

    // Auth gate
    const userType = user?.user_type ?? user?.userType;
    if (userType !== 'admin') {
        return (
            <div className="min-h-screen flex items-center justify-center p-4" dir="rtl">
                <div className="bg-white rounded-3xl p-8 max-w-md w-full shadow-xl text-center">
                    <div className="text-6xl mb-3">🔒</div>
                    <h1 className="text-2xl font-extrabold text-gray-900 mb-2">
                        الوصول مرفوض
                    </h1>
                    <p className="text-sm text-gray-500">
                        هذه الصفحة مخصصة للإدارة فقط.
                    </p>
                    <p className="text-xs text-gray-400 mt-2">
                        نوع حسابك الحالي:{' '}
                        <span className="font-bold">{userType ?? 'غير معروف'}</span>
                    </p>
                </div>
            </div>
        );
    }

    const handleNavigate = useCallback((t: 'buyers' | 'sellers' | 'tools' | 'analytics') => {
        setActiveTab(t);
        // Smooth scroll to top بعد التغيير
        if (typeof window !== 'undefined') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 pb-24" dir="rtl">
            <div className="max-w-7xl mx-auto px-4 pt-3">
                <TabNav active={activeTab} onChange={setActiveTab} />

                <div className="mt-4">
                    <Suspense fallback={<LoadingSkeleton />}>
                        {activeTab === 'overview'  && <AdminOverview onNavigate={handleNavigate} />}
                        {activeTab === 'buyers'    && <AdminBuyers />}
                        {activeTab === 'sellers'   && <AdminSellers />}
                        {activeTab === 'analytics' && <AdminAnalytics />}
                        {activeTab === 'tools'     && <AdminTools />}
                    </Suspense>
                </div>
            </div>
        </div>
    );
};

export default AdminDashboard;
