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

const MAX = 1500;

export const StorePoliciesCard: React.FC = () => {
    const { user, language, customAlert } = useApp();
    const isRTL = language === 'ar';
    const [policy, setPolicy] = useState('');
    const [terms, setTerms] = useState('');
    const [saved, setSaved] = useState({ p: '', t: '' });
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);

    const load = useCallback(async () => {
        if (!user?.id) return;
        const r = await refundRepository.storePolicies(user.id);
        const p = r?.refundPolicy || '';
        const t = r?.storeTerms || '';
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
        fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)',
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
                    <div style={{ fontWeight: 700, fontSize: '0.74rem', color: empty ? '#b45309' : 'var(--text-secondary)', marginTop: 3 }}>
                        {empty
                            ? (isRTL ? '⚠️ لم تكتبها بعد — المشتري لا يرى شيئاً قبل الحجز' : '⚠️ Not written yet — buyers see nothing before booking')
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
                        fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.9,
                    }}>
                        {isRTL
                            ? 'ما تكتبه هنا يراه المشتري قبل الحجز، وهو مرجعك حين يطلب استرداداً. تاكي وسيطٌ لا تفرض سياسة ولا تبتّ فيها: الاسترداد والاستبدال بينك وبين المشتري.'
                            : 'What you write here is shown to buyers before they book, and it is your reference when they request a refund. TAKI is an intermediary: it neither imposes nor adjudicates store policies.'}
                    </div>

                    <label style={label}>{isRTL ? 'سياسة الاسترداد والاستبدال' : 'Refund & exchange policy'}</label>
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
