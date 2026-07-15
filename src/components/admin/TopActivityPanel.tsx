/**
 * TopActivityPanel v12.30 — «🏆 الأعلى مبيعاً» في تحليلات الأدمن.
 *
 * أعلى المتاجر أو المشترين مبيعاً بأي عدد نتائج (١٠/١٠٠/١٠٠٠ أو رقم حر) وأي
 * فترة (اليوم/يومان/٣/٧/٣٠/الكل أو «عدد أيام» حر أو من/إلى). العدّ حي من جدول
 * الحجوزات (users.total_bookings قديم بالتصميم) عبر admin_top_activity
 * (SECURITY DEFINER + is_admin). الغرض: يختار ناصر الأعلى نشاطاً ليمنحهم
 * خصومات/جوائز أو يسحب عليهم من قسم المسابقات.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabaseClient';

interface TopRow {
    id: string;
    label: string;
    phone: string | null;
    bookings: number;
    completed: number;
    qty: number;
    revenue: number;
}

type Preset = '1' | '2' | '3' | '7' | '30' | 'all' | 'days' | 'custom';
const PRESETS: { key: Preset; label: string }[] = [
    { key: '1', label: 'اليوم' }, { key: '2', label: 'يومان' }, { key: '3', label: '٣ أيام' },
    { key: '7', label: '٧ أيام' }, { key: '30', label: '٣٠ يوماً' }, { key: 'all', label: 'الكل' },
    { key: 'days', label: 'عدد أيام' }, { key: 'custom', label: 'من / إلى' },
];
const LIMIT_CHIPS = [10, 50, 100, 1000];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const fmtSar = (n: number) => `${Number(n || 0).toLocaleString('ar-SA', { maximumFractionDigits: 2 })} ر.س`;

export const TopActivityPanel: React.FC = () => {
    const [kind, setKind] = useState<'stores' | 'buyers'>('stores');
    const [preset, setPreset] = useState<Preset>('30');
    const [days, setDays] = useState(7);
    const [from, setFrom] = useState(isoDay(new Date(Date.now() - 29 * 864e5)));
    const [to, setTo] = useState(isoDay(new Date()));
    const [limit, setLimit] = useState(10);
    const [rows, setRows] = useState<TopRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [revealed, setRevealed] = useState<Set<string>>(new Set());

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
        const { data, error } = await supabase.rpc('admin_top_activity', {
            p_kind: kind,
            p_from: range.from,
            p_to: range.to,
            p_limit: Math.max(1, Math.min(limit || 10, 2000)),
        });
        if (!error && Array.isArray(data)) {
            setRows((data as any[]).map(r => ({
                id: r.id,
                label: r.label || r.id,
                phone: r.phone ?? null,
                bookings: Number(r.bookings) || 0,
                completed: Number(r.completed) || 0,
                qty: Number(r.qty) || 0,
                revenue: Number(r.revenue) || 0,
            })));
        }
        setLoading(false);
    }, [kind, range, limit]);
    useEffect(() => { load(); }, [load]);

    const togglePhone = (id: string) => setRevealed(s => {
        const n = new Set(s);
        n.has(id) ? n.delete(id) : n.add(id);
        return n;
    });

    return (
        <div className="bg-[var(--card-bg)] rounded-2xl p-4 border border-[var(--border-color)] shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-[var(--text-primary)]">🏆 الأعلى مبيعاً — {kind === 'stores' ? 'المتاجر' : 'المشترون'}</h2>
                <div className="flex gap-1.5">
                    {([['stores', '🏬 المتاجر'], ['buyers', '🛍 المشترون']] as const).map(([k, lbl]) => (
                        <button key={k} onClick={() => setKind(k)}
                            className={`px-3 py-1.5 rounded-lg text-[12px] font-extrabold ${kind === k ? 'bg-emerald-600 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                            {lbl}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
                {PRESETS.map(p => (
                    <button key={p.key} onClick={() => setPreset(p.key)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold ${preset === p.key ? 'bg-emerald-600 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                        {p.label}
                    </button>
                ))}
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

            <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-bold text-[var(--text-secondary)]">عدد النتائج:</span>
                <input type="number" min={1} max={2000} value={limit}
                    onChange={e => setLimit(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
                    className="w-24 px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-center text-[var(--text-primary)]" />
                {LIMIT_CHIPS.map(n => (
                    <button key={n} onClick={() => setLimit(n)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold ${limit === n ? 'bg-emerald-600 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                        {n}
                    </button>
                ))}
            </div>

            {loading ? (
                <div className="h-28 bg-[var(--gray-100)] rounded-xl animate-pulse" />
            ) : rows.length === 0 ? (
                <div className="text-sm text-[var(--gray-400)] text-center py-6">لا يوجد نشاط في هذه الفترة.</div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead><tr className="text-[var(--text-secondary)]">
                            <th className="text-right py-1.5 px-2 font-extrabold">#</th>
                            <th className="text-right py-1.5 px-2 font-extrabold">{kind === 'stores' ? 'المتجر' : 'المشتري'}</th>
                            <th className="text-right py-1.5 px-2 font-extrabold">مبيعات مكتملة</th>
                            <th className="text-right py-1.5 px-2 font-extrabold">إجمالي الحجوزات</th>
                            <th className="text-right py-1.5 px-2 font-extrabold">قطع مُباعة</th>
                            <th className="text-right py-1.5 px-2 font-extrabold">قيمة المبيعات</th>
                            <th className="text-right py-1.5 px-2 font-extrabold">الجوال</th>
                        </tr></thead>
                        <tbody>
                            {rows.map((r, i) => {
                                const shown = revealed.has(r.id);
                                return (
                                    <tr key={r.id} className="border-t border-[var(--border-color)] font-bold text-[var(--text-primary)]">
                                        <td className="py-1.5 px-2 text-[var(--text-secondary)]">{i + 1}</td>
                                        <td className="py-1.5 px-2">{i < 3 ? ['🥇', '🥈', '🥉'][i] + ' ' : ''}{r.label}</td>
                                        <td className="py-1.5 px-2 font-black text-emerald-600">{r.completed.toLocaleString('ar-SA')}</td>
                                        <td className="py-1.5 px-2">{r.bookings.toLocaleString('ar-SA')}</td>
                                        <td className="py-1.5 px-2">{r.qty.toLocaleString('ar-SA')}</td>
                                        <td className="py-1.5 px-2">{fmtSar(r.revenue)}</td>
                                        <td className="py-1.5 px-2">
                                            {shown ? (
                                                <a href={`tel:${r.phone || ''}`} className="font-mono text-emerald-600 underline" dir="ltr">{r.phone || '—'}</a>
                                            ) : (
                                                <button onClick={() => togglePhone(r.id)} className="px-2 py-0.5 rounded-lg text-[10px] font-extrabold bg-emerald-50 text-emerald-700 border border-emerald-200">🔓 الرقم</button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <p className="text-[10px] text-[var(--text-secondary)] font-bold mt-2">
                        💡 استخدم هذه القائمة لاختيار من تمنحهم خصومات أو جوائز — وللسحب عليهم افتح «المسابقات ← سحب مخصص» بنفس الفترة.
                    </p>
                </div>
            )}
        </div>
    );
};
