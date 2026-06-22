export type Category =
    | 'Fashion_Women'
    | 'Fashion_Men'
    | 'Kids_Infants'
    | 'Kids_Girls'
    | 'Electronics'
    | 'Food'
    | 'Beauty'
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

// Localized display name for a geography item (region/city/mall). Falls back to the
// Arabic name when English is unavailable, so nothing ever shows blank. v11.88
export const geoName = (
    item: { name: string; nameEn?: string } | null | undefined,
    language?: 'ar' | 'en',
): string => (language === 'en' && item?.nameEn ? item.nameEn : (item?.name || ''));
export const getStore = (id: string): Store | undefined => STORES.find(s => s.id === id);
