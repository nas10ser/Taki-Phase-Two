/**
 * AdminTools — أدوات الإدارة المتقدمة
 *
 * يجمع:
 *  - بوابة الدفع SaaS toggle
 *  - إدارة البانرات الإعلانية (CRUD)
 *  - الحملات الترويجية (إنشاء، تفعيل، إيقاف)
 *  - الإعدادات العامة
 */

import React, { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import { supabase } from '../../services/supabaseClient';
import { promoRepository } from '../../repositories/promoRepository';
import { storageService } from '../../services/storageService';
import { useApp } from '../../context/AppContext';
import { useEscClose } from '../../hooks/useEscClose';
import { Tooltip } from '../../components/admin/Tooltip';
import BannerImageEditor from '../../components/BannerImageEditor';
import { applySwUpdate } from '../../sw-cleanup';
import { SEASONS, campaignSellerOpen, campaignPublicLive, SeasonCampaign } from '../../data/seasons';

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
    initial?: any | null;
    onClose: () => void;
    onSaved: () => void;
}> = ({ initial, onClose, onSaved }) => {
    const { customAlert, language, deals } = useApp();
    const isRTL = language === 'ar';
    const isEdit = Boolean(initial?.id);
    const [form, setForm] = useState({
        title_ar: initial?.title_ar || '',
        title_en: initial?.title_en || '',
        image_url: initial?.image_url || '',
        target_url: initial?.target_url || '',
        deal_id: initial?.deal_id || '',
        store_id: initial?.store_id || '',
        position: initial?.position || 'home_top',
        is_active: initial?.is_active ?? true,
    });
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [editorSrc, setEditorSrc] = useState<string | null>(null);
    const [storeQuery, setStoreQuery] = useState('');
    const [selectedStoreName, setSelectedStoreName] = useState(
        initial?.store_id ? (deals.find(d => d.storeId === initial.store_id)?.shopName || '') : ''
    );
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Blob URL backing the "adjust existing image" flow — revoked on close.
    const objectUrlRef = useRef<string | null>(null);

    // Link a banner by NAME, not by ID. Stores + their deals are derived from
    // the deals already in memory, so the admin never types a UUID or a URL.
    // Each unique storeId→shopName is a selectable store; its active deals are
    // the deal options once a store is chosen.
    const stores = useMemo(() => {
        const map = new Map<string, string>();
        for (const d of deals) {
            if (d.storeId && !map.has(d.storeId)) map.set(d.storeId, d.shopName || d.storeId);
        }
        return Array.from(map, ([id, name]) => ({ id, name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'ar'));
    }, [deals]);

    const storeMatches = useMemo(() => {
        const q = storeQuery.trim().toLowerCase();
        if (!q) return [];
        return stores.filter(s => s.name.toLowerCase().includes(q)).slice(0, 8);
    }, [stores, storeQuery]);

    const storeDeals = useMemo(() => {
        if (!form.store_id) return [];
        return deals.filter(d => d.storeId === form.store_id && d.status === 'active');
    }, [deals, form.store_id]);

    const selectStore = (s: { id: string; name: string }) => {
        setForm(prev => ({ ...prev, store_id: s.id, deal_id: '' }));
        setSelectedStoreName(s.name);
        setStoreQuery('');
    };
    const clearStore = () => {
        setForm(prev => ({ ...prev, store_id: '', deal_id: '' }));
        setSelectedStoreName('');
        setStoreQuery('');
    };

    // Esc closes the modal. Banner draft is purely client-side until the
    // explicit "نشر" button — no DB write happens on close.
    useEscClose(true, onClose);

    // Revoke any outstanding blob URL when the modal unmounts.
    useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); }, []);

    const closeEditor = () => {
        setEditorSrc(null);
        if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
    };

    // Pick from device → open the positioner on a data URL (no upload yet;
    // the cropped 1200×600 result is what gets uploaded).
    const handleFilePick = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // allow re-picking the same file
        if (!file) return;
        if (!file.type.startsWith('image/')) { customAlert('⚠️ يرجى اختيار صورة'); return; }
        if (file.size > 12 * 1024 * 1024) { customAlert('⚠️ حجم الصورة أكبر من 12MB'); return; }
        const reader = new FileReader();
        reader.onload = () => setEditorSrc(String(reader.result));
        reader.onerror = () => customAlert('❌ تعذّرت قراءة الصورة. حاول مجدداً.');
        reader.readAsDataURL(file);
    };

    // Re-open the positioner on an already-set image_url. We fetch it into a
    // blob first so the canvas is same-origin (never tainted). External URLs
    // that block CORS fall back gracefully with a clear message.
    const handleAdjustExisting = async () => {
        const url = form.image_url.trim();
        if (!url) return;
        try {
            const resp = await fetch(url, { mode: 'cors' });
            if (!resp.ok) throw new Error('fetch_failed');
            const blob = await resp.blob();
            const objUrl = URL.createObjectURL(blob);
            if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
            objectUrlRef.current = objUrl;
            setEditorSrc(objUrl);
        } catch {
            await customAlert('⚠️ تعذّر تجهيز هذه الصورة للقص (قد تكون من مصدر خارجي). ارفع صورة من جهازك لاستخدام أداة القص.');
        }
    };

    // Editor handed back a ready 1200×600 JPEG → upload it, set the URL.
    const handleEditorApply = async (file: File) => {
        closeEditor();
        setUploading(true);
        const url = await storageService.uploadImage(file);
        setUploading(false);
        if (!url) {
            await customAlert(storageService.lastBlockReason === 'nsfw'
                ? '🚫 رفض فلتر المحتوى هذه الصورة (محتوى غير لائق).'
                : '❌ فشل رفع الصورة. تأكد من الإنترنت أو ألصق رابطاً جاهزاً.');
            return;
        }
        setForm(prev => ({ ...prev, image_url: url }));
    };

    const handleSave = async () => {
        if (saving) return;
        if (!form.image_url.trim()) {
            await customAlert('⚠️ يرجى رفع صورة أو لصق رابط');
            return;
        }
        setSaving(true);
        // try/finally + a 12s safety timeout so the button can never stick on
        // "جاري النشر..." if the network stalls (v11.23).
        let err: any = null;
        try {
            // deal_id / store_id are FOREIGN KEYS (→ deals.id / users.id). An
            // empty optional field MUST be null, never '' — Postgres treats ''
            // as a real value and it fails banners_deal_id_fkey /
            // banners_store_id_fkey. This was the silent "النشر لا يعمل" bug
            // (v11.30): the form shipped deal_id:'' store_id:'' on every banner.
            const row = {
                title_ar: form.title_ar.trim() || null,
                title_en: form.title_en.trim() || null,
                image_url: form.image_url.trim(),
                target_url: form.target_url.trim() || null,
                deal_id: form.deal_id.trim() || null,
                store_id: form.store_id.trim() || null,
                position: form.position,
                is_active: form.is_active,
            };
            // Edit updates the same row in place; otherwise insert a new banner.
            const writeQuery = isEdit
                ? supabase.from('banners').update(row).eq('id', initial.id)
                : supabase.from('banners').insert([row]);
            const timeout = new Promise<{ error: any }>(resolve =>
                setTimeout(() => resolve({ error: { message: 'انتهت مهلة الاتصال — تحقق من الإنترنت وحاول مجدداً' } }), 12000)
            );
            const { error } = await Promise.race([writeQuery as any, timeout]);
            err = error;
        } catch (e: any) {
            err = { message: e?.message || 'فشل النشر — تحقق من الاتصال' };
        } finally {
            setSaving(false);
        }
        if (err) {
            // Translate the raw Postgres FK error into a clear Arabic hint.
            const m = String(err.message || '');
            const friendly =
                m.includes('banners_deal_id_fkey') ? 'رقم العرض الذي أدخلته غير موجود. تأكد منه أو اتركه فارغاً.'
                : m.includes('banners_store_id_fkey') ? 'رقم المتجر الذي أدخلته غير موجود. تأكد منه أو اتركه فارغاً.'
                : (m || 'فشل النشر');
            await customAlert('❌ ' + friendly);
            return;
        }
        await customAlert(isEdit ? '✅ تم حفظ تعديلات البانر' : '✅ تم نشر البانر بنجاح');
        onSaved();
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[3000] flex items-center justify-center p-4">
            <div className="bg-[var(--card-bg)] rounded-3xl max-w-lg w-full max-h-[90vh] overflow-y-auto shadow-2xl">
                <div className="sticky top-0 bg-gradient-to-r from-orange-500 to-red-600 text-white p-5 rounded-t-3xl flex items-center justify-between">
                    <div className="text-xl font-bold">{isEdit ? '✏️ تعديل البانر' : '🖼️ بانر إعلاني جديد'}</div>
                    <button
                        onClick={onClose}
                        className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center"
                    >
                        ✕
                    </button>
                </div>

                <div className="p-5 space-y-4">
                    {form.image_url && (
                        <div className="rounded-2xl overflow-hidden border border-[var(--border-color)] relative">
                            {/* WYSIWYG preview — exactly the 2.5:1 shape shown on the home page */}
                            <div className="relative w-full" style={{ aspectRatio: '2.5 / 1', background: 'var(--gray-100)' }}>
                                <img
                                    src={form.image_url}
                                    alt=""
                                    className="absolute inset-0 w-full h-full object-cover"
                                    onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                                />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/45 to-transparent px-3 py-2 pointer-events-none">
                                    <span className="text-[10px] font-bold text-white/90">معاينة كما سيظهر في الرئيسية تماماً (2.5:1)</span>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setForm({ ...form, image_url: '' })}
                                className="absolute top-2 left-2 bg-red-500/90 text-white rounded-full w-8 h-8 flex items-center justify-center text-sm font-bold shadow-md active:scale-90 transition"
                                aria-label="إزالة الصورة"
                            >
                                ✕
                            </button>
                            <button
                                type="button"
                                onClick={handleAdjustExisting}
                                className="absolute top-2 right-2 bg-black/55 backdrop-blur-sm text-white rounded-full px-3 h-8 flex items-center gap-1 text-xs font-bold shadow-md active:scale-90 transition"
                            >
                                ✂️ ضبط الجزء الظاهر
                            </button>
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

                    {/* Image: upload OR paste URL */}
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1">
                            صورة البانر <span className="text-red-500">*</span>
                        </label>
                        <div className="text-[11px] text-[var(--text-secondary)] mb-2 leading-relaxed">
                            📐 المقاس المثالي <b>1200×480</b> بكسل (نسبة 2.5:1). بعد اختيار الصورة ستفتح أداة تتيح لك تحريك الصورة واختيار الجزء الظاهر بالضبط.
                        </div>
                        {/* A native <label> opens the file picker on click WITHOUT a
                            programmatic fileInputRef.click() — that path silently failed
                            on some desktop browsers («الرفع لا يعمل من اللابتوب»). The
                            input is visually hidden but kept in the DOM (not display:none,
                            which can swallow .click()). Works on web + PWA, mobile + laptop. */}
                        <label
                            className={`w-full px-3 py-3 bg-orange-50 hover:bg-orange-100 border-2 border-dashed border-orange-300 text-orange-700 font-bold rounded-xl text-sm flex items-center justify-center gap-2 transition ${uploading ? 'opacity-50 pointer-events-none' : 'cursor-pointer'}`}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                onChange={handleFilePick}
                                disabled={uploading}
                                style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}
                            />
                            {uploading ? '⏳ جاري الرفع...' : '📤 رفع صورة من الجهاز'}
                        </label>
                        <div className="text-[11px] text-[var(--text-secondary)] text-center my-1.5">— أو —</div>
                        <input
                            type="text"
                            placeholder="ألصق رابط الصورة (https://...)"
                            value={form.image_url}
                            onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                            className="w-full px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-orange-500 focus:bg-[var(--card-bg)] outline-none"
                        />
                    </div>
                    {/* What happens when the banner is tapped. The admin links by
                        NAME: search a store, then optionally pick one of its deals.
                        No IDs, no links. Empty = the banner just shows. */}
                    <div className="rounded-2xl border border-[var(--border-color)] bg-[var(--body-bg)] p-3 space-y-3">
                        <div>
                            <div className="text-sm font-extrabold text-[var(--text-primary)]">🔗 عند الضغط على البانر</div>
                            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5 leading-relaxed">
                                اختياري. اختر متجراً (وعرضاً محدداً إن أردت). اترك الكل فارغاً لعرض الصورة فقط.
                            </div>
                        </div>

                        {!form.store_id ? (
                            /* Step 1 — search the store by name */
                            <div className="relative">
                                <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">🏪 ابحث عن المتجر بالاسم</label>
                                <input
                                    type="text"
                                    value={storeQuery}
                                    onChange={(e) => setStoreQuery(e.target.value)}
                                    placeholder="اكتب اسم المتجر..."
                                    className="w-full px-3 py-2.5 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-orange-500 outline-none"
                                />
                                {storeMatches.length > 0 && (
                                    <div className="mt-1 max-h-52 overflow-y-auto rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] shadow-lg divide-y divide-[var(--border-color)]">
                                        {storeMatches.map((s) => (
                                            <button
                                                key={s.id}
                                                type="button"
                                                onClick={() => selectStore(s)}
                                                className="w-full text-right px-3 py-2.5 text-sm font-bold text-[var(--text-primary)] hover:bg-orange-50 active:bg-orange-100 transition flex items-center gap-2"
                                            >
                                                <span>🏪</span><span className="truncate">{s.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {storeQuery.trim() && storeMatches.length === 0 && (
                                    <div className="text-[11px] text-[var(--text-secondary)] mt-1.5">
                                        لا يوجد متجر بهذا الاسم. (تظهر المتاجر التي لديها عروض فقط.)
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* Step 2 — store chosen; optionally pick a specific deal */
                            <div className="space-y-3">
                                <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5">
                                    <span className="text-sm font-bold text-emerald-800 flex items-center gap-2 min-w-0">
                                        <span>🏪</span><span className="truncate">{selectedStoreName || 'متجر مُختار'}</span>
                                    </span>
                                    <button
                                        type="button"
                                        onClick={clearStore}
                                        className="text-xs font-bold text-emerald-700 hover:text-red-600 flex-shrink-0"
                                    >
                                        تغيير ✕
                                    </button>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">🎯 عرض محدد من هذا المتجر (اختياري)</label>
                                    <select
                                        value={form.deal_id}
                                        onChange={(e) => setForm({ ...form, deal_id: e.target.value })}
                                        className="w-full px-3 py-2.5 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl text-sm focus:border-orange-500 outline-none"
                                    >
                                        <option value="">— بدون عرض محدد (يفتح صفحة المتجر) —</option>
                                        {storeDeals.map((d) => (
                                            <option key={d.id} value={d.id}>{d.itemName}</option>
                                        ))}
                                    </select>
                                    <div className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                                        {storeDeals.length === 0
                                            ? 'لا توجد عروض نشطة لهذا المتجر — سيفتح البانر صفحة المتجر.'
                                            : 'إن اخترت عرضاً، يفتح البانر صفحة ذلك العرض مباشرة بدل صفحة المتجر.'}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* External link — secondary/advanced, used only if no store is chosen */}
                        <details className="rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)]">
                            <summary className="cursor-pointer px-3 py-2 text-xs font-bold text-[var(--text-secondary)]">
                                🌐 أو رابط خارجي بدل المتجر (متقدّم)
                            </summary>
                            <div className="p-3">
                                <Field
                                    label="رابط الوجهة"
                                    value={form.target_url}
                                    onChange={(v) => setForm({ ...form, target_url: v })}
                                    placeholder="https://..."
                                />
                                <div className="text-[11px] text-[var(--text-secondary)] mt-1 leading-relaxed">
                                    صفحة خارجية تُفتح عند الضغط (مثل منتج في موقعك). يُستخدم فقط إذا لم تختر متجراً بالأعلى.
                                </div>
                            </div>
                        </details>
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
                        {saving ? (isEdit ? 'جاري الحفظ...' : 'جاري النشر...') : (isEdit ? '💾 حفظ التعديلات' : '🚀 نشر البانر')}
                    </button>
                </div>
            </div>

            {/* Upload-in-progress veil (after the positioner hands back the crop) */}
            {uploading && (
                <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px] flex items-center justify-center z-[3100]">
                    <div className="bg-[var(--card-bg)] rounded-2xl px-5 py-4 shadow-xl flex items-center gap-3">
                        <span className="w-5 h-5 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                        <span className="text-sm font-bold text-[var(--text-primary)]">جاري رفع الصورة...</span>
                    </div>
                </div>
            )}

            {/* WYSIWYG banner positioner (portal — renders to <body>) */}
            {editorSrc && (
                <BannerImageEditor
                    src={editorSrc}
                    isRTL={isRTL}
                    onApply={handleEditorApply}
                    onCancel={closeEditor}
                />
            )}
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
    /** v12.27 — إعادة بث تلقائية: none/daily/every_3_days/weekend/weekly/monthly */
    recurrence: string;
    /** ساعة الإرسال بتوقيت الرياض (0–23) */
    recurrence_hour: number;
};

// خيارات التكرار — الكرون الساعي في قاعدة البيانات يعيد البث حسبها (بتوقيت الرياض)
const RECURRENCE_OPTIONS: { v: string; label: string; icon: string }[] = [
    { v: 'none',         label: 'بدون تكرار',       icon: '⏹' },
    { v: 'daily',        label: 'يومياً',            icon: '📆' },
    { v: 'every_3_days', label: 'كل ٣ أيام',        icon: '🔂' },
    { v: 'weekend',      label: 'كل ويكند (الجمعة)', icon: '🌴' },
    { v: 'weekly',       label: 'أسبوعياً',          icon: '🗓' },
    { v: 'monthly',      label: 'شهرياً',            icon: '📅' },
];
export const RECURRENCE_LABELS: Record<string, string> = Object.fromEntries(
    RECURRENCE_OPTIONS.map((o) => [o.v, o.label])
);

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
    recurrence: 'none',
    recurrence_hour: 10,
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
        recurrence: initial?.recurrence ?? 'none',
        recurrence_hour: typeof initial?.recurrence_hour === 'number' ? initial.recurrence_hour : 10,
    }));
    const [saving, setSaving] = useState(false);

    // Esc closes the campaign modal — same rationale as the banner modal:
    // nothing persists until "نشر" / "تعديل" is pressed.
    useEscClose(true, onClose);

    const set = <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) =>
        setForm((prev) => ({ ...prev, [k]: v }));

    const handleSave = async () => {
        if (!form.title_ar.trim() || !form.body_ar.trim()) {
            await customAlert('⚠️ العنوان والمحتوى (عربي) مطلوبان');
            return;
        }
        if (saving) return;

        // Validate dates BEFORE the spinner — a malformed value shows a clear
        // error instantly instead of any spinner time (v11.22.1). Empty is fine
        // (starts_at defaults to now, ends_at to null).
        const startMs = form.starts_at ? new Date(form.starts_at).getTime() : Date.now();
        const endMs = form.ends_at ? new Date(form.ends_at).getTime() : null;
        if (Number.isNaN(startMs) || (endMs !== null && Number.isNaN(endMs))) {
            await customAlert('❌ تاريخ غير صالح. تحقّق من تاريخ البداية والنهاية.');
            return;
        }
        if (endMs !== null && endMs <= startMs) {
            await customAlert('❌ تاريخ النهاية يجب أن يكون بعد تاريخ البداية.');
            return;
        }

        setSaving(true);
        // EVERYTHING that can throw (date conversion + network) lives inside the
        // try, and setSaving(false) is in finally — so the button can NEVER
        // stick on "جاري الحفظ..." no matter what fails (v11.22.1: the row was
        // previously built OUTSIDE the try, so a bad date hung the button).
        let result: any;
        let broadcastCount = 0;
        try {
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
                starts_at: new Date(startMs).toISOString(),
                ends_at: endMs !== null ? new Date(endMs).toISOString() : null,
                priority: Number(form.priority) || 0,
                is_active: form.is_active,
                recurrence: form.recurrence || 'none',
                recurrence_hour: Math.min(23, Math.max(0, Number(form.recurrence_hour) || 10)),
            };

            // 12s timeout so a stalled network call never leaves the button
            // stuck. The user sees a clear error and can retry.
            const networkCall = isEdit
                ? supabase.from('promotional_campaigns').update(row).eq('id', initial.id).select().maybeSingle()
                : supabase.from('promotional_campaigns').insert([row]).select().maybeSingle();
            const timeout = new Promise<{ error: any }>(resolve =>
                setTimeout(() => resolve({ error: { message: 'انتهت مهلة الاتصال — تحقق من الإنترنت وحاول مجدداً' } }), 12000)
            );
            result = await Promise.race([networkCall as any, timeout]);
            // On a NEW active campaign, fan out to the targeted inboxes right
            // away (v11.22) — without this the campaign reaches nobody. Edits
            // don't re-broadcast (broadcast_campaign skips users who already
            // saw it, but we also don't want an edit to re-ping everyone).
            // Broadcast also gets its own timeout so a slow fan-out can't hang.
            if (!result?.error && !isEdit && row.is_active && result?.data?.id) {
                const bc = promoRepository.broadcastNow(result.data.id);
                const bcTimeout = new Promise<number>(resolve => setTimeout(() => resolve(0), 12000));
                broadcastCount = await Promise.race([bc, bcTimeout]);
            }
        } catch (e: any) {
            result = { error: { message: e?.message || 'فشل الحفظ — تحقق من الاتصال' } };
        } finally {
            setSaving(false);
        }
        if (result?.error) {
            console.error('Campaign save failed:', result.error);
            await customAlert('❌ ' + (result.error.message || 'فشل الحفظ — تحقق من الاتصال'));
            return;
        }
        await customAlert(
            isEdit
                ? '✅ تم تعديل الحملة'
                : (broadcastCount > 0
                    ? `✅ تم نشر الحملة ووصلت إلى ${broadcastCount.toLocaleString('ar-SA')} مستخدم.`
                    : '✅ تم نشر الحملة.')
        );
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

                    {/* 🔁 التكرار التلقائي (v12.27) */}
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-2">🔁 التكرار التلقائي</label>
                        <div className="grid grid-cols-3 gap-2">
                            {RECURRENCE_OPTIONS.map((o) => (
                                <button
                                    key={o.v}
                                    type="button"
                                    onClick={() => set('recurrence', o.v)}
                                    className={`p-2.5 rounded-xl border-2 font-bold text-xs transition-all ${
                                        form.recurrence === o.v
                                            ? 'bg-indigo-50 border-indigo-500 text-indigo-700'
                                            : 'bg-[var(--card-bg)] border-[var(--border-color)] text-[var(--text-secondary)]'
                                    }`}
                                >
                                    <div className="text-lg mb-0.5">{o.icon}</div>
                                    {o.label}
                                </button>
                            ))}
                        </div>
                        {form.recurrence !== 'none' && (
                            <div className="mt-3 flex items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-xl p-3">
                                <div className="flex-1">
                                    <div className="text-xs font-bold text-indigo-800">⏰ ساعة إعادة الإرسال (بتوقيت الرياض)</div>
                                    <div className="text-[10px] text-indigo-600 mt-0.5">
                                        يُعاد إرسال الحملة تلقائياً كإشعار جديد لكل الجمهور (الموقع + التطبيق + البوتات) حسب التكرار، حتى تاريخ النهاية أو إيقاف الحملة.
                                    </div>
                                </div>
                                <select
                                    value={form.recurrence_hour}
                                    onChange={(e) => set('recurrence_hour', Number(e.target.value))}
                                    className="px-2 py-2 bg-[var(--card-bg)] border border-indigo-200 rounded-xl text-sm font-bold outline-none"
                                >
                                    {Array.from({ length: 24 }, (_, h) => (
                                        <option key={h} value={h}>
                                            {h === 0 ? '12 منتصف الليل' : h < 12 ? `${h} صباحاً` : h === 12 ? '12 ظهراً' : `${h - 12} مساءً`}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
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
        if (posting) return;
        setPosting(true);
        // Insert the campaign, then immediately fan it out to every targeted
        // user's notification inbox via broadcast_campaign(). BEFORE v11.22 the
        // quick-post only inserted the row — the fan-out RPC was never called,
        // so "نشر فوراً" created a campaign that reached NOBODY (campaigns sat
        // at current_impressions=0). try/finally guarantees the button never
        // hangs on "جاري النشر" regardless of which step fails.
        let count = 0;
        let failMsg = '';
        try {
            const { data, error } = await supabase
                .from('promotional_campaigns')
                .insert([{
                    title_ar: t,
                    title_en: t,    // mirror — admin can refine later via modal
                    body_ar: b,
                    body_en: b,
                    target_audience: audience,
                    starts_at: new Date().toISOString(),
                    ends_at: null,
                    priority: 0,
                    is_active: true,
                }])
                .select('id')
                .single();
            if (error) throw error;
            // Fan-out with a 12s safety timeout so a slow broadcast never
            // leaves the button stuck on "جاري النشر".
            const bc = promoRepository.broadcastNow(data.id);
            const bcTimeout = new Promise<number>(resolve => setTimeout(() => resolve(0), 12000));
            count = await Promise.race([bc, bcTimeout]);
        } catch (e: any) {
            failMsg = e?.message || 'فشل النشر — تحقق من الاتصال';
        } finally {
            setPosting(false);
        }
        if (failMsg) {
            await customAlert('❌ ' + failMsg);
            return;
        }
        setTitle('');
        setBody('');
        await customAlert(
            count > 0
                ? `📤 تم النشر ووصل الإشعار إلى ${count.toLocaleString('ar-SA')} ${audience === 'seller' ? 'بائع' : audience === 'buyer' ? 'مشترٍ' : 'مستخدم'}.`
                : '📤 تم نشر الحملة. (لا يوجد مستخدمون مطابقون لاستلامها الآن — ستصل لمن يطابق لاحقاً.)'
        );
        onPosted();
    };

    return (
        <div className="bg-pink-50 border border-pink-200 rounded-2xl p-4 mb-3">
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
    const [telegramBotEnabled, setTelegramBotEnabled] = useState(true);
    const [whatsappBotEnabled, setWhatsappBotEnabled] = useState(false);
    const [whatsappBotNumber, setWhatsappBotNumber] = useState('');
    const [savingWaNumber, setSavingWaNumber] = useState(false);
    // v12.44 — هوية المواسم: الموسم المفعّل حالياً ('' = الهوية الأساسية).
    // v12.57 — صار للعرض فقط: القيمة تُشتق في القاعدة من النافذة العامة
    // للحملة (trigger + كرون كل ١٥ دقيقة) — لا تفعيل يدوي منفصل.
    const [seasonTheme, setSeasonTheme] = useState('');
    // v12.48 — «حملة الموسم»: نافذة التجار + النافذة العامة + تاريخ الفعالية
    const [camp, setCamp] = useState({ season_id: '', event_date: '', seller_from: '', seller_to: '', public_from: '', public_to: '', hero_title_ar: '', hero_tagline_ar: '', hero_title_en: '', hero_tagline_en: '' });
    const [campSaved, setCampSaved] = useState(false);
    const [savingCamp, setSavingCamp] = useState(false);
    // تواريخ الفعاليات لتذكير المالك قبل ٣٠ ثم ٧ أيام (كرون يومي)
    const [eventDates, setEventDates] = useState<Record<string, string>>({});
    const [savingDates, setSavingDates] = useState(false);
    const [banners, setBanners] = useState<any[]>([]);
    // v12.71 — مدة عرض كل بانر في الرئيسية (ثوانٍ) — نص للحقل، يُحفظ رقماً
    const [bannerSeconds, setBannerSeconds] = useState('2');
    const [savingBannerSeconds, setSavingBannerSeconds] = useState(false);
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [bannerModalOpen, setBannerModalOpen] = useState(false);
    const [bannerEdit, setBannerEdit] = useState<any | null>(null); // null = new banner
    const [campaignModal, setCampaignModal] = useState<{ open: boolean; initial: any | null }>({ open: false, initial: null });
    const [loading, setLoading] = useState(true);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        // BUG FIX: code used to query a non-existent `global_settings` table
        // with key `is_payment_gateway_enabled`. Real table is `platform_settings`,
        // real key is `payment_gateway_enabled`, value is a jsonb boolean (not string).
        const [paymentRes, botRes, waBotRes, waNumRes, seasonThemeRes, seasonCampRes, eventDatesRes, bannerRes, campaignRes, bannerSecRes] = await Promise.all([
            supabase.from('platform_settings').select('value').eq('key', 'payment_gateway_enabled').maybeSingle(),
            supabase.from('platform_settings').select('value').eq('key', 'telegram_bot_enabled').maybeSingle(),
            supabase.from('platform_settings').select('value').eq('key', 'whatsapp_bot_enabled').maybeSingle(),
            supabase.from('platform_settings').select('value').eq('key', 'whatsapp_bot_number').maybeSingle(),
            supabase.from('platform_settings').select('value').eq('key', 'seasonal_theme').maybeSingle(),
            supabase.from('platform_settings').select('value').eq('key', 'season_campaign').maybeSingle(),
            supabase.from('platform_settings').select('value').eq('key', 'season_event_dates').maybeSingle(),
            supabase.from('banners').select('*').order('display_order', { ascending: true }),
            supabase.from('promotional_campaigns').select('*').order('created_at', { ascending: false }).limit(20),
            supabase.from('platform_settings').select('value').eq('key', 'banner_autoplay_seconds').maybeSingle(),
        ]);

        setPaymentEnabled(paymentRes.data?.value === true);
        // Bot defaults ON: enabled unless explicitly turned off (fail-open).
        setTelegramBotEnabled(botRes.data?.value !== false);
        // WhatsApp defaults OFF (dormant until enabled + number set).
        setWhatsappBotEnabled(waBotRes.data?.value === true);
        setWhatsappBotNumber(typeof waNumRes.data?.value === 'string' ? waNumRes.data.value : '');
        setSeasonTheme(typeof seasonThemeRes.data?.value === 'string' ? seasonThemeRes.data.value : '');
        // v12.48 — حملة الموسم + تواريخ التذكير
        const cv = (seasonCampRes.data?.value ?? null) as any;
        const hasCamp = !!(cv && typeof cv.season_id === 'string' && cv.season_id);
        setCampSaved(hasCamp);
        setCamp({
            season_id: hasCamp ? cv.season_id : '',
            event_date: (hasCamp && cv.event_date) || '',
            seller_from: (hasCamp && cv.seller_from) || '',
            seller_to: (hasCamp && cv.seller_to) || '',
            public_from: (hasCamp && cv.public_from) || '',
            public_to: (hasCamp && cv.public_to) || '',
            // v12.69 — نصوص البانر المخصصة (فارغة = الافتراضي)
            hero_title_ar: (hasCamp && cv.hero_title_ar) || '',
            hero_tagline_ar: (hasCamp && cv.hero_tagline_ar) || '',
            hero_title_en: (hasCamp && cv.hero_title_en) || '',
            hero_tagline_en: (hasCamp && cv.hero_tagline_en) || '',
        });
        const dv = (eventDatesRes.data?.value as any)?.dates ?? {};
        setEventDates(Object.fromEntries(SEASONS.map(s => [s.id, typeof dv[s.id] === 'string' ? dv[s.id] : ''])));
        setBanners(bannerRes.data ?? []);
        setCampaigns(campaignRes.data ?? []);
        // v12.71 — سرعة تنقّل البانر (ثوانٍ، الافتراضي ٢)
        const bs = Number(bannerSecRes.data?.value);
        setBannerSeconds(Number.isFinite(bs) && bs >= 1 && bs <= 120 ? String(bs) : '2');
        setLoading(false);
    }, []);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    // Quick-action bridge from the ⌘K command palette. Each entry is a
    // one-shot intent: read it, clear it, act on it. Anything we don't
    // recognise is ignored silently — the user just lands on the tools
    // tab, which is still useful.
    useEffect(() => {
        try {
            const intent = sessionStorage.getItem('taki:admin:quick_action');
            if (!intent) return;
            sessionStorage.removeItem('taki:admin:quick_action');
            if (intent === 'new-banner') {
                setBannerEdit(null);
                setBannerModalOpen(true);
            } else if (intent === 'new-campaign') {
                setCampaignModal({ open: true, initial: null });
            }
        } catch {}
    }, []);

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

    // Single kill-switch for the Telegram bot (request 2). Upsert so the row is
    // created if missing; the bot polls telegram_bot_enabled (≤45s) and the web
    // hides the link button via AppContext realtime — both flip from this one toggle.
    const toggleBot = async () => {
        const newValue = !telegramBotEnabled;
        setTelegramBotEnabled(newValue); // optimistic
        const { error } = await supabase
            .from('platform_settings')
            .upsert({ key: 'telegram_bot_enabled', value: newValue, description: 'Enable/disable the Telegram bot platform-wide', updated_at: new Date().toISOString() });
        if (error) {
            setTelegramBotEnabled(!newValue); // rollback
            await customAlert('❌ ' + error.message);
            return;
        }
        await customAlert(
            newValue
                ? '✅ تم تفعيل بوت تيليجرام — عاد للعمل وظهر زر الربط في الإعدادات (قد يستغرق التفعيل حتى دقيقة).'
                : '🔌 تم تعطيل بوت تيليجرام — توقّف عن الرد وأُخفي زر الربط (يسري خلال دقيقة). تقدر تعيد تفعيله بأي وقت بنفس الزر.'
        );
    };

    // v12.57 — توحيد (طلب ناصر): أُلغي التفعيل اليدوي المنفصل للهوية.
    // seasonal_theme يُشتق في القاعدة من النافذة العامة للحملة تلقائياً
    // (trigger عند الحفظ/الإنهاء + كرون كل ١٥ دقيقة لانقلاب منتصف الليل)،
    // فتتبعه كل الواجهات: ألوان الموقع وبانر الرئيسية وسطر الموسم في البوتين.
    // هذه نسخة محلية من نفس الاشتقاق لتحديث شارة «النشط الآن» فوراً بعد الحفظ.
    const localEffectiveTheme = (c: typeof camp): string => {
        if (!c.season_id || !c.public_from || !c.public_to) return '';
        const d = new Date();
        const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return t >= c.public_from && t <= c.public_to ? c.season_id : '';
    };

    // v12.48 — «حملة الموسم»: حفظ/إنهاء الحملة + إشعار التجار + تواريخ التذكير.
    // كل التواريخ يقررها ناصر يدوياً؛ الحارس النهائي للنافذة DB trigger.
    const saveCampaign = async () => {
        if (!camp.season_id) { await customAlert('⚠️ اختر الموسم أولاً'); return; }
        if (!camp.seller_from || !camp.seller_to || !camp.public_from || !camp.public_to) {
            await customAlert('⚠️ أكمل التواريخ الأربعة: نافذة التجار (من/إلى) والنافذة العامة (من/إلى)');
            return;
        }
        if (camp.seller_from > camp.seller_to) { await customAlert('⚠️ نافذة التجار: تاريخ البداية بعد النهاية'); return; }
        if (camp.public_from > camp.public_to) { await customAlert('⚠️ النافذة العامة: تاريخ البداية بعد النهاية'); return; }
        setSavingCamp(true);
        const { error } = await supabase.from('platform_settings').upsert({
            key: 'season_campaign',
            value: {
                season_id: camp.season_id,
                event_date: camp.event_date || null,
                seller_from: camp.seller_from,
                seller_to: camp.seller_to,
                public_from: camp.public_from,
                public_to: camp.public_to,
                // v12.69 — نصوص البانر المخصصة (فارغة = يُستخدم نص الموسم الافتراضي)
                hero_title_ar: camp.hero_title_ar.trim() || null,
                hero_tagline_ar: camp.hero_tagline_ar.trim() || null,
                hero_title_en: camp.hero_title_en.trim() || null,
                hero_tagline_en: camp.hero_tagline_en.trim() || null,
            },
            description: 'Season campaign windows: seller submissions + public page (v12.48)',
            updated_at: new Date().toISOString(),
        });
        setSavingCamp(false);
        if (error) { await customAlert('❌ ' + error.message); return; }
        setCampSaved(true);
        // v12.57 — الهوية تتبع الحملة: القاعدة زامنت seasonal_theme فور الحفظ
        // (trigger)، وهنا نحدّث الشارة محلياً بنفس المنطق دون انتظار realtime.
        const eff = localEffectiveTheme(camp);
        setSeasonTheme(eff);
        const s = SEASONS.find(x => x.id === camp.season_id);
        await customAlert(
            `✅ حُفظت حملة «${s?.ar}» — نظام موحّد:\n` +
            `🏪 التجار يضيفون منتجاتهم من ${camp.seller_from} إلى ${camp.seller_to}\n` +
            `👥 الصفحة العامة + هوية الألوان والبانر والبوتات: من ${camp.public_from} إلى ${camp.public_to} تلقائياً\n\n` +
            (eff
                ? `🎨 النافذة العامة مفتوحة الآن — هوية «${s?.ar}» اشتغلت فوراً لجميع المستخدمين.\n\n`
                : `⏳ الهوية ستشتغل من تلقاء نفسها يوم ${camp.public_from} وتنطفئ بعد ${camp.public_to}.\n\n`) +
            'لا تنسَ زر «📣 إشعار التجار» ليعرفوا أن الباب فُتح.'
        );
    };

    const clearCampaign = async () => {
        const ok = await customConfirm('سيتم إنهاء الحملة نهائياً: تختفي صفحة عروض الموسم من موقع المشترين والبوتات، ويقفل باب إضافة العروض للتجار، وتعود ألوان المنصة وبانر الرئيسية للهوية الأساسية فوراً (العروض الموسومة سابقاً تبقى عروضاً عادية). متابعة؟');
        if (!ok) return;
        setSavingCamp(true);
        // v12.52 — كان value: null يفشل بصمت (العمود NOT NULL) فتبقى الحملة حية
        // رغم «الإنهاء» — {} تعني «لا حملة» عند الويب والبوتين معاً.
        const { error } = await supabase.from('platform_settings').upsert({
            key: 'season_campaign', value: {},
            description: 'Season campaign windows: seller submissions + public page (v12.48)',
            updated_at: new Date().toISOString(),
        });
        setSavingCamp(false);
        if (error) { await customAlert('❌ ' + error.message); return; }
        setCampSaved(false);
        setCamp({ season_id: '', event_date: '', seller_from: '', seller_to: '', public_from: '', public_to: '', hero_title_ar: '', hero_tagline_ar: '', hero_title_en: '', hero_tagline_en: '' });
        setSeasonTheme(''); // v12.57 — القاعدة صفّرت الهوية بنفس اللحظة (trigger)
        await customAlert('✅ انتهت الحملة — اختفت صفحة الموسم من الموقع والبوتات، وعادت الألوان والبانر للهوية الأساسية لجميع المستخدمين.');
    };

    // إشعار للتجار فقط (وليس المشترين) عبر admin_broadcast_notification —
    // يصلهم داخل التطبيق وفي البوتين (outbox v11.70) تلقائياً.
    const notifySellersCampaign = async () => {
        const s = SEASONS.find(x => x.id === camp.season_id);
        if (!s) return;
        const ok = await customConfirm(`سيصل إشعار لجميع التجار لإضافة منتجاتهم لعروض ${s.ar}. متابعة؟`);
        if (!ok) return;
        setSavingCamp(true);
        const { data, error } = await supabase.rpc('admin_broadcast_notification', {
            p_title_ar: `${s.emoji} فُتح باب عروض ${s.ar} لمتجرك!`,
            p_body_ar: `أضف منتجاتك لصفحة عروض ${s.ar} الحصرية: من لوحة التاجر عند إضافة أو تعديل أي منتج فعّل «شارك في عروض ${s.ar}». باب الإضافة مفتوح من ${camp.seller_from} حتى ${camp.seller_to} فقط.`,
            p_audience: 'sellers',
            p_type: 'system',
        });
        setSavingCamp(false);
        if (error) { await customAlert('❌ ' + error.message); return; }
        await customAlert(`✅ وصل الإشعار إلى ${(data as any)?.notified ?? 0} تاجر.`);
    };

    // تواريخ الفعاليات للتذكير: قراءة-تعديل-كتابة تحافظ على سجل «أُرسل سابقاً»
    // حتى لا يتكرر تذكير الـ٣٠/٧ أيام بعد كل حفظ.
    const saveEventDates = async () => {
        setSavingDates(true);
        const { data } = await supabase.from('platform_settings').select('value').eq('key', 'season_event_dates').maybeSingle();
        const notified = (data?.value as any)?.notified ?? [];
        const dates = Object.fromEntries(Object.entries(eventDates).filter(([, v]) => !!v));
        const { error } = await supabase.from('platform_settings').upsert({
            key: 'season_event_dates',
            value: { dates, notified },
            description: 'Season event dates for the 30/7-day admin reminders (v12.48)',
            updated_at: new Date().toISOString(),
        });
        setSavingDates(false);
        if (error) { await customAlert('❌ ' + error.message); return; }
        await customAlert('✅ حُفظت التواريخ — سيصلك إشعار تلقائي قبل كل فعالية بشهر ثم بأسبوع.');
    };

    // Kill-switch for the WhatsApp bot — mirrors Telegram. The WA server polls
    // wa_bot_is_enabled() (≤45s) and stops replying when OFF; the web hides the
    // WhatsApp link section via AppContext realtime. v11.97
    const toggleWhatsappBot = async () => {
        const newValue = !whatsappBotEnabled;
        setWhatsappBotEnabled(newValue); // optimistic
        const { error } = await supabase
            .from('platform_settings')
            .upsert({ key: 'whatsapp_bot_enabled', value: newValue, description: 'Enable/disable the WhatsApp bot platform-wide', updated_at: new Date().toISOString() });
        if (error) {
            setWhatsappBotEnabled(!newValue); // rollback
            await customAlert('❌ ' + error.message);
            return;
        }
        await customAlert(
            newValue
                ? '✅ تم تفعيل بوت واتساب — سيعمل ويظهر زر الربط في الإعدادات بمجرد إدخال رقم الواتساب أدناه.'
                : '🔌 تم تعطيل بوت واتساب — توقّف عن الرد وأُخفي زر الربط (يسري خلال دقيقة).'
        );
    };

    // The bot's public WhatsApp Business number — drives the wa.me deep link. The
    // link section in settings stays hidden until BOTH the toggle is ON and this
    // number is set (digits only). v11.97
    const saveWhatsappNumber = async () => {
        const digits = whatsappBotNumber.replace(/\D/g, '');
        setSavingWaNumber(true);
        const { error } = await supabase
            .from('platform_settings')
            .upsert({ key: 'whatsapp_bot_number', value: digits, description: 'Public WhatsApp Business number (digits only) for the bot deep link', updated_at: new Date().toISOString() });
        setSavingWaNumber(false);
        if (error) { await customAlert('❌ ' + error.message); return; }
        setWhatsappBotNumber(digits);
        await customAlert(digits
            ? `✅ تم حفظ رقم واتساب: ${digits}`
            : '✅ تم مسح رقم واتساب — زر الربط سيبقى مخفياً حتى تُدخل رقماً.');
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

    // Banner reordering: persist the new order to `banners.display_order`
    // for each affected row. We do this in parallel via Promise.allSettled
    // so a single failed write doesn't block the rest.
    const dragId = useRef<string | null>(null);
    const persistBannerOrder = async (newList: any[]) => {
        const updates = newList.map((b, i) => ({ id: b.id, display_order: i }));
        // Reflect locally first (optimistic) — the parent state already
        // received the reordered list before this is called.
        const writes = updates.map(({ id, display_order }) =>
            supabase.from('banners').update({ display_order }).eq('id', id)
        );
        const results = await Promise.allSettled(writes);
        const failed = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && (r.value as any).error)).length;
        if (failed > 0) {
            await customAlert(`⚠️ تعذّر حفظ ترتيب ${failed} بانر — حدّث الصفحة للتأكد`);
        }
    };
    const onBannerDragStart = (id: string) => { dragId.current = id; };
    const onBannerDrop = (targetId: string) => {
        const sourceId = dragId.current;
        dragId.current = null;
        if (!sourceId || sourceId === targetId) return;
        const srcIdx = banners.findIndex((b) => b.id === sourceId);
        const dstIdx = banners.findIndex((b) => b.id === targetId);
        if (srcIdx < 0 || dstIdx < 0) return;
        const next = [...banners];
        const [moved] = next.splice(srcIdx, 1);
        next.splice(dstIdx, 0, moved);
        setBanners(next);
        persistBannerOrder(next);
    };
    const moveBanner = (id: string, direction: -1 | 1) => {
        const idx = banners.findIndex((b) => b.id === id);
        if (idx < 0) return;
        const targetIdx = idx + direction;
        if (targetIdx < 0 || targetIdx >= banners.length) return;
        const next = [...banners];
        [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
        setBanners(next);
        persistBannerOrder(next);
    };

    const toggleBanner = async (b: any) => {
        const next = !b.is_active;
        // v12.31 — التفعيل اليدوي من الأدمن يمسح frozen_reason (البنر الذي
        // أخفاه انتهاء اشتراك المتجر لا يعود إلا بهذا القرار الصريح).
        const patch: any = next ? { is_active: true, frozen_reason: null } : { is_active: false };
        // Flip locally first — toggle pill snaps instantly.
        setBanners(prev => prev.map(x => x.id === b.id ? { ...x, ...patch } : x));
        const { error } = await supabase.from('banners').update(patch).eq('id', b.id);
        if (error) {
            setBanners(prev => prev.map(x => x.id === b.id ? { ...x, is_active: !next, frozen_reason: b.frozen_reason } : x));
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
            <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">🛠️ أدوات الإدارة</h1>
                    <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                        إعدادات المنصة، البانرات، الحملات الترويجية
                    </p>
                </div>
                {/* Force-update escape hatch (v11.23): if the device is stuck on an
                    old cached build (iOS Safari pins the SW), this purges every
                    cache and hard-reloads to the latest deploy in one tap. */}
                <button
                    type="button"
                    onClick={async () => {
                        const ok = await customConfirm('سيتم تحديث التطبيق لأحدث نسخة وإعادة التحميل. متابعة؟');
                        if (ok) await applySwUpdate();
                    }}
                    className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-xs font-extrabold shadow-md hover:shadow-lg active:scale-95 transition-all flex items-center gap-2"
                >
                    🔄 تحديث التطبيق للأحدث
                </button>
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
                        icon="🤖"
                        title="بوت تيليجرام"
                        subtitle={
                            telegramBotEnabled
                                ? 'مُفعّل — البوت يعمل وزر الربط ظاهر في الإعدادات'
                                : 'مُعطّل — البوت متوقف عن الرد وزر الربط مخفي'
                        }
                        enabled={telegramBotEnabled}
                        onToggle={toggleBot}
                        color="blue"
                    />
                    <ToggleCard
                        icon="💬"
                        title="بوت واتساب"
                        subtitle={
                            whatsappBotEnabled
                                ? 'مُفعّل — البوت يعمل وزر الربط يظهر في الإعدادات (يلزم إدخال الرقم أدناه)'
                                : 'مُعطّل — البوت متوقف عن الرد وزر الربط مخفي'
                        }
                        enabled={whatsappBotEnabled}
                        onToggle={toggleWhatsappBot}
                        color="green"
                    />
                    {whatsappBotEnabled && (
                        <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4">
                            <label className="block text-sm font-bold text-[var(--text-primary)] mb-1">📱 رقم واتساب الرسمي للبوت</label>
                            <p className="text-xs text-[var(--gray-400)] mb-2">أرقام فقط مع رمز الدولة (مثال: 9665XXXXXXXX). زر الربط لن يظهر في الإعدادات حتى تُدخل رقماً صحيحاً.</p>
                            <div className="flex gap-2">
                                <input
                                    type="tel"
                                    dir="ltr"
                                    value={whatsappBotNumber}
                                    onChange={e => setWhatsappBotNumber(e.target.value.replace(/\D/g, ''))}
                                    placeholder="9665XXXXXXXX"
                                    className="flex-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--body-bg)] text-[var(--text-primary)] text-sm font-semibold outline-none"
                                />
                                <button
                                    onClick={saveWhatsappNumber}
                                    disabled={savingWaNumber}
                                    className="px-4 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-extrabold shadow-md hover:shadow-lg active:scale-95 transition-all disabled:opacity-60"
                                >
                                    {savingWaNumber ? '⏳' : '💾 حفظ'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* v12.57 — نظام موحّد (طلب ناصر): البطاقة تختار موسم الحملة فقط،
                والتفعيل الفعلي كله (ألوان الموقع + بانر الرئيسية + صفحة العروض
                + القائمة الجانبية + خانة التاجر + البوتان) تحكمه تواريخ الحملة
                أدناه وحدها — القاعدة تشتق seasonal_theme من النافذة العامة
                تلقائياً (trigger عند الحفظ + كرون كل ١٥ دقيقة). */}
            <section>
                <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">🎨 الموسم — هوية وحملة موحّدة</h2>
                    {seasonTheme ? (
                        <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-[var(--primary-light)] text-[var(--primary)]">
                            🟢 الهوية النشطة الآن: {SEASONS.find(s => s.id === seasonTheme)?.emoji} {SEASONS.find(s => s.id === seasonTheme)?.ar}
                        </span>
                    ) : (
                        <span className="text-xs font-extrabold px-3 py-1 rounded-full bg-[var(--gray-100)] text-[var(--text-secondary)]">
                            ⚪ الهوية الأساسية — لا موسم نشط الآن
                        </span>
                    )}
                </div>
                <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">
                    نظام واحد بلا لخبطة: <b>اختر الموسم من البطاقات</b> ثم حدد التواريخ واحفظ الحملة بالأسفل. ألوان المنصة والبانر وصفحة العروض والقائمة الجانبية والبوتات كلها تشتغل <b>تلقائياً مع بداية «الصفحة العامة»</b> وتنطفئ مع نهايتها، وخانة «شارك في عروض الموسم» عند التاجر تتبع «نافذة التجار» — لا يوجد أي تفعيل يدوي منفصل، و«إنهاء الحملة» يعيد كل شيء فوراً.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {SEASONS.map(s => {
                        const selected = camp.season_id === s.id;
                        const liveNow = seasonTheme === s.id;
                        return (
                            <button
                                key={s.id}
                                type="button"
                                onClick={() => setCamp(prev => ({ ...prev, season_id: s.id }))}
                                className={`relative text-right rounded-2xl overflow-hidden border-2 transition-all active:scale-[0.97] ${
                                    selected
                                        ? 'border-[var(--primary)] shadow-lg'
                                        : 'border-[var(--border-color)] hover:shadow-md'
                                }`}
                                style={{ background: 'var(--card-bg)' }}
                            >
                                <div className="h-16 w-full relative" style={{ background: s.swatch }}>
                                    <span className="absolute bottom-1.5 right-2.5 text-2xl" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.4))' }}>{s.emoji}</span>
                                    {liveNow && (
                                        <span className="absolute top-1.5 left-2 text-[10px] font-black bg-white/95 text-emerald-700 px-2 py-0.5 rounded-full shadow">
                                            🟢 نشط الآن
                                        </span>
                                    )}
                                    {!liveNow && selected && campSaved && (
                                        <span className="absolute top-1.5 left-2 text-[10px] font-black bg-white/95 text-amber-600 px-2 py-0.5 rounded-full shadow">
                                            ⏳ مجدول
                                        </span>
                                    )}
                                </div>
                                <div className="p-2.5">
                                    <div className="text-sm font-extrabold text-[var(--text-primary)]">{s.ar}</div>
                                    <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{s.hintAr}</div>
                                    <div className={`mt-2 text-[11px] font-black rounded-lg py-1.5 text-center ${
                                        selected
                                            ? 'text-white'
                                            : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'
                                    }`}
                                        style={selected ? { background: s.swatch } : undefined}
                                    >
                                        {selected ? '✓ موسم الحملة — حدد التواريخ بالأسفل' : 'اختر لهذه الحملة'}
                                    </div>
                                </div>
                            </button>
                        );
                    })}
                </div>

                {/* v12.48 — «حملة الموسم»: مشاركة التجار + صفحة العروض الحصرية */}
                {(() => {
                    const campSeason = SEASONS.find(s => s.id === camp.season_id);
                    const parsed: SeasonCampaign | null = campSaved && camp.season_id ? {
                        seasonId: camp.season_id,
                        sellerFrom: camp.seller_from || undefined, sellerTo: camp.seller_to || undefined,
                        publicFrom: camp.public_from || undefined, publicTo: camp.public_to || undefined,
                    } : null;
                    const sellerOpen = campaignSellerOpen(parsed);
                    const publicLive = campaignPublicLive(parsed);
                    const dateInput = (label: string, key: keyof typeof camp) => (
                        <div>
                            <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">{label}</label>
                            <input
                                type="date"
                                value={camp[key]}
                                onChange={e => setCamp(prev => ({ ...prev, [key]: e.target.value }))}
                                className="w-full px-2.5 py-2 rounded-xl border border-[var(--border-color)] bg-[var(--body-bg)] text-[var(--text-primary)] text-sm font-semibold outline-none"
                            />
                        </div>
                    );
                    return (
                        <div className="mt-5 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4">
                            <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
                                <h3 className="text-base font-extrabold text-[var(--text-primary)]">📅 تواريخ الحملة — التحكم الوحيد بالتفعيل</h3>
                                {campSaved && (
                                    <div className="flex gap-1.5 flex-wrap">
                                        <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${sellerOpen ? 'bg-emerald-500/15 text-emerald-600' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                                            🏪 باب التجار: {sellerOpen ? 'مفتوح الآن' : 'مغلق'}
                                        </span>
                                        <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${publicLive ? 'bg-emerald-500/15 text-emerald-600' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                                            👥 الصفحة + الهوية + البوتات: {publicLive ? 'شغّالة الآن' : 'مطفأة'}
                                        </span>
                                    </div>
                                )}
                            </div>
                            <p className="text-xs text-[var(--text-secondary)] mb-3 leading-relaxed">
                                <b>نافذة التجار:</b> فيها فقط تظهر للتاجر خانة «شارك في عروض الموسم» عند إضافة/تعديل المنتج. <b>النافذة العامة:</b> فيها فقط تظهر صفحة العروض للمتسوقين (القائمة الجانبية + زر «تسوّق الآن» + زر الموسم في البوتين) <b>وتشتغل هوية الألوان والبانر تلقائياً</b> — وتنطفئ كلها بانتهائها دون أي تدخل منك.
                            </p>
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                                <div>
                                    <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">الموسم (من البطاقات أعلاه)</label>
                                    <div className={`w-full px-2.5 py-2 rounded-xl border text-sm font-extrabold ${campSeason ? 'border-[var(--primary)] bg-[var(--primary-light)] text-[var(--primary)]' : 'border-[var(--border-color)] bg-[var(--body-bg)] text-[var(--text-secondary)]'}`}>
                                        {campSeason ? `${campSeason.emoji} ${campSeason.ar}` : '⬆️ اضغط بطاقة موسم أولاً'}
                                    </div>
                                </div>
                                {dateInput('🗓 تاريخ الفعالية (اختياري)', 'event_date')}
                                <div className="hidden md:block" />
                                {dateInput('🏪 التجار — من', 'seller_from')}
                                {dateInput('🏪 التجار — إلى', 'seller_to')}
                                <div className="hidden md:block" />
                                {dateInput('👥 الصفحة العامة — من', 'public_from')}
                                {dateInput('👥 الصفحة العامة — إلى', 'public_to')}
                            </div>
                            {/* v12.57 — تنبيه التعارض: نافذة عامة لا تشمل تاريخ الفعالية
                                المسجّل للتذكير (مثل حملة «اليوم الوطني» في يوليو والفعلية
                                ٢٣ سبتمبر) — هذا مصدر اللخبطة الذي أشار له ناصر. */}
                            {campSeason && eventDates[camp.season_id] && camp.public_from && camp.public_to
                                && (eventDates[camp.season_id] < camp.public_from || eventDates[camp.season_id] > camp.public_to) && (
                                <div className="mt-2.5 px-3 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] font-bold text-[var(--text-primary)] leading-relaxed">
                                    💡 انتبه: تاريخ فعالية «{campSeason.ar}» المسجّل عندك للتذكير هو <b>{eventDates[camp.season_id]}</b>، لكن نافذتك العامة ({camp.public_from} → {camp.public_to}) لا تشمله — إن لم يكن هذا مقصوداً عدّل التواريخ قبل الحفظ.
                                </div>
                            )}
                            {/* v12.69 — نص بانر الموسم تحت تحكم المالك (طلب ناصر):
                                عنوان + سطر تسويقي لكل حملة، والفراغ = الافتراضي.
                                يظهر في بانر الرئيسية + صفحة /seasonal + القائمة الجانبية. */}
                            {campSeason && (
                                <div className="mt-3 rounded-xl border border-[var(--border-color)] bg-[var(--body-bg)] p-3">
                                    <div className="text-xs font-extrabold text-[var(--text-primary)] mb-1">✍️ نص بانر الموسم — أنت المتحكم</div>
                                    <p className="text-[11px] text-[var(--text-secondary)] mb-2 leading-relaxed">
                                        يظهر للمتسوقين في بانر الرئيسية وصفحة العروض الموسمية والقائمة الجانبية.
                                        اتركه فارغاً ليُستخدم النص الافتراضي (الظاهر داخل الحقل كمثال باهت)، ويسري تعديلك فور «💾 حفظ الحملة».
                                    </p>
                                    <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">العنوان الكبير</label>
                                    <input
                                        type="text"
                                        value={camp.hero_title_ar}
                                        onChange={e => setCamp(prev => ({ ...prev, hero_title_ar: e.target.value }))}
                                        placeholder={`عروض ${campSeason.ar} الحصرية`}
                                        className="w-full px-2.5 py-2 mb-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] text-sm font-bold outline-none focus:border-violet-500"
                                    />
                                    <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">السطر التسويقي (تحت العنوان)</label>
                                    <textarea
                                        rows={2}
                                        value={camp.hero_tagline_ar}
                                        onChange={e => setCamp(prev => ({ ...prev, hero_tagline_ar: e.target.value }))}
                                        placeholder={campSeason.taglineAr}
                                        className="w-full px-2.5 py-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] text-sm font-semibold outline-none focus:border-violet-500 leading-relaxed"
                                    />
                                    <details className="mt-2 rounded-xl border border-[var(--border-color)]">
                                        <summary className="cursor-pointer px-3 py-2 text-[11px] font-bold text-[var(--text-secondary)]">🌐 النسخة الإنجليزية (لمستخدمي English)</summary>
                                        <div className="p-2.5 space-y-2">
                                            <input
                                                type="text" dir="ltr"
                                                value={camp.hero_title_en}
                                                onChange={e => setCamp(prev => ({ ...prev, hero_title_en: e.target.value }))}
                                                placeholder={`Exclusive ${campSeason.en} Deals`}
                                                className="w-full px-2.5 py-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] text-sm outline-none"
                                            />
                                            <textarea
                                                rows={2} dir="ltr"
                                                value={camp.hero_tagline_en}
                                                onChange={e => setCamp(prev => ({ ...prev, hero_tagline_en: e.target.value }))}
                                                placeholder={campSeason.taglineEn}
                                                className="w-full px-2.5 py-2 rounded-xl border border-[var(--border-color)] bg-[var(--card-bg)] text-[var(--text-primary)] text-sm outline-none leading-relaxed"
                                            />
                                        </div>
                                    </details>
                                </div>
                            )}
                            <div className="flex gap-2 mt-3 flex-wrap">
                                <button
                                    onClick={saveCampaign}
                                    disabled={savingCamp}
                                    className="flex-1 min-w-[140px] py-2.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-600 text-white text-sm font-extrabold shadow-md hover:shadow-lg active:scale-95 transition-all disabled:opacity-60"
                                >
                                    {savingCamp ? '⏳' : '💾 حفظ الحملة'}
                                </button>
                                {campSaved && campSeason && (
                                    <button
                                        onClick={notifySellersCampaign}
                                        disabled={savingCamp}
                                        className="flex-1 min-w-[140px] py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 text-white text-sm font-extrabold shadow-md hover:shadow-lg active:scale-95 transition-all disabled:opacity-60"
                                    >
                                        📣 إشعار التجار الآن
                                    </button>
                                )}
                                {campSaved && (
                                    <button
                                        onClick={clearCampaign}
                                        disabled={savingCamp}
                                        className="py-2.5 px-4 rounded-xl border border-red-300 text-red-500 text-sm font-extrabold hover:bg-red-500/10 transition-all disabled:opacity-60"
                                    >
                                        🗑 إنهاء الحملة
                                    </button>
                                )}
                            </div>

                            {/* تذكير المالك قبل ٣٠ ثم ٧ أيام من كل فعالية (كرون يومي) */}
                            <div className="mt-4 pt-3 border-t border-[var(--border-color)]">
                                <div className="text-sm font-extrabold text-[var(--text-primary)] mb-1">⏰ تواريخ الفعاليات — للتذكير التلقائي</div>
                                <p className="text-[11px] text-[var(--text-secondary)] mb-2.5 leading-relaxed">
                                    سيصلك إشعار قبل كل فعالية <b>بشهر</b> ثم <b>بأسبوع</b> حتى تجهّز الحملة. حدّث التواريخ متى شئت (رمضان والعيد يتقدمان كل سنة).
                                </p>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
                                    {SEASONS.map(s => (
                                        <div key={s.id}>
                                            <label className="block text-[11px] font-bold text-[var(--text-secondary)] mb-1">{s.emoji} {s.ar}</label>
                                            <input
                                                type="date"
                                                value={eventDates[s.id] || ''}
                                                onChange={e => setEventDates(prev => ({ ...prev, [s.id]: e.target.value }))}
                                                className="w-full px-2.5 py-2 rounded-xl border border-[var(--border-color)] bg-[var(--body-bg)] text-[var(--text-primary)] text-sm font-semibold outline-none"
                                            />
                                        </div>
                                    ))}
                                </div>
                                <button
                                    onClick={saveEventDates}
                                    disabled={savingDates}
                                    className="mt-3 w-full py-2.5 rounded-xl border border-[var(--border-color)] bg-[var(--body-bg)] text-[var(--text-primary)] text-sm font-extrabold hover:shadow-md transition-all disabled:opacity-60"
                                >
                                    {savingDates ? '⏳' : '💾 حفظ تواريخ التذكير'}
                                </button>
                            </div>
                        </div>
                    );
                })()}
            </section>

            {/* Banners */}
            <section>
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-bold text-[var(--text-primary)]">🖼️ البانرات الإعلانية</h2>
                    <button
                        onClick={() => { setBannerEdit(null); setBannerModalOpen(true); }}
                        className="px-4 py-2 bg-gradient-to-r from-orange-500 to-red-600 text-white font-bold rounded-xl text-sm shadow-md hover:shadow-lg transition-all"
                    >
                        ➕ بانر جديد
                    </button>
                </div>

                {/* v12.71 — سرعة تنقّل البانر في الرئيسية بيد المدير (الافتراضي ٢ ثانية) */}
                <div className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded-2xl p-4 mb-3 flex flex-wrap items-center gap-3">
                    <div className="flex-1 min-w-[180px]">
                        <div className="text-sm font-extrabold text-[var(--text-primary)]">⏱ مدة عرض كل بانر (بالثواني)</div>
                        <div className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
                            كل كم ثانية ينتقل البانر في الصفحة الرئيسية للبانر التالي تلقائياً. يسري فوراً على كل الزوار بعد الحفظ.
                        </div>
                    </div>
                    <input
                        type="number"
                        min={1}
                        max={120}
                        step={0.5}
                        inputMode="decimal"
                        value={bannerSeconds}
                        onChange={(e) => setBannerSeconds(e.target.value)}
                        className="w-24 px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-extrabold text-[var(--text-primary)] text-center outline-none focus:border-emerald-500"
                        dir="ltr"
                    />
                    <button
                        onClick={async () => {
                            const n = parseFloat(bannerSeconds);
                            if (!Number.isFinite(n) || n < 1 || n > 120) {
                                await customAlert('⚠️ أدخل رقماً بين 1 و120 ثانية.');
                                return;
                            }
                            setSavingBannerSeconds(true);
                            const { error } = await supabase.from('platform_settings').upsert({
                                key: 'banner_autoplay_seconds',
                                value: n,
                                description: 'Home banner autoplay interval in seconds (admin-controlled, default 2)',
                                updated_at: new Date().toISOString(),
                            });
                            setSavingBannerSeconds(false);
                            if (error) { await customAlert('❌ ' + error.message); return; }
                            await customAlert(`✅ تم الحفظ — البانر يتنقل الآن كل ${n} ثانية.`);
                        }}
                        disabled={savingBannerSeconds}
                        className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-sm transition-all"
                    >
                        {savingBannerSeconds ? 'جاري الحفظ...' : '💾 حفظ'}
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
                        {banners.map((b, i) => (
                            <div
                                key={b.id}
                                draggable
                                onDragStart={() => onBannerDragStart(b.id)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => onBannerDrop(b.id)}
                                className="group bg-[var(--card-bg)] rounded-2xl overflow-hidden border border-[var(--border-color)] shadow-sm transition-all hover:shadow-md cursor-move"
                            >
                                <div className="relative h-32 bg-[var(--gray-100)]">
                                    {b.image_url && (
                                        <img
                                            src={b.image_url}
                                            alt=""
                                            className="w-full h-full object-cover pointer-events-none"
                                            onError={(e) =>
                                                ((e.target as HTMLImageElement).style.display = 'none')
                                            }
                                        />
                                    )}
                                    <Tooltip text="اسحب لإعادة الترتيب">
                                        <span className="absolute top-2 left-2 bg-black/40 backdrop-blur-sm text-white text-base font-bold rounded-md px-2 py-1 cursor-grab active:cursor-grabbing">
                                            ⋮⋮
                                        </span>
                                    </Tooltip>
                                    <div className="absolute top-2 right-2 flex items-center gap-1.5">
                                        <span className="bg-black/40 backdrop-blur-sm text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md tabular-nums">
                                            #{i + 1}
                                        </span>
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
                                    {/* v12.31 — بنر أخفاه انتهاء اشتراك المتجر: لا يعود إلا بتفعيل يدوي من هنا */}
                                    {!b.is_active && b.frozen_reason === 'subscription_expired' && (
                                        <div className="mt-2 text-[11px] font-extrabold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 leading-relaxed">
                                            ⏸ أُخفي تلقائياً — انتهى اشتراك المتجر المرتبط به. لن يعود للظهور إلا إذا فعّلته أنت بعد تجديد اشتراكه.
                                        </div>
                                    )}
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
                                        <Tooltip text="انقل للأعلى">
                                            <button
                                                type="button"
                                                onClick={() => moveBanner(b.id, -1)}
                                                disabled={i === 0}
                                                className="w-7 h-7 text-sm font-bold bg-[var(--gray-100)] text-[var(--text-secondary)] hover:bg-[var(--gray-200)] rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                                            >
                                                ↑
                                            </button>
                                        </Tooltip>
                                        <Tooltip text="انقل للأسفل">
                                            <button
                                                type="button"
                                                onClick={() => moveBanner(b.id, 1)}
                                                disabled={i === banners.length - 1}
                                                className="w-7 h-7 text-sm font-bold bg-[var(--gray-100)] text-[var(--text-secondary)] hover:bg-[var(--gray-200)] rounded-lg disabled:opacity-30 disabled:cursor-not-allowed"
                                            >
                                                ↓
                                            </button>
                                        </Tooltip>
                                        <Tooltip text="تعديل البانر">
                                            <button
                                                type="button"
                                                onClick={() => { setBannerEdit(b); setBannerModalOpen(true); }}
                                                className="px-3 py-1.5 text-xs font-bold bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-lg transition-all duration-200 active:scale-90"
                                            >
                                                ✏️
                                            </button>
                                        </Tooltip>
                                        <Tooltip text="حذف نهائي">
                                            <button
                                                type="button"
                                                onClick={() => deleteBanner(b.id)}
                                                className="px-3 py-1.5 text-xs font-bold bg-red-50 text-red-600 hover:bg-red-100 rounded-lg transition-all duration-200 active:scale-90"
                                            >
                                                🗑
                                            </button>
                                        </Tooltip>
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
                                            {c.recurrence && c.recurrence !== 'none' && (
                                                <><span>•</span><span className="text-indigo-600 font-bold">🔁 {RECURRENCE_LABELS[c.recurrence] ?? c.recurrence}</span></>
                                            )}
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
                <BannerModal
                    initial={bannerEdit}
                    onClose={() => { setBannerModalOpen(false); setBannerEdit(null); }}
                    onSaved={fetchAll}
                />
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
