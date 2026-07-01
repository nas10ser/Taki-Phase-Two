import { useEffect, useState } from 'react';

/**
 * useNowTick — returns a number that advances every `intervalMs`, but ONLY
 * while the tab is visible. Add it to a `useMemo` dependency array to force a
 * list to re-evaluate time-based predicates (e.g. `isDealExpiredByTime`) so a
 * deal that crosses its expiry disappears on its own — no data change, no
 * network round-trip, no waiting for a background timer that iOS Safari may
 * have paused.
 *
 * It's deliberately cheap: a single integer state and a paused-in-background
 * interval. Recomputing a filter over a few dozen deals every ~15s is
 * negligible, and it stops entirely when the page is hidden.
 */
export function useNowTick(intervalMs: number = 15000): number {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let timer: ReturnType<typeof setInterval> | null = null;

        const start = () => {
            if (timer) return;
            timer = setInterval(() => setTick(t => t + 1), intervalMs);
        };
        const stop = () => {
            if (timer) { clearInterval(timer); timer = null; }
        };

        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                // Re-evaluate immediately on return, then resume ticking.
                setTick(t => t + 1);
                start();
            } else {
                stop();
            }
        };

        if (document.visibilityState === 'visible') start();
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [intervalMs]);

    return tick;
}
