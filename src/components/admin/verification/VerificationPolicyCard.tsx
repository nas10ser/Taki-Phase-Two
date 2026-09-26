/**
 * VerificationPolicyCard — سُلَّمُ الإلزام بيد ناصر، وقابلٌ للتراجع بضغطة (v14.95)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 القياسُ الذي شكّل هذه البطاقة: على الإنتاج **١١ عرضاً حيّاً · متجران
 *    نشطان · ولا سجلّ تجاريّ لأيٍّ منهما**. أي أن «شغّل التوثيق» بمفتاحٍ واحد
 *    كان يعني إطفاء المنصّة — ومتجرِ ناصر نفسه معها.
 *
 * فالإلزام ليس مفتاحاً بل **سُلَّمٌ من ثلاث درجات**:
 *   • `off`      — لا أثر إطلاقاً: البطاقة مخفيّة عن التاجر، والحارس يعود فوراً.
 *   • `advisory` — يُطلب التوثيق ويظهر كل شيء، **والنشر مفتوح تماماً**. مرحلةُ
 *                  القياس: هنا وحدها يُعرف كم طلباً يصل وكم يستغرق القرار.
 *   • `required` — يُمنع نشر عرضٍ **جديد** لغير الموثّق. والعروض الحيّة لا تُمسّ.
 *
 * 🪤 ولا يُضغط زرٌّ على عمياء: كل تبديلٍ يعرض **عدد من سيُمنع** قبل التنفيذ.
 *    الرقمُ يأتي من الخادم (`admin_verification_stats`) لا من تخمينٍ في المتصفّح.
 *
 * 🪤 و«وضع السفر» ليس رفاهية: المراجعُ واحد. غيابُه أسبوعاً بلا هذا المفتاح
 *    يعني طابوراً لا يفتحه أحد وتجّاراً مجمَّدين بلا ذنب. يُنزِّل الأثر الفعليّ
 *    من `required` إلى `advisory` بضغطة، ويعود بضغطة.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useApp } from '../../../context/AppContext';
import { supabase } from '../../../services/supabaseClient';
import { writePlatformSetting } from '../../../services/platformSettingWrite';
import { normalizeArabicNumerals } from '../../../utils/helpers';
import { holdLabelGen } from '../../../utils/bookingHold';
import { AdmSection, AdmButton, AdmStat, AdmStatGrid } from '../ui';
import { verificationRepository } from '../../../repositories/verificationRepository';
import type { VerificationStats } from '../../../repositories/verificationRepository';
import { arCount } from '../../../utils/arPlural';
import { DAYS, DEALS, LIVE_DEALS, MERCHANTS, UNVERIFIED_MERCHANTS } from './verificationStatus';

const KEY = 'verification';

type Mode = 'off' | 'advisory' | 'required';

interface Policy { mode: Mode; sla_hours: number; vacation: boolean; show_badge: boolean }

const MODES: { id: Mode; label: string; hint: string }[] = [
    { id: 'off', label: '⚪️ مُطفأ', hint: 'لا شيء يظهر للتاجر ولا شيء يُمنع. الحالة الحالية قبل أن تبدأ.' },
    { id: 'advisory', label: '🟡 نصيحة', hint: 'تظهر بطاقة التوثيق ويصلك الطلب — **والنشر مفتوح تماماً**. ابدأ هنا أسبوعاً على الأقلّ.' },
    { id: 'required', label: '🔴 إلزام', hint: 'لا يُنشر عرضٌ **جديد** إلا من متجرٍ موثّق. والعروض الحيّة لا تتوقّف.' },
];

export const VerificationPolicyCard: React.FC = () => {
    const { customAlert, customConfirm } = useApp();
    const [p, setP] = useState<Policy | null>(null);
    const [sla, setSla] = useState('');
    const [stats, setStats] = useState<VerificationStats | null>(null);
    const [busy, setBusy] = useState('');
    /** '' = ما زالت تُقرأ · نصٌّ = تعذّرت القراءة ومعها سببها. */
    const [readErr, setReadErr] = useState('');

    const load = useCallback(async () => {
        setReadErr('');
        const [{ data, error }, s] = await Promise.all([
            supabase.from('platform_settings').select('value').eq('key', KEY).maybeSingle(),
            verificationRepository.adminStats(),
        ]);
        const v: any = data?.value || {};
        // 🪤 لا يُعرض حقلٌ بقيمةٍ افتراضية قبل وصول الحقيقية: الحفظ حينها يدهس
        //    ضبطَ ناصر بضبطي (درس «حقل تحرير يُهيَّأ بنصٍّ افتراضي»).
        if (!['off', 'advisory', 'required'].includes(v.mode)) {
            // 🪤 ولا يُترك الأمر عند «جارٍ القراءة…» إلى الأبد: سياسةُ القراءة على
            //    `platform_settings` تحمل **قائمة سماحٍ بأسماء المفاتيح**، ومفتاحٌ
            //    خارجها يعود بصفر صفوفٍ **لا بخطأ** (درس v14.92) — فتبدو الشاشة
            //    «تحمّل» أبداً بلا صوت. يُقال السبب ويُعرض زرُّ إعادة المحاولة،
            //    ويبقى الشرط قائماً: لا تُعرض الأزرار بقيمةٍ افتراضية أبداً.
            setReadErr(error
                ? `تعذّرت قراءة السياسة: ${error.message}`
                : 'لم تصل سياسةُ التوثيق من القاعدة — المفتاح غائبٌ أو لا تراه سياسةُ القراءة.');
            return;
        }
        setP({
            mode: v.mode, sla_hours: Number(v.sla_hours) || 24,
            vacation: v.vacation === true, show_badge: v.show_badge === true,
        });
        setSla(String(Number(v.sla_hours) || 24));
        if (s.ok && s.stats) setStats(s.stats);
    }, []);

    useEffect(() => { load(); }, [load]);

    const save = async (patch: Partial<Policy>, label: string) => {
        if (!p) return;
        setBusy(label);
        const next = { ...p, ...patch };
        const err = await writePlatformSetting(KEY, {
            mode: next.mode, sla_hours: next.sla_hours,
            vacation: next.vacation, show_badge: next.show_badge,
        }, 'توثيق التجّار: الوضع ومهلة المراجعة ووضع السفر وشارة المشتري');
        setBusy('');
        if (err) { await customAlert('❌ ' + err); return; }
        setP(next);
        await load();
        return true;
    };

    if (!p) {
        return (
            <AdmSection title="سياسة التوثيق" icon="🎚" desc="مستوى الإلزام ومهلة المراجعة." collapsible defaultOpen={false}>
                {readErr ? (
                    <div style={{ display: 'grid', gap: 9, justifyItems: 'start' }}>
                        <p role="alert" style={{ fontSize: '.78rem', fontWeight: 800, lineHeight: 1.8, color: 'var(--adm-bad-fg)', margin: 0 }}>
                            ⚠️ {readErr}
                        </p>
                        <p style={{ fontSize: '.73rem', color: 'var(--adm-fg-3)', margin: 0, lineHeight: 1.8 }}>
                            ولا تُعرض الأزرار بقيمةٍ افتراضية حتى تصل الحقيقية — فحفظُها حينئذٍ يدهس ضبطك.
                        </p>
                        <AdmButton onClick={load}>🔄 أعِد المحاولة</AdmButton>
                    </div>
                ) : (
                    <p style={{ fontSize: '.78rem', color: 'var(--adm-fg-3)', margin: 0 }}>
                        جارٍ قراءة السياسة الحالية… لا تُعرض الأزرار قبلها حتى لا يُحفظ وضعٌ افتراضيّ فوق الحقيقي.
                    </p>
                )}
            </AdmSection>
        );
    }

    // 🪤 الأرقام عبر `verificationRepository.adminStats()` لا بقراءة مفاتيح jsonb
    //    هنا: مفتاحٌ خاطئ يعرض «0 سيُمنع» فيضغط ناصر على عمياء — والمستودع هو
    //    المكان الوحيد الذي يعرف أسماء حقول القاعدة.
    const pending = stats?.pending ?? 0;
    const oldestHours = stats?.oldestPendingHours ?? 0;
    const unverifiedSellers = stats?.wouldBlock ?? 0;
    const liveDeals = stats?.wouldBlockLiveDeals ?? 0;
    const merchants = stats?.merchants ?? 0;
    const approved = stats?.approved ?? 0;
    /** الأثر الفعليّ: «سفر» يُنزِّل الإلزام إلى نصيحة — ويُقال صراحةً لئلا
     *  يظنّ ناصر أن الإلزام يعمل وهو موقوف. */
    const effective: Mode = p.mode === 'required' && p.vacation ? 'advisory' : p.mode;
    const effectiveLabel = MODES.find(m => m.id === effective)?.label ?? '';

    const pickMode = async (m: Mode) => {
        if (m === p.mode) return;
        if (m === 'required') {
            const ok = await customConfirm(
                `⚠️ تفعيل الإلزام.\n\n` +
                `سيُمنع من نشر عرضٍ جديد: ${arCount(unverifiedSellers, UNVERIFIED_MERCHANTS)}.\n` +
                `ولن تتوقّف عروضهم الحيّة (${arCount(liveDeals, DEALS)}) — تبقى كما هي.\n\n` +
                `والتراجع ضغطةٌ واحدة إلى «نصيحة».\n\nهل تفعّل الإلزام؟`);
            if (!ok) return;
        }
        if (await save({ mode: m }, m)) {
            await customAlert(m === 'off' ? '✅ أُطفئ التوثيق — لا شيء يظهر ولا شيء يُمنع.'
                : m === 'advisory' ? '✅ صار «نصيحة» — يظهر للتجّار ويصلك طلبهم، والنشر مفتوح.'
                : '✅ صار «إلزام» — لا يُنشر عرضٌ جديد إلا من متجرٍ موثّق.');
        }
    };

    const saveSla = async () => {
        const n = parseFloat(normalizeArabicNumerals(sla));
        if (!Number.isFinite(n) || n < 1 || n > 720) {
            await customAlert('⚠️ المهلة بين ساعة واحدة و٧٢٠ ساعة (٣٠ يوماً).'); return;
        }
        if (await save({ sla_hours: n }, 'sla')) {
            await customAlert(`✅ صار الوعد «نردّ خلال ${holdLabelGen(n, true)}».`);
        }
    };

    const openGrace = async () => {
        const days = 60;
        const until = new Date();
        until.setDate(until.getDate() + days);
        // 🪤 التاريخ يُبنى من حقولٍ محلّية لا من toISOString — الأخيرة تُرجع
        //    اليوم إلى الوراء على توقيت +٣ (درس مسجَّل في قواعد المشروع).
        const ymd = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, '0')}-${String(until.getDate()).padStart(2, '0')}`;
        const ok = await customConfirm(
            `مهلةٌ انتقالية حتى ${ymd} (${arCount(days, DAYS)}).\n\n` +
            `تُجمَّد قائمةُ التجّار القائمين الآن (${arCount(unverifiedSellers, MERCHANTS)}) فيواصلون النشر خلالها بلا توثيق.\n` +
            `ومن يسجّل بعد هذه اللحظة يلزمه التوثيق من يومه الأوّل.\n\nهل أفتحها؟`);
        if (!ok) return;
        setBusy('grace');
        // 🪤 ردُّ الدالّة jsonb: `ok:false` يصل بـ`error=null`، فمن يفحص الخطأ
        //    وحده يقول «✅ فُتحت المهلة» عن مهلةٍ لم تُفتح.
        const r = await verificationRepository.adminOpenGrace(until.toISOString());
        setBusy('');
        if (!r.ok) { await customAlert('❌ ' + (r.msg || r.error || 'تعذّر فتح المهلة.')); return; }
        await customAlert(`✅ فُتحت المهلة حتى ${ymd} — شملت ${arCount(r.stores ?? 0, MERCHANTS)}.`);
        await load();
    };

    const sweep = async () => {
        setBusy('sweep');
        // القياس أوّلاً: `dryRun` يعدّ ولا يلمس، فالرقم يُرى قبل أن يُضغط.
        const dry = await verificationRepository.adminSweep(true);
        setBusy('');
        if (!dry.ok) { await customAlert('❌ ' + (dry.msg || 'تعذّر عدّ العروض.')); return; }
        const n = dry.wouldPause ?? dry.paused ?? 0;
        if (n === 0) { await customAlert('✅ لا عرضَ حيٍّ لمتجرٍ غير موثّق — لا شيء يُكنس.'); return; }
        const ok = await customConfirm(
            `⚠️ ستُوقَف ${arCount(n, LIVE_DEALS)} لمتاجرَ غير موثّقة.\n\n` +
            `تعود بضغطةٍ من التاجر بعد توثيقه. وهذا إجراءٌ لا تحتاجه إلا بعد انتهاء المهلة الانتقالية.\n\nأتابع؟`);
        if (!ok) return;
        setBusy('sweep');
        const res = await verificationRepository.adminSweep(false);
        setBusy('');
        // 🪤 ولا يُقال «أُوقف» إلا بعد `ok` من الردّ نفسه لا من غياب الخطأ وحده.
        if (!res.ok) { await customAlert('❌ ' + (res.msg || 'تعذّر إيقاف العروض.')); return; }
        await customAlert(`✅ أُوقف ${arCount(res.paused ?? 0, DEALS)}، وأُشعر أصحابها.`);
        await load();
    };

    const box: React.CSSProperties = {
        padding: 12, borderRadius: 'var(--adm-r-sm)',
        border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)',
    };

    return (
        <AdmSection
            title="سياسة التوثيق"
            icon="🎚"
            desc="مستوى الإلزام · مهلة المراجعة المعلنة · وضع السفر. كلّها تسري فوراً بلا نشر."
            collapsible
            defaultOpen={false}
        >
            {effective !== p.mode && (
                <p style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--adm-fg)', margin: '0 0 10px',
                            padding: 10, borderRadius: 'var(--adm-r-sm)',
                            border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)' }}>
                    🧳 وضع السفر مُفعَّل — الأثر الفعليّ الآن «{effectiveLabel}» لا «إلزام».
                </p>
            )}
            <AdmStatGrid cols={3}>
                <AdmStat
                    label="بانتظار مراجعتك" value={String(pending)} icon="⏳"
                    scope={pending > 0 && oldestHours > 0
                        ? `أقدمُ طلبٍ منذ ${holdLabelGen(Math.round(oldestHours), true)}`
                        : 'الطابور الآن'}
                    tone={pending > 0 ? 'warn' : 'ok'} />
                <AdmStat
                    label="موثّقون من التجّار" value={`${approved} / ${merchants}`} icon="✅"
                    scope="كل تجّار المنصّة" tone={approved > 0 ? 'ok' : 'neutral'} />
                <AdmStat
                    label="سيُمنعون لو فعّلتَ الإلزام" value={String(unverifiedSellers)} icon="🚧"
                    scope={`الآن · ولن تتوقّف عروضهم الحيّة (${arCount(liveDeals, DEALS)})`}
                    tone={unverifiedSellers > 0 ? 'warn' : 'ok'} />
            </AdmStatGrid>

            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
                {MODES.map(m => {
                    const on = p.mode === m.id;
                    return (
                        <button
                            key={m.id} type="button" onClick={() => pickMode(m.id)} disabled={!!busy}
                            className="adm-focusable"
                            style={{
                                ...box, textAlign: 'right', cursor: busy ? 'default' : 'pointer',
                                borderColor: on ? 'var(--primary)' : 'var(--adm-border)',
                                borderWidth: on ? 2 : 1, borderStyle: 'solid',
                                background: on ? 'var(--adm-surface)' : 'var(--adm-surface-2)',
                            }}
                        >
                            <div style={{ fontSize: '.86rem', fontWeight: 900, color: 'var(--adm-fg)' }}>
                                {m.label}{on ? ' — الحالي' : ''}
                            </div>
                            <div style={{ fontSize: '.73rem', lineHeight: 1.85, color: 'var(--adm-fg-3)', marginTop: 5 }}>
                                {m.hint.replace(/\*\*/g, '')}
                            </div>
                        </button>
                    );
                })}
            </div>

            {p.mode === 'required' && (
                <div style={{ ...box, marginTop: 12, borderColor: p.vacation ? 'var(--primary)' : 'var(--adm-border)' }}>
                    <div style={{ fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)' }}>🧳 وضع السفر</div>
                    <div style={{ fontSize: '.73rem', lineHeight: 1.85, color: 'var(--adm-fg-3)', margin: '6px 0 10px' }}>
                        أنت المراجع الوحيد. حين تسافر أو تمرض، هذا المفتاح يُنزِّل الأثر إلى «نصيحة»
                        فلا يتجمّد تاجرٌ خلف طابورٍ لا يفتحه أحد — ويعود بضغطة.
                        {p.vacation && <><br /><strong style={{ color: 'var(--adm-fg)' }}>مُفعَّل الآن: الأثر الفعليّ «نصيحة».</strong></>}
                    </div>
                    <AdmButton
                        variant={p.vacation ? 'primary' : undefined}
                        disabled={!!busy}
                        onClick={async () => {
                            if (await save({ vacation: !p.vacation }, 'vac')) {
                                await customAlert(!p.vacation
                                    ? '🧳 فُعّل وضع السفر — الإلزام موقوفٌ مؤقتاً.'
                                    : '✅ أُلغي وضع السفر — عاد الإلزام.');
                            }
                        }}
                    >
                        {p.vacation ? '↩️ أنهِ وضع السفر' : '🧳 فعّل وضع السفر'}
                    </AdmButton>
                </div>
            )}

            {p.mode !== 'off' && (
                <>
                    <div style={{ ...box, marginTop: 12 }}>
                        <div style={{ fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)', marginBottom: 4 }}>⏱ مهلة المراجعة المعلنة</div>
                        <div style={{ fontSize: '.73rem', lineHeight: 1.85, color: 'var(--adm-fg-3)', marginBottom: 9 }}>
                            الوعدُ الذي يراه التاجر لحظة الإرسال. <strong style={{ color: 'var(--adm-fg)' }}>لا تختر رقماً قبل أن تراجع طلباتٍ حقيقية</strong> —
                            وعدٌ لا تفي به أسوأ من ألّا تَعِد.
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '.8rem', fontWeight: 800, color: 'var(--adm-fg)' }}>نراجع خلال</span>
                            <input
                                type="number" min={1} max={720} step={1} inputMode="numeric" dir="ltr"
                                value={sla} onChange={e => setSla(normalizeArabicNumerals(e.target.value))}
                                aria-label="مهلة مراجعة التوثيق بالساعات" className="adm-focusable"
                                style={{
                                    width: 88, padding: '9px 10px', textAlign: 'center', fontWeight: 800,
                                    borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
                                    background: 'var(--adm-surface)', color: 'var(--adm-fg)', fontSize: '.9rem',
                                }}
                            />
                            <span style={{ fontSize: '.8rem', fontWeight: 800, color: 'var(--adm-fg-2)' }}>ساعة</span>
                            <AdmButton variant="primary" disabled={!!busy} onClick={saveSla}>
                                {busy === 'sla' ? 'جاري الحفظ…' : '💾 حفظ'}
                            </AdmButton>
                        </div>
                    </div>

                    <div style={{ ...box, marginTop: 12 }}>
                        <div style={{ fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)', marginBottom: 4 }}>✅ شارة «متجر موثّق» للمشتري</div>
                        <div style={{ fontSize: '.73rem', lineHeight: 1.85, color: 'var(--adm-fg-3)', marginBottom: 9 }}>
                            مكسبُ ثقةٍ للموثّق، وثمنُه أن غير الموثّق يبدو أسوأ — وهو ضغطٌ مفيد إن كان الإلزام قادماً،
                            ومؤذٍ إن بقيتَ على «نصيحة» طويلاً.
                        </div>
                        <AdmButton
                            variant={p.show_badge ? 'primary' : undefined} disabled={!!busy}
                            onClick={async () => {
                                if (await save({ show_badge: !p.show_badge }, 'badge')) {
                                    await customAlert(!p.show_badge ? '✅ صارت الشارة ظاهرة للمشترين.' : '✅ أُخفيت الشارة.');
                                }
                            }}
                        >
                            {p.show_badge ? '🙈 أخفِ الشارة' : '👁 أظهِر الشارة'}
                        </AdmButton>
                    </div>

                    <div style={{ ...box, marginTop: 12 }}>
                        <div style={{ fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)', marginBottom: 4 }}>🕊 المهلة الانتقالية والكنس</div>
                        <div style={{ fontSize: '.73rem', lineHeight: 1.85, color: 'var(--adm-fg-3)', marginBottom: 9 }}>
                            افتح المهلة <strong style={{ color: 'var(--adm-fg)' }}>قبل</strong> تفعيل الإلزام: تُجمَّد قائمةُ التجّار القائمين الآن فيواصلون
                            النشر خلالها. والكنسُ لا تحتاجه إلا <strong style={{ color: 'var(--adm-fg)' }}>بعد</strong> انتهائها — ويعرض العدد قبل التنفيذ.
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <AdmButton disabled={!!busy} onClick={openGrace}>
                                {busy === 'grace' ? 'جارٍ…' : '🕊 افتح مهلةً انتقالية (٦٠ يوماً)'}
                            </AdmButton>
                            <AdmButton disabled={!!busy} onClick={sweep}>
                                {busy === 'sweep' ? 'جارٍ العدّ…' : '🧹 اكنس العروض غير الموثّقة'}
                            </AdmButton>
                        </div>
                    </div>
                </>
            )}
        </AdmSection>
    );
};

export default VerificationPolicyCard;
