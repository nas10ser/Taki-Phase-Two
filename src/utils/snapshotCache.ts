/**
 * Snapshot cache — stale-while-revalidate render cache.
 *
 * The Supabase project lives in ap-northeast-1 (Tokyo); users are in
 * Saudi Arabia. Every REST/Realtime round-trip is ~300-500 ms from a
 * KSA phone, and the cold-load path makes several of them, so a fresh
 * fetch can take 6-7 s before anything paints.
 *
 * This cache makes the FIRST paint instant: the last data the user saw
 * is persisted to localStorage and re-hydrated synchronously on the
 * next app open, BEFORE any network call. The live fetch still runs in
 * the background and overwrites state the moment it lands — the server
 * is always authoritative, the snapshot is never trusted as truth. It
 * only removes the blank-screen wait, exactly like SWR / TanStack Query
 * persistence.
 *
 * Safety:
 *  - schema-versioned: a shape change invalidates every old snapshot.
 *  - TTL bounded: a snapshot older than the TTL is ignored.
 *  - user-scoped keys: per-user lists are keyed by uid so account
 *    switching can never show the previous account's data.
 *  - fully wrapped in try/catch: private mode / quota / disabled
 *    storage degrades to "no cache", never throws.
 */

const PREFIX = 'taki_snap_';
const SCHEMA = 'v1';
// Purely a render cache; the live fetch always revalidates. A generous
// TTL is fine — it just bounds how stale the very first paint can be
// before we fall back to the spinner.
const TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

interface Envelope<T> {
    s: string;
    t: number;
    d: T;
}

export function readSnapshot<T>(key: string): T | null {
    try {
        const raw = localStorage.getItem(PREFIX + key);
        if (!raw) return null;
        const env = JSON.parse(raw) as Envelope<T>;
        if (!env || env.s !== SCHEMA) return null;
        if (Date.now() - env.t > TTL_MS) return null;
        return env.d;
    } catch {
        return null;
    }
}

export function writeSnapshot(key: string, data: unknown): void {
    try {
        const env: Envelope<unknown> = { s: SCHEMA, t: Date.now(), d: data };
        localStorage.setItem(PREFIX + key, JSON.stringify(env));
    } catch {
        // Quota exceeded / private mode / storage disabled — the cache is
        // best-effort; losing it only means the next open shows a spinner.
    }
}

/**
 * Clear snapshots. With no argument, clears every snapshot (used on
 * sign-out so a shared device never leaks the previous account). With a
 * key fragment, clears only matching entries.
 */
export function clearSnapshots(keyFragment?: string): void {
    try {
        const toRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith(PREFIX)) continue;
            if (!keyFragment || k.includes(keyFragment)) toRemove.push(k);
        }
        toRemove.forEach(k => localStorage.removeItem(k));
    } catch {
        /* ignore */
    }
}
