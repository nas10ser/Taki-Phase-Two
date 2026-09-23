/**
 * AdminData — الجدول وشريط الأدوات ومنتقي الفترة (v14.89)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 منتقي الفترة كان مكتوباً في **ثمانية ملفّات** («من تاريخ»/«إلى تاريخ»)،
 *    كلٌّ بصياغته وبحدوده وبسلوكه عند عكس التاريخين. واحدٌ هنا بدلها.
 * 🪤 وأحد عشر جدولاً مكتوبةً يدوياً: منها ما يتمرّر أفقياً ومنها ما يدفع
 *    الصفحة كلّها جانباً، ومنها ما يقول «لا بيانات» ومنها ما يعرض فراغاً.
 */

import React, { memo, useMemo } from 'react';
import { AdmEmpty, AdmSkeleton } from './AdminKit';

// ═══════════════════════════════════════════════════════════════════════════
// الجدول
// ═══════════════════════════════════════════════════════════════════════════

export interface AdmColumn<T> {
    /** العنوان كما يراه المستخدم */
    header: string;
    /** قيمة الخلية */
    cell: (row: T, index: number) => React.ReactNode;
    /** أرقامٌ تُصفّ عمودياً (tabular-nums) */
    numeric?: boolean;
    /** يُخفى على الشاشات الضيّقة — للأعمدة الثانوية */
    secondary?: boolean;
    width?: string;
}

export function AdmTable<T>({
    columns,
    rows,
    keyOf,
    loading,
    empty,
    onRowClick,
    caption,
}: {
    columns: Array<AdmColumn<T>>;
    rows: T[];
    keyOf: (row: T, index: number) => string;
    loading?: boolean;
    empty?: { icon?: string; title: string; hint?: string };
    onRowClick?: (row: T) => void;
    /** وصفٌ لقارئ الشاشة — الجدول بلا عنوانٍ يقرأ كأعمدةٍ بلا معنى */
    caption?: string;
}) {
    if (loading) return <AdmSkeleton rows={4} height={44} />;
    if (!rows.length) {
        return (
            <AdmEmpty
                icon={empty?.icon}
                title={empty?.title ?? 'لا توجد صفوف بعد'}
                hint={empty?.hint}
            />
        );
    }

    return (
        <div className="adm-table-wrap">
            <table className="adm-table">
                {caption && <caption className="sr-only">{caption}</caption>}
                <thead>
                    <tr>
                        {columns.map((c, i) => (
                            <th key={i} style={{ width: c.width }} className={c.secondary ? 'adm-col-secondary' : undefined}>
                                {c.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, ri) => (
                        <tr
                            key={keyOf(row, ri)}
                            onClick={onRowClick ? () => onRowClick(row) : undefined}
                            style={onRowClick ? { cursor: 'pointer' } : undefined}
                        >
                            {columns.map((c, ci) => (
                                <td
                                    key={ci}
                                    className={`${c.numeric ? 'adm-num' : ''} ${c.secondary ? 'adm-col-secondary' : ''}`.trim() || undefined}
                                >
                                    {c.cell(row, ri)}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// شريط الأدوات: بحثٌ + مرشّحات + إجراءات
// ═══════════════════════════════════════════════════════════════════════════

export const AdmSearch = memo<{
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    label?: string;
}>(({ value, onChange, placeholder = 'ابحث…', label = 'بحث' }) => (
    <label style={{ position: 'relative', flex: '1 1 210px', minWidth: 0, display: 'block' }}>
        <span className="sr-only">{label}</span>
        <input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="adm-focusable"
            style={{
                width: '100%', padding: '8px 34px 8px 12px', fontSize: '.85rem', fontWeight: 600,
                borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
                background: 'var(--adm-surface)', color: 'var(--adm-fg)',
            }}
        />
        <span
            aria-hidden="true"
            style={{ position: 'absolute', insetInlineStart: 11, top: '50%', transform: 'translateY(-50%)', fontSize: '.85rem', opacity: .5, pointerEvents: 'none' }}
        >
            🔎
        </span>
    </label>
));
AdmSearch.displayName = 'AdmSearch';

export const AdmSelect = memo<{
    value: string;
    onChange: (v: string) => void;
    options: Array<{ value: string; label: string }>;
    label: string;
}>(({ value, onChange, options, label }) => (
    <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>{label}</span>
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="adm-focusable"
            style={{
                padding: '7px 10px', fontSize: '.82rem', fontWeight: 700,
                borderRadius: 'var(--adm-r-sm)', border: '1px solid var(--adm-border)',
                background: 'var(--adm-surface)', color: 'var(--adm-fg)', minWidth: 120,
            }}
        >
            {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
            ))}
        </select>
    </label>
));
AdmSelect.displayName = 'AdmSelect';

export const AdmToolbar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
        {children}
    </div>
);

// ═══════════════════════════════════════════════════════════════════════════
// الفترة الزمنية — واحدةٌ بدل ثمانٍ
// ═══════════════════════════════════════════════════════════════════════════

export interface AdmRange { from: string; to: string }

/** اختصاراتٌ يقيسها الجميع بنفس الطريقة (اليوم = آخر ٠ أيام، أي اليوم نفسه). */
export const RANGE_PRESETS: Array<{ id: string; label: string; days: number }> = [
    { id: 'd1', label: 'اليوم', days: 0 },
    { id: 'd7', label: '٧ أيام', days: 6 },
    { id: 'd30', label: '٣٠ يوماً', days: 29 },
    { id: 'd90', label: '٩٠ يوماً', days: 89 },
];

/**
 * يبني فترةً من عدد أيام **بتوقيت الجهاز** لا UTC.
 * 🪤 `toISOString()` يرجع التاريخ يوماً إلى الوراء لمن شرق غرينتش (درس
 *    مسجَّل في القواعد) — والسعودية +٣. لذلك التنسيق يدويٌّ من الحقول المحلّية.
 */
export function rangeFromDays(days: number, now: Date): AdmRange {
    const fmt = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const from = new Date(to);
    from.setDate(from.getDate() - days);
    return { from: fmt(from), to: fmt(to) };
}

/**
 * `Date` ⇐ قيمة `<input type="date">` **بتوقيت الجهاز**.
 * 🪤 لا `toISOString()` هنا: يرجع يوماً للوراء لمن شرق غرينتش (السعودية +٣) —
 *    فخٌّ مسجَّل، وقع في أكثر من شاشة.
 */
export function toDateInput(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const AdmDateRange: React.FC<{
    value: AdmRange;
    onChange: (r: AdmRange) => void;
    /** أقصى فترة مسموحة بالأيام (لحماية استعلامات ثقيلة) */
    maxDays?: number;
}> = ({ value, onChange, maxDays }) => {
    // 🪤 التاريخان معكوسين يُنتجان فترةً فارغة بصمت — تُصحَّح هنا لا في كل مُنادٍ.
    const invalid = useMemo(() => !!value.from && !!value.to && value.from > value.to, [value.from, value.to]);

    const setPreset = (days: number) => {
        onChange(rangeFromDays(days, new Date()));
    };

    return (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {RANGE_PRESETS.filter((p) => !maxDays || p.days < maxDays).map((p) => (
                    <button
                        key={p.id}
                        type="button"
                        onClick={() => setPreset(p.days)}
                        className="adm-focusable"
                        style={{
                            padding: '6px 11px', fontSize: '.76rem', fontWeight: 800,
                            borderRadius: 999, border: '1px solid var(--adm-border)',
                            background: 'var(--adm-surface-2)', color: 'var(--adm-fg-2)', cursor: 'pointer',
                        }}
                    >
                        {p.label}
                    </button>
                ))}
            </div>
            <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>من</span>
                <input
                    type="date"
                    value={value.from}
                    max={value.to || undefined}
                    onChange={(e) => onChange({ ...value, from: e.target.value })}
                    className="adm-focusable"
                    style={{
                        padding: '6px 9px', fontSize: '.8rem', fontWeight: 700, borderRadius: 'var(--adm-r-sm)',
                        border: `1px solid ${invalid ? 'var(--adm-bad-fg)' : 'var(--adm-border)'}`,
                        background: 'var(--adm-surface)', color: 'var(--adm-fg)',
                    }}
                />
            </label>
            <label style={{ display: 'inline-flex', flexDirection: 'column', gap: 3 }}>
                <span style={{ fontSize: '.68rem', fontWeight: 800, color: 'var(--adm-fg-3)' }}>إلى</span>
                <input
                    type="date"
                    value={value.to}
                    min={value.from || undefined}
                    onChange={(e) => onChange({ ...value, to: e.target.value })}
                    className="adm-focusable"
                    style={{
                        padding: '6px 9px', fontSize: '.8rem', fontWeight: 700, borderRadius: 'var(--adm-r-sm)',
                        border: `1px solid ${invalid ? 'var(--adm-bad-fg)' : 'var(--adm-border)'}`,
                        background: 'var(--adm-surface)', color: 'var(--adm-fg)',
                    }}
                />
            </label>
            {invalid && (
                <span style={{ fontSize: '.74rem', fontWeight: 800, color: 'var(--adm-bad-fg)', alignSelf: 'center' }}>
                    تاريخ البداية بعد النهاية — بدّلهما.
                </span>
            )}
        </div>
    );
};
