/**
 * workingHours.ts — ساعات عمل المحل (per-day, multi-shift, Asia/Riyadh).
 * Mirrors the SQL `public.store_is_open()` 1:1 so the website, app and bot all
 * agree on whether a shop is open. v11.77
 *
 * Shape stored on users.working_hours (jsonb):
 *   { enabled: true,
 *     days: { "0":[["07:00","22:00"]],                 // Sunday
 *             "2":[["08:30","12:30"],["16:00","23:00"]],// Tuesday split
 *             "5":[] } }                                 // Friday closed
 *   day key = JS getDay() (0=Sun..6=Sat); shift = ["HH:MM","HH:MM"] (open < close).
 */

export type Shift = [string, string];
export interface WorkingHours {
    enabled: boolean;
    days: Record<string, Shift[]>;
}
export interface ShopStatus {
    configured: boolean;     // false = no hours set → treated as always open
    open: boolean;
    closesInMin?: number;    // when open
    opensInMin?: number;     // when closed (null/undefined = never opens this week)
}

// «يغلق قريباً» = خلال هذا العدد من الدقائق (ساعة). يُحذّر المشتري عند الحجز. v11.77
export const CLOSING_SOON_MIN = 60;
export const DAY_NAMES_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export const DAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const toMin = (hhmm: string): number => {
    const [h, m] = String(hhmm).split(':');
    return (parseInt(h, 10) || 0) * 60 + (parseInt(m, 10) || 0);
};

// Current weekday (0=Sun) + minutes-since-midnight in Asia/Riyadh, regardless of
// where the code runs (browser, Node, UTC server). Uses Intl so it's DST-proof.
function riyadhNow(now: Date = new Date()): { dow: number; min: number } {
    try {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Riyadh', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
        }).formatToParts(now);
        const wd = parts.find(p => p.type === 'weekday')?.value || 'Sun';
        let hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
        const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
        if (hour === 24) hour = 0; // some engines emit 24 for midnight
        const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        return { dow: map[wd] ?? 0, min: hour * 60 + minute };
    } catch {
        return { dow: now.getDay(), min: now.getHours() * 60 + now.getMinutes() };
    }
}

export function isValidWorkingHours(wh: any): wh is WorkingHours {
    return !!wh && typeof wh === 'object' && !!wh.enabled && wh.days && typeof wh.days === 'object';
}

/** Open/closed status — identical logic to the SQL store_is_open(). */
export function getShopStatus(wh: any, now: Date = new Date()): ShopStatus {
    if (!isValidWorkingHours(wh)) return { configured: false, open: true };
    const { dow, min } = riyadhNow(now);
    const todayShifts: Shift[] = Array.isArray(wh.days[String(dow)]) ? wh.days[String(dow)] : [];

    let closesIn: number | undefined;
    for (const sh of todayShifts) {
        const o = toMin(sh[0]); const c = toMin(sh[1]);
        if (min >= o && min < c) closesIn = closesIn == null ? c - min : Math.min(closesIn, c - min);
    }
    if (closesIn != null) return { configured: true, open: true, closesInMin: closesIn };

    // closed → soonest future opening within 8 days
    let nextMin: number | undefined;
    for (let off = 0; off <= 7; off++) {
        const shifts: Shift[] = Array.isArray(wh.days[String((dow + off) % 7)]) ? wh.days[String((dow + off) % 7)] : [];
        for (const sh of shifts) {
            const delta = off * 1440 + toMin(sh[0]) - min;
            if (delta > 0 && (nextMin == null || delta < nextMin)) nextMin = delta;
        }
    }
    return { configured: true, open: false, opensInMin: nextMin };
}

/** "7:00 ص" — 12-hour Arabic/English clock. */
export function fmtClock(hhmm: string, isRTL = true): string {
    const m = toMin(hhmm);
    let h = Math.floor(m / 60); const mm = m % 60;
    const am = h < 12;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    const suffix = isRTL ? (am ? 'ص' : 'م') : (am ? 'AM' : 'PM');
    return `${h12}:${String(mm).padStart(2, '0')} ${suffix}`;
}

/** "ساعة و20 دقيقة" / "40 دقيقة" / "1h 20m". */
export function fmtDuration(min: number, isRTL = true): string {
    const h = Math.floor(min / 60); const m = min % 60;
    if (isRTL) {
        if (h <= 0) return `${m} دقيقة`;
        if (m === 0) return h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : `${h} ساعات`;
        return `${h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : `${h} ساعات`} و${m} دقيقة`;
    }
    if (h <= 0) return `${m}m`;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/** One day's shifts as text: "7:00 ص – 10:00 م" or "8:30 ص – 12:30 م، 4:00 م – 11:00 م" / "مغلق". */
export function fmtDayShifts(shifts: Shift[] | undefined, isRTL = true): string {
    if (!shifts || !shifts.length) return isRTL ? 'مغلق' : 'Closed';
    const sep = isRTL ? '،  ' : ',  ';
    return shifts.map(s => `${fmtClock(s[0], isRTL)} – ${fmtClock(s[1], isRTL)}`).join(sep);
}

/** Today's hours line, e.g. "اليوم: 7:00 ص – 10:00 م". */
export function todayHoursLabel(wh: any, isRTL = true, now: Date = new Date()): string {
    if (!isValidWorkingHours(wh)) return '';
    const { dow } = riyadhNow(now);
    return fmtDayShifts(wh.days[String(dow)], isRTL);
}

/** Full week, ordered Sun→Sat, today flagged — for the deal-details "all hours" view. */
export function weekHoursLines(wh: any, isRTL = true, now: Date = new Date()): Array<{ day: string; label: string; today: boolean }> {
    if (!isValidWorkingHours(wh)) return [];
    const { dow } = riyadhNow(now);
    const names = isRTL ? DAY_NAMES_AR : DAY_NAMES_EN;
    return [0, 1, 2, 3, 4, 5, 6].map(d => ({ day: names[d], label: fmtDayShifts(wh.days[String(d)], isRTL), today: d === dow }));
}

/**
 * Short status pill text + tone for badges, e.g.
 *   { tone:'open',  text:'مفتوح الآن · يغلق 10:00 م' }
 *   { tone:'soon',  text:'يغلق قريباً · بعد 40 دقيقة' }
 *   { tone:'closed',text:'مغلق · يفتح بعد ساعتين' }
 */
export function statusPill(wh: any, isRTL = true, now: Date = new Date()): { tone: 'open' | 'soon' | 'closed' | 'none'; text: string } {
    const st = getShopStatus(wh, now);
    if (!st.configured) return { tone: 'none', text: '' };
    if (st.open) {
        const soon = (st.closesInMin ?? 999) <= CLOSING_SOON_MIN;
        if (soon) return { tone: 'soon', text: isRTL ? `يغلق بعد ${fmtDuration(st.closesInMin!, true)}` : `Closes in ${fmtDuration(st.closesInMin!, false)}` };
        return { tone: 'open', text: isRTL ? 'مفتوح الآن' : 'Open now' };
    }
    if (st.opensInMin != null) return { tone: 'closed', text: isRTL ? `مغلق · يفتح بعد ${fmtDuration(st.opensInMin, true)}` : `Closed · opens in ${fmtDuration(st.opensInMin, false)}` };
    return { tone: 'closed', text: isRTL ? 'مغلق' : 'Closed' };
}

/** Default working hours for a fresh editor: every day 9:00–22:00 (a sane Saudi default). */
export function defaultWorkingHours(): WorkingHours {
    const days: Record<string, Shift[]> = {};
    for (let d = 0; d <= 6; d++) days[String(d)] = [['09:00', '22:00']];
    return { enabled: true, days };
}
