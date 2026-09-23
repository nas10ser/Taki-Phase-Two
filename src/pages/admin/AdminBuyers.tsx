/**
 * AdminBuyers — المشترون (v14.89 — أُعيد تنظيمها على نظام لوحة الإدارة)
 * ═══════════════════════════════════════════════════════════════════════════
 * ما تفعله الشاشة (بلا تغيير): بحثٌ بالاسم/الجوال/البريد · مرشّحات سريعة ·
 * مفضّلة محلّية · تحديد متعدّد (تعليق/استرجاع) · تصدير CSV · ترقيم صفحات ·
 * بطاقة تعديلٍ لكل مشترٍ (مع الدخول كَمستخدم والترقية لمسؤول حسب الصلاحية).
 *
 * 🔴 ما صُحِّح هنا — رقمٌ كان يكذب بنطاقه:
 *    شريطُ الأرقام أعلى الشاشة يُحسب من **الصفوف المعروضة وحدها** (حتى ٥٠
 *    صفّاً)، بينما شاشة «الرئيسية» تعرض عدد المنصّة كلّها بالاسم نفسه تقريباً
 *    — فيرى القارئ رقمين مختلفين للشيء ذاته ولا شيء يقول أيّهما أيّ. الآن كل
 *    رقمٍ يحمل `scope` يقول نطاقه صراحةً، والتسميات تقول «في هذه الصفحة».
 *    (ولا نداء جديد للقاعدة — نفس `searchUsers` ونفس الحساب.)
 *
 * 🪤 ولا `dark:` ولا `bg-white` ولا تدرّجات: الألوان رموز `--adm-*` تتبع
 *    `.dark-mode`/`.light-mode`، واللون للدلالة وحدها.
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
import { SmartChip } from '../../components/admin/SmartChip';
import {
    AdmCard, AdmSection, AdmStat, AdmStatGrid,
    AdmPill, AdmEmpty, AdmSkeleton, AdmButton, AdmSearch, AdmToolbar,
} from '../../components/admin/ui';
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

/** 🪤 `ar-SA` وحدها تُخرج تاريخاً هجرياً — التقويم يُثبَّت ميلادياً صراحةً. */
const fmtDate = (s?: string | null): string => {
    if (!s) return '—';
    const t = new Date(s).getTime();
    if (!Number.isFinite(t)) return '—';
    return new Date(t).toLocaleDateString('ar-SA-u-ca-gregory');
};

const num = (n: number | null | undefined): string => (n ?? 0).toLocaleString('ar-SA');

// ═══════════════════════════════════════════════════════════════════════════
// حقول النموذج
// ═══════════════════════════════════════════════════════════════════════════

const fieldStyle: React.CSSProperties = {
    width: '100%',
    padding: '9px 11px',
    fontSize: '.85rem',
    fontWeight: 600,
    borderRadius: 'var(--adm-r-sm)',
    border: '1px solid var(--adm-border)',
    background: 'var(--adm-surface-2)',
    color: 'var(--adm-fg)',
};

const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '.72rem',
    fontWeight: 800,
    color: 'var(--adm-fg-3)',
    marginBottom: 5,
};

const Field = memo<{
    label: string;
    value: string;
    onChange: (v: string) => void;
    type?: string;
    hint?: string;
}>(({ label, value, onChange, type = 'text', hint }) => (
    <label style={{ display: 'block' }}>
        <span style={labelStyle}>{label}</span>
        <input
            type={type}
            className="adm-focusable"
            style={fieldStyle}
            value={value}
            onChange={(e) => onChange(e.target.value)}
        />
        {hint && (
            <span style={{ display: 'block', fontSize: '.7rem', color: 'var(--adm-fg-3)', marginTop: 4 }}>
                {hint}
            </span>
        )}
    </label>
));
Field.displayName = 'Field';

// ═══════════════════════════════════════════════════════════════════════════
// بطاقة تعديل المشتري
// ═══════════════════════════════════════════════════════════════════════════
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
        if (saving) return;
        setSaving(true);
        // try/finally so a thrown error never leaves the button stuck on
        // "جاري الحفظ..." (v11.22).
        let res: { success: boolean; error?: string } = { success: false };
        try {
            // v14.32 — الإيقاف لا يمرّ مع بقية الحقول: `admin_update_user` تضبط
            // العمود ولا تمنع دخولاً ولا تُنهي جلسة ولا تُشعر أحداً. المسار
            // الصحيح دالةٌ مستقلّة، فنفصله عن الحفظ العادي.
            const wantsSuspendChange = form.is_suspended !== !!user.is_suspended;
            const { is_suspended: _drop, ...rest } = form as any;
            res = await adminService.updateUser(user.id, rest);
            if (res.success && wantsSuspendChange) {
                const sr = await adminService.suspendAccount(
                    user.id, form.is_suspended,
                    form.is_suspended ? (form.admin_notes || 'قرار إداري') : undefined);
                if (!sr.success) res = { success: false, error: sr.error };
            }
        } catch (e: any) {
            res = { success: false, error: e?.message || 'فشل الحفظ' };
        } finally {
            setSaving(false);
        }
        if (res.success) {
            await customAlert('✅ تم حفظ التغييرات بنجاح');
            onSaved();
            onClose();
        } else {
            await customAlert('❌ ' + (res.error ?? 'فشل الحفظ'));
        }
    };

    return (
        <div
            className="fixed inset-0 z-[3000] flex items-center justify-center p-4 animate-fade-in"
            style={{ background: 'rgba(8, 13, 20, .55)', backdropFilter: 'blur(3px)' }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={`بطاقة المشتري ${user.name}`}
                dir="rtl"
                style={{
                    width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto',
                    background: 'var(--adm-surface)',
                    border: '1px solid var(--adm-border)',
                    borderRadius: 'var(--adm-r)',
                    boxShadow: 'var(--adm-shadow-lift)',
                }}
            >
                {/* ── الرأس ───────────────────────────────────────────────── */}
                <div
                    style={{
                        position: 'sticky', top: 0, zIndex: 10,
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '13px 15px',
                        background: 'var(--adm-surface-2)',
                        borderBottom: '1px solid var(--adm-border)',
                    }}
                >
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 3 }}>
                            <span style={{ fontSize: '.7rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>بطاقة مشترٍ</span>
                            {user.is_suspended && <AdmPill tone="bad">معلّق</AdmPill>}
                            {isDirty && <AdmPill tone="warn">● تغييرات غير محفوظة</AdmPill>}
                        </div>
                        <div
                            style={{
                                fontSize: '1.05rem', fontWeight: 900, color: 'var(--adm-fg)',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                        >
                            {user.name}
                        </div>
                    </div>
                    <Tooltip text="إغلاق (Esc)">
                        <button
                            onClick={handleCloseRequest}
                            aria-label="إغلاق"
                            className="adm-focusable"
                            style={{
                                flexShrink: 0, width: 32, height: 32, borderRadius: 999,
                                border: '1px solid var(--adm-border)', background: 'var(--adm-surface)',
                                color: 'var(--adm-fg-2)', fontSize: '.9rem', cursor: 'pointer', lineHeight: 1,
                            }}
                        >
                            ✕
                        </button>
                    </Tooltip>
                </div>

                <div style={{ display: 'grid', gap: 16, padding: 15 }}>

                    {/* ── أرقامه ──────────────────────────────────────────── */}
                    <div>
                        <AdmStatGrid cols={2}>
                            <AdmStat
                                icon="🎟️"
                                label="حجوزاته"
                                value={num(user.total_bookings)}
                                scope="منذ تسجيله"
                            />
                            <AdmStat
                                icon="💳"
                                label="إجمالي صرفه"
                                value={`${num(user.total_spent)} ر.س`}
                                scope="مجموع طلباته المكتملة"
                            />
                        </AdmStatGrid>
                        <div
                            style={{
                                display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 9,
                                fontSize: '.73rem', color: 'var(--adm-fg-3)', fontWeight: 600,
                            }}
                        >
                            <span>آخر نشاط: {fmtDate(user.last_active_at)}</span>
                            <span>مسجَّل منذ: {fmtDate(user.created_at)}</span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} dir="ltr">
                                <span style={{ fontFamily: 'monospace' }}>{user.id.slice(0, 8)}…</span>
                                <CopyButton value={user.id} label="المعرّف" size="xs" />
                            </span>
                        </div>
                    </div>

                    {/* ── صلاحيات خاصّة ───────────────────────────────────────
                        الدخول كَمستخدم تبديلُ جلسةٍ كامل: كل حجزٍ ورسالةٍ وحذفٍ
                        بعده يُنسب إليه هو. v11.19 — محروسة بـ`action_impersonate`. */}
                    {(canImpersonate || canPromote) && (
                        <div
                            style={{
                                display: 'grid', gap: 9, padding: 12,
                                borderRadius: 'var(--adm-r-sm)',
                                border: '1px dashed var(--adm-border-strong)',
                                background: 'var(--adm-surface-2)',
                            }}
                        >
                            <div style={{ fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>
                                إجراءات حسّاسة — كلّها مسجَّلة في سِجل التدقيق
                            </div>
                            {canImpersonate && (
                                <>
                                    <AdmButton variant="danger" full disabled={opening} onClick={handleOpenAsUser}>
                                        {opening ? '⏳ جارٍ فتح الجلسة…' : '🔓 دخول كَهذا المشتري (جلسة كاملة)'}
                                    </AdmButton>
                                    <div style={{ fontSize: '.71rem', color: 'var(--adm-fg-2)', lineHeight: 1.75 }}>
                                        كأنّك سجّلت الدخول بحسابه — تحجز وتحذف وتُراسل وتُعدّل كما يفعل هو.
                                    </div>
                                </>
                            )}
                            {canPromote && (
                                <AdmButton variant="secondary" full disabled={promoting} onClick={handlePromote}>
                                    {promoting ? '⏳ جارٍ الترقية…' : '👑 ترقية لمسؤول (مع اختيار الصلاحيات)'}
                                </AdmButton>
                            )}
                        </div>
                    )}

                    {/* ── بياناته ─────────────────────────────────────────── */}
                    <div style={{ display: 'grid', gap: 12 }}>
                        <Field label="الاسم الكامل" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
                        <Field label="رقم الجوال" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
                        <Field label="البريد الإلكتروني" type="email" value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
                        <Field label="العنوان" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />

                        <label style={{ display: 'block' }}>
                            <span style={labelStyle}>ملاحظات الأدمن (داخلية)</span>
                            <textarea
                                className="adm-focusable"
                                style={{ ...fieldStyle, resize: 'vertical', lineHeight: 1.8 }}
                                rows={2}
                                value={form.admin_notes}
                                onChange={(e) => setForm({ ...form, admin_notes: e.target.value })}
                                placeholder="ملاحظات لن يراها المستخدم…"
                            />
                        </label>
                    </div>

                    {/* ── التعليق ─────────────────────────────────────────── */}
                    <div
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                            padding: 12, borderRadius: 'var(--adm-r-sm)',
                            background: form.is_suspended ? 'var(--adm-bad-bg)' : 'var(--adm-surface-2)',
                            border: `1px solid ${form.is_suspended ? 'var(--adm-bad-fg)' : 'var(--adm-border)'}`,
                        }}
                    >
                        <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '.85rem', fontWeight: 800, color: form.is_suspended ? 'var(--adm-bad-fg)' : 'var(--adm-fg)' }}>
                                تعليق الحساب
                            </div>
                            <div style={{ fontSize: '.73rem', lineHeight: 1.8, color: 'var(--adm-fg-2)', marginTop: 3 }}>
                                يُمنع من الدخول فوراً · تُنهى جلساته المفتوحة · وإن كان
                                تاجراً تختفي عروضه ولا ينشر غيرها
                            </div>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={form.is_suspended}
                            aria-label="تعليق الحساب"
                            onClick={() => setForm({ ...form, is_suspended: !form.is_suspended })}
                            className="adm-focusable"
                            style={{
                                flexShrink: 0, position: 'relative', width: 44, height: 24,
                                borderRadius: 999, border: 'none', cursor: 'pointer',
                                background: form.is_suspended ? 'var(--adm-bad-fg)' : 'var(--adm-border-strong)',
                                transition: 'background-color .15s',
                            }}
                        >
                            <span
                                style={{
                                    position: 'absolute', top: 4, insetInlineStart: form.is_suspended ? 24 : 4,
                                    width: 16, height: 16, borderRadius: 999,
                                    background: 'var(--adm-surface)', transition: 'inset-inline-start .15s',
                                }}
                            />
                        </button>
                    </div>
                </div>

                {/* ── الذيل ───────────────────────────────────────────────── */}
                <div
                    style={{
                        position: 'sticky', bottom: 0,
                        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10,
                        padding: 13,
                        background: 'var(--adm-surface-2)',
                        borderTop: '1px solid var(--adm-border)',
                    }}
                >
                    <AdmButton variant="secondary" full onClick={handleCloseRequest}>إلغاء (Esc)</AdmButton>
                    <AdmButton variant="primary" full disabled={saving || !isDirty} onClick={handleSave}>
                        {saving ? 'جارٍ الحفظ…' : isDirty ? '✅ حفظ التغييرات' : '— لا تغييرات —'}
                    </AdmButton>
                </div>
            </div>
        </div>
    );
});
UserEditModal.displayName = 'UserEditModal';

// ═══════════════════════════════════════════════════════════════════════════
// صفّ مشترٍ
// ═══════════════════════════════════════════════════════════════════════════
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
    const on = selectionMode && selected;

    // 🪤 الصفّ ليس `<button>`: بداخله زرّا النسخ والتثبيت، وزرٌّ داخل زرٍّ
    //    ترميزٌ غير صالح تتصرّف فيه المتصفّحات كما تشاء. صفٌّ بـ`role=button`
    //    ومعالجِ لوحة مفاتيح يحفظ نفس القدرة بلا تعشيش.
    return (
        <div
            role="button"
            tabIndex={0}
            aria-pressed={selectionMode ? selected : undefined}
            aria-label={`${user.name}${user.is_suspended ? ' — معلّق' : ''}`}
            onClick={handleClick}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); }
            }}
            className="adm-focusable"
            style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '9px 10px', cursor: 'pointer',
                borderRadius: 'var(--adm-r-sm)',
                border: `1px solid ${on ? 'var(--adm-accent)' : 'transparent'}`,
                background: on ? 'var(--adm-accent-weak)' : 'transparent',
                transition: 'background-color .12s, border-color .12s',
            }}
            onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = 'var(--adm-surface-2)'; }}
            onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}
        >
            {selectionMode && (
                <span
                    aria-hidden="true"
                    style={{
                        flexShrink: 0, width: 19, height: 19, borderRadius: 5,
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '.7rem', fontWeight: 900,
                        border: `2px solid ${selected ? 'var(--adm-accent)' : 'var(--adm-border-strong)'}`,
                        background: selected ? 'var(--adm-accent)' : 'transparent',
                        color: 'var(--adm-surface)',
                    }}
                >
                    {selected ? '✓' : ''}
                </span>
            )}

            <span
                aria-hidden="true"
                style={{
                    flexShrink: 0, width: 38, height: 38, borderRadius: 999,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '1rem', fontWeight: 900,
                    background: user.is_suspended ? 'var(--adm-bad-bg)' : 'var(--adm-surface-3)',
                    color: user.is_suspended ? 'var(--adm-bad-fg)' : 'var(--adm-fg-2)',
                }}
            >
                {user.name?.[0]?.toUpperCase() ?? '؟'}
            </span>

            <span style={{ flex: 1, minWidth: 0, display: 'block' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                    <span
                        style={{
                            fontSize: '.86rem', fontWeight: 800, color: 'var(--adm-fg)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                    >
                        {user.name}
                    </span>
                    {user.is_suspended && <AdmPill tone="bad">معلّق</AdmPill>}
                    {pinned && !selectionMode && <AdmPill tone="warn" title="مثبَّت في مفضّلتك">★</AdmPill>}
                </span>
                <span
                    style={{
                        display: 'flex', alignItems: 'center', gap: 5, marginTop: 2,
                        fontSize: '.74rem', color: 'var(--adm-fg-3)', fontWeight: 600,
                    }}
                    dir="ltr"
                >
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{user.phone ?? '—'}</span>
                    {user.phone && <CopyButton value={user.phone} label="الجوال" size="xs" />}
                </span>
            </span>

            <span style={{ flexShrink: 0, textAlign: 'center', minWidth: 46 }}>
                <span
                    style={{
                        display: 'block', fontSize: '1rem', fontWeight: 900,
                        color: 'var(--adm-fg)', fontVariantNumeric: 'tabular-nums', lineHeight: 1.2,
                    }}
                >
                    {num(user.total_bookings)}
                </span>
                <span style={{ display: 'block', fontSize: '.66rem', fontWeight: 700, color: 'var(--adm-fg-3)' }}>
                    حجز
                </span>
            </span>

            {!selectionMode && (
                <span style={{ flexShrink: 0 }}>
                    <PinButton pinned={pinned} onToggle={() => onTogglePin(user.id)} />
                </span>
            )}
        </div>
    );
});
UserRow.displayName = 'UserRow';

// ═══════════════════════════════════════════════════════════════════════════
// الشاشة
// ═══════════════════════════════════════════════════════════════════════════
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

    /**
     * 🪤 الأرقام تتبع **ما يراه القارئ أمامه**، لا الصفحة الخام.
     *    كانت تُحسب من `users` (الصفحة كلّها) بينما القائمة تحتها مُصفّاة
     *    بالمرشّح الذكيّ — فيختار «معلّق» فيرى ثلاثة صفوف وفوقها «٤٥ غير
     *    معلّق». رقمٌ صادقٌ عن مجموعةٍ لا يراها.
     *    (تُعرَّف بعد `filteredUsers` لأنها تعتمد عليها.)
     */

    /**
     * 🔴 نطاق الأرقام — الإصلاح الجوهري في هذه الشاشة.
     * `stats` محسوبةٌ من `users` وهي **الصفحة المعروضة وحدها** (حتى ٥٠ صفّاً
     * بعد تطبيق البحث). شاشة «الرئيسية» تعرض عدد المنصّة كاملاً بالاسم نفسه —
     * فبلا هذه الجملة يرى القارئ رقمين متناقضين ولا يعرف أيّهما يصدّق.
     */

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

    const stats = useMemo(() => {
        const active = filteredUsers.filter((u) => !u.is_suspended).length;
        const suspended = filteredUsers.length - active;
        const totalBookings = filteredUsers.reduce((sum, u) => sum + (u.total_bookings ?? 0), 0);
        return { active, suspended, totalBookings };
    }, [filteredUsers]);

    const scopeText = useMemo(() => (
        debouncedQuery.trim()
            ? `ضمن نتائج بحثك · ${num(filteredUsers.length)} صفّاً`
            : `في هذه الصفحة · ${num(filteredUsers.length)} صفّاً`
    ), [debouncedQuery, filteredUsers.length]);

    // أعداد الشرائح — تُحسب ممّا هو محمَّل أصلاً، بلا أي نداءٍ إضافي للقاعدة.
    const chipCounts = useMemo(() => {
        const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        let newWeek = 0, noBookings = 0, suspended = 0;
        for (const u of users) {
            if (u.created_at) {
                const t = new Date(u.created_at).getTime();
                if (Number.isFinite(t) && t >= weekAgo) newWeek++;
            }
            if ((u.total_bookings ?? 0) === 0) noBookings++;
            if (u.is_suspended) suspended++;
        }
        return { newWeek, noBookings, suspended };
    }, [users]);

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
                suspend ? '\nسيُمنعون من الدخول فوراً وتُنهى جلساتهم المفتوحة.' : ''
            }`
        );
        if (!ok) return;
        setBulkBusy(true);
        const ids = Array.from(selected);
        const results = await Promise.allSettled(
            ids.map((id) => adminService.suspendAccount(id, suspend, suspend ? 'قرار إداري جماعي' : undefined))
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

    /**
     * الحالة الفارغة تقول **لماذا** هي فارغة وماذا يفعل القارئ — لا «لا نتائج»
     * وحدها. ولكل سببٍ نصّه: مرشّحٌ لم يطابق ≠ بحثٌ لم يطابق ≠ صفحةٌ انتهت.
     */
    const emptyState = (): { icon: string; title: string; hint: string; action?: React.ReactNode } => {
        const showAll = <AdmButton size="sm" onClick={() => setSmartFilter('all')}>عرض كل المشترين</AdmButton>;
        if (smartFilter === 'pinned') {
            return pins.list.length === 0
                ? {
                    icon: '★',
                    title: 'لا أحد في مفضّلتك بعد',
                    hint: 'اضغط ☆ بجانب أي مشتري في القائمة ليبقى في الأعلى دائماً. المفضّلة محفوظة على هذا الجهاز وحده ولا يراها أحد غيرك.',
                    action: showAll,
                }
                : {
                    icon: '★',
                    title: 'لا أحد من مفضّلتك ضمن المعروض الآن',
                    hint: `عندك ${num(pins.list.length)} في المفضّلة، لكن المفضّلة تُصفّى ممّا هو معروضٌ في هذه الصفحة. امسح البحث أو ارجع للصفحة الأولى.`,
                    action: showAll,
                };
        }
        if (smartFilter === 'suspended') {
            return {
                icon: '🚫',
                title: 'لا حساب معلّق في هذه الصفحة',
                hint: 'المرشّح يبحث في الصفوف المعروضة أمامك وحدها — لا في كل المنصّة. جرّب صفحةً أخرى أو ابحث بالاسم.',
                action: showAll,
            };
        }
        if (smartFilter === 'no_bookings') {
            return {
                icon: '🪫',
                title: 'كل من في هذه الصفحة حجز مرّةً على الأقل',
                hint: 'لا يوجد حسابٌ بصفر حجوزات ضمن الصفوف المعروضة الآن.',
                action: showAll,
            };
        }
        if (smartFilter === 'new_week') {
            return {
                icon: '✨',
                title: 'لا مشتري جديد هذا الأسبوع هنا',
                hint: 'لم يسجّل أحدٌ من الصفوف المعروضة خلال آخر سبعة أيام.',
                action: showAll,
            };
        }
        if (debouncedQuery.trim()) {
            return {
                icon: '🔎',
                title: `لا نتائج لـ «${debouncedQuery.trim()}»`,
                hint: 'جرّب جزءاً من الاسم، أو آخر أرقام الجوال، أو البريد. وهذه الشاشة تبحث في المشترين وحدهم — التجّار في تبويب «التجّار».',
                action: <AdmButton size="sm" onClick={() => setQuery('')}>مسح البحث</AdmButton>,
            };
        }
        if (page > 0) {
            return {
                icon: '📄',
                title: 'لا مزيد من المشترين',
                hint: 'انتهت النتائج عند هذه الصفحة.',
                action: <AdmButton size="sm" onClick={() => setPage((p) => Math.max(0, p - 1))}>الرجوع للصفحة السابقة</AdmButton>,
            };
        }
        return {
            icon: '🛒',
            title: 'لا مشترين بعد',
            hint: 'أوّل من يسجّل حساباً كمشترٍ سيظهر هنا مباشرةً.',
        };
    };

    /**
     * مجموعات العرض — المفضّلة أوّلاً ثم الباقي.
     * 🪤 وهنا كان عيبٌ صامت في النسخة السابقة: مع مرشّح «المفضّلة» يصير كل
     *    المعروض مثبَّتاً ⇒ `restList` فارغة، وكتلةُ المفضّلة محروسة بـ
     *    `smartFilter !== 'pinned'` ⇒ لا تُعرض أي كتلة، فتظهر قائمةٌ بيضاء
     *    بلا حالةٍ فارغة تفسّرها. المرشّح يعرض الآن قائمةً مسطّحة بلا ترويسة.
     */
    const groups: Array<{ key: string; header: string | null; rows: AdminUserRow[]; pinned: boolean }> =
        smartFilter === 'pinned'
            ? [{ key: 'pins', header: null, rows: filteredUsers, pinned: true }]
            : [
                ...(pinnedList.length > 0
                    ? [{ key: 'pinned', header: `★ المفضّلة (${num(pinnedList.length)})`, rows: pinnedList, pinned: true }]
                    : []),
                ...(restList.length > 0
                    ? [{
                        key: 'rest',
                        header: pinnedList.length > 0 ? `باقي النتائج (${num(restList.length)})` : null,
                        rows: restList,
                        pinned: false,
                    }]
                    : []),
            ];

    return (
        <div style={{ display: 'grid', gap: 14 }} dir="rtl">

            {/* ── الرأس ───────────────────────────────────────────────────── */}
            {/* 🪤 v14.89b — كان هنا عنوان الشاشة ووصفها، وقشرةُ اللوحة تطبع
                الاثنين من `adminNav.ts` — فظهر العنوان مرّتين فوق بعضه بصياغتين
                مختلفتين (بلاغ ناصر). بقي الوصفُ التشغيليّ والإجراءات. */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <ExportButton
                    rows={filteredUsers}
                    columns={BUYER_CSV_COLUMNS}
                    filenameStem="taki-buyers"
                    tooltip="تنزيل القائمة المعروضة حالياً كملف CSV يفتح في Excel — ستحتوي على كل الحسابات بعد تطبيق البحث والفلاتر"
                />
                <AdmButton
                    variant={selectionMode ? 'primary' : 'secondary'}
                    onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
                    title={selectionMode ? 'إلغاء وضع التحديد' : 'تحديد عدة حسابات لإجراء جماعي'}
                >
                    {selectionMode ? '✕ خروج من التحديد' : '☑ تحديد متعدد'}
                </AdmButton>
            </div>

            {/* ── الأرقام ─────────────────────────────────────────────────── */}
            <div>
                <AdmStatGrid cols={3}>
                    <AdmStat
                        icon="🛒"
                        label="مشترون غير معلّقين"
                        value={num(stats.active)}
                        scope={scopeText}
                        title="عدد الحسابات غير المعلّقة بين الصفوف المعروضة أمامك الآن — لا في كل المنصّة."
                    />
                    <AdmStat
                        icon="🚫"
                        label="حسابات معلّقة"
                        value={num(stats.suspended)}
                        tone={stats.suspended > 0 ? 'bad' : 'neutral'}
                        scope={scopeText}
                        title="الحسابات الممنوعة من الدخول بين الصفوف المعروضة أمامك الآن."
                    />
                    <AdmStat
                        icon="🎟️"
                        label="مجموع حجوزاتهم"
                        value={num(stats.totalBookings)}
                        scope={scopeText}
                        title="مجموع حجوزات الصفوف المعروضة أمامك الآن، منذ تسجيل كلٍّ منهم."
                    />
                </AdmStatGrid>
                <p style={{ margin: '8px 2px 0', fontSize: '.72rem', lineHeight: 1.8, color: 'var(--adm-fg-3)', fontWeight: 600 }}>
                    هذه الثلاثة تُحسب من الصفوف المعروضة أمامك وحدها (حتى ٥٠ صفّاً في الصفحة)، لا من كل المنصّة —
                    الأعداد الكاملة في شاشة «الرئيسية».
                </p>
            </div>

            {/* ── البحث والمرشّحات ────────────────────────────────────────── */}
            <AdmCard>
                <AdmToolbar>
                    <AdmSearch
                        value={query}
                        onChange={setQuery}
                        label="بحث في المشترين"
                        placeholder="ابحث بالاسم أو الجوال أو البريد…"
                    />
                </AdmToolbar>
                <div
                    role="group"
                    aria-label="مرشّحات سريعة"
                    className="scrollbar-hide"
                    style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2 }}
                >
                    <SmartChip active={smartFilter === 'all'} onClick={() => setSmartFilter('all')}
                        icon="👥" label="الكل" count={users.length}
                        title="كل الصفوف المعروضة في هذه الصفحة" />
                    <SmartChip active={smartFilter === 'pinned'} onClick={() => setSmartFilter('pinned')}
                        icon="★" label="المفضّلة" count={pins.list.length}
                        title="المثبَّتون عندك على هذا الجهاز — يظهر منهم هنا من كان ضمن الصفحة المعروضة" />
                    <SmartChip active={smartFilter === 'new_week'} onClick={() => setSmartFilter('new_week')}
                        icon="✨" label="جدد هذا الأسبوع" count={chipCounts.newWeek}
                        title="من سجّل خلال آخر سبعة أيام" />
                    <SmartChip active={smartFilter === 'top_spender'} onClick={() => setSmartFilter('top_spender')}
                        icon="💎" label="الأكثر صرفاً"
                        title="ترتيبٌ تنازلي بإجمالي الصرف — لا يُخفي أحداً" />
                    <SmartChip active={smartFilter === 'no_bookings'} onClick={() => setSmartFilter('no_bookings')}
                        icon="🪫" label="بدون حجوزات" count={chipCounts.noBookings}
                        title="حسابات لم تحجز ولا مرّة" />
                    <SmartChip active={smartFilter === 'suspended'} onClick={() => setSmartFilter('suspended')}
                        icon="🚫" label="معلّق" count={chipCounts.suspended}
                        title="الحسابات الممنوعة من الدخول" />
                </div>
            </AdmCard>

            {/* ── شريط الإجراء الجماعي ────────────────────────────────────── */}
            {selectionMode && (
                <div
                    style={{
                        position: 'sticky', top: 60, zIndex: 20,
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 10, flexWrap: 'wrap', padding: '10px 12px',
                        background: 'var(--adm-surface)',
                        border: '1px solid var(--adm-accent)',
                        borderRadius: 'var(--adm-r)',
                        boxShadow: 'var(--adm-shadow-lift)',
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '.8rem', fontWeight: 800, color: 'var(--adm-fg)' }}>محدّد:</span>
                        <AdmPill tone={selected.size > 0 ? 'info' : 'neutral'}>{num(selected.size)}</AdmPill>
                        {selected.size > 0 && (
                            <AdmButton size="sm" variant="ghost" onClick={clearSelected}>مسح التحديد</AdmButton>
                        )}
                        {bulkBusy && (
                            <span style={{ fontSize: '.74rem', fontWeight: 700, color: 'var(--adm-fg-2)' }}>
                                ⏳ جارٍ التنفيذ…
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                        <AdmButton
                            size="sm"
                            variant="secondary"
                            disabled={filteredUsers.length === 0}
                            onClick={() => setSelected(new Set(filteredUsers.map((u) => u.id)))}
                        >
                            تحديد الكل ({num(filteredUsers.length)})
                        </AdmButton>
                        <AdmButton
                            size="sm"
                            variant="danger"
                            disabled={selected.size === 0 || bulkBusy}
                            onClick={() => bulkSetSuspended(true)}
                        >
                            🚫 تعليق
                        </AdmButton>
                        <AdmButton
                            size="sm"
                            variant="primary"
                            disabled={selected.size === 0 || bulkBusy}
                            onClick={() => bulkSetSuspended(false)}
                        >
                            ✅ استرجاع
                        </AdmButton>
                    </div>
                </div>
            )}

            {/* ── القائمة ─────────────────────────────────────────────────── */}
            <AdmSection
                icon="📋"
                title="القائمة"
                desc={
                    selectionMode
                        ? 'اضغط أي صفّ لتحديده أو إلغاء تحديده، ثم اختر الإجراء من الشريط أعلاه.'
                        : 'اضغط أي صفّ لفتح بطاقته وتعديل بياناته. ☆ تُثبّت المشتري في أعلى القائمة على هذا الجهاز.'
                }
                badge={loading ? undefined : { text: `${num(filteredUsers.length)} صفّاً`, tone: 'neutral' }}
            >
                {loading ? (
                    <AdmSkeleton rows={6} height={56} />
                ) : filteredUsers.length === 0 ? (
                    <AdmEmpty {...emptyState()} />
                ) : (
                    <div style={{ display: 'grid', gap: 2 }}>
                        {groups.map((g, gi) => (
                            <React.Fragment key={g.key}>
                                {g.header && (
                                    <div
                                        style={{
                                            fontSize: '.7rem', fontWeight: 800,
                                            color: g.pinned ? 'var(--adm-warn-fg)' : 'var(--adm-fg-3)',
                                            padding: gi === 0 ? '2px 4px 4px' : '10px 4px 4px',
                                            borderTop: gi === 0 ? undefined : '1px solid var(--adm-border)',
                                            marginTop: gi === 0 ? undefined : 6,
                                        }}
                                    >
                                        {g.header}
                                    </div>
                                )}
                                {g.rows.map((u) => (
                                    <UserRow
                                        key={u.id}
                                        user={u}
                                        onEdit={setEditing}
                                        pinned={g.pinned}
                                        onTogglePin={pins.toggle}
                                        selectionMode={selectionMode}
                                        selected={selected.has(u.id)}
                                        onToggleSelect={toggleSelected}
                                    />
                                ))}
                            </React.Fragment>
                        ))}
                    </div>
                )}
            </AdmSection>

            {/* ── الترقيم ─────────────────────────────────────────────────────
                🪤 الشرط القديم كان `users.length === PAGE_SIZE` وحده: فصفحةٌ
                أخيرة ناقصة تُخفي الشريط كلّه — بما فيه زرّ «السابق» — فيعلق
                القارئ في آخر صفحة بلا طريق رجوع. */}
            {(page > 0 || users.length === PAGE_SIZE) && (
                <AdmCard padded={false}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px' }}>
                        <AdmButton size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                            ← السابق
                        </AdmButton>
                        <span style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--adm-fg-2)' }}>
                            صفحة {num(page + 1)} · {num(users.length)} صفّاً
                        </span>
                        <AdmButton size="sm" disabled={users.length < PAGE_SIZE || loading} onClick={() => setPage((p) => p + 1)}>
                            التالي →
                        </AdmButton>
                    </div>
                </AdmCard>
            )}

            {/* ── بطاقة التعديل ───────────────────────────────────────────── */}
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
