/**
 * WathqCard — اشتراكُ سجلّ وزارة التجارة، ومقياسُ ما يُصرف (v15.30)
 * ═══════════════════════════════════════════════════════════════════════════
 * بطاقةٌ واحدة تقول: هل نحن مشتركون؟ بأيّ بيئة؟ كم صُرف هذا الشهر؟ وما
 * الخيارانِ المدفوعان — ومُطفأٌ منهما ما يُطفأ افتراضاً.
 *
 * ── ثلاثةُ قراراتٍ مقصودة ─────────────────────────────────────────────────
 * • 🔴 **المفتاحُ يُكتب ولا يُقرأ أبداً**: لا تُعيد القاعدةُ قيمتَه (الدالّةُ
 *   التي تقرؤه ممنوعةٌ عن `authenticated`)، والحقلُ يُفرَّغ لحظةَ الحفظ،
 *   ولا يُطبع في أي سجلّ. الظاهرُ آخرُ أربعة محارف وحدها.
 * • 🔴 **سقفُ صرفٍ شهريّ إلزاميّ**: باقةُ واثق رصيدٌ يُستهلك، وخطأٌ في حلقةٍ
 *   قد يحرقه في ساعة. فالطابورُ **يتوقّف** عند السقف ولا يفشل.
 * • **وفحصُ المُلّاك مطفأٌ افتراضاً** لأنه الوحيدُ الغالي (٥ ريالات للنداء)،
 *   والحالةُ مجّانيّة. ميزةٌ تصرف مالاً تفشل مغلقة.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AdmSection, AdmButton, AdmPill, AdmSwitch, AdmSettingRow } from '../ui';
import { wathqRepository } from '../../../repositories/verificationRepository';
import type { WathqState } from '../../../repositories/verificationRepository';

const field: React.CSSProperties = {
    width: '100%', padding: '9px 11px', fontSize: '.85rem', fontWeight: 700,
    borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
    background: 'var(--adm-surface-2)', color: 'var(--adm-fg)', fontFamily: 'inherit',
};
const note: React.CSSProperties = {
    fontSize: '.74rem', lineHeight: 1.85, color: 'var(--adm-fg-2)', fontWeight: 600,
};

const ERRORS: Record<string, string> = {
    FORBIDDEN: 'لا صلاحيةَ لك على هذا الإعداد.',
    KEY_TOO_SHORT: 'المفتاحُ أقصرُ من أن يكون صحيحاً — انسخه كاملاً من بوّابة واثق.',
    BAD_ENV: 'بيئةٌ غير معروفة.',
    BAD_CAP: 'سقفٌ غيرُ مقبول.',
    SECRET_WRITE_FAILED: '🔴 قالت الخزنةُ «حُفظ» ولم تُقرأ القيمةُ بعدها — لم يُحفظ شيء. أعِد المحاولة.',
};

export const WathqCard: React.FC = () => {
    const [st, setSt] = useState<WathqState | null>(null);
    const [key, setKey] = useState('');
    const [env, setEnv] = useState<'production' | 'sandbox'>('production');
    const [msg, setMsg] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const r = await wathqRepository.state();
        if (r.ok && r.state) { setSt(r.state); setEnv(r.state.env); }
        else setMsg(ERRORS[r.error || ''] || r.error || '');
    }, []);
    useEffect(() => { void load(); }, [load]);

    const save = async () => {
        setBusy(true); setMsg('');
        const r = await wathqRepository.setKey(key, env);
        // 🔴 يُفرَّغ الحقلُ في كلّ الأحوال: نجاحاً فلا يبقى سرٌّ في الذاكرة،
        //    وفشلاً فلا يُعاد إرسالُ قيمةٍ قد تكون ملتصقةً خطأً.
        setKey('');
        setBusy(false);
        if (!r.ok) { setMsg(ERRORS[r.error || ''] || r.error || 'تعذّر الحفظ'); return; }
        setMsg('✅ حُفظ المفتاح وأُثبت بقراءةٍ بعده.');
        await load();
    };

    const opt = async (o: { checkOwners?: boolean; convertCr?: boolean; monthlyCap?: number }) => {
        setBusy(true);
        const r = await wathqRepository.setOptions(o);
        setBusy(false);
        if (r.ok && r.state) setSt(r.state);
        else setMsg(ERRORS[r.error || ''] || r.error || 'تعذّر الضبط');
    };

    const q = st?.queue || {};
    const pending = (q.pending || 0) + (q.awaiting || 0);

    return (
        <AdmSection
            title="سجل وزارة التجارة (واثق)" icon="🏛"
            desc="فحصُ السجلّات التجارية آلياً — وحالةُ السجل مجّانيّة."
            badge={{ text: st?.subscribed ? 'مُشترَك' : 'بلا اشتراك', tone: st?.subscribed ? 'ok' : 'warn' }}
            collapsible defaultOpen={false}
        >
            <div style={{ display: 'grid', gap: 11 }}>
                <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
                    <AdmPill tone={st?.subscribed ? 'ok' : 'warn'}>
                        {st?.subscribed ? `مُشترَك · ••${st.last4 || '____'}` : 'لا اشتراك بعد'}
                    </AdmPill>
                    {st?.env === 'sandbox' && <AdmPill tone="warn">بيئةُ اختبار</AdmPill>}
                    {pending > 0 && <AdmPill tone="neutral">{pending} في الطابور</AdmPill>}
                </div>

                {!st?.subscribed && (
                    <div style={note}>
                        فحصُ السجلّات التجارية آلياً موقوفٌ حتى يُسجَّل اشتراك واثق. وهذا
                        <strong> لا يمنع التوثيق</strong>: المراجعةُ تمضي يدوياً، والاستعلامُ
                        الحكوميُّ المجّانيّ متاحٌ من زرّ «افتح السجل الرسمي» في كل طلب.
                        <br />
                        الخطوة: سجّل في <span dir="ltr">developer.wathq.sa</span> (تسجيلٌ
                        شخصيٌّ بهويّتك)، خُذ الباقة التجريبية المجّانية (١٠٠ استعلام /
                        ٣٠ يوماً، <strong>ولا تتكرّر</strong>)، ثمّ الصق المفتاح هنا.
                    </div>
                )}

                <div style={{ display: 'grid', gap: 6 }}>
                    <label htmlFor="wathq-key" style={{ fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>
                        مفتاحُ واثق {st?.subscribed && '(الصقْ مفتاحاً جديداً ليُستبدل)'}
                    </label>
                    <input
                        id="wathq-key" type="password" autoComplete="off" dir="ltr"
                        value={key} onChange={e => setKey(e.target.value)}
                        placeholder="apiKey من بوّابة واثق" style={field}
                    />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <select
                            aria-label="بيئة واثق" value={env} dir="rtl"
                            onChange={e => setEnv(e.target.value === 'sandbox' ? 'sandbox' : 'production')}
                            style={{ ...field, width: 'auto' }}
                        >
                            <option value="production">الإنتاج (بياناتٌ حقيقيّة)</option>
                            <option value="sandbox">بيئةُ الاختبار</option>
                        </select>
                        <AdmButton variant="primary" onClick={save} disabled={busy || key.trim().length < 16}>
                            احفظ المفتاح
                        </AdmButton>
                    </div>
                    <div style={note}>
                        🪤 بيئةُ الاختبار <strong>لا تحوي</strong> نداءَ تحويل رقم السجل إلى
                        الرقم الوطنيّ، فهي ليست تمريناً كاملاً على مسار الإنتاج.
                    </div>
                </div>

                {msg && <div style={{ ...note, color: 'var(--adm-fg)' }}>{msg}</div>}

                {st && (
                    <>
                        <AdmSettingRow
                            icon="🔁" title="حوّل رقم السجل تلقائياً"
                            desc="الإنتاجُ يطلب الرقم الوطنيّ الموحّد (٧٠٠…)، والتاجرُ يعرف رقمَه العشَريّ."
                            note="٢ ريال مرّةً واحدةً لكلّ تاجر — وبدونه لا يعمل الفحصُ على الإنتاج إطلاقاً."
                            right={<AdmSwitch on={st.convertCr} disabled={busy}
                                              onToggle={() => opt({ convertCr: !st.convertCr })}
                                              label="تحويل رقم السجل" />}
                        />

                        <AdmSettingRow
                            icon="👤" title="افحص مُلّاك السجل"
                            desc="يُظهر أسماء المُلّاك لمقارنتها بالاسم المُدّعى."
                            note="٥ ريالات للنداء — قرينةٌ قويّة، وليست إثباتَ هويّة. مطفأٌ افتراضاً لأنه الوحيدُ الغالي."
                            right={<AdmSwitch on={st.checkOwners} disabled={busy}
                                              onToggle={() => opt({ checkOwners: !st.checkOwners })}
                                              label="فحص المُلّاك" />}
                        />

                        <div style={{ display: 'grid', gap: 6 }}>
                            <label htmlFor="wathq-cap" style={{ fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>
                                سقفُ الصرف الشهريّ (ريال)
                            </label>
                            <input
                                id="wathq-cap" type="number" min={0} max={100000} step={10} dir="ltr"
                                defaultValue={st.monthlyCapSar} style={{ ...field, width: 140 }}
                                onBlur={e => {
                                    const n = Number(e.target.value);
                                    if (Number.isFinite(n) && n !== st.monthlyCapSar) void opt({ monthlyCap: n });
                                }}
                            />
                            <div style={note}>
                                صُرف هذا الشهر <strong>{st.spentThisMonthSar.toFixed(2)}</strong> ريال من{' '}
                                {st.monthlyCapSar.toFixed(2)}. وعند بلوغ السقف يتوقّف الطابورُ
                                ولا يفشل — فلا تُحرق باقةٌ بصمت.
                                <br />
                                🟢 والاستعلامُ عن حالة السجل <strong>مجّانيّ (٠٫٠٠ ريال)</strong>،
                                فمراقبةُ التأكيد السنويّ لكلّ التجّار لا تكلّف شيئاً.
                                والاستعلامُ الفاشل لا يُخصَم أصلاً.
                            </div>
                        </div>
                    </>
                )}
            </div>
        </AdmSection>
    );
};

export default WathqCard;
