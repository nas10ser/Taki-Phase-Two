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
