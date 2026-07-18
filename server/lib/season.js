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

function create({ rpc }) {
    let _id = '', _at = 0;
    // آخر قيمة معروفة تبقى عند فشل عابر للـRPC — نفس فلسفة botEnabled().
    async function activeId() {
        const now = Date.now();
        if (now - _at < 60_000) return _id;
        _at = now;
        const v = await rpc('bot_active_season', {});
        if (typeof v === 'string') _id = SEASONS[v] ? v : '';
        return _id;
    }
    // سطر الموسم الجاهز للعرض ('' عندما لا يوجد موسم مفعّل).
    async function line(lang) {
        const id = await activeId();
        if (!id) return '';
        return SEASONS[id][lang === 'en' ? 'en' : 'ar'];
    }
    return { activeId, line };
}

module.exports = { create, SEASONS };
