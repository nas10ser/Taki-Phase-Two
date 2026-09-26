/**
 * VerificationCard — «توثيق المتجر» في لوحة التاجر (v14.95)
 * ═══════════════════════════════════════════════════════════════════════════
 * هذه البطاقة هي **الطريق الوحيد** الذي يُوثَّق منه تاجر. فإن غمضت أو نقصت
 * حالةٌ من حالاتها بقي تاجرٌ بلا توثيقٍ ولا يعرف لماذا — ولا شيء في أي سجلّ
 * يصرخ. لذلك ستّ حالاتٍ مكتوبةٌ بالكامل، لكلٍّ نصُّها **وفعلُها التالي**، ولا
 * حالةَ تنتهي بطريقٍ مسدود. ولغتُها البصرية لغةُ جارتَيها في العمود نفسه
 * (`SetupPath` · `VatStatusCard`): صندوقٌ بـ`var(--card-bg)` وحافةٌ علوية بلون
 * الحالة، وعنوانٌ ثمّ **سببٌ بجملةٍ لا مصطلح**، ثمّ الفعل.
 *
 * ── قراراتٌ مقصودة ───────────────────────────────────────────────────────
 * • **لا تُرسم إطلاقاً حين يكون الوضع `off`**: إعدادٌ مُطفأ يعني ألّا يرى التاجر
 *   ذِكراً لميزةٍ لا أثر لها، لا بطاقةً تسأله عن شيءٍ لا يلزمه.
 * • **الوضعُ والمهلة من ردّ الخادم متى وصل** (`my_verification_state` تُرجعهما
 *   بعد أثر «السفر»)، وإعداداتُ المنصّة مصدرُهما قبل وصوله فلا يومض شيء. 🪤
 *   مصدران لرقمٍ واحد ينحرفان — فالخادم هو الحَكَم، والآخر ريثما يُجيب.
 * • **وثيقة العمل الحر مقبولةٌ كالسجل التجاري تماماً** — صراحةً في شرح الخيار
 *   نفسه. البائع الفرد بائعٌ نظاميّ، وإخفاءُ ذلك يصرف نصف التجّار.
 * • **تاريخ الانتهاء اختياريّ** ويُقال للتاجر لماذا: النظام التجاري الجديد ألغى
 *   تاريخ انتهاء السجل. حقلٌ إلزاميّ هنا كان سيوقف تاجراً سجلُّه سليم.
 * • **ولا رسالةَ خطأٍ تُخترع هنا**: الدوال تُرجع رمزاً و`submitErrorText` تنطق
 *   به — مكانٌ واحد لا ينحرف عن نصّ البوتين ولا عن الهجرة.
 *
 * 🪤 **لا نجاحَ بلا دليل**: ردُّ الدالّة jsonb، و`ok:false` تصل بـ`error=null`
 *    فتبدو نجاحاً لمن يفحص `error` وحده. فبعد كل إرسالٍ أو سحبٍ نُعيد قراءة
 *    الحالة ونشترط أنها **تغيّرت فعلاً** قبل أن نقول «تمّ».
 * 🪤 ولا نرسم `null` حتى يصل الردّ (درس v13.61): يقفز بكل ما تحته. أوّل زيارةٍ
 *    هيكلٌ شبحيّ بارتفاعٍ مقارب، وما بعدها من ذاكرة الوحدة — **لا localStorage**:
 *    هنا رقم وثيقةٍ واسمٌ نظاميّ، وهما بيانات التاجر لا زينةَ واجهة.
 * 🪤 ورقمُ الساعات لا يُصاغ يدوياً («٦ ساعة» / «1 hours») — `holdLabelGen` وحده.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { useApp } from '../../context/AppContext';
import { normalizeArabicNumerals } from '../../utils/helpers';
import { holdLabelGen } from '../../utils/bookingHold';
import {
    verificationRepository, DOC_KINDS, docKindInfo, rejectReason, submitErrorText,
    DocKind, MyVerification,
} from '../../repositories/verificationRepository';

/**
 * لماذا هذا الخيار — جملةٌ واحدة لكلٍّ. و`DOC_KINDS` تحمل الاسم وصيغة الرقم
 * ومن أين يُجلب؛ أمّا **معنى** الخيار للتاجر فنصٌّ تملكه هذه الشاشة، وفيه
 * الجملة التي لا يصحّ أن تغيب: العمل الحرّ مقبولٌ كالسجل التجاري بلا فرق.
 */
const WHY: Record<DocKind, { ar: string; en: string }> = {
    business_sa: {
        ar: 'منشأتك مسجّلة في المركز السعودي للأعمال — وهو أسرع طريقٍ إن كان رقمك جاهزاً.',
        en: 'Your establishment is registered with the Saudi Business Center — the fastest route if you already have the number.',
    },
    cr: {
        ar: 'لديك سجلٌّ تجاريّ باسم منشأتك، وهو الأشهر بين المحلّات والمؤسسات.',
        en: 'You hold a commercial registration in your establishment’s name — the most common case for shops.',
    },
    freelance: {
        ar: 'تبيع باسمك أنت بوثيقة العمل الحر — ونقبلها كالسجل التجاري تماماً بلا أي فرق: البائع الفرد بائعٌ نظاميّ.',
        en: 'You sell in your own name with a freelance certificate — we accept it exactly like a commercial registration, with no difference: an individual seller is fully legitimate.',
    },
};

/** آخر حالةٍ معروفة لكل تاجر — تنجو من التنقّل بين تبويبات اللوحة. */
const memCache = new Map<string, MyVerification>();

/** 🪤 `ar-SA` وحدها تُخرج التاريخ هجرياً — `-u-ca-gregory` إلزامية. */
const fmtDate = (s: string | null, isRTL: boolean): string => {
    if (!s) return '';
    const d = new Date(s);
    if (!Number.isFinite(d.getTime())) return '';
    return d.toLocaleDateString(isRTL ? 'ar-SA-u-ca-gregory' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** الرقم مقنّعاً إلا آخر أربعة — لا داعي لعرضه كاملاً على شاشةٍ في محلّ. */
const maskNum = (n: string | null): string => {
    const s = String(n || '');
    return s.length <= 4 ? s : '•'.repeat(Math.min(s.length - 4, 12)) + s.slice(-4);
};

const H: React.CSSProperties = { fontWeight: 900, fontSize: '0.95rem', color: 'var(--text-primary)' };
const P: React.CSSProperties = { fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.85, marginTop: 8 };
const LBL: React.CSSProperties = { fontWeight: 900, fontSize: '0.78rem', color: 'var(--text-primary)', margin: '14px 0 6px' };
const HINT: React.CSSProperties = { fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', marginTop: 5, lineHeight: 1.75 };
const INP: React.CSSProperties = {
    width: '100%', padding: '11px 14px', borderRadius: 12, fontSize: '16px', fontFamily: 'inherit',
    border: '1px solid var(--border-color)', background: 'var(--body-bg)', color: 'var(--text-primary)', outline: 'none',
};
const TINT: React.CSSProperties = {
    marginTop: 12, padding: '10px 12px', borderRadius: 12, background: 'rgba(245,158,11,0.10)',
    border: '1px solid rgba(245,158,11,0.35)', fontSize: '0.74rem', fontWeight: 800,
    lineHeight: 1.8, color: 'var(--text-primary)',
};
const QUOTE: React.CSSProperties = {
    marginTop: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--body-bg)',
    border: '1px solid var(--border-color)', fontSize: '0.75rem', fontWeight: 700,
    lineHeight: 1.8, color: 'var(--text-primary)',
};
const GHOST: React.CSSProperties = {
    padding: '11px 16px', borderRadius: 12, border: '1px solid var(--border-color)', background: 'transparent',
    color: 'var(--text-primary)', fontWeight: 900, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'inherit', minHeight: 42,
};
const GO = 'linear-gradient(135deg,#0d9488,#0f766e)';
const btn = (bg: string, off = false): React.CSSProperties => ({
    padding: '11px 16px', borderRadius: 12, border: 'none', color: '#fff', fontWeight: 900, fontSize: '0.82rem',
    cursor: off ? 'default' : 'pointer', background: bg, opacity: off ? 0.5 : 1, fontFamily: 'inherit', minHeight: 42,
});

const VerificationCard: React.FC = () => {
    const { user, language, platformSettings, platformSettingsReady } = useApp();
    const history = useHistory();
    const isRTL = language === 'ar';
    const t = (ar: string, en: string) => (isRTL ? ar : en);

    const userId = user?.id ? String(user.id) : '';
    const [st, setSt] = useState<MyVerification | null>(() => memCache.get(userId) ?? null);
    const [settled, setSettled] = useState<boolean>(() => memCache.has(userId));
    const [notMerchant, setNotMerchant] = useState(false);
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState<DocKind | ''>('');
    const [num, setNum] = useState('');
    const [legal, setLegal] = useState('');
    const [expiry, setExpiry] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const [note, setNote] = useState('');

    // الإعدادات مصدرُ الوضع والمهلة **ريثما** يُجيب الخادم؛ ثمّ ردُّه هو الحَكَم
    // (وهو وحده الذي طبّق أثر «السفر» على الوضع).
    const cfg = platformSettings?.verification;
    const setMode = cfg?.mode ?? 'off';
    const mode = st ? st.mode : (cfg?.vacation && setMode === 'required' ? 'advisory' : setMode);
    const slaRaw = Number(st ? st.slaHours : cfg?.slaHours);
    const sla = Number.isFinite(slaRaw) && slaRaw > 0 ? slaRaw : 24;
    const slaAr = holdLabelGen(sla, true);
    const slaEn = holdLabelGen(sla, false);

    /** لا نجلب إلا حين لا نعلم يقيناً أنها مُطفأة — فإعداداتٌ لم تصل ليست «off». */
    const shouldLoad = !!userId && (!platformSettingsReady || setMode !== 'off');

    const load = useCallback(async () => {
        const res = await verificationRepository.myState();
        setSettled(true);
        if (!res.ok) return;                       // لم يُجب ⇐ تبقى آخر حالة معروفة
        if (!res.state) { setNotMerchant(true); return; }
        memCache.set(userId, res.state);
        setSt(res.state);
    }, [userId]);

    useEffect(() => { if (shouldLoad) load(); }, [shouldLoad, load]);

    /** يفتح النموذج مملوءاً بما أرسله التاجر آخر مرّة — لا يُعيد كتابته. */
    const openForm = (from: MyVerification) => {
        setKind((from.docKind || '') as DocKind | '');
        setNum(from.docNumber || '');
        setLegal(from.claimedName || from.legalName || '');
        setExpiry(/^\d{4}-\d{2}-\d{2}$/.test(String(from.docExpiry || '')) ? String(from.docExpiry) : '');
        setErr(''); setNote(''); setOpen(true);
    };

    /**
     * الدليل لا الادّعاء: نُعيد القراءة ونشترط أن الحالة صارت كما يجب.
     * 🪤 والشرط `hasOpen` لا `status === 'submitted'`: **التجديد يُرسَل والمتجر
     *    موثَّقٌ بعد**، فتبقى الحالة `approved` ويُفتح طلبٌ بجانبها. شرطُ الحالة
     *    كان سيتّهم تجديداً ناجحاً بالفشل — وهو أسوأ خطأ: يدفع التاجر لإعادة
     *    الإرسال فيصطدم بـ`ALREADY_PENDING`.
     * وإن نجح النداء وتعذّرت القراءة، نقول ذلك بدل أن نرسم شاشةً قديمة بنجاحٍ
     * فوقها — فتلك أسوأ من خطأ.
     */
    const became = async (want: (v: MyVerification) => boolean, res: { ok: boolean; error?: string }, ar: string, en: string) => {
        if (!res.ok) {
            setBusy(false);
            // 🪤 لا يُعرض نصُّ خطأ الخادم الخام: التاجر يقرأ جملة لا رسالة PostgREST.
            setErr(submitErrorText(res.error, isRTL) || t(ar, en));
            return false;
        }
        const after = await verificationRepository.myState();
        setBusy(false);
        if (after.ok && after.state) {
            memCache.set(userId, after.state); setSt(after.state);
            if (want(after.state)) { setOpen(false); return true; }
        }
        setErr(t('نفّذنا طلبك على الخادم، لكن تعذّر تحديث هذه الشاشة الآن — حدّث الصفحة لتراه.',
            'Your request went through on the server, but this screen could not refresh — reload the page to see it.'));
        return false;
    };

    const submit = async () => {
        setErr(''); setNote('');
        const n = num.trim(), nm = legal.trim();
        const info = docKindInfo(kind as DocKind);
        if (!kind || !info) { setErr(t('اختر نوع الوثيقة أوّلاً.', 'Choose a document type first.')); return; }
        if (!info.test(n)) { setErr(t(info.hintAr, info.hintEn)); return; }
        if (nm.length < 3) { setErr(t('اكتب الاسم المسجَّل كاملاً كما في الوثيقة.', 'Write the full registered name exactly as on the document.')); return; }
        setBusy(true);
        const res = await verificationRepository.submit(kind as DocKind, n, nm, expiry || null);
        const ok = await became(v => v.hasOpen, res,
            'تعذّر إرسال الطلب — حاول مرّة أخرى.', 'Could not submit — please try again.');
        if (ok) setNote(t('وصلنا طلبك.', 'We have your request.'));
    };

    const withdraw = async () => {
        setErr(''); setNote(''); setBusy(true);
        const res = await verificationRepository.withdraw();
        const ok = await became(v => !v.hasOpen, res,
            'تعذّر سحب الطلب — ما زال قيد المراجعة.', 'Could not withdraw — the request is still under review.');
        if (ok) setNote(t('سُحب طلبك.', 'Your request was withdrawn.'));
    };

    if (mode === 'off' || !userId || notMerchant) return null;

    // أوّل زيارة على هذا الجهاز: هيكلٌ يحجز المساحة فلا تقفز البطاقات تحته.
    if (!settled) {
        return (
            <section aria-hidden style={{
                background: 'var(--card-bg)', borderRadius: 18, padding: 18, marginBottom: 16,
                border: '1px solid var(--border-color)', minHeight: 180, display: 'flex', flexDirection: 'column', gap: 12,
            }}>
                {['55%', '100%', '84%'].map(w => <div key={w} className="taki-skeleton" style={{ height: 16, width: w, borderRadius: 8 }} />)}
                <div className="taki-skeleton" style={{ height: 42, width: '100%', borderRadius: 12, marginTop: 6 }} />
            </section>
        );
    }

    const s = st;
    const status = s?.status ?? 'none';
    const box = (accent: string): React.CSSProperties => ({
        background: 'var(--card-bg)', borderRadius: 18, padding: 18, marginBottom: 16,
        border: '1px solid var(--border-color)', borderTop: `3px solid ${accent}`,
        textAlign: isRTL ? 'right' : 'left',
    });
    const kindName = (k: DocKind | null) => {
        const i = docKindInfo(k);
        return i ? t(i.ar, i.en) : t('وثيقة', 'Document');
    };
    const feedback = (
        <>
            {err && <div role="alert" style={{ ...HINT, marginTop: 12, color: 'var(--danger)', fontWeight: 900 }}>⚠️ {err}</div>}
            {note && <div style={{ ...HINT, marginTop: 12, color: '#0d9488', fontWeight: 900 }}>✅ {note}</div>}
        </>
    );
    const again = (label: string) => (
        <div style={{ marginTop: 14 }}>
            <button type="button" onClick={() => s && openForm(s)} style={btn(GO)}>{label}</button>
        </div>
    );
    const withdrawBtn = (
        <div style={{ marginTop: 14 }}>
            <button type="button" onClick={withdraw} disabled={busy} style={{ ...GHOST, opacity: busy ? 0.5 : 1 }}>
                {busy ? t('جارٍ السحب…', 'Withdrawing…') : t('اسحب الطلب', 'Withdraw request')}
            </button>
        </div>
    );

    // ── النموذج: مشتركٌ بين «لا توثيق» و«مرفوض» و«منتهٍ» و«تجديد» ──
    const picked = docKindInfo(kind as DocKind);
    const form = (
        <>
            <div style={{ ...LBL, marginTop: 16 }}>{t('١) نوع الوثيقة', '1) Document type')}</div>
            <div role="radiogroup" aria-label={t('نوع الوثيقة', 'Document type')} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {DOC_KINDS.map(k => {
                    const on = kind === k.kind;
                    return (
                        <button key={k.kind} type="button" role="radio" aria-checked={on} onClick={() => setKind(k.kind)} style={{
                            textAlign: isRTL ? 'right' : 'left', padding: '12px 14px', borderRadius: 14, cursor: 'pointer',
                            fontFamily: 'inherit', border: on ? '2px solid #0d9488' : '1px solid var(--border-color)',
                            background: on ? 'rgba(13,148,136,0.10)' : 'var(--body-bg)',
                        }}>
                            <div style={{ fontWeight: 900, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                <span aria-hidden="true">{on ? '◉' : '○'}</span> {t(k.ar, k.en)}
                            </div>
                            <div style={{ fontSize: '0.73rem', fontWeight: 700, color: 'var(--text-secondary)', lineHeight: 1.75, marginTop: 4 }}>
                                {t(WHY[k.kind].ar, WHY[k.kind].en)}
                            </div>
                        </button>
                    );
                })}
            </div>

            <div style={LBL}>{t('٢) رقم الوثيقة', '2) Document number')}</div>
            <input value={num} inputMode="numeric" aria-label={t('رقم الوثيقة', 'Document number')}
                onChange={e => setNum(normalizeArabicNumerals(e.target.value).replace(/[^0-9A-Za-z]/g, '').slice(0, 24))}
                style={{ ...INP, direction: 'ltr', textAlign: isRTL ? 'right' : 'left' }} />
            <div style={HINT}>
                {picked ? t(picked.hintAr, picked.hintEn) : t('اختر نوع الوثيقة أوّلاً ليظهر لك شكل الرقم المطلوب.', 'Pick a document type first to see the expected number format.')}
                {' '}{t('والأرقام العربية والإنجليزية كلاهما يُقبل.', 'Arabic and English numerals are both accepted.')}
                {picked && (
                    <> <a href={picked.url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontWeight: 900 }}>
                        {t('من أين أجلب الرقم؟', 'Where do I find it?')}
                    </a></>
                )}
            </div>

            <div style={LBL}>{t('٣) الاسم النظامي', '3) Legal name')}</div>
            <input value={legal} aria-label={t('الاسم النظامي', 'Legal name')}
                onChange={e => setLegal(e.target.value.slice(0, 160))} style={INP} />
            <div style={HINT}>{t('اكتبه كما هو في السجل بالضبط — اختلافُ حرفٍ واحد يؤخّر المراجعة.', 'Write it exactly as in the registry — one differing letter delays the review.')}</div>

            <div style={LBL}>{t('٤) تاريخ الانتهاء (اختياري)', '4) Expiry date (optional)')}</div>
            <input type="date" value={expiry} aria-label={t('تاريخ انتهاء الوثيقة', 'Document expiry date')}
                onChange={e => setExpiry(e.target.value)}
                style={{ ...INP, direction: 'ltr', textAlign: isRTL ? 'right' : 'left' }} />
            <div style={HINT}>{t('اتركه فارغاً إن كان سجلك بلا تاريخ انتهاء — النظام التجاري الجديد ألغى تاريخ انتهاء السجل.', 'Leave it empty if your registration has no expiry — the new Saudi commercial-registration system removed expiry dates.')}</div>

            <div style={{ ...HINT, marginTop: 14 }}>
                {t(`⏳ نراجع الطلب خلال ${slaAr} عادةً، ويصلك إشعارٌ بالنتيجة. ولا نطلب صورة الوثيقة — الرقم والاسم فقط.`,
                    `⏳ We usually review within ${slaEn} and notify you either way. We never ask for a scan — only the number and the name.`)}
            </div>
            {feedback}
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <button type="button" onClick={submit} disabled={busy} style={{ ...btn(GO, busy), flex: 1, minWidth: 150 }}>
                    {busy ? t('جارٍ الإرسال…', 'Sending…') : t('أرسل للتوثيق', 'Submit for verification')}
                </button>
                {status !== 'none' && status !== 'withdrawn' && status !== 'superseded' && (
                    <button type="button" onClick={() => { setOpen(false); setErr(''); }} style={GHOST}>{t('إلغاء', 'Cancel')}</button>
                )}
            </div>
        </>
    );

    // ── ⏳ قيد المراجعة ──
    if (s && status === 'submitted') {
        return (
            <section style={box('#3b82f6')}>
                <div style={H}>⏳ {t('طلبك قيد المراجعة', 'Your request is under review')}</div>
                <div style={P}>
                    {s.submittedAt
                        ? t(`أرسلتَه في ${fmtDate(s.submittedAt, true)}.`, `Sent on ${fmtDate(s.submittedAt, false)}.`)
                        : t('أرسلتَ طلب التوثيق.', 'Your verification request was sent.')}{' '}
                    {t(`نراجع الطلبات خلال ${slaAr} عادةً، ويصلك إشعارٌ بالنتيجة سواء قُبل أو لم يُقبل.`,
                        `We usually review within ${slaEn}, and you get a notification whether it is accepted or not.`)}
                </div>
                <div style={{ ...P, marginTop: 6 }}>
                    {kindName(s.docKind)}{s.docNumber ? ` · ${maskNum(s.docNumber)}` : ''}
                </div>
                {feedback}
                {withdrawBtn}
            </section>
        );
    }

    // ── ✅ موثَّق — والتجديد مسموحٌ والتوثيق قائم ──
    if (s && status === 'approved') {
        return (
            <section style={box('#0d9488')}>
                <div style={H}>✅ {t('متجرك موثّق', 'Your store is verified')}</div>
                <div style={P}>
                    {kindName(s.docKind)}
                    {s.docNumber ? <> · <span style={{ direction: 'ltr', unicodeBidi: 'isolate' }}>{maskNum(s.docNumber)}</span></> : null}
                    {s.decidedAt ? t(` · وُثّق في ${fmtDate(s.decidedAt, true)}`, ` · verified on ${fmtDate(s.decidedAt, false)}`) : ''}
                </div>
                {s.legalName && <div style={{ ...P, marginTop: 4 }}>{t('الاسم المسجَّل:', 'Registered name:')} {s.legalName}</div>}
                {s.docExpiry && (
                    <div style={TINT}>
                        {t(`تنتهي صلاحية وثيقتك في ${fmtDate(s.docExpiry, true)} — جدّدها قبل ذلك كي لا ينقطع توثيقك.`,
                            `Your document expires on ${fmtDate(s.docExpiry, false)} — renew before then so your badge is not interrupted.`)}
                    </div>
                )}
                {/* 🪤 تجديدٌ قيد المراجعة والمتجر موثَّقٌ بعد: لا يُعرض زرّ تجديدٍ
                    ثانٍ (تردّه القاعدة بـ`ALREADY_PENDING`)، بل حالةُ الطلب وسحبُه. */}
                {s.hasOpen ? (
                    <>
                        <div style={QUOTE}>
                            {t(`🔄 طلب تجديدٍ قيد المراجعة — ومتجرك يبقى موثّقاً حتى يُبَتّ فيه. نراجعه خلال ${slaAr} عادةً.`,
                                `🔄 A renewal request is under review — your store stays verified until it is decided. We usually review within ${slaEn}.`)}
                        </div>
                        {feedback}
                        {withdrawBtn}
                    </>
                ) : open ? form : (s.docExpiry ? again(t('جدّد التوثيق', 'Renew verification')) : null)}
            </section>
        );
    }

    // ── ❌ لم يُقبل ──
    if (s && status === 'rejected') {
        const r = rejectReason(s.rejectCode);
        return (
            <section style={box('#dc2626')}>
                <div style={H}>❌ {t('لم نستطع توثيق متجرك', 'We could not verify your store')}</div>
                <div style={P}>
                    {r ? t(r.merchantAr, r.en) : t('لم تُذكر لنا تفاصيل أكثر من ذلك.', 'No further detail was recorded.')}
                </div>
                {s.adminNote && <div style={QUOTE}>{t('ملاحظة المراجع:', 'Reviewer’s note:')} {s.adminNote}</div>}
                <div style={{ ...P, marginTop: 8 }}>
                    {t('صحّح ما سبق وأرسل من جديد — وبياناتك السابقة محفوظة لك في النموذج.',
                        'Fix the above and send again — your previous entries are pre-filled in the form.')}
                </div>
                {open ? form : again(t('أرسل من جديد', 'Send again'))}
            </section>
        );
    }

    // ── ⌛ انتهت الصلاحية ──
    if (s && status === 'expired') {
        return (
            <section style={box('#f59e0b')}>
                <div style={H}>⌛ {t('انتهت صلاحية توثيقك', 'Your verification has expired')}</div>
                <div style={P}>
                    {s.docExpiry
                        ? t(`انتهت وثيقتك في ${fmtDate(s.docExpiry, true)}، فتوقّفت علامة «موثّق» على متجرك.`,
                            `Your document expired on ${fmtDate(s.docExpiry, false)}, so the “verified” badge is paused.`)
                        : t('انتهت صلاحية وثيقتك، فتوقّفت علامة «موثّق» على متجرك.', 'Your document expired, so the “verified” badge is paused.')}{' '}
                    {t('أرسل وثيقتك المجدَّدة ويعود التوثيق.', 'Send your renewed document and it comes back.')}
                </div>
                {open ? form : again(t('جدّد التوثيق', 'Renew verification'))}
            </section>
        );
    }

    // ── 🚫 سُحب التوثيق — قرارُ إدارةٍ لا يُعاد بنموذج، فالطريق محادثةٌ معنا ──
    if (s && status === 'revoked') {
        const r = rejectReason(s.rejectCode);
        return (
            <section style={box('#dc2626')}>
                <div style={H}>🚫 {t('سُحب توثيق متجرك', 'Your store’s verification was revoked')}</div>
                <div style={P}>
                    {s.adminNote || (r ? t(r.merchantAr, r.en) : t('لم تُذكر لنا تفاصيل أكثر من ذلك.', 'No further detail was recorded.'))}
                </div>
                <div style={{ ...P, marginTop: 6 }}>
                    {t('إن كان في الأمر لبس فراسل الإدارة وسنراجعه معك.', 'If this is a misunderstanding, message us and we will review it with you.')}
                </div>
                <div style={{ marginTop: 14 }}>
                    <button type="button" onClick={() => history.push('/complaints')} style={btn('#dc2626')}>
                        {t('تواصل مع الإدارة', 'Contact support')}
                    </button>
                </div>
            </section>
        );
    }

    // ── 🪪 لا توثيق بعد (ويشمل المسحوب والمُستبدَل: الطريق أمامه النموذج) ──
    return (
        <section style={box('#f59e0b')}>
            <div style={H}>🪪 {t('وثّق متجرك', 'Verify your store')}</div>
            <div style={P}>
                {t('التوثيق يعني أن تاكي تأكّدت أن خلف هذا المتجر جهةً حقيقية باسمٍ مسجَّل. المشتري يرى ذلك على صفحتك، وهو أكثر ما يطمئنه قبل أن يدفع لمتجرٍ لم يشترِ منه من قبل.',
                    'Verification means TAKI has confirmed that a real, registered party stands behind this store. Buyers see that on your page, and it is what reassures them most before paying a store they have never bought from.')}
            </div>
            {mode === 'required' && (
                <div style={TINT}>
                    {t('⚠️ نشرُ عرضٍ جديد صار يحتاج توثيقاً. وعروضك المنشورة الآن لا تُمسّ — تبقى تعمل كما هي.',
                        '⚠️ Publishing a new deal now requires verification. Your already-published deals are untouched and keep running.')}
                </div>
            )}
            {form}
        </section>
    );
};

export default VerificationCard;
