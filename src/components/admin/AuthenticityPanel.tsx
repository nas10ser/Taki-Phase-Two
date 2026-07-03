/**
 * AuthenticityPanel v12.17 — «🔵🟡 مصداقية العروض» في تحليلات الأدمن.
 *
 * النسبة العامة لتصويت المشترين «حقيقي/وهمي» مع تواريخ مرنة (٧/٣٠/٩٠/سنة/الكل
 * + فترة مخصصة من/إلى) لدراسة الحالات: أكثر العروض والمتاجر المُبلَّغ عنها وهمياً.
 * الألوان: 🔵 أزرق = حقيقي، 🟡 كهرماني = وهمي (قرار ناصر — ليست أخضر/أحمر).
 * البيانات عبر admin_authenticity_stats (SECURITY DEFINER — تصويتات الجدول
 * محجوبة بسياسة «صاحب الصوت فقط»، فالأدمن يمرّ عبر الدالة).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabaseClient';

interface CaseRow { deal_id?: string; store_id: string; shop: string | null; item_name?: string | null; deal_status?: string | null; votes: number; real: number; fake: number; }
interface Stats { total: number; real: number; fake: number; deals: CaseRow[]; stores: CaseRow[]; }

const REAL_C = '#3b82f6';   // 🔵 حقيقي
const FAKE_C = '#f59e0b';   // 🟡 وهمي

type Preset = '7' | '30' | '90' | '365' | 'all' | 'custom';
const PRESETS: { key: Preset; label: string }[] = [
    { key: '7', label: '٧ أيام' }, { key: '30', label: '٣٠ يوماً' }, { key: '90', label: '٩٠ يوماً' },
    { key: '365', label: 'سنة' }, { key: 'all', label: 'الكل' }, { key: 'custom', label: 'مخصص' },
];

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const pct = (part: number, total: number) => (total > 0 ? Math.round((part / total) * 100) : 0);

export const AuthenticityPanel: React.FC = () => {
    const [preset, setPreset] = useState<Preset>('30');
    const [from, setFrom] = useState(isoDate(new Date(Date.now() - 29 * 864e5)));
    const [to, setTo] = useState(isoDate(new Date()));
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
        const { data, error } = await supabase.rpc('admin_authenticity_stats', { p_from: range.from, p_to: range.to });
        if (!error && data) setStats(data as unknown as Stats);
        setLoading(false);
    }, [range]);
    useEffect(() => { load(); }, [load]);

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
                            <div className="text-[10px] font-bold" style={{ color: '#b45309' }}>🟡 وهمي</div>
                            <div className="text-lg font-black" style={{ color: '#b45309' }}>{fakePct}٪ <span className="text-[11px] font-bold">({stats.fake.toLocaleString('ar-SA')})</span></div>
                        </div>
                    </div>
                    <div className="h-3 rounded-full overflow-hidden flex" style={{ background: 'var(--gray-100)' }}>
                        <div style={{ width: `${realPct}%`, background: REAL_C, transition: 'width .4s' }} />
                        <div style={{ width: `${fakePct}%`, background: FAKE_C, transition: 'width .4s' }} />
                    </div>

                    {/* حالات للدراسة — عروض */}
                    {stats.deals.length > 0 && (
                        <div>
                            <h3 className="text-sm font-extrabold text-[var(--text-primary)] mt-2 mb-1.5">🔍 حالات للدراسة — أكثر العروض تصويتاً «وهمي»</h3>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead><tr className="text-[var(--text-secondary)]">
                                        <th className="text-right py-1.5 px-2 font-extrabold">العرض</th>
                                        <th className="text-right py-1.5 px-2 font-extrabold">المتجر</th>
                                        <th className="text-right py-1.5 px-2 font-extrabold">🔵</th>
                                        <th className="text-right py-1.5 px-2 font-extrabold">🟡</th>
                                        <th className="text-right py-1.5 px-2 font-extrabold">نسبة الوهمي</th>
                                    </tr></thead>
                                    <tbody>
                                        {stats.deals.map(d => {
                                            const fp = pct(d.fake, d.votes);
                                            return (
                                                <tr key={d.deal_id} className="border-t border-[var(--border-color)] font-bold text-[var(--text-primary)]">
                                                    <td className="py-1.5 px-2">{d.item_name || d.deal_id}{d.deal_status && d.deal_status !== 'active' ? ' (موقوف)' : ''}</td>
                                                    <td className="py-1.5 px-2">{d.shop || d.store_id}</td>
                                                    <td className="py-1.5 px-2" style={{ color: REAL_C }}>{d.real}</td>
                                                    <td className="py-1.5 px-2" style={{ color: '#b45309' }}>{d.fake}</td>
                                                    <td className="py-1.5 px-2 font-black" style={{ color: fp >= 50 ? '#ef4444' : fp >= 25 ? '#b45309' : 'var(--text-secondary)' }}>{fp}٪</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* حالات للدراسة — متاجر */}
                    {stats.stores.length > 0 && (
                        <div>
                            <h3 className="text-sm font-extrabold text-[var(--text-primary)] mt-2 mb-1.5">🏬 على مستوى المتاجر</h3>
                            <div className="flex flex-col gap-1.5">
                                {stats.stores.map(s => {
                                    const fp = pct(s.fake, s.votes);
                                    return (
                                        <div key={s.store_id} className="flex items-center gap-2 text-xs font-bold border border-[var(--border-color)] rounded-xl px-3 py-2">
                                            <span className="flex-1 text-[var(--text-primary)] truncate">{s.shop || s.store_id}</span>
                                            <span style={{ color: REAL_C }}>🔵 {s.real}</span>
                                            <span style={{ color: '#b45309' }}>🟡 {s.fake}</span>
                                            <span className="font-black" style={{ color: fp >= 50 ? '#ef4444' : 'var(--text-secondary)' }}>{fp}٪ وهمي</span>
                                        </div>
                                    );
                                })}
                            </div>
                            <p className="text-[10px] text-[var(--text-secondary)] font-bold mt-2">
                                💡 نسبة وهمي مرتفعة = مؤشر «تخفيض مضلِّل» — افتح المتجر من تبويب البائعين للتحقيق أو الإيقاف.
                            </p>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};
