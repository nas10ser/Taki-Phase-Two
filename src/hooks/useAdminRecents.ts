/**
 * useAdminRecents — track the last admin entities the user opened.
 *
 * Each entry is a compact snapshot (id, name, type, optional shop/phone)
 * so the palette and overview can render it without a second DB round-trip.
 * Capped at 8 items, most-recent first. Persisted in localStorage so the
 * list survives reloads.
 */

import { useState, useCallback, useEffect, useRef } from 'react';

export interface RecentEntity {
    id: string;
    name: string;
    type: 'buyer' | 'seller';
    shop?: string | null;
    phone?: string | null;
    at: number; // unix ms
}

const KEY = 'taki:admin:recents';
const MAX = 8;

function load(): RecentEntity[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((e: any) => e && typeof e.id === 'string' && typeof e.name === 'string')
            .slice(0, MAX);
    } catch {
        return [];
    }
}

export function useAdminRecents(): {
    recents: RecentEntity[];
    push: (entity: Omit<RecentEntity, 'at'>) => void;
    remove: (id: string) => void;
    clear: () => void;
} {
    const [recents, setRecents] = useState<RecentEntity[]>(() => load());

    const firstRun = useRef(true);
    useEffect(() => {
        if (firstRun.current) { firstRun.current = false; return; }
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(KEY, JSON.stringify(recents));
        } catch {}
    }, [recents]);

    // Cross-tab sync: when another tab updates the list, mirror it here so
    // the admin sees a coherent view across windows.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onStorage = (e: StorageEvent) => {
            if (e.key !== KEY) return;
            setRecents(load());
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const push = useCallback((entity: Omit<RecentEntity, 'at'>) => {
        if (!entity.id) return;
        setRecents((prev) => {
            const without = prev.filter((e) => e.id !== entity.id);
            const next: RecentEntity = { ...entity, at: Date.now() };
            return [next, ...without].slice(0, MAX);
        });
    }, []);

    const remove = useCallback((id: string) => {
        setRecents((prev) => prev.filter((e) => e.id !== id));
    }, []);

    const clear = useCallback(() => setRecents([]), []);

    return { recents, push, remove, clear };
}

export default useAdminRecents;
