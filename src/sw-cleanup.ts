/**
 * SW + Cache cleanup — fixes the "I refreshed and nothing changed" bug.
 *
 * Background: an earlier sw.js used cache-first for navigations and asset
 * requests. When we ship a new build, phones that have the old SW still
 * serve the OLD index.html (and therefore old JS hashes), so users get
 * frozen on the previous version even after a reload.
 *
 * What this does on every page load:
 *   1. Unregisters every active service worker.
 *   2. Deletes every CacheStorage entry left behind.
 *   3. If anything was actually purged AND we haven't reloaded yet this
 *      session, force ONE reload so the next paint comes from the
 *      network, not the now-empty cache.
 *
 * The session sentinel prevents infinite reload loops.
 */

const RELOAD_SENTINEL = 'TAKI_SW_CLEANED_v10';

(async () => {
    if (typeof window === 'undefined') return;

    let purgedSomething = false;

    // 1) Unregister all SWs
    if ('serviceWorker' in navigator) {
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const reg of regs) {
                await reg.unregister().catch(() => {});
                purgedSomething = true;
            }
        } catch { /* ignore */ }
    }

    // 2) Wipe CacheStorage
    if ('caches' in window) {
        try {
            const keys = await caches.keys();
            if (keys.length > 0) {
                purgedSomething = true;
                await Promise.all(keys.map((k) => caches.delete(k).catch(() => false)));
            }
        } catch { /* ignore */ }
    }

    // 3) One-shot reload so the freshly-empty browser fetches the new build
    if (purgedSomething && !sessionStorage.getItem(RELOAD_SENTINEL)) {
        try { sessionStorage.setItem(RELOAD_SENTINEL, '1'); } catch { /* private mode */ }
        // Replace so this reload doesn't add a back-button entry
        window.location.replace(window.location.href);
    }
})();
