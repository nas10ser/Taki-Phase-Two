// The four location packages. `max` is the number of DISTINCT active-deal
// locations the store may run at once — enforced both client-side and by the
// `enforce_seller_location_cap` DB trigger (reads store_profiles.max_branches).
// Admin sets a store's package from the Admin → Sellers subscription modal.
export interface LocationPackage {
    id: 1 | 2 | 3 | 4;
    max: number;
    ar: string;
    en: string;
    descAr: string;
    descEn: string;
}

export const LOCATION_PACKAGES: LocationPackage[] = [
    { id: 1, max: 1,  ar: 'الباقة الأولى',  en: 'Package 1', descAr: 'موقع واحد فقط',        descEn: '1 location only' },
    { id: 2, max: 3,  ar: 'الباقة الثانية', en: 'Package 2', descAr: 'حتى 3 مواقع',          descEn: 'up to 3 locations' },
    { id: 3, max: 6,  ar: 'الباقة الثالثة', en: 'Package 3', descAr: 'حتى 6 مواقع',          descEn: 'up to 6 locations' },
    { id: 4, max: 10, ar: 'الباقة الرابعة', en: 'Package 4', descAr: 'حتى 10 مواقع',         descEn: 'up to 10 locations' },
];

export const DEFAULT_MAX_LOCATIONS = 3;

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
