/**
 * useKpiSnapshot — persist one KPI snapshot per calendar day in localStorage,
 * and surface yesterday's snapshot for trend comparisons.
 *
 * Why client-side: the existing `get_live_stats` RPC returns "today so far"
 * counters but no historical baseline. Adding a DB-side trend RPC would
 * require new migrations + indexes; for an admin dashboard that's
 * over-engineered. localStorage built up over a few days gives us the
 * "vs yesterday" signal admins actually want, with zero backend changes.
 *
 * Caveats:
 *  - Trend only appears after at least one full day of admin visits.
 *  - The snapshot stores values "as of last visit today", so the delta is
 *    "today so far vs yesterday's final value" — labelled "أمس" to match.
 *  - First-time admins see "—" until tomorrow's first visit.
 */

import { useEffect, useMemo } from 'react';

export interface KpiSnapshotPayload {
    bookings_today: number;
    new_users_today: number;
    mrr: number;
    paying_sellers: number;
    active_users: number;
    at: number;
}

const PREFIX = 'taki:admin:kpi:';

function dateKey(d: Date = new Date()): string {
    // YYYY-MM-DD in local time (admin's timezone). The day boundary that
    // matters for "today vs yesterday" is the admin's perceived day.
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function readSnapshot(key: string): KpiSnapshotPayload | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(PREFIX + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed !== 'object' || parsed === null) return null;
        return parsed as KpiSnapshotPayload;
    } catch {
        return null;
    }
}

function writeSnapshot(key: string, payload: KpiSnapshotPayload) {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(PREFIX + key, JSON.stringify(payload));
    } catch {
        // Quota — ignore.
    }
}

export interface KpiDelta {
    today: number;
    yesterday: number | null;
    diff: number | null;
    /** % change vs yesterday — null when we have no baseline yet. */
    pct: number | null;
}

export function useKpiSnapshot(stats: {
    bookings_today: number;
    new_users_today: number;
    mrr: number;
    paying_sellers: number;
    active_users: number;
} | null): {
    deltas: {
        bookings: KpiDelta;
        new_users: KpiDelta;
        mrr: KpiDelta;
    };
    hasBaseline: boolean;
} {
    // Whenever stats change, overwrite today's snapshot. This means we
    // always have the latest "today so far" value persisted; yesterday's
    // snapshot is naturally frozen because we only ever write to today's key.
    useEffect(() => {
        if (!stats) return;
        writeSnapshot(dateKey(), {
            bookings_today: stats.bookings_today ?? 0,
            new_users_today: stats.new_users_today ?? 0,
            mrr: stats.mrr ?? 0,
            paying_sellers: stats.paying_sellers ?? 0,
            active_users: stats.active_users ?? 0,
            at: Date.now(),
        });
    }, [stats]);

    const yesterday = useMemo(() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return readSnapshot(dateKey(d));
    }, [stats?.bookings_today, stats?.mrr, stats?.new_users_today]);

    const deltas = useMemo(() => {
        const make = (todayVal: number, key: keyof KpiSnapshotPayload): KpiDelta => {
            if (!yesterday) return { today: todayVal, yesterday: null, diff: null, pct: null };
            const y = (yesterday as any)[key] ?? 0;
            const diff = todayVal - y;
            const pct = y === 0 ? (todayVal === 0 ? 0 : 100) : Math.round((diff / y) * 100);
            return { today: todayVal, yesterday: y, diff, pct };
        };
        return {
            bookings: make(stats?.bookings_today ?? 0, 'bookings_today'),
            new_users: make(stats?.new_users_today ?? 0, 'new_users_today'),
            mrr: make(stats?.mrr ?? 0, 'mrr'),
        };
    }, [stats, yesterday]);

    return { deltas, hasBaseline: yesterday !== null };
}

export default useKpiSnapshot;
