/**
 * InvestorPack — لمحة الأعمال: ما يدفعه المشترون، ومن هم، وكم يعودون (v14.89)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **التسمية أوّلاً — فهي التي كانت تكذب.** كان في هذه الشاشة «GMV (إجمالي
 *    قيمة الحجوزات)» و«📊 GMV الشهري»، وفي الشاشة المجاورة «الإيراد الشهري
 *    المتوقّع» و«الإيرادات الشهرية»، وفي ثالثةٍ «إجمالي المبيعات» — خمسة
 *    أسماءٍ لمالَين مختلفين تماماً:
 *      • **قيمة مبيعات التجّار (GMV)** — ما يدفعه المشترون للتجّار. الدفع
 *        مباشرٌ لحساب التاجر بلا عمولة، فلا يمرّ بحساب تاكي ولا ريال منه.
 *      • **اشتراكات التجّار في تاكي** — ما تقبضه تاكي فعلاً (في شاشة
 *        «التحليلات» أسفل هذه اللمحة).
 *    الآن الاسم واحدٌ في الموضعين، ولكل بطاقة `title` يقول ما يدخل في الرقم
 *    وما لا يدخل، و`scope` يقول مداه الزمنيّ صراحةً.
 *
 * 🪤 وما حُذف من هنا لأنه كان مكرّراً في مجموعة «النمو»:
 *    • **منحنى الاستبقاء (D1/D7/D30/D60)**: كان جدولاً مستقلّاً بجوار جدول
 *      «الأفواج» يجيب السؤال نفسه بأرقامٍ لا يمكن التوفيق بينها بصرياً.
 *      صار **عمودَين إلى أربعة داخل جدول الأفواج** في شاشة «التحليلات».
 *    • **التوزيع الجغرافي**: الجغرافيا كلّها في «جمهور المدن». بقي سطرُ إحالة.
 *
 * 🪤 و`toISOString().split('T')` كان يُنتج تاريخ **أمس** لكل من شرق غرينتش
 *    بين التاسعة مساءً ومنتصف الليل (السعودية +٣) — أي أن «استعلام اليوم»
 *    كان يقرأ يوماً سابقاً كل ليلة. التنسيق الآن من الحقول المحلّية.
 */

import React, {
    useCallback,
    useEffect,
    useMemo,
    useState,
    memo,
} from 'react';
import { adminService } from '../../services/adminService';
import { CsvColumn, downloadCsv } from '../../utils/csvExport';
import {
    AdmCard, AdmSection, AdmStat, AdmStatGrid,
    AdmEmpty, AdmSkeleton, AdmButton,
    admNum, admMoney,
} from './ui';

type LookupMode = 'day' | 'month' | 'year';
type Period = 7 | 30 | 90;

const PERIOD_LABEL: Record<Period, string> = {
    7: '٧ أيام',
    30: '٣٠ يوماً',
    90: '٩٠ يوماً',
};
const periodScope = (p: Period) => `آخر ${PERIOD_LABEL[p]}`;

// 🪤 شكلُ الرقم قرارُ لوحةٍ واحد لا قرارُ ملفّ: `admNum`/`admMoney` من نظام
//    التصميم، وهما يمرّران القيمة بـ`Number()` فلا يُسقط عمودُ `numeric`
//    واصلٌ نصّاً الشاشةَ كلّها. والنسبة المئوية تُبنى منهما هنا.
const fmtMoney = admMoney;
const fmtNum = admNum;
const fmtPct = (v: number | null | undefined) => `${admNum(v)}٪`;

/** تاريخٌ لحقل `input[type=date]` **بتوقيت الجهاز** لا UTC. */
const toDateInput = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** شارة نموٍّ مقارنةً بالفترة السابقة — بصيغة `delta` التي تفهمها `AdmStat`. */
const growthDelta = (pct: number | null | undefined) => {
    const v = Number(pct) || 0;
    const arrow = v > 0 ? '▲' : v < 0 ? '▼' : '—';
    return {
        text: `${arrow} ${fmtPct(Math.abs(v))} عن الفترة السابقة`,
        good: v === 0 ? undefined : v > 0,
    };
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

// ═══════════════════════════════════════════════════════════════════════════
// الأنواع
// ═══════════════════════════════════════════════════════════════════════════
interface InvestorKpis {
    period_days: number;
    gmv: number; gmv_completed: number; savings_delivered: number;
    total_bookings: number; completed_bookings: number; cancelled_bookings: number;
    avg_order_value: number;
    dau: number; wau: number; mau: number; stickiness_pct: number;
    total_views: number; unique_viewers: number; conversion_pct: number;
    repeat_customer_rate_pct: number;
    mom_gmv_growth_pct: number; mom_bookings_growth_pct: number; mom_new_users_growth_pct: number;
    new_buyers: number; new_sellers: number; net_active_merchants: number;
}

interface GmvMonth {
    month_key: string; month_label: string;
    gmv: number; completed_gmv: number;
    bookings_count: number; completed_count: number;
    avg_order_value: number; savings_delivered: number; unique_buyers: number;
}

type DayLookup = NonNullable<Awaited<ReturnType<typeof adminService.lookupByDate>>>;
type MonthLookup = NonNullable<Awaited<ReturnType<typeof adminService.lookupByMonth>>>;
type YearLookup = NonNullable<Awaited<ReturnType<typeof adminService.lookupByYear>>>;

// ═══════════════════════════════════════════════════════════════════════════
// ١) لمحة الأعمال — المال والطلبات
// ═══════════════════════════════════════════════════════════════════════════
const MoneySection = memo<{ kpis: InvestorKpis | null; period: Period }>(({ kpis, period }) => (
    <AdmSection
        icon="💵"
        title="قيمة مبيعات التجّار (GMV) والطلبات"
        desc="مالٌ يدفعه المشترون للتجّار مباشرةً — لا يمرّ بحساب تاكي ولا تأخذ منه عمولة. ما تقبضه تاكي هو «اشتراكات التجّار في تاكي» أسفل الشاشة."
        badge={{ text: periodScope(period), tone: 'info' }}
    >
        {!kpis ? (
            <AdmEmpty icon="💵" title="لا أرقام في الفترة المختارة" hint="وسّع الفترة من الأعلى، أو انتظر أوّل حجز." />
        ) : (
            <AdmStatGrid cols={3}>
                <AdmStat
                    icon="🧾"
                    label="قيمة مبيعات التجّار (GMV)"
                    value={fmtMoney(kpis.gmv)}
                    scope={periodScope(period)}
                    tone="ok"
                    delta={growthDelta(kpis.mom_gmv_growth_pct)}
                    title="مجموع (كمية المحجوز × سعر العرض بعد الخصم) لكل حجزٍ أُنشئ في الفترة — بحالته أياً كانت، حتى الملغى. لا تدخل فيه رسوم التوصيل ولا الإضافات، ولا يدخل منه ريالٌ واحد حساب تاكي."
                />
                <AdmStat
                    icon="✅"
                    label="منه مبيعاتٌ أُكملت فعلاً"
                    value={fmtMoney(kpis.gmv_completed)}
                    scope="من نفس الفترة — الطلبات المكتملة وحدها"
                    title="الجزء الذي وصل صاحبه واكتمل الطلب. الفرق بينه وبين الرقم الأيسر هو الملغى والمعلّق."
                />
                <AdmStat
                    icon="📐"
                    label="متوسط قيمة الطلب (AOV)"
                    value={fmtMoney(kpis.avg_order_value)}
                    scope="الطلبات المكتملة وحدها"
                    title="قيمة المبيعات المكتملة ÷ عدد الطلبات المكتملة. لا تدخل فيه الطلبات الملغاة فلا تخفضه."
                />
                <AdmStat
                    icon="🎟️"
                    label="حجوزات"
                    value={fmtNum(kpis.total_bookings)}
                    scope={`${fmtNum(kpis.completed_bookings)} مكتملاً · ${fmtNum(kpis.cancelled_bookings)} ملغى`}
                    delta={growthDelta(kpis.mom_bookings_growth_pct)}
                    title="كل حجزٍ أُنشئ في الفترة، بحالته أياً كانت."
                />
                <AdmStat
                    icon="💚"
                    label="وفّرته تاكي على المشترين"
                    value={fmtMoney(kpis.savings_delivered)}
                    scope="الطلبات المكتملة وحدها"
                    tone="ok"
                    title="الفرق بين السعر الأصلي وسعر العرض، مضروباً في الكمية، للطلبات التي اكتملت فقط. هذا ما ربحه المشتري لا ما كسبته المنصّة."
                />
                <AdmStat
                    icon="🔁"
                    label="نسبة التحويل"
                    value={fmtPct(kpis.conversion_pct)}
                    scope={periodScope(period)}
                    tone="info"
                    title="عدد الحجوزات ÷ عدد مشاهدات العروض في الفترة."
                />
            </AdmStatGrid>
        )}
    </AdmSection>
));
MoneySection.displayName = 'MoneySection';

// ═══════════════════════════════════════════════════════════════════════════
// ٢) لمحة الأعمال — الناس
// ═══════════════════════════════════════════════════════════════════════════
const PeopleSection = memo<{ kpis: InvestorKpis | null; period: Period }>(({ kpis, period }) => (
    <AdmSection
        icon="👥"
        title="الناس والتفاعل"
        desc="من يدخل المنصّة، وكم يعود. 🪤 أعداد النشطين (يومياً/أسبوعياً/شهرياً) نوافذ ثابتة ولا تتبع الفترة المختارة — ومدى كلٍّ مكتوبٌ تحته."
        collapsible
        defaultOpen
    >
        {!kpis ? (
            <AdmEmpty icon="👥" title="لا نشاط في الفترة المختارة" hint="وسّع الفترة من الأعلى." />
        ) : (
            <AdmStatGrid cols={3}>
                <AdmStat
                    icon="🗓️"
                    label="نشطون شهرياً (MAU)"
                    value={fmtNum(kpis.mau)}
                    scope="آخر ٣٠ يوماً — نافذة ثابتة"
                    title="عدد الحسابات المختلفة التي قامت بأي فعلٍ على المنصّة خلال آخر ثلاثين يوماً. لا يتغيّر بتغيير الفترة أعلى الشاشة."
                />
                <AdmStat
                    icon="📆"
                    label="نشطون أسبوعياً (WAU)"
                    value={fmtNum(kpis.wau)}
                    scope="آخر ٧ أيام — نافذة ثابتة"
                />
                <AdmStat
                    icon="🌞"
                    label="نشطون يومياً (DAU)"
                    value={fmtNum(kpis.dau)}
                    scope="آخر ٢٤ ساعة — نافذة ثابتة"
                />
                <AdmStat
                    icon="🧲"
                    label="التماسك (DAU ÷ MAU)"
                    value={fmtPct(kpis.stickiness_pct)}
                    scope="كم من مستخدمي الشهر يدخل في يومٍ واحد"
                    tone="info"
                    title="كلّما ارتفعت، كان التطبيق عادةً يومية لا زيارةً متفرّقة. ٢٠٪ فأعلى رقمٌ جيّد لتطبيقات التسوّق."
                />
                <AdmStat
                    icon="🔂"
                    label="مشترون يعيدون الشراء"
                    value={fmtPct(kpis.repeat_customer_rate_pct)}
                    scope={periodScope(period)}
                    tone="ok"
                    title="من بين من حجز في الفترة، نسبة من حجز مرّتين فأكثر. تُحسب من الطلبات المكتملة والمستلَمة."
                />
                <AdmStat
                    icon="✨"
                    label="مشترون جدد"
                    value={fmtNum(kpis.new_buyers)}
                    scope={periodScope(period)}
                    delta={growthDelta(kpis.mom_new_users_growth_pct)}
                />
                <AdmStat
                    icon="🏪"
                    label="تجّار جدد"
                    value={fmtNum(kpis.new_sellers)}
                    scope={periodScope(period)}
                    title="حسابات تجّار سُجّلت في الفترة — سواءٌ اشتركت في باقةٍ مدفوعة أم لا."
                />
                <AdmStat
                    icon="🔥"
                    label="تجّار عليهم حجوزات"
                    value={fmtNum(kpis.net_active_merchants)}
                    scope={periodScope(period)}
                    title="التجّار الذين وصلهم حجزٌ واحد على الأقل في الفترة — لا مجرّد مشتركين."
                />
                <AdmStat
                    icon="👀"
                    label="مشاهدات عروض"
                    value={fmtNum(kpis.total_views)}
                    scope={`${fmtNum(kpis.unique_viewers)} مستخدماً فريداً`}
                    title="عدد مرّات فتح صفحة عرض. فتحُ التطبيق وحده لا يُحسب هنا."
                />
            </AdmStatGrid>
        )}
    </AdmSection>
));
PeopleSection.displayName = 'PeopleSection';

// ═══════════════════════════════════════════════════════════════════════════
// ٣) قيمة مبيعات التجّار (GMV) — آخر ١٢ شهراً
// ═══════════════════════════════════════════════════════════════════════════
const GmvMonthlySection = memo<{ data: GmvMonth[] }>(({ data }) => {
    const max = Math.max(...data.map((d) => Number(d.gmv) || 0), 1);
    const totalGmv = data.reduce((s, d) => s + (Number(d.gmv) || 0), 0);
    const totalCompleted = data.reduce((s, d) => s + (Number(d.completed_gmv) || 0), 0);
    const totalSavings = data.reduce((s, d) => s + (Number(d.savings_delivered) || 0), 0);

    return (
        <AdmSection
            icon="📊"
            title="قيمة مبيعات التجّار (GMV) — آخر ١٢ شهراً"
            desc="نفس تعريف الرقم أعلاه، موزّعاً على الأشهر الميلادية. لا يتأثّر بالفترة المختارة أعلى الشاشة."
        >
            {data.length === 0 ? (
                <AdmEmpty
                    icon="📊"
                    title="لا حجوزات في آخر اثني عشر شهراً"
                    hint="يبدأ هذا المخطّط عند أوّل حجزٍ يُسجَّل على المنصّة."
                />
            ) : (
                <>
                    <AdmStatGrid cols={3}>
                        <AdmStat
                            label="إجمالي مبيعات التجّار"
                            value={fmtMoney(totalGmv)}
                            scope="مجموع ١٢ شهراً"
                            tone="ok"
                            title="مجموع كل الحجوزات في اثني عشر شهراً بسعر العرض × الكمية — بحالتها أياً كانت."
                        />
                        <AdmStat
                            label="منها أُكمل فعلاً"
                            value={fmtMoney(totalCompleted)}
                            scope="الطلبات المكتملة وحدها"
                        />
                        <AdmStat
                            label="وفّرته تاكي على المشترين"
                            value={fmtMoney(totalSavings)}
                            scope="الطلبات المكتملة وحدها"
                            tone="info"
                        />
                    </AdmStatGrid>

                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 150, marginTop: 16 }}>
                        {data.map((d) => {
                            const gmv = Number(d.gmv) || 0;
                            const done = Number(d.completed_gmv) || 0;
                            return (
                                <div
                                    key={d.month_key}
                                    title={`${d.month_label}: مبيعات ${fmtMoney(gmv)} · مكتمل ${fmtMoney(done)} · متوسط الطلب ${fmtMoney(d.avg_order_value)} · ${fmtNum(d.bookings_count)} حجزاً`}
                                    style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 5, height: '100%' }}
                                >
                                    <div
                                        style={{
                                            width: '100%', position: 'relative', overflow: 'hidden',
                                            height: `${(gmv / max) * 100}%`, minHeight: 2,
                                            background: 'var(--adm-ok-bg)', borderRadius: '5px 5px 0 0',
                                        }}
                                    >
                                        <div
                                            style={{
                                                position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, bottom: 0,
                                                height: gmv > 0 ? `${(done / gmv) * 100}%` : 0,
                                                background: 'var(--adm-accent)',
                                            }}
                                        />
                                    </div>
                                    <span style={{ fontSize: '.6rem', fontWeight: 700, color: 'var(--adm-fg-3)', whiteSpace: 'nowrap' }}>
                                        {d.month_label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 12, fontSize: '.72rem', fontWeight: 700, color: 'var(--adm-fg-3)' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <span aria-hidden="true" style={{ width: 13, height: 7, borderRadius: 3, background: 'var(--adm-accent)' }} /> مبيعاتٌ أُكملت
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                            <span aria-hidden="true" style={{ width: 13, height: 7, borderRadius: 3, background: 'var(--adm-ok-bg)' }} /> الإجمالي (متضمّناً الملغى والمعلّق)
                        </span>
                    </div>
                </>
            )}
        </AdmSection>
    );
});
GmvMonthlySection.displayName = 'GmvMonthlySection';

// ═══════════════════════════════════════════════════════════════════════════
// ٤) استعلام بتاريخ محدّد — يوم / شهر / سنة
// ═══════════════════════════════════════════════════════════════════════════
const MODE_TABS: Array<{ v: LookupMode; label: string }> = [
    { v: 'day', label: '📆 يوم' },
    { v: 'month', label: '🗓️ شهر' },
    { v: 'year', label: '📅 سنة' },
];

const DateLookupSection: React.FC = () => {
    // 🪤 `new Date()` في جسم المكوّن يتغيّر كل تصيير فيُبطل أي `useMemo`
    //    يعتمد عليه. يُثبَّت مرّةً واحدة عند أوّل تركيب.
    const [today] = useState(() => new Date());
    const [mode, setMode] = useState<LookupMode>('day');
    const [date, setDate] = useState<string>(() => toDateInput(today));
    const [year, setYear] = useState<number>(() => today.getFullYear());
    const [month, setMonth] = useState<number>(() => today.getMonth() + 1);
    const [loading, setLoading] = useState(false);
    const [day, setDay] = useState<DayLookup | null>(null);
    const [mo, setMo] = useState<MonthLookup | null>(null);
    const [yr, setYr] = useState<YearLookup | null>(null);

    const run = useCallback(async () => {
        setLoading(true);
        try {
            if (mode === 'day') {
                const d = await adminService.lookupByDate(date);
                setDay(d); setMo(null); setYr(null);
            } else if (mode === 'month') {
                const m = await adminService.lookupByMonth(year, month);
                setMo(m); setDay(null); setYr(null);
            } else {
                const y = await adminService.lookupByYear(year);
                setYr(y); setDay(null); setMo(null);
            }
        } finally { setLoading(false); }
    }, [mode, date, year, month]);

    // يعمل عند أوّل فتحٍ وعند كل تغيير في المُدخلات.
    useEffect(() => { run(); }, [run]);

    const recentYears = useMemo(() => {
        const y0 = today.getFullYear();
        return Array.from({ length: 5 }, (_, i) => y0 - i);
    }, [today]);

    const fieldStyle: React.CSSProperties = {
        padding: '7px 10px', fontSize: '.82rem', fontWeight: 700,
        borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
        background: 'var(--adm-surface)', color: 'var(--adm-fg)',
    };

    return (
        <AdmSection
            icon="📅"
            title="استعلام بتاريخ محدّد"
            desc="اختر يوماً أو شهراً أو سنة واقرأ أرقامها بالضبط — خارج الفترة المختارة أعلى الشاشة."
            collapsible
            defaultOpen={false}
        >
            {/* اختيار النمط */}
            <div role="group" aria-label="نمط الاستعلام" style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap', marginBottom: 12 }}>
                {MODE_TABS.map((t) => {
                    const on = mode === t.v;
                    return (
                        <button
                            key={t.v}
                            type="button"
                            onClick={() => setMode(t.v)}
                            aria-pressed={on}
                            className="adm-focusable"
                            style={{
                                padding: '6px 14px', fontSize: '.8rem', fontWeight: 800, borderRadius: 999,
                                cursor: 'pointer',
                                border: `1px solid ${on ? 'transparent' : 'var(--adm-border)'}`,
                                background: on ? 'var(--adm-accent)' : 'var(--adm-surface-2)',
                                color: on ? '#ffffff' : 'var(--adm-fg-2)',
                            }}
                        >
                            {t.label}
                        </button>
                    );
                })}
            </div>

            {/* المُدخلات */}
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
                {mode === 'day' && (
                    <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>التاريخ</span>
                        <input
                            type="date"
                            value={date}
                            max={toDateInput(today)}
                            onChange={(e) => setDate(e.target.value)}
                            className="adm-focusable"
                            style={fieldStyle}
                        />
                    </label>
                )}
                {mode === 'month' && (
                    <>
                        <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
                            <span style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>الشهر</span>
                            <select
                                value={month}
                                onChange={(e) => setMonth(Number(e.target.value))}
                                className="adm-focusable"
                                style={fieldStyle}
                            >
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                    <option key={m} value={m}>
                                        {new Date(2000, m - 1, 1).toLocaleString('ar-SA-u-ca-gregory', { month: 'long' })}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
                            <span style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>السنة</span>
                            <select
                                value={year}
                                onChange={(e) => setYear(Number(e.target.value))}
                                className="adm-focusable"
                                style={fieldStyle}
                            >
                                {recentYears.map((y) => <option key={y} value={y}>{y}</option>)}
                            </select>
                        </label>
                    </>
                )}
                {mode === 'year' && (
                    <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>السنة</span>
                        <select
                            value={year}
                            onChange={(e) => setYear(Number(e.target.value))}
                            className="adm-focusable"
                            style={fieldStyle}
                        >
                            {recentYears.map((y) => <option key={y} value={y}>{y}</option>)}
                        </select>
                    </label>
                )}
            </div>

            {/* النتائج */}
            {loading && <AdmSkeleton rows={2} height={82} />}

            {!loading && mode === 'day' && day && (
                <LookupResult
                    caption={`أرقام يوم ${new Date(day.target_date).toLocaleDateString('ar-SA-u-ca-gregory')}`}
                    views={day.views_count}
                    viewsScope={`${fmtNum(day.unique_viewers)} مستخدماً فريداً`}
                    bookings={day.bookings_count}
                    bookingsScope={`${fmtNum(day.completed_bookings)} مكتملاً`}
                    gmv={day.gmv}
                    savings={day.savings_delivered}
                    people={day.active_users}
                    peopleLabel="مستخدمون نشطون"
                    peopleScope={`+${fmtNum(day.new_buyers)} مشترياً جديداً`}
                />
            )}

            {!loading && mode === 'month' && mo && (
                <>
                    <LookupResult
                        caption={`أرقام شهر ${mo.label}`}
                        views={mo.views_count}
                        bookings={mo.bookings_count}
                        bookingsScope={`${fmtNum(mo.completed_bookings)} مكتملاً`}
                        gmv={mo.gmv}
                        savings={mo.savings_delivered}
                        people={mo.active_users}
                        peopleLabel="مستخدمون نشطون"
                        peopleScope={`+${fmtNum(mo.new_buyers)} مشترياً جديداً`}
                    />
                    {Array.isArray(mo.daily_breakdown) && mo.daily_breakdown.length > 0 && (
                        <DailyMiniChart points={mo.daily_breakdown} />
                    )}
                </>
            )}

            {!loading && mode === 'year' && yr && (
                <>
                    <LookupResult
                        caption={`أرقام سنة ${yr.label}`}
                        views={yr.views_count}
                        bookings={yr.bookings_count}
                        bookingsScope={`${fmtNum(yr.completed_bookings)} مكتملاً`}
                        gmv={yr.gmv}
                        savings={yr.savings_delivered}
                        people={yr.new_buyers}
                        peopleLabel="مشترون جدد"
                        peopleScope={`+${fmtNum(yr.new_sellers)} تاجراً جديداً`}
                    />
                    {Array.isArray(yr.monthly_breakdown) && yr.monthly_breakdown.length > 0 && (
                        <MonthlyMiniChart points={yr.monthly_breakdown} />
                    )}
                </>
            )}

            {!loading && !day && !mo && !yr && (
                <AdmEmpty icon="📅" title="لا أرقام لهذه الفترة" hint="جرّب تاريخاً آخر — أو تأكّد أن المنصّة كانت تعمل حينها." />
            )}
        </AdmSection>
    );
};

const LookupResult = memo<{
    caption: string;
    views: number; viewsScope?: string;
    bookings: number; bookingsScope?: string;
    gmv: number; savings: number;
    people: number; peopleLabel: string; peopleScope?: string;
}>(({ caption, views, viewsScope, bookings, bookingsScope, gmv, savings, people, peopleLabel, peopleScope }) => (
    <div>
        <div style={{ fontSize: '.82rem', fontWeight: 800, color: 'var(--adm-fg)', marginBottom: 10 }}>{caption}</div>
        <AdmStatGrid cols={4}>
            <AdmStat label="مشاهدات عروض" value={fmtNum(views)} scope={viewsScope} icon="👀" />
            <AdmStat label="حجوزات" value={fmtNum(bookings)} scope={bookingsScope} icon="🎟️" tone="ok" />
            <AdmStat
                label="قيمة مبيعات التجّار (GMV)"
                value={fmtMoney(gmv)}
                scope={`وفّر على المشترين ${fmtMoney(savings)}`}
                icon="🧾"
                title="مالٌ دفعه المشترون للتجّار في هذه الفترة — لا يمرّ بحساب تاكي."
            />
            <AdmStat label={peopleLabel} value={fmtNum(people)} scope={peopleScope} icon="👥" tone="info" />
        </AdmStatGrid>
    </div>
));
LookupResult.displayName = 'LookupResult';

const DailyMiniChart = memo<{ points: Array<{ day: string; views: number; books: number }> }>(({ points }) => {
    const max = Math.max(...points.map((p) => Math.max(Number(p.views) || 0, Number(p.books) || 0)), 1);
    return (
        <div style={{ background: 'var(--adm-surface-2)', borderRadius: 'var(--adm-r-sm)', padding: 12, marginTop: 14 }}>
            <div style={{ fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-3)', marginBottom: 9 }}>
                تفصيلٌ يومي — المشاهدات فوق والحجوزات تحت
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 84 }}>
                {points.map((p) => (
                    <div
                        key={p.day}
                        title={`${p.day}: ${fmtNum(p.views)} مشاهدة · ${fmtNum(p.books)} حجزاً`}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 2, height: '100%' }}
                    >
                        <div style={{ height: `${((Number(p.views) || 0) / max) * 100}%`, minHeight: p.views > 0 ? 1 : 0, background: 'var(--adm-info-fg)', borderRadius: '3px 3px 0 0' }} />
                        <div style={{ height: `${((Number(p.books) || 0) / max) * 100}%`, minHeight: p.books > 0 ? 1 : 0, background: 'var(--adm-ok-fg)', borderRadius: '3px 3px 0 0' }} />
                    </div>
                ))}
            </div>
        </div>
    );
});
DailyMiniChart.displayName = 'DailyMiniChart';

const MonthlyMiniChart = memo<{ points: Array<{ month: string; month_key: string; views: number; books: number; gmv: number }> }>(({ points }) => {
    const maxGmv = Math.max(...points.map((p) => Number(p.gmv) || 0), 1);
    return (
        <div style={{ background: 'var(--adm-surface-2)', borderRadius: 'var(--adm-r-sm)', padding: 12, marginTop: 14 }}>
            <div style={{ fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-3)', marginBottom: 9 }}>
                تفصيلٌ شهري — قيمة مبيعات التجّار (GMV)
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 96 }}>
                {points.map((p) => (
                    <div
                        key={p.month_key}
                        title={`${p.month}: ${fmtMoney(p.gmv)} مبيعات · ${fmtNum(p.books)} حجزاً`}
                        style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 4, height: '100%' }}
                    >
                        <div style={{ width: '100%', height: `${((Number(p.gmv) || 0) / maxGmv) * 100}%`, minHeight: p.gmv > 0 ? 2 : 0, background: 'var(--adm-accent)', borderRadius: '5px 5px 0 0' }} />
                        <span style={{ fontSize: '.58rem', fontWeight: 700, color: 'var(--adm-fg-3)', whiteSpace: 'nowrap' }}>
                            {p.month.split(' ')[0]}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
});
MonthlyMiniChart.displayName = 'MonthlyMiniChart';

// ═══════════════════════════════════════════════════════════════════════════
// منتقي الفترة
// ═══════════════════════════════════════════════════════════════════════════
const PeriodPicker = memo<{ period: Period; onChange: (p: Period) => void }>(({ period, onChange }) => (
    <div role="group" aria-label="فترة لمحة الأعمال" style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap' }}>
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
// الحاوية
// ═══════════════════════════════════════════════════════════════════════════
export const InvestorPack: React.FC = () => {
    const [period, setPeriod] = useState<Period>(30);
    const [kpis, setKpis] = useState<InvestorKpis | null>(null);
    const [gmv, setGmv] = useState<GmvMonth[]>([]);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        setLoading(true);
        const [k, g] = await Promise.all([
            adminService.getInvestorKpis(period),
            adminService.getGmvMonthly(12),
        ]);
        setKpis(k);
        setGmv(g);
        setLoading(false);
    }, [period]);

    useEffect(() => { refresh(); }, [refresh]);

    /** كل الأرقام في ملفّ CSV واحد — بنفس التسمية المعروضة، لا باسمٍ آخر. */
    const packRows = useMemo(() => {
        if (!kpis) return [];
        return [
            { metric: 'الفترة (أيام)', value: kpis.period_days },
            { metric: 'قيمة مبيعات التجّار (GMV)', value: kpis.gmv },
            { metric: 'منها مبيعاتٌ أُكملت فعلاً', value: kpis.gmv_completed },
            { metric: 'وفّرته تاكي على المشترين', value: kpis.savings_delivered },
            { metric: 'إجمالي الحجوزات', value: kpis.total_bookings },
            { metric: 'حجوزات مكتملة', value: kpis.completed_bookings },
            { metric: 'حجوزات ملغاة', value: kpis.cancelled_bookings },
            { metric: 'متوسط قيمة الطلب (AOV)', value: kpis.avg_order_value },
            { metric: 'نشطون يومياً (DAU)', value: kpis.dau },
            { metric: 'نشطون أسبوعياً (WAU)', value: kpis.wau },
            { metric: 'نشطون شهرياً (MAU)', value: kpis.mau },
            { metric: 'التماسك % (DAU ÷ MAU)', value: kpis.stickiness_pct },
            { metric: 'مشاهدات العروض', value: kpis.total_views },
            { metric: 'مشاهدون فريدون', value: kpis.unique_viewers },
            { metric: 'نسبة التحويل %', value: kpis.conversion_pct },
            { metric: 'مشترون يعيدون الشراء %', value: kpis.repeat_customer_rate_pct },
            { metric: 'نمو مبيعات التجّار % (عن الفترة السابقة)', value: kpis.mom_gmv_growth_pct },
            { metric: 'نمو الحجوزات %', value: kpis.mom_bookings_growth_pct },
            { metric: 'نمو المستخدمين الجدد %', value: kpis.mom_new_users_growth_pct },
            { metric: 'مشترون جدد', value: kpis.new_buyers },
            { metric: 'تجّار جدد', value: kpis.new_sellers },
            { metric: 'تجّار عليهم حجوزات', value: kpis.net_active_merchants },
        ];
    }, [kpis]);

    const PACK_COLUMNS: CsvColumn<{ metric: string; value: string | number }>[] = useMemo(() => [
        { header: 'المقياس', accessor: (r) => r.metric },
        { header: 'القيمة', accessor: (r) => r.value },
    ], []);

    const downloadFullPack = useCallback(() => {
        if (!packRows.length) return;
        downloadCsv('taki-investor-pack-kpis', packRows, PACK_COLUMNS);
    }, [packRows, PACK_COLUMNS]);

    return (
        <div style={{ display: 'grid', gap: 14 }} dir="rtl">

            {/* ── شريط الفترة والإجراءات ──────────────────────────────────── */}
            <AdmCard>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: 200 }}>
                        <div style={{ fontSize: '.88rem', fontWeight: 800, color: 'var(--adm-fg)' }}>فترة لمحة الأعمال</div>
                        <p style={{ margin: '5px 0 0', fontSize: '.78rem', lineHeight: 1.75, color: 'var(--adm-fg-2)', maxWidth: '64ch' }}>
                            تتحكّم بالقسمين التاليين وحدهما. الأقسام الشهرية والاستعلام بتاريخٍ لها مداها الخاص، وهو مكتوبٌ في عنوان كلٍّ منها.
                        </p>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <PeriodPicker period={period} onChange={setPeriod} />
                        <AdmButton onClick={downloadFullPack} disabled={!kpis} title="تنزيل كل أرقام هذه اللمحة في ملفّ CSV واحد جاهز للإرسال">
                            ⬇ تنزيل الأرقام
                        </AdmButton>
                        <AdmButton onClick={refresh} disabled={loading} title="إعادة تحميل أرقام هذه اللمحة">
                            {loading ? 'جارٍ التحميل…' : '↻ تحديث'}
                        </AdmButton>
                    </div>
                </div>
            </AdmCard>

            {loading ? (
                <AdmCard><AdmSkeleton rows={4} height={76} /></AdmCard>
            ) : (
                <>
                    <MoneySection kpis={kpis} period={period} />
                    <PeopleSection kpis={kpis} period={period} />
                    <GmvMonthlySection data={gmv} />
                    <DateLookupSection />

                    {/* 🪤 إحالة بدل تكرار: الجغرافيا كلّها في شاشةٍ واحدة. */}
                    <RefLine
                        icon="🗺"
                        text="التوزيع الجغرافي (المناطق والمدن ومن أين يدخل المشترون) في شاشة «جمهور المدن» — أغنى ممّا كان هنا، وفي مكانٍ واحد."
                    />
                </>
            )}
        </div>
    );
};

export default InvestorPack;
