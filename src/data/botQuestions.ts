/**
 * TAKI Bot Question Flows
 * 
 * These question flows define the conversation structure for
 * Telegram and WhatsApp bots. Each flow is a sequence of questions
 * that the bot will ask the user to gather the required information.
 * 
 * Usage: The bot handler reads these flows and presents each question
 * in sequence, collecting answers into a payload object.
 */

export interface BotQuestion {
    id: string;
    textAr: string;
    textEn: string;
    type: 'text' | 'number' | 'select' | 'location' | 'image' | 'confirm';
    required: boolean;
    options?: { value: string; labelAr: string; labelEn: string }[];
    validation?: {
        pattern?: string;
        min?: number;
        max?: number;
        errorAr?: string;
        errorEn?: string;
    };
    mapToField: string; // field name in the payload
}

// ============================================================
// أسئلة البائع عند نشر عرض جديد
// ============================================================
export const SELLER_PUBLISH_FLOW: BotQuestion[] = [
    {
        id: 'shop_name',
        textAr: '🏪 ما اسم محلك؟',
        textEn: '🏪 What is your shop name?',
        type: 'text',
        required: true,
        validation: { errorAr: 'يرجى إدخال اسم المحل', errorEn: 'Please enter the shop name' },
        mapToField: 'shopName'
    },
    {
        id: 'item_name',
        textAr: '📦 ما اسم المنتج المعروض؟',
        textEn: '📦 What is the product name?',
        type: 'text',
        required: true,
        validation: { errorAr: 'يرجى إدخال اسم المنتج', errorEn: 'Please enter the product name' },
        mapToField: 'itemName'
    },
    {
        id: 'category',
        textAr: '🏷️ اختر تصنيف المنتج:',
        textEn: '🏷️ Select the product category:',
        type: 'select',
        required: true,
        options: [
            { value: 'Fashion_Women', labelAr: '👗 فساتين ونساء', labelEn: '👗 Women Clothing' },
            { value: 'Fashion_Men', labelAr: '👔 ملابس رجالية', labelEn: '👔 Men Clothing' },
            { value: 'Kids_Infants', labelAr: '👶 أطفال ورضع', labelEn: '👶 Infants' },
            { value: 'Electronics', labelAr: '📱 إلكترونيات', labelEn: '📱 Electronics' },
            { value: 'Food', labelAr: '🍔 مطاعم', labelEn: '🍔 Food' },
            { value: 'Beauty', labelAr: '💄 عطور وتجميل', labelEn: '💄 Beauty' },
            { value: 'MensSalon', labelAr: '💈 صالون رجالي', labelEn: '💈 Barbershop' },
            { value: 'WomensSalon', labelAr: '💇‍♀️ صالون نسائي', labelEn: "💇‍♀️ Women's Salon" },
            { value: 'Sports', labelAr: '⚽ رياضة', labelEn: '⚽ Sports' },
            { value: 'Supermarket', labelAr: '🛒 سوبرماركت', labelEn: '🛒 Supermarket' },
            { value: 'Butcher', labelAr: '🥩 ملحمة', labelEn: '🥩 Butcher' },
            { value: 'Sanitary', labelAr: '🚿 أدوات صحية', labelEn: '🚿 Sanitary' },
            { value: 'Cafe', labelAr: '☕ مقاهي', labelEn: '☕ Cafes' },
            { value: 'Home', labelAr: '🏠 منزل وديكور', labelEn: '🏠 Home' },
            { value: 'Hotels', labelAr: '🏨 فنادق', labelEn: '🏨 Hotels' },
            { value: 'CarRentals', labelAr: '🚗 تأجير سيارات', labelEn: '🚗 Car Rentals' },
            { value: 'Laundry', labelAr: '🧺 مغسلة ملابس', labelEn: '🧺 Laundromats' },
            { value: 'MensTailor', labelAr: '🧵 خياطة رجالية', labelEn: "🧵 Men's Tailor" },
            { value: 'WomensTailor', labelAr: '🪡 مشغل نسائي', labelEn: "🪡 Women's Tailor" },
            { value: 'CarWash', labelAr: '🧽 مغسلة سيارات', labelEn: '🧽 Car Wash' },
            { value: 'CarWorkshop', labelAr: '🔧 ورش سيارات', labelEn: '🔧 Car Workshops' },
            { value: 'Amusements', labelAr: '🎡 ملاهي ألعاب', labelEn: '🎡 Amusements' },
            { value: 'Gym', labelAr: '🏋️ نادي رياضي', labelEn: '🏋️ Gym' },
            { value: 'Library', labelAr: '📚 مكتبة', labelEn: '📚 Library' },
            { value: 'Nursery', labelAr: '🌱 مشاتل زراعية', labelEn: '🌱 Nurseries' },
            { value: 'Clinics', labelAr: '🩺 عيادات', labelEn: '🩺 Clinics' },
            { value: 'Other', labelAr: '✨ أخرى', labelEn: '✨ Other' }
        ],
        mapToField: 'category'
    },
    {
        id: 'gender',
        textAr: '👥 الفئة المستهدفة:',
        textEn: '👥 Target audience:',
        type: 'select',
        required: true,
        options: [
            { value: 'all', labelAr: 'للجميع', labelEn: 'Everyone' },
            { value: 'men', labelAr: 'رجال', labelEn: 'Men' },
            { value: 'women', labelAr: 'نساء', labelEn: 'Women' },
            { value: 'kids', labelAr: 'أطفال', labelEn: 'Kids' },
        ],
        mapToField: 'gender'
    },
    {
        id: 'original_price',
        textAr: '💰 السعر الأصلي (بالريال):',
        textEn: '💰 Original price (SAR):',
        type: 'number',
        required: true,
        validation: { min: 1, max: 999999, errorAr: 'يرجى إدخال سعر صحيح', errorEn: 'Please enter a valid price' },
        mapToField: 'originalPrice'
    },
    {
        id: 'discounted_price',
        textAr: '🔥 سعر الخصم (بالريال):',
        textEn: '🔥 Discounted price (SAR):',
        type: 'number',
        required: true,
        validation: { min: 1, max: 999999, errorAr: 'يرجى إدخال سعر صحيح', errorEn: 'Please enter a valid price' },
        mapToField: 'discountedPrice'
    },
    {
        id: 'days',
        textAr: '📆 عدد الأيام للعرض (اختياري - لتجاوز اكتب 0):',
        textEn: '📆 Days till expiration (Optional - put 0 to skip):',
        type: 'number',
        required: false,
        validation: { min: 1, max: 365, errorAr: 'عدد أيام غير صالح', errorEn: 'Invalid number of days' },
        mapToField: 'days'
    },
    {
        id: 'quantity',
        textAr: '📊 الكمية المتوفرة:',
        textEn: '📊 Available quantity:',
        type: 'number',
        required: true,
        validation: { min: 1, max: 9999, errorAr: 'يرجى إدخال كمية صحيحة', errorEn: 'Please enter a valid quantity' },
        mapToField: 'quantity'
    },
    {
        id: 'description',
        textAr: '📝 أضف وصف للمنتج (اختياري):',
        textEn: '📝 Add a product description (optional):',
        type: 'text',
        required: false,
        mapToField: 'description'
    },
    {
        id: 'images',
        textAr: '📸 أرسل صورة أو رابط صورة المنتج:',
        textEn: '📸 Send a product image or image URL:',
        type: 'image',
        required: false,
        mapToField: 'images'
    },
    {
        id: 'location',
        textAr: '📍 أرسل موقعك أو اختر المول/السوق:',
        textEn: '📍 Send your location or select the mall/market:',
        type: 'location',
        required: true,
        mapToField: 'locationId'
    },
    {
        id: 'confirm',
        textAr: '✅ هل تريد نشر العرض الآن؟',
        textEn: '✅ Would you like to publish the deal now?',
        type: 'confirm',
        required: true,
        mapToField: '_confirm'
    }
];

// ============================================================
// أسئلة المشتري عند استكشاف العروض
// ============================================================
export const BUYER_EXPLORE_FLOW: BotQuestion[] = [
    {
        id: 'explore_type',
        textAr: '🔍 كيف تريد استكشاف العروض؟',
        textEn: '🔍 How would you like to explore deals?',
        type: 'select',
        required: true,
        options: [
            { value: 'all', labelAr: '📋 جميع العروض', labelEn: '📋 All Deals' },
            { value: 'nearby', labelAr: '📍 عروض قريبة مني', labelEn: '📍 Nearby Deals' },
            { value: 'category', labelAr: '🏷️ حسب التصنيف', labelEn: '🏷️ By Category' },
            { value: 'search', labelAr: '🔎 بحث بالاسم', labelEn: '🔎 Search by Name' },
        ],
        mapToField: 'exploreType'
    },
    {
        id: 'buyer_location',
        textAr: '📍 أرسل موقعك الحالي لنعرض لك أقرب العروض:',
        textEn: '📍 Send your current location to see nearby deals:',
        type: 'location',
        required: false,
        mapToField: 'userLocation'
    },
    {
        id: 'buyer_category',
        textAr: '🏷️ اختر التصنيف الذي يهمك:',
        textEn: '🏷️ Select the category you\'re interested in:',
        type: 'select',
        required: false,
        options: [
            { value: 'Fashion_Women', labelAr: '👗 فساتين ونساء', labelEn: '👗 Women Clothing' },
            { value: 'Fashion_Men', labelAr: '👔 ملابس رجالية', labelEn: '👔 Men Clothing' },
            { value: 'Kids_Infants', labelAr: '👶 أطفال ورضع', labelEn: '👶 Infants' },
            { value: 'Electronics', labelAr: '📱 إلكترونيات', labelEn: '📱 Electronics' },
            { value: 'Food', labelAr: '🍔 مطاعم', labelEn: '🍔 Food' },
            { value: 'Beauty', labelAr: '💄 عطور وتجميل', labelEn: '💄 Beauty' },
            { value: 'MensSalon', labelAr: '💈 صالون رجالي', labelEn: '💈 Barbershop' },
            { value: 'WomensSalon', labelAr: '💇‍♀️ صالون نسائي', labelEn: "💇‍♀️ Women's Salon" },
            { value: 'Sports', labelAr: '⚽ رياضة', labelEn: '⚽ Sports' },
            { value: 'Supermarket', labelAr: '🛒 سوبرماركت', labelEn: '🛒 Supermarket' },
            { value: 'Butcher', labelAr: '🥩 ملحمة', labelEn: '🥩 Butcher' },
            { value: 'Sanitary', labelAr: '🚿 أدوات صحية', labelEn: '🚿 Sanitary' },
            { value: 'Cafe', labelAr: '☕ مقاهي', labelEn: '☕ Cafes' },
            { value: 'Home', labelAr: '🏠 منزل وديكور', labelEn: '🏠 Home' },
            { value: 'Hotels', labelAr: '🏨 فنادق', labelEn: '🏨 Hotels' },
            { value: 'CarRentals', labelAr: '🚗 تأجير سيارات', labelEn: '🚗 Car Rentals' },
            { value: 'Laundry', labelAr: '🧺 مغسلة ملابس', labelEn: '🧺 Laundromats' },
            { value: 'MensTailor', labelAr: '🧵 خياطة رجالية', labelEn: "🧵 Men's Tailor" },
            { value: 'WomensTailor', labelAr: '🪡 مشغل نسائي', labelEn: "🪡 Women's Tailor" },
            { value: 'CarWash', labelAr: '🧽 مغسلة سيارات', labelEn: '🧽 Car Wash' },
            { value: 'CarWorkshop', labelAr: '🔧 ورش سيارات', labelEn: '🔧 Car Workshops' },
            { value: 'Amusements', labelAr: '🎡 ملاهي ألعاب', labelEn: '🎡 Amusements' },
            { value: 'Gym', labelAr: '🏋️ نادي رياضي', labelEn: '🏋️ Gym' },
            { value: 'Library', labelAr: '📚 مكتبة', labelEn: '📚 Library' },
            { value: 'Nursery', labelAr: '🌱 مشاتل زراعية', labelEn: '🌱 Nurseries' },
            { value: 'Clinics', labelAr: '🩺 عيادات', labelEn: '🩺 Clinics' },
            { value: 'Other', labelAr: '✨ أخرى', labelEn: '✨ Other' }
        ],
        mapToField: 'selectedCategory'
    },
    {
        id: 'buyer_search',
        textAr: '🔎 اكتب اسم المنتج أو المحل الذي تبحث عنه:',
        textEn: '🔎 Type the product or store name you\'re looking for:',
        type: 'text',
        required: false,
        mapToField: 'searchQuery'
    },
    {
        id: 'buyer_radius',
        textAr: '📏 كم كيلو حولك تريد البحث؟ (مثال: 5)',
        textEn: '📏 How many km radius? (e.g., 5)',
        type: 'number',
        required: false,
        validation: { min: 1, max: 100, errorAr: 'أدخل رقم بين 1 و 100', errorEn: 'Enter a number between 1 and 100' },
        mapToField: 'radiusKm'
    }
];

// ============================================================
// رسائل البوت
// ============================================================
export const BOT_MESSAGES = {
    welcome: {
        ar: '👋 مرحباً بك في *تاكي*!\nمنصة حجز التخفيضات الأولى في السعودية 🇸🇦\n\nاختر عملية:',
        en: '👋 Welcome to *TAKI*!\nSaudi\'s #1 discount booking platform 🇸🇦\n\nChoose an action:'
    },
    mainMenu: {
        ar: '📱 القائمة الرئيسية:\n\n🛍️ /explore — استكشف العروض\n📦 /publish — انشر عرض (للبائعين)\n📋 /bookings — حجوزاتي\n👤 /profile — حسابي\n❓ /help — مساعدة',
        en: '📱 Main Menu:\n\n🛍️ /explore — Explore deals\n📦 /publish — Publish deal (sellers)\n📋 /bookings — My bookings\n👤 /profile — My profile\n❓ /help — Help'
    },
    bookingSuccess: {
        ar: '✅ تم الحجز بنجاح!\n\nالباركود: `{barcode}`\nالرمز الاحتياطي: `{backupCode}`\n\n⏱️ لديك ساعتان للوصول للمحل والحصول على السعر المخفض.',
        en: '✅ Booking successful!\n\nBarcode: `{barcode}`\nBackup Code: `{backupCode}`\n\n⏱️ You have 2 hours to visit the store and get the discounted price.'
    },
    noDealsFound: {
        ar: '😕 لم نجد عروضاً تطابق بحثك. جرب تصنيفاً آخر أو وسّع نطاق البحث.',
        en: '😕 No deals match your search. Try another category or expand your search radius.'
    }
};
