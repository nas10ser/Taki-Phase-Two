/**
 * lib/session.js — حالة الجلسة في الذاكرة (مفتاحها telegram_id) + اكتساح دوري.
 * مستخرَجة من bot.js v11.72 بنفس الشكل تماماً.
 */
const tgId   = ctx => ctx.from?.id;
const chatId = ctx => ctx.chat?.id;

const sessions = new Map();
const TTL = 30 * 60_000;

function getSession(id) {
    const k = String(id);
    let s = sessions.get(k);
    if (!s || Date.now() - s.at > TTL) {
        s = { step: 'idle', userId: null, userType: null, name: null, shop: null,
              isAdmin: false, pendingBookings: 0, activeDeals: 0, temp: {}, at: Date.now() };
        sessions.set(k, s);
    }
    s.at = Date.now();
    return s;
}
function setStep(id, step, extra = {}) { const s = getSession(id); s.step = step; Object.assign(s, extra); }

// اكتساح الجلسات المنتهية كل 10 دقائق (unref حتى لا يمنع إغلاق العملية).
setInterval(() => { const n = Date.now(); for (const [k, v] of sessions) if (n - v.at > TTL) sessions.delete(k); }, 10 * 60_000).unref?.();

module.exports = { tgId, chatId, sessions, TTL, getSession, setStep };
