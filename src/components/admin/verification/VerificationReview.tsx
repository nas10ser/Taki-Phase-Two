/**
 * VerificationReview — بطاقةُ قرارٍ واحد: نظرةٌ وضغطتان (v14.95)
 * ═══════════════════════════════════════════════════════════════════════════
 * المراجعُ واحدٌ ويقرأ على جوّاله. فكل ما يلزم القرار في بطاقةٍ واحدة بترتيب
 * القراءة لا بترتيب الجدول: **مَن** (المتجر وصاحبه) ثمّ **ماذا يدّعي** (الاسم
 * والرقم) ثمّ **أين يُتحقَّق** (زرّ السجل) ثمّ **القرار**.
 *
 * ── ثلاثة قراراتٍ مقصودة ─────────────────────────────────────────────────
 * • 🔴 **حقل «الاسم النظاميّ» يبدأ فارغاً**: ملؤه بما كتبه التاجر يجعل الاعتماد
 *   نسخاً لا تحقّقاً، والاسمُ هذا يُطبع على فاتورةٍ ضريبية. وبجانبه زرُّ «انسخ ما
 *   كتبه التاجر» — ضغطةٌ واحدة لكنها **قرارٌ واعٍ** (درس v14.71).
 * • 🔴 **الإقرار عند اختلاف الاسمين إلزاميّ** — والحَكَمُ القاعدة: إن تساهلت
 *   هذه الشاشة ردَّت `NAME_MISMATCH_UNACKED`، فيُعرض الاسمان ويُطلب الإقرار.
 * • **وثيقة العمل الحر لا سجلّ عامّ لها** — يُقال ذلك صراحةً في البطاقة
 *   (`assurance='declared'`)، فلا يبدو الإقرار سجلّاً.
 *
 * 🪤 ولا نجاحَ بلا دليل: `adminResolve` تُرجع `ok:false` **بـ`error=null` من
 *    PostgREST**، فمن يفحص الخطأ وحده يرى «نجاحاً» لقرارٍ لم يُكتب.
 */
import React, { useState } from 'react';
import { useApp } from '../../../context/AppContext';
import { CopyButton } from '../CopyButton';
import { AdmPill, AdmButton, toneBg, toneFg } from '../ui';
import type { Tone } from '../ui';
import { VerificationPill } from './VerificationPill';
import {
    REJECT_REASONS, kindLabel, registryUrl, registryMeta, sameName, fmtDate,
} from './verificationStatus';
import type { RejectCode } from './verificationStatus';
import { verificationRepository } from '../../../repositories/verificationRepository';
import type { AdminVerificationRow } from '../../../repositories/verificationRepository';

// ── أنماطٌ مشتركة: سطحٌ أفتح داخل البطاقة، وحافّةٌ من رموز الثيم ──────────
const panel: React.CSSProperties = {
    background: 'var(--adm-surface-3)', border: '1px solid var(--adm-border)',
    borderRadius: 'var(--adm-r-sm)', padding: '10px 12px',
};
const meta: React.CSSProperties = { fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)' };
const strong: React.CSSProperties = {
    fontSize: '.86rem', fontWeight: 800, color: 'var(--adm-fg)', wordBreak: 'break-word',
};
const field: React.CSSProperties = {
    width: '100%', padding: '9px 11px', fontSize: '.85rem', fontWeight: 700,
    borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
    background: 'var(--adm-surface-2)', color: 'var(--adm-fg)', fontFamily: 'inherit',
};

/** زرُّ قرارٍ بنغمة دلالة — النغمة تقول أثر الضغطة قبل الضغط. */
const ActBtn: React.FC<{
    tone: Tone; onClick: () => void; children: React.ReactNode; disabled?: boolean;
}> = ({ tone, onClick, children, disabled }) => (
    <button
        type="button" onClick={onClick} disabled={disabled} className="adm-focusable"
        style={{
            width: '100%', padding: '10px 16px', borderRadius: 'var(--adm-r-sm)',
            border: '1px solid transparent', fontSize: '.84rem', fontWeight: 800,
            cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1,
            background: toneBg(tone), color: toneFg(tone),
        }}
    >{children}</button>
);

const Line: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div style={{ display: 'grid', gap: 3 }}>
        <span style={meta}>{label}</span>
        <div style={strong}>{children}</div>
    </div>
);

export const VerificationReview: React.FC<{
    row: AdminVerificationRow;
    /** بعد أي قرارٍ ناجح — يُعيد المنادي جلبَ الطابور والعدّادات. */
    onDone: () => void;
}> = ({ row, onDone }) => {
    const { customAlert, customConfirm } = useApp();
    const [legalName, setLegalName] = useState('');   // 🔴 يبدأ فارغاً عمداً
    const [expiry, setExpiry] = useState(row.docExpiry || '');
    const [ack, setAck] = useState(false);
    const [code, setCode] = useState<RejectCode | ''>('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState('');
    const [err, setErr] = useState('');

    const reg = registryMeta(row.docKind);
    const url = registryUrl(row.docKind);
    const decided = row.status !== 'submitted';
    // الاسم المكتوب (أو المُدّعى قبل الكتابة) مقابل اسم المتجر — عرضٌ لا حُكم.
    const differs = !sameName(legalName || row.claimedName, row.shop);
    const needAck = differs && !ack;

    const approve = async () => {
        const typed = legalName.trim();
        if (!typed) { setErr('اكتب الاسم النظاميّ كما هو في السجل — هو ما يُطبع على فاتورة هذا المتجر.'); return; }
        if (needAck) { setErr('الاسم النظاميّ يختلف عن اسم المتجر — أقرّ بذلك صراحةً قبل الاعتماد.'); return; }
        const ok = await customConfirm(
            `✅ اعتماد توثيق «${row.shop || row.storeId}»؟\n\n`
            + `الاسم النظاميّ: ${typed}\n`
            + `${kindLabel(row.docKind)}: ${row.docNumber}\n\n`
            + 'سيصبح المتجر موثّقاً، ويُكتب الرقم في ملفّه، ويُطبع الاسم على فواتيره.');
        if (!ok) return;
        setBusy('approve'); setErr('');
        const r = await verificationRepository.adminResolve({
            id: row.id, approve: true, legalName: typed, expiry: expiry || null, nameAck: ack,
        });
        setBusy('');
        if (!r.ok) {
            // 🪤 حَكَمُ الاسم هو القاعدة — هنا يُعرض اسماها هي لا ما في الشاشة.
            if (r.error === 'NAME_MISMATCH_UNACKED') {
                setErr(`القاعدة ترى الاسمين مختلفين:\nالسجل: ${r.legalName || typed}\nالمتجر: ${r.shop || row.shop || '—'}\nأقرّ بذلك ثمّ أعِد المحاولة.`);
                setAck(false);
                return;
            }
            setErr(r.msg || `تعذّر الاعتماد (${r.error || 'خطأ غير معروف'}).`);
            return;
        }
        await customAlert('✅ اعتُمد التوثيق — وصله إشعار، وصار متجره موثّقاً.');
        onDone();
    };

    const reject = async () => {
        if (!code) { setErr('اختر سبب الرفض — هو ما يصل التاجر، ولا يُرفض طلبٌ بلا سبب.'); return; }
        const reason = REJECT_REASONS.find(r => r.code === code);
        if (code === 'other' && !note.trim()) { setErr('سبب «أخرى» بلا ملاحظة لا يقول للتاجر شيئاً — اكتب ما يصحّحه.'); return; }
        const ok = await customConfirm(
            `❌ رفض طلب «${row.shop || row.storeId}»؟\n\n`
            + `الذي سيصل التاجر: ${reason?.merchantAr || ''}\n`
            + (note.trim() ? `وملاحظتك: ${note.trim()}\n` : '')
            + '\nوله أن يُصحّح ويُرسل من جديد.');
        if (!ok) return;
        setBusy('reject'); setErr('');
        const r = await verificationRepository.adminResolve({
            id: row.id, approve: false, rejectCode: code, note: note.trim() || null,
        });
        setBusy('');
        if (!r.ok) { setErr(r.msg || `تعذّر الرفض (${r.error || 'خطأ غير معروف'}).`); return; }
        await customAlert('❌ رُفض الطلب ووصل التاجرَ السبب.');
        onDone();
    };

    return (
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
            {/* ١) مَن — المتجر وصاحبه */}
            <div style={{ ...panel, display: 'grid', gap: 9 }}>
                <Line label="اسم المتجر على المنصّة">{row.shop || '—'}</Line>
                <Line label="الاسم الذي كتبه التاجر">{row.claimedName || '—'}</Line>
                {!row.nameMatches && (
                    <AdmPill tone="warn" title="اسم المتجر واسم الوثيقة مختلفان — جائزٌ نظاماً (اسمٌ تجاري)، لكنه يحتاج إقرارك.">
                        ⚠️ الاسم لا يطابق اسم المتجر
                    </AdmPill>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: '.78rem', color: 'var(--adm-fg-2)', fontWeight: 700 }}>
                    <span>👤 {row.ownerName || '—'}</span>
                    {row.ownerPhone && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>📞 {row.ownerPhone}</span>
                            <CopyButton value={row.ownerPhone} label="الجوال" size="xs" />
                        </span>
                    )}
                </div>
            </div>

            {/* ٢) ماذا يدّعي — الوثيقة ورقمها */}
            <div style={{ ...panel, display: 'grid', gap: 9 }}>
                <Line label="نوع الوثيقة">{kindLabel(row.docKind)}</Line>
                <div style={{ display: 'grid', gap: 3 }}>
                    <span style={meta}>الرقم</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <span dir="ltr" style={{ ...strong, fontVariantNumeric: 'tabular-nums', letterSpacing: '.03em' }}>
                            {row.docNumber}
                        </span>
                        <CopyButton value={row.docNumber} label="الرقم" size="xs" />
                    </div>
                </div>
                {row.dupNumber && (
                    <AdmPill tone="bad" title="نفس الرقم مسجَّل على طلبٍ آخر مفتوحٍ أو معتمد — تأكّد أيّهما صاحبه قبل الاعتماد.">
                        ⚠️ نفس الرقم في طلبٍ آخر
                    </AdmPill>
                )}
                {row.docExpiry && <Line label="تاريخ الانتهاء كما كتبه التاجر">{row.docExpiry}</Line>}
                <div style={{ fontSize: '.76rem', lineHeight: 1.8, color: 'var(--adm-fg-2)', fontWeight: 600 }}>
                    {reg.howAr}
                </div>
                {!reg.lookup && (
                    <div style={{ fontSize: '.76rem', lineHeight: 1.8, color: 'var(--adm-warn-fg)', fontWeight: 700 }}>
                        هذه الوثيقة لا يوجد لها سجلٌّ عامّ يُتحقَّق منه — فالاعتماد هنا يستند إلى الرقم
                        والاسم وحدهما، ويُسجَّل «إسناداً بإقرار صاحبه» لا «إسناداً من سجلّ».
                    </div>
                )}
            </div>

            {/* ٣) أين يُتحقَّق */}
            {url && (
                <a
                    href={url} target="_blank" rel="noopener noreferrer" className="adm-focusable"
                    style={{
                        display: 'block', textAlign: 'center', padding: '13px 16px', textDecoration: 'none',
                        borderRadius: 'var(--adm-r-sm)', background: 'var(--adm-accent)',
                        color: '#ffffff', fontSize: '.9rem', fontWeight: 900,
                    }}
                >
                    افتح السجل الرسمي ↗
                </a>
            )}

            {/* ٤) القرار — أو خلاصتُه إن كان قد صدر */}
            {decided ? (
                <div style={{ ...panel, display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                        <VerificationPill status={row.status} />
                        <span style={meta}>{fmtDate(row.decidedAt)}</span>
                    </div>
                    {row.legalName && <Line label="الاسم النظاميّ المعتمد">{row.legalName}</Line>}
                    {row.rejectCode && (
                        <Line label="سبب الرفض">
                            {REJECT_REASONS.find(r => r.code === row.rejectCode)?.merchantAr || row.rejectCode}
                        </Line>
                    )}
                    {row.adminNote && <Line label="ملاحظة الإدارة">{row.adminNote}</Line>}
                </div>
            ) : (
                <div style={{ ...panel, display: 'grid', gap: 11 }}>
                    <div style={{ display: 'grid', gap: 5 }}>
                        <label style={meta} htmlFor={`lname-${row.id}`}>الاسم النظاميّ كما في السجل (تكتبه أنت بعد أن تراه)</label>
                        <input
                            id={`lname-${row.id}`} type="text" value={legalName}
                            onChange={(e) => { setLegalName(e.target.value); setErr(''); }}
                            placeholder="انسخه من صفحة السجل حرفاً بحرف"
                            className="adm-focusable" style={field}
                        />
                        {row.claimedName && (
                            <AdmButton size="sm" onClick={() => { setLegalName(row.claimedName || ''); setErr(''); }}>
                                ⧉ انسخ ما كتبه التاجر
                            </AdmButton>
                        )}
                    </div>

                    <div style={{ display: 'grid', gap: 5 }}>
                        <label style={meta} htmlFor={`exp-${row.id}`}>تاريخ انتهاء الوثيقة (اختياريّ — السجل الجديد بلا انتهاء)</label>
                        <input
                            id={`exp-${row.id}`} type="date" value={expiry}
                            onChange={(e) => setExpiry(e.target.value)}
                            className="adm-focusable" style={field}
                        />
                    </div>

                    {differs && (
                        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: '.8rem', fontWeight: 700, lineHeight: 1.7, color: 'var(--adm-fg)' }}>
                            <input type="checkbox" checked={ack} onChange={(e) => { setAck(e.target.checked); setErr(''); }} style={{ marginTop: 3 }} />
                            أُقرّ أن اسم المتجر يختلف عن الاسم النظاميّ وهذا مقبول
                        </label>
                    )}

                    {err && (
                        <div role="alert" style={{
                            padding: '9px 11px', borderRadius: 'var(--adm-r-sm)', whiteSpace: 'pre-wrap',
                            background: 'var(--adm-bad-bg)', color: 'var(--adm-bad-fg)', lineHeight: 1.75,
                            fontSize: '.79rem', fontWeight: 700,
                        }}>{err}</div>
                    )}

                    <ActBtn tone="ok" onClick={approve} disabled={!!busy}>
                        {busy === 'approve' ? '⏳ جارٍ الاعتماد…' : '✅ اعتماد التوثيق'}
                    </ActBtn>

                    <div style={{ display: 'grid', gap: 7 }}>
                        <label style={meta} htmlFor={`rej-${row.id}`}>أو ارفض — والسبب هو ما يصل التاجر</label>
                        <select
                            id={`rej-${row.id}`} value={code}
                            onChange={(e) => { setCode(e.target.value as RejectCode | ''); setErr(''); }}
                            className="adm-focusable" style={field}
                        >
                            <option value="">— اختر السبب —</option>
                            {REJECT_REASONS.map(r => <option key={r.code} value={r.code}>{r.ar}</option>)}
                        </select>
                        {code && (
                            <div style={{ fontSize: '.76rem', color: 'var(--adm-fg-2)', fontWeight: 700, lineHeight: 1.8 }}>
                                يقرأ التاجر: {REJECT_REASONS.find(r => r.code === code)?.merchantAr}
                            </div>
                        )}
                        <input
                            type="text" value={note} onChange={(e) => setNote(e.target.value)}
                            placeholder="ملاحظة تصل التاجر (اختيارية — إلزامية مع «أخرى»)"
                            className="adm-focusable" style={field}
                        />
                        <ActBtn tone="bad" onClick={reject} disabled={!!busy}>
                            {busy === 'reject' ? '⏳ جارٍ الرفض…' : '❌ رفض الطلب'}
                        </ActBtn>
                    </div>
                </div>
            )}
        </div>
    );
};

export default VerificationReview;
