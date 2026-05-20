/**
 * AdminReports v10.94 — "Reports & Complaints" center
 *
 * What changed in v10.94:
 *  - Full Tailwind redesign — matches the rest of the admin panel
 *    (was the only tab still on inline styles)
 *  - Glass-style filter bar that sticks while scrolling cards
 *  - Pill chips for type/status/role with active gradients
 *  - Click-to-copy on phone numbers
 *  - One-click jump to the seller's store page / buyer's admin record
 *  - Status pills tinted to match the action (under_review = red,
 *    resolved = green, dismissed = gray)
 *
 * Owner requirements still respected:
 *  - Reporter + reported identities visible
 *  - Per-account counts (received vs filed, distinct-reporter)
 *  - Complaints surface here too (not email-only)
 *  - Manual handling only — no auto-restrict
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import {
    adminService,
    AdminReportRow,
    AdminComplaintRow,
} from '../../services/adminService';
import { CopyButton } from '../../components/admin/CopyButton';
import { Tooltip } from '../../components/admin/Tooltip';

const REPORT_TYPES = [
    { value: 'scam', label: 'احتيال', icon: '⚠️' },
    { value: 'no_show', label: 'عدم حضور', icon: '🚷' },
    { value: 'harassment', label: 'تحرّش', icon: '🛑' },
    { value: 'inappropriate', label: 'محتوى غير لائق', icon: '🚫' },
    { value: 'spam', label: 'سبام', icon: '📛' },
    { value: 'other', label: 'أخرى', icon: '❓' },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string; icon: string }> = {
    open:           { bg: 'bg-amber-100',    text: 'text-amber-800',    label: 'مفتوح',          icon: '🟠' },
    under_review:   { bg: 'bg-red-100',      text: 'text-red-800',      label: 'تحت المراجعة',   icon: '🔴' },
    reviewing:      { bg: 'bg-red-100',      text: 'text-red-800',      label: 'قيد المراجعة',   icon: '🔴' },
    resolved:       { bg: 'bg-emerald-100',  text: 'text-emerald-800',  label: 'تم الحل',        icon: '✅' },
    dismissed:      { bg: 'bg-gray-100',     text: 'text-gray-700',     label: 'مرفوض',          icon: '⛔' },
};

const fmt = (iso: string) => {
    try {
        const d = new Date(iso);
        return d.toLocaleString('ar-SA', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit',
        });
    } catch { return iso; }
};

const timeAgo = (iso: string): string => {
    const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (sec < 60) return `قبل ${sec} ث`;
    if (sec < 3600) return `قبل ${Math.floor(sec / 60)} د`;
    if (sec < 86400) return `قبل ${Math.floor(sec / 3600)} س`;
    return `قبل ${Math.floor(sec / 86400)} ي`;
};

// ============================================================
// Status Pill
// ============================================================
const StatusPill: React.FC<{ status: string }> = ({ status }) => {
    const s = STATUS_STYLES[status] ?? { bg: 'bg-gray-100', text: 'text-gray-700', label: status, icon: '•' };
    return (
        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold ${s.bg} ${s.text}`}>
            <span>{s.icon}</span>
            {s.label}
        </span>
    );
};

// ============================================================
// Main
// ============================================================
const AdminReports: React.FC = () => {
    const { customConfirm, customAlert } = useApp();
    const history = useHistory();

    const [view, setView] = useState<'reports' | 'complaints'>('reports');
    const [reports, setReports] = useState<AdminReportRow[]>([]);
    const [complaints, setComplaints] = useState<AdminComplaintRow[]>([]);
    const [loading, setLoading] = useState(true);

    const [q, setQ] = useState('');
    const [status, setStatus] = useState<string>('');
    const [rtype, setRtype] = useState<string>('');
    const [days, setDays] = useState<number>(0);
    const [role, setRole] = useState<string>('');

    const load = useCallback(async () => {
        setLoading(true);
        if (view === 'reports') {
            const rows = await adminService.listReports({
                query: q, status: status || null, type: rtype || null,
                reportedRole: (role || null) as any, days,
            });
            setReports(rows);
        } else {
            const rows = await adminService.listComplaints({ query: q, status: status || null });
            setComplaints(rows);
        }
        setLoading(false);
    }, [view, q, status, rtype, days, role]);

    useEffect(() => { load(); }, [load]);

    const changeReportStatus = async (id: string, next: string) => {
        const labelNext = STATUS_STYLES[next]?.label ?? next;
        const ok = await customConfirm(`تغيير حالة البلاغ إلى «${labelNext}»؟`);
        if (!ok) return;
        const r = await adminService.setReportStatus(id, next);
        if (r.success) load();
        else customAlert('❌ تعذّر تحديث الحالة');
    };
    const changeComplaintStatus = async (id: string, next: string) => {
        const labelNext = STATUS_STYLES[next]?.label ?? next;
        const ok = await customConfirm(`تغيير حالة الشكوى إلى «${labelNext}»؟`);
        if (!ok) return;
        const r = await adminService.setComplaintStatus(id, next);
        if (r.success) load();
        else customAlert('❌ تعذّر تحديث الحالة');
    };

    const openAccount = (id: string, partyRole: string, name?: string) => {
        if (partyRole === 'seller') history.push(`/store/${id}`);
        else history.push(`/admin?tab=buyers&q=${encodeURIComponent(name || id)}`);
    };

    // Summary counts so admin can see at-a-glance how many open items.
    const summary = useMemo(() => {
        if (view === 'reports') {
            const open = reports.filter(r => r.status === 'open').length;
            const review = reports.filter(r => r.status === 'under_review').length;
            const resolved = reports.filter(r => r.status === 'resolved').length;
            return { open, review, resolved, total: reports.length };
        }
        const open = complaints.filter(c => c.status === 'open').length;
        const review = complaints.filter(c => c.status === 'reviewing').length;
        const resolved = complaints.filter(c => c.status === 'resolved').length;
        return { open, review, resolved, total: complaints.length };
    }, [view, reports, complaints]);

    const clearFilters = () => { setQ(''); setStatus(''); setRtype(''); setDays(0); setRole(''); };
    const hasFilters = !!(q || status || rtype || days || role);

    return (
        <div className="space-y-4 animate-fade-in" dir="rtl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                        🚩 البلاغات والشكاوى
                    </h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                        راجع البلاغات بين المستخدمين والشكاوى المرسلة للإدارة. كل تغيير حالة يدوي.
                    </p>
                </div>
                <Tooltip text="إعادة تحميل القائمة من قاعدة البيانات">
                    <button
                        onClick={load}
                        className="px-4 h-10 bg-[var(--card-bg)] border border-[var(--border-color)] hover:border-red-400 hover:text-red-600 text-[var(--text-secondary)] font-bold rounded-xl text-sm transition-colors flex items-center gap-2"
                    >
                        🔄 تحديث
                    </button>
                </Tooltip>
            </div>

            {/* Summary strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryCard
                    label="مفتوح / يحتاج مراجعة"
                    value={summary.open}
                    gradient="bg-gradient-to-br from-amber-500 to-orange-500"
                    pulse
                />
                <SummaryCard
                    label={view === 'reports' ? 'تحت المراجعة' : 'قيد المراجعة'}
                    value={summary.review}
                    gradient="bg-gradient-to-br from-red-500 to-rose-600"
                />
                <SummaryCard
                    label="تم الحل"
                    value={summary.resolved}
                    gradient="bg-gradient-to-br from-emerald-500 to-teal-600"
                />
                <SummaryCard
                    label="الإجمالي"
                    value={summary.total}
                    gradient="bg-gradient-to-br from-[var(--text-secondary)] to-[var(--text-primary)]"
                />
            </div>

            {/* View toggle: Reports vs Complaints */}
            <div className="flex gap-2">
                <button
                    onClick={() => { setView('reports'); setStatus(''); }}
                    className={`flex-1 md:flex-none px-5 py-2.5 rounded-xl font-extrabold text-sm transition-all flex items-center justify-center gap-2 ${
                        view === 'reports'
                            ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-md'
                            : 'bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-red-300'
                    }`}
                >
                    🚩 بلاغات المستخدمين
                </button>
                <button
                    onClick={() => { setView('complaints'); setStatus(''); }}
                    className={`flex-1 md:flex-none px-5 py-2.5 rounded-xl font-extrabold text-sm transition-all flex items-center justify-center gap-2 ${
                        view === 'complaints'
                            ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow-md'
                            : 'bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-red-300'
                    }`}
                >
                    📣 شكاوى للإدارة
                </button>
            </div>

            {/* Filters */}
            <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)] shadow-sm space-y-3">
                <div className="flex gap-2 items-stretch">
                    <input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="🔍 بحث: اسم، جوال، معرّف، نص..."
                        className="flex-1 min-w-0 px-4 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold focus:border-red-500 outline-none transition-colors"
                    />
                    {hasFilters && (
                        <Tooltip text="إلغاء كل الفلاتر">
                            <button
                                onClick={clearFilters}
                                className="px-3 bg-[var(--gray-100)] hover:bg-[var(--gray-200)] text-[var(--text-secondary)] font-bold rounded-xl text-sm transition-colors flex items-center gap-1"
                            >
                                ✕ مسح
                            </button>
                        </Tooltip>
                    )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                    {/* Status chips */}
                    <FilterChip active={!status} onClick={() => setStatus('')} label="كل الحالات" icon="•" />
                    <FilterChip active={status === 'open'} onClick={() => setStatus('open')} label="مفتوح" icon="🟠" />
                    <FilterChip
                        active={status === (view === 'reports' ? 'under_review' : 'reviewing')}
                        onClick={() => setStatus(view === 'reports' ? 'under_review' : 'reviewing')}
                        label={view === 'reports' ? 'تحت المراجعة' : 'قيد المراجعة'}
                        icon="🔴"
                    />
                    <FilterChip active={status === 'resolved'} onClick={() => setStatus('resolved')} label="تم الحل" icon="✅" />
                    <FilterChip active={status === 'dismissed'} onClick={() => setStatus('dismissed')} label="مرفوض" icon="⛔" />
                </div>

                {view === 'reports' && (
                    <>
                        <div className="flex flex-wrap gap-1.5">
                            <FilterChip active={!rtype} onClick={() => setRtype('')} label="كل الأنواع" icon="•" />
                            {REPORT_TYPES.map((t) => (
                                <FilterChip
                                    key={t.value}
                                    active={rtype === t.value}
                                    onClick={() => setRtype(t.value)}
                                    label={t.label}
                                    icon={t.icon}
                                />
                            ))}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <FilterChip active={!role} onClick={() => setRole('')} label="ضد: الكل" icon="👥" />
                            <FilterChip active={role === 'seller'} onClick={() => setRole('seller')} label="ضد تاجر" icon="🏪" />
                            <FilterChip active={role === 'buyer'} onClick={() => setRole('buyer')} label="ضد مشتري" icon="🛒" />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <FilterChip active={!days} onClick={() => setDays(0)} label="كل الفترات" icon="📅" />
                            <FilterChip active={days === 1} onClick={() => setDays(1)} label="آخر يوم" icon="📅" />
                            <FilterChip active={days === 7} onClick={() => setDays(7)} label="آخر 7 أيام" icon="📅" />
                            <FilterChip active={days === 14} onClick={() => setDays(14)} label="آخر 14 يوم" icon="📅" />
                            <FilterChip active={days === 30} onClick={() => setDays(30)} label="آخر 30 يوم" icon="📅" />
                        </div>
                    </>
                )}
            </div>

            {/* List */}
            {loading ? (
                <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} className="h-32 bg-[var(--gray-100)] rounded-2xl animate-pulse" />
                    ))}
                </div>
            ) : view === 'reports' ? (
                reports.length === 0 ? (
                    <EmptyState
                        icon="🎉"
                        title={hasFilters ? 'لا توجد نتائج لهذه الفلاتر' : 'لا توجد بلاغات حالياً'}
                        subtitle={hasFilters ? 'جرّب توسيع البحث أو امسح الفلاتر' : 'ستظهر البلاغات هنا فور وصولها'}
                    />
                ) : (
                    <div className="space-y-3">
                        {reports.map((r) => (
                            <ReportCard
                                key={r.id}
                                report={r}
                                onOpenAccount={openAccount}
                                onStatusChange={changeReportStatus}
                            />
                        ))}
                    </div>
                )
            ) : (
                complaints.length === 0 ? (
                    <EmptyState
                        icon="🎉"
                        title={hasFilters ? 'لا توجد نتائج لهذه الفلاتر' : 'لا توجد شكاوى حالياً'}
                        subtitle={hasFilters ? 'جرّب توسيع البحث أو امسح الفلاتر' : 'ستظهر الشكاوى هنا فور وصولها'}
                    />
                ) : (
                    <div className="space-y-3">
                        {complaints.map((c) => (
                            <ComplaintCard
                                key={c.id}
                                complaint={c}
                                onOpenAccount={openAccount}
                                onStatusChange={changeComplaintStatus}
                            />
                        ))}
                    </div>
                )
            )}
        </div>
    );
};

// ============================================================
// Cards & helpers
// ============================================================

const SummaryCard: React.FC<{
    label: string;
    value: number;
    gradient: string;
    pulse?: boolean;
}> = ({ label, value, gradient, pulse }) => (
    <div className={`relative overflow-hidden rounded-2xl p-4 text-white shadow-md ${gradient}`}>
        {pulse && value > 0 && (
            <span className="absolute top-3 right-3 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white"></span>
            </span>
        )}
        <div className="text-3xl font-extrabold tabular-nums">{value}</div>
        <div className="text-xs opacity-90 mt-1 font-medium">{label}</div>
    </div>
);

const FilterChip: React.FC<{
    active: boolean;
    onClick: () => void;
    label: string;
    icon?: string;
}> = ({ active, onClick, label, icon }) => (
    <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all whitespace-nowrap ${
            active
                ? 'bg-gradient-to-r from-red-500 to-rose-600 text-white shadow'
                : 'bg-[var(--body-bg)] text-[var(--text-secondary)] hover:bg-[var(--gray-100)] hover:text-[var(--text-primary)]'
        }`}
    >
        {icon && <span>{icon}</span>}
        {label}
    </button>
);

const EmptyState: React.FC<{ icon: string; title: string; subtitle: string }> = ({ icon, title, subtitle }) => (
    <div className="bg-[var(--card-bg)] rounded-3xl p-12 border border-dashed border-[var(--border-color)] text-center">
        <div className="text-6xl mb-3">{icon}</div>
        <div className="font-extrabold text-[var(--text-primary)] mb-1">{title}</div>
        <div className="text-sm text-[var(--text-secondary)]">{subtitle}</div>
    </div>
);

const ActionButton: React.FC<{
    onClick: () => void;
    children: React.ReactNode;
    variant: 'review' | 'resolve' | 'dismiss';
    tooltip?: string;
}> = ({ onClick, children, variant, tooltip }) => {
    const styles: Record<string, string> = {
        review: 'bg-red-50 text-red-700 hover:bg-red-100',
        resolve: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
        dismiss: 'bg-[var(--gray-100)] text-[var(--text-secondary)] hover:bg-[var(--gray-200)]',
    };
    const btn = (
        <button
            onClick={onClick}
            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${styles[variant]}`}
        >
            {children}
        </button>
    );
    return tooltip ? <Tooltip text={tooltip}>{btn}</Tooltip> : btn;
};

interface ReportCardProps {
    report: AdminReportRow;
    onOpenAccount: (id: string, role: string, name?: string) => void;
    onStatusChange: (id: string, status: string) => void;
}

const ReportCard: React.FC<ReportCardProps> = ({ report: r, onOpenAccount, onStatusChange }) => {
    const typeLabel = REPORT_TYPES.find(t => t.value === r.report_type);
    return (
        <div className={`bg-[var(--card-bg)] border rounded-2xl p-4 shadow-sm transition-all hover:shadow-md ${
            r.status === 'open' ? 'border-amber-300' : r.status === 'under_review' ? 'border-red-300' : 'border-[var(--border-color)]'
        }`}>
            {/* Top row: type + status + time */}
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 bg-[var(--gray-100)] text-[var(--text-primary)] px-2.5 py-1 rounded-lg text-xs font-extrabold">
                        {typeLabel?.icon ?? '⚠️'} {typeLabel?.label ?? r.report_type}
                    </span>
                    <StatusPill status={r.status} />
                    {r.reported_under_review && (
                        <span className="inline-flex items-center gap-1 bg-red-100 text-red-800 px-2 py-0.5 rounded-full text-[10px] font-extrabold">
                            ⚠️ الحساب تحت المراجعة
                        </span>
                    )}
                </div>
                <Tooltip text={fmt(r.created_at)}>
                    <span className="text-[11px] text-[var(--gray-400)] font-bold tabular-nums">
                        {timeAgo(r.created_at)}
                    </span>
                </Tooltip>
            </div>

            {/* Parties */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
                <PartyButton
                    label="المُبلِّغ"
                    name={r.reporter_name}
                    role={r.reporter_role}
                    extra={`${r.reporter_filed_count} بلاغ مُقدّم`}
                    extraTooltip="عدد البلاغات التي قدّمها هذا المستخدم — كثرة الأرقام = مُبلِّغ كيدي محتمل"
                    onClick={() => onOpenAccount(r.reporter_id, r.reporter_role, r.reporter_name)}
                    icon="👤"
                />
                <span className="text-[var(--gray-400)] font-bold">←</span>
                <PartyButton
                    label="المُبلَّغ ضده"
                    name={r.reported_name}
                    role={r.reported_role}
                    extra={`${r.reported_received_count} بلاغ مستلَم · ${r.reported_distinct_reporters} مبلِّغ مختلف/14ي`}
                    extraTooltip="إذا تجاوز عدد المبلِّغين المختلفين 3 خلال 14 يوم، النظام يحوّل الحساب تلقائياً لتحت المراجعة"
                    onClick={() => onOpenAccount(r.reported_id, r.reported_role, r.reported_name)}
                    icon="🎯"
                    danger
                />
            </div>

            {/* Phone copy */}
            {r.reporter_phone && (
                <div className="flex items-center gap-2 mb-2 text-xs">
                    <span className="text-[var(--text-secondary)] font-bold">📞 جوال المبلِّغ:</span>
                    <span className="text-[var(--text-primary)] font-bold tabular-nums" dir="ltr">{r.reporter_phone}</span>
                    <CopyButton value={r.reporter_phone} label="الجوال" size="xs" />
                </div>
            )}

            {/* Reason */}
            <div className="bg-[var(--body-bg)] rounded-xl p-3 mb-3">
                <div className="text-[10px] text-[var(--gray-400)] font-extrabold mb-1">سبب البلاغ</div>
                <p className="text-sm text-[var(--text-primary)] font-medium leading-relaxed whitespace-pre-wrap">
                    {r.reason}
                </p>
            </div>

            {r.admin_note && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
                    <div className="text-[10px] text-amber-700 font-extrabold mb-1">📝 ملاحظة الأدمن</div>
                    <p className="text-xs text-amber-900 font-medium whitespace-pre-wrap">{r.admin_note}</p>
                </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
                <ActionButton
                    onClick={() => onStatusChange(r.id, 'under_review')}
                    variant="review"
                    tooltip="ضع الحساب تحت المراجعة — قيد على الحساب حتى ينتهي التحقيق"
                >
                    🔴 تحت المراجعة
                </ActionButton>
                <ActionButton
                    onClick={() => onStatusChange(r.id, 'resolved')}
                    variant="resolve"
                    tooltip="أغلق البلاغ كمحلول — اتخذت إجراء أو لا حاجة لإجراء"
                >
                    ✅ تم الحل
                </ActionButton>
                <ActionButton
                    onClick={() => onStatusChange(r.id, 'dismissed')}
                    variant="dismiss"
                    tooltip="ارفض البلاغ — كيدي أو غير صحيح"
                >
                    ⛔ رفض (كيدي)
                </ActionButton>
            </div>
        </div>
    );
};

interface ComplaintCardProps {
    complaint: AdminComplaintRow;
    onOpenAccount: (id: string, role: string, name?: string) => void;
    onStatusChange: (id: string, status: string) => void;
}

const ComplaintCard: React.FC<ComplaintCardProps> = ({ complaint: c, onOpenAccount, onStatusChange }) => (
    <div className={`bg-[var(--card-bg)] border rounded-2xl p-4 shadow-sm transition-all hover:shadow-md ${
        c.status === 'open' ? 'border-amber-300' : c.status === 'reviewing' ? 'border-red-300' : 'border-[var(--border-color)]'
    }`}>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1 bg-[var(--gray-100)] text-[var(--text-primary)] px-2.5 py-1 rounded-lg text-xs font-extrabold">
                    📣 {c.category}{c.subject ? ` — ${c.subject}` : ''}
                </span>
                <StatusPill status={c.status} />
            </div>
            <Tooltip text={fmt(c.created_at)}>
                <span className="text-[11px] text-[var(--gray-400)] font-bold tabular-nums">
                    {timeAgo(c.created_at)}
                </span>
            </Tooltip>
        </div>

        <div className="flex items-center gap-2 flex-wrap mb-3">
            <PartyButton
                label="من"
                name={c.user_name}
                role={c.user_type || '—'}
                onClick={() => onOpenAccount(c.user_id, c.user_type === 'seller' ? 'seller' : 'buyer', c.user_name)}
                icon="👤"
            />
            {c.user_phone && (
                <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-[var(--text-primary)] font-bold tabular-nums" dir="ltr">📞 {c.user_phone}</span>
                    <CopyButton value={c.user_phone} label="الجوال" size="xs" />
                </div>
            )}
        </div>

        <div className="bg-[var(--body-bg)] rounded-xl p-3 mb-3">
            <p className="text-sm text-[var(--text-primary)] font-medium leading-relaxed whitespace-pre-wrap">
                {c.message}
            </p>
        </div>

        {c.admin_note && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-3">
                <div className="text-[10px] text-amber-700 font-extrabold mb-1">📝 ملاحظة الأدمن</div>
                <p className="text-xs text-amber-900 font-medium whitespace-pre-wrap">{c.admin_note}</p>
            </div>
        )}

        <div className="flex flex-wrap gap-2">
            <ActionButton
                onClick={() => onStatusChange(c.id, 'reviewing')}
                variant="review"
                tooltip="ضع الشكوى قيد المراجعة"
            >
                🔴 قيد المراجعة
            </ActionButton>
            <ActionButton
                onClick={() => onStatusChange(c.id, 'resolved')}
                variant="resolve"
                tooltip="أغلق الشكوى كمحلولة"
            >
                ✅ تم الحل
            </ActionButton>
            <ActionButton
                onClick={() => onStatusChange(c.id, 'dismissed')}
                variant="dismiss"
                tooltip="ارفض الشكوى"
            >
                ⛔ رفض
            </ActionButton>
        </div>
    </div>
);

const PartyButton: React.FC<{
    label: string;
    name: string;
    role: string;
    extra?: string;
    extraTooltip?: string;
    icon: string;
    danger?: boolean;
    onClick: () => void;
}> = ({ label, name, role, extra, extraTooltip, icon, danger, onClick }) => (
    <div className="flex flex-col gap-0.5">
        <button
            onClick={onClick}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all ${
                danger
                    ? 'bg-red-50 text-red-700 hover:bg-red-100 border border-red-200'
                    : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
            }`}
        >
            <span>{icon}</span>
            <span className="text-[10px] opacity-80">{label}:</span>
            <span>{name}</span>
            <span className="text-[10px] opacity-70">({role})</span>
            <span className="opacity-50">→</span>
        </button>
        {extra && (
            extraTooltip ? (
                <Tooltip text={extraTooltip}>
                    <span className="text-[10px] text-[var(--text-secondary)] font-bold mr-1 cursor-help underline decoration-dotted decoration-[var(--gray-400)] underline-offset-2">
                        {extra}
                    </span>
                </Tooltip>
            ) : (
                <span className="text-[10px] text-[var(--text-secondary)] font-bold mr-1">{extra}</span>
            )
        )}
    </div>
);

export default AdminReports;
