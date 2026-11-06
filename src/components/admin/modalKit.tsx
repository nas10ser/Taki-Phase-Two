/**
 * modalKit — أنماطُ نوافذ لوحة المدير وحقولُها المشتركة (v15.51)
 * ═══════════════════════════════════════════════════════════════════════════
 * خرجت من `AdminTools.tsx` حين بلغ سقفَ السقّافة (١٩٨٢ سطراً) واحتاج إصلاحُ
 * البثّ مكاناً. والصوابُ **تقليصٌ حقيقيّ لا رفعُ سقف**: فنافذةُ البانر ونافذةُ
 * الحملة كانتا تتقاسمان تسعةَ تعريفاتٍ في ملفٍّ واحد، فصار لها موضعٌ واحد
 * يُقرأ — وهو نفسُ النمط الذي أخرج `BookingHoldsCard` و`OrderCloseActions`.
 */
import React, { memo } from 'react';

export const fieldStyle: React.CSSProperties = {
    width: '100%', padding: '9px 11px', fontSize: '.85rem', fontWeight: 600,
    borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
    background: 'var(--adm-surface-2)', color: 'var(--adm-fg)',
};
export const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '.72rem', fontWeight: 800, color: 'var(--adm-fg-3)', marginBottom: 5,
};
export const hintStyle: React.CSSProperties = {
    display: 'block', fontSize: '.72rem', lineHeight: 1.75, color: 'var(--adm-fg-2)', marginTop: 5,
};
export const AUDIENCE_LABELS: Record<string, string> = {
    all: '👥 الجميع', buyer: '🛒 المشترون', seller: '🏪 البائعون',
};
export const Field = memo<{
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    dir?: 'rtl' | 'ltr';
}>(({ label, value, onChange, placeholder, dir }) => (
    <label style={{ display: 'block' }}>
        <span style={labelStyle}>{label}</span>
        <input
            type="text" dir={dir} placeholder={placeholder} value={value}
            onChange={(e) => onChange(e.target.value)}
            className="adm-focusable" style={fieldStyle}
        />
    </label>
));
Field.displayName = 'Field';
export const modalShell: React.CSSProperties = {
    width: '100%', maxHeight: '90vh', overflowY: 'auto',
    background: 'var(--adm-surface)', border: '1px solid var(--adm-border)',
    borderRadius: 'var(--adm-r)', boxShadow: 'var(--adm-shadow-lift)',
};
export const modalHead: React.CSSProperties = {
    position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', gap: 10,
    padding: '13px 15px', background: 'var(--adm-surface-2)', borderBottom: '1px solid var(--adm-border)',
};
export const modalFoot: React.CSSProperties = {
    position: 'sticky', bottom: 0, display: 'flex', gap: 10, padding: '12px 15px',
    background: 'var(--adm-surface-2)', borderTop: '1px solid var(--adm-border)',
};
export function toLocalDateInput(iso: string): string {
    try {
        const d = new Date(iso);
        const tzOffset = d.getTimezoneOffset() * 60000;
        return new Date(d.getTime() - tzOffset).toISOString().slice(0, 16);
    } catch { return ''; }
}
