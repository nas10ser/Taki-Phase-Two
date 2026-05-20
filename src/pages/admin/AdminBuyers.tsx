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
import { CopyButton } from '../../components/admin/CopyButton';
import { Tooltip } from '../../components/admin/Tooltip';

// ============================================================
// User Edit Modal
// ============================================================
const UserEditModal = memo<{
    user: AdminUserRow;
    onClose: () => void;
    onSaved: () => void;
}>(({ user, onClose, onSaved }) => {
    const { customAlert, customConfirm } = useApp();
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
const UserRow = memo<{
    user: AdminUserRow;
    onEdit: (u: AdminUserRow) => void;
}>(({ user, onEdit }) => (
    <button
        onClick={() => onEdit(user)}
        className={`w-full text-right p-4 rounded-2xl border transition-all hover:shadow-md hover:-translate-y-0.5 ${
            user.is_suspended
                ? 'bg-red-50 border-red-200'
                : 'bg-[var(--card-bg)] border-[var(--border-color)] hover:border-blue-200'
        }`}
    >
        <div className="flex items-center gap-3">
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
            <div className="flex-shrink-0 text-left">
                <div className="text-lg font-extrabold text-blue-600 tabular-nums">
                    {user.total_bookings}
                </div>
                <div className="text-[10px] text-[var(--text-secondary)] font-medium">حجز</div>
            </div>
        </div>
    </button>
));
UserRow.displayName = 'UserRow';

// ============================================================
// Main Component
// ============================================================
const AdminBuyers: React.FC = () => {
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
    const PAGE_SIZE = 50;

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

    return (
        <div className="space-y-5 animate-fade-in" dir="rtl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">🛒 إدارة المشترين</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                        ابحث، اعرض، عدّل أي مشتري في المنصة
                    </p>
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
            ) : users.length === 0 ? (
                <div className="bg-[var(--card-bg)] rounded-2xl p-12 border border-dashed border-[var(--border-color)] text-center text-[var(--gray-400)]">
                    لا توجد نتائج. جرّب كلمة بحث أخرى.
                </div>
            ) : (
                <div className="space-y-2">
                    {users.map((u) => (
                        <UserRow key={u.id} user={u} onEdit={setEditing} />
                    ))}
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
