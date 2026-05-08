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
    onToggle: () => void | Promise<void>;
    color?: 'green' | 'blue' | 'purple';
}>(({ icon, title, subtitle, enabled, onToggle, color = 'green' }) => {
    const [busy, setBusy] = useState(false);
    const colors = {
        green: enabled ? 'bg-emerald-500' : 'bg-[var(--gray-300)]',
        blue: enabled ? 'bg-blue-500' : 'bg-[var(--gray-300)]',
        purple: enabled ? 'bg-purple-500' : 'bg-[var(--gray-300)]',
    };
    const handleClick = async () => {
        if (busy) return;
        setBusy(true);
        try { await onToggle(); } finally { setBusy(false); }
    };
    return (
        <div className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm flex items-center gap-4">
            <div className="text-3xl">{icon}</div>
            <div className="flex-1">
                <div className="font-bold text-[var(--text-primary)]">{title}</div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">{subtitle}</div>
            </div>
            <button
                onClick={handleClick}
                disabled={busy}
                aria-busy={busy}
                aria-pressed={enabled}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-all duration-300 ease-out ${colors[color]} active:scale-95 ${busy ? 'opacity-70 cursor-wait' : 'cursor-pointer hover:brightness-110'}`}
            >
                <span
                    className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ease-out ${
                        enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                />
            </button>
        </div>
    );
});
ToggleCard.displayName = 'ToggleCard';

// Reusable smooth toggle pill — used inline in lists where the row card
// supplies its own layout. Optimistic by design: flips visually immediately
// while the parent's onToggle reconciles with the server.
const ToggleSwitch: React.FC<{
    enabled: boolean;
    onToggle: () => void | Promise<void>;
    color?: 'green' | 'blue';
    size?: 'sm' | 'md';
    label?: string;
}> = ({ enabled, onToggle, color = 'green', size = 'sm', label }) => {
    const [busy, setBusy] = useState(false);
    const handleClick = async () => {
        if (busy) return;
        setBusy(true);
        try { await onToggle(); } finally { setBusy(false); }
    };
    const dims = size === 'md' ? 'h-7 w-12' : 'h-6 w-11';
    const knob = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
    const onColor = color === 'green' ? 'bg-emerald-500' : 'bg-blue-500';
    return (
        <button
            onClick={handleClick}
            disabled={busy}
            aria-busy={busy}
            aria-pressed={enabled}
            aria-label={label}
            className={`relative inline-flex ${dims} items-center rounded-full transition-all duration-300 ease-out ${enabled ? onColor : 'bg-[var(--gray-300)]'} active:scale-95 ${busy ? 'opacity-70 cursor-wait' : 'cursor-pointer hover:brightness-110'}`}
        >
            <span
                className={`inline-block ${knob} transform rounded-full bg-white shadow-md transition-transform duration-300 ease-out ${
                    size === 'md'
                        ? (enabled ? 'translate-x-6' : 'translate-x-1')
                        : (enabled ? 'translate-x-6' : 'translate-x-1')
                }`}
            />
        </button>
    );
};

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
// Campaign Modal — لإنشاء وتعديل حملة ترويجية
// ============================================================
type CampaignDraft = {
    title_ar: string;
    title_en: string;
    body_ar: string;
    body_en: string;
    target_audience: 'all' | 'buyer' | 'seller';
    target_city: string;
    target_region: string;
    image_url: string;
    action_url: string;
    action_label_ar: string;
    action_label_en: string;
    starts_at: string;
    ends_at: string;
    priority: number;
    is_active: boolean;
};

const emptyCampaign: CampaignDraft = {
    title_ar: '',
    title_en: '',
    body_ar: '',
    body_en: '',
    target_audience: 'all',
    target_city: '',
    target_region: '',
    image_url: '',
    action_url: '',
    action_label_ar: '',
    action_label_en: '',
    starts_at: '',
    ends_at: '',
    priority: 0,
    is_active: true,
};

const CampaignModal: React.FC<{
    initial: any | null;
    onClose: () => void;
    onSaved: () => void;
}> = ({ initial, onClose, onSaved }) => {
    const { customAlert } = useApp();
    const isEdit = Boolean(initial?.id);
    const [form, setForm] = useState<CampaignDraft>(() => ({
        ...emptyCampaign,
        ...(initial ?? {}),
        starts_at: initial?.starts_at ? toLocalDateInput(initial.starts_at) : '',
        ends_at: initial?.ends_at ? toLocalDateInput(initial.ends_at) : '',
        target_audience: (initial?.target_audience as any) ?? 'all',
        priority: initial?.priority ?? 0,
        is_active: initial?.is_active ?? true,
    }));
    const [saving, setSaving] = useState(false);

    const set = <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) =>
        setForm((prev) => ({ ...prev, [k]: v }));

    const handleSave = async () => {
        if (!form.title_ar.trim() || !form.body_ar.trim()) {
            await customAlert('⚠️ العنوان والمحتوى (عربي) مطلوبان');
            return;
        }
        if (saving) return;
        setSaving(true);
        // The DB has NOT NULL on title_en/body_en. Mirror Arabic when missing
        // so admins can publish a single-language campaign without friction.
        const row: any = {
            title_ar: form.title_ar.trim(),
            title_en: (form.title_en.trim() || form.title_ar.trim()),
            body_ar: form.body_ar.trim(),
            body_en: (form.body_en.trim() || form.body_ar.trim()),
            target_audience: form.target_audience || 'all',
            target_city: form.target_city.trim() || null,
            target_region: form.target_region.trim() || null,
            image_url: form.image_url.trim() || null,
            action_url: form.action_url.trim() || null,
            action_label_ar: form.action_label_ar.trim() || null,
            action_label_en: form.action_label_en.trim() || null,
            starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : new Date().toISOString(),
            ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
            priority: Number(form.priority) || 0,
            is_active: form.is_active,
        };

        // 15s timeout so a stalled network call never leaves the button
        // stuck on "جاري الحفظ...". The user sees a clear error and can retry.
        const networkCall = isEdit
            ? supabase.from('promotional_campaigns').update(row).eq('id', initial.id).select().maybeSingle()
            : supabase.from('promotional_campaigns').insert([row]).select().maybeSingle();
        const timeout = new Promise<{ error: any }>(resolve =>
            setTimeout(() => resolve({ error: { message: 'انتهت مهلة الاتصال — تحقق من الإنترنت وحاول مجدداً' } }), 15000)
        );
        const result = await Promise.race([networkCall as any, timeout]);
        setSaving(false);
        if (result?.error) {
            console.error('Campaign save failed:', result.error);
            await customAlert('❌ ' + (result.error.message || 'فشل الحفظ — تحقق من الاتصال'));
            return;
        }
        await customAlert(isEdit ? '✅ تم تعديل الحملة' : '✅ تم نشر الحملة');
        onSaved();
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[3000] flex items-center justify-center p-4">
            <div className="bg-[var(--card-bg)] rounded-3xl max-w-2xl w-full max-h-[92vh] overflow-y-auto shadow-2xl">
                <div className="sticky top-0 bg-gradient-to-r from-pink-500 via-rose-500 to-red-500 text-white p-5 rounded-t-3xl flex items-center justify-between z-10">
                    <div>
                        <div className="text-xs opacity-80 mb-1">📢 حملة ترويجية</div>
                        <div className="text-xl font-bold">{isEdit ? 'تعديل الحملة' : 'حملة جديدة'}</div>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-xl">✕</button>
                </div>

                <div className="p-5 space-y-4">
                    {/* الجمهور المستهدف */}
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-2">🎯 الجمهور المستهدف</label>
                        <div className="grid grid-cols-3 gap-2">
                            {([
                                { v: 'all', label: 'الجميع', icon: '👥' },
                                { v: 'buyer', label: 'المشترون', icon: '🛒' },
                                { v: 'seller', label: 'البائعون', icon: '🏪' },
                            ] as const).map((o) => (
                                <button
                                    key={o.v}
                                    onClick={() => set('target_audience', o.v as any)}
                                    className={`p-3 rounded-xl border-2 font-bold text-sm transition-all ${
                                        form.target_audience === o.v
                                            ? 'bg-pink-50 border-pink-500 text-pink-700'
                                            : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-secondary)]'
                                    }`}
                                >
                                    <div className="text-2xl mb-1">{o.icon}</div>
                                    {o.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* العنوان والمحتوى — عربي */}
                    <Field label="العنوان (عربي) *" value={form.title_ar} onChange={(v) => set('title_ar', v)} placeholder="مثال: عيد سعيد — خصومات تصل 70%" />
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">المحتوى (عربي) *</label>
                        <textarea
                            rows={3}
                            value={form.body_ar}
                            onChange={(e) => set('body_ar', e.target.value)}
                            placeholder="اكتب نص الحملة الذي سيظهر للمستخدمين..."
                            className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-pink-500 focus:bg-[var(--card-bg)] outline-none"
                        />
                    </div>

                    {/* English (optional) */}
                    <details className="rounded-xl border border-[var(--border-color)] bg-[var(--body-bg)]">
                        <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-[var(--text-secondary)]">🌐 إضافة نسخة إنجليزية (اختياري — تنسخ العربية تلقائياً إذا تركت فارغة)</summary>
                        <div className="p-3 space-y-3">
                            <Field label="Title (English)" value={form.title_en} onChange={(v) => set('title_en', v)} />
                            <div>
                                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">Body (English)</label>
                                <textarea
                                    rows={2}
                                    value={form.body_en}
                                    onChange={(e) => set('body_en', e.target.value)}
                                    className="w-full px-3 py-2.5 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl text-sm outline-none"
                                />
                            </div>
                        </div>
                    </details>

                    {/* جدولة */}
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-2">📅 الجدولة (اختياري)</label>
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <div className="text-[10px] text-[var(--gray-400)] mb-1">يبدأ</div>
                                <input
                                    type="datetime-local"
                                    value={form.starts_at}
                                    onChange={(e) => set('starts_at', e.target.value)}
                                    className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-pink-500 outline-none"
                                />
                            </div>
                            <div>
                                <div className="text-[10px] text-[var(--gray-400)] mb-1">ينتهي (فارغ = بلا انتهاء)</div>
                                <input
                                    type="datetime-local"
                                    value={form.ends_at}
                                    onChange={(e) => set('ends_at', e.target.value)}
                                    className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-pink-500 outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* CTA + media (collapsible) */}
                    <details className="rounded-xl border border-[var(--border-color)] bg-[var(--body-bg)]">
                        <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-[var(--text-secondary)]">🔗 زر إجراء + صورة (اختياري)</summary>
                        <div className="p-3 space-y-3">
                            <Field label="رابط الصورة" value={form.image_url} onChange={(v) => set('image_url', v)} placeholder="https://..." />
                            <Field label="رابط عند الضغط" value={form.action_url} onChange={(v) => set('action_url', v)} placeholder="/store/abc أو https://..." />
                            <div className="grid grid-cols-2 gap-3">
                                <Field label="نص الزر (عربي)" value={form.action_label_ar} onChange={(v) => set('action_label_ar', v)} placeholder="تصفح العروض" />
                                <Field label="نص الزر (English)" value={form.action_label_en} onChange={(v) => set('action_label_en', v)} placeholder="Browse" />
                            </div>
                        </div>
                    </details>

                    {/* أولوية + استهداف جغرافي */}
                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">⚡ الأولوية</label>
                            <input
                                type="number"
                                min={0}
                                value={form.priority}
                                onChange={(e) => set('priority', Number(e.target.value) || 0)}
                                className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm outline-none"
                            />
                        </div>
                        <Field label="مدينة (اختياري)" value={form.target_city} onChange={(v) => set('target_city', v)} placeholder="riyadh" />
                        <Field label="منطقة (اختياري)" value={form.target_region} onChange={(v) => set('target_region', v)} placeholder="central" />
                    </div>

                    {/* تفعيل فوري */}
                    <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl border border-emerald-100">
                        <div>
                            <div className="font-bold text-sm text-emerald-800">تفعيل الحملة فوراً</div>
                            <div className="text-xs text-emerald-600 mt-0.5">إذا أُلغي، تحفظ كمسوّدة</div>
                        </div>
                        <button
                            onClick={() => set('is_active', !form.is_active)}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.is_active ? 'bg-emerald-500' : 'bg-[var(--gray-300)]'}`}
                        >
                            <span className={`inline-block h-4 w-4 transform rounded-full bg-[var(--card-bg)] transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                    </div>
                </div>

                <div className="sticky bottom-0 bg-[var(--body-bg)] p-4 rounded-b-3xl flex gap-3 border-t border-[var(--border-color)]">
                    <button onClick={onClose} className="flex-1 py-3 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] font-bold rounded-xl">إلغاء</button>
                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex-[2] py-3 bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold rounded-xl hover:shadow-lg disabled:opacity-50"
                    >
                        {saving ? 'جاري الحفظ...' : (isEdit ? '💾 حفظ التعديلات' : '🚀 نشر الحملة')}
                    </button>
                </div>
            </div>
        </div>
    );
};

function toLocalDateInput(iso: string): string {
    try {
        const d = new Date(iso);
        const tzOffset = d.getTimezoneOffset() * 60000;
        return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
    } catch { return ''; }
}

// ============================================================
// Quick-post box — write a campaign right inside the page, in 3 fields.
// For anything more than a one-shot announcement, use the full modal.
// ============================================================
const QuickCampaignBox: React.FC<{ onPosted: () => void; onAdvanced: () => void }> = ({ onPosted, onAdvanced }) => {
    const { customAlert } = useApp();
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [audience, setAudience] = useState<'all' | 'buyer' | 'seller'>('all');
    const [posting, setPosting] = useState(false);

    const handlePost = async () => {
        const t = title.trim();
        const b = body.trim();
        if (!t || !b) {
            await customAlert('⚠️ اكتب العنوان والمحتوى قبل النشر.');
            return;
        }
        setPosting(true);
        const { error } = await supabase.from('promotional_campaigns').insert([{
            title_ar: t,
            title_en: t,    // mirror — admin can refine later via modal
            body_ar: b,
            body_en: b,
            target_audience: audience,
            starts_at: new Date().toISOString(),
            ends_at: null,
            priority: 0,
            is_active: true,
        }]);
        setPosting(false);
        if (error) {
            await customAlert('❌ ' + error.message);
            return;
        }
        setTitle('');
        setBody('');
        onPosted();
    };

    return (
        <div className="bg-gradient-to-br from-pink-50 via-rose-50 to-orange-50 border border-pink-200 rounded-2xl p-4 mb-3">
            <div className="flex items-center justify-between mb-3">
                <div className="font-bold text-sm text-pink-900 flex items-center gap-2">📝 اكتب حملة بسرعة</div>
                <button
                    onClick={onAdvanced}
                    className="text-[11px] text-pink-700 font-bold hover:underline"
                >
                    ⚙️ خيارات متقدمة (تواريخ، صورة، زر إجراء...)
                </button>
            </div>
            <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="✏️ اكتب العنوان هنا..."
                className="w-full px-3 py-2.5 bg-[var(--card-bg)] border border-pink-200 rounded-xl text-sm font-bold focus:border-pink-500 outline-none mb-2"
            />
            <textarea
                rows={3}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="📄 اكتب المحتوى الذي سيظهر للمستخدمين..."
                className="w-full px-3 py-2.5 bg-[var(--card-bg)] border border-pink-200 rounded-xl text-sm focus:border-pink-500 outline-none mb-3"
            />
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex gap-1.5">
                    {([
                        { v: 'all', label: '👥 الكل' },
                        { v: 'buyer', label: '🛒 المشترون' },
                        { v: 'seller', label: '🏪 البائعون' },
                    ] as const).map((o) => (
                        <button
                            key={o.v}
                            onClick={() => setAudience(o.v)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                audience === o.v
                                    ? 'bg-pink-500 text-white'
                                    : 'bg-[var(--card-bg)] text-[var(--text-secondary)] border border-pink-200'
                            }`}
                        >
                            {o.label}
                        </button>
                    ))}
                </div>
                <button
                    onClick={handlePost}
                    disabled={posting || !title.trim() || !body.trim()}
                    className="px-5 py-2 bg-gradient-to-r from-pink-500 to-rose-600 text-white font-bold rounded-xl text-sm shadow-md hover:shadow-lg disabled:opacity-50"
                >
                    {posting ? '... جاري النشر' : '📤 نشر فوراً'}
                </button>
            </div>
        </div>
    );
};

// ============================================================
// Main Component
// ============================================================
const AdminTools: React.FC = () => {
    const { customAlert, customConfirm } = useApp();
    const [paymentEnabled, setPaymentEnabled] = useState(false);
    const [seasonalVisible, setSeasonalVisible] = useState(false);
    const [banners, setBanners] = useState<any[]>([]);
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [bannerModalOpen, setBannerModalOpen] = useState(false);
    const [campaignModal, setCampaignModal] = useState<{ open: boolean; initial: any | null }>({ open: false, initial: null });
    const [loading, setLoading] = useState(true);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        // BUG FIX: code used to query a non-existent `global_settings` table
        // with key `is_payment_gateway_enabled`. Real table is `platform_settings`,
        // real key is `payment_gateway_enabled`, value is a jsonb boolean (not string).
        const [paymentRes, seasonalRes, bannerRes, campaignRes] = await Promise.all([
            supabase.from('platform_settings').select('value').eq('key', 'payment_gateway_enabled').maybeSingle(),
            supabase.from('platform_settings').select('value').eq('key', 'seasonal_offers_visible').maybeSingle(),
            supabase.from('banners').select('*').order('display_order', { ascending: true }),
            supabase.from('promotional_campaigns').select('*').order('created_at', { ascending: false }).limit(20),
        ]);

        setPaymentEnabled(paymentRes.data?.value === true);
        setSeasonalVisible(seasonalRes.data?.value === true);
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
        const { error } = await supabase
            .from('platform_settings')
            .update({ value: newValue, updated_at: new Date().toISOString() })
            .eq('key', 'payment_gateway_enabled');
        if (error) {
            setPaymentEnabled(!newValue); // rollback optimistic update
            await customAlert('❌ ' + error.message);
            return;
        }
        await customAlert(
            newValue
                ? '✅ تم تفعيل بوابة الدفع. التجار سيحتاجون اشتراك لإضافة عروض.'
                : '✅ تم تعطيل البوابة. التطبيق الآن مجاني بالكامل.'
        );
    };

    const toggleSeasonal = async () => {
        const newValue = !seasonalVisible;
        setSeasonalVisible(newValue); // optimistic — toggle pill snaps instantly
        // Upsert so the row is created the first time. Supabase realtime
        // listener in AppContext propagates the new value to every client.
        const { error } = await supabase
            .from('platform_settings')
            .upsert({ key: 'seasonal_offers_visible', value: newValue, description: 'Show/hide seasonal offers section across the app', updated_at: new Date().toISOString() });
        if (error) {
            setSeasonalVisible(!newValue);
            await customAlert('❌ ' + error.message);
        }
    };

    const deleteBanner = async (id: string) => {
        const ok = await customConfirm('هل تريد حذف هذا البانر نهائياً؟');
        if (!ok) return;
        // Optimistic remove — UI reacts instantly; rollback on failure.
        const previous = banners;
        setBanners(prev => prev.filter(b => b.id !== id));
        const { error } = await supabase.from('banners').delete().eq('id', id);
        if (error) {
            setBanners(previous);
            await customAlert('❌ ' + error.message);
        }
    };

    const toggleBanner = async (b: any) => {
        const next = !b.is_active;
        // Flip locally first — toggle pill snaps instantly.
        setBanners(prev => prev.map(x => x.id === b.id ? { ...x, is_active: next } : x));
        const { error } = await supabase.from('banners').update({ is_active: next }).eq('id', b.id);
        if (error) {
            setBanners(prev => prev.map(x => x.id === b.id ? { ...x, is_active: !next } : x));
            await customAlert('❌ ' + error.message);
        }
    };

    const toggleCampaign = async (c: any) => {
        const next = !c.is_active;
        setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, is_active: next } : x));
        const { error } = await supabase.from('promotional_campaigns').update({ is_active: next }).eq('id', c.id);
        if (error) {
            setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, is_active: !next } : x));
            await customAlert('❌ ' + error.message);
        }
    };

    const deleteCampaign = async (c: any) => {
        const ok = await customConfirm(`حذف حملة "${c.title_ar}" نهائياً؟`);
        if (!ok) return;
        const previous = campaigns;
        setCampaigns(prev => prev.filter(x => x.id !== c.id));
        const { error } = await supabase.from('promotional_campaigns').delete().eq('id', c.id);
        if (error) {
            setCampaigns(previous);
            await customAlert('❌ ' + error.message);
        }
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
                    <ToggleCard
                        icon="🌙"
                        title="عروض الموسم"
                        subtitle={
                            seasonalVisible
                                ? 'ظاهرة لجميع المستخدمين في القائمة الجانبية'
                                : 'مخفية — لن تظهر لأي مستخدم'
                        }
                        enabled={seasonalVisible}
                        onToggle={toggleSeasonal}
                        color="purple"
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
                                    <div className="flex gap-2 mt-3 items-center">
                                        <ToggleSwitch
                                            enabled={b.is_active}
                                            onToggle={() => toggleBanner(b)}
                                            label={b.is_active ? 'إيقاف' : 'تفعيل'}
                                        />
                                        <span className="text-[10px] font-bold text-[var(--text-secondary)]">
                                            {b.is_active ? 'نشط' : 'متوقف'}
                                        </span>
                                        <div className="flex-1" />
                                        <button
                                            type="button"
                                            onClick={() => deleteBanner(b.id)}
                                            className="px-3 py-1.5 text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-all duration-200 active:scale-90"
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
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">📢 الحملات الترويجية</h2>
                </div>

                {/* Inline quick-post — fastest path: title + body + go */}
                <QuickCampaignBox
                    onPosted={fetchAll}
                    onAdvanced={() => setCampaignModal({ open: true, initial: null })}
                />

                {campaigns.length === 0 ? (
                    <div className="bg-[var(--card-bg)] rounded-2xl p-6 border border-dashed border-[var(--border-color)] text-center text-sm text-[var(--text-secondary)]">
                        لا توجد حملات بعد. اكتب حملتك الأولى في المربع أعلاه واضغط نشر.
                    </div>
                ) : (
                    <div className="space-y-2">
                        {campaigns.map((c) => {
                            const audienceLabel: Record<string, string> = { all: '👥 الجميع', buyer: '🛒 المشترون', seller: '🏪 البائعون' };
                            const ends = c.ends_at ? new Date(c.ends_at) : null;
                            const ended = ends && ends.getTime() < Date.now();
                            return (
                                <div
                                    key={c.id}
                                    className={`bg-[var(--card-bg)] rounded-2xl p-4 border ${ended ? 'border-red-200 opacity-70' : 'border-[var(--border-color)]'} flex items-start gap-3`}
                                >
                                    <div className="text-2xl flex-shrink-0">{c.image_url ? '🖼️' : '📢'}</div>
                                    <div className="flex-1 min-w-0">
                                        <div className="font-bold text-sm text-[var(--text-primary)] truncate">{c.title_ar}</div>
                                        <div className="text-xs text-[var(--text-secondary)] line-clamp-2 mt-0.5">{c.body_ar}</div>
                                        <div className="text-[10px] text-[var(--gray-400)] mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5">
                                            <span>{audienceLabel[c.target_audience] ?? c.target_audience}</span>
                                            <span>•</span>
                                            <span>أولوية {c.priority ?? 0}</span>
                                            {c.target_city && <><span>•</span><span>📍 {c.target_city}</span></>}
                                            {ends && (
                                                <>
                                                    <span>•</span>
                                                    <span className={ended ? 'text-red-600 font-bold' : ''}>
                                                        {ended ? 'منتهية' : `حتى ${ends.toLocaleDateString('ar-SA')}`}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                        <ToggleSwitch
                                            enabled={c.is_active}
                                            onToggle={() => toggleCampaign(c)}
                                            label={c.is_active ? 'إيقاف' : 'تفعيل'}
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setCampaignModal({ open: true, initial: c })}
                                            className="w-8 h-8 rounded-lg bg-[var(--gray-100)] hover:bg-[var(--gray-200)] text-[var(--text-secondary)] flex items-center justify-center transition-all duration-200 active:scale-90"
                                            aria-label="تعديل"
                                        >
                                            ✏️
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => deleteCampaign(c)}
                                            className="w-8 h-8 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 flex items-center justify-center transition-all duration-200 active:scale-90"
                                            aria-label="حذف"
                                        >
                                            🗑
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {bannerModalOpen && (
                <BannerModal onClose={() => setBannerModalOpen(false)} onSaved={fetchAll} />
            )}
            {campaignModal.open && (
                <CampaignModal
                    initial={campaignModal.initial}
                    onClose={() => setCampaignModal({ open: false, initial: null })}
                    onSaved={fetchAll}
                />
            )}
        </div>
    );
};

export default memo(AdminTools);
