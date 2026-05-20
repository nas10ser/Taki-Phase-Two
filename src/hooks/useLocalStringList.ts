/**
 * useLocalStringList — small localStorage-backed list of strings.
 *
 * Used for "recently viewed" and "pinned" admin items. Caps at `maxItems`
 * (most-recent first for recents, insertion order for pins). Returns
 * stable callbacks so consumers can pass them to memoized children
 * without surprise re-renders.
 *
 * Storage is silently best-effort: if localStorage is unavailable
 * (private mode, quota exceeded) the list still works in memory.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

interface Options {
    maxItems?: number;
    /** If true, adding an existing item moves it to the front (recency). */
    moveToFront?: boolean;
}

export function useLocalStringList(
    storageKey: string,
    { maxItems = 10, moveToFront = false }: Options = {},
): {
    list: string[];
    add: (item: string) => void;
    remove: (item: string) => void;
    toggle: (item: string) => void;
    has: (item: string) => boolean;
    clear: () => void;
} {
    const [list, setList] = useState<string[]>(() => {
        if (typeof window === 'undefined') return [];
        try {
            const raw = window.localStorage.getItem(storageKey);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
        } catch {
            return [];
        }
    });

    // Persist whenever the list changes.
    const firstRun = useRef(true);
    useEffect(() => {
        if (firstRun.current) { firstRun.current = false; return; }
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(list));
        } catch {
            // Quota — ignore.
        }
    }, [list, storageKey]);

    const add = useCallback((item: string) => {
        if (!item) return;
        setList((prev) => {
            const exists = prev.includes(item);
            if (exists && !moveToFront) return prev;
            const without = exists ? prev.filter((v) => v !== item) : prev;
            const next = [item, ...without];
            return next.slice(0, maxItems);
        });
    }, [maxItems, moveToFront]);

    const remove = useCallback((item: string) => {
        setList((prev) => prev.filter((v) => v !== item));
    }, []);

    const toggle = useCallback((item: string) => {
        setList((prev) => (
            prev.includes(item)
                ? prev.filter((v) => v !== item)
                : [item, ...prev].slice(0, maxItems)
        ));
    }, [maxItems]);

    const has = useCallback((item: string) => list.includes(item), [list]);
    const clear = useCallback(() => setList([]), []);

    return { list, add, remove, toggle, has, clear };
}

export default useLocalStringList;
