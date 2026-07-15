export type Category =
    | 'Fashion_Women'
    | 'Fashion_Men'
    | 'Kids_Infants'
    | 'Kids_Girls'
    | 'Electronics'
    | 'Food'
    | 'Beauty'
    | 'Glasses'
    | 'MensSalon'
    | 'WomensSalon'
    | 'Sports'
    | 'Supermarket'
    | 'Butcher'
    | 'Sanitary'
    | 'Cafe'
    | 'Home'
    | 'Hotels'
    | 'CarRentals'
    | 'Laundry'
    | 'MensTailor'
    | 'WomensTailor'
    | 'CarWash'
    | 'CarWorkshop'
    | 'Amusements'
    | 'Gym'
    | 'Library'
    | 'Nursery'
    | 'Pharmacy'
    | 'Clinics'
    | 'Online'
    | 'Other';

export type GenderTarget = 'all' | 'men' | 'women' | 'kids' | 'other';

export interface Region {
    id: string;
    name: string;
    nameEn?: string;
    lat?: number;
    lng?: number;
    googleMapsLink?: string;
}

export interface City {
    id: string;
    name: string;
    nameEn?: string;
    regionId: string;
    lat: number;
    lng: number;
}

export interface Location {
    id: string;
    name: string;
    nameEn?: string;
    type: 'mall' | 'market';
    cityId: string;
    lat: number;
    lng: number;
}

export interface Store {
    id: string;
    name: string;
    rating: number;
    lat: number;
    lng: number;
    address: string;
}

export interface Rating {
    /** DB row id (uuid). Optional for legacy in-memory ratings. */
    id?: string;
    userId: string;
    userName: string;
    score: number;
    comment: string;
    date: string;
    reply?: string;
    repliedBy?: string;
    repliedAt?: string;
    likedBy?: string[];
    likeCount?: number;
}

export interface Booking {
    deal: Deal;
    barcode: string;
    backupCode: string;
    expiryTime: number;
    bookedAt: number;
    bookedQuantity: number;
    userId: string;
    prepTime?: string;
    notes?: string;
    status?: 'pending' | 'acknowledged' | 'completed' | 'cancelled';
}

export interface Deal {
    id: string;
    storeId: string;
    shopName: string;
    itemName: string;
    category: Category;
    gender: GenderTarget;
    size?: string;
    originalPrice: number;
    discountedPrice: number;
    discountPercentage: number;
    images: string[];
    description: string;
    locationId: string;
    /** City/region keys denormalized onto the deal so filtering doesn't
     *  rely on locationId being a known LOCATIONS entry. Custom locations
     *  (locationId = `custom_<ts>`) used to break region filters because
     *  the chain LOCATIONS → CITIES → REGIONS dead-ended at step 1. */
    region?: string;
    city?: string;
    mapLocation?: { lat: number; lng: number };
    googleMapsLink?: string;
    reliabilityScore: number;
    expiresInMinutes: number;
    expiryType?: 'hours' | 'duration' | 'date' | 'stock';
    expiryDate?: string; // ISO YYYY-MM-DD (gregorian) when expiryType === 'date'
    quantity: number | 'unlimited';
    initialQuantity?: number | 'unlimited';
    /** v12.28 — حدود التاجر للحجز (منع السوق السوداء). undefined/0 = بلا حد. */
    /** أقصى عدد قطع يحجزها المشتري في الحجز الواحد. */
    maxPerBooking?: number;
    /** كم مرة يحق للمشتري الواحد حجز هذا العرض (نشط + مكتمل). */
    maxBookingsPerBuyer?: number;
    /** مدة الانتظار (بالدقائق) بعد استلام حجز مكتمل قبل السماح بحجز جديد. */
    rebookCooldownMinutes?: number;
    ratings: Rating[];
    prepTime?: string;
    createdAt: number;
    status: 'active' | 'expired' | 'paused';
    /** v11.20 — scheduled launch (epoch ms). When set & in the future, the
     *  deal is "Coming Soon": locked from booking, dimmed with a lock icon,
     *  and surfaced in Home's "العروض القادمة" section only while it sits
     *  inside the 7-day visibility window. Merchant can schedule up to 30
     *  days ahead so they can prep early; deal only appears publicly once
     *  the 7-day window opens. Unset (undefined) = legacy behavior. */
    startsAt?: number;
    /** Aggregated impressions counter — incremented by RPC `increment_deal_view`
     *  (migration v13). Optional because legacy deals predate the column. */
    views?: number;
    /** Aggregated click-throughs — incremented by RPC `increment_deal_click`. */
    clicks?: number;
    /** v11.97 — buyer authenticity votes for THIS offer (deal_authenticity_votes).
     *  Buyers who completed a purchase vote «عرض حقيقي / شكلي»; the green/red badge
     *  + percentage on the card and details page derives from these counts. */
    authReal?: number;
    authFake?: number;
    /** The signed-in buyer's own vote on this deal: true=real, false=fake,
     *  null/undefined = hasn't voted. Used to skip re-asking after purchase. */
    myAuthVote?: boolean | null;
}

export const CATEGORIES: { id: Category | 'all'; ar: string; en: string; emoji: string }[] = [
    { id: 'all', ar: 'الكل', en: 'All', emoji: '🔥' },
    { id: 'Fashion_Women', ar: 'فساتين ونساء', en: 'Women & Dresses', emoji: '👗' },
    { id: 'Fashion_Men', ar: 'ملابس رجالية', en: 'Men Fashion', emoji: '👔' },
    { id: 'Kids_Infants', ar: 'رضع وملابس حمل', en: 'Infants & Maternity', emoji: '👶' },
    { id: 'Kids_Girls', ar: 'ملابس أطفال', en: 'Kids', emoji: '👧' },
    { id: 'Electronics', ar: 'إلكترونيات', en: 'Electronics', emoji: '📱' },
    { id: 'Food', ar: 'مطاعم', en: 'Food', emoji: '🍔' },
    { id: 'Beauty', ar: 'عطور وتجميل', en: 'Beauty', emoji: '💄' },
    { id: 'Glasses', ar: 'نظارات', en: 'Eyewear', emoji: '👓' },
    { id: 'MensSalon', ar: 'صالون رجالي', en: 'Barbershop', emoji: '💈' },
    { id: 'WomensSalon', ar: 'صالون نسائي', en: "Women's Salon", emoji: '💇‍♀️' },
    { id: 'Sports', ar: 'رياضة', en: 'Sports', emoji: '⚽' },
    { id: 'Supermarket', ar: 'سوبرماركت', en: 'Supermarket', emoji: '🛒' },
    { id: 'Butcher', ar: 'ملحمة', en: 'Butcher', emoji: '🥩' },
    { id: 'Sanitary', ar: 'أدوات صحية', en: 'Sanitary', emoji: '🚿' },
    { id: 'Cafe', ar: 'مقاهي', en: 'Cafes', emoji: '☕' },
    { id: 'Home', ar: 'منزل وديكور', en: 'Home', emoji: '🏠' },
    { id: 'Hotels', ar: 'فنادق', en: 'Hotels', emoji: '🏨' },
    { id: 'CarRentals', ar: 'تأجير سيارات', en: 'Car Rentals', emoji: '🚗' },
    { id: 'Laundry', ar: 'مغسلة ملابس', en: 'Laundromats', emoji: '🧺' },
    { id: 'MensTailor', ar: 'خياطة رجالية', en: "Men's Tailor", emoji: '🧵' },
    { id: 'WomensTailor', ar: 'مشغل نسائي', en: "Women's Tailor", emoji: '🪡' },
    { id: 'CarWash', ar: 'مغسلة سيارات', en: 'Car Wash', emoji: '🧽' },
    { id: 'CarWorkshop', ar: 'ورش سيارات', en: 'Car Workshops', emoji: '🔧' },
    { id: 'Amusements', ar: 'ملاهي ألعاب', en: 'Amusements', emoji: '🎡' },
    { id: 'Gym', ar: 'نادي رياضي', en: 'Gym', emoji: '🏋️' },
    { id: 'Library', ar: 'مكتبة', en: 'Library', emoji: '📚' },
    { id: 'Nursery', ar: 'مشاتل زراعية', en: 'Nurseries', emoji: '🌱' },
    { id: 'Pharmacy', ar: 'صيدلية', en: 'Pharmacy', emoji: '💊' },
    { id: 'Clinics', ar: 'عيادات', en: 'Clinics', emoji: '🩺' },
    { id: 'Online', ar: 'أونلاين', en: 'Online', emoji: '🌐' },
    { id: 'Other', ar: 'أخرى', en: 'Other', emoji: '✨' },
];

export const GENDERS: { id: GenderTarget; ar: string; en: string; emoji: string }[] = [
    { id: 'all', ar: 'الكل', en: 'All', emoji: '👥' },
    { id: 'men', ar: 'رجال', en: 'Men', emoji: '👨' },
    { id: 'women', ar: 'نساء', en: 'Women', emoji: '👩' },
    { id: 'kids', ar: 'أطفال', en: 'Kids', emoji: '👶' },
    { id: 'other', ar: 'أخرى', en: 'Other', emoji: '✨' },
];

/**
 * Distance calculation helper for reverse geocoding simulation
 */
export const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const p = 0.017453292519943295;    // Math.PI / 180
    const c = Math.cos;
    const a = 0.5 - c((lat2 - lat1) * p) / 2 +
        c(lat1 * p) * c(lat2 * p) *
        (1 - c((lon2 - lon1) * p)) / 2;

    return 12742 * Math.asin(Math.sqrt(a)); // 2 * R; R = 6371 km
};

export const findNearestCity = (lat: number, lng: number): City | undefined => {
    let nearest: City | undefined = undefined;
    let minDistance = Infinity;

    CITIES.forEach(city => {
        // We look for a location in this city to get a coordinate baseline
        // Since CITIES don't have coords directly, we find a representative location
        const loc = LOCATIONS.find(l => l.cityId === city.id);
        if (loc) {
            const dist = calculateDistance(lat, lng, loc.lat, loc.lng);
            if (dist < minDistance) {
                minDistance = dist;
                nearest = city;
            }
        }
    });

    return nearest;
};

export const findNearestLocation = (lat: number, lng: number): Location | undefined => {
    let nearest: Location | undefined = undefined;
    let minDistance = Infinity;

    LOCATIONS.forEach(loc => {
        const dist = calculateDistance(lat, lng, loc.lat, loc.lng);
        if (dist < minDistance) {
            minDistance = dist;
            nearest = loc;
        }
    });

    // If closer than 500m, consider it inside that location
    return minDistance < 0.5 ? nearest : undefined;
};

// ============================================================
// المناطق الإدارية - 13 منطقة
// ============================================================
export const REGIONS: Region[] = [
    { id: 'riyadh', name: 'منطقة الرياض', nameEn: "Riyadh Region", lat: 24.7136, lng: 46.6753 },
    { id: 'makkah', name: 'منطقة مكة المكرمة', nameEn: "Makkah Region", lat: 21.3891, lng: 39.8579 },
    { id: 'madinah', name: 'منطقة المدينة المنورة', nameEn: "Madinah Region", lat: 24.4672, lng: 39.6061 },
    { id: 'qassim', name: 'منطقة القصيم', nameEn: "Qassim Region", lat: 26.3260, lng: 43.9750 },
    { id: 'eastern', name: 'المنطقة الشرقية', nameEn: "Eastern Province", lat: 26.4207, lng: 50.0888 },
    { id: 'asir', name: 'منطقة عسير', nameEn: "Asir Region", lat: 18.2171, lng: 42.5053 },
    { id: 'tabuk', name: 'منطقة تبوك', nameEn: "Tabuk Region", lat: 28.3833, lng: 36.5667 },
    { id: 'hail', name: 'منطقة حائل', nameEn: "Hail Region", lat: 27.5167, lng: 41.6833 },
    { id: 'northern', name: 'منطقة الحدود الشمالية', nameEn: "Northern Borders Region", lat: 30.9667, lng: 41.0167 },
    { id: 'jazan', name: 'منطقة جازان', nameEn: "Jazan Region", lat: 16.8892, lng: 42.5511 },
    { id: 'najran', name: 'منطقة نجران', nameEn: "Najran Region", lat: 17.4917, lng: 44.1322 },
    { id: 'baha', name: 'منطقة الباحة', nameEn: "Al Bahah Region", lat: 20.0125, lng: 41.4653 },
    { id: 'jouf', name: 'منطقة الجوف', nameEn: "Al Jawf Region", lat: 29.9667, lng: 40.2000 },
];

// ============================================================
// المدن - جميع المدن الرئيسية في كل منطقة
// ============================================================
export const CITIES: City[] = [
    { id: 'bukayriah', name: 'البكيرية', nameEn: "Bukayriah", regionId: 'qassim', lat: 26.1437, lng: 43.6593 },
    { id: 'badaiah', name: 'البدائع', nameEn: "Badaya", regionId: 'qassim', lat: 25.9750, lng: 43.6833 },
    { id: 'muznib', name: 'المذنب', nameEn: "Mithnab", regionId: 'qassim', lat: 25.8667, lng: 44.2167 },
    { id: 'riyadh_city', name: 'الرياض', nameEn: "Riyadh", regionId: 'riyadh', lat: 24.7136, lng: 46.6753 },
    { id: 'kharj', name: 'الخرج', nameEn: "Al Kharj", regionId: 'riyadh', lat: 24.1500, lng: 47.3000 },
    { id: 'majmaah', name: 'المجمعة', nameEn: "Al Majmaah", regionId: 'riyadh', lat: 25.9000, lng: 45.3333 },
    { id: 'dawadmi', name: 'الدوادمي', nameEn: "Dawadmi", regionId: 'riyadh', lat: 24.5075, lng: 44.3919 },
    { id: 'wadi_ad_dawasir', name: 'وادي الدواسر', nameEn: "Wadi ad-Dawasir", regionId: 'riyadh', lat: 20.4500, lng: 44.7500 },
    { id: 'quwayiyah', name: 'القويعية', nameEn: "Quwayiyah", regionId: 'riyadh', lat: 24.0500, lng: 45.2667 },
    { id: 'zulfi', name: 'الزلفي', nameEn: "Az Zulfi", regionId: 'riyadh', lat: 26.3000, lng: 44.8167 },
    { id: 'shakra', name: 'شقراء', nameEn: "Shaqra", regionId: 'riyadh', lat: 25.2422, lng: 45.2494 },
    { id: 'diriyah', name: 'الدرعية', nameEn: "Diriyah", regionId: 'riyadh', lat: 24.7500, lng: 46.5333 },

    // مكة المكرمة
    { id: 'makkah_city', name: 'مكة المكرمة', nameEn: "Makkah", regionId: 'makkah', lat: 21.3891, lng: 39.8579 },
    { id: 'jeddah', name: 'جدة', nameEn: "Jeddah", regionId: 'makkah', lat: 21.4858, lng: 39.1867 },
    { id: 'taif', name: 'الطائف', nameEn: "Taif", regionId: 'makkah', lat: 21.2833, lng: 40.4167 },
    { id: 'qunfudhah', name: 'القنفذة', nameEn: "Al Qunfudhah", regionId: 'makkah', lat: 19.1264, lng: 41.0789 },
    { id: 'rabigh', name: 'رابغ', nameEn: "Rabigh", regionId: 'makkah', lat: 22.8000, lng: 39.0333 },
    { id: 'laith', name: 'الليث', nameEn: "Al Lith", regionId: 'makkah', lat: 20.1500, lng: 40.2667 },
    { id: 'bahrah', name: 'بحرة', nameEn: "Bahrah", regionId: 'makkah', lat: 21.4167, lng: 39.4667 },
    { id: 'khulays', name: 'خليص', nameEn: "Khulays", regionId: 'makkah', lat: 22.1833, lng: 39.3167 },
    { id: 'ranyah', name: 'رنية', nameEn: "Ranyah", regionId: 'makkah', lat: 21.2500, lng: 42.8500 },
    { id: 'turubah', name: 'تربة', nameEn: "Turabah", regionId: 'makkah', lat: 21.2167, lng: 41.6333 },

    // المدينة المنورة
    { id: 'madinah_city', name: 'المدينة المنورة', nameEn: "Madinah", regionId: 'madinah', lat: 24.4672, lng: 39.6061 },
    { id: 'yanbu', name: 'ينبع', nameEn: "Yanbu", regionId: 'madinah', lat: 24.0891, lng: 38.0637 },
    { id: 'ula', name: 'العلا', nameEn: "AlUla", regionId: 'madinah', lat: 26.6167, lng: 37.9167 },
    { id: 'mahad_adh_dhahab', name: 'مهد الذهب', nameEn: "Mahd adh Dhahab", regionId: 'madinah', lat: 23.4833, lng: 40.8667 },
    { id: 'badr', name: 'بدر', nameEn: "Badr", regionId: 'madinah', lat: 23.7833, lng: 38.8333 },
    { id: 'khaybar', name: 'خيبر', nameEn: "Khaybar", regionId: 'madinah', lat: 25.6833, lng: 39.2833 },
    { id: 'hinakiyah', name: 'الحناكية', nameEn: "Al Hinakiyah", regionId: 'madinah', lat: 24.8500, lng: 40.5000 },

    // القصيم
    { id: 'buraidah', name: 'بريدة', nameEn: "Buraidah", regionId: 'qassim', lat: 26.3260, lng: 43.9750 },
    { id: 'unaizah', name: 'عنيزة', nameEn: "Unaizah", regionId: 'qassim', lat: 26.0842, lng: 43.9936 },
    { id: 'rass', name: 'الرس', nameEn: "Ar Rass", regionId: 'qassim', lat: 25.8692, lng: 43.4975 },
    { id: 'mithnab', name: 'المذنب', nameEn: "Al Midhnab", regionId: 'qassim', lat: 25.8667, lng: 44.2167 },
    { id: 'bukayriyah_q', name: 'البكيرية', nameEn: "Al Bukayriyah", regionId: 'qassim', lat: 26.1500, lng: 43.6667 },
    { id: 'badaya', name: 'البدائع', nameEn: "Al Badaya", regionId: 'qassim', lat: 25.9667, lng: 43.6833 },
    { id: 'riyadh_al_khabra', name: 'رياض الخبراء', nameEn: "Riyadh Al Khabra", regionId: 'qassim', lat: 26.0667, lng: 43.5833 },

    // المنطقة الشرقية
    { id: 'dammam', name: 'الدمام', nameEn: "Dammam", regionId: 'eastern', lat: 26.4207, lng: 50.0888 },
    { id: 'khobar', name: 'الخبر', nameEn: "Khobar", regionId: 'eastern', lat: 26.2172, lng: 50.1971 },
    { id: 'dhahran', name: 'الظهران', nameEn: "Dhahran", regionId: 'eastern', lat: 26.2361, lng: 50.1211 },
    { id: 'jubail', name: 'الجبيل', nameEn: "Jubail", regionId: 'eastern', lat: 27.0117, lng: 49.6583 },
    { id: 'hafuf', name: 'الهفوف (الأحساء)', nameEn: "Hofuf (Al-Ahsa)", regionId: 'eastern', lat: 25.3787, lng: 49.5863 },
    { id: 'qatif', name: 'القطيف', nameEn: "Qatif", regionId: 'eastern', lat: 26.5167, lng: 50.0000 },
    { id: 'hafar_al_batin', name: 'حفر الباطن', nameEn: "Hafar Al-Batin", regionId: 'eastern', lat: 28.4333, lng: 45.9667 },
    { id: 'khafji', name: 'الخفجي', nameEn: "Khafji", regionId: 'eastern', lat: 28.4342, lng: 48.4908 },
    { id: 'ras_tanura', name: 'رأس تنورة', nameEn: "Ras Tanura", regionId: 'eastern', lat: 26.6500, lng: 50.1167 },
    { id: 'nairyah', name: 'النعيرية', nameEn: "Nairyah", regionId: 'eastern', lat: 27.5000, lng: 48.4833 },

    // منطقة عسير
    { id: 'abha', name: 'أبها', nameEn: "Abha", regionId: 'asir', lat: 18.2171, lng: 42.5053 },
    { id: 'khamis_mushait', name: 'خميس مشيط', nameEn: "Khamis Mushait", regionId: 'asir', lat: 18.3000, lng: 42.7333 },
    { id: 'bishah', name: 'بيشة', nameEn: "Bishah", regionId: 'asir', lat: 19.9833, lng: 42.6167 },
    { id: 'namas', name: 'النماص', nameEn: "An-Namas", regionId: 'asir', lat: 19.1167, lng: 42.1167 },
    { id: 'mahail_asir', name: 'محايل عسير', nameEn: "Mahayil Asir", regionId: 'asir', lat: 18.5500, lng: 41.9167 },
    { id: 'bariq', name: 'بارق', nameEn: "Bariq", regionId: 'asir', lat: 18.9167, lng: 41.9333 },
    { id: 'ahad_rufaydah', name: 'أحد رفيدة', nameEn: "Ahad Rafidah", regionId: 'asir', lat: 18.1500, lng: 42.8500 },

    // منطقة تبوك
    { id: 'tabuk_city', name: 'تبوك', nameEn: "Tabuk", regionId: 'tabuk', lat: 28.3833, lng: 36.5667 },
    { id: 'wajh', name: 'الوجه', nameEn: "Al-Wajh", regionId: 'tabuk', lat: 26.2333, lng: 36.4667 },
    { id: 'duba', name: 'ضباء', nameEn: "Duba", regionId: 'tabuk', lat: 27.3500, lng: 35.6833 },
    { id: 'tiyama', name: 'تيماء', nameEn: "Tayma", regionId: 'tabuk', lat: 27.6333, lng: 38.5500 },
    { id: 'umluj', name: 'أملج', nameEn: "Umluj", regionId: 'tabuk', lat: 25.0333, lng: 37.2667 },
    { id: 'haql', name: 'حقل', nameEn: "Haql", regionId: 'tabuk', lat: 29.2833, lng: 34.9333 },

    // منطقة حائل
    { id: 'hail_city', name: 'حائل', nameEn: "Hail", regionId: 'hail', lat: 27.5167, lng: 41.6833 },
    { id: 'baqaa', name: 'بقعاء', nameEn: "Baqaa", regionId: 'hail', lat: 27.9333, lng: 42.3333 },
    { id: 'shnan', name: 'الشنان', nameEn: "Ash-Shanan", regionId: 'hail', lat: 27.1667, lng: 42.4333 },
    { id: 'ghazalah', name: 'الغزالة', nameEn: "Al-Ghazalah", regionId: 'hail', lat: 26.4333, lng: 41.2333 },

    // منطقة الحدود الشمالية
    { id: 'arar', name: 'عرعر', nameEn: "Arar", regionId: 'northern', lat: 30.9667, lng: 41.0167 },
    { id: 'rafha', name: 'رفحاء', nameEn: "Rafha", regionId: 'northern', lat: 29.6167, lng: 43.5000 },
    { id: 'turayf', name: 'طريف', nameEn: "Turaif", regionId: 'northern', lat: 31.6833, lng: 38.6500 },
    { id: 'uwayqilah', name: 'العويقيلة', nameEn: "Al-Uwayqilah", regionId: 'northern', lat: 30.3167, lng: 42.1833 },

    // منطقة جازان
    { id: 'jazan_city', name: 'جازان', nameEn: "Jazan", regionId: 'jazan', lat: 16.8892, lng: 42.5511 },
    { id: 'sabya', name: 'صبيا', nameEn: "Sabya", regionId: 'jazan', lat: 17.1500, lng: 42.6167 },
    { id: 'abu_arish', name: 'أبو عريش', nameEn: "Abu Arish", regionId: 'jazan', lat: 16.9667, lng: 42.8333 },
    { id: 'samitah', name: 'صامطة', nameEn: "Samtah", regionId: 'jazan', lat: 16.5833, lng: 42.9333 },
    { id: 'adrabi', name: 'الدرب', nameEn: "Ad-Darb", regionId: 'jazan', lat: 17.7167, lng: 42.2500 },
    { id: 'biysh', name: 'بيش', nameEn: "Baish", regionId: 'jazan', lat: 17.3833, lng: 42.5333 },

    // منطقة نجران
    { id: 'najran_city', name: 'نجران', nameEn: "Najran", regionId: 'najran', lat: 17.4917, lng: 44.1322 },
    { id: 'sharurah', name: 'شرورة', nameEn: "Sharurah", regionId: 'najran', lat: 17.4833, lng: 47.1167 },
    { id: 'hubuna', name: 'حبونا', nameEn: "Habuna", regionId: 'najran', lat: 17.8500, lng: 44.3667 },

    // منطقة الباحة
    { id: 'baha_city', name: 'الباحة', nameEn: "Al-Bahah", regionId: 'baha', lat: 20.0125, lng: 41.4653 },
    { id: 'baljurashi', name: 'بلجرشي', nameEn: "Baljurashi", regionId: 'baha', lat: 19.8500, lng: 41.5667 },
    { id: 'mandaq', name: 'المندق', nameEn: "Al-Mandaq", regionId: 'baha', lat: 20.1500, lng: 41.2833 },
    { id: 'mikhwah', name: 'المخواة', nameEn: "Al-Makhwah", regionId: 'baha', lat: 19.7833, lng: 41.4333 },

    // منطقة الجوف
    { id: 'sakaka', name: 'سكاكا', nameEn: "Sakaka", regionId: 'jouf', lat: 29.9667, lng: 40.2000 },
    { id: 'qurayyat', name: 'القريات', nameEn: "Qurayyat", regionId: 'jouf', lat: 31.3333, lng: 37.3333 },
    { id: 'dumat_jandal', name: 'دومة الجندل', nameEn: "Dumat Al-Jandal", regionId: 'jouf', lat: 29.8167, lng: 39.8667 },
    { id: 'tabarjal', name: 'طبرجل', nameEn: "Tabarjal", regionId: 'jouf', lat: 30.5000, lng: 38.3500 },
];

// ============================================================
// المولات والأسواق في جميع المدن
// ============================================================
export const LOCATIONS: Location[] = [
    // ========== الرياض ==========
    { id: 'nakheel_riyadh', name: 'النخيل مول', nameEn: "Nakheel Mall", type: 'mall', cityId: 'riyadh_city', lat: 24.7669, lng: 46.6806 },
    { id: 'riyadh_park', name: 'الرياض بارك', nameEn: "Riyadh Park", type: 'mall', cityId: 'riyadh_city', lat: 24.7578, lng: 46.6300 },
    { id: 'riyadh_gallery', name: 'الرياض جاليري', nameEn: "Riyadh Gallery", type: 'mall', cityId: 'riyadh_city', lat: 24.6907, lng: 46.6653 },
    { id: 'panorama_riyadh', name: 'بانوراما مول', nameEn: "Panorama Mall", type: 'mall', cityId: 'riyadh_city', lat: 24.7003, lng: 46.6842 },
    { id: 'hayat_mall', name: 'حياة مول', nameEn: "Hayat Mall", type: 'mall', cityId: 'riyadh_city', lat: 24.7631, lng: 46.7384 },
    { id: 'granada_riyadh', name: 'غرناطة مول', nameEn: "Granada Mall", type: 'mall', cityId: 'riyadh_city', lat: 24.7724, lng: 46.7262 },
    { id: 'kingdom_mall', name: 'مركز المملكة', nameEn: "Kingdom Centre", type: 'mall', cityId: 'riyadh_city', lat: 24.7118, lng: 46.6744 },
    { id: 'avenues_riyadh', name: 'ذا أفنيوز', nameEn: "The Avenues", type: 'mall', cityId: 'riyadh_city', lat: 24.7683, lng: 46.6933 },
    { id: 'via_riyadh', name: 'فياء الرياض', nameEn: "Via Riyadh", type: 'mall', cityId: 'riyadh_city', lat: 24.7350, lng: 46.6570 },
    { id: 'othaim_riyadh', name: 'العثيم مول', nameEn: "Othaim Mall", type: 'mall', cityId: 'riyadh_city', lat: 24.7389, lng: 46.7529 },
    { id: 'tala_mall', name: 'تالا مول', nameEn: "Tala Mall", type: 'mall', cityId: 'riyadh_city', lat: 24.7522, lng: 46.6855 },
    { id: 'cena_mall', name: 'سنتريا مول', nameEn: "Centria Mall", type: 'mall', cityId: 'riyadh_city', lat: 24.6946, lng: 46.6814 },
    { id: 'qasr_mall', name: 'القصر مول', nameEn: "Al Qasr Mall", type: 'mall', cityId: 'riyadh_city', lat: 24.5971, lng: 46.6811 },
    { id: 'hamra_mall', name: 'الحمراء مول', nameEn: "Al Hamra Mall", type: 'mall', cityId: 'riyadh_city', lat: 24.7766, lng: 46.7588 },
    { id: 'marina_mall', name: 'مارينا مول', nameEn: "Marina Mall", type: 'mall', cityId: 'riyadh_city', lat: 24.7430, lng: 46.6666 },
    { id: 'taibah_souq', name: 'أسواق طيبة', nameEn: "Taibah Souq", type: 'market', cityId: 'riyadh_city', lat: 24.7400, lng: 46.6800 },
    { id: 'batha_souq', name: 'سوق البطحاء', nameEn: "Al Batha Souq", type: 'market', cityId: 'riyadh_city', lat: 24.6360, lng: 46.7170 },
    { id: 'dira_souq', name: 'سوق الديرة', nameEn: "Al Dirah Souq", type: 'market', cityId: 'riyadh_city', lat: 24.6352, lng: 46.7113 },
    { id: 'ovais_souq', name: 'أسواق العويس', nameEn: "Al Owais Souq", type: 'market', cityId: 'riyadh_city', lat: 24.7450, lng: 46.6850 },
    { id: 'kharj_mall', name: 'الخرج مول', nameEn: "Al Kharj Mall", type: 'mall', cityId: 'kharj', lat: 24.1537, lng: 47.3340 },
    { id: 'jawhara_mall', name: 'الجوهرة مول', nameEn: "Al Jawharah Mall", type: 'mall', cityId: 'kharj', lat: 24.1480, lng: 47.3120 },

    // ========== مكة المكرمة وجدة ==========
    { id: 'red_sea_mall', name: 'رد سي مول', nameEn: "Red Sea Mall", type: 'mall', cityId: 'jeddah', lat: 21.6274, lng: 39.1185 },
    { id: 'mall_of_arabia', name: 'مول العرب', nameEn: "Mall of Arabia", type: 'mall', cityId: 'jeddah', lat: 21.5834, lng: 39.1461 },
    { id: 'aziz_mall', name: 'العزيز مول', nameEn: "Al Aziz Mall", type: 'mall', cityId: 'jeddah', lat: 21.5422, lng: 39.1757 },
    { id: 'stars_avenue', name: 'ستارز أفنيو', nameEn: "Stars Avenue", type: 'mall', cityId: 'jeddah', lat: 21.5894, lng: 39.1540 },
    { id: 'heraa_mall', name: 'هيفاء مول', nameEn: "Haifa Mall", type: 'mall', cityId: 'jeddah', lat: 21.5580, lng: 39.1735 },
    { id: 'andalus_jeddah', name: 'الأندلس مول', nameEn: "Andalus Mall", type: 'mall', cityId: 'jeddah', lat: 21.5736, lng: 39.1513 },
    { id: 'salam_mall_jeddah', name: 'السلام مول', nameEn: "Al Salam Mall", type: 'mall', cityId: 'jeddah', lat: 21.5033, lng: 39.2311 },
    { id: 'roshen_mall', name: 'روشان مول', nameEn: "Roshan Mall", type: 'mall', cityId: 'jeddah', lat: 21.6455, lng: 39.1080 },
    { id: 'balad_souq', name: 'سوق البلد', nameEn: "Al Balad Souq", type: 'market', cityId: 'jeddah', lat: 21.4844, lng: 39.1862 },
    { id: 'shatea_souq', name: 'سوق الشاطئ', nameEn: "Al Shati Souq", type: 'market', cityId: 'jeddah', lat: 21.5600, lng: 39.1400 },
    { id: 'bawadi_souq', name: 'سوق البوادي', nameEn: "Al Bawadi Souq", type: 'market', cityId: 'jeddah', lat: 21.5977, lng: 39.1788 },
    { id: 'abraj_bait', name: 'أبراج البيت', nameEn: "Abraj Al Bait", type: 'mall', cityId: 'makkah_city', lat: 21.4189, lng: 39.8263 },
    { id: 'makkah_mall', name: 'مكة مول', nameEn: "Makkah Mall", type: 'mall', cityId: 'makkah_city', lat: 21.3948, lng: 39.8339 },
    { id: 'aziziyah_souq', name: 'سوق العزيزية', nameEn: "Al Aziziyah Souq", type: 'market', cityId: 'makkah_city', lat: 21.3950, lng: 39.8450 },
    { id: 'diyafa_mall', name: 'مول الضيافة', nameEn: "Al Diyafa Mall", type: 'mall', cityId: 'makkah_city', lat: 21.4333, lng: 39.8000 },
    { id: 'hijaz_mall', name: 'سوق الحجاز', nameEn: "Al Hijaz Souq", type: 'mall', cityId: 'makkah_city', lat: 21.4350, lng: 39.7900 },
    { id: 'taif_heart', name: 'قلب الطائف', nameEn: "Heart of Taif", type: 'mall', cityId: 'taif', lat: 21.2727, lng: 40.4163 },
    { id: 'jouri_mall', name: 'جوري مول', nameEn: "Jouri Mall", type: 'mall', cityId: 'taif', lat: 21.2634, lng: 40.3829 },

    // ========== المدينة المنورة ==========
    { id: 'noor_mall', name: 'النور مول', nameEn: "Al Noor Mall", type: 'mall', cityId: 'madinah_city', lat: 24.4671, lng: 39.6024 },
    { id: 'rashid_mall_madinah', name: 'الراشد ميغا مول', nameEn: "Al Rashid Mega Mall", type: 'mall', cityId: 'madinah_city', lat: 24.4685, lng: 39.6146 },
    { id: 'al_alyat_mall', name: 'العالية مول', nameEn: "Al Aliyah Mall", type: 'mall', cityId: 'madinah_city', lat: 24.4444, lng: 39.6111 },
    { id: 'manar_mall', name: 'المنار مول', nameEn: "Al Manar Mall", type: 'mall', cityId: 'madinah_city', lat: 24.4820, lng: 39.5777 },
    { id: 'quba_souq', name: 'سوق قباء', nameEn: "Quba Souq", type: 'market', cityId: 'madinah_city', lat: 24.4523, lng: 39.6199 },
    { id: 'yanbu_mall', name: 'ينبع مول', nameEn: "Yanbu Mall", type: 'mall', cityId: 'yanbu', lat: 24.0895, lng: 38.0618 },
    { id: 'dana_mall', name: 'الدانة مول', nameEn: "Al Dana Mall", type: 'mall', cityId: 'yanbu', lat: 24.1000, lng: 38.0500 },

    // ========== القصيم ==========
    { id: 'othaim_buraidah', name: 'العثيم مول بريدة', nameEn: "Othaim Mall Buraydah", type: 'mall', cityId: 'buraidah', lat: 26.3266, lng: 43.9750 },
    { id: 'nakheel_buraidah', name: 'النخيل بلازا', nameEn: "Nakheel Plaza", type: 'mall', cityId: 'buraidah', lat: 26.3350, lng: 43.9680 },
    { id: 'buraidah_souq', name: 'سوق بريدة المركزي', nameEn: "Buraydah Central Souq", type: 'market', cityId: 'buraidah', lat: 26.3280, lng: 43.9730 },
    { id: 'unaizah_mall', name: 'عنيزة مول', nameEn: "Unaizah Mall", type: 'mall', cityId: 'unaizah', lat: 26.0842, lng: 43.9936 },
    { id: 'rass_mall', name: 'الرس مول', nameEn: "Ar Rass Mall", type: 'mall', cityId: 'rass', lat: 25.8692, lng: 43.4975 },

    // ========== المنطقة الشرقية ==========
    { id: 'nakheel_dammam', name: 'النخيل مول الدمام', nameEn: "Nakheel Mall Dammam", type: 'mall', cityId: 'dammam', lat: 26.4193, lng: 50.0888 },
    { id: 'othaim_dammam', name: 'العثيم مول الدمام', nameEn: "Othaim Mall Dammam", type: 'mall', cityId: 'dammam', lat: 26.4350, lng: 50.0704 },
    { id: 'rashid_mega_mall', name: 'الراشد ميغا مول', nameEn: "Rashid Mega Mall", type: 'mall', cityId: 'khobar', lat: 26.2812, lng: 50.1900 },
    { id: 'dhahran_mall', name: 'الظهران مول', nameEn: "Dhahran Mall", type: 'mall', cityId: 'dhahran', lat: 26.2975, lng: 50.1413 },
    { id: 'fanateer_mall', name: 'الفناتير مول', nameEn: "Fanateer Mall", type: 'mall', cityId: 'jubail', lat: 27.0046, lng: 49.6601 },
    { id: 'jubail_mall', name: 'الجبيل مول', nameEn: "Jubail Mall", type: 'mall', cityId: 'jubail', lat: 27.0100, lng: 49.6700 },
    { id: 'ahsa_mall', name: 'الأحساء مول', nameEn: "Al Ahsa Mall", type: 'mall', cityId: 'hafuf', lat: 25.3768, lng: 49.5851 },
    { id: 'qaisariyyah_souq', name: 'سوق القيصرية', nameEn: "Qaisariyah Souq", type: 'market', cityId: 'hafuf', lat: 25.3790, lng: 49.5870 },
    { id: 'darin_mall', name: 'دارين مول', nameEn: "Darin Mall", type: 'mall', cityId: 'dammam', lat: 26.4100, lng: 50.0650 },
    { id: 'mall_dhahran', name: 'أمواج مول', nameEn: "Amwaj Mall", type: 'mall', cityId: 'dhahran', lat: 26.3111, lng: 50.1555 },
    { id: 'venezia_mall', name: 'فينيسيا مول', nameEn: "Venezia Mall", type: 'mall', cityId: 'khobar', lat: 26.2810, lng: 50.1970 },

    // ========== عسير ==========
    { id: 'abha_mall', name: 'أبها مول', nameEn: "Abha Mall", type: 'mall', cityId: 'abha', lat: 18.2295, lng: 42.5020 },
    { id: 'asir_mall', name: 'عسير مول', nameEn: "Asir Mall", type: 'mall', cityId: 'abha', lat: 18.2320, lng: 42.5200 },
    { id: 'rashid_mall_abha', name: 'الراشد مول أبها', nameEn: "Rashid Mall Abha", type: 'mall', cityId: 'abha', lat: 18.2435, lng: 42.5401 },
    { id: 'khamis_mall', name: 'الخميس أفنيو', nameEn: "Khamis Avenue", type: 'mall', cityId: 'khamis_mushait', lat: 18.3002, lng: 42.7341 },
    { id: 'mushait_mall', name: 'موجان بارك', nameEn: "Mojan Park", type: 'mall', cityId: 'khamis_mushait', lat: 18.3100, lng: 42.7500 },
    { id: 'souq_thulathi', name: 'سوق الثلاثاء', nameEn: "Tuesday Souq", type: 'market', cityId: 'abha', lat: 18.2260, lng: 42.5000 },

    // ========== المناطق الأخرى (أسواق شعبية ومولات) ==========
    { id: 'tabuk_park', name: 'تبوك بارك', nameEn: "Tabuk Park", type: 'mall', cityId: 'tabuk_city', lat: 28.3834, lng: 36.5844 },
    { id: 'tabuk_souq', name: 'سوق تبوك الشعبي', nameEn: "Tabuk Popular Souq", type: 'market', cityId: 'tabuk_city', lat: 28.3800, lng: 36.5800 },
    { id: 'hail_mall', name: 'حائل مول', nameEn: "Hail Mall", type: 'mall', cityId: 'hail_city', lat: 27.5114, lng: 41.6904 },
    { id: 'barzan_souq', name: 'سوق برزان', nameEn: "Barzan Souq", type: 'market', cityId: 'hail_city', lat: 27.5250, lng: 41.6950 },
    { id: 'salma_mall', name: 'سلمى مول', nameEn: "Salma Mall", type: 'mall', cityId: 'hail_city', lat: 27.5200, lng: 41.7000 },
    { id: 'arar_mall', name: 'عرعر مول', nameEn: "Arar Mall", type: 'mall', cityId: 'arar', lat: 30.9753, lng: 41.0200 },
    { id: 'jazan_mall', name: 'كادي مول', nameEn: "Kadi Mall", type: 'mall', cityId: 'jazan_city', lat: 16.8900, lng: 42.5500 },
    { id: 'jazan_souq', name: 'سوق جازان الداخلي (البلد)', nameEn: "Jazan Inner Souq (Al Balad)", type: 'market', cityId: 'jazan_city', lat: 16.8850, lng: 42.5550 },
    { id: 'rashid_mall_jazan', name: 'الراشد مول جازان', nameEn: "Rashid Mall Jazan", type: 'mall', cityId: 'jazan_city', lat: 16.8800, lng: 42.5600 },
    { id: 'najran_mall', name: 'نجران مول', nameEn: "Najran Mall", type: 'mall', cityId: 'najran_city', lat: 17.4922, lng: 44.1314 },
    { id: 'najran_souq', name: 'سوق الجنابي الشعبي', nameEn: "Al Janabi Popular Souq", type: 'market', cityId: 'najran_city', lat: 17.5000, lng: 44.1400 },
    { id: 'baha_mall', name: 'الباحة مول', nameEn: "Al Baha Mall", type: 'mall', cityId: 'baha_city', lat: 20.0125, lng: 41.4653 },
    { id: 'baha_souq', name: 'سوق الخميس بالباحة', nameEn: "Al Khamis Souq in Al Baha", type: 'market', cityId: 'baha_city', lat: 20.0150, lng: 41.4600 },
    { id: 'mikhwah_souq', name: 'سوق المخواة الشعبي', nameEn: "Al Makhwah Popular Souq", type: 'market', cityId: 'mikhwah', lat: 19.8227, lng: 41.4385 },
    { id: 'jouf_mall', name: 'الجوف بلازا', nameEn: "Al Jouf Plaza", type: 'mall', cityId: 'sakaka', lat: 29.9697, lng: 40.2064 },
    { id: 'jouf_souq', name: 'سوق سكاكا الشعبي', nameEn: "Sakaka Popular Souq", type: 'market', cityId: 'sakaka', lat: 29.9750, lng: 40.2100 },
    { id: 'qurayyat_mall', name: 'القريات مول', nameEn: "Qurayyat Mall", type: 'mall', cityId: 'qurayyat', lat: 31.3317, lng: 37.3414 },
    { id: 'tariq_souq', name: 'سوق طارق', nameEn: "Tariq Souq", type: 'market', cityId: 'khobar', lat: 26.2800, lng: 50.2100 },
    { id: 'suwaileh_souq', name: 'أسواق السويلم', nameEn: "Al Suwailem Markets", type: 'market', cityId: 'riyadh_city', lat: 24.6300, lng: 46.7120 },
    { id: 'ahsa_souq', name: 'سوق السويق بالاحساء', nameEn: "Al Suwaiq Souq in Al Ahsa", type: 'market', cityId: 'hafuf', lat: 25.3780, lng: 49.5880 },
    // ===== توسعة المولات والأسواق v11.98 — مصدر موثّق + تحقّق مسافة من مركز المدينة =====
    // ++ abha
    { id: 'haraj_abha', name: "حراج أبها", nameEn: "Haraj Abha", type: 'market', cityId: 'abha', lat: 18.24865, lng: 42.52805 },
    { id: 'lavanda_park', name: "لافندا بارك", nameEn: "Lavanda Park", type: 'mall', cityId: 'abha', lat: 18.24006, lng: 42.60378 },
    // ++ abu_arish
    { id: 'forsatak_shopping', name: "فرصتك للتسوق", nameEn: "Forsatak Shopping Mall", type: 'mall', cityId: 'abu_arish', lat: 16.96142, lng: 42.82163 },
    { id: 'the_region', name: "ذي ريجن مول", nameEn: "The Region Mall", type: 'mall', cityId: 'abu_arish', lat: 16.96051, lng: 42.82166 },
    // ++ arar
    { id: 'arar_vegetable', name: "سوق الخضار بعرعر", nameEn: "Arar Vegetable Market", type: 'market', cityId: 'arar', lat: 30.97687, lng: 41.01281 },
    { id: 'valley', name: "فالي مول", nameEn: "Valley Mall", type: 'mall', cityId: 'arar', lat: 30.96629, lng: 41.02432 },
    // ++ badr
    { id: 'abdullah_al_othaim_markets', name: "أسواق عبدالله العثيم", nameEn: "Abdullah Al Othaim Markets", type: 'market', cityId: 'badr', lat: 23.78007, lng: 38.79702 },
    // ++ baha_city
    { id: 'ghoneim_mall', name: "الغنيم مول", nameEn: "Al Ghoneim Mall", type: 'mall', cityId: 'baha_city', lat: 20.00719, lng: 41.45171 },
    // ++ baljurashi
    { id: 'baljurashi_mall', name: "بلجرشي مول", nameEn: "Baljurashi Mall", type: 'mall', cityId: 'baljurashi', lat: 19.88378, lng: 41.56766 },
    // ++ baqaa
    { id: 'vegetable_market_baqaa', name: "سوق الخضار (بقعاء)", nameEn: "Vegetable Market (Baqaa)", type: 'market', cityId: 'baqaa', lat: 27.9027, lng: 42.3944 },
    // ++ bariq
    { id: 'souq_al_ajamah', name: "سوق العجمة", nameEn: "Souq Al Ajamah", type: 'market', cityId: 'bariq', lat: 19.01128, lng: 41.87948 },
    { id: 'souq_al_rubu', name: "سوق الربوع", nameEn: "Souq Al Rubu", type: 'market', cityId: 'bariq', lat: 18.9285, lng: 41.91195 },
    // ++ bukayriah
    { id: 'al_bukayriyah', name: "مول البكيرية", nameEn: "Al Bukayriyah Mall", type: 'mall', cityId: 'bukayriah', lat: 26.14386, lng: 43.65071 },
    { id: 'monday_popular', name: "سوق الاثنين الشعبي", nameEn: "Monday Popular Market", type: 'market', cityId: 'bukayriah', lat: 26.12278, lng: 43.67721 },
    // ++ bukayriyah_q
    { id: 'al_bukayriyah_bukayriyah_q', name: "مول البكيرية", nameEn: "Al Bukayriyah Mall", type: 'mall', cityId: 'bukayriyah_q', lat: 26.14386, lng: 43.65071 },
    { id: 'monday_popular_bukayriyah_q', name: "سوق الاثنين الشعبي", nameEn: "Monday Popular Market", type: 'market', cityId: 'bukayriyah_q', lat: 26.12278, lng: 43.67721 },
    // ++ buraidah
    { id: 'al_faiziah', name: "مول الفايزية", nameEn: "Al Faiziah Mall", type: 'mall', cityId: 'buraidah', lat: 26.38628, lng: 43.96259 },
    { id: 'al_rashid', name: "الراشد مول", nameEn: "Al Rashid Mall", type: 'mall', cityId: 'buraidah', lat: 26.36763, lng: 43.94281 },
    { id: 'alhasson', name: "الحسون سنتر", nameEn: "Alhasson Center", type: 'mall', cityId: 'buraidah', lat: 26.36686, lng: 43.94225 },
    { id: 'aljedaie', name: "الجديعي مول", nameEn: "Aljedaie Mall", type: 'mall', cityId: 'buraidah', lat: 26.3741, lng: 43.93634 },
    { id: 'birds', name: "سوق الطيور", nameEn: "Birds Market", type: 'market', cityId: 'buraidah', lat: 26.35468, lng: 44.0461 },
    { id: 'central_dates', name: "سوق التمور المركزي", nameEn: "Central Dates Market", type: 'market', cityId: 'buraidah', lat: 26.3135, lng: 43.98242 },
    { id: 'vegetable_and_fruit', name: "سوق الخضار والفواكه", nameEn: "Vegetable and Fruit Market", type: 'market', cityId: 'buraidah', lat: 26.3123, lng: 43.97844 },
    // ++ dammam
    { id: 'dammam_fish', name: "سوق السمك بالدمام", nameEn: "Dammam Fish Market", type: 'market', cityId: 'dammam', lat: 26.44576, lng: 50.06573 },
    { id: 'marina_mall_dammam', name: "مارينا مول الدمام", nameEn: "Marina Mall Dammam", type: 'mall', cityId: 'dammam', lat: 26.45508, lng: 50.10569 },
    // ++ dawadmi
    { id: 'othaim', name: "سوق العثيم", nameEn: "Othaim Market", type: 'market', cityId: 'dawadmi', lat: 24.516, lng: 44.4103 },
    // ++ diriyah
    { id: 'al_makan', name: "المكان مول", nameEn: "Al Makan Mall", type: 'mall', cityId: 'diriyah', lat: 24.79055, lng: 46.61177 },
    { id: 'lumiere', name: "لوميير مول", nameEn: "Lumiere Mall", type: 'mall', cityId: 'diriyah', lat: 24.75987, lng: 46.60362 },
    { id: 'riyadh_park_diriyah', name: "الرياض بارك", nameEn: "Riyadh Park", type: 'mall', cityId: 'diriyah', lat: 24.75677, lng: 46.62987 },
    { id: 'u_walk', name: "يو ووك", nameEn: "U Walk", type: 'mall', cityId: 'diriyah', lat: 24.73804, lng: 46.62882 },
    // ++ dumat_jandal
    { id: 'arena_al_jouf', name: "مول أرينا الجوف", nameEn: "Arena Al Jouf Mall", type: 'mall', cityId: 'dumat_jandal', lat: 29.79867, lng: 39.8535 },
    // ++ hafar_al_batin
    { id: 'al_othaim_mall_hafar_al_batin', name: "العثيم مول حفر الباطن", nameEn: "Al Othaim Mall Hafar Al Batin", type: 'mall', cityId: 'hafar_al_batin', lat: 28.3186, lng: 45.95045 },
    { id: 'hala', name: "هلا مول", nameEn: "Hala Mall", type: 'mall', cityId: 'hafar_al_batin', lat: 28.41218, lng: 45.99798 },
    { id: 'sarh_al_muslim', name: "صرح المسلم مول", nameEn: "Sarh Al Muslim Mall", type: 'mall', cityId: 'hafar_al_batin', lat: 28.40919, lng: 45.97097 },
    // ++ hafuf
    { id: 'al_haraj_souq_mubarraz', name: "سوق الحراج بالمبرز", nameEn: "Al Haraj Souq Mubarraz", type: 'market', cityId: 'hafuf', lat: 25.39579, lng: 49.5936 },
    { id: 'al_othaim_mall_mubarraz', name: "العثيم مول المبرز", nameEn: "Al Othaim Mall Mubarraz", type: 'mall', cityId: 'hafuf', lat: 25.40022, lng: 49.57793 },
    { id: 'al_soni_electronics', name: "سوق السوني للإلكترونيات", nameEn: "Al Soni Electronics Souq", type: 'market', cityId: 'hafuf', lat: 25.38062, lng: 49.58997 },
    { id: 'nakheel_plaza_hofuf', name: "النخيل بلازا", nameEn: "Nakheel Plaza Hofuf", type: 'mall', cityId: 'hafuf', lat: 25.35966, lng: 49.54755 },
    // ++ hail_city
    { id: 'centrepoint_hail', name: "سنتر بوينت حائل", nameEn: "Centrepoint Hail", type: 'mall', cityId: 'hail_city', lat: 27.50929, lng: 41.69929 },
    { id: 'garden_mall_mango_garden', name: "الحديقة مول (مانجو جاردن مول)", nameEn: "Garden Mall (MANGO Garden Mall)", type: 'mall', cityId: 'hail_city', lat: 27.55437, lng: 41.68155 },
    { id: 'grand', name: "جراند مول", nameEn: "Grand Mall", type: 'mall', cityId: 'hail_city', lat: 27.47394, lng: 41.67696 },
    { id: 'hail_square', name: "مجمع حائل سكوير", nameEn: "Hail Square", type: 'mall', cityId: 'hail_city', lat: 27.4999, lng: 41.67051 },
    { id: 'othaim_mall_hail', name: "العثيم مول حائل", nameEn: "Othaim Mall Hail", type: 'mall', cityId: 'hail_city', lat: 27.47404, lng: 41.67665 },
    // ++ haql
    { id: 'othaim_markets', name: "أسواق العثيم", nameEn: "Othaim Markets", type: 'market', cityId: 'haql', lat: 29.28114, lng: 34.93833 },
    // ++ jazan_city
    { id: 'vegetable_and_fruit_jazan_city', name: "سوق الخضار والفواكه", nameEn: "Vegetable and Fruit Market", type: 'market', cityId: 'jazan_city', lat: 16.90174, lng: 42.54598 },
    // ++ jeddah
    { id: 'hera', name: "حراء مول", nameEn: "Hera Mall", type: 'mall', cityId: 'jeddah', lat: 21.61092, lng: 39.13918 },
    { id: 'jeddah_park', name: "جدة بارك", nameEn: "Jeddah Park", type: 'mall', cityId: 'jeddah', lat: 21.55622, lng: 39.18497 },
    { id: 'le_prestige', name: "لو بريستيج مول", nameEn: "Le Prestige Mall", type: 'mall', cityId: 'jeddah', lat: 21.56564, lng: 39.12501 },
    { id: 'souq_al_alawi_al_balad', name: "سوق العلوي (البلد)", nameEn: "Souq Al Alawi (Al Balad)", type: 'market', cityId: 'jeddah', lat: 21.48421, lng: 39.1875 },
    // ++ khafji
    { id: 'al_othaim_mall_khafji', name: "العثيم مول الخفجي", nameEn: "Al Othaim Mall Khafji", type: 'mall', cityId: 'khafji', lat: 28.42172, lng: 48.48063 },
    // ++ khamis_mushait
    { id: 'asdaf', name: "أصداف مول", nameEn: "Asdaf Mall", type: 'mall', cityId: 'khamis_mushait', lat: 18.306, lng: 42.73223 },
    // ++ kharj
    { id: 'al_wahah', name: "الواحة مول", nameEn: "Al Wahah Mall", type: 'mall', cityId: 'kharj', lat: 24.12969, lng: 47.26459 },
    { id: 'al_warood', name: "الورود بلازا", nameEn: "Al Warood Plaza", type: 'mall', cityId: 'kharj', lat: 24.15889, lng: 47.29999 },
    { id: 'jaw', name: "جو مول", nameEn: "Jaw Mall", type: 'mall', cityId: 'kharj', lat: 24.16612, lng: 47.33396 },
    // ++ khaybar
    { id: 'al_muthallath_shopping', name: "مركز المثلث للتسويق", nameEn: "Al Muthallath Shopping Center", type: 'market', cityId: 'khaybar', lat: 25.69404, lng: 39.29546 },
    { id: 'al_takamul_shopping', name: "التكامل للتسوق", nameEn: "Al Takamul Shopping Center", type: 'market', cityId: 'khaybar', lat: 25.69192, lng: 39.29413 },
    // ++ laith
    { id: 'souq_mugaybil', name: "سوق مقيبل", nameEn: "Souq Mugaybil", type: 'market', cityId: 'laith', lat: 20.14874, lng: 40.27905 },
    // ++ madinah_city
    { id: 'al_jabri', name: "مجمع الجابري", nameEn: "Al Jabri Mall", type: 'mall', cityId: 'madinah_city', lat: 24.45801, lng: 39.61439 },
    { id: 'al_jazira_shopping', name: "مجمع الجزيرة للتسوق", nameEn: "Al Jazira Shopping Mall", type: 'mall', cityId: 'madinah_city', lat: 24.46393, lng: 39.61504 },
    { id: 'al_madinah', name: "المدينة سنتر", nameEn: "Al Madinah Center", type: 'mall', cityId: 'madinah_city', lat: 24.45744, lng: 39.59598 },
    { id: 'al_madinah_international', name: "سوق المدينة الدولي", nameEn: "Al Madinah International Souq", type: 'market', cityId: 'madinah_city', lat: 24.48355, lng: 39.59765 },
    { id: 'al_qarat', name: "مجمع القارات", nameEn: "Al Qarat Mall", type: 'mall', cityId: 'madinah_city', lat: 24.49415, lng: 39.60089 },
    { id: 'al_rashed', name: "الراشد مول", nameEn: "Al Rashed Mall", type: 'mall', cityId: 'madinah_city', lat: 24.48731, lng: 39.64953 },
    { id: 'centre_point', name: "سنتر بوينت", nameEn: "Centre Point", type: 'mall', cityId: 'madinah_city', lat: 24.46382, lng: 39.61196 },
    { id: 'hassan', name: "حسن مول", nameEn: "Hassan Mall", type: 'mall', cityId: 'madinah_city', lat: 24.49799, lng: 39.6185 },
    { id: 'j_walk', name: "جي ووك", nameEn: "J Walk", type: 'mall', cityId: 'madinah_city', lat: 24.45791, lng: 39.54429 },
    { id: 'mazaia', name: "مزايا مول", nameEn: "Mazaia Mall", type: 'mall', cityId: 'madinah_city', lat: 24.48476, lng: 39.61045 },
    { id: 'namia', name: "مركز نامية", nameEn: "Namia Center", type: 'mall', cityId: 'madinah_city', lat: 24.47195, lng: 39.61277 },
    { id: 'new_bilal', name: "سوق بلال الجديد", nameEn: "New Bilal Market", type: 'market', cityId: 'madinah_city', lat: 24.46187, lng: 39.61181 },
    { id: 'new_dates', name: "سوق التمور الجديد", nameEn: "New Dates Market", type: 'market', cityId: 'madinah_city', lat: 24.41674, lng: 39.61705 },
    { id: 'qurban', name: "قربان مول", nameEn: "Qurban Mall", type: 'mall', cityId: 'madinah_city', lat: 24.45376, lng: 39.61994 },
    { id: 'rotana', name: "روتانا مول", nameEn: "Rotana Mall", type: 'mall', cityId: 'madinah_city', lat: 24.45845, lng: 39.6664 },
    { id: 'space', name: "سبيس مول", nameEn: "Space Mall", type: 'mall', cityId: 'madinah_city', lat: 24.48584, lng: 39.58935 },
    // ++ mahad_adh_dhahab
    { id: 'abdullah_al_othaim_markets_mahad_adh_dhahab', name: "أسواق عبدالله العثيم", nameEn: "Abdullah Al Othaim Markets", type: 'market', cityId: 'mahad_adh_dhahab', lat: 23.50642, lng: 40.88548 },
    // ++ mahail_asir
    { id: 'oasis_al_waha', name: "الواحة مول", nameEn: "Oasis (Al Waha) Mall", type: 'mall', cityId: 'mahail_asir', lat: 18.55198, lng: 42.04006 },
    // ++ majmaah
    { id: 'majmaah', name: "مول المجمعة", nameEn: "Majmaah Mall", type: 'mall', cityId: 'majmaah', lat: 25.90935, lng: 45.34319 },
    { id: 'othaim_majmaah', name: "العثيم مول", nameEn: "Othaim Mall", type: 'mall', cityId: 'majmaah', lat: 25.90262, lng: 45.35489 },
    // ++ makkah_city
    { id: 'souq_al_arab', name: "سوق العرب", nameEn: "Souq Al Arab", type: 'market', cityId: 'makkah_city', lat: 21.44615, lng: 39.85599 },
    { id: 'souq_al_khalil', name: "سوق الخليل", nameEn: "Souq Al Khalil", type: 'market', cityId: 'makkah_city', lat: 21.42122, lng: 39.82186 },
    { id: 'souq_al_tamr_dates', name: "سوق التمور", nameEn: "Souq Al Tamr (Dates Market)", type: 'market', cityId: 'makkah_city', lat: 21.37039, lng: 39.80595 },
    // ++ muznib
    { id: 'al_muznib_old_heritage', name: "سوق المذنب القديم التراثي", nameEn: "Al Muznib Old Heritage Market", type: 'market', cityId: 'muznib', lat: 25.86836, lng: 44.22761 },
    // ++ nairyah
    { id: 'nairyah_popular', name: "سوق النعيرية الشعبي", nameEn: "Nairyah Popular Souq", type: 'market', cityId: 'nairyah', lat: 27.465, lng: 48.4806 },
    // ++ najran_city
    { id: 'al_azzam', name: "العزّام مول", nameEn: "Al-Azzam Mall", type: 'mall', cityId: 'najran_city', lat: 17.53926, lng: 44.21432 },
    { id: 'al_faisaliah_market_for_vegetables_fruit', name: "سوق الفيصلية للخضار والفواكه واللحوم", nameEn: "Al-Faisaliah Market for Vegetables, Fruits and Meat", type: 'market', cityId: 'najran_city', lat: 17.52588, lng: 44.20105 },
    { id: 'najran_royal', name: "نجران رويال مول", nameEn: "Najran Royal Mall", type: 'mall', cityId: 'najran_city', lat: 17.55017, lng: 44.25779 },
    { id: 'suq_al_haraj_wa_al_aghnam_popular_livest', name: "سوق الحراج والأغنام (سوق الجنابي الشعبي)", nameEn: "Suq Al-Haraj wa Al-Aghnam (popular livestock market)", type: 'market', cityId: 'najran_city', lat: 17.49389, lng: 44.15213 },
    // ++ namas
    { id: 'al_namas', name: "النماص مول", nameEn: "Al Namas Mall", type: 'mall', cityId: 'namas', lat: 19.11868, lng: 42.13088 },
    // ++ qatif
    { id: 'city_mall_qatif', name: "مجمع سيتي مول بالقطيف", nameEn: "City Mall Qatif", type: 'mall', cityId: 'qatif', lat: 26.55785, lng: 50.0377 },
    { id: 'qatif', name: "مجمع القطيف بلازا", nameEn: "Qatif Plaza", type: 'mall', cityId: 'qatif', lat: 26.5509, lng: 50.01545 },
    { id: 'qatif_central_fish', name: "سوق السمك المركزي بالقطيف", nameEn: "Qatif Central Fish Market", type: 'market', cityId: 'qatif', lat: 26.55533, lng: 50.00797 },
    { id: 'qatif_thursday', name: "سوق الخميس بالقطيف", nameEn: "Qatif Thursday Souq", type: 'market', cityId: 'qatif', lat: 26.55686, lng: 49.99917 },
    // ++ qurayyat
    { id: 'al_wisam_discount', name: "مركز الوسام للتخفيضات", nameEn: "Al Wisam Discount Center", type: 'mall', cityId: 'qurayyat', lat: 31.31927, lng: 37.35733 },
    // ++ rabigh
    { id: 'rabigh', name: "رابغ مول", nameEn: "Rabigh Mall", type: 'mall', cityId: 'rabigh', lat: 22.78871, lng: 39.03258 },
    { id: 'rabigh_livestock', name: "سوق رابغ للمواشي", nameEn: "Rabigh Livestock Market", type: 'market', cityId: 'rabigh', lat: 22.77047, lng: 39.05598 },
    // ++ rafha
    { id: 'rafha_shopping', name: "مركز تسوق رفحاء", nameEn: "Rafha Shopping Center", type: 'market', cityId: 'rafha', lat: 29.6177, lng: 43.5263 },
    // ++ rass
    { id: 'al_deira', name: "الديرة مول", nameEn: "Al Deira Mall", type: 'mall', cityId: 'rass', lat: 25.86894, lng: 43.50871 },
    { id: 'al_othaim_mall_al_rass', name: "العثيم مول الرس", nameEn: "Al Othaim Mall Al Rass", type: 'mall', cityId: 'rass', lat: 25.8976, lng: 43.4719 },
    { id: 'al_rass_vegetable_and_fruit', name: "سوق الخضار والفواكه بالرس", nameEn: "Al Rass Vegetable and Fruit Market", type: 'market', cityId: 'rass', lat: 25.87303, lng: 43.50978 },
    { id: 'city', name: "سيتي سنتر", nameEn: "City Center", type: 'mall', cityId: 'rass', lat: 25.86832, lng: 43.50466 },
    { id: 'sahara', name: "صحارى مول", nameEn: "Sahara Mall", type: 'mall', cityId: 'rass', lat: 25.86681, lng: 43.50653 },
    // ++ riyadh_al_khabra
    { id: 'riyadh_al_khabra_local_dates', name: "سوق رياض الخبراء للتمور المحلية", nameEn: "Riyadh Al Khabra Local Dates Market", type: 'market', cityId: 'riyadh_al_khabra', lat: 26.05628, lng: 43.56225 },
    // ++ sabya
    { id: 'al_qahtani_commercial_complex', name: "مجمع القحطاني التجاري", nameEn: "Al Qahtani Commercial Complex", type: 'market', cityId: 'sabya', lat: 17.10284, lng: 42.65453 },
    { id: 'al_salwa_commercial_complex', name: "مجمع السلوى التجاري", nameEn: "Al Salwa Commercial Complex", type: 'market', cityId: 'sabya', lat: 17.08745, lng: 42.64619 },
    { id: 'tuesday', name: "سوق الثلاثاء", nameEn: "Tuesday Market", type: 'market', cityId: 'sabya', lat: 17.21531, lng: 42.6438 },
    // ++ sakaka
    { id: 'al_hassoun', name: "مول الحسون", nameEn: "Al Hassoun Mall", type: 'mall', cityId: 'sakaka', lat: 29.95443, lng: 40.19022 },
    { id: 'ala_kefak', name: "على كيفك", nameEn: "Ala Kefak Mall", type: 'mall', cityId: 'sakaka', lat: 29.97625, lng: 40.21262 },
    { id: 'downtown', name: "سوق داون تاون", nameEn: "Downtown Market", type: 'market', cityId: 'sakaka', lat: 29.95638, lng: 40.20963 },
    { id: 'jouf_square', name: "سكوير الجوف", nameEn: "Jouf Square", type: 'mall', cityId: 'sakaka', lat: 29.97628, lng: 40.21388 },
    { id: 'samina', name: "سوق سمينا", nameEn: "Samina Market", type: 'market', cityId: 'sakaka', lat: 29.95852, lng: 40.19388 },
    // ++ samitah
    { id: 'al_burhan', name: "البرهان مول", nameEn: "Al Burhan Mall", type: 'mall', cityId: 'samitah', lat: 16.60476, lng: 42.93732 },
    // ++ shakra
    { id: 'al_andalus_commercial', name: "سوق الأندلس التجاري", nameEn: "Al Andalus Commercial Market", type: 'market', cityId: 'shakra', lat: 25.24348, lng: 45.25844 },
    { id: 'shaqra_commercial', name: "سوق شقراء التجاري", nameEn: "Shaqra Commercial Souq", type: 'mall', cityId: 'shakra', lat: 25.25182, lng: 45.25584 },
    { id: 'vegetable_and_meat', name: "سوق الخضار واللحوم", nameEn: "Vegetable and Meat Market", type: 'market', cityId: 'shakra', lat: 25.24551, lng: 45.2601 },
    // ++ tabuk_city
    { id: 'al_hokair', name: "الحكير مول", nameEn: "Al Hokair Mall", type: 'mall', cityId: 'tabuk_city', lat: 28.39513, lng: 36.54863 },
    { id: 'al_raqi', name: "الراقي مول", nameEn: "Al Raqi Mall", type: 'mall', cityId: 'tabuk_city', lat: 28.36265, lng: 36.56715 },
    { id: 'al_sannabel', name: "السنابل مول", nameEn: "Al Sannabel Mall", type: 'mall', cityId: 'tabuk_city', lat: 28.38679, lng: 36.56383 },
    { id: 'central_marketplace', name: "السوق المركزي (سوق شعبي)", nameEn: "Central Marketplace", type: 'market', cityId: 'tabuk_city', lat: 28.40525, lng: 36.53974 },
    { id: 'park_mall_tabuk_park', name: "بارك مول", nameEn: "Park Mall (Tabuk Park)", type: 'mall', cityId: 'tabuk_city', lat: 28.42928, lng: 36.57293 },
    { id: 'vegetable_market_souk_khodra', name: "سوق الخضار", nameEn: "Vegetable Market (Souk Khodra)", type: 'market', cityId: 'tabuk_city', lat: 28.40407, lng: 36.53963 },
    // ++ taif
    { id: 'central_fish', name: "سوق السمك المركزي", nameEn: "Central Fish Market", type: 'market', cityId: 'taif', lat: 21.27214, lng: 40.4063 },
    { id: 'souq_al_anqari', name: "سوق العنقري", nameEn: "Souq Al Anqari", type: 'market', cityId: 'taif', lat: 21.27306, lng: 40.43041 },
    { id: 'souq_al_obeikan', name: "سوق العبيكان", nameEn: "Souq Al Obeikan", type: 'market', cityId: 'taif', lat: 21.27395, lng: 40.42407 },
    { id: 'taif_international', name: "سوق الطائف الدولي", nameEn: "Taif International Mall", type: 'mall', cityId: 'taif', lat: 21.27248, lng: 40.43202 },
    { id: 'tera', name: "تيرا مول", nameEn: "Tera Mall", type: 'mall', cityId: 'taif', lat: 21.27955, lng: 40.44451 },
    // ++ turayf
    { id: 'othaim_markets_turaif', name: "أسواق العثيم طريف", nameEn: "Othaim Markets Turaif", type: 'market', cityId: 'turayf', lat: 31.67789, lng: 38.67636 },
    // ++ ula
    { id: 'vegetable_market_alula', name: "سوق الخضار", nameEn: "Vegetable Market (AlUla)", type: 'market', cityId: 'ula', lat: 26.60796, lng: 37.92485 },
    // ++ umluj
    { id: 'al_olayan', name: "سوق العليان", nameEn: "Al Olayan Market", type: 'market', cityId: 'umluj', lat: 25.03464, lng: 37.26026 },
    // ++ unaizah
    { id: 'al_othaim_mall_unaizah', name: "العثيم مول عنيزة", nameEn: "Al Othaim Mall Unaizah", type: 'mall', cityId: 'unaizah', lat: 26.10741, lng: 43.9946 },
    { id: 'onaizah_dates', name: "سوق التمور بعنيزة", nameEn: "Onaizah Dates Market", type: 'market', cityId: 'unaizah', lat: 26.11218, lng: 44.02987 },
    { id: 'onaizah_friday', name: "سوق الجمعة بعنيزة", nameEn: "Onaizah Friday Market", type: 'market', cityId: 'unaizah', lat: 26.11258, lng: 44.02515 },
    // ++ uwayqilah
    { id: 'abdullah_al_othaim_markets_uwayqilah', name: "أسواق عبدالله العثيم العويقيلة", nameEn: "Abdullah Al-Othaim Markets Uwayqilah", type: 'market', cityId: 'uwayqilah', lat: 30.3504, lng: 42.2441 },
    // ++ wadi_ad_dawasir
    { id: 'al_liddam_general', name: "سوق اللدام العام", nameEn: "Al Liddam General Souq", type: 'market', cityId: 'wadi_ad_dawasir', lat: 20.46834, lng: 44.79115 },
    { id: 'dates', name: "سوق التمور", nameEn: "Dates Souq", type: 'market', cityId: 'wadi_ad_dawasir', lat: 20.46767, lng: 44.7904 },
    { id: 'popular', name: "السوق الشعبي", nameEn: "Popular Souq", type: 'market', cityId: 'wadi_ad_dawasir', lat: 20.4678, lng: 44.79102 },
    { id: 'sahara_central_markets', name: "أسواق الصحارى المركزية", nameEn: "Sahara Central Markets", type: 'market', cityId: 'wadi_ad_dawasir', lat: 20.46119, lng: 44.78082 },
    { id: 'vegetable_and_fruit_wadi_ad_dawasir', name: "سوق الخضار والفواكه", nameEn: "Vegetable and Fruit Market", type: 'market', cityId: 'wadi_ad_dawasir', lat: 20.46936, lng: 44.78333 },
    // ++ yanbu
    { id: 'al_jawhara', name: "الجوهرة مول", nameEn: "Al Jawhara Mall", type: 'mall', cityId: 'yanbu', lat: 24.01506, lng: 38.19835 },
    { id: 'al_nakheel', name: "سوق النخيل", nameEn: "Al Nakheel Market", type: 'market', cityId: 'yanbu', lat: 24.01428, lng: 38.19323 },
    { id: 'al_rabiah', name: "الرابية مول", nameEn: "Al Rabiah Mall", type: 'mall', cityId: 'yanbu', lat: 24.10258, lng: 38.03175 },
    { id: 'dana', name: "دانا مول", nameEn: "Dana Mall", type: 'mall', cityId: 'yanbu', lat: 24.03318, lng: 38.19359 },
    { id: 'fish', name: "سوق السمك", nameEn: "Fish Market", type: 'market', cityId: 'yanbu', lat: 24.07426, lng: 38.05381 },
    { id: 'miro', name: "ميرو مول", nameEn: "Miro Mall", type: 'mall', cityId: 'yanbu', lat: 24.02461, lng: 38.22315 },
    { id: 'royal_plaza_shopping', name: "مركز تسوق رويال بلازا", nameEn: "Royal Plaza Shopping Center", type: 'mall', cityId: 'yanbu', lat: 24.08543, lng: 38.05612 },
    // ++ zulfi
    { id: 'central', name: "السوق المركزي", nameEn: "Central Market", type: 'market', cityId: 'zulfi', lat: 26.29625, lng: 44.80762 },
    { id: 'city_zulfi', name: "ستي مول", nameEn: "City Mall", type: 'mall', cityId: 'zulfi', lat: 26.29335, lng: 44.80743 },
    { id: 'vegetable_and_dates', name: "سوق الخضار والتمور", nameEn: "Vegetable and Dates Market", type: 'market', cityId: 'zulfi', lat: 26.29472, lng: 44.8086 },
];

// ============================================================
// المتاجر
// ============================================================
export const STORES: Store[] = [
    { id: 'm1', name: 'محل الأناقة', rating: 4.8, lat: 24.7669, lng: 46.6806, address: 'النخيل مول، الرياض' },
    { id: 'store_2', name: 'عطور باريس', rating: 4.5, lat: 24.7578, lng: 46.6300, address: 'الرياض بارك، الرياض' },
    { id: 'store_3', name: 'أزياء الشرق', rating: 4.7, lat: 24.6907, lng: 46.6653, address: 'الرياض جاليري، الرياض' },
    { id: 'store_4', name: 'تقنيات المستقبل', rating: 4.9, lat: 24.7003, lng: 46.6842, address: 'بانوراما مول، الرياض' },
    { id: 'store_5', name: 'مطعم البيت السعودي', rating: 4.6, lat: 21.6274, lng: 39.1185, address: 'رد سي مول، جدة' },
    { id: 'store_6', name: 'رياضة الأبطال', rating: 4.4, lat: 21.5834, lng: 39.1461, address: 'مول العرب، جدة' },
    { id: 'store_7', name: 'كوفي تايم', rating: 4.8, lat: 26.4193, lng: 50.0888, address: 'النخيل مول، الدمام' },
    { id: 'store_8', name: 'أثاث المنزل العصري', rating: 4.3, lat: 26.2812, lng: 50.1900, address: 'الراشد ميغا مول، الخبر' },
    { id: 'store_9', name: 'سوبرماركت الخير', rating: 4.5, lat: 24.4671, lng: 39.6024, address: 'النور مول، المدينة' },
    { id: 'store_10', name: 'ملابس الصغار', rating: 4.7, lat: 18.2295, lng: 42.5020, address: 'أبها مول، أبها' },
];

export const USER_LOCATION = { lat: 24.7136, lng: 46.6753 };

export const getLocation = (id: string): Location | undefined => LOCATIONS.find(l => l.id === id);
export const getCity = (id: string): City | undefined => CITIES.find(c => c.id === id);
export const getRegion = (id: string): Region | undefined => REGIONS.find(r => r.id === id);

/**
 * Hydrate the malls/markets list from the DB (admin-managed via the «إدارة
 * المولات والأسواق» tool). The exported LOCATIONS array is mutated IN PLACE so
 * every module that already imported it — getLocation, helpers, all pickers —
 * sees the curated list without re-importing. AppContext calls this on startup
 * and after an admin edit, then bumps a version so the tree re-reads. We never
 * blank the list on an empty/failed fetch (the bundled list stays as fallback).
 * (v12.01)
 */
export const replaceLocations = (next: Location[]): void => {
    if (!Array.isArray(next) || next.length === 0) return;
    LOCATIONS.length = 0;
    LOCATIONS.push(...next);
};

// Localized display name for a geography item (region/city/mall). Falls back to the
// Arabic name when English is unavailable, so nothing ever shows blank. v11.88
export const geoName = (
    item: { name: string; nameEn?: string } | null | undefined,
    language?: 'ar' | 'en',
): string => (language === 'en' && item?.nameEn ? item.nameEn : (item?.name || ''));
export const getStore = (id: string): Store | undefined => STORES.find(s => s.id === id);
