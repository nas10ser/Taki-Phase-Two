/**
 * AdminTools — البانرات والحملات وإعدادات المنصّة (v14.89 — أُعيدت على نظام اللوحة)
 * ═══════════════════════════════════════════════════════════════════════════
 * ما تفعله الشاشة (بلا تغيير في المنطق): بانرات الرئيسية (إضافة/تعديل/ترتيب/
 * تفعيل/حذف + مدّة التنقّل) · الحملات الترويجية (نشرٌ سريع + نافذة كاملة +
 * بثّ/إيقاف/حذف) · مفاتيح التشغيل (بوابة الدفع · تيليجرام · واتساب ورقمه) ·
 * مهلة الحجز · حملة الموسم وتواريخ التذكير · أداة ضغط الصور.
 *
 * 🔴 أربعة عيوب قِيست وصُحِّحت هنا:
 *
 *  ١) **زرٌّ يقول «تمّ» ولا يفعل شيئاً.** مفتاح بوابة الدفع كان يكتب بـ
 *     `update … eq('key')`: لو لم يكن الصفّ موجوداً عاد `error=null` وصفر
 *     صفوف، فيرى ناصر «✅ تم التفعيل» ولا شيء تغيّر. الآن كل كتابةٍ في هذا
 *     الملفّ تمرّ بـ`writeSetting`/`.select()` **وتُعدّ صفوفها**، وصفرُ صفوفٍ
 *     خطأٌ صريح لا نجاحٌ صامت (وهذا يشمل الحذف الذي ترفضه RLS: يعود بلا خطأ).
 *
 *  ٢) **مفاتيح كاذبة في أوّل ثانية.** كانت المفاتيح تُرسم بقيمها الافتراضية
 *     قبل وصول القيم الحقيقية (تيليجرام «مُفعّل»، الدفع «مطفأة»، المهل ٢/٦/٧٢)
 *     — وضغطةٌ حينها تقلب من القيمة الخطأ. الآن لا يُرسم أي مفتاح أو حقل إعداد
 *     قبل وصول قيمته: `AdmSkeleton` مكانه، و`AdmError` إن فشل التحميل.
 *
 *  ٣) **صلاحيات فرعية مطبَّقة على النصف.** `action_manage_campaigns` كانت
 *     تُفحص في موضعين و`action_manage_banners` في موضعٍ واحد، فأدمنٌ بلا
 *     صلاحية الحملات ينشر من «نشر فوراً» ويحذف، وبلا صلاحية البنرات ينشئ
 *     ويرتّب. الآن **كل إجراء** مربوطٌ بصلاحيته، وما لا يُسمح به **يُخفى**
 *     (كبقيّة اللوحة) لا يُعطَّل، والفحص يبقى في الفعل أيضاً لا في الإخفاء وحده.
 *
 *  ٤) **مصطلحاتٌ تقنية أمام غير المبرمج.** مكان البانر كان يُعرض خاماً
 *     (`home_top`)، وحقلا مدينة/منطقة الحملة كانا نصّين يُطلب فيهما مفتاحٌ
 *     إنجليزي يُخمَّن (`riyadh`, `central`) — وخطأٌ فيهما حملةٌ لا تصل أحداً
 *     بلا أي تحذير. الآن: ترجمةٌ لكل قيمة معروضة، وقائمتا اختيار من
 *     `REGIONS`/`CITIES` (نفس المعرّفات التي تقارنها `taki_user_in_campaign`).
 *
 * 🪤 ولا `dark:` ولا `bg-white` ولا تدرّجات: الألوان رموز `--adm-*` تتبع
 *    `.dark-mode`/`.light-mode`، واللون للدلالة وحدها.
 */

import React, { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import { supabase } from '../../services/supabaseClient';
import { writePlatformSetting } from '../../services/platformSettingWrite';
import { promoRepository } from '../../repositories/promoRepository';
import { storageService } from '../../services/storageService';
import { useApp } from '../../context/AppContext';
import { useEscClose } from '../../hooks/useEscClose';
import { Tooltip } from '../../components/admin/Tooltip';
import BannerImageEditor from '../../components/BannerImageEditor';
import { applySwUpdate } from '../../sw-cleanup';
import { SEASONS, campaignSellerOpen, campaignPublicLive, SeasonCampaign } from '../../data/seasons';
import { REGIONS, CITIES } from '../../data/mock';
import { BANNER } from '../../utils/imageCompression';
import { normalizeArabicNumerals } from '../../utils/helpers';
import ImageOptimizer from '../../components/admin/ImageOptimizer';
import {
    AdmCard, AdmSection, AdmPill, AdmEmpty, AdmSkeleton, AdmError, AdmButton,
} from '../../components/admin/ui';

// ═══════════════════════════════════════════════════════════════════════════
// أنماطٌ مشتركة + ترجمة القيم المعروضة
// ═══════════════════════════════════════════════════════════════════════════

const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '9px 11px', fontSize: '.85rem', fontWeight: 600,
    borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
    background: 'var(--adm-surface-2)', color: 'var(--adm-fg)',
};
const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-3)', marginBottom: 5,
};
const hintStyle: React.CSSProperties = {
    display: 'block', fontSize: '.72rem', lineHeight: 1.75, color: 'var(--adm-fg-2)', marginTop: 5,
};

/** مكان البانر — تُعرض التسمية العربية في كل موضع، لا المفتاح الخام. */
const BANNER_POSITIONS: { v: string; label: string }[] = [
    { v: 'home_top', label: 'أعلى الصفحة الرئيسية' },
    { v: 'category_top', label: 'أعلى التصنيفات' },
];
const positionLabel = (p?: string | null): string =>
    BANNER_POSITIONS.find((x) => x.v === p)?.label ?? (p || '—');

/** المدينة/المنطقة: المعرّف هو ما تقارنه القاعدة، والاسم هو ما يراه القارئ. */
const cityLabel = (id?: string | null): string =>
    id ? (CITIES.find((c) => c.id === id)?.name ?? id) : '';
const regionLabel = (id?: string | null): string =>
    id ? (REGIONS.find((r) => r.id === id)?.name ?? id) : '';

const AUDIENCE_LABELS: Record<string, string> = {
    all: '👥 الجميع', buyer: '🛒 المشترون', seller: '🏪 البائعون',
};

/** مصدرٌ واحد لكتابة الإعدادات (يُثبت الحفظ بصفٍّ مُعاد). */
const writeSetting = writePlatformSetting;

// ═══════════════════════════════════════════════════════════════════════════
// مفتاحٌ واحد لكل التبديلات
// ═══════════════════════════════════════════════════════════════════════════

const Sw: React.FC<{
    on: boolean;
    onToggle: () => void | Promise<void>;
    label: string;
    disabled?: boolean;
}> = ({ on, onToggle, label, disabled }) => {
    const [busy, setBusy] = useState(false);
    const click = async () => {
        if (busy || disabled) return;
        setBusy(true);
        try { await onToggle(); } finally { setBusy(false); }
    };
    const locked = busy || !!disabled;
    return (
        <button
            type="button" onClick={click} disabled={locked}
            aria-pressed={on} aria-busy={busy} aria-label={label} title={label}
            className="adm-focusable"
            style={{
                position: 'relative', flexShrink: 0, width: 46, height: 26, borderRadius: 999,
                border: '1px solid var(--adm-border)',
                background: on ? 'var(--adm-ok-fg)' : 'var(--adm-surface-3)',
                cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? .55 : 1,
                transition: 'background .2s',
            }}
        >
            {/* 🪤 قرصٌ أبيض ثابت يختفي ليلاً: `--adm-ok-fg` أخضرُ فاتح في الوضع
                الداكن، فالأبيض عليه بالكاد يُرى. القرص يتبع الثيم عكسَ مساره. */}
            <span
                style={{
                    position: 'absolute', top: 2, insetInlineStart: on ? 22 : 2,
                    width: 20, height: 20, borderRadius: 999,
                    background: on ? 'var(--adm-surface)' : 'var(--adm-fg-3)',
                    boxShadow: '0 1px 3px rgba(0,0,0,.28)', transition: 'inset-inline-start .2s',
                }}
            />
        </button>
    );
};

/** صفّ إعداد: أيقونة + عنوان + شرحٌ بحالته الحالية + المفتاح. */
const SettingRow: React.FC<{
    icon: string; title: string; desc: string; note?: React.ReactNode; right: React.ReactNode;
}> = ({ icon, title, desc, note, right }) => (
    <div
        style={{
            display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 14px',
            borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
            background: 'var(--adm-surface-2)',
        }}
    >
        <span style={{ fontSize: '1.25rem', lineHeight: 1.2 }} aria-hidden="true">{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '.88rem', fontWeight: 800, color: 'var(--adm-fg)' }}>{title}</div>
            <div style={{ fontSize: '.75rem', lineHeight: 1.75, color: 'var(--adm-fg-2)', marginTop: 3 }}>{desc}</div>
            {note}
        </div>
        {right}
    </div>
);

const Field = memo<{
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    dir?: 'rtl' | 'ltr';
}>(({ label, value, onChange, placeholder, dir }) => (
    <label style={{ display: 'block' }}>
        <span style={labelStyle}>{label}</span>
        <input
            type="text" dir={dir} placeholder={placeholder} value={value}
            onChange={(e) => onChange(e.target.value)}
            className="adm-focusable" style={fieldStyle}
        />
    </label>
));
Field.displayName = 'Field';

// ═══════════════════════════════════════════════════════════════════════════
// نافذة البانر
// ═══════════════════════════════════════════════════════════════════════════

const modalShell: React.CSSProperties = {
    width: '100%', maxHeight: '90vh', overflowY: 'auto',
    background: 'var(--adm-surface)', border: '1px solid var(--adm-border)',
    borderRadius: 'var(--adm-r)', boxShadow: 'var(--adm-shadow-lift)',
};
const modalHead: React.CSSProperties = {
    position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: 10,
    padding: '13px 15px', background: 'var(--adm-surface-2)', borderBottom: '1px solid var(--adm-border)',
};
const modalFoot: React.CSSProperties = {
    position: 'sticky', bottom: 0, display: 'flex', gap: 10, padding: '12px 15px',
    background: 'var(--adm-surface-2)', borderTop: '1px solid var(--adm-border)',
};

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

    // الربط بالاسم لا بالمعرّف: المتاجر وعروضها تُشتق من العروض في الذاكرة،
    // فلا يكتب المدير UUID ولا رابطاً أبداً.
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

    // Esc تُغلق — المسوّدة كلها في المتصفّح حتى زرّ النشر الصريح.
    useEscClose(true, onClose);
    useEffect(() => () => { if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current); }, []);

    const closeEditor = () => {
        setEditorSrc(null);
        if (objectUrlRef.current) { URL.revokeObjectURL(objectUrlRef.current); objectUrlRef.current = null; }
    };

    // اختيار من الجهاز → أداة تحديد الجزء الظاهر (لا رفع قبل القصّ).
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

    // إعادة فتح الأداة على صورةٍ محفوظة: تُجلب إلى blob أولاً كي يبقى الكانفس
    // من نفس المصدر (لا يتلوّث)، والمصادر الخارجية ترتدّ برسالةٍ واضحة.
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

    const handleEditorApply = async (file: File) => {
        closeEditor();
        setUploading(true);
        // v13.33 — البنر: مقاسه الخاص بلا مصغّرة (لا يُعرض صغيراً أبداً)
        const url = await storageService.uploadImage(file, { compress: BANNER, thumb: false });
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
        if (!form.image_url.trim()) { await customAlert('⚠️ يرجى رفع صورة أو لصق رابط'); return; }
        setSaving(true);
        // كل ما قد يرمي داخل try، و`setSaving(false)` في finally، ومهلة ١٢ ثانية
        // فلا يعلق الزرّ على «جاري النشر...» مهما تعثّرت الشبكة (v11.23).
        let err: any = null;
        let rows = -1;
        try {
            // 🪤 `deal_id`/`store_id` مفاتيح أجنبية: الفارغ **يجب** أن يكون null
            // لا `''` — فـ`''` قيمةٌ حقيقية عند بوستجرس وتكسر
            // `banners_deal_id_fkey` (كان هذا عيب «النشر لا يعمل»، v11.30).
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
            // 🪤 `.select('id')` ليس زينة: تعديلٌ ترفضه RLS — أو صفٌّ حُذف من
            // جهازٍ آخر — يعود بـ`error=null` وصفر صفوف، فتقول الشاشة «حُفظ».
            const writeQuery = isEdit
                ? supabase.from('banners').update(row).eq('id', initial.id).select('id')
                : supabase.from('banners').insert([row]).select('id');
            const timeout = new Promise<{ error: any }>(resolve =>
                setTimeout(() => resolve({ error: { message: 'انتهت مهلة الاتصال — تحقق من الإنترنت وحاول مجدداً' } }), 12000)
            );
            const res: any = await Promise.race([writeQuery as any, timeout]);
            err = res?.error ?? null;
            rows = Array.isArray(res?.data) ? res.data.length : -1;
        } catch (e: any) {
            err = { message: e?.message || 'فشل النشر — تحقق من الاتصال' };
        } finally {
            setSaving(false);
        }
        if (err) {
            // ترجمة خطأ المفتاح الأجنبي الخام إلى سببٍ مفهوم.
            const m = String(err.message || '');
            const friendly =
                m.includes('banners_deal_id_fkey') ? 'العرض المرتبط لم يعد موجوداً. اختر عرضاً آخر أو اترك الربط فارغاً.'
                : m.includes('banners_store_id_fkey') ? 'المتجر المرتبط لم يعد موجوداً. اختر متجراً آخر أو اترك الربط فارغاً.'
                : (m || 'فشل النشر');
            await customAlert('❌ ' + friendly);
            return;
        }
        if (rows === 0) {
            await customAlert('❌ لم يُحفَظ شيء (صفر صفوف). قد يكون البانر حُذف، أو لا تسمح صلاحياتك بتعديله. حدّث الصفحة.');
            return;
        }
        await customAlert(isEdit ? '✅ تم حفظ تعديلات البانر' : '✅ تم نشر البانر بنجاح');
        onSaved();
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[3000] flex items-center justify-center p-4 animate-fade-in"
            style={{ background: 'rgba(8, 13, 20, .55)', backdropFilter: 'blur(3px)' }}
        >
            <div role="dialog" aria-modal="true" aria-label="بطاقة البانر" dir="rtl" style={{ ...modalShell, maxWidth: 560 }}>
                <div style={modalHead}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '.7rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>بانر إعلاني</div>
                        <div style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--adm-fg)' }}>
                            {isEdit ? 'تعديل البانر' : 'بانر جديد'}
                        </div>
                    </div>
                    <AdmButton size="sm" variant="ghost" onClick={onClose} title="إغلاق (Esc)">✕</AdmButton>
                </div>

                <div style={{ padding: 15, display: 'grid', gap: 14 }}>
                    {form.image_url && (
                        <div style={{ position: 'relative', borderRadius: 'var(--adm-r-sm)', overflow: 'hidden', border: '1px solid var(--adm-border)' }}>
                            {/* معاينة بنفس نسبة الرئيسية تماماً (2.5:1) */}
                            <div style={{ position: 'relative', width: '100%', aspectRatio: '2.5 / 1', background: 'var(--adm-surface-3)' }}>
                                <img
                                    src={form.image_url} alt=""
                                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                                    onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                                />
                            </div>
                            <div style={{ position: 'absolute', top: 7, insetInlineStart: 7, display: 'flex', gap: 6 }}>
                                <AdmButton size="sm" variant="danger" onClick={() => setForm({ ...form, image_url: '' })} title="إزالة الصورة">✕</AdmButton>
                                <AdmButton size="sm" onClick={handleAdjustExisting}>✂️ ضبط الجزء الظاهر</AdmButton>
                            </div>
                            <div style={{ padding: '6px 9px', fontSize: '.7rem', fontWeight: 700, color: 'var(--adm-fg-3)', background: 'var(--adm-surface-2)' }}>
                                معاينة كما سيظهر في الرئيسية تماماً (2.5:1)
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <Field label="العنوان (عربي)" value={form.title_ar} onChange={(v) => setForm({ ...form, title_ar: v })} />
                        <Field label="العنوان (English)" value={form.title_en} onChange={(v) => setForm({ ...form, title_en: v })} dir="ltr" />
                    </div>

                    {/* الصورة: رفعٌ أو رابط */}
                    <div>
                        <span style={labelStyle}>صورة البانر <span style={{ color: 'var(--adm-bad-fg)' }}>*</span></span>
                        <div style={{ ...hintStyle, marginTop: 0, marginBottom: 8 }}>
                            📐 المقاس المثالي <b>1200×480</b> بكسل (نسبة 2.5:1). بعد الاختيار تفتح أداةٌ تحرّك الصورة وتحدّد الجزء الظاهر بالضبط.
                        </div>
                        {/* 🪤 `<label>` أصليّ يفتح المنتقي بلا `fileInputRef.click()` —
                            ذلك المسار كان يفشل صامتاً على بعض متصفّحات سطح المكتب.
                            والحقل مخفيٌّ بصرياً لا بـ`display:none` (تبتلع النقرة). */}
                        <label
                            className="adm-focusable"
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                width: '100%', padding: '12px', fontSize: '.85rem', fontWeight: 800,
                                borderRadius: 'var(--adm-r-sm)', border: '1px dashed var(--adm-border-strong)',
                                background: 'var(--adm-surface-2)', color: 'var(--adm-fg)',
                                cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? .5 : 1,
                            }}
                        >
                            <input
                                ref={fileInputRef} type="file" accept="image/*"
                                onChange={handleFilePick} disabled={uploading}
                                style={{ position: 'absolute', width: 1, height: 1, padding: 0, margin: -1, overflow: 'hidden', clip: 'rect(0,0,0,0)', whiteSpace: 'nowrap', border: 0 }}
                            />
                            {uploading ? '⏳ جاري الرفع...' : '📤 رفع صورة من الجهاز'}
                        </label>
                        <div style={{ textAlign: 'center', fontSize: '.72rem', color: 'var(--adm-fg-3)', margin: '7px 0' }}>— أو —</div>
                        <input
                            type="text" dir="ltr" placeholder="ألصق رابط الصورة (https://...)"
                            value={form.image_url}
                            onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                            className="adm-focusable" style={fieldStyle}
                        />
                    </div>

                    {/* وجهة الضغط — بالاسم لا بالمعرّف */}
                    <div style={{ borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)', padding: 13, display: 'grid', gap: 11 }}>
                        <div>
                            <div style={{ fontSize: '.85rem', fontWeight: 800, color: 'var(--adm-fg)' }}>🔗 عند الضغط على البانر</div>
                            <div style={{ ...hintStyle, marginTop: 3 }}>اختياري. اختر متجراً (وعرضاً محدداً إن أردت). اترك الكل فارغاً لعرض الصورة فقط.</div>
                        </div>

                        {!form.store_id ? (
                            <div style={{ position: 'relative' }}>
                                <span style={labelStyle}>🏪 ابحث عن المتجر بالاسم</span>
                                <input
                                    type="text" value={storeQuery}
                                    onChange={(e) => setStoreQuery(e.target.value)}
                                    placeholder="اكتب اسم المتجر..."
                                    className="adm-focusable" style={fieldStyle}
                                />
                                {storeMatches.length > 0 && (
                                    <div style={{ marginTop: 6, maxHeight: 200, overflowY: 'auto', borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)', background: 'var(--adm-surface)' }}>
                                        {storeMatches.map((s) => (
                                            <button
                                                key={s.id} type="button" onClick={() => selectStore(s)}
                                                className="adm-focusable"
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'right',
                                                    padding: '9px 11px', fontSize: '.84rem', fontWeight: 700, cursor: 'pointer',
                                                    background: 'transparent', border: 0, borderBottom: '1px solid var(--adm-border)', color: 'var(--adm-fg)',
                                                }}
                                            >
                                                <span aria-hidden="true">🏪</span>
                                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                                {storeQuery.trim() && storeMatches.length === 0 && (
                                    <span style={hintStyle}>لا يوجد متجر بهذا الاسم. (تظهر المتاجر التي لديها عروض فقط.)</span>
                                )}
                            </div>
                        ) : (
                            <div style={{ display: 'grid', gap: 11 }}>
                                <div
                                    style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                                        padding: '9px 11px', borderRadius: 'var(--adm-r-sm)',
                                        background: 'var(--adm-ok-bg)', color: 'var(--adm-ok-fg)',
                                    }}
                                >
                                    <span style={{ fontSize: '.84rem', fontWeight: 800, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        🏪 {selectedStoreName || 'متجر مُختار'}
                                    </span>
                                    <button
                                        type="button" onClick={clearStore} className="adm-focusable"
                                        style={{ background: 'transparent', border: 0, color: 'inherit', fontSize: '.76rem', fontWeight: 800, cursor: 'pointer' }}
                                    >
                                        تغيير ✕
                                    </button>
                                </div>
                                <label style={{ display: 'block' }}>
                                    <span style={labelStyle}>🎯 عرض محدد من هذا المتجر (اختياري)</span>
                                    <select
                                        value={form.deal_id}
                                        onChange={(e) => setForm({ ...form, deal_id: e.target.value })}
                                        className="adm-focusable" style={fieldStyle}
                                    >
                                        <option value="">— بدون عرض محدد (يفتح صفحة المتجر) —</option>
                                        {storeDeals.map((d) => (
                                            <option key={d.id} value={d.id}>{d.itemName}</option>
                                        ))}
                                    </select>
                                    <span style={hintStyle}>
                                        {storeDeals.length === 0
                                            ? 'لا توجد عروض نشطة لهذا المتجر — سيفتح البانر صفحة المتجر.'
                                            : 'إن اخترت عرضاً، يفتح البانر صفحة ذلك العرض مباشرة بدل صفحة المتجر.'}
                                    </span>
                                </label>
                            </div>
                        )}

                        <details style={{ borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)', background: 'var(--adm-surface)' }}>
                            <summary style={{ cursor: 'pointer', padding: '8px 11px', fontSize: '.76rem', fontWeight: 800, color: 'var(--adm-fg-2)' }}>
                                🌐 أو رابط خارجي بدل المتجر (متقدّم)
                            </summary>
                            <div style={{ padding: 11 }}>
                                <Field label="رابط الوجهة" value={form.target_url} onChange={(v) => setForm({ ...form, target_url: v })} placeholder="https://..." dir="ltr" />
                                <span style={hintStyle}>صفحة خارجية تُفتح عند الضغط. تُستخدم فقط إذا لم تختر متجراً بالأعلى.</span>
                            </div>
                        </details>
                    </div>

                    <label style={{ display: 'block' }}>
                        <span style={labelStyle}>مكان الظهور</span>
                        <select
                            value={form.position}
                            onChange={(e) => setForm({ ...form, position: e.target.value })}
                            className="adm-focusable" style={fieldStyle}
                        >
                            {BANNER_POSITIONS.map((p) => <option key={p.v} value={p.v}>{p.label}</option>)}
                        </select>
                    </label>
                </div>

                <div style={modalFoot}>
                    <AdmButton onClick={onClose} full>إلغاء</AdmButton>
                    <AdmButton variant="primary" onClick={handleSave} disabled={saving} full>
                        {saving ? (isEdit ? 'جاري الحفظ...' : 'جاري النشر...') : (isEdit ? '💾 حفظ التعديلات' : '🚀 نشر البانر')}
                    </AdmButton>
                </div>
            </div>

            {uploading && (
                <div className="fixed inset-0 flex items-center justify-center z-[3100]" style={{ background: 'rgba(8,13,20,.45)' }}>
                    <AdmCard>
                        <span style={{ fontSize: '.85rem', fontWeight: 800, color: 'var(--adm-fg)' }}>⏳ جاري رفع الصورة...</span>
                    </AdmCard>
                </div>
            )}

            {editorSrc && (
                <BannerImageEditor src={editorSrc} isRTL={isRTL} onApply={handleEditorApply} onCancel={closeEditor} />
            )}
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════════
// نافذة الحملة الترويجية
// ═══════════════════════════════════════════════════════════════════════════

type CampaignDraft = {
    title_ar: string; title_en: string; body_ar: string; body_en: string;
    target_audience: 'all' | 'buyer' | 'seller';
    target_city: string; target_region: string;
    image_url: string; action_url: string;
    action_label_ar: string; action_label_en: string;
    starts_at: string; ends_at: string;
    priority: number; is_active: boolean;
    /** v12.27 — إعادة بث تلقائية: none/daily/every_3_days/weekend/weekly/monthly */
    recurrence: string;
    /** ساعة الإرسال بتوقيت الرياض (0–23) */
    recurrence_hour: number;
};

// خيارات التكرار — الكرون الساعي في القاعدة يعيد البثّ حسبها (بتوقيت الرياض)
const RECURRENCE_OPTIONS: { v: string; label: string; icon: string }[] = [
    { v: 'none',         label: 'بدون تكرار',       icon: '⏹' },
    { v: 'daily',        label: 'يومياً',            icon: '📆' },
    { v: 'every_3_days', label: 'كل ٣ أيام',        icon: '🔂' },
    { v: 'weekend',      label: 'كل ويكند (الجمعة)', icon: '🌴' },
    { v: 'weekly',       label: 'أسبوعياً',          icon: '🗓' },
    { v: 'monthly',      label: 'شهرياً',            icon: '📅' },
];
const RECURRENCE_LABELS: Record<string, string> = Object.fromEntries(
    RECURRENCE_OPTIONS.map((o) => [o.v, o.label])
);

const emptyCampaign: CampaignDraft = {
    title_ar: '', title_en: '', body_ar: '', body_en: '',
    target_audience: 'all', target_city: '', target_region: '',
    image_url: '', action_url: '', action_label_ar: '', action_label_en: '',
    starts_at: '', ends_at: '', priority: 0, is_active: true,
    recurrence: 'none', recurrence_hour: 10,
};

/** زرّ اختيارٍ واحد داخل مجموعة (جمهور / تكرار). */
const PickButton: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }> = ({ active, onClick, children }) => (
    <button
        type="button" onClick={onClick} aria-pressed={active} className="adm-focusable"
        style={{
            padding: '9px 7px', fontSize: '.76rem', fontWeight: 800, cursor: 'pointer',
            borderRadius: 'var(--adm-r-sm)', textAlign: 'center',
            border: `1px solid ${active ? 'var(--adm-accent)' : 'var(--adm-border)'}`,
            background: active ? 'var(--adm-info-bg)' : 'var(--adm-surface-2)',
            color: active ? 'var(--adm-accent)' : 'var(--adm-fg-2)',
        }}
    >
        {children}
    </button>
);

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
        target_city: initial?.target_city ?? '',
        target_region: initial?.target_region ?? '',
        priority: initial?.priority ?? 0,
        is_active: initial?.is_active ?? true,
        recurrence: initial?.recurrence ?? 'none',
        recurrence_hour: typeof initial?.recurrence_hour === 'number' ? initial.recurrence_hour : 10,
    }));
    const [saving, setSaving] = useState(false);

    useEscClose(true, onClose);

    const set = <K extends keyof CampaignDraft>(k: K, v: CampaignDraft[K]) =>
        setForm((prev) => ({ ...prev, [k]: v }));

    // 🪤 المدينة تتبع المنطقة: مدينةٌ من منطقةٍ أخرى استهدافٌ لا يطابق أحداً.
    //    لكنّ المرشِّح وحده يُخفي المدينة المحفوظة فيعرض المنتقي «كل المدن»
    //    بينما الحالة تحمل مدينةً — فيُحفظ ما لا يراه أحد. لذلك تُضاف المدينة
    //    الحالية للقائمة دائماً، وتُمسح فقط إن كانت **معروفةً** ولا تنتمي
    //    للمنطقة الجديدة (والقيمة القديمة المجهولة تبقى كما هي).
    const cityChoices = useMemo(() => {
        const list = CITIES.filter((c) => !form.target_region || c.regionId === form.target_region);
        const cur = CITIES.find((c) => c.id === form.target_city);
        return cur && !list.includes(cur) ? [cur, ...list] : list;
    }, [form.target_region, form.target_city]);
    const unknownCity = !!form.target_city && !CITIES.some((c) => c.id === form.target_city);
    const unknownRegion = !!form.target_region && !REGIONS.some((r) => r.id === form.target_region);
    const pickRegion = (v: string) => {
        setForm((prev) => {
            const city = CITIES.find((c) => c.id === prev.target_city);
            const keep = !city || !v || city.regionId === v;
            return { ...prev, target_region: v, target_city: keep ? prev.target_city : '' };
        });
    };

    const handleSave = async () => {
        if (!form.title_ar.trim() || !form.body_ar.trim()) {
            await customAlert('⚠️ العنوان والمحتوى (عربي) مطلوبان');
            return;
        }
        if (saving) return;

        // التواريخ تُفحص **قبل** المؤشّر: قيمةٌ معطوبة تعطي خطأً فورياً بلا
        // انتظار (v11.22.1). والفراغ مقبول (البداية = الآن، والنهاية = بلا نهاية).
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
        // كل ما قد يرمي داخل try و`setSaving(false)` في finally، فلا يعلق الزرّ.
        let result: any;
        let broadcastCount = 0;
        try {
            // القاعدة تفرض NOT NULL على `title_en`/`body_en` — تُنسخ العربية
            // عند غيابها كي تُنشر حملةٌ بلغةٍ واحدة بلا احتكاك.
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

            const networkCall = isEdit
                ? supabase.from('promotional_campaigns').update(row).eq('id', initial.id).select().maybeSingle()
                : supabase.from('promotional_campaigns').insert([row]).select().maybeSingle();
            const timeout = new Promise<{ error: any }>(resolve =>
                setTimeout(() => resolve({ error: { message: 'انتهت مهلة الاتصال — تحقق من الإنترنت وحاول مجدداً' } }), 12000)
            );
            result = await Promise.race([networkCall as any, timeout]);
            // حملةٌ جديدة مفعّلة تُبثّ فوراً (v11.22) — بدون ذلك لا تصل أحداً.
            // والتعديل لا يُعيد البثّ عمداً. وللبثّ مهلته كي لا يعلّق الزرّ.
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
        // 🪤 `maybeSingle()` تعيد `data=null` بلا خطأ حين لا يتغيّر أي صفّ —
        // وهي بالضبط صورة الرفض الصامت (صفٌّ محذوف أو سياسةٌ تمنع).
        if (!result?.data) {
            await customAlert('❌ لم تُحفَظ الحملة (صفر صفوف). قد تكون حُذفت، أو لا تسمح صلاحياتك بتعديلها.');
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
        <div
            className="fixed inset-0 z-[3000] flex items-center justify-center p-4 animate-fade-in"
            style={{ background: 'rgba(8, 13, 20, .55)', backdropFilter: 'blur(3px)' }}
        >
            <div role="dialog" aria-modal="true" aria-label="بطاقة الحملة" dir="rtl" style={{ ...modalShell, maxWidth: 680 }}>
                <div style={modalHead}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '.7rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>📢 حملة ترويجية</div>
                        <div style={{ fontSize: '1.05rem', fontWeight: 900, color: 'var(--adm-fg)' }}>
                            {isEdit ? 'تعديل الحملة' : 'حملة جديدة'}
                        </div>
                    </div>
                    <AdmButton size="sm" variant="ghost" onClick={onClose} title="إغلاق (Esc)">✕</AdmButton>
                </div>

                <div style={{ padding: 15, display: 'grid', gap: 14 }}>
                    <div>
                        <span style={labelStyle}>🎯 الجمهور المستهدف</span>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
                            {(['all', 'buyer', 'seller'] as const).map((v) => (
                                <PickButton key={v} active={form.target_audience === v} onClick={() => set('target_audience', v)}>
                                    {AUDIENCE_LABELS[v]}
                                </PickButton>
                            ))}
                        </div>
                    </div>

                    <Field label="العنوان (عربي) *" value={form.title_ar} onChange={(v) => set('title_ar', v)} placeholder="مثال: عيد سعيد — خصومات تصل 70%" />
                    <label style={{ display: 'block' }}>
                        <span style={labelStyle}>المحتوى (عربي) *</span>
                        <textarea
                            rows={3} value={form.body_ar}
                            onChange={(e) => set('body_ar', e.target.value)}
                            placeholder="اكتب نص الحملة الذي سيظهر للمستخدمين..."
                            className="adm-focusable" style={{ ...fieldStyle, lineHeight: 1.8, resize: 'vertical' }}
                        />
                    </label>

                    <details style={{ borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)' }}>
                        <summary style={{ cursor: 'pointer', padding: '8px 11px', fontSize: '.76rem', fontWeight: 800, color: 'var(--adm-fg-2)' }}>
                            🌐 نسخة إنجليزية (اختياري — تُنسخ العربية إن تُركت فارغة)
                        </summary>
                        <div style={{ padding: 11, display: 'grid', gap: 10 }}>
                            <Field label="Title (English)" value={form.title_en} onChange={(v) => set('title_en', v)} dir="ltr" />
                            <label style={{ display: 'block' }}>
                                <span style={labelStyle}>Body (English)</span>
                                <textarea
                                    rows={2} dir="ltr" value={form.body_en}
                                    onChange={(e) => set('body_en', e.target.value)}
                                    className="adm-focusable" style={{ ...fieldStyle, background: 'var(--adm-surface)', lineHeight: 1.8, resize: 'vertical' }}
                                />
                            </label>
                        </div>
                    </details>

                    <div>
                        <span style={labelStyle}>📅 الجدولة (اختياري)</span>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <label style={{ display: 'block' }}>
                                <span style={{ ...labelStyle, fontSize: '.68rem' }}>يبدأ</span>
                                <input
                                    type="datetime-local" value={form.starts_at}
                                    onChange={(e) => set('starts_at', e.target.value)}
                                    className="adm-focusable" style={fieldStyle}
                                />
                            </label>
                            <label style={{ display: 'block' }}>
                                <span style={{ ...labelStyle, fontSize: '.68rem' }}>ينتهي (فارغ = بلا انتهاء)</span>
                                <input
                                    type="datetime-local" value={form.ends_at}
                                    onChange={(e) => set('ends_at', e.target.value)}
                                    className="adm-focusable" style={fieldStyle}
                                />
                            </label>
                        </div>
                    </div>

                    <div>
                        <span style={labelStyle}>🔁 التكرار التلقائي</span>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 8 }}>
                            {RECURRENCE_OPTIONS.map((o) => (
                                <PickButton key={o.v} active={form.recurrence === o.v} onClick={() => set('recurrence', o.v)}>
                                    {o.icon} {o.label}
                                </PickButton>
                            ))}
                        </div>
                        {form.recurrence !== 'none' && (
                            <div
                                style={{
                                    marginTop: 10, display: 'flex', alignItems: 'center', gap: 11, flexWrap: 'wrap',
                                    padding: 11, borderRadius: 'var(--adm-r-sm)',
                                    background: 'var(--adm-info-bg)', color: 'var(--adm-info-fg)',
                                }}
                            >
                                <div style={{ flex: 1, minWidth: 180 }}>
                                    <div style={{ fontSize: '.78rem', fontWeight: 800 }}>⏰ ساعة إعادة الإرسال (بتوقيت الرياض)</div>
                                    <div style={{ fontSize: '.72rem', lineHeight: 1.75, marginTop: 3 }}>
                                        تُعاد الحملة إشعاراً جديداً لكل الجمهور (الموقع + التطبيق + البوتان) حسب التكرار، حتى تاريخ النهاية أو إيقاف الحملة.
                                    </div>
                                </div>
                                <select
                                    value={form.recurrence_hour}
                                    onChange={(e) => set('recurrence_hour', Number(e.target.value))}
                                    className="adm-focusable"
                                    style={{ ...fieldStyle, width: 'auto', background: 'var(--adm-surface)' }}
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

                    <details style={{ borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)' }}>
                        <summary style={{ cursor: 'pointer', padding: '8px 11px', fontSize: '.76rem', fontWeight: 800, color: 'var(--adm-fg-2)' }}>
                            🔗 زر إجراء + صورة (اختياري)
                        </summary>
                        <div style={{ padding: 11, display: 'grid', gap: 10 }}>
                            <Field label="رابط الصورة" value={form.image_url} onChange={(v) => set('image_url', v)} placeholder="https://..." dir="ltr" />
                            <Field label="رابط عند الضغط" value={form.action_url} onChange={(v) => set('action_url', v)} placeholder="/store/abc أو https://..." dir="ltr" />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <Field label="نص الزر (عربي)" value={form.action_label_ar} onChange={(v) => set('action_label_ar', v)} placeholder="تصفح العروض" />
                                <Field label="نص الزر (English)" value={form.action_label_en} onChange={(v) => set('action_label_en', v)} placeholder="Browse" dir="ltr" />
                            </div>
                        </div>
                    </details>

                    {/* 🪤 الاستهداف الجغرافي كان حقلين نصّيين يُطلب فيهما مفتاحٌ
                        إنجليزي مخمَّن؛ وخطأُ حرفٍ = حملةٌ لا تصل أحداً بلا تحذير.
                        القوائم من نفس مصدر بقيّة الموقع، فالمعرّف صحيحٌ دائماً. */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                        <label style={{ display: 'block' }}>
                            <span style={labelStyle}>⚡ الأولوية</span>
                            <input
                                type="number" min={0} value={form.priority}
                                onChange={(e) => set('priority', Number(e.target.value) || 0)}
                                className="adm-focusable" style={fieldStyle} dir="ltr"
                            />
                        </label>
                        <label style={{ display: 'block' }}>
                            <span style={labelStyle}>🗺 المنطقة (اختياري)</span>
                            <select value={form.target_region} onChange={(e) => pickRegion(e.target.value)} className="adm-focusable" style={fieldStyle}>
                                <option value="">كل المناطق</option>
                                {REGIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                                {unknownRegion && <option value={form.target_region}>قيمة محفوظة: {form.target_region}</option>}
                            </select>
                        </label>
                        <label style={{ display: 'block' }}>
                            <span style={labelStyle}>📍 المدينة (اختياري)</span>
                            <select value={form.target_city} onChange={(e) => set('target_city', e.target.value)} className="adm-focusable" style={fieldStyle}>
                                <option value="">كل المدن</option>
                                {cityChoices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                                {unknownCity && <option value={form.target_city}>قيمة محفوظة: {form.target_city}</option>}
                            </select>
                        </label>
                    </div>
                    <span style={{ ...hintStyle, marginTop: -6 }}>
                        بلا اختيار = الحملة تصل الجميع. ومع الاختيار تصل من تدلّ بياناته على تلك المدينة/المنطقة
                        (حجزٌ سابق من متجرٍ فيها، أو أقرب مدينةٍ لموقعه) — فكلّما ضيّقت، قلّ العدد.
                    </span>

                    <div
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                            padding: 12, borderRadius: 'var(--adm-r-sm)',
                            background: form.is_active ? 'var(--adm-ok-bg)' : 'var(--adm-surface-2)',
                            border: '1px solid var(--adm-border)',
                        }}
                    >
                        <div>
                            <div style={{ fontSize: '.85rem', fontWeight: 800, color: form.is_active ? 'var(--adm-ok-fg)' : 'var(--adm-fg)' }}>
                                تفعيل الحملة فوراً
                            </div>
                            <div style={{ fontSize: '.72rem', color: 'var(--adm-fg-2)', marginTop: 2 }}>إن أُلغي، تُحفظ كمسوّدة بلا بثّ.</div>
                        </div>
                        <Sw on={form.is_active} onToggle={() => set('is_active', !form.is_active)} label="تفعيل الحملة فوراً" />
                    </div>
                </div>

                <div style={modalFoot}>
                    <AdmButton onClick={onClose} full>إلغاء</AdmButton>
                    <AdmButton variant="primary" onClick={handleSave} disabled={saving} full>
                        {saving ? 'جاري الحفظ...' : (isEdit ? '💾 حفظ التعديلات' : '🚀 نشر الحملة')}
                    </AdmButton>
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

// ═══════════════════════════════════════════════════════════════════════════
// نشرٌ سريع — حملةٌ في ثلاثة حقول
// ═══════════════════════════════════════════════════════════════════════════

const QuickCampaignBox: React.FC<{ onPosted: () => void; onAdvanced: () => void }> = ({ onPosted, onAdvanced }) => {
    const { customAlert } = useApp();
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [audience, setAudience] = useState<'all' | 'buyer' | 'seller'>('all');
    const [posting, setPosting] = useState(false);

    const handlePost = async () => {
        const t = title.trim();
        const b = body.trim();
        if (!t || !b) { await customAlert('⚠️ اكتب العنوان والمحتوى قبل النشر.'); return; }
        if (posting) return;
        setPosting(true);
        // تُدرَج الحملة ثمّ تُبثّ فوراً عبر `broadcast_campaign`. قبل v11.22 كان
        // النشر السريع يُدرج الصفّ فقط بلا بثّ — فتُنشأ حملةٌ لا تصل **أحداً**.
        let count = 0;
        let failMsg = '';
        try {
            const { data, error } = await supabase
                .from('promotional_campaigns')
                .insert([{
                    title_ar: t, title_en: t,   // نسخة مرآة — يُنقّحها المدير لاحقاً من النافذة الكاملة
                    body_ar: b, body_en: b,
                    target_audience: audience,
                    starts_at: new Date().toISOString(),
                    ends_at: null, priority: 0, is_active: true,
                }])
                .select('id')
                .single();
            if (error) throw error;
            if (!data?.id) throw new Error('لم يُنشأ أي صفّ — قد تمنعك صلاحياتك.');
            const bc = promoRepository.broadcastNow(data.id);
            const bcTimeout = new Promise<number>(resolve => setTimeout(() => resolve(0), 12000));
            count = await Promise.race([bc, bcTimeout]);
        } catch (e: any) {
            failMsg = e?.message || 'فشل النشر — تحقق من الاتصال';
        } finally {
            setPosting(false);
        }
        if (failMsg) { await customAlert('❌ ' + failMsg); return; }
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
        <div
            style={{
                padding: 13, marginBottom: 12, display: 'grid', gap: 9,
                borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '.85rem', fontWeight: 800, color: 'var(--adm-fg)' }}>📝 اكتب حملة بسرعة</span>
                <AdmButton size="sm" variant="ghost" onClick={onAdvanced}>⚙️ خيارات متقدمة (تواريخ · صورة · زرّ إجراء · استهداف)</AdmButton>
            </div>
            <input
                type="text" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="✏️ العنوان..." aria-label="عنوان الحملة السريعة"
                className="adm-focusable" style={{ ...fieldStyle, background: 'var(--adm-surface)', fontWeight: 800 }}
            />
            <textarea
                rows={3} value={body} onChange={(e) => setBody(e.target.value)}
                placeholder="📄 المحتوى الذي سيظهر للمستخدمين..." aria-label="محتوى الحملة السريعة"
                className="adm-focusable" style={{ ...fieldStyle, background: 'var(--adm-surface)', lineHeight: 1.8, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 9, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {(['all', 'buyer', 'seller'] as const).map((v) => (
                        <button
                            key={v} type="button" onClick={() => setAudience(v)} aria-pressed={audience === v}
                            className="adm-focusable"
                            style={{
                                padding: '6px 12px', fontSize: '.76rem', fontWeight: 800, cursor: 'pointer', borderRadius: 999,
                                border: `1px solid ${audience === v ? 'var(--adm-accent)' : 'var(--adm-border)'}`,
                                background: audience === v ? 'var(--adm-info-bg)' : 'var(--adm-surface)',
                                color: audience === v ? 'var(--adm-accent)' : 'var(--adm-fg-2)',
                            }}
                        >
                            {AUDIENCE_LABELS[v]}
                        </button>
                    ))}
                </div>
                <AdmButton
                    variant="primary" onClick={handlePost}
                    disabled={posting || !title.trim() || !body.trim()}
                >
                    {posting ? '... جاري النشر' : '📤 نشر فوراً'}
                </AdmButton>
            </div>
        </div>
    );
};

// ═══════════════════════════════════════════════════════════════════════════
// الشاشة
// ═══════════════════════════════════════════════════════════════════════════

const AdminTools: React.FC = () => {
    // v14.38/v14.89 — الصلاحيتان تُفحصان في **كل** إجراء، وما لا يُسمح به يُخفى.
    // (و`action_manage_seasonal` محروسة في RLS على `pinned_stores` ولا شاشة لها.)
    const { hasPermission: hasPerm, customAlert, customConfirm } = useApp();
    const canCampaigns = hasPerm('action_manage_campaigns');
    const canBanners = hasPerm('action_manage_banners');

    const [paymentEnabled, setPaymentEnabled] = useState(false);
    const [telegramBotEnabled, setTelegramBotEnabled] = useState(true);
    const [whatsappBotEnabled, setWhatsappBotEnabled] = useState(false);
    const [whatsappBotNumber, setWhatsappBotNumber] = useState('');
    const [savingWaNumber, setSavingWaNumber] = useState(false);
    // v12.57 — الهوية الموسمية للعرض فقط: تُشتق في القاعدة من النافذة العامة
    // للحملة (trigger + كرون كل ١٥ دقيقة) — لا تفعيل يدوي منفصل.
    const [seasonTheme, setSeasonTheme] = useState('');
    const [camp, setCamp] = useState({ season_id: '', event_date: '', seller_from: '', seller_to: '', public_from: '', public_to: '', hero_title_ar: '', hero_tagline_ar: '', hero_title_en: '', hero_tagline_en: '' });
    const [campSaved, setCampSaved] = useState(false);
    const [savingCamp, setSavingCamp] = useState(false);
    // تواريخ الفعاليات لتذكير المالك قبل ٣٠ ثم ٧ أيام (كرون يومي)
    const [eventDates, setEventDates] = useState<Record<string, string>>({});
    const [savingDates, setSavingDates] = useState(false);
    const [banners, setBanners] = useState<any[]>([]);
    // v12.71 — مدة عرض كل بانر في الرئيسية (ثوانٍ) — نصٌّ للحقل، يُحفظ رقماً
    const [bannerSeconds, setBannerSeconds] = useState('2');
    const [savingBannerSeconds, setSavingBannerSeconds] = useState(false);
    // v14.12 — مهلة الحجز بالساعات: استلام · توصيل · شبكة أمان الطلب المنطلق.
    const [holdPickup, setHoldPickup] = useState('2');
    const [holdDelivery, setHoldDelivery] = useState('6');
    const [holdSafety, setHoldSafety] = useState('72');
    const [savingHolds, setSavingHolds] = useState(false);
    const [campaigns, setCampaigns] = useState<any[]>([]);
    const [bannerModalOpen, setBannerModalOpen] = useState(false);
    const [bannerEdit, setBannerEdit] = useState<any | null>(null); // null = بانر جديد
    const [campaignModal, setCampaignModal] = useState<{ open: boolean; initial: any | null }>({ open: false, initial: null });
    const [loading, setLoading] = useState(true);
    // 🔴 لا يُرسم مفتاحٌ ولا حقلُ إعدادٍ قبل وصول قيمته، ولا بعد فشل التحميل:
    // القيم الافتراضية تُظهر حالةً غير الحقيقية، وضغطةٌ حينها تقلب من القيمة الخطأ.
    const [loadErr, setLoadErr] = useState('');

    const fetchAll = useCallback(async () => {
        setLoading(true);
        setLoadErr('');
        // 🪤 الجدول `platform_settings` والمفتاح `payment_gateway_enabled`
        // والقيمة jsonb منطقية (لا نصّ) — وكان الكود يسأل جدولاً غير موجود.
        const [paymentRes, botRes, waBotRes, waNumRes, seasonThemeRes, seasonCampRes, eventDatesRes, bannerRes, campaignRes, bannerSecRes, holdsRes] = await Promise.all([
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
            supabase.from('platform_settings').select('value').eq('key', 'booking_holds').maybeSingle(),
        ]);

        const firstErr = [paymentRes, botRes, waBotRes, waNumRes, seasonThemeRes, seasonCampRes, eventDatesRes, bannerRes, campaignRes, bannerSecRes, holdsRes]
            .map((r: any) => r?.error?.message).find(Boolean);

        setPaymentEnabled(paymentRes.data?.value === true);
        // البوت الافتراضي يعمل: مُفعّل ما لم يُطفأ صراحةً (fail-open).
        setTelegramBotEnabled(botRes.data?.value !== false);
        // واتساب الافتراضي مطفأ (نائم حتى التفعيل + رقم).
        setWhatsappBotEnabled(waBotRes.data?.value === true);
        setWhatsappBotNumber(typeof waNumRes.data?.value === 'string' ? waNumRes.data.value : '');
        setSeasonTheme(typeof seasonThemeRes.data?.value === 'string' ? seasonThemeRes.data.value : '');
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
        const bs = Number(bannerSecRes.data?.value);
        setBannerSeconds(Number.isFinite(bs) && bs >= 1 && bs <= 120 ? String(bs) : '2');
        // v14.12 — الافتراضات هنا تطابق `taki_booking_hold_hours` حرفياً كي لا
        // يعرض الحقل رقماً لا يُطبَّق.
        const hv = (holdsRes.data?.value ?? {}) as any;
        const hnum = (x: any, d: number) => {
            const n = typeof x === 'number' ? x : parseFloat(String(x ?? ''));
            return Number.isFinite(n) && n >= 0.25 && n <= 8760 ? String(n) : String(d);
        };
        setHoldPickup(hnum(hv.pickup_hours, 2));
        setHoldDelivery(hnum(hv.delivery_hours, 6));
        setHoldSafety(hnum(hv.in_progress_hours, 72));
        if (firstErr) setLoadErr(firstErr);
        setLoading(false);
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // جسرٌ من لوحة الأوامر (⌘K): نيّةٌ تُقرأ مرّةً ثم تُمسح. وما لا يُسمح به
    // لا يُفتح — النيّة لا تلتفّ على الصلاحية.
    useEffect(() => {
        try {
            const intent = sessionStorage.getItem('taki:admin:quick_action');
            if (!intent) return;
            sessionStorage.removeItem('taki:admin:quick_action');
            if (intent === 'new-banner' && canBanners) {
                setBannerEdit(null);
                setBannerModalOpen(true);
            } else if (intent === 'new-campaign' && canCampaigns) {
                setCampaignModal({ open: true, initial: null });
            }
        } catch { /* sessionStorage محجوب — تجاهل بصمت */ }
    }, [canBanners, canCampaigns]);

    // ── مفاتيح التشغيل ──────────────────────────────────────────────────────

    /**
     * 🔴 كان هذا المفتاح يكتب بـ`update … eq('key')`: صفٌّ غير موجود = صفر
     * صفوف بلا خطأ، فيقول «✅ تم التفعيل» ولا شيء يتغيّر. الآن `writeSetting`
     * (upsert + إثبات بالقراءة)، وأي فشل يُعيد المفتاح لمكانه.
     */
    const togglePayment = async () => {
        const newValue = !paymentEnabled;
        setPaymentEnabled(newValue);
        const err = await writeSetting('payment_gateway_enabled', newValue, 'Enable/disable the SaaS payment gateway platform-wide');
        if (err) { setPaymentEnabled(!newValue); await customAlert('❌ ' + err); return; }
        await customAlert(newValue
            ? '✅ تم تفعيل بوابة الدفع. التجار سيحتاجون اشتراكاً لإضافة عروض.'
            : '✅ تم تعطيل البوابة. التطبيق الآن مجاني بالكامل.');
    };

    // مفتاح إيقافٍ واحد لبوت تيليجرام: البوت يسأل `telegram_bot_enabled`
    // (≤٤٥ ثانية) والموقع يخفي زرّ الربط عبر realtime — كلاهما من هنا.
    const toggleBot = async () => {
        const newValue = !telegramBotEnabled;
        setTelegramBotEnabled(newValue);
        const err = await writeSetting('telegram_bot_enabled', newValue, 'Enable/disable the Telegram bot platform-wide');
        if (err) { setTelegramBotEnabled(!newValue); await customAlert('❌ ' + err); return; }
        await customAlert(newValue
            ? '✅ تم تفعيل بوت تيليجرام — عاد للعمل وظهر زر الربط في الإعدادات (قد يستغرق حتى دقيقة).'
            : '🔌 تم تعطيل بوت تيليجرام — توقّف عن الرد وأُخفي زر الربط (يسري خلال دقيقة). تقدر تعيد تفعيله بأي وقت بنفس الزر.');
    };

    // مرآة تيليجرام لواتساب: خادم واتساب يسأل `wa_bot_is_enabled()` ويتوقّف
    // عن الردّ عند الإطفاء، والموقع يخفي قسم الربط. v11.97
    const toggleWhatsappBot = async () => {
        const newValue = !whatsappBotEnabled;
        setWhatsappBotEnabled(newValue);
        const err = await writeSetting('whatsapp_bot_enabled', newValue, 'Enable/disable the WhatsApp bot platform-wide');
        if (err) { setWhatsappBotEnabled(!newValue); await customAlert('❌ ' + err); return; }
        await customAlert(newValue
            ? '✅ تم تفعيل بوت واتساب — سيعمل ويظهر زر الربط بمجرّد إدخال الرقم أدناه.'
            : '🔌 تم تعطيل بوت واتساب — توقّف عن الرد وأُخفي زر الربط (يسري خلال دقيقة).');
    };

    // رقم واتساب الرسمي — يقود رابط `wa.me`. قسم الربط يبقى مخفياً حتى يكون
    // المفتاح مُفعّلاً **والرقم** مضبوطاً (أرقام فقط). v11.97
    const saveWhatsappNumber = async () => {
        const digits = whatsappBotNumber.replace(/\D/g, '');
        setSavingWaNumber(true);
        const err = await writeSetting('whatsapp_bot_number', digits, 'Public WhatsApp Business number (digits only) for the bot deep link');
        setSavingWaNumber(false);
        if (err) { await customAlert('❌ ' + err); return; }
        setWhatsappBotNumber(digits);
        await customAlert(digits
            ? `✅ تم حفظ رقم واتساب: ${digits}`
            : '✅ تم مسح رقم واتساب — زر الربط سيبقى مخفياً حتى تُدخل رقماً.');
    };

    // ── مهلة الحجز ──────────────────────────────────────────────────────────

    const saveHolds = async () => {
        const num = (t: string) => parseFloat(normalizeArabicNumerals(t));
        const p = num(holdPickup), d = num(holdDelivery), sfy = num(holdSafety);
        if ([p, d, sfy].some(n => !Number.isFinite(n) || n < 0.25 || n > 8760)) {
            await customAlert('⚠️ كل مهلة يجب أن تكون بين ربع ساعة و8760 ساعة (سنة).');
            return;
        }
        // التوصيل أقصر من الاستلام وعدٌ أقلّ لطلبٍ طريقُه أطول — نسأل ولا نمنع.
        if (d < p && !(await customConfirm(`⚠️ مهلة التوصيل (${d}) أقصر من مهلة الاستلام (${p}).\nطلب التوصيل يحتاج تجهيزاً وطريقاً، فالأقصر يُلغي طلبات صحيحة.\n\nهل تريد الحفظ رغم ذلك؟`))) return;
        if (sfy < d && !(await customConfirm(`⚠️ شبكة الأمان (${sfy}) أقصر من مهلة التوصيل (${d}).\nمعناها أن طلباً انطلق مندوبه قد يُلغى قبل انتهاء مهلته الأصلية.\n\nهل تريد الحفظ رغم ذلك؟`))) return;
        setSavingHolds(true);
        const err = await writeSetting('booking_holds',
            { pickup_hours: p, delivery_hours: d, in_progress_hours: sfy },
            'مهلة الحجز بالساعات: الاستلام · التوصيل · شبكة أمان الطلب المنطلق');
        setSavingHolds(false);
        if (err) { await customAlert('❌ ' + err); return; }
        await customAlert(`✅ تم الحفظ — استلام ${p} ساعة · توصيل ${d} ساعة · شبكة أمان ${sfy} ساعة.\nيسري على الطلبات الجديدة فوراً.`);
    };

    // ── الموسم ──────────────────────────────────────────────────────────────

    // نسخةٌ محلّية من اشتقاق القاعدة، لتحديث شارة «النشط الآن» فور الحفظ.
    const localEffectiveTheme = (c: typeof camp): string => {
        if (!c.season_id || !c.public_from || !c.public_to) return '';
        const d = new Date();
        const t = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return t >= c.public_from && t <= c.public_to ? c.season_id : '';
    };

    // v12.48 — حملة الموسم: التواريخ يقررها المالك، والحارس النهائي DB trigger.
    const saveCampaign = async () => {
        if (!canCampaigns) { await customAlert('⛔ ليست لديك صلاحية إدارة الحملات.'); return; }
        if (!camp.season_id) { await customAlert('⚠️ اختر الموسم أولاً'); return; }
        if (!camp.seller_from || !camp.seller_to || !camp.public_from || !camp.public_to) {
            await customAlert('⚠️ أكمل التواريخ الأربعة: نافذة التجار (من/إلى) والنافذة العامة (من/إلى)');
            return;
        }
        if (camp.seller_from > camp.seller_to) { await customAlert('⚠️ نافذة التجار: تاريخ البداية بعد النهاية'); return; }
        if (camp.public_from > camp.public_to) { await customAlert('⚠️ النافذة العامة: تاريخ البداية بعد النهاية'); return; }
        setSavingCamp(true);
        const err = await writeSetting('season_campaign', {
            season_id: camp.season_id,
            event_date: camp.event_date || null,
            seller_from: camp.seller_from,
            seller_to: camp.seller_to,
            public_from: camp.public_from,
            public_to: camp.public_to,
            // v12.69 — نصوص البانر المخصصة (فارغة = نصّ الموسم الافتراضي)
            hero_title_ar: camp.hero_title_ar.trim() || null,
            hero_tagline_ar: camp.hero_tagline_ar.trim() || null,
            hero_title_en: camp.hero_title_en.trim() || null,
            hero_tagline_en: camp.hero_tagline_en.trim() || null,
        }, 'Season campaign windows: seller submissions + public page (v12.48)');
        setSavingCamp(false);
        if (err) { await customAlert('❌ ' + err); return; }
        setCampSaved(true);
        // v12.57 — الهوية تتبع الحملة: القاعدة زامنت `seasonal_theme` فور الحفظ.
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
        if (!canCampaigns) { await customAlert('⛔ ليست لديك صلاحية إدارة الحملات.'); return; }
        const ok = await customConfirm('سيتم إنهاء الحملة نهائياً: تختفي صفحة عروض الموسم من موقع المشترين والبوتات، ويقفل باب إضافة العروض للتجار، وتعود ألوان المنصة وبانر الرئيسية للهوية الأساسية فوراً (العروض الموسومة سابقاً تبقى عروضاً عادية). متابعة؟');
        if (!ok) return;
        setSavingCamp(true);
        // 🪤 v12.52 — `value: null` كان يفشل بصمت (العمود NOT NULL) فتبقى الحملة
        // حيّةً رغم «الإنهاء». `{}` تعني «لا حملة» عند الويب والبوتين معاً.
        const err = await writeSetting('season_campaign', {}, 'Season campaign windows: seller submissions + public page (v12.48)');
        setSavingCamp(false);
        if (err) { await customAlert('❌ ' + err); return; }
        setCampSaved(false);
        setCamp({ season_id: '', event_date: '', seller_from: '', seller_to: '', public_from: '', public_to: '', hero_title_ar: '', hero_tagline_ar: '', hero_title_en: '', hero_tagline_en: '' });
        setSeasonTheme(''); // القاعدة صفّرت الهوية باللحظة نفسها (trigger)
        await customAlert('✅ انتهت الحملة — اختفت صفحة الموسم من الموقع والبوتات، وعادت الألوان والبانر للهوية الأساسية لجميع المستخدمين.');
    };

    // إشعارٌ للتجار وحدهم عبر `admin_broadcast_notification` — يصلهم داخل
    // التطبيق وفي البوتين (outbox v11.70) تلقائياً.
    const notifySellersCampaign = async () => {
        if (!canCampaigns) { await customAlert('⛔ ليست لديك صلاحية إدارة الحملات.'); return; }
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

    // قراءة-تعديل-كتابة تحافظ على سجلّ «أُرسل سابقاً» فلا يتكرّر تذكير الـ٣٠/٧
    // أيام بعد كل حفظ.
    const saveEventDates = async () => {
        if (!canCampaigns) { await customAlert('⛔ ليست لديك صلاحية إدارة الحملات.'); return; }
        setSavingDates(true);
        const { data } = await supabase.from('platform_settings').select('value').eq('key', 'season_event_dates').maybeSingle();
        const notified = (data?.value as any)?.notified ?? [];
        const dates = Object.fromEntries(Object.entries(eventDates).filter(([, v]) => !!v));
        const err = await writeSetting('season_event_dates', { dates, notified }, 'Season event dates for the 30/7-day admin reminders (v12.48)');
        setSavingDates(false);
        if (err) { await customAlert('❌ ' + err); return; }
        await customAlert('✅ حُفظت التواريخ — سيصلك إشعار تلقائي قبل كل فعالية بشهر ثم بأسبوع.');
    };

    // ── البانرات ────────────────────────────────────────────────────────────

    const saveBannerSeconds = async () => {
        if (!canBanners) { await customAlert('⛔ ليست لديك صلاحية إدارة البنرات.'); return; }
        const n = parseFloat(normalizeArabicNumerals(bannerSeconds));
        if (!Number.isFinite(n) || n < 1 || n > 120) { await customAlert('⚠️ أدخل رقماً بين 1 و120 ثانية.'); return; }
        setSavingBannerSeconds(true);
        const err = await writeSetting('banner_autoplay_seconds', n, 'Home banner autoplay interval in seconds (admin-controlled, default 2)');
        setSavingBannerSeconds(false);
        if (err) { await customAlert('❌ ' + err); return; }
        await customAlert(`✅ تم الحفظ — البانر يتنقل الآن كل ${n} ثانية.`);
    };

    const deleteBanner = async (id: string) => {
        if (!canBanners) { await customAlert('⛔ ليست لديك صلاحية إدارة البنرات.'); return; }
        const ok = await customConfirm('هل تريد حذف هذا البانر نهائياً؟');
        if (!ok) return;
        const previous = banners;
        setBanners(prev => prev.filter(b => b.id !== id));
        // 🪤 حذفٌ ترفضه RLS يعود بـ`error=null` وصفر صفوف — فيختفي من الشاشة
        // وهو باقٍ في القاعدة. `.select('id')` هو ما يكشف ذلك.
        const { data, error } = await supabase.from('banners').delete().eq('id', id).select('id');
        if (error || !data || data.length === 0) {
            setBanners(previous);
            await customAlert('❌ ' + (error?.message || 'لم يُحذف البانر (صفر صفوف) — قد تمنعك صلاحياتك.'));
        }
    };

    // الترتيب يُكتب لكل صفٍّ متأثّر بالتوازي، فلا تُعطّل كتابةٌ فاشلة البقية.
    const dragId = useRef<string | null>(null);
    const persistBannerOrder = async (newList: any[]) => {
        if (!canBanners) return;
        const writes = newList.map((b, i) =>
            supabase.from('banners').update({ display_order: i }).eq('id', b.id).select('id')
        );
        const results = await Promise.allSettled(writes);
        const failed = results.filter((r) =>
            r.status === 'rejected'
            || (r.value as any)?.error
            || !((r.value as any)?.data?.length)
        ).length;
        if (failed > 0) await customAlert(`⚠️ تعذّر حفظ ترتيب ${failed} بانر — حدّث الصفحة للتأكد`);
    };
    const onBannerDragStart = (id: string) => { dragId.current = id; };
    const onBannerDrop = (targetId: string) => {
        const sourceId = dragId.current;
        dragId.current = null;
        if (!canBanners || !sourceId || sourceId === targetId) return;
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
        if (!canBanners) return;
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
        if (!canBanners) { await customAlert('⛔ ليست لديك صلاحية إدارة البنرات.'); return; }
        const next = !b.is_active;
        // v12.31 — التفعيل اليدوي يمسح `frozen_reason`: البنر الذي أخفاه انتهاء
        // اشتراك المتجر لا يعود إلا بهذا القرار الصريح.
        const patch: any = next ? { is_active: true, frozen_reason: null } : { is_active: false };
        setBanners(prev => prev.map(x => x.id === b.id ? { ...x, ...patch } : x));
        const { data, error } = await supabase.from('banners').update(patch).eq('id', b.id).select('id');
        if (error || !data || data.length === 0) {
            setBanners(prev => prev.map(x => x.id === b.id ? { ...x, is_active: !next, frozen_reason: b.frozen_reason } : x));
            await customAlert('❌ ' + (error?.message || 'لم يُحفَظ التغيير (صفر صفوف) — قد تمنعك صلاحياتك.'));
        }
    };

    // ── الحملات ─────────────────────────────────────────────────────────────

    /**
     * v14.33 — «تفعيل» كان يقلب عموداً ولا يبثّ شيئاً: لا إشعار ولا دفعة ولا
     * رسالة تيليجرام، والحملة تبدو «مفعّلة» فيُظنّ أنها أُرسلت. والآن يُعرض
     * عدد من ستصلهم **قبل** الإرسال، لأن استهداف المدينة صار يعمل فعلاً.
     */
    const toggleCampaign = async (c: any) => {
        if (!canCampaigns) { await customAlert('⛔ ليست لديك صلاحية إدارة الحملات.'); return; }
        const next = !c.is_active;
        if (next) {
            const { data: aud } = await supabase.rpc('admin_campaign_audience', { p_campaign_id: c.id });
            const a: any = aud || {};
            const scope = [cityLabel(a.targeted_city), regionLabel(a.targeted_region)].filter(Boolean).join(' · ');
            const ok = await customConfirm(
                `📣 تفعيل وبثّ «${c.title_ar}»؟\n\n` +
                `• الجمهور المؤهّل: ${a.eligible ?? '—'}\n` +
                `• داخل الاستهداف${scope ? ` (${scope})` : ''}: ${a.targeted ?? '—'}\n` +
                `• سيصلهم الآن (لم يُشعَروا بها بعد): ${a.will_receive ?? '—'}\n\n` +
                `سيصلهم إشعار في الموقع والتطبيق وتيليجرام وواتساب.`);
            if (!ok) return;
        }
        setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, is_active: next } : x));
        const { data, error } = await supabase.from('promotional_campaigns').update({ is_active: next }).eq('id', c.id).select('id');
        if (error || !data || data.length === 0) {
            setCampaigns(prev => prev.map(x => x.id === c.id ? { ...x, is_active: !next } : x));
            await customAlert('❌ ' + (error?.message || 'لم يُحفَظ التغيير (صفر صفوف) — قد تمنعك صلاحياتك.'));
            return;
        }
        if (!next) return;
        try {
            const sent = await promoRepository.broadcastNow(c.id);
            await customAlert(sent > 0
                ? `✅ فُعّلت وبُثّت إلى ${sent} مستخدماً.`
                : 'ℹ️ فُعّلت. لم يصل أحدٌ جديد — إمّا أن جمهورها أُشعِر بها سابقاً، أو أن استهداف المدينة لا يطابق أحداً.');
        } catch (e: any) {
            await customAlert('⚠️ فُعّلت الحملة لكن تعذّر البثّ: ' + (e?.message || ''));
        }
    };

    const deleteCampaign = async (c: any) => {
        if (!canCampaigns) { await customAlert('⛔ ليست لديك صلاحية إدارة الحملات.'); return; }
        const ok = await customConfirm(`حذف حملة "${c.title_ar}" نهائياً؟`);
        if (!ok) return;
        const previous = campaigns;
        setCampaigns(prev => prev.filter(x => x.id !== c.id));
        const { data, error } = await supabase.from('promotional_campaigns').delete().eq('id', c.id).select('id');
        if (error || !data || data.length === 0) {
            setCampaigns(previous);
            await customAlert('❌ ' + (error?.message || 'لم تُحذف الحملة (صفر صفوف) — قد تمنعك صلاحياتك.'));
        }
    };

    const forceUpdate = async () => {
        const ok = await customConfirm('سيتم تحديث التطبيق لأحدث نسخة وإعادة التحميل. متابعة؟');
        if (ok) await applySwUpdate();
    };

    // ── العرض ───────────────────────────────────────────────────────────────

    const settingsReady = !loading && !loadErr;
    const activeBanners = banners.filter(b => b.is_active).length;
    const activeCampaigns = campaigns.filter(c => c.is_active).length;
    const campSeason = SEASONS.find(s => s.id === camp.season_id);
    const parsedSeason: SeasonCampaign | null = campSaved && camp.season_id ? {
        seasonId: camp.season_id,
        sellerFrom: camp.seller_from || undefined, sellerTo: camp.seller_to || undefined,
        publicFrom: camp.public_from || undefined, publicTo: camp.public_to || undefined,
    } : null;
    const sellerOpen = campaignSellerOpen(parsedSeason);
    const publicLive = campaignPublicLive(parsedSeason);
    const seasonDate = (label: string, key: keyof typeof camp) => (
        <label style={{ display: 'block' }}>
            <span style={labelStyle}>{label}</span>
            <input
                type="date" value={camp[key]}
                onChange={e => setCamp(prev => ({ ...prev, [key]: e.target.value }))}
                className="adm-focusable" style={fieldStyle}
            />
        </label>
    );

    return (
        // العنوان والوصف تطبعهما قشرة اللوحة من `adminNav` — فلا عنوان محلّي هنا.
        <div className="space-y-5 animate-fade-in" dir="rtl">
            {/* مخرج طوارئ: جهازٌ عالقٌ على نسخةٍ قديمة (iOS يثبّت الخدمة العاملة). */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <AdmButton size="sm" onClick={forceUpdate} title="يمسح كل النسخ المخزّنة ويعيد التحميل على أحدث إصدار">
                    🔄 تحديث التطبيق للأحدث
                </AdmButton>
            </div>

            {loadErr && <AdmError message={`تعذّر تحميل الإعدادات: ${loadErr}`} onRetry={fetchAll} />}

            {/* ═══ ١ — البانرات (الأكثر استعمالاً) ═══ */}
            <AdmSection
                title="البانرات الإعلانية"
                icon="🖼️"
                desc="الصور التي تتنقّل أعلى الصفحة الرئيسية. الترتيب هنا هو ترتيب ظهورها عند الزائر."
                badge={loading ? undefined : { text: `${activeBanners} نشط من ${banners.length}`, tone: activeBanners ? 'ok' : 'neutral' }}
                action={canBanners && (
                    <AdmButton variant="primary" size="sm" onClick={() => { setBannerEdit(null); setBannerModalOpen(true); }}>
                        ➕ بانر جديد
                    </AdmButton>
                )}
            >
                {!canBanners && (
                    <div style={{ marginBottom: 12 }}>
                        <AdmPill tone="info">للعرض فقط — لا تملك صلاحية «البنرات الإعلانية»</AdmPill>
                    </div>
                )}

                {/* مدّة التنقّل — إعدادُ بانرٍ، فيتبع صلاحية البنرات */}
                {canBanners && (loading
                    ? <div style={{ marginBottom: 12 }}><AdmSkeleton rows={1} height={64} /></div>
                    : settingsReady && (
                        <div
                            style={{
                                display: 'flex', alignItems: 'flex-end', gap: 11, flexWrap: 'wrap', marginBottom: 12,
                                padding: 12, borderRadius: 'var(--adm-r-sm)',
                                border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)',
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 190 }}>
                                <div style={{ fontSize: '.85rem', fontWeight: 800, color: 'var(--adm-fg)' }}>⏱ مدّة عرض كل بانر</div>
                                <div style={{ fontSize: '.74rem', lineHeight: 1.75, color: 'var(--adm-fg-2)', marginTop: 3 }}>
                                    كل كم ثانية ينتقل البانر للتالي في الرئيسية. يسري على كل الزوار فور الحفظ.
                                </div>
                            </div>
                            <label style={{ display: 'block' }}>
                                <span style={labelStyle}>بالثواني</span>
                                <input
                                    type="number" min={1} max={120} step={0.5} inputMode="decimal" dir="ltr"
                                    value={bannerSeconds}
                                    onChange={(e) => setBannerSeconds(e.target.value)}
                                    className="adm-focusable"
                                    style={{ ...fieldStyle, width: 92, textAlign: 'center', fontWeight: 800, background: 'var(--adm-surface)' }}
                                />
                            </label>
                            <AdmButton onClick={saveBannerSeconds} disabled={savingBannerSeconds}>
                                {savingBannerSeconds ? 'جاري الحفظ...' : '💾 حفظ'}
                            </AdmButton>
                        </div>
                    )
                )}

                {loading ? (
                    <AdmSkeleton rows={2} height={120} />
                ) : banners.length === 0 ? (
                    <AdmEmpty
                        icon="🖼️"
                        title="لا توجد بانرات بعد"
                        hint="البانر صورةٌ أعلى الرئيسية تفتح متجراً أو عرضاً عند الضغط. أضف الأول لتجرّبه."
                        action={canBanners
                            ? <AdmButton variant="primary" size="sm" onClick={() => { setBannerEdit(null); setBannerModalOpen(true); }}>➕ بانر جديد</AdmButton>
                            : undefined}
                    />
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
                        {banners.map((b, i) => (
                            <div
                                key={b.id}
                                draggable={canBanners}
                                onDragStart={() => onBannerDragStart(b.id)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={() => onBannerDrop(b.id)}
                                style={{
                                    borderRadius: 'var(--adm-r-sm)', overflow: 'hidden',
                                    border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)',
                                    cursor: canBanners ? 'move' : 'default',
                                }}
                            >
                                <div style={{ position: 'relative', height: 122, background: 'var(--adm-surface-3)' }}>
                                    {b.image_url && (
                                        <img
                                            src={b.image_url} alt=""
                                            style={{ width: '100%', height: '100%', objectFit: 'cover', pointerEvents: 'none' }}
                                            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
                                        />
                                    )}
                                    <div style={{ position: 'absolute', top: 7, insetInlineEnd: 7, display: 'flex', gap: 5, alignItems: 'center' }}>
                                        <span
                                            style={{
                                                fontSize: '.66rem', fontWeight: 800, padding: '2px 7px', borderRadius: 999,
                                                background: 'rgba(8,13,20,.62)', color: '#ffffff', fontVariantNumeric: 'tabular-nums',
                                            }}
                                        >
                                            #{i + 1}
                                        </span>
                                        <AdmPill tone={b.is_active ? 'ok' : 'bad'}>{b.is_active ? 'نشط' : 'متوقف'}</AdmPill>
                                    </div>
                                    {canBanners && (
                                        <Tooltip text="اسحب لإعادة الترتيب">
                                            <span
                                                style={{
                                                    position: 'absolute', top: 7, insetInlineStart: 7, cursor: 'grab',
                                                    fontSize: '.8rem', fontWeight: 800, padding: '2px 7px', borderRadius: 'var(--adm-r-sm)',
                                                    background: 'rgba(8,13,20,.62)', color: '#ffffff',
                                                }}
                                            >
                                                ⋮⋮
                                            </span>
                                        </Tooltip>
                                    )}
                                </div>
                                <div style={{ padding: 12 }}>
                                    <div style={{ fontSize: '.86rem', fontWeight: 800, color: 'var(--adm-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {b.title_ar || 'بدون عنوان'}
                                    </div>
                                    <div style={{ fontSize: '.73rem', color: 'var(--adm-fg-2)', marginTop: 3 }}>
                                        📍 {positionLabel(b.position)}
                                    </div>
                                    {/* v12.31 — بنر أخفاه انتهاء اشتراك المتجر: لا يعود إلا بقرارٍ صريح */}
                                    {!b.is_active && b.frozen_reason === 'subscription_expired' && (
                                        <div
                                            style={{
                                                marginTop: 8, padding: '7px 9px', borderRadius: 'var(--adm-r-sm)',
                                                fontSize: '.72rem', fontWeight: 700, lineHeight: 1.75,
                                                background: 'var(--adm-warn-bg)', color: 'var(--adm-warn-fg)',
                                            }}
                                        >
                                            ⏸ أُخفي تلقائياً — انتهى اشتراك المتجر المرتبط به. لن يعود إلا إذا فعّلته أنت بعد تجديد اشتراكه.
                                        </div>
                                    )}
                                    {canBanners && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 11, flexWrap: 'wrap' }}>
                                            {/* الحالة مكتوبةٌ مرّةً واحدة — في الشارة فوق الصورة. */}
                                            <Sw on={b.is_active} onToggle={() => toggleBanner(b)} label={b.is_active ? 'إيقاف البانر' : 'تفعيل البانر'} />
                                            <span style={{ flex: 1 }} />
                                            <Tooltip text="انقل للأعلى">
                                                <AdmButton size="sm" onClick={() => moveBanner(b.id, -1)} disabled={i === 0}>↑</AdmButton>
                                            </Tooltip>
                                            <Tooltip text="انقل للأسفل">
                                                <AdmButton size="sm" onClick={() => moveBanner(b.id, 1)} disabled={i === banners.length - 1}>↓</AdmButton>
                                            </Tooltip>
                                            <Tooltip text="تعديل البانر">
                                                <AdmButton size="sm" onClick={() => { setBannerEdit(b); setBannerModalOpen(true); }}>✏️</AdmButton>
                                            </Tooltip>
                                            <Tooltip text="حذف نهائي">
                                                <AdmButton size="sm" variant="danger" onClick={() => deleteBanner(b.id)}>🗑</AdmButton>
                                            </Tooltip>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </AdmSection>

            {/* ═══ ٢ — الحملات ═══ */}
            <AdmSection
                title="الحملات الترويجية"
                icon="📢"
                desc="إشعارٌ يصل المستخدمين في الموقع والتطبيق وتيليجرام وواتساب. آخر ٢٠ حملة."
                badge={loading ? undefined : { text: `${activeCampaigns} فعّالة من ${campaigns.length}`, tone: activeCampaigns ? 'ok' : 'neutral' }}
            >
                {!canCampaigns && (
                    <div style={{ marginBottom: 12 }}>
                        <AdmPill tone="info">للعرض فقط — لا تملك صلاحية «الحملات الترويجية»</AdmPill>
                    </div>
                )}

                {canCampaigns && (
                    <QuickCampaignBox
                        onPosted={fetchAll}
                        onAdvanced={() => setCampaignModal({ open: true, initial: null })}
                    />
                )}

                {loading ? (
                    <AdmSkeleton rows={3} height={74} />
                ) : campaigns.length === 0 ? (
                    <AdmEmpty
                        icon="📢"
                        title="لا توجد حملات بعد"
                        hint={canCampaigns
                            ? 'اكتب حملتك الأولى في المربّع أعلاه واضغط «نشر فوراً».'
                            : 'لا تملك صلاحية إنشاء الحملات.'}
                    />
                ) : (
                    <div style={{ display: 'grid', gap: 9 }}>
                        {campaigns.map((c) => {
                            const ends = c.ends_at ? new Date(c.ends_at) : null;
                            const ended = !!ends && ends.getTime() < Date.now();
                            return (
                                <div
                                    key={c.id}
                                    style={{
                                        display: 'flex', alignItems: 'flex-start', gap: 11, padding: 12,
                                        borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
                                        background: 'var(--adm-surface-2)', opacity: ended ? .72 : 1,
                                    }}
                                >
                                    <span style={{ fontSize: '1.2rem', flexShrink: 0 }} aria-hidden="true">{c.image_url ? '🖼️' : '📢'}</span>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '.86rem', fontWeight: 800, color: 'var(--adm-fg)' }}>{c.title_ar}</span>
                                            <AdmPill tone={ended ? 'bad' : c.is_active ? 'ok' : 'neutral'}>
                                                {ended ? 'منتهية' : c.is_active ? 'فعّالة' : 'مسوّدة'}
                                            </AdmPill>
                                        </div>
                                        <div
                                            style={{
                                                fontSize: '.76rem', lineHeight: 1.75, color: 'var(--adm-fg-2)', marginTop: 3,
                                                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                                            }}
                                        >
                                            {c.body_ar}
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px', fontSize: '.7rem', color: 'var(--adm-fg-3)', fontWeight: 700, marginTop: 6 }}>
                                            <span>{AUDIENCE_LABELS[c.target_audience] ?? c.target_audience}</span>
                                            <span>أولوية {c.priority ?? 0}</span>
                                            {c.target_region && <span>🗺 {regionLabel(c.target_region)}</span>}
                                            {c.target_city && <span>📍 {cityLabel(c.target_city)}</span>}
                                            {c.recurrence && c.recurrence !== 'none' && (
                                                <span>🔁 {RECURRENCE_LABELS[c.recurrence] ?? c.recurrence}</span>
                                            )}
                                            {ends && !ended && <span>حتى {ends.toLocaleDateString('ar-SA-u-ca-gregory')}</span>}
                                        </div>
                                    </div>
                                    {canCampaigns && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
                                            <Sw on={c.is_active} onToggle={() => toggleCampaign(c)} label={c.is_active ? 'إيقاف الحملة' : 'تفعيل الحملة وبثّها'} />
                                            <Tooltip text="تعديل الحملة">
                                                <AdmButton size="sm" onClick={() => setCampaignModal({ open: true, initial: c })}>✏️</AdmButton>
                                            </Tooltip>
                                            <Tooltip text="حذف نهائي">
                                                <AdmButton size="sm" variant="danger" onClick={() => deleteCampaign(c)}>🗑</AdmButton>
                                            </Tooltip>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </AdmSection>

            {/* ═══ ٣ — مفاتيح التشغيل ═══ */}
            <AdmSection
                title="مفاتيح التشغيل"
                icon="⚙️"
                desc="ثلاثة مفاتيح تسري على المنصّة كلها خلال دقيقة، بلا نشرٍ جديد."
            >
                {loading ? <AdmSkeleton rows={3} height={68} /> : !settingsReady ? (
                    <AdmError message="لم تصل قيم المفاتيح — لا تُعرض حتى لا تُقلب من قيمةٍ خاطئة." onRetry={fetchAll} />
                ) : (
                    <div style={{ display: 'grid', gap: 10 }}>
                        <SettingRow
                            icon="💳"
                            title="بوابة الدفع (SaaS)"
                            desc={paymentEnabled ? 'مُفعّلة — التجار يجب أن يشتركوا لإضافة عروض.' : 'مُعطّلة — التطبيق مجاني بالكامل.'}
                            note={
                                <div style={{ fontSize: '.71rem', fontWeight: 700, color: 'var(--adm-fg-3)', marginTop: 5, lineHeight: 1.7 }}>
                                    ℹ️ هذه الشاشة هي <b>المكان الوحيد</b> لضبط بوابة الدفع — لا يوجد مفتاحٌ ثانٍ لها في شاشة التجّار ولا في أي شاشةٍ أخرى.
                                </div>
                            }
                            right={<Sw on={paymentEnabled} onToggle={togglePayment} label="بوابة الدفع" />}
                        />
                        <SettingRow
                            icon="🤖"
                            title="بوت تيليجرام"
                            desc={telegramBotEnabled ? 'مُفعّل — يردّ على المستخدمين وزرّ الربط ظاهر في الإعدادات.' : 'مُعطّل — توقّف عن الردّ وزرّ الربط مخفي.'}
                            right={<Sw on={telegramBotEnabled} onToggle={toggleBot} label="بوت تيليجرام" />}
                        />
                        <SettingRow
                            icon="💬"
                            title="بوت واتساب"
                            desc={whatsappBotEnabled ? 'مُفعّل — يعمل وزرّ الربط يظهر بمجرّد إدخال الرقم أدناه.' : 'مُعطّل — توقّف عن الردّ وزرّ الربط مخفي.'}
                            right={<Sw on={whatsappBotEnabled} onToggle={toggleWhatsappBot} label="بوت واتساب" />}
                        />
                        {whatsappBotEnabled && (
                            <div style={{ padding: 13, borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)' }}>
                                <span style={labelStyle}>📱 رقم واتساب الرسمي للبوت</span>
                                <div style={{ fontSize: '.73rem', color: 'var(--adm-fg-2)', lineHeight: 1.75, marginBottom: 8 }}>
                                    أرقام فقط مع رمز الدولة (مثال: 9665XXXXXXXX). زرّ الربط لا يظهر في الإعدادات حتى تُدخل رقماً صحيحاً.
                                </div>
                                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                    <input
                                        type="tel" dir="ltr" value={whatsappBotNumber}
                                        onChange={e => setWhatsappBotNumber(e.target.value.replace(/\D/g, ''))}
                                        placeholder="9665XXXXXXXX" aria-label="رقم واتساب الرسمي"
                                        className="adm-focusable"
                                        style={{ ...fieldStyle, flex: '1 1 190px', width: 'auto', background: 'var(--adm-surface)', fontWeight: 800 }}
                                    />
                                    <AdmButton variant="primary" onClick={saveWhatsappNumber} disabled={savingWaNumber}>
                                        {savingWaNumber ? '⏳ جاري الحفظ...' : '💾 حفظ الرقم'}
                                    </AdmButton>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </AdmSection>

            {/* ═══ ٤ — مهلة الحجز ═══ */}
            <AdmSection
                title="مهلة الحجز"
                icon="⏳"
                desc="كم يبقى الطلب محجوزاً قبل أن يُلغى تلقائياً وتعود الكمّية للبيع. الرقم الوحيد في المنصّة: تقرؤه القاعدة والموقع والبوتان والصفحات القانونية معاً."
                collapsible
                defaultOpen={false}
            >
                {loading ? <AdmSkeleton rows={3} height={92} /> : !settingsReady ? (
                    <AdmError message="لم تصل المهل الحالية — لا تُعرض الحقول حتى لا تُحفظ أرقامٌ افتراضية فوق الحقيقية." onRetry={fetchAll} />
                ) : (
                    <>
                        <p style={{ fontSize: '.78rem', lineHeight: 1.85, color: 'var(--adm-fg-2)', margin: '0 0 12px' }}>
                            يسري فوراً على الطلبات الجديدة، ويتغيّر معه نصّ ورقة الحجز وصفحات الشروط والاسترداد والأسئلة الشائعة والبوتان في اللحظة نفسها.
                            <br />
                            <strong style={{ color: 'var(--adm-fg)' }}>ولا يمسّ الطلبات القائمة</strong> — كل طلبٍ يحتفظ بالمهلة التي وُعد بها وقت حجزه.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
                            {([
                                { key: 'pickup',   icon: '🏪', label: 'استلام من المتجر', value: holdPickup,   set: setHoldPickup,   hint: 'المشتري يذهب للمتجر — المخزون محبوس طوال المهلة، فالإطالة تعني بيعاً أقلّ.' },
                                { key: 'delivery', icon: '🚚', label: 'توصيل إلى العنوان', value: holdDelivery, set: setHoldDelivery, hint: 'التجهيز والطريق. تتوقّف المهلة بمجرّد انطلاق المندوب.' },
                                { key: 'safety',   icon: '🛟', label: 'شبكة أمان الطلب المنطلق', value: holdSafety, set: setHoldSafety, hint: 'حدٌّ أقصى لطلبٍ انطلق مندوبه ولم يُغلقه التاجر — كي لا يُحبس المخزون للأبد.' },
                            ] as const).map(f => (
                                <div key={f.key} style={{ padding: 12, borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)' }}>
                                    <div style={{ fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)', marginBottom: 7 }}>{f.icon} {f.label}</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <input
                                            type="number" min={0.25} max={8760} step={0.25} inputMode="decimal" dir="ltr"
                                            value={f.value}
                                            onChange={(e) => f.set(normalizeArabicNumerals(e.target.value))}
                                            aria-label={f.label}
                                            className="adm-focusable"
                                            style={{ ...fieldStyle, width: 92, textAlign: 'center', fontWeight: 800, background: 'var(--adm-surface)' }}
                                        />
                                        <span style={{ fontSize: '.76rem', fontWeight: 800, color: 'var(--adm-fg-2)' }}>ساعة</span>
                                    </div>
                                    <div style={{ fontSize: '.7rem', lineHeight: 1.8, color: 'var(--adm-fg-3)', marginTop: 8 }}>{f.hint}</div>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                            <AdmButton variant="primary" onClick={saveHolds} disabled={savingHolds}>
                                {savingHolds ? 'جاري الحفظ...' : '💾 حفظ المهل'}
                            </AdmButton>
                        </div>
                    </>
                )}
            </AdmSection>

            {/* ═══ ٥ — الموسم (هوية + حملة موحّدة) ═══
                v12.57 — لا تفعيل يدوي: القاعدة تشتقّ `seasonal_theme` من النافذة
                العامة (trigger + كرون ١٥ دقيقة)، فتتبعه الألوان والبانر وصفحة
                العروض والقائمة الجانبية وخانة التاجر والبوتان. */}
            {canCampaigns && (
                <AdmSection
                    title="الموسم — هوية وحملة موحّدة"
                    icon="🎨"
                    desc="اختر الموسم ثمّ حدّد نافذتي التجار والجمهور. كل شيء يشتغل وينطفئ بالتواريخ وحدها."
                    badge={loading ? undefined : seasonTheme
                        ? { text: `نشط: ${SEASONS.find(s => s.id === seasonTheme)?.ar ?? seasonTheme}`, tone: 'ok' }
                        : { text: 'الهوية الأساسية', tone: 'neutral' }}
                    collapsible
                    defaultOpen={false}
                >
                    {loading ? <AdmSkeleton rows={3} height={96} /> : !settingsReady ? (
                        <AdmError message="لم تصل بيانات الحملة الموسمية — لا تُعرض حتى لا تُحفَظ فوق الحقيقية." onRetry={fetchAll} />
                    ) : (
                        <>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
                                {SEASONS.map(s => {
                                    const selected = camp.season_id === s.id;
                                    const liveNow = seasonTheme === s.id;
                                    return (
                                        <button
                                            key={s.id} type="button"
                                            onClick={() => setCamp(prev => ({ ...prev, season_id: s.id }))}
                                            aria-pressed={selected}
                                            className="adm-focusable"
                                            style={{
                                                textAlign: 'right', borderRadius: 'var(--adm-r-sm)', overflow: 'hidden', cursor: 'pointer',
                                                border: `1px solid ${selected ? 'var(--adm-accent)' : 'var(--adm-border)'}`,
                                                background: 'var(--adm-surface-2)', padding: 0,
                                            }}
                                        >
                                            <div style={{ position: 'relative', height: 54, background: s.swatch }}>
                                                <span style={{ position: 'absolute', bottom: 6, insetInlineEnd: 9, fontSize: '1.3rem', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.4))' }}>{s.emoji}</span>
                                                {(liveNow || (selected && campSaved)) && (
                                                    <span style={{ position: 'absolute', top: 6, insetInlineStart: 6 }}>
                                                        <AdmPill tone={liveNow ? 'ok' : 'warn'}>{liveNow ? 'نشط الآن' : 'مجدول'}</AdmPill>
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ padding: 10 }}>
                                                <div style={{ fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)' }}>{s.ar}</div>
                                                <div style={{ fontSize: '.71rem', color: 'var(--adm-fg-2)', marginTop: 2, lineHeight: 1.7 }}>{s.hintAr}</div>
                                                <div style={{ fontSize: '.71rem', fontWeight: 800, marginTop: 7, color: selected ? 'var(--adm-accent)' : 'var(--adm-fg-3)' }}>
                                                    {selected ? '✓ موسم الحملة — حدّد التواريخ بالأسفل' : 'اختر لهذه الحملة'}
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>

                            <div style={{ marginTop: 14, padding: 13, borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '.88rem', fontWeight: 800, color: 'var(--adm-fg)' }}>📅 تواريخ الحملة — التحكّم الوحيد بالتفعيل</span>
                                    {campSaved && (
                                        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                            <AdmPill tone={sellerOpen ? 'ok' : 'neutral'}>🏪 باب التجار: {sellerOpen ? 'مفتوح' : 'مغلق'}</AdmPill>
                                            <AdmPill tone={publicLive ? 'ok' : 'neutral'}>👥 الصفحة والهوية والبوتات: {publicLive ? 'شغّالة' : 'مطفأة'}</AdmPill>
                                        </span>
                                    )}
                                </div>
                                <p style={{ fontSize: '.76rem', lineHeight: 1.85, color: 'var(--adm-fg-2)', margin: '7px 0 12px' }}>
                                    <b>نافذة التجار:</b> فيها وحدها تظهر للتاجر خانة «شارك في عروض الموسم». <b>النافذة العامة:</b> فيها وحدها تظهر صفحة العروض للمتسوّقين (القائمة الجانبية + زرّ الموسم في البوتين) <b>وتشتغل هوية الألوان والبانر تلقائياً</b> — وتنطفئ كلها بانتهائها بلا أي تدخّل.
                                </p>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
                                    <div>
                                        <span style={labelStyle}>الموسم (من البطاقات أعلاه)</span>
                                        <div
                                            style={{
                                                ...fieldStyle, fontWeight: 800,
                                                color: campSeason ? 'var(--adm-accent)' : 'var(--adm-fg-3)',
                                                borderColor: campSeason ? 'var(--adm-accent)' : 'var(--adm-border)',
                                            }}
                                        >
                                            {campSeason ? `${campSeason.emoji} ${campSeason.ar}` : '⬆️ اضغط بطاقة موسم أولاً'}
                                        </div>
                                    </div>
                                    {seasonDate('🗓 تاريخ الفعالية (اختياري)', 'event_date')}
                                    {seasonDate('🏪 التجار — من', 'seller_from')}
                                    {seasonDate('🏪 التجار — إلى', 'seller_to')}
                                    {seasonDate('👥 الصفحة العامة — من', 'public_from')}
                                    {seasonDate('👥 الصفحة العامة — إلى', 'public_to')}
                                </div>

                                {/* v12.57 — تنبيه التعارض: نافذةٌ عامة لا تشمل تاريخ الفعالية المسجّل. */}
                                {campSeason && eventDates[camp.season_id] && camp.public_from && camp.public_to
                                    && (eventDates[camp.season_id] < camp.public_from || eventDates[camp.season_id] > camp.public_to) && (
                                    <div
                                        style={{
                                            marginTop: 10, padding: '9px 11px', borderRadius: 'var(--adm-r-sm)',
                                            fontSize: '.74rem', fontWeight: 700, lineHeight: 1.8,
                                            background: 'var(--adm-warn-bg)', color: 'var(--adm-warn-fg)',
                                        }}
                                    >
                                        💡 تاريخ فعالية «{campSeason.ar}» المسجّل عندك للتذكير هو <b>{eventDates[camp.season_id]}</b>، لكن نافذتك العامة ({camp.public_from} → {camp.public_to}) لا تشمله — إن لم يكن هذا مقصوداً فعدّل التواريخ قبل الحفظ.
                                    </div>
                                )}

                                {/* v12.69 — نصّ بانر الموسم بيد المالك: الفراغ = الافتراضي. */}
                                {campSeason && (
                                    <div style={{ marginTop: 12, padding: 12, borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)', background: 'var(--adm-surface)' }}>
                                        <div style={{ fontSize: '.82rem', fontWeight: 800, color: 'var(--adm-fg)' }}>✍️ نصّ بانر الموسم</div>
                                        <p style={{ fontSize: '.73rem', lineHeight: 1.8, color: 'var(--adm-fg-2)', margin: '5px 0 10px' }}>
                                            يظهر للمتسوّقين في بانر الرئيسية وصفحة العروض الموسمية والقائمة الجانبية. اتركه فارغاً ليُستخدم النصّ الافتراضي (الظاهر باهتاً داخل الحقل)، ويسري تعديلك فور «💾 حفظ الحملة».
                                        </p>
                                        <label style={{ display: 'block', marginBottom: 9 }}>
                                            <span style={labelStyle}>العنوان الكبير</span>
                                            <input
                                                type="text" value={camp.hero_title_ar}
                                                onChange={e => setCamp(prev => ({ ...prev, hero_title_ar: e.target.value }))}
                                                placeholder={`عروض ${campSeason.ar} الحصرية`}
                                                className="adm-focusable" style={{ ...fieldStyle, fontWeight: 800 }}
                                            />
                                        </label>
                                        <label style={{ display: 'block' }}>
                                            <span style={labelStyle}>السطر التسويقي (تحت العنوان)</span>
                                            <textarea
                                                rows={2} value={camp.hero_tagline_ar}
                                                onChange={e => setCamp(prev => ({ ...prev, hero_tagline_ar: e.target.value }))}
                                                placeholder={campSeason.taglineAr}
                                                className="adm-focusable" style={{ ...fieldStyle, lineHeight: 1.8, resize: 'vertical' }}
                                            />
                                        </label>
                                        <details style={{ marginTop: 9, borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)' }}>
                                            <summary style={{ cursor: 'pointer', padding: '8px 11px', fontSize: '.74rem', fontWeight: 800, color: 'var(--adm-fg-2)' }}>
                                                🌐 النسخة الإنجليزية (لمستخدمي English)
                                            </summary>
                                            <div style={{ padding: 11, display: 'grid', gap: 9 }}>
                                                <input
                                                    type="text" dir="ltr" value={camp.hero_title_en}
                                                    onChange={e => setCamp(prev => ({ ...prev, hero_title_en: e.target.value }))}
                                                    placeholder={`Exclusive ${campSeason.en} Deals`}
                                                    aria-label="Season hero title (English)"
                                                    className="adm-focusable" style={fieldStyle}
                                                />
                                                <textarea
                                                    rows={2} dir="ltr" value={camp.hero_tagline_en}
                                                    onChange={e => setCamp(prev => ({ ...prev, hero_tagline_en: e.target.value }))}
                                                    placeholder={campSeason.taglineEn}
                                                    aria-label="Season hero tagline (English)"
                                                    className="adm-focusable" style={{ ...fieldStyle, lineHeight: 1.8, resize: 'vertical' }}
                                                />
                                            </div>
                                        </details>
                                    </div>
                                )}

                                <div style={{ display: 'flex', gap: 9, marginTop: 12, flexWrap: 'wrap' }}>
                                    <AdmButton variant="primary" onClick={saveCampaign} disabled={savingCamp}>
                                        {savingCamp ? '⏳ جاري الحفظ...' : '💾 حفظ الحملة'}
                                    </AdmButton>
                                    {campSaved && campSeason && (
                                        <AdmButton onClick={notifySellersCampaign} disabled={savingCamp}>📣 إشعار التجار الآن</AdmButton>
                                    )}
                                    {campSaved && (
                                        <AdmButton variant="danger" onClick={clearCampaign} disabled={savingCamp}>🗑 إنهاء الحملة</AdmButton>
                                    )}
                                </div>

                                {/* تذكير المالك قبل ٣٠ ثمّ ٧ أيام من كل فعالية (كرون يومي) */}
                                <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--adm-border)' }}>
                                    <div style={{ fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)' }}>⏰ تواريخ الفعاليات — للتذكير التلقائي</div>
                                    <p style={{ fontSize: '.73rem', lineHeight: 1.8, color: 'var(--adm-fg-2)', margin: '5px 0 10px' }}>
                                        سيصلك إشعار قبل كل فعالية <b>بشهر</b> ثمّ <b>بأسبوع</b> حتى تجهّز الحملة. حدّث التواريخ متى شئت (رمضان والعيد يتقدّمان كل سنة).
                                    </p>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
                                        {SEASONS.map(s => (
                                            <label key={s.id} style={{ display: 'block' }}>
                                                <span style={labelStyle}>{s.emoji} {s.ar}</span>
                                                <input
                                                    type="date" value={eventDates[s.id] || ''}
                                                    onChange={e => setEventDates(prev => ({ ...prev, [s.id]: e.target.value }))}
                                                    className="adm-focusable" style={fieldStyle}
                                                />
                                            </label>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 11 }}>
                                        <AdmButton onClick={saveEventDates} disabled={savingDates}>
                                            {savingDates ? '⏳ جاري الحفظ...' : '💾 حفظ تواريخ التذكير'}
                                        </AdmButton>
                                    </div>
                                </div>
                            </div>
                        </>
                    )}
                </AdmSection>
            )}

            {/* ═══ ٦ — الصيانة (أداة الصور) ═══ */}
            <AdmSection
                title="الصيانة"
                icon="🧰"
                desc="أدواتٌ تُشغَّل مرّةً عند الحاجة — لا شأن لها بالعمل اليومي."
                collapsible
                defaultOpen={false}
            >
                {/* v13.34 — ضغط الصور القديمة بضغطة واحدة (بلاغ: الموقع يعلق عند الدخول) */}
                <ImageOptimizer />
            </AdmSection>

            {bannerModalOpen && canBanners && (
                <BannerModal
                    initial={bannerEdit}
                    onClose={() => { setBannerModalOpen(false); setBannerEdit(null); }}
                    onSaved={fetchAll}
                />
            )}
            {campaignModal.open && canCampaigns && (
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
