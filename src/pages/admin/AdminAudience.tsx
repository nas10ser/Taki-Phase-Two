import React, { useEffect, useMemo, useState } from 'react';
import { adminService } from '../../services/adminService';
import { REGIONS, CITIES, LOCATIONS, CATEGORIES } from '../../data/mock';

/**
 * v12.52 — «👥 جمهور المدن» ج٢ (طلب ناصر): أرقام واضحة بلا خرائط —
 * حُذفت خريطة التتبع نهائياً احتراماً لخصوصية المستخدمين.
 *  - المناطق الـ١٣ كلها بأعداد المسجلين والمتفاعلين (اضغط منطقة لتصفيتها).
 *  - المدن: مسجلون + متفاعلون + اليوم/أمس — والمنتقل من مدينة لأخرى يُحسب
 *    على آخر مدينة عُرف فيها (الدمام ← الخبر = الخبر).
 *  - يوم محدد + مدى ساعات بتوقيت الرياض + منطقة/مدينة/سوق محدد بنطاق كم.
 *  - تفصيل الحجوزات: مكتمل / نشط / ملغى (مشتري / تاجر / انتهاء الوقت).
 *  - ساعات الذروة (٢٤ ساعة) للنطاق المحدد.
 * المصدر: RPC admin_geo_insights v2 (أدمن فقط) — لا تُرجع أي إحداثيات أفراد.
 * هذا التبويب يحلل «المشترين» — المحلل الذكي يحلل «التجار والسوق».
 */

type Geo = any;

const arNum = (n: number | null | undefined) => (Number(n) || 0).toLocaleString('ar-SA');
const cityName = (id: string | null) => CITIES.find(c => c.id === id)?.name || id || '—';
const regionName = (id: string | null) => REGIONS.find(r => r.id === id)?.name || id || '—';
const catName = (id: string) => {
    const c = CATEGORIES.find(x => x.id === id);
    return c ? `${c.emoji} ${c.ar}` : id;
};
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

/** شريط أعمدة SVG بسيط (بلا مكتبات) — نفس روح SellerAnalytics. */
const DailyBars: React.FC<{ rows: Array<{ d: string; actives: number; bookers: number }> }> = ({ rows }) => {
    const max = Math.max(1, ...rows.map(r => r.actives));
    const W = 700, H = 160, pad = 4;
    const bw = Math.max(6, (W - pad * 2) / Math.max(1, rows.length) - 4);
    return (
        <div className="overflow-x-auto" dir="ltr">
            <svg viewBox={`0 0 ${W} ${H + 24}`} className="w-full min-w-[320px]" style={{ maxHeight: 200 }}>
                {rows.map((r, i) => {
                    const x = pad + i * ((W - pad * 2) / Math.max(1, rows.length));
                    const hA = Math.round((r.actives / max) * H);
                    const hB = Math.round((r.bookers / max) * H);
                    const day = r.d.slice(8, 10);
                    return (
                        <g key={r.d}>
                            <rect x={x} y={H - hA} width={bw} height={Math.max(hA, r.actives > 0 ? 3 : 0)} rx={3} fill="#0d9488" opacity={0.85} />
                            <rect x={x + bw * 0.25} y={H - hB} width={bw * 0.5} height={Math.max(hB, r.bookers > 0 ? 3 : 0)} rx={2} fill="#f59e0b" />
                            <text x={x + bw / 2} y={H + 14} textAnchor="middle" fontSize={9} fill="var(--text-secondary)" fontWeight={700}>{day}</text>
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

/** أعمدة ساعات الذروة (٢٤ ساعة) — أعلى ساعة تتلوّن ذهبياً. */
const HourBars: React.FC<{ rows: Array<{ hr: number; opens: number }> }> = ({ rows }) => {
    const max = Math.max(1, ...rows.map(r => r.opens));
    const top = rows.reduce((b, r) => (r.opens > b.opens ? r : b), { hr: -1, opens: -1 });
    const W = 700, H = 120, pad = 4;
    const bw = Math.max(5, (W - pad * 2) / 24 - 3);
    return (
        <div className="overflow-x-auto" dir="ltr">
            <svg viewBox={`0 0 ${W} ${H + 26}`} className="w-full min-w-[420px]" style={{ maxHeight: 170 }}>
                {rows.map((r) => {
                    const x = pad + r.hr * ((W - pad * 2) / 24);
                    const h = Math.round((r.opens / max) * H);
                    const isTop = r.hr === top.hr && r.opens > 0;
                    return (
                        <g key={r.hr}>
                            <rect x={x} y={H - h} width={bw} height={Math.max(h, r.opens > 0 ? 3 : 1)} rx={2}
                                fill={isTop ? '#f59e0b' : '#0d9488'} opacity={r.opens > 0 ? 0.9 : 0.18} />
                            {r.hr % 3 === 0 && (
                                <text x={x + bw / 2} y={H + 14} textAnchor="middle" fontSize={8.5} fill="var(--text-secondary)" fontWeight={700}>{hourLabel(r.hr)}</text>
                            )}
                        </g>
                    );
                })}
            </svg>
        </div>
    );
};

const SRC_META: Record<string, { emoji: string; ar: string }> = {
    web: { emoji: '🌐', ar: 'الموقع / التطبيق' },
    telegram: { emoji: '✈️', ar: 'بوت تيليجرام' },
    whatsapp: { emoji: '💬', ar: 'بوت واتساب' },
};

const AdminAudience: React.FC = () => {
    const [days, setDays] = useState(7);
    const [onDate, setOnDate] = useState('');        // يوم محدد — يطغى على الفترة
    const [hourFrom, setHourFrom] = useState(-1);    // -1 = كل الساعات
    const [hourTo, setHourTo] = useState(-1);
    const [region, setRegion] = useState('');
    const [city, setCity] = useState('');
    const [mall, setMall] = useState('');            // سوق/مول محدد (نطاق كم حوله)
    const [radiusKm, setRadiusKm] = useState(10);
    const [data, setData] = useState<Geo | null>(null);
    const [loading, setLoading] = useState(true);

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
        }).then(d => { if (alive) { setData(d); setLoading(false); } });
        return () => { alive = false; };
    }, [days, onDate, hourFrom, hourTo, hoursOn, region, city, mallObj, radiusKm]);

    const t = data?.totals || {};
    const daily: Array<any> = data?.daily || [];
    const hours: Array<any> = data?.hours || [];
    const regions: Array<any> = data?.regions || [];
    const sources: Array<any> = data?.sources || [];
    const cats: Array<any> = data?.cats || [];
    const cities: Array<any> = data?.cities || [];

    const todayDelta = deltaPct(Number(t.actives_today) || 0, Number(t.actives_yday) || 0);
    const conv = (Number(t.actives) || 0) > 0 ? Math.round(((Number(t.bookers) || 0) / Number(t.actives)) * 100) : 0;
    const catTotal = Math.max(1, cats.reduce((s, c) => s + (Number(c.views) || 0), 0));
    const bigDrop = !onDate && todayDelta !== null && todayDelta <= -40;
    const topHour = hours.reduce((b: any, r: any) => ((r.opens || 0) > (b?.opens || 0) ? r : b), null);

    // المسجلون داخل النطاق المختار (مدينة > منطقة > الكل)
    const scopeRegistered = city
        ? Number(cities.find(c => c.city === city)?.registered) || 0
        : region
            ? Number(regions.find(r => r.region === region)?.registered) || 0
            : Number(t.total_users) || 0;

    // نضمن ظهور المناطق الـ١٣ كلها حتى الصفرية
    const regions13 = useMemo(() => REGIONS.map(r => {
        const row = regions.find(x => x.region === r.id) || {};
        return { id: r.id, name: r.name, registered: Number(row.registered) || 0, actives: Number(row.actives) || 0, buyers: Number(row.buyers) || 0, sellers: Number(row.sellers) || 0 };
    }), [regions]);

    const periodLabel = onDate
        ? `يوم ${onDate}${hoursOn ? ` (${hourLabel(hourFrom)} → ${hourLabel(hourTo)})` : ''}`
        : `${days === 1 ? 'اليوم' : `آخر ${days} يوم`}${hoursOn ? ` (${hourLabel(hourFrom)} → ${hourLabel(hourTo)})` : ''}`;

    return (
        <div className="space-y-4 font-tajawal" dir="rtl">
            <div>
                <h2 className="text-xl font-extrabold text-[var(--text-primary)]">👥 جمهور المدن — أعداد المشترين وتفاعلهم</h2>
                <p className="text-xs text-[var(--text-secondary)] font-bold mt-1 leading-relaxed">
                    هذا التبويب عن <b>المشترين</b>: كم مسجّلاً في كل منطقة ومدينة، كم دخلوا، متى ذروتهم، وماذا فعلوا —
                    أرقام فقط <b>بلا خرائط تتبّع</b> احتراماً للخصوصية. (تحليل التجار والسوق في «المحلل الذكي»).
                </p>
            </div>

            {/* التحكم الكامل: الفترة/اليوم + الساعات + المكان */}
            <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)] space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                    {[1, 7, 14, 30].map(d => (
                        <button key={d} onClick={() => { setDays(d); setOnDate(''); }}
                            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border ${!onDate && days === d ? 'bg-teal-600 text-white border-teal-600' : 'bg-[var(--body-bg)] text-[var(--text-primary)] border-[var(--border-color)]'}`}>
                            {d === 1 ? 'اليوم' : `آخر ${d} يوم`}
                        </button>
                    ))}
                    <label className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-extrabold cursor-pointer ${onDate ? 'bg-teal-600 text-white border-teal-600' : 'bg-[var(--body-bg)] text-[var(--text-primary)] border-[var(--border-color)]'}`}>
                        📅 يوم محدد
                        <input type="date" value={onDate} onChange={e => setOnDate(e.target.value)}
                            className="bg-transparent text-inherit font-bold text-[11px] outline-none" style={{ colorScheme: 'auto' }} />
                        {onDate && <button onClick={(ev) => { ev.preventDefault(); setOnDate(''); }} className="font-black">✕</button>}
                    </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <select value={hourFrom} onChange={e => { const v = Number(e.target.value); setHourFrom(v); if (v >= 0 && hourTo < 0) setHourTo(23); if (v < 0) setHourTo(-1); }}
                        className="px-2 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--body-bg)] text-xs font-bold text-[var(--text-primary)]">
                        <option value={-1}>🕐 كل الساعات</option>
                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>من {hourLabel(h)}</option>)}
                    </select>
                    <select value={hourTo} disabled={hourFrom < 0} onChange={e => setHourTo(Number(e.target.value))}
                        className="px-2 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--body-bg)] text-xs font-bold text-[var(--text-primary)] disabled:opacity-50">
                        <option value={-1}>—</option>
                        {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>إلى {hourLabel(h)}</option>)}
                    </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <select value={region} onChange={e => { setRegion(e.target.value); setCity(''); setMall(''); }}
                        className="px-2 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--body-bg)] text-xs font-bold text-[var(--text-primary)]">
                        <option value="">🌍 كل المناطق (١٣)</option>
                        {REGIONS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <select value={city} onChange={e => { setCity(e.target.value); setMall(''); }}
                        className="px-2 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--body-bg)] text-xs font-bold text-[var(--text-primary)]">
                        <option value="">🏙 كل المدن</option>
                        {regionCities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                {city && cityMalls.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                        <select value={mall} onChange={e => setMall(e.target.value)}
                            className="flex-1 min-w-[160px] px-2 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--body-bg)] text-xs font-bold text-[var(--text-primary)]">
                            <option value="">🏬 المدينة كاملة (بدون سوق محدد)</option>
                            {cityMalls.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                        {mall && (
                            <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-bold text-[var(--text-secondary)]">نطاق</span>
                                <input type="number" min={1} max={100} value={radiusKm}
                                    onChange={e => setRadiusKm(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                                    className="w-16 px-2 py-1 rounded-lg border border-[var(--border-color)] bg-[var(--body-bg)] text-xs font-bold text-center text-[var(--text-primary)]" />
                                <span className="text-[10px] font-bold text-[var(--text-secondary)]">كم حول السوق</span>
                            </div>
                        )}
                    </div>
                )}
                <div className="text-[10px] font-bold text-teal-700">🎯 يعرض الآن: {periodLabel} • {mallObj ? `${mallObj.name} (${radiusKm} كم)` : city ? cityName(city) : region ? regionName(region) : 'كل السعودية'}</div>
            </div>

            {loading ? (
                <div className="text-center py-14 text-sm font-extrabold text-[var(--text-secondary)]">⏳ جاري تحليل الجمهور...</div>
            ) : !data ? (
                <div className="text-center py-14 text-sm font-extrabold text-red-600">❌ تعذّر جلب البيانات — أعد المحاولة</div>
            ) : (
                <>
                    {/* إنذار الهبوط */}
                    {bigDrop && (
                        <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-3 text-sm font-extrabold text-red-700">
                            🚨 هبوط حاد: دخل اليوم {arNum(t.actives_today)} مقابل {arNum(t.actives_yday)} أمس ({todayDelta}٪) — تحقق من الخدمة أو أطلق حملة.
                        </div>
                    )}

                    {/* الأرقام الرئيسية — بلغة بسيطة */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)] text-center">
                            <div className="text-2xl font-black text-[var(--text-primary)]">{arNum(scopeRegistered)}</div>
                            <div className="text-[10px] font-extrabold text-[var(--text-secondary)] mt-0.5">🪪 مسجّلون في هذا النطاق</div>
                        </div>
                        <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)] text-center">
                            <div className="text-2xl font-black text-teal-700">{arNum(t.actives)}</div>
                            <div className="text-[10px] font-extrabold text-[var(--text-secondary)] mt-0.5">👥 دخلوا فعلاً في الفترة المحددة</div>
                        </div>
                        <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)] text-center">
                            <div className="text-2xl font-black text-indigo-600">{arNum(t.new_users)}</div>
                            <div className="text-[10px] font-extrabold text-[var(--text-secondary)] mt-0.5">🆕 سجّلوا جديداً في الفترة</div>
                        </div>
                        <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)] text-center">
                            <div className="text-2xl font-black text-amber-600">{arNum(t.bookers)}</div>
                            <div className="text-[10px] font-extrabold text-[var(--text-secondary)] mt-0.5">🎟 أشخاص حجزوا</div>
                        </div>
                        <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)] text-center">
                            <div className="text-2xl font-black text-[var(--text-primary)]">{arNum(t.bookings)}</div>
                            <div className="text-[10px] font-extrabold text-[var(--text-secondary)] mt-0.5">📦 إجمالي الحجوزات</div>
                        </div>
                        <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)] text-center">
                            <div className={`text-2xl font-black ${conv < 10 ? 'text-red-600' : 'text-emerald-600'}`}>{conv}٪</div>
                            <div className="text-[10px] font-extrabold text-[var(--text-secondary)] mt-0.5">🔁 من دخلوا وانتهوا بحجز</div>
                        </div>
                    </div>

                    {/* تفصيل الحجوزات: من أنجز ومن ألغى؟ */}
                    <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)]">
                        <div className="text-sm font-extrabold text-[var(--text-primary)] mb-2">📦 ماذا حدث للحجوزات في هذه الفترة؟</div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                            <div className="bg-emerald-500/10 rounded-xl p-2.5">
                                <div className="text-lg font-black text-emerald-600">{arNum(t.bk_completed)}</div>
                                <div className="text-[10px] font-extrabold text-[var(--text-secondary)]">✅ استُلمت (مكتملة)</div>
                            </div>
                            <div className="bg-sky-500/10 rounded-xl p-2.5">
                                <div className="text-lg font-black text-sky-600">{arNum(t.bk_active)}</div>
                                <div className="text-[10px] font-extrabold text-[var(--text-secondary)]">⏳ ما زالت قائمة</div>
                            </div>
                            <div className="bg-red-500/10 rounded-xl p-2.5">
                                <div className="text-lg font-black text-red-600">{arNum(t.bk_cancelled)}</div>
                                <div className="text-[10px] font-extrabold text-[var(--text-secondary)]">🚫 أُلغيت</div>
                            </div>
                        </div>
                        {Number(t.bk_cancelled) > 0 && (
                            <div className="flex gap-2 mt-2 text-[10px] font-extrabold text-[var(--text-secondary)] flex-wrap">
                                <span className="px-2 py-1 rounded-full bg-[var(--body-bg)] border border-[var(--border-color)]">🛍 ألغاها المشتري: {arNum(t.bk_c_buyer)}</span>
                                <span className="px-2 py-1 rounded-full bg-[var(--body-bg)] border border-[var(--border-color)]">🏪 ألغاها التاجر: {arNum(t.bk_c_seller)}</span>
                                <span className="px-2 py-1 rounded-full bg-[var(--body-bg)] border border-[var(--border-color)]">⏰ انتهى وقتها تلقائياً: {arNum(t.bk_c_system)}</span>
                            </div>
                        )}
                    </div>

                    {/* المناطق الـ١٣ — أرقام لا خرائط */}
                    <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)]">
                        <div className="text-sm font-extrabold text-[var(--text-primary)] mb-1">🗺 المناطق الـ١٣ — كم مسجّلاً في كل منطقة؟</div>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] mb-2">اضغط أي منطقة لتصفية كل الأرقام عليها. «مسجّل» = آخر موقع معروف له داخل المنطقة.</p>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {regions13.map(r => (
                                <button key={r.id} onClick={() => { setRegion(region === r.id ? '' : r.id); setCity(''); setMall(''); }}
                                    className={`text-right rounded-xl p-2.5 border transition-all ${region === r.id ? 'border-teal-600 bg-teal-600/10 shadow' : 'border-[var(--border-color)] bg-[var(--body-bg)] hover:shadow'}`}>
                                    <div className="text-[11px] font-extrabold text-[var(--text-primary)] truncate">{r.name}</div>
                                    <div className="flex items-baseline gap-2 mt-1">
                                        <span className="text-lg font-black text-teal-700">{arNum(r.registered)}</span>
                                        <span className="text-[9px] font-bold text-[var(--text-secondary)]">مسجّل</span>
                                        <span className="text-xs font-black text-amber-600 mr-auto">{arNum(r.actives)}</span>
                                        <span className="text-[9px] font-bold text-[var(--text-secondary)]">نشِط</span>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ساعات الذروة */}
                    <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)]">
                        <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
                            <div className="text-sm font-extrabold text-[var(--text-primary)]">⏰ ساعات الذروة {city ? `في ${cityName(city)}` : region ? `في ${regionName(region)}` : ''}</div>
                            {topHour && topHour.opens > 0 && (
                                <span className="text-[10px] font-black text-amber-600 bg-amber-500/10 px-2 py-1 rounded-full">🔥 الذروة: {hourLabel(topHour.hr)} ({arNum(topHour.opens)} دخول)</span>
                            )}
                        </div>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] mb-2">كل عمود = عدد مرات الدخول في تلك الساعة (بتوقيت الرياض) خلال الفترة المحددة.</p>
                        <HourBars rows={hours} />
                    </div>

                    {/* الرسم اليومي */}
                    <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)]">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-extrabold text-[var(--text-primary)]">📈 التفاعل اليومي</div>
                            <div className="text-[10px] font-bold text-[var(--text-secondary)]">
                                <span className="inline-block w-2.5 h-2.5 rounded-sm ml-1" style={{ background: '#0d9488' }} /> دخلوا
                                <span className="inline-block w-2.5 h-2.5 rounded-sm mr-2 ml-1" style={{ background: '#f59e0b' }} /> حجزوا
                            </div>
                        </div>
                        <DailyBars rows={daily} />
                    </div>

                    {/* المصادر */}
                    <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)]">
                        <div className="text-sm font-extrabold text-[var(--text-primary)] mb-2">📡 من أين يدخلون؟</div>
                        <div className="grid grid-cols-3 gap-2">
                            {['web', 'telegram', 'whatsapp'].map(src => {
                                const s = sources.find(x => x.source === src) || { users: 0, opens: 0, bookings: 0 };
                                return (
                                    <div key={src} className="bg-[var(--body-bg)] rounded-xl p-2.5 border border-[var(--border-color)] text-center">
                                        <div className="text-lg">{SRC_META[src].emoji}</div>
                                        <div className="text-[10px] font-extrabold text-[var(--text-secondary)]">{SRC_META[src].ar}</div>
                                        <div className="text-base font-black text-[var(--text-primary)] mt-1">{arNum(s.users)}</div>
                                        <div className="text-[9px] font-bold text-[var(--text-secondary)]">مستخدم • {arNum(s.bookings)} حجز</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* التصنيفات */}
                    <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)]">
                        <div className="text-sm font-extrabold text-[var(--text-primary)] mb-2">🏷 أين دخلوا؟ (أي التصنيفات شاهدوا)</div>
                        {cats.length === 0 ? (
                            <div className="text-xs font-bold text-[var(--text-secondary)] text-center py-3">لا مشاهدات منتجات مسجلة في هذه الفترة/النطاق بعد.</div>
                        ) : (
                            <div className="space-y-1.5">
                                {cats.map((c) => {
                                    const pct = Math.round(((Number(c.views) || 0) / catTotal) * 100);
                                    return (
                                        <div key={c.category} className="flex items-center gap-2">
                                            <div className="w-28 text-[11px] font-extrabold text-[var(--text-primary)] truncate">{catName(c.category)}</div>
                                            <div className="flex-1 h-3 bg-[var(--body-bg)] rounded-full overflow-hidden border border-[var(--border-color)]">
                                                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'linear-gradient(90deg,#0d9488,#14b8a6)' }} />
                                            </div>
                                            <div className="w-24 text-[11px] font-black text-teal-700 text-left" dir="ltr">{pct}٪ ({arNum(c.viewers)} شخص)</div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* المدن */}
                    <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)]">
                        <div className="text-sm font-extrabold text-[var(--text-primary)] mb-1">🏙 المدن — مسجّلون ونشاط</div>
                        <p className="text-[10px] font-bold text-[var(--text-secondary)] mb-2">
                            المنتقل بين المدن يُحسب على <b>آخر مدينة</b> عُرف فيها (كان في الدمام وصار في الخبر ← يُحسب على الخبر).
                        </p>
                        {cities.length === 0 ? (
                            <div className="text-xs font-bold text-[var(--text-secondary)] text-center py-3">
                                لا مستخدمين بموقع معروف تفاعلوا في هذه الفترة — كلما شارك المتسوقون مواقعهم امتلأ هذا الجدول.
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-[11px]">
                                    <thead>
                                        <tr className="text-[var(--text-secondary)] font-extrabold">
                                            <th className="text-right py-1.5">المدينة</th>
                                            <th className="text-center py-1.5">مسجّلون</th>
                                            <th className="text-center py-1.5">دخلوا في الفترة</th>
                                            <th className="text-center py-1.5">اليوم</th>
                                            <th className="text-center py-1.5">أمس</th>
                                            <th className="text-center py-1.5">التغيّر</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {cities.map((c) => {
                                            const dl = deltaPct(Number(c.today) || 0, Number(c.yesterday) || 0);
                                            return (
                                                <tr key={c.city} className="border-t border-[var(--border-color)] font-bold text-[var(--text-primary)]">
                                                    <td className="py-1.5">
                                                        <button onClick={() => { setRegion(c.region || ''); setCity(c.city); setMall(''); }} className="font-extrabold text-teal-700 hover:underline">
                                                            {cityName(c.city)}
                                                        </button>
                                                        {' '}<span className="text-[9px] text-[var(--text-secondary)]">({regionName(c.region)})</span>
                                                    </td>
                                                    <td className="text-center">{arNum(c.registered)}</td>
                                                    <td className="text-center">{arNum(c.actives)}</td>
                                                    <td className="text-center">{arNum(c.today)}</td>
                                                    <td className="text-center">{arNum(c.yesterday)}</td>
                                                    <td className="text-center">
                                                        {dl === null ? <span className="text-[var(--text-secondary)]">—</span> : (
                                                            <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-black ${dl < 0 ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                                                {dl > 0 ? `▲${dl}٪` : dl < 0 ? `▼${Math.abs(dl)}٪` : '='}
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        <div className="text-[10px] font-bold text-[var(--text-secondary)] mt-2 leading-relaxed">
                            🔒 خصوصية: {arNum(t.located_users)} من {arNum(t.total_users)} مستخدماً شاركوا موقعهم — نعرض <b>أعداداً فقط</b>،
                            لا خرائط ولا مواقع أفراد. الجلسات تُحسب مرة كل ٣٠ دقيقة كحد أقصى لكل مستخدم.
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AdminAudience;
