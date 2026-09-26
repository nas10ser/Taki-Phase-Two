/**
 * AdminDashboard — قشرة لوحة الإدارة (v14.89)
 * ═══════════════════════════════════════════════════════════════════════════
 * ما تملكه هذه الشاشة: حالة التبويب، والروابط العميقة (`?tab=`)، ولوحة
 * الأوامر ⌘K، وشارات ما ينتظر المراجعة، ونبض الجلسة، وحدّ التحميل الكسول.
 *
 * 🪤 ما استُبدل في v14.89 (وقِيس قبل استبداله):
 *   • ثمانية عشر تبويباً في شريطٍ أفقيّ واحد — على جوّال ناصر تظهر ثلاثة،
 *     والبقيّة خلف تمريرٍ لا يُعلن عن نفسه. صارت ستّ مجموعاتٍ تُقرأ دفعةً
 *     واحدة، وشريطُ تبويباتٍ داخل المجموعة، ولوحةٌ كاملة بزرٍّ واحد.
 *   • أسماء التبويبات كانت مكتوبةً مرّتين (هنا وفي ⌘K) وانحرفت فعلاً —
 *     المصدر الآن `src/data/adminNav.ts` وحده.
 *   • كل تبويبٍ كان يحمل تدرّجاً لونياً خاصّاً: تسعةَ عشرَ لوناً تتنافس،
 *     فلا تسلسل بصريّ. اللون الآن للدلالة وحدها.
 */

import React, { Suspense, lazy, useState, useEffect, useCallback, useMemo, memo } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { adminService } from '../services/adminService';
import { verificationRepository } from '../repositories/verificationRepository';
import { CommandPalette } from '../components/admin/CommandPalette';
import { AdminGroupBar, AdminTabBar, AdminNavPanel } from '../components/admin/AdminNav';
import type { AdminBadges } from '../components/admin/AdminNav';
import { AdmCard, AdmPageHeader, AdmSkeleton } from '../components/admin/ui';
import {
    ADMIN_TABS, ADMIN_TAB_BY_ID, ADMIN_GROUP_BY_ID,
    AdminTabId, AdminGroupId, AdminTabDef,
} from '../data/adminNav';

// ── التحميل الكسول: كل شاشةٍ حزمةٌ تُدفع ثمنها عند فتحها وحدها ──────────────
const AdminOverview   = lazy(() => import('./admin/AdminOverview'));
const AdminBuyers     = lazy(() => import('./admin/AdminBuyers'));
const AdminSellers    = lazy(() => import('./admin/AdminSellers'));
const AdminAnalytics  = lazy(() => import('./admin/AdminAnalytics'));
const AdminTools      = lazy(() => import('./admin/AdminTools'));
const AdminLocations  = lazy(() => import('./admin/AdminLocations'));
const AdminContests   = lazy(() => import('./admin/AdminContests'));
const AdminReports    = lazy(() => import('./admin/AdminReports'));
const AdminVerification = lazy(() => import('./admin/AdminVerification'));
const AdminModeration = lazy(() => import('./admin/AdminModeration'));
const AdminLaunch     = lazy(() => import('./admin/AdminLaunch'));
const AdminTax        = lazy(() => import('./admin/AdminTax'));
const AdminDelivery   = lazy(() => import('./admin/AdminDelivery'));
const AdminInvoices   = lazy(() => import('./admin/AdminInvoices'));
const AdminMessages   = lazy(() => import('./admin/AdminMessages'));
const AdminMessaging  = lazy(() => import('./admin/AdminMessaging'));
const AdminAdmins     = lazy(() => import('./admin/AdminAdmins'));
const AdminAnalyst    = lazy(() => import('./admin/AdminAnalyst'));
const AdminAudience   = lazy(() => import('./admin/AdminAudience'));


/**
 * سجلّ الشاشات — `Record<AdminTabId, …>` عمداً.
 * 🪤 كانت هنا سلسلةٌ من ثمانية عشر `activeTab === '…' && <X />`: قائمةٌ ثانية
 *    تستطيع الانحراف عن الكتالوج **بصمت** — تُضاف شاشةٌ في `adminNav.ts`
 *    ويُنسى سطرها هنا، فيُفتح تبويبٌ فارغ بلا أي خطأ. السجلّ يجعل `tsc`
 *    يرفض النقص.
 *    («الرئيسية» خارجه لأنها وحدها تأخذ خاصّية `onNavigate`.)
 */
const TAB_VIEWS: Record<Exclude<AdminTabId, 'overview'>, React.ComponentType> = {
    buyers: AdminBuyers,
    sellers: AdminSellers,
    admins: AdminAdmins,
    reports: AdminReports,
    verification: AdminVerification,
    moderation: AdminModeration,
    messages: AdminMessages,
    delivery: AdminDelivery,
    invoices: AdminInvoices,
    tax: AdminTax,
    analytics: AdminAnalytics,
    analyst: AdminAnalyst,
    audience: AdminAudience,
    contests: AdminContests,
    tools: AdminTools,
    locations: AdminLocations,
    messaging: AdminMessaging,
    launch: AdminLaunch,
};

/** ذاكرةُ تبويبٍ للجلسة — تُنقذ القارئ من فقدان مكانه عند إعادة التحميل. */
const TAB_MEMO = 'taki:admin:last_tab';

// ═══════════════════════════════════════════════════════════════════════════
// هيكل التحميل — يحجز ارتفاعاً قريباً من المحتوى فلا تقفز الصفحة
// ═══════════════════════════════════════════════════════════════════════════
const TabFallback = memo(() => (
    <div style={{ display: 'grid', gap: 12 }}>
        <div className="animate-pulse" style={{ height: 58, borderRadius: 'var(--adm-r)', background: 'var(--adm-surface-3)' }} />
        <AdmSkeleton rows={2} height={92} />
        <AdmSkeleton rows={1} height={220} />
    </div>
));
TabFallback.displayName = 'TabFallback';

// ═══════════════════════════════════════════════════════════════════════════

const AdminDashboard: React.FC = () => {
    const { user, hasPermission, isSuperAdmin } = useApp();
    const history = useHistory();
    const location = useLocation();

    const [activeTab, setActiveTab] = useState<AdminTabId>('overview');
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [navOpen, setNavOpen] = useState(false);
    /**
     * ما ينتظر المراجعة — عددٌ لكل شاشة، لا رقمٌ واحد باسم «البلاغات».
     * 🪤 كان رقماً مفرداً (`reportsBadge`) يمرّ في ثلاثة مكوّنات، وكلٌّ منها
     *    يقارن `t.id === 'reports'` حرفياً. فلمّا لزمت شارةٌ ثانية (طابور
     *    التوثيق) كان البديل خاصّيةً رابعة وثلاثَ مقارناتٍ جديدة. المفتاح الآن
     *    هويّةُ التبويب، والدمج جزئيّ (`prev => …`) فلا يمحو نداءٌ نتيجةَ الآخر.
     */
    const [badges, setBadges] = useState<AdminBadges>({});

    // ── الصلاحيات ────────────────────────────────────────────────────────────
    const canSee = useCallback(
        (t: AdminTabDef) => (t.onlySuper ? isSuperAdmin : hasPermission(t.permission)),
        [hasPermission, isSuperAdmin]
    );
    const visibleTabs = useMemo(() => ADMIN_TABS.filter(canSee), [canSee]);
    const allowedGroups = useMemo(
        () => new Set<AdminGroupId>(visibleTabs.map((t) => t.group)),
        [visibleTabs]
    );

    // المجموعة تتبع التبويب المفتوح — فلا حالةٌ ثانية تنحرف عنه.
    const activeGroup: AdminGroupId = ADMIN_TAB_BY_ID[activeTab]?.group ?? 'home';
    const groupTabs = useMemo(
        () => visibleTabs.filter((t) => t.group === activeGroup),
        [visibleTabs, activeGroup]
    );

    // إن سقطت صلاحية التبويب المفتوح (سحبها المالك أثناء الجلسة) نعود لأول مسموح.
    useEffect(() => {
        if (!visibleTabs.length) return;
        if (!visibleTabs.some((t) => t.id === activeTab)) setActiveTab(visibleTabs[0].id);
    }, [visibleTabs, activeTab]);

    /**
     * الروابط العميقة: `/admin?tab=reports`.
     *
     * 🪤 وقِيس أن العنوان **لا يصمد لإعادة تحميل**: مسار الدخول في
     *    `App.tsx` يرى ملفّ المستخدم ناقصاً للحظةٍ قبل وصول بياناته، فيحوّل
     *    إلى `/complete-profile` ثم يعيده إلى `/admin` — **بلا معاملات**.
     *    فيفقد القارئ تبويبه عند كل تحديثٍ للصفحة. ولمسُ ذلك المسار مخاطرةٌ
     *    غير متناسبة (ثلاثة إصدارات سابقة أُنفقت على إصلاحه)، فالعلاج هنا:
     *    التبويب يُحفظ للجلسة ويُستعاد إن جاء العنوان خالياً.
     */
    useEffect(() => {
        const t = new URLSearchParams(location.search).get('tab');
        if (t && visibleTabs.some((vt) => vt.id === t)) {
            setActiveTab(t as AdminTabId);
            try { sessionStorage.setItem(TAB_MEMO, t); } catch { /* تخزينٌ محجوب */ }
            return;
        }
        if (!t) {
            let saved: string | null = null;
            try { saved = sessionStorage.getItem(TAB_MEMO); } catch { /* تخزينٌ محجوب */ }
            if (saved && visibleTabs.some((vt) => vt.id === saved)) setActiveTab(saved as AdminTabId);
        }
    }, [location.search, visibleTabs]);

    const goTab = useCallback((t: AdminTabId) => {
        setActiveTab(t);
        try { sessionStorage.setItem(TAB_MEMO, t); } catch { /* تخزينٌ محجوب */ }
        // 🪤 العنوان يتبع التبويب — وإلّا انفصلا. كان `?tab=` يُقرأ ولا يُكتب:
        // فأيُّ إعادةِ بناءٍ لكائن المستخدم تُعيد تشغيل خطّاف الرابط العميق
        // فيُعاد ضبط الشاشة على قيمة العنوان **القديمة**، ويُقذف القارئ إلى
        // شاشةٍ لم يخترها. وبكتابته أيضاً يصير زرّ رجوع المتصفّح يعود تبويباً
        // واحداً لا يخرج من اللوحة كلّها.
        try {
            const sp = new URLSearchParams(window.location.search);
            if (sp.get('tab') !== t) {
                sp.set('tab', t);
                sp.delete('q');
                history.push({ pathname: '/admin', search: `?${sp.toString()}` });
            }
        } catch { /* بيئة بلا window */ }
        try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch { /* بيئة بلا window */ }
    }, [history]);

    /** اختيار مجموعة يفتح أوّل شاشةٍ مسموحةٍ فيها. */
    const goGroup = useCallback((g: AdminGroupId) => {
        const first = visibleTabs.find((t) => t.group === g);
        if (first) goTab(first.id);
    }, [visibleTabs, goTab]);

    /**
     * الرجوع = خطوةٌ واحدة إلى الوراء، كما يتوقّعه كل من استعمل متصفّحاً.
     * 🪤 كان يقفز إلى «الرئيسية» أوّلاً مهما كان مصدرُك — فزرٌّ اسمه «رجوع»
     *    يأخذك إلى مكانٍ لم تكن فيه. وصار ذلك سليماً الآن لأن `goTab` يكتب
     *    التبويب في العنوان، فسجلّ المتصفّح يحفظ خطواتك داخل اللوحة.
     */
    const handleBack = useCallback(() => {
        if (history.length > 1) history.goBack();
        else history.push('/');
    }, [history]);

    // ── نبض جلسة الأدمن ──────────────────────────────────────────────────────
    useEffect(() => {
        if (user?.user_type !== 'admin' && user?.userType !== 'admin') return;
        adminService.heartbeat('/admin');
        const id = setInterval(() => adminService.heartbeat('/admin'), 30000);
        return () => clearInterval(id);
    }, [user]);

    // ── شارة البلاغات المفتوحة ───────────────────────────────────────────────
    useEffect(() => {
        if (user?.user_type !== 'admin' && user?.userType !== 'admin') return;
        if (!hasPermission('tab_reports')) return;
        let alive = true;
        const load = async () => {
            try {
                const rows = await adminService.listReports({ status: 'open', limit: 100 });
                if (alive) setBadges((b) => ({ ...b, reports: Array.isArray(rows) ? rows.length : 0 }));
            } catch { /* شارةٌ لا تُفشل شاشة */ }
        };
        load();
        const id = setInterval(load, 60000);
        return () => { alive = false; clearInterval(id); };
    }, [user, hasPermission]);

    // ── شارة طابور التوثيق ───────────────────────────────────────────────────
    // 🪤 العدد من `admin_verification_stats` لا من طول قائمةٍ مقصوصة بحدٍّ:
    //    قائمةٌ بحدّ ١٠٠ تقول «١٠٠» وهي ١٤٠. والخادم يحرس الصلاحية بنفسه
    //    (`taki_admin_perm('tab_verification')`)، وفحصُ الواجهة هنا لتوفير
    //    نداءٍ مرفوضٍ سلفاً لا ليكون هو الحارس.
    useEffect(() => {
        if (user?.user_type !== 'admin' && user?.userType !== 'admin') return;
        if (!hasPermission('tab_verification')) return;
        let alive = true;
        const load = async () => {
            try {
                const res = await verificationRepository.adminStats();
                if (alive && res.ok && res.stats) {
                    setBadges((b) => ({ ...b, verification: res.stats!.pending }));
                }
            } catch { /* شارةٌ لا تُفشل شاشة */ }
        };
        load();
        const id = setInterval(load, 60000);
        return () => { alive = false; clearInterval(id); };
    }, [user, hasPermission]);

    // ── ⌘K ───────────────────────────────────────────────────────────────────
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setPaletteOpen((p) => !p);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const head = ADMIN_TAB_BY_ID[activeTab];
    const group = ADMIN_GROUP_BY_ID[activeGroup];

    if (!visibleTabs.length) {
        return (
            <div style={{ padding: '40px 18px', textAlign: 'center', color: 'var(--adm-fg-2)' }}>
                لا توجد لك صلاحيةٌ على أي شاشةٍ في لوحة الإدارة. راجع مالك المنصّة.
            </div>
        );
    }

    return (
        <div className="adm-shell" style={{ background: 'var(--body-bg)', minHeight: '100vh' }}>
            {/* ── الرأس الثابت: رجوع · القائمة · بحث ─────────────────────── */}
            <div
                style={{
                    position: 'sticky', top: 0, zIndex: 30,
                    background: 'var(--body-bg)',
                    borderBottom: '1px solid var(--adm-border)',
                    paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
                    paddingInline: 14,
                    paddingBottom: 8,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 9, minWidth: 0 }}>
                    <button
                        onClick={handleBack}
                        aria-label="رجوع"
                        className="adm-focusable"
                        style={{
                            flexShrink: 0, height: 34, paddingInline: 11, borderRadius: 'var(--adm-r-sm)',
                            border: '1px solid var(--adm-border)', background: 'var(--adm-surface)',
                            color: 'var(--adm-fg-2)', fontSize: '.8rem', fontWeight: 800, cursor: 'pointer',
                        }}
                    >
                        →
                    </button>
                    <button
                        onClick={() => setNavOpen(true)}
                        className="adm-focusable"
                        style={{
                            flexShrink: 0, height: 34, paddingInline: 11, borderRadius: 'var(--adm-r-sm)',
                            border: '1px solid var(--adm-border)', background: 'var(--adm-surface)',
                            color: 'var(--adm-fg-2)', fontSize: '.8rem', fontWeight: 800, cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                        }}
                    >
                        <span aria-hidden="true">☰</span>
                        كل الشاشات
                    </button>
                    <button
                        onClick={() => setPaletteOpen(true)}
                        className="adm-focusable"
                        style={{
                            flex: 1, minWidth: 0, height: 34, paddingInline: 11, borderRadius: 'var(--adm-r-sm)',
                            border: '1px solid var(--adm-border)', background: 'var(--adm-surface)',
                            color: 'var(--adm-fg-3)', fontSize: '.8rem', fontWeight: 700, cursor: 'pointer',
                            display: 'inline-flex', alignItems: 'center', gap: 7, justifyContent: 'space-between',
                        }}
                    >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                            <span aria-hidden="true">🔎</span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                ابحث عن شاشة أو مستخدم
                            </span>
                        </span>
                        <kbd
                            className="adm-kbd"
                            style={{
                                fontSize: '.62rem', padding: '1px 5px', borderRadius: 5,
                                border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)',
                            }}
                        >
                            ⌘K
                        </kbd>
                    </button>
                </div>

                <AdminGroupBar
                    activeGroup={activeGroup}
                    onPick={goGroup}
                    allowed={allowedGroups}
                    badges={badges}
                />
            </div>

            {/* ── جسم الشاشة ──────────────────────────────────────────────── */}
            {/* 🔴 v14.89b — `minmax(0, 1fr)` لا `1fr`: عنصرُ الشبكة عرضُه الأدنى
                `auto` افتراضياً، أي **عرض محتواه**. فشريطُ تبويبات المجموعة
                (٦٣٩ بكسل) مدّ الحاوية إلى ٧٦٦ على شاشة ٣٧٥، و`app-container`
                يقصّ بـ`overflow-x: clip` — فقُصَّت **كل** البطاقات من اليسار
                ولم تكن الصفحة تتمرّر جانبياً لأن القصّ لا تمرير معه.
                قِيس قبل: clientWidth 375 · scrollWidth 766. */}
            <div style={{ padding: '16px 14px 90px', display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 1fr)' }}>
                {groupTabs.length > 1 && (
                    <div style={{ borderBottom: '1px solid var(--adm-border)', paddingBottom: 2, minWidth: 0, overflow: 'hidden' }}>
                        <AdminTabBar tabs={groupTabs} active={activeTab} onPick={goTab} badges={badges} />
                    </div>
                )}

                {head && (
                    <AdmPageHeader
                        title={head.label}
                        desc={head.hint}
                        icon={head.icon}
                        actions={
                            /* مسارُ تنقّلٍ **قابلٍ للنقر**: كان سطراً نصّياً ميّتاً يقول
                               اسم المجموعة ولا يذهب إلى شيء. الآن يفتح كل الشاشات. */
                            <button
                                type="button"
                                onClick={() => setNavOpen(true)}
                                className="adm-focusable"
                                style={{
                                    alignSelf: 'center', fontSize: '.7rem', fontWeight: 800,
                                    color: 'var(--adm-fg-2)', background: 'var(--adm-surface-2)',
                                    border: '1px solid var(--adm-border)', borderRadius: 999,
                                    padding: '3px 11px', cursor: 'pointer', whiteSpace: 'nowrap',
                                }}
                                title="كل الشاشات"
                            >
                                {group?.icon} {group?.label} ›
                            </button>
                        }
                    />
                )}

                {/* 🪤 حارسُ تصييرٍ صريح — لا يُستغنى عنه بإخفاء التبويب وحده.
                    قبل v14.89 كانت كل شاشةٍ تحمل شرطها بنفسها، ثمّ صار التبويب
                    يُخفى من الشريط فقط. وإخفاءُ مدخلٍ ليس منعاً: يكفي رابطٌ
                    عميق أو حالةٌ قديمة. هذا شرطٌ واحد يغطّي الجميع —
                    والقاعدة تحرس من ورائه (RLS + admin_rpc_permissions). */}
                {!visibleTabs.some((t) => t.id === activeTab) ? (
                    <AdmCard>
                        <div style={{ textAlign: 'center', padding: '22px 14px', color: 'var(--adm-fg-2)', fontSize: '.9rem', fontWeight: 700 }}>
                            هذه الشاشة ليست ضمن صلاحياتك.
                        </div>
                    </AdmCard>
                ) : (
                <Suspense fallback={<TabFallback />}>
                    {activeTab === 'overview'
                        ? <AdminOverview onNavigate={goTab} />
                        : React.createElement(TAB_VIEWS[activeTab])}
                </Suspense>
                )}
            </div>

            <AdminNavPanel
                open={navOpen}
                onClose={() => setNavOpen(false)}
                active={activeTab}
                onPick={goTab}
                canSee={canSee}
                badges={badges}
            />

            <CommandPalette
                open={paletteOpen}
                onClose={() => setPaletteOpen(false)}
                onNavigate={(t) => goTab(t as AdminTabId)}
            />
        </div>
    );
};

export default AdminDashboard;
