/**
 * AdminOutageCredits — «🎁 تعويض الأعطال» (v16.54)
 * ═══════════════════════════════════════════════════════════════════════════
 * أمرُ ناصر: «زرّ إرجاع المبلغ بضغطةٍ واحدة من الأدمن للتاجر، أو أحدّد تجّاراً
 * معيّنين، أو تحديد الكل، في حال وجود أعطال».
 *
 * 🔴 **المعاينةُ قبل التنفيذ ليست تجميلاً**: الزرُّ يمسّ كلَّ التجّار بضغطة،
 *    والعددُ والمجموعُ يُقاسان على **الخادم** ويُعرضان قبل أن يُضغط — فلا
 *    يُقرَّر على رقمٍ بناه المتصفّح. (نفسُ قاعدة «القياس أوّلاً» في كنس
 *    العروض غير الموثّقة: `dryRun` يعدّ ولا يلمس.)
 *
 * 🪤 **مفتاحُ التكرار يُولَّد عند فتح النموذج لا عند الضغط.** لو وُلِّد عند
 *    الضغط لصار لكلّ ضغطةٍ مفتاحٌ جديد — أي لا حمايةَ من الضغطتين أصلاً،
 *    وهو بالضبط الشكلُ الذي يبدو فيه الحارسُ قائماً وهو عاطل.
 *
 * 🪤 ونوعُ «مبلغ» لا يقول «رُدّ»: المبلغُ يُسجَّل **مستحقّاً** ويُشعَر به
 *    التاجر، ويُختم «حُوِّل» بمرجعٍ بنكيٍّ بعد التحويل. وقِيس أن تاكي لم
 *    تستقبل ريالاً من تاجرٍ قطّ (مسارُ الدفع محاكاة)، فلا بوّابةَ تردّ عبرها.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
    AdmPageHeader, AdmSection, AdmButton, AdmPill, AdmEmpty, AdmError, AdmSkeleton, AdmStat, AdmStatGrid,
} from '../../components/admin/ui';
import { admCount, MERCHANTS } from '../../components/admin/ui/adminForms';
import { DAYS } from '../../utils/arPlural';
import { normalizeArabicNumerals } from '../../utils/helpers';
import {
    outageCreditRepository, creditErrorText,
    CreditScope, CreditKind, CreditRow, CreditPreview, ScopeRow,
} from '../../repositories/outageCreditRepository';

const SCOPES: { id: CreditScope; label: string; hint: string }[] = [
    { id: 'subscribed', label: 'المشتركون', hint: 'من له اشتراكٌ سارٍ الآن — وهم من تضرّروا بالعطل فعلاً' },
    { id: 'all',        label: 'كل التجّار', hint: 'كل حسابات المتاجر، بما فيها من لا اشتراكَ له' },
    { id: 'selected',   label: 'تجّارٌ أحدّدهم', hint: 'تختارهم من القائمة أدناه' },
];

const fmtSar = (n: number) => `${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`;

const when = (iso: string | null) => {
    if (!iso) return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ar-SA-u-ca-gregory',
        { year: 'numeric', month: 'short', day: 'numeric' });
};

export const AdminOutageCredits: React.FC = () => {
    const { customAlert, customConfirm, customPrompt } = useApp();

    const [scope, setScope] = useState<CreditScope>('subscribed');
    const [kind, setKind] = useState<CreditKind>('days');
    const [days, setDays] = useState('7');
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [picked, setPicked] = useState<string[]>([]);

    const [preview, setPreview] = useState<CreditPreview | null>(null);
    const [pvErr, setPvErr] = useState('');
    const [rows, setRows] = useState<CreditRow[] | null>(null);
    const [pendingCash, setPendingCash] = useState(0);
    const [pendingAmount, setPendingAmount] = useState(0);
    const [busy, setBusy] = useState('');
    const [listErr, setListErr] = useState('');

    /**
     * 🔴 يُولَّد **مرّةً** مع المكوّن، ويتجدّد بعد كلّ منحٍ ناجحٍ وحده.
     *    فضغطتان متتاليتان تحملان نفسَ المفتاح ⇒ دفعةٌ واحدة في القاعدة.
     */
    const [batchKey, setBatchKey] = useState(() =>
        `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);

    const nDays = Math.round(Number(normalizeArabicNumerals(days)) || 0);
    const nAmount = Math.round((Number(normalizeArabicNumerals(amount)) || 0) * 100) / 100;

    const loadList = useCallback(async () => {
        setListErr('');
        const r = await outageCreditRepository.list('all');
        if (!r.ok) { setListErr(r.msg || 'تعذّرت قراءة السجلّ.'); setRows(null); return; }
        setRows(r.rows || []);
        setPendingCash(r.pendingCash || 0);
        setPendingAmount(r.pendingAmount || 0);
    }, []);

    const loadPreview = useCallback(async () => {
        setPvErr('');
        const r = await outageCreditRepository.preview(
            scope, scope === 'selected' ? picked : null, kind,
            kind === 'days' ? nDays : null, kind === 'cash' ? nAmount : null);
        if (!r.ok) {
            setPvErr(creditErrorText(r.error) || r.msg || 'تعذّرت المعاينة.');
            setPreview(null); return;
        }
        setPreview(r.data || null);
    }, [scope, picked, kind, nDays, nAmount]);

    useEffect(() => { loadList(); }, [loadList]);
    useEffect(() => { loadPreview(); }, [loadPreview]);

    /** قائمةُ الاختيار: تُقرأ من نفس معاينة «كل التجّار» فلا مصدرَ ثانٍ. */
    const [allRows, setAllRows] = useState<ScopeRow[] | null>(null);
    useEffect(() => {
        if (scope !== 'selected' || allRows) return;
        (async () => {
            const r = await outageCreditRepository.preview('all', null, 'days', 1, null);
            if (r.ok) setAllRows(r.data?.rows || []);
        })();
    }, [scope, allRows]);

    const ready = useMemo(() => {
        if (reason.trim().length < 10) return false;
        if (scope === 'selected' && picked.length === 0) return false;
        if (kind === 'days') return nDays >= 1 && nDays <= 365;
        return nAmount > 0 && nAmount <= 50000;
    }, [reason, scope, picked, kind, nDays, nAmount]);

    const grant = async () => {
        if (!ready || !preview) return;
        const who = admCount(scope === 'selected' ? picked.length : preview.count, MERCHANTS);
        const what = kind === 'days'
            ? `إضافة ${admCount(nDays, DAYS)} إلى اشتراك كلٍّ منهم`
            : `تسجيل ${fmtSar(nAmount)} مستحقّاً لكلٍّ منهم (المجموع ${fmtSar(preview.totalAmount || 0)})`;
        const tail = kind === 'days'
            ? 'تُضاف فوق رصيدهم الباقي ولا تستبدله. ولا تراجع بعد التنفيذ.'
            : 'لا يُخصم شيءٌ الآن: يُسجَّل المبلغ ويصلهم إشعار، ثم تحوّله بنكياً وتختمه بمرجع.';

        const ok = await customConfirm(
            `🎁 تعويض الأعطال\n\n` +
            `المشمولون: ${who}\n` +
            `الإجراء: ${what}\n` +
            `السبب: ${reason.trim()}\n\n` +
            `${tail}\n\nأتابع؟`);
        if (!ok) return;

        setBusy('grant');
        const r = await outageCreditRepository.grant({
            batchKey, scope, ids: scope === 'selected' ? picked : null,
            kind, days: kind === 'days' ? nDays : null,
            amount: kind === 'cash' ? nAmount : null, reason: reason.trim(),
        });
        setBusy('');
        if (!r.ok) {
            await customAlert('❌ ' + (creditErrorText(r.error) || r.msg || 'تعذّر التنفيذ.'));
            return;
        }
        // مفتاحٌ جديد للدفعة التالية — والقديمُ يبقى محروقاً فلا يُعاد المنح به.
        setBatchKey(`${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
        setReason('');
        await customAlert(
            `✅ نُفِّذ التعويض لـ${admCount(r.granted || 0, MERCHANTS)}.` +
            (r.skipped ? `\n\nوتجاوزنا ${admCount(r.skipped, MERCHANTS)}: سبق أن شملتهم هذه الدفعة.` : '') +
            (kind === 'cash' ? '\n\nالمبالغ مسجّلةٌ «مستحقّة» — حوّلها ثم اختمها من السجلّ أدناه.' : ''));
        await Promise.all([loadList(), loadPreview()]);
    };

    const settle = async (row: CreditRow, ok: boolean) => {
        // 🪤 `customPrompt` لا `window.prompt`: النوافذُ الأصليّة قد لا تظهر
        //    داخل التطبيق المثبَّت (PWA)، فيضغط الأدمنُ ولا يحدث شيء.
        let ref = '';
        if (ok) {
            const typed = await customPrompt('مرجع التحويل البنكي (إلزامي):');
            if (typed === null) return;
            ref = typed.trim();
            if (!ref) { await customAlert('❌ ' + creditErrorText('REF_REQUIRED')); return; }
        }
        const note = await customPrompt(ok ? 'ملاحظة (اختياري):' : 'سبب التعذّر (اختياري):');
        if (note === null) return;
        setBusy(row.id);
        const r = await outageCreditRepository.settle(row.id, ok, ref || undefined, note || undefined);
        setBusy('');
        if (!r.ok) { await customAlert('❌ ' + (creditErrorText(r.error) || r.msg || 'تعذّر الحفظ.')); return; }
        await loadList();
    };

    const statusPill = (s: CreditRow['status']) =>
        s === 'applied' ? <AdmPill tone="ok">✅ طُبّق</AdmPill>
        : s === 'pending_cash' ? <AdmPill tone="warn">⏳ مستحقٌّ لم يُحوَّل</AdmPill>
        : s === 'paid' ? <AdmPill tone="ok">💸 حُوِّل</AdmPill>
        : <AdmPill tone="bad">❌ تعذّر</AdmPill>;

    return (
        <>
            <AdmPageHeader
                icon="🎁" title="تعويض الأعطال"
                desc="عند عطلٍ في المنصّة: عوّض تاجراً أو المشتركين أو الكل بضغطة — أيام اشتراكٍ تُضاف فوراً، أو مبلغ يُسجَّل مستحقّاً ثم تحوّله." />

            <AdmStatGrid cols={3}>
                <AdmStat label="مستحقٌّ لم يُحوَّل" value={String(pendingCash)} icon="⏳"
                    scope={pendingCash > 0 ? fmtSar(pendingAmount) : 'لا شيء معلّق'}
                    tone={pendingCash > 0 ? 'warn' : 'ok'} />
                <AdmStat label="ضمن النطاق الآن" value={String(preview?.count ?? 0)} icon="🏪"
                    scope={SCOPES.find(s => s.id === scope)?.label || ''} />
                <AdmStat label="سجلُّ التعويضات" value={String(rows?.length ?? 0)} icon="🧾" scope="كل ما نُفِّذ" />
            </AdmStatGrid>

            <AdmSection title="منح تعويض" icon="🎁" desc="اقرأ المعاينة قبل الضغط — العدد والمجموع يُحسبان على الخادم.">
                {/* ① من */}
                <div style={{ fontSize: '.8rem', fontWeight: 900, color: 'var(--adm-fg)', margin: '0 0 7px' }}>١) من تُعوّض؟</div>
                <div style={{ display: 'grid', gap: 7, marginBottom: 13 }}>
                    {SCOPES.map(s => (
                        <button key={s.id} type="button" onClick={() => setScope(s.id)}
                            style={{
                                textAlign: 'right', padding: '11px 13px', borderRadius: 'var(--adm-r-sm)',
                                cursor: 'pointer', fontFamily: 'inherit',
                                border: scope === s.id ? '2px solid var(--adm-accent)' : '1px solid var(--adm-border)',
                                background: scope === s.id ? 'var(--adm-surface-3)' : 'var(--adm-surface-2)',
                            }}>
                            <div style={{ fontSize: '.84rem', fontWeight: 900, color: 'var(--adm-fg)' }}>
                                <span aria-hidden="true">{scope === s.id ? '◉' : '○'}</span> {s.label}
                            </div>
                            <div style={{ fontSize: '.72rem', color: 'var(--adm-fg-3)', marginTop: 3, lineHeight: 1.7 }}>{s.hint}</div>
                        </button>
                    ))}
                </div>

                {scope === 'selected' && (
                    <div style={{ marginBottom: 13, maxHeight: 240, overflowY: 'auto',
                                  border: '1px solid var(--adm-border)', borderRadius: 'var(--adm-r-sm)', padding: 9 }}>
                        {allRows === null ? <AdmSkeleton rows={2} /> : allRows.length === 0 ? (
                            <div style={{ fontSize: '.78rem', color: 'var(--adm-fg-3)' }}>لا تجّار.</div>
                        ) : allRows.map(m => {
                            const on = picked.includes(m.merchantId);
                            return (
                                <label key={m.merchantId} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '7px 4px', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={on}
                                        onChange={() => setPicked(p => on ? p.filter(x => x !== m.merchantId) : [...p, m.merchantId])} />
                                    <span style={{ fontSize: '.82rem', fontWeight: 800, color: 'var(--adm-fg)', flex: 1 }}>{m.shop}</span>
                                    <span style={{ fontSize: '.71rem', color: 'var(--adm-fg-3)' }}>
                                        {m.expiresAt ? `ينتهي ${when(m.expiresAt)}` : 'بلا اشتراك'}
                                    </span>
                                </label>
                            );
                        })}
                    </div>
                )}

                {/* ② بماذا */}
                <div style={{ fontSize: '.8rem', fontWeight: 900, color: 'var(--adm-fg)', margin: '0 0 7px' }}>٢) بماذا تُعوّض؟</div>
                <div style={{ display: 'flex', gap: 7, marginBottom: 9, flexWrap: 'wrap' }}>
                    <AdmButton variant={kind === 'days' ? 'primary' : undefined} onClick={() => setKind('days')}>
                        📅 أيام اشتراك
                    </AdmButton>
                    <AdmButton variant={kind === 'cash' ? 'primary' : undefined} onClick={() => setKind('cash')}>
                        💸 مبلغ
                    </AdmButton>
                </div>

                {kind === 'days' ? (
                    <>
                        <input value={days} inputMode="numeric" aria-label="عدد الأيام"
                            onChange={e => setDays(normalizeArabicNumerals(e.target.value).replace(/[^0-9]/g, '').slice(0, 3))}
                            style={{ width: 130, padding: '9px 11px', borderRadius: 'var(--adm-r-sm)', fontFamily: 'inherit',
                                     border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)',
                                     color: 'var(--adm-fg)', fontWeight: 800, direction: 'ltr', textAlign: 'right' }} />
                        <div style={{ fontSize: '.73rem', color: 'var(--adm-fg-3)', marginTop: 6, lineHeight: 1.8 }}>
                            تُضاف <strong style={{ color: 'var(--adm-fg)' }}>فوق</strong> رصيد التاجر الباقي ولا تستبدله —
                            فمن له عشرون يوماً ثم عوّضتَه سبعة يصير عنده سبعةٌ وعشرون. ويصله إشعارٌ بالسبب.
                        </div>
                    </>
                ) : (
                    <>
                        <input value={amount} inputMode="decimal" aria-label="المبلغ بالريال"
                            onChange={e => setAmount(normalizeArabicNumerals(e.target.value).replace(/[^0-9.]/g, '').slice(0, 9))}
                            placeholder="مثال: 150.00"
                            style={{ width: 160, padding: '9px 11px', borderRadius: 'var(--adm-r-sm)', fontFamily: 'inherit',
                                     border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)',
                                     color: 'var(--adm-fg)', fontWeight: 800, direction: 'ltr', textAlign: 'right' }} />
                        <div style={{ fontSize: '.73rem', color: 'var(--adm-warn-fg)', marginTop: 6, lineHeight: 1.8, fontWeight: 700 }}>
                            ⚠️ لا يُخصم شيءٌ من أيّ حساب الآن: تاكي لا تحتفظ بمالٍ للتجّار (اشتراكاتهم لم تمرّ ببوّابةٍ بعد).
                            يُسجَّل المبلغ «مستحقّاً» ويصل التاجرَ إشعار، ثم تحوّله بنكياً وتختمه بمرجعٍ من السجلّ أدناه —
                            ولا يُقال للتاجر «حُوِّل» قبل ذلك.
                        </div>
                    </>
                )}

                {/* ③ لماذا */}
                <div style={{ fontSize: '.8rem', fontWeight: 900, color: 'var(--adm-fg)', margin: '13px 0 7px' }}>٣) سبب التعويض</div>
                <textarea value={reason} onChange={e => setReason(e.target.value.slice(0, 400))} rows={2}
                    aria-label="سبب التعويض"
                    placeholder="مثال: انقطاع الخدمة يوم الخميس من 2 ظهراً حتى 6 مساءً"
                    style={{ width: '100%', padding: '9px 11px', borderRadius: 'var(--adm-r-sm)', fontFamily: 'inherit',
                             border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)',
                             color: 'var(--adm-fg)', fontWeight: 700, fontSize: '.82rem', resize: 'vertical' }} />
                <div style={{ fontSize: '.72rem', color: 'var(--adm-fg-3)', marginTop: 5 }}>
                    يُحفظ في السجلّ ويصل التاجر مع الإشعار — فيعرف لماذا عُوّض. (عشرةُ محارف على الأقل.)
                </div>

                {/* المعاينة */}
                <div style={{ marginTop: 14, padding: 12, borderRadius: 'var(--adm-r-sm)',
                              border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)' }}>
                    {pvErr ? (
                        <div style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--adm-bad-fg)' }}>⚠️ {pvErr}</div>
                    ) : preview === null ? (
                        <div style={{ fontSize: '.78rem', color: 'var(--adm-fg-3)' }}>جارٍ القياس…</div>
                    ) : (
                        <div style={{ fontSize: '.82rem', fontWeight: 800, color: 'var(--adm-fg)', lineHeight: 1.9 }}>
                            👁 المعاينة: <strong>{admCount(scope === 'selected' ? picked.length : preview.count, MERCHANTS)}</strong>
                            {kind === 'days'
                                ? <> — لكلٍّ منهم <strong>{admCount(nDays, DAYS)}</strong></>
                                : <> — لكلٍّ منهم <strong>{fmtSar(nAmount)}</strong>، والمجموع{' '}
                                    <strong>{fmtSar(scope === 'selected' ? nAmount * picked.length : (preview.totalAmount || 0))}</strong></>}
                        </div>
                    )}
                </div>

                <div style={{ marginTop: 12 }}>
                    <AdmButton variant="primary" disabled={!ready || !!busy || !preview} onClick={grant}>
                        {busy === 'grant' ? 'جارٍ التنفيذ…' : '🎁 نفّذ التعويض'}
                    </AdmButton>
                    {!ready && (
                        <div style={{ fontSize: '.73rem', color: 'var(--adm-fg-3)', marginTop: 7 }}>
                            {reason.trim().length < 10
                                ? 'اكتب السبب أوّلاً (عشرةُ محارف على الأقل).'
                                : scope === 'selected' && picked.length === 0
                                    ? 'اختر تاجراً واحداً على الأقل.'
                                    : kind === 'days' ? 'عدد الأيام بين ١ و٣٦٥.' : 'المبلغ بين ٠٫٠١ و٥٠٬٠٠٠ ر.س.'}
                        </div>
                    )}
                </div>
            </AdmSection>

            <AdmSection title="السجلّ" icon="🧾" desc="كل تعويضٍ نُفِّذ، ومن ينتظر تحويلاً." collapsible defaultOpen={pendingCash > 0}>
                {listErr ? <AdmError message={listErr} onRetry={loadList} />
                 : rows === null ? <AdmSkeleton rows={3} />
                 : rows.length === 0 ? <AdmEmpty icon="🧾" title="لا تعويضات بعد" hint="كل ما تمنحه يظهر هنا بسببه وأثره." />
                 : (
                    <div style={{ display: 'grid', gap: 9 }}>
                        {rows.map(r => (
                            <div key={r.id} style={{ padding: 11, borderRadius: 'var(--adm-r-sm)',
                                                     border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)' }}>
                                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center', marginBottom: 5 }}>
                                    {statusPill(r.status)}
                                    <AdmPill>{r.kind === 'days' ? `📅 ${admCount(r.days || 0, DAYS)}` : `💸 ${fmtSar(r.amount || 0)}`}</AdmPill>
                                </div>
                                <div style={{ fontSize: '.84rem', fontWeight: 900, color: 'var(--adm-fg)' }}>{r.shop}</div>
                                <div style={{ fontSize: '.74rem', color: 'var(--adm-fg-2)', marginTop: 3, lineHeight: 1.8 }}>
                                    {r.reason}
                                </div>
                                {r.kind === 'days' && r.expiresAfter && (
                                    <div style={{ fontSize: '.72rem', color: 'var(--adm-fg-3)', marginTop: 4 }}>
                                        الاشتراك: {when(r.expiresBefore)} ⇐ {when(r.expiresAfter)}
                                    </div>
                                )}
                                {r.transferRef && (
                                    <div style={{ fontSize: '.72rem', color: 'var(--adm-fg-3)', marginTop: 4 }}>
                                        مرجع التحويل: <span dir="ltr" style={{ fontFamily: 'monospace' }}>{r.transferRef}</span>
                                    </div>
                                )}
                                <div style={{ fontSize: '.7rem', color: 'var(--adm-fg-3)', marginTop: 4 }}>{when(r.createdAt)}</div>
                                {r.kind === 'cash' && (r.status === 'pending_cash' || r.status === 'failed') && (
                                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 9 }}>
                                        <AdmButton variant="primary" disabled={busy === r.id} onClick={() => settle(r, true)}>
                                            {busy === r.id ? 'جارٍ…' : '💸 حوّلته — اختم بمرجع'}
                                        </AdmButton>
                                        {r.status === 'pending_cash' && (
                                            <AdmButton disabled={busy === r.id} onClick={() => settle(r, false)}>
                                                ❌ تعذّر التحويل
                                            </AdmButton>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                 )}
            </AdmSection>
        </>
    );
};

export default AdminOutageCredits;
