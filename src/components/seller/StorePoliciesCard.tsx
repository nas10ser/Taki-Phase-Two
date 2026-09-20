/**
 * StorePoliciesCard — سياسة التاجر المعلنة (v14.18)
 * ═══════════════════════════════════════════════════════════════════════════
 * صفحة الاسترداد في تاكي تقول للمشتري منذ يوليو: «اطّلع — قبل الحجز — على سياسة
 * الاسترداد المُعلَنة في صفحة المتجر أو العرض»، والأسئلة الشائعة تنصح التاجر
 * بنشرها. ولم يكن في النظام حقلٌ يكتبها فيه — وعدٌ بلا مكان.
 *
 * ما يُكتب هنا يظهر للمشتري في **صفحة المتجر وصفحة العرض قبل الحجز**، وهو
 * المرجع الذي يبتّ به التاجر في أي طلب استرداد. تاكي وسيط: لا تفرض سياسة ولا
 * تبتّ فيها.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { refundRepository } from '../../repositories/refundRepository';
import { notifySetupGapsChanged } from './SetupPath';

const MAX = 1500;

/**
 * نموذج جاهز يعدّله التاجر (v14.28، قرار ناصر: «لا تُلزم، ولكن اكتب تحذيراً»).
 * كُتب ليكون صالحاً كما هو لمتجرٍ عادي، ومع ذلك كل سطر فيه قابل للحذف أو
 * التغيير — فالسياسة سياسة التاجر لا سياسة تاكي.
 */
const TEMPLATE_AR = `• الاستبدال أو الاسترداد خلال ٣ أيام من الاستلام، بالفاتورة أو رقم الطلب.
• يجب أن يكون المنتج بحالته الأصلية وبكامل تغليفه وملحقاته وغير مستعمل.
• لا استرداد نقدي على: المنتجات الغذائية، ومنتجات العناية الشخصية المفتوحة، والمنتجات المخفَّضة تخفيضاً نهائياً.
• المنتج المعيب أو المخالف للوصف: نستبدله أو نردّ قيمته كاملة، ونتحمّل نحن تكلفة الإرجاع.
• تغيير الرأي: يتحمّل المشتري تكلفة الإرجاع.
• مدّة وصول المبلغ المُعاد تحدّدها جهة الدفع (البنك أو البوابة).
• للتواصل: راسلنا عبر محادثة الطلب داخل تاكي.`;

const TEMPLATE_EN = `• Exchange or refund within 3 days of receipt, with the receipt or order number.
• The item must be unused, in its original condition, packaging and accessories.
• No cash refunds on: food items, opened personal-care products, and final-sale discounted items.
• Faulty or not-as-described items: we replace them or refund in full and cover the return cost.
• Change of mind: the buyer covers the return cost.
• The time for a refund to reach your account is set by your bank or the payment provider.
• Contact us through the order chat inside TAKI.`;

export const StorePoliciesCard: React.FC = () => {
    const { user, language, customAlert, customConfirm } = useApp();
    const isRTL = language === 'ar';
    const [policy, setPolicy] = useState('');
    const [terms, setTerms] = useState('');
    const [saved, setSaved] = useState({ p: '', t: '' });
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);

    const load = useCallback(async () => {
        if (!user?.id) return;
        const r = await refundRepository.storePolicies(user.id);
        // تعذّرت القراءة: لا نُفرغ الحقول ولا نفتح البطاقة كأنّ التاجر لم يكتب شيئاً.
        if (!r.ok) return;
        const p = r.refundPolicy || '';
        const t = r.storeTerms || '';
        setPolicy(p); setTerms(t); setSaved({ p, t });
        // بطاقة فارغة تُفتح تلقائياً: التاجر يراها ولا يبحث عنها.
        if (!p && !t) setOpen(true);
    }, [user?.id]);
    useEffect(() => { load(); }, [load]);

    if (!user?.id) return null;
    const dirty = policy !== saved.p || terms !== saved.t;
    const empty = !saved.p && !saved.t;

    const field: React.CSSProperties = {
        width: '100%', minHeight: 110, padding: '11px 13px', borderRadius: 14,
        border: '1px solid var(--border-color)', background: 'var(--body-bg)',
        color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 700,
        lineHeight: 1.9, outline: 'none', resize: 'vertical', fontFamily: 'inherit',
    };
    const label: React.CSSProperties = {
        display: 'block', fontSize: '0.78rem', fontWeight: 900,
        color: 'var(--text-primary)', marginBottom: 6,
    };
    const hint: React.CSSProperties = {
        fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)',
        marginTop: 4, lineHeight: 1.7,
    };

    return (
        <div style={{
            background: 'var(--card-bg)', border: `1.5px solid ${empty ? 'rgba(245,158,11,0.5)' : 'var(--border-color)'}`,
            borderRadius: 18, padding: 16,
        }}>
            <button
                onClick={() => setOpen(o => !o)}
                style={{
                    width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10, textAlign: isRTL ? 'right' : 'left',
                }}
            >
                <span style={{ fontSize: '1.2rem' }}>📜</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {isRTL ? 'سياسة الاسترداد والاستبدال وشروط متجرك' : 'Your refund, exchange and store terms'}
                    </div>
                    {/* v14.24 — كهرمانيّ فاتح: الغامق (#b45309) على البطاقة الداكنة
                        تباينُه ٣:١ عند ١٢px — فالسطر الوحيد المقصود أن يلفت النظر كان
                        أصعب ما يُقرأ في الوضع الليلي. */}
                    <div style={{ fontWeight: 700, fontSize: '0.75rem', color: empty ? 'var(--secondary, #f59e0b)' : 'var(--text-secondary)', marginTop: 3 }}>
                        {empty
                            ? (isRTL ? '⚠️ لم تكتبها بعد — صفحاتك تقول للمشتري: «لم يُعلن هذا المتجر سياسة استرداد»' : '⚠️ Not written yet — your pages tell buyers: "this store has not published a refund policy"')
                            : (isRTL ? '✅ معلنة في صفحة متجرك وفي كل عروضك' : '✅ Published on your store page and every deal')}
                    </div>
                </div>
                <span style={{ color: 'var(--text-secondary)', fontWeight: 900 }}>{open ? '▲' : '▼'}</span>
            </button>

            {open && (
                <div style={{ marginTop: 14 }}>
                    <div style={{
                        padding: '10px 12px', borderRadius: 12, marginBottom: 14,
                        background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(59,130,246,0.3)',
                        fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.9,
                    }}>
                        {isRTL
                            ? 'ما تكتبه هنا يراه المشتري قبل الحجز، وهو مرجعك حين يطلب استرداداً. تاكي وسيطٌ لا تفرض سياسة ولا تبتّ فيها: الاسترداد والاستبدال بينك وبين المشتري.'
                            : 'What you write here is shown to buyers before they book, and it is your reference when they request a refund. TAKI is an intermediary: it neither imposes nor adjudicates store policies.'}
                    </div>

                    {empty && (
                        <div style={{
                            padding: '12px 14px', borderRadius: 12, marginBottom: 14,
                            background: 'rgba(245,158,11,0.12)', border: '1.5px solid rgba(245,158,11,0.45)',
                            fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1.95,
                        }}>
                            {isRTL ? '⚠️ كتابتها اختيارية — وتركها مكلف' : '⚠️ Optional — but leaving it empty costs you'}
                            <div style={{ marginTop: 6, fontWeight: 700, color: 'var(--text-secondary)' }}>
                                {isRTL
                                    ? 'متجرٌ بلا سياسة معلنة يتردّد المشتري في الحجز منه، ويظنّ أن لا ضمان له إن وصله المنتج مخالفاً. وحين يقع خلاف لن يكون لديك مرجعٌ مكتوب تحتكم إليه — فتخسر الحقّ والسمعة معاً. وأنظمة التجارة الإلكترونية في السعودية تُلزم البائع بالإفصاح عن شروط الاستبدال والاسترجاع قبل إتمام البيع؛ تاكي لا تفرضها عليك ولا تبتّ فيها، لكنها تنبّهك.'
                                    : 'Buyers hesitate to book from a store with no published policy, and assume they have no recourse. In a dispute you would have no written reference to rely on. Saudi e-commerce regulations require sellers to disclose return and exchange terms before the sale; TAKI does not impose or adjudicate your policy, but it does warn you.'}
                            </div>
                        </div>
                    )}

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                        <label style={{ ...label, marginBottom: 0 }}>{isRTL ? 'سياسة الاسترداد والاستبدال' : 'Refund & exchange policy'}</label>
                        <button
                            onClick={async () => {
                                if (policy.trim() && !(await customConfirm(isRTL
                                    ? 'سيستبدل النموذج ما كتبته هنا. أتريد المتابعة؟'
                                    : 'The template will replace what you wrote. Continue?'))) return;
                                setPolicy(isRTL ? TEMPLATE_AR : TEMPLATE_EN);
                            }}
                            style={{
                                background: 'none', border: '1px solid var(--border-color)', borderRadius: 10,
                                padding: '5px 10px', fontSize: '0.75rem', fontWeight: 900,
                                color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap',
                            }}
                        >
                            {isRTL ? '📝 ابدأ بنموذج جاهز' : '📝 Start from a template'}
                        </button>
                    </div>
                    <textarea
                        style={field}
                        value={policy}
                        maxLength={MAX}
                        onChange={e => setPolicy(e.target.value.slice(0, MAX))}
                        placeholder={isRTL
                            ? 'مثال: الاستبدال خلال ٣ أيام بالفاتورة وبحالته الأصلية وبكامل تغليفه. لا استرداد نقدي على المنتجات الغذائية أو المخفّضة. يتحمّل المشتري تكلفة الإرجاع.'
                            : 'e.g. Exchange within 3 days with the receipt, unused and in original packaging. No cash refunds on food or discounted items.'}
                    />
                    <div style={hint}>{policy.length}/{MAX}</div>

                    <label style={{ ...label, marginTop: 14 }}>{isRTL ? 'شروط إضافية (اختياري)' : 'Additional terms (optional)'}</label>
                    <textarea
                        style={field}
                        value={terms}
                        maxLength={MAX}
                        onChange={e => setTerms(e.target.value.slice(0, MAX))}
                        placeholder={isRTL
                            ? 'مثال: الضمان سنة على الأجهزة من تاريخ الفاتورة. الطلبات الخاصة تحتاج ٤٨ ساعة تجهيز. التوصيل داخل المدينة فقط.'
                            : 'e.g. One-year warranty on devices. Custom orders need 48h. Delivery inside the city only.'}
                    />
                    <div style={hint}>{terms.length}/{MAX}</div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                        <button
                            disabled={busy || !dirty}
                            onClick={async () => {
                                setBusy(true);
                                const res = await refundRepository.savePolicies(policy, terms);
                                setBusy(false);
                                if (!res.ok) { await customAlert('❌ ' + (res.error || '')); return; }
                                setSaved({ p: policy.trim(), t: terms.trim() });
                                notifySetupGapsChanged();
                                await customAlert(isRTL
                                    ? '✅ حُفظت. تظهر الآن للمشتري في صفحة متجرك وفي كل عروضك قبل الحجز.'
                                    : '✅ Saved. Buyers now see it on your store page and every deal before booking.');
                            }}
                            style={{
                                padding: '10px 22px', borderRadius: 12, border: 'none',
                                background: (busy || !dirty) ? 'var(--gray-400)' : 'linear-gradient(135deg,#10b981,#059669)',
                                color: '#fff', fontWeight: 900, fontSize: '0.8rem',
                                cursor: (busy || !dirty) ? 'default' : 'pointer',
                            }}
                        >
                            {busy ? (isRTL ? 'جارٍ الحفظ…' : 'Saving…') : dirty ? (isRTL ? '💾 حفظ' : '💾 Save') : (isRTL ? '✓ محفوظة' : '✓ Saved')}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StorePoliciesCard;
