/**
 * TAKI Shared Utility Functions
 * Centralized helpers to eliminate code duplication across the app.
 */

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
