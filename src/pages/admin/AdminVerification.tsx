/**
 * AdminVerification — طابور توثيق المتاجر (v14.95)
 * ═══════════════════════════════════════════════════════════════════════════
 * شاشةٌ يفتحها شخصٌ واحد على جوّاله، وغالباً وهو ينتظر في مكانٍ ما. فالهدف
 * المعماريّ هنا ليس «عرض جدول» بل **نظرةٌ وضغطتان**: الصفّ يقول في سطرٍ واحد
 * كل ما يفرّق طلباً عن طلب (المتجر · الاسم المكتوب · الرقم · متى وصل · وعلامةُ
 * خطرٍ إن وُجدت)، وفتحُه يعطي بطاقة القرار كاملةً بلا انتقالٍ ولا نافذة.
 *
 * ── ما تقوله الأرقام فوق، ولماذا كلٌّ منها بنطاقه ───────────────────────
 * مصدرها `admin_verification_stats` وهي **عن المنصّة كلّها ولا تتأثّر
 * بالمرشِّح** الذي يحكم القائمة تحتها. وخلطُ الاثنين هو بالضبط العيب الذي
 * كلّف قراراً في v14.33 («ظهر ٥٠ من ٤١٢» مقارنةً بين مُرشَّحٍ وغير مُرشَّح) —
 * فلكل بطاقةٍ هنا `scope` يقوله صراحةً.
 *
 * 🪤 و«أقدم طلب منذ» لا يُصاغ بيد: `arCount` وحدها («ساعتان» لا «٢ ساعة»).
 * 🪤 والترقيم بمؤشّر `submitted_at` لا بـOFFSET — فلا يسقط طلبٌ بين صفحتين
 *    حين يصل طلبٌ جديد أثناء التصفّح (قاعدة «لا يسقط شيء»، v14.28).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
    AdmSection, AdmStat, AdmStatGrid, AdmPill, AdmEmpty, AdmSkeleton, AdmButton, AdmError, admNum,
} from '../../components/admin/ui';
import { VerificationPill } from '../../components/admin/verification/VerificationPill';
import { VerificationPolicyCard } from '../../components/admin/verification/VerificationPolicyCard';
import { VerificationReview } from '../../components/admin/verification/VerificationReview';
import {
    QUEUE_STATUSES, statusMeta, kindLabel, hoursSince, DAYS, STORES, REQUESTS,
} from '../../components/admin/verification/verificationStatus';
import { verificationRepository } from '../../repositories/verificationRepository';
import type {
    AdminVerificationRow, VerificationStats, VerificationStatus,
} from '../../repositories/verificationRepository';
import { arCount, HOURS } from '../../utils/arPlural';

const PAGE = 25;

/** أسماء الأوضاع الثلاثة — تُعرض هنا ولا تُضبط: الضبط في بطاقة سياسة التوثيق. */
const MODE_AR: Record<string, string> = {
    off: '⚪️ مُطفأ', advisory: '🟡 نصيحة', required: '🔴 إلزام',
};

/** «منذ ساعتين» / «منذ 3 أيام» — بمحرّك الجمع، وبالساعات ما دامت مفيدة. */
const ago = (iso: string | null | undefined): string => {
    const h = hoursSince(iso);
    if (h === null) return '—';
    if (h < 1) return 'قبل أقل من ساعة';
    if (h < 72) return `منذ ${arCount(Math.round(h), HOURS, true)}`;
    return `منذ ${arCount(Math.round(h / 24), DAYS, true)}`;
};

const chipStyle = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5,
    padding: '5px 11px', borderRadius: 999,
    fontSize: '.75rem', fontWeight: 800, whiteSpace: 'nowrap', cursor: 'pointer',
    border: `1px solid ${active ? 'transparent' : 'var(--adm-border)'}`,
    background: active ? 'var(--adm-accent)' : 'var(--adm-surface-2)',
    color: active ? '#ffffff' : 'var(--adm-fg-2)',
});

const rowCard: React.CSSProperties = {
    background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)',
    borderRadius: 'var(--adm-r-sm)', padding: '12px 13px',
};

const AdminVerification: React.FC = () => {
    const [status, setStatus] = useState<VerificationStatus | null>('submitted');
    const [rows, setRows] = useState<AdminVerificationRow[]>([]);
    const [next, setNext] = useState<string | null>(null);
    const [stats, setStats] = useState<VerificationStats | null>(null);
    const [loading, setLoading] = useState(true);
    const [more, setMore] = useState(false);
    const [err, setErr] = useState('');
    const [open, setOpen] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setErr('');
        const [q, s] = await Promise.all([
            verificationRepository.adminList(status, PAGE, null),
            verificationRepository.adminStats(),
        ]);
        if (!q.ok) { setErr(q.msg || 'تعذّر جلب الطابور من الخادم.'); setRows([]); setNext(null); }
        else { setRows(q.rows || []); setNext(q.nextCursor || null); setOpen(null); }
        if (s.ok && s.stats) setStats(s.stats);
        setLoading(false);
    }, [status]);

    useEffect(() => { load(); }, [load]);

    const loadMore = async () => {
        if (!next || more) return;
        setMore(true);
        const q = await verificationRepository.adminList(status, PAGE, next);
        setMore(false);
        if (!q.ok) { setErr(q.msg || 'تعذّر جلب بقيّة الطابور.'); return; }
        // 🪤 المؤشّر زمنيّ، وطلبان في الثانية نفسها واردان — فالدمج بالهويّة
        //    لا بالإلحاق الأعمى، وإلا ظهر صفٌّ مرّتين وبدا الطابور أطول مما هو.
        setRows((prev) => {
            const seen = new Set(prev.map((r) => r.id));
            return [...prev, ...(q.rows || []).filter((r) => !seen.has(r.id))];
        });
        setNext(q.nextCursor || null);
    };

    const slaHours = stats?.policy?.sla_hours ?? 24;
    const oldest = stats?.oldestPendingHours ?? null;
    const late = oldest !== null && oldest > slaHours;

    // ── الأرقام ──────────────────────────────────────────────────────────
    const statsBlock = (
        <AdmStatGrid cols={4}>
            <AdmStat
                label="بانتظار المراجعة"
                value={admNum(stats?.pending ?? 0)}
                tone={(stats?.pending ?? 0) > 0 ? 'warn' : 'ok'}
                icon="⏳"
                scope="كل المنصّة — لا يتأثّر بالمرشِّح"
                title="طلباتٌ وصلت ولم يُبتّ فيها بعد. هذه وحدها هي العمل."
            />
            <AdmStat
                label="أقدم طلب منذ"
                value={oldest === null ? '—' : arCount(Math.round(oldest), HOURS)}
                tone={late ? 'bad' : oldest === null ? 'ok' : 'neutral'}
                icon="🕐"
                scope={oldest === null
                    ? 'لا طلب معلَّق الآن'
                    : `المهلة المعلنة ${arCount(slaHours, HOURS)}`}
                title="عمر أقدم طلبٍ لم يُبتّ فيه. تجاوزُه المهلة المعلنة يعني أننا أخلفنا وعداً مكتوباً في لوحة التاجر."
            />
            <AdmStat
                label="متاجر موثّقة"
                value={admNum(stats?.approved ?? 0)}
                tone="ok"
                icon="✅"
                scope={`كل المنصّة — من ${arCount(stats?.merchants ?? 0, STORES, true)}`}
                title="متاجر توثيقها معتمدٌ وسارٍ الآن (غير المنتهي وغير المسحوب)."
            />
            <AdmStat
                label="طلبات مرفوضة"
                value={admNum(stats?.rejected30d ?? 0)}
                tone={(stats?.rejected30d ?? 0) > 0 ? 'warn' : 'neutral'}
                icon="❌"
                scope="كل المنصّة — خلال آخر ثلاثين يوماً"
                title="كثرةُ الرفض في نوعٍ واحد من الوثائق غالباً عيبٌ في شرح الحقل لا في التجّار."
            />
        </AdmStatGrid>
    );

    // ── الطابور ──────────────────────────────────────────────────────────
    let body: React.ReactNode;
    if (loading) {
        body = <AdmSkeleton rows={4} height={86} />;
    } else if (err) {
        body = <AdmError message={err} onRetry={load} />;
    } else if (rows.length === 0) {
        const m = status ? statusMeta(status) : null;
        body = (
            <AdmEmpty
                icon={status === 'submitted' ? '🎉' : '—'}
                title={status === 'submitted' ? 'لا طلب ينتظر قرارك' : `لا طلب في حالة «${m?.label || 'الكل'}»`}
                hint={
                    stats && stats.mode === 'off'
                        ? 'وضع التوثيق «مُطفأ» الآن — بطاقة التوثيق لا تظهر للتاجر أصلاً، فلن يصل طلبٌ حتى تنقله إلى «نصيحة» من بطاقة سياسة التوثيق.'
                        : status === 'submitted'
                            ? 'كل ما وصل بُتّ فيه. الطلب الجديد يظهر هنا فور إرسال التاجر له من لوحته — وتذكيرُك به مسؤوليّة هذه الشاشة وحدها.'
                            : 'جرّب حالةً أخرى من المرشِّح فوق، أو «الكل» لترى السجلّ كاملاً.'
                }
                action={status !== null
                    ? <AdmButton size="sm" onClick={() => setStatus(null)}>عرض كل الحالات</AdmButton>
                    : undefined}
            />
        );
    } else {
        body = (
            <div style={{ display: 'grid', gap: 10 }}>
                {rows.map((r) => {
                    const isOpen = open === r.id;
                    const h = hoursSince(r.submittedAt);
                    const overdue = r.status === 'submitted' && h !== null && h > slaHours;
                    return (
                        <div key={r.id} style={rowCard}>
                            <button
                                type="button"
                                onClick={() => setOpen(isOpen ? null : r.id)}
                                aria-expanded={isOpen}
                                className="adm-focusable"
                                style={{
                                    width: '100%', display: 'grid', gap: 7, textAlign: 'right',
                                    background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
                                    color: 'var(--adm-fg)', fontFamily: 'inherit',
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '.92rem', fontWeight: 900 }}>{r.shop || r.storeId}</span>
                                    <span style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>{ago(r.submittedAt)}</span>
                                </div>
                                <div style={{ fontSize: '.78rem', fontWeight: 700, color: 'var(--adm-fg-2)', wordBreak: 'break-word' }}>
                                    {kindLabel(r.docKind)} · <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>{r.docNumber}</span>
                                </div>
                                <div style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--adm-fg-3)', wordBreak: 'break-word' }}>
                                    كتب التاجر: {r.claimedName || '—'}
                                </div>
                                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                                    <VerificationPill status={r.status} />
                                    {r.dupNumber && <AdmPill tone="bad">⚠️ نفس الرقم في طلبٍ آخر</AdmPill>}
                                    {!r.nameMatches && <AdmPill tone="warn">⚠️ الاسم لا يطابق اسم المتجر</AdmPill>}
                                    {overdue && (
                                        <AdmPill tone="bad" title="تجاوز المهلة المعلنة للمراجعة في لوحة التاجر.">
                                            ⏰ تجاوز المهلة
                                        </AdmPill>
                                    )}
                                    <span style={{ marginInlineStart: 'auto', fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-2)' }}>
                                        {isOpen ? 'إخفاء ▲' : 'افتح للمراجعة ▼'}
                                    </span>
                                </div>
                            </button>

                            {isOpen && <VerificationReview row={r} onDone={load} />}
                        </div>
                    );
                })}

                {next && (
                    <AdmButton full onClick={loadMore} disabled={more}>
                        {more ? 'جارٍ التحميل…' : `المعروض الآن: ${arCount(rows.length, REQUESTS)} — عرض المزيد`}
                    </AdmButton>
                )}
            </div>
        );
    }

    const curLabel = status ? statusMeta(status).label : 'كل الحالات';

    return (
        <div dir="rtl" style={{ display: 'grid', gap: 14 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <p style={{ flex: '1 1 260px', margin: 0, fontSize: '.85rem', lineHeight: 1.8, color: 'var(--adm-fg-2)' }}>
                    هنا يُبتّ في توثيق المتاجر: التاجر يرسل رقم وثيقته والاسم المسجَّل، وأنت تفتح السجل
                    الرسميّ وتقارن ثم تعتمد أو ترفض بسببٍ يصله. والاسم الذي تعتمده هو ما يُطبع على
                    فواتير ذلك المتجر — فلا يُنسخ من كتابة التاجر بلا أن تراه في السجل.
                </p>
                <AdmButton onClick={load} title="إعادة جلب الطابور والعدّادات من قاعدة البيانات">🔄 تحديث</AdmButton>
            </div>

            {stats && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <AdmPill tone={stats.mode === 'required' ? 'bad' : stats.mode === 'advisory' ? 'warn' : 'neutral'}>
                        وضع التوثيق الآن: {MODE_AR[stats.mode] || stats.mode}
                    </AdmPill>
                    {stats.policy?.vacation && (
                        <AdmPill tone="info" title="وضع السفر يُنزِّل أثر الإلزام إلى «نصيحة» حتى تُطفئه — فلا يتجمّد تاجرٌ بغيابك.">
                            🧳 وضع السفر مفعّل
                        </AdmPill>
                    )}
                    <span style={{ fontSize: '.72rem', fontWeight: 700, color: 'var(--adm-fg-3)' }}>
                        يُضبط من بطاقة «سياسة التوثيق» أدناه — وبقيّةُ هذه الشاشة للمراجعة وحدها.
                    </span>
                </div>
            )}

            {/* 🪤 البطاقة مركّبةٌ هنا لا في درجٍ عامّ: موضعُ الضبط حيث يُنفَّذ الوعد
                (درس v14.92). وجملتا الشاشة أعلاه وفي الحالة الفارغة تُحيلان إليها —
                ووثيقةٌ تَعِد بما لا يُنفَّذ أسوأ من وثيقةٍ لا تَعِد (v14.82). */}
            <VerificationPolicyCard />

            {statsBlock}

            <AdmSection
                icon="🪪"
                title="طابور المراجعة"
                desc="المرشِّح يحكم هذه القائمة وحدها — والأرقام فوقها عن المنصّة كلّها. افتح الصفّ لترى بطاقة القرار كاملة."
                badge={loading ? undefined : { text: `${arCount(rows.length, REQUESTS)} · ${curLabel}`, tone: 'neutral' }}
            >
                <div style={{ display: 'grid', gap: 12 }}>
                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                        <button type="button" onClick={() => setStatus(null)} aria-pressed={status === null}
                            className="adm-focusable" style={chipStyle(status === null)}>
                            <span aria-hidden="true">•</span> الكل
                        </button>
                        {QUEUE_STATUSES.map((s) => {
                            const m = statusMeta(s);
                            return (
                                <button key={s} type="button" onClick={() => setStatus(s)} aria-pressed={status === s}
                                    title={m.hint} className="adm-focusable" style={chipStyle(status === s)}>
                                    <span aria-hidden="true">{m.icon}</span> {m.label}
                                </button>
                            );
                        })}
                    </div>
                    {body}
                </div>
            </AdmSection>
        </div>
    );
};

export default AdminVerification;
