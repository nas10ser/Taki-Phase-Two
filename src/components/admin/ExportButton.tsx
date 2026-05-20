/**
 * ExportButton — small "download as CSV" trigger used by admin lists.
 *
 * Disabled when there's nothing to export. Shows a tooltip explaining
 * what will be exported (the *currently visible* list, not the whole
 * database). Plays a brief "✓" confirmation after the download fires.
 */

import React, { useState } from 'react';
import { Tooltip } from './Tooltip';
import { CsvColumn, downloadCsv } from '../../utils/csvExport';

interface ExportButtonProps<T> {
    rows: T[];
    columns: CsvColumn<T>[];
    filenameStem: string;
    label?: string;
    tooltip?: string;
    accent?: 'emerald' | 'blue' | 'purple';
}

export function ExportButton<T>({
    rows,
    columns,
    filenameStem,
    label = 'تصدير CSV',
    tooltip,
    accent = 'emerald',
}: ExportButtonProps<T>) {
    const [done, setDone] = useState(false);
    const empty = rows.length === 0;

    const onClick = () => {
        if (empty) return;
        const ok = downloadCsv(filenameStem, rows, columns);
        if (ok) {
            setDone(true);
            window.setTimeout(() => setDone(false), 1600);
        }
    };

    const accentMap: Record<string, string> = {
        emerald: 'border-emerald-300 text-emerald-700 hover:bg-emerald-50',
        blue: 'border-blue-300 text-blue-700 hover:bg-blue-50',
        purple: 'border-purple-300 text-purple-700 hover:bg-purple-50',
    };

    const button = (
        <button
            type="button"
            onClick={onClick}
            disabled={empty}
            aria-label={label}
            className={`inline-flex items-center gap-1.5 px-3 h-10 rounded-xl text-sm font-bold transition-all bg-[var(--card-bg)] border ${accentMap[accent]} disabled:opacity-40 disabled:cursor-not-allowed`}
        >
            <span>{done ? '✓' : '📥'}</span>
            <span>{done ? 'تم التنزيل' : label}</span>
            {!empty && !done && (
                <span className="text-[10px] bg-[var(--gray-100)] text-[var(--text-secondary)] px-1.5 py-0.5 rounded tabular-nums">
                    {rows.length}
                </span>
            )}
        </button>
    );

    return tooltip ? <Tooltip text={tooltip}>{button}</Tooltip> : button;
}

export default ExportButton;
