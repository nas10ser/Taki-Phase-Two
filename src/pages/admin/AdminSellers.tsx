/**
 * AdminSellers — إدارة البائعين والاشتراكات
 *
 * الميزات الكاملة:
 *  - بحث + فلترة بالباقة (premium / trial / free / suspended)
 *  - النقر على البائع يفتح Sub Modal الذكي:
 *      • تاريخ بداية الاشتراك (date picker)
 *      • تاريخ نهاية الاشتراك (date picker)
 *      • نسبة الخصم (slider 0-100)
 *      • المبلغ الشهري (number input)
 *      • الباقة (select: free / trial / premium)
 *      • الإشعار للبائع (toggle)
 *      • ملاحظات
 *  - أزرار سريعة: شهر / 3 أشهر / سنة / إلغاء
 *  - بطاقات إحصائية: MRR، عدد المشتركين، الباقات
 */

import React, { useEffect, useState, useCallback, useMemo, memo } from 'react';
import { adminService, AdminUserRow, ApplySubscriptionParams } from '../../services/adminService';
import { useApp } from '../../context/AppContext';
import { LOCATION_PACKAGES, packageForMax } from '../../data/packages';
import { subscriptionRepository } from '../../repositories/subscriptionRepository';
import { useEscClose } from '../../hooks/useEscClose';
import { useLocalStringList } from '../../hooks/useLocalStringList';
import { useAdminRecents } from '../../hooks/useAdminRecents';
import { CopyButton } from '../../components/admin/CopyButton';
import { Tooltip } from '../../components/admin/Tooltip';
import { PinButton } from '../../components/admin/PinButton';
import { ExportButton } from '../../components/admin/ExportButton';
import { CsvColumn } from '../../utils/csvExport';

const SELLER_CSV_COLUMNS: CsvColumn<AdminUserRow>[] = [
    { header: 'المتجر',           accessor: (s) => s.shop ?? '' },
    { header: 'اسم المالك',       accessor: (s) => s.name },
    { header: 'الجوال',           accessor: (s) => s.phone ?? '' },
    { header: 'الإيميل',          accessor: (s) => s.email ?? '' },
    { header: 'الباقة',           accessor: (s) => s.subscription_plan ?? 'free' },
    { header: 'تنتهي في',         accessor: (s) => s.subscription_expires_at ?? '' },
    { header: 'المبلغ الشهري',    accessor: (s) => s.subscription_amount ?? 0 },
    { header: 'الخصم %',          accessor: (s) => s.discount_percentage ?? 0 },
    { header: 'معلّق',            accessor: (s) => (s.is_suspended ? 'نعم' : 'لا') },
    { header: 'آخر نشاط',         accessor: (s) => s.last_active_at ?? '' },
    { header: 'تاريخ التسجيل',    accessor: (s) => s.created_at ?? '' },
    { header: 'المعرّف',           accessor: (s) => s.id },
];

type FilterTab = 'all' | 'premium' | 'trial' | 'free' | 'suspended';

// ============================================================
// Subscription Control Modal — أهم مكوّن في اللوحة
// ============================================================
const SubscriptionModal = memo<{
    seller: AdminUserRow;
    onClose: () => void;
    onSaved: () => void;
}>(({ seller, onClose, onSaved }) => {
    const { customAlert, startImpersonating } = useApp();
    const today = new Date();
    // Defensive: subscription_expires_at can be a malformed string from
    // legacy rows. Fall back to "today + 30 days" instead of letting an
    // Invalid Date crash the modal (was a white-screen culprit).
    const defaultExpiry = (() => {
        if (seller.subscription_expires_at) {
            const d = new Date(seller.subscription_expires_at);
            if (!isNaN(d.getTime())) return d;
        }
        return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    })();

    const [plan, setPlan] = useState<'free' | 'trial' | 'premium'>(
        (seller.subscription_plan as any) ?? 'premium'
    );
    const [startedAt, setStartedAt] = useState(toDateInput(today));
    const [expiresAt, setExpiresAt] = useState(toDateInput(defaultExpiry));
    const [discount, setDiscount] = useState(Number(seller.discount_percentage) || 0);
    const [amount, setAmount] = useState(Number(seller.subscription_amount) || 199);
    const [notes, setNotes] = useState('');
    const [sendNotif, setSendNotif] = useState(true);
    const [saving, setSaving] = useState(false);
    // Location package (1/3/6/10). max_branches isn't on AdminUserRow, so we
    // pull the store's current value once and default the picker to it.
    const [maxBranches, setMaxBranches] = useState<number>(3);
    useEffect(() => {
        let alive = true;
        subscriptionRepository.getStoreSubscription(seller.id)
            .then(s => { if (alive && s?.maxBranches) setMaxBranches(s.maxBranches); })
            .catch(() => {});
        return () => { alive = false; };
    }, [seller.id]);

    // أزرار سريعة لتغيير المدة
    const quickDurations = [
        { label: 'أسبوع', days: 7 },
        { label: 'شهر', days: 30 },
        { label: '3 أشهر', days: 90 },
        { label: '6 أشهر', days: 180 },
        { label: 'سنة', days: 365 },
    ];

    const setQuickDuration = (days: number) => {
        const start = new Date(startedAt);
        const end = new Date(start.getTime() + days * 24 * 60 * 60 * 1000);
        setExpiresAt(toDateInput(end));
    };

    const finalAmount = useMemo(() => {
        return Math.max(0, amount - (amount * discount) / 100);
    }, [amount, discount]);

    const handleApply = async () => {
        setSaving(true);
        const params: ApplySubscriptionParams = {
            storeId: seller.id,
            plan,
            startedAt: new Date(startedAt),
            expiresAt: expiresAt ? new Date(expiresAt) : null,
            discount,
            amount,
            notes: notes || undefined,
            sendNotification: sendNotif,
            maxBranches,
        };
        const res = await adminService.applySubscription(params);
        setSaving(false);
        if (res.success) {
            await customAlert(`✅ تم تطبيق الاشتراك على متجر "${seller.shop ?? seller.name}"`);
            onSaved();
            onClose();
        } else {
            await customAlert('❌ ' + (res.error ?? 'فشل التطبيق'));
        }
    };

    // Esc closes the modal. The subscription form is intentionally
    // close-on-Esc without an unsaved-changes prompt — applying the
    // subscription is an explicit action (the "تطبيق" button), so
    // Esc is just "cancel" and that matches the seller's mental model.
    useEscClose(true, onClose);

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[3000] flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-[var(--card-bg)] rounded-3xl max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-gradient-to-r from-purple-500 via-fuchsia-600 to-pink-600 text-white p-5 rounded-t-3xl flex items-center justify-between z-10">
                    <div className="min-w-0">
                        <div className="text-xs opacity-80 mb-1">إدارة الاشتراك</div>
                        <div className="text-xl font-extrabold truncate">{seller.shop ?? seller.name}</div>
                        <div className="text-xs opacity-80 mt-0.5 flex items-center gap-1.5" dir="ltr">
                            <span>{seller.phone ?? '—'}</span>
                            {seller.phone && (
                                <CopyButton value={seller.phone} label="الجوال" size="xs" />
                            )}
                        </div>
                    </div>
                    <Tooltip text="إغلاق (Esc)">
                        <button
                            onClick={onClose}
                            aria-label="إغلاق"
                            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-xl flex-shrink-0"
                        >
                            ✕
                        </button>
                    </Tooltip>
                </div>

                <div className="p-5 space-y-5">
                    {/* Browse-as-user action — opens the app as this seller */}
                    <div>
                        <button
                            type="button"
                            onClick={() => startImpersonating(seller.id)}
                            className="w-full p-3 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500 text-white font-extrabold rounded-2xl text-sm hover:shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                        >
                            <span className="text-base">👁️</span>
                            <span>تصفّح التطبيق كهذا التاجر</span>
                        </button>
                        <div className="text-[10px] text-[var(--text-secondary)] text-center mt-1.5">
                            ستشاهد لوحته، عروضه، حجوزاته، رسائله — كأنك هو. ارجع للمدير في أي وقت.
                        </div>
                    </div>

                    {/* اختيار الباقة */}
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-2">
                            🎯 الباقة
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {([
                                { value: 'free', label: 'مجانية', icon: '🆓', color: 'gray' },
                                { value: 'trial', label: 'تجريبية', icon: '🎁', color: 'amber' },
                                { value: 'premium', label: 'مميزة', icon: '⭐', color: 'emerald' },
                            ] as const).map((p) => (
                                <button
                                    key={p.value}
                                    onClick={() => setPlan(p.value)}
                                    className={`p-3 rounded-xl border-2 transition-all font-bold text-sm ${
                                        plan === p.value
                                            ? p.color === 'emerald'
                                                ? 'bg-emerald-50 border-emerald-500 text-emerald-700'
                                                : p.color === 'amber'
                                                ? 'bg-amber-50 border-amber-500 text-amber-700'
                                                : 'bg-[var(--gray-100)] border-[var(--gray-400)] text-[var(--text-primary)]'
                                            : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-secondary)]'
                                    }`}
                                >
                                    <div className="text-2xl mb-1">{p.icon}</div>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* باقة المواقع — كم لوكيشن مسموح للتاجر */}
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-2">
                            📍 باقة المواقع (عدد اللوكيشنات المسموحة)
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {LOCATION_PACKAGES.map((pkg) => {
                                const selected = maxBranches === pkg.max;
                                return (
                                    <button
                                        key={pkg.id}
                                        onClick={() => setMaxBranches(pkg.max)}
                                        className={`p-3 rounded-xl border-2 transition-all text-sm text-right ${
                                            selected
                                                ? 'bg-purple-50 border-purple-500 text-purple-700'
                                                : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-secondary)]'
                                        }`}
                                    >
                                        <div className="font-extrabold">{pkg.ar}</div>
                                        <div className="text-xs opacity-80 mt-0.5">{pkg.descAr}</div>
                                    </button>
                                );
                            })}
                        </div>
                        <div className="text-[11px] text-[var(--text-secondary)] mt-2">
                            الباقة الحالية: <span className="font-bold">{packageForMax(maxBranches).ar}</span> — {packageForMax(maxBranches).descAr}
                        </div>
                    </div>

                    {/* تاريخ البداية والنهاية */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">
                                📅 تاريخ البداية
                            </label>
                            <input
                                type="date"
                                value={startedAt}
                                onChange={(e) => setStartedAt(e.target.value)}
                                className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-purple-500 focus:bg-[var(--card-bg)] outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">
                                📅 تاريخ الانتهاء
                            </label>
                            <input
                                type="date"
                                value={expiresAt}
                                onChange={(e) => setExpiresAt(e.target.value)}
                                className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-purple-500 focus:bg-[var(--card-bg)] outline-none"
                            />
                        </div>
                    </div>

                    {/* أزرار سريعة للمدة */}
                    <div>
                        <div className="text-xs font-bold text-[var(--text-secondary)] mb-2">⚡ مدد سريعة:</div>
                        <div className="flex flex-wrap gap-2">
                            {quickDurations.map((d) => (
                                <button
                                    key={d.days}
                                    onClick={() => setQuickDuration(d.days)}
                                    className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-xs font-bold transition-all"
                                >
                                    {d.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* المبلغ الشهري */}
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">
                            💰 المبلغ الشهري (ر.س)
                        </label>
                        <input
                            type="number"
                            min={0}
                            step={1}
                            value={amount}
                            onChange={(e) => setAmount(Number(e.target.value))}
                            className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-purple-500 focus:bg-[var(--card-bg)] outline-none"
                        />
                    </div>

                    {/* نسبة الخصم — slider */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-[var(--text-secondary)]">
                                🎉 نسبة الخصم
                            </label>
                            <span className="text-lg font-extrabold text-purple-600 tabular-nums">
                                {discount}%
                            </span>
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={discount}
                            onChange={(e) => setDiscount(Number(e.target.value))}
                            className="w-full accent-purple-600"
                        />
                        <div className="flex justify-between text-[10px] text-[var(--gray-400)] mt-1">
                            <span>0%</span>
                            <span>50%</span>
                            <span>100% (مجاني)</span>
                        </div>
                    </div>

                    {/* ملخّص — بصري */}
                    <div className="bg-gradient-to-br from-purple-50 via-fuchsia-50 to-pink-50 border border-purple-200 rounded-2xl p-4">
                        <div className="text-xs font-bold text-purple-700 mb-2">💡 ملخّص الاشتراك</div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <div className="text-xs text-[var(--text-secondary)]">السعر الأصلي</div>
                                <div className="font-bold text-[var(--text-primary)]">
                                    {amount.toLocaleString('ar-SA')} ر.س
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-[var(--text-secondary)]">بعد الخصم</div>
                                <div className="text-xl font-extrabold text-emerald-600 tabular-nums">
                                    {finalAmount.toLocaleString('ar-SA')} ر.س
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ملاحظات */}
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">
                            📝 ملاحظات (اختياري)
                        </label>
                        <textarea
                            rows={2}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="مثال: عميل VIP، ممنوح من إدارة المنصة..."
                            className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-purple-500 focus:bg-[var(--card-bg)] outline-none"
                        />
                    </div>

                    {/* إرسال إشعار */}
                    <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                        <div>
                            <div className="font-bold text-sm text-emerald-800">
                                إرسال إشعار للبائع
                            </div>
                            <div className="text-xs text-emerald-600 mt-0.5">
                                سيتم إخباره بالاشتراك الجديد فوراً
                            </div>
                        </div>
                        <button
                            onClick={() => setSendNotif(!sendNotif)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                sendNotif ? 'bg-emerald-500' : 'bg-[var(--gray-300)]'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-[var(--card-bg)] transition-transform ${
                                    sendNotif ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 p-4 bg-[var(--body-bg)] rounded-b-3xl flex gap-3 border-t border-[var(--border-color)]">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] font-bold rounded-xl hover:bg-[var(--gray-100)]"
                    >
                        إلغاء
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={saving}
                        className="flex-[2] py-3 bg-gradient-to-r from-purple-500 to-fuchsia-600 text-white font-bold rounded-xl hover:shadow-lg disabled:opacity-50"
                    >
                        {saving ? 'جاري التطبيق...' : '⚡ تطبيق فوري'}
                    </button>
                </div>
            </div>
        </div>
    );
});
SubscriptionModal.displayName = 'SubscriptionModal';

function toDateInput(d: Date): string {
    // Guard against Invalid Date (legacy rows with malformed timestamps).
    if (!d || isNaN(d.getTime())) return new Date().toISOString().split('T')[0];
    return d.toISOString().split('T')[0];
}

// ============================================================
// Seller Row
// ============================================================
const SellerRow = memo<{
    seller: AdminUserRow;
    onEdit: (s: AdminUserRow) => void;
    pinned: boolean;
    onTogglePin: (id: string) => void;
}>(({ seller, onEdit, pinned, onTogglePin }) => {
    const expiresAt = seller.subscription_expires_at
        ? new Date(seller.subscription_expires_at)
        : null;
    const daysLeft = expiresAt
        ? Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null;

    const planMeta: Record<string, { label: string; color: string; icon: string }> = {
        premium: { label: 'مميزة', color: 'bg-emerald-100 text-emerald-700', icon: '⭐' },
        trial: { label: 'تجريبية', color: 'bg-amber-100 text-amber-700', icon: '🎁' },
        free: { label: 'مجانية', color: 'bg-[var(--gray-100)] text-[var(--text-primary)]', icon: '🆓' },
    };
    const meta = planMeta[seller.subscription_plan ?? 'free'] ?? planMeta.free;

    return (
        <button
            onClick={() => onEdit(seller)}
            className={`w-full text-right p-4 rounded-2xl border transition-all hover:shadow-md hover:-translate-y-0.5 ${
                seller.is_suspended
                    ? 'bg-red-50 border-red-200'
                    : 'bg-[var(--card-bg)] border-[var(--border-color)] hover:border-purple-200'
            }`}
        >
            <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-100 to-fuchsia-100 flex items-center justify-center text-xl font-bold text-purple-600 flex-shrink-0">
                    {seller.shop?.[0] ?? seller.name?.[0] ?? '?'}
                </div>
                <div className="flex-1 min-w-0 text-right">
                    <div className="font-bold text-sm text-[var(--text-primary)] truncate flex items-center gap-2">
                        {seller.shop ?? seller.name}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${meta.color}`}>
                            {meta.icon} {meta.label}
                        </span>
                    </div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5 truncate flex items-center gap-1.5" dir="ltr">
                        <span>{seller.phone ?? '—'}</span>
                        {seller.phone && <CopyButton value={seller.phone} label="الجوال" size="xs" />}
                    </div>
                    {expiresAt && daysLeft !== null && (
                        <div
                            className={`text-[10px] mt-1 font-bold ${
                                daysLeft < 7
                                    ? 'text-red-600'
                                    : daysLeft < 30
                                    ? 'text-amber-600'
                                    : 'text-[var(--text-secondary)]'
                            }`}
                        >
                            {daysLeft > 0 ? `ينتهي خلال ${daysLeft} يوم` : 'منتهي'} ·{' '}
                            {expiresAt.toLocaleDateString('ar-SA')}
                        </div>
                    )}
                </div>
                <div className="flex-shrink-0 text-left flex items-center gap-2">
                    <div>
                        <div className="text-base font-extrabold text-emerald-600 tabular-nums">
                            {(seller.subscription_amount ?? 0).toLocaleString('ar-SA')}
                        </div>
                        <div className="text-[10px] text-[var(--text-secondary)] font-medium">ر.س/شهر</div>
                        {(seller.discount_percentage ?? 0) > 0 && (
                            <div className="text-[10px] mt-0.5 bg-orange-100 text-orange-700 rounded px-1.5 py-0.5 font-bold">
                                خصم {seller.discount_percentage}%
                            </div>
                        )}
                    </div>
                    <PinButton pinned={pinned} onToggle={() => onTogglePin(seller.id)} />
                </div>
            </div>
        </button>
    );
});
SellerRow.displayName = 'SellerRow';

// ============================================================
// Smart filter chip — second-tier filter (composes with the plan tabs)
// ============================================================
const SellerSmartChip: React.FC<{
    active: boolean;
    onClick: () => void;
    icon: string;
    label: string;
    count?: number;
}> = ({ active, onClick, icon, label, count }) => (
    <button
        onClick={onClick}
        className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all whitespace-nowrap ${
            active
                ? 'bg-purple-100 border border-purple-400 text-purple-800 shadow-sm'
                : 'bg-[var(--body-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-purple-300'
        }`}
    >
        <span>{icon}</span>
        <span>{label}</span>
        {count !== undefined && count > 0 && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${
                active ? 'bg-purple-200' : 'bg-[var(--gray-100)]'
            }`}>{count}</span>
        )}
    </button>
);
SellerSmartChip.displayName = 'SellerSmartChip';

// ============================================================
// Global Subscription Mode — platform-wide controls.
// Sets the default subscription amount + lets the admin flip the entire
// site between "free for everyone" and "paid for everyone" with one tap.
// This is the answer to the "exception became the default" feedback —
// the global mode lives at the top, and the bulk panel below handles
// per-store exceptions.
// ============================================================
const GlobalSubscriptionMode = memo<{ onApplied: () => void }>(({ onApplied }) => {
    const { customAlert, customConfirm } = useApp();
    const [loaded, setLoaded] = useState(false);
    const [globalAmount, setGlobalAmount] = useState<number>(199);
    const [draftAmount, setDraftAmount] = useState<string>('199');
    const [trialDays, setTrialDays] = useState<number>(14);
    const [gatewayEnabled, setGatewayEnabled] = useState<boolean>(false);
    const [savingAmount, setSavingAmount] = useState(false);
    const [busyMode, setBusyMode] = useState<null | 'free' | 'paid' | 'trial-paid'>(null);

    // Hydrate current settings on mount.
    useEffect(() => {
        let alive = true;
        (async () => {
            const [amount, enabled, trial] = await Promise.all([
                adminService.getPlatformSetting<number>('basic_plan_price_sar'),
                adminService.getPlatformSetting<boolean>('payment_gateway_enabled'),
                adminService.getPlatformSetting<number>('trial_days'),
            ]);
            if (!alive) return;
            const amt = Number(amount) || 199;
            setGlobalAmount(amt);
            setDraftAmount(String(amt));
            setTrialDays(Math.max(1, Number(trial) || 14));
            setGatewayEnabled(Boolean(enabled));
            setLoaded(true);
        })();
        return () => { alive = false; };
    }, []);

    const saveAmount = async () => {
        const n = Math.max(0, Math.round(Number(draftAmount) || 0));
        if (n === globalAmount) return;
        setSavingAmount(true);
        const res = await adminService.setPlatformSetting(
            'basic_plan_price_sar',
            n,
            'Default monthly subscription price for sellers (SAR).'
        );
        setSavingAmount(false);
        if (!res.success) {
            await customAlert('❌ ' + (res.error ?? 'تعذّر الحفظ'));
            return;
        }
        setGlobalAmount(n);
        await customAlert(`✅ المبلغ الافتراضي: ${n.toLocaleString('ar-SA')} ر.س/شهر`);
    };

    const handleFreeForAll = async () => {
        const ok = await customConfirm(
            'سيتم:\n' +
            '• تعطيل بوابة الدفع (الموقع مجاني تماماً)\n' +
            '• تحويل كل البائعين النشطين إلى باقة مجانية بلا انتهاء\n\n' +
            'متابعة؟'
        );
        if (!ok) return;
        setBusyMode('free');

        const settingRes = await adminService.setPlatformSetting('payment_gateway_enabled', false);
        if (!settingRes.success) {
            setBusyMode(null);
            await customAlert('❌ تعذر تعطيل البوابة: ' + (settingRes.error ?? ''));
            return;
        }
        setGatewayEnabled(false);

        const r = await adminService.bulkSetAllActiveSellers({
            plan: 'free',
            amount: 0,
            discount: 100,
            expiresAt: null,
            notes: 'Platform mode: free for all',
        });
        setBusyMode(null);
        await customAlert(
            r.failed === 0
                ? `🆓 الموقع الآن مجاني تماماً.\n${r.ok} متجر تم ضبطه على الباقة المجانية.`
                : `⚠️ نجح: ${r.ok} | فشل: ${r.failed} (من ${r.total})`
        );
        onApplied();
    };

    const handlePaidForAll = async () => {
        const ok = await customConfirm(
            'سيتم:\n' +
            '• تفعيل بوابة الدفع\n' +
            `• تحويل كل البائعين النشطين إلى باقة مميزة بمبلغ ${globalAmount.toLocaleString('ar-SA')} ر.س/شهر بلا خصم\n` +
            '• إلغاء أي خصومات أو فترات مجانية حالية\n\n' +
            'متابعة؟'
        );
        if (!ok) return;
        setBusyMode('paid');

        const settingRes = await adminService.setPlatformSetting('payment_gateway_enabled', true);
        if (!settingRes.success) {
            setBusyMode(null);
            await customAlert('❌ تعذر تفعيل البوابة: ' + (settingRes.error ?? ''));
            return;
        }
        setGatewayEnabled(true);

        const r = await adminService.bulkSetAllActiveSellers({
            plan: 'premium',
            amount: globalAmount,
            discount: 0,
            expiresAt: null,
            notes: 'Platform mode: mandatory paid for all',
        });
        setBusyMode(null);
        await customAlert(
            r.failed === 0
                ? `💰 الموقع الآن إلزامي.\n${r.ok} متجر يدفع ${globalAmount.toLocaleString('ar-SA')} ر.س/شهر.`
                : `⚠️ نجح: ${r.ok} | فشل: ${r.failed} (من ${r.total})`
        );
        onApplied();
    };

    const handleTrialThenPaid = async () => {
        const ok = await customConfirm(
            'سيتم:\n' +
            '• تفعيل بوابة الدفع\n' +
            `• كل تاجر يسجّل حساب جديد من الآن يحصل على ${trialDays} يوم تجريبي مجاناً\n` +
            `• بعد انتهاء التجربة → اشتراك ${globalAmount.toLocaleString('ar-SA')} ر.س/شهر\n` +
            '• التجار الحاليون لن يتأثروا (يبقون على باقتهم الحالية)\n\n' +
            'متابعة؟'
        );
        if (!ok) return;
        setBusyMode('trial-paid');

        const settingRes = await adminService.setPlatformSetting('payment_gateway_enabled', true);
        if (!settingRes.success) {
            setBusyMode(null);
            await customAlert('❌ تعذر تفعيل البوابة: ' + (settingRes.error ?? ''));
            return;
        }
        setGatewayEnabled(true);

        // Persist trial config so the DB trigger `tr_new_seller_trial` reads
        // the latest values when a new seller signs up. We only update the
        // platform-wide settings — existing sellers keep their current plan.
        await Promise.allSettled([
            adminService.setPlatformSetting('trial_days', trialDays),
            adminService.setPlatformSetting('basic_plan_price_sar', globalAmount),
        ]);

        setBusyMode(null);
        await customAlert(
            `🎁 الوضع مُفعّل.\nالتجار الجدد فقط يحصلون على ${trialDays} يوم تجربة، ثم ${globalAmount.toLocaleString('ar-SA')} ر.س/شهر.\nالتجار الحاليون لم يتأثروا.`
        );
        onApplied();
    };

    return (
        <div className="bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50 border-2 border-emerald-200 rounded-2xl p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-3">
                <div className="text-2xl">💼</div>
                <div className="flex-1">
                    <div className="font-bold text-base text-emerald-900">وضع الاشتراك العام للموقع</div>
                    <div className="text-xs text-emerald-700 mt-0.5">
                        {loaded
                            ? gatewayEnabled
                                ? '🟢 بوابة الدفع مُفعّلة — التجار يحتاجون اشتراك'
                                : '🟡 بوابة الدفع مُعطّلة — التطبيق مجاني للجميع'
                            : 'جاري التحميل...'}
                    </div>
                </div>
            </div>

            {/* Global default amount input */}
            <div className="bg-[var(--card-bg)] rounded-xl p-3 mb-3 border border-emerald-100">
                <div className="text-xs font-bold text-[var(--text-secondary)] mb-1.5">
                    💰 المبلغ الافتراضي للاشتراك (يطبَّق على التجار الجدد)
                </div>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <input
                            type="number"
                            min={0}
                            step={1}
                            value={draftAmount}
                            onChange={(e) => setDraftAmount(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') saveAmount(); }}
                            className="w-full px-3 py-2.5 pl-12 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-lg text-sm font-bold focus:border-emerald-500 outline-none"
                        />
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[var(--text-secondary)] pointer-events-none">
                            ر.س/شهر
                        </span>
                    </div>
                    <button
                        onClick={saveAmount}
                        disabled={savingAmount || Number(draftAmount) === globalAmount}
                        className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-lg text-sm disabled:opacity-40 transition-all"
                    >
                        {savingAmount ? '...' : '💾 حفظ'}
                    </button>
                </div>
                {Number(draftAmount) !== globalAmount && draftAmount !== '' && (
                    <div className="text-[10px] text-amber-700 mt-1">⚡ مبلغ غير محفوظ — اضغط حفظ</div>
                )}
            </div>

            {/* Three platform-mode buttons */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <button
                    onClick={handleFreeForAll}
                    disabled={busyMode !== null}
                    className="p-4 bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 text-right transition-all"
                >
                    <div className="text-2xl mb-1">🆓</div>
                    <div className="text-sm font-extrabold">مجاني للجميع</div>
                    <div className="text-[11px] opacity-90 mt-0.5">إيقاف البوابة + تحويل كل التجار للباقة المجانية</div>
                    {busyMode === 'free' && <div className="text-[11px] mt-1">⏳ جاري التطبيق...</div>}
                </button>
                <button
                    onClick={handleTrialThenPaid}
                    disabled={busyMode !== null}
                    className="p-4 bg-gradient-to-br from-amber-500 to-orange-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 text-right transition-all"
                >
                    <div className="text-2xl mb-1">🎁</div>
                    <div className="text-sm font-extrabold">{trialDays} يوم تجريبي للجدد فقط</div>
                    <div className="text-[11px] opacity-90 mt-0.5">
                        التجار الجدد يجرّبون مجاناً ثم {globalAmount.toLocaleString('ar-SA')} ر.س/شهر
                    </div>
                    {busyMode === 'trial-paid' && <div className="text-[11px] mt-1">⏳ جاري التطبيق...</div>}
                </button>
                <button
                    onClick={handlePaidForAll}
                    disabled={busyMode !== null}
                    className="p-4 bg-gradient-to-br from-purple-600 to-fuchsia-600 text-white font-bold rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 text-right transition-all"
                >
                    <div className="text-2xl mb-1">💰</div>
                    <div className="text-sm font-extrabold">إلزامي فوراً</div>
                    <div className="text-[11px] opacity-90 mt-0.5">
                        تفعيل البوابة + الزام الكل بـ {globalAmount.toLocaleString('ar-SA')} ر.س/شهر بدون تجربة
                    </div>
                    {busyMode === 'paid' && <div className="text-[11px] mt-1">⏳ جاري التطبيق...</div>}
                </button>
            </div>

            {/* Editable trial duration — affects the trial-then-paid button label & action */}
            <div className="flex items-center gap-2 mt-3 bg-white/60 rounded-lg p-2 text-[11px]">
                <span className="text-amber-800 font-bold">⏱ مدة التجربة:</span>
                <input
                    type="number"
                    min={1}
                    max={365}
                    value={trialDays}
                    onChange={(e) => setTrialDays(Math.max(1, Math.min(365, Number(e.target.value) || 14)))}
                    onBlur={() => adminService.setPlatformSetting('trial_days', trialDays).catch(() => {})}
                    className="w-14 px-2 py-1 bg-[var(--card-bg)] border border-amber-200 rounded text-center font-bold text-amber-900 outline-none focus:border-amber-500"
                />
                <span className="text-amber-800">يوم — تطبَّق على زر "تجريبي ثم إلزامي". تُحفظ تلقائياً.</span>
            </div>

            <div className="text-[11px] text-emerald-700 mt-3 leading-relaxed bg-white/60 rounded-lg p-2">
                💡 <strong>للاستثناءات</strong> (إعفاء متجر معين، خصم لمدة محدودة، متاجر VIP) استخدم لوحة "تحكم جماعي قوي" بالأسفل أو اضغط على بطاقة المتجر مباشرة.
            </div>
        </div>
    );
});
GlobalSubscriptionMode.displayName = 'GlobalSubscriptionMode';

// ============================================================
// Bulk Subscription Panel — full control over ANY subset of sellers.
// Pick stores by name (search), set plan, dates, amount, discount,
// then apply once. Replaces the previous 2-button limitation.
// ============================================================
type BulkPlan = 'free' | 'trial' | 'premium';

const BulkSubscriptionPanel = memo<{
    sellers: AdminUserRow[];
    isOpen: boolean;
    onToggle: () => void;
    onApplied: () => void;
}>(({ sellers, isOpen, onToggle, onApplied }) => {
    const { customAlert, customConfirm } = useApp();
    const [scope, setScope] = useState<'all-active' | 'pick'>('pick');
    const [pickedIds, setPickedIds] = useState<Set<string>>(new Set());
    const [searchQ, setSearchQ] = useState('');
    const [debouncedSearchQ, setDebouncedSearchQ] = useState('');

    const [plan, setPlan] = useState<BulkPlan>('free');
    const today = new Date();
    const [startedAt, setStartedAt] = useState(toDateInput(today));
    const [expiresAt, setExpiresAt] = useState<string>(''); // empty = no expiry
    const [amount, setAmount] = useState<number>(0);
    const [discount, setDiscount] = useState<number>(100);
    const [sendNotif, setSendNotif] = useState(false);
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

    // Debounce the inline seller search so typing stays buttery on big lists.
    useEffect(() => {
        const t = setTimeout(() => setDebouncedSearchQ(searchQ.trim().toLowerCase()), 150);
        return () => clearTimeout(t);
    }, [searchQ]);

    const visibleSellers = useMemo(() => {
        const list = sellers.filter((s) => !s.is_suspended);
        if (!debouncedSearchQ) return list;
        return list.filter((s) => {
            const blob = `${s.shop ?? ''} ${s.name ?? ''} ${s.phone ?? ''} ${s.email ?? ''}`.toLowerCase();
            return blob.includes(debouncedSearchQ);
        });
    }, [sellers, debouncedSearchQ]);

    const targetIds = useMemo(() => {
        if (scope === 'all-active') return sellers.filter((s) => !s.is_suspended).map((s) => s.id);
        return Array.from(pickedIds);
    }, [scope, pickedIds, sellers]);

    const togglePick = useCallback((id: string) => {
        setPickedIds((prev) => {
            const n = new Set(prev);
            if (n.has(id)) n.delete(id); else n.add(id);
            return n;
        });
    }, []);

    const selectAllVisible = () => {
        setPickedIds((prev) => {
            const n = new Set(prev);
            visibleSellers.forEach((s) => n.add(s.id));
            return n;
        });
    };
    const clearPicks = () => setPickedIds(new Set());

    // ---- Plan presets — one tap fills sensible defaults ---------------
    const applyPreset = (preset: 'free-perpetual' | 'free-30d' | 'trial-30d' | 'premium-full' | 'premium-half') => {
        const now = new Date();
        if (preset === 'free-perpetual') {
            setPlan('free'); setAmount(0); setDiscount(100); setExpiresAt('');
        } else if (preset === 'free-30d') {
            setPlan('free'); setAmount(0); setDiscount(100);
            setExpiresAt(toDateInput(new Date(now.getTime() + 30 * 86400000)));
        } else if (preset === 'trial-30d') {
            setPlan('trial'); setAmount(199); setDiscount(0);
            setExpiresAt(toDateInput(new Date(now.getTime() + 30 * 86400000)));
        } else if (preset === 'premium-full') {
            setPlan('premium'); setAmount(199); setDiscount(0);
            setExpiresAt(toDateInput(new Date(now.getTime() + 365 * 86400000)));
        } else if (preset === 'premium-half') {
            setPlan('premium'); setAmount(199); setDiscount(50);
            setExpiresAt(toDateInput(new Date(now.getTime() + 365 * 86400000)));
        }
    };

    // ---- Quick durations for the end date ---------------------------
    const setQuickDuration = (days: number | null) => {
        if (days === null) { setExpiresAt(''); return; }
        const start = startedAt ? new Date(startedAt) : new Date();
        if (isNaN(start.getTime())) return;
        setExpiresAt(toDateInput(new Date(start.getTime() + days * 86400000)));
    };

    const finalAmount = Math.max(0, amount - (amount * discount) / 100);

    const handleApply = async () => {
        if (targetIds.length === 0) {
            await customAlert('⚠️ اختر بائعاً واحداً على الأقل، أو حوّل الفلتر إلى "كل النشطين".');
            return;
        }
        const expiresLabel = expiresAt
            ? `حتى ${new Date(expiresAt).toLocaleDateString('ar-SA')}`
            : 'بلا انتهاء';
        const planLabel = plan === 'free' ? 'مجانية' : plan === 'trial' ? 'تجريبية' : 'مميزة';
        const ok = await customConfirm(
            `سيتم تطبيق:\n` +
            `• الباقة: ${planLabel}\n` +
            `• المبلغ: ${finalAmount.toLocaleString('ar-SA')} ر.س/شهر${discount > 0 ? ` (خصم ${discount}%)` : ''}\n` +
            `• الانتهاء: ${expiresLabel}\n` +
            `على ${targetIds.length} متجر. متابعة؟`
        );
        if (!ok) return;

        setBusy(true);
        setProgress({ done: 0, total: targetIds.length });
        const expiresDate = expiresAt ? new Date(expiresAt) : null;
        const startDate = startedAt ? new Date(startedAt) : new Date();

        // Run in chunks of 8 — keeps Supabase happy and updates progress as we go.
        const CHUNK = 8;
        let okCount = 0;
        let failCount = 0;
        for (let i = 0; i < targetIds.length; i += CHUNK) {
            const slice = targetIds.slice(i, i + CHUNK);
            const results = await Promise.allSettled(
                slice.map((sid) =>
                    adminService.applySubscription({
                        storeId: sid,
                        plan,
                        startedAt: startDate,
                        expiresAt: expiresDate,
                        discount,
                        amount,
                        notes: 'Bulk panel (admin)',
                        sendNotification: sendNotif,
                    })
                )
            );
            results.forEach((r) => {
                if (r.status === 'fulfilled' && (r.value as any).success) okCount++;
                else failCount++;
            });
            setProgress({ done: Math.min(i + CHUNK, targetIds.length), total: targetIds.length });
        }
        setBusy(false);
        setProgress(null);

        await customAlert(
            failCount === 0
                ? `✅ تم تطبيق الإعدادات على ${okCount} متجر بنجاح.`
                : `⚠️ نجح: ${okCount} | فشل: ${failCount}. افتح DevTools Console للتفاصيل.`
        );
        if (okCount > 0) {
            // Reset picks so the admin doesn't accidentally re-apply on the next click.
            setPickedIds(new Set());
            onApplied();
        }
    };

    if (!isOpen) {
        return (
            <button
                onClick={onToggle}
                className="w-full bg-gradient-to-br from-amber-50 via-orange-50 to-pink-50 border border-amber-200 rounded-2xl p-4 text-right hover:shadow-md transition-all"
            >
                <div className="flex items-center gap-3">
                    <div className="text-3xl">⚡</div>
                    <div className="flex-1">
                        <div className="font-bold text-sm text-amber-900">تحكم جماعي قوي بالاشتراكات</div>
                        <div className="text-xs text-amber-700 mt-0.5">
                            اختر متاجر معينة (بحث بالاسم) أو الكل، حدد الباقة والمبلغ والتاريخ والخصم بحرية، ثم طبّق بضغطة. اضغط للفتح →
                        </div>
                    </div>
                </div>
            </button>
        );
    }

    return (
        <div className="bg-[var(--card-bg)] border-2 border-amber-300 rounded-2xl shadow-xl overflow-hidden">
            <div className="bg-gradient-to-r from-amber-500 via-orange-500 to-pink-500 text-white p-4 flex items-center justify-between">
                <div>
                    <div className="font-bold text-base flex items-center gap-2">⚡ تحكم جماعي بالاشتراكات</div>
                    <div className="text-xs opacity-90 mt-0.5">حدّد كل التفاصيل بحرية — بدون قيود.</div>
                </div>
                <button onClick={onToggle} className="w-8 h-8 rounded-lg bg-white/20 hover:bg-white/30 flex items-center justify-center text-lg">✕</button>
            </div>

            <div className="p-4 space-y-5">
                {/* --- 1) Scope -------------------------------------------------- */}
                <section>
                    <div className="text-xs font-bold text-[var(--text-secondary)] mb-2">👥 على من تُطبَّق؟</div>
                    <div className="grid grid-cols-2 gap-2 mb-2">
                        <button
                            onClick={() => setScope('all-active')}
                            className={`p-3 rounded-xl border-2 text-sm font-bold transition-all ${
                                scope === 'all-active'
                                    ? 'bg-emerald-50 border-emerald-500 text-emerald-700'
                                    : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-secondary)]'
                            }`}
                        >
                            🌐 كل النشطين
                            <div className="text-[10px] font-normal mt-0.5 opacity-80">
                                {sellers.filter((s) => !s.is_suspended).length} متجر
                            </div>
                        </button>
                        <button
                            onClick={() => setScope('pick')}
                            className={`p-3 rounded-xl border-2 text-sm font-bold transition-all ${
                                scope === 'pick'
                                    ? 'bg-purple-50 border-purple-500 text-purple-700'
                                    : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-secondary)]'
                            }`}
                        >
                            🎯 متاجر محددة
                            <div className="text-[10px] font-normal mt-0.5 opacity-80">
                                {pickedIds.size} مختار
                            </div>
                        </button>
                    </div>

                    {scope === 'pick' && (
                        <div className="bg-[var(--body-bg)] rounded-xl border border-[var(--border-color)] overflow-hidden">
                            <div className="p-2 border-b border-[var(--border-color)]">
                                <input
                                    type="text"
                                    value={searchQ}
                                    onChange={(e) => setSearchQ(e.target.value)}
                                    placeholder="🔍 ابحث باسم المتجر، الاسم، الجوال أو الإيميل..."
                                    className="w-full px-3 py-2 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-lg text-sm focus:border-purple-500 outline-none"
                                />
                                <div className="flex gap-2 mt-2 text-[11px]">
                                    <button onClick={selectAllVisible} className="px-2 py-1 bg-purple-100 text-purple-700 rounded font-bold">
                                        ✓ اختر كل المعروض ({visibleSellers.length})
                                    </button>
                                    <button onClick={clearPicks} className="px-2 py-1 bg-[var(--gray-100)] text-[var(--text-secondary)] rounded font-bold">
                                        مسح الاختيار
                                    </button>
                                </div>
                            </div>
                            <div className="max-h-56 overflow-y-auto divide-y divide-[var(--border-color)]">
                                {visibleSellers.length === 0 ? (
                                    <div className="p-4 text-center text-xs text-[var(--gray-400)]">لا نتائج لهذا البحث.</div>
                                ) : visibleSellers.map((s) => {
                                    const checked = pickedIds.has(s.id);
                                    const planMeta: Record<string, string> = {
                                        premium: '⭐',
                                        trial: '🎁',
                                        free: '🆓',
                                    };
                                    return (
                                        <label
                                            key={s.id}
                                            className={`flex items-center gap-3 p-2.5 cursor-pointer transition-colors ${
                                                checked ? 'bg-purple-50' : 'hover:bg-[var(--gray-100)]'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => togglePick(s.id)}
                                                className="w-4 h-4 accent-purple-600"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-bold text-[var(--text-primary)] truncate flex items-center gap-1.5">
                                                    {planMeta[s.subscription_plan ?? 'free'] ?? '🆓'} {s.shop ?? s.name ?? '(بدون اسم)'}
                                                </div>
                                                <div className="text-[10px] text-[var(--text-secondary)] truncate" dir="ltr">
                                                    {s.phone ?? s.email ?? '—'}
                                                </div>
                                            </div>
                                            {(s.subscription_amount ?? 0) > 0 && (
                                                <span className="text-[10px] text-emerald-600 font-bold flex-shrink-0">
                                                    {(s.subscription_amount ?? 0).toLocaleString('ar-SA')} ر.س
                                                </span>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </section>

                {/* --- 2) Quick presets --------------------------------------- */}
                <section>
                    <div className="text-xs font-bold text-[var(--text-secondary)] mb-2">⚡ قوالب سريعة (تعبّي الحقول لك):</div>
                    <div className="flex flex-wrap gap-2">
                        <button onClick={() => applyPreset('free-perpetual')} className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg text-xs font-bold">🆓 مجاني دائم</button>
                        <button onClick={() => applyPreset('free-30d')} className="px-3 py-1.5 bg-teal-50 hover:bg-teal-100 text-teal-700 rounded-lg text-xs font-bold">🆓 مجاني 30 يوم</button>
                        <button onClick={() => applyPreset('trial-30d')} className="px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-lg text-xs font-bold">🎁 تجريبي 30 يوم</button>
                        <button onClick={() => applyPreset('premium-half')} className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-lg text-xs font-bold">⭐ مميز -50%</button>
                        <button onClick={() => applyPreset('premium-full')} className="px-3 py-1.5 bg-fuchsia-50 hover:bg-fuchsia-100 text-fuchsia-700 rounded-lg text-xs font-bold">⭐ مميز سنة كاملة</button>
                    </div>
                </section>

                {/* --- 3) Plan ------------------------------------------------- */}
                <section>
                    <div className="text-xs font-bold text-[var(--text-secondary)] mb-2">📦 الباقة</div>
                    <div className="grid grid-cols-3 gap-2">
                        {([
                            { v: 'free', label: 'مجانية', icon: '🆓' },
                            { v: 'trial', label: 'تجريبية', icon: '🎁' },
                            { v: 'premium', label: 'مميزة', icon: '⭐' },
                        ] as const).map((o) => (
                            <button
                                key={o.v}
                                onClick={() => setPlan(o.v)}
                                className={`p-2.5 rounded-xl border-2 text-sm font-bold transition-all ${
                                    plan === o.v
                                        ? 'bg-amber-50 border-amber-500 text-amber-800'
                                        : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-secondary)]'
                                }`}
                            >
                                <div className="text-xl mb-0.5">{o.icon}</div>
                                {o.label}
                            </button>
                        ))}
                    </div>
                </section>

                {/* --- 4) Dates ------------------------------------------------ */}
                <section>
                    <div className="text-xs font-bold text-[var(--text-secondary)] mb-2">📅 الفترة</div>
                    <div className="grid grid-cols-2 gap-3 mb-2">
                        <div>
                            <div className="text-[10px] text-[var(--gray-400)] mb-1">يبدأ</div>
                            <input
                                type="date"
                                value={startedAt}
                                onChange={(e) => setStartedAt(e.target.value)}
                                className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-lg text-sm focus:border-amber-500 outline-none"
                            />
                        </div>
                        <div>
                            <div className="text-[10px] text-[var(--gray-400)] mb-1">ينتهي (فارغ = بلا انتهاء)</div>
                            <input
                                type="date"
                                value={expiresAt}
                                onChange={(e) => setExpiresAt(e.target.value)}
                                className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-lg text-sm focus:border-amber-500 outline-none"
                            />
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {[
                            { label: 'أسبوع', d: 7 },
                            { label: 'شهر', d: 30 },
                            { label: '3 أشهر', d: 90 },
                            { label: '6 أشهر', d: 180 },
                            { label: 'سنة', d: 365 },
                            { label: 'بلا انتهاء', d: null as null | number },
                        ].map((q) => (
                            <button
                                key={q.label}
                                onClick={() => setQuickDuration(q.d as any)}
                                className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 rounded-lg text-[11px] font-bold"
                            >
                                {q.label}
                            </button>
                        ))}
                    </div>
                </section>

                {/* --- 5) Amount + Discount ----------------------------------- */}
                <section className="grid grid-cols-2 gap-3">
                    <div>
                        <div className="text-xs font-bold text-[var(--text-secondary)] mb-1.5">💰 المبلغ الشهري (ر.س)</div>
                        <input
                            type="number"
                            min={0}
                            step={1}
                            value={amount}
                            onChange={(e) => setAmount(Number(e.target.value) || 0)}
                            className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-lg text-sm focus:border-amber-500 outline-none"
                        />
                    </div>
                    <div>
                        <div className="flex justify-between items-center mb-1.5">
                            <div className="text-xs font-bold text-[var(--text-secondary)]">🎉 الخصم</div>
                            <span className="text-sm font-extrabold text-amber-700 tabular-nums">{discount}%</span>
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={discount}
                            onChange={(e) => setDiscount(Number(e.target.value))}
                            className="w-full accent-amber-600"
                        />
                    </div>
                </section>

                {/* --- 6) Summary --------------------------------------------- */}
                <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-3">
                    <div className="text-xs text-emerald-700 mb-1">💡 الخلاصة:</div>
                    <div className="text-sm text-[var(--text-primary)]">
                        سيتم تطبيق <strong>{plan === 'free' ? 'باقة مجانية' : plan === 'trial' ? 'باقة تجريبية' : 'باقة مميزة'}</strong>
                        {' '}بمبلغ صافي <strong className="text-emerald-700 tabular-nums">{finalAmount.toLocaleString('ar-SA')} ر.س/شهر</strong>
                        {discount > 0 && <> (بعد خصم {discount}%)</>}
                        {' '}على <strong className="text-amber-700">{targetIds.length}</strong> متجر
                        {expiresAt ? <>، ينتهي <strong>{new Date(expiresAt).toLocaleDateString('ar-SA')}</strong>.</> : <>، <strong>بلا انتهاء</strong>.</>}
                    </div>
                </div>

                {/* --- 7) Notify toggle --------------------------------------- */}
                <label className="flex items-center justify-between p-3 bg-blue-50 rounded-xl border border-blue-100 cursor-pointer">
                    <div>
                        <div className="font-bold text-sm text-blue-800">إرسال إشعار للبائعين</div>
                        <div className="text-xs text-blue-600 mt-0.5">قد تحتاج إيقافه لو الإجراء كبير لتجنّب إزعاج الجميع.</div>
                    </div>
                    <input
                        type="checkbox"
                        checked={sendNotif}
                        onChange={(e) => setSendNotif(e.target.checked)}
                        className="w-5 h-5 accent-blue-600"
                    />
                </label>

                {/* --- 8) Apply button ---------------------------------------- */}
                {progress && (
                    <div className="bg-[var(--gray-100)] rounded-xl overflow-hidden h-2">
                        <div
                            className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all"
                            style={{ width: `${(progress.done / progress.total) * 100}%` }}
                        />
                    </div>
                )}
                <button
                    onClick={handleApply}
                    disabled={busy || targetIds.length === 0}
                    className="w-full py-3.5 bg-gradient-to-r from-amber-500 via-orange-500 to-pink-500 text-white font-bold rounded-xl shadow-md hover:shadow-lg disabled:opacity-50 text-sm"
                >
                    {busy
                        ? `... جاري التطبيق ${progress ? `(${progress.done}/${progress.total})` : ''}`
                        : targetIds.length === 0
                        ? 'اختر متاجر أولاً'
                        : `⚡ تطبيق على ${targetIds.length} متجر`}
                </button>
            </div>
        </div>
    );
});
BulkSubscriptionPanel.displayName = 'BulkSubscriptionPanel';

// ============================================================
// Main Component
// ============================================================
type SellerSmartFilter = 'pinned' | 'expiring_7d' | 'expiring_30d' | 'no_plan' | 'high_discount';

const AdminSellers: React.FC = () => {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [filter, setFilter] = useState<FilterTab>('all');
    const [smartFilter, setSmartFilter] = useState<SellerSmartFilter | null>(null);
    const [sellers, setSellers] = useState<AdminUserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<AdminUserRow | null>(null);
    const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
    const pins = useLocalStringList('taki:admin:sellers:pins', { maxItems: 100 });
    const { push: pushRecent } = useAdminRecents();

    // Push to recents whenever the admin opens a seller's subscription modal.
    useEffect(() => {
        if (editing) {
            pushRecent({
                id: editing.id,
                name: editing.name ?? 'تاجر',
                shop: editing.shop,
                type: 'seller',
                phone: editing.phone,
            });
        }
    }, [editing, pushRecent]);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQuery(query), 300);
        return () => clearTimeout(t);
    }, [query]);

    const fetchSellers = useCallback(async () => {
        setLoading(true);
        const data = await adminService.searchUsers(debouncedQuery, 'seller', 200, 0);
        setSellers(data);
        setLoading(false);
    }, [debouncedQuery]);

    useEffect(() => {
        fetchSellers();
    }, [fetchSellers]);

    const filtered = useMemo(() => {
        // Step 1: plan/status filter (the existing tabs).
        let base: AdminUserRow[];
        if (filter === 'all') base = sellers;
        else if (filter === 'suspended') base = sellers.filter((s) => s.is_suspended);
        else base = sellers.filter((s) => s.subscription_plan === filter && !s.is_suspended);

        // Step 2: smart filter on top (optional).
        if (!smartFilter) return base;
        const now = Date.now();
        const in7d = now + 7 * 24 * 60 * 60 * 1000;
        const in30d = now + 30 * 24 * 60 * 60 * 1000;
        if (smartFilter === 'pinned') return base.filter((s) => pins.has(s.id));
        if (smartFilter === 'expiring_7d') return base.filter((s) => {
            if (!s.subscription_expires_at) return false;
            const t = new Date(s.subscription_expires_at).getTime();
            return Number.isFinite(t) && t >= now && t <= in7d;
        });
        if (smartFilter === 'expiring_30d') return base.filter((s) => {
            if (!s.subscription_expires_at) return false;
            const t = new Date(s.subscription_expires_at).getTime();
            return Number.isFinite(t) && t >= now && t <= in30d;
        });
        if (smartFilter === 'no_plan') return base.filter((s) => !s.subscription_plan || s.subscription_plan === 'free');
        if (smartFilter === 'high_discount') return base.filter((s) => (s.discount_percentage ?? 0) >= 30);
        return base;
    }, [sellers, filter, smartFilter, pins]);

    // Split into pinned vs the rest so favourites float to the top.
    const { pinnedSellers, restSellers } = useMemo(() => {
        const pinnedSellers: AdminUserRow[] = [];
        const restSellers: AdminUserRow[] = [];
        for (const s of filtered) {
            if (pins.has(s.id)) pinnedSellers.push(s);
            else restSellers.push(s);
        }
        return { pinnedSellers, restSellers };
    }, [filtered, pins]);

    const stats = useMemo(() => {
        const premium = sellers.filter((s) => s.subscription_plan === 'premium').length;
        const trial = sellers.filter((s) => s.subscription_plan === 'trial').length;
        const free = sellers.filter((s) => !s.subscription_plan || s.subscription_plan === 'free').length;
        const mrr = sellers
            .filter((s) => s.subscription_plan === 'premium')
            .reduce((sum, s) => {
                const amount = s.subscription_amount ?? 0;
                const discount = s.discount_percentage ?? 0;
                return sum + (amount - (amount * discount) / 100);
            }, 0);
        return { premium, trial, free, mrr };
    }, [sellers]);

    return (
        <div className="space-y-5 animate-fade-in" dir="rtl">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">🏪 إدارة البائعين</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                        تحكم كامل بالاشتراكات والخصومات بضغطة زر واحدة
                    </p>
                </div>
                <ExportButton
                    rows={filtered}
                    columns={SELLER_CSV_COLUMNS}
                    filenameStem="taki-sellers"
                    accent="purple"
                    tooltip="تنزيل القائمة المعروضة حالياً كملف CSV — يحتوي على الباقة، تاريخ الانتهاء، الخصم، MRR لكل تاجر"
                />
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-4 text-white shadow-lg">
                    <div className="text-3xl font-extrabold tabular-nums">
                        {stats.mrr.toLocaleString('ar-SA')}
                    </div>
                    <div className="text-xs opacity-90 mt-0.5">MRR (ر.س/شهر)</div>
                </div>
                <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm">
                    <div className="text-2xl font-extrabold text-emerald-600">{stats.premium}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">⭐ مميز</div>
                </div>
                <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm">
                    <div className="text-2xl font-extrabold text-amber-500">{stats.trial}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">🎁 تجريبي</div>
                </div>
                <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm">
                    <div className="text-2xl font-extrabold text-[var(--text-secondary)]">{stats.free}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">🆓 مجاني</div>
                </div>
            </div>

            {/* Platform-wide subscription mode — set the default amount + flip
                the entire site to free / paid in one click. This is the
                "default" that applies to everyone unless an exception is set. */}
            <GlobalSubscriptionMode onApplied={fetchSellers} />

            {/* Per-store exceptions: pick any subset of sellers and apply ANY
                plan / dates / amount / discount. */}
            <BulkSubscriptionPanel
                sellers={sellers}
                isOpen={bulkPanelOpen}
                onToggle={() => setBulkPanelOpen((v) => !v)}
                onApplied={fetchSellers}
            />

            {/* Filters + Search */}
            <div className="space-y-3">
                <input
                    type="text"
                    placeholder="🔍 ابحث باسم المتجر، الجوال، الإيميل..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full px-5 py-4 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl shadow-sm text-sm focus:border-purple-500 focus:shadow-md outline-none transition-all"
                />
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {([
                        { value: 'all', label: 'الكل', icon: '👥' },
                        { value: 'premium', label: 'مميز', icon: '⭐' },
                        { value: 'trial', label: 'تجريبي', icon: '🎁' },
                        { value: 'free', label: 'مجاني', icon: '🆓' },
                        { value: 'suspended', label: 'معلّق', icon: '🚫' },
                    ] as const).map((f) => (
                        <button
                            key={f.value}
                            onClick={() => setFilter(f.value)}
                            className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-bold transition-all ${
                                filter === f.value
                                    ? 'bg-gradient-to-r from-purple-500 to-fuchsia-600 text-white shadow-md'
                                    : 'bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] hover:border-purple-300'
                            }`}
                        >
                            {f.icon} {f.label}
                        </button>
                    ))}
                </div>

                {/* Smart filters (compose on top of the plan filter above) */}
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                    <SellerSmartChip active={smartFilter === null}             onClick={() => setSmartFilter(null)}             icon="✓" label="بلا فلتر ذكي" />
                    <SellerSmartChip active={smartFilter === 'pinned'}         onClick={() => setSmartFilter('pinned')}         icon="★" label="المفضّلة" count={pins.list.length} />
                    <SellerSmartChip active={smartFilter === 'expiring_7d'}    onClick={() => setSmartFilter('expiring_7d')}    icon="⏰" label="ينتهي خلال 7 أيام" />
                    <SellerSmartChip active={smartFilter === 'expiring_30d'}   onClick={() => setSmartFilter('expiring_30d')}   icon="📅" label="ينتهي خلال 30 يوم" />
                    <SellerSmartChip active={smartFilter === 'no_plan'}        onClick={() => setSmartFilter('no_plan')}        icon="🆓" label="بدون اشتراك" />
                    <SellerSmartChip active={smartFilter === 'high_discount'}  onClick={() => setSmartFilter('high_discount')}  icon="🏷️" label="خصم ≥ 30%" />
                </div>
            </div>

            {/* List */}
            {loading ? (
                <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="h-20 bg-[var(--gray-100)] rounded-2xl animate-pulse" />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="bg-[var(--card-bg)] rounded-2xl p-12 border border-dashed border-[var(--border-color)] text-center text-[var(--gray-400)]">
                    {smartFilter === 'pinned'
                        ? 'لا يوجد تجار في مفضّلتك بعد. اضغط ★ بجانب أي تاجر لإضافته.'
                        : 'لا توجد نتائج لهذا الفلتر.'}
                </div>
            ) : (
                <div className="space-y-3">
                    {pinnedSellers.length > 0 && smartFilter !== 'pinned' && (
                        <div>
                            <div className="text-xs font-extrabold text-amber-700 mb-2 flex items-center gap-1.5 px-1">
                                ★ المفضّلة ({pinnedSellers.length})
                            </div>
                            <div className="space-y-2">
                                {pinnedSellers.map((s) => (
                                    <SellerRow
                                        key={s.id}
                                        seller={s}
                                        onEdit={setEditing}
                                        pinned={true}
                                        onTogglePin={pins.toggle}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                    {restSellers.length > 0 && (
                        <div>
                            {pinnedSellers.length > 0 && smartFilter !== 'pinned' && (
                                <div className="text-xs font-extrabold text-[var(--text-secondary)] mb-2 px-1">
                                    باقي المتاجر ({restSellers.length})
                                </div>
                            )}
                            <div className="space-y-2">
                                {restSellers.map((s) => (
                                    <SellerRow
                                        key={s.id}
                                        seller={s}
                                        onEdit={setEditing}
                                        pinned={false}
                                        onTogglePin={pins.toggle}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Subscription Modal */}
            {editing && (
                <SubscriptionModal
                    seller={editing}
                    onClose={() => setEditing(null)}
                    onSaved={fetchSellers}
                />
            )}
        </div>
    );
};

export default memo(AdminSellers);
