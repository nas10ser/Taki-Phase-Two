/**
 * TAKI Bot — v11.77  |  بوت تاكي الاحترافي الآمن
 * ═══════════════════════════════════════════════════════
 * v11.77 (٦ ملاحظات): أرقام عربية في وقت الاستلام/الكمية (normalizeDigits) •
 *   إصلاح /start بعد الخروج (نقطة غير مهرّبة في ترحيب الضيف) + sendMain آمن •
 *   زر رجوع موثوق في الحجوزات السابقة • إشعار «حجز حالي» للتاجر والمشتري عند
 *   الدخول • ساعات عمل المحل (per-day + فترتين، توقيت الرياض) عبر users.working_hours
 *   + store_is_open: بوابة حجز (مغلق=منع/قرب الإغلاق=تحذير) + عرض الساعات + فلتر
 *   «مفتوح الآن» (افتراضي) + إشعار استباقي قبل الإغلاق • منع تكرار الإشعار الترويجي.
 * ═══════════════════════════════════════════════════════
 * v11.76 (بوت المشتري): صفحة «حولي» كاملة بكل فلاتر الموقع داخل البوت
 *   (منطقة→مدينة→مول متسلسلة + تصنيف + الأقرب/نطاق كم) عبر bot_browse_deals
 *   الموسّعة • إصلاح ظهور تفاصيل العرض مع الصور (تهريب «~» في كتلة المسافة +
 *   إرسال آمن لا يُسقط التفاصيل أبداً) • التنبيهات الذكية للمشتري فقط (أُزيلت من
 *   التاجر) • معاينة نطاق التنبيه على الخريطة بتظليل فاتح/غامق مطابق للموقع.
 * ═══════════════════════════════════════════════════════
 * v11.74: إصلاح حجز العرض (ازدواجية دالة bot_get_deal) + بحث (عرض/متجر/تاجر) +
 *   بنر ترويجي فوق العروض + مسابقات وجوائز داخل البوت + فتح بروفايل المتجر من
 *   العرض والحجز + أزرار «رجوع» في كل خطوات الحجز والتاجر + تحسين خطوة المقاس
 *   والموقع (روابط خريطة للمواقع المحفوظة + خيار حفظ الموقع كموقع دائم).
 * ═══════════════════════════════════════════════════════
 * الأمان:
 *   • الهوية عبر telegram_id الذي يضمنه تيليجرام تشفيرياً في كل تحديث.
 *   • ربط الحسابات الموجودة عبر رمز لمرة واحدة يُولَّد فقط داخل جلسة
 *     ويب مسجّلة الدخول (bot_create_link_token يقرأ auth.uid()). لا ربط
 *     بالرقم إطلاقاً — لا يستطيع أحد انتحال حسابك.
 *   • كل العمليات عبر دوال SECURITY DEFINER بمفتاح anon (لا service-role).
 *   • رفع الصور عبر Edge Function محمية بسرّ مشترك (لا مفاتيح في العميل).
 *
 * البنية (v11.73): كود منظّم بلا دين تقني —
 *   lib/{format,catalog,geo,session}.js أدوات نقيّة • flows/sellerDeals.js تدفّق
 *   التاجر الكامل (إضافة/تعديل/مواقع) • bot.js المنسّق (تصفح/حجز/إشعارات/واتساب/أدمن).
 *
 * الميزات: تصفح + صور + حجز (مدة الاستلام + ملاحظة) + محادثة التاجر (٣+٣) +
 *   تعديل/إلغاء الحجز + تقييم ⭐ + متابعة/حظر المتاجر (مشتري) —
 *   إحصائيات + حجوزات + محادثة + تحقق + إتمام + اشتراك الباقات (تاجر) —
 *   ★ إضافة/تعديل العرض بمطابقة الموقع 100%: طريقة الانتهاء (كمية/ساعات/أيام/تاريخ)
 *     + المقاس + الفئة + العرض القادم (مجدول) + الموقع (منطقة→مدينة→مول/سوق أو رابط
 *     أو مشاركة) + صور ١–٤ + الباقة محسوبة + إعادة تفعيل بنفس الإعدادات.
 */

try { require('dotenv').config(); } catch { /* optional */ }

const express  = require('express');
const crypto   = require('crypto');
const { Telegraf, Markup } = require('telegraf');
const { createClient }     = require('@supabase/supabase-js');

// ── Crash guards (v11.90) ───────────────────────────────────────────────────────
// A 24/7 Telegram bot must NEVER die from one bad update or one bad notification.
// Without these, ANY unhandled async error exits the process with status 1 → Render's
// free tier restarts it (≈30-60s of cold start) → every button hangs ("يتم التحميل…")
// for everyone during that window. We log loudly (Render captures stderr) and keep
// running, so a single unforeseen glitch degrades ONE tap instead of the whole bot.
process.on('unhandledRejection', (reason) => {
    console.error('⚠️  unhandledRejection (bot kept alive):', reason?.stack || reason?.message || reason);
});
process.on('uncaughtException', (err) => {
    console.error('⚠️  uncaughtException (bot kept alive):', err?.stack || err?.message || err);
});

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL             = process.env.SUPABASE_URL;
const SUPABASE_KEY             = process.env.SUPABASE_ANON_KEY || '';
const TELEGRAM_TOKEN           = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_WEBHOOK_SECRET  = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const BOT_GATEWAY_SECRET       = process.env.BOT_GATEWAY_SECRET || '';
const WHATSAPP_VERIFY_TOKEN    = process.env.WHATSAPP_VERIFY_TOKEN || '';
const WHATSAPP_APP_SECRET      = process.env.WHATSAPP_APP_SECRET || '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN || '';
const APP_URL                  = (process.env.APP_URL || 'https://taki-test-eight.vercel.app').replace(/\/$/, '');
const BOT_MODE                 = (process.env.BOT_MODE || 'webhook').toLowerCase();
const PORT                     = process.env.PORT || 3000;
const BOT_VERSION              = '12.33.0';

// ── Clients ───────────────────────────────────────────────────────────────────
// Attach the shared bot gateway secret to EVERY PostgREST/RPC request. The DB
// gate (_bot_gate_ok) verifies this header so the sensitive bot_* functions
// can't be called by anyone else holding the public anon key (impersonation /
// PII drain). One client → covers Telegram + WhatsApp + sellerDeals. v12.12
const supabase = (SUPABASE_URL && SUPABASE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_KEY,
        BOT_GATEWAY_SECRET ? { global: { headers: { 'x-bot-secret': BOT_GATEWAY_SECRET } } } : undefined)
    : null;
const bot = TELEGRAM_TOKEN ? new Telegraf(TELEGRAM_TOKEN) : null;

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use('/webhook/whatsapp', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
const globalRL = new Map();
app.use((req, res, next) => {
    if (req.path === '/health') return next();
    const ip = req.ip || req.headers['x-forwarded-for'] || 'x';
    const now = Date.now(), e = globalRL.get(ip);
    if (!e || now - e.t > 300_000) { globalRL.set(ip, { t: now, n: 1 }); return next(); }
    if (++e.n > 300) return res.status(429).json({ error: 'rate limit' });
    next();
});
setInterval(() => { const n = Date.now(); for (const [k,v] of globalRL) if (n-v.t > 600_000) globalRL.delete(k); }, 600_000).unref?.();

// ── Per-chat rate limit ───────────────────────────────────────────────────────
const chatRL = new Map();
function checkRL(k) {
    const now = Date.now(), e = chatRL.get(k);
    if (!e || now - e.t > 60_000) { chatRL.set(k, { t: now, n: 1 }); return true; }
    return ++e.n <= 30;
}
setInterval(() => { const n = Date.now(); for (const [k,v] of chatRL) if (n-v.t > 120_000) chatRL.delete(k); }, 300_000).unref?.();

// ── Shared helpers (extracted to lib/ — modular, no tech debt) ───────────────
const F = require('./lib/format');
const C = require('./lib/catalog');
const G = require('./lib/geo');
const { tgId, chatId, getSession, setStep } = require('./lib/session');
const sellerDeals = require('./flows/sellerDeals');

const { md, money, numEsc, fmtDate, fmtDay, fmtTime, prepLabel, statusLabel, STATUS, DIV, sanitize, isPrice, isQty, priceBlock, normalizeDigits, authText } = F;
// Convert Arabic/Persian digits → Latin then to Number (user may type ٢٠).
// `+text` alone yields NaN on ٢٠ → "NaNmin"; always go through this. v11.77
const numOf = t => +normalizeDigits(t);
const { CAT, catLabel, catKeyboard } = C;
const { haversineKm, fmtKm, placeLink, dirLink, remainingText, durationEndsAt } = G;
const HRS = require('./lib/hours');   // ساعات عمل المحل — تنسيق + أيام الأسبوع

const W = path => APP_URL + path;   // web deep-link (BrowserRouter, no #)

// Strip MarkdownV2 markup → plain readable text (removes escape backslashes and
// the *_` markers) for a safe fallback.
const stripMd = t => String(t == null ? '' : t)
    .replace(/\\([_*[\]()~`>#+\-=|{}.!\\])/g, '$1')
    .replace(/[*`]/g, '')
    .replace(/__/g, '').replace(/(^|[^_])_([^_]+)_/g, '$1$2');
// Send a MarkdownV2 message; if Telegram rejects the entities (an unescaped
// reserved char, a caption that's too long, …) fall back to PLAIN text so the
// message ALWAYS reaches the user. Prevents the "album shows but the details
// vanish" class of bugs from ever hiding a deal's info again. v11.76
async function safeReplyMd(ctx, text, extra = {}) {
    try { return await ctx.reply(text, { parse_mode: 'MarkdownV2', ...extra }); }
    catch (e) {
        console.warn('safeReplyMd fallback:', e.message);
        const { parse_mode, ...rest } = extra;
        try { return await ctx.reply(stripMd(text), rest); } catch { /* give up silently */ }
    }
}

// Barcodes the bot itself just booked → so the notification outbox doesn't ALSO
// send the buyer a "booking confirmed" alert (the bot already showed it inline).
// App/website bookings are NOT in this set, so those DO reach the bot. v11.70.
const botBookedBarcodes = new Set();

// ── Supabase RPC ──────────────────────────────────────────────────────────────
async function rpc(fn, args) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase.rpc(fn, args);
        if (error) { console.error(`RPC ${fn}:`, error.message); return null; }
        return data;
    } catch(e) { console.error(`RPC ${fn} ex:`, e.message); return null; }
}

// ── «هوية المواسم» (v12.45) — سطر الموسم المفعّل من لوحة المدير يتصدّر القوائم ──
// كاش ٦٠ث عبر bot_active_season (نمط bot_is_enabled). مشترك بين البوتين.
const SEASON = require('./lib/season').create({ rpc });

// ── WhatsApp channel (flows/whatsapp.js) — مستقلّ، يعيد استخدام نفس RPCs/i18n ──
// خامل تماماً حتى تُضبط WHATSAPP_* في البيئة (sendWA يصبح no-op قبلها). v11.91
const WA = require('./flows/whatsapp').create({ rpc, APP_URL, botBookedBarcodes, SEASON });

// ── Admin kill-switch (request 2) ─────────────────────────────────────────────
// The bot polls platform_settings.telegram_bot_enabled via a definer RPC, cached
// ~45s so it's effectively free per update. When OFF the bot stops responding
// (one polite notice); flipping it back ON from the admin dashboard revives it
// within the cache window — no redeploy needed. v11.78
let _botEnabled = true, _botEnabledAt = 0;
async function botEnabled() {
    const now = Date.now();
    if (now - _botEnabledAt < 45_000) return _botEnabled;
    _botEnabledAt = now;
    const v = await rpc('bot_is_enabled', {});
    if (typeof v === 'boolean') _botEnabled = v;   // keep last-known value on a transient RPC failure
    return _botEnabled;
}

// ── Upload a Telegram photo → public deal image URL (via secure Edge Fn) ──────
async function uploadPhoto(ctx, fileId) {
    if (!BOT_GATEWAY_SECRET || !SUPABASE_URL) return null;
    try {
        const link = await ctx.telegram.getFileLink(fileId);
        const fileUrl = link?.href || String(link);
        const r = await fetch(`${SUPABASE_URL}/functions/v1/bot-upload-image`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-bot-secret': BOT_GATEWAY_SECRET,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'apikey': SUPABASE_KEY,
            },
            body: JSON.stringify({ file_url: fileUrl }),
        });
        const j = await r.json().catch(() => ({}));
        return j?.url || null;
    } catch (e) { console.warn('uploadPhoto:', e.message); return null; }
}

// An account can OWN a store while still being typed 'admin' (Nasser runs shop
// «تاكي» as an admin). Every store-management feature must accept a store-owner,
// not just user_type==='seller' — the JS twin of the v11.79 SQL identity fix.
// `shop` is non-null only for store-owners (bot_get_user), so it's the signal. v11.81
const ownsStore = s => s.userType === 'seller' || !!s.shop;

// ── Load/refresh session from DB (identity = telegram_id) ─────────────────────
async function refreshSession(ctx) {
    const s = getSession(tgId(ctx));
    const user = await rpc('bot_get_user', { p_telegram_id: tgId(ctx) });
    if (user) {
        s.userId   = user.id;
        s.userType = user.user_type;
        s.name     = user.name;
        s.shop     = user.shop || null;
        s.lang     = user.bot_lang || s.lang || 'ar';
        s.isAdmin  = !!(user.is_super_admin || user.user_type === 'admin' || (user.admin_permissions?.length > 0));
        // Restore a previously-saved location so we never re-ask the buyer to share
        // it every session — «الأقرب» / «حولي» work straight away (request 5).
        if (!s.geo && user.lat != null && user.lng != null) s.geo = { lat: Number(user.lat), lng: Number(user.lng) };
        rpc('bot_touch_chat', { p_telegram_id: tgId(ctx), p_chat_id: chatId(ctx) }); // keep chat id fresh
        if (ownsStore(s)) {
            const st = await rpc('bot_get_seller_stats', { p_telegram_id: tgId(ctx) });
            if (st) { s.pendingBookings = st.pending_bookings || 0; s.activeDeals = st.active_deals || 0; }
        }
    } else { s.userId = null; s.userType = null; s.isAdmin = false; }
    return s;
}

// ── i18n: per-user language (ar default, en additive). Missing key/lang → Arabic,
// so the Arabic experience is byte-for-byte unchanged («بدون تغيير أي شي»). v11.83
const I18N = require('./lib/i18n');
const tr = I18N.tr;   // request-scoped translate — language resolved from ALS (set in middleware)
// Language toggle button — shows the OTHER language (tap to switch). Plain text.
const langBtn = () => (I18N.lang() === 'en')
    ? Markup.button.callback('🌐 العربية', 'lang:set:ar')
    : Markup.button.callback('🌐 English', 'lang:set:en');
// أسماء الجغرافيا بالإنجليزي (نفس ترجمة الموقع) — تتبع لغة الطلب عبر ALS. v11.89
const GEO_EN = require('./lib/geoNames.json');
const geoLabel = item => (I18N.lang()==='en' && item && GEO_EN[item.id]) ? GEO_EN[item.id] : (item ? item.name : '');

// ── Keyboards ─────────────────────────────────────────────────────────────────
const KB_BACK = (s) => Markup.inlineKeyboard([[Markup.button.callback(tr('menu_back'),'menu:back')]]);

function kbGuest(s) {
    return Markup.inlineKeyboard([
        [Markup.button.callback(tr('menu_browse_start'),'browse:menu')],
        [Markup.button.callback(tr('menu_nearby'),'buyer:nearby'), Markup.button.callback(tr('menu_search'),'search:start')],
        [Markup.button.callback(tr('menu_coming_soon'),'browse:soon')],
        [Markup.button.callback(tr('menu_login_link'),'link:start')],
        [Markup.button.webApp(tr('menu_quick_login'), APP_URL)],
        [Markup.button.callback(tr('menu_help'),'help'), langBtn()]
    ]);
}
function kbBuyer(s) {
    return Markup.inlineKeyboard([
        [Markup.button.callback(tr('menu_browse'),'browse:menu'), Markup.button.callback(tr('menu_nearby'),'buyer:nearby')],
        [Markup.button.callback(tr('menu_coming_soon'),'browse:soon'), Markup.button.callback(tr('menu_search'),'search:start')],
        [Markup.button.callback(tr('menu_bookings_buyer'),'buyer:bookings'), Markup.button.callback(tr('menu_smart_alerts'),'buyer:notif')],
        [Markup.button.callback(tr('menu_follows'),'buyer:following'), Markup.button.callback(tr('menu_contests'),'contests:list')],
        [Markup.button.callback(tr('menu_account'),'buyer:profile')],
        [Markup.button.webApp(tr('menu_open_taki'), APP_URL)],
        [Markup.button.callback(tr('menu_help'),'help'), Markup.button.callback(tr('menu_logout'),'logout')],
        [langBtn()]
    ]);
}
function kbSeller(s) {
    const pBadge = s.pendingBookings > 0 ? `  •  ${s.pendingBookings}` : '';
    return Markup.inlineKeyboard([
        [Markup.button.callback(tr('menu_seller_stats'),'seller:stats'), Markup.button.callback(tr('menu_seller_bookings')+pBadge,'seller:bookings')],
        [Markup.button.callback(tr('menu_verify_booking'),'seller:verify'), Markup.button.callback(tr('menu_seller_deals'),'seller:deals')],
        [Markup.button.callback(tr('menu_add_deal'),'seller:addDeal'), Markup.button.callback(tr('menu_my_locations'),'seller:branches')],
        [Markup.button.callback(tr('menu_subscription'),'seller:sub'), Markup.button.callback(tr('menu_store_account'),'seller:profile')],
        [Markup.button.callback(tr('menu_working_hours'),'seller:hours'), Markup.button.callback(tr('menu_preview_buyer'),`store:${s.userId}`)],
        // التنبيهات الذكية ميزة للمتسوّق فقط — التاجر تصله إشعارات الحجوزات تلقائياً. v11.76
        [Markup.button.callback(tr('menu_help'),'help'), Markup.button.callback(tr('menu_logout'),'logout')],
        [Markup.button.webApp(tr('menu_seller_dashboard'), W('/seller')), langBtn()]
    ]);
}
function kbAdmin(s = {}) {
    const rows = [
        [Markup.button.callback(tr('menu_platform_stats'),'admin:stats'), Markup.button.callback(tr('menu_reports'),'admin:reports')],
        [Markup.button.callback(tr('menu_browse'),'browse:menu'), Markup.button.callback(tr('menu_nearby'),'buyer:nearby')],
        // Store owners don't book — show «طلبات متجري» (store orders) here instead
        // of the buyer «حجوزاتي» which would just be empty + confusing. v12.02
        [ownsStore(s)
            ? Markup.button.callback(tr('menu_store_orders') + (s.pendingBookings > 0 ? `  •  ${s.pendingBookings}` : ''), 'seller:bookings')
            : Markup.button.callback(tr('menu_bookings_buyer'), 'buyer:bookings'),
          Markup.button.callback(tr('menu_follows'),'buyer:following')],
        [Markup.button.callback(tr('menu_alerts'),'alerts:open'), Markup.button.callback(tr('menu_account'),'buyer:profile')],
    ];
    // الأدمن قد يكون مالكاً لمتجر («تاكي») — يحتاج إدارة طلبات متجره من البوت لا أن
    // يصله الإشعار فقط؛ بدون هذا الزر لا منفذ لقائمة طلبات المتجر إطلاقاً. v11.81
    if (ownsStore(s)) {
        // «طلبات متجري» تظهر أعلاه الآن بدل «حجوزاتي» (v12.02) — هنا لوحة المتجر + الاشتراك.
        rows.push([Markup.button.webApp(tr('menu_store_dashboard'), W('/seller'))]);
        // الأدمن-المالك يحتاج إدارة اشتراك/باقات متجره من البوت أيضاً (نفس مصدر الموقع). v11.91
        rows.push([Markup.button.callback(tr('menu_subscription'),'seller:sub')]);
    }
    rows.push([Markup.button.webApp(tr('menu_full_admin'), W('/admin'))]);
    rows.push([Markup.button.callback(tr('menu_help'),'help'), Markup.button.callback(tr('menu_logout'),'logout')]);
    rows.push([langBtn()]);
    return Markup.inlineKeyboard(rows);
}
function roleKb(s) {
    if (s.isAdmin)                 return kbAdmin(s);
    if (s.userType === 'seller')   return kbSeller(s);
    if (s.userType === 'buyer')    return kbBuyer(s);
    return kbGuest(s);
}
function roleMsg(s) {
    if (s.isAdmin)
        return tr('menu_msg_admin', DIV, md(s.name));
    if (s.userType === 'seller') {
        const p = s.pendingBookings > 0 ? tr('menu_seller_pending', s.pendingBookings) : tr('menu_seller_no_pending');
        return tr('menu_msg_seller', md(s.shop||s.name), DIV, p, s.activeDeals);
    }
    if (s.userType === 'buyer')
        return tr('menu_msg_buyer', md(s.name), DIV);
    return tr('menu_msg_guest', DIV);
}
// safeReplyMd: an unescaped '.' inside the guest welcome's italic was making the
// whole message fail → /start «did nothing» for a guest after logout. The escape
// above fixes it; safeReplyMd guarantees the main menu always renders. v11.77
async function sendMain(ctx, s) {
    // v12.45 — «هوية المواسم»: الموسم المفعّل من لوحة المدير يتصدّر القائمة
    // الرئيسية بسطر عريض (نفس هوية الموقع نصّياً). md() يؤمّن MarkdownV2.
    // v12.46 (طلب ناصر «حتى لا تزعج»): يظهر عند «الدخول» فقط — مرة كل ٦ ساعات
    // لكل مستخدم، لا مع كل رجوع للقائمة. s في الذاكرة فيُعاد الترحيب بعد
    // إعادة تشغيل السيرفر — سلوك مقبول (دخول جديد فعلياً).
    let msg = roleMsg(s);
    const seasonLine = await SEASON.line(I18N.lang());
    if (seasonLine && (!s.seasonGreetAt || Date.now() - s.seasonGreetAt > 6 * 3600_000)) {
        s.seasonGreetAt = Date.now();
        msg = `*${md(seasonLine)}*\n${DIV}\n${msg}`;
    }
    await safeReplyMd(ctx, msg, { reply_markup: roleKb(s).reply_markup });
}

// On login/start: surface a CURRENT booking the user may have made on the
// website/app but hasn't seen in the bot yet — the seller sees pending orders,
// the buyer sees their active reservation. Shown once per bot session (always
// right after linking via `force`). v11.77 (Task 4)
async function notifyPendingOnLogin(ctx, s, force = false) {
    if (!s || !s.userId) return;
    if (!force && s.temp.loginBkAlertShown) return;
    s.temp.loginBkAlertShown = true;
    try {
        if (ownsStore(s)) {
            const n = s.pendingBookings || 0;
            if (n > 0) await safeReplyMd(ctx, tr('b306_pending_orders_alert', numEsc(n), DIV), { reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b306_view_orders_btn', n),'seller:bookings')]]).reply_markup });
        } else {
            const list = await rpc('bot_get_my_bookings', { p_telegram_id: tgId(ctx), p_scope: 'current' }) || [];
            const n = Array.isArray(list) ? list.length : 0;
            if (n > 0) await safeReplyMd(ctx, tr('b310_current_booking_alert', numEsc(n), DIV), { reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b310_my_current_bookings_btn', n),'buyer:bk:current')]]).reply_markup });
        }
    } catch (e) { console.warn('notifyPendingOnLogin:', e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════════
if (bot) {

bot.telegram.setMyCommands([
    { command:'start',    description:'القائمة الرئيسية' },
    { command:'deals',    description:'تصفح العروض' },
    { command:'nearby',   description:'حولي — العروض القريبة + الخريطة' },
    { command:'search',   description:'بحث عن عرض/متجر/تاجر' },
    { command:'contests', description:'المسابقات والجوائز' },
    { command:'link',     description:'ربط حسابي' },
    { command:'bookings', description:'حجوزاتي' },
    { command:'alerts',   description:'تنبيهاتي' },
    { command:'stats',    description:'الإحصائيات (تاجر)' },
    { command:'verify',   description:'تحقق من حجز (تاجر)' },
    { command:'logout',   description:'تسجيل الخروج' },
    { command:'help',     description:'مساعدة' }
]).catch(e => console.warn('setMyCommands:', e.message));

// ── حصانة عامة ضدّ «اختفاء الرسالة» / تعليق الأزرار (v11.93) ────────────────────
// كان أي محرف MarkdownV2 محجوز غير مهرَّب في أي نص يجعل تيليجرام يرفض الرسالة كاملةً،
// فتختفي الشاشة ويبدو الزر «معلّقاً». بدل ملاحقة ٢٠٠ نداء ctx.reply يدوياً، نلفّ
// ctx.reply/ctx.replyWithPhoto مرّة واحدة لكل تحديث: عند فشل تحليل MarkdownV2 تُعاد
// الرسالة تلقائياً نصاً عادياً (md مُزال) — فلا تختفي أي شاشة في كل أزرار البوت بعد اليوم.
const MD_PARSE_ERR = /can't parse entities|can't find end|byte offset|reserved|entities/i;
bot.use((ctx, next) => {
    if (ctx && typeof ctx.reply === 'function') {
        const _reply = ctx.reply.bind(ctx);
        ctx.reply = async (text, extra) => {
            try { return await _reply(text, extra); }
            catch (e) {
                if (extra && extra.parse_mode && MD_PARSE_ERR.test(e && e.message || '')) {
                    console.warn('reply MarkdownV2 fallback:', e.message);
                    const { parse_mode, ...rest } = extra;
                    return _reply(stripMd(text), rest);
                }
                throw e;
            }
        };
        if (typeof ctx.replyWithPhoto === 'function') {
            const _photo = ctx.replyWithPhoto.bind(ctx);
            ctx.replyWithPhoto = async (photo, extra) => {
                try { return await _photo(photo, extra); }
                catch (e) {
                    if (extra && extra.parse_mode && MD_PARSE_ERR.test(e && e.message || '')) {
                        console.warn('replyWithPhoto MarkdownV2 fallback:', e.message);
                        const { parse_mode, caption, ...rest } = extra;
                        return _photo(photo, { ...rest, caption: caption ? stripMd(caption) : caption });
                    }
                    throw e;
                }
            };
        }
    }
    return next();
});

// Lazy identity refresh: if we don't yet know who this chat belongs to (e.g. the
// user just linked their account from the Mini App), load their profile from the
// DB BEFORE any handler runs — so حجوزاتي / الحجوزات / إلخ recognise them without
// needing /start first. Once known it's a no-op (no further DB hit).
bot.use(async (ctx, next) => {
    // Kill-switch gate — when the admin disables the bot, answer once and stop.
    if (!(await botEnabled())) {
        try {
            if (ctx.updateType === 'callback_query') await ctx.answerCbQuery(tr('b341_bot_maintenance_cb'), { show_alert: true });
            else if (ctx.message) await ctx.reply(tr('b342_bot_maintenance_msg'));
        } catch { /* ignore */ }
        return;
    }
    try { const id = tgId(ctx); if (id && !getSession(id).userId) await refreshSession(ctx); }
    catch { /* never block the update */ }
    // Per-update language context — every tr() downstream reads it (default Arabic). v11.85
    let _lang = 'ar'; try { _lang = getSession(tgId(ctx)).lang || 'ar'; } catch { /* */ }
    return I18N.withLang(_lang, next);
});

// ── Seller-deal flow (إضافة/تعديل العرض + المواقع) — وحدة مستقلة تسجّل أزرارها،
//    وbot.js يفوّض إليها النص/الصورة/الموقع. v11.73
const sellerH = sellerDeals.register(bot, { rpc, uploadPhoto, W, refreshSession, sendMain, KB_BACK });

// ── /start (handles deep-link token: /start link_<token>) ─────────────────────
bot.start(async ctx => {
    if (!checkRL(`start:${chatId(ctx)}`)) return;
    const payload = (ctx.startPayload || '').trim();
    if (payload.startsWith('link_')) {
        const token = payload.slice(5);
        const result = await rpc('bot_consume_link_token', { p_token: token, p_telegram_id: tgId(ctx), p_chat_id: chatId(ctx) });
        if (result?.success) {
            const s = getSession(tgId(ctx));
            s.userId=result.id; s.userType=result.user_type; s.name=result.name; s.shop=result.shop||null; s.lang=result.bot_lang||s.lang||'ar';
            s.isAdmin=!!(result.is_super_admin || result.user_type==='admin' || (result.admin_permissions?.length>0));
            if (ownsStore(s)) { const st = await rpc('bot_get_seller_stats',{p_telegram_id:tgId(ctx)}); if (st) { s.pendingBookings=st.pending_bookings||0; s.activeDeals=st.active_deals||0; } }
            await ctx.reply(tr('b369_link_success', md(s.name)), { parse_mode:'MarkdownV2' });
            await sendMain(ctx, s);
            return notifyPendingOnLogin(ctx, s, true);
        }
        await ctx.reply(tr('b373_link_invalid'), { parse_mode:'MarkdownV2' });
    }
    const s = await refreshSession(ctx);
    await sendMain(ctx, s);
    await notifyPendingOnLogin(ctx, s);
});

bot.command('menu', async ctx => { const s = await refreshSession(ctx); await sendMain(ctx, s); });
bot.action('menu:back', async ctx => { await ctx.answerCbQuery(); const s = await refreshSession(ctx); await sendMain(ctx, s); });
// 🌐 language toggle — persist per-user (if linked) + re-render the main menu. v11.83
bot.action(/^lang:set:(ar|en)$/, async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    s.lang = ctx.match[1];
    I18N.setLang(s.lang);   // update THIS request's ALS context so the re-render uses the new language
    if (s.userId) await rpc('bot_set_lang', { p_telegram_id: tgId(ctx), p_lang: s.lang });
    await sendMain(ctx, s);
});

// ── Help ──────────────────────────────────────────────────────────────────────
bot.command('help', ctx => showHelp(ctx));
bot.action('help', async ctx => { await ctx.answerCbQuery(); showHelp(ctx); });
async function showHelp(ctx) {
    const s = getSession(tgId(ctx));
    let m = tr('help_title', DIV);
    if (!s.userId) m += tr('help_link_hint');
    m += tr('help_commands');
    if (s.userType==='seller'||s.isAdmin) m += tr('help_commands_seller');
    if (s.userId) m += tr('help_logout');
    m += tr('help_type_hint');
    // NOTE: APP_URL contains '.' and '-' which are MarkdownV2-special — md() escapes it
    // (an unescaped URL here once made the whole Help message fail to send).
    m += tr('help_website', md(APP_URL));
    const rows = [[Markup.button.webApp(tr('help_open_taki'), APP_URL)]];
    if (!s.userId) rows.push([Markup.button.callback(tr('help_link_btn'),'link:start')]);
    rows.push([Markup.button.callback(tr('menu_back'),'menu:back')]);
    await safeReplyMd(ctx, m, { reply_markup: Markup.inlineKeyboard(rows).reply_markup });
}

// ── Logout (unlink this Telegram identity from the account) ───────────────────
bot.command('logout', ctx => startLogout(ctx));
bot.action('logout', async ctx => { await ctx.answerCbQuery(); startLogout(ctx); });
async function startLogout(ctx) {
    const s = getSession(tgId(ctx));
    if (!s.userId) { const ns = await refreshSession(ctx); return sendMain(ctx, ns); }
    await ctx.reply(
        tr('b419_logout_confirm', DIV),
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(tr('b421_logout_yes_btn'),'logout:yes')],
            [Markup.button.callback(tr('cm_back_undo'),'menu:back')]
        ]).reply_markup });
}
bot.action('logout:yes', async ctx => {
    await ctx.answerCbQuery(tr('b426_logging_out_cb'));
    const r = await rpc('bot_unlink', { p_telegram_id: tgId(ctx) });
    const s = getSession(tgId(ctx));
    s.userId=null; s.userType=null; s.isAdmin=false; s.name=null; s.shop=null;
    s.geo=null; s.pendingBookings=0; s.activeDeals=0; s.temp={}; s.step='idle';
    await ctx.reply(r?.success ? tr('b431_logout_success') : tr('b431_not_linked'), { parse_mode:'MarkdownV2' });
    return sendMain(ctx, s);
});

// ── Link account (secure — token minted in authenticated web session) ─────────
bot.command('link', ctx => startLink(ctx));
bot.action('link:start', async ctx => { await ctx.answerCbQuery(); startLink(ctx); });
async function startLink(ctx) {
    await ctx.reply(
        tr('q440_link_intro', DIV),
        { parse_mode:'MarkdownV2',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.webApp(tr('b447_login_link_account'), W('/register?tglink=1'))],
            [Markup.button.webApp(tr('b448_browse_as_shopper'), APP_URL)],
            [Markup.button.callback(tr('b449_back'),'menu:back')]
          ]).reply_markup }
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Browse v11 — filters + categories + nearby + rich deal detail
//  (mirrors the web app: distance & drive-time, sponsors ⭐, deal-type, stock)
// ═══════════════════════════════════════════════════════════════════════════════

const SORTMAP     = { p:'popular', d:'discount', n:'newest', s:'sponsored', x:'nearby', r:'real' };
// دوال وقت-التشغيل (لا خرائط ثابتة) كي يتبع النصّ لغة المستخدم عبر ALS. v11.87
const SORT_TITLE  = sort => tr('sort_t_' + sort);   // 🔥/💸/🆕/⭐/📍
const SORT_SHORT  = sl   => tr('sort_s_' + sl);
const PAGE   = 6;

// Full deal-type block: how it ends (days/specific date/quantity) + what's left.
function dealTypeBlock(d){
    const lines=[];
    if(d.expiry_type==='stock'){ lines.push(d.is_unlimited ? tr('q467_qty_unlimited') : tr('q467_remaining_pieces', numEsc(d.quantity??0))); }
    else if(d.expiry_type==='date' && d.expiry_date){ lines.push(tr('q468_valid_until', md(d.expiry_date))); if(!d.is_unlimited) lines.push(tr('q468_remaining', numEsc(d.quantity??0))); }
    else { const r=remainingText(d); lines.push(r ? tr('q469_ends_within', md(r)) : tr('q469_limited_time')); if(!d.is_unlimited) lines.push(tr('q469_remaining', numEsc(d.quantity??0))); }
    return lines.join('\n');
}
// v12.28 — أربع درجات تميز بترتيب ثابت (نفس تمييز الإطار الذهبي في الموقع):
// 👑 راعٍ رسمي → 📣 معلن → ⭐ نجمة → 🥇 إطار ذهبي. bot_browse_deals يرتّبها بنفس السلّم.
function sponsorEmoji(d){ return d.sponsor_label==='sponsor' ? '👑' : d.sponsor_label==='star' ? '⭐' : d.sponsor_label==='none' ? '🥇' : '📣'; }
function sponsorWord(d){
    if (d.sponsor_label==='sponsor') return tr('q472_official_sponsor');
    if (d.sponsor_label==='star')    return tr('q472_star_badge');
    if (d.sponsor_label==='none')    return tr('q472_gold_badge');
    return tr('q472_featured_ad');
}
function sponsorTag(d){ if(!d.is_sponsored) return ''; const e=sponsorEmoji(d); return `${e} ━━━━━ *${sponsorWord(d)}* ━━━━━ ${e}`; }
// placeLink / dirLink / driveInfo → lib/geo.js
// One clear expiry/type line — shows HOW the deal ends (by time vs by quantity)
// plus the exact end date & time when it's time-based. Mirrors the website. v11.72
function browseExpiryLine(d){
    if(d.expiry_type==='stock'){
        return d.is_unlimited ? tr('q479_type_by_qty_available') : tr('q479_ends_when_sold_out', numEsc(d.quantity??0));
    }
    if(d.expiry_type==='date' && d.expiry_date){
        const stk = d.is_unlimited ? '' : tr('q482_left_suffix', numEsc(d.quantity??0));
        return tr('q483_ends_by_time_date', md(fmtDate(d.expiry_date)), stk);
    }
    const r = remainingText(d), end = durationEndsAt(d);
    const when = end ? `  \\(📅 ${md(fmtDate(end))}\\)` : '';
    const stk = d.is_unlimited ? '' : tr('q482_left_suffix', numEsc(d.quantity??0));
    return r ? tr('q488_ends_by_time_within', md(r), when, stk) : tr('q488_limited_time_offer', stk);
}
// One self-contained browse CARD (its own message + a tap button) — like the
// deals page. Tappable location, before/after price, expiry date/type. v11.72
function browseCard(d, n, geo){
    const save = Math.max(0, Number(d.original_price) - Number(d.discounted_price));
    const dist = (geo && d.distance_km!=null) ? tr('q494_distance_km', numEsc(d.distance_km)) : '';
    const pl = placeLink(d);
    const loc = pl ? `[📍 ${md(d.city||d.region||tr('q496_location'))}](${pl})` : `📍 ${md(d.city||d.region||'—')}`;
    const price = save > 0
        ? tr('q498_price_with_save', money(d.discounted_price), money(d.original_price), numEsc(d.discount_percentage))
        : tr('q499_price_only', money(d.discounted_price));
    const head = d.is_sponsored
        ? tr('q501_head_sponsored', sponsorWord(d), numEsc(n), md(d.item_name))
        : tr('q502_head_plain', numEsc(n), md(d.item_name));
    // حالة المحل (مفتوح/مغلق + وقت الفتح) داخل نفس الكرت — تظهر خصوصاً في «جميع المحلات»
    // حيث تظهر المحلات المغلقة أيضاً. الحالة محسوبة في bot_browse_deals (open_status). v11.92
    const os = d.open_status;
    const statusLine = (os && os.configured) ? `\n${md(HRS.statusText(os))}` : '';
    const at = authText(d.auth_real, d.auth_fake);
    const authLn = at ? `\n${md(at)}` : '';
    return tr('q503_browse_card', head, md(d.shop_name), loc, dist, price, browseExpiryLine(d), statusLine) + authLn;
}

bot.command('deals', ctx => enterBrowse(ctx));
bot.action('browse:menu', async ctx => { await ctx.answerCbQuery(); enterBrowse(ctx); });
bot.action(/^deals:(\d+)$/, async ctx => { await ctx.answerCbQuery(); const off=+ctx.match[1]; if(off===0) await sendBanners(ctx, true); renderList(ctx,'n','-',off); }); // entry shows the promo banner too (request: banner on every browse). v12.02
// «تصفّح العروض» → البنر الإعلاني (إن وُجد) ثم قائمة العروض مباشرةً، بفوتر الترتيب
// والصفحات وزرّي «المفتوحة الآن / جميع المحلات» وزر الرجوع — تماماً كما في لقطة
// الشاشة. (requests 3 + 4) v11.78
async function enterBrowse(ctx){
    await sendBanners(ctx, true);   // البنر يظهر مع كل دخول لـ«تصفح العروض» (request 3)
    return renderList(ctx, 'n', '-', 0);
}

// ── Banners shown above the offers (Task 5a) — image cards with a tap action ───
// Shown on every explicit «تصفح العروض» entry (force=true from enterBrowse) so the
// owner's promo always greets the buyer there (request 3); pagination/sort within
// the list do NOT call this, so the images are never re-spammed mid-browse.
async function sendBanners(ctx, force=false){
    const s = getSession(tgId(ctx));
    if (!force && s.temp.bannersShown) return;
    let banners = [];
    try { banners = await rpc('bot_active_banners', {}) || []; } catch { banners = []; }
    if (!banners.length) return;
    s.temp.bannersShown = true;
    for (const b of banners.slice(0,3)){
        const btns = [];
        if (b.deal_id)       btns.push([Markup.button.callback(tr('b530_see_deal'), `deal:${b.deal_id}`)]);
        else if (b.store_id) btns.push([Markup.button.callback(tr('b531_see_store'), `store:${b.store_id}`)]);
        else if (b.target_url && /^https?:\/\//i.test(b.target_url)) btns.push([Markup.button.url(tr('b532_details'), b.target_url)]);
        const cap = tr('b533_banner_caption', md(b.title));
        const rm  = btns.length ? { reply_markup: Markup.inlineKeyboard(btns).reply_markup } : {};
        if (b.image_url){ try { await ctx.replyWithPhoto(b.image_url, { caption: cap, parse_mode:'MarkdownV2', ...rm }); continue; } catch { /* fall through to text */ } }
        await ctx.reply(cap, { parse_mode:'MarkdownV2', ...rm });
    }
}

// ── Search: deals + stores by keyword (Task 4) — mirrors the website search ────
bot.command('search', async ctx => { setStep(tgId(ctx),'await_search'); await ctx.reply(tr('b541_search_prompt'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b541_menu'),'browse:menu')]]).reply_markup }); });
bot.action('search:start', async ctx => {
    await ctx.answerCbQuery();
    setStep(tgId(ctx),'await_search');
    await ctx.reply(tr('b545_search_prompt'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b545_back'),'browse:menu')]]).reply_markup });
});
// التصنيفات أكواد إنجليزية في DB؛ نُطابق نصّ البحث على تسميات التصنيف (عربي/إنجليزي)
// ونمرّر الأكواد فيبحث RPC بها أيضاً — فيشتغل البحث بـ«مقاهي» مثلاً. v11.94
function matchCategoryCodes(q){
    const norm = String(q||'').trim().toLowerCase();
    if (norm.length < 2) return [];
    const out = [];
    for (const code of Object.keys(CAT)){
        if (code === 'all') continue;
        const ar = String(CAT[code].ar||'').toLowerCase();
        const en = String(I18N.t('en','cat_'+code)||'').toLowerCase();
        if (code.toLowerCase()===norm || ar===norm || en===norm || (ar && (ar.includes(norm)||norm.includes(ar))) || (en && (en.includes(norm)||norm.includes(en)))) out.push(code);
    }
    return out;
}
async function runSearch(ctx, q){
    setStep(tgId(ctx),'idle');
    const cats = matchCategoryCodes(q);
    const r = await rpc('bot_search', { p_query: q, p_limit: 8, p_categories: cats.length ? cats : null });
    const deals  = (r && Array.isArray(r.deals))  ? r.deals  : [];
    const stores = (r && Array.isArray(r.stores)) ? r.stores : [];
    if (!deals.length && !stores.length){
        return ctx.reply(tr('b553_no_results', md(q)), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b553_new_search'),'search:start'), Markup.button.callback(tr('b553_menu'),'browse:menu')]]).reply_markup });
    }
    const s = getSession(tgId(ctx));
    s.temp.listCb = 'browse:menu';
    await ctx.reply(tr('b557_search_results', md(q), DIV, numEsc(deals.length), numEsc(stores.length)), { parse_mode:'MarkdownV2' });
    for (const st of stores.slice(0,6)){
        const where = [st.city, st.region].filter(Boolean).join(' • ');
        await ctx.reply(tr('b560_store_card', md(st.shop_name), where?`\n📍 ${md(where)}`:'', numEsc(st.deals_n)), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b560_store_page'),'store:'+st.store_id)]]).reply_markup });
    }
    for (let i=0;i<deals.length;i++){
        const d = deals[i];
        await ctx.reply(browseCard(d, i+1, null), { parse_mode:'MarkdownV2', link_preview_options:{is_disabled:true}, reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b564_details_book'), `deal:${d.id}`)]]).reply_markup });
    }
    await ctx.reply(`${DIV}`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b553_new_search'),'search:start'), Markup.button.callback(tr('b553_menu'),'browse:menu')]]).reply_markup });
}

// ── Contests & prizes (Task 5b) — list, details, and in-bot entry (quiz+social) ─
bot.command('contests', ctx => showContests(ctx));
bot.action('contests:list', async ctx => { await ctx.answerCbQuery(); showContests(ctx); });
async function showContests(ctx){
    const list = await rpc('bot_list_contests', { p_telegram_id: tgId(ctx) }) || [];
    // v12.32 (طلب ناصر ١٧): «القائمة» كانت تفتح تصفّح العروض — الآن زران
    // واضحان: «تصفح العروض» و«القائمة» (القائمة الرئيسية فعلاً).
    if (!list.length) return ctx.reply(tr('b574_no_contests', DIV), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(tr('b574_refresh'),'contests:list')],
        [Markup.button.callback(tr('menu_browse'),'browse:menu'), Markup.button.callback(tr('b553_menu'),'menu:back')]
    ]).reply_markup });
    await ctx.reply(tr('b575_contests_header', numEsc(list.length), DIV), { parse_mode:'MarkdownV2' });
    for (const c of list){
        let m = `🎁 *${md(c.title)}*`;
        if (c.prize)       m += tr('q578_prize', md(c.prize));
        if (c.description) m += `\n${md(String(c.description).slice(0,200))}`;
        if (c.ends_at)     m += tr('q580_ends', md(fmtDay(c.ends_at)));
        const label = c.entered ? tr('b581_entered_details') : tr('b581_enter_now');
        await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(label, `contest:open:${c.id}`)]]).reply_markup });
    }
    // v12.32 (طلب ناصر ١٧): زران منفصلان — «تصفح العروض» و«القائمة» الرئيسية.
    await ctx.reply(`${DIV}`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(tr('b574_refresh'),'contests:list')],
        [Markup.button.callback(tr('menu_browse'),'browse:menu'), Markup.button.callback(tr('b553_menu'),'menu:back')]
    ]).reply_markup });
}
bot.action(/^contest:open:([0-9a-fA-F-]+)$/, async ctx => { await ctx.answerCbQuery(); openContest(ctx, ctx.match[1]); });
async function openContest(ctx, id){
    const c = await rpc('bot_get_contest', { p_telegram_id: tgId(ctx), p_contest_id: id });
    if (!c) return ctx.reply(tr('b589_contest_unavailable'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b589_contests'),'contests:list')]]).reply_markup });
    let m = `🎁 *${md(c.title)}*\n${DIV}`;
    if (c.prize)       m += tr('q591_prize', md(c.prize));
    if (c.description) m += `\n\n${md(String(c.description).slice(0,400))}`;
    if (c.ends_at)     m += tr('q593_ends', md(fmtDay(c.ends_at)));
    const qn = Array.isArray(c.questions) ? c.questions.length : 0;
    const sn = Array.isArray(c.social_tasks) ? c.social_tasks.length : 0;
    if (qn||sn) m += tr('q596_questions_tasks', numEsc(qn), sn?tr('q596_tasks_suffix', numEsc(sn)):'');
    const btns = [];
    if (!c.live)          m += tr('q598_contest_no_longer_available');
    else if (c.entered)   m += tr('q599_already_participated');
    else if (!c.linked) { m += tr('q600_login_to_participate'); btns.push([Markup.button.callback(tr('b600_link_account'),'link:start')]); }
    else if (!c.has_phone){ m += tr('q601_add_phone_then_participate'); btns.push([Markup.button.webApp(tr('b601_complete_phone'), W('/profile'))]); }
    else                  btns.push([Markup.button.callback(tr('b602_start_entry'), `contest:go:${id}`)]);
    btns.push([Markup.button.callback(tr('b603_contests'),'contests:list')]);
    const rm = { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup };
    if (c.banner_image){ try { return await ctx.replyWithPhoto(c.banner_image, { caption:m, ...rm }); } catch { /* fall through */ } }
    await ctx.reply(m, rm);
}
bot.action(/^contest:go:([0-9a-fA-F-]+)$/, async ctx => { await ctx.answerCbQuery(); startContestQuiz(ctx, ctx.match[1]); });
async function startContestQuiz(ctx, id){
    const c = await rpc('bot_get_contest', { p_telegram_id: tgId(ctx), p_contest_id: id });
    if (!c || !c.live)  return ctx.reply(tr('b611_contest_no_longer'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b589_contests'),'contests:list')]]).reply_markup });
    if (c.entered)      return openContest(ctx, id);
    if (!c.linked)      return ctx.reply(tr('b613_login_first_link'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b600_link_account'),'link:start')]]).reply_markup });
    if (!c.has_phone)   return ctx.reply(tr('b614_add_phone_then_enter'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.webApp(tr('b601_complete_phone'), W('/profile'))]]).reply_markup });
    const s = getSession(tgId(ctx));
    s.temp.cwiz = { id, questions: Array.isArray(c.questions)?c.questions:[], social: Array.isArray(c.social_tasks)?c.social_tasks:[], answers:{}, social_answers:{}, qi:0, si:0 };
    return askContestStep(ctx);
}
// Drives the quiz one step at a time: questions first, then social tasks, then submit.
async function askContestStep(ctx){
    const s = getSession(tgId(ctx)); const w = s.temp.cwiz; if (!w) return;
    if (w.qi < w.questions.length){
        const q = w.questions[w.qi];
        const prompt = tr('b624_question_prompt', numEsc(w.qi+1), numEsc(w.questions.length), md(q.prompt||''));
        if (q.type === 'choice' && Array.isArray(q.options) && q.options.length){
            const rows = q.options.map((opt,idx) => [Markup.button.callback(String(opt).slice(0,60), `cq:${idx}`)]);
            if (!q.required) rows.push([Markup.button.callback(tr('b627_skip'),'cq:skip')]);
            rows.push([Markup.button.callback(tr('b628_cancel'),'contests:list')]);
            setStep(tgId(ctx),'idle');
            return ctx.reply(prompt, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
        }
        setStep(tgId(ctx),'await_contest_answer');
        const rows = [];
        if (!q.required) rows.push([Markup.button.callback(tr('b627_skip'),'cq:skip')]);
        rows.push([Markup.button.callback(tr('b628_cancel'),'contests:list')]);
        return ctx.reply(tr('b636_type_answer', prompt), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
    }
    if (w.si < w.social.length){
        const t = w.social[w.si];
        setStep(tgId(ctx),'await_contest_social');
        return ctx.reply(tr('b641_social_task', numEsc(w.si+1), numEsc(w.social.length), md(t.prompt||'')), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b627_skip'),'cq:skip')],[Markup.button.callback(tr('b628_cancel'),'contests:list')]]).reply_markup });
    }
    return submitContest(ctx);
}
bot.action(/^cq:(\d+|skip)$/, async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx)); const w = s.temp.cwiz;
    if (!w) return ctx.reply(tr('cm_contest_session_ended'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('cm_contests'),'contests:list')]]).reply_markup });
    setStep(tgId(ctx),'idle');
    if (w.qi < w.questions.length){
        const q = w.questions[w.qi];
        if (ctx.match[1]==='skip') { if (q) w.answers[q.id]=''; }
        else if (q && q.type==='choice' && Array.isArray(q.options)) { w.answers[q.id] = String(q.options[+ctx.match[1]] ?? ''); }
        w.qi++;
    } else {
        const t = w.social[w.si]; if (t) w.social_answers[t.id]=''; w.si++;
    }
    return askContestStep(ctx);
});
async function submitContest(ctx){
    const s = getSession(tgId(ctx)); const w = s.temp.cwiz; if (!w) return;
    setStep(tgId(ctx),'idle');
    const r = await rpc('bot_submit_contest_entry', { p_telegram_id: tgId(ctx), p_contest_id: w.id, p_answers: w.answers, p_social: w.social_answers });
    s.temp.cwiz = null;
    if (!r?.success){
        const e=r?.error;
        const msg = e==='already_entered' ? tr('b667_already_entered')
            : e==='no_phone'    ? tr('b668_add_phone')
            : e==='not_linked'  ? tr('b669_login_first')
            : e==='ended'       ? tr('b670_contest_ended')
            : e==='not_started' ? tr('b671_not_started')
            : e==='not_active'  ? tr('b672_not_active')
            : (e==='sellers_only'||e==='buyers_only') ? tr('b673_different_audience')
            : tr('b674_entry_failed');
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('cm_contests'),'contests:list')]]).reply_markup });
    }
    const head  = r.qualified ? tr('b677_entry_qualified') : tr('b677_entry_recorded');
    const score = (r.max_score>0) ? tr('b678_your_score', numEsc(r.score), numEsc(r.max_score)) : '';
    // v12.32 (طلب ناصر ١٧): بعد المشاركة — «مسابقات أخرى» + «تصفح العروض» + «القائمة».
    await ctx.reply(tr('b679_good_luck', head, score, DIV), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(tr('b679_other_contests'),'contests:list')],
        [Markup.button.callback(tr('menu_browse'),'browse:menu'), Markup.button.callback(tr('b679_menu'),'menu:back')]
    ]).reply_markup });
}

// br:<sortLetter>:<category|->:<offset>
bot.action(/^br:([pdnsxr]):([A-Za-z_\-]+):(\d+)$/, async ctx => { await ctx.answerCbQuery(); await renderList(ctx, ctx.match[1], ctx.match[2], +ctx.match[3]); });
async function renderList(ctx, sortLetter, cat, offset){
    if(!checkRL(`br:${chatId(ctx)}`)) return;
    const s=getSession(tgId(ctx));
    const sort=SORTMAP[sortLetter]||'newest';
    const geo=(sort==='nearby')?s.geo:undefined;
    if(sort==='nearby' && !geo) return askLocation(ctx);
    if(s.temp.browseOpenNow===undefined) s.temp.browseOpenNow=true;   // العروض الحيّة افتراضياً
    s.temp.lastBr={ sortLetter, cat, offset };
    const deals=await rpc('bot_browse_deals',{ p_sort:sort, p_category:(cat&&cat!=='-')?cat:null,
        p_lat:geo?geo.lat:null, p_lng:geo?geo.lng:null, p_radius_km:null, p_limit:PAGE, p_offset:offset,
        p_open_now:!!s.temp.browseOpenNow })||[];
    const catName=(cat&&cat!=='-')?`  ·  ${catLabel(cat)}`:'';
    s.temp.listCb=`br:${sortLetter}:${cat||'-'}:${offset}`;
    if(!deals.length){
        const openHint = (offset===0 && s.temp.browseOpenNow) ? tr('b698_some_shops_closed') : '';
        const msg=offset===0?`${tr('b699_no_matching_deals')}${geo?tr('b699_try_widen'):''}${openHint}`:tr('b699_no_more_deals');
        const erows=[];
        if (offset===0 && s.temp.browseOpenNow) erows.push([Markup.button.callback(tr('b701_show_all_shops'),'br:open:0')]);
        erows.push([Markup.button.callback(tr('b702_another_category'),'browse:cats'),Markup.button.callback(tr('b702_menu'),'menu:back')]);
        return ctx.reply(`${SORT_TITLE(sort)}${md(catName)}\n${DIV}\n\n${msg}`, { parse_mode:'MarkdownV2',
            reply_markup: Markup.inlineKeyboard(erows).reply_markup });
    }
    // Header, then ONE self-contained card per deal (button attached) — exactly
    // like the deals page, so each deal is its own tappable box. v11.72
    await ctx.reply(tr('b708_each_deal_card', SORT_TITLE(sort), md(catName), DIV), { parse_mode:'MarkdownV2' });
    for(let i=0;i<deals.length;i++){
        const d=deals[i];
        await ctx.reply(browseCard(d, offset+i+1, geo), { parse_mode:'MarkdownV2', link_preview_options:{is_disabled:true},
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('cm_details_book') + (d.is_sponsored?` ${sponsorEmoji(d)}`:''), `deal:${d.id}`)]]).reply_markup });
    }
    const rows=[];
    const nav=[];
    if(offset>0) nav.push(Markup.button.callback(tr('b716_previous'),`br:${sortLetter}:${cat||'-'}:${Math.max(0,offset-PAGE)}`));
    if(deals.length===PAGE) nav.push(Markup.button.callback(tr('b717_next'),`br:${sortLetter}:${cat||'-'}:${offset+PAGE}`));
    if(nav.length) rows.push(nav);
    const sw=[];
    ['p','d','n','r'].forEach(sl=>{ if(sl!==sortLetter) sw.push(Markup.button.callback(SORT_SHORT(sl),`br:${sl}:${cat||'-'}:0`)); });
    if(s.geo && sortLetter!=='x') sw.push(Markup.button.callback(SORT_SHORT('x'),`br:x:${cat||'-'}:0`));
    // زرّان كحدّ أقصى في الصف حتى لا يقتصّ تيليجرام «الأكثر خصماً» على الشاشات الضيقة. v11.87
    for(let i=0;i<sw.length;i+=2) rows.push(sw.slice(i,i+2));
    // فلتر واضح بزرّين: المفتوحة الآن (الافتراضي) أو جميع المحلات (مفتوحة + مغلقة). v11.77
    rows.push([
        Markup.button.callback(s.temp.browseOpenNow ? tr('b725_open_now_on') : tr('b725_open_now'), 'br:open:1'),
        Markup.button.callback(!s.temp.browseOpenNow ? tr('b726_all_shops_on') : tr('b726_all_shops'), 'br:open:0'),
    ]);
    rows.push([Markup.button.callback(tr('b728_categories'),'browse:cats'),Markup.button.callback(tr('b728_menu'),'menu:back')]);
    // فوتر التنقّل/الترتيب: «=» محرف محجوز في MarkdownV2 — بدون تهريبه يرفض
    // تيليجرام الرسالة بصمت فتختفي أزرار «التالي/التصنيفات». نهرّبه + safeReplyMd
    // (احتياط نصّ عادي) كي لا يختفي الفوتر مهما حدث. v11.81
    await safeReplyMd(ctx, tr('b732_page_footer', DIV, md(String(Math.floor(offset/PAGE)+1))), { reply_markup: Markup.inlineKeyboard(rows).reply_markup });
}
// ── العروض القادمة (Coming Soon) — عروض مجدولة تبدأ خلال ٧ أيام، بعدّاد بدل الحجز.
//    تُجلب بوضع p_upcoming:true (يطابق نافذة الموقع 7 أيام). v11.98 ────────────────
function soonCard(d, n){
    const save = Math.max(0, Number(d.original_price) - Number(d.discounted_price));
    const pl = placeLink(d);
    const loc = pl ? `[📍 ${md(d.city||d.region||tr('q496_location'))}](${pl})` : `📍 ${md(d.city||d.region||'—')}`;
    const price = save > 0
        ? tr('q498_price_with_save', money(d.discounted_price), money(d.original_price), numEsc(d.discount_percentage))
        : tr('q499_price_only', money(d.discounted_price));
    const startsMs = d.starts_at ? Number(d.starts_at) : 0;
    const soon = startsMs>Date.now() ? `\n⏳ ${md(tr('soon_starts_in', fmtSoonCountdown(startsMs-Date.now())))}` : '';
    return `${tr('q502_head_plain', numEsc(n), md(d.item_name))}\n🏪 ${md(d.shop_name)}   ${loc}\n${price}${soon}`;
}
async function renderUpcoming(ctx, offset){
    if(!checkRL(`soon:${chatId(ctx)}`)) return;
    const s=getSession(tgId(ctx));
    const deals=await rpc('bot_browse_deals',{ p_sort:'newest', p_limit:PAGE, p_offset:offset, p_upcoming:true })||[];
    s.temp.listCb='browse:soon';
    if(!deals.length){
        return safeReplyMd(ctx, `${tr('soon_title')}\n${DIV}\n\n${tr('soon_none')}`, {
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b728_menu'),'menu:back')]]).reply_markup });
    }
    await ctx.reply(`${tr('soon_title')}\n${DIV}`, { parse_mode:'MarkdownV2' });
    for(let i=0;i<deals.length;i++){
        const d=deals[i];
        await safeReplyMd(ctx, soonCard(d, offset+i+1), { link_preview_options:{is_disabled:true},
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('cm_details_book'), `deal:${d.id}`)]]).reply_markup });
    }
    const nav=[];
    if(offset>0) nav.push(Markup.button.callback(tr('b716_previous'),`soon:go:${Math.max(0,offset-PAGE)}`));
    if(deals.length===PAGE) nav.push(Markup.button.callback(tr('b717_next'),`soon:go:${offset+PAGE}`));
    const rows=[];
    if(nav.length) rows.push(nav);
    rows.push([Markup.button.callback(tr('b728_menu'),'menu:back')]);
    await safeReplyMd(ctx, tr('b732_page_footer', DIV, md(String(Math.floor(offset/PAGE)+1))), { reply_markup: Markup.inlineKeyboard(rows).reply_markup });
}
bot.action('browse:soon', async ctx => { await ctx.answerCbQuery(); await renderUpcoming(ctx, 0); });
bot.action(/^soon:go:(\d+)$/, async ctx => { await ctx.answerCbQuery(); await renderUpcoming(ctx, +ctx.match[1]); });

// "Open now" (1) vs "all shops" (0) for the browse list, then re-render. v11.77
bot.action(/^br:open:([01])$/, async ctx => {
    await ctx.answerCbQuery();
    const s=getSession(tgId(ctx));
    s.temp.browseOpenNow = ctx.match[1]==='1';
    const b = s.temp.lastBr || { sortLetter:'n', cat:'-', offset:0 };
    return renderList(ctx, b.sortLetter, b.cat, b.offset);
});

// Category picker (counts respect the user's shared location when available).
bot.action('browse:cats', async ctx => { await ctx.answerCbQuery(); showCats(ctx); });
async function showCats(ctx){
    const s=getSession(tgId(ctx));
    const cats=await rpc('bot_get_categories',{ p_lat:s.geo?s.geo.lat:null, p_lng:s.geo?s.geo.lng:null, p_radius_km:null })||[];
    if(!cats.length) return ctx.reply(tr('b748_no_active_categories'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b748_menu'),'browse:menu')]]).reply_markup });
    const rows=[]; let row=[];
    cats.forEach(c=>{ row.push(Markup.button.callback(`${catLabel(c.category)} (${c.n})`,`br:n:${c.category}:0`)); if(row.length===2){ rows.push(row); row=[]; } });
    if(row.length) rows.push(row);
    rows.push([Markup.button.callback(tr('b752_menu'),'browse:menu')]);
    await ctx.reply(tr('b753_available_categories', DIV), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
}

// Nearby — ask the user to share their location (Telegram location keyboard).
bot.action('browse:near', async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); if(s.geo) return renderList(ctx,'x','-',0); askLocation(ctx); });
function askLocation(ctx){
    return ctx.reply(tr('b759_your_location'), { parse_mode:'MarkdownV2',
        reply_markup: Markup.keyboard([[Markup.button.locationRequest(tr('b1569_share_my_location_now'))],[tr('sd34_cancel')]]).resize().oneTime().reply_markup });
}
bot.on('location', async ctx => {
    const loc=ctx.message && ctx.message.location; if(!loc) return;
    const s=getSession(tgId(ctx));
    // تدفّق التاجر يلتقط موقعاً (إضافة/تعديل/فرع عبر «مشاركة موقعي»)؟
    try { if (await sellerH.handleLocation(ctx, s, loc.latitude, loc.longitude)) return; } catch (e) { console.warn('loc:', e.message); }
    return handleSharedLocation(ctx, s, loc.latitude, loc.longitude);
});
// A location obtained via Telegram share OR a pasted Google-Maps link / "lat,lng"
// (request 5): save it once (session + the linked account so we never ask again),
// then resume whatever the user was doing.
async function handleSharedLocation(ctx, s, lat, lng){
    s.geo = { lat, lng };
    if (s.userId) rpc('bot_set_location', { p_telegram_id: tgId(ctx), p_lat: lat, p_lng: lng });
    const kbOff = { reply_markup: Markup.removeKeyboard().reply_markup };
    // Smart-alert radius flow.
    if (s.temp.alertLocWait) {
        s.temp.alertLocWait = false;
        const d = s.temp.alertDraft || (s.temp.alertDraft = newDraft());
        d.coords = { lat, lng };
        await ctx.reply(tr('b781_alert_location_set'), { parse_mode:'MarkdownV2', ...kbOff });
        return askRadius(ctx);
    }
    // Nearby page: 'pick' → choose the km, 'hub' → back to filters, else show 30 كم now.
    if (s.temp.nearbyLocWait) {
        const mode = s.temp.nearbyLocWait; s.temp.nearbyLocWait = false;
        // لا نفرض ٣٠ كم بعد الآن — «الأقرب» = الأقرب فالأقرب بلا حدّ (وضع pick يختار الكم لاحقاً). v11.93
        const f = nfDraft(s); f.useGeo = true;
        await ctx.reply(tr('b788_location_set'), { parse_mode:'MarkdownV2', ...kbOff });
        return mode==='pick' ? askNfRadius(ctx) : mode==='hub' ? showNearbyHub(ctx) : runNearby(ctx, 0);
    }
    // Default → the nearest-offers list.
    const saved = s.userId ? tr('b792_location_saved') : '';
    await ctx.reply(tr('b793_location_set_nearest', saved), { parse_mode:'MarkdownV2', ...kbOff });
    return renderList(ctx,'x','-',0);
}

// عدّاد تنازلي مختصر (يي سس / سس دد / دد) — لبطاقة «قادم قريباً».
// (مختلف عن fmtCountdown أدناه الخاص بعدّاد الحجز HH:MM:SS). v11.98
function fmtSoonCountdown(ms) {
    const mins = Math.max(0, Math.floor(ms / 60000));
    const dd = Math.floor(mins / 1440), hh = Math.floor((mins % 1440) / 60), mm = mins % 60;
    if (dd > 0) return `${tr('dur_d', dd)} ${tr('dur_h', hh)}`;
    if (hh > 0) return `${tr('dur_h', hh)} ${tr('dur_m', mm)}`;
    return tr('dur_m', mm);
}

// ── Deal detail (rich: images album + deal-type + distance/drive + sponsor) ────
bot.action(/^deal:([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    const dealId = ctx.match[1];
    const d = await rpc('bot_get_deal', { p_deal_id: dealId, p_telegram_id: tgId(ctx) });
    if (!d) return ctx.reply(tr('b802_deal_expired'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b802_available_deals'),'browse:menu')]]).reply_markup });
    const s = getSession(tgId(ctx));
    s.temp.dealId = dealId; s.temp.dealName = d.item_name; s.temp.dealQty = 1;
    s.temp.dealMaxPer = Number(d.max_per_booking) || 0;   // v12.28 — سقف التاجر للحجز الواحد
    const tag  = sponsorTag(d);
    const cat  = d.category ? tr('b806_category_line', md(catLabel(d.category))) : '';
    const rating = d.rating_count>0 ? tr('b807_rating_line', md(String(d.rating_avg)), d.rating_count) : '';
    // مصداقية العرض (تصويت المشترين حقيقي/وهمي) — سطر مستقل، MarkdownV2-safe. v11.98
    const at = authText(d.auth_real, d.auth_fake);
    const authBlock = at ? `\n${md(at)}` : '';
    const prep = d.prep_time ? tr('b808_prep_time_line', md(d.prep_time)) : '';
    const desc = d.description ? tr('b809_notes_line', md(String(d.description).slice(0,500))) : '';
    let geoBlock='';
    // Task 11 (speed) — instant local estimate instead of the OSRM network call
    // (which could block the deal card up to 2.5s). Straight-line × road factor.
    if (s.geo && d.map_lat!=null && d.map_lng!=null) {
        const straight = haversineKm(s.geo.lat, s.geo.lng, d.map_lat, d.map_lng);
        const km = straight*1.3, min = Math.max(1, Math.round(km/0.6));
        // NOTE: '~' is MarkdownV2-reserved — it MUST be escaped (\\~) or the
        // whole caption fails to parse and the details vanish (only the image
        // album shows). This regressed in v11.74 when the estimate became the
        // default path (the '~' is now always present in the nearby flow). v11.76
        geoBlock = tr('b820_distance_drive', numEsc(fmtKm(straight)), numEsc(min), numEsc(fmtKm(km)));
    }
    else if (d.map_lat!=null) geoBlock = tr('b822_share_for_distance');
    // ساعات عمل المحل (v11.77) — الحالة محسوبة في قاعدة البيانات (open_status).
    const os = d.open_status;
    const shopClosed  = !!(os && os.configured && !os.open);
    const closingSoon = !!(os && os.configured && os.open && os.closes_in_min != null && os.closes_in_min <= HRS.CLOSING_SOON_MIN);
    let hoursBlock = '';
    if (os && os.configured) {
        const today = HRS.todayLine(d.working_hours);
        hoursBlock = `\n🕐 *${md(HRS.statusText(os))}*${today ? `\n_${md(today)}_` : ''}`;
    }
    // «قادم قريباً» — لم يبدأ العرض بعد: نعرض العدّاد ونمنع الحجز. v11.98
    const startsMs = d.starts_at ? Number(d.starts_at) : 0;
    const comingSoon = startsMs > Date.now();
    const soonBlock = comingSoon ? `\n⏳ *${md(tr('soon_starts_in', fmtSoonCountdown(startsMs - Date.now())))}*` : '';
    const caption =
        `${tag?tag+'\n':''}🏷 *${md(d.item_name)}*\n${DIV}\n🏪 ${md(d.shop_name)}   📍 ${md(d.city||d.region||'—')}${cat}${rating}${authBlock}\n\n` +
        priceBlock(d.original_price, d.discounted_price, d.discount_percentage) +
        `\n\n${dealTypeBlock(d)}${prep}${geoBlock}${hoursBlock}${soonBlock}${desc}`;
    const btns = [];
    if (s.userId && s.userType !== 'seller') {
        if (comingSoon)      btns.push([Markup.button.callback(tr('soon_locked').slice(0,62), `dealsoon:${dealId}`)]);
        else if (shopClosed) btns.push([Markup.button.callback(tr('b838_shop_closed_btn', os.opens_in_min!=null?tr('b838_opens_in', HRS.fmtMins(os.opens_in_min)):'').slice(0,62), `dealclosed:${dealId}`)]);
        else                 btns.push([Markup.button.callback(tr('b839_book_now'),'book:qty')]);
    }
    else if (!s.userId) btns.push([Markup.button.webApp(tr('b841_login_to_book'), APP_URL)]);
    if (d.store_id) {
        // Tap the merchant to open their store profile (Task 6).
        btns.push([Markup.button.callback(tr('b844_store_page'), `store:${d.store_id}`)]);
        const folRow = [];
        if (s.userId) folRow.push(Markup.button.callback(d.following ? tr('b846_following_unfollow') : tr('b846_follow_store'), d.following ? `folAsk:${d.store_id}` : `fol:${d.store_id}`));
        folRow.push(Markup.button.callback(tr('b847_reviews'), `revw:${d.store_id}`));
        btns.push(folRow);
    }
    const dl = dirLink(d, s.geo);
    const row2=[];
    if (dl) row2.push(Markup.button.url(tr('b852_directions'), dl));
    if (!s.geo && d.map_lat!=null) row2.push(Markup.button.callback(tr('b853_calc_distance'),'browse:near'));
    if (row2.length) btns.push(row2);
    btns.push([Markup.button.callback(tr('b855_back_to_deals'), s.temp.listCb || 'browse:menu')]);
    const extra = { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup };
    const imgs   = Array.isArray(d.images) ? d.images.filter(Boolean) : [];
    const photos = (imgs.length ? imgs : (d.image ? [d.image] : [])).slice(0, 5);
    // One image + a short caption → attach the details to the photo (compact card).
    if (photos.length === 1 && caption.length <= 1000) {
        try { return await ctx.replyWithPhoto(photos[0], { caption, ...extra }); }
        catch { /* fall through → photo then text, so details always show */ }
    }
    // Otherwise: send the image(s) FIRST (album or single, NO caption), then the
    // full details + booking buttons as a guaranteed text message — mirrors the
    // website (gallery, then details below). safeReplyMd never lets the details
    // get lost to a caption-length or MarkdownV2 parse error. v11.76
    if (photos.length > 1)      { try { await ctx.replyWithMediaGroup(photos.map(u => ({ type:'photo', media:u }))); } catch { /* ignore */ } }
    else if (photos.length === 1) { try { await ctx.replyWithPhoto(photos[0]); } catch { /* ignore */ } }
    return safeReplyMd(ctx, caption, { ...extra, link_preview_options:{is_disabled:true} });
});

// Tapped the locked "coming soon" button → explain it hasn't started yet. v11.98
bot.action(/^dealsoon:([a-zA-Z0-9_-]+)$/, async ctx => {
    const d = await rpc('bot_get_deal', { p_deal_id: ctx.match[1], p_telegram_id: tgId(ctx) });
    const startsMs = d && d.starts_at ? Number(d.starts_at) : 0;
    const msg = startsMs > Date.now()
        ? `${tr('soon_locked')} ${tr('soon_starts_in', fmtSoonCountdown(startsMs - Date.now()))}`
        : tr('soon_locked');
    return ctx.answerCbQuery(msg, { show_alert: true });
});

// Tapped the "shop closed" button → explain when it reopens (v11.77).
bot.action(/^dealclosed:([a-zA-Z0-9_-]+)$/, async ctx => {
    const d = await rpc('bot_get_deal', { p_deal_id: ctx.match[1], p_telegram_id: tgId(ctx) });
    const os = d?.open_status;
    const msg = (os && os.opens_in_min != null)
        ? tr('b878_closed_opens_in', HRS.fmtMins(os.opens_in_min))
        : tr('b879_closed_now');
    return ctx.answerCbQuery(msg, { show_alert: true });
});

// ── Store: follow / block / reviews ───────────────────────────────────────────
bot.action(/^fol:(.+)$/, async ctx => {
    const r = await rpc('bot_toggle_follow', { p_telegram_id: tgId(ctx), p_store_id: ctx.match[1] });
    if (!r?.success) return ctx.answerCbQuery(tr('b886_login_first'), { show_alert:true });
    return ctx.answerCbQuery(r.following ? tr('b887_followed_store') : tr('b887_unfollowed'), { show_alert:true });
});
bot.action(/^blk:(.+)$/, async ctx => {
    const r = await rpc('bot_toggle_block', { p_telegram_id: tgId(ctx), p_store_id: ctx.match[1] });
    if (!r?.success) return ctx.answerCbQuery(tr('b891_login_first'), { show_alert:true });
    return ctx.answerCbQuery(r.blocked ? tr('b892_store_blocked') : tr('b892_block_removed'), { show_alert:true });
});
// Confirm screens (mirror the app's «هل أنت متأكد؟») — unfollow + block. v11.72
bot.action(/^folAsk:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const sid = ctx.match[1];
    await ctx.reply(tr('b898_unfollow_confirm'), { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b899_yes_unfollow'),`fol:${sid}`)],[Markup.button.callback(tr('b899_back'),'menu:back')]]).reply_markup });
});
bot.action(/^blkAsk:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const sid = ctx.match[1];
    await ctx.reply(tr('b904_block_confirm'), { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b905_yes_block'),`blk:${sid}`)],[Markup.button.callback(tr('b905_back'),'menu:back')]]).reply_markup });
});
bot.action(/^revw:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const sid = ctx.match[1];
    const r = await rpc('bot_get_store_reviews', { p_store_id: sid, p_limit: 6 });
    if (!r?.success) return ctx.reply(tr('b911_reviews_load_failed'), { parse_mode:'MarkdownV2' });
    const stars = n => '⭐'.repeat(Math.max(0, Math.min(5, Math.round(n))));
    let m = tr('q913_store_reviews_header', DIV);
    if (r.count>0) m += tr('q914_overall_rating', md(String(r.avg)), r.count);
    const revs = r.reviews||[];
    if (!revs.length) m += tr('q916_no_reviews_yet');
    else for (const v of revs) {
        m += `${stars(v.score)}  _${md(v.user)}_\n`;
        if (v.comment) m += `${md(v.comment)}\n`;
        if (v.reply) m += tr('q920_merchant_reply', md(v.reply));
        m += `\n`;
    }
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b923_block_store'),`blkAsk:${sid}`)],[Markup.button.callback(tr('b923_back_to_offers'),'browse:menu')]]).reply_markup });
});

// ── Store profile (buyer taps the merchant from a deal/booking) — Task 6 ──────
bot.action(/^store:(.+)$/, async ctx => { await ctx.answerCbQuery(); await renderStore(ctx, ctx.match[1]); });
async function renderStore(ctx, storeId) {
    const s = getSession(tgId(ctx));
    const st = await rpc('bot_get_store', { p_telegram_id: tgId(ctx), p_store_id: storeId });
    if (!st) return ctx.reply(tr('b931_store_open_failed'), { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    const stars  = st.rating_count>0 ? tr('q932_store_rating', md(String(st.rating_avg)), st.rating_count) : tr('q932_no_ratings_yet');
    const where  = [st.city, st.region].filter(Boolean).join(' • ');
    const loc    = where ? `\n📍 ${md(where)}` : '';
    const bio    = st.bio ? `\n\n📝 _${md(String(st.bio).slice(0,300))}_` : '';
    let m = tr('q936_store_card', md(st.name), DIV, stars, loc, numEsc(st.active_deals), bio);
    // نسبة مصداقية عروض المتجر (إجمالي تصويت المشترين). v11.98
    const stAuth = authText(st.auth_real, st.auth_fake);
    if (stAuth) m += `\n${md(stAuth)}`;
    // ساعات العمل — مع صيغة احترافية لـ«٢٤ ساعة/لم تُحدَّد». v11.98
    const sos = st.open_status;
    if (sos && sos.configured) {
        const today = HRS.todayLine(st.working_hours);
        m += `\n\n${tr('store_hours_label')}\n🕐 *${md(HRS.statusText(sos))}*${today ? `\n_${md(today)}_` : ''}`;
    } else {
        m += `\n\n${tr('store_hours_label')}\n${md(tr('hrs_always_open'))}\n_${md(tr('hrs_not_set'))}_`;
    }
    const btns = [];
    const folRow = [];
    if (s.userId) folRow.push(Markup.button.callback(st.following ? tr('b939_following_cancel') : tr('b939_follow_store'), st.following ? `folAsk:${storeId}` : `fol:${storeId}`));
    folRow.push(Markup.button.callback(tr('b940_reviews'), `revw:${storeId}`));
    btns.push(folRow);
    // Task 2 — call the merchant + report (mirror the website store page).
    if (s.userId) btns.push([Markup.button.callback(tr('b943_call_merchant'), `call:s:${storeId}`), Markup.button.callback(tr('b943_report'), `rep:${storeId}`)]);
    const deals = Array.isArray(st.deals) ? st.deals : [];
    deals.slice(0,8).forEach(d => btns.push([Markup.button.callback(tr('b945_deal_btn', String(d.item_name).slice(0,26), (+d.discounted_price)), `deal:${d.id}`)]));
    btns.push([Markup.button.webApp(tr('b946_full_store_page'), W(`/store/${storeId}`))]);
    btns.push([Markup.button.callback(tr('b947_back_to_offers'), s.temp.listCb || 'browse:menu')]);
    const extra = { parse_mode:'MarkdownV2', link_preview_options:{is_disabled:true}, reply_markup: Markup.inlineKeyboard(btns).reply_markup };
    if (st.avatar) { try { return await ctx.replyWithPhoto(st.avatar, { caption:m, parse_mode:'MarkdownV2', reply_markup: extra.reply_markup }); } catch { /* fall through to text */ } }
    await ctx.reply(m, extra);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Task 2 — Call (reveal + confirm) & Report (mirror the website ReportDialog)
// ═══════════════════════════════════════════════════════════════════════════════
// Telegram inline buttons can't carry tel: links, so we reveal the number as
// tap-to-call plain text (Telegram auto-links phone patterns on mobile) after a
// deliberate tap — same "call then confirm" intent the owner asked for.
function callReply(ctx, r, backCb) {
    if (!r?.success) {
        const e = r?.error;
        const msg = e==='not_linked' ? tr('b962_login_first') : e==='not_authorized' ? tr('b962_not_authorized_number') : tr('b962_fetch_number_failed');
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b963_back'), backCb)]]).reply_markup });
    }
    if (!r.phone) {
        return ctx.reply(tr('b966_no_public_number', md(r.name||''), DIV), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b966_back'), backCb)]]).reply_markup });
    }
    return ctx.reply(
        tr('b969_call_reveal', md(r.name||''), DIV, md(r.phone)),
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b970_done'), backCb)]]).reply_markup });
}
bot.action(/^call:s:(.+)$/, async ctx => { await ctx.answerCbQuery(); const r = await rpc('bot_store_contact', { p_telegram_id: tgId(ctx), p_store_id: ctx.match[1] }); return callReply(ctx, r, `store:${ctx.match[1]}`); });
bot.action(/^call:b:(.+)$/, async ctx => { await ctx.answerCbQuery(); const r = await rpc('bot_booking_contact', { p_telegram_id: tgId(ctx), p_barcode: ctx.match[1] }); const s=getSession(tgId(ctx)); return callReply(ctx, r, (ownsStore(s)?'seller:bookings':'buyer:bookings')); });

const REPORT_TYPES = [
    ['scam',tr('q976_report_scam')], ['no_show',tr('q976_report_no_show')], ['harassment',tr('q976_report_harassment')],
    ['inappropriate',tr('q977_report_inappropriate')], ['spam',tr('q977_report_spam')], ['other',tr('q977_report_other')],
];
bot.action(/^rep:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    if (!getSession(tgId(ctx)).userId) return ctx.reply(tr('b981_login_first'), { parse_mode:'MarkdownV2' });
    const sid = ctx.match[1];
    const rows = REPORT_TYPES.map(([k,ar]) => [Markup.button.callback(ar, `rept:${sid}:${k}`)]);
    rows.push([Markup.button.callback(tr('b984_back'), `store:${sid}`)]);
    await ctx.reply(tr('b985_report_store', DIV), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
});
bot.action(/^rept:(.+):([a-z_]+)$/, async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    s.temp.reportStore = ctx.match[1]; s.temp.reportType = ctx.match[2];
    setStep(tgId(ctx),'await_report');
    const label = (REPORT_TYPES.find(t=>t[0]===ctx.match[2])||[])[1] || tr('q992_report_fallback');
    await ctx.reply(tr('b993_report_details', md(label), DIV), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b993_cancel'), `store:${ctx.match[1]}`)]]).reply_markup });
});

// ── Rate a completed booking — Step 1: authenticity «هل العرض حقيقي؟» (every
//    purchase), then ⭐ 1–5 + optional comment. v11.98 ──────────────────────────
bot.action(/^rate:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const bc = ctx.match[1];
    const s = getSession(tgId(ctx));
    let st = null;
    try { st = await rpc('bot_rating_status', { p_telegram_id: tgId(ctx), p_barcode: bc }); } catch { st = null; }
    s.temp.rateStatus = (st && st.ok) ? st : null;
    // v12.30 — the authenticity vote is now EDITABLE: if they voted before,
    // show the current vote and offer to change it or keep it (anti merchant
    // product-swap manipulation — Nasser). ✅ marks the current vote.
    if (st && st.ok && st.voted_auth) {
        const curLbl = st.my_vote === true ? tr('av_real_btn') : tr('av_fake_btn');
        return ctx.reply(tr('av_change_q', curLbl), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback((st.my_vote === true ? '✅ ' : '') + tr('av_real_btn'), `av:${bc}:1`),
             Markup.button.callback((st.my_vote === false ? '✅ ' : '') + tr('av_fake_btn'), `av:${bc}:0`)],
            [Markup.button.callback(tr('av_keep_btn'), `avskip:${bc}`)],
            [Markup.button.callback(tr('b1003_back'),'buyer:bookings')]
        ]).reply_markup });
    }
    await ctx.reply(tr('av_question'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(tr('av_real_btn'),`av:${bc}:1`), Markup.button.callback(tr('av_fake_btn'),`av:${bc}:0`)],
        [Markup.button.callback(tr('b1003_back'),'buyer:bookings')]
    ]).reply_markup });
});
// Record (or CHANGE) the real/fake vote (barcode proves the completed purchase).
bot.action(/^av:(.+):([01])$/, async ctx => {
    const bc = ctx.match[1], isReal = ctx.match[2] === '1';
    const r = await rpc('bot_cast_authenticity_vote', { p_deal_id: null, p_is_real: isReal, p_telegram_id: tgId(ctx), p_barcode: bc });
    await ctx.answerCbQuery(r && r.success ? (r.changed ? tr('av_changed') : tr('av_thanks')) : tr('av_error'));
    return proceedStoreRating(ctx, bc, getSession(tgId(ctx)).temp.rateStatus);
});
// «إبقاء تصويتي» — keep the current vote and continue to the store rating. v12.30
bot.action(/^avskip:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    return proceedStoreRating(ctx, ctx.match[1], getSession(tgId(ctx)).temp.rateStatus);
});
// Store-rating step: if the buyer already rated this STORE, SHOW their previous
// stars+comment WITH an edit button (v12.30 — bot_rate_store updates in place);
// otherwise prompt for stars.
async function proceedStoreRating(ctx, bc, st){
    if (st && st.prev_score) {
        const stars = '⭐'.repeat(st.prev_score);
        const cmt = st.prev_comment ? `\n💬 ${md(st.prev_comment)}` : '';
        return ctx.reply(tr('b_already_rated_store', md(st.shop_name||''), stars, cmt), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(tr('rate_edit_btn'), `redit:${bc}`)],
            [Markup.button.callback(tr('b1019_my_bookings'),'buyer:bookings')],
            [Markup.button.callback(tr('b1019_menu'),'menu:back')]
        ]).reply_markup });
    }
    return showRateStarsTg(ctx, bc);
}
function showRateStarsTg(ctx, bc){
    return ctx.reply(tr('b1000_rate_experience'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('⭐',`rst:${bc}:1`), Markup.button.callback('⭐⭐',`rst:${bc}:2`), Markup.button.callback('⭐⭐⭐',`rst:${bc}:3`)],
        [Markup.button.callback('⭐⭐⭐⭐',`rst:${bc}:4`), Markup.button.callback('⭐⭐⭐⭐⭐',`rst:${bc}:5`)],
        [Markup.button.callback(tr('b1003_back'),'buyer:bookings')]
    ]).reply_markup });
}
// «تعديل تقييمي» — re-open the stars picker; bot_rate_store UPDATEs the old rating. v12.30
bot.action(/^redit:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    return showRateStarsTg(ctx, ctx.match[1]);
});
bot.action(/^rst:(.+):([1-5])$/, async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    s.temp.rateBarcode = ctx.match[1]; s.temp.rateScore = +ctx.match[2];
    setStep(tgId(ctx),'await_rate_comment');
    await ctx.reply(tr('b1011_write_comment', '⭐'.repeat(+ctx.match[2])), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1011_skip_send'),'rateskip')],[Markup.button.callback(tr('b1011_cancel'),'buyer:bookings')]]).reply_markup });
});
bot.action('rateskip', async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); setStep(tgId(ctx),'idle'); const r = await rpc('bot_rate_store', { p_telegram_id: tgId(ctx), p_barcode: s.temp.rateBarcode, p_score: s.temp.rateScore, p_comment: null }); return afterRate(ctx, r); });
async function afterRate(ctx, r) {
    if (!r?.success) {
        const e=r?.error; const msg = e==='not_completed' ? tr('b1016_rate_only_after_complete') : e==='not_found' ? tr('b1016_booking_not_found') : e==='bad_score' ? tr('b1016_score_range') : e==='not_linked' ? tr('b1016_login_first') : tr('b1016_rate_failed');
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('cm_my_bookings'),'buyer:bookings')]]).reply_markup });
    }
    await ctx.reply(tr('b1019_thanks_rating', '⭐'.repeat(r.score||0)), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1019_my_bookings'),'buyer:bookings')],[Markup.button.callback(tr('b1019_menu'),'menu:back')]]).reply_markup });
}

// ── Task 3 — booking countdown (Telegram messages are static, so we render the
//    remaining HH:MM:SS on demand + a refresh button that recomputes it). ───────
function fmtCountdown(ms){
    let diff = ms - Date.now();
    if (diff <= 0) return null;
    const h = Math.floor(diff/3600000); diff -= h*3600000;
    const mn = Math.floor(diff/60000);
    const sec = Math.floor((diff - mn*60000)/1000);
    return `${String(h).padStart(2,'0')}:${String(mn).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}
function countdownBlock(expiryMs){
    const cd = expiryMs ? fmtCountdown(expiryMs) : null;
    return cd ? tr('q1034_countdown_block', cd) : tr('q1034_booking_expired');
}
// v12.22 — the countdown is LIVE: the button now carries the BARCODE (not the
// timestamp), and every refresh re-reads the booking from the DB. A completed/
// cancelled/expired booking says so and drops the refresh button, so an old
// «تحديث العدّاد» can never keep counting after the booking ended.
// Legacy cd:<ms> buttons (pre-v12.22 messages) are matched by expiry against
// the user's ACTIVE bookings and degrade gracefully when none matches.
// The bookings nav follows the CONTEXT the counter was opened from (v12.24 —
// Nasser: a counter opened from the STORE side must never show «حجوزاتي» and
// flip the merchant into buyer screens):
//   's' → store side: «طلبات متجري» + menu only.
//   'b' → buyer side: «حجوزاتي» + menu (an owner also gets «طلبات متجري»).
function bookingsNavRows(s, roleCtx){
    if (roleCtx === 's') return [
        [Markup.button.callback(tr('menu_store_orders'),'seller:bookings')],
        [Markup.button.callback(tr('b1045_menu'),'menu:back')]
    ];
    const base = [Markup.button.callback(tr('b1045_my_bookings'),'buyer:bookings'), Markup.button.callback(tr('b1045_menu'),'menu:back')];
    return ownsStore(s)
        ? [[Markup.button.callback(tr('menu_store_orders'),'seller:bookings')], base]
        : [base];
}
async function renderCountdown(ctx, barcode, roleCtx){
    const s = getSession(tgId(ctx));
    if (!s.userId) { await ctx.answerCbQuery().catch(()=>{}); return ctx.reply(tr('cm_login_first'), { parse_mode:'MarkdownV2', reply_markup: kbGuest().reply_markup }); }
    const r = await rpc('bot_booking_countdown', { p_telegram_id: tgId(ctx), p_barcode: barcode });
    if (!r?.success) {
        await ctx.answerCbQuery(tr('cd_done_cb')).catch(()=>{});
        return safeReplyMd(ctx, tr('cd_gone', DIV), { reply_markup: Markup.inlineKeyboard(bookingsNavRows(s, roleCtx)).reply_markup });
    }
    // No explicit context (old cd:<bc> buttons) → derive it from the caller's
    // role ON THIS BOOKING as the DB sees it.
    const rc = roleCtx || (r.role === 'seller' ? 's' : 'b');
    const active = r.status==='pending' || r.status==='acknowledged';
    const ms = Number(r.expiry_time) || 0;
    const cd = (active && ms) ? fmtCountdown(ms) : null;
    // v12.25 (طلب ناصر): العدّاد يعرض «الحجز نفسه» مثل مسار التأكيد — رسالة
    // المؤقّت (بلا أزرار) ثم بطاقة الحجز الكاملة بأزرارها، وفيها زر «العدّاد»
    // الذي يعيد نفس الدورة بعدّاد محدّث.
    const head = !active
        ? (r.status==='completed' ? tr('cd_completed', DIV)
           : r.status==='cancelled' ? tr('cd_cancelled', DIV)
           : tr('b1042_booking_expired', DIV))
        : (cd ? tr(rc==='s' ? 'b1041_time_remaining_s' : 'b1041_time_remaining', DIV, cd, md(fmtDate(new Date(ms))))
              : tr('b1042_booking_expired', DIV));
    await ctx.answerCbQuery(cd ? tr('b1039_time_left', cd) : tr('cd_done_cb')).catch(()=>{});
    await safeReplyMd(ctx, head);
    return renderOneBooking(ctx, r.barcode, rc);
}
async function legacyCd(ctx, ms){
    const s = getSession(tgId(ctx));
    let bc = null, rc = null;
    try {
        const mine = await rpc('bot_get_my_bookings', { p_telegram_id: tgId(ctx), p_scope:'current' }) || [];
        let hit = (Array.isArray(mine)?mine:[]).find(b => Number(b.expiry_time) === ms);
        if (hit) rc = 'b';
        if (!hit && ownsStore(s)) {
            const sl = await rpc('bot_get_seller_bookings', { p_telegram_id: tgId(ctx), p_scope:'current' }) || [];
            hit = (Array.isArray(sl)?sl:[]).find(b => Number(b.expiry_time) === ms);
            if (hit) rc = 's';
        }
        if (hit) bc = hit.barcode;
    } catch { /* degrade to the stale-button message below */ }
    if (bc) return renderCountdown(ctx, bc, rc);
    await ctx.answerCbQuery(tr('cd_done_cb')).catch(()=>{});
    return safeReplyMd(ctx, tr('cd_stale_button', DIV), { reply_markup: Markup.inlineKeyboard(bookingsNavRows(s, ownsStore(s)?'s':'b')).reply_markup });
}
// Order matters only for clarity — an epoch-ms payload is 13 digits, a barcode
// is 4–12 alphanumerics, so the two patterns can never both match.
bot.action(/^cd:(\d{13,})$/, ctx => legacyCd(ctx, +ctx.match[1]));
bot.action(/^cd:([A-Za-z0-9]{4,12})$/, ctx => renderCountdown(ctx, ctx.match[1]));
bot.action(/^cds:([A-Za-z0-9]{4,12})$/, ctx => renderCountdown(ctx, ctx.match[1], 's'));

// ── Booking: quantity → confirm → book ────────────────────────────────────────
bot.action('book:qty', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    if (!s.userId) return ctx.reply(tr('b1053_login_via_open'), { parse_mode:'MarkdownV2' });
    if (!s.temp.dealId) return ctx.reply(tr('b1054_session_ended'), { parse_mode:'MarkdownV2' });
    // v12.28 — سقف التاجر للحجز الواحد: نخفي الأزرار الأعلى منه ونظهر السقف
    const cap = Number(s.temp.dealMaxPer) || 0;
    const presets = [1,2,3,5].filter(q => !cap || q <= cap);
    const row2 = [];
    if (!cap || cap >= 10) row2.push(Markup.button.callback('10','bq:10'));
    if (!cap || cap > 1)   row2.push(Markup.button.callback(tr('b1058_other_qty'),'bq:custom'));
    const capHint = cap ? `\n${tr('bk_max_hint', cap)}` : '';
    await ctx.reply(tr('b1055_how_many', md(s.temp.dealName)) + md(capHint), { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            presets.map(q => Markup.button.callback(`${q}`, `bq:${q}`)),
            ...(row2.length ? [row2] : []),
            [Markup.button.callback(tr('b1059_back'), s.temp.dealId ? `deal:${s.temp.dealId}` : 'browse:menu'), Markup.button.callback(tr('b1059_cancel'),'menu:back')]
        ]).reply_markup });
});
bot.action(/^bq:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    const cap = Number(s.temp.dealMaxPer) || 0;
    // زر قديم أو متسابق يتجاوز السقف → نثبّت على السقف بدل الرفض (v12.28)
    s.temp.dealQty = cap ? Math.min(+ctx.match[1], cap) : +ctx.match[1];
    setStep(tgId(ctx),'idle'); await askPrep(ctx, s);
});
bot.action('bq:custom', async ctx => { await ctx.answerCbQuery(); setStep(tgId(ctx),'await_book_qty'); await ctx.reply(tr('b1063_send_qty'), { reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1063_back'),'book:qty')]]).reply_markup }); });

// Step 2 — pickup / prep time (mirrors the website's prep-time field)
async function askPrep(ctx, s) {
    await ctx.reply(tr('b1067_when_pickup', s.temp.dealQty), { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(tr('b1069_on_arrival'),'prep:arrival'), Markup.button.callback(tr('b1069_15_min'),'prep:15')],
            [Markup.button.callback(tr('b1070_30_min'),'prep:30'), Markup.button.callback(tr('b1070_45_min'),'prep:45')],
            [Markup.button.callback(tr('b1071_60_min'),'prep:60'), Markup.button.callback(tr('b1071_other_time'),'prep:custom')],
            [Markup.button.callback(tr('b1072_back'),'book:qty'), Markup.button.callback(tr('b1072_cancel'),'menu:back')]
        ]).reply_markup });
}
bot.action('prep:arrival', async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); s.temp.prepTime='arrival'; await askNote(ctx,s); });
bot.action(/^prep:(\d+)$/, async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); s.temp.prepTime=`${ctx.match[1]}min`; await askNote(ctx,s); });
bot.action('prep:custom', async ctx => { await ctx.answerCbQuery(); setStep(tgId(ctx),'await_prep'); await ctx.reply(tr('b1077_send_prep_mins'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1077_back'),'book:back:prep')]]).reply_markup }); });
// Back-navigation: re-show the prep / note steps preserving the in-progress booking. (Task 1)
bot.action('book:back:prep', async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); setStep(tgId(ctx),'idle'); await askPrep(ctx, s); });
bot.action('book:back:note', async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); setStep(tgId(ctx),'idle'); await askNote(ctx, s); });

// Step 3 — optional note to the seller
async function askNote(ctx, s) {
    setStep(tgId(ctx),'idle');
    await ctx.reply(tr('b1085_note_to_merchant'), { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(tr('b1087_add_note'),'note:add')],
            [Markup.button.callback(tr('b1088_skip_continue'),'note:skip')],
            [Markup.button.callback(tr('b1089_back'),'book:back:prep'), Markup.button.callback(tr('b1089_cancel'),'menu:back')]
        ]).reply_markup });
}
bot.action('note:add', async ctx => { await ctx.answerCbQuery(); setStep(tgId(ctx),'await_note'); await ctx.reply(tr('b1092_write_note'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1092_back'),'book:back:note')]]).reply_markup }); });
bot.action('note:skip', async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); s.temp.notes=null; await bookConfirm(ctx,s); });

// Step 4 — confirm (shows quantity + prep + note + total)
async function bookConfirm(ctx, s) {
    setStep(tgId(ctx),'idle');
    // NOTE: pass p_telegram_id so PostgREST resolves the (text,bigint) overload
    // unambiguously — the bare (text) overload was dropped (v11.74) because the
    // ambiguity made this call fail with "function is not unique" → the booking
    // wrongly reported «انتهى هذا العرض أثناء الحجز». (Task 7 fix.)
    const d = await rpc('bot_get_deal', { p_deal_id: s.temp.dealId, p_telegram_id: tgId(ctx) });
    if (!d) return ctx.reply(tr('b1103_deal_ended'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1103_available_offers'),'browse:menu')]]).reply_markup });
    // ساعات العمل (v11.77): مغلق → امنع الإتمام واعرض وقت الفتح.
    const os = d.open_status;
    if (os && os.configured && !os.open) {
        return safeReplyMd(ctx, tr('b1107_store_closed_now', DIV, os.opens_in_min!=null?tr('b1107_opens_in', md(HRS.fmtMins(os.opens_in_min))):''), { reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1107_browse_offers'),'browse:menu')],[Markup.button.callback(tr('b1107_menu'),'menu:back')]]).reply_markup });
    }
    const total = d.discounted_price * s.temp.dealQty;
    let m = tr('q1110_confirm_booking_head', DIV, md(d.item_name), md(d.shop_name), s.temp.dealQty, md(prepLabel(s.temp.prepTime)));
    if (s.temp.notes) m += tr('b1111_your_note', md(s.temp.notes));
    m += tr('q1112_total_line', money(total), DIV);
    // قرب الإغلاق (<ساعتين) → تحذير واضح قبل الإتمام.
    if (os && os.configured && os.open && os.closes_in_min != null && os.closes_in_min <= HRS.CLOSING_SOON_MIN) {
        m += tr('q1115_closing_soon_warn', md(HRS.fmtMins(os.closes_in_min)), DIV);
    }
    // Task 3 — booking duration + liability disclaimer (verbatim from the website).
    m += tr('q1118_booking_duration_disclaimer', DIV);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(tr('b1120_yes_confirm_booking'),'book:confirm')],
        [Markup.button.callback(tr('b1121_back'),'book:back:note'), Markup.button.callback(tr('b1121_cancel'),'menu:back')]
    ]).reply_markup });
}
bot.action('book:confirm', async ctx => {
    await ctx.answerCbQuery(tr('b1125_booking_in_progress'));
    const s = getSession(tgId(ctx));
    if (!s.temp.dealId) return ctx.reply(tr('b1127_session_ended'), { parse_mode:'MarkdownV2' });
    const result = await rpc('bot_book_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.dealId, p_quantity: s.temp.dealQty||1, p_notes: s.temp.notes||null, p_prep_time: s.temp.prepTime||'arrival' });
    const bc = result?.barcode;
    s.temp.dealId = null; s.temp.dealQty = 1; s.temp.prepTime = null; s.temp.notes = null;
    if (!result?.success) {
        const e = result?.error;
        const m = e==='deal_inactive'   ? tr('b1133_deal_inactive')
                : e==='deal_not_found'  ? tr('b1134_deal_not_found')
                : e==='shop_closed'     ? tr('b1135_shop_closed', result.opens_in_min!=null?tr('b1135_opens_in', md(HRS.fmtMins(result.opens_in_min))):'')
                : e==='no_quantity'     ? tr('b1136_no_quantity', result.available??0)
                : e==='max_qty'         ? tr('bk_err_max_qty', result.limit??1)
                : e==='rebook_limit'    ? tr('bk_err_rebook_limit', result.limit??1)
                : e==='rebook_wait'     ? tr('bk_err_rebook_wait', md(HRS.fmtMins(result.wait_minutes??1)))
                : e==='not_linked'      ? tr('b1137_login_first')
                : e==='suspended'       ? tr('b1138_account_suspended')
                : tr('b1139_booking_failed');
        return safeReplyMd(ctx, m, { reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1140_browse_deals'),'browse:menu')],[Markup.button.callback(tr('b1140_menu'),'menu:back')]]).reply_markup });
    }
    // Mark this barcode so the outbox skips the duplicate "confirmed" alert below.
    if (bc) botBookedBarcodes.add(bc);
    const expiryMs = result.expiry_at ? new Date(result.expiry_at).getTime() : 0;
    const expiry = expiryMs ? fmtDate(new Date(expiryMs)) : '—';
    await ctx.reply(
        tr('q1147_booking_success', DIV, md(result.deal_name), md(result.shop_name), result.quantity, md(prepLabel(result.prep_time)), md(bc), md(expiry), countdownBlock(expiryMs)),
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(tr('b1149_chat_merchant'),`chat:${bc}`), Markup.button.callback(tr('b1149_call_merchant'),`call:b:${bc}`)],
            ...(expiryMs && bc ? [[Markup.button.callback(tr('b1150_countdown'),`cd:${bc}`)]] : []),
            ...(result.store_id ? [[Markup.button.callback(tr('b1151_store_page'),`store:${result.store_id}`)]] : []),
            // إلغاء الحجز مباشرةً من كرت التأكيد (كان ناقصاً — المشتري ما يقدر يلغي إلا من قائمة الحجوزات). v12.07
            ...(bc ? [[Markup.button.callback(tr('b1205_cancel_booking'),`cancel:${bc}`)]] : []),
            // مالك المتجر (بائع أو أدمن-مالك) يحصل أيضاً على «طلبات متجري» — بدون هذا
            // الصف كان يُرمى في مسار المشتري فقط بعد الحجز (تداخل الأدوار). v12.22
            ...(ownsStore(s) ? [[Markup.button.callback(tr('menu_store_orders'),'seller:bookings')]] : []),
            [Markup.button.callback(tr('b1152_my_bookings'),'buyer:bookings'), Markup.button.callback(tr('b1152_deals'),'deals:0')],
            [Markup.button.callback(tr('b1153_menu'),'menu:back')]
        ]).reply_markup });
});

// ── Buyer: my bookings (split: current vs previous) ───────────────────────────
bot.command('bookings', ctx => buyerBookingsMenu(ctx));
bot.action('buyer:bookings', async ctx => { await ctx.answerCbQuery(); buyerBookingsMenu(ctx); });
bot.action('buyer:bk:current',  async ctx => { await ctx.answerCbQuery(); showBuyerBookings(ctx, 'current'); });
bot.action('buyer:bk:previous', async ctx => { await ctx.answerCbQuery(); showBuyerBookings(ctx, 'previous'); });
async function buyerBookingsMenu(ctx) {
    const s = getSession(tgId(ctx));
    if (!s.userId) return ctx.reply(tr('cm_login_first'), { parse_mode:'MarkdownV2', reply_markup: kbGuest().reply_markup });
    // مالك المتجر يرى عنواناً موضحاً «كمشتري» + زر «طلبات متجري» — حتى لا يظن أن
    // حجوزاته الشخصية الفارغة تعني ضياع طلبات متجره (تداخل الأدوار). v12.22
    const owner = ownsStore(s);
    await ctx.reply(tr(owner ? 'b1165_my_bookings_title_owner' : 'b1165_my_bookings_title', DIV), { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(tr('b1167_current'),'buyer:bk:current'), Markup.button.callback(tr('b1167_previous'),'buyer:bk:previous')],
            ...(owner ? [[Markup.button.callback(tr('menu_store_orders'),'seller:bookings')]] : []),
            [Markup.button.callback(tr('cm_menu'),'menu:back')]
        ]).reply_markup });
}
// scope: 'current' (قيد الانتظار/مؤكد) | 'previous' (مكتمل/ملغي/منتهٍ)
async function showBuyerBookings(ctx, scope='current') {
    const s = getSession(tgId(ctx));
    if (!s.userId) return ctx.reply(tr('b1174_login_first'), { parse_mode:'MarkdownV2', reply_markup: kbGuest().reply_markup });
    const list = await rpc('bot_get_my_bookings', { p_telegram_id: tgId(ctx), p_scope: scope });
    if (!list?.length) {
        const empty = scope==='previous' ? tr('b1177_no_previous_bookings') : tr('b1177_no_current_bookings');
        return ctx.reply(empty, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(tr('b1178_browse_deals'),'deals:0')],
            // مالك المتجر: القائمة الفارغة هنا تعني «ما حجزت كمشتري» — طلبات متجره في مكانها. v12.22
            ...(ownsStore(s) ? [[Markup.button.callback(tr('menu_store_orders'),'seller:bookings')]] : []),
            [Markup.button.callback(tr('b1178_back'),'buyer:bookings')]
        ]).reply_markup });
    }
    const title = scope==='previous' ? tr('q1180_my_previous_bookings') : tr('q1180_my_current_bookings');
    const shown = list.slice(0, 10);
    const more  = list.length - shown.length;
    // Cache current values so each edit prompt can show the OLD value first. v11.70
    s.temp.bkCache = s.temp.bkCache || {};
    for (const x of list) s.temp.bkCache[x.barcode] = { quantity:x.quantity, prep_time:x.prep_time, notes:x.notes, deal_name:x.deal_name };
    // Header, then ONE self-contained card per booking (buttons attached to it) —
    // so it's always clear which «محادثة/تعديل/قيّم» belongs to which booking. v11.70
    await ctx.reply(`${title} \\(${list.length}${more>0?tr('w1186_latest_n', shown.length):''}\\)\n${DIV}\n${tr('w1186_each_booking_own_card')}`, { parse_mode:'MarkdownV2' });
    for (let i=0;i<shown.length;i++){
        const b = shown[i];
        const active = b.status==='pending'||b.status==='acknowledged';
        let m = `*${i+1}\\.* 🛍 *${md(b.deal_name)}*\n🏪 ${md(b.shop_name)}\n📋 \`${md(b.barcode)}\`\n📦 ${tr('w1190_quantity')}: *${b.quantity}*  •  ⏱ ${md(prepLabel(b.prep_time))}\n${statusLabel(b.status)}  •  📅 ${md(fmtDay(b.booked_at))}`;
        if (active && b.expiry_time) m += `\n⏰ *${tr('w1191_booking_expires')}:* ${md(fmtDate(b.expiry_time))}\n${countdownBlock(Number(b.expiry_time))}`;
        if (b.notes) m += `\n📝 _${md(b.notes)}_`;
        const chatLabel = b.unread>0 ? tr('cm_chat_n', b.unread) : tr('cm_chat');
        const row = [Markup.button.callback(chatLabel, `chat:${b.barcode}`), Markup.button.callback(tr('cm_call'), `call:b:${b.barcode}`)];
        if (b.status==='pending')   row.push(Markup.button.callback(tr('b1197_edit'), `edit:${b.barcode}`));
        if (b.status==='completed') row.push(Markup.button.callback(tr('b1198_rate'), `rate:${b.barcode}`));
        const rows = [row];
        const row2 = [];
        if (active && b.expiry_time) row2.push(Markup.button.callback(tr('cm_countdown'), `cd:${b.barcode}`));
        if (b.store_id) row2.push(Markup.button.callback(tr('b1202_store'), `store:${b.store_id}`));
        if (row2.length) rows.push(row2);
        const row3 = [];
        if (active) row3.push(Markup.button.callback(tr('b1205_cancel_booking'), `cancel:${b.barcode}`));
        if (b.store_id) row3.push(Markup.button.callback(tr('b1206_report'), `rep:${b.store_id}`));
        if (row3.length) rows.push(row3);
        await safeReplyMd(ctx, m, { reply_markup: Markup.inlineKeyboard(rows).reply_markup });
    }
    // safeReplyMd so a single odd card can never abort before this footer — it
    // carries the «رجوع» button, which was vanishing when >10 bookings made the
    // footer text fail to parse (unescaped '.'). v11.77
    await safeReplyMd(ctx, `${DIV}${more>0?tr('b1213_older_hidden', numEsc(more)):''}`, { reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1213_refresh'),`buyer:bk:${scope}`), Markup.button.callback(tr('b1213_back'),'buyer:bookings')]]).reply_markup });
}
bot.action(/^cancel:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const bc = ctx.match[1];
    await ctx.reply(tr('b1218_confirm_cancel', md(bc)), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1218_yes_cancel'),'doCancel:'+bc)],[Markup.button.callback(tr('b1218_no'),'buyer:bookings')]]).reply_markup });
});
bot.action(/^doCancel:(.+)$/, async ctx => {
    await ctx.answerCbQuery(tr('b1221_cancelling'));
    const result = await rpc('bot_cancel_booking', { p_telegram_id: tgId(ctx), p_barcode: ctx.match[1] });
    if (result?.success) await ctx.reply(tr('b1223_booking_cancelled'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1223_my_bookings'),'buyer:bookings')],[Markup.button.callback(tr('b1223_menu'),'menu:back')]]).reply_markup });
    else { const m = result?.error==='cannot_cancel' ? tr('b1224_cannot_cancel') : tr('b1224_cancel_failed'); await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup }); }
});
// Seller-side cancel — same RPC (now authorizes the store owner), but the
// confirm «no» and the success screen route back to SELLER bookings, not the
// buyer list. v12.07
bot.action(/^scancel:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const bc = ctx.match[1];
    await ctx.reply(tr('b1218_confirm_cancel', md(bc)), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1218_yes_cancel'),'sdoCancel:'+bc)],[Markup.button.callback(tr('b1218_no'),'seller:bookings')]]).reply_markup });
});
bot.action(/^sdoCancel:(.+)$/, async ctx => {
    await ctx.answerCbQuery(tr('b1221_cancelling'));
    const result = await rpc('bot_cancel_booking', { p_telegram_id: tgId(ctx), p_barcode: ctx.match[1] });
    if (result?.success) await ctx.reply(tr('b1223_booking_cancelled'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('menu_seller_bookings'),'seller:bookings')],[Markup.button.callback(tr('b1223_menu'),'menu:back')]]).reply_markup });
    else { const m = result?.error==='cannot_cancel' ? tr('b1224_cannot_cancel') : tr('b1224_cancel_failed'); await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup }); }
});

// ── Task 1 — single-booking view (chat «back» lands here, then «back» → list) ──
bot.action(/^bkOne:(.+)$/, async ctx => { await ctx.answerCbQuery(); await renderOneBooking(ctx, ctx.match[1]); });
async function renderOneBooking(ctx, barcode, roleCtx){
    const s = getSession(tgId(ctx));
    if (!s.userId) return ctx.reply(tr('b1231_login_first'), { parse_mode:'MarkdownV2', reply_markup: kbGuest().reply_markup });
    const bc = String(barcode).toUpperCase();
    // A store-owner (incl. an admin who owns a store) is the SELLER on their store's
    // booking — search the store list first, then fall back to the buyer list, so a
    // booking is always found. Was: user_type==='seller' only, which made the admin-
    // owner query the BUYER list (empty) → «لم نعد نجد هذا الحجز» on chat «back». v11.81
    // roleCtx (v12.25): the countdown buttons carry the side they were opened from
    // ('s' store / 'b' buyer) — when the owner books from his OWN store both lists
    // contain the barcode, so the search order must follow the context, not ownsStore.
    let b = null, seller = false;
    const trySeller = async () => {
        if (!ownsStore(s)) return false;
        const sl = await rpc('bot_get_seller_bookings', { p_telegram_id: tgId(ctx), p_scope:'all' }) || [];
        const f = (Array.isArray(sl)?sl:[]).find(x => String(x.barcode).toUpperCase()===bc);
        if (f) { b = f; seller = true; }
        return !!f;
    };
    const tryBuyer = async () => {
        const bl = await rpc('bot_get_my_bookings', { p_telegram_id: tgId(ctx), p_scope:'all' }) || [];
        const f = (Array.isArray(bl)?bl:[]).find(x => String(x.barcode).toUpperCase()===bc);
        if (f) { b = f; seller = false; }
        return !!f;
    };
    if (roleCtx === 'b') { if (!(await tryBuyer())) await trySeller(); }
    else { if (!(await trySeller())) await tryBuyer(); }
    const listCb = seller?'seller:bookings':'buyer:bookings';
    if (!b) return ctx.reply(tr('b1248_booking_not_found'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1248_bookings'), listCb)]]).reply_markup });
    const active = b.status==='pending'||b.status==='acknowledged';
    let m = `🎟 *${tr('w1248_booking_details')}* \`${md(b.barcode)}\`\n${DIV}\n🛍 *${md(b.deal_name)}*\n` +
        (seller ? `👤 ${md(b.user_name)}  •  📞 ${md(b.user_phone)}\n` : `🏪 ${md(b.shop_name)}\n`) +
        `📦 ${tr('w1250_quantity')}: *${b.quantity}*  •  ⏱ ${md(prepLabel(b.prep_time))}\n${statusLabel(b.status)}  •  📅 ${md(fmtDate(b.booked_at))}`;
    if (active && b.expiry_time) m += `\n⏰ *${tr('w1251_booking_expires')}:* ${md(fmtDate(b.expiry_time))}\n${countdownBlock(Number(b.expiry_time))}`;
    if (b.notes) m += `\n📝 _${md(b.notes)}_`;
    const rows = [[Markup.button.callback(b.unread>0?tr('cm_chat_n', b.unread):tr('cm_chat'), `chat:${b.barcode}`), Markup.button.callback(tr('cm_call'), `call:b:${b.barcode}`)]];
    if (seller){
        if (b.status==='pending') rows.push([Markup.button.callback(tr('b1257_confirm_start_prep'),`ack:${b.barcode}`)]);
        if (active) rows.push([Markup.button.callback(tr('b1258_complete_booking'),`complete:${b.barcode}`)]);
        // العدّاد والإلغاء كانا في بطاقة القائمة فقط — بطاقة الحجز المفردة (تظهر بعد
        // «تأكيد الطلب») تحتاجهما ليكتمل صف الخطوة التالية للتاجر. v12.24
        const sr = [];
        if (active && b.expiry_time) sr.push(Markup.button.callback(tr('cm_countdown'), `cds:${b.barcode}`));
        if (active) sr.push(Markup.button.callback(tr('b1205_cancel_booking'), `scancel:${b.barcode}`));
        if (sr.length) rows.push(sr);
    } else {
        const r2=[]; if (b.status==='pending') r2.push(Markup.button.callback(tr('b1260_edit'),`edit:${b.barcode}`)); if (b.status==='completed') r2.push(Markup.button.callback(tr('b1260_rate'),`rate:${b.barcode}`)); if (active && b.expiry_time) r2.push(Markup.button.callback(tr('b1260_counter'),`cd:${b.barcode}`)); if (r2.length) rows.push(r2);
        const r3=[]; if (active) r3.push(Markup.button.callback(tr('b1261_cancel'),`cancel:${b.barcode}`)); if (b.store_id){ r3.push(Markup.button.callback(tr('b1261_store'),`store:${b.store_id}`)); r3.push(Markup.button.callback(tr('b1261_report'),`rep:${b.store_id}`)); } if (r3.length) rows.push(r3);
    }
    rows.push([Markup.button.callback(tr('b1263_back_to_bookings'), listCb)]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
}

// ── Booking chat (buyer ↔ seller, 3 messages each side) ───────────────────────
bot.action(/^chat:(.+)$/, async ctx => { await ctx.answerCbQuery(); await renderChat(ctx, ctx.match[1]); });
async function renderChat(ctx, barcode) {
    const r = await rpc('bot_booking_chat', { p_telegram_id: tgId(ctx), p_barcode: barcode });
    if (!r?.success) {
        const e=r?.error; const msg = e==='not_authorized' ? tr('b1272_not_authorized') : e==='not_found' ? tr('b1272_booking_not_found') : e==='not_linked' ? tr('b1272_login_first') : tr('b1272_chat_open_failed');
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
    let m = `💬 *${tr('w1273_booking_chat')}* \`${md(r.barcode)}\`\n🛍 ${md(r.deal_name)} • ${statusLabel(r.status)}\n👤 ${tr('w1273_with')}: *${md(r.other_name)}*\n${DIV}\n\n`;
    const msgs = r.messages || [];
    if (!msgs.length) m += tr('w1275_no_messages_yet') + '\n';
    else for (const x of msgs) {
        const who = x.mine ? tr('q1279_you') : `👤 ${md(r.other_name)}`;
        m += `${who} _\\(${md(fmtTime(x.at))}\\)_\n${md(x.body)}\n\n`;
    }
    m += `${DIV}\n✍️ ${tr('w1280_your_messages')}: *${r.my_count}/3*`;
    const btns = [];
    // حجز منتهٍ (مكتمل/ملغي/منتهي المهلة) = محادثة للقراءة فقط — يطابق حارس
    // bot_send_booking_message في قاعدة البيانات (v12.22).
    const finished = ['cancelled','completed','expired'].includes(r.status);
    const canSend = !finished && r.my_count < 3;
    if (canSend) btns.push([Markup.button.callback(tr('b1285_write_message'), `chatmsg:${r.barcode}`)]);
    else if (finished) m += `\n${tr('w_chat_finished')}`;
    else m += `\n${tr('w1284_message_limit_reached')}`;
    // Task 1 — «back» returns to the booking itself; from there «back» → the list.
    btns.push([Markup.button.callback(tr('b1288_refresh'), `chat:${r.barcode}`), Markup.button.callback(tr('b1288_call'), `call:b:${r.barcode}`)]);
    btns.push([Markup.button.callback(tr('b1289_back_to_booking'), `bkOne:${r.barcode}`)]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup });
}
bot.action(/^chatmsg:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    s.temp.chatBarcode = ctx.match[1];
    setStep(tgId(ctx),'await_chat_msg');
    await ctx.reply(tr('b1297_write_your_message'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1297_cancel'),`chat:${ctx.match[1]}`)]]).reply_markup });
});

// ── Edit a pending booking (quantity / prep-time / note) ──────────────────────
// Current values are read from the session cache (populated by showBuyerBookings)
// so every prompt shows the OLD value first — the buyer may want to keep it. v11.70
function bkVal(ctx, barcode) { const s = getSession(tgId(ctx)); return (s.temp.bkCache || {})[barcode] || null; }
bot.action(/^edit:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const bc = ctx.match[1];
    getSession(tgId(ctx)).temp.editBarcode = bc;
    const v = bkVal(ctx, bc);
    const cur = v ? `\n${DIV}\n🛍 *${md(v.deal_name||'')}*\n🔢 ${tr('w1307_quantity')}: *${md(String(v.quantity??'—'))}*  •  ⏱ ${md(prepLabel(v.prep_time))}${v.notes?`\n📝 _${md(v.notes)}_`:''}` : '';
    await ctx.reply(tr('b1310_edit_booking', md(bc), cur, DIV), { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(tr('b1312_quantity'),`editqty:${bc}`), Markup.button.callback(tr('b1312_pickup_time'),`editprep:${bc}`)],
            [Markup.button.callback(tr('b1313_note'),`editnote:${bc}`)],
            [Markup.button.callback(tr('b1314_back'),'buyer:bookings')]
        ]).reply_markup });
});
bot.action(/^editqty:(.+)$/, async ctx => { await ctx.answerCbQuery(); const bc=ctx.match[1]; const s=getSession(tgId(ctx)); s.temp.editBarcode=bc; const v=bkVal(ctx,bc); setStep(tgId(ctx),'await_edit_qty'); await ctx.reply(tr('b1317_current_quantity', md(String(v?.quantity??'—')), DIV), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1317_cancel'),`edit:${bc}`)]]).reply_markup }); });
bot.action(/^editnote:(.+)$/, async ctx => { await ctx.answerCbQuery(); const bc=ctx.match[1]; const s=getSession(tgId(ctx)); s.temp.editBarcode=bc; const v=bkVal(ctx,bc); setStep(tgId(ctx),'await_edit_note'); await ctx.reply(tr('b1318_current_note', md(v?.notes||tr('b1318_none')), DIV), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1318_cancel'),`edit:${bc}`)]]).reply_markup }); });
bot.action(/^editprep:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const bc = ctx.match[1];
    const v = bkVal(ctx, bc);
    await ctx.reply(tr('b1323_current_pickup_time', md(prepLabel(v?.prep_time)), DIV), { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(tr('b1325_on_arrival'),`eprep:${bc}:arrival`), Markup.button.callback(tr('b1325_15min'),`eprep:${bc}:15`)],
            [Markup.button.callback(tr('b1326_30min'),`eprep:${bc}:30`), Markup.button.callback(tr('b1326_45min'),`eprep:${bc}:45`), Markup.button.callback(tr('b1326_60min'),`eprep:${bc}:60`)],
            [Markup.button.callback(tr('b1327_back'),`edit:${bc}`)]
        ]).reply_markup });
});
bot.action(/^eprep:(.+):(arrival|\d+)$/, async ctx => {
    await ctx.answerCbQuery(tr('b1331_saving'));
    const pv = ctx.match[2]==='arrival' ? 'arrival' : `${ctx.match[2]}min`;
    const r = await rpc('bot_update_booking', { p_telegram_id: tgId(ctx), p_barcode: ctx.match[1], p_prep_time: pv });
    return afterEdit(ctx, r);
});
async function afterEdit(ctx, r) {
    if (!r?.success) {
        const e=r?.error; const msg = e==='not_editable' ? tr('b1338_not_editable') : e==='no_quantity' ? tr('b1338_only_available', r.available??0) : e==='max_qty' ? tr('bk_err_max_qty', r.limit??1) : e==='not_found' ? tr('b1338_booking_not_found') : tr('b1338_edit_failed');
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('cm_my_bookings'),'buyer:bookings')]]).reply_markup });
    }
    await ctx.reply(tr('cm_booking_edited'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1019_my_bookings'),'buyer:bookings')],[Markup.button.callback(tr('b1019_menu'),'menu:back')]]).reply_markup });
}
// ═══════════════════════════════════════════════════════════════════════════════
//  Alerts hub — keyword alerts + SMART alerts builder (Task 13) + Telegram on/off
//  Smart rules are written to users.smart_alerts (identical shape to the website),
//  so the same handle_deal_smart_notifications trigger matches new deals and the
//  outbox fans the alert out to the bot. One source of truth → bot = web = app.
// ═══════════════════════════════════════════════════════════════════════════════
bot.command('alerts', ctx => showAlerts(ctx));
bot.action('buyer:notif', async ctx => { await ctx.answerCbQuery(); showAlerts(ctx); });
bot.action('alerts:open',  async ctx => { await ctx.answerCbQuery(); showAlerts(ctx); });
async function showAlerts(ctx) {
    const s = getSession(tgId(ctx));
    if (!s.userId) return ctx.reply(tr('b1354_login_first'), { parse_mode:'MarkdownV2', reply_markup: kbGuest().reply_markup });
    // التنبيهات الذكية للمتسوّقين فقط (تطابق الموقع — صفحة «حسابي» للمشتري). التاجر
    // تصله إشعارات الحجوزات تلقائياً ولا يحتاج تنبيهات عروض. v11.76
    if (s.userType === 'seller') return safeReplyMd(ctx, tr('b1357_smart_alerts_shoppers', DIV), { reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1357_bookings'),'seller:bookings')],[Markup.button.callback(tr('b1357_back_to_menu'),'menu:back')]]).reply_markup });
    const a = await rpc('bot_get_alerts', { p_telegram_id: tgId(ctx) });
    if (!a?.success) return ctx.reply(tr('b1359_alerts_load_failed'), { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    const kn = Array.isArray(a.keywords) ? a.keywords.length : 0;
    const sn = a.smart_count || 0;
    const m = tr('b1362_my_smart_alerts', DIV, (a.notify_via_telegram ? tr('b1362_enabled') : tr('b1362_disabled')), numEsc(kn), numEsc(sn));
    const btns = [
        [Markup.button.callback(tr('b1364_new_smart_alert'),'smart:new')],
        [Markup.button.callback(tr('b1365_my_smart_alerts', sn),'smart:list'), Markup.button.callback(tr('b1365_my_keywords', kn),'alerts:kw')],
        [Markup.button.callback(a.notify_via_telegram ? tr('b1366_disable_tg_alerts') : tr('b1366_enable_tg_alerts'), `alerts:toggle:${a.notify_via_telegram?'0':'1'}`)],
        [Markup.button.callback(tr('b1367_back'),'menu:back')],
    ];
    // safeReplyMd: لو بقي محرف MarkdownV2 غير مهرَّب يُعرض النص عادياً بدل أن تختفي الشاشة. v11.92
    await safeReplyMd(ctx, m, { reply_markup: Markup.inlineKeyboard(btns).reply_markup });
}
// ── Keyword alerts (each in its own box, like the website) ────────────────────
bot.action('alerts:kw', async ctx => { await ctx.answerCbQuery(); showKeywords(ctx); });
async function showKeywords(ctx){
    const a = await rpc('bot_get_alerts', { p_telegram_id: tgId(ctx) });
    const kws = (a && Array.isArray(a.keywords)) ? a.keywords : [];
    const m = tr('b1376_my_keywords_header', numEsc(kws.length), DIV) + (kws.length ? tr('b1376_kw_have') : tr('b1376_kw_none'));
    const btns = [];
    kws.forEach((k,i) => btns.push([Markup.button.callback(`🗑  ${String(k).slice(0,30)}`, `alerts:rm:${i}`)]));
    btns.push([Markup.button.callback(tr('b1379_add_keyword'),'alerts:add')]);
    btns.push([Markup.button.callback(tr('b1380_back'),'alerts:open')]);
    await safeReplyMd(ctx, m, { reply_markup: Markup.inlineKeyboard(btns).reply_markup });
}
bot.action('alerts:add', async ctx => {
    await ctx.answerCbQuery();
    if (!getSession(tgId(ctx)).userId) return;
    setStep(tgId(ctx),'await_alert_kw');
    await ctx.reply(tr('b1387_type_keyword'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1387_cancel'),'alerts:kw')]]).reply_markup });
});
bot.action(/^alerts:rm:(\d+)$/, async ctx => {
    await ctx.answerCbQuery(tr('cm_deleting'));
    await rpc('bot_remove_notif_keyword', { p_telegram_id: tgId(ctx), p_index: +ctx.match[1] });
    return showKeywords(ctx);
});
bot.action(/^alerts:toggle:([01])$/, async ctx => {
    await ctx.answerCbQuery(ctx.match[1]==='1' ? tr('q1395_alerts_enabled') : tr('q1395_alerts_disabled'));
    await rpc('bot_set_telegram_notif', { p_telegram_id: tgId(ctx), p_enabled: ctx.match[1]==='1' });
    return showAlerts(ctx);
});

// ── Smart alerts: list (each rule in its own box) + delete ────────────────────
function describeRule(rule, n){
    const parts = [];
    const cats = Array.isArray(rule.categories) ? rule.categories : [];
    if (cats.length) parts.push(tr('q1404_categories_line', cats.map(c=>md(catLabel(c))).join(tr('cm_sep'))));
    const L = rule.labels || {};
    const lbl = (a, ids) => (Array.isArray(a) && a.length ? a : ids);   // empty labels[] → fall back to ids
    if (Array.isArray(rule.regions) && rule.regions.length) parts.push(tr('q1407_regions_line', lbl(L.regions,rule.regions).map(md).join(tr('cm_sep'))));
    if (Array.isArray(rule.cities)  && rule.cities.length)  parts.push(tr('q1408_cities_line', lbl(L.cities,rule.cities).map(md).join(tr('cm_sep'))));
    if (Array.isArray(rule.malls)   && rule.malls.length)   parts.push(tr('q1409_malls_line', lbl(L.malls,[tr('cm_location')]).map(md).join(tr('cm_sep'))));
    if (Array.isArray(rule.keywords)&& rule.keywords.length)parts.push(tr('q1410_keywords_line', rule.keywords.map(md).join(tr('cm_sep'))));
    // عند وجود موقع للتنبيه: أظهر النطاق + رابطاً لقوقل ماب يفتح موقع التنبيه نفسه (طلب ناصر). v11.94
    if (rule.coords && rule.coords.lat!=null && rule.coords.lng!=null) {
        const g = `https://www.google.com/maps/search/?api=1&query=${rule.coords.lat},${rule.coords.lng}`;
        parts.push(tr('q1411_within_km_link', numEsc(rule.radiusKm||0), g));
    }
    return tr('q1412_alert_box', numEsc(n), (parts.length ? parts.join('\n') : '—'));
}
bot.action('smart:list', async ctx => { await ctx.answerCbQuery(); showSmartAlerts(ctx); });
async function showSmartAlerts(ctx){
    const r = await rpc('bot_get_smart_alerts', { p_telegram_id: tgId(ctx) });
    if (!r?.success) return ctx.reply(tr('b1417_smart_load_failed'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1417_back'),'alerts:open')]]).reply_markup });
    const alerts = Array.isArray(r.alerts) ? r.alerts : [];
    if (!alerts.length) return safeReplyMd(ctx, tr('b1419_no_smart_alerts', DIV), { reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1419_new_smart_alert'),'smart:new')],[Markup.button.callback(tr('b1419_back'),'alerts:open')]]).reply_markup });
    await safeReplyMd(ctx, tr('b1420_smart_alerts_header', numEsc(alerts.length), DIV));
    for (let i=0;i<alerts.length;i++){
        await safeReplyMd(ctx, describeRule(alerts[i], i+1), { reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1422_delete_this_alert'),`smart:rm:${i}`)]]).reply_markup });
    }
    await safeReplyMd(ctx, `${DIV}`, { reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1424_new_smart_alert'),'smart:new')],[Markup.button.callback(tr('b1424_back'),'alerts:open')]]).reply_markup });
}
bot.action(/^smart:rm:(\d+)$/, async ctx => {
    await ctx.answerCbQuery(tr('cm_deleting'));
    await rpc('bot_remove_smart_alert', { p_telegram_id: tgId(ctx), p_index: +ctx.match[1] });
    return showSmartAlerts(ctx);
});

// ── Smart alert BUILDER — combine category + region/city/mall + my-location +
//    radius + keywords into ONE rule (Task 13), then save. Multiple criteria = a
//    deal must satisfy them ALL (mirrors the website's conjunctive rule). ────────
function newDraft(){ return { categories:[], regions:[], cities:[], malls:[], keywords:[], coords:null, radiusKm:null, labels:{ regions:[], cities:[], malls:[] } }; }
function draftHas(d){ return d.categories.length||d.regions.length||d.cities.length||d.malls.length||d.keywords.length||(d.coords&&d.radiusKm); }
function draftSummary(d){
    const parts=[];
    if(d.categories.length) parts.push(`🏷 ${d.categories.map(c=>md(catLabel(c))).join(tr('cm_sep'))}`);
    if(d.labels.regions.length) parts.push(`🗺 ${d.labels.regions.map(md).join(tr('cm_sep'))}`);
    if(d.labels.cities.length) parts.push(`🏙 ${d.labels.cities.map(md).join(tr('cm_sep'))}`);
    if(d.labels.malls.length) parts.push(`🏬 ${d.labels.malls.map(md).join(tr('cm_sep'))}`);
    if(d.keywords.length) parts.push(`🔤 ${d.keywords.map(md).join(tr('cm_sep'))}`);
    if(d.coords && d.radiusKm) parts.push(tr('q1444_within_km_of_you', numEsc(d.radiusKm)));
    return parts.length ? parts.join('\n') : tr('q1445_no_criteria_yet');
}
bot.action('smart:new',     async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); if(!s.userId || s.userType==='seller') return showAlerts(ctx); s.temp.alertDraft=newDraft(); showSmartBuilder(ctx); });
bot.action('smart:builder', async ctx => { await ctx.answerCbQuery(); showSmartBuilder(ctx); });
bot.action('smart:clear',   async ctx => { await ctx.answerCbQuery(tr('cm_criteria_cleared')); getSession(tgId(ctx)).temp.alertDraft=newDraft(); showSmartBuilder(ctx); });
async function showSmartBuilder(ctx){
    const s=getSession(tgId(ctx)); const d=s.temp.alertDraft||(s.temp.alertDraft=newDraft());
    setStep(tgId(ctx),'idle');
    const m = tr('b1453_smart_builder', DIV, draftSummary(d));
    const rows=[
        [Markup.button.callback(tr('b1455_category'),'sa:add:cat'), Markup.button.callback(tr('b1455_region'),'sa:add:rg')],
        [Markup.button.callback(tr('b1456_city'),'sa:add:ct'), Markup.button.callback(tr('b1456_mall_market'),'sa:add:ml')],
        [Markup.button.callback(tr('b1457_my_location_radius'),'sa:add:loc'), Markup.button.callback(tr('b1457_keyword'),'sa:add:kw')],
    ];
    if(draftHas(d)) rows.push([Markup.button.callback(tr('b1459_save_alert'),'smart:save'), Markup.button.callback(tr('b1459_clear'),'smart:clear')]);
    rows.push([Markup.button.callback(tr('b1460_back'),'alerts:open')]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
}
// category
bot.action('sa:add:cat', async ctx => {
    await ctx.answerCbQuery();
    const ids = Object.keys(CAT).filter(k=>k!=='all');
    const rows=[]; for(let i=0;i<ids.length;i+=2) rows.push(ids.slice(i,i+2).map(id=>Markup.button.callback(catLabel(id),`sa:cat:${id}`)));
    rows.push([Markup.button.callback(tr('b1468_back'),'smart:builder')]);
    await ctx.reply(tr('b1469_choose_category'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
});
bot.action(/^sa:cat:([A-Za-z_]+)$/, async ctx => {
    await ctx.answerCbQuery(tr('cm_added_m'));
    const s=getSession(tgId(ctx)); const d=s.temp.alertDraft||(s.temp.alertDraft=newDraft());
    if(!d.categories.includes(ctx.match[1])) d.categories.push(ctx.match[1]);
    return showSmartBuilder(ctx);
});
// region
bot.action('sa:add:rg', async ctx => {
    await ctx.answerCbQuery();
    const regions = await rpc('bot_geo_regions',{})||[];
    const s=getSession(tgId(ctx)); s.temp.saRegions=regions;
    if(!regions.length) return ctx.reply(tr('b1482_regions_load_failed'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([[Markup.button.callback(tr('b1482_back'),'smart:builder')]]).reply_markup});
    const rows=[]; for(let i=0;i<regions.length;i+=2) rows.push(regions.slice(i,i+2).map(r=>Markup.button.callback(geoLabel(r),`sa:rg:${r.id}`)));
    rows.push([Markup.button.callback(tr('b1484_back'),'smart:builder')]);
    await ctx.reply(tr('b1485_choose_region'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard(rows).reply_markup});
});
bot.action(/^sa:rg:([A-Za-z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery(tr('cm_added_f'));
    const s=getSession(tgId(ctx)); const d=s.temp.alertDraft||(s.temp.alertDraft=newDraft());
    const reg=(s.temp.saRegions||[]).find(r=>r.id===ctx.match[1]);
    if(!d.regions.includes(ctx.match[1])){ d.regions.push(ctx.match[1]); d.labels.regions.push(reg?geoLabel(reg):ctx.match[1]); }
    return showSmartBuilder(ctx);
});
// city (region → city)
bot.action('sa:add:ct', async ctx => {
    await ctx.answerCbQuery();
    const regions = await rpc('bot_geo_regions',{})||[];
    const s=getSession(tgId(ctx)); s.temp.saRegions=regions;
    if(!regions.length) return ctx.reply(tr('b1499_regions_load_failed'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([[Markup.button.callback(tr('b1499_back'),'smart:builder')]]).reply_markup});
    const rows=[]; for(let i=0;i<regions.length;i+=2) rows.push(regions.slice(i,i+2).map(r=>Markup.button.callback(geoLabel(r),`sac:rg:${r.id}`)));
    rows.push([Markup.button.callback(tr('b1501_back'),'smart:builder')]);
    await ctx.reply(tr('b1502_choose_region_first'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard(rows).reply_markup});
});
bot.action(/^sac:rg:([A-Za-z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    const cities = await rpc('bot_geo_cities',{p_region:ctx.match[1]})||[];
    const s=getSession(tgId(ctx)); s.temp.saCities=cities;
    if(!cities.length) return ctx.reply(tr('b1508_no_cities_region'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([[Markup.button.callback(tr('b1508_back'),'sa:add:ct')]]).reply_markup});
    const rows=[]; for(let i=0;i<cities.length;i+=2) rows.push(cities.slice(i,i+2).map(c=>Markup.button.callback(geoLabel(c),`sa:ct:${c.id}`)));
    rows.push([Markup.button.callback(tr('b1510_back'),'sa:add:ct')]);
    await ctx.reply(tr('b1511_choose_city'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard(rows).reply_markup});
});
bot.action(/^sa:ct:([A-Za-z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery(tr('cm_added_f'));
    const s=getSession(tgId(ctx)); const d=s.temp.alertDraft||(s.temp.alertDraft=newDraft());
    const c=(s.temp.saCities||[]).find(x=>x.id===ctx.match[1]);
    if(!d.cities.includes(ctx.match[1])){ d.cities.push(ctx.match[1]); d.labels.cities.push(c?geoLabel(c):ctx.match[1]); }
    return showSmartBuilder(ctx);
});
// mall/market (region → city → type → location)
bot.action('sa:add:ml', async ctx => {
    await ctx.answerCbQuery();
    const regions = await rpc('bot_geo_regions',{})||[];
    const s=getSession(tgId(ctx)); s.temp.saRegions=regions;
    if(!regions.length) return ctx.reply(tr('b1525_regions_load_failed'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([[Markup.button.callback(tr('b1525_back'),'smart:builder')]]).reply_markup});
    const rows=[]; for(let i=0;i<regions.length;i+=2) rows.push(regions.slice(i,i+2).map(r=>Markup.button.callback(geoLabel(r),`sam:rg:${r.id}`)));
    rows.push([Markup.button.callback(tr('b1527_back'),'smart:builder')]);
    await ctx.reply(tr('b1528_mall_choose_region'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard(rows).reply_markup});
});
bot.action(/^sam:rg:([A-Za-z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    const cities = await rpc('bot_geo_cities',{p_region:ctx.match[1]})||[];
    const s=getSession(tgId(ctx)); s.temp.saCities=cities;
    if(!cities.length) return ctx.reply(tr('b1534_no_cities_region'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([[Markup.button.callback(tr('b1534_back'),'sa:add:ml')]]).reply_markup});
    const rows=[]; for(let i=0;i<cities.length;i+=2) rows.push(cities.slice(i,i+2).map(c=>Markup.button.callback(geoLabel(c),`sam:ct:${c.id}`)));
    rows.push([Markup.button.callback(tr('b1536_back'),'sa:add:ml')]);
    await ctx.reply(tr('b1537_choose_city'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard(rows).reply_markup});
});
bot.action(/^sam:ct:([A-Za-z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    const s=getSession(tgId(ctx)); s.temp.saCity=ctx.match[1];
    await ctx.reply(tr('b1542_location_type'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([
        [Markup.button.callback(tr('b1543_mall'),`sam:tp:mall`), Markup.button.callback(tr('b1543_market'),`sam:tp:market`)],
        [Markup.button.callback(tr('b1544_back'),'sa:add:ml')]
    ]).reply_markup});
});
bot.action(/^sam:tp:(mall|market)$/, async ctx => {
    await ctx.answerCbQuery();
    const s=getSession(tgId(ctx));
    const locs = await rpc('bot_geo_locations',{p_city:s.temp.saCity,p_type:ctx.match[1]})||[];
    s.temp.saLocs=locs;
    if(!locs.length) return ctx.reply(tr('b1552_no_locations', (ctx.match[1]==='mall'?tr('b1552_malls'):tr('b1552_markets'))),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([[Markup.button.callback(tr('b1552_back'),'sa:add:ml')]]).reply_markup});
    const rows=locs.slice(0,16).map((l,i)=>[Markup.button.callback(`📍 ${String(geoLabel(l)).slice(0,34)}`,`sa:ml:${i}`)]);
    rows.push([Markup.button.callback(tr('cm_back'),'sa:add:ml')]);
    await ctx.reply(`${ctx.match[1]==='mall'?tr('q1555_choose_mall'):tr('q1555_choose_market')}`,{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard(rows).reply_markup});
});
bot.action(/^sa:ml:(\d+)$/, async ctx => {
    await ctx.answerCbQuery(tr('cm_added_m'));
    const s=getSession(tgId(ctx)); const d=s.temp.alertDraft||(s.temp.alertDraft=newDraft()); const l=(s.temp.saLocs||[])[+ctx.match[1]];
    if(l && !d.malls.includes(l.id)){ d.malls.push(l.id); d.labels.malls.push(geoLabel(l)); }
    return showSmartBuilder(ctx);
});
// my location + radius
bot.action('sa:add:loc', async ctx => {
    await ctx.answerCbQuery();
    const s=getSession(tgId(ctx)); const d=s.temp.alertDraft||(s.temp.alertDraft=newDraft());
    if(s.geo){ d.coords={lat:s.geo.lat,lng:s.geo.lng}; return askRadius(ctx); }
    s.temp.alertLocWait=true;
    await ctx.reply(tr('b1569_share_location_for_alert'),{ reply_markup: Markup.keyboard([[Markup.button.locationRequest(tr('b1569_share_my_location_now'))],[tr('q1569_cancel')]]).resize().oneTime().reply_markup });
});
function askRadius(ctx){
    return ctx.reply(tr('b1572_distance_radius_prompt'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([
        [Markup.button.callback(tr('b1573_3_km'),'sa:rad:3'),Markup.button.callback(tr('b1573_5_km'),'sa:rad:5'),Markup.button.callback(tr('b1573_10_km'),'sa:rad:10')],
        [Markup.button.callback(tr('b1574_20_km'),'sa:rad:20'),Markup.button.callback(tr('b1574_50_km'),'sa:rad:50')],
        [Markup.button.callback(tr('b1575_back'),'smart:builder')]
    ]).reply_markup});
}
bot.action(/^sa:rad:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const s=getSession(tgId(ctx)); const d=s.temp.alertDraft; if(!d||!d.coords) return showSmartBuilder(ctx);
    d.radiusKm=+ctx.match[1];
    await ctx.reply(tr('b1582_radius_set',numEsc(d.radiusKm)),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([
        [Markup.button.callback(tr('b1583_show_radius_on_map'),'sa:map')],
        [Markup.button.callback(tr('b1584_continue'),'smart:builder')]
    ]).reply_markup});
});
bot.action('sa:map', async ctx => {
    await ctx.answerCbQuery();
    const s=getSession(tgId(ctx)); const d=s.temp.alertDraft;
    if(!d||!d.coords) return showSmartBuilder(ctx);
    // رابط خرائط قوقل (نصّ عادي → يفتح Google Maps لا خرائط آبل على iPhone). طلب ناصر. v11.95
    const gmap = `https://www.google.com/maps/search/?api=1&query=${d.coords.lat},${d.coords.lng}`;
    try { await ctx.reply(`${tr('b1595_alert_map')}\n${gmap}`); } catch { /* ignore */ }
    // Open the website /nearby map seeded with these coords + radius → it renders
    // the SAME light-circle (inside the radius) / dark-mask (outside) the owner
    // knows from the site, so the radius is actually visualised. v11.76 (Task 3)
    const mapUrl = W(`/nearby?lat=${d.coords.lat}&lng=${d.coords.lng}${d.radiusKm?`&radius=${d.radiusKm}`:''}`);
    await ctx.reply(tr('b1596_location_and_radius_map',numEsc(d.radiusKm||0),DIV,numEsc(d.radiusKm||0)),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([
        [Markup.button.webApp(tr('b1597_show_radius_map_light_dark'), mapUrl)],
        [Markup.button.callback(tr('b1584_continue'),'smart:builder')]
    ]).reply_markup});
});
// keyword
bot.action('sa:add:kw', async ctx => {
    await ctx.answerCbQuery();
    setStep(tgId(ctx),'await_smart_kw');
    await ctx.reply(tr('b1605_type_keyword_match_title'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([[Markup.button.callback(tr('b1575_back'),'smart:builder')]]).reply_markup});
});
// save
bot.action('smart:save', async ctx => {
    await ctx.answerCbQuery(tr('b1609_saving'));
    const s=getSession(tgId(ctx)); const d=s.temp.alertDraft||newDraft();
    const rule={};
    if(d.categories.length) rule.categories=d.categories;
    if(d.regions.length)    rule.regions=d.regions;
    if(d.cities.length)     rule.cities=d.cities;
    if(d.malls.length)      rule.malls=d.malls;
    if(d.keywords.length)   rule.keywords=d.keywords;
    if(d.coords && d.radiusKm){ rule.coords=d.coords; rule.radiusKm=d.radiusKm; }
    rule.labels=d.labels;   // display-only; ignored by the website & the trigger
    const r = await rpc('bot_add_smart_alert',{p_telegram_id:tgId(ctx),p_rule:rule});
    if(!r?.success){ const e=r?.error; const msg= e==='empty_rule'?tr('b1620_err_empty_rule'):e==='too_many'?tr('b1620_err_too_many'):e==='not_linked'?tr('b1620_err_not_linked'):tr('b1620_err_save_failed'); return ctx.reply(msg,{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([[Markup.button.callback(tr('b1575_back'),'smart:builder')]]).reply_markup}); }
    s.temp.alertDraft=null;
    await ctx.reply(tr('b1622_smart_alert_saved'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([
        [Markup.button.callback(tr('b1623_my_smart_alerts'),'smart:list')],
        [Markup.button.callback(tr('b1624_another_alert'),'smart:new'), Markup.button.callback(tr('b1624_menu'),'menu:back')]
    ]).reply_markup});
});
bot.action('buyer:profile', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    await ctx.reply(tr('b1630_my_account',DIV,md(s.name)), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(tr('b1631_stores_i_follow'),'buyer:following')],
        [Markup.button.callback(tr('b1632_my_smart_alerts'),'buyer:notif'), Markup.button.callback(tr('b1632_my_bookings'),'buyer:bookings')],
        [Markup.button.webApp(tr('b1633_edit_account'), W('/profile'))],
        [Markup.button.callback(tr('b1634_back'),'menu:back')]
    ]).reply_markup });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Task 14 — followed merchants (each in its own box: deals / store / reviews /
//  unfollow). Reads users.followed_merchants — same array the website manages.
// ═══════════════════════════════════════════════════════════════════════════════
bot.command('following', ctx => showFollowing(ctx));
bot.action('buyer:following', async ctx => { await ctx.answerCbQuery(); showFollowing(ctx); });
async function showFollowing(ctx){
    const s=getSession(tgId(ctx));
    if(!s.userId) return ctx.reply(tr('b1646_sign_in_first'), { parse_mode:'MarkdownV2', reply_markup: kbGuest().reply_markup });
    const r=await rpc('bot_list_followed',{p_telegram_id:tgId(ctx)});
    if(!r?.success) return ctx.reply(tr('b1648_load_follows_failed'), { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    const ms=Array.isArray(r.merchants)?r.merchants:[];
    if(!ms.length) return ctx.reply(tr('b1650_no_follows_yet',DIV), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1650_browse_offers'),'browse:menu')],[Markup.button.callback(tr('b1650_back'),'menu:back')]]).reply_markup });
    await ctx.reply(tr('b1651_followed_stores_count',numEsc(ms.length),DIV), { parse_mode:'MarkdownV2' });
    for(const x of ms){
        const stars = x.rating_count>0 ? `⭐ ${md(String(x.rating_avg))} \\(${numEsc(x.rating_count)}\\)` : tr('q1654_new_store');
        const bio = x.bio ? `\n📝 _${md(String(x.bio).slice(0,120))}_` : '';
        const m = tr('q1656_follow_store_card', md(x.name), stars, numEsc(x.active_deals), bio);
        const rows = [
            [Markup.button.callback(tr('b1657_its_offers'),'store:'+x.store_id), Markup.button.callback(tr('b1657_its_reviews'),'revw:'+x.store_id)],
            [Markup.button.callback(tr('b1658_unfollow'),'unfolAsk:'+x.store_id)],
        ];
        if(x.avatar){ try { await ctx.replyWithPhoto(x.avatar, { caption:m, parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup }); continue; } catch { /* fall through */ } }
        await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
    }
    await ctx.reply(`${DIV}`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1663_refresh'),'buyer:following'), Markup.button.callback(tr('b1663_back'),'menu:back')]]).reply_markup });
}
bot.action(/^unfolAsk:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(tr('b1667_confirm_unfollow'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1667_yes_unfollow'),`unfol:${ctx.match[1]}`)],[Markup.button.callback(tr('b1667_undo'),'buyer:following')]]).reply_markup });
});
bot.action(/^unfol:(.+)$/, async ctx => {
    await ctx.answerCbQuery(tr('b1670_unfollowing'));
    await rpc('bot_toggle_follow', { p_telegram_id: tgId(ctx), p_store_id: ctx.match[1] });
    return showFollowing(ctx);
});

// «أقرب العروض كمواقع على الخريطة» (نقاط Venue على شكل دبابيس) أُزيلت بطلب المالك
// (request 6) — تجربة «حولي» صارت قائمة عروض ضمن نطاق كم، ويبقى زر الخريطة التفاعلية
// الكاملة للموقع متاحاً داخل صفحة «حولي» لمن يريدها. v11.78

// ═══════════════════════════════════════════════════════════════════════════════
//  Buyer "Nearby" page — mirrors the website /nearby filters INSIDE the bot:
//  region → city → mall (cascading, stop at any level), category, radius / nearest,
//  then the matching deals as cards, plus the full interactive light/dark-mask map
//  as a web app (also previews the smart-alert radius). v11.76
// ═══════════════════════════════════════════════════════════════════════════════
// openNow افتراضياً OFF: تصفّح المنطقة/المدينة نيّةُ استكشاف؛ فلترة «المفتوح الآن»
// كانت تُفرّغ مناطق فيها عروض فعلاً (محلات مغلقة خارج الدوام) فيظنّها فارغة. v11.98
function nfDraft(s){ return s.temp.nf || (s.temp.nf = { region:null, regionName:null, city:null, cityName:null, mall:null, mallName:null, category:null, radius:null, useGeo:false, openNow:false }); }
function nfSummary(f, s){
    const lines = [
        tr('q1690_summary_region', f.regionName ? md(f.regionName) : tr('q1690b_all_regions')),
        tr('q1691_summary_city', f.cityName ? md(f.cityName) : '—'),
        tr('q1692_summary_mall', f.mallName ? md(f.mallName) : '—'),
        tr('q1693_summary_category', f.category ? md(catLabel(f.category)) : tr('q1693b_all_categories')),
    ];
    if (f.useGeo && s.geo) lines.push(tr('q1695_summary_range', f.radius>0 ? tr('q1695b_within_km', numEsc(f.radius)) : tr('q1695c_nearest_to_you')));
    else lines.push(tr('q1696_summary_range_none'));
    lines.push(tr('q1697_summary_display', f.openNow ? tr('q1697b_open_now') : tr('q1697c_all_shops')));
    return lines.join('\n');
}
// Web map URL carrying the chosen filters → the website renders the SAME
// light-circle / dark-mask the owner knows (Task 3 + full map).
function nfMapUrl(f, s){
    const qp = [];
    if (f.region)   qp.push(`region=${encodeURIComponent(f.region)}`);
    if (f.city)     qp.push(`city=${encodeURIComponent(f.city)}`);
    if (f.mall)     qp.push(`mall=${encodeURIComponent(f.mall)}`);
    if (f.category) qp.push(`cat=${encodeURIComponent(f.category)}`);
    if (f.useGeo && s.geo){ qp.push(`lat=${s.geo.lat}`, `lng=${s.geo.lng}`); if (f.radius>0) qp.push(`radius=${f.radius}`); }
    return W('/nearby' + (qp.length ? `?${qp.join('&')}` : ''));
}
bot.command('nearby', ctx => showNearbyHub(ctx));
bot.action('buyer:nearby', async ctx => { await ctx.answerCbQuery(); showNearbyHub(ctx); });
async function showNearbyHub(ctx){
    const s=getSession(tgId(ctx)); const f=nfDraft(s);
    const hasGeo = !!s.geo;
    const m = tr('q1716_nearby_hub', DIV, nfSummary(f, s), DIV);
    const rows = [
        [Markup.button.callback(tr('nf_region_city_mall'),'nf:loc')],
        [Markup.button.callback(tr('nf_category'),'nf:cat')],
        // «الأقرب لي» على اليمين (الخيار الأول قراءةً بالعربي RTL) و«+ كيلومترات» على اليسار. v11.87
        [Markup.button.callback(tr('nf_nearest_km'),'nf:nearkm'), Markup.button.callback(tr('nf_nearest_30'),'nf:near')],
        [Markup.button.callback(tr('b725_open_now') + (f.openNow?' ✅':''), 'nf:open:1'), Markup.button.callback(tr('b726_all_shops') + (!f.openNow?' ✅':''), 'nf:open:0')],
        [Markup.button.callback(tr('nf_show_deals'),'nf:go:0')],
        [Markup.button.webApp(tr('nf_interactive_map'), nfMapUrl(f, s))],
    ];
    if (hasGeo) rows.push([Markup.button.callback(tr('nf_change_location'),'nf:setloc')]);
    if (f.region||f.city||f.mall||f.category||f.useGeo) rows.push([Markup.button.callback(tr('nf_clear_filters'),'nf:clear')]);
    rows.push([Markup.button.callback(tr('cm_back_to_menu'),'menu:back')]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
}
bot.action('nf:clear', async ctx => { await ctx.answerCbQuery(tr('b1728_filters_cleared')); getSession(tgId(ctx)).temp.nf=null; return showNearbyHub(ctx); });
// «كل مدن المنطقة» / «كل المولات في المدينة» → اعرض العروض مباشرةً بدل العودة للوحة
// الفلاتر (كان أكبر سبب لشكوى «اخترت المنطقة/المدينة وما ظهرت عروض»). v12.02
bot.action('nf:done',  async ctx => { await ctx.answerCbQuery(tr('b1729_done')); return runNearby(ctx, 0); });
bot.action(/^nf:open:([01])$/, async ctx => { await ctx.answerCbQuery(); nfDraft(getSession(tgId(ctx))).openNow = ctx.match[1]==='1'; return showNearbyHub(ctx); });
// «عرض كل المتاجر» من الحالة الفارغة — يُطفئ فلتر المفتوح-الآن ويعيد العرض. v11.98
bot.action('nf:showall', async ctx => { await ctx.answerCbQuery(); nfDraft(getSession(tgId(ctx))).openNow = false; return runNearby(ctx, 0); });

// ── Location cascade: region → city → mall (the user may stop at any level) ────
bot.action('nf:loc', async ctx => {
    await ctx.answerCbQuery();
    const regions = await rpc('bot_geo_regions',{})||[];
    const s=getSession(tgId(ctx)); s.temp.nfRegions=regions;
    if(!regions.length) return ctx.reply(tr('b1737_load_regions_failed'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([[Markup.button.callback(tr('b1737_back'),'buyer:nearby')]]).reply_markup});
    const rows=[]; for(let i=0;i<regions.length;i+=2) rows.push(regions.slice(i,i+2).map(r=>Markup.button.callback(geoLabel(r),`nfl:rg:${r.id}`)));
    rows.push([Markup.button.callback(tr('b1739_all_regions'),'nfl:rg:_all')]);
    rows.push([Markup.button.callback(tr('b1740_back'),'buyer:nearby')]);
    await ctx.reply(tr('b1741_choose_region'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard(rows).reply_markup});
});
bot.action(/^nfl:rg:([A-Za-z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    const s=getSession(tgId(ctx)); const f=nfDraft(s);
    if(ctx.match[1]==='_all'){ f.region=f.regionName=f.city=f.cityName=f.mall=f.mallName=null; return runNearby(ctx, 0); }
    const reg=(s.temp.nfRegions||[]).find(r=>r.id===ctx.match[1]);
    f.region=ctx.match[1]; f.regionName=reg?geoLabel(reg):ctx.match[1]; f.city=f.cityName=f.mall=f.mallName=null;
    const cities = await rpc('bot_geo_cities',{p_region:f.region})||[]; s.temp.nfCities=cities;
    if(!cities.length) return runNearby(ctx, 0);
    const rows=[]; for(let i=0;i<cities.length;i+=2) rows.push(cities.slice(i,i+2).map(c=>Markup.button.callback(geoLabel(c),`nfl:ct:${c.id}`)));
    rows.push([Markup.button.callback(tr('b1752_all_cities_in_region',f.regionName),'nf:done')]);
    rows.push([Markup.button.callback(tr('b1753_regions'),'nf:loc')]);
    await ctx.reply(tr('b1754_choose_city',md(f.regionName)),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard(rows).reply_markup});
});
bot.action(/^nfl:ct:([A-Za-z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    const s=getSession(tgId(ctx)); const f=nfDraft(s);
    const c=(s.temp.nfCities||[]).find(x=>x.id===ctx.match[1]);
    f.city=ctx.match[1]; f.cityName=c?geoLabel(c):ctx.match[1]; f.mall=f.mallName=null;
    const locs = await rpc('bot_geo_locations',{p_city:f.city,p_type:null})||[]; s.temp.nfLocs=locs;
    // City has no registered malls/markets → show its deals directly (don't dump
    // the user back on the filter hub with nothing). v12.02
    if(!locs.length) return runNearby(ctx, 0);
    const typeTag = t => t==='market'?tr('q1766_tag_market'):t==='mall'?tr('q1766_tag_mall'):t==='store'?tr('q1766_tag_store'):'';
    const rows=locs.slice(0,18).map((l,i)=>[Markup.button.callback(`📍 ${String(geoLabel(l)).slice(0,30)}${typeTag(l.type)}`,`nfl:ml:${i}`)]);
    rows.push([Markup.button.callback(tr('b1765_all_in_city',f.cityName),'nf:done')]);
    rows.push([Markup.button.callback(tr('b1766_cities'),'nf:loc')]);
    await ctx.reply(tr('b1767_choose_mall',md(f.cityName)),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard(rows).reply_markup});
});
bot.action(/^nfl:ml:(\d+)$/, async ctx => {
    await ctx.answerCbQuery(tr('b1770_done'));
    const s=getSession(tgId(ctx)); const f=nfDraft(s); const l=(s.temp.nfLocs||[])[+ctx.match[1]];
    if(l){ f.mall=l.id; f.mallName=geoLabel(l); }
    return runNearby(ctx, 0);   // picked a specific mall → show its deals now. v12.02
});
// ── Category filter ───────────────────────────────────────────────────────────
bot.action('nf:cat', async ctx => {
    await ctx.answerCbQuery();
    const ids = Object.keys(CAT).filter(k=>k!=='all');
    const rows=[]; for(let i=0;i<ids.length;i+=2) rows.push(ids.slice(i,i+2).map(id=>Markup.button.callback(catLabel(id),`nfcat:${id}`)));
    rows.push([Markup.button.callback(tr('b1780_all_categories'),'nfcat:_all')]);
    rows.push([Markup.button.callback(tr('b1781_back'),'buyer:nearby')]);
    await ctx.reply(tr('b1782_choose_category'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard(rows).reply_markup});
});
bot.action(/^nfcat:([A-Za-z_]+)$/, async ctx => {
    await ctx.answerCbQuery(tr('cm_done'));
    const s=getSession(tgId(ctx)); const f=nfDraft(s);
    if (ctx.match[1]==='_all'){ f.category=null; return showNearbyHub(ctx); }
    f.category = ctx.match[1];
    // request 6: بعد اختيار التصنيف، اسأل كيف يُعرض — الأقرب ضمن ٣٠ كم أو كل العروض.
    return ctx.reply(tr('b1790_category_display_mode', md(catLabel(f.category)), DIV), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(tr('b1791_nearest_30km'),'nfcatmode:near')],
        [Markup.button.callback(tr('b1792_all_deals'),'nfcatmode:all')],
        [Markup.button.callback(tr('b1793_back'),'buyer:nearby')]
    ]).reply_markup });
});
// التصنيف ضمن ٣٠ كم من الموقع (يُطلب الموقع مرة واحدة إن لزم) أو كل العروض. (request 6)
bot.action('nfcatmode:near', async ctx => {
    await ctx.answerCbQuery();
    const s=getSession(tgId(ctx)); const f=nfDraft(s);
    // الأقرب فالأقرب بلا حدّ مسافة (طلب ناصر) — radius=null. v11.93
    f.useGeo=true; f.radius=null;
    if(s.geo) return runNearby(ctx, 0);
    s.temp.nearbyLocWait='go';
    return askLocation(ctx);
});
bot.action('nfcatmode:all', async ctx => {
    await ctx.answerCbQuery();
    const s=getSession(tgId(ctx)); const f=nfDraft(s);
    f.useGeo=false; f.radius=null;
    return runNearby(ctx, 0);
});
// ── Nearest (share location) + radius ─────────────────────────────────────────
// «الأقرب لي (٣٠ كم)» — النطاق الافتراضي مباشرةً (request 6). إن كان الموقع محفوظاً
// عرضنا فوراً بلا طلب مشاركة (request 5)؛ وإلا طلبناه مرة واحدة ثم عرضنا.
bot.action('nf:near', async ctx => {
    await ctx.answerCbQuery();
    const s=getSession(tgId(ctx)); const f=nfDraft(s);
    // «الأقرب لي» = الأقرب فالأقرب بلا حدّ مسافة (طلب ناصر) — radius=null → بلا فلتر نطاق. v11.93
    f.useGeo=true; f.radius=null;
    if(s.geo) return runNearby(ctx, 0);
    s.temp.nearbyLocWait='go';
    return askLocation(ctx);
});
// «الأقرب لي + تحديد الكيلومترات» — يختار المستخدم نصف القطر ثم نعرض (request 6).
bot.action('nf:nearkm', async ctx => {
    await ctx.answerCbQuery();
    const s=getSession(tgId(ctx)); const f=nfDraft(s);
    f.useGeo=true; if(!f.radius) f.radius=30;
    if(s.geo) return askNfRadius(ctx);
    s.temp.nearbyLocWait='pick';
    return askLocation(ctx);
});
// «تغيير موقعي» — يعيد طلب الموقع (مشاركة أو رابط قوقل) ثم يرجع لصفحة الفلاتر (request 5).
bot.action('nf:setloc', async ctx => {
    await ctx.answerCbQuery();
    getSession(tgId(ctx)).temp.nearbyLocWait='hub';
    return askLocation(ctx);
});
function askNfRadius(ctx){
    return ctx.reply(tr('b1838_radius_around_you'),{parse_mode:'MarkdownV2',reply_markup:Markup.inlineKeyboard([
        [Markup.button.callback(tr('b1839_1km'),'nfr:1'),Markup.button.callback(tr('b1839_2km'),'nfr:2'),Markup.button.callback(tr('b1839_5km'),'nfr:5')],
        [Markup.button.callback(tr('b1840_10km'),'nfr:10'),Markup.button.callback(tr('b1840_20km'),'nfr:20'),Markup.button.callback(tr('b1840_30km'),'nfr:30')],
        [Markup.button.callback(tr('b1841_50km'),'nfr:50'),Markup.button.callback(tr('b1841_100km'),'nfr:100'),Markup.button.callback(tr('b1841_all'),'nfr:0')],
        [Markup.button.callback(tr('b1842_back'),'buyer:nearby')]
    ]).reply_markup});
}
bot.action(/^nfr:(\d+)$/, async ctx => {
    await ctx.answerCbQuery(tr('cm_done'));
    const s=getSession(tgId(ctx)); const f=nfDraft(s);
    f.radius=+ctx.match[1]; f.useGeo=true;
    return runNearby(ctx, 0);   // أظهر النتائج فوراً بعد اختيار النطاق (request 6)
});
// ── Run the filtered nearby search → cards (same engine as the website) ────────
bot.action(/^nf:go:(\d+)$/, async ctx => { await ctx.answerCbQuery(); return runNearby(ctx, +ctx.match[1]); });
async function runNearby(ctx, offset){
    if(!checkRL(`nf:${chatId(ctx)}`)) return;
    const s=getSession(tgId(ctx)); const f=nfDraft(s);
    const useGeo = !!(f.useGeo && s.geo);
    const deals = await rpc('bot_browse_deals',{
        p_sort: useGeo ? 'nearby' : 'newest',
        p_category: f.category || null,
        p_lat: useGeo ? s.geo.lat : null,
        p_lng: useGeo ? s.geo.lng : null,
        p_radius_km: (useGeo && f.radius>0) ? f.radius : null,
        p_limit: PAGE, p_offset: offset,
        p_region: f.region || null,
        p_city: f.city || null,
        p_location_id: f.mall || null,
        p_open_now: !!f.openNow,
    })||[];
    s.temp.listCb='buyer:nearby';
    const where  = [f.mallName, f.cityName, f.regionName].filter(Boolean).join(' • ') || (useGeo ? tr('q1873_around_you') : tr('q1873_all_regions'));
    const catTxt = f.category ? ` · ${catLabel(f.category)}` : '';
    if(!deals.length){
        const msg = offset===0 ? tr('b1873_no_matching_deals') : tr('b1873_no_more_deals');
        // If the empty list is because open-now hid closed shops, say so + offer
        // a one-tap «show all shops» that re-runs with the gate off. v11.98
        const erows = [];
        if (offset===0 && f.openNow) erows.push([Markup.button.callback(tr('b701_show_all_shops'),'nf:showall')]);
        erows.push([Markup.button.callback(tr('b1874_edit_filters'),'buyer:nearby')]);
        erows.push([Markup.button.callback(tr('b1874_menu'),'menu:back')]);
        const hint = (offset===0 && f.openNow) ? ('\n' + tr('b698_some_shops_closed')) : '';
        return ctx.reply(tr('b1874_nearby_header', md(where), md(catTxt), DIV, msg) + hint, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(erows).reply_markup });
    }
    await ctx.reply(tr('b1876_nearby_cards_intro', md(where), md(catTxt), DIV), { parse_mode:'MarkdownV2' });
    for(let i=0;i<deals.length;i++){
        const d=deals[i];
        await safeReplyMd(ctx, browseCard(d, offset+i+1, useGeo?s.geo:null), { link_preview_options:{is_disabled:true},
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('cm_details_book') + (d.is_sponsored?` ${sponsorEmoji(d)}`:''), `deal:${d.id}`)]]).reply_markup });
    }
    const nav=[];
    if(offset>0) nav.push(Markup.button.callback(tr('b1883_prev'),`nf:go:${Math.max(0,offset-PAGE)}`));
    if(deals.length===PAGE) nav.push(Markup.button.callback(tr('b1884_next'),`nf:go:${offset+PAGE}`));
    const rows=[];
    if(nav.length) rows.push(nav);
    rows.push([Markup.button.webApp(tr('b1887_interactive_map'), nfMapUrl(f, s))]);
    rows.push([Markup.button.callback(tr('b1888_edit_filters'),'buyer:nearby'), Markup.button.callback(tr('b1888_menu'),'menu:back')]);
    await ctx.reply(tr('b1889_page', DIV, md(String(Math.floor(offset/PAGE)+1))), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
}

// ── Seller: stats ─────────────────────────────────────────────────────────────
bot.command('stats', ctx => showSellerStats(ctx));
bot.action('seller:stats', async ctx => { await ctx.answerCbQuery(); showSellerStats(ctx); });
async function showSellerStats(ctx) {
    const s = await refreshSession(ctx);
    if (!s.userId || s.userType!=='seller') return ctx.reply(tr('cm_sellers_only'), { parse_mode:'MarkdownV2' });
    const st = await rpc('bot_get_seller_stats', { p_telegram_id: tgId(ctx) });
    if (!st) return ctx.reply(tr('b1899_stats_load_failed'), { parse_mode:'MarkdownV2' });
    const plan = st.subscription_plan || tr('q1903_free_plan');
    const expiry = st.subscription_expires_at ? fmtDay(st.subscription_expires_at) : '—';
    await ctx.reply(
        tr('b1903_seller_stats', md(st.shop||s.name), DIV, st.today_bookings, st.total_bookings, st.pending_bookings, st.active_deals, money(st.total_revenue), md(plan), md(expiry)),
        { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
}

// ── Seller: bookings (split: active vs previous) ──────────────────────────────
bot.action('seller:bookings', async ctx => { await ctx.answerCbQuery(); sellerBookingsMenu(ctx); });
bot.action('seller:bk:current',  async ctx => { await ctx.answerCbQuery(); showSellerBookings(ctx, 'current'); });
bot.action('seller:bk:previous', async ctx => { await ctx.answerCbQuery(); showSellerBookings(ctx, 'previous'); });
async function sellerBookingsMenu(ctx) {
    const s = getSession(tgId(ctx));
    if (!s.userId || !ownsStore(s)) return;
    // Refresh the pending count LIVE from the DB — the cached s.pendingBookings
    // lagged after a cancel/complete, so the header said «1 بانتظار التأكيد»
    // while the active list was already empty. v12.11
    try { const st = await rpc('bot_get_seller_stats', { p_telegram_id: tgId(ctx) }); if (st) { s.pendingBookings = st.pending_bookings || 0; s.activeDeals = st.active_deals || 0; } } catch { /* keep cached on transient error */ }
    const p = s.pendingBookings>0 ? tr('b1914_pending_count', s.pendingBookings) : '';
    await ctx.reply(tr('b1915_store_bookings', p, DIV), { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(tr('b1917_active'),'seller:bk:current'), Markup.button.callback(tr('b1917_previous'),'seller:bk:previous')],
            [Markup.button.callback(tr('b1918_menu'),'menu:back')]
        ]).reply_markup });
}
// scope: 'current' (قيد الانتظار/مؤكد) | 'previous' (مكتمل/ملغي/منتهٍ)
async function showSellerBookings(ctx, scope='current') {
    const s = getSession(tgId(ctx));
    if (!s.userId || !ownsStore(s)) return;
    const list = await rpc('bot_get_seller_bookings', { p_telegram_id: tgId(ctx), p_scope: scope });
    if (!list?.length) {
        const empty = scope==='previous' ? tr('b1927_no_previous_bookings') : tr('b1927_no_active_bookings');
        return ctx.reply(empty, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1928_back'),'seller:bookings')]]).reply_markup });
    }
    const title = scope==='previous' ? tr('b1930_previous_bookings') : tr('b1930_active_bookings');
    const shown = list.slice(0, 10);
    const more  = list.length - shown.length;
    // One self-contained card per booking — buttons attached, never detached. v11.70
    await safeReplyMd(ctx, `${title} \\(${list.length}${more>0?tr('w1186_latest_n', shown.length):''}\\)\n${DIV}\n${tr('w1186_each_booking_own_card')}`);
    for (let i=0;i<shown.length;i++){
        const b = shown[i];
        const active = b.status==='pending'||b.status==='acknowledged';
        let m = `*${i+1}\\.* 📋 \`${md(b.barcode)}\`\n👤 *${md(b.user_name)}*  📞 ${md(b.user_phone)}\n🛍 ${md(b.deal_name)}  •  📦 ×${b.quantity}  •  ⏱ ${md(prepLabel(b.prep_time))}\n${statusLabel(b.status)}  •  📅 ${md(fmtDate(b.booked_at))}`;
        if (active && b.expiry_time) m += `\n⏰ *${tr('w1191_booking_expires')}:* ${md(fmtDate(b.expiry_time))}\n${countdownBlock(Number(b.expiry_time))}`;
        if (b.notes) m += `\n📝 _${md(b.notes)}_`;
        const rows = [];
        if (b.status==='pending') rows.push([Markup.button.callback(tr('b1942_confirm_and_prepare'), `ack:${b.barcode}`)]);
        const row = [];
        if (active) row.push(Markup.button.callback(tr('b1944_complete'), `complete:${b.barcode}`));
        row.push(Markup.button.callback(b.unread>0 ? tr('b1945_chat_unread', b.unread) : tr('b1945_chat'), `chat:${b.barcode}`));
        rows.push(row);
        const row2 = [Markup.button.callback(tr('b1947_call_customer'), `call:b:${b.barcode}`)];
        if (active && b.expiry_time) row2.push(Markup.button.callback(tr('cm_countdown'), `cds:${b.barcode}`));
        rows.push(row2);
        // التاجر يقدر يلغي حجز المشتري من عنده (كان ناقصاً في البوت). مسار scancel يرجّع
        // لقائمة حجوزات التاجر بدل حجوزات المشتري. v12.07
        if (active) rows.push([Markup.button.callback(tr('b1205_cancel_booking'), `scancel:${b.barcode}`)]);
        // safeReplyMd so one odd card (a name/note Telegram rejects) can never abort the
        // loop before the footer below — the footer carries the «رجوع» button. v11.90
        await safeReplyMd(ctx, m, { reply_markup: Markup.inlineKeyboard(rows).reply_markup });
    }
    // The «رجوع» footer was vanishing when a card failed MarkdownV2 and threw — now both
    // cards and footer use safeReplyMd, so the back button ALWAYS arrives (matches the
    // buyer-side v11.77 fix that the seller render had missed). v11.90
    await safeReplyMd(ctx, `${DIV}${more>0?tr('b1952_older_hidden', numEsc(more)):''}`, { reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1952_refresh'),`seller:bk:${scope}`), Markup.button.callback(tr('b1952_back'),'seller:bookings')]]).reply_markup });
}
bot.action(/^ack:(.+)$/, async ctx => {
    await ctx.answerCbQuery(tr('b1955_confirming_order'));
    const result = await rpc('bot_acknowledge_booking', { p_telegram_id: tgId(ctx), p_barcode: ctx.match[1] });
    if (result?.success) {
        // بعد التأكيد يرجع التاجر لبطاقة نفس الحجز بأزرار الخطوة التالية
        // (إتمام/محادثة/العدّاد/اتصال/إلغاء) بدل أزرار قوائم عامة. v12.24
        await ctx.reply(tr('b1957_order_confirmed', md(result.user_name)), { parse_mode:'MarkdownV2' });
        return renderOneBooking(ctx, ctx.match[1]);
    }
    else {
        const e = result?.error;
        const m = e==='wrong_status' ? tr('b1960_already_confirmed')
            : e==='not_found'  ? tr('b1961_order_not_found')
            : e==='not_seller' ? tr('b1962_not_a_store')
            : tr('b1963_confirm_failed');
        await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1964_bookings'),'seller:bookings')]]).reply_markup });
    }
});
// Completing a booking offers an OPTIONAL message to the buyer (delivered to
// web + app + bot, same instant — mirrors the app's delivery note). v11.72
bot.action(/^complete:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const bc = ctx.match[1];
    getSession(tgId(ctx)).temp.completeBarcode = bc;
    await ctx.reply(tr('b1973_complete_booking_prompt', md(bc), DIV), { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(tr('b1975_add_message_then_complete'),`completeMsg:${bc}`)],
            [Markup.button.callback(tr('b1976_complete_no_message'),`completeGo:${bc}`)],
            [Markup.button.callback(tr('b1977_back'),'seller:bookings')]
        ]).reply_markup });
});
bot.action(/^completeGo:(.+)$/, async ctx => { await ctx.answerCbQuery(tr('b1980_completing')); doComplete(ctx, ctx.match[1], null); });
bot.action(/^completeMsg:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx)); s.temp.completeBarcode = ctx.match[1];
    setStep(tgId(ctx),'await_complete_msg');
    await ctx.reply(tr('b1985_write_message_prompt'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1985_no_message'),`completeGo:${ctx.match[1]}`)]]).reply_markup });
});
bot.command('complete', async ctx => { const c = sanitize((ctx.message?.text||'').split(' ')[1],20); if (!c) return ctx.reply(tr('b1987_complete_usage'),{parse_mode:'MarkdownV2'}); doComplete(ctx, c, null); });
async function doComplete(ctx, barcode, message) {
    setStep(tgId(ctx),'idle');
    const result = await rpc('bot_complete_booking', { p_telegram_id: tgId(ctx), p_barcode: barcode, p_message: message||null });
    if (!result?.success) {
        const e = result?.error;
        const m = e==='already_completed' ? tr('b1993_already_completed') : e==='not_found' ? tr('b1993_code_not_found') : e==='cancelled' ? tr('b1993_booking_cancelled') : tr('b1993_error_try_later');
        return ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
    const sent = message ? tr('b1996_message_sent') : '';
    await ctx.reply(tr('b1997_booking_completed', md(result.user_name), result.quantity, sent), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b1997_bookings'),'seller:bookings')],[Markup.button.callback(tr('b1997_menu'),'menu:back')]]).reply_markup });
}

// ── Seller: verify ────────────────────────────────────────────────────────────
bot.command('verify', ctx => startVerify(ctx));
bot.action('seller:verify', async ctx => { await ctx.answerCbQuery(); startVerify(ctx); });
bot.action('verify:manual', async ctx => { await ctx.answerCbQuery(); askBarcode(ctx); });
async function startVerify(ctx) {
    const s = getSession(tgId(ctx));
    if (!s.userId || s.userType!=='seller') return ctx.reply(tr('b2006_sellers_only'), { parse_mode:'MarkdownV2' });
    const c = sanitize((ctx.message?.text||'').split(' ')[1],20);
    if (c) return doVerify(ctx, c);
    // Options — mirror the app: type the code / pick from the list / camera scanner. v11.72
    await ctx.reply(tr('b2010_verify_booking', DIV), { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(tr('b2012_enter_barcode_manually'),'verify:manual')],
            [Markup.button.callback(tr('b2013_pick_from_bookings'),'seller:bk:current')],
            [Markup.button.webApp(tr('b2014_camera_scan'), W('/seller?tab=scanner'))],
            [Markup.button.callback(tr('b2015_menu'),'menu:back')]
        ]).reply_markup });
}
async function askBarcode(ctx) {
    setStep(tgId(ctx),'await_barcode');
    await ctx.reply(tr('b2020_enter_barcode'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2020_cancel'),'menu:back')]]).reply_markup });
}
async function doVerify(ctx, barcode) {
    const r = await rpc('bot_verify_booking', { p_telegram_id: tgId(ctx), p_barcode: barcode });
    setStep(tgId(ctx),'idle');
    if (!r?.success) return ctx.reply(r?.error==='not_found' ? tr('b2025_code_not_in_store') : tr('b2025_error_try_later'), { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    const ok = r.status!=='completed' && r.status!=='cancelled';
    let m = `${ok?'✅':'⚠️'} ${tr('q2030_verify_result')}\n${DIV}\n📋 \`${md(r.barcode)}\`\n👤 *${md(r.user_name)}*  📞 ${md(r.user_phone)}\n🛍 ${md(r.deal_name)}  📦 ${r.quantity}\n${statusLabel(r.status)}\n⏰ ${md(fmtDate(r.booked_at))}`;
    if (r.notes) m += `\n📝 ${md(r.notes)}`;
    const btns = [];
    if (ok && r.status==='pending') btns.push([Markup.button.callback(tr('b2030_confirm_and_prepare'), `ack:${r.barcode}`)]);
    if (ok) btns.push([Markup.button.callback(tr('b2031_complete_booking'), `complete:${r.barcode}`)]);
    btns.push([Markup.button.callback(tr('b2032_back'),'menu:back')]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup });
}

// ── Seller: subscription / packages (subscribe from Telegram, simulated payment) ─
bot.action('seller:sub', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    // الأدمن-المالك للمتجر «تاكي» يُعدّ بائعاً لأغراض إدارة المتجر (ownsStore). v11.91
    if (!s.userId || !ownsStore(s)) return ctx.reply(tr('b2040_option_sellers_only'), { parse_mode:'MarkdownV2' });
    const sub = await rpc('bot_get_subscription', { p_telegram_id: tgId(ctx) });
    if (!sub?.success) return ctx.reply(tr('b2042_subscription_load_failed'), { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    const planAr = sub.plan==='premium' ? tr('q2046_plan_premium') : sub.plan==='trial' ? tr('q2046_plan_trial') : tr('q2046_plan_free');
    const exp = sub.expires_at ? fmtDay(sub.expires_at) : '—';
    const statusLine = sub.active ? tr('q2048_active') : tr('q2048_inactive');
    await ctx.reply(
        tr('b2047_current_subscription', DIV, md(planAr), statusLine, sub.max_branches, md(exp)),
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2048_packages_and_sub'),'seller:packages')],[Markup.button.callback(tr('b2048_back'),'menu:back')]]).reply_markup });
});
// كل باقة في صندوق مستقل (طلب ناصر) — الاسم/السعر/الخصم/عدد المواقع كلها تُقرأ مباشرةً
// من `platform_settings.location_packages` عبر RPC، أي تعديل من لوحة الأدمن ينعكس فوراً. v11.91
bot.action('seller:packages', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    if (!s.userId || !ownsStore(s)) return;
    const pkgs = await rpc('bot_list_packages', {});
    const list = Array.isArray(pkgs) ? pkgs.filter(p => p.active!==false) : [];
    if (!list.length) return ctx.reply(tr('b2056_no_packages'), { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    // باقة المتجر الحالية → نُعلّم الباقة المطابقة بشارة «باقتك الحالية».
    const sub = await rpc('bot_get_subscription', { p_telegram_id: tgId(ctx) });
    const curMax = (sub && sub.success) ? Number(sub.max_branches)||0 : 0;
    const en = I18N.lang()==='en';
    // رأس الصفحة (صندوق منفصل).
    const curLine = curMax>0 ? tr('pkg_hub_current', numEsc(curMax)) : tr('pkg_hub_none');
    await safeReplyMd(ctx, tr('pkg_hub_header', DIV, curLine));
    // صندوق لكل باقة، بزر اشتراك ملتصق به.
    for (const p of list) {
        const name  = (en ? (p.en||p.ar) : (p.ar||p.en)) || tr('q2060_package_fallback', p.id);
        const max   = Math.max(1, Number(p.max)||1);
        const disc  = Math.min(100, Math.max(0, Number(p.discount)||0));
        const price = Math.round((Number(p.price)||0) * (1 - disc/100) * 100) / 100;   // خانتان عشريتان (299.99). v12.15
        const isCur = curMax>0 && max===curMax;
        let m = `💎 *${md(name)}*${isCur?tr('pkg_c_current_badge'):''}`;
        m += `\n${max<=1 ? tr('pkg_c_loc_one') : tr('pkg_c_loc_many', numEsc(max))}`;
        m += `\n${tr('pkg_c_price', money(price))}`;
        if (disc>0) m += `\n${tr('pkg_c_discount', money(Number(p.price)||0), numEsc(disc))}`;
        m += `\n${tr('pkg_c_duration', numEsc(Number(p.durationDays)||30))}`;
        m += `\n${tr('pkg_c_feat')}`;
        await safeReplyMd(ctx, m, { reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback(tr('pkg_c_subscribe_btn', price), `subpkg:${p.id}`)]
        ]).reply_markup });
    }
    // فوتر (صندوق منفصل) يحمل زر الرجوع — دائماً يصل عبر safeReplyMd.
    await safeReplyMd(ctx, tr('pkg_hub_footer', DIV), { reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2064_back'),'seller:sub')]]).reply_markup });
});
bot.action(/^subpkg:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const pkgs = await rpc('bot_list_packages', {});
    const p = (Array.isArray(pkgs)?pkgs:[]).find(x => String(x.id)===ctx.match[1]);
    if (!p) return ctx.reply(tr('cm_plan_unavailable'), { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    const en = I18N.lang()==='en';
    const name = (en ? (p.en||p.ar) : (p.ar||p.en)) || tr('q2073_package_fallback', p.id);
    const price = Math.round((Number(p.price)||0) * (1 - (Number(p.discount)||0)/100) * 100) / 100;   // خانتان عشريتان. v12.15
    await ctx.reply(
        tr('b2074_confirm_subscription', DIV, md(name), numEsc(Math.max(1,Number(p.max)||1)), money(price), numEsc(Number(p.durationDays)||30)),
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2075_confirm_and_subscribe'),`subgo:${p.id}`)],[Markup.button.callback(tr('b2075_cancel'),'seller:packages')]]).reply_markup });
});
bot.action(/^subgo:(\d+)$/, async ctx => {
    await ctx.answerCbQuery(tr('b2078_activating'));
    const r = await rpc('bot_subscribe_plan', { p_telegram_id: tgId(ctx), p_package_id: +ctx.match[1] });
    if (!r?.success) {
        const e=r?.error; const msg = e==='not_seller' ? tr('b2081_sellers_only') : e==='bad_package' ? tr('b2081_package_unavailable') : tr('b2081_subscribe_failed');
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
    await ctx.reply(
        tr('b2085_subscription_activated', DIV, md(r.plan_ar), r.max_branches, money(r.price), md(fmtDay(r.expires_at))),
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2086_my_deals'),'seller:deals'), Markup.button.callback(tr('b2086_add_deal'),'seller:addDeal')],[Markup.button.callback(tr('b2086_menu'),'menu:back')]]).reply_markup });
});

// ── Seller: store profile (bio view + edit) — Task 5 ──────────────────────────
bot.action('seller:profile', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    if (!s.userId || s.userType!=='seller') return ctx.reply(tr('b2093_sellers_only'), { parse_mode:'MarkdownV2' });
    const st = await rpc('bot_get_store', { p_telegram_id: tgId(ctx), p_store_id: s.userId });
    const stats = await rpc('bot_get_seller_stats', { p_telegram_id: tgId(ctx) });
    const plan = stats?.subscription_plan || tr('q2095_plan_free');
    const expiry = stats?.subscription_expires_at ? fmtDay(stats.subscription_expires_at) : '—';
    const stars = (st && st.rating_count>0) ? tr('q2097_rating_line', md(String(st.rating_avg)), numEsc(st.rating_count)) : tr('q2097_no_ratings');
    const bio = (st && st.bio) ? tr('q2098_bio_line', md(String(st.bio).slice(0,400))) : tr('q2098_no_bio');
    const m = tr('q2099_store_account', md(s.shop||s.name), DIV, md(s.name), stars, numEsc(st?.active_deals||0), md(plan), md(expiry), bio);
    const rows = [
        [Markup.button.callback(tr('b2102_edit_store_bio'),'seller:bio')],
        [Markup.button.callback(tr('b2103_preview_as_buyer'),`store:${s.userId}`)],
        [Markup.button.webApp(tr('b2104_edit_full_store'), W('/seller'))],
        [Markup.button.callback(tr('b2105_back'),'menu:back')],
    ];
    if (st && st.avatar) { try { return await ctx.replyWithPhoto(st.avatar, { caption:m, parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup }); } catch { /* fall through */ } }
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
});
bot.action('seller:bio', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    if (s.userType!=='seller') return;
    const st = await rpc('bot_get_store', { p_telegram_id: tgId(ctx), p_store_id: s.userId });
    const cur = (st && st.bio) ? tr('q2114_current_bio', DIV, md(String(st.bio).slice(0,300))) : '';
    setStep(tgId(ctx),'await_bio');
    await ctx.reply(tr('b2117_store_bio_prompt', cur, DIV), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2117_cancel'),'seller:profile')]]).reply_markup });
});

// ── Seller working hours (ساعات العمل) — same-for-all / per-day (two shifts) / off
//    Stored in users.working_hours (same source the website editor uses). v11.77
const _toMinHr = hhmm => { const [h,m]=String(hhmm).split(':'); return (+h||0)*60+(+m||0); };
// يُرجِع { shifts } عند النجاح أو { error } مع سبب واضح. الفترتان يجب أن تكونا
// متتاليتين بلا تداخل (بداية الثانية بعد نهاية الأولى) — تنبيه ناصر: «٤:٣٠» تُفهَم
// ٤:٣٠ صباحاً في صيغة ٢٤ ساعة، فالعصر يُكتب ١٦:٣٠. v11.94
function parseHoursInput(text){
    const toks = (normalizeDigits(String(text)).match(/\d{1,2}:\d{2}/g) || [])
        .map(x => { const [h,m]=x.split(':'); return (+h>=0&&+h<=23&&+m>=0&&+m<=59) ? `${String(+h).padStart(2,'0')}:${m}` : null; })
        .filter(Boolean);
    if (toks.length < 2 || toks.length % 2 !== 0 || toks.length > 4) return { error:'format' };
    const shifts=[];
    for (let i=0;i<toks.length;i+=2){
        if (_toMinHr(toks[i]) >= _toMinHr(toks[i+1])) return { error:'shift_range' };   // داخل الفترة: البداية قبل النهاية
        shifts.push([toks[i], toks[i+1]]);
    }
    if (shifts.length===2 && _toMinHr(shifts[1][0]) < _toMinHr(shifts[0][1])) return { error:'sequence' };  // الفترة الثانية بعد الأولى
    return { shifts };
}
const hoursErrKey = e => e==='sequence' ? 'b2323_hours_not_sequential' : e==='shift_range' ? 'b2324_hours_shift_range' : 'b2322_hours_bad_format';
async function showSellerHours(ctx){
    const s=getSession(tgId(ctx));
    if (!s.userId || !ownsStore(s)) return ctx.reply(tr('b2134_sellers_only'), { parse_mode:'MarkdownV2' });
    const r = await rpc('bot_get_store_hours', { p_telegram_id: tgId(ctx) });
    const wh = r?.working_hours;
    const hasDays = !!(wh && wh.days && Object.keys(wh.days).length);
    const enabled = !!(wh && wh.enabled);
    // ساعات موقوفة لكن محفوظة (يمكن استعادتها) ↔ ٢٤ ساعة. v11.94
    const lines = (enabled && HRS.isConfigured(wh)) ? HRS.weekLines(wh).map(l=>`• ${md(l)}`).join('\n')
                : (!enabled && hasDays) ? tr('b2137_hours_off_24_7')
                : tr('b2137_no_hours_set');
    const m = tr('b2138_shop_hours', DIV, lines);
    const rows = [
        [Markup.button.callback(tr('b2140_same_hours_all_days'),'sh:all')],
        [Markup.button.callback(tr('b2141_edit_specific_day'),'sh:day')],
    ];
    if (enabled)        rows.push([Markup.button.callback(tr('b2142_disable_hours'),'sh:off')]);
    else if (hasDays)   rows.push([Markup.button.callback(tr('b2142_restore_hours'),'sh:restore')]);
    rows.push([Markup.button.callback(tr('b2143_back'),'menu:back')]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
}
bot.command('hours', ctx => showSellerHours(ctx));
bot.action('seller:hours', async ctx => { await ctx.answerCbQuery(); showSellerHours(ctx); });
bot.action('sh:all', async ctx => {
    await ctx.answerCbQuery(); setStep(tgId(ctx),'await_hours_all');
    await ctx.reply(tr('b2150_unified_hours_prompt'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2150_cancel'),'seller:hours')]]).reply_markup });
});
bot.action('sh:day', async ctx => {
    await ctx.answerCbQuery();
    const rows=[]; for(let i=0;i<7;i+=2) rows.push([i,i+1].filter(d=>d<7).map(d=>Markup.button.callback(tr('day_'+d),`sh:d:${d}`)));
    rows.push([Markup.button.callback(tr('b2155_back'),'seller:hours')]);
    await ctx.reply(tr('b2156_pick_day_to_edit'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
});
bot.action(/^sh:d:([0-6])$/, async ctx => {
    await ctx.answerCbQuery();
    const s=getSession(tgId(ctx)); s.temp.hoursDay=+ctx.match[1]; setStep(tgId(ctx),'await_hours_day');
    await ctx.reply(tr('b2161_day_hours_prompt', md(tr('day_'+ctx.match[1]))), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2161_close_this_day'),`sh:close:${+ctx.match[1]}`)],[Markup.button.callback(tr('b2161_cancel'),'sh:day')]]).reply_markup });
});
async function saveDayHours(ctx, day, shifts){
    const r0 = await rpc('bot_get_store_hours', { p_telegram_id: tgId(ctx) });
    const wh = HRS.isConfigured(r0?.working_hours) ? r0.working_hours : { enabled:true, days:{} };
    wh.enabled = true; wh.days = wh.days || {};
    wh.days[String(day)] = shifts;
    const r = await rpc('bot_set_store_hours', { p_telegram_id: tgId(ctx), p_hours: wh });
    return r?.success;
}
bot.action(/^sh:close:([0-6])$/, async ctx => {
    await ctx.answerCbQuery(tr('b2172_day_closed'));
    setStep(tgId(ctx),'idle');
    await saveDayHours(ctx, +ctx.match[1], []);
    return showSellerHours(ctx);
});
// إيقاف ساعات العمل: تأكيد أولاً (طلب ناصر) — ثم نُطفئ التفعيل مع *حفظ* الأيام
// ليتسنّى استعادتها لاحقاً، بدل مسحها. v11.94
bot.action('sh:off', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(tr('b2179_disable_confirm', DIV), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback(tr('b2179_yes_disable'),'sh:off:yes')],
        [Markup.button.callback(tr('b2179_cancel'),'seller:hours')],
    ]).reply_markup });
});
bot.action('sh:off:yes', async ctx => {
    await ctx.answerCbQuery(tr('b2178_disabled'));
    const r0 = await rpc('bot_get_store_hours', { p_telegram_id: tgId(ctx) });
    const wh = (r0 && r0.working_hours) || {};
    const days = (wh.days && Object.keys(wh.days).length) ? wh.days : {};   // احفظ الجدول للاستعادة
    await rpc('bot_set_store_hours', { p_telegram_id: tgId(ctx), p_hours: { enabled:false, days } });
    await ctx.reply(tr('b2180_hours_disabled', DIV), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2180_working_hours'),'seller:hours')],[Markup.button.callback(tr('b2180_menu'),'menu:back')]]).reply_markup });
});
bot.action('sh:restore', async ctx => {
    await ctx.answerCbQuery();
    const r0 = await rpc('bot_get_store_hours', { p_telegram_id: tgId(ctx) });
    const wh = (r0 && r0.working_hours) || {};
    if (!(wh.days && Object.keys(wh.days).length)) return showSellerHours(ctx);
    await rpc('bot_set_store_hours', { p_telegram_id: tgId(ctx), p_hours: { enabled:true, days: wh.days } });
    await ctx.reply(tr('b2181_hours_restored'), { parse_mode:'MarkdownV2' });
    return showSellerHours(ctx);
});

// ── Admin ─────────────────────────────────────────────────────────────────────
bot.action('admin:stats', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    if (!s.isAdmin) return ctx.reply(tr('b2187_not_authorized'), { parse_mode:'MarkdownV2' });
    const st = await rpc('bot_get_admin_stats', { p_telegram_id: tgId(ctx) });
    if (!st?.success) return ctx.reply(tr('b2189_unauthorized_or_error'), { parse_mode:'MarkdownV2' });
    await ctx.reply(tr('b2190_platform_stats', DIV, st.total_users, st.merchants, st.buyers, st.active_deals, st.total_bookings, st.today_bookings, st.pending_reports), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.webApp(tr('b2190_admin_panel'), W('/admin'))],[Markup.button.callback(tr('b2190_back'),'menu:back')]]).reply_markup });
});
bot.action('admin:reports', async ctx => { await ctx.answerCbQuery(); await ctx.reply(tr('b2192_pending_reports'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.webApp(tr('b2192_admin_center'), W('/admin'))],[Markup.button.callback(tr('b2192_back'),'menu:back')]]).reply_markup }); });

// ── Photo handler → delegated to the seller-deal flow (1–4 images) ──────────
bot.on('photo', async ctx => {
    const s = getSession(tgId(ctx));
    try { if (await sellerH.handlePhoto(ctx, s)) return; } catch (e) { console.warn('photo:', e.message); }
});

// ── Free text (multi-step flows + shortcuts) ──────────────────────────────────
bot.on('text', async ctx => {
    if (!checkRL(`text:${chatId(ctx)}`)) return;
    const s = getSession(tgId(ctx));
    const text = sanitize(ctx.message.text, 500);
    const lc = text.toLowerCase().trim();

    // خطوات التاجر (إضافة/تعديل عرض + فروع) تعالَج أولاً في الوحدة المستقلة.
    try { if (await sellerH.handleText(ctx, s, text)) return; } catch (e) { console.warn('sellerText:', e.message); }

    // Reply-keyboard "إلغاء" (from the share-location prompt) → drop the keyboard + reset.
    if (text === '❌ إلغاء') { setStep(tgId(ctx),'idle'); s.temp.locCtx=null; s.temp.alertLocWait=false; s.temp.nearbyLocWait=false; await ctx.reply(tr('b2211_cancelled'), { parse_mode:'MarkdownV2', reply_markup: Markup.removeKeyboard().reply_markup }); const ns = await refreshSession(ctx); return sendMain(ctx, ns); }

    // Google-Maps link or "lat,lng" pasted as text → treat it as a shared location
    // (request 5). Guarded to idle / awaiting-location so it never hijacks a note,
    // search query, rating comment, etc.
    if (s.step === 'idle' || s.temp.nearbyLocWait || s.temp.alertLocWait) {
        let g = G.parseLatLng(text) || G.extractFromMapsUrl(text);
        if (!g && /^https?:\/\//i.test(text) && /(google\.[a-z.]+\/maps|goo\.gl|maps\.app\.goo\.gl|\/maps\b|[?&](?:q|ll|center|destination|daddr)=)/i.test(text)) {
            await ctx.reply(tr('b2219_reading_location_from_link'));
            g = await G.resolveGoogleLocation(text);
        }
        if (g) return handleSharedLocation(ctx, s, g.lat, g.lng);
        if ((s.temp.nearbyLocWait || s.temp.alertLocWait) && /^https?:\/\//i.test(text)) {
            return ctx.reply(tr('b2224_link_loc_failed'), { parse_mode:'MarkdownV2' });
        }
    }

    // Session-loss guards: if the edit context vanished (e.g. bot restarted between
    // tapping a field and typing), say so clearly instead of a confusing fall-through. v11.72
    if (['await_edit_qty','await_edit_note'].includes(s.step) && !s.temp.editBarcode) {
        setStep(tgId(ctx),'idle');
        return ctx.reply(tr('b2232_edit_session_ended'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2232_my_bookings_btn'),'buyer:bookings')]]).reply_markup });
    }

    if (s.step === 'await_barcode') { setStep(tgId(ctx),'idle'); return doVerify(ctx, text.trim().toUpperCase()); }
    if (s.step === 'await_book_qty') {
        const q = numOf(text);
        if (!isQty(text) || q < 1) return ctx.reply(tr('b2238_send_valid_number'));
        const cap = Number(s.temp.dealMaxPer) || 0;
        if (cap && q > cap) return ctx.reply(tr('bk_err_max_qty', cap));   // v12.28
        s.temp.dealQty = q; setStep(tgId(ctx),'idle'); return askPrep(ctx, s);
    }
    if (s.step === 'await_prep') {
        const mins = numOf(text);
        if (!isQty(text) || mins < 1 || mins > 1440) return ctx.reply(tr('b2243_send_valid_minutes'));
        s.temp.prepTime = `${mins}min`; setStep(tgId(ctx),'idle'); return askNote(ctx, s);
    }
    if (s.step === 'await_note') {
        s.temp.notes = text.slice(0,300); setStep(tgId(ctx),'idle'); return bookConfirm(ctx, s);
    }
    if (s.step === 'await_chat_msg') {
        const bc = s.temp.chatBarcode; setStep(tgId(ctx),'idle');
        if (!bc) return ctx.reply(tr('b2251_session_ended'), { parse_mode:'MarkdownV2' });
        const r = await rpc('bot_send_booking_message', { p_telegram_id: tgId(ctx), p_barcode: bc, p_body: text });
        if (!r?.success) {
            const e=r?.error; const msg = e==='cap_reached' ? tr('b2254_chat_cap_reached') : e==='cancelled' ? tr('b2254_chat_cancelled') : (e==='completed'||e==='expired') ? tr('b2254_chat_finished') : e==='bad_length' ? tr('b2254_chat_bad_length') : tr('b2254_chat_send_failed');
            await ctx.reply(msg, { parse_mode:'MarkdownV2' });
        }
        return renderChat(ctx, bc);
    }
    if (s.step === 'await_complete_msg') {
        const bc = s.temp.completeBarcode; setStep(tgId(ctx),'idle');
        if (!bc) return ctx.reply(tr('b2261_session_ended_reopen'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2261_bookings_btn'),'seller:bookings')]]).reply_markup });
        return doComplete(ctx, bc, text.slice(0,300));
    }
    if (s.step === 'await_edit_qty') {
        const q = numOf(text);
        if (!isQty(text) || q < 1) return ctx.reply(tr('b2266_send_valid_number'));
        setStep(tgId(ctx),'idle');
        const r = await rpc('bot_update_booking', { p_telegram_id: tgId(ctx), p_barcode: s.temp.editBarcode, p_quantity: q });
        return afterEdit(ctx, r);
    }
    if (s.step === 'await_edit_note') {
        setStep(tgId(ctx),'idle');
        const r = await rpc('bot_update_booking', { p_telegram_id: tgId(ctx), p_barcode: s.temp.editBarcode, p_notes: text.slice(0,300) });
        return afterEdit(ctx, r);
    }
    if (s.step === 'await_rate_comment') {
        setStep(tgId(ctx),'idle');
        const r = await rpc('bot_rate_store', { p_telegram_id: tgId(ctx), p_barcode: s.temp.rateBarcode, p_score: s.temp.rateScore, p_comment: text.slice(0,400) });
        return afterRate(ctx, r);
    }
    if (s.step === 'await_alert_kw') {
        setStep(tgId(ctx),'idle');
        const r = await rpc('bot_add_notif_keyword', { p_telegram_id: tgId(ctx), p_keyword: text.slice(0,40) });
        if (!r?.success) {
            const e=r?.error; const msg = e==='exists' ? tr('b2285_kw_exists') : e==='too_many' ? tr('b2285_kw_too_many') : e==='bad_length' ? tr('b2285_kw_bad_length') : e==='not_linked' ? tr('b2285_kw_not_linked') : tr('b2285_kw_add_failed');
            await ctx.reply(msg, { parse_mode:'MarkdownV2' });
        } else {
            await ctx.reply(tr('b2288_kw_added'), { parse_mode:'MarkdownV2' });
        }
        return showKeywords(ctx);
    }
    if (s.step === 'await_smart_kw') {                               // Task 13 — smart-alert keyword
        setStep(tgId(ctx),'idle');
        const kw = text.trim().slice(0,40);
        if (kw.length < 2) return ctx.reply(tr('b2295_clearer_keyword'), { parse_mode:'MarkdownV2' });
        const d = s.temp.alertDraft || (s.temp.alertDraft = newDraft());
        if (!d.keywords.includes(kw)) d.keywords.push(kw);
        return showSmartBuilder(ctx);
    }
    if (s.step === 'await_report') {                                 // Task 2 — report reason
        setStep(tgId(ctx),'idle');
        const reason = text.trim().slice(0,1000);
        const sid = s.temp.reportStore;
        if (reason.length < 5) { setStep(tgId(ctx),'await_report'); return ctx.reply(tr('b2304_clearer_reason'), { parse_mode:'MarkdownV2' }); }
        const r = await rpc('bot_report', { p_telegram_id: tgId(ctx), p_store_id: sid, p_type: s.temp.reportType||'other', p_reason: reason });
        s.temp.reportStore=null; s.temp.reportType=null;
        if (!r?.success) {
            const e=r?.error; const msg = e==='self' ? tr('b2308_report_self') : e==='same_role' ? tr('b2308_report_same_role') : e==='short_reason' ? tr('b2308_report_short') : e==='not_linked' ? tr('b2308_report_not_linked') : tr('b2308_report_failed');
            return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('cm_menu'),'menu:back')]]).reply_markup });
        }
        return ctx.reply(tr('b2311_report_sent'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([...(sid?[[Markup.button.callback(tr('b2311_back_to_store'),`store:${sid}`)]]:[]),[Markup.button.callback(tr('b2309_menu_btn'),'menu:back')]]).reply_markup });
    }
    if (s.step === 'await_bio') {                                    // Task 5 — seller store bio
        setStep(tgId(ctx),'idle');
        const r = await rpc('bot_update_store_bio', { p_telegram_id: tgId(ctx), p_bio: text.slice(0,500) });
        if (!r?.success) return ctx.reply(tr('b2316_bio_save_failed'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2316_store_account_btn'),'seller:profile')]]).reply_markup });
        await ctx.reply(tr('b2317_bio_saved'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2316_store_account_btn'),'seller:profile')],[Markup.button.callback(tr('b2309_menu_btn'),'menu:back')]]).reply_markup });
        return;
    }
    if (s.step === 'await_hours_all') {                              // v11.77 — same hours for all 7 days
        const pr = parseHoursInput(text);
        if (pr.error) { return ctx.reply(tr(hoursErrKey(pr.error)), { parse_mode:'MarkdownV2' }); }
        const shifts = pr.shifts;
        setStep(tgId(ctx),'idle');
        const days={}; for(let d=0;d<7;d++) days[String(d)]=shifts.map(x=>[x[0],x[1]]);
        const r = await rpc('bot_set_store_hours', { p_telegram_id: tgId(ctx), p_hours: { enabled:true, days } });
        if (!r?.success) return ctx.reply(tr('b2326_save_failed'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2326_working_hours_btn'),'seller:hours')]]).reply_markup });
        await ctx.reply(tr('b2327_hours_saved_all'), { parse_mode:'MarkdownV2' });
        return showSellerHours(ctx);
    }
    if (s.step === 'await_hours_day') {                              // v11.77 — one specific day
        const pr = parseHoursInput(text);
        if (pr.error) { return ctx.reply(tr(hoursErrKey(pr.error)), { parse_mode:'MarkdownV2' }); }
        const shifts = pr.shifts;
        setStep(tgId(ctx),'idle');
        const ok = await saveDayHours(ctx, s.temp.hoursDay ?? 0, shifts);
        if (!ok) return ctx.reply(tr('b2335_save_failed'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2335_working_hours_btn'),'seller:hours')]]).reply_markup });
        await ctx.reply(tr('b2336_hours_saved_day', md(tr('day_'+(s.temp.hoursDay ?? 0)))), { parse_mode:'MarkdownV2' });
        return showSellerHours(ctx);
    }
    if (s.step === 'await_search') {                                 // Task 4
        const q = text.trim().slice(0,60);
        if (q.length < 2) return ctx.reply(tr('b2341_clearer_search'), { parse_mode:'MarkdownV2' });
        return runSearch(ctx, q);
    }
    if (s.step === 'await_contest_answer') {                         // Task 5b — quiz
        const w = s.temp.cwiz; setStep(tgId(ctx),'idle');
        if (!w) return ctx.reply(tr('b2346_contest_session_ended'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2346_contests_btn'),'contests:list')]]).reply_markup });
        const q = w.questions[w.qi]; if (q) w.answers[q.id] = text.slice(0,200); w.qi++;
        return askContestStep(ctx);
    }
    if (s.step === 'await_contest_social') {                         // Task 5b — social tasks
        const w = s.temp.cwiz; setStep(tgId(ctx),'idle');
        if (!w) return ctx.reply(tr('b2352_contest_session_ended'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2352_contests_btn'),'contests:list')]]).reply_markup });
        const t = w.social[w.si]; if (t) w.social_answers[t.id] = text.slice(0,200); w.si++;
        return askContestStep(ctx);
    }
    if (['menu','قائمة','القائمة','ابدأ','start','مرحبا','مرحباً','اهلا','أهلا','السلام عليكم'].includes(lc)) { const ns = await refreshSession(ctx); return sendMain(ctx, ns); }
    if (['عروض','deals','تخفيضات'].some(k=>lc.includes(k))) return enterBrowse(ctx);
    if (['بحث','search'].includes(lc)) { setStep(tgId(ctx),'await_search'); return ctx.reply(tr('b2358_search_prompt'), { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(tr('b2358_menu_btn'),'browse:menu')]]).reply_markup }); }
    if (['مسابقات','مسابقة','جوائز','contests'].some(k=>lc.includes(k))) return showContests(ctx);
    if (['مساعدة','help'].includes(lc)) return showHelp(ctx);
    if (['حجوزاتي','bookings'].includes(lc)) return buyerBookingsMenu(ctx);
    if (['تنبيهات','تنبيهاتي','alerts'].includes(lc)) return showAlerts(ctx);
    if (['خروج','تسجيل الخروج','تسجيل خروج','logout'].includes(lc)) return startLogout(ctx);
    if (['ربط','link'].includes(lc)) return startLink(ctx);

    const ns = await refreshSession(ctx);
    await ctx.reply(ns.userId ? tr('b2367_choose_from_menu') : tr('b2367_type_menu_or_link'), { parse_mode:'MarkdownV2', reply_markup: roleKb(ns).reply_markup });
});

bot.catch((err,ctx) => console.error(`Bot error [${ctx?.updateType}]:`, err?.message||err));

app.post('/webhook/telegram', (req, res) => {
    if (!TELEGRAM_WEBHOOK_SECRET) return res.status(503).json({ error:'not configured' });
    if (req.headers['x-telegram-bot-api-secret-token'] !== TELEGRAM_WEBHOOK_SECRET) return res.status(403).json({ error:'Forbidden' });
    // Never let a rejected update escape as an unhandled rejection (→ status-1 crash). v11.90
    Promise.resolve(bot.handleUpdate(req.body, res)).catch(e => console.error('handleUpdate:', e?.message || e));
});

} // end if(bot)

// ═══════════════════════════════════════════════════════════════════════════════
//  Realtime: push notifications to Telegram — smart-alerts + ALL booking events
//  (new / acknowledged / completed / cancelled / expired / 15-min warning).
//  Everything flows through the single `notifications` table = one DB, one source,
//  so a subscriber gets the same alerts whether on the website, app, or bot.
// ═══════════════════════════════════════════════════════════════════════════════
const DEBOUNCE = new Map();
// Emoji prefix per notification type — keeps every alert visually consistent.
const NOTIF_ICON = { booking:'📦', deal:'🆕', marketing:'📣', system:'🔔', follow:'➕', rating:'⭐', review:'⭐', contest:'🎁', survey:'📝', subscription:'💳', report:'🚩', sponsor:'⭐', campaign:'📣', analytics:'📊' };

// ── One fan-out for EVERY website notification → all channels the user enabled ──
// The website, app, Telegram and WhatsApp all read the same `notifications` row,
// so a user gets the *identical* alert everywhere. Telegram is live now; WhatsApp
// turns on the instant its creds are set (no code change). Professional, modern,
// one source of truth.
async function deliverNotification(n) {
    const aud = n.meta_data?.audience, ev = n.meta_data?.event, bc = n.meta_data?.barcode;
    const isMsg = !!n.meta_data?.isMessage;
    // Audience guards (mirror in-app routing): admins use the in-app center (no
    // per-event booking firehose). The buyer's OWN brand-new booking IS echoed to
    // the bot — EXCEPT when the bot itself just made it (already shown inline).
    if (n.type==='booking') {
        if (aud==='admin') return;
        if (ev==='new' && aud==='buyer' && bc && botBookedBarcodes.has(bc)) { botBookedBarcodes.delete(bc); return; }
    }
    // Debounce ONLY the marketing/deal stream (it can burst); every other type is
    // a discrete event the user should always receive.
    if (n.type==='deal' || n.type==='marketing') {
        if (Date.now() - (DEBOUNCE.get(n.user_id)||0) < 20_000) return;
        DEBOUNCE.set(n.user_id, Date.now());
    }
    // Channel prefs come ENRICHED on the outbox row (definer RPC) — no RLS-blocked
    // users read needed (that read returned null for buyers, killing delivery).
    const en    = (n.preferred_lang||'').startsWith('en');
    const title = (en ? (n.title_en||n.title_ar) : (n.title_ar||n.title_en)) || '';
    const body  = (en ? (n.body_en ||n.body_ar ) : (n.body_ar ||n.body_en )) || '';
    const custom= en ? n.meta_data?.bot_message_en : n.meta_data?.bot_message_ar;
    const icon  = NOTIF_ICON[n.type] || '🔔';

    // Contextual action buttons (Telegram).
    const rows = [];
    if (n.type==='booking' && bc) {
        if (isMsg) rows.push([Markup.button.callback(tr('nt_open_chat'),`chat:${bc}`)]);
        else if (aud==='seller' && ev==='new') { rows.push([Markup.button.callback(tr('nt_confirm_start'),`ack:${bc}`)]); rows.push([Markup.button.callback(tr('nt_complete'),`complete:${bc}`), Markup.button.callback(tr('cm_chat'),`chat:${bc}`)]); rows.push([Markup.button.callback(tr('b1205_cancel_booking'),`scancel:${bc}`)]); }
        else if (aud==='buyer'  && ev==='completed') rows.push([Markup.button.callback(tr('nt_rate'),`rate:${bc}`)]);
        else if (aud==='buyer'  && ev==='new') { rows.push([Markup.button.callback(tr('cm_my_bookings'),'buyer:bookings'), Markup.button.callback(tr('cm_chat'),`chat:${bc}`)]); rows.push([Markup.button.callback(tr('b1205_cancel_booking'),`cancel:${bc}`)]); }
        else if (aud==='buyer'  && (ev==='acknowledged' || ev==='warning')) rows.push([Markup.button.callback(tr('cm_chat'),`chat:${bc}`)]);
        else rows.push([Markup.button.callback(tr('cm_bookings'), aud==='seller'?'seller:bookings':'buyer:bookings')]);
    }
    // Reports → admin (مركز البلاغات) • analytics → the relevant stats screen. v11.72
    else if (n.type==='report')    rows.push([Markup.button.callback(tr('nt_view_reports'),'admin:reports')]);
    else if (n.type==='analytics') rows.push([Markup.button.callback(tr('nt_statistics'), aud==='admin'?'admin:stats':'seller:stats')]);
    // A "فتح" deep-link for content notifications that point somewhere specific.
    const dealId = n.meta_data?.deal_id || n.meta_data?.dealId;
    const storeId = n.meta_data?.store_id || n.meta_data?.storeId;
    let url = null;
    if (n.type==='booking' && bc) url = W(`/booking/${bc}`);
    else if (dealId)  url = W(`/deal/${dealId}`);
    else if (storeId) url = W(`/store/${storeId}`);
    else if (n.meta_data?.action_url) url = n.meta_data.action_url;

    // ── Telegram ── (gated by the admin kill-switch for parity with WhatsApp:
    //    a disabled bot stops OUTBOUND notifications too, not just inbound. v11.97b)
    if (n.telegram_chat_id && n.notify_via_telegram && await botEnabled()) {
        const text = custom ? `${icon} ${md(custom)}` : `${icon} *${md(title)}*\n${md(body)}`;
        const kbRows = rows.slice();
        if (!kbRows.length && url) kbRows.push([Markup.button.url(tr('b2445_open_link'), url)]);
        try {
            await bot.telegram.sendMessage(n.telegram_chat_id, text,
                { parse_mode:'MarkdownV2', link_preview_options:{is_disabled:true},
                  ...(kbRows.length ? { reply_markup: Markup.inlineKeyboard(kbRows).reply_markup } : {}) });
        } catch(e) { console.warn('TG notif:', e.message); }
    }
    // ── WhatsApp (parity) — live the instant WHATSAPP_* creds are set; sendWA is a
    //    no-op until then. NB: outside Meta's 24h service window an *approved
    //    template* is required (free-form text only delivers inside the window).
    if (n.whatsapp_chat_id && n.notify_via_whatsapp && WA.enabled()) {
        // الوحدة تبني الرسالة + أزرار الإجراء (تأكيد/محادثة/تقييم) بلغة المستلم. v11.94
        try { await WA.deliverNotification(n); }
        catch(e) { console.warn('WA notif:', e.message); }
    }
}

// ── Outbox poll — the reliable, anon-safe delivery path ───────────────────────
// Realtime + the anon key can't read other users' `notifications` rows (RLS:
// notifs_select_own = auth.uid()=user_id) nor a buyer's telegram_chat_id (users
// public = sellers only), so the realtime path delivered NOTHING to buyers/admins
// and never delivered chat messages either. Instead we poll a SECURITY DEFINER
// outbox (bot_pull_outbox) every few seconds: it bypasses RLS safely, enriches
// each row with the recipient's channel prefs, and atomically marks it delivered.
// Booking chat messages already become `notifications` rows (DB trigger), so they
// flow through here too. Survives Render restarts (2-day replay window).
// One DB, one source of truth → website, app & bot get the identical alert.
if (supabase && bot) {
    let outboxBusy = false;
    async function drainOutbox() {
        if (outboxBusy) return;            // never overlap polls
        outboxBusy = true;
        // When the admin disables the bot we still advance the outbox cursor but send
        // NOTHING — so the kill-switch silences notifications too, with no stale flood
        // when it's switched back on (request 2).
        const enabled = await botEnabled();
        try {
            let batch;
            do {
                batch = await rpc('bot_pull_outbox', { p_limit: 25 });
                if (enabled && Array.isArray(batch) && batch.length) {
                    for (const n of batch) { try { await deliverNotification(n); } catch(e) { console.warn('deliver:', e.message); } }
                }
            } while (Array.isArray(batch) && batch.length === 25);   // drain a backlog fast
        } catch(e) { console.warn('outbox poll:', e.message); }
        finally { outboxBusy = false; }
    }
    setInterval(drainOutbox, 2000).unref?.();
    console.log('📤 إشعارات البوت عبر outbox — سحب كل ثانيتين (آمن مع مفتاح anon: حجوزات + رسائل + تنبيهات + تحليلات + كل أحداث الموقع — يصل شبه فوري كالتطبيق)');
}

// ── Email dispatcher (v12.27) ─────────────────────────────────────────────────
// The admin «الإشعارات والرسائل» tab can route lifecycle messages (subscription
// warning/expired/cancelled, new-subscription invoice, booking reminder) to
// email. DB functions render + queue the HTML into email_outbox; this 24/7
// process is the ONLY sender. Configure SMTP on Render (a Gmail app-password
// works): SMTP_USER + SMTP_PASS, optional SMTP_HOST/SMTP_PORT/SMTP_FROM.
// Without creds it stays dormant and reports «غير مهيأ» to the admin tab.
let mailer = null, mailerFrom = '';
if (supabase) {
    try {
        if (process.env.SMTP_USER && process.env.SMTP_PASS) {
            const nodemailer = require('nodemailer');
            const smtpPort = Number(process.env.SMTP_PORT || 465);
            mailerFrom = process.env.SMTP_FROM || process.env.SMTP_USER;
            mailer = nodemailer.createTransport({
                host: process.env.SMTP_HOST || 'smtp.gmail.com',
                port: smtpPort,
                secure: smtpPort === 465,
                auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
            });
        }
    } catch (e) { console.error('mailer init:', e.message); }
    // Tell the admin tab whether email delivery is live (best-effort, on boot).
    rpc('bot_report_email_status', { p_configured: !!mailer, p_from: mailerFrom });
    if (mailer) {
        let emailBusy = false;
        const drainEmails = async () => {
            if (emailBusy) return;             // never overlap polls
            emailBusy = true;
            try {
                const batch = await rpc('bot_pull_email_outbox', { p_limit: 10 });
                if (Array.isArray(batch)) for (const m of batch) {
                    try {
                        await mailer.sendMail({ from: `TAKI تاكي <${mailerFrom}>`, to: m.to_email, subject: m.subject, html: m.html });
                        await rpc('bot_mark_email', { p_id: m.id, p_ok: true });
                    } catch (e) {
                        console.error('email send:', m.to_email, e.message);
                        await rpc('bot_mark_email', { p_id: m.id, p_ok: false, p_error: String(e.message || e).slice(0, 300) });
                    }
                }
            } catch (e) { console.warn('email poll:', e.message); }
            finally { emailBusy = false; }
        };
        setInterval(drainEmails, 45_000).unref?.();
        drainEmails();
        console.log(`📧 مرسل الإيميل مفعّل عبر SMTP (${mailerFrom}) — سحب من email_outbox كل 45 ثانية`);
    } else {
        console.log('📧 مرسل الإيميل غير مهيأ — اضبط SMTP_USER و SMTP_PASS في Render لتفعيله');
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WhatsApp Cloud API — منطق القناة كاملاً في flows/whatsapp.js (الكائن WA أعلاه).
//  bot.js يملك هنا النقل فقط: تحقّق webhook (GET) + توقيع HMAC (POST)، ثم يفوّض كل
//  رسالة واردة إلى WA.handleMessage. كل المنطق والـi18n والهوية في الوحدة (لا دين تقني).
//  v11.91: مشتري+تاجر بالتطابق مع تيليجرام، خامل حتى تُضبط WHATSAPP_* في البيئة.
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/webhook/whatsapp', (req, res) => {
    if (req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===WHATSAPP_VERIFY_TOKEN && WHATSAPP_VERIFY_TOKEN) return res.status(200).send(req.query['hub.challenge']);
    res.status(403).send('Forbidden');
});
app.post('/webhook/whatsapp', async (req, res) => {
    if (!WHATSAPP_APP_SECRET) return res.status(503).json({ error:'not configured' });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const expected = 'sha256=' + crypto.createHmac('sha256', WHATSAPP_APP_SECRET).update(raw).digest('hex');
    try { if (!crypto.timingSafeEqual(Buffer.from(req.headers['x-hub-signature-256']||''), Buffer.from(expected))) return res.status(403).json({error:'Invalid signature'}); }
    catch { return res.status(403).json({error:'Invalid signature'}); }
    let body; try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({error:'Bad JSON'}); }
    res.status(200).send('OK');
    try {
        for (const entry of body?.entry||[]) for (const change of entry.changes||[]) {
            // فشل التسليم يصل كتقرير status ولا يُرى في أي مكان آخر — نسجّله وإلا ضاع السبب (v12.23)
            for (const st of change.value?.statuses||[]) if (st.status === 'failed') console.error('WA delivery FAILED →', st.recipient_id, JSON.stringify(st.errors||[]));
            for (const msg of change.value?.messages||[]) {
                const from = msg.from; if (!from || !checkRL(`wa:${from}`)) continue;
                await WA.handleMessage(from, msg);
            }
        }
    } catch(e) { console.error('WA processing:', e.message); }
});

// ── Health + Boot ─────────────────────────────────────────────────────────────
app.get('/health', (_,res) => res.json({ status:'active', version:BOT_VERSION, mode:BOT_MODE, uptime:Math.round(process.uptime()), services:{ telegram:!!bot, supabase:!!supabase, photo_upload:!!BOT_GATEWAY_SECRET, email:!!mailer } }));
app.listen(PORT, () => {
    console.log(`🚀 TAKI Bot v${BOT_VERSION} | port ${PORT} | mode: ${BOT_MODE}`);
    if (!TELEGRAM_TOKEN) console.warn('⚠️  TELEGRAM_BOT_TOKEN missing');
    if (!SUPABASE_URL)   console.warn('⚠️  SUPABASE_URL missing');
});
if (bot && BOT_MODE === 'polling') {
    bot.launch({ dropPendingUpdates: true }).then(() => console.log('🤖 Bot LIVE — polling mode')).catch(e => console.error('❌ Launch failed:', e.message));
} else if (bot && BOT_MODE === 'webhook') {
    // Auto-register the Telegram webhook so a fresh cloud deploy (Render / Railway)
    // is reachable with ZERO manual steps. Render exposes its public URL as
    // RENDER_EXTERNAL_URL; PUBLIC_URL overrides for any other host.
    const base = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
    if (base && TELEGRAM_WEBHOOK_SECRET) {
        bot.telegram.setWebhook(`${base}/webhook/telegram`, { secret_token: TELEGRAM_WEBHOOK_SECRET, drop_pending_updates: true })
            .then(() => console.log(`🔗 Webhook registered → ${base}/webhook/telegram`))
            .catch(e => console.error('❌ setWebhook failed:', e.message));
    } else {
        console.warn('⚠️  webhook mode but PUBLIC_URL / RENDER_EXTERNAL_URL or TELEGRAM_WEBHOOK_SECRET is missing — webhook NOT registered');
    }
}

// ── Keep-alive (free hosting) ──────────────────────────────────────────────────
// Render's free tier sleeps a web service after ~15 min with no inbound HTTP.
// We ping our OWN public /health every 10 min (well under that threshold) so the
// bot NEVER idles into sleep — 24/7 on the free plan, no external uptime service.
// No-op locally (no public URL), so it only kicks in on the cloud host.
const KEEPALIVE_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
if (KEEPALIVE_URL) {
    const selfPing = () => { try { fetch(`${KEEPALIVE_URL}/health`).catch(() => {}); } catch { /* fetch unavailable */ } };
    setTimeout(selfPing, 30_000);                  // first ping shortly after boot
    setInterval(selfPing, 10 * 60_000).unref?.();  // then every 10 minutes
    console.log(`💓 Keep-alive: self-ping every 10 min → ${KEEPALIVE_URL}/health`);
}

process.once('SIGINT',  () => bot?.stop('SIGINT'));
process.once('SIGTERM', () => bot?.stop('SIGTERM'));
