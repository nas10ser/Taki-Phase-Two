/**
 * HoldHoursCard — التاجر يحدّد مهلة حجزه (v15.43)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر: «اجعل التاجر هو من يحدّد مدّة الحجز في النظام وليس أنا».
 *
 * والعلّةُ عمليّة: مخبزٌ يريد نصفَ ساعة (الخبزُ يبرد)، ومعرضُ أثاثٍ يريد
 * يومين (العميلُ يأتي بسيّارة نقل). ورقمٌ واحدٌ للمنصّة يُظلم الاثنين، وناصرٌ
 * ليس طرفاً في تلك المفاضلة — صاحبُ البضاعة هو من يعرف.
 *
 * 🪤 و«اتبع افتراضي المنصّة» حالةٌ ثالثة لا صفر: حقلٌ فارغ ⇒ `null` في القاعدة
 *    ⇒ يتحرّك المتجرُ مع ضبط ناصر. والصفرُ قيمةٌ أخرى تماماً (وهو مرفوض:
 *    الأرضيّة ربعُ ساعة). خلطُهما هو بالضبط عيبُ v15.33 في الكمّيات.
 * 🪤 والقاعدة **ترفض** ما خرج عن المدى ولا تقصّه بصمت — فالرسالةُ تقول الحدّ.
 * 🔴 والحجوزاتُ القائمة تبقى على مهلتها المَوعودة: مشغّلُ القاعدة
 *    `BEFORE INSERT` وحده، فلا يُعاد حسابُ حجزٍ قائم. وهذا مكتوبٌ للتاجر
 *    في البطاقة نفسها — وعدٌ لا يُقال في كودٍ وحده.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { refundRepository } from '../../repositories/refundRepository';
import { holdLabel } from '../../utils/bookingHold';

/** نصُّ الحقل ⇒ رقمٌ أو `null` («اتبع المنصّة») أو `undefined` (غير صالح). */
const parseHours = (raw: string): number | null | undefined => {
    const t = (raw || '').trim();
    if (!t) return null;
    const n = parseFloat(t.replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
    return Number.isFinite(n) ? n : undefined;
};

export const HoldHoursCard: React.FC = () => {
    const { user, language, platformSettings, customAlert } = useApp();
    const isRTL = language === 'ar';
    const [pickup, setPickup] = useState('');
    const [delivery, setDelivery] = useState('');
    const [saved, setSaved] = useState({ p: '', d: '' });
    const [max, setMax] = useState(72);
    const [busy, setBusy] = useState(false);
    const [ready, setReady] = useState(false);

    const load = useCallback(async () => {
        if (!user?.id) return;
        const r = await refundRepository.storePolicies(user.id);
        // تعذّرت القراءة ⇒ لا تُفرَّغ الحقول: فراغٌ هنا يعني «اتبع المنصّة»،
        // فحفظٌ بعده يمحو اختيارَ التاجر بلا أن يقصد (درس v14.71).
        if (!r.ok) return;
        const p = r.holdPickupCustom != null ? String(r.holdPickupCustom) : '';
        const d = r.holdDeliveryCustom != null ? String(r.holdDeliveryCustom) : '';
        setPickup(p); setDelivery(d); setSaved({ p, d });
        if (r.holdMaxHours != null) setMax(r.holdMaxHours);
        setReady(true);
    }, [user?.id]);
    useEffect(() => { load(); }, [load]);

    if (!user?.id) return null;
    const dirty = pickup !== saved.p || delivery !== saved.d;
    const platP = platformSettings.bookingHolds.pickupHours;
    const platD = platformSettings.bookingHolds.deliveryHours;

    const save = async () => {
        const p = parseHours(pickup);
        const d = parseHours(delivery);
        if (p === undefined || d === undefined) {
            await customAlert(isRTL ? 'اكتب رقم ساعات صحيحاً، أو اترك الحقل فارغاً لتتبع افتراضي تاكي.'
                                   : 'Enter a valid number of hours, or leave it empty to follow the TAKI default.');
            return;
        }
        setBusy(true);
        try {
            const r = await refundRepository.saveBookingHolds(p, d);
            if (!r.ok) {
                const lo = r.min ?? 0.25;
                const hi = r.max ?? max;
                await customAlert(
                    r.error === 'PICKUP_OUT_OF_RANGE' || r.error === 'DELIVERY_OUT_OF_RANGE'
                        ? (isRTL ? `المهلة يجب أن تكون بين ${lo} و${hi} ساعة.`
                                 : `The window must be between ${lo} and ${hi} hours.`)
                        : (isRTL ? 'تعذّر الحفظ — حاول مرة أخرى.' : 'Could not save — please try again.'));
                return;
            }
            setSaved({ p: pickup, d: delivery });
            await customAlert(isRTL
                ? `✅ حُفظت. تسري على الحجوزات الجديدة، والحجوزات القائمة تبقى على مهلتها التي وُعد بها المشتري.`
                : '✅ Saved. It applies to new bookings; existing ones keep the window the buyer was promised.');
        } finally { setBusy(false); }
    };

    const box: React.CSSProperties = {
        marginTop: 12, padding: '14px 15px', borderRadius: 18,
        background: 'var(--card-bg)', border: '1px solid var(--border-color)',
    };
    const input: React.CSSProperties = {
        width: '100%', padding: '11px 13px', borderRadius: 14,
        border: '1px solid var(--border-color)', background: 'var(--body-bg)',
        color: 'var(--text-primary)', fontSize: '0.85rem', fontWeight: 800, outline: 'none',
    };
    const label: React.CSSProperties = {
        display: 'block', fontSize: '0.78rem', fontWeight: 900,
        color: 'var(--text-primary)', marginBottom: 6,
    };
    const hint: React.CSSProperties = {
        fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)',
        marginTop: 4, lineHeight: 1.7,
    };

    return (
        <div style={box}>
            <div style={{ fontWeight: 900, fontSize: '0.9rem', marginBottom: 4 }}>
                ⏳ {isRTL ? 'كم تنتظر المشتري؟' : 'How long do you wait for the buyer?'}
            </div>
            {/* شرحٌ لتاجرٍ يسجّل أوّل مرّة (أمرُ ناصر): ماذا يفعل الرقمُ في يومه،
                ومثالٌ يعرفه، وماذا يخسر إن قصّر أو أطال، ومعنى الفراغ.
                🪤 والمثالُ بلا أرقام عمداً: «نصف ساعة/يومان» تصير كذباً لو خفّض
                   المديرُ السقفَ تحتها، والسطرُ الذي يذكر المدى تحته مباشرة. */}
            <div style={hint}>
                {isRTL
                    ? 'المشتري يحجز، فتُحجز الكمّية باسمه ولا يشتريها غيره. وإن لم يستلم خلال المدّة التي تكتبها هنا، يُلغى طلبه وحده وترجع الكمّية للبيع.'
                    : 'When a buyer books, the quantity is held in his name and nobody else can buy it. If he does not collect within the window you set here, his order cancels itself and the quantity goes back on sale.'}
            </div>
            <div style={hint}>
                {isRTL
                    ? 'المخبز يكتب مدّة قصيرة لأن الخبز يبرد، ومعرض الأثاث مدّة أطول لأن المشتري يجيب سيّارة نقل.'
                    : 'A bakery sets a short window because bread goes cold; a furniture shop sets a longer one because the buyer brings a truck.'}
            </div>
            <div style={hint}>
                {isRTL
                    ? 'القصيرة تُلغي طلبات مشترين هم في طريقهم إليك، والطويلة تحبس بضاعتك عند من قد لا يأتي.'
                    : 'Too short cancels on buyers who are on their way; too long locks your stock up for someone who may never come.'}
            </div>

            {/* 🪤 `alignItems:'flex-end'` ليست تجميلاً. العنوان «الاستلام من المتجر
                (ساعات)» يحتاج ١٦٥٫٥px بخطّ Tajawal عند 0.78rem/900 والحقلُ ١٤٠–١٦٥٫٥px
                في نطاق العرض ٣٨٩–٤٣٩pt — وجهازُ ناصر داخله (١٢٨٤/٣ = ٤٢٨pt) — فينكسر
                إلى سطرين بينما «التوصيل (ساعات)» (١٠٤٫٧px) يبقى سطراً، و`stretch`
                الافتراضيّة تُسوّي **الغلافين** لا الحقلين ⇒ فارقٌ ١٩٫٩٧px.
                والمحاذاةُ على المحور المتقاطع (الرأسيّ) لا تنعكس مع RTL — ينعكس
                `justify-content` وحده — فسطرٌ واحد يكفي اللغتين، ويبقى صحيحاً عند
                ثلاثة أسطر، ولا أثر له حين يتكدّس الحقلان (قِيس: نفسُ الارتفاع).
                🔴 وأوّلُ قياسين عندي **برّآ الكودَ كذباً** (١٣٦٫٦px، بلا كسر) لأن خطّ
                   التطبيق لم يكن محمّلاً والاحتياطيُّ أضيقُ ٢١٪. أيُّ إعادة قياسٍ
                   لهذه البطاقة تشترط `document.fonts.check(...)` قبل تصديق أيّ عرض. */}
            <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                    <span style={label}>{isRTL ? 'الاستلام (ساعات)' : 'Pickup (hours)'}</span>
                    <input style={input} value={pickup} inputMode="decimal"
                        onChange={e => setPickup(e.target.value)}
                        placeholder={isRTL ? `فارغ = ${holdLabel(platP, true)}` : `empty = ${holdLabel(platP, false)}`} />
                </div>
                <div style={{ flex: 1, minWidth: 140 }}>
                    <span style={label}>{isRTL ? 'التوصيل (ساعات)' : 'Delivery (hours)'}</span>
                    <input style={input} value={delivery} inputMode="decimal"
                        onChange={e => setDelivery(e.target.value)}
                        placeholder={isRTL ? `فارغ = ${holdLabel(platD, true)}` : `empty = ${holdLabel(platD, false)}`} />
                </div>
            </div>

            <div style={hint}>
                {isRTL
                    ? `بين ربع ساعة و${max} ساعة. والمعمول به الآن: الاستلام ${holdLabel(saved.p ? Number(saved.p) : platP, true)} والتوصيل ${holdLabel(saved.d ? Number(saved.d) : platD, true)}.`
                    : `Between 0.25 and ${max} hours. In effect now: pickup ${holdLabel(saved.p ? Number(saved.p) : platP, false)}, delivery ${holdLabel(saved.d ? Number(saved.d) : platD, false)}.`}
            </div>
            <div style={hint}>
                {isRTL
                    ? 'ملاحظة: التعديل يسري على الحجوزات الجديدة فقط — والحجوزات القائمة تبقى على المهلة التي وُعد بها المشتري.'
                    : 'Note: changes apply to new bookings only — existing ones keep the window the buyer was promised.'}
            </div>

            <button onClick={save} disabled={busy || !dirty || !ready}
                style={{
                    marginTop: 12, width: '100%', padding: '11px', borderRadius: 14, border: 'none',
                    background: (busy || !dirty || !ready) ? 'var(--gray-400)' : 'linear-gradient(135deg,#10b981,#059669)',
                    color: '#fff', fontWeight: 900, fontSize: '0.8rem',
                    cursor: (busy || !dirty || !ready) ? 'default' : 'pointer',
                }}>
                {busy ? (isRTL ? 'جارٍ الحفظ…' : 'Saving…')
                      : dirty ? (isRTL ? '💾 حفظ المهلة' : '💾 Save window')
                              : (isRTL ? '✓ محفوظة' : '✓ Saved')}
            </button>
        </div>
    );
};

export default HoldHoursCard;
