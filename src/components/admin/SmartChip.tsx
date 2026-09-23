/**
 * SmartChip — شريحة مرشّح واحدة للوحة الإدارة (v14.89)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 كان هذا المكوّن منسوخاً حرفياً في شاشتَي «المشترين» و«التجّار»، كلٌّ
 *    بلونٍ مختلف (أزرق هناك، بنفسجي هنا) — فالشريحةُ نفسها تبدو شيئين
 *    مختلفين حسب التبويب، والقارئ يتعلّم شكلاً جديداً في كل شاشة.
 *    نسخةٌ واحدة، ولونٌ واحد للحالة النشطة: لون الدلالة (accent).
 *
 * 🪤 ولا `dark:` ولا `bg-white` هنا: `darkMode` غير مضبوط في
 *    `tailwind.config.js` فالافتراضي `media`، بينما التطبيق يكتب
 *    `.dark-mode` على `<html>`. كل لونٍ هنا رمز `--adm-*` يتبع الاثنين.
 */

import React, { memo } from 'react';

export interface SmartChipProps {
    /** هل هذا المرشّح هو المُطبَّق الآن؟ */
    active: boolean;
    onClick: () => void;
    icon: string;
    label: string;
    /** عددٌ اختياري بجانب التسمية — يُخفى إن كان صفراً */
    count?: number;
    /** شرحٌ يظهر عند التمرير — ما الذي يفعله هذا المرشّح بالضبط */
    title?: string;
}

export const SmartChip = memo<SmartChipProps>(({ active, onClick, icon, label, count, title }) => (
    <button
        type="button"
        onClick={onClick}
        aria-pressed={active}
        title={title}
        className="adm-focusable"
        style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 11px',
            borderRadius: 999,
            fontSize: '.76rem',
            fontWeight: 800,
            whiteSpace: 'nowrap',
            cursor: 'pointer',
            lineHeight: 1.7,
            transition: 'background-color .15s, border-color .15s, color .15s',
            background: active ? 'var(--adm-accent-weak)' : 'var(--adm-surface)',
            border: `1px solid ${active ? 'var(--adm-accent)' : 'var(--adm-border)'}`,
            color: active ? 'var(--adm-accent)' : 'var(--adm-fg-2)',
        }}
    >
        <span aria-hidden="true">{icon}</span>
        <span>{label}</span>
        {count !== undefined && count > 0 && (
            <span
                style={{
                    fontSize: '.68rem',
                    fontWeight: 900,
                    padding: '0 6px',
                    borderRadius: 999,
                    fontVariantNumeric: 'tabular-nums',
                    background: active ? 'var(--adm-surface)' : 'var(--adm-surface-3)',
                    color: active ? 'var(--adm-accent)' : 'var(--adm-fg-3)',
                }}
            >
                {count}
            </span>
        )}
    </button>
));
SmartChip.displayName = 'SmartChip';

export default SmartChip;
