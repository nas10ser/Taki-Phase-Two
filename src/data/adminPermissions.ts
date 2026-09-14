/**
 * adminPermissions — كتالوج صلاحيات الإدارة، **مصدرٌ واحد** (v14.38)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 كان هذا الكتالوج مكرَّراً في ثلاثة ملفات مستقلّة (`authService.ts` نوعاً،
 * و`AdminAdmins.tsx` و`PromoteToAdminDialog.tsx` قائمتين)، وقد **تفارقت**
 * فعلاً: شاشةُ المنح تعرض مفتاحاً وشاشةُ التعديل لا تعرضه، ووصفٌ واحد يَعِد
 * بقدرةٍ غير موجودة. إضافةُ صلاحية كانت تعني تعديل ثلاثة ملفات، ونسيانُ واحدٍ
 * يمرّ صامتاً.
 *
 * ⚠️ كل صلاحية هنا يجب أن يكون لها **قارئ فعليّ**: في الواجهة (إخفاء لا تعطيل)
 * وفي القاعدة (`admin_rpc_permissions` أو سياسة RLS عبر `taki_admin_perm`).
 * صلاحيةٌ بلا قارئ مربّعُ اختيارٍ يكذب على من يمنحه. عمود «يحرس» أدناه يقول
 * أين تُقرأ كلٌّ منها.
 */
import type { AdminPermission } from '../services/authService';

export interface PermDef {
    key: AdminPermission;
    label: string;
    description: string;
    group: 'tabs' | 'actions';
    onlySuper?: boolean;
    defaultOn?: boolean;
    /** أين تُفرض فعلاً — للتوثيق ولمراجعة أن لكل صلاحية قارئاً. */
    enforcedAt: string;
}

export const ADMIN_PERMS: PermDef[] = [
    // ── التبويبات ──────────────────────────────────────────────────────────
    { key: 'tab_overview',  label: '🏠 الرئيسية',          description: 'نظرة عامة على المنصة', group: 'tabs', defaultOn: true,
      enforcedAt: 'AdminDashboard.visibleTabs' },
    { key: 'tab_buyers',    label: '🛒 المشترون',          description: 'تبويب المشترين وقراءة بياناتهم', group: 'tabs',
      enforcedAt: 'AdminDashboard + RLS users(SELECT)' },
    { key: 'tab_sellers',   label: '🏪 البائعون',          description: 'تبويب البائعين والمتاجر والفروع والاشتراكات', group: 'tabs',
      enforcedAt: 'AdminDashboard + RLS store_profiles/branches/subscriptions' },
    { key: 'tab_reports',   label: '🚩 البلاغات والشكاوى', description: 'مراجعة البلاغات والشكاوى والإنذارات', group: 'tabs',
      enforcedAt: 'AdminDashboard + RLS reports/complaints/warnings' },
    { key: 'tab_analytics', label: '📊 التحليلات',          description: 'مؤشرات لحظية ورسوم (بلا أرقام مالية)', group: 'tabs',
      enforcedAt: 'AdminDashboard + admin_rpc_permissions' },
    { key: 'tab_tools',     label: '🛠️ الأدوات',           description: 'الإعدادات والسجلّات وأدوات التشغيل', group: 'tabs',
      enforcedAt: 'AdminDashboard + RLS activity_log/sessions/settings' },
    { key: 'tab_messages',  label: '💬 مراقبة الرسائل',    description: 'متابعة المحادثات (القراءة فقط)', group: 'tabs',
      enforcedAt: 'AdminDashboard + admin_rpc_permissions' },
    { key: 'tab_contests',  label: '🎁 المسابقات',          description: 'الاستبيانات والجوائز والسحب', group: 'tabs',
      enforcedAt: 'AdminDashboard + RLS contests/entries/draws' },
    { key: 'tab_launch',    label: '🚀 الإطلاق',            description: 'الفحص الشامل وقائمة ما قبل الإطلاق', group: 'tabs',
      enforcedAt: 'AdminDashboard + admin_rpc_permissions' },
    { key: 'tab_admins',    label: '👑 إدارة المسؤولين',     description: 'هذه الصفحة — للأدمن الأعلى وحده', group: 'tabs', onlySuper: true,
      enforcedAt: 'AdminDashboard (isSuperAdmin)' },

    // ── الأفعال ────────────────────────────────────────────────────────────
    { key: 'action_impersonate',       label: '🔓 دخول كحساب آخر',         description: 'فتح جلسة كاملة كأي مستخدم', group: 'actions',
      enforcedAt: 'AdminBuyers/AdminSellers + edge fn admin-impersonate + RLS impersonation_log' },
    { key: 'action_view_finance',      label: '💰 الأمور المالية',          description: 'GMV والإيرادات والفواتير والاشتراكات', group: 'actions',
      enforcedAt: 'AdminOverview/AdminSellers/AdminInvoices + RLS order_invoices/payments' },
    { key: 'action_manage_users',      label: '✏️ تعديل حسابات المستخدمين', description: 'تعديل بيانات حساب أو إيقافه أو حذفه', group: 'actions',
      enforcedAt: 'AdminBuyers/AdminSellers + RLS users(UPDATE) + admin_update_user' },
    { key: 'action_delete_deals',      label: '🗑️ إخفاء/حذف العروض',        description: 'إخفاء منشور تاجر أو حذفه', group: 'actions',
      enforcedAt: '⏳ لم يُبنَ بعد — إجراءات الإخفاء والحذف في الرقابة قيد التنفيذ' },
    { key: 'action_manage_seasonal',   label: '🌟 عروض الموسم',             description: 'تثبيت متجر أو عرض في الموسم', group: 'actions',
      enforcedAt: 'RLS pinned_stores فقط — لا واجهة له اليوم (لا شاشة تثبّت متجراً)' },
    { key: 'action_manage_campaigns',  label: '📣 الحملات الترويجية',       description: 'إنشاء الحملات وبثّها وإيقافها', group: 'actions',
      enforcedAt: 'AdminTools + admin_rpc_permissions(broadcast)' },
    { key: 'action_manage_banners',    label: '🎨 البنرات الإعلانية',       description: 'بنرات داخل التطبيق', group: 'actions',
      enforcedAt: 'AdminTools + RLS banners' },
    { key: 'action_manage_sponsors',   label: '🤝 الرعاة الرسميون',         description: 'منح صفة راعٍ وتحديد الاستهداف', group: 'actions',
      enforcedAt: 'AdminSellers + RLS sponsors/sponsorships' },
    { key: 'action_moderate_messages', label: '🚨 حذف/إنذار في الرسائل',    description: 'حذف رسالة أو إنذار مستخدم', group: 'actions',
      enforcedAt: 'AdminMessages + admin_rpc_permissions' },
];

export const PERM_TABS    = ADMIN_PERMS.filter(p => p.group === 'tabs');
export const PERM_ACTIONS = ADMIN_PERMS.filter(p => p.group === 'actions');
export default ADMIN_PERMS;
