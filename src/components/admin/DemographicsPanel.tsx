import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';

/**
 * DemographicsPanel — جمهورُ المنصّة: الجنس × الفئة العمرية × مدينة الشراء
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 طلبُ ناصر: «أريد تحليلاً شاملاً في النمو … أستطيع فلترة الأعمار والذكور
 *    أو الإناث ومدنهم … لتحليل سلوك المستهلكين».
 *
 * 🔴 **وتصحيحٌ معروضٌ للمستخدم لا مخبوءٌ في كود**: «مدينة المستخدم» غير
 *    مخزَّنة في المنصّة إطلاقاً (قِيس: صفرُ عمودِ مدينةٍ في `users`، وصفرُ صفٍّ
 *    بمدينةٍ في `delivery_address`). فالمدينةُ هنا **مشتقّةٌ من حيث يشتري**
 *    — وتُسمّى «مدينة الشراء» صراحةً كي لا تُقرأ على أنها مكانُ سكنه.
 *
 * 🪤 والفلترةُ تقع في المتصفّح على مصفوفةٍ كاملةٍ في الذاكرة (الأعدادُ مجمّعةٌ
 *    أصلاً وصغيرة) — لا استعلامَ جديد لكلّ ضغطة. والعدّاداتُ العلويّة تبقى على
 *    **الكلّ** ولا تتبع الفلتر: رقمٌ يتبدّل لمجرّد ضغطةٍ يُربك قارئه.
 */

const arNum = (n: unknown) => (Number(n) || 0).toLocaleString('ar-SA');
const GENDER_AR: Record<string, string> = { male: 'ذكر', female: 'أنثى', unknown: 'لم يُجب' };
const BAND_ORDER = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+', 'unknown'];

type Cell = { g: string; band: string; n: number };

const chip = (active: boolean): React.CSSProperties => ({
    padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
    fontSize: '0.74rem', fontWeight: 800,
    border: `1px solid ${active ? 'var(--primary)' : 'var(--border-color)'}`,
    background: active ? 'var(--primary)' : 'var(--card-bg)',
    color: active ? '#fff' : 'var(--text-primary)',
});

const Bar: React.FC<{ label: string; n: number; total: number }> = ({ label, n, total }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
        <span style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--text-primary)', minWidth: 72 }}>{label}</span>
        <div style={{ flex: 1, height: 9, borderRadius: 999, background: 'var(--gray-100)', overflow: 'hidden' }}>
            <div style={{ width: `${total > 0 ? Math.round((n / total) * 100) : 0}%`, height: '100%', background: 'var(--primary)' }} />
        </div>
        <span style={{ fontSize: '0.76rem', fontWeight: 900, color: 'var(--text-primary)', minWidth: 34, textAlign: 'left' }}>{arNum(n)}</span>
    </div>
);

export const DemographicsPanel: React.FC = () => {
    const [data, setData] = useState<Record<string, any> | null>(null);
    const [err, setErr] = useState('');
    const [loading, setLoading] = useState(true);
    const [fg, setFg] = useState<string>('');      // فلتر الجنس
    const [fb, setFb] = useState<string>('');      // فلتر الفئة العمرية

    const load = useCallback(async () => {
        const { data: d, error } = await supabase.rpc('admin_demographics', { p_days: 0 });
        if (error) setErr(error.message || 'تعذّر جلب تحليل الجمهور');
        else { setErr(''); setData(d as Record<string, any>); }
        setLoading(false);
    }, []);
    useEffect(() => { load(); }, [load]);

    const total = Number(data?.total) || 0;
    const answeredG = Number(data?.answered?.gender) || 0;
    const answeredA = Number(data?.answered?.age) || 0;
    const matrix: Cell[] = data?.matrix || [];
    const cities: Array<{ city: string; n: number }> = data?.cities || [];

    // الفلترةُ على المصفوفة — والمجموعُ يُعاد حسابه منها لا من `total`.
    const shown = matrix.filter((c) => (!fg || c.g === fg) && (!fb || c.band === fb));
    const shownN = shown.reduce((a, c) => a + (Number(c.n) || 0), 0);

    const byBand = BAND_ORDER
        .map((b) => ({ b, n: shown.filter((c) => c.band === b).reduce((a, c) => a + (Number(c.n) || 0), 0) }))
        .filter((r) => r.n > 0);
    const byGender = ['male', 'female', 'unknown']
        .map((g) => ({ g, n: shown.filter((c) => c.g === g).reduce((a, c) => a + (Number(c.n) || 0), 0) }))
        .filter((r) => r.n > 0);

    if (loading) {
        return <div style={{ padding: 16, textAlign: 'center', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-secondary)' }}>جارِ الحساب…</div>;
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 900, color: 'var(--text-primary)', margin: '0 0 3px' }}>👥 جمهور المنصّة</h3>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.8 }}>
                    من إجابات التسجيل الاختيارية. المشترون وحدهم، بلا المحذوفين.
                </div>
            </div>

            {err && (
                <div style={{ background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.35)', borderRadius: 12, padding: '9px 12px', fontSize: '0.78rem', fontWeight: 800 }}>
                    ⚠️ {err}
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 8 }}>
                {[
                    { k: 'مشترون', v: total, h: 'كل الحسابات' },
                    { k: 'أجابوا عن الجنس', v: answeredG, h: `${total > 0 ? Math.round((answeredG / total) * 100) : 0}٪` },
                    { k: 'أجابوا عن العمر', v: answeredA, h: `${total > 0 ? Math.round((answeredA / total) * 100) : 0}٪` },
                ].map((c) => (
                    <div key={c.k} style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '10px 12px' }}>
                        <div style={{ fontSize: '1.3rem', fontWeight: 900, color: 'var(--text-primary)' }}>{arNum(c.v)}</div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-primary)' }}>{c.k}</div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-secondary)' }}>{c.h}</div>
                    </div>
                ))}
            </div>

            {answeredG === 0 && answeredA === 0 ? (
                <div style={{ background: 'var(--card-bg)', border: '1px dashed var(--border-color)', borderRadius: 16, padding: 20, textAlign: 'center' }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 800, color: 'var(--text-primary)' }}>لا إجابات بعد</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: 6, lineHeight: 1.8 }}>
                        السؤالان أُضيفا في هذا الإصدار، فتمتلئ هذه الشاشة مع كلّ تسجيلٍ جديد. والحسابات القائمة لم تُسأل.
                    </div>
                </div>
            ) : (
                <>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)' }}>فلترة:</span>
                        {['male', 'female'].map((g) => (
                            <button key={g} type="button" style={chip(fg === g)} onClick={() => setFg(fg === g ? '' : g)}>{GENDER_AR[g]}</button>
                        ))}
                        {BAND_ORDER.filter((b) => b !== 'unknown').map((b) => (
                            <button key={b} type="button" style={{ ...chip(fb === b), direction: 'ltr' }} onClick={() => setFb(fb === b ? '' : b)}>{b}</button>
                        ))}
                        {(fg || fb) && (
                            <button type="button" style={chip(false)} onClick={() => { setFg(''); setFb(''); }}>✕ مسح</button>
                        )}
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                            المطابق: {arNum(shownN)}
                        </span>
                    </div>

                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-primary)' }}>حسب الفئة العمرية</div>
                        {byBand.length === 0
                            ? <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', fontWeight: 700 }}>لا مطابق.</div>
                            : byBand.map((r) => <Bar key={r.b} label={r.b === 'unknown' ? 'لم يُجب' : r.b} n={r.n} total={shownN} />)}
                    </div>

                    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
                        <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-primary)' }}>حسب الجنس</div>
                        {byGender.length === 0
                            ? <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', fontWeight: 700 }}>لا مطابق.</div>
                            : byGender.map((r) => <Bar key={r.g} label={GENDER_AR[r.g]} n={r.n} total={shownN} />)}
                    </div>
                </>
            )}

            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 900, color: 'var(--text-primary)' }}>مدينة الشراء</div>
                {/* 🔴 إفصاحٌ ظاهر: المدينةُ **مشتقّة** لا مُصرَّحٌ بها — المنصّة لا تسأل عنها. */}
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 600, lineHeight: 1.8 }}>
                    نحن لا نسأل المستخدم عن مدينته. هذه مُشتقّة من مدينة العروض التي حجزها فعلاً — فهي «أين يشتري» لا «أين يسكن».
                </div>
                {cities.length === 0
                    ? <div style={{ fontSize: '0.76rem', color: 'var(--text-secondary)', fontWeight: 700 }}>لا حجوزات بعد.</div>
                    : cities.map((c) => (
                        <Bar key={c.city} label={c.city === 'unknown' ? 'غير معروفة' : c.city} n={Number(c.n) || 0} total={total} />
                    ))}
            </div>
        </div>
    );
};

export default DemographicsPanel;
