/**
 * AdminTools — أدوات الإدارة المتقدمة
 *
 * يجمع:
 *  - بوابة الدفع SaaS toggle
 *  - إدارة البانرات الإعلانية (CRUD)
 *  - الحملات الترويجية (إنشاء، تفعيل، إيقاف)
 *  - الإعدادات العامة
 */

import React, { useEffect, useState, useCallback, memo } from 'react';
import { supabase } from '../../services/supabaseClient';
import { useApp } from '../../context/AppContext';

// ============================================================
// Setting Toggle Card
// ============================================================
const ToggleCard = memo<{
    icon: string;
    title: string;
    subtitle: string;
    enabled: boolean;
    onToggle: () => void;
    color?: 'green' | 'blue' | 'purple';
}>(({ icon, title, subtitle, enabled, onToggle, color = 'green' }) => {
    const colors = {
        green: enabled ? 'bg-emerald-500' : 'bg-[var(--gray-300)]',
        blue: enabled ? 'bg-blue-500' : 'bg-[var(--gray-300)]',
        purple: enabled ? 'bg-purple-500' : 'bg-[var(--gray-300)]',
    };
    return (
        <div className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm flex items-center gap-4">
            <div className="text-3xl">{icon}</div>
            <div className="flex-1">
                <div className="font-bold text-[var(--text-primary)]">{title}</div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">{subtitle}</div>
            </div>
            <button
                onClick={onToggle}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${colors[color]}`}
            >
                <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-[var(--card-bg)] shadow transition-transform ${
                        enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
            </button>
        </div>
    );
});
ToggleCard.displayName = 'ToggleCard';

// ============================================================
// Banner Modal
// ============================================================
const BannerModal: React.FC<{
    onClose: () => void;
    onSaved: () => void;
}> = ({ onClose, onSaved }) => {
    const { customAlert } = useApp();
    const [form, setForm] = useState({
        title_ar: '',
        title_en: '',
        image_url: '',
        target_url: '',
        deal_id: '',
        store_id: '',
        position: 'home_top',
        is_active: true,
    });
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        if (!form.image_url.trim()) {
            await customAlert('⚠️ يرجى إضافة رابط الصورة');
            return;
        }
        setSaving(true);
        const { error } = await supabase.from('banners').insert([form]);
        setSaving(false);
        if (error) {
            await customAlert('❌ ' + error.message);
            return;
        }
        await customAlert('✅ تم نشر البانر بنجاح');
        onSaved();
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[3000] flex items-center justify-center p-4">
            <div className="bg-[var(--card-bg)] rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
                <div className="sticky top-0 bg-gradient-to-r from-orange-500 to-red-600 text-white p-5 rounded-t-3xl flex items-center justify-between">
                    <div className="text-xl font-bold">🖼️ بانر إعلاني جديد</div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center"
                    >
                        ✕
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {form.image_url && (
                        <div className="rounded-2xl overflow-hidden border border-[var(--border-color)]">
                            <img
                                src={form.image_url}
                                alt=""
                                className="w-full h-32 object-cover"
                                onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                            />
                        </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                        <Field
                            label="العنوان (عربي)"
                            value={form.title_ar}
                            onChange={(v) => setForm({ ...form, title_ar: v })}
                        />
                        <Field
                            label="العنوان (English)"
                            value={form.title_en}
                            onChange={(v) => setForm({ ...form, title_en: v })}
                        />
                    </div>
                    <Field
                        label="رابط الصورة (URL)"
                        value={form.image_url}
                        onChange={(v) => setForm({ ...form, image_url: v })}
                        placeholder="https://..."
                    />
                    <Field
                        label="رابط الوجهة (اختياري)"
                        value={form.target_url}
                        onChange={(v) => setForm({ ...form, target_url: v })}
                        placeholder="https://..."
                    />
                    <div className="grid grid-cols-2 gap-3">
                        <Field
                            label="ID العرض (اختياري)"
                            value={form.deal_id}
                            onChange={(v) => setForm({ ...form, deal_id: v })}
                        />
                        <Field
                            label="ID المتجر (اختياري)"
                            value={form.store_id}
                            onChange={(v) => setForm({ ...form, store_id: v })}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">المكان</label>
                        <select
                            value={form.position}
                            onChange={(e) => setForm({ ...form, position: e.target.value })}
                            className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm"
                        >
                            <option value="home_top">أعلى الصفحة الرئيسية</option>
                            <option value="category_top">أعلى التصنيفات</option>
                        </select>
                    </div>
                </div>

                <div className="sticky bottom-0 bg-[var(--body-bg)] p-4 rounded-b-3xl flex gap-3 border-t">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] font-bold rounded-xl"
                    >
                        إلغاء
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-[2] py-3 bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold rounded-xl disabled:opacity-50"
                    >
                        {saving ? 'جاري النشر...' : '🚀 نشر البانر'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const Field = memo<{
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
}>(({ label, value, onChange, placeholder }) => (
    <div>
        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">{label}</label>
        <input
            type="text"
            placeholder={placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-orange-500 focus:bg-[var(--card-bg)] outline-none"
        />
    </div>
));
Field.displayName = 'Field';

// ============================================================
// Main Component
// ============================================================
const AdminTools: React.FC = () => {
    const { customAlert, customConfirm } = useApp();
    const [paymentEnabled, setPaymentEnabled] = useState(false);
    const [banners, setBanners] = useState<any[]>([]);
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [bannerModalOpen, setBannerModalOpen] = useState(false);
    const [loading, setLoading] = useState(true);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        const [paymentRes, bannerRes, campaignRes] = await Promise.all([
            supabase.from('global_settings').select('value').eq('key', 'is_payment_gateway_enabled').maybeSingle(),
            supabase.from('banners').select('*').order('display_order', { ascending: true }),
            supabase.from('promotional_campaigns').select('*').order('created_at', { ascending: false }).limit(20),
        ]);

        setPaymentEnabled(paymentRes.data?.value === 'true');
        setBanners(bannerRes.data ?? []);
        setCampaigns(campaignRes.data ?? []);
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    const togglePayment = async () => {
        const newValue = !paymentEnabled;
        setPaymentEnabled(newValue);
        await supabase.from('global_settings').upsert({
            key: 'is_payment_gateway_enabled',
            value: newValue.toString(),
            updated_at: new Date().toISOString(),
        });
        await customAlert(
            newValue
                ? '✅ تم تفعيل بوابة الدفع. التجار سيحتاجون اشتراك لإضافة عروض.'
                : '✅ تم تعطيل البوابة. التطبيق الآن مجاني بالكامل.'
        );
    };

    const deleteBanner = async (id: string) => {
        const ok = await customConfirm('هل تريد حذف هذا البانر نهائياً؟');
        if (!ok) return;
        await supabase.from('banners').delete().eq('id', id);
        fetchAll();
    };

    const toggleBanner = async (b: any) => {
        await supabase.from('banners').update({ is_active: !b.is_active }).eq('id', b.id);
        fetchAll();
    };

    const toggleCampaign = async (c: any) => {
        await supabase.from('promotional_campaigns').update({ is_active: !c.is_active }).eq('id', c.id);
        fetchAll();
    };

    return (
        <div className="space-y-6 animate-fade-in" dir="rtl">
            <div>
                <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">🛠️ أدوات الإدارة</h1>
                <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                    إعدادات المنصة، البانرات، الحملات الترويجية
                </p>
            </div>

            {/* Settings */}
            <section>
                <h2 className="text-lg font-bold text-[var(--text-primary)] mb-3">⚙️ الإعدادات العامة</h2>
                <div className="space-y-3">
                    <ToggleCard
                        icon="💳"
                        title="بوابة الدفع (SaaS)"
                        subtitle={
                            paymentEnabled
                                ? 'مُفعّلة — التجار يجب أن يشتركوا'
                                : 'مُعطّلة — التطبيق مجاني'
                        }
                        enabled={paymentEnabled}
                        onToggle={togglePayment}
                    />
                </div>
            </section>

            {/* Banners */}
            <section>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">🖼️ البانرات الإعلانية</h2>
                    <button
                        onClick={() => setBannerModalOpen(true)}
                        className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold rounded-xl text-sm shadow-md hover:shadow-lg transition-all"
                    >
                        ➕ بانر جديد
                    </button>
                </div>
                {loading ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {Array.from({ length: 2 }).map((_, i) => (
                            <div key={i} className="h-32 bg-[var(--gray-100)] rounded-2xl animate-pulse" />
                        ))}
                    </div>
                ) : banners.length === 0 ? (
                    <div className="bg-[var(--card-bg)] rounded-2xl p-12 border border-dashed border-[var(--border-color)] text-center text-[var(--gray-400)]">
                        لا توجد بانرات. أضف الأول الآن.
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {banners.map((b) => (
                            <div
                                key={b.id}
                                className="bg-[var(--card-bg)] rounded-2xl overflow-hidden border border-[var(--border-color)] shadow-sm"
                            >
                                <div className="relative h-32 bg-[var(--gray-100)]">
                                    {b.image_url && (
                                        <img
                                            src={b.image_url}
                                            alt=""
                                            className="w-full h-full object-cover"
                                            onError={(e) =>
                                                ((e.target as HTMLImageElement).style.display = 'none')
                                            }
                                        />
                                    )}
                                    <div className="absolute top-2 right-2">
                                        <span
                                            className={`px-2 py-1 rounded-md text-[10px] font-bold text-white ${
                                                b.is_active ? 'bg-emerald-500' : 'bg-red-500'
                                            }`}
                                        >
                                            {b.is_active ? '✓ نشط' : '✕ متوقف'}
                                        </span>
                                    </div>
                                </div>
                                <div className="p-3">
                                    <div className="font-bold text-sm truncate">
                                        {b.title_ar || 'بدون عنوان'}
                                    </div>
                                    <div className="text-xs text-[var(--text-secondary)] mt-0.5">{b.position}</div>
                                    <div className="flex gap-2 mt-3">
                                        <button
                                            onClick={() => toggleBanner(b)}
                                            className="flex-1 py-1.5 text-xs font-bold bg-[var(--body-bg)] hover:bg-[var(--gray-100)] rounded-lg"
                                        >
                                            {b.is_active ? 'إيقاف' : 'تفعيل'}
                                        </button>
                                        <button
                                            onClick={() => deleteBanner(b.id)}
                                            className="px-3 py-1.5 text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 rounded-lg"
                                        >
                                            🗑
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Campaigns */}
            <section>
                <h2 className="text-lg font-bold text-[var(--text-primary)] mb-3">📢 الحملات الترويجية</h2>
                {campaigns.length === 0 ? (
                    <div className="bg-[var(--card-bg)] rounded-2xl p-8 border border-dashed border-[var(--border-color)] text-center text-sm text-[var(--text-secondary)]">
                        لا توجد حملات. يمكنك إنشاؤها مباشرةً من Supabase SQL Editor.
                    </div>
                ) : (
                    <div className="space-y-2">
                        {campaigns.map((c) => (
                            <div
                                key={c.id}
                                className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] flex items-center gap-3"
                            >
                                <div className="text-2xl">📢</div>
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm truncate">{c.title_ar}</div>
                                    <div className="text-xs text-[var(--text-secondary)] truncate">{c.body_ar}</div>
                                    <div className="text-[10px] text-[var(--gray-400)] mt-1">
                                        {c.target_audience} • أولوية {c.priority}
                                    </div>
                                </div>
                                <button
                                    onClick={() => toggleCampaign(c)}
                                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                        c.is_active ? 'bg-emerald-500' : 'bg-[var(--gray-300)]'
                                    }`}
                                >
                                    <span
                                        className={`inline-block h-4 w-4 transform rounded-full bg-[var(--card-bg)] transition-transform ${
                                            c.is_active ? 'translate-x-6' : 'translate-x-1'
                                        }`}
                                    />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {bannerModalOpen && (
                <BannerModal onClose={() => setBannerModalOpen(false)} onSaved={fetchAll} />
            )}
        </div>
    );
};

export default memo(AdminTools);
