/**
 * AdminKit — الطبقة البصرية الواحدة للوحة الإدارة (v14.89)
 * ═══════════════════════════════════════════════════════════════════════════
 * لماذا وُجد هذا الملف — قِيس على الإصدار 14.88 قبل كتابته:
 *   • ٩٤ تدرّجاً لونياً (`bg-gradient-to-*`) و٤٧ ظلّاً ثقيلاً: كل بطاقة تصرخ،
 *     فلا شيء يبرز. لوحات الإدارة العالمية تعكس ذلك: سطحٌ هادئ، واللون
 *     **للدلالة وحدها** (سليم/تحذير/خطر) لا للزينة.
 *   • ٣٦ «رقماً كبيراً» مكتوباً يدوياً بأربع صيغ مختلفة.
 *   • ٦٠ حالةً فارغة و٢٧ هيكل تحميل، كلٌّ بصياغته.
 *   • ثلاث قيم زاوية للبطاقة نفسها (`rounded-xl` ٣٠٢ · `2xl` ١٩٦ · `3xl` ١٩).
 *   • ١٢ `bg-white` صلباً — أبيضُ على أبيض في الوضع الداكن.
 *
 * 🪤 ولا `dark:` هنا إطلاقاً: `darkMode` غير مضبوط في `tailwind.config.js`
 *    فالافتراضي `media` — أي أن `dark:` يتبع نظام التشغيل، بينما التطبيق
 *    يكتب `.dark-mode`/`.light-mode` على `<html>` حسب اختيار المستخدم.
 *    كل لونٍ هنا رمزٌ من `styles.css` يتبع الاثنين.
 */

import React, { memo, useState, useId } from 'react';

/** نغمات الدلالة الخمس — لا سادسة، ولا لون خارجها. */
export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info';

const TONE_FG: Record<Tone, string> = {
    neutral: 'var(--adm-neutral-fg)',
    ok: 'var(--adm-ok-fg)',
    warn: 'var(--adm-warn-fg)',
    bad: 'var(--adm-bad-fg)',
    info: 'var(--adm-info-fg)',
};
const TONE_BG: Record<Tone, string> = {
    neutral: 'var(--adm-neutral-bg)',
    ok: 'var(--adm-ok-bg)',
    warn: 'var(--adm-warn-bg)',
    bad: 'var(--adm-bad-bg)',
    info: 'var(--adm-info-bg)',
};

export const toneFg = (t: Tone): string => TONE_FG[t];
export const toneBg = (t: Tone): string => TONE_BG[t];


// ═══════════════════════════════════════════════════════════════════════════
// الأرقام — شكلٌ واحد في اللوحة كلّها
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 🪤 قِيس على شاشةٍ واحدة: تسعةُ أرقامٍ لاتينية وثلاثةٌ هندية معاً — لأن بعض
 *    المواضع تستعمل `toLocaleString('ar-SA')` (٥١٬٢٣٤) وبعضها يطبع الرقم خاماً
 *    (51234). وثالثةٌ في اللوحة تستعمل `en-US`. ثلاثة أشكالٍ للرقم في منصّةٍ
 *    واحدة، وفي بطاقتين متجاورتين أحياناً.
 *    القرار: **أرقام لاتينية في لوحة الإدارة كلّها** — تصطفّ عمودياً مع
 *    `tabular-nums`، وتُقرأ أسرع في جدولٍ طويل. و`ar-SA-u-nu-latn` يعطي
 *    الفواصل بالشكل المحلّي والأرقامَ لاتينية.
 *    (واجهة المشتري تبقى كما هي — هذا قرارُ لوحةٍ لا قرارُ منصّة.)
 */
export const admNum = (n: number | null | undefined): string =>
    Number(n ?? 0).toLocaleString('ar-SA-u-nu-latn');

/** مبلغٌ بالريال — بلا كسورٍ إلا إن وُجدت. */
export const admMoney = (n: number | null | undefined): string =>
    `${Number(n ?? 0).toLocaleString('ar-SA-u-nu-latn', { maximumFractionDigits: 2 })} ر.س`;

// ═══════════════════════════════════════════════════════════════════════════
// السطح
// ═══════════════════════════════════════════════════════════════════════════

export const AdmCard: React.FC<{
    children: React.ReactNode;
    className?: string;
    padded?: boolean;
    style?: React.CSSProperties;
}> = ({ children, className = '', padded = true, style }) => (
    <div
        className={className}
        style={{
            background: 'var(--adm-surface)',
            border: '1px solid var(--adm-border)',
            borderRadius: 'var(--adm-r)',
            boxShadow: 'var(--adm-shadow)',
            padding: padded ? '18px' : 0,
            ...style,
        }}
    >
        {children}
    </div>
);

/**
 * قسمٌ بعنوانٍ ووصفٍ وإجراء — ويطوى اختيارياً.
 * الطيّ يحلّ مشكلة قِيست: تبويباتٌ تعرض ثمانية أقسامٍ مفتوحةً دفعةً واحدة
 * فلا يجد القارئ ما يريد. `defaultOpen=false` يجعل القسم ثانوياً بلا حذفه.
 */
export const AdmSection: React.FC<{
    title: string;
    desc?: string;
    icon?: string;
    action?: React.ReactNode;
    collapsible?: boolean;
    defaultOpen?: boolean;
    children: React.ReactNode;
    /** شارة صغيرة بجانب العنوان (عدد، حالة) */
    badge?: { text: string; tone?: Tone };
}> = ({ title, desc, icon, action, collapsible = false, defaultOpen = true, children, badge }) => {
    const [open, setOpen] = useState(defaultOpen);
    const bodyId = useId();
    const shown = collapsible ? open : true;

    const head = (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {icon && <span style={{ fontSize: '1.05rem', lineHeight: 1 }} aria-hidden="true">{icon}</span>}
                    <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800, color: 'var(--adm-fg)', letterSpacing: '-.01em' }}>
                        {title}
                    </h3>
                    {badge && <AdmPill tone={badge.tone ?? 'neutral'}>{badge.text}</AdmPill>}
                </div>
                {desc && (
                    <p style={{ margin: '5px 0 0', fontSize: '.82rem', lineHeight: 1.75, color: 'var(--adm-fg-2)', maxWidth: '68ch' }}>
                        {desc}
                    </p>
                )}
            </div>
            {action && <div style={{ flexShrink: 0 }}>{action}</div>}
            {collapsible && (
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    className="adm-focusable"
                    style={{
                        flexShrink: 0, width: 30, height: 30, borderRadius: 'var(--adm-r-sm)',
                        border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)',
                        color: 'var(--adm-fg-2)', fontSize: '.8rem', cursor: 'pointer', lineHeight: 1,
                    }}
                >
                    {open ? '▲' : '▼'}
                </button>
            )}
        </div>
    );

    return (
        <AdmCard>
            {head}
            <div id={bodyId} hidden={!shown} style={{ marginTop: 16 }}>
                {children}
            </div>
        </AdmCard>
    );
};

/** رأس الصفحة/التبويب — عنوانٌ واحد لكل شاشة، وسطرٌ يقول ما فائدتها. */
export const AdmPageHeader: React.FC<{
    title: string;
    desc?: string;
    icon?: string;
    actions?: React.ReactNode;
}> = memo(({ title, desc, icon, actions }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap', marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 900, color: 'var(--adm-fg)', letterSpacing: '-.02em', display: 'flex', alignItems: 'center', gap: 9 }}>
                {icon && <span aria-hidden="true">{icon}</span>}
                {title}
            </h2>
            {desc && (
                <p style={{ margin: '6px 0 0', fontSize: '.86rem', lineHeight: 1.8, color: 'var(--adm-fg-2)', maxWidth: '72ch' }}>
                    {desc}
                </p>
            )}
        </div>
        {actions && <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap' }}>{actions}</div>}
    </div>
));
AdmPageHeader.displayName = 'AdmPageHeader';

// ═══════════════════════════════════════════════════════════════════════════
// الأرقام
// ═══════════════════════════════════════════════════════════════════════════

/**
 * بطاقة رقم — تسميةٌ فوق، ورقمٌ كبير، وسطرُ سياقٍ تحته.
 * `scope` ليس زينة: قِيس أن بطاقاتٍ كثيرة لا تقول إن كان رقمها عن المنصّة
 * كلّها أم عن الصفحة المعروضة وحدها — وهو فرقٌ يغيّر القرار.
 */
export const AdmStat = memo<{
    label: string;
    value: string | number;
    scope?: string;
    tone?: Tone;
    icon?: string;
    delta?: { text: string; good?: boolean };
    onClick?: () => void;
    title?: string;
}>(({ label, value, scope, tone = 'neutral', icon, delta, onClick, title }) => {
    const inner = (
        <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                {icon && <span style={{ fontSize: '.9rem', lineHeight: 1 }} aria-hidden="true">{icon}</span>}
                <span style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--adm-fg-2)', letterSpacing: '.01em' }}>
                    {label}
                </span>
            </div>
            <div
                style={{
                    fontSize: '1.7rem', fontWeight: 900, lineHeight: 1.15,
                    fontVariantNumeric: 'tabular-nums',
                    color: tone === 'neutral' ? 'var(--adm-fg)' : TONE_FG[tone],
                    letterSpacing: '-.02em',
                }}
            >
                {value}
            </div>
            {(scope || delta) && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, flexWrap: 'wrap' }}>
                    {delta && (
                        <span
                            style={{
                                fontSize: '.7rem', fontWeight: 800, padding: '1px 7px', borderRadius: 999,
                                color: delta.good === undefined ? 'var(--adm-neutral-fg)' : delta.good ? 'var(--adm-ok-fg)' : 'var(--adm-bad-fg)',
                                background: delta.good === undefined ? 'var(--adm-neutral-bg)' : delta.good ? 'var(--adm-ok-bg)' : 'var(--adm-bad-bg)',
                                fontVariantNumeric: 'tabular-nums',
                            }}
                        >
                            {delta.text}
                        </span>
                    )}
                    {scope && <span style={{ fontSize: '.7rem', color: 'var(--adm-fg-3)', fontWeight: 600 }}>{scope}</span>}
                </div>
            )}
        </>
    );

    const base: React.CSSProperties = {
        background: 'var(--adm-surface)',
        border: '1px solid var(--adm-border)',
        borderRadius: 'var(--adm-r)',
        padding: '15px 16px',
        textAlign: 'right',
        width: '100%',
        boxShadow: 'var(--adm-shadow)',
    };

    if (!onClick) return <div style={base} title={title}>{inner}</div>;
    return (
        <button type="button" onClick={onClick} title={title} className="adm-focusable"
            style={{ ...base, cursor: 'pointer', transition: 'border-color .15s, box-shadow .15s' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--adm-border-strong)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--adm-border)'; }}
        >
            {inner}
        </button>
    );
});
AdmStat.displayName = 'AdmStat';

/** شبكة أرقام — عمودان على الجوال، ثلاثة/أربعة على الشاشات الأوسع. */
export const AdmStatGrid: React.FC<{ children: React.ReactNode; cols?: 2 | 3 | 4 }> = ({ children, cols = 4 }) => (
    <div
        style={{
            display: 'grid',
            gap: 10,
            gridTemplateColumns: `repeat(2, minmax(0, 1fr))`,
        }}
        data-adm-cols={cols}
        className={`adm-statgrid adm-statgrid-${cols}`}
    >
        {children}
    </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// الحالات والشارات
// ═══════════════════════════════════════════════════════════════════════════

export const AdmPill: React.FC<{ tone?: Tone; children: React.ReactNode; title?: string }> = memo(
    ({ tone = 'neutral', children, title }) => (
        <span
            title={title}
            style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: '.7rem', fontWeight: 800, padding: '2px 9px', borderRadius: 999,
                color: TONE_FG[tone], background: TONE_BG[tone], whiteSpace: 'nowrap',
                lineHeight: 1.7,
            }}
        >
            {children}
        </span>
    )
);
AdmPill.displayName = 'AdmPill';

/** حالةٌ فارغة تقول **لماذا** فارغة وماذا يفعل القارئ — لا «لا بيانات» وحدها. */
export const AdmEmpty: React.FC<{
    icon?: string;
    title: string;
    hint?: string;
    action?: React.ReactNode;
}> = memo(({ icon = '—', title, hint, action }) => (
    <div style={{ textAlign: 'center', padding: '34px 18px' }}>
        <div style={{ fontSize: '1.7rem', marginBottom: 10, opacity: .55 }} aria-hidden="true">{icon}</div>
        <div style={{ fontSize: '.92rem', fontWeight: 800, color: 'var(--adm-fg)' }}>{title}</div>
        {hint && (
            <div style={{ fontSize: '.8rem', color: 'var(--adm-fg-2)', marginTop: 6, lineHeight: 1.8, maxWidth: '48ch', marginInline: 'auto' }}>
                {hint}
            </div>
        )}
        {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
));
AdmEmpty.displayName = 'AdmEmpty';

/** هيكل تحميل موحّد — يحجز نفس ارتفاع المحتوى فلا تقفز الصفحة. */
export const AdmSkeleton: React.FC<{ rows?: number; height?: number }> = memo(({ rows = 3, height = 52 }) => (
    <div style={{ display: 'grid', gap: 8 }} aria-busy="true" aria-live="polite">
        {Array.from({ length: rows }, (_, i) => (
            <div
                key={i}
                className="animate-pulse"
                style={{ height, borderRadius: 'var(--adm-r-sm)', background: 'var(--adm-surface-3)' }}
            />
        ))}
        <span style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>جارٍ التحميل</span>
    </div>
));
AdmSkeleton.displayName = 'AdmSkeleton';

/** خطأٌ يقول ما حدث وكيف يُعالَج — لا «حدث خطأ» وحدها. */
export const AdmError: React.FC<{ message: string; onRetry?: () => void }> = memo(({ message, onRetry }) => (
    <div
        style={{
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '12px 14px', borderRadius: 'var(--adm-r-sm)',
            background: 'var(--adm-bad-bg)', color: 'var(--adm-bad-fg)',
            fontSize: '.84rem', fontWeight: 700,
        }}
        role="alert"
    >
        <span style={{ flex: 1, minWidth: 0 }}>{message}</span>
        {onRetry && (
            <button type="button" onClick={onRetry} className="adm-focusable"
                style={{
                    fontSize: '.78rem', fontWeight: 800, padding: '4px 12px', borderRadius: 999,
                    border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer',
                }}
            >
                إعادة المحاولة
            </button>
        )}
    </div>
));
AdmError.displayName = 'AdmError';

// ═══════════════════════════════════════════════════════════════════════════
// الأزرار
// ═══════════════════════════════════════════════════════════════════════════

export const AdmButton: React.FC<{
    children: React.ReactNode;
    onClick?: () => void;
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
    disabled?: boolean;
    title?: string;
    type?: 'button' | 'submit';
    full?: boolean;
}> = ({ children, onClick, variant = 'secondary', size = 'md', disabled, title, type = 'button', full }) => {
    const pad = size === 'sm' ? '5px 11px' : '8px 15px';
    const fs = size === 'sm' ? '.78rem' : '.85rem';
    const look: Record<string, React.CSSProperties> = {
        primary: { background: 'var(--adm-accent)', color: '#ffffff', border: '1px solid transparent' },
        secondary: { background: 'var(--adm-surface-2)', color: 'var(--adm-fg)', border: '1px solid var(--adm-border)' },
        ghost: { background: 'transparent', color: 'var(--adm-fg-2)', border: '1px solid transparent' },
        danger: { background: 'var(--adm-bad-bg)', color: 'var(--adm-bad-fg)', border: '1px solid transparent' },
    };
    return (
        <button
            type={type}
            onClick={onClick}
            disabled={disabled}
            title={title}
            className="adm-focusable"
            style={{
                ...look[variant],
                padding: pad, fontSize: fs, fontWeight: 800, borderRadius: 'var(--adm-r-sm)',
                cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .5 : 1,
                whiteSpace: 'nowrap', width: full ? '100%' : undefined,
                transition: 'opacity .15s',
            }}
        >
            {children}
        </button>
    );
};
