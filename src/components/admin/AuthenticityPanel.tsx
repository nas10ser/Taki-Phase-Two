/**
 * AuthenticityPanel v12.30 — «🔵🟡 مصداقية العروض» في تحليلات الأدمن.
 *
 * النسبة العامة لتصويت المشترين «حقيقي/شكلي» مع تواريخ مرنة (٧/٣٠/٩٠/سنة/الكل
 * + فترة مخصصة من/إلى) + ترتيب مرن (الأعلى شكلي/حقيقي بالأصوات أو بالنسبة)
 * + عدد نتائج حر (١٠/١٠٠/١٠٠٠ أو أي رقم) مع نسبة كل عرض/متجر.
 * الألوان: 🔵 أزرق = حقيقي، 🟡 كهرماني = شكلي (قرار ناصر — ليست أخضر/أحمر).
 * البيانات عبر admin_authenticity_stats (SECURITY DEFINER — تصويتات الجدول
 * محجوبة بسياسة «صاحب الصوت فقط»، فالأدمن يمرّ عبر الدالة).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabaseClient';

interface CaseRow { deal_id?: string; store_id: string; shop: string | null; item_name?: string | null; deal_status?: string | null; votes: number; real: number; fake: number; }
interface Stats { total: number; real: number; fake: number; deals: CaseRow[]; stores: CaseRow[]; }

const REAL_C = '#3b82f6';   // 🔵 حقيقي
const FAKE_C = '#f59e0b';   // 🟡 شكلي

type Preset = '7' | '30' | '90' | '365' | 'all' | 'custom';
const PRESETS: { key: Preset; label: string }[] = [
    { key: '7', label: '٧ أيام' }, { key: '30', label: '٣٠ يوماً' }, { key: '90', label: '٩٠ يوماً' },
    { key: '365', label: 'سنة' }, { key: 'all', label: 'الكل' }, { key: 'custom', label: 'مخصص' },
];

type SortKey = 'fake' | 'real' | 'fake_pct' | 'real_pct';
const SORTS: { key: SortKey; label: string }[] = [
    { key: 'fake', label: '🟡 الأعلى شكلي (أصواتاً)' },
    { key: 'real', label: '🔵 الأعلى حقيقي (أصواتاً)' },
    { key: 'fake_pct', label: '🟡 الأعلى نسبة شكلي' },
    { key: 'real_pct', label: '🔵 الأعلى نسبة حقيقي' },
];
const LIMIT_CHIPS = [10, 50, 100, 1000];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

export const AuthenticityPanel: React.FC = () => {
    const [preset, setPreset] = useState<Preset>('30');
    const [from, setFrom] = useState(isoDate(new Date(Date.now() - 29 * 864e5)));
    const [to, setTo] = useState(isoDate(new Date()));
    const [sort, setSort] = useState<SortKey>('fake');
    const [limit, setLimit] = useState(20);
    const [stats, setStats] = useState<Stats | null>(null);
    const [loading, setLoading] = useState(true);

    const range = useMemo((): { from: string | null; to: string | null } => {
        if (preset === 'all') return { from: null, to: null };
        if (preset === 'custom') return {
            from: new Date(from + 'T00:00:00').toISOString(),
            to: new Date(new Date(to + 'T00:00:00').getTime() + 864e5).toISOString(),   // شامل يوم «إلى»
        };
        return { from: new Date(Date.now() - Number(preset) * 864e5).toISOString(), to: null };
    }, [preset, from, to]);

    const load = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.rpc('admin_authenticity_stats', {
            p_from: range.from, p_to: range.to,
            p_limit: Math.max(1, Math.min(limit || 20, 2000)),
            p_sort: sort,
        });
        if (!error && data) setStats(data as unknown as Stats);
        setLoading(false);
    }, [range, sort, limit]);
    useEffect(() => { load(); }, [load]);

    // «حقيقي» يُظهر عمود نسبة الحقيقي، و«شكلي» يُظهر نسبة الشكلي.
    const showReal = sort === 'real' || sort === 'real_pct';

    const realPct = stats ? pct(stats.real, stats.total) : 0;
    const fakePct = stats ? pct(stats.fake, stats.total) : 0;

    return (
        <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-[var(--text-primary)]">🔵🟡 مصداقية العروض (تصويت المشترين)</h2>
                <div className="flex flex-wrap gap-1.5">
                    {PRESETS.map(p => (
                        <button key={p.key} onClick={() => setPreset(p.key)}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold ${preset === p.key ? 'bg-blue-600 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            {preset === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">من تاريخ</label>
                        <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
                            className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)]" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">إلى تاريخ</label>
                        <input type="date" value={to} min={from} max={isoDate(new Date())} onChange={e => setTo(e.target.value)}
                            className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm text-[var(--text-primary)]" />
                    </div>
                </div>
            )}

            {/* v12.30 — الترتيب + عدد النتائج (أي رقم: ١٠/١٠٠/١٠٠٠…) */}
            <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[220px]">
                    <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">ترتيب القائمة</label>
                    <select value={sort} onChange={e => setSort(e.target.value as SortKey)}
                        className="w-full px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-[var(--text-primary)]">
                        {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                </div>
                <div>
                    <label className="block text-xs font-bold text-[var(--text-secondary)] mb-1.5">عدد النتائج</label>
                    <div className="flex items-center gap-1.5">
                        <input type="number" min={1} max={2000} value={limit}
                            onChange={e => setLimit(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
                            className="w-24 px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-center text-[var(--text-primary)]" />
                        {LIMIT_CHIPS.map(n => (
                            <button key={n} onClick={() => setLimit(n)}
                                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold ${limit === n ? 'bg-blue-600 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                                {n}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="h-28 bg-[var(--gray-100)] rounded-xl animate-pulse" />
            ) : !stats || stats.total === 0 ? (
                <div className="text-sm text-[var(--gray-400)] text-center py-6">لا توجد تصويتات في هذه الفترة.</div>
            ) : (
                <>
                    {/* النسبة العامة */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-xl border border-[var(--border-color)] p-3">
                            <div className="text-[10px] font-bold text-[var(--text-secondary)]">إجمالي الأصوات</div>
                            <div className="text-lg font-black text-[var(--text-primary)]">{stats.total.toLocaleString('ar-SA')}</div>
                        </div>
                        <div className="rounded-xl p-3" style={{ background: 'rgba(59,130,246,0.08)', border: `1px solid ${REAL_C}44` }}>
                            <div className="text-[10px] font-bold" style={{ color: REAL_C }}>🔵 حقيقي</div>
                            <div className="text-lg font-black" style={{ color: REAL_C }}>{realPct}٪ <span className="text-[11px] font-bold">({stats.real.toLocaleString('ar-SA')})</span></div>
                        </div>
                        <div className="rounded-xl p-3" style={{ background: 'rgba(245,158,11,0.08)', border: `1px solid ${FAKE_C}44` }}>
                            <div className="text-[10px] font-bold" style={{ color: '#b45309' }}>🟡 شكلي</div>
                            <div className="text-lg font-black" style={{ color: '#b45309' }}>{fakePct}٪ <span className="text-[11px] font-bold">({stats.fake.toLocaleString('ar-SA')})</span></div>
                        </div>
                    </div>
                    <div className="h-3 rounded-full overflow-hidden flex" style={{ background: 'var(--gray-100)' }}>
                        <div style={{ width: `${realPct}%`, background: REAL_C, transition: 'width .4s' }} />
                        <div style={{ width: `${fakePct}%`, background: FAKE_C, transition: 'width .4s' }} />
                    </div>

                    {/* الترتيب — عروض (النسبة تتبع نوع الترتيب المختار) */}
                    {stats.deals.length > 0 && (
                        <div>
                            <h3 className="text-sm font-extrabold text-[var(--text-primary)] mt-2 mb-1.5">
                                🔍 ترتيب العروض — {SORTS.find(s => s.key === sort)?.label} (أعلى {stats.deals.length})
                            </h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead><tr className="text-[var(--text-secondary)]">
                                        <th className="text-right py-1.5 px-2 font-extrabold">#</th>
                                        <th className="text-right py-1.5 px-2 font-extrabold">العرض</th>
                                        <th className="text-right py-1.5 px-2 font-extrabold">المتجر</th>
                                        <th className="text-right py-1.5 px-2 font-extrabold">🔵</th>
                                        <th className="text-right py-1.5 px-2 font-extrabold">🟡</th>
                                        <th className="text-right py-1.5 px-2 font-extrabold">{showReal ? 'نسبة الحقيقي' : 'نسبة الشكلي'}</th>
                                    </tr></thead>
                                    <tbody>
                                        {stats.deals.map((d, i) => {
                                            const p = showReal ? pct(d.real, d.votes) : pct(d.fake, d.votes);
                                            const warn = !showReal && p >= 50;
                                            return (
                                                <tr key={d.deal_id} className="border-t border-[var(--border-color)] font-bold text-[var(--text-primary)]">
                                                    <td className="py-1.5 px-2 text-[var(--text-secondary)]">{i + 1}</td>
                                                    <td className="py-1.5 px-2">{d.item_name || d.deal_id}{d.deal_status && d.deal_status !== 'active' ? ' (موقوف)' : ''}</td>
                                                    <td className="py-1.5 px-2">{d.shop || d.store_id}</td>
                                                    <td className="py-1.5 px-2" style={{ color: REAL_C }}>{d.real}</td>
                                                    <td className="py-1.5 px-2" style={{ color: '#b45309' }}>{d.fake}</td>
                                                    <td className="py-1.5 px-2 font-black" style={{ color: warn ? '#ef4444' : showReal ? REAL_C : (p >= 25 ? '#b45309' : 'var(--text-secondary)') }}>{p}٪</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* الترتيب — متاجر */}
                    {stats.stores.length > 0 && (
                        <div>
                            <h3 className="text-sm font-extrabold text-[var(--text-primary)] mt-2 mb-1.5">🏬 على مستوى المتاجر (أعلى {stats.stores.length})</h3>
                            <div className="flex flex-col gap-1.5">
                                {stats.stores.map((s, i) => {
                                    const p = showReal ? pct(s.real, s.votes) : pct(s.fake, s.votes);
                                    return (
                                        <div key={s.store_id} className="flex items-center gap-2 text-xs font-bold border border-[var(--border-color)] rounded-xl px-3 py-2">
                                            <span className="text-[var(--text-secondary)] shrink-0">{i + 1}.</span>
                                            <span className="flex-1 text-[var(--text-primary)] truncate">{s.shop || s.store_id}</span>
                                            <span style={{ color: REAL_C }}>🔵 {s.real}</span>
                                            <span style={{ color: '#b45309' }}>🟡 {s.fake}</span>
                                            <span className="font-black" style={{ color: !showReal && p >= 50 ? '#ef4444' : showReal ? REAL_C : 'var(--text-secondary)' }}>
                                                {p}٪ {showReal ? 'حقيقي' : 'شكلي'}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                            <p className="text-[10px] text-[var(--text-secondary)] font-bold mt-2">
                                💡 نسبة «شكلي» مرتفعة = مؤشر «تخفيض مضلِّل» — افتح المتجر من تبويب البائعين للتحقيق أو الإيقاف.
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
