import React, { useState, useRef, useMemo, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import { useApp } from '../../context/AppContext';
import { useEscClose } from '../../hooks/useEscClose';
import { useBackClose } from '../../hooks/useBackClose';
import { storageService, uploadFailureMessage } from '../../services/storageService';
import BannerImageEditor from '../BannerImageEditor';
import { BANNER } from '../../utils/imageCompression';
import { fieldStyle, labelStyle, hintStyle, Field, modalShell, modalHead, modalFoot } from './modalKit';
import { AdmCard, AdmButton } from './ui';
import BannerSchedule from './BannerSchedule';

/**
 * BannerModal — إنشاءُ البانر الإعلاني وتعديلُه (v16.46)
 * =======================================================================
 * خرج من `AdminTools.tsx` لنفس السبب الذي أخرج `CampaignModal` قبله (v15.51):
 * ذاك ملفٌّ مُعلَنٌ ضخماً بلغ سقفَ السقّافة بالضبط، واحتاجت **جدولةُ ظهور
 * البانر** (أمرُ ناصر ٢٠ نوفمبر) بضعةَ أسطرٍ فيه. وقاعدةُ المشروع:
 * **قلّص، لا ترفع السقف** — والنافذةُ وحدةٌ قائمةٌ بذاتها تُستعمل مرّةً واحدة.
 */
/** مكان البانر — تُعرض التسمية العربية في كل موضع، لا المفتاح الخام. */
export const BANNER_POSITIONS: { v: string; label: string }[] = [
    { v: 'home_top', label: 'أعلى الصفحة الرئيسية' },
    { v: 'category_top', label: 'أعلى التصنيفات' },
];
export const positionLabel = (p?: string | null): string =>
    BANNER_POSITIONS.find((x) => x.v === p)?.label ?? (p || '—');

export const BannerModal: React.FC<{
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
    const [sched, setSched] = useState<{ starts_at: string | null; expires_at: string | null; error: string | null }>({ starts_at: initial?.starts_at ?? null, expires_at: initial?.expires_at ?? null, error: null });
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
    useBackClose(true, onClose);
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
            // v16.44 — السببُ الحقيقيّ من مصدرٍ واحد: «تأكد من الإنترنت» كانت
            // تُقال لرفضٍ محلّيٍّ بحت (حجم/صيغة) فيذهب المستخدم يفحص شبكةً سليمة.
            await customAlert(`❌ تعذّر رفع الصورة — ${uploadFailureMessage(true)}`);
            return;
        }
        setForm(prev => ({ ...prev, image_url: url }));
    };

    const handleSave = async () => {
        if (saving) return;
        if (!form.image_url.trim()) { await customAlert('⚠️ يرجى رفع صورة أو لصق رابط'); return; }
        // v16.46 — جدولةٌ متناقضة تُحفظ بلا شكوى ثمّ تُسقط السياسةُ البانرَ بصمت.
        if (sched.error) { await customAlert(sched.error); return; }
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
                starts_at: sched.starts_at, expires_at: sched.expires_at,   // v16.46 — جدولةُ الظهور
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

                    {/* 🔴 v16.48 — **ظاهرٌ دائماً، خارج أيّ طيّ.** وفي v16.46 أُدرج
                        بالخطأ داخل `<details>` «رابط خارجي (متقدّم)» المطويّة،
                        فشُحن الكودُ وبقي الحقلُ غيرَ مرئيّ — وبلاغُ ناصر: «لا زال
                        البنر لا يوجد به تاريخ». والدرسُ: وجودُ النصّ في الحزمة
                        لا يُثبت أنه **يُرى**؛ يُقرأ موضعُ التصيير لا وجودُه. */}
                    <BannerSchedule initial={initial} onChange={setSched} />

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

export default BannerModal;
