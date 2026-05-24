/**
 * AdminAdmins v11.19 — manage staff admins and their permissions.
 *
 * Visible only to super admins (Nasser). Lists every account with
 * `user_type='admin'`, lets the super admin tick which permissions each
 * staff member holds, and demote them back to buyer/seller if needed.
 *
 * Promotion happens from AdminBuyers / AdminSellers — a separate page
 * would force the super admin to remember a user's id; promoting in-context
 * is far more ergonomic.
 *
 * The catalogue of permission keys lives in `authService.ts` (AdminPermission
 * union) and in the v11_19 migration. Three are intentional read-only:
 *  - super admin's row cannot be edited via RPC (would be a self-coup).
 *  - the staff-admin themselves cannot self-promote (the RPC validates super).
 *  - `tab_admins` only makes sense for super admins, so we hide it from the
 *    grid — staff admins should not see who else is staff.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';
import type { AdminPermission } from '../../services/authService';

interface StaffAdmin {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    user_type: string;
    is_super_admin: boolean;
    admin_permissions: string[];
    created_at: string | null;
}

interface PermDef {
    key: AdminPermission;
    label: string;
    description: string;
    group: 'tabs' | 'actions';
    onlySuper?: boolean;
}

// Catalogue rendered in the grid. Order matters — first by group, then by
// importance. `tab_overview` is intentionally always-on for staff (an admin
// with zero permissions is useless), but we still surface it as a checkbox
// so the super admin sees the full surface area.
const PERMS: PermDef[] = [
    { key: 'tab_overview',  label: '🏠 الرئيسية',         description: 'نظرة عامة على المنصة', group: 'tabs' },
    { key: 'tab_buyers',    label: '🛒 المشترون',         description: 'تبويب المشترين + التعديل', group: 'tabs' },
    { key: 'tab_sellers',   label: '🏪 البائعون',         description: 'تبويب البائعين + التعديل', group: 'tabs' },
    { key: 'tab_reports',   label: '🚩 البلاغات والشكاوى', description: 'مراجعة البلاغات + التعامل معها', group: 'tabs' },
    { key: 'tab_analytics', label: '📊 التحليلات',         description: 'مؤشرات لحظية ورسوم', group: 'tabs' },
    { key: 'tab_tools',     label: '🛠️ الأدوات',          description: 'البنرات والحملات والإعدادات', group: 'tabs' },
    { key: 'tab_admins',    label: '👑 إدارة المسؤولين',    description: 'هذه الصفحة (super admin فقط)', group: 'tabs', onlySuper: true },
    { key: 'action_impersonate',       label: '🔓 دخول كحساب آخر',        description: 'فتح جلسة كاملة كأي مستخدم', group: 'actions' },
    { key: 'action_view_finance',      label: '💰 الأمور المالية',          description: 'GMV/MRR/الإيرادات/الاشتراكات', group: 'actions' },
    { key: 'action_manage_users',      label: '✏️ تعديل حسابات المستخدمين', description: 'تغيير بيانات أو حذف حسابات', group: 'actions' },
    { key: 'action_delete_deals',      label: '🗑️ حذف العروض',              description: 'حذف منشورات التجار', group: 'actions' },
    { key: 'action_manage_seasonal',   label: '🌟 عروض الموسم',             description: 'تثبيت / إلغاء عروض الموسم', group: 'actions' },
    { key: 'action_manage_campaigns',  label: '📣 الحملات الترويجية',       description: 'إنشاء / تعديل / إيقاف الحملات', group: 'actions' },
    { key: 'action_manage_banners',    label: '🎨 البنرات الإعلانية',       description: 'بنرات الإعلانات داخل التطبيق', group: 'actions' },
];

const AdminAdmins: React.FC = () => {
    const { user, isSuperAdmin, customAlert, customConfirm } = useApp();
    const [staff, setStaff] = useState<StaffAdmin[]>([]);
    const [loading, setLoading] = useState(true);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [pendingPerms, setPendingPerms] = useState<Record<string, string[]>>({});

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error } = await supabase.rpc('admin_list_staff');
            if (error) throw error;
            setStaff((data || []) as StaffAdmin[]);
            // Seed pending state from server truth so checkbox toggles
            // compare against the same baseline.
            const baseline: Record<string, string[]> = {};
            (data || []).forEach((s: StaffAdmin) => { baseline[s.id] = [...(s.admin_permissions || [])]; });
            setPendingPerms(baseline);
        } catch (e: any) {
            customAlert('فشل تحميل قائمة المسؤولين: ' + (e?.message || ''));
        } finally {
            setLoading(false);
        }
    }, [customAlert]);

    useEffect(() => { refresh(); }, [refresh]);

    const togglePerm = (adminId: string, perm: string) => {
        setPendingPerms(prev => {
            const current = new Set(prev[adminId] || []);
            if (current.has(perm)) current.delete(perm);
            else current.add(perm);
            return { ...prev, [adminId]: Array.from(current) };
        });
    };

    const dirty = useCallback((row: StaffAdmin) => {
        const pending = pendingPerms[row.id] || [];
        const server = row.admin_permissions || [];
        if (pending.length !== server.length) return true;
        const set = new Set(pending);
        return server.some(p => !set.has(p));
    }, [pendingPerms]);

    const save = async (row: StaffAdmin) => {
        if (row.is_super_admin) return; // protected; UI shouldn't allow this anyway
        setSavingId(row.id);
        try {
            const { error } = await supabase.rpc('admin_set_permissions', {
                target_id: row.id,
                perms: pendingPerms[row.id] || []
            });
            if (error) throw error;
            await refresh();
        } catch (e: any) {
            customAlert('فشل الحفظ: ' + (e?.message || ''));
        } finally {
            setSavingId(null);
        }
    };

    const demote = async (row: StaffAdmin, role: 'buyer' | 'seller') => {
        if (row.is_super_admin) return;
        const ok = await customConfirm(
            `هل أنت متأكد من إزالة صلاحيات المسؤول من «${row.name || row.email || row.id}»؟ سيرجع كـ${role === 'buyer' ? 'مشتري' : 'تاجر'} عادي.`
        );
        if (!ok) return;
        setSavingId(row.id);
        try {
            const { error } = await supabase.rpc('admin_demote_user', { target_id: row.id, target_role: role });
            if (error) throw error;
            await refresh();
        } catch (e: any) {
            customAlert('فشل الإزالة: ' + (e?.message || ''));
        } finally {
            setSavingId(null);
        }
    };

    const tabPerms = useMemo(() => PERMS.filter(p => p.group === 'tabs'), []);
    const actionPerms = useMemo(() => PERMS.filter(p => p.group === 'actions'), []);

    if (!isSuperAdmin) {
        return (
            <div className="text-center py-20" dir="rtl">
                <div className="text-6xl mb-3">🔒</div>
                <h2 className="text-xl font-extrabold text-[var(--text-primary)]">صفحة مخصصة للمسؤول الرئيسي</h2>
                <p className="text-sm text-[var(--text-secondary)] mt-2">إدارة الصلاحيات متاحة فقط لمالك المنصة.</p>
            </div>
        );
    }

    return (
        <div dir="rtl">
            <div className="bg-gradient-to-l from-amber-50 to-rose-50 border border-amber-200 rounded-2xl p-4 mb-4">
                <div className="flex items-start gap-3">
                    <div className="text-2xl">👑</div>
                    <div className="flex-1">
                        <h2 className="font-extrabold text-amber-900 text-lg">إدارة المسؤولين</h2>
                        <p className="text-sm text-amber-800 mt-1 leading-6">
                            هنا تتحكم بكامل صلاحيات الفريق. كل مسؤول يرى فقط التبويبات والأزرار المسموح بها له.
                            الصلاحيات تطبق فوراً بعد الحفظ — المسؤول لا يحتاج تسجيل خروج.
                            لإضافة مسؤول جديد: افتح حسابه من تبويب «المشترون» أو «البائعون» واضغط «👑 ترقية لمسؤول».
                        </p>
                    </div>
                </div>
            </div>

            {loading && (
                <div className="text-center py-20">
                    <div className="w-10 h-10 mx-auto rounded-full border-4 border-emerald-200 border-t-emerald-500 animate-spin" />
                    <p className="text-sm text-[var(--text-secondary)] mt-3 font-bold">جاري التحميل...</p>
                </div>
            )}

            {!loading && staff.length === 0 && (
                <div className="text-center py-20 bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)]">
                    <div className="text-5xl mb-3">👥</div>
                    <p className="font-bold text-[var(--text-primary)]">لا يوجد مسؤولون بعد</p>
                    <p className="text-sm text-[var(--text-secondary)] mt-2">رقّ أي مستخدم من تبويب المشترين أو البائعين.</p>
                </div>
            )}

            <div className="flex flex-col gap-4">
                {staff.map(row => {
                    const isSelf = row.id === user?.id;
                    const isProtected = row.is_super_admin;
                    const isDirty = !isProtected && dirty(row);
                    const isSaving = savingId === row.id;
                    return (
                        <div key={row.id} className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 shadow-sm">
                            <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                                <div>
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="font-extrabold text-[var(--text-primary)] text-base">
                                            {row.name || '(بدون اسم)'}
                                        </span>
                                        {isProtected && (
                                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-gradient-to-l from-amber-500 to-rose-500 text-white">
                                                👑 المسؤول الرئيسي
                                            </span>
                                        )}
                                        {isSelf && !isProtected && (
                                            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                                أنت
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-xs text-[var(--text-secondary)] mt-1 font-mono">
                                        {row.email || row.phone || row.id}
                                    </div>
                                </div>
                                <div className="flex gap-2">
                                    {!isProtected && (
                                        <>
                                            <button
                                                disabled={!isDirty || isSaving}
                                                onClick={() => save(row)}
                                                className={`px-4 py-2 rounded-xl text-sm font-extrabold transition ${
                                                    isDirty && !isSaving
                                                        ? 'bg-emerald-500 text-white hover:bg-emerald-600 shadow'
                                                        : 'bg-[var(--gray-100)] text-[var(--gray-400)] cursor-not-allowed'
                                                }`}
                                            >
                                                {isSaving ? '⏳ جاري الحفظ...' : isDirty ? '💾 حفظ التغييرات' : '✓ محفوظ'}
                                            </button>
                                            <button
                                                disabled={isSaving}
                                                onClick={() => demote(row, 'buyer')}
                                                className="px-3 py-2 rounded-xl text-xs font-bold bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 transition"
                                                title="إزالة الصلاحيات وإرجاع كمشتري"
                                            >
                                                إزالة المسؤول
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {isProtected ? (
                                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
                                    🔒 المسؤول الرئيسي لديه كل الصلاحيات تلقائياً. لا يمكن تعديلها من هنا.
                                </div>
                            ) : (
                                <>
                                    <div className="mb-2">
                                        <div className="text-xs font-extrabold text-[var(--text-secondary)] mb-2 uppercase">التبويبات التي يراها</div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                            {tabPerms.filter(p => !p.onlySuper).map(p => {
                                                const checked = (pendingPerms[row.id] || []).includes(p.key);
                                                return (
                                                    <label
                                                        key={p.key}
                                                        className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition ${
                                                            checked
                                                                ? 'bg-emerald-50 border-emerald-300'
                                                                : 'bg-[var(--body-bg)] border-[var(--border-color)] hover:bg-[var(--gray-100)]'
                                                        }`}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => togglePerm(row.id, p.key)}
                                                            className="mt-1 w-4 h-4 accent-emerald-500"
                                                        />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-sm font-extrabold text-[var(--text-primary)]">{p.label}</div>
                                                            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{p.description}</div>
                                                        </div>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div>
                                        <div className="text-xs font-extrabold text-[var(--text-secondary)] mt-3 mb-2 uppercase">الإجراءات المسموح بها</div>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                                            {actionPerms.map(p => {
                                                const checked = (pendingPerms[row.id] || []).includes(p.key);
                                                return (
                                                    <label
                                                        key={p.key}
                                                        className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition ${
                                                            checked
                                                                ? 'bg-blue-50 border-blue-300'
                                                                : 'bg-[var(--body-bg)] border-[var(--border-color)] hover:bg-[var(--gray-100)]'
                                                        }`}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => togglePerm(row.id, p.key)}
                                                            className="mt-1 w-4 h-4 accent-blue-500"
                                                        />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="text-sm font-extrabold text-[var(--text-primary)]">{p.label}</div>
                                                            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{p.description}</div>
                                                        </div>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default AdminAdmins;
