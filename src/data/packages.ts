// Location/subscription packages. `max` is the number of DISTINCT active-deal
// locations the store may run at once — enforced both client-side and by the
// `enforce_seller_location_cap` DB trigger (reads store_profiles.max_branches).
//
// v11.36 — packages now carry MONTHLY PRICING (price + discount + duration).
// The admin edits every package's price/locations/discount/label freely from
// Admin → Sellers → "💎 باقات المواقع والأسعار". The live values are stored in
// platform_settings.location_packages (see packageRepository) — these defaults
// are only the seed / offline fallback.
export interface LocationPackage {
    id: number;
    max: number;            // allowed distinct active locations
    price: number;          // monthly price in SAR (before discount)
    discount: number;       // percent 0..100 off the monthly price
    durationDays: number;   // billing period length (default 30 = monthly)
    ar: string;
    en: string;
    descAr: string;
    descEn: string;
    active: boolean;        // hidden from merchants when false
}

export const DEFAULT_LOCATION_PACKAGES: LocationPackage[] = [
    { id: 1, max: 1,  price: 200, discount: 0, durationDays: 30, ar: 'الباقة الأولى',  en: 'Package 1', descAr: 'موقع واحد فقط', descEn: '1 location only', active: true },
    { id: 2, max: 3,  price: 250, discount: 0, durationDays: 30, ar: 'الباقة الثانية', en: 'Package 2', descAr: 'حتى 3 مواقع',   descEn: 'up to 3 locations',  active: true },
    { id: 3, max: 6,  price: 300, discount: 0, durationDays: 30, ar: 'الباقة الثالثة', en: 'Package 3', descAr: 'حتى 6 مواقع',   descEn: 'up to 6 locations',  active: true },
    { id: 4, max: 10, price: 350, discount: 0, durationDays: 30, ar: 'الباقة الرابعة', en: 'Package 4', descAr: 'حتى 10 مواقع',  descEn: 'up to 10 locations', active: true },
    { id: 5, max: 15, price: 400, discount: 0, durationDays: 30, ar: 'الباقة الخامسة', en: 'Package 5', descAr: 'حتى 15 موقع',   descEn: 'up to 15 locations', active: true },
    { id: 6, max: 20, price: 450, discount: 0, durationDays: 30, ar: 'الباقة السادسة', en: 'Package 6', descAr: 'حتى 20 موقع',   descEn: 'up to 20 locations', active: true },
];

// Backward-compatible alias: existing call sites import LOCATION_PACKAGES as the
// catalogue for label/max lookups. These stay the defaults; live PRICES come
// from packageRepository (platform_settings).
export const LOCATION_PACKAGES: LocationPackage[] = DEFAULT_LOCATION_PACKAGES;

export const DEFAULT_MAX_LOCATIONS = 3;

/** Monthly price after the package's own discount, rounded to whole SAR. */
export const effectivePrice = (p: { price: number; discount?: number }): number =>
    Math.max(0, Math.round((Number(p.price) || 0) * (1 - (Number(p.discount) || 0) / 100)));

export const maxForPackage = (id: number): number =>
    LOCATION_PACKAGES.find(p => p.id === id)?.max ?? DEFAULT_MAX_LOCATIONS;

/** Closest package for a raw max_branches value (for display + admin default). */
export const packageForMax = (max: number | null | undefined): LocationPackage => {
    const m = max ?? DEFAULT_MAX_LOCATIONS;
    return LOCATION_PACKAGES.find(p => p.max === m)
        ?? [...LOCATION_PACKAGES].reverse().find(p => p.max <= m)
        ?? LOCATION_PACKAGES[1];
};

/** Human label for a raw max value: package name if it matches a tier. */
export const packageLabel = (max: number | null | undefined, isRTL: boolean): string => {
    const m = max ?? DEFAULT_MAX_LOCATIONS;
    const exact = LOCATION_PACKAGES.find(p => p.max === m);
    if (exact) return isRTL ? exact.ar : exact.en;
    return isRTL ? `${m} مواقع` : `${m} locations`;
};

/** Arabic-Indic digits for display (e.g. 15 → ١٥) so cards never show Latin "0". */
const arNum = (n: number): string => Math.max(0, Math.round(n)).toLocaleString('ar-SA');

/**
 * Short branch-count label, grammatically graceful in Arabic
 * (فرع واحد / فرعان / X فروع / X فرعاً). e.g. branchesShort(15,true) → "١٥ فرعاً".
 */
export const branchesShort = (n: number, isRTL: boolean): string => {
    const m = Math.max(1, Math.round(n));
    if (!isRTL) return m === 1 ? '1 branch' : `${m} branches`;
    if (m === 1) return 'فرع واحد';
    if (m === 2) return 'فرعان';
    if (m <= 10) return `${arNum(m)} فروع`;
    return `${arNum(m)} فرعاً`;
};

/**
 * Detailed, customer-facing label that spells out a "موقع" = a DISTINCT
 * geographic branch (Nasser's request — buyers were unsure what a location
 * meant, and a Latin "0" looked like Arabic "٥"). Always includes the count.
 * e.g. "١٥ فرعاً (١٥ موقعاً جغرافياً مختلفاً)".
 */
export const branchesDetailed = (n: number, isRTL: boolean): string => {
    const m = Math.max(1, Math.round(n));
    if (!isRTL) return m === 1 ? '1 branch (1 distinct location)' : `${m} branches (${m} distinct locations)`;
    if (m === 1) return 'فرع واحد (موقع جغرافي واحد)';
    if (m === 2) return 'فرعان (موقعان جغرافيان مختلفان)';
    if (m <= 10) return `${arNum(m)} فروع (${arNum(m)} مواقع جغرافية مختلفة)`;
    return `${arNum(m)} فرعاً (${arNum(m)} موقعاً جغرافياً مختلفاً)`;
};
