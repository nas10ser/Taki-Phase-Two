/**
 * RegistryPanel — ما قالته واثق، لا ما نظنّه (v15.30)
 * ═══════════════════════════════════════════════════════════════════════════
 * بطاقةٌ داخل شاشة المراجعة تعرض **جواب سجلّ وزارة التجارة** عن هذا الرقم:
 * هل وُجد؟ هل سارٍ؟ ما اسمُه النظاميّ؟ ومتى يستحقّ تأكيدُه السنويّ؟
 *
 * ── ثلاثةُ قراراتٍ مقصودة ─────────────────────────────────────────────────
 * • 🔴 **لا حُكمَ آليّ.** تُعرض الحقائقُ ويبقى القرارُ للمراجع. وسببُه قياسيّ:
 *   جدولُ التوثيق فيه صفرُ صفٍّ اليوم، فلا سلوكَ مقيساً يُبنى عليه رفضٌ آليّ —
 *   ورفضُ تاجرٍ حقيقيٍّ خطأً أغلى من ثلاثين ثانيةً من نظر إنسان.
 * • 🔴 **تطابقُ الاسم يُعرض ولا يُعتمد**: تطبيعُ الأسماء العربية يُخطئ في
 *   الاتجاهين («الراشد» و«راشد»)، فالنتيجةُ معلومةٌ للمراجع لا خاتمٌ.
 * • **وغيابُ الاشتراك يُقال صراحةً** بدل بطاقةٍ فارغة تبدو عطلاً — فالفرقُ
 *   بين «لم نسأل» و«سألنا فلم نجد» هو كلُّ الفرق في هذا القرار.
 */
import React, { useEffect, useState } from 'react';
import { AdmPill } from '../ui';
import type { Tone } from '../ui';
import { wathqRepository } from '../../../repositories/verificationRepository';

const panel: React.CSSProperties = {
    background: 'var(--adm-surface-3)', border: '1px solid var(--adm-border)',
    borderRadius: 'var(--adm-r-sm)', padding: '10px 12px', display: 'grid', gap: 9,
};
const meta: React.CSSProperties = { fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)' };
const strong: React.CSSProperties = {
    fontSize: '.86rem', fontWeight: 800, color: 'var(--adm-fg)', wordBreak: 'break-word',
};
const note: React.CSSProperties = {
    fontSize: '.74rem', lineHeight: 1.8, color: 'var(--adm-fg-2)', fontWeight: 600,
};

const Line: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div style={{ display: 'grid', gap: 3 }}>
        <span style={meta}>{label}</span>
        <span style={strong}>{children}</span>
    </div>
);

/** تاريخٌ بالميلاديّ وحده — والهجريُّ لا يُحوَّل لأن وثيقتَي واثق تنشران ترتيبين متعاكسين. */
const fmt = (d: string | null | undefined): string => (d ? String(d).slice(0, 10) : '—');

export const RegistryPanel: React.FC<{ verId: string; docKind: string }> = ({ verId, docKind }) => {
    const [d, setD] = useState<any>(null);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(true);

    useEffect(() => {
        let dead = false;
        (async () => {
            setBusy(true);
            const r = await wathqRepository.registry(verId);
            if (dead) return;
            if (!r.ok) setErr(r.error || 'تعذّر القراءة');
            else setD(r.data);
            setBusy(false);
        })();
        return () => { dead = true; };
    }, [verId]);

    // واثق سجلٌّ تجاريّ فقط — ولا واجهةَ لوثيقة العمل الحر ولا لمنصّة الأعمال.
    if (docKind !== 'cr') return null;
    if (busy) return <div style={{ ...panel, ...note }}>⏳ أقرأ سجل وزارة التجارة…</div>;
    if (err) return <div style={{ ...panel, ...note }}>⚠️ {err}</div>;
    if (!d) return null;

    if (!d.subscribed) {
        return (
            <div style={panel}>
                <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                    <AdmPill tone="neutral">🏛 سجل وزارة التجارة</AdmPill>
                    <AdmPill tone="warn">لا اشتراك بعد</AdmPill>
                </div>
                <div style={note}>
                    لم نسأل السجلَّ عن هذا الرقم — اشتراكُ «واثق» غير مُسجَّلٍ بعد.
                    وهذا ليس عطلاً: المراجعةُ تمضي يدوياً كما هي، وزرُّ «افتح السجل
                    الرسمي» أعلاه يفتح الاستعلامَ المجّانيّ.
                </div>
            </div>
        );
    }

    const r = d.registry || null;
    const found = r?.found === true;
    const active = r?.active === true;
    const tone: Tone = !r ? 'neutral' : (!found ? 'bad' : (active ? 'ok' : 'warn'));
    const label = !r ? 'لم يُسأل بعد' : (!found ? 'الرقم غير موجود' : (active ? 'سارٍ' : 'غير سارٍ'));

    const owners: string[] = Array.isArray(r?.owner_names) ? r.owner_names : [];
    const nameMatch = r?.owner_name_match;

    return (
        <div style={panel}>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                <AdmPill tone="neutral">🏛 سجل وزارة التجارة</AdmPill>
                <AdmPill tone={tone}>{label}</AdmPill>
                {d.env === 'sandbox' && <AdmPill tone="warn">بيئةُ اختبار</AdmPill>}
                {r?.registry_at && <span style={meta}>{fmt(d.registry_at)}</span>}
            </div>

            {!r && (
                <div style={note}>
                    الطلبُ في الطابور — يُسأل السجلُّ خلال دقيقة. (الاستعلامُ عن الحالة
                    مجّانيّ، فلا كلفةَ على هذه القراءة.)
                </div>
            )}

            {r && !found && (
                <div style={note}>
                    سألنا السجلَّ عن <span dir="ltr">{r.asked || '—'}</span> فلم يجده.
                    🪤 والإنتاجُ في واثق يطلب <strong>الرقم الوطنيّ الموحّد</strong> (يبدأ
                    بـ٧)؛ وقد حاولنا تحويلَ رقم السجل العشَريّ تلقائياً. فإن كان الرقمُ
                    صحيحاً في نظر التاجر فالأرجحُ أنه كتبه خطأً — أو أن السجلَّ مشطوب.
                </div>
            )}

            {r && found && (
                <>
                    {r.status_name && <Line label="حالةُ السجل كما يقولها السجلّ">{r.status_name}</Line>}
                    {d.cr_national && (
                        <Line label="الرقم الوطنيّ الموحّد">
                            <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>{d.cr_national}</span>
                        </Line>
                    )}
                    {r.confirmation_date && <Line label="آخرُ تأكيدٍ سنويّ">{fmt(r.confirmation_date)}</Line>}
                    {d.confirmation_due && <Line label="يستحقّ التأكيدَ السنويّ في">{fmt(d.confirmation_due)}</Line>}
                    {r.suspension_date && <Line label="تاريخُ التعليق">{fmt(r.suspension_date)}</Line>}

                    {owners.length > 0 && (
                        <div style={{ display: 'grid', gap: 4 }}>
                            <span style={meta}>المُلّاك في السجل</span>
                            {owners.map((o, i) => (
                                <span key={i} style={{ ...strong, fontSize: '.8rem' }}>• {o}</span>
                            ))}
                            <div style={note}>
                                {nameMatch === true
                                    ? '✅ أحدُ أسماء المُلّاك يطابق الاسمَ النظاميّ المُدّعى — وهي قرينةٌ لا إثباتُ هويّة.'
                                    : '⚠️ لا اسمَ من المُلّاك يطابق الاسمَ المُدّعى. قارِن بعينك: تطبيعُ الأسماء العربية يُخطئ في الاتجاهين.'}
                            </div>
                        </div>
                    )}

                    <div style={note}>
                        🪤 هذا يُثبت <strong>السجلَّ</strong> لا <strong>الشخص</strong>: لا تملك
                        المنصّةُ دخولَ نفاذ، فمن كتب الرقمَ قد لا يكون صاحبَه. ولإثبات
                        الشخص يلزم نفاذ.
                    </div>
                </>
            )}

            <div style={{ ...meta, borderTop: '1px solid var(--adm-border)', paddingTop: 7 }}>
                صُرف هذا الشهر: {Number(d.spent_this_month_sar || 0).toFixed(2)} من{' '}
                {Number(d.monthly_cap_sar || 0).toFixed(2)} ريال
                {d.check_owners === false && ' · فحصُ المُلّاك مطفأ (مدفوع)'}
            </div>
        </div>
    );
};

export default RegistryPanel;
