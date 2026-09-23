/**
 * أنماط شاشة التجّار المشتركة (v14.89)
 * استُخرجت حين انفصلت نافذة الاشتراك عن `AdminSellers.tsx` — فالنمطان
 * يستعملهما الملفّان، ونسخُهما مرّتين هو بالضبط ما كانت هذه الموجة تحذفه.
 */
import React from 'react';

/** حقل إدخال موحّد — بدل ستّ صيغ `className` طويلة كانت تنحرف عن بعضها. */
export const fieldCss: React.CSSProperties = {
    width: '100%', padding: '9px 12px', fontSize: '.85rem', fontWeight: 600,
    borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
    background: 'var(--adm-surface-2)', color: 'var(--adm-fg)', outline: 'none',
};

export const labelCss: React.CSSProperties = { color: 'var(--adm-fg-2)' };

/** زرّ اختيار: الحدّ واللون الخفيف يقولان «مختار» — بلا تدرّجٍ ولا لونٍ ممتلئ. */
export const pickCss = (selected: boolean): React.CSSProperties => ({
    padding: '11px', borderRadius: 'var(--adm-r-sm)', cursor: 'pointer', fontWeight: 700,
    border: `1px solid ${selected ? 'var(--adm-accent)' : 'var(--adm-border)'}`,
    background: selected ? 'var(--adm-accent-weak)' : 'var(--adm-surface-2)',
    color: selected ? 'var(--adm-accent)' : 'var(--adm-fg-2)',
});
