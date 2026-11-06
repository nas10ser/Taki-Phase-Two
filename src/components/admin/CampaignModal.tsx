/**
 * CampaignModal — نافذةُ إنشاء/تعديل الحملة الترويجية (v15.51)
 * ═══════════════════════════════════════════════════════════════════════════
 * خرجت من `AdminTools.tsx` لأنه بلغ سقفَ السقّافة بالضبط (١٩٨٢ سطراً) واحتاج
 * إصلاحُ البثّ عشرةَ أسطر. وقاعدةُ المشروع: **قلّص، لا ترفع السقف** — والتقليصُ
 * كشف أن تسعةَ تعريفاتٍ كانت مشتركةً بين نافذتين في ملفٍّ واحد (`modalKit`).
 */
import React, { useMemo, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { useApp } from '../../context/AppContext';
import { CITIES, REGIONS } from '../../data/mock';
import { AdmButton, AdmSwitch as Sw } from './ui';
import { useEscClose } from '../../hooks/useEscClose';
// v15.51 — زرُّ الرجوع في الجهاز يُغلق الطبقة كما يفعل Esc على الحاسوب.
import { useBackClose } from '../../hooks/useBackClose';
import { promoRepository } from '../../repositories/promoRepository';
import { fieldStyle, labelStyle, hintStyle, AUDIENCE_LABELS, Field,
         modalShell, modalHead, modalFoot, toLocalDateInput } from './modalKit';

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
export const RECURRENCE_LABELS: Record<string, string> = Object.fromEntries(
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

export const CampaignModal: React.FC<{
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
    useBackClose(true, onClose);

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
