/**
 * lib/hours.js — تنسيق ساعات عمل المحل في البوت. حالة الفتح تأتي محسوبة من قاعدة
 * البيانات (store_is_open / open_status)؛ هنا فقط التنسيق + أيام الأسبوع. v11.77
 * كل النصوص عربية بدون رموز MarkdownV2 محجوزة (تُهرَّب عند الإدراج عبر md()).
 */
const DAY_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const CLOSING_SOON_MIN = 60;   // «يغلق قريباً» = خلال ساعة

const toMin = hhmm => { const [h, m] = String(hhmm).split(':'); return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0); };

// مدّة بشرية: "ساعة و20 دقيقة" / "40 دقيقة" / "ساعتين".
function fmtMins(min) {
    if (min == null) return '';
    const h = Math.floor(min / 60), m = min % 60;
    if (h <= 0) return `${m} دقيقة`;
    const hh = h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : `${h} ساعات`;
    return m ? `${hh} و${m} دقيقة` : hh;
}
// ساعة 12 بصيغة "7:00 ص".
function fmtClock(hhmm) {
    const t = toMin(hhmm); let h = Math.floor(t / 60); const mm = t % 60;
    const am = h < 12; const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(mm).padStart(2, '0')} ${am ? 'ص' : 'م'}`;
}
// فترات يوم: "7:00 ص – 10:00 م" أو "8:30 ص – 12:30 م، 4:00 م – 11:00 م" أو "مغلق".
function dayShifts(shifts) {
    if (!Array.isArray(shifts) || !shifts.length) return 'مغلق';
    return shifts.map(s => `${fmtClock(s[0])} – ${fmtClock(s[1])}`).join('، ');
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
        return (c != null && c <= CLOSING_SOON_MIN) ? `🟠 يغلق بعد ${fmtMins(c)}` : '🟢 مفتوح الآن';
    }
    return os.opens_in_min != null ? `🔴 مغلق · يفتح بعد ${fmtMins(os.opens_in_min)}` : '🔴 مغلق الآن';
}
// سطر «اليوم: …» لساعات اليوم الحالي.
function todayLine(wh) {
    if (!isConfigured(wh)) return '';
    return `اليوم: ${dayShifts(wh.days[String(riyadhDow())])}`;
}
// أسطر الأسبوع كاملاً (الأحد→السبت) مع تمييز اليوم.
function weekLines(wh) {
    if (!isConfigured(wh)) return [];
    const dow = riyadhDow();
    return [0, 1, 2, 3, 4, 5, 6].map(d => `${DAY_AR[d]}${d === dow ? ' (اليوم)' : ''}: ${dayShifts(wh.days[String(d)])}`);
}

module.exports = { fmtMins, fmtClock, dayShifts, statusText, todayLine, weekLines, isConfigured, riyadhDow, DAY_AR, CLOSING_SOON_MIN };
