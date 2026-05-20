/**
 * TrendChip — small "↑ 12% vs أمس" badge that goes inside a KPI card.
 *
 * Reads a delta produced by useKpiSnapshot and renders one of three states:
 *  - no baseline yet → "—"
 *  - positive       → green ↑
 *  - negative       → red   ↓
 *  - flat           → gray  →
 */

import React from 'react';
import { Tooltip } from './Tooltip';
import { KpiDelta } from '../../hooks/useKpiSnapshot';

interface TrendChipProps {
    delta: KpiDelta;
    /** Whether higher is better for this metric (true for almost all KPIs). */
    higherIsBetter?: boolean;
}

export const TrendChip: React.FC<TrendChipProps> = ({ delta, higherIsBetter = true }) => {
    if (delta.pct === null) {
        return (
            <Tooltip text="المقارنة مع الأمس ستظهر بعد أول زيارة في اليوم التالي">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-white/15 cursor-help">
                    — vs أمس
                </span>
            </Tooltip>
        );
    }
    const isUp = (delta.pct ?? 0) > 0;
    const isDown = (delta.pct ?? 0) < 0;
    const goodDirection = higherIsBetter ? isUp : isDown;
    const badDirection = higherIsBetter ? isDown : isUp;
    const arrow = isUp ? '↑' : isDown ? '↓' : '→';
    const cls = goodDirection
        ? 'bg-emerald-400/30 text-white'
        : badDirection
        ? 'bg-red-400/30 text-white'
        : 'bg-white/15 text-white/80';
    const pctAbs = Math.abs(delta.pct ?? 0);
    return (
        <Tooltip text={`اليوم: ${delta.today.toLocaleString('ar-SA')} · أمس: ${(delta.yesterday ?? 0).toLocaleString('ar-SA')}`}>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold ${cls} cursor-help`}>
                <span>{arrow}</span>
                <span className="tabular-nums">{pctAbs}%</span>
                <span className="opacity-80">vs أمس</span>
            </span>
        </Tooltip>
    );
};

export default TrendChip;
