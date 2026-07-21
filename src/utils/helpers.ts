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
// Official Sponsors (v11.23) — راعٍ رسمي
// An admin grants a store sponsor status with optional targeting + expiry.
// Sponsored deals render with a gold frame as ads, inserted after every
// SPONSOR_EVERY_N normal deals, ROTATING across all active sponsors (so with
// 20 sponsors each gets one slot before the cycle repeats). A sponsor may
// restrict where its ads appear (category / city / region / radius); outside
// that target its deals still appear normally but NOT as a gold ad.
// =========================================================================
export const SPONSOR_EVERY_N = 5; // one sponsor ad after every 5 normal deals

export type SponsorLabel = 'ad' | 'sponsor' | 'none' | 'star';

export interface Sponsor {
    storeId: string;
    isActive: boolean;
    targetCategory?: string | null;
    targetCity?: string | null;
    targetRegion?: string | null;
    targetLat?: number | null;
    targetLng?: number | null;
    targetRadiusKm?: number | null;
    priority: number;
    labelType?: SponsorLabel;   // 'ad' = إعلان, 'sponsor' = راعٍ رسمي, 'none' = frame only
    startsAt?: string | null;
    expiresAt?: string | null;
}

/** The Arabic/English label text for a sponsor card. '' = no text (frame only). */
export const sponsorLabelText = (label: SponsorLabel | undefined, isRTL: boolean): string => {
    const l = label || 'ad';
    // 'none' = gold frame only; 'star' = gold frame + a corner ⭐ badge
    // (rendered separately in DealCard) — neither shows a full text ribbon.
    if (l === 'none' || l === 'star') return '';
    if (l === 'sponsor') return isRTL ? 'راعٍ رسمي' : 'Official Sponsor';
    return isRTL ? 'إعلان' : 'Ad';
};

/** True if the sponsorship is live right now: active, started, not expired.
 *  A future `startsAt` means the gold ads don't begin until that date; a past
 *  `expiresAt` means they've ended. */
export const isSponsorActive = (s: Sponsor | undefined | null): boolean => {
    if (!s || !s.isActive) return false;
    const now = Date.now();
    if (s.startsAt && new Date(s.startsAt).getTime() > now) return false;
    if (s.expiresAt && new Date(s.expiresAt).getTime() <= now) return false;
    return true;
};

/**
 * Does this deal qualify to be shown as a GOLD sponsored ad, given the
 * sponsor's targeting? All unset axes mean "no restriction". Radius is only
 * applied when the sponsor set lat/lng + radius AND we know the deal's coords.
 */
export const dealMatchesSponsorTarget = (deal: Deal, s: Sponsor): boolean => {
    if (s.targetCategory && deal.category !== s.targetCategory && (deal.category as string) !== 'all') return false;
    if (s.targetCity || s.targetRegion) {
        const { regionId, cityId } = resolveDealLocation(deal);
        if (s.targetCity && cityId !== s.targetCity) return false;
        if (s.targetRegion && regionId !== s.targetRegion) return false;
    }
    if (s.targetLat != null && s.targetLng != null && s.targetRadiusKm != null && s.targetRadiusKm > 0) {
        const lat = deal.mapLocation?.lat;
        const lng = deal.mapLocation?.lng;
        if (typeof lat !== 'number' || typeof lng !== 'number') return false;
        if (getDistance(s.targetLat, s.targetLng, lat, lng) > s.targetRadiusKm) return false;
    }
    return true;
};

/**
 * Build the final list with sponsored ads interleaved. Pure + deterministic.
 *
 *  - `ranked` is the already-sorted list of NORMAL deals to display.
 *  - `sponsorMap` maps storeId → Sponsor.
 *  - A deal is an ad-candidate if its store is an active sponsor AND the deal
 *    matches that sponsor's targeting for the current view.
 *  - Ad-candidates are pulled OUT of the normal stream and re-inserted as gold
 *    ads after every SPONSOR_EVERY_N normal deals, rotating one sponsor STORE
 *    per slot (round-robin by priority desc) so no single sponsor dominates.
 *    When the sponsor rotation is exhausted it loops back to the start.
 *
 * Returns items tagged so the renderer knows which to gold-frame.
 */
export interface DisplayDeal { deal: Deal; sponsored: boolean; sponsorLabel?: SponsorLabel; }

// =========================================================================
// v12.50 — «تحكم ترتيب الرعاة» — المالك يتحكم يدوياً في نمط الظهور من
// لوحة المدير (platform_settings.sponsor_layout):
//   everyN     كم منتجاً عادياً بين كل بطاقتين مروَّجتين.
//   lead       هل تتصدّر بطاقة مروَّجة أول القائمة؟
//   tierOrder  ترتيب الطبقات الأربع (راعٍ رسمي/معلن/نجمة/إطار) — الأول يظهر أولاً.
//   rotation   داخل الطبقة: round_robin تناوب متجر-متجر، sequential متجر
//              يستنفد منتجاته ثم الذي يليه.
//   storeOrder ترتيب يدوي للمتاجر داخل طبقتها (غير المذكور يتبع priority).
// =========================================================================
export interface SponsorLayout {
    everyN: number;
    lead: boolean;
    tierOrder: SponsorLabel[];
    rotation: 'round_robin' | 'sequential';
    storeOrder: string[];
}

export const DEFAULT_SPONSOR_LAYOUT: SponsorLayout = {
    everyN: SPONSOR_EVERY_N,
    lead: true,
    tierOrder: ['sponsor', 'ad', 'star', 'none'],
    rotation: 'round_robin',
    storeOrder: [],
};

/** يفكّ jsonb القادم من platform_settings بدفاعية كاملة — أي نقص يكمَّل من الافتراضي. */
export const parseSponsorLayout = (v: any): SponsorLayout => {
    const d = DEFAULT_SPONSOR_LAYOUT;
    if (!v || typeof v !== 'object') return d;
    const rawTiers = Array.isArray(v.tier_order) ? v.tier_order.filter((t: any) => ['sponsor', 'ad', 'star', 'none'].includes(t)) : [];
    const tierOrder = [...rawTiers, ...d.tierOrder.filter(t => !rawTiers.includes(t))] as SponsorLabel[];
    const n = Number(v.every_n);
    return {
        everyN: Number.isFinite(n) ? Math.min(20, Math.max(1, Math.round(n))) : d.everyN,
        lead: v.lead !== false,
        tierOrder,
        rotation: v.rotation === 'sequential' ? 'sequential' : 'round_robin',
        storeOrder: Array.isArray(v.store_order) ? v.store_order.filter((s: any) => typeof s === 'string') : [],
    };
};

export const interleaveSponsored = (
    ranked: Deal[],
    sponsorMap: Record<string, Sponsor>,
    layout: SponsorLayout = DEFAULT_SPONSOR_LAYOUT
): DisplayDeal[] => {
    const everyN = Math.min(20, Math.max(1, layout.everyN || SPONSOR_EVERY_N));
    // ترتيب الطبقة من tierOrder — الفهرس الأصغر = أسبق ظهوراً.
    const labelRank = (label: SponsorLabel | undefined): number => {
        const i = layout.tierOrder.indexOf(label || 'ad');
        return i === -1 ? layout.tierOrder.length : i;
    };
    // ترتيب المتاجر داخل الطبقة: اليدوي أولاً (storeOrder)، ثم priority تنازلياً.
    const storeCmp = (a: string, b: string): number => {
        const ia = layout.storeOrder.indexOf(a);
        const ib = layout.storeOrder.indexOf(b);
        if (ia !== -1 || ib !== -1) {
            if (ia === -1) return 1;
            if (ib === -1) return -1;
            return ia - ib;
        }
        const pa = sponsorMap[a]?.priority ?? 0;
        const pb = sponsorMap[b]?.priority ?? 0;
        if (pb !== pa) return pb - pa;
        return a < b ? -1 : a > b ? 1 : 0;
    };
    // Partition: ad-eligible deals (active sponsor + on-target) vs the rest.
    const normal: Deal[] = [];
    const adsByStore = new Map<string, Deal[]>();
    for (const d of ranked) {
        const s = sponsorMap[d.storeId];
        if (s && isSponsorActive(s) && dealMatchesSponsorTarget(d, s)) {
            if (!adsByStore.has(d.storeId)) adsByStore.set(d.storeId, []);
            adsByStore.get(d.storeId)!.push(d);
        } else {
            normal.push(d);
        }
    }

    if (adsByStore.size === 0) {
        return normal.map(deal => ({ deal, sponsored: false }));
    }

    // Build the ad SEQUENCE with tier precedence taken from layout.tierOrder:
    //   1. Tiers emit in the owner's chosen order — the whole first tier drains
    //      before the next tier appears.
    //   2. WITHIN a tier, stores follow storeOrder (manual) then priority; the
    //      rotation mode decides round-robin (S1,S2,S3,S1…) vs sequential
    //      (all of S1, then all of S2 …).
    const byTier = new Map<number, string[]>(); // rank → storeIds
    for (const id of adsByStore.keys()) {
        const rank = labelRank(sponsorMap[id]?.labelType);
        if (!byTier.has(rank)) byTier.set(rank, []);
        byTier.get(rank)!.push(id);
    }
    const tiers = Array.from(byTier.keys()).sort((a, b) => a - b); // فهرس أصغر = أسبق
    const adQueue: DisplayDeal[] = [];
    for (const rank of tiers) {
        const stores = byTier.get(rank)!.sort(storeCmp);
        if (layout.rotation === 'sequential') {
            // متجر يستنفد كل منتجاته ثم الذي يليه.
            for (const id of stores) {
                const q = adsByStore.get(id) || [];
                for (const deal of q) {
                    adQueue.push({ deal, sponsored: true, sponsorLabel: sponsorMap[id]?.labelType || 'ad' });
                }
            }
        } else {
            // Round-robin across this tier's stores until all their queues drain.
            let any = true;
            while (any) {
                any = false;
                for (const id of stores) {
                    const q = adsByStore.get(id);
                    if (q && q.length > 0) {
                        adQueue.push({ deal: q.shift()!, sponsored: true, sponsorLabel: sponsorMap[id]?.labelType || 'ad' });
                        any = true;
                    }
                }
            }
        }
    }

    const out: DisplayDeal[] = [];
    let ni = 0;       // normal index
    let ai = 0;       // ad-queue index
    const remainingAds = () => ai < adQueue.length;
    const nextAd = (): DisplayDeal | null => (ai < adQueue.length ? adQueue[ai++] : null);

    // With lead=true the FIRST sponsored card opens the page (before any normal
    // deal); lead=false starts with normal deals and the first ad waits for the
    // first everyN chunk. Then one sponsored card after every `everyN` normals.
    if (layout.lead) {
        const lead = nextAd();
        if (lead) out.push(lead);
    }

    while (ni < normal.length || remainingAds()) {
        for (let i = 0; i < everyN && ni < normal.length; i++) {
            out.push({ deal: normal[ni++], sponsored: false });
        }
        if (remainingAds()) {
            const ad = nextAd();
            if (ad) out.push(ad);
        }
    }
    return out;
};

// =========================================================================
// Coming Soon (v11.20, re-confirmed v12.60) — Nasser's agreed rule, on
// EVERY public surface (Home rail, DealsList, season page alike):
//   1. Hidden       — startsAt > now + 7 days   (only the merchant sees it)
//   2. Coming Soon  — now < startsAt ≤ now + 7d  (locked + countdown)
//   3. Live         — startsAt ≤ now             (normal active deal)
// `null/undefined` startsAt = legacy behavior (always live from createdAt).
// =========================================================================
export const COMING_SOON_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days
export const COMING_SOON_URGENT_MS = 4 * 60 * 60 * 1000;        // 4 hours

/** True if the deal has a future startsAt — i.e. not yet bookable. */
export const isDealComingSoon = (deal: Deal): boolean => {
    return typeof deal.startsAt === 'number' && deal.startsAt > Date.now();
};

/** True if the deal is in its public 7-day countdown window — the agreed
 *  rule for ALL public listings (Home rail, DealsList, season page): a
 *  scheduled deal only surfaces once ≤7 days remain to launch. */
export const isDealVisibleComingSoon = (deal: Deal): boolean => {
    if (typeof deal.startsAt !== 'number') return false;
    const now = Date.now();
    return deal.startsAt > now && deal.startsAt <= now + COMING_SOON_WINDOW_MS;
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

/** True the instant a deal's lifespan has elapsed — computed live from the
 *  clock, NOT from the DB `status` field. This is what makes expired offers
 *  vanish immediately on every render instead of lingering until the 30s
 *  status-flip tick runs or the server cron catches up. Defaults to a 120-min
 *  lifespan to mirror the expiry tick (see AppContext) so the two never
 *  disagree. Coming-soon deals (future startsAt) are never expired — their
 *  lifespan clock hasn't started, so lifespanStart is in the future. */
export const isDealExpiredByTime = (deal: Deal): boolean => {
    const mins = deal.expiresInMinutes || 120;
    return Date.now() > dealLifespanStart(deal) + mins * 60 * 1000;
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

// ============================================================
// Geolocation — cross-browser, NEVER-hangs (v11.41)
// ------------------------------------------------------------
// Safari (esp. desktop / iPad, which has no GPS) frequently HANGS on
// navigator.geolocation.getCurrentPosition with enableHighAccuracy:true —
// its built-in `timeout` is unreliable and sometimes NEITHER callback fires,
// so any UI spinner stays stuck forever. These helpers guarantee the promise
// always settles (a hard JS timer) and fall back from high → low accuracy so
// desktop Safari still resolves via Wi-Fi/IP. Use everywhere instead of calling
// getCurrentPosition directly.
// ============================================================

export type GeoErrorKind = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export class GeoError extends Error {
    kind: GeoErrorKind;
    constructor(kind: GeoErrorKind) {
        super(kind);
        this.kind = kind;
        this.name = 'GeoError';
    }
}

export interface GeoPos { lat: number; lng: number; accuracy: number; }

const mapGeoPositionError = (err: GeolocationPositionError): GeoError => {
    if (err.code === 1) return new GeoError('denied');
    if (err.code === 3) return new GeoError('timeout');
    return new GeoError('unavailable');
};

// One attempt that ALWAYS settles: a hard JS timer fires even if Safari never
// calls back. maximumAge lets the low-accuracy pass return a recent cached fix
// fast (desktop Safari).
const geoPositionOnce = (enableHighAccuracy: boolean, timeoutMs: number): Promise<GeoPos> =>
    new Promise<GeoPos>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(guard);
            fn();
        };
        const guard = setTimeout(() => finish(() => reject(new GeoError('timeout'))), timeoutMs + 2000);
        try {
            navigator.geolocation.getCurrentPosition(
                (pos) => finish(() => resolve({
                    lat: pos.coords.latitude,
                    lng: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                })),
                (err) => finish(() => reject(mapGeoPositionError(err))),
                { enableHighAccuracy, timeout: timeoutMs, maximumAge: enableHighAccuracy ? 0 : 120000 },
            );
        } catch {
            finish(() => reject(new GeoError('unavailable')));
        }
    });

/**
 * Cross-browser "where am I" that never hangs. Tries a high-accuracy fix first
 * (great on phones), then falls back to a fast low-accuracy fix (desktop Safari,
 * which has no GPS). A hard denial is not retried. Always settles.
 */
export const getCurrentPositionSafe = (opts?: { highMs?: number; lowMs?: number }): Promise<GeoPos> => {
    const highMs = opts?.highMs ?? 8000;
    const lowMs = opts?.lowMs ?? 8000;
    if (typeof navigator === 'undefined' || !navigator.geolocation || !navigator.geolocation.getCurrentPosition) {
        return Promise.reject(new GeoError('unsupported'));
    }
    return geoPositionOnce(true, highMs).catch((e: unknown) => {
        const kind = e instanceof GeoError ? e.kind : 'unavailable';
        if (kind === 'denied' || kind === 'unsupported') throw e;
        return geoPositionOnce(false, lowMs);
    });
};

/** Friendly bilingual message for a GeoError (or any thrown value). */
export const geoErrorMessage = (e: unknown, isRTL: boolean): string => {
    const kind = e instanceof GeoError ? e.kind : 'unavailable';
    if (kind === 'denied') return isRTL
        ? 'صلاحية الموقع مرفوضة. فعّلها من إعدادات المتصفح/الجهاز ثم أعد المحاولة — أو اضغط على الخريطة لتحديد موقعك يدوياً.'
        : 'Location permission is denied. Enable it in your browser/device settings and retry — or tap the map to set your location manually.';
    if (kind === 'unsupported') return isRTL
        ? 'المتصفح لا يدعم تحديد الموقع — اضغط على الخريطة لتحديد موقعك يدوياً.'
        : 'This browser does not support geolocation — tap the map to set your location manually.';
    if (kind === 'timeout') return isRTL
        ? 'انتهت مهلة تحديد الموقع. تأكد من تفعيل خدمة الموقع، أو اضغط على الخريطة لتحديد موقعك يدوياً.'
        : 'Location request timed out. Make sure location services are on, or tap the map to set it manually.';
    return isRTL
        ? 'تعذّر تحديد الموقع. اضغط على الخريطة لتحديد موقعك يدوياً.'
        : 'Could not get your location. Tap the map to set it manually.';
};

/**
 * Authenticity badge derived from buyer «real vs fake» votes on an offer.
 * v12.33 wording (Nasser #18): buyer-facing labels are «عرض حقيقي» / «عرض
 * شكلي» EVERYWHERE — «شكلي» (for-show) replaced both the harsh «وهمي» and the
 * v12.32 «خصم مبالغ فيه» experiment. The vote judges whether the offer's
 * discount is genuine (same price or inflated original = شكلي). `show` is
 * false until at least one vote exists so brand-new deals don't carry a
 * misleading badge. v11.97
 */
export interface AuthenticityBadge {
    show: boolean;
    real: boolean;   // true → green (real), false → red (fake)
    pct: number;     // dominant side percentage (0-100)
    total: number;   // total votes
    label: string;   // localized "عرض حقيقي 85%" / "Real 85%"
    color: string;   // text/icon color
    bg: string;      // pill background
}

export const getAuthenticityBadge = (real = 0, fake = 0, isRTL = true): AuthenticityBadge => {
    const r = Math.max(0, real || 0);
    const f = Math.max(0, fake || 0);
    const total = r + f;
    if (total <= 0) {
        return { show: false, real: true, pct: 0, total: 0, label: '', color: '', bg: '' };
    }
    const realPct = Math.round((r / total) * 100);
    const isReal = r >= f;                 // ties resolve to "real"
    const pct = isReal ? realPct : 100 - realPct;
    const label = isReal
        ? `${isRTL ? '🔵 عرض حقيقي' : '🔵 Real offer'} ${pct}%`
        : `${isRTL ? '🟡 عرض شكلي' : '🟡 Cosmetic offer'} ${pct}%`;
    // BLUE (real) / YELLOW (fake) — NOT green/red, which are reserved for shop
    // open/closed status (owner's rule, v11.98). Yellow needs DARK text for AA
    // contrast; blue keeps white. Solid pill → readable on light + dark cards.
    return {
        show: true,
        real: isReal,
        pct,
        total,
        label,
        color: isReal ? '#ffffff' : '#713f12',
        bg: isReal ? '#1d4ed8' : '#facc15',
    };
};
