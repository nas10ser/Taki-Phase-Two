/**
 * AdminBuyers — إدارة المشترين
 *
 * تتيح للأدمن:
 *  - بحث متقدم بالاسم/الجوال/الإيميل
 *  - عرض جدول مع pagination ذكي
 *  - النقر على أي مشتري يفتح modal للتعديل
 *  - تعطيل/تفعيل/حذف ناعم
 *  - رؤية إحصائيات المشتري (عدد الحجوزات، إجمالي المصروف)
 */

import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { useLocation } from 'react-router-dom';
import { adminService, AdminUserRow } from '../../services/adminService';
import { useApp } from '../../context/AppContext';
import { useEscClose } from '../../hooks/useEscClose';
import { useLocalStringList } from '../../hooks/useLocalStringList';
import { useAdminRecents } from '../../hooks/useAdminRecents';
import { CopyButton } from '../../components/admin/CopyButton';
import { Tooltip } from '../../components/admin/Tooltip';
import { PinButton } from '../../components/admin/PinButton';
import { ExportButton } from '../../components/admin/ExportButton';
import { CsvColumn } from '../../utils/csvExport';

// CSV layout for buyer exports. Ordering here = column order in Excel.
const BUYER_CSV_COLUMNS: CsvColumn<AdminUserRow>[] = [
    { header: 'الاسم',          accessor: (u) => u.name },
    { header: 'الجوال',         accessor: (u) => u.phone ?? '' },
    { header: 'الإيميل',        accessor: (u) => u.email ?? '' },
    { header: 'العنوان',        accessor: (u) => u.address ?? '' },
    { header: 'عدد الحجوزات',   accessor: (u) => u.total_bookings ?? 0 },
    { header: 'إجمالي الصرف',   accessor: (u) => u.total_spent ?? 0 },
    { header: 'معلّق',          accessor: (u) => (u.is_suspended ? 'نعم' : 'لا') },
    { header: 'آخر نشاط',       accessor: (u) => u.last_active_at ?? '' },
    { header: 'تاريخ التسجيل',  accessor: (u) => u.created_at ?? '' },
    { header: 'المعرّف',         accessor: (u) => u.id },
];

// ============================================================
// User Edit Modal
// ============================================================
const UserEditModal = memo<{
    user: AdminUserRow;
    onClose: () => void;
    onSaved: () => void;
}>(({ user, onClose, onSaved }) => {
    const { customAlert, customConfirm, startImpersonating, hasPermission, isSuperAdmin } = useApp();
    // v11.19 — both admin powers (impersonate + promote) are
    // permission-gated. The super admin gets both automatically.
    const canImpersonate = hasPermission('action_impersonate');
    const canPromote = isSuperAdmin && user.user_type !== 'admin';
    // Loading flag for the "act as user" button — the start chain takes
    // ~2 s (edge fn + verifyOtp + reload), and without visible feedback
    // the admin assumed the first tap was ignored and tapped again.
    const [opening, setOpening] = useState(false);
    const [promoting, setPromoting] = useState(false);
    const handleOpenAsUser = useCallback(async () => {
        if (opening) return;
        setOpening(true);
        try { await startImpersonating(user.id); }
        finally { setOpening(false); }
    }, [opening, startImpersonating, user.id]);

    // Promote this buyer to staff admin. Opens a granular permission picker
    // (the same one used in AdminAdmins) so the super admin can decide what
    // the new admin can do BEFORE granting them the role.
    const handlePromote = useCallback(async () => {
        if (promoting || !canPromote) return;
        const { default: openPromoteDialog } = await import('../../components/admin/PromoteToAdminDialog');
        const perms = await openPromoteDialog(user.name || user.email || user.id);
        if (!perms) return; // cancelled
        setPromoting(true);
        try {
            const { supabase } = await import('../../services/supabaseClient');
            const { error } = await supabase.rpc('admin_promote_user', { target_id: user.id, perms });
            if (error) throw error;
            await customAlert('✅ تمت الترقية لمسؤول. الصلاحيات نشطة فوراً.');
            onSaved();
            onClose();
        } catch (e: any) {
            await customAlert('❌ ' + (e?.message || 'فشلت الترقية'));
        } finally {
            setPromoting(false);
        }
    }, [promoting, canPromote, user.id, user.name, user.email, customAlert, onSaved, onClose]);
    const [form, setForm] = useState({
        name: user.name ?? '',
        phone: user.phone ?? '',
        email: user.email ?? '',
        address: user.address ?? '',
        is_suspended: !!user.is_suspended,
        admin_notes: '',
    });
    const [saving, setSaving] = useState(false);

    // Track whether the form has unsaved edits so an accidental Esc/click
    // can't quietly wipe what the admin typed.
    const isDirty =
        form.name !== (user.name ?? '') ||
        form.phone !== (user.phone ?? '') ||
        form.email !== (user.email ?? '') ||
        form.address !== (user.address ?? '') ||
        form.is_suspended !== !!user.is_suspended ||
        form.admin_notes !== '';

    const handleCloseRequest = useCallback(async () => {
        if (!isDirty) { onClose(); return; }
        const ok = await customConfirm('لديك تغييرات غير محفوظة. هل تريد الإغلاق دون حفظ؟');
        if (ok) onClose();
    }, [isDirty, onClose, customConfirm]);

    useEscClose(true, handleCloseRequest);

    const handleSave = async () => {
        setSaving(true);
        const res = await adminService.updateUser(user.id, form);
        setSaving(false);
        if (res.success) {
            await customAlert('✅ تم حفظ التغييرات بنجاح');
            onSaved();
            onClose();
        } else {
            await customAlert('❌ ' + (res.error ?? 'فشل الحفظ'));
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[3000] flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-[var(--card-bg)] rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-gradient-to-r from-blue-500 to-indigo-600 text-white p-5 rounded-t-3xl flex items-center justify-between z-10">
                    <div className="min-w-0">
                        <div className="text-xs opacity-80 flex items-center gap-1.5">
                            تعديل مشتري
                            {isDirty && (
                                <span className="inline-flex items-center gap-1 bg-white/20 px-2 py-0.5 rounded-full text-[10px] font-extrabold">
                                    ● غير محفوظ
                                </span>
                            )}
                        </div>
                        <div className="text-xl font-bold truncate">{user.name}</div>
                    </div>
                    <Tooltip text="إغلاق (Esc)">
                        <button
                            onClick={handleCloseRequest}
                            aria-label="إغلاق"
                            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-xl flex-shrink-0"
                        >
                            ✕
                        </button>
                    </Tooltip>
                </div>

                {/* Act-as-user action — full session swap. After clicking,
                    the admin's Supabase session becomes this buyer's: every
                    booking, message, deletion is attributed to them.
                    v11.19 — gated on `action_impersonate` permission. */}
                {(canImpersonate || canPromote) && (
                    <div className="px-4 pt-4 space-y-2">
                        {canImpersonate && (
                            <>
                                <button
                                    type="button"
                                    onClick={handleOpenAsUser}
                                    disabled={opening}
                                    className="w-full p-3 bg-gradient-to-r from-rose-500 via-red-500 to-red-600 text-white font-extrabold rounded-2xl text-sm hover:shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-wait"
                                >
                                    {opening ? (
                                        <>
                                            <span className="inline-block w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                                            <span>جاري فَتح الجَلسة...</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-base">🔓</span>
                                            <span>دخول كَهذا المُشتري (جَلسة كاملة)</span>
                                        </>
                                    )}
                                </button>
                                <div className="text-[10px] text-[var(--text-secondary)] text-center">
                                    كأنّك سَجَّلت دخول بِحسابه — تَحجز، تَحذف، تُراسِل، تُعدِّل كَما يَفعل. كل إجراء مُسجَّل في سِجل التَّدقيق.
                                </div>
                            </>
                        )}
                        {canPromote && (
                            <button
                                type="button"
                                onClick={handlePromote}
                                disabled={promoting}
                                className="w-full p-3 bg-gradient-to-r from-amber-500 to-orange-600 text-white font-extrabold rounded-2xl text-sm hover:shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                            >
                                {promoting ? (
                                    <>
                                        <span className="inline-block w-4 h-4 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                                        <span>جاري الترقية...</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-base">👑</span>
                                        <span>ترقية لمسؤول (مع اختيار الصلاحيات)</span>
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                )}

                {/* Stats badge row */}
                <div className="grid grid-cols-3 gap-2 p-4 bg-[var(--body-bg)] border-b">
                    <div className="text-center">
                        <div className="text-2xl font-extrabold text-blue-600">{user.total_bookings}</div>
                        <div className="text-[10px] text-[var(--text-secondary)] font-medium">حجز</div>
                    </div>
                    <div className="text-center">
                        <div className="text-2xl font-extrabold text-emerald-600">
                            {(user.total_spent ?? 0).toLocaleString('ar-SA')}
                        </div>
                        <div className="text-[10px] text-[var(--text-secondary)] font-medium">ر.س مصروفة</div>
                    </div>
                    <div className="text-center">
                        <div className="text-xs font-bold text-[var(--text-primary)] mt-1">
                            {user.last_active_at
                                ? new Date(user.last_active_at).toLocaleDateString('ar-SA')
                                : '—'}
                        </div>
                        <div className="text-[10px] text-[var(--text-secondary)] font-medium">آخر نشاط</div>
                    </div>
                </div>

                {/* Form */}
                <div className="p-5 space-y-4">
                    <Field
                        label="الاسم الكامل"
                        value={form.name}
                        onChange={(v) => setForm({ ...form, name: v })}
                    />
                    <Field
                        label="رقم الجوال"
                        value={form.phone}
                        onChange={(v) => setForm({ ...form, phone: v })}
                    />
                    <Field
                        label="البريد الإلكتروني"
                        value={form.email}
                        onChange={(v) => setForm({ ...form, email: v })}
                        type="email"
                    />
                    <Field
                        label="العنوان"
                        value={form.address}
                        onChange={(v) => setForm({ ...form, address: v })}
                    />

                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">
                            ملاحظات الأدمن (داخلية)
                        </label>
                        <textarea
                            className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-blue-500 focus:bg-[var(--card-bg)] outline-none transition-all"
                            rows={2}
                            value={form.admin_notes}
                            onChange={(e) => setForm({ ...form, admin_notes: e.target.value })}
                            placeholder="ملاحظات لن يراها المستخدم..."
                        />
                    </div>

                    {/* Suspend toggle */}
                    <div className="flex items-center justify-between p-3 bg-red-50 rounded-xl border border-red-100">
                        <div>
                            <div className="font-bold text-sm text-red-800">تعليق الحساب</div>
                            <div className="text-xs text-red-600 mt-0.5">
                                المستخدم لن يستطيع تسجيل الدخول
                            </div>
                        </div>
                        <button
                            onClick={() => setForm({ ...form, is_suspended: !form.is_suspended })}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                form.is_suspended ? 'bg-red-500' : 'bg-[var(--gray-300)]'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-[var(--card-bg)] transition-transform ${
                                    form.is_suspended ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 p-4 bg-[var(--body-bg)] rounded-b-3xl flex gap-3 border-t border-[var(--border-color)]">
                    <button
                        onClick={handleCloseRequest}
                        className="flex-1 py-3 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] font-bold rounded-xl hover:bg-[var(--gray-100)]"
                    >
                        إلغاء (Esc)
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving || !isDirty}
                        className="flex-1 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-bold rounded-xl hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {saving ? 'جاري الحفظ...' : isDirty ? '✅ حفظ التغييرات' : '— لا تغييرات —'}
                    </button>
                </div>
            </div>
        </div>
    );
});
UserEditModal.displayName = 'UserEditModal';

const Field = memo<{
    label: string;
    value: string;
    onChange: (v: string) => void;
    type?: string;
}>(({ label, value, onChange, type = 'text' }) => (
    <div>
        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">{label}</label>
        <input
            type={type}
            className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-blue-500 focus:bg-[var(--card-bg)] outline-none transition-all"
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
    </div>
));
Field.displayName = 'Field';

// ============================================================
// User Row
// ============================================================
interface UserRowProps {
    user: AdminUserRow;
    onEdit: (u: AdminUserRow) => void;
    pinned: boolean;
    onTogglePin: (id: string) => void;
    selectionMode: boolean;
    selected: boolean;
    onToggleSelect: (id: string) => void;
}

const UserRow = memo<UserRowProps>(({
    user, onEdit, pinned, onTogglePin, selectionMode, selected, onToggleSelect,
}) => {
    const handleClick = () => {
        if (selectionMode) onToggleSelect(user.id);
        else onEdit(user);
    };
    return (
        <button
            onClick={handleClick}
            className={`w-full text-right p-4 rounded-2xl border transition-all hover:shadow-md hover:-translate-y-0.5 ${
                selectionMode && selected
                    ? 'bg-blue-50 border-blue-500 ring-2 ring-blue-200'
                    : user.is_suspended
                    ? 'bg-red-50 border-red-200'
                    : 'bg-[var(--card-bg)] border-[var(--border-color)] hover:border-blue-200'
            }`}
        >
            <div className="flex items-center gap-3">
                {selectionMode && (
                    <div
                        className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-all ${
                            selected
                                ? 'bg-blue-500 border-blue-500 text-white'
                                : 'bg-[var(--card-bg)] border-[var(--gray-300)]'
                        }`}
                        aria-hidden
                    >
                        {selected && <span className="text-xs">✓</span>}
                    </div>
                )}
                <div
                    className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0 ${
                        user.is_suspended
                            ? 'bg-red-100 text-red-600'
                            : 'bg-gradient-to-br from-blue-100 to-indigo-100 text-blue-600'
                    }`}
                >
                    {user.name?.[0]?.toUpperCase() ?? '?'}
                </div>
                <div className="flex-1 min-w-0 text-right">
                    <div className="font-bold text-sm text-[var(--text-primary)] truncate flex items-center gap-2">
                        {user.name}
                        {user.is_suspended && (
                            <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-bold">
                                معلّق
                            </span>
                        )}
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5 truncate flex items-center gap-1.5" dir="ltr">
                        {user.phone ?? '—'}
                        {user.phone && <CopyButton value={user.phone} label="الجوال" size="xs" />}
                    </div>
                </div>
                <div className="flex-shrink-0 text-left flex items-center gap-2">
                    <div>
                        <div className="text-lg font-extrabold text-blue-600 tabular-nums">
                            {user.total_bookings}
                        </div>
                        <div className="text-[10px] text-[var(--text-secondary)] font-medium">حجز</div>
                    </div>
                    {!selectionMode && (
                        <PinButton pinned={pinned} onToggle={() => onTogglePin(user.id)} />
                    )}
                </div>
            </div>
        </button>
    );
});
UserRow.displayName = 'UserRow';

// ============================================================
// Smart filter chip (compact, scrolling-friendly)
// ============================================================
const SmartChip: React.FC<{
    active: boolean;
    onClick: () => void;
    icon: string;
    label: string;
    count?: number;
}> = ({ active, onClick, icon, label, count }) => (
    <button
        onClick={onClick}
        className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-extrabold transition-all whitespace-nowrap ${
            active
                ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow'
                : 'bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-blue-300'
        }`}
    >
        <span>{icon}</span>
        <span>{label}</span>
        {count !== undefined && count > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${
                active ? 'bg-white/20' : 'bg-[var(--gray-100)]'
            }`}>{count}</span>
        )}
    </button>
);
SmartChip.displayName = 'SmartChip';

// ============================================================
// Main Component
// ============================================================
type SmartFilter = 'all' | 'pinned' | 'new_week' | 'top_spender' | 'no_bookings' | 'suspended';

const AdminBuyers: React.FC = () => {
    const { customAlert, customConfirm } = useApp();
    const location = useLocation();
    const initialQuery = useMemo(() => {
        // Deep-link from CommandPalette: /admin?tab=buyers&q=name
        try {
            return new URLSearchParams(location.search).get('q') ?? '';
        } catch { return ''; }
    }, [location.search]);

    const [query, setQuery] = useState(initialQuery);
    const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
    const [users, setUsers] = useState<AdminUserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<AdminUserRow | null>(null);
    const [page, setPage] = useState(0);
    const [smartFilter, setSmartFilter] = useState<SmartFilter>('all');
    const [selectionMode, setSelectionMode] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [bulkBusy, setBulkBusy] = useState(false);
    const pins = useLocalStringList('taki:admin:buyers:pins', { maxItems: 50 });
    const { push: pushRecent } = useAdminRecents();
    const PAGE_SIZE = 50;

    // Push to recents whenever the admin opens a buyer's edit modal.
    useEffect(() => {
        if (editing) {
            pushRecent({
                id: editing.id,
                name: editing.name ?? 'مشتري',
                type: 'buyer',
                phone: editing.phone,
            });
        }
    }, [editing, pushRecent]);

    // Toggle selection for bulk operations.
    const toggleSelected = useCallback((id: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);
    const clearSelected = useCallback(() => setSelected(new Set()), []);
    const exitSelection = useCallback(() => {
        setSelectionMode(false);
        setSelected(new Set());
    }, []);

    // Sync the input whenever the URL `q` changes (covers re-navigating
    // from the palette while already on this tab).
    useEffect(() => {
        if (initialQuery && initialQuery !== query) {
            setQuery(initialQuery);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialQuery]);

    // Debounce search
    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(t);
    }, [query]);

    const fetchUsers = useCallback(async () => {
        setLoading(true);
        const data = await adminService.searchUsers(
            debouncedQuery,
            'buyer',
            PAGE_SIZE,
            page * PAGE_SIZE
        );
        setUsers(data);
        setLoading(false);
    }, [debouncedQuery, page]);

    useEffect(() => {
        fetchUsers();
    }, [fetchUsers]);

    const stats = useMemo(() => {
        const active = users.filter((u) => !u.is_suspended).length;
        const suspended = users.length - active;
        const totalBookings = users.reduce((s, u) => s + (u.total_bookings ?? 0), 0);
        return { active, suspended, totalBookings };
    }, [users]);

    // Apply the active smart filter. Filters compose with the text search
    // because the underlying RPC already restricts by `debouncedQuery`.
    const filteredUsers = useMemo(() => {
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        switch (smartFilter) {
            case 'pinned':
                return users.filter((u) => pins.has(u.id));
            case 'new_week':
                return users.filter((u) => {
                    if (!u.created_at) return false;
                    const t = new Date(u.created_at).getTime();
                    return Number.isFinite(t) && t >= weekAgo;
                });
            case 'top_spender':
                return [...users].sort((a, b) => (b.total_spent ?? 0) - (a.total_spent ?? 0));
            case 'no_bookings':
                return users.filter((u) => (u.total_bookings ?? 0) === 0);
            case 'suspended':
                return users.filter((u) => u.is_suspended);
            default:
                return users;
        }
    }, [users, smartFilter, pins]);

    // Split into pinned vs the rest so favourites float to the top.
    const { pinnedList, restList } = useMemo(() => {
        const pinnedList: AdminUserRow[] = [];
        const restList: AdminUserRow[] = [];
        for (const u of filteredUsers) {
            if (pins.has(u.id)) pinnedList.push(u);
            else restList.push(u);
        }
        return { pinnedList, restList };
    }, [filteredUsers, pins]);

    // Bulk operations — suspend / unsuspend selected. We don't expose
    // bulk delete from the UI: deletion is irreversible and routinely
    // requested in admin tools is a footgun for a non-technical owner.
    const bulkSetSuspended = async (suspend: boolean) => {
        if (selected.size === 0) return;
        const ok = await customConfirm(
            `${suspend ? 'تعليق' : 'استرجاع'} ${selected.size} حساب؟${
                suspend ? '\nالحسابات المُعلَّقة لا تستطيع تسجيل الدخول.' : ''
            }`
        );
        if (!ok) return;
        setBulkBusy(true);
        const ids = Array.from(selected);
        const results = await Promise.allSettled(
            ids.map((id) => adminService.updateUser(id, { is_suspended: suspend }))
        );
        const okCount = results.filter(
            (r) => r.status === 'fulfilled' && (r.value as any).success,
        ).length;
        const failed = results.length - okCount;
        setBulkBusy(false);
        await customAlert(
            failed === 0
                ? `✅ تم ${suspend ? 'تعليق' : 'استرجاع'} ${okCount} حساب`
                : `⚠️ نجح: ${okCount} | فشل: ${failed}`
        );
        exitSelection();
        fetchUsers();
    };

    return (
        <div className="space-y-5 animate-fade-in" dir="rtl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">🛒 إدارة المشترين</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                        ابحث، اعرض، عدّل أي مشتري في المنصة
                    </p>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <ExportButton
                        rows={filteredUsers}
                        columns={BUYER_CSV_COLUMNS}
                        filenameStem="taki-buyers"
                        accent="blue"
                        tooltip="تنزيل القائمة المعروضة حالياً كملف CSV يفتح في Excel — ستحتوي على كل الحسابات بعد تطبيق البحث والفلاتر"
                    />
                    <Tooltip text={selectionMode ? 'إلغاء وضع التحديد' : 'تحديد عدة حسابات لإجراء جماعي'}>
                        <button
                            onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
                            className={`px-4 h-10 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${
                                selectionMode
                                    ? 'bg-blue-600 text-white shadow'
                                    : 'bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-blue-300 text-[var(--text-secondary)]'
                            }`}
                        >
                            {selectionMode ? '✕ خروج من التحديد' : '☑ تحديد متعدد'}
                        </button>
                    </Tooltip>
                </div>
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-3 gap-3">
                <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm">
                    <div className="text-2xl font-extrabold text-blue-600">{stats.active}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">مشتري نشط</div>
                </div>
                <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm">
                    <div className="text-2xl font-extrabold text-red-500">{stats.suspended}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">معلّق</div>
                </div>
                <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm">
                    <div className="text-2xl font-extrabold text-emerald-600">{stats.totalBookings}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">إجمالي الحجوزات</div>
                </div>
            </div>

            {/* Search */}
            <div className="relative">
                <input
                    type="text"
                    placeholder="🔍 ابحث بالاسم، الجوال، الإيميل..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full px-5 py-4 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-sm text-sm focus:border-blue-500 focus:shadow-md outline-none transition-all"
                />
            </div>

            {/* Smart filter chips */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                <SmartChip active={smartFilter === 'all'}          onClick={() => setSmartFilter('all')}          icon="👥" label="الكل" />
                <SmartChip active={smartFilter === 'pinned'}       onClick={() => setSmartFilter('pinned')}       icon="★"  label="المفضّلة" count={pins.list.length} />
                <SmartChip active={smartFilter === 'new_week'}     onClick={() => setSmartFilter('new_week')}     icon="✨" label="جدد هذا الأسبوع" />
                <SmartChip active={smartFilter === 'top_spender'}  onClick={() => setSmartFilter('top_spender')}  icon="💎" label="الأكثر صرفاً" />
                <SmartChip active={smartFilter === 'no_bookings'}  onClick={() => setSmartFilter('no_bookings')}  icon="🪫" label="بدون حجوزات" />
                <SmartChip active={smartFilter === 'suspended'}    onClick={() => setSmartFilter('suspended')}    icon="🚫" label="معلّق" />
            </div>

            {/* Bulk action toolbar — visible only in selection mode */}
            {selectionMode && (
                <div className="sticky top-[60px] z-10 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-2xl p-3 shadow-lg flex items-center justify-between gap-3 flex-wrap animate-fade-in">
                    <div className="flex items-center gap-2 font-bold text-sm">
                        <span>محدّد:</span>
                        <span className="bg-white/20 px-2.5 py-0.5 rounded-full tabular-nums">{selected.size}</span>
                        {selected.size > 0 && (
                            <button onClick={clearSelected} className="text-xs underline opacity-90 hover:opacity-100">
                                مسح
                            </button>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => {
                                const ids = new Set(filteredUsers.map((u) => u.id));
                                setSelected(ids);
                            }}
                            className="px-3 py-1.5 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-bold"
                        >
                            تحديد الكل ({filteredUsers.length})
                        </button>
                        <button
                            onClick={() => bulkSetSuspended(true)}
                            disabled={selected.size === 0 || bulkBusy}
                            className="px-3 py-1.5 bg-red-500 hover:bg-red-600 rounded-lg text-xs font-bold disabled:opacity-50"
                        >
                            🚫 تعليق
                        </button>
                        <button
                            onClick={() => bulkSetSuspended(false)}
                            disabled={selected.size === 0 || bulkBusy}
                            className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 rounded-lg text-xs font-bold disabled:opacity-50"
                        >
                            ✅ استرجاع
                        </button>
                    </div>
                </div>
            )}

            {/* Users List */}
            {loading ? (
                <div className="space-y-2">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div
                            key={i}
                            className="h-20 bg-gradient-to-r from-[var(--gray-100)] to-[var(--gray-50)] rounded-2xl animate-pulse"
                        />
                    ))}
                </div>
            ) : filteredUsers.length === 0 ? (
                <div className="bg-[var(--card-bg)] rounded-2xl p-12 border border-dashed border-[var(--border-color)] text-center text-[var(--gray-400)]">
                    {smartFilter === 'pinned'
                        ? 'لا يوجد مشترين في مفضّلتك بعد. اضغط ★ بجانب أي مشتري لإضافته.'
                        : 'لا توجد نتائج. جرّب كلمة بحث أخرى أو فلتر مختلف.'}
                </div>
            ) : (
                <div className="space-y-3">
                    {pinnedList.length > 0 && smartFilter !== 'pinned' && (
                        <div>
                            <div className="text-xs font-extrabold text-amber-700 mb-2 flex items-center gap-1.5 px-1">
                                ★ المفضّلة ({pinnedList.length})
                            </div>
                            <div className="space-y-2">
                                {pinnedList.map((u) => (
                                    <UserRow
                                        key={u.id}
                                        user={u}
                                        onEdit={setEditing}
                                        pinned={true}
                                        onTogglePin={pins.toggle}
                                        selectionMode={selectionMode}
                                        selected={selected.has(u.id)}
                                        onToggleSelect={toggleSelected}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                    {restList.length > 0 && (
                        <div>
                            {pinnedList.length > 0 && smartFilter !== 'pinned' && (
                                <div className="text-xs font-extrabold text-[var(--text-secondary)] mb-2 px-1">
                                    باقي النتائج ({restList.length})
                                </div>
                            )}
                            <div className="space-y-2">
                                {restList.map((u) => (
                                    <UserRow
                                        key={u.id}
                                        user={u}
                                        onEdit={setEditing}
                                        pinned={false}
                                        onTogglePin={pins.toggle}
                                        selectionMode={selectionMode}
                                        selected={selected.has(u.id)}
                                        onToggleSelect={toggleSelected}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Pagination */}
            {users.length === PAGE_SIZE && (
                <div className="flex items-center justify-between">
                    <button
                        disabled={page === 0}
                        onClick={() => setPage(page - 1)}
                        className="px-4 py-2 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl font-bold text-sm disabled:opacity-50"
                    >
                        ← السابق
                    </button>
                    <span className="text-sm text-[var(--text-secondary)]">صفحة {page + 1}</span>
                    <button
                        onClick={() => setPage(page + 1)}
                        className="px-4 py-2 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl font-bold text-sm"
                    >
                        التالي →
                    </button>
                </div>
            )}

            {/* Edit Modal */}
            {editing && (
                <UserEditModal
                    user={editing}
                    onClose={() => setEditing(null)}
                    onSaved={fetchUsers}
                />
            )}
        </div>
    );
};

export default memo(AdminBuyers);
