// v12.45 — «هوية المواسم» في البوتين (تيليجرام + واتساب).
// عندما يفعّل ناصر موسماً من لوحة المدير (platform_settings.seasonal_theme)
// يظهر سطر الموسم أعلى القائمة الرئيسية في البوتين — نفس فكرة إعادة تلوين
// الموقع لكن نصّياً. يُقرأ عبر RPC definer «bot_active_season» (نمط
// bot_is_enabled نفسه) بكاش ٦٠ ثانية فالكلفة صفر عملياً لكل رسالة.
// ⚠️ المعرّفات هنا يجب أن تطابق src/data/seasons.ts في الموقع حرفياً.

const SEASONS = {
    ramadan: {
        ar: '🏮🌙 رمضان كريم — أجواء الشهر الفضيل وعروضه بين يديك',
        en: '🏮🌙 Ramadan Kareem — the holy month’s deals await you',
    },
    eid: {
        ar: '🎈🎉 عيدكم مبارك — العيديات والهدايا وعروض العيد وصلت',
        en: '🎈🎉 Eid Mubarak — gifts and celebration deals have arrived',
    },
    founding: {
        ar: '🐎✨ يوم بدينا — عروض يوم التأسيس بروح التراث',
        en: '🐎✨ Founding Day — heritage-inspired deals',
    },
    national: {
        ar: '🇸🇦💚 عزّها في علاها — عروض اليوم الوطني',
        en: '🇸🇦💚 National Day — green-day deals from your city',
    },
    school: {
        ar: '🎒✏️ العودة للمدارس — جهّز أطفالك بأقل الأسعار',
        en: '🎒✏️ Back to School — get the kids ready for less',
    },
    white_friday: {
        ar: '🛍️🔥 الجمعة البيضاء — ذروة تخفيضات السنة',
        en: '🛍️🔥 White Friday — the year’s biggest sale',
    },
    summer: {
        ar: '☀️🍉 عروض الصيف — صيّف وارتاح مع عروض المساء',
        en: '☀️🍉 Summer deals — evening mall offers all break long',
    },
};

// أسماء المواسم للأزرار والعناوين (تطابق src/data/seasons.ts حرفياً)
const NAMES = {
    ramadan:      { ar: 'رمضان',          en: 'Ramadan',        emoji: '🏮' },
    eid:          { ar: 'العيد',           en: 'Eid',            emoji: '🎉' },
    founding:     { ar: 'يوم التأسيس',     en: 'Founding Day',   emoji: '🐎' },
    national:     { ar: 'اليوم الوطني',    en: 'National Day',   emoji: '🇸🇦' },
    school:       { ar: 'العودة للمدارس',  en: 'Back to School', emoji: '🎒' },
    white_friday: { ar: 'الجمعة البيضاء',  en: 'White Friday',   emoji: '🛍️' },
    summer:       { ar: 'إجازة الصيف',     en: 'Summer',         emoji: '☀️' },
};

// v12.51 — «حملة الموسم» في البوتين: نافذتان يقررهما المالك (تطابق الويب):
//  - نافذة التجار  seller_from→seller_to : زر «أضفه لعروض الموسم» بعد النشر.
//  - النافذة العامة public_from→public_to: زر تصفح «عروض الموسم» للمتسوقين.
// التاريخ يُقارن بتوقيت الرياض (UTC+3) بصيغة YYYY-MM-DD كما في الحارس tr_deal_season.
const riyadhToday = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const inWin = (from, to) => { const d = riyadhToday(); return !!from && !!to && d >= from && d <= to; };

function create({ rpc }) {
    let _id = '', _at = 0;
    let _camp = null, _campAt = 0;
    // آخر قيمة معروفة تبقى عند فشل عابر للـRPC — نفس فلسفة botEnabled().
    async function activeId() {
        const now = Date.now();
        if (now - _at < 60_000) return _id;
        _at = now;
        const v = await rpc('bot_active_season', {});
        if (typeof v === 'string') _id = SEASONS[v] ? v : '';
        return _id;
    }
    // إعدادات الحملة (كاش ٦٠ث). null = لا توجد حملة.
    async function campaign() {
        const now = Date.now();
        if (now - _campAt < 60_000) return _camp;
        _campAt = now;
        const v = await rpc('bot_season_campaign', {});
        if (v !== null && typeof v === 'object' && typeof v.season_id === 'string' && NAMES[v.season_id]) _camp = v;
        else if (v === null || (typeof v === 'object')) _camp = null; // حملة منتهية/غير موجودة
        return _camp;
    }
    // نسخة متزامنة من آخر كاش — للقوائم المبنية sync (تُحدَّث مع كل sendMain).
    const campaignSync = () => _camp;
    const publicLive = c => !!c && inWin(c.public_from, c.public_to);
    const sellerOpen = c => !!c && inWin(c.seller_from, c.seller_to);
    // نص زر/عنوان «عروض {الموسم}» بلغة المستخدم.
    const label = (c, lang) => {
        const n = c && NAMES[c.season_id];
        if (!n) return '';
        return lang === 'en' ? `${n.emoji} ${n.en} deals` : `${n.emoji} عروض ${n.ar}`;
    };
    // سطر الموسم الجاهز للعرض ('' عندما لا يوجد موسم مفعّل).
    async function line(lang) {
        campaign().catch(() => {}); // إنعاش كاش الحملة بالمرور — القوائم بعده sync
        const id = await activeId();
        if (!id) return '';
        return SEASONS[id][lang === 'en' ? 'en' : 'ar'];
    }
    return { activeId, line, campaign, campaignSync, publicLive, sellerOpen, label, NAMES };
}

module.exports = { create, SEASONS };
