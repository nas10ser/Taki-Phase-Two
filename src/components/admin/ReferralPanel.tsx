/**
 * ReferralPanel v12.30 — «📣 الإحالات وروابط الدعوة» في تحليلات الأدمن.
 *
 * قسمان:
 *  1) «من أين سمعت عنا؟» — توزيع إجابات المسجلين الجدد (صديق/تواصل/بحث/متجر…).
 *  2) أعلى المتاجر إحالةً — كل متجر له رمز/رابط دعوة (يُنشأ من لوحة التاجر)،
 *     وكل من سجّل عبر الرابط يُنسب للمتجر تلقائياً. الترتيب بأي عدد نتائج
 *     (٤/١٠/١٠٠/١٠٠٠ أو رقم حر) وأي فترة (من/إلى أو عدد أيام) مع فلاتر
 *     المنطقة/المدينة/المول — ليختار ناصر أعلى المتاجر ويمنحهم خصومات.
 * البيانات عبر admin_referral_stats (SECURITY DEFINER + is_admin).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabaseClient';
import { REGIONS, CITIES, LOCATIONS } from '../../data/mock';

interface StoreRow { store_id: string; shop: string | null; code: string | null; refs: number; seller_refs: number; }
interface SourceRow { source: string; count: number; }
interface Stats { total_referred: number; sources: SourceRow[]; stores: StoreRow[]; }

const SOURCE_LABELS: Record<string, string> = {
    friend: '👥 صديق أو قريب',
    social: '📱 وسائل التواصل',
    search: '🔎 البحث في الإنترنت',
    store: '🏬 متجر (رابط دعوة أو ترشيح)',
    ad: '📢 إعلان',
    other: '✨ أخرى',
    unknown: '❔ غير محدد',
};

type Preset = '7' | '30' | '90' | 'all' | 'days' | 'custom';
const PRESETS: { key: Preset; label: string }[] = [
    { key: '7', label: '٧ أيام' }, { key: '30', label: '٣٠ يوماً' }, { key: '90', label: '٩٠ يوماً' },
    { key: 'all', label: 'الكل' }, { key: 'days', label: 'عدد أيام' }, { key: 'custom', label: 'من / إلى' },
];
const LIMIT_CHIPS = [4, 10, 100, 1000];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const ReferralPanel: React.FC = () => {
    const [preset, setPreset] = useState<Preset>('30');
    const [days, setDays] = useState(7);
    const [from, setFrom] = useState(isoDay(new Date(Date.now() - 29 * 864e5)));
    const [to, setTo] = useState(isoDay(new Date()));
    const [limit, setLimit] = useState(10);
    const [region, setRegion] = useState('');
    const [city, setCity] = useState('');
    const [locationId, setLocationId] = useState('');
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    const range = useMemo((): { from: string | null; to: string | null } => {
        if (preset === 'all') return { from: null, to: null };
        if (preset === 'days') return { from: new Date(Date.now() - Math.max(1, days) * 864e5).toISOString(), to: null };
        if (preset === 'custom') return {
            from: new Date(from + 'T00:00:00').toISOString(),
            to: new Date(new Date(to + 'T00:00:00').getTime() + 864e5).toISOString(),   // شامل يوم «إلى»
        };
        return { from: new Date(Date.now() - Number(preset) * 864e5).toISOString(), to: null };
    }, [preset, days, from, to]);

    const load = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.rpc('admin_referral_stats', {
            p_from: range.from,
            p_to: range.to,
            p_limit: Math.max(1, Math.min(limit || 10, 2000)),
            p_region: region || null,
            p_city: city || null,
            p_location: locationId || null,
        });
        if (!error && data) setStats(data as unknown as Stats);
        setLoading(false);
    }, [range, limit, region, city, locationId]);
    useEffect(() => { load(); }, [load]);

    const cities = useMemo(() => CITIES.filter(c => !region || c.regionId === region), [region]);
    const malls = useMemo(() => LOCATIONS.filter(l => !city || l.cityId === city), [city]);
    const maxSource = stats && stats.sources.length > 0 ? Math.max(...stats.sources.map(s => s.count)) : 0;

    return (
        <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-[var(--text-primary)]">📣 الإحالات — «من أين سمعت عنا؟» وروابط دعوة المتاجر</h2>
                <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map(p => (
                        <button key={p.key} onClick={() => setPreset(p.key)}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold ${preset === p.key ? 'bg-fuchsia-600 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            {preset === 'days' && (
                <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-[var(--text-secondary)]">آخر</span>
                    <input type="number" min={1} max={3650} value={days}
                        onChange={e => setDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))}
                        className="w-24 px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-center text-[var(--text-primary)]" />
                    <span className="text-xs font-bold text-[var(--text-secondary)]">يوماً</span>
                </div>
            )}
            {preset === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">من تاريخ</label>
                        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
                            className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)]" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">إلى تاريخ</label>
                        <input type="date" value={to} min={from} max={isoDay(new Date())} onChange={e => setTo(e.target.value)}
                            className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)]" />
                    </div>
                </div>
            )}

            {/* فلاتر جغرافية لقائمة المتاجر: منطقة / مدينة / مول */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                    <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">المنطقة</label>
                    <select value={region} onChange={e => { setRegion(e.target.value); setCity(''); setLocationId(''); }}
                        className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-[var(--text-primary)]">
                        <option value="">كل المناطق</option>
                        {REGIONS.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">المدينة / المحافظة</label>
                    <select value={city} onChange={e => { setCity(e.target.value); setLocationId(''); }}
                        className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-[var(--text-primary)]">
                        <option value="">كل المدن</option>
                        {cities.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">المول / السوق</label>
                    <select value={locationId} onChange={e => setLocationId(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-[var(--text-primary)]">
                        <option value="">كل المولات</option>
                        {malls.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                </div>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-bold text-[var(--text-secondary)]">أعلى</span>
                <input type="number" min={1} max={2000} value={limit}
                    onChange={e => setLimit(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
                    className="w-24 px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-center text-[var(--text-primary)]" />
                <span className="text-xs font-bold text-[var(--text-secondary)]">متجر</span>
                {LIMIT_CHIPS.map(n => (
                    <button key={n} onClick={() => setLimit(n)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold ${limit === n ? 'bg-fuchsia-600 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                        {n}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="h-28 bg-[var(--gray-100)] rounded-xl animate-pulse" />
            ) : !stats ? (
                <div className="text-sm text-[var(--gray-400)] text-center py-6">تعذّر تحميل البيانات.</div>
            ) : (
                <>
                    {/* 1) من أين سمعوا عنا؟ */}
                    <div>
                        <h3 className="text-sm font-extrabold text-[var(--text-primary)] mb-1.5">🗣 من أين سمع المسجلون الجدد عن تاكي؟ (في الفترة المحددة)</h3>
                        {stats.sources.length === 0 ? (
                            <div className="text-xs text-[var(--gray-400)] py-3 text-center">لا توجد إجابات بعد — تظهر مع التسجيلات الجديدة.</div>
                        ) : (
                            <div className="space-y-1.5">
                                {stats.sources.map(s => (
                                    <div key={s.source} className="flex items-center gap-2 text-xs font-bold">
                                        <span className="w-44 shrink-0 text-[var(--text-primary)]">{SOURCE_LABELS[s.source] || s.source}</span>
                                        <div className="flex-1 h-3 rounded-full overflow-hidden bg-[var(--gray-100)]">
                                            <div style={{ width: `${maxSource > 0 ? Math.max(4, Math.round((s.count / maxSource) * 100)) : 0}%`, background: '#c026d3', height: '100%', transition: 'width .4s' }} />
                                        </div>
                                        <span className="w-10 shrink-0 text-left font-black text-[var(--text-primary)]">{s.count.toLocaleString('ar-SA')}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* 2) أعلى المتاجر إحالةً */}
                    <div>
                        <h3 className="text-sm font-extrabold text-[var(--text-primary)] mt-2 mb-1.5">
                            🔗 أعلى المتاجر في رابط الدعوة (أحال {Number(stats.total_referred || 0).toLocaleString('ar-SA')} مسجلاً إجمالاً)
                        </h3>
                        {stats.stores.length === 0 ? (
                            <div className="text-xs text-[var(--gray-400)] py-3 text-center">
                                لا إحالات في هذه الفترة/الفلاتر — رابط الدعوة يظهر للتاجر في لوحته «رابط دعوة عملائك».
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead><tr className="text-[var(--text-secondary)]">
                                        <th className="text-right py-1.5 px-2 font-extrabold">#</th>
                                        <th className="text-right py-1.5 px-2 font-extrabold">المتجر</th>
                                        <th className="text-right py-1.5 px-2 font-extrabold">رمز الدعوة</th>
                                        <th className="text-right py-1.5 px-2 font-extrabold">مسجّلون عبره</th>
                                    </tr></thead>
                                    <tbody>
                                        {stats.stores.map((s, i) => (
                                            <tr key={s.store_id} className="border-t border-[var(--border-color)] font-bold text-[var(--text-primary)]">
                                                <td className="py-1.5 px-2 text-[var(--text-secondary)]">{i + 1}</td>
                                                <td className="py-1.5 px-2">{i < 3 ? ['🥇', '🥈', '🥉'][i] + ' ' : ''}{s.shop || s.store_id}</td>
                                                <td className="py-1.5 px-2 font-mono" dir="ltr">{s.code || '—'}</td>
                                                <td className="py-1.5 px-2 font-black text-fuchsia-600">{s.refs.toLocaleString('ar-SA')}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                        <p className="text-[10px] text-[var(--text-secondary)] font-bold mt-2">
                            💡 اختر الفترة والمنطقة/المدينة/المول ثم كافئ أعلى المتاجر بخصومات أو عروض — أو اسحب عليهم من «المسابقات ← سحب مخصص».
                        </p>
                    </div>
                </>
            )}
        </div>
    );
};
