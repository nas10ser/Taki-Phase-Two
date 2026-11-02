/**
 * BookingHoldsCard — بطاقةُ «⏳ مهلة الحجز» (v15.43، خرجت من `AdminTools`)
 * ═══════════════════════════════════════════════════════════════════════════
 * كانت داخل `AdminTools.tsx` وهو عند سقفه بالضبط، فلمّا احتاجت البطاقةُ حقلين
 * جديدين كان الصواب **تقليصاً حقيقياً** لا رفعَ السقف: خرجت البطاقةُ بكاملها
 * — حالتُها وجلبُها وحفظُها — فصار لها ملفٌّ يُقرأ في جلسةٍ واحدة.
 *
 * والحقول خمسة، وكلُّها في مفتاحٍ واحد (`platform_settings.booking_holds`):
 *   • استلام · توصيل — افتراضُ المنصّة، **ويجوز للتاجر تجاوزُه** (v15.43).
 *   • شبكةُ أمانِ الطلب المنطلق — سقفٌ لطلبٍ انطلق مندوبه ولم يُختم.
 *   • أقصى ما يختاره التاجر — سقفُ المنصّة على اختيار التاجر (v15.43).
 *   • مهلةُ الختم بلا كود — بالدقائق (v15.42).
 *
 * 🪤 والوحدةُ ليست واحدة: الخامسُ **بالدقائق**، فلو ورث كلمةَ «ساعة» من
 *    البطاقة لقال المديرُ ١٠ وقصد دقائق فكُتبت ساعات — وهو خطأٌ لا يظهر إلا
 *    على طلبٍ حقيقيّ. فلكلّ حقلٍ وحدتُه ومداه نصّاً.
 * 🪤 ولا تُرسم الحقولُ قبل وصول قيمها: افتراضٌ معروضٌ ثمّ حفظٌ = كتابةُ رقمٍ
 *    افتراضيّ فوق رقمٍ حقيقيّ (درسُ لوحة الأدوات نفسِها).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { writePlatformSetting } from '../../services/platformSettingWrite';
import { useApp } from '../../context/AppContext';
import { normalizeArabicNumerals } from '../../utils/helpers';
import { AdmSection, AdmSkeleton, AdmError, AdmButton } from './ui';

type Key = 'pickup' | 'delivery' | 'safety' | 'maxHold' | 'selfClose';

interface FieldDef {
    key: Key;
    icon: string;
    label: string;
    unit: 'h' | 'min';
    min: number;
    max: number;
    step: number;
    hint: string;
}

const FIELDS: readonly FieldDef[] = [
    { key: 'pickup', icon: '🏪', label: 'استلام من المتجر', unit: 'h', min: 0.25, max: 8760, step: 0.25,
      hint: 'افتراضُ المنصّة. المخزون محبوس طوال المهلة، فالإطالة تعني بيعاً أقلّ. ويجوز للتاجر اختيار مهلةٍ أخرى من لوحته.' },
    { key: 'delivery', icon: '🚚', label: 'توصيل إلى العنوان', unit: 'h', min: 0.25, max: 8760, step: 0.25,
      hint: 'افتراضُ المنصّة. التجهيز والطريق، وتتوقّف المهلة بمجرّد انطلاق المندوب. ويجوز للتاجر تغييرها.' },
    { key: 'safety', icon: '🛟', label: 'شبكة أمان الطلب المنطلق', unit: 'h', min: 0.25, max: 8760, step: 0.25,
      hint: 'حدٌّ أقصى لطلبٍ انطلق مندوبه ولم يُغلقه التاجر — كي لا يُحبس المخزون للأبد. لا يملك التاجر تغييرها.' },
    { key: 'maxHold', icon: '🚧', label: 'أقصى ما يختاره التاجر', unit: 'h', min: 0.25, max: 8760, step: 1,
      hint: 'سقفُك على اختيار التاجر. مهلةُ أسبوعٍ تُجمّد مخزوناً وتُفرّغ العرض، فهذا هو الحدّ الذي لا يتجاوزه.' },
    { key: 'selfClose', icon: '✅', label: 'قبل الختم بلا كود', unit: 'min', min: 0, max: 1440, step: 1,
      hint: 'بالدقائق: كم بعد الحجز قبل أن يظهر «استلمت طلبي» للمشتري و«تم التسليم بدون كود» للتاجر. مسحُ الكود يبقى فورياً دائماً. و٠ تُعطّل المهلة.' },
];

const DEFAULTS: Record<Key, number> = { pickup: 2, delivery: 6, safety: 72, maxHold: 72, selfClose: 10 };
const JSON_KEY: Record<Key, string> = {
    pickup: 'pickup_hours', delivery: 'delivery_hours', safety: 'in_progress_hours',
    maxHold: 'max_hold_hours', selfClose: 'self_close_minutes',
};

export const BookingHoldsCard: React.FC = () => {
    const { customAlert, customConfirm } = useApp();
    const [vals, setVals] = useState<Record<Key, string> | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true); setErr('');
        const { data, error } = await supabase
            .from('platform_settings').select('value').eq('key', 'booking_holds').maybeSingle();
        if (error) { setErr(error.message); setLoading(false); return; }
        const v = (data?.value ?? {}) as any;
        const next = {} as Record<Key, string>;
        for (const f of FIELDS) {
            const raw = v[JSON_KEY[f.key]];
            const n = typeof raw === 'number' ? raw : parseFloat(String(raw ?? ''));
            next[f.key] = String(Number.isFinite(n) && n >= f.min && n <= f.max ? n : DEFAULTS[f.key]);
        }
        setVals(next); setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const set = (k: Key, raw: string) =>
        setVals(prev => (prev ? { ...prev, [k]: normalizeArabicNumerals(raw) } : prev));

    const save = async () => {
        if (!vals) return;
        const n = {} as Record<Key, number>;
        for (const f of FIELDS) {
            const x = parseFloat(normalizeArabicNumerals(vals[f.key]));
            if (!Number.isFinite(x) || x < f.min || x > f.max) {
                await customAlert(`⚠️ «${f.label}» يجب أن تكون بين ${f.min} و${f.max} ${f.unit === 'h' ? 'ساعة' : 'دقيقة'}.`);
                return;
            }
            n[f.key] = x;
        }
        // التوصيل أقصر من الاستلام وعدٌ أقلّ لطلبٍ طريقُه أطول — نسأل ولا نمنع.
        if (n.delivery < n.pickup && !(await customConfirm(
            `⚠️ مهلة التوصيل (${n.delivery}) أقصر من مهلة الاستلام (${n.pickup}).\nطلب التوصيل يحتاج تجهيزاً وطريقاً، فالأقصر يُلغي طلبات صحيحة.\n\nهل تريد الحفظ رغم ذلك؟`))) return;
        if (n.safety < n.delivery && !(await customConfirm(
            `⚠️ شبكة الأمان (${n.safety}) أقصر من مهلة التوصيل (${n.delivery}).\nمعناها أن طلباً انطلق مندوبه قد يُلغى قبل انتهاء مهلته الأصلية.\n\nهل تريد الحفظ رغم ذلك؟`))) return;
        // 🪤 وسقفُ التاجر أقصرُ من افتراضك يعني متجراً لا يستطيع أن يبلغ
        //    افتراضَك نفسَه — والقاعدة تقصّ اختيارَه عنده، فيبدو الافتراضُ كذباً.
        if (n.maxHold < Math.max(n.pickup, n.delivery) && !(await customConfirm(
            `⚠️ أقصى ما يختاره التاجر (${n.maxHold}) أقصر من افتراضك (${Math.max(n.pickup, n.delivery)}).\nالتاجر الذي يريد مهلةً كافتراضك لن يستطيع اختيارها.\n\nهل تريد الحفظ رغم ذلك؟`))) return;

        setSaving(true);
        const e = await writePlatformSetting('booking_holds', {
            pickup_hours: n.pickup, delivery_hours: n.delivery, in_progress_hours: n.safety,
            max_hold_hours: n.maxHold, self_close_minutes: n.selfClose,
        }, 'مهلة الحجز: الاستلام · التوصيل · شبكة الأمان · سقف اختيار التاجر · مهلة الختم بلا كود');
        setSaving(false);
        if (e) { await customAlert('❌ ' + e); return; }
        await customAlert(
            `✅ تم الحفظ — استلام ${n.pickup} ساعة · توصيل ${n.delivery} ساعة · شبكة أمان ${n.safety} ساعة`
            + `\nوسقف اختيار التاجر ${n.maxHold} ساعة · والختم بلا كود بعد ${n.selfClose} دقيقة.`
            + `\nيسري على الطلبات الجديدة فوراً.`);
    };

    return (
        <AdmSection
            title="مهلة الحجز"
            icon="⏳"
            desc="كم يبقى الطلب محجوزاً قبل أن يُلغى تلقائياً وتعود الكمّية للبيع. هذه افتراضات المنصّة — ولكلّ تاجرٍ أن يحدّد مهلته من لوحته (v15.43)."
            collapsible
            defaultOpen={false}
        >
            {loading ? <AdmSkeleton rows={3} height={92} /> : err || !vals ? (
                <AdmError message="لم تصل المهل الحالية — لا تُعرض الحقول حتى لا تُحفظ أرقامٌ افتراضية فوق الحقيقية." onRetry={load} />
            ) : (
                <>
                    <p style={{ fontSize: '.78rem', lineHeight: 1.85, color: 'var(--adm-fg-2)', margin: '0 0 12px' }}>
                        يسري فوراً على الطلبات الجديدة، ويتغيّر معه نصّ ورقة الحجز وصفحات الشروط والاسترداد والأسئلة الشائعة والبوتان في اللحظة نفسها.
                        <br />
                        <strong style={{ color: 'var(--adm-fg)' }}>ولا يمسّ الطلبات القائمة</strong> — كل طلبٍ يحتفظ بالمهلة التي وُعد بها وقت حجزه.
                        <br />
                        <strong style={{ color: 'var(--adm-fg)' }}>والتاجر يملك تجاوز الاستلام والتوصيل</strong> من «سياسات متجري» — وما تضبطه هنا هو ما يسري على كل متجر لم يختر.
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10 }}>
                        {FIELDS.map(f => (
                            <div key={f.key} style={{ padding: 12, borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)' }}>
                                <div style={{ fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)', marginBottom: 7 }}>{f.icon} {f.label}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <input
                                        type="number" min={f.min} max={f.max} step={f.step} inputMode="decimal" dir="ltr"
                                        value={vals[f.key]}
                                        onChange={(e) => set(f.key, e.target.value)}
                                        aria-label={f.label}
                                        className="adm-focusable"
                                        style={{
                                            width: '100%', padding: '9px 11px', fontSize: '.85rem',
                                            borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
                                            background: 'var(--adm-surface)', color: 'var(--adm-fg)',
                                            maxWidth: 92, textAlign: 'center', fontWeight: 800,
                                        }}
                                    />
                                    <span style={{ fontSize: '.76rem', fontWeight: 800, color: 'var(--adm-fg-2)' }}>
                                        {f.unit === 'h' ? 'ساعة' : 'دقيقة'}
                                    </span>
                                </div>
                                <div style={{ fontSize: '.7rem', lineHeight: 1.8, color: 'var(--adm-fg-3)', marginTop: 8 }}>{f.hint}</div>
                            </div>
                        ))}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                        <AdmButton variant="primary" onClick={save} disabled={saving}>
                            {saving ? 'جاري الحفظ...' : '💾 حفظ المهل'}
                        </AdmButton>
                    </div>
                </>
            )}
        </AdmSection>
    );
};

export default BookingHoldsCard;
