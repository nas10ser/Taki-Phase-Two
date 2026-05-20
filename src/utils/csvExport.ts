/**
 * csvExport — download a 2D table as a UTF-8 CSV file.
 *
 * Used by the admin tabs to dump the currently visible list (buyers,
 * sellers, top performers) into Excel/Numbers. Adds a BOM so the file
 * opens cleanly with Arabic text in Excel for Windows — Excel uses the
 * BOM to detect UTF-8 instead of falling back to a legacy code page
 * that mangles RTL strings.
 */

type CellValue = string | number | boolean | null | undefined | Date;

export interface CsvColumn<T> {
    header: string;
    accessor: (row: T) => CellValue;
}

function escapeCell(value: CellValue): string {
    if (value === null || value === undefined) return '';
    let s: string;
    if (value instanceof Date) {
        s = isNaN(value.getTime()) ? '' : value.toISOString();
    } else {
        s = String(value);
    }
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
        s = `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

export function buildCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
    const lines: string[] = [];
    lines.push(columns.map((c) => escapeCell(c.header)).join(','));
    for (const row of rows) {
        lines.push(columns.map((c) => escapeCell(c.accessor(row))).join(','));
    }
    return lines.join('\r\n');
}

export function downloadCsv<T>(
    filenameStem: string,
    rows: T[],
    columns: CsvColumn<T>[],
): boolean {
    if (typeof window === 'undefined') return false;
    try {
        const csv = buildCsv(rows, columns);
        // UTF-8 BOM keeps Excel happy with Arabic.
        const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
        const stamp = new Date().toISOString().split('T')[0];
        const filename = `${filenameStem}-${stamp}.csv`;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        // Revoke after a tick so Safari has a chance to fetch the blob.
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        return true;
    } catch (err) {
        console.error('[csvExport]', err);
        return false;
    }
}
