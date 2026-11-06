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
// v15.50 — كلُّ عبارةِ ساعاتٍ أو دقائقَ من هنا وحده (قاعدةُ v14.92).
import { holdLabel, minutesLabel, minutesLabelGen } from '../../utils/bookingHold';
import { AdmSection, AdmSkeleton, AdmError, AdmButton } from './ui';

type Key = 'minHold' | 'pickup' | 'delivery' | 'safety' | 'maxHold' | 'selfClose';

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
    // 🔴 v15.50 (أمرُ ناصر) — «أقلّ مدّةٍ يضعها التاجر ساعة»، وقابلةً لضبطه.
    //    وكانت ٠٫٢٥ مكتوبةً في خمسة أجسامٍ على القاعدة وأربعةِ مواضعَ هنا.
    { key: 'minHold', icon: '⏱', label: 'أقلّ ما يختاره التاجر', unit: 'h', min: 1, max: 8760, step: 1,
      hint: 'أرضيّتُك على اختيار التاجر. مهلةٌ أقصر من ساعةٍ تُلغي طلبات عملاءٍ في الطريق إلى المتجر، فهذا هو الحدُّ الذي لا ينزل تحته. والقاعدةُ تفرضه، فلا يُكتب رقمُه في أيّ نصّ.' },
    { key: 'pickup', icon: '🏪', label: 'استلام من المتجر', unit: 'h', min: 1, max: 8760, step: 1,
      hint: 'افتراضُ المنصّة. المخزون محبوس طوال المهلة، فالإطالة تعني بيعاً أقلّ. ويجوز للتاجر اختيار مهلةٍ أخرى من لوحته.' },
    { key: 'delivery', icon: '🚚', label: 'توصيل إلى العنوان', unit: 'h', min: 1, max: 8760, step: 1,
      hint: 'افتراضُ المنصّة. التجهيز والطريق، وتتوقّف المهلة بمجرّد انطلاق المندوب. ويجوز للتاجر تغييرها.' },
    { key: 'safety', icon: '🛟', label: 'شبكة أمان الطلب المنطلق', unit: 'h', min: 1, max: 8760, step: 1,
      hint: 'حدٌّ أقصى لطلبٍ انطلق مندوبه ولم يُغلقه التاجر — كي لا يُحبس المخزون للأبد. لا يملك التاجر تغييرها.' },
    { key: 'maxHold', icon: '🚧', label: 'أقصى ما يختاره التاجر', unit: 'h', min: 1, max: 8760, step: 1,
      hint: 'سقفُك على اختيار التاجر. مهلةُ أسبوعٍ تُجمّد مخزوناً وتُفرّغ العرض، فهذا هو الحدّ الذي لا يتجاوزه.' },
    // 🪤 والسقفُ ١٢٠ لا ١٤٤٠: مهلةُ الحجز نفسُها ساعتان افتراضاً، فرقمٌ أكبر
    //    منها يُقفل الميزةَ على المنصّة كلّها بلا أن يقول أحدٌ شيئاً.
    { key: 'selfClose', icon: '✅', label: 'قبل الختم بلا كود', unit: 'min', min: 0, max: 120, step: 1,
      hint: 'بالدقائق، ويجب أن تبقى أقصرَ من أقصر مهلةِ حجزٍ يستطيع التاجرُ اختيارها (الصفُّ الأوّل أعلاه). و٠ تعني بلا مهلة: الزرُّ يُفتح فوراً. كم بعد **تأكيد التاجر** لاستلام الطلب قبل أن يظهر «استلمت طلبي» للمشتري و«تم التسليم بدون كود» للتاجر. وإن لم يؤكّد التاجر، يُفتح الزرّ في آخر هذه المدّة من المهلة كي لا يبقى المشتري بلا مخرج. ومسحُ الكود فوريٌّ دائماً. و٠ تُعطّل المهلة.' },
];

const DEFAULTS: Record<Key, number> = { minHold: 1, pickup: 2, delivery: 6, safety: 72, maxHold: 72, selfClose: 10 };
const JSON_KEY: Record<Key, string> = {
    minHold: 'min_hold_hours',
    pickup: 'pickup_hours', delivery: 'delivery_hours', safety: 'in_progress_hours',
    maxHold: 'max_hold_hours', selfClose: 'self_close_minutes',
};

export const BookingHoldsCard: React.FC = () => {
    const { customAlert, customConfirm } = useApp();
    const [vals, setVals] = useState<Record<Key, string> | null>(null);
    // 🪤 ويُحتفظ بالصفّ كما هو: الحفظُ يستبدل الكائنَ كلَّه، فأيُّ مفتاحٍ
    //    يضيفه إصدارٌ لاحق كان يُمحى بصمت عند أوّل حفظٍ للمدير.
    const [rawValue, setRawValue] = useState<Record<string, unknown>>({});
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true); setErr('');
        const { data, error } = await supabase
            .from('platform_settings').select('value').eq('key', 'booking_holds').maybeSingle();
        if (error) { setErr(error.message); setLoading(false); return; }
        const v = (data?.value ?? {}) as any;
        setRawValue(v && typeof v === 'object' ? v : {});
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
                await customAlert(`⚠️ «${f.label}» يجب أن تكون بين `
                    + `${f.unit === 'h' ? holdLabel(f.min, true) : minutesLabel(f.min, true)} و`
                    + `${f.unit === 'h' ? holdLabel(f.max, true) : minutesLabel(f.max, true)}.`);
                return;
            }
            n[f.key] = x;
        }
        // التوصيل أقصر من الاستلام وعدٌ أقلّ لطلبٍ طريقُه أطول — نسأل ولا نمنع.
        if (n.delivery < n.pickup && !(await customConfirm(
            `⚠️ مهلة التوصيل (${n.delivery}) أقصر من مهلة الاستلام (${n.pickup}).\nطلب التوصيل يحتاج تجهيزاً وطريقاً، فالأقصر يُلغي طلبات صحيحة.\n\nهل تريد الحفظ رغم ذلك؟`))) return;
        // 🔴 v15.49 — القياسُ على **أطولِ مهلةٍ ممكنة** لا على افتراضك: التاجر
        //    يختار حتى `maxHold`، فمقارنةٌ بـ`delivery` (٦) تسكت عن ضبطٍ (٧٢
        //    و٧٢) حمايتُه صفر. و«يساوي» مثلُ «أقصر» — الفرقُ هو الهامشُ نفسه.
        //    والقاعدةُ تضمن ساعةً بعد مهلة كلِّ طلبٍ على الأقلّ، فالتحذيرُ عن
        //    ضيق الهامش لا عن إلغاءٍ صار مستحيلاً.
        if (n.safety <= Math.max(n.delivery, n.maxHold) && !(await customConfirm(
            `⚠️ شبكة الأمان (${n.safety}) لا تتجاوز أطولَ مهلةٍ ممكنة (${Math.max(n.delivery, n.maxHold)}).\nفلن يبقى للطلب المنطلق إلا الحدُّ الأدنى الذي تضمنه القاعدة: ساعةٌ واحدة بعد انتهاء مهلته.\n\nهل تريد الحفظ رغم ذلك؟`))) return;
        // 🪤 وسقفُ التاجر أقصرُ من افتراضك يعني متجراً لا يستطيع أن يبلغ
        //    افتراضَك نفسَه — والقاعدة تقصّ اختيارَه عنده، فيبدو الافتراضُ كذباً.
        if (n.maxHold < Math.max(n.pickup, n.delivery) && !(await customConfirm(
            `⚠️ أقصى ما يختاره التاجر (${n.maxHold}) أقصر من افتراضك (${Math.max(n.pickup, n.delivery)}).\nالتاجر الذي يريد مهلةً كافتراضك لن يستطيع اختيارها.\n\nهل تريد الحفظ رغم ذلك؟`))) return;

        // 🔴 v15.46 — مهلةُ الختم تُقاس بالدقائق والمهلةُ بالساعات. فكلُّ قيمةٍ
        //    تقترب من **أرضيّة** مهلة التاجر تُفرّغ نافذةَ المتاجر الواقفة عليها
        //    إلى الدقيقة الواحدة التي يضمنها السقف. نسأل ولا نمنع — القرارُ قرارُه.
        // 🔴 v15.50 — والعتبةُ تُحسب من الأرضيّة المضبوطة لا من رقمٍ جامد: كانت
        //    ١٤ دقيقةً مكتوبةً بحساب ربع ساعة، فبدّلها ناصرٌ إلى ساعةٍ فصار
        //    الإنذارُ يصرخ على قيمٍ آمنة ويسكت عمّا يجب.
        const floorMin = Math.round(n.minHold * 60);
        if (n.selfClose >= floorMin - 1 && !(await customConfirm(
            `⚠️ «قبل الختم بلا كود» = ${minutesLabel(n.selfClose, true)}، وأقصرُ مهلةٍ يملك التاجرُ اختيارها ${holdLabel(n.minHold, true)}.\n`
            + `في تلك المتاجر لن يبقى للمشتري إلا دقيقةٌ واحدة ليضغط «استلمت طلبي».\n\nهل تريد الحفظ رغم ذلك؟`))) return;
        // ومثلُها لو تجاوزت افتراضَ المنصّة نفسَه.
        if (n.selfClose >= n.pickup * 60 && !(await customConfirm(
            `⚠️ «قبل الختم بلا كود» (${minutesLabel(n.selfClose, true)}) أطولُ من مهلة الاستلام نفسِها (${holdLabel(n.pickup, true)}).\n`
            + `الزرُّ لن يُفتح إلا قبل انتهاء الطلب بدقيقة.\n\nهل تريد الحفظ رغم ذلك؟`))) return;
        // والأرضيّةُ فوق السقف تقلب المدى فيُرفض كلُّ رقمٍ يكتبه التاجر.
        if (n.minHold > n.maxHold) {
            await customAlert(`⚠️ أقلُّ ما يختاره التاجر (${holdLabel(n.minHold, true)}) أطولُ من أقصاه (${holdLabel(n.maxHold, true)}) — فلا رقمَ يستطيع اختياره. صحّح أحدهما.`);
            return;
        }

        setSaving(true);
        const e = await writePlatformSetting('booking_holds', {
            ...rawValue,
            min_hold_hours: n.minHold,
            pickup_hours: n.pickup, delivery_hours: n.delivery, in_progress_hours: n.safety,
            max_hold_hours: n.maxHold, self_close_minutes: n.selfClose,
        }, 'مهلة الحجز: الاستلام · التوصيل · شبكة الأمان · أرضيّة وسقف اختيار التاجر · مهلة الختم بلا كود');
        setSaving(false);
        if (e) { await customAlert('❌ ' + e); return; }
        // 🪤 v15.50 — كانت هذه السطورُ تصنع «${n} ساعة» بيدها، فتطبع «2 ساعة»
        //    مكان «ساعتان» و«6 ساعة» مكان «6 ساعات» و«10 دقيقة» مكان «10 دقائق»
        //    — ثلاثةُ أخطاءٍ نحويّة حيّة. والمحرّكُ واحدٌ (`arPlural`) بقاعدة v14.92.
        await customAlert(
            `✅ تم الحفظ — استلام ${holdLabel(n.pickup, true)} · توصيل ${holdLabel(n.delivery, true)} · شبكة أمان ${holdLabel(n.safety, true)}`
            + `\nواختيارُ التاجر بين ${holdLabel(n.minHold, true)} و${holdLabel(n.maxHold, true)} · والختم بلا كود بعد ${minutesLabelGen(n.selfClose, true)} من تأكيد التاجر.`
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
