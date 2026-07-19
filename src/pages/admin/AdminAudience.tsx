import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, useMapEvents } from 'react-leaflet';
import { adminService } from '../../services/adminService';
import { REGIONS, CITIES, CATEGORIES } from '../../data/mock';

/**
 * v12.50 — «🗺 جمهور المدن» (طلب ناصر): أين المشترون وكم يدخلون يومياً؟
 *  - خريطة بآخر موقع معروف لكل مستخدم شارك موقعه (مباشر أو مرة واحدة).
 *  - إحصاء يومي: كم دخل التطبيق، كم حجز، ونسبة التحويل — مع إنذار هبوط.
 *  - فلترة بمنطقة / مدينة / نطاق كيلومتري أحدده بنقرة على الخريطة.
 *  - المصادر: ويب / بوت تيليجرام / بوت واتساب.
 *  - نسب التصنيفات المشاهدة داخل النطاق المحدد.
 * المصدر: RPC admin_geo_insights (أدمن فقط) فوق analytics_events (جلسة
 * «فتح» كل ٣٠ دقيقة كحد أقصى) + users.lat/lng + bookings.
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

/** يلتقط نقرة الخريطة لتحديد مركز النطاق الكيلومتري. */
const RadiusPicker: React.FC<{ onPick: (lat: number, lng: number) => void }> = ({ onPick }) => {
    useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
    return null;
};

const SRC_META: Record<string, { emoji: string; ar: string }> = {
    web: { emoji: '🌐', ar: 'الموقع / التطبيق' },
    telegram: { emoji: '✈️', ar: 'بوت تيليجرام' },
    whatsapp: { emoji: '💬', ar: 'بوت واتساب' },
};

const AdminAudience: React.FC = () => {
    const [days, setDays] = useState(7);
    const [region, setRegion] = useState('');
    const [city, setCity] = useState('');
    const [radiusOn, setRadiusOn] = useState(false);
    const [radiusKm, setRadiusKm] = useState(10);
    const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
    const [data, setData] = useState<Geo | null>(null);
    const [loading, setLoading] = useState(true);

    const regionCities = useMemo(() => CITIES.filter(c => !region || c.regionId === region), [region]);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        adminService.getGeoInsights({
            days,
            region: region || null,
            city: city || null,
            lat: radiusOn && center ? center.lat : null,
            lng: radiusOn && center ? center.lng : null,
            radiusKm: radiusOn && center ? radiusKm : null,
        }).then(d => { if (alive) { setData(d); setLoading(false); } });
        return () => { alive = false; };
    }, [days, region, city, radiusOn, center, radiusKm]);

    const t = data?.totals || {};
    const daily: Array<any> = data?.daily || [];
    const sources: Array<any> = data?.sources || [];
    const cats: Array<any> = data?.cats || [];
    const cities: Array<any> = data?.cities || [];
    const points: Array<any> = data?.points || [];

    const todayDelta = deltaPct(Number(t.actives_today) || 0, Number(t.actives_yday) || 0);
    const conv = (Number(t.actives) || 0) > 0 ? Math.round(((Number(t.bookers) || 0) / Number(t.actives)) * 100) : 0;
    const catTotal = Math.max(1, cats.reduce((s, c) => s + (Number(c.views) || 0), 0));
    const bigDrop = todayDelta !== null && todayDelta <= -40;

    return (
        <div className="space-y-4 font-tajawal" dir="rtl">
            <div>
                <h2 className="text-xl font-extrabold text-[var(--text-primary)]">🗺 جمهور المدن — أماكن المشترين وتفاعلهم</h2>
                <p className="text-xs text-[var(--text-secondary)] font-bold mt-1 leading-relaxed">
                    كم شخصاً دخل يومياً، من أين، من أي قناة، وكم منهم حجز — لكل السعودية أو منطقة أو مدينة أو نطاق تحدده بنقرة على الخريطة.
                </p>
            </div>

            {/* الفلاتر */}
            <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)] space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                    {[1, 7, 14, 30].map(d => (
                        <button key={d} onClick={() => setDays(d)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-extrabold border ${days === d ? 'bg-teal-600 text-white border-teal-600' : 'bg-[var(--body-bg)] text-[var(--text-primary)] border-[var(--border-color)]'}`}>
                            {d === 1 ? 'اليوم' : `آخر ${d} يوم`}
                        </button>
                    ))}
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <select value={region} onChange={e => { setRegion(e.target.value); setCity(''); }}
                        className="px-2 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--body-bg)] text-xs font-bold text-[var(--text-primary)]">
                        <option value="">🌍 كل المناطق</option>
                        {REGIONS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                    <select value={city} onChange={e => setCity(e.target.value)}
                        className="px-2 py-2 rounded-lg border border-[var(--border-color)] bg-[var(--body-bg)] text-xs font-bold text-[var(--text-primary)]">
                        <option value="">🏙 كل المدن</option>
                        {regionCities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <label className="flex items-center gap-1.5 cursor-pointer select-none text-xs font-extrabold text-[var(--text-primary)]">
                        <input type="checkbox" checked={radiusOn} onChange={e => setRadiusOn(e.target.checked)} className="w-4 h-4 accent-teal-600" />
                        🎯 نطاق كيلومتري (انقر على الخريطة لتحديد المركز)
                    </label>
                    {radiusOn && (
                        <div className="flex items-center gap-1.5">
                            <input type="number" min={1} max={200} value={radiusKm}
                                onChange={e => setRadiusKm(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
                                className="w-16 px-2 py-1 rounded-lg border border-[var(--border-color)] bg-[var(--body-bg)] text-xs font-bold text-center text-[var(--text-primary)]" />
                            <span className="text-[10px] font-bold text-[var(--text-secondary)]">كم</span>
                            {center && <span className="text-[10px] font-bold text-teal-700">📍 {center.lat.toFixed(3)}, {center.lng.toFixed(3)}</span>}
                        </div>
                    )}
                </div>
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

                    {/* KPIs */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)] text-center">
                            <div className="text-2xl font-black text-teal-700">{arNum(t.actives)}</div>
                            <div className="text-[10px] font-extrabold text-[var(--text-secondary)] mt-0.5">👥 متفاعل خلال الفترة</div>
                        </div>
                        <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)] text-center">
                            <div className="text-2xl font-black text-[var(--text-primary)]">
                                {arNum(t.actives_today)}
                                {todayDelta !== null && (
                                    <span className={`text-xs font-black mr-1 ${todayDelta < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                                        {todayDelta > 0 ? `▲${todayDelta}٪` : todayDelta < 0 ? `▼${Math.abs(todayDelta)}٪` : '='}
                                    </span>
                                )}
                            </div>
                            <div className="text-[10px] font-extrabold text-[var(--text-secondary)] mt-0.5">📅 دخلوا اليوم (أمس: {arNum(t.actives_yday)})</div>
                        </div>
                        <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)] text-center">
                            <div className="text-2xl font-black text-amber-600">{arNum(t.bookers)}</div>
                            <div className="text-[10px] font-extrabold text-[var(--text-secondary)] mt-0.5">🎟 حجزوا ({arNum(t.bookings)} حجزاً)</div>
                        </div>
                        <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)] text-center">
                            <div className={`text-2xl font-black ${conv < 10 ? 'text-red-600' : 'text-emerald-600'}`}>{conv}٪</div>
                            <div className="text-[10px] font-extrabold text-[var(--text-secondary)] mt-0.5">🔁 نسبة التحويل دخول→حجز</div>
                        </div>
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
                        <div className="text-sm font-extrabold text-[var(--text-primary)] mb-2">🏷 أي التصنيفات يشاهدون؟ (٪ من مشاهدات المنتجات)</div>
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
                                            <div className="w-14 text-[11px] font-black text-teal-700 text-left" dir="ltr">{pct}٪ ({arNum(c.views)})</div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* المدن */}
                    <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)]">
                        <div className="text-sm font-extrabold text-[var(--text-primary)] mb-2">🏙 المدن الأنشط (اليوم مقابل أمس)</div>
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
                                            <th className="text-center py-1.5">متفاعلون</th>
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
                                                    <td className="py-1.5">{cityName(c.city)} <span className="text-[9px] text-[var(--text-secondary)]">({regionName(c.region)})</span></td>
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
                    </div>

                    {/* الخريطة */}
                    <div className="bg-[var(--card-bg)] rounded-2xl p-3 border border-[var(--border-color)]">
                        <div className="flex items-center justify-between mb-2">
                            <div className="text-sm font-extrabold text-[var(--text-primary)]">📍 خريطة المستخدمين (آخر موقع معروف)</div>
                            <div className="text-[10px] font-bold text-[var(--text-secondary)]">
                                {arNum(t.located_users)} من {arNum(t.total_users)} مستخدماً شاركوا موقعهم
                            </div>
                        </div>
                        <div style={{ height: 380, borderRadius: 16, overflow: 'hidden' }}>
                            <MapContainer center={[24.7136, 46.6753]} zoom={5} attributionControl={false} style={{ height: '100%', width: '100%' }}>
                                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                {radiusOn && <RadiusPicker onPick={(lat, lng) => setCenter({ lat, lng })} />}
                                {radiusOn && center && (
                                    <Circle center={[center.lat, center.lng]} radius={radiusKm * 1000}
                                        pathOptions={{ color: '#0d9488', fillColor: '#0d9488', fillOpacity: 0.08 }} />
                                )}
                                {points.map((p) => (
                                    <CircleMarker
                                        key={p.id}
                                        center={[p.lat, p.lng]}
                                        radius={7}
                                        pathOptions={{
                                            color: p.type === 'seller' ? '#f59e0b' : p.type === 'admin' ? '#8b5cf6' : '#0d9488',
                                            fillOpacity: 0.75, weight: 2,
                                        }}
                                    >
                                        <Popup>
                                            <div style={{ fontFamily: 'inherit', fontWeight: 700, fontSize: 12, direction: 'rtl' }}>
                                                {p.type === 'seller' ? '🏪' : p.type === 'admin' ? '🛡' : '🛍'} {p.name || 'مستخدم'}
                                                <br />المدينة: {cityName(p.city)}
                                                {p.last_seen && <><br />آخر نشاط: {new Date(p.last_seen).toLocaleString('ar-SA')}</>}
                                            </div>
                                        </Popup>
                                    </CircleMarker>
                                ))}
                            </MapContainer>
                        </div>
                        <div className="text-[10px] font-bold text-[var(--text-secondary)] mt-2 leading-relaxed">
                            🛍 مشترٍ • 🏪 تاجر • 🛡 إدارة — النقطة تعكس آخر موقع شاركه المستخدم (مباشر أو لمرة واحدة).
                            الجلسات تُحسب مرة كل ٣٠ دقيقة كحد أقصى لكل مستخدم، والزوار بلا حساب يُحصون في الإجمالي بلا موقع.
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

export default AdminAudience;
