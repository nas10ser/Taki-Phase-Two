/**
 * AdminAudience — «جمهور المدن»: الجغرافيا وحدها (v14.89)
 * ═══════════════════════════════════════════════════════════════════════════
 * القاعدة الحاكمة بعد الجرد: **هذه الشاشة تجيب سؤالاً واحداً** — أين يسكن
 * المشترون، وكم منهم دخل وحجز في كل منطقة ومدينة. الأرقامُ على فترةٍ مكانها
 * «التحليلات»، والتشخيصُ مكانه «المحلل الذكي».
 *
 * 🪤 ما حُذف من هنا، وقد قِيس تكرارُه على الصفحة نفسها:
 *   • **«⏰ ساعات الذروة»** — «المحلل الذكي» يعرض خريطة ساعاتٍ أغنى (ساعة ×
 *     يوم) على البيانات نفسها. بقي هنا سطرُ إحالةٍ قابلٌ للنقر.
 *   • **«🏷 أين دخلوا؟ (التصنيفات)»** — التصنيف ليس جغرافيا، وهو في
 *     «التحليلات» كجدول تحويل. سطرُ إحالةٍ بدله.
 *   • **عنوان الشاشة المحلّي** — قشرةُ اللوحة تطبع اسم التبويب ووصفه من
 *     `adminNav.ts` فوق كل شاشة، فكتابته هنا تكرارٌ حرفيّ.
 *
 * 🪤 وما صُحّح لأن الرقم كان يكذب بلا أن يُخطئ:
 *   • **جدول المدن يخلط أربعة مديات** في صفٍّ واحد: «مسجّلون» تراكميّ من أوّل
 *     يوم · «دخلوا» يتبع الفترة · «اليوم»/«أمس» يومان ثابتان. صار المدى
 *     مكتوباً في **رأس كل عمود**، وتحت الجدول سطرٌ يقول إن الاختلاف مقصود.
 *     (وقِيس في نصّ الدالّة: «اليوم»/«أمس» يُحسبان من أحداث الفترة نفسها —
 *     فإن اخترتَ يوماً ماضياً لا يشملهما ظهرا صفراً، وليس ذلك عطلاً.)
 *   • **«📦 إجمالي الحجوزات» يشمل الملغاة، و«حجوزات المنصّات» لا تشملها**
 *     (`bk_all` مقابل `bk` في `admin_geo_insights`) — فالمجموعُ أقلّ دائماً
 *     بلا تفسير. صار لكلّ رقمٍ `scope` يقول أيّهما.
 *   • **رسمان يوميّان متجاوران** يقولان الشيء نفسه بمقياسين: الرسم هنا
 *     يتبع التصفية الجغرافية، ورسمُ «زوّار الموقع» يقيس جلسات التصفّح في كل
 *     الموقع بفترته الخاصّة. صارا قسماً واحداً ظاهراً وآخر يُفتح عمداً،
 *     ولكلٍّ نطاقُه مكتوباً فوقه.
 *   • ورسمُ الأعمدة كان يقيس العمودين **بأقصى «من دخل» وحده**، فلو تجاوز
 *     الحاجزون الداخلين (حجزٌ بلا حدث فتح) خرج العمود من الإطار. المقياس
 *     الآن أقصى الاثنين.
 *
 * المصدر: RPC `admin_geo_insights` (أدمن فقط) — لا تُرجع أي إحداثيات أفراد.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { adminService } from '../../services/adminService';
import { REGIONS, CITIES, LOCATIONS } from '../../data/mock';
import SiteTrafficPanel from '../../components/admin/SiteTrafficPanel';
import {
    AdmCard, AdmSection, AdmStat, AdmStatGrid, AdmPill, AdmEmpty,
    AdmSkeleton, AdmError, AdmButton, AdmTable, AdmSelect, admNum,
} from '../../components/admin/ui';
import type { AdmColumn } from '../../components/admin/ui';

// ═══════════════════════════════════════════════════════════════════════════
// الأنواع والأدوات
// ═══════════════════════════════════════════════════════════════════════════

interface DailyRow { d: string; actives: number; opens: number; bookers: number; bookings: number }
interface RegionRow { region: string; registered: number; actives: number; buyers: number; sellers: number }
interface CityRow { city: string; region: string | null; registered: number; actives: number; today: number; yesterday: number }
interface SourceRow { source: string; users: number; opens: number; bookings: number }

const num = (v: unknown): number => Number(v) || 0;
const cityName = (id: string | null) => CITIES.find(c => c.id === id)?.name || id || '—';
const regionName = (id: string | null) => REGIONS.find(r => r.id === id)?.name || id || '—';

/** نسبة التغيّر — و`null` حين لا خطَّ أساس (أمسُ صفر) فلا تُعرض «٠٪» كأنها قياس. */
const deltaPct = (today: number, yday: number): number | null => {
    if (!yday) return null;
    return Math.round(((today - yday) / yday) * 100);
};

/** «٥ م» بدل 17 — تسميات ساعات مفهومة لغير التقنيين. */
const hourLabel = (h: number) => {
    const ampm = h < 12 ? 'ص' : 'م';
    const base = h % 12 === 0 ? 12 : h % 12;
    return `${base} ${ampm}`;
};

const SRC_META: Record<string, { emoji: string; ar: string }> = {
    web: { emoji: '🌐', ar: 'الموقع / التطبيق' },
    telegram: { emoji: '✈️', ar: 'بوت تيليجرام' },
    whatsapp: { emoji: '💬', ar: 'بوت واتساب' },
};

// ═══════════════════════════════════════════════════════════════════════════
// الرسم اليومي — عمودان لكل يوم: من دخل، ومن حجز
// ═══════════════════════════════════════════════════════════════════════════

const DailyChart: React.FC<{ rows: DailyRow[] }> = ({ rows }) => {
    const n = rows.length;
    const max = Math.max(1, ...rows.map(r => Math.max(num(r.actives), num(r.bookers))));
    const W = 720, H = 148, PAD = 8, LAB = 20;
    const slot = (W - PAD * 2) / Math.max(1, n);
    const bw = Math.min(14, Math.max(3, slot * 0.36));
    const step = Math.max(1, Math.ceil(n / 12));

    return (
        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }} dir="ltr">
            <svg
                viewBox={`0 0 ${W} ${H + LAB}`}
                role="img"
                aria-label={`أعمدة يومية لعدد من دخل ومن حجز خلال ${n} يوماً`}
                style={{ display: 'block', width: '100%', minWidth: Math.min(700, Math.max(300, n * 24)), height: 'auto', maxHeight: 210 }}
            >
                <line x1={PAD} y1={H} x2={W - PAD} y2={H} stroke="var(--adm-border)" strokeWidth={1} />
                {rows.map((r, i) => {
                    const a = num(r.actives);
                    const b = num(r.bookers);
                    const cx = PAD + i * slot + slot / 2;
                    const ha = a > 0 ? Math.max(2, Math.round((a / max) * (H - 8))) : 0;
                    const hb = b > 0 ? Math.max(2, Math.round((b / max) * (H - 8))) : 0;
                    return (
                        <g key={r.d}>
                            <title>{`${r.d} — ${admNum(a)} دخلوا · ${admNum(b)} حجزوا`}</title>
                            <rect x={cx - bw - 1} y={H - ha} width={bw} height={ha} rx={2} fill="var(--adm-accent)" />
                            <rect x={cx + 1} y={H - hb} width={bw} height={hb} rx={2} fill="var(--adm-warn-fg)" />
                            {i % step === 0 && (
                                <text x={cx} y={H + 14} textAnchor="middle" fontSize={9.5} fontWeight={700} fill="var(--adm-fg-3)">
                                    {r.d.slice(8, 10)}
                                </text>
                            )}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

const Swatch: React.FC<{ color: string; label: string }> = ({ color, label }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: '.74rem', fontWeight: 700, color: 'var(--adm-fg-2)' }}>
        <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 3, background: color, display: 'inline-block' }} />
        {label}
    </span>
);

/** سطرُ إحالةٍ إلى شاشةٍ أخرى — لأن ما حُذف من هنا لم يُحذف من اللوحة. */
const MovedTo: React.FC<{ icon: string; what: string; where: string; why: string; onGo: () => void }> = ({ icon, what, where, why, onGo }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 2px', borderBottom: '1px solid var(--adm-border)' }}>
        <span aria-hidden="true" style={{ fontSize: '.95rem' }}>{icon}</span>
        <span style={{ flex: 1, minWidth: 180 }}>
            <span style={{ fontSize: '.83rem', fontWeight: 800, color: 'var(--adm-fg)' }}>{what}</span>
            <span style={{ display: 'block', fontSize: '.75rem', color: 'var(--adm-fg-2)', lineHeight: 1.7, marginTop: 2 }}>{why}</span>
        </span>
        <AdmButton size="sm" onClick={onGo}>{where} ←</AdmButton>
    </div>
);

// ═══════════════════════════════════════════════════════════════════════════

const AdminAudience: React.FC = () => {
    const history = useHistory();

    const [days, setDays] = useState(7);
    const [onDate, setOnDate] = useState('');        // يوم محدد — يطغى على الفترة
    const [hourFrom, setHourFrom] = useState(-1);    // -1 = كل الساعات
    const [hourTo, setHourTo] = useState(-1);
    const [region, setRegion] = useState('');
    const [city, setCity] = useState('');
    const [mall, setMall] = useState('');            // سوق/مول محدد (نطاق كم حوله)
    const [radiusKm, setRadiusKm] = useState(10);
    const [data, setData] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reloadKey, setReloadKey] = useState(0);

    const regionCities = useMemo(() => CITIES.filter(c => !region || c.regionId === region), [region]);
    const cityMalls = useMemo(() => LOCATIONS.filter(l => city && l.cityId === city), [city]);
    const mallObj = useMemo(() => LOCATIONS.find(l => l.id === mall), [mall]);
    const hoursOn = hourFrom >= 0 && hourTo >= 0;

    useEffect(() => {
        let alive = true;
        setLoading(true);
        adminService.getGeoInsights({
            days,
            date: onDate || null,
            hourFrom: hoursOn ? hourFrom : null,
            hourTo: hoursOn ? hourTo : null,
            region: region || null,
            city: city || null,
            lat: mallObj?.lat ?? null,
            lng: mallObj?.lng ?? null,
            radiusKm: mallObj ? radiusKm : null,
        })
            .then(d => {
                if (!alive) return;
                setData(d);
                setFailed(!d);
                setLoading(false);
            })
            // 🪤 بلا هذا المصيدِ يبقى «جارٍ التحليل» إلى الأبد عند انقطاع الشبكة:
            //    الوعدُ يُرفض فلا يُنفَّذ `then` ولا يُطفأ التحميل.
            .catch(() => {
                if (!alive) return;
                setData(null);
                setFailed(true);
                setLoading(false);
            });
        return () => { alive = false; };
    }, [days, onDate, hourFrom, hourTo, hoursOn, region, city, mallObj, radiusKm, reloadKey]);

    const t = data?.totals || {};
    const daily = useMemo<DailyRow[]>(() => (data?.daily ?? []) as DailyRow[], [data]);
    const sources = useMemo<SourceRow[]>(() => (data?.sources ?? []) as SourceRow[], [data]);
    const cities = useMemo<CityRow[]>(() => (data?.cities ?? []) as CityRow[], [data]);

    /** المناطق الثلاث عشرة كلها — حتى الصفرية، فغيابُ منطقةٍ يُقرأ «لا بيانات» لا «صفر». */
    const regions13 = useMemo(() => {
        const rows = (data?.regions ?? []) as RegionRow[];
        return REGIONS.map(r => {
            const row = rows.find(x => x.region === r.id);
            return {
                id: r.id,
                name: r.name,
                registered: num(row?.registered),
                actives: num(row?.actives),
            };
        });
    }, [data]);

    const todayDelta = deltaPct(num(t.actives_today), num(t.actives_yday));
    const conv = num(t.actives) > 0 ? Math.round((num(t.bookers) / num(t.actives)) * 100) : 0;
    const bigDrop = !onDate && todayDelta !== null && todayDelta <= -40;
    const srcBookings = sources.reduce((s, x) => s + num(x.bookings), 0);
    const chartHasData = daily.some(r => num(r.actives) > 0 || num(r.bookers) > 0);
    const peakDay = daily.reduce<DailyRow | null>((b, r) => (num(r.actives) > num(b?.actives) ? r : b), null);

    // المسجلون داخل النطاق المختار (مدينة ‹ منطقة ‹ الكل)
    const scopeRegistered = city
        ? num(cities.find(c => c.city === city)?.registered)
        : region
            ? num(regions13.find(r => r.id === region)?.registered)
            : num(t.total_users);

    const placeLabel = mallObj
        ? `${mallObj.name} (${radiusKm} كم حوله)`
        : city ? cityName(city) : region ? regionName(region) : 'كل السعودية';

    const periodLabel = onDate
        ? `يوم ${onDate}`
        : days === 1 ? 'اليوم' : `آخر ${days} يوماً`;

    const hoursLabel = hoursOn ? `${hourLabel(hourFrom)} → ${hourLabel(hourTo)}` : 'كل الساعات';
    const filtersOn = !!(onDate || hoursOn || region || city || mall) || days !== 7;

    const resetFilters = useCallback(() => {
        setDays(7); setOnDate(''); setHourFrom(-1); setHourTo(-1);
        setRegion(''); setCity(''); setMall(''); setRadiusKm(10);
    }, []);

    const cityColumns = useMemo<Array<AdmColumn<CityRow>>>(() => [
        {
            header: 'المدينة',
            cell: (c) => (
                <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' }}>
                    <button
                        type="button"
                        onClick={() => { setRegion(c.region || ''); setCity(c.city); setMall(''); }}
                        className="adm-focusable"
                        title={`تصفية كل أرقام الصفحة على ${cityName(c.city)}`}
                        style={{
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                            fontSize: '.84rem', fontWeight: 800, color: 'var(--adm-accent)',
                            textDecoration: 'underline', textUnderlineOffset: 3,
                        }}
                    >
                        {cityName(c.city)}
                    </button>
                    <span style={{ fontSize: '.7rem', color: 'var(--adm-fg-3)', fontWeight: 600 }}>{regionName(c.region)}</span>
                </span>
            ),
        },
        { header: 'مسجّلون — كل الوقت', numeric: true, cell: (c) => admNum(num(c.registered)) },
        { header: 'دخلوا — الفترة المختارة', numeric: true, cell: (c) => admNum(num(c.actives)) },
        { header: 'اليوم', numeric: true, cell: (c) => admNum(num(c.today)) },
        { header: 'أمس', numeric: true, secondary: true, cell: (c) => admNum(num(c.yesterday)) },
        {
            header: 'التغيّر: اليوم مقابل أمس',
            cell: (c) => {
                const dl = deltaPct(num(c.today), num(c.yesterday));
                if (dl === null) return <span style={{ color: 'var(--adm-fg-3)' }}>—</span>;
                if (dl === 0) return <AdmPill>بلا تغيّر</AdmPill>;
                return <AdmPill tone={dl < 0 ? 'bad' : 'ok'}>{dl > 0 ? `▲ ${dl}٪` : `▼ ${Math.abs(dl)}٪`}</AdmPill>;
            },
        },
    ], []);

    // ═══════════════════════════════════════════════════════════════════════

    return (
        <div style={{ display: 'grid', gap: 14 }} dir="rtl">

            {/* ── المرشِّحات: فترة + ساعات + مكان ─────────────────────────── */}
            <AdmCard>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <span style={{ fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>الفترة</span>
                    {[1, 7, 14, 30].map(d => (
                        <AdmButton
                            key={d}
                            size="sm"
                            variant={!onDate && days === d ? 'primary' : 'secondary'}
                            onClick={() => { setDays(d); setOnDate(''); }}
                        >
                            {d === 1 ? 'اليوم' : `آخر ${d} يوماً`}
                        </AdmButton>
                    ))}
                    <label
                        className="adm-focusable"
                        style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                            padding: '5px 11px', borderRadius: 'var(--adm-r-sm)',
                            border: `1px solid ${onDate ? 'transparent' : 'var(--adm-border)'}`,
                            background: onDate ? 'var(--adm-accent)' : 'var(--adm-surface-2)',
                            color: onDate ? '#ffffff' : 'var(--adm-fg)',
                            fontSize: '.78rem', fontWeight: 800,
                        }}
                    >
                        📅 يوم محدد
                        <input
                            type="date"
                            value={onDate}
                            onChange={e => setOnDate(e.target.value)}
                            style={{ background: 'transparent', color: 'inherit', border: 'none', font: 'inherit', outline: 'none', colorScheme: 'auto' }}
                        />
                        {onDate && (
                            <button
                                type="button"
                                onClick={(ev) => { ev.preventDefault(); setOnDate(''); }}
                                aria-label="إلغاء اليوم المحدد"
                                style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontWeight: 900, padding: 0 }}
                            >
                                ✕
                            </button>
                        )}
                    </label>
                </div>

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <AdmSelect
                        label="المنطقة"
                        value={region}
                        onChange={(v) => { setRegion(v); setCity(''); setMall(''); }}
                        options={[{ value: '', label: '🌍 كل المناطق' }, ...REGIONS.map(r => ({ value: r.id, label: r.name }))]}
                    />
                    <AdmSelect
                        label="المدينة"
                        value={city}
                        onChange={(v) => { setCity(v); setMall(''); }}
                        options={[{ value: '', label: '🏙 كل المدن' }, ...regionCities.map(c => ({ value: c.id, label: c.name }))]}
                    />
                    {city && cityMalls.length > 0 && (
                        <AdmSelect
                            label="سوق / مول"
                            value={mall}
                            onChange={setMall}
                            options={[{ value: '', label: '🏬 المدينة كاملة' }, ...cityMalls.map(l => ({ value: l.id, label: l.name }))]}
                        />
                    )}
                    {mallObj && (
                        <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
                            <span style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>النطاق حول السوق (كم)</span>
                            <input
                                type="number"
                                min={1}
                                max={100}
                                value={radiusKm}
                                onChange={e => setRadiusKm(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                                className="adm-focusable"
                                style={{
                                    width: 90, padding: '7px 10px', fontSize: '.82rem', fontWeight: 700,
                                    borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
                                    background: 'var(--adm-surface)', color: 'var(--adm-fg)', textAlign: 'center',
                                }}
                            />
                        </label>
                    )}
                    <AdmSelect
                        label="من الساعة"
                        value={hourFrom < 0 ? '' : String(hourFrom)}
                        onChange={(v) => {
                            if (v === '') { setHourFrom(-1); setHourTo(-1); return; }
                            setHourFrom(Number(v));
                            if (hourTo < 0) setHourTo(23);
                        }}
                        options={[{ value: '', label: '🕐 كل الساعات' }, ...Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hourLabel(h) }))]}
                    />
                    {hourFrom >= 0 && (
                        <AdmSelect
                            label="إلى الساعة"
                            value={hourTo < 0 ? '23' : String(hourTo)}
                            onChange={(v) => setHourTo(Number(v))}
                            options={Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: hourLabel(h) }))}
                        />
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--adm-border)' }}>
                    <span style={{ fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>يعرض الآن</span>
                    <AdmPill tone="info">📍 {placeLabel}</AdmPill>
                    <AdmPill tone="info">🗓 {periodLabel}</AdmPill>
                    <AdmPill tone={hoursOn ? 'info' : 'neutral'}>🕐 {hoursLabel}</AdmPill>
                    {filtersOn && (
                        <span style={{ marginInlineStart: 'auto' }}>
                            <AdmButton size="sm" variant="ghost" onClick={resetFilters}>إعادة الضبط</AdmButton>
                        </span>
                    )}
                </div>
            </AdmCard>

            {/* ── هبوطٌ حادّ اليوم ─────────────────────────────────────────── */}
            {!loading && !failed && bigDrop && (
                <div
                    role="status"
                    style={{
                        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                        padding: '12px 14px', borderRadius: 'var(--adm-r)',
                        background: 'var(--adm-bad-bg)', color: 'var(--adm-bad-fg)',
                        fontSize: '.84rem', fontWeight: 800, lineHeight: 1.8,
                    }}
                >
                    <span>🚨 هبوط حادّ اليوم: دخل {admNum(num(t.actives_today))} مقابل {admNum(num(t.actives_yday))} أمس ({todayDelta}٪).</span>
                    <span style={{ fontWeight: 600 }}>تحقّق من الخدمة أوّلاً، ثم من الحملة.</span>
                </div>
            )}

            {failed ? (
                <AdmError
                    message="تعذّر جلب أرقام الجمهور. قد تكون الشبكة انقطعت، أو انتهت جلسة الدخول."
                    onRetry={() => setReloadKey(k => k + 1)}
                />
            ) : loading ? (
                <>
                    <AdmCard><AdmSkeleton rows={2} height={86} /></AdmCard>
                    <AdmCard><AdmSkeleton rows={1} height={190} /></AdmCard>
                </>
            ) : (
                <>
                    {/* ── الأرقام على النطاق المختار ───────────────────────── */}
                    <AdmSection
                        title="الأرقام على النطاق المختار"
                        icon="📊"
                        desc="تحت كل رقمٍ مداه: ما هو تراكميٌّ من أوّل يوم، وما يتبع الفترة والمكان المختارين أعلاه."
                    >
                        <AdmStatGrid cols={3}>
                            <AdmStat
                                icon="🪪"
                                label="مسجّلون في هذا النطاق"
                                value={admNum(scopeRegistered)}
                                scope={`كل الوقت — ${placeLabel}`}
                                title="عدد الحسابات التي آخرُ موقعٍ معروفٍ لها داخل النطاق المختار. رقمٌ تراكميّ لا يتبع الفترة."
                            />
                            <AdmStat
                                icon="👥"
                                label="دخلوا فعلاً"
                                value={admNum(num(t.actives))}
                                tone="ok"
                                scope="الفترة المختارة"
                                delta={!onDate && todayDelta !== null ? { text: `${todayDelta > 0 ? '▲' : todayDelta < 0 ? '▼' : '—'} ${Math.abs(todayDelta)}٪ اليوم عن أمس`, good: todayDelta === 0 ? undefined : todayDelta > 0 } : undefined}
                                title="أشخاصٌ مختلفون لهم حساب وسُجّل لهم نشاطٌ داخل الفترة والنطاق. الزائر بلا حساب غير محسوبٍ هنا — مكانه «زوّار الموقع» أسفل الصفحة."
                            />
                            <AdmStat
                                icon="🆕"
                                label="سجّلوا حساباً جديداً"
                                value={admNum(num(t.new_users))}
                                tone="info"
                                scope="الفترة المختارة"
                                title="حساباتٌ أُنشئت داخل الفترة المختارة ويقع موقعها في النطاق المختار."
                            />
                            <AdmStat
                                icon="🎟"
                                label="أشخاص حجزوا"
                                value={admNum(num(t.bookers))}
                                tone="warn"
                                scope="الفترة المختارة — بلا الملغاة"
                                title="أشخاصٌ مختلفون أنشأوا حجزاً واحداً على الأقلّ لم يُلغَ."
                            />
                            <AdmStat
                                icon="📦"
                                label="إجمالي الحجوزات"
                                value={admNum(num(t.bookings))}
                                scope="الفترة المختارة — يشمل الملغاة"
                                title="كل حجزٍ أُنشئ في الفترة أيّاً كان مصيره: مكتمل أو قائم أو ملغى. ولذلك هو أكبر من مجموع حجوزات المنصّات أدناه، فتلك تستثني الملغاة."
                            />
                            <AdmStat
                                icon="🔁"
                                label="٪ من الداخلين حجزوا"
                                value={`${conv}٪`}
                                tone={conv < 10 ? 'bad' : 'ok'}
                                scope="الفترة المختارة"
                                title="«أشخاص حجزوا» ÷ «دخلوا فعلاً» داخل الفترة والنطاق نفسيهما، بلا الحجوزات الملغاة. وهي غير «٪ الزوّار الذين حجزوا» في «زوّار الموقع» أسفل الصفحة: تلك تُقاس على جلسات التصفّح كلّها بما فيها زوّارٌ بلا حساب."
                            />
                        </AdmStatGrid>
                    </AdmSection>

                    {/* ── مصير الحجوزات ───────────────────────────────────── */}
                    <AdmSection
                        title="ماذا حدث للحجوزات؟"
                        icon="📦"
                        desc={`الثلاثة معاً = «إجمالي الحجوزات» (${admNum(num(t.bookings))}) — فهو وحده يشمل الملغاة.`}
                    >
                        <AdmStatGrid cols={3}>
                            <AdmStat icon="✅" label="استُلمت (مكتملة)" value={admNum(num(t.bk_completed))} tone="ok" scope="الفترة المختارة" />
                            <AdmStat icon="⏳" label="ما زالت قائمة" value={admNum(num(t.bk_active))} tone="info" scope="الفترة المختارة" />
                            <AdmStat icon="🚫" label="أُلغيت" value={admNum(num(t.bk_cancelled))} tone="bad" scope="الفترة المختارة" />
                        </AdmStatGrid>
                        {num(t.bk_cancelled) > 0 && (
                            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
                                <span style={{ fontSize: '.74rem', fontWeight: 800, color: 'var(--adm-fg-3)', alignSelf: 'center' }}>من ألغى؟</span>
                                <AdmPill>🛍 المشتري: {admNum(num(t.bk_c_buyer))}</AdmPill>
                                <AdmPill>🏪 التاجر: {admNum(num(t.bk_c_seller))}</AdmPill>
                                <AdmPill>⏰ انتهت المهلة تلقائياً: {admNum(num(t.bk_c_system))}</AdmPill>
                            </div>
                        )}
                    </AdmSection>

                    {/* ── المناطق الثلاث عشرة ─────────────────────────────── */}
                    <AdmSection
                        title="المناطق الثلاث عشرة"
                        icon="🗺"
                        desc="اضغط منطقةً لتصفية كل أرقام الصفحة عليها. «مسجّل» تراكميٌّ من أوّل يوم (آخر موقعٍ معروفٍ للحساب)، و«نشِط» يتبع الفترة المختارة — ولذلك تظهر بقيّة المناطق بنشاطٍ صفر ما دامت منطقةٌ واحدة مختارة."
                        badge={region ? { text: `مُصفّى على ${regionName(region)}`, tone: 'info' } : undefined}
                        action={region ? <AdmButton size="sm" variant="ghost" onClick={() => { setRegion(''); setCity(''); setMall(''); }}>إلغاء التصفية</AdmButton> : undefined}
                    >
                        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                            {regions13.map(r => {
                                const on = region === r.id;
                                return (
                                    <button
                                        key={r.id}
                                        type="button"
                                        onClick={() => { setRegion(on ? '' : r.id); setCity(''); setMall(''); }}
                                        aria-pressed={on}
                                        className="adm-focusable"
                                        style={{
                                            textAlign: 'right', cursor: 'pointer',
                                            padding: '11px 12px', borderRadius: 'var(--adm-r-sm)',
                                            border: `1px solid ${on ? 'var(--adm-accent)' : 'var(--adm-border)'}`,
                                            background: on ? 'var(--adm-accent-weak)' : 'var(--adm-surface-2)',
                                        }}
                                    >
                                        <div style={{ fontSize: '.78rem', fontWeight: 800, color: 'var(--adm-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {r.name}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '1.15rem', fontWeight: 900, color: 'var(--adm-fg)', fontVariantNumeric: 'tabular-nums' }}>
                                                {admNum(r.registered)}
                                            </span>
                                            <span style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--adm-fg-3)' }}>مسجّل</span>
                                            <span style={{ marginInlineStart: 'auto', fontSize: '.8rem', fontWeight: 900, color: 'var(--adm-warn-fg)', fontVariantNumeric: 'tabular-nums' }}>
                                                {admNum(r.actives)}
                                            </span>
                                            <span style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--adm-fg-3)' }}>نشِط</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </AdmSection>

                    {/* ── المدن ───────────────────────────────────────────── */}
                    <AdmSection
                        title="المدن"
                        icon="🏙"
                        desc="المنتقل بين المدن يُحسب على آخر مدينةٍ عُرف فيها (كان في الدمام وصار في الخبر ← يُحسب على الخبر)."
                        badge={cities.length ? { text: `${admNum(cities.length)} مدينة`, tone: 'neutral' } : undefined}
                    >
                        <AdmTable<CityRow>
                            columns={cityColumns}
                            rows={cities}
                            keyOf={(c) => c.city}
                            caption="المدن: المسجّلون والنشاط اليومي"
                            empty={{
                                icon: '🏙',
                                title: 'لا مستخدمين بموقعٍ معروف تفاعلوا في هذا النطاق',
                                hint: 'الجدول يمتلئ كلّما شارك المتسوّقون مواقعهم. جرّب توسيع الفترة أو إلغاء تصفية المنطقة.',
                            }}
                        />
                        <div style={{ fontSize: '.74rem', color: 'var(--adm-fg-2)', fontWeight: 600, lineHeight: 1.9, marginTop: 12, paddingTop: 11, borderTop: '1px solid var(--adm-border)' }}>
                            📏 <b>أعمدة هذا الجدول بمدياتٍ مختلفة عمداً</b>، ولا يصحّ جمعها أو مقارنتها ببعض:
                            «مسجّلون» رقمٌ تراكميّ من أوّل يوم · «دخلوا» يتبع الفترة المختارة أعلاه ·
                            «اليوم» و«أمس» يومان ثابتان لا يتبعان الفترة، ويظهران صفراً إن كانت الفترة المختارة لا تشملهما.
                            <br />
                            🔒 خصوصية: {admNum(num(t.located_users))} من {admNum(num(t.total_users))} مستخدماً شاركوا موقعهم — نعرض
                            <b> أعداداً فقط</b>، لا خرائط ولا مواقع أفراد. والجلسة تُحسب مرّةً كل ثلاثين دقيقة كحدٍّ أقصى لكل مستخدم.
                        </div>
                    </AdmSection>

                    {/* ── يوماً بيوم ──────────────────────────────────────── */}
                    <AdmSection
                        title="يوماً بيوم داخل النطاق المختار"
                        icon="📈"
                        desc="عمودان لكل يوم: من دخل، ومن حجز — لأصحاب الحسابات داخل المكان والفترة المختارين. (أمّا زوّار الموقع كلّهم بلا تصفيةٍ جغرافية فقسمٌ مستقلّ أسفل الصفحة، ولا يصحّ مقارنة الرقمين.)"
                        action={
                            <span style={{ display: 'inline-flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                                <Swatch color="var(--adm-accent)" label="دخلوا" />
                                <Swatch color="var(--adm-warn-fg)" label="حجزوا" />
                            </span>
                        }
                    >
                        {!chartHasData ? (
                            <AdmEmpty
                                icon="📈"
                                title="لا نشاط مسجّل في هذا النطاق"
                                hint="لا دخولٌ ولا حجزٌ لأصحاب الحسابات داخل المكان والفترة المختارين."
                            />
                        ) : (
                            <>
                                <DailyChart rows={daily} />
                                {peakDay && num(peakDay.actives) > 0 && (
                                    <div style={{ marginTop: 10 }}>
                                        <AdmPill tone="info">
                                            🔝 أعلى يوم: {peakDay.d} — {admNum(num(peakDay.actives))} دخلوا · {admNum(num(peakDay.bookers))} حجزوا
                                        </AdmPill>
                                    </div>
                                )}
                            </>
                        )}
                    </AdmSection>

                    {/* ── المنصّات ────────────────────────────────────────── */}
                    <AdmSection
                        title="من أي منصّة يستعملون تاكي؟"
                        icon="📱"
                        desc="المنصّة التي فتحوا منها تاكي وحجزوا: الموقع، أو بوت تيليجرام، أو بوت واتساب. وهي غير «قناة الإحالة» (بحثٌ أو انستقرام أو رابط حملة) — تلك في «زوّار الموقع ومصادرهم» أسفل الصفحة، وتُقاس على جلسات التصفّح لا على الحسابات."
                    >
                        <AdmStatGrid cols={3}>
                            {(['web', 'telegram', 'whatsapp'] as const).map(src => {
                                const s = sources.find(x => x.source === src);
                                return (
                                    <AdmStat
                                        key={src}
                                        icon={SRC_META[src].emoji}
                                        label={SRC_META[src].ar}
                                        value={admNum(num(s?.users))}
                                        scope={`مستخدماً · ${admNum(num(s?.bookings))} حجز`}
                                        title={`أشخاصٌ مختلفون سُجّل لهم نشاطٌ من ${SRC_META[src].ar} داخل الفترة والنطاق المختارين. والحجوزات هنا بلا الملغاة.`}
                                    />
                                );
                            })}
                        </AdmStatGrid>
                        <div style={{ fontSize: '.74rem', color: 'var(--adm-fg-2)', fontWeight: 600, lineHeight: 1.9, marginTop: 12 }}>
                            🧮 مجموع الحجوزات هنا <b>{admNum(srcBookings)}</b> — <b>بلا الملغاة</b>، بينما «إجمالي الحجوزات»
                            أعلاه <b>{admNum(num(t.bookings))}</b> <b>يشملها</b> ({admNum(num(t.bk_cancelled))} ملغاة).
                            ولا تظهر هنا منصّةٌ بلا نشاطٍ في الفترة ولو كان لها حجز.
                        </div>
                    </AdmSection>

                    {/* ── ما نُقل من هذه الشاشة ───────────────────────────── */}
                    <AdmCard>
                        <div style={{ fontSize: '.95rem', fontWeight: 900, color: 'var(--adm-fg)' }}>🔗 نُقل من هذه الشاشة</div>
                        <p style={{ margin: '5px 0 10px', fontSize: '.8rem', color: 'var(--adm-fg-2)', lineHeight: 1.8, maxWidth: '68ch' }}>
                            هذه الشاشة للجغرافيا وحدها — أين يسكن المشترون وكم دخلوا وحجزوا. وما كان يتكرّر هنا صار له مكانٌ واحد:
                        </p>
                        <MovedTo
                            icon="⏰"
                            what="ساعات الذروة"
                            why="«المحلل الذكي» يعرضها أغنى: ساعةً × يوماً، مع التوصية المبنيّة عليها."
                            where="المحلل الذكي"
                            onGo={() => history.push('/admin?tab=analyst')}
                        />
                        <MovedTo
                            icon="🏷"
                            what="التصنيفات الأكثر مشاهدة"
                            why="التصنيف ليس جغرافيا؛ وهو في «التحليلات» ضمن جدول تحويل التصنيفات (مشاهدة ← حجز)."
                            where="التحليلات"
                            onGo={() => history.push('/admin?tab=analytics')}
                        />
                    </AdmCard>

                    {/* ── زوّار الموقع: نطاقٌ آخر، فقسمٌ يُفتح عمداً ─────── */}
                    <AdmSection
                        title="زوّار الموقع ومصادرهم"
                        icon="🌍"
                        collapsible
                        defaultOpen={false}
                        badge={{ text: 'كل الموقع — بلا تصفية جغرافية', tone: 'info' }}
                        desc="قسمٌ بمقياسٍ مختلفٍ تماماً عمّا فوقه: يعدّ جلسات التصفّح (ومنها زوّارٌ بلا حساب)، وله فترتُه الخاصّة، ولا تصفّيه مرشِّحات المنطقة والمدينة أعلاه. بداخله: القنوات والحملات والمواقع المُحيلة والأجهزة وآخر صفحةٍ قبل المغادرة."
                    >
                        <SiteTrafficPanel />
                    </AdmSection>
                </>
            )}
        </div>
    );
};

export default AdminAudience;
