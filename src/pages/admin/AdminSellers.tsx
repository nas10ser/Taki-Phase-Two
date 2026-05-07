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

type FilterTab = 'all' | 'premium' | 'trial' | 'free' | 'suspended';

// ============================================================
// Subscription Control Modal — أهم مكوّن في اللوحة
// ============================================================
const SubscriptionModal = memo<{
    seller: AdminUserRow;
    onClose: () => void;
    onSaved: () => void;
}>(({ seller, onClose, onSaved }) => {
    const { customAlert } = useApp();
    const today = new Date();
    const defaultExpiry = seller.subscription_expires_at
        ? new Date(seller.subscription_expires_at)
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const [plan, setPlan] = useState<'free' | 'trial' | 'premium'>(
        (seller.subscription_plan as any) ?? 'premium'
    );
    const [startedAt, setStartedAt] = useState(toDateInput(today));
    const [expiresAt, setExpiresAt] = useState(toDateInput(defaultExpiry));
    const [discount, setDiscount] = useState(seller.discount_percentage ?? 0);
    const [amount, setAmount] = useState(seller.subscription_amount ?? 199);
    const [notes, setNotes] = useState('');
    const [sendNotif, setSendNotif] = useState(true);
    const [saving, setSaving] = useState(false);

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

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[3000] flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-3xl max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">
                {/* Header */}
                <div className="sticky top-0 bg-gradient-to-r from-purple-500 via-fuchsia-600 to-pink-600 text-white p-5 rounded-t-3xl flex items-center justify-between z-10">
                    <div>
                        <div className="text-xs opacity-80 mb-1">إدارة الاشتراك</div>
                        <div className="text-xl font-extrabold">{seller.shop ?? seller.name}</div>
                        <div className="text-xs opacity-80 mt-0.5" dir="ltr">
                            {seller.phone}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-xl"
                    >
                        ✕
                    </button>
                </div>

                <div className="p-5 space-y-5">
                    {/* اختيار الباقة */}
                    <div>
                        <label className="block text-xs font-bold text-gray-600 mb-2">
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
                                                : 'bg-gray-50 border-gray-500 text-gray-700'
                                            : 'bg-white border-gray-200 text-gray-500'
                                    }`}
                                >
                                    <div className="text-2xl mb-1">{p.icon}</div>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* تاريخ البداية والنهاية */}
                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1.5">
                                📅 تاريخ البداية
                            </label>
                            <input
                                type="date"
                                value={startedAt}
                                onChange={(e) => setStartedAt(e.target.value)}
                                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:border-purple-500 focus:bg-white outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1.5">
                                📅 تاريخ الانتهاء
                            </label>
                            <input
                                type="date"
                                value={expiresAt}
                                onChange={(e) => setExpiresAt(e.target.value)}
                                className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:border-purple-500 focus:bg-white outline-none"
                            />
                        </div>
                    </div>

                    {/* أزرار سريعة للمدة */}
                    <div>
                        <div className="text-xs font-bold text-gray-500 mb-2">⚡ مدد سريعة:</div>
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
                        <label className="block text-xs font-bold text-gray-600 mb-1.5">
                            💰 المبلغ الشهري (ر.س)
                        </label>
                        <input
                            type="number"
                            min={0}
                            step={1}
                            value={amount}
                            onChange={(e) => setAmount(Number(e.target.value))}
                            className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:border-purple-500 focus:bg-white outline-none"
                        />
                    </div>

                    {/* نسبة الخصم — slider */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-bold text-gray-600">
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
                        <div className="flex justify-between text-[10px] text-gray-400 mt-1">
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
                                <div className="text-xs text-gray-500">السعر الأصلي</div>
                                <div className="font-bold text-gray-700">
                                    {amount.toLocaleString('ar-SA')} ر.س
                                </div>
                            </div>
                            <div>
                                <div className="text-xs text-gray-500">بعد الخصم</div>
                                <div className="text-xl font-extrabold text-emerald-600 tabular-nums">
                                    {finalAmount.toLocaleString('ar-SA')} ر.س
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ملاحظات */}
                    <div>
                        <label className="block text-xs font-bold text-gray-600 mb-1.5">
                            📝 ملاحظات (اختياري)
                        </label>
                        <textarea
                            rows={2}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            placeholder="مثال: عميل VIP، ممنوح من إدارة المنصة..."
                            className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:border-purple-500 focus:bg-white outline-none"
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
                                sendNotif ? 'bg-emerald-500' : 'bg-gray-300'
                            }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                    sendNotif ? 'translate-x-6' : 'translate-x-1'
                                }`}
                            />
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <div className="sticky bottom-0 p-4 bg-gray-50 rounded-b-3xl flex gap-3 border-t border-gray-100">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 bg-white border border-gray-200 text-gray-600 font-bold rounded-xl hover:bg-gray-100"
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
    return d.toISOString().split('T')[0];
}

// ============================================================
// Seller Row
// ============================================================
const SellerRow = memo<{
    seller: AdminUserRow;
    onEdit: (s: AdminUserRow) => void;
}>(({ seller, onEdit }) => {
    const expiresAt = seller.subscription_expires_at
        ? new Date(seller.subscription_expires_at)
        : null;
    const daysLeft = expiresAt
        ? Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null;

    const planMeta: Record<string, { label: string; color: string; icon: string }> = {
        premium: { label: 'مميزة', color: 'bg-emerald-100 text-emerald-700', icon: '⭐' },
        trial: { label: 'تجريبية', color: 'bg-amber-100 text-amber-700', icon: '🎁' },
        free: { label: 'مجانية', color: 'bg-gray-100 text-gray-700', icon: '🆓' },
    };
    const meta = planMeta[seller.subscription_plan ?? 'free'] ?? planMeta.free;

    return (
        <button
            onClick={() => onEdit(seller)}
            className={`w-full text-right p-4 rounded-2xl border transition-all hover:shadow-md hover:-translate-y-0.5 ${
                seller.is_suspended
                    ? 'bg-red-50 border-red-200'
                    : 'bg-white border-gray-100 hover:border-purple-200'
            }`}
        >
            <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-100 to-fuchsia-100 flex items-center justify-center text-xl font-bold text-purple-600 flex-shrink-0">
                    {seller.shop?.[0] ?? seller.name?.[0] ?? '?'}
                </div>
                <div className="flex-1 min-w-0 text-right">
                    <div className="font-bold text-sm text-gray-900 truncate flex items-center gap-2">
                        {seller.shop ?? seller.name}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${meta.color}`}>
                            {meta.icon} {meta.label}
                        </span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 truncate" dir="ltr">
                        {seller.phone ?? '—'}
                    </div>
                    {expiresAt && daysLeft !== null && (
                        <div
                            className={`text-[10px] mt-1 font-bold ${
                                daysLeft < 7
                                    ? 'text-red-600'
                                    : daysLeft < 30
                                    ? 'text-amber-600'
                                    : 'text-gray-500'
                            }`}
                        >
                            {daysLeft > 0 ? `ينتهي خلال ${daysLeft} يوم` : 'منتهي'} ·{' '}
                            {expiresAt.toLocaleDateString('ar-SA')}
                        </div>
                    )}
                </div>
                <div className="flex-shrink-0 text-left">
                    <div className="text-base font-extrabold text-emerald-600 tabular-nums">
                        {(seller.subscription_amount ?? 0).toLocaleString('ar-SA')}
                    </div>
                    <div className="text-[10px] text-gray-500 font-medium">ر.س/شهر</div>
                    {(seller.discount_percentage ?? 0) > 0 && (
                        <div className="text-[10px] mt-0.5 bg-orange-100 text-orange-700 rounded px-1.5 py-0.5 font-bold">
                            خصم {seller.discount_percentage}%
                        </div>
                    )}
                </div>
            </div>
        </button>
    );
});
SellerRow.displayName = 'SellerRow';

// ============================================================
// Main Component
// ============================================================
const AdminSellers: React.FC = () => {
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [filter, setFilter] = useState<FilterTab>('all');
    const [sellers, setSellers] = useState<AdminUserRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState<AdminUserRow | null>(null);

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
        if (filter === 'all') return sellers;
        if (filter === 'suspended') return sellers.filter((s) => s.is_suspended);
        return sellers.filter((s) => s.subscription_plan === filter && !s.is_suspended);
    }, [sellers, filter]);

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
            <div>
                <h1 className="text-2xl font-extrabold text-gray-900">🏪 إدارة البائعين</h1>
                <p className="text-sm text-gray-500 mt-0.5">
                    تحكم كامل بالاشتراكات والخصومات بضغطة زر واحدة
                </p>
            </div>

            {/* Stats strip */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-4 text-white shadow-lg">
                    <div className="text-3xl font-extrabold tabular-nums">
                        {stats.mrr.toLocaleString('ar-SA')}
                    </div>
                    <div className="text-xs opacity-90 mt-0.5">MRR (ر.س/شهر)</div>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                    <div className="text-2xl font-extrabold text-emerald-600">{stats.premium}</div>
                    <div className="text-xs text-gray-500 mt-0.5">⭐ مميز</div>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                    <div className="text-2xl font-extrabold text-amber-500">{stats.trial}</div>
                    <div className="text-xs text-gray-500 mt-0.5">🎁 تجريبي</div>
                </div>
                <div className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm">
                    <div className="text-2xl font-extrabold text-gray-500">{stats.free}</div>
                    <div className="text-xs text-gray-500 mt-0.5">🆓 مجاني</div>
                </div>
            </div>

            {/* Filters + Search */}
            <div className="space-y-3">
                <input
                    type="text"
                    placeholder="🔍 ابحث باسم المتجر، الجوال، الإيميل..."
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full px-5 py-4 bg-white border border-gray-200 rounded-2xl shadow-sm text-sm focus:border-purple-500 focus:shadow-md outline-none transition-all"
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
                                    : 'bg-white border border-gray-200 text-gray-600 hover:border-purple-300'
                            }`}
                        >
                            {f.icon} {f.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* List */}
            {loading ? (
                <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="h-20 bg-gray-100 rounded-2xl animate-pulse" />
                    ))}
                </div>
            ) : filtered.length === 0 ? (
                <div className="bg-white rounded-2xl p-12 border border-dashed border-gray-200 text-center text-gray-400">
                    لا توجد نتائج لهذا الفلتر.
                </div>
            ) : (
                <div className="space-y-2">
                    {filtered.map((s) => (
                        <SellerRow key={s.id} seller={s} onEdit={setEditing} />
                    ))}
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
