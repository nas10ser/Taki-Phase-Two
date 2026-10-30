import React from 'react';
import NumericField from '../NumericField';
import { qtyGiven } from '../../utils/locationQty';

/**
 * LocationQtyGroups — «مجموعات الكمية لكل موقع» (v15.33)
 *
 * ── لماذا وُحِّدت ───────────────────────────────────────────────────────────
 * كانت هذه الكتلةُ مكتوبةً **مرّتين** في `SellerDashboard` (مرّةً للمنتج بلا
 * أنواع ومرّةً لكلّ نوع)، متطابقتين سطراً بسطر إلا في الألوان. وثمنُ ذلك
 * قِيس فعلاً: حين انحرف `coveredKeys` عن `cellFromGroups` انحرف في النسختين
 * معاً، فصارت الشاشةُ تقول «✅ كل المواقع محدّدة بكمية» والحفظُ يرفض بإنذار
 * «لا تترك موقعاً مفتوحاً» — وهو ما صوّره ناصر.
 *
 * 🪤 والقاعدة الحاكمة واحدة: **الموقعُ مُغطّى إذا كان في مجموعةٍ لها كمّية
 *    مُعطاة** (`qtyGiven`) — والصفرُ كمّيةٌ مُعطاة، والفراغُ ليس كذلك. وهي
 *    نفسُها التي يسألها `cellFromGroups` عند الحفظ، فلا تنحرفان ثانية.
 */

export interface QtyGroup { qty?: number; locs: string[] }
export interface BranchOpt { key: string; label: string }

interface Props {
    groups: QtyGroup[];
    branches: BranchOpt[];
    isRTL: boolean;
    /** الكمية إلزامية (ويحمرّ الحقل الفارغ) مع الانتهاء «بالكمية» وحده. */
    requireQty: boolean;
    /** 'base' = المنتج بلا أنواع (بطاقة كبيرة) · 'variant' = داخل نوع (بطاقة مُدمجة) */
    tone: 'base' | 'variant';
    title: string;
    hint: string;
    usedElsewhere: (groupIndex: number) => Set<string>;
    onQty: (groupIndex: number, n: number | undefined) => void;
    onToggle: (groupIndex: number, branchKey: string) => void;
    onRemove: (groupIndex: number) => void;
    onAdd: () => void;
}

const LocationQtyGroups: React.FC<Props> = ({ groups, branches, isRTL, requireQty, tone, title, hint, usedElsewhere, onQty, onToggle, onRemove, onAdd }) => {
    const base = tone === 'base';
    // الموقعُ مفتوحٌ ما لم يكن في مجموعةٍ ذاتِ كمّية — نفسُ شرط الحفظ بالضبط.
    const covered = new Set<string>(groups.filter(g => qtyGiven(g.qty)).flatMap(g => g.locs));
    const open = branches.filter(b => !covered.has(b.key));
    const rowBg = base ? 'var(--card-bg)' : 'var(--gray-50)';
    const fieldBg = base ? 'var(--body-bg)' : 'var(--card-bg)';

    return (
        <div style={base
            ? { marginBottom: 20, background: 'var(--gray-50)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 14 }
            : { marginBottom: 8, background: 'var(--card-bg)', border: '1px dashed var(--primary)', borderRadius: 12, padding: 10 }}>
            <div style={{ fontSize: base ? '0.95rem' : '0.75rem', fontWeight: 900, color: 'var(--text-primary)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                {title}
            </div>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: base ? 10 : 8, lineHeight: 1.6 }}>
                {hint}
            </div>
            {groups.map((g, gi) => {
                const used = usedElsewhere(gi);
                return (
                    <div key={gi} style={{ border: '1px solid var(--border-color)', borderRadius: 10, padding: 8, marginBottom: 8, background: rowBg }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <NumericField integer value={g.qty} onChange={n => onQty(gi, n)}
                                placeholder={isRTL ? `الكمية${requireQty ? ' *' : ''}` : 'qty'}
                                title={isRTL ? 'اكتب «0» إن لم يكن متوفراً في هذه المواقع — ويبقى الموقع ظاهراً للمشتري «نفد».' : 'Enter 0 if it is not available at these branches — the branch stays visible as sold out.'}
                                style={{ width: 92, padding: '8px 9px', borderRadius: 10, border: `1px solid ${requireQty && !qtyGiven(g.qty) ? 'var(--danger)' : 'var(--border-color)'}`, background: fieldBg, color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 800, textAlign: 'center' }} />
                            <span style={{ flex: 1, fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)' }}>{isRTL ? 'لهذه المواقع:' : 'for these branches:'}</span>
                            <button type="button" onClick={() => onRemove(gi)} aria-label={isRTL ? 'حذف المجموعة' : 'Remove group'}
                                style={{ background: 'var(--danger-light)', color: 'var(--danger)', border: 'none', borderRadius: 9, padding: '5px 9px', fontWeight: 900, cursor: 'pointer', flexShrink: 0 }}>✕</button>
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {branches.map(b => {
                                const on = g.locs.includes(b.key);
                                const blocked = used.has(b.key) && !on;
                                return (
                                    <button key={b.key} type="button" disabled={blocked} onClick={() => onToggle(gi, b.key)}
                                        title={blocked ? (isRTL ? 'مستخدم في مجموعة أخرى' : 'used in another group') : undefined}
                                        style={{ background: on ? 'var(--primary)' : 'var(--body-bg)', color: on ? '#fff' : 'var(--text-primary)', border: `1.5px solid ${on ? 'var(--primary)' : 'var(--gray-200)'}`, borderRadius: 999, padding: '6px 11px', fontSize: '0.75rem', fontWeight: 800, cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.4 : 1, WebkitTapHighlightColor: 'transparent' }}>
                                        {on ? '✅' : '➕'} {b.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
            <button type="button" onClick={onAdd}
                style={{ width: '100%', padding: base ? '10px' : '9px', borderRadius: 10, border: '1.5px dashed var(--primary)', background: 'var(--notif-unread-bg)', color: 'var(--primary)', fontSize: base ? '0.82rem' : '0.78rem', fontWeight: 900, cursor: 'pointer' }}>
                {isRTL ? '➕ أضف كمية' : '➕ Add quantity'}
            </button>
            <div style={{ fontSize: '0.75rem', fontWeight: 800, color: open.length ? 'var(--secondary)' : 'var(--primary)', marginTop: 7, lineHeight: 1.6 }}>
                {open.length
                    ? `🔓 ${isRTL ? 'مواقع مفتوحة (بلا حد)' : 'Open branches'}: ${open.map(b => b.label).join(isRTL ? '، ' : ', ')}`
                    : `✅ ${isRTL ? 'كل المواقع محدّدة بكمية' : 'All branches have a quantity'}`}
            </div>
        </div>
    );
};

export default LocationQtyGroups;
