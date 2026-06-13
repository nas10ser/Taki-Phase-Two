/**
 * lib/catalog.js — تصنيفات السوق السعودي (تطابق src/data/mock.ts) + منتقي أزرار.
 */
const { Markup } = require('telegraf');

const CAT = {
    all: { ar: 'الكل', e: '🔥' }, Fashion_Women: { ar: 'فساتين ونساء', e: '👗' }, Fashion_Men: { ar: 'ملابس رجالية', e: '👔' },
    Kids_Infants: { ar: 'رضع وحمل', e: '👶' }, Kids_Girls: { ar: 'ملابس أطفال', e: '👧' }, Electronics: { ar: 'إلكترونيات', e: '📱' },
    Food: { ar: 'مطاعم', e: '🍔' }, Beauty: { ar: 'عطور وتجميل', e: '💄' }, MensSalon: { ar: 'صالون رجالي', e: '💈' },
    WomensSalon: { ar: 'صالون نسائي', e: '💇‍♀️' }, Sports: { ar: 'رياضة', e: '⚽' }, Supermarket: { ar: 'سوبرماركت', e: '🛒' },
    Butcher: { ar: 'ملحمة', e: '🥩' }, Sanitary: { ar: 'أدوات صحية', e: '🚿' }, Cafe: { ar: 'مقاهي', e: '☕' },
    Home: { ar: 'منزل وديكور', e: '🏠' }, Hotels: { ar: 'فنادق', e: '🏨' }, CarRentals: { ar: 'تأجير سيارات', e: '🚗' },
    Laundry: { ar: 'مغسلة ملابس', e: '🧺' }, MensTailor: { ar: 'خياطة رجالية', e: '🧵' }, WomensTailor: { ar: 'مشغل نسائي', e: '🪡' },
    CarWash: { ar: 'غسيل سيارات', e: '🧽' }, CarWorkshop: { ar: 'ورش سيارات', e: '🔧' }, Amusements: { ar: 'ملاهي', e: '🎡' },
    Gym: { ar: 'نادي رياضي', e: '🏋️' }, Library: { ar: 'مكتبة', e: '📚' }, Nursery: { ar: 'مشاتل', e: '🌱' },
    Pharmacy: { ar: 'صيدلية', e: '💊' }, Clinics: { ar: 'عيادات', e: '🩺' }, Online: { ar: 'أونلاين', e: '🌐' }, Other: { ar: 'أخرى', e: '✨' },
};
const catLabel = id => { const c = CAT[id]; return c ? `${c.e} ${c.ar}` : `✨ ${id || 'أخرى'}`; };

// صفوف أزرار التصنيف (2/صف) — `prefix` يُلصق قبل معرّف التصنيف في callback_data.
function catKeyboard(prefix) {
    const ids = Object.keys(CAT).filter(k => k !== 'all');
    const rows = [];
    for (let i = 0; i < ids.length; i += 2) rows.push(ids.slice(i, i + 2).map(id => Markup.button.callback(catLabel(id), `${prefix}${id}`)));
    return rows;
}

// الفئة المستهدفة (gender) — تطابق الموقع.
const GENDER = { all: '👥 الجميع', men: '👔 رجال', women: '👗 نساء', kids: '🧒 أطفال' };
const genderLabel = g => GENDER[g] || GENDER.all;

module.exports = { CAT, catLabel, catKeyboard, GENDER, genderLabel };
