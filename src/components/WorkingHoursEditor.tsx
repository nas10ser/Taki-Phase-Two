import React, { useState } from 'react';
import { WorkingHours, Shift, defaultWorkingHours, DAY_NAMES_AR, DAY_NAMES_EN, fmtClock } from '../utils/workingHours';

/**
 * WorkingHoursEditor — Google-Maps-style per-day shop hours (ساعات عمل المحل).
 * Each day: open/closed toggle + up to two shifts (e.g. 8:30–12:30 then 4:00–11:00).
 * "Copy to all days" for the common case, plus a master enable switch. v11.77
 */
interface Props {
    value?: WorkingHours | null;
    isRTL: boolean;
    saving?: boolean;
    onSave: (wh: WorkingHours) => void;
}

// Display order Sun→Sat (Saudi week). Friday/Saturday last so the weekend reads naturally.
const ORDER = [0, 1, 2, 3, 4, 5, 6];

const WorkingHoursEditor: React.FC<Props> = ({ value, isRTL, saving, onSave }) => {
    const init: WorkingHours = (value && value.days) ? { enabled: value.enabled !== false, days: { ...value.days } } : defaultWorkingHours();
    const [enabled, setEnabled] = useState<boolean>(init.enabled);
    const [days, setDays] = useState<Record<string, Shift[]>>(() => {
        const d: Record<string, Shift[]> = {};
        for (const i of ORDER) d[String(i)] = Array.isArray(init.days[String(i)]) ? init.days[String(i)].map(s => [s[0], s[1]] as Shift) : [];
        return d;
    });
    const dayNames = isRTL ? DAY_NAMES_AR : DAY_NAMES_EN;

    const setShift = (d: number, idx: number, which: 0 | 1, val: string) => {
        setDays(prev => {
            const arr = (prev[String(d)] || []).map(s => [s[0], s[1]] as Shift);
            if (!arr[idx]) arr[idx] = ['09:00', '22:00'];
            arr[idx][which] = val;
            return { ...prev, [String(d)]: arr };
        });
    };
    const toggleDay = (d: number, open: boolean) => setDays(prev => ({ ...prev, [String(d)]: open ? [['09:00', '22:00']] : [] }));
    const addShift = (d: number) => setDays(prev => ({ ...prev, [String(d)]: [...(prev[String(d)] || []), ['16:00', '23:00'] as Shift] }));
    const removeShift = (d: number, idx: number) => setDays(prev => ({ ...prev, [String(d)]: (prev[String(d)] || []).filter((_, i) => i !== idx) }));
    const copyToAll = (d: number) => {
        const src = days[String(d)] || [];
        setDays(() => { const out: Record<string, Shift[]> = {}; for (const i of ORDER) out[String(i)] = src.map(s => [s[0], s[1]] as Shift); return out; });
    };

    const card: React.CSSProperties = { background: 'var(--card-bg)', borderRadius: 16, padding: 14, border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' };

    return (
        <div style={card}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: enabled ? 12 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '1.3rem' }}>🕐</span>
                    <div>
                        <div style={{ fontWeight: 900, color: 'var(--text-primary)', fontSize: '0.95rem' }}>{isRTL ? 'ساعات عمل المحل' : 'Shop Working Hours'}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary, var(--gray-400))', fontWeight: 700 }}>{isRTL ? 'اختياري — تظهر للعملاء وتمنع الحجز خارج الدوام' : 'Optional — shown to customers; blocks booking when closed'}</div>
                    </div>
                </div>
                {/* master switch */}
                <button type="button" onClick={() => setEnabled(e => !e)} aria-label="toggle"
                    style={{ width: 50, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', background: enabled ? 'var(--primary)' : 'var(--gray-300)', position: 'relative', flexShrink: 0, transition: 'background .2s' }}>
                    <span style={{ position: 'absolute', top: 3, [enabled ? (isRTL ? 'left' : 'right') : (isRTL ? 'right' : 'left')]: 3, width: 22, height: 22, borderRadius: '50%', background: 'white', boxShadow: '0 1px 4px rgba(0,0,0,0.3)', transition: 'all .2s' } as React.CSSProperties} />
                </button>
            </div>

            {enabled && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {ORDER.map(d => {
                        const shifts = days[String(d)] || [];
                        const isOpen = shifts.length > 0;
                        return (
                            <div key={d} style={{ background: 'var(--body-bg)', borderRadius: 12, padding: '10px 12px', border: '1px solid var(--border-color)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                    <span style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.85rem', minWidth: 64 }}>{dayNames[d]}</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        {isOpen && shifts.length < 2 && (
                                            <button type="button" onClick={() => addShift(d)} title={isRTL ? 'فترة ثانية' : 'Second shift'}
                                                style={{ background: 'transparent', border: '1px dashed var(--primary)', color: 'var(--primary)', borderRadius: 8, padding: '3px 8px', fontSize: '0.7rem', fontWeight: 800, cursor: 'pointer' }}>+ {isRTL ? 'فترة' : 'shift'}</button>
                                        )}
                                        {isOpen && (
                                            <button type="button" onClick={() => copyToAll(d)} title={isRTL ? 'انسخ لكل الأيام' : 'Copy to all days'}
                                                style={{ background: 'transparent', border: 'none', color: 'var(--accent)', fontSize: '0.7rem', fontWeight: 800, cursor: 'pointer' }}>📋 {isRTL ? 'للكل' : 'all'}</button>
                                        )}
                                        <button type="button" onClick={() => toggleDay(d, !isOpen)}
                                            style={{ background: isOpen ? 'rgba(16,185,129,0.12)' : 'var(--gray-100)', color: isOpen ? 'var(--primary)' : 'var(--gray-500)', border: 'none', borderRadius: 8, padding: '4px 10px', fontSize: '0.72rem', fontWeight: 900, cursor: 'pointer', minWidth: 54 }}>
                                            {isOpen ? (isRTL ? 'مفتوح' : 'Open') : (isRTL ? 'مغلق' : 'Closed')}
                                        </button>
                                    </div>
                                </div>
                                {isOpen && (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                                        {shifts.map((s, idx) => (
                                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                                                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary, var(--gray-400))', fontWeight: 700 }}>{isRTL ? 'من' : 'From'}</span>
                                                <input type="time" value={s[0]} onChange={e => setShift(d, idx, 0, e.target.value)}
                                                    style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.8rem' }} />
                                                <span style={{ fontSize: '0.68rem', color: 'var(--text-secondary, var(--gray-400))', fontWeight: 700 }}>{isRTL ? 'إلى' : 'to'}</span>
                                                <input type="time" value={s[1]} onChange={e => setShift(d, idx, 1, e.target.value)}
                                                    style={{ padding: '5px 8px', borderRadius: 8, border: '1px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontWeight: 700, fontSize: '0.8rem' }} />
                                                {idx > 0 && (
                                                    <button type="button" onClick={() => removeShift(d, idx)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', fontSize: '0.95rem', cursor: 'pointer' }}>🗑</button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            <button type="button" disabled={saving} onClick={() => onSave({ enabled, days })}
                style={{ width: '100%', marginTop: 12, padding: '11px', borderRadius: 12, background: 'var(--primary)', color: 'white', border: 'none', fontWeight: 900, fontSize: '0.9rem', cursor: saving ? 'default' : 'pointer', opacity: saving ? 0.7 : 1, boxShadow: '0 6px 16px var(--primary-glow)' }}>
                {saving ? (isRTL ? 'جارٍ الحفظ…' : 'Saving…') : (isRTL ? '💾 حفظ ساعات العمل' : '💾 Save Working Hours')}
            </button>
        </div>
    );
};

export default WorkingHoursEditor;
