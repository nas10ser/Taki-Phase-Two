/**
 * TAKI Shared Utility Functions
 * Centralized helpers to eliminate code duplication across the app.
 */

import { Deal, LOCATIONS, CITIES, findNearestCity } from '../data/mock';

/**
 * Returns { region, city } for a deal. Priority:
 *   1. Denormalized columns on the deal (deal.region, deal.city) — set
 *      at create-time for new deals.
 *   2. LOCATIONS → CITIES chain — works for legacy deals whose
 *      locationId is a valid mall/market entry.
 *   3. Map coords + findNearestCity — last-resort geo lookup so that
 *      old `custom_<ts>` rows still get classified.
 *
 * Centralized so every filter call site agrees on what region a deal
 * belongs to. Without this, filters disagreed and deals with custom
 * locations silently vanished from region/city cuts.
 */
export const resolveDealLocation = (deal: Deal): { regionId?: string; cityId?: string } => {
    if (deal.region || deal.city) {
        return { regionId: deal.region, cityId: deal.city };
    }
    const loc = LOCATIONS.find(l => l.id === deal.locationId);
    if (loc) {
        const city = CITIES.find(c => c.id === loc.cityId);
        return { regionId: city?.regionId, cityId: loc.cityId };
    }
    if (deal.mapLocation) {
        const nearest = findNearestCity(deal.mapLocation.lat, deal.mapLocation.lng);
        if (nearest) return { regionId: nearest.regionId, cityId: nearest.id };
    }
    return {};
};

/**
 * True if `deal` matches the location filter (region/city/mall). Falsy
 * filter values mean "no constraint". Mall is checked against
 * deal.locationId directly since malls are concrete LOCATIONS entries.
 */
export const dealMatchesLocation = (
    deal: Deal,
    filter: { region?: string; city?: string; mall?: string }
): boolean => {
    if (filter.mall && deal.locationId !== filter.mall) return false;
    if (filter.city || filter.region) {
        const { regionId, cityId } = resolveDealLocation(deal);
        if (filter.city && cityId !== filter.city) return false;
        if (filter.region && regionId !== filter.region) return false;
    }
    return true;
};

// =========================================================================
// Coming Soon (v11.20) — A scheduled deal lives in three phases:
//   1. Hidden       — startsAt > now + 7 days   (only merchant sees it)
//   2. Coming Soon  — now < startsAt ≤ now + 7d  (shown on Home, locked)
//   3. Live         — startsAt ≤ now             (normal active deal)
// `null/undefined` startsAt = legacy behavior (always live from createdAt).
// =========================================================================
export const COMING_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
export const COMING_SOON_URGENT_MS = 4 * 60 * 60 * 1000;        // 4 hours
export const COMING_SOON_MAX_LEAD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** True if the deal has a future startsAt — i.e. not yet bookable. */
export const isDealComingSoon = (deal: Deal): boolean => {
    return typeof deal.startsAt === 'number' && deal.startsAt > Date.now();
};

/** True if the deal is in its public 7-day countdown window
 *  (visible on Home + StoreDetails but locked from booking). */
export const isDealVisibleComingSoon = (deal: Deal): boolean => {
    if (typeof deal.startsAt !== 'number') return false;
    const now = Date.now();
    return deal.startsAt > now && deal.startsAt <= now + COMING_SOON_WINDOW_MS;
};

/** True if the deal is scheduled further than 7 days out — merchant
 *  prep mode; not shown to buyers yet. */
export const isDealScheduledHidden = (deal: Deal): boolean => {
    if (typeof deal.startsAt !== 'number') return false;
    return deal.startsAt > Date.now() + COMING_SOON_WINDOW_MS;
};

/** True if the deal is in the last 4 hours of its coming-soon window
 *  (countdown turns red). */
export const isComingSoonUrgent = (deal: Deal): boolean => {
    if (typeof deal.startsAt !== 'number') return false;
    const diff = deal.startsAt - Date.now();
    return diff > 0 && diff <= COMING_SOON_URGENT_MS;
};

/** The timestamp the deal's lifespan should be measured from. For legacy
 *  deals (no startsAt) this is just createdAt. For scheduled deals the
 *  expiry clock only begins ticking the moment the deal goes live, NOT
 *  from publish time — otherwise a "2-hour" deal scheduled a week out
 *  would be born already expired. */
export const dealLifespanStart = (deal: Deal): number => {
    return typeof deal.startsAt === 'number' ? Math.max(deal.startsAt, deal.createdAt || 0) : (deal.createdAt || 0);
};

/** Effective expiry timestamp (ms). Combines startsAt + expiresInMinutes
 *  so callers don't have to reproduce the lifespan-start logic. */
export const dealExpiryTs = (deal: Deal): number => {
    return dealLifespanStart(deal) + (deal.expiresInMinutes || 0) * 60 * 1000;
};

/** Format the remaining time until startsAt — same shape as the live-deal
 *  countdown so the two read consistently. */
export const formatComingSoonRemaining = (
    startsAt: number,
    isRTL: boolean
): { text: string; urgent: boolean; ready: boolean } => {
    const diff = startsAt - Date.now();
    if (diff <= 0) return { text: isRTL ? 'متاح الآن' : 'Live now', urgent: false, ready: true };

    const days = Math.floor(diff / 86400000);
    const hours = Math.floor((diff / 3600000) % 24);
    const mins = Math.floor((diff / 60000) % 60);
    const secs = Math.floor((diff / 1000) % 60);
    const urgent = diff <= COMING_SOON_URGENT_MS;

    if (days > 0) return { text: isRTL ? `${days}ي ${hours}س` : `${days}d ${hours}h`, urgent: false, ready: false };
    if (hours > 0) return { text: isRTL ? `${hours}س ${mins}د` : `${hours}h ${mins}m`, urgent, ready: false };
    if (mins > 0) return { text: isRTL ? `${mins}د ${secs.toString().padStart(2,'0')}ث` : `${mins}m ${secs}s`, urgent: true, ready: false };
    return { text: isRTL ? `${secs}ث` : `${secs}s`, urgent: true, ready: false };
};

/**
 * Normalizes Arabic/Eastern numerals (٠١٢٣٤٥٦٧٨٩) to Western (0123456789).
 * Essential for Saudi users typing on Arabic keyboards.
 */
export const normalizeArabicNumerals = (input: string): string => {
    const arabicNumerals = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
    let result = input;
    arabicNumerals.forEach((an, i) => {
        result = result.replace(new RegExp(an, 'g'), i.toString());
    });
    return result;
};

/**
 * Calculates the Haversine distance between two geographic coordinates.
 * @returns Distance in kilometers
 */
export const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

/**
 * Proximity TIER of a deal relative to the customer's home city. Lower =
 * closer/more relevant. Used on Home to surface the customer's city first,
 * then progressively wider rings — WITHOUT hard-cutting at the city border
 * (that strict-distance behaviour is the Nearby page's job). Coarse buckets
 * (not exact km) so ordering stays "nearest-ish first, then by section
 * ranking" rather than a rigid distance sort.
 *
 *   0 = same city            1 = same region (e.g. المخواة → بلجرشي/قلوة/الباحة)
 *   2 = < 150 km             3 = < 400 km            4 = farther
 *   5 = city known, no geo   6 = location unknown (always last)
 *
 * Returns 0 for everything when no home city is set (no reordering).
 */
export const dealProximityTier = (
    deal: Deal,
    home: { regionId?: string; cityId?: string } | null | undefined
): number => {
    if (!home || !home.cityId) return 0;
    const { regionId, cityId } = resolveDealLocation(deal);
    if (!cityId && !regionId) return 6;
    if (cityId && cityId === home.cityId) return 0;
    if (regionId && home.regionId && regionId === home.regionId) return 1;
    const hc = CITIES.find(c => c.id === home.cityId);
    const dc = cityId ? CITIES.find(c => c.id === cityId) : undefined;
    if (hc && dc) {
        const km = getDistance(hc.lat, hc.lng, dc.lat, dc.lng);
        if (km < 150) return 2;
        if (km < 400) return 3;
        return 4;
    }
    return 5;
};

/**
 * Generates a random alphanumeric barcode string.
 * Excludes confusing characters (0/O, 1/I/L).
 * Uses Web Crypto API for cryptographically strong randomness.
 */
export const generateBarcode = (length: number = 8): string => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const randomValues = new Uint32Array(length);
    crypto.getRandomValues(randomValues);
    let barcode = '';
    for (let i = 0; i < length; i++) {
        barcode += chars.charAt(randomValues[i] % chars.length);
    }
    return barcode;
};

/**
 * Converts a Gregorian date string (YYYY-MM-DD) to a Hijri formatted string.
 */
export const toHijri = (dateStr: string): string => {
    if (!dateStr) return '';
    try {
        const date = new Date(dateStr);
        const formatter = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-uma', {
            day: 'numeric',
            month: 'long',
            year: 'numeric'
        });
        return formatter.format(date);
    } catch (e) {
        return '';
    }
};

/**
 * Creates a bilingual text helper function.
 * @param isRTL Whether the current language is Arabic
 */
export const createT = (isRTL: boolean) => (ar: string, en: string): string => isRTL ? ar : en;

// PWA standalone (iOS Safari add-to-homescreen, Android TWA) blocks `window.open`
// silently. A programmatically-clicked anchor delegates to the OS URL handler,
// which opens the default browser instead.
export const openExternalUrl = (url: string): void => {
    try {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    } catch {
        window.location.href = url;
    }
};

// Promise wrapper that rejects after `ms` if the inner promise hasn't settled.
// Used to put a ceiling on DB writes so a flaky mobile network or a hung
// Supabase auth refresh can't leave a save button spinning forever — the
// spinner stops, the user sees a clear "try again" toast, and the form
// becomes interactive again.
export class TimeoutError extends Error {
    constructor(ms: number) {
        super(`Operation exceeded ${ms}ms timeout`);
        this.name = 'TimeoutError';
    }
}

export const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
        promise.then(
            (v) => { clearTimeout(timer); resolve(v); },
            (e) => { clearTimeout(timer); reject(e); }
        );
    });
};

// Allow only digits and at most one decimal point. Keeps the half-typed
// "16." state so the user can finish typing "16.50" without the field
// fighting them. The Saudi Halala is 1/100 of a Riyal — we never need
// more than 2 fractional digits, but we don't truncate here; the final
// price is stored in DB as NUMERIC which preserves whatever precision
// was entered.
export const sanitizeDecimalInput = (raw: string): string => {
    let v = raw.replace(/[^\d.]/g, '');
    // Collapse multiple dots to one (keep the first).
    const firstDot = v.indexOf('.');
    if (firstDot !== -1) {
        v = v.slice(0, firstDot + 1) + v.slice(firstDot + 1).replace(/\./g, '');
    }
    // Cap fractional digits at 2 (halalas), but only after at least one
    // decimal digit is typed so "16." stays "16." while typing.
    const m = v.match(/^(\d*)\.(\d*)$/);
    if (m && m[2].length > 2) {
        v = `${m[1]}.${m[2].slice(0, 2)}`;
    }
    return v;
};
