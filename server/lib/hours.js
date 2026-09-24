/**
 * lib/hours.js — تنسيق ساعات عمل المحل في البوت. حالة الفتح تأتي محسوبة من قاعدة
 * البيانات (store_is_open / open_status)؛ هنا فقط التنسيق + أيام الأسبوع. v11.77
 * كل النصوص عربية بدون رموز MarkdownV2 محجوزة (تُهرَّب عند الإدراج عبر md()).
 */
const { tr, lang } = require('./i18n');   // request-scoped translation (ar/en) — v11.85
const { arCount } = require('../../shared/arPlural');
const DAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const CLOSING_SOON_MIN = 60;   // «يغلق قريباً» = خلال ساعة

const toMin = hhmm => { const [h, m] = String(hhmm).split(':'); return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0); };

/**
 * مدّة بشرية: «ساعتين و٢٠ دقيقة» · «٤٠ دقيقة» · «11 ساعة».
 *
 * 🔴 v14.93 — كانت العربية تُبنى من سلاسل i18n، وفيها عيبان يراهما المستخدم:
 *    `hrs_hours_many` = «{0} ساعات» لكل h ≥ ٣ ⇒ «يغلق بعد 24 ساعات»،
 *    و`hrs_h_and_m` = «{0} و{1} دقيقة» لكل m ⇒ «و3 دقيقة».
 *    جمعُ القلّة لا يتجاوز العشرة، وما دونها لا يُفرد. العربية تُصاغ الآن من
 *    `shared/arPlural.js` — نفس قاعدة الموقع والقاعدة، ويحرسها `npm test`.
 *    والإنجليزية بسيطة فتُبنى هنا مباشرةً بلا سلاسل تُوهم أنها مترجَمة.
 */
function fmtMins(min) {
    if (min == null) return '';
    const h = Math.floor(min / 60), m = min % 60;
    if (lang() === 'en') {
        const hh = h === 1 ? '1 hr' : `${h} hrs`;
        if (h <= 0) return `${m} min`;
        return m ? `${hh} ${m} min` : hh;
    }
    if (h <= 0) return arCount(m, 'minutes');
    const hh = arCount(h, 'hours', true);
    return m ? `${hh} و${arCount(m, 'minutes')}` : hh;
}
// ساعة 12 بصيغة "7:00 ص".
function fmtClock(hhmm) {
    const t = toMin(hhmm); let h = Math.floor(t / 60); const mm = t % 60;
    const am = h < 12; const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(mm).padStart(2, '0')} ${am ? tr('clock_am') : tr('clock_pm')}`;
}
// فترات يوم: "7:00 ص – 10:00 م" أو "8:30 ص – 12:30 م، 4:00 م – 11:00 م" أو "مغلق".
function dayShifts(shifts) {
    if (!Array.isArray(shifts) || !shifts.length) return tr('day_closed');
    // فاصل حسب اللغة (، عربي / , إنجليزي) بدل فاصلة عربية ثابتة. v11.96
    return shifts.map(s => `${fmtClock(s[0])} – ${fmtClock(s[1])}`).join(tr('cm_sep'));
}
// يوم الأسبوع الحالي بتوقيت الرياض (0=الأحد).
function riyadhDow() {
    try {
        const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Riyadh', weekday: 'short' }).format(new Date());
        return ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 })[wd] ?? 0;
    } catch { return new Date().getDay(); }
}
const isConfigured = wh => !!(wh && wh.enabled && wh.days);
// سطر الحالة المختصر للعرض: "🟢 مفتوح الآن" / "🟠 يغلق بعد ٤٠ دقيقة" / "🔴 مغلق · يفتح بعد ساعتين".
function statusText(os) {
    if (!os || !os.configured) return '';
    if (os.open) {
        const c = os.closes_in_min;
        return (c != null && c <= CLOSING_SOON_MIN) ? tr('hrs_closing_in', fmtMins(c)) : tr('hrs_open_now');
    }
    return os.opens_in_min != null ? tr('hrs_closed_opens', fmtMins(os.opens_in_min)) : tr('hrs_closed_now');
}
// سطر «اليوم: …» لساعات اليوم الحالي.
function todayLine(wh) {
    if (!isConfigured(wh)) return '';
    return tr('hrs_today', dayShifts(wh.days[String(riyadhDow())]));
}
// أسطر الأسبوع كاملاً (الأحد→السبت) مع تمييز اليوم.
function weekLines(wh) {
    if (!isConfigured(wh)) return [];
    const dow = riyadhDow();
    return [0, 1, 2, 3, 4, 5, 6].map(d => `${tr('day_' + d)}${d === dow ? tr('hrs_today_tag') : ''}: ${dayShifts(wh.days[String(d)])}`);
}

module.exports = { fmtMins, fmtClock, dayShifts, statusText, todayLine, weekLines, isConfigured, riyadhDow, DAY_AR, CLOSING_SOON_MIN };
