/**
 * AdminDashboard v10.94 — Premium Admin Center
 *
 * What this file is:
 *  - The top-level shell for /admin
 *  - Owns: tab state, deep-link parsing, ⌘K palette, the reports badge,
 *    and the Suspense fallback for lazy-loaded tabs.
 *
 * v10.94 additions (Phase 1 of the admin redesign):
 *  - ⌘K / Ctrl+K command palette for instant navigation + user search
 *  - Reports tab badge (red dot when there are open reports)
 *  - Bigger, labeled back button — no more guessing what "›" means
 *  - Tab tooltips so the admin learns what each section holds
 *  - Quick-action bridge (palette → "new banner" / "new campaign") wired
 *    through localStorage so the destination tab can pick it up on mount
 */

import React, { Suspense, lazy, useState, useEffect, useCallback, memo } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { adminService } from '../services/adminService';
import { CommandPalette, AdminTab } from '../components/admin/CommandPalette';
import { Tooltip } from '../components/admin/Tooltip';

// ============================================================
// Lazy load all admin tabs — كل تاب ملف منفصل
// ============================================================
const AdminOverview  = lazy(() => import('./admin/AdminOverview'));
const AdminBuyers    = lazy(() => import('./admin/AdminBuyers'));
const AdminSellers   = lazy(() => import('./admin/AdminSellers'));
const AdminAnalytics = lazy(() => import('./admin/AdminAnalytics'));
const AdminTools     = lazy(() => import('./admin/AdminTools'));
const AdminLocations = lazy(() => import('./admin/AdminLocations'));
const AdminContests  = lazy(() => import('./admin/AdminContests'));
const AdminReports   = lazy(() => import('./admin/AdminReports'));
const AdminModeration = lazy(() => import('./admin/AdminModeration'));
const AdminLaunch    = lazy(() => import('./admin/AdminLaunch'));
const AdminTax       = lazy(() => import('./admin/AdminTax'));
const AdminMessages  = lazy(() => import('./admin/AdminMessages'));
const AdminMessaging = lazy(() => import('./admin/AdminMessaging'));
const AdminAdmins    = lazy(() => import('./admin/AdminAdmins'));
const AdminAnalyst   = lazy(() => import('./admin/AdminAnalyst'));

type Tab = AdminTab;

interface TabDef {
    value: Tab;
    label: string;
    icon: string;
    gradient: string;
    hint: string;
    permission: string; // permission key — empty string = always allowed
}

// v11.19 — each tab gates on a permission key. The super admin sees all of
// them automatically (hasPermission returns true unconditionally).
const TABS: TabDef[] = [
    { value: 'overview',  label: 'الرئيسية',          icon: '🏠',  gradient: 'from-emerald-500 to-teal-600',     hint: 'نظرة عامة لحظية على المنصة',                          permission: 'tab_overview'  },
    { value: 'buyers',    label: 'المشترون',          icon: '🛒',  gradient: 'from-blue-500 to-indigo-600',      hint: 'بحث وتعديل أي مشتري',                                permission: 'tab_buyers'    },
    { value: 'sellers',   label: 'البائعون',          icon: '🏪',  gradient: 'from-purple-500 to-fuchsia-600',   hint: 'تحكم بالاشتراكات والباقات',                          permission: 'tab_sellers'   },
    { value: 'reports',   label: 'البلاغات والشكاوى', icon: '🚩',  gradient: 'from-red-500 to-rose-600',         hint: 'البلاغات بين المستخدمين والشكاوى للإدارة',           permission: 'tab_reports'   },
    { value: 'moderation', label: 'الإنذارات',        icon: '🛡',  gradient: 'from-rose-600 to-red-700',         hint: 'رصد آلي: كلمات تحرش في المحادثات/التقييمات/العروض + صور مرفوضة — عدد الإنذارات لكل متجر وسببها', permission: 'tab_reports' },
    { value: 'analytics', label: 'التحليلات',         icon: '📊',  gradient: 'from-amber-500 to-orange-600',     hint: 'مؤشرات لحظية ورسوم بيانية',                          permission: 'tab_analytics' },
    { value: 'analyst',   label: 'المحلل الذكي',      icon: '🧠',  gradient: 'from-indigo-500 to-violet-700',    hint: 'تحليل آلي كامل: عزوف التجار وأسبابه + ذروة الساعات + فرص المدن + توصية لكل تاجر تُرسل بموافقتك', permission: 'tab_analytics' },
    { value: 'tools',     label: 'الأدوات',           icon: '🛠️',  gradient: 'from-pink-500 to-rose-600',        hint: 'بانرات، حملات، إعدادات',                              permission: 'tab_tools'     },
    { value: 'locations', label: 'المولات والأسواق',  icon: '🏬',  gradient: 'from-teal-500 to-emerald-600',     hint: 'إضافة وتعديل وحذف المولات والأسواق (الموقع + البوتين)', permission: 'tab_tools'     },
    { value: 'contests',  label: 'المسابقات',         icon: '🎁',  gradient: 'from-purple-500 to-fuchsia-600',   hint: 'استبيانات بجوائز + تصحيح تلقائي + سحب',              permission: 'tab_contests'  },
    { value: 'launch',    label: 'الإطلاق',           icon: '🚀',  gradient: 'from-slate-700 to-slate-900',      hint: 'فحص شامل + بوابة الدفع + قائمة ما قبل الإطلاق',     permission: 'tab_launch'    },
    { value: 'tax',       label: 'الزكاة والضريبة',   icon: '🧾',  gradient: 'from-teal-600 to-emerald-700',     hint: 'عدّاد التسجيل الضريبي + جدول شهري + فواتير جاهزة',   permission: 'tab_launch'    },
    { value: 'messages',  label: 'الرسائل',           icon: '💬',  gradient: 'from-cyan-500 to-blue-600',        hint: 'مراقبة كل المحادثات لحظة بلحظة',                     permission: 'tab_messages'  },
    { value: 'messaging', label: 'الإشعارات والرسائل', icon: '📨',  gradient: 'from-indigo-500 to-violet-600',    hint: 'التحكم برسائل الاشتراك والحجز: النص + التوقيت + القناة (إشعار/إيميل)', permission: 'tab_tools' },
    { value: 'admins',    label: 'المسؤولون',         icon: '👑',  gradient: 'from-amber-500 to-orange-600',     hint: 'إدارة الفريق + الصلاحيات (المالك فقط)',              permission: 'tab_admins'    },
];

// ============================================================
// Loading Skeleton — يظهر أثناء lazy loading
// ============================================================
const LoadingSkeleton = memo(() => (
    <div className="space-y-4 animate-pulse">
        <div className="h-32 bg-gradient-to-r from-[var(--gray-100)] via-[var(--gray-200)] to-[var(--gray-100)] rounded-3xl" />
        <div className="grid grid-cols-3 gap-3">
            <div className="h-40 bg-[var(--gray-100)] rounded-2xl" />
            <div className="h-40 bg-[var(--gray-100)] rounded-2xl" />
            <div className="h-40 bg-[var(--gray-100)] rounded-2xl" />
        </div>
        <div className="h-64 bg-[var(--gray-100)] rounded-2xl" />
    </div>
));
LoadingSkeleton.displayName = 'LoadingSkeleton';

// ============================================================
// Tab Navigation — pill style + tooltips + badges + ⌘K trigger
// ============================================================
interface TabNavProps {
    active: Tab;
    onChange: (t: Tab) => void;
    onBack: () => void;
    onOpenPalette: () => void;
    reportsBadge: number;
    visibleTabs: TabDef[];
}

const TabNav = memo<TabNavProps>(({ active, onChange, onBack, onOpenPalette, reportsBadge, visibleTabs }) => (
    // env(safe-area-inset-top) keeps the bar BELOW the notch/Dynamic Island
    // instead of slamming into the clock/battery. Previously top-0 + pt-2 left
    // about 8px to the status bar on a real iPhone, which Nasser flagged.
    <div
        className="sticky z-30 -mx-4 px-4 pb-3 border-b border-[var(--border-color)]"
        style={{
            top: 0,
            // SOLID background (not the 82% glass) — on iOS the backdrop blur
            // sometimes fails to paint, letting the welcome banner bleed through
            // the bar (Nasser: "البانر العلوي متداخل مع الكلمات"). A fully opaque
            // surface + a lift shadow guarantees a clean, professional header
            // that content scrolls cleanly underneath (v11.29).
            background: 'var(--body-bg)',
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
            boxShadow: '0 6px 18px -8px rgba(0,0,0,0.25)',
        }}
    >
        <div className="flex items-center gap-2">
            <Tooltip text="رجوع للخلف">
                <button
                    onClick={onBack}
                    aria-label="رجوع"
                    className="flex-shrink-0 h-10 px-3 rounded-xl bg-[var(--gray-100)] hover:bg-[var(--gray-200)] text-[var(--text-primary)] flex items-center gap-1.5 transition-all font-bold text-sm"
                >
                    <span className="text-lg leading-none">→</span>
                    <span className="hidden sm:inline">رجوع</span>
                </button>
            </Tooltip>

            <Tooltip text="بحث سريع — اضغط ⌘K أو Ctrl+K">
                <button
                    onClick={onOpenPalette}
                    aria-label="فتح البحث السريع"
                    className="flex-shrink-0 h-10 px-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-700 flex items-center gap-1.5 transition-all font-bold text-sm"
                >
                    <span className="text-base">🔎</span>
                    <span className="hidden sm:inline">بحث</span>
                    <kbd className="hidden md:inline-block text-[10px] bg-[var(--card-bg)] border border-emerald-200 px-1.5 py-0.5 rounded">⌘K</kbd>
                </button>
            </Tooltip>

            <div className="flex gap-1 overflow-x-auto scrollbar-hide flex-1">
                {visibleTabs.map((tab) => {
                    const isActive = active === tab.value;
                    const showBadge = tab.value === 'reports' && reportsBadge > 0;
                    return (
                        <Tooltip key={tab.value} text={tab.hint}>
                            <button
                                onClick={() => onChange(tab.value)}
                                className={`relative flex-shrink-0 px-4 py-2.5 rounded-xl text-sm font-bold transition-all whitespace-nowrap ${
                                    isActive
                                        ? `bg-gradient-to-r ${tab.gradient} text-white shadow-md`
                                        : 'text-[var(--text-secondary)] hover:bg-[var(--gray-100)]'
                                }`}
                            >
                                <span className="text-lg ml-1">{tab.icon}</span>
                                {tab.label}
                                {showBadge && (
                                    <span
                                        className={`absolute -top-1 -left-1 min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-extrabold ${
                                            isActive ? 'bg-white text-red-600' : 'bg-red-500 text-white'
                                        } shadow ring-2 ring-[var(--body-bg)]`}
                                    >
                                        {reportsBadge > 99 ? '99+' : reportsBadge}
                                    </span>
                                )}
                            </button>
                        </Tooltip>
                    );
                })}
            </div>
        </div>
    </div>
));
TabNav.displayName = 'TabNav';

// ============================================================
// Main Component
// ============================================================
const AdminDashboard: React.FC = () => {
    const { user, isAuthReady, hasPermission, isSuperAdmin } = useApp();
    const history = useHistory();
    const location = useLocation();
    const [activeTab, setActiveTab] = useState<Tab>('overview');
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [reportsBadge, setReportsBadge] = useState(0);

    // v11.19 — filter tabs by the caller's permissions. Super admin sees
    // everything; staff admins only see tabs they're allowed.
    const visibleTabs = React.useMemo(() => TABS.filter(t => hasPermission(t.permission)), [hasPermission]);

    // If the current tab disappears (e.g. super admin revoked the permission
    // mid-session), fall back to the first allowed tab.
    useEffect(() => {
        if (visibleTabs.length === 0) return;
        if (!visibleTabs.some(t => t.value === activeTab)) {
            setActiveTab(visibleTabs[0].value);
        }
    }, [visibleTabs, activeTab]);

    // Deep-link support: /admin?tab=reports opens the right tab on load.
    // Block the deep-link if the caller lacks permission.
    useEffect(() => {
        const t = new URLSearchParams(location.search).get('tab');
        if (t && visibleTabs.some(vt => vt.value === t)) {
            setActiveTab(t as Tab);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.search, visibleTabs]);

    const handleBack = useCallback(() => {
        if (activeTab !== 'overview') {
            setActiveTab('overview');
            return;
        }
        if (history.length > 1) history.goBack();
        else history.push('/');
    }, [activeTab, history]);

    // Heartbeat لتتبع جلسة الأدمن
    useEffect(() => {
        if (user?.user_type !== 'admin' && user?.userType !== 'admin') return;
        adminService.heartbeat('/admin');
        const id = setInterval(() => adminService.heartbeat('/admin'), 30000);
        return () => clearInterval(id);
    }, [user]);

    // Reports badge — poll the open count every 60s. Cheap RPC, capped at 100.
    useEffect(() => {
        if (user?.user_type !== 'admin' && user?.userType !== 'admin') return;
        let alive = true;
        const refresh = async () => {
            const rows = await adminService.listReports({ status: 'open', limit: 100 });
            if (alive) setReportsBadge(rows.length);
        };
        refresh();
        const id = setInterval(refresh, 60000);
        return () => { alive = false; clearInterval(id); };
    }, [user]);

    // ⌘K / Ctrl+K opens the palette anywhere inside /admin.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
                e.preventDefault();
                setPaletteOpen((v) => !v);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // IMPORTANT: every hook must run on every render (Rules of Hooks).
    const handleNavigate = useCallback((t: AdminTab) => {
        setActiveTab(t);
        if (typeof window !== 'undefined') {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }, []);

    // Quick-action bridge for the palette. We stash a one-shot intent
    // in sessionStorage; the destination tab reads + clears it on mount.
    const handleQuickAction = useCallback((id: string) => {
        try {
            sessionStorage.setItem('taki:admin:quick_action', id);
        } catch {}
    }, []);

    // Auth gate.
    const userType = user?.user_type ?? user?.userType;
    if (!isAuthReady) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4" dir="rtl">
                <div className="text-center">
                    <div className="w-10 h-10 mx-auto rounded-full border-4 border-emerald-200 border-t-emerald-500 animate-spin" />
                    <p className="text-sm text-[var(--text-secondary)] mt-3 font-bold">جاري التحقق من الجلسة...</p>
                </div>
            </div>
        );
    }
    if (userType !== 'admin') {
        return (
            <div className="min-h-screen flex items-center justify-center p-4" dir="rtl">
                <div className="bg-[var(--card-bg)] rounded-3xl p-8 max-w-md w-full shadow-xl text-center">
                    <div className="text-6xl mb-3">🔒</div>
                    <h1 className="text-2xl font-extrabold text-[var(--text-primary)] mb-2">
                        الوصول مرفوض
                    </h1>
                    <p className="text-sm text-[var(--text-secondary)]">
                        هذه الصفحة مخصصة للإدارة فقط.
                    </p>
                    <p className="text-xs text-[var(--gray-400)] mt-2">
                        نوع حسابك الحالي:{' '}
                        <span className="font-bold">{userType ?? 'غير معروف'}</span>
                    </p>
                    <button
                        onClick={() => history.push('/register')}
                        className="mt-4 px-4 py-2 bg-emerald-500 text-white font-bold rounded-xl text-sm hover:bg-emerald-600"
                    >
                        تسجيل الدخول
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-[var(--body-bg)] pb-24" dir="rtl">
            <div className="max-w-7xl mx-auto px-4 pt-3">
                <TabNav
                    active={activeTab}
                    onChange={setActiveTab}
                    onBack={handleBack}
                    onOpenPalette={() => setPaletteOpen(true)}
                    reportsBadge={reportsBadge}
                    visibleTabs={visibleTabs}
                />

                {/* If the staff admin has been granted zero tabs, surface
                    a clear message instead of a blank screen. */}
                {visibleTabs.length === 0 && (
                    <div className="mt-8 text-center bg-amber-50 border border-amber-200 rounded-2xl p-6">
                        <div className="text-5xl mb-2">🔒</div>
                        <p className="font-extrabold text-amber-900">لا توجد صلاحيات مفعّلة لحسابك</p>
                        <p className="text-sm text-amber-800 mt-1">تواصل مع المالك ليفعّل لك التبويبات اللازمة.</p>
                    </div>
                )}

                <div className="mt-5">
                    <Suspense fallback={<LoadingSkeleton />}>
                        {activeTab === 'overview'  && hasPermission('tab_overview')  && <AdminOverview onNavigate={handleNavigate} />}
                        {activeTab === 'buyers'    && hasPermission('tab_buyers')    && <AdminBuyers />}
                        {activeTab === 'sellers'   && hasPermission('tab_sellers')   && <AdminSellers />}
                        {activeTab === 'reports'   && hasPermission('tab_reports')   && <AdminReports />}
                        {activeTab === 'moderation' && hasPermission('tab_reports')  && <AdminModeration />}
                        {activeTab === 'analytics' && hasPermission('tab_analytics') && <AdminAnalytics />}
                        {activeTab === 'analyst'   && hasPermission('tab_analytics') && <AdminAnalyst />}
                        {activeTab === 'tools'     && hasPermission('tab_tools')     && <AdminTools />}
                        {activeTab === 'locations' && hasPermission('tab_tools')     && <AdminLocations />}
                        {activeTab === 'contests'  && hasPermission('tab_contests')  && <AdminContests />}
                        {activeTab === 'launch'    && hasPermission('tab_launch')    && <AdminLaunch />}
                        {activeTab === 'tax'       && hasPermission('tab_launch')    && <AdminTax />}
                        {activeTab === 'messages'  && hasPermission('tab_messages')  && <AdminMessages />}
                        {activeTab === 'messaging' && hasPermission('tab_tools')     && <AdminMessaging />}
                        {activeTab === 'admins'    && isSuperAdmin                   && <AdminAdmins />}
                    </Suspense>
                </div>
            </div>

            <CommandPalette
                open={paletteOpen}
                onClose={() => setPaletteOpen(false)}
                onNavigate={handleNavigate}
                onQuickAction={handleQuickAction}
            />
        </div>
    );
};

export default AdminDashboard;
