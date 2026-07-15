/**
 * FirstMembersPanel v12.31 — «🥇 أوائل المشتركين» في تحليلات الأدمن (طلب ناصر ١٢).
 *
 * أول N مشترك في المنصة (١٠٠/١٠٠٠/٥٠٠٠/٢٠٠٠٠ أو أي رقم) بالترتيب الزمني
 * الدقيق — التاريخ والوقت بالثانية (users.created_at timestamptz مسجّل أصلاً
 * بدقة الميكروثانية منذ اليوم الأول) — لتكريم الأوائل لاحقاً. مع وضع «فترة
 * محددة»: من/إلى أو عدد أيام لعرض من سجّلوا فيها بالترتيب. فلتر النوع:
 * الكل / مشترون / تجار. البيانات عبر admin_first_members (is_admin).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../services/supabaseClient';

interface MemberRow {
    id: string;
    name: string | null;
    shop: string | null;
    phone: string | null;
    user_type: string;
    created_at: string;
}

type Mode = 'first' | 'range';
type Kind = 'all' | 'buyers' | 'sellers';
type RangePreset = 'days' | 'custom';

const LIMIT_CHIPS = [100, 1000, 5000, 20000];
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** تاريخ + وقت بالثانية بتوقيت الرياض — «2026-07-15 14:03:22» */
const fmtExact = (iso: string) => {
    try {
        const d = new Date(iso);
        const date = d.toLocaleDateString('en-CA', { timeZone: 'Asia/Riyadh' });
        const time = d.toLocaleTimeString('en-GB', { timeZone: 'Asia/Riyadh', hour12: false });
        return `${date} ${time}`;
    } catch { return iso; }
};

export const FirstMembersPanel: React.FC = () => {
    const [mode, setMode] = useState<Mode>('first');
    const [kind, setKind] = useState<Kind>('all');
    const [limit, setLimit] = useState(100);
    const [preset, setPreset] = useState<RangePreset>('days');
    const [days, setDays] = useState(7);
    const [from, setFrom] = useState(isoDay(new Date(Date.now() - 6 * 864e5)));
    const [to, setTo] = useState(isoDay(new Date()));
    const [rows, setRows] = useState<MemberRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [revealed, setRevealed] = useState<Set<string>>(new Set());

    const range = useMemo((): { from: string | null; to: string | null } => {
        if (mode === 'first') return { from: null, to: null };   // من فجر المنصة
        if (preset === 'days') return { from: new Date(Date.now() - Math.max(1, days) * 864e5).toISOString(), to: null };
        return {
            from: new Date(from + 'T00:00:00').toISOString(),
            to: new Date(new Date(to + 'T00:00:00').getTime() + 864e5).toISOString(),   // شامل يوم «إلى»
        };
    }, [mode, preset, days, from, to]);

    const load = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.rpc('admin_first_members', {
            p_kind: kind,
            p_from: range.from,
            p_to: range.to,
            p_limit: Math.max(1, Math.min(limit || 100, 20000)),
        });
        if (!error && Array.isArray(data)) setRows(data as MemberRow[]);
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
                <h2 className="text-lg font-bold text-[var(--text-primary)]">🥇 أوائل المشتركين — بالتاريخ والوقت (بالثانية)</h2>
                <div className="flex gap-1.5">
                    <button onClick={() => setMode('first')}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-extrabold ${mode === 'first' ? 'bg-amber-500 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                        🥇 أوائل المنصة
                    </button>
                    <button onClick={() => setMode('range')}
                        className={`px-3 py-1.5 rounded-lg text-[12px] font-extrabold ${mode === 'range' ? 'bg-amber-500 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                        📅 فترة محددة
                    </button>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-bold text-[var(--text-secondary)]">النوع:</span>
                {([['all', 'الجميع'], ['buyers', '🛍 مشترون'], ['sellers', '🏬 تجار']] as const).map(([k, lbl]) => (
                    <button key={k} onClick={() => setKind(k)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold ${kind === k ? 'bg-amber-500 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                        {lbl}
                    </button>
                ))}
                <span className="text-xs font-bold text-[var(--text-secondary)] mr-2">أول</span>
                <input type="number" min={1} max={20000} value={limit}
                    onChange={e => setLimit(Math.max(1, Math.min(20000, Number(e.target.value) || 1)))}
                    className="w-24 px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-center text-[var(--text-primary)]" />
                <span className="text-xs font-bold text-[var(--text-secondary)]">مشترك</span>
                {LIMIT_CHIPS.map(n => (
                    <button key={n} onClick={() => setLimit(n)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold ${limit === n ? 'bg-amber-500 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                        {n.toLocaleString('ar-SA')}
                    </button>
                ))}
            </div>

            {mode === 'range' && (
                <div className="space-y-2">
                    <div className="flex gap-1.5">
                        <button onClick={() => setPreset('days')}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold ${preset === 'days' ? 'bg-amber-500 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                            عدد أيام
                        </button>
                        <button onClick={() => setPreset('custom')}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-extrabold ${preset === 'custom' ? 'bg-amber-500 text-white' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]'}`}>
                            من / إلى
                        </button>
                    </div>
                    {preset === 'days' ? (
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-[var(--text-secondary)]">آخر</span>
                            <input type="number" min={1} max={3650} value={days}
                                onChange={e => setDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))}
                                className="w-24 px-3 py-2 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold text-center text-[var(--text-primary)]" />
                            <span className="text-xs font-bold text-[var(--text-secondary)]">يوماً</span>
                        </div>
                    ) : (
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
                </div>
            )}

            {loading ? (
                <div className="h-28 bg-[var(--gray-100)] rounded-xl animate-pulse" />
            ) : rows.length === 0 ? (
                <div className="text-sm text-[var(--gray-400)] text-center py-6">لا مسجّلين مطابقين.</div>
            ) : (
                <div className="overflow-x-auto">
                    <div className="text-[11px] font-bold text-[var(--text-secondary)] mb-1.5">
                        {rows.length.toLocaleString('ar-SA')} مشترك — الأقدم أولاً (الترتيب = أسبقية الانضمام)
                    </div>
                    <table className="w-full text-xs">
                        <thead><tr className="text-[var(--text-secondary)]">
                            <th className="text-right py-1.5 px-2 font-extrabold">#</th>
                            <th className="text-right py-1.5 px-2 font-extrabold">الاسم</th>
                            <th className="text-right py-1.5 px-2 font-extrabold">النوع</th>
                            <th className="text-right py-1.5 px-2 font-extrabold">تاريخ ووقت التسجيل</th>
                            <th className="text-right py-1.5 px-2 font-extrabold">الجوال</th>
                        </tr></thead>
                        <tbody>
                            {rows.map((r, i) => {
                                const shown = revealed.has(r.id);
                                return (
                                    <tr key={r.id} className="border-t border-[var(--border-color)] font-bold text-[var(--text-primary)]">
                                        <td className="py-1.5 px-2 text-[var(--text-secondary)] tabular-nums">{i + 1}</td>
                                        <td className="py-1.5 px-2">
                                            {i < 3 && mode === 'first' ? ['🥇', '🥈', '🥉'][i] + ' ' : ''}
                                            {r.shop ? `${r.shop}` : (r.name || '—')}
                                            {r.shop && r.name && <span className="text-[10px] text-[var(--text-secondary)]"> ({r.name})</span>}
                                        </td>
                                        <td className="py-1.5 px-2">
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold text-white ${r.user_type === 'seller' ? 'bg-purple-500' : r.user_type === 'admin' ? 'bg-slate-600' : 'bg-blue-500'}`}>
                                                {r.user_type === 'seller' ? 'تاجر' : r.user_type === 'admin' ? 'إدارة' : 'مشتري'}
                                            </span>
                                        </td>
                                        <td className="py-1.5 px-2 font-mono tabular-nums" dir="ltr">{fmtExact(r.created_at)}</td>
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
                        💡 كل تسجيل محفوظ بتوقيته الدقيق (بالثانية) منذ اليوم الأول — استخدم القائمة للتكريم أو اسحب على نفس الفترة من «المسابقات ← سحب مخصص».
                    </p>
                </div>
            )}
        </div>
    );
};
