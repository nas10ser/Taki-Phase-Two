/**
 * DupAttemptsCard — خانةُ «محاولات برقمٍ مستعمل» (v16.52)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر (٢٠ نوفمبر ٢٠٢٦): «في حال أراد شخصٌ إضافةَ وثيقةٍ وهي مضافة فلا
 * يُسمح له بالإضافة، ويأتي الأدمنَ تنبيهٌ في خانةٍ داخل حسابه ليتحقّق».
 *
 * 🔴 ولماذا خانةٌ لا إشعارٌ وحده: الإشعارُ يُقرأ ويُنسى، والمحاولةُ قد تكون
 *    انتحالاً يستحقّ قراراً. فما يحتاج قراراً يحتاج **طابوراً** له حالة.
 *
 * 🪤 والصفُّ واحدٌ لكلّ (متجر × نوع × رقم) وعدّادُه يزيد: محاولةٌ مكرّرةٌ لا
 *    تُغرق الخانةَ ولا تُعيد الإشعار — وإنذارٌ يتكرّر بلا جديدٍ يُدرّب على
 *    تجاهل القناة التي يجب أن تصرخ يومَ يقع عطلٌ حقيقيّ (درس v15.24).
 *
 * 🪤 ولا يُعرض الرقمُ كاملاً: هو رقمُ وثيقةِ **متجرٍ آخر**، وعرضُه كاملاً في
 *    شاشةٍ قد يراها أدمنٌ فرعيّ تسريبٌ لا داعيَ له. يُعرض مقنَّعاً، والمراجعُ
 *    يقارن الطرفين بالاسم والمتجر — وهو ما يحتاجه ليقرّر.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../../context/AppContext';
import { AdmSection, AdmButton, AdmPill, AdmEmpty, AdmError, AdmSkeleton } from '../ui';
import { admCount } from '../ui/adminForms';
import { TIMES } from '../../../utils/arPlural';
import { verificationRepository, DupAttempt, docKindInfo } from '../../../repositories/verificationRepository';

type Tab = 'open' | 'reviewed' | 'dismissed' | 'all';

const TABS: { id: Tab; label: string }[] = [
    { id: 'open', label: 'بانتظارك' },
    { id: 'reviewed', label: 'راجعتها' },
    { id: 'dismissed', label: 'مستبعَدة' },
    { id: 'all', label: 'الكل' },
];

/** `1010543210` ⇒ `1010••3210` — يكفي للمقارنة ولا يكشف الرقم. */
const maskNum = (n: string) => {
    const s = String(n || '');
    return s.length <= 8 ? s : `${s.slice(0, 4)}${'•'.repeat(Math.min(6, s.length - 8))}${s.slice(-4)}`;
};

const when = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ar-SA-u-ca-gregory', {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
};

export const DupAttemptsCard: React.FC = () => {
    const { customAlert, customPrompt } = useApp();
    const [tab, setTab] = useState<Tab>('open');
    const [rows, setRows] = useState<DupAttempt[] | null>(null);
    const [openCount, setOpenCount] = useState(0);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        setErr('');
        const r = await verificationRepository.adminDupAttempts(tab);
        if (!r.ok) { setErr(r.msg || 'تعذّرت قراءة الخانة.'); setRows(null); return; }
        setRows(r.rows || []);
        setOpenCount(r.open || 0);
    }, [tab]);

    useEffect(() => { load(); }, [load]);

    const decide = async (row: DupAttempt, action: 'reviewed' | 'dismissed' | 'open') => {
        let note: string | null = null;
        if (action !== 'open') {
            // 🪤 الملاحظةُ اختيارية: إلزامُها يجعل الأدمنَ يكتب «.» ليمرّ، فلا
            //    تُفيد. لكنّها تُحفظ حين تُكتب — فيعرف مراجعٌ لاحقٌ لماذا.
            note = await customPrompt(action === 'reviewed'
                ? 'ماذا تبيّن؟ (اختياري — يُحفظ مع السجل)'
                : 'لماذا استُبعدت؟ (اختياري)');
            if (note === null) return;   // ألغى
        }
        setBusy(row.id);
        const r = await verificationRepository.adminResolveDup(row.id, action, note || undefined);
        setBusy('');
        if (!r.ok) { await customAlert('❌ ' + (r.msg || 'تعذّر الحفظ.')); return; }
        await load();
    };

    const body = () => {
        if (err) return <AdmError message={err} onRetry={load} />;
        if (rows === null) return <AdmSkeleton rows={2} />;
        if (rows.length === 0) {
            return (
                <AdmEmpty
                    icon="✅"
                    title={tab === 'open' ? 'لا محاولةَ تنتظرك' : 'لا شيء هنا'}
                    hint={tab === 'open'
                        ? 'كلُّ محاولةٍ برقمٍ يخصّ متجراً آخر تظهر هنا — ولا شيء الآن.'
                        : 'جرّب تبويباً آخر.'} />
            );
        }
        return (
            <div style={{ display: 'grid', gap: 10 }}>
                {rows.map(r => {
                    const info = docKindInfo(r.docKind);
                    return (
                        <div key={r.id} style={{
                            padding: 12, borderRadius: 'var(--adm-r-sm)',
                            border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                                <AdmPill tone={r.status === 'open' ? 'warn' : r.status === 'reviewed' ? 'ok' : undefined}>
                                    {r.status === 'open' ? '⏳ بانتظارك' : r.status === 'reviewed' ? '✅ روجعت' : '🚫 مستبعَدة'}
                                </AdmPill>
                                <AdmPill>{info?.ar || r.docKind}</AdmPill>
                                {/* 🪤 ولا يُصاغ المعدودُ بيد: «٢ مرّات» خطأٌ نحويّ،
                                    و`admCount` هي المكانُ الوحيد (أمسكه حارسُ
                                    الجمع العربيّ في أوّل تشغيل). */}
                                {r.attempts > 1 && <AdmPill tone="warn">{`حاول ${admCount(r.attempts, TIMES)}`}</AdmPill>}
                            </div>

                            <div style={{ fontSize: '.82rem', fontWeight: 800, color: 'var(--adm-fg)', lineHeight: 1.8 }}>
                                «{r.shop || r.ownerName || 'متجر'}» حاول التوثيق بالرقم{' '}
                                <span dir="ltr" style={{ fontFamily: 'monospace' }}>{maskNum(r.docNumber)}</span>
                            </div>
                            <div style={{ fontSize: '.75rem', lineHeight: 1.85, color: 'var(--adm-fg-2)', marginTop: 4 }}>
                                والرقمُ {r.heldStatus === 'approved' ? 'موثَّقٌ فعلاً' : 'على طلبٍ مفتوحٍ سبقه'} لمتجر
                                {' '}«{r.heldByShop || '—'}».
                            </div>
                            {r.claimedName && (
                                <div style={{ fontSize: '.73rem', color: 'var(--adm-fg-3)', marginTop: 3 }}>
                                    الاسمُ الذي كتبه: {r.claimedName}
                                </div>
                            )}
                            <div style={{ fontSize: '.71rem', color: 'var(--adm-fg-3)', marginTop: 5 }}>
                                آخرُ محاولة: {when(r.lastAt)}
                                {r.ownerPhone ? <> · جوّاله: <span dir="ltr">{r.ownerPhone}</span></> : null}
                            </div>
                            {r.adminNote && (
                                <div style={{ fontSize: '.73rem', color: 'var(--adm-fg-2)', marginTop: 5, lineHeight: 1.8 }}>
                                    📝 {r.adminNote}
                                </div>
                            )}

                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 9 }}>
                                {r.status === 'open' ? (
                                    <>
                                        <AdmButton variant="primary" disabled={busy === r.id}
                                            onClick={() => decide(r, 'reviewed')}>
                                            {busy === r.id ? 'جارٍ…' : '✅ راجعتها'}
                                        </AdmButton>
                                        <AdmButton disabled={busy === r.id} onClick={() => decide(r, 'dismissed')}>
                                            🚫 استبعِدها
                                        </AdmButton>
                                    </>
                                ) : (
                                    <AdmButton disabled={busy === r.id} onClick={() => decide(r, 'open')}>
                                        ↩️ أعِدها للطابور
                                    </AdmButton>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>
        );
    };

    return (
        <AdmSection
            title={openCount > 0 ? `محاولات برقمٍ مستعمل (${openCount})` : 'محاولات برقمٍ مستعمل'}
            icon="🚨"
            desc="رقمُ وثيقةٍ يخصّ متجراً آخر: مُنع التاجرُ من إرساله، وسُجّلت المحاولة هنا لتتحقّق."
            collapsible
            defaultOpen={openCount > 0}
        >
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 11 }}>
                {TABS.map(x => (
                    <AdmButton key={x.id} variant={tab === x.id ? 'primary' : undefined}
                        onClick={() => { setRows(null); setTab(x.id); }}>
                        {x.label}
                    </AdmButton>
                ))}
            </div>
            {body()}
        </AdmSection>
    );
};
