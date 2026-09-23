/**
 * AdvancedAnalytics — أرقام المنصّة على فترةٍ تختارها (v14.89)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **الفخّ الذي أُغلق هنا: كلمة «إيراد» كانت تعني شيئين.**
 *    كان في هذه الشاشة «💰 الإيراد الشهري المتوقّع» و«💰 الإيرادات الشهرية»
 *    و«GMV»، وفي شاشةٍ أخرى «اشتراكات شهرية» و«إجمالي المبيعات» — وكلّها
 *    «مال» بلا ما يفرّق. وهما مالان مختلفان تماماً:
 *      • **مبيعات التجّار (GMV)** — ما يدفعه المشترون للتجّار. لا يمرّ بحساب
 *        تاكي إطلاقاً (الدفع مباشر لحساب التاجر، بلا عمولة).
 *      • **اشتراكات التجّار في تاكي** — ما تقبضه تاكي فعلاً.
 *    فصارت التسمية واحدة: كل ما في هذا الملفّ من مالٍ هو **اشتراكات**،
 *    و«قيمة مبيعات التجّار (GMV)» في ملفّ المستثمر أعلى الشاشة. ولكل بطاقة
 *    `title` يقول ما يدخل في الرقم وما لا يدخل، و`scope` يقول مداه.
 *
 * 🪤 وما حُذف من هنا لأنه كان مكرّراً في مجموعة «النمو»:
 *    • **خريطة النشاط الأسبوعية** (٧×٢٤): شاشة «المحلل الذكي» تحمل تحليل
 *      ساعات الذروة وهو أغنى (تصنيف × مدينة × ساعة، بفترةٍ حرّة). بقي هنا
 *      سطرُ إحالة.
 *    • **التوزيع الجغرافي**: الجغرافيا كلّها في «جمهور المدن». سطرُ إحالة.
 *    • **جدولا «الاستبقاء» و«الأفواج»**: كانا يجيبان السؤال نفسه («كم عاد
 *      ممّن سجّل في شهر كذا») بجدولين لا يمكن التوفيق بينهما بصرياً. صارا
 *      جدولاً واحداً: الأفواج أساساً، والاستبقاء أعمدةً فيه.
 *
 * 🪤 ولا `dark:` ولا `bg-white` ولا تدرّج: الألوان رموزٌ من `styles.css`
 *    (`--adm-*`) تتبع `.dark-mode` و`.light-mode` معاً.
 */

import React, {
    useCallback,
    useEffect,
    useMemo,
    useState,
    memo,
} from 'react';
import { useHistory } from 'react-router-dom';
import { adminService } from '../../services/adminService';
import { CopyButton } from './CopyButton';
import { ExportButton } from './ExportButton';
import { CsvColumn } from '../../utils/csvExport';
import {
    AdmCard, AdmSection, AdmStat, AdmStatGrid, AdmPill,
    AdmEmpty, AdmSkeleton, AdmButton, AdmTable,
    admNum, admMoney,
} from './ui';
import type { AdmColumn, Tone } from './ui';

// ═══════════════════════════════════════════════════════════════════════════
// الفترة — تحكم أقسام «آخر N يوم» وحدها. الأقسام الشهرية لها مداها المكتوب.
// ═══════════════════════════════════════════════════════════════════════════
type Period = 7 | 30 | 90;

const PERIOD_LABEL: Record<Period, string> = {
    7: '٧ أيام',
    30: '٣٠ يوماً',
    90: '٩٠ يوماً',
};
const periodScope = (p: Period) => `آخر ${PERIOD_LABEL[p]}`;

// ═══════════════════════════════════════════════════════════════════════════
// صِيَغ مشتركة
// ═══════════════════════════════════════════════════════════════════════════
// 🪤 شكلُ الرقم قرارُ لوحةٍ واحد لا قرارُ ملفّ: `admNum`/`admMoney` من نظام
//    التصميم (أرقامٌ لاتينية تصطفّ عمودياً في الجداول)، وهما يمرّران القيمة
//    بـ`Number()` فلا يُسقط عمودُ `numeric` واصلٌ نصّاً الشاشةَ كلّها.
//    والنسبة المئوية وحدها ليست في النظام بعد، فتُبنى منه هنا.
const fmtMoney = admMoney;
const fmtNum = admNum;
const fmtPct = (v: number) => `${admNum(v)}٪`;
const fmtDate = (iso: string | null) => {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleDateString('ar-SA-u-ca-gregory'); } catch { return iso; }
};
const daysAgo = (iso: string) => {
    const ms = Date.now() - new Date(iso).getTime();
    const d = Math.floor(ms / 86400000);
    if (d < 1) return 'اليوم';
    if (d === 1) return 'أمس';
    return `قبل ${fmtNum(d)} يوماً`;
};

/** سطرُ إحالة — «هذا موجودٌ هناك، ولا يُكرَّر هنا». */
const RefLine = memo<{ icon: string; text: string }>(({ icon, text }) => (
    <div
        style={{
            display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap',
            padding: '11px 13px', borderRadius: 'var(--adm-r-sm)',
            background: 'var(--adm-surface-2)', border: '1px solid var(--adm-border)',
        }}
    >
        <span aria-hidden="true" style={{ fontSize: '.95rem', lineHeight: 1 }}>{icon}</span>
        <span style={{ fontSize: '.82rem', fontWeight: 700, color: 'var(--adm-fg-2)', flex: 1, minWidth: 180, lineHeight: 1.7 }}>
            {text}
        </span>
    </div>
));
RefLine.displayName = 'RefLine';

/** كتلةٌ داخل قسم — عنوانٌ صغير وسطرُ سياق، فلا تتراكم البطاقات. */
const Block = memo<{ title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode }>(
    ({ title, hint, right, children }) => (
        <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--adm-border)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                <h4 style={{ margin: 0, fontSize: '.88rem', fontWeight: 800, color: 'var(--adm-fg)' }}>{title}</h4>
                {hint && <span style={{ fontSize: '.74rem', color: 'var(--adm-fg-3)', fontWeight: 600 }}>{hint}</span>}
                {right && <span style={{ marginInlineStart: 'auto' }}>{right}</span>}
            </div>
            {children}
        </div>
    )
);
Block.displayName = 'Block';

// ═══════════════════════════════════════════════════════════════════════════
// ١) اشتراكات التجّار في تاكي — الوضع الحالي + المحصّل + النمو + الحالات
// ═══════════════════════════════════════════════════════════════════════════
interface ForecastData {
    monthly_expected: number;
    paying_sellers: number;
    free_sellers: number;
    trial_sellers: number;
    expires_7d: number;
    expires_30d: number;
    avg_arpu: number;
}
interface MrrPoint { month_key: string; month_label: string; paid_amount: number; paid_count: number; refunded_amount: number; }
interface GrowthPoint { month_key: string; month_label: string; new_subs: number; churned_subs: number; net_change: number; }

const LIFECYCLE_META: Record<string, { label: string; color: string }> = {
    trial: { label: 'تجريبي', color: '#d97706' },
    active: { label: 'نشط', color: '#059669' },
    past_due: { label: 'متأخر', color: '#dc2626' },
    cancelled: { label: 'ملغي', color: '#64748b' },
    gifted: { label: 'هدية', color: '#8b5cf6' },
    frozen: { label: 'مجمّد', color: '#2563eb' },
};

const SubscriptionsSection = memo<{
    forecast: ForecastData | null;
    mrr: MrrPoint[];
    growth: GrowthPoint[];
    lifecycle: Array<{ status: string; cnt: number }>;
}>(({ forecast, mrr, growth, lifecycle }) => {
    // ── المحصّل شهرياً ──
    const mrrMax = Math.max(...mrr.map((d) => d.paid_amount), 1);
    const mrrTotal = mrr.reduce((s, d) => s + d.paid_amount, 0);
    const mrrCurrent = mrr.length ? mrr[mrr.length - 1] : null;
    const mrrPrev = mrr.length > 1 ? mrr[mrr.length - 2] : null;
    const mrrMoM = mrrPrev && mrrPrev.paid_amount > 0 && mrrCurrent
        ? Math.round(((mrrCurrent.paid_amount - mrrPrev.paid_amount) / mrrPrev.paid_amount) * 100)
        : null;

    // ── جديد مقابل إلغاء ──
    const growthMax = Math.max(...growth.flatMap((d) => [d.new_subs, d.churned_subs]), 1);
    const totalNew = growth.reduce((s, d) => s + d.new_subs, 0);
    const totalChurn = growth.reduce((s, d) => s + d.churned_subs, 0);
    const net = totalNew - totalChurn;

    // ── توزيع الحالات ──
    const lcTotal = lifecycle.reduce((s, d) => s + d.cnt, 0);

    return (
        <AdmSection
            icon="💳"
            title="اشتراكات التجّار في تاكي"
            desc="ما تقبضه تاكي من التجّار مقابل الاشتراك في المنصّة. لا علاقة له بمبيعات المتاجر — تلك في «قيمة مبيعات التجّار (GMV)» أعلى الشاشة."
        >
            <AdmStatGrid cols={3}>
                <AdmStat
                    icon="💳"
                    label="اشتراكات التجّار في تاكي — المتوقّع شهرياً"
                    value={forecast ? fmtMoney(forecast.monthly_expected) : '—'}
                    scope="الاشتراكات النشطة الآن، بعد الخصم"
                    tone="ok"
                    title="مجموع ما يدفعه التجّار المشتركون لتاكي شهرياً بعد خصوماتهم. لا يدخل فيه أي ريال من مبيعات المتاجر، ولا يعني أنه حُصّل فعلاً — المحصّل في «المحصّل فعلاً» أدناه."
                />
                <AdmStat
                    icon="📐"
                    label="متوسط اشتراك التاجر (ARPU)"
                    value={forecast ? fmtMoney(forecast.avg_arpu) : '—'}
                    scope="لكل تاجرٍ مشترك"
                    title="المتوقّع شهرياً ÷ عدد التجّار المشتركين. لا يشمل التجّار المجانيين ولا التجريبيين."
                />
                <AdmStat
                    icon="✅"
                    label="تجّار مشتركون"
                    value={forecast ? fmtNum(forecast.paying_sellers) : '—'}
                    scope="كل المنصّة"
                    title="تجّار على باقةٍ مدفوعة نشطة، غير موقوفين."
                />
                <AdmStat
                    icon="🧪"
                    label="تجّار على تجربة"
                    value={forecast ? fmtNum(forecast.trial_sellers) : '—'}
                    scope="كل المنصّة"
                    tone="info"
                    title="تجّار في فترة التجربة — لم يدفعوا بعد."
                />
                <AdmStat
                    icon="🆓"
                    label="تجّار على الباقة المجانية"
                    value={forecast ? fmtNum(forecast.free_sellers) : '—'}
                    scope="كل المنصّة"
                    title="تجّار يعملون بلا اشتراك مدفوع — لا يدخلون في أي رقمٍ مالي هنا."
                />
                <AdmStat
                    icon="⏳"
                    label="اشتراكٌ ينتهي قريباً"
                    value={forecast ? fmtNum(forecast.expires_7d) : '—'}
                    scope={forecast ? `و${fmtNum(forecast.expires_30d)} خلال ٣٠ يوماً` : undefined}
                    tone={forecast && forecast.expires_7d > 0 ? 'bad' : 'neutral'}
                    title="عدد التجّار الذين ينتهي اشتراكهم خلال سبعة أيام. تفاصيلهم في «جدول الاشتراكات» أدناه."
                />
            </AdmStatGrid>

            {/* ── المحصّل فعلاً ─────────────────────────────────────────── */}
            <Block
                title="المحصّل فعلاً — آخر ١٢ شهراً"
                hint={mrr.length ? `إجمالي ${fmtMoney(mrrTotal)}` : undefined}
            >
                {mrr.length === 0 ? (
                    <AdmEmpty
                        icon="💤"
                        title="لا دفعات اشتراكٍ مسجّلة بعد"
                        hint="يبدأ هذا المخطّط عند أوّل دفعة اشتراكٍ تصل من بوّابة الدفع."
                    />
                ) : (
                    <>
                        <div style={{ marginBottom: 12 }}>
                            <AdmStatGrid cols={2}>
                                <AdmStat
                                    label="هذا الشهر"
                                    value={fmtMoney(mrrCurrent?.paid_amount ?? 0)}
                                    scope={`${fmtNum(mrrCurrent?.paid_count ?? 0)} دفعة`}
                                    tone="ok"
                                    delta={mrrMoM === null ? undefined : {
                                        text: `${mrrMoM >= 0 ? '▲' : '▼'} ${fmtNum(Math.abs(mrrMoM))}٪ عن الشهر السابق`,
                                        good: mrrMoM === 0 ? undefined : mrrMoM > 0,
                                    }}
                                    title="مجموع دفعات الاشتراك المسجّلة في الشهر الجاري — مالٌ وصل تاكي فعلاً."
                                />
                                <AdmStat
                                    label="مستردّ للتجّار"
                                    value={fmtMoney(mrr.reduce((s, d) => s + d.refunded_amount, 0))}
                                    scope="آخر ١٢ شهراً"
                                    tone="warn"
                                    title="دفعات اشتراكٍ أُعيدت للتاجر — تُطرح من المحصّل."
                                />
                            </AdmStatGrid>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 118 }}>
                            {mrr.map((d) => (
                                <div
                                    key={d.month_key}
                                    title={`${d.month_label}: ${fmtMoney(d.paid_amount)} · ${fmtNum(d.paid_count)} دفعة`}
                                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, height: '100%', justifyContent: 'flex-end' }}
                                >
                                    <div
                                        style={{
                                            width: '100%',
                                            height: `${(d.paid_amount / mrrMax) * 100}%`,
                                            minHeight: 2,
                                            background: 'var(--adm-accent)',
                                            borderRadius: '5px 5px 0 0',
                                        }}
                                    />
                                    <span style={{ fontSize: '.6rem', fontWeight: 700, color: 'var(--adm-fg-3)', whiteSpace: 'nowrap' }}>
                                        {d.month_label}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </>
                )}
            </Block>

            {/* ── جديد مقابل إلغاء ──────────────────────────────────────── */}
            {growth.length > 0 && (
                <Block
                    title="اشتراكاتٌ جديدة مقابل إلغاءات — آخر ١٢ شهراً"
                    hint="الأخضر انضمام، والأحمر إلغاء"
                >
                    <div style={{ marginBottom: 12 }}>
                        <AdmStatGrid cols={3}>
                            <AdmStat label="اشتراكات جديدة" value={fmtNum(totalNew)} scope="آخر ١٢ شهراً" tone="ok" />
                            <AdmStat label="إلغاءات" value={fmtNum(totalChurn)} scope="آخر ١٢ شهراً" tone={totalChurn > 0 ? 'bad' : 'neutral'} />
                            <AdmStat
                                label="الصافي"
                                value={`${net >= 0 ? '+' : '−'}${fmtNum(Math.abs(net))}`}
                                scope="جديد ناقص إلغاء"
                                tone={net > 0 ? 'ok' : net < 0 ? 'bad' : 'neutral'}
                            />
                        </AdmStatGrid>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 104 }}>
                        {growth.map((d) => (
                            <div
                                key={d.month_key}
                                title={`${d.month_label}: +${fmtNum(d.new_subs)} جديد · −${fmtNum(d.churned_subs)} إلغاء`}
                                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, height: '100%', justifyContent: 'flex-end' }}
                            >
                                <div style={{ width: '100%', display: 'flex', gap: 2, alignItems: 'flex-end', height: '100%' }}>
                                    <div style={{ flex: 1, height: `${(d.new_subs / growthMax) * 100}%`, minHeight: d.new_subs > 0 ? 2 : 0, background: 'var(--adm-ok-fg)', borderRadius: '4px 4px 0 0' }} />
                                    <div style={{ flex: 1, height: `${(d.churned_subs / growthMax) * 100}%`, minHeight: d.churned_subs > 0 ? 2 : 0, background: 'var(--adm-bad-fg)', borderRadius: '4px 4px 0 0' }} />
                                </div>
                                <span style={{ fontSize: '.6rem', fontWeight: 700, color: 'var(--adm-fg-3)', whiteSpace: 'nowrap' }}>
                                    {d.month_label}
                                </span>
                            </div>
                        ))}
                    </div>
                </Block>
            )}

            {/* ── توزيع الحالات ─────────────────────────────────────────── */}
            <Block title="حالات الاشتراكات الآن" hint={lcTotal > 0 ? `${fmtNum(lcTotal)} اشتراكاً` : undefined}>
                {lcTotal === 0 ? (
                    <AdmEmpty icon="🍩" title="لا اشتراكات بعد" hint="يظهر التوزيع عند أوّل اشتراكٍ يُسجَّل على المنصّة." />
                ) : (
                    <LifecycleDonut data={lifecycle} total={lcTotal} />
                )}
            </Block>
        </AdmSection>
    );
});
SubscriptionsSection.displayName = 'SubscriptionsSection';

const LifecycleDonut = memo<{ data: Array<{ status: string; cnt: number }>; total: number }>(({ data, total }) => {
    let cum = 0;
    const arcs = data.map((d) => {
        const meta = LIFECYCLE_META[d.status] ?? { label: d.status, color: '#94a3b8' };
        const start = cum / total;
        cum += d.cnt;
        return { ...d, meta, start, end: cum / total, pct: Math.round((d.cnt / total) * 100) };
    });
    const polar = (cx: number, cy: number, r: number, angle: number) => {
        const a = (angle - 0.25) * 2 * Math.PI; // يبدأ من الساعة ١٢
        return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    };
    const arcPath = (start: number, end: number) => {
        if (end - start >= 0.999) return 'M 50 5 A 45 45 0 1 1 49.99 5 Z';
        const p1 = polar(50, 50, 45, start);
        const p2 = polar(50, 50, 45, end);
        return `M ${p1.x} ${p1.y} A 45 45 0 ${end - start > 0.5 ? 1 : 0} 1 ${p2.x} ${p2.y}`;
    };
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <svg viewBox="0 0 100 100" style={{ width: 124, height: 124, flexShrink: 0 }} role="img" aria-label={`توزيع ${total} اشتراكاً على الحالات`}>
                {arcs.map((a) => (
                    <path key={a.status} d={arcPath(a.start, a.end)} fill="none" stroke={a.meta.color} strokeWidth="12" />
                ))}
                <text x="50" y="47" textAnchor="middle" style={{ fill: 'var(--adm-fg)', fontSize: 15, fontWeight: 900 }}>
                    {total}
                </text>
                <text x="50" y="59" textAnchor="middle" style={{ fill: 'var(--adm-fg-3)', fontSize: 6, fontWeight: 700 }}>
                    اشتراك
                </text>
            </svg>
            <div style={{ flex: 1, minWidth: 180, display: 'grid', gap: 7 }}>
                {arcs.map((a) => (
                    <div key={a.status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span aria-hidden="true" style={{ width: 11, height: 11, borderRadius: 3, background: a.meta.color, flexShrink: 0 }} />
                        <span style={{ fontSize: '.8rem', fontWeight: 700, color: 'var(--adm-fg)', flex: 1 }}>{a.meta.label}</span>
                        <span style={{ fontSize: '.8rem', fontWeight: 900, color: 'var(--adm-fg)', fontVariantNumeric: 'tabular-nums' }}>{fmtNum(a.cnt)}</span>
                        <span style={{ fontSize: '.7rem', fontWeight: 700, color: 'var(--adm-fg-3)', fontVariantNumeric: 'tabular-nums', minWidth: 38, textAlign: 'left' }}>
                            {fmtPct(a.pct)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
});
LifecycleDonut.displayName = 'LifecycleDonut';

// ═══════════════════════════════════════════════════════════════════════════
// ٢) قمع التحويل
// ═══════════════════════════════════════════════════════════════════════════
interface FunnelData {
    total_views: number;
    unique_viewers: number;
    total_bookings: number;
    unique_bookers: number;
    conversion_pct: number;
    avg_views_per_booker: number;
}

const FunnelSection = memo<{ data: FunnelData | null; period: Period }>(({ data, period }) => {
    const max = Math.max(data?.total_views ?? 0, 1);
    const bookPct = Math.round(((data?.total_bookings ?? 0) / max) * 100);
    return (
        <AdmSection
            icon="🔥"
            title="قمع التحويل"
            desc="من شاهد عرضاً، كم منهم حجز فعلاً. أهمّ نسبةٍ في المنصّة."
            badge={{ text: periodScope(period), tone: 'info' }}
        >
            {!data ? (
                <AdmEmpty icon="🔥" title="لا مشاهدات في الفترة المختارة" hint="وسّع الفترة أو انتظر أوّل زيارة." />
            ) : (
                <>
                    <div style={{ display: 'grid', gap: 12 }}>
                        <FunnelStage
                            label="👀 شاهدوا العرض"
                            primary={fmtNum(data.total_views)}
                            sub={`${fmtNum(data.unique_viewers)} مستخدماً فريداً`}
                            pct={100}
                            tone="info"
                        />
                        <FunnelStage
                            label="🎟️ حجزوا فعلاً"
                            primary={fmtNum(data.total_bookings)}
                            sub={`${fmtNum(data.unique_bookers)} مستخدماً فريداً`}
                            pct={bookPct}
                            tone="ok"
                        />
                    </div>
                    <div style={{ marginTop: 14 }}>
                        <AdmStatGrid cols={2}>
                            <AdmStat
                                label="نسبة التحويل"
                                value={fmtPct(data.conversion_pct)}
                                scope={periodScope(period)}
                                tone="ok"
                                title="عدد الحجوزات ÷ عدد مشاهدات العروض في الفترة. لا يدخل فيه من فتح التطبيق بلا فتح عرض."
                            />
                            <AdmStat
                                label="مشاهدات قبل كل حجز"
                                value={fmtNum(data.avg_views_per_booker)}
                                scope={periodScope(period)}
                                tone="info"
                                title="متوسط عدد العروض التي يقلّبها المشتري قبل أن يحجز."
                            />
                        </AdmStatGrid>
                    </div>
                </>
            )}
        </AdmSection>
    );
});
FunnelSection.displayName = 'FunnelSection';

const FunnelStage = memo<{ label: string; primary: string; sub: string; pct: number; tone: Tone }>(
    ({ label, primary, sub, pct, tone }) => (
        <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)' }}>{label}</span>
                <span style={{ fontSize: '.74rem', fontWeight: 700, color: 'var(--adm-fg-3)' }}>{sub}</span>
            </div>
            <div style={{ position: 'relative', height: 44, background: 'var(--adm-surface-3)', borderRadius: 'var(--adm-r-sm)', overflow: 'hidden' }}>
                <div
                    style={{
                        height: '100%',
                        width: `${Math.max(pct, 10)}%`,
                        background: `var(--adm-${tone}-bg)`,
                        borderInlineEnd: `2px solid var(--adm-${tone}-fg)`,
                        borderRadius: 'var(--adm-r-sm)',
                        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                        paddingInlineEnd: 13,
                    }}
                >
                    <span style={{ fontSize: '1rem', fontWeight: 900, color: `var(--adm-${tone}-fg)`, fontVariantNumeric: 'tabular-nums' }}>
                        {primary}
                    </span>
                </div>
            </div>
        </div>
    )
);
FunnelStage.displayName = 'FunnelStage';

// ═══════════════════════════════════════════════════════════════════════════
// ٣) الحركة اليومية
// ═══════════════════════════════════════════════════════════════════════════
interface DailyPoint {
    day_key: string;
    day_label: string;
    events: number;
    bookings: number;
    new_users: number;
    completed_bookings: number;
    cancelled_bookings: number;
}

const DailySection = memo<{ data: DailyPoint[]; period: Period }>(({ data, period }) => {
    if (!data || data.length === 0) {
        return (
            <AdmSection icon="📈" title="الحركة اليومية" desc="الأحداث والحجوزات والتسجيلات، يوماً بيوم." badge={{ text: periodScope(period), tone: 'info' }}>
                <AdmEmpty icon="📉" title="لا حركة في الفترة المختارة" hint="جرّب فترةً أوسع من الأعلى." />
            </AdmSection>
        );
    }
    const maxEvents = Math.max(...data.map((d) => d.events), 1);
    const maxBookings = Math.max(...data.map((d) => d.bookings), 1);
    const maxUsers = Math.max(...data.map((d) => d.new_users), 1);

    const W = 100;
    const H = 100;
    const stepX = data.length > 1 ? W / (data.length - 1) : 0;
    const line = (vals: number[], max: number) =>
        vals.map((v, i) => `${i === 0 ? 'M' : 'L'} ${i * stepX} ${H - (v / max) * (H - 8)}`).join(' ');

    const totalEvents = data.reduce((s, d) => s + d.events, 0);
    const totalBookings = data.reduce((s, d) => s + d.bookings, 0);
    const totalNewUsers = data.reduce((s, d) => s + d.new_users, 0);
    const totalCompleted = data.reduce((s, d) => s + d.completed_bookings, 0);
    const totalCancelled = data.reduce((s, d) => s + d.cancelled_bookings, 0);

    return (
        <AdmSection
            icon="📈"
            title="الحركة اليومية"
            desc="كل خطٍّ مقياسه الخاص — الشكل يقول الاتجاه، والأرقام تحته تقول الحجم."
            badge={{ text: periodScope(period), tone: 'info' }}
        >
            <AdmStatGrid cols={3}>
                <AdmStat icon="◼" label="أحداث" value={fmtNum(totalEvents)} scope={periodScope(period)} tone="info" title="كل حدثٍ سجّلته المنصّة: فتح تطبيق، فتح عرض، حجز، تقييم…" />
                <AdmStat icon="◼" label="حجوزات" value={fmtNum(totalBookings)} scope={`${fmtNum(totalCompleted)} مكتملاً · ${fmtNum(totalCancelled)} ملغى`} tone="ok" title="كل حجزٍ أُنشئ في الفترة، بحالته أياً كانت." />
                <AdmStat icon="◼" label="مستخدمون جدد" value={fmtNum(totalNewUsers)} scope={periodScope(period)} tone="warn" title="حسابات سُجّلت في الفترة — مشترين وتجّاراً." />
            </AdmStatGrid>

            <div style={{ marginTop: 14 }}>
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: '100%', height: 168 }} role="img" aria-label="منحنيات الأحداث والحجوزات والتسجيلات اليومية">
                    <path d={line(data.map((d) => d.events), maxEvents)} fill="none" strokeWidth="0.7" strokeLinejoin="round" style={{ stroke: 'var(--adm-info-fg)' }} />
                    <path d={line(data.map((d) => d.bookings), maxBookings)} fill="none" strokeWidth="0.7" strokeLinejoin="round" style={{ stroke: 'var(--adm-ok-fg)' }} />
                    <path d={line(data.map((d) => d.new_users), maxUsers)} fill="none" strokeWidth="0.7" strokeLinejoin="round" style={{ stroke: 'var(--adm-warn-fg)' }} />
                </svg>
                <div dir="ltr" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: '.64rem', fontWeight: 700, color: 'var(--adm-fg-3)', fontVariantNumeric: 'tabular-nums' }}>
                    <span>{data[0].day_label}</span>
                    {data.length > 4 && <span>{data[Math.floor(data.length / 2)].day_label}</span>}
                    <span>{data[data.length - 1].day_label}</span>
                </div>
            </div>
        </AdmSection>
    );
});
DailySection.displayName = 'DailySection';

// ═══════════════════════════════════════════════════════════════════════════
// ٤) الأفواج والاستبقاء — جدولٌ واحد بدل جدولين
// ═══════════════════════════════════════════════════════════════════════════
interface CohortRow {
    cohort_key: string; cohort_label: string;
    registered: number; active_now: number; booked_ever: number; retention_pct: number;
}
interface RetentionRow {
    cohort_month: string; cohort_label: string; cohort_size: number;
    d1_pct: number; d7_pct: number; d30_pct: number; d60_pct: number;
}
interface CohortMerged extends CohortRow { ret: RetentionRow | null }

const retTone = (pct: number): Tone => (pct >= 50 ? 'ok' : pct >= 25 ? 'info' : pct >= 10 ? 'warn' : 'neutral');

const RetPill = memo<{ pct: number | null }>(({ pct }) =>
    pct === null
        ? <span style={{ color: 'var(--adm-fg-3)', fontWeight: 700 }}>—</span>
        : <AdmPill tone={retTone(pct)}>{fmtPct(pct)}</AdmPill>
);
RetPill.displayName = 'RetPill';

const ActiveBar = memo<{ count: number; pct: number }>(({ count, pct }) => {
    const safe = Math.max(0, Math.min(100, pct));
    const tone: Tone = safe >= 60 ? 'ok' : safe >= 30 ? 'warn' : 'bad';
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', minWidth: 28 }}>{fmtNum(count)}</span>
            <span style={{ position: 'relative', width: 54, height: 7, background: 'var(--adm-surface-3)', borderRadius: 999, overflow: 'hidden', flexShrink: 0 }}>
                <span style={{ position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: `${safe}%`, background: `var(--adm-${tone}-fg)` }} />
            </span>
            <span style={{ fontSize: '.7rem', fontWeight: 800, color: 'var(--adm-fg-3)', fontVariantNumeric: 'tabular-nums', minWidth: 36 }}>
                {fmtPct(safe)}
            </span>
        </span>
    );
});
ActiveBar.displayName = 'ActiveBar';

const COHORT_CSV_COLUMNS: CsvColumn<CohortMerged>[] = [
    { header: 'شهر التسجيل', accessor: (r) => r.cohort_label },
    { header: 'سجّلوا', accessor: (r) => r.registered },
    { header: 'حجزوا مرّةً على الأقل', accessor: (r) => r.booked_ever },
    { header: 'نشطون الآن', accessor: (r) => r.active_now },
    { header: 'نسبة النشطين %', accessor: (r) => r.retention_pct },
    { header: 'عادوا بعد يوم %', accessor: (r) => r.ret?.d1_pct ?? '' },
    { header: 'عادوا بعد أسبوع %', accessor: (r) => r.ret?.d7_pct ?? '' },
    { header: 'عادوا بعد شهر %', accessor: (r) => r.ret?.d30_pct ?? '' },
    { header: 'عادوا بعد شهرين %', accessor: (r) => r.ret?.d60_pct ?? '' },
];

const CohortRetentionSection = memo<{ cohorts: CohortRow[]; retention: RetentionRow[] }>(({ cohorts, retention }) => {
    // 🪤 المفتاحان من دالّتين مختلفتين لكنّهما بنفس الصيغة (`YYYY-MM`) —
    //    فالربط دقيق. وشهرٌ بلا صفّ استبقاءٍ يعرض «—» لا صفراً كاذباً.
    const rows: CohortMerged[] = useMemo(() => {
        const byKey = new Map(retention.map((r) => [r.cohort_month, r]));
        return cohorts.map((c) => ({ ...c, ret: byKey.get(c.cohort_key) ?? null }));
    }, [cohorts, retention]);

    const columns: Array<AdmColumn<CohortMerged>> = useMemo(() => [
        { header: 'شهر التسجيل', cell: (r) => <span style={{ fontWeight: 800 }}>{r.cohort_label}</span> },
        { header: 'سجّلوا', numeric: true, cell: (r) => fmtNum(r.registered) },
        { header: 'حجزوا', numeric: true, cell: (r) => <span style={{ fontWeight: 800, color: 'var(--adm-ok-fg)' }}>{fmtNum(r.booked_ever)}</span> },
        { header: 'نشطون الآن', cell: (r) => <ActiveBar count={r.active_now} pct={r.retention_pct} /> },
        { header: 'عادوا بعد يوم', cell: (r) => <RetPill pct={r.ret?.d1_pct ?? null} /> },
        { header: 'بعد أسبوع', cell: (r) => <RetPill pct={r.ret?.d7_pct ?? null} /> },
        { header: 'بعد شهر', cell: (r) => <RetPill pct={r.ret?.d30_pct ?? null} /> },
        { header: 'بعد شهرين', secondary: true, cell: (r) => <RetPill pct={r.ret?.d60_pct ?? null} /> },
    ], []);

    return (
        <AdmSection
            icon="👥"
            title="الأفواج والاستبقاء"
            desc="لكل شهر تسجيل: كم مشترياً سجّل فيه، وكم منهم حجز، وكم لا يزال نشطاً، وكم عاد بعد يومٍ وأسبوعٍ وشهرٍ وشهرين."
            collapsible
            defaultOpen={false}
            action={
                <ExportButton
                    rows={rows}
                    columns={COHORT_CSV_COLUMNS}
                    filenameStem="taki-cohorts-retention"
                    accent="blue"
                    tooltip="تنزيل جدول الأفواج والاستبقاء كاملاً"
                />
            }
        >
            <AdmTable
                columns={columns}
                rows={rows}
                keyOf={(r) => r.cohort_key}
                caption="أفواج المشترين حسب شهر التسجيل، ونِسب عودتهم بعد يوم وأسبوع وشهر وشهرين"
                empty={{
                    icon: '👥',
                    title: 'لا أفواج بعد',
                    hint: 'يظهر الجدول بعد أوّل شهرٍ يسجّل فيه مشترون.',
                }}
            />
            <p style={{ margin: '12px 0 0', fontSize: '.76rem', lineHeight: 1.85, color: 'var(--adm-fg-3)', fontWeight: 600 }}>
                «نشطون الآن» = من فتح التطبيق خلال آخر ٣٠ يوماً، مهما كان شهر تسجيله.
                و«عادوا بعد …» = من عاد في اليوم المحدَّد بعد تسجيله هو (لا بعد تاريخ اليوم) —
                فهما يقيسان شيئين مختلفين عمداً: الأوّل حالةٌ راهنة، والثاني عادةٌ أوّل أسابيع.
                و«—» تعني شهراً لم يسجّل فيه أحد.
            </p>
        </AdmSection>
    );
});
CohortRetentionSection.displayName = 'CohortRetentionSection';

// ═══════════════════════════════════════════════════════════════════════════
// ٥) جدول الاشتراكات
// ═══════════════════════════════════════════════════════════════════════════
interface SubTimelineRow {
    store_id: string; name: string; shop: string | null; phone: string | null;
    plan: string; started_at: string | null; expires_at: string | null;
    days_remaining: number | null;
    amount: number; discount: number; net_amount: number;
}

const TIMELINE_CSV_COLUMNS: CsvColumn<SubTimelineRow>[] = [
    { header: 'المتجر', accessor: (r) => r.shop ?? r.name },
    { header: 'الجوال', accessor: (r) => r.phone ?? '' },
    { header: 'الباقة', accessor: (r) => r.plan },
    { header: 'بداية الاشتراك', accessor: (r) => r.started_at ?? '' },
    { header: 'انتهاء الاشتراك', accessor: (r) => r.expires_at ?? '' },
    { header: 'أيام متبقية', accessor: (r) => r.days_remaining ?? '' },
    { header: 'المبلغ', accessor: (r) => r.amount },
    { header: 'الخصم %', accessor: (r) => r.discount },
    { header: 'الصافي', accessor: (r) => r.net_amount },
];

const SubscriptionTimelineSection = memo<{ data: SubTimelineRow[]; onOpenSeller: (id: string) => void }>(({ data, onOpenSeller }) => {
    const expiringSoon = data.filter((r) => r.days_remaining !== null && r.days_remaining >= 0 && r.days_remaining <= 7);
    const expiringMonth = data.filter((r) => r.days_remaining !== null && r.days_remaining > 7 && r.days_remaining <= 30);
    const expired = data.filter((r) => r.days_remaining !== null && r.days_remaining < 0);
    const sum = (rows: SubTimelineRow[]) => rows.reduce((s, r) => s + r.net_amount, 0);

    return (
        <AdmSection
            icon="📅"
            title="جدول الاشتراكات"
            desc="كل تاجرٍ مشترك ومتى ينتهي اشتراكه. المبالغ هنا اشتراكاتٌ لتاكي، لا مبيعات متجره."
            collapsible
            defaultOpen={false}
            badge={{ text: `${fmtNum(data.length)} تاجراً`, tone: 'neutral' }}
            action={
                <ExportButton
                    rows={data}
                    columns={TIMELINE_CSV_COLUMNS}
                    filenameStem="taki-subscription-timeline"
                    accent="purple"
                    tooltip="تنزيل جدول الاشتراكات كاملاً مع التواريخ والمبالغ"
                />
            }
        >
            <AdmStatGrid cols={3}>
                <AdmStat
                    label="ينتهي خلال ٧ أيام"
                    value={fmtNum(expiringSoon.length)}
                    scope={`${fmtMoney(sum(expiringSoon))} شهرياً`}
                    tone={expiringSoon.length ? 'bad' : 'neutral'}
                    title="اشتراكاتٌ على وشك الانتهاء — تواصلٌ الآن يمنع الفقد."
                />
                <AdmStat
                    label="ينتهي خلال ٣٠ يوماً"
                    value={fmtNum(expiringMonth.length)}
                    scope={`${fmtMoney(sum(expiringMonth))} شهرياً`}
                    tone={expiringMonth.length ? 'warn' : 'neutral'}
                />
                <AdmStat
                    label="منتهٍ بالفعل"
                    value={fmtNum(expired.length)}
                    scope={`${fmtMoney(sum(expired))} شهرياً`}
                    title="اشتراكاتٌ انقضت ولم تُجدَّد بعد."
                />
            </AdmStatGrid>

            <div style={{ marginTop: 14, maxHeight: 340, overflowY: 'auto' }}>
                {data.length === 0 ? (
                    <AdmEmpty icon="📅" title="لا اشتراكات مسجّلة" hint="تظهر هنا كل باقةٍ تُطبَّق على تاجر من شاشة «التجّار»." />
                ) : (
                    data.slice(0, 25).map((row) => (
                        <TimelineRow key={row.store_id} row={row} onOpen={() => onOpenSeller(row.store_id)} />
                    ))
                )}
            </div>
            {data.length > 25 && (
                <p style={{ margin: '10px 0 0', fontSize: '.75rem', fontWeight: 700, color: 'var(--adm-fg-3)' }}>
                    معروضٌ ٢٥ من {fmtNum(data.length)} — البقيّة في ملفّ CSV أعلاه.
                </p>
            )}
        </AdmSection>
    );
});
SubscriptionTimelineSection.displayName = 'SubscriptionTimelineSection';

const RowButton: React.FC<{ onClick?: () => void; children: React.ReactNode }> = ({ onClick, children }) => {
    // 🪤 `border: 0` أوّلاً ثم `borderBottom` — العكس يُلغي اللون فيرث الخطّ
    //    لون النصّ بدل لون الحدّ.
    const style: React.CSSProperties = {
        width: '100%', textAlign: 'right', padding: '11px 4px',
        display: 'flex', alignItems: 'center', gap: 11,
        background: 'transparent',
        border: 0,
        borderBottom: '1px solid var(--adm-border)',
    };
    if (!onClick) return <div style={style}>{children}</div>;
    return (
        <button type="button" onClick={onClick} className="adm-focusable" style={{ ...style, cursor: 'pointer' }}>
            {children}
        </button>
    );
};

const TimelineRow = memo<{ row: SubTimelineRow; onOpen: () => void }>(({ row, onOpen }) => {
    const dr = row.days_remaining;
    const tone: Tone = dr === null ? 'neutral' : dr < 0 ? 'bad' : dr <= 7 ? 'bad' : dr <= 30 ? 'warn' : 'neutral';
    return (
        <RowButton onClick={onOpen}>
            <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.shop ?? row.name}
                </span>
                <span dir="ltr" style={{ display: 'block', fontSize: '.73rem', color: 'var(--adm-fg-3)', fontWeight: 600 }}>
                    {row.phone ?? '—'}
                </span>
            </span>
            <span style={{ flexShrink: 0, textAlign: 'left' }}>
                <span style={{ display: 'block', fontSize: '.84rem', fontWeight: 900, color: 'var(--adm-ok-fg)', fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(row.net_amount)}
                </span>
                <span style={{ display: 'block', fontSize: '.7rem', fontWeight: 800, color: `var(--adm-${tone}-fg)`, fontVariantNumeric: 'tabular-nums' }}>
                    {dr === null
                        ? 'بلا تاريخ انتهاء'
                        : dr < 0
                            ? `منتهٍ منذ ${fmtNum(Math.abs(dr))} يوماً`
                            : `${fmtNum(dr)} يوماً متبقياً`}
                </span>
            </span>
        </RowButton>
    );
});
TimelineRow.displayName = 'TimelineRow';

// ═══════════════════════════════════════════════════════════════════════════
// ٦) الاشتراكات المفقودة (للاسترجاع)
// ═══════════════════════════════════════════════════════════════════════════
interface ChurnedRow {
    store_id: string; name: string; shop: string | null;
    phone: string | null; plan: string | null;
    ended_at: string; days_since_churn: number; last_amount: number;
}

const CHURNED_CSV_COLUMNS: CsvColumn<ChurnedRow>[] = [
    { header: 'المتجر', accessor: (r) => r.shop ?? r.name },
    { header: 'الجوال', accessor: (r) => r.phone ?? '' },
    { header: 'انتهى في', accessor: (r) => r.ended_at },
    { header: 'أيام منذ الإلغاء', accessor: (r) => r.days_since_churn },
    { header: 'قيمة الاشتراك المفقود', accessor: (r) => r.last_amount },
];

const ChurnedSection = memo<{ data: ChurnedRow[]; onOpenSeller: (id: string) => void }>(({ data, onOpenSeller }) => {
    const totalLost = data.reduce((s, r) => s + r.last_amount, 0);
    return (
        <AdmSection
            icon="🪦"
            title="اشتراكاتٌ فُقدت — فرصة استرجاع"
            desc="تجّار اشتركوا في تاكي ثم تركوا خلال آخر ٩٠ يوماً."
            collapsible
            defaultOpen={false}
            badge={data.length ? { text: `${fmtNum(data.length)} تاجراً`, tone: 'warn' } : { text: 'لا فقد', tone: 'ok' }}
            action={
                <ExportButton
                    rows={data}
                    columns={CHURNED_CSV_COLUMNS}
                    filenameStem="taki-win-back-list"
                    accent="purple"
                    tooltip="تنزيل قائمة التجّار الذين تركوا — للتواصل معهم"
                />
            }
        >
            {data.length === 0 ? (
                <AdmEmpty icon="🎉" title="لم يترك أي تاجرٍ اشتراكه" hint="لا إلغاءات في آخر ٩٠ يوماً." />
            ) : (
                <>
                    <AdmStat
                        label="اشتراكاتٌ فُقدت شهرياً"
                        value={fmtMoney(totalLost)}
                        scope={`${fmtNum(data.length)} تاجراً · آخر ٩٠ يوماً`}
                        tone="bad"
                        title="مجموع ما كان هؤلاء التجّار يدفعونه لتاكي شهرياً قبل تركهم. مالُ اشتراكاتٍ لا مبيعات."
                    />
                    <div style={{ marginTop: 14, maxHeight: 340, overflowY: 'auto' }}>
                        {data.map((row) => (
                            <RowButton key={row.store_id} onClick={() => onOpenSeller(row.store_id)}>
                                <span
                                    aria-hidden="true"
                                    style={{
                                        width: 34, height: 34, borderRadius: 999, flexShrink: 0,
                                        background: 'var(--adm-bad-bg)', color: 'var(--adm-bad-fg)',
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                        fontWeight: 900, fontSize: '.85rem',
                                    }}
                                >
                                    {(row.shop ?? row.name)?.[0] ?? '?'}
                                </span>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ display: 'block', fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {row.shop ?? row.name}
                                    </span>
                                    <span dir="ltr" style={{ display: 'block', fontSize: '.73rem', color: 'var(--adm-fg-3)', fontWeight: 600 }}>
                                        {row.phone ?? '—'}
                                    </span>
                                </span>
                                <span style={{ flexShrink: 0, textAlign: 'left' }}>
                                    <span style={{ display: 'block', fontSize: '.73rem', fontWeight: 800, color: 'var(--adm-bad-fg)' }}>
                                        منذ {fmtNum(row.days_since_churn)} يوماً
                                    </span>
                                    <span style={{ display: 'block', fontSize: '.68rem', color: 'var(--adm-fg-3)', fontWeight: 600 }}>
                                        {fmtDate(row.ended_at)}
                                    </span>
                                </span>
                            </RowButton>
                        ))}
                    </div>
                </>
            )}
        </AdmSection>
    );
});
ChurnedSection.displayName = 'ChurnedSection';

// ═══════════════════════════════════════════════════════════════════════════
// ٧) شاهدوا ولم يحجزوا
// ═══════════════════════════════════════════════════════════════════════════
interface NoBookRow {
    user_id: string; name: string; phone: string | null;
    views_count: number; last_viewed_at: string; deals_seen: number;
}

const NOBOOK_CSV_COLUMNS: CsvColumn<NoBookRow>[] = [
    { header: 'الاسم', accessor: (r) => r.name },
    { header: 'الجوال', accessor: (r) => r.phone ?? '' },
    { header: 'مشاهدات', accessor: (r) => r.views_count },
    { header: 'عروض مختلفة', accessor: (r) => r.deals_seen },
    { header: 'آخر مشاهدة', accessor: (r) => r.last_viewed_at },
];

const BrowseNoBookSection = memo<{ data: NoBookRow[]; period: Period }>(({ data, period }) => (
    <AdmSection
        icon="🎣"
        title="شاهدوا ولم يحجزوا"
        desc="مشترون قلّبوا العروض ولم يحجزوا — أقرب الناس إلى أوّل حجز."
        collapsible
        defaultOpen={false}
        badge={{ text: periodScope(period), tone: 'info' }}
        action={
            <ExportButton
                rows={data}
                columns={NOBOOK_CSV_COLUMNS}
                filenameStem="taki-browse-no-book"
                accent="blue"
                tooltip="تنزيل قائمة المهتمّين الذين لم يحجزوا — للتسويق المستهدف"
            />
        }
    >
        {data.length === 0 ? (
            <AdmEmpty icon="👍" title="لا أحد شاهد بلا حجز" hint="كل من فتح عرضاً في هذه الفترة حجز فعلاً." />
        ) : (
            <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                {data.map((row) => (
                    <RowButton key={row.user_id}>
                        <span
                            aria-hidden="true"
                            style={{
                                width: 34, height: 34, borderRadius: 999, flexShrink: 0,
                                background: 'var(--adm-info-bg)', color: 'var(--adm-info-fg)',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontWeight: 900, fontSize: '.85rem',
                            }}
                        >
                            {row.name?.[0] ?? '?'}
                        </span>
                        <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {row.name}
                            </span>
                            <span dir="ltr" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '.73rem', color: 'var(--adm-fg-3)', fontWeight: 600 }}>
                                <span>{row.phone ?? '—'}</span>
                                {row.phone && <CopyButton value={row.phone} label="الجوال" size="xs" />}
                            </span>
                        </span>
                        <span style={{ flexShrink: 0, textAlign: 'left' }}>
                            <span style={{ display: 'block', fontSize: '.92rem', fontWeight: 900, color: 'var(--adm-info-fg)', fontVariantNumeric: 'tabular-nums' }}>
                                {fmtNum(row.views_count)}
                            </span>
                            <span style={{ display: 'block', fontSize: '.68rem', color: 'var(--adm-fg-3)', fontWeight: 700 }}>
                                مشاهدة · {fmtNum(row.deals_seen)} عرضاً
                            </span>
                            <span style={{ display: 'block', fontSize: '.68rem', color: 'var(--adm-fg-3)', fontWeight: 600 }}>
                                {daysAgo(row.last_viewed_at)}
                            </span>
                        </span>
                    </RowButton>
                ))}
            </div>
        )}
    </AdmSection>
));
BrowseNoBookSection.displayName = 'BrowseNoBookSection';

// ═══════════════════════════════════════════════════════════════════════════
// ٨) أداء التصنيفات — يبقى هنا: التصنيفات ليست جغرافيا ولا تشخيصاً
// ═══════════════════════════════════════════════════════════════════════════
const CategoryFunnelSection = memo<{ data: Array<{ category: string; views: number; bookings: number; conversion_pct: number }>; period: Period }>(
    ({ data, period }) => {
        const maxViews = Math.max(...data.map((d) => d.views), 1);
        return (
            <AdmSection
                icon="🏷️"
                title="أداء التصنيفات"
                desc="أيّ تصنيفٍ يُشاهَد كثيراً ويُحجَز قليلاً — الفجوة هي الفرصة."
                collapsible
                defaultOpen={false}
                badge={{ text: periodScope(period), tone: 'info' }}
            >
                {data.length === 0 ? (
                    <AdmEmpty icon="🏷️" title="لا مشاهدات لأي تصنيف" hint="جرّب فترةً أوسع من الأعلى." />
                ) : (
                    <>
                        <div style={{ display: 'grid', gap: 10 }}>
                            {data.map((c) => (
                                <div key={c.category} style={{ background: 'var(--adm-surface-2)', borderRadius: 'var(--adm-r-sm)', padding: '11px 12px' }}>
                                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 7 }}>
                                        <span style={{ fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-fg)' }}>{c.category}</span>
                                        <span style={{ fontSize: '.74rem', fontWeight: 700, color: 'var(--adm-fg-3)', fontVariantNumeric: 'tabular-nums' }}>
                                            <span style={{ color: 'var(--adm-ok-fg)', fontWeight: 900 }}>{fmtNum(c.bookings)}</span>
                                            {' حجزاً من '}
                                            <span style={{ color: 'var(--adm-info-fg)', fontWeight: 900 }}>{fmtNum(c.views)}</span>
                                            {' مشاهدة · '}
                                            <span style={{ color: 'var(--adm-fg)', fontWeight: 900 }}>{fmtPct(c.conversion_pct)}</span>
                                        </span>
                                    </div>
                                    <div style={{ position: 'relative', height: 8, background: 'var(--adm-surface-3)', borderRadius: 999, overflow: 'hidden' }}>
                                        <div style={{ position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: `${(c.views / maxViews) * 100}%`, background: 'var(--adm-info-fg)', opacity: .45 }} />
                                        <div style={{ position: 'absolute', insetInlineStart: 0, top: 0, bottom: 0, width: `${(c.bookings / maxViews) * 100}%`, background: 'var(--adm-ok-fg)' }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, fontSize: '.72rem', fontWeight: 700, color: 'var(--adm-fg-3)' }}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                <span aria-hidden="true" style={{ width: 13, height: 7, borderRadius: 3, background: 'var(--adm-info-fg)', opacity: .45 }} /> مشاهدات
                            </span>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                                <span aria-hidden="true" style={{ width: 13, height: 7, borderRadius: 3, background: 'var(--adm-ok-fg)' }} /> حجوزات
                            </span>
                        </div>
                    </>
                )}
            </AdmSection>
        );
    }
);
CategoryFunnelSection.displayName = 'CategoryFunnelSection';

// ═══════════════════════════════════════════════════════════════════════════
// منتقي الفترة
// ═══════════════════════════════════════════════════════════════════════════
const PeriodPicker = memo<{ period: Period; onChange: (p: Period) => void }>(({ period, onChange }) => (
    <div role="group" aria-label="فترة الأرقام" style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap' }}>
        {([7, 30, 90] as Period[]).map((p) => {
            const on = period === p;
            return (
                <button
                    key={p}
                    type="button"
                    onClick={() => onChange(p)}
                    aria-pressed={on}
                    className="adm-focusable"
                    style={{
                        padding: '6px 13px', fontSize: '.78rem', fontWeight: 800, borderRadius: 999,
                        cursor: 'pointer',
                        border: `1px solid ${on ? 'transparent' : 'var(--adm-border)'}`,
                        background: on ? 'var(--adm-accent)' : 'var(--adm-surface-2)',
                        color: on ? '#ffffff' : 'var(--adm-fg-2)',
                    }}
                >
                    آخر {PERIOD_LABEL[p]}
                </button>
            );
        })}
    </div>
));
PeriodPicker.displayName = 'PeriodPicker';

// ═══════════════════════════════════════════════════════════════════════════
// الحاوية — تجلب كل شيء مرّةً واحدة وتوزّعه
// ═══════════════════════════════════════════════════════════════════════════
export const AdvancedAnalytics: React.FC = () => {
    const history = useHistory();
    const [period, setPeriod] = useState<Period>(30);

    const [forecast, setForecast] = useState<ForecastData | null>(null);
    const [funnel, setFunnel] = useState<FunnelData | null>(null);
    const [daily, setDaily] = useState<DailyPoint[]>([]);
    const [mrr, setMrr] = useState<MrrPoint[]>([]);
    const [growth, setGrowth] = useState<GrowthPoint[]>([]);
    const [lifecycle, setLifecycle] = useState<Array<{ status: string; cnt: number }>>([]);
    const [cohorts, setCohorts] = useState<CohortRow[]>([]);
    const [retention, setRetention] = useState<RetentionRow[]>([]);
    const [timeline, setTimeline] = useState<SubTimelineRow[]>([]);
    const [churned, setChurned] = useState<ChurnedRow[]>([]);
    const [noBook, setNoBook] = useState<NoBookRow[]>([]);
    const [categories, setCategories] = useState<Array<{ category: string; views: number; bookings: number; conversion_pct: number }>>([]);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        const [
            f, fn, dm, m, g, lc, ch, rc, tl, cs, nb, cf,
        ] = await Promise.all([
            adminService.getRevenueForecast(),
            adminService.getBookingFunnel(period),
            adminService.getDailyMetrics(period),
            adminService.getMrrMonthly(12),
            adminService.getSubscriptionGrowth(12),
            adminService.getSubscriptionLifecycle(),
            adminService.getUserCohorts(6),
            adminService.getRetentionCurve(6),
            adminService.getSubscriptionTimeline(200),
            adminService.getChurnedSubscribers(90, 100),
            adminService.getBrowseNoBook(period, 50),
            adminService.getCategoryFunnel(period, 12),
        ]);
        setForecast(f);
        setFunnel(fn);
        setDaily(dm);
        setMrr(m);
        setGrowth(g);
        setLifecycle(lc);
        setCohorts(ch);
        setRetention(rc);
        setTimeline(tl);
        setChurned(cs);
        setNoBook(nb);
        setCategories(cf);
        setLoading(false);
    }, [period]);

    useEffect(() => { refresh(); }, [refresh]);

    const openSeller = useCallback((id: string) => {
        history.push(`/store/${id}`);
    }, [history]);

    return (
        <div style={{ display: 'grid', gap: 14 }} dir="rtl">

            {/* ── شريط الفترة ─────────────────────────────────────────────── */}
            <AdmCard>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: '.88rem', fontWeight: 800, color: 'var(--adm-fg)' }}>فترة الأرقام</div>
                        <p style={{ margin: '5px 0 0', fontSize: '.78rem', lineHeight: 1.75, color: 'var(--adm-fg-2)', maxWidth: '62ch' }}>
                            تتحكّم بالأقسام الموسومة بالفترة وحدها. الأقسام الشهرية (الاشتراكات · الأفواج) مداها مكتوبٌ في عنوانها ولا يتغيّر باختيارك.
                        </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <PeriodPicker period={period} onChange={setPeriod} />
                        <AdmButton onClick={refresh} disabled={loading} title="إعادة تحميل كل أرقام هذه الشاشة">
                            {loading ? 'جارٍ التحميل…' : '↻ تحديث'}
                        </AdmButton>
                    </div>
                </div>
            </AdmCard>

            {loading ? (
                <AdmCard><AdmSkeleton rows={5} height={70} /></AdmCard>
            ) : (
                <>
                    <SubscriptionsSection forecast={forecast} mrr={mrr} growth={growth} lifecycle={lifecycle} />

                    <FunnelSection data={funnel} period={period} />

                    <DailySection data={daily} period={period} />

                    <CategoryFunnelSection data={categories} period={period} />

                    <CohortRetentionSection cohorts={cohorts} retention={retention} />

                    <SubscriptionTimelineSection data={timeline} onOpenSeller={openSeller} />

                    <ChurnedSection data={churned} onOpenSeller={openSeller} />

                    <BrowseNoBookSection data={noBook} period={period} />

                    {/* 🪤 إحالتان بدل تكرارَين: ما كان هنا موجودٌ أغنى في شاشتَيه. */}
                    <RefLine
                        icon="🕐"
                        text="خريطة ساعات النشاط في شاشة «المحلل الذكي» — هناك تُقرأ بالتصنيف والمدينة والساعة معاً، لا بجدولٍ مصغّر."
                    />
                    <RefLine
                        icon="🗺"
                        text="التوزيع الجغرافي كلّه في شاشة «جمهور المدن»: المناطق والمدن ومن أين يدخل المشترون."
                    />
                </>
            )}
        </div>
    );
};

export default AdvancedAnalytics;
