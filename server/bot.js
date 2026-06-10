/**
 * TAKI Bot — v8.0 Professional Edition
 * ─────────────────────────────────────
 * • Role-based menus: buyer / seller / admin
 * • Full seller panel: stats, bookings, verify, complete, add/toggle deals
 * • Full buyer panel: browse deals, my bookings
 * • Admin panel: platform stats, pending reports
 * • Guided multi-step flows (account linking, add deal)
 * • Supabase Realtime → push notifications to linked users
 * • WhatsApp Cloud API support
 * • Always-on via Railway (BOT_MODE=polling) or webhook (production)
 */

try { require('dotenv').config(); } catch { /* dotenv optional */ }

const express  = require('express');
const crypto   = require('crypto');
const { Telegraf, Markup } = require('telegraf');
const { createClient }     = require('@supabase/supabase-js');

// ─── Config ──────────────────────────────────────────────────────────────────
const SUPABASE_URL             = process.env.SUPABASE_URL;
const SUPABASE_KEY             = process.env.SUPABASE_ANON_KEY || '';
const TELEGRAM_TOKEN           = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_WEBHOOK_SECRET  = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const WHATSAPP_VERIFY_TOKEN    = process.env.WHATSAPP_VERIFY_TOKEN || '';
const WHATSAPP_APP_SECRET      = process.env.WHATSAPP_APP_SECRET || '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN || '';
const APP_URL                  = process.env.APP_URL || 'https://taki-test-eight.vercel.app';
const BOT_MODE                 = (process.env.BOT_MODE || 'webhook').toLowerCase();
const PORT                     = process.env.PORT || 3000;
const BOT_VERSION              = '8.0.0';

// ─── Clients ─────────────────────────────────────────────────────────────────
const supabase = (SUPABASE_URL && SUPABASE_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_KEY)
    : null;
const bot = TELEGRAM_TOKEN ? new Telegraf(TELEGRAM_TOKEN) : null;

// ─── Express ─────────────────────────────────────────────────────────────────
const app = express();
app.use('/webhook/whatsapp', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// Global rate limit (IP-based)
const globalRL = new Map();
app.use((req, res, next) => {
    if (req.path === '/health') return next();
    const ip = req.ip || req.headers['x-forwarded-for'] || 'x';
    const now = Date.now();
    const e = globalRL.get(ip);
    if (!e || now - e.t > 300_000) { globalRL.set(ip, { t: now, n: 1 }); return next(); }
    if (++e.n > 300) return res.status(429).json({ error: 'Too many requests' });
    next();
});
setInterval(() => { const n = Date.now(); for (const [k,v] of globalRL) if (n - v.t > 600_000) globalRL.delete(k); }, 600_000).unref?.();

// ─── Security: per-chat rate limit ───────────────────────────────────────────
const chatRL = new Map();
function checkRL(key) {
    const now = Date.now();
    const e = chatRL.get(key);
    if (!e || now - e.t > 60_000) { chatRL.set(key, { t: now, n: 1 }); return true; }
    return ++e.n <= 30;
}
setInterval(() => { const n = Date.now(); for (const [k,v] of chatRL) if (n - v.t > 120_000) chatRL.delete(k); }, 300_000).unref?.();

// ─── Input helpers ────────────────────────────────────────────────────────────
function sanitize(str, max = 300) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/<[^>]*>?/gm, '').trim().substring(0, max);
}
function isPhone(p)   { return /^05\d{8}$/.test(p); }
function isPrice(p)   { return /^\d+(\.\d{1,2})?$/.test(p) && parseFloat(p) > 0; }
function isQty(q)     { return /^\d+$/.test(q) && parseInt(q) >= 0; }

// MarkdownV2 escaper
function md(text) {
    if (text == null) return '';
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

// ─── Session State (in-memory, 30-min TTL) ───────────────────────────────────
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function getSession(chatId) {
    const key = String(chatId);
    let s = sessions.get(key);
    if (!s || Date.now() - s.lastAt > SESSION_TTL) {
        s = { step: 'idle', userId: null, userType: null, name: null,
              shop: null, isAdmin: false, temp: {}, lastAt: Date.now() };
        sessions.set(key, s);
    }
    s.lastAt = Date.now();
    return s;
}
function setStep(chatId, step, extra = {}) {
    const s = getSession(chatId);
    s.step = step;
    Object.assign(s, extra);
}
setInterval(() => {
    const n = Date.now();
    for (const [k, v] of sessions) if (n - v.lastAt > SESSION_TTL) sessions.delete(k);
}, 10 * 60 * 1000).unref?.();

// ─── Supabase RPC wrappers ───────────────────────────────────────────────────
async function rpc(fn, args) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase.rpc(fn, args);
        if (error) { console.error(`RPC ${fn} error:`, error.message); return null; }
        return data;
    } catch (e) { console.error(`RPC ${fn} exception:`, e.message); return null; }
}

async function getActiveDeals(limit = 8) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('deals')
            .select('id, item_name, shop_name, original_price, discounted_price, discount_percentage, quantity, is_unlimited, city, region')
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(limit);
        return error ? [] : (data || []);
    } catch { return []; }
}

// ─── Menu builders ───────────────────────────────────────────────────────────
function menuGuest() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🔗 ربط حسابي', 'link:start')],
        [Markup.button.callback('🔥 تصفح العروض', 'browse:deals')],
        [Markup.button.webApp('🚀 فتح تاكي', APP_URL)],
        [Markup.button.callback('🆘 مساعدة', 'help')]
    ]);
}

function menuBuyer() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🔥 العروض النشطة',  'browse:deals'),
         Markup.button.callback('🎟 حجوزاتي',        'buyer:bookings')],
        [Markup.button.callback('🔔 تنبيهاتي',       'buyer:notif'),
         Markup.button.callback('👤 حسابي',           'buyer:profile')],
        [Markup.button.webApp('🚀 فتح تاكي (دخول تلقائي)', APP_URL)],
        [Markup.button.callback('🆘 مساعدة', 'help')]
    ]);
}

function menuSeller() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('📊 إحصائياتي',      'seller:stats'),
         Markup.button.callback('📦 الحجوزات الواردة', 'seller:bookings')],
        [Markup.button.callback('✅ تحقق من حجز',    'seller:verify'),
         Markup.button.callback('🏷 عروضي',          'seller:deals')],
        [Markup.button.callback('➕ إضافة عرض',      'seller:addDeal'),
         Markup.button.callback('👤 حسابي',          'seller:profile')],
        [Markup.button.webApp('🚀 لوحة التاجر', APP_URL + '/#/seller'),
         Markup.button.callback('🆘 مساعدة', 'help')]
    ]);
}

function menuAdmin() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('📊 إحصائيات المنصة', 'admin:stats'),
         Markup.button.callback('🚩 البلاغات المعلقة',  'admin:reports')],
        [Markup.button.webApp('🛡 لوحة الإدارة', APP_URL + '/#/admin'),
         Markup.button.callback('🆘 مساعدة', 'help')]
    ]);
}

function backBtn(action = 'menu') {
    return Markup.inlineKeyboard([[Markup.button.callback('◀️ رجوع للقائمة', action)]]);
}

// ─── Helpers: resolve user menu ───────────────────────────────────────────────
function roleMenu(s) {
    if (s.isAdmin)                   return menuAdmin();
    if (s.userType === 'merchant')   return menuSeller();
    if (s.userType === 'buyer')      return menuBuyer();
    return menuGuest();
}

function roleWelcome(s) {
    if (s.isAdmin)                   return `🛡 *مرحباً ${md(s.name)} — مدير المنصة*\nاختر من لوحة التحكم:`;
    if (s.userType === 'merchant')   return `🏪 *مرحباً ${md(s.name)}*\n🛍 متجرك: *${md(s.shop)}*\nاختر من لوحة التاجر:`;
    if (s.userType === 'buyer')      return `👋 *مرحباً ${md(s.name)}*\nتصفح العروض وأدر حجوزاتك من هنا:`;
    return `🛍️ *أهلاً في TAKI*\nاختر من القائمة أو اربط حسابك للمزيد:`;
}

// ─── Send menu (reusable) ─────────────────────────────────────────────────────
async function sendMenu(ctx, s) {
    await ctx.reply(roleWelcome(s), {
        parse_mode: 'MarkdownV2',
        reply_markup: roleMenu(s).reply_markup
    });
}

// ─── Load or refresh session from DB ─────────────────────────────────────────
async function refreshSession(chatId) {
    const s = getSession(chatId);
    if (s.userId) return s; // already loaded this session
    const user = await rpc('bot_get_user', { p_chat_id: chatId });
    if (user) {
        s.userId   = user.id;
        s.userType = user.user_type;
        s.name     = user.name;
        s.shop     = user.shop || null;
        s.isAdmin  = !!(user.is_super_admin ||
            (user.admin_permissions && user.admin_permissions.length > 0));
    }
    return s;
}

// ─── Status labels ────────────────────────────────────────────────────────────
const STATUS_LABELS = {
    pending:      '⏳ قيد الانتظار',
    acknowledged: '✅ مؤكد',
    completed:    '🏁 مكتمل',
    cancelled:    '❌ ملغي',
    active:       '🟢 نشط',
    paused:       '⏸ متوقف',
    draft:        '📝 مسودة',
    expired:      '🔴 منتهي'
};
function statusLabel(s) { return STATUS_LABELS[s] || md(s); }

// ─── Format date ─────────────────────────────────────────────────────────────
function fmtDate(d) {
    if (!d) return '—';
    try { return new Date(d).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' }); }
    catch { return String(d); }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TELEGRAM BOT HANDLERS
// ═══════════════════════════════════════════════════════════════════════════════
if (bot) {

    // ── Bot commands menu ─────────────────────────────────────────────────────
    bot.telegram.setMyCommands([
        { command: 'start',   description: 'القائمة الرئيسية' },
        { command: 'menu',    description: 'القائمة الرئيسية' },
        { command: 'deals',   description: 'العروض النشطة' },
        { command: 'link',    description: 'ربط حسابي' },
        { command: 'verify',  description: 'تحقق من حجز' },
        { command: 'stats',   description: 'إحصائياتي' },
        { command: 'help',    description: 'مساعدة' }
    ]).catch(e => console.warn('setMyCommands:', e.message));

    // ── /start ────────────────────────────────────────────────────────────────
    bot.start(async (ctx) => {
        if (!checkRL(`tg:${ctx.chat.id}`)) return;
        const s = await refreshSession(ctx.chat.id);
        await sendMenu(ctx, s);
    });

    // ── /menu ─────────────────────────────────────────────────────────────────
    bot.command('menu', async (ctx) => {
        const s = await refreshSession(ctx.chat.id);
        await sendMenu(ctx, s);
    });

    // ── /help ─────────────────────────────────────────────────────────────────
    bot.command('help', async (ctx) => showHelp(ctx));
    bot.action('help', async (ctx) => { await ctx.answerCbQuery(); await showHelp(ctx); });

    async function showHelp(ctx) {
        const s = await refreshSession(ctx.chat.id);
        let txt = `🆘 *مساعدة TAKI*\n\n`;
        if (!s.userId) {
            txt += `اربط حسابك أولاً بالضغط على "ربط حسابي"، ثم تصبح كل خيارات القائمة متاحة لك\\.\n\n`;
        }
        txt += `📌 *الأوامر المتاحة:*\n`;
        txt += `/menu — القائمة الرئيسية\n`;
        txt += `/deals — العروض النشطة\n`;
        txt += `/link — ربط حسابك\n`;
        if (s.userType === 'merchant' || s.isAdmin) txt += `/stats — إحصائياتك\n/verify — تحقق من حجز\n`;
        txt += `\n🌐 تطبيق تاكي: ${APP_URL}`;
        await ctx.reply(txt, { parse_mode: 'MarkdownV2', reply_markup: backBtn('menu:back').reply_markup });
    }

    // ── /link ─────────────────────────────────────────────────────────────────
    bot.command('link', async (ctx) => startLink(ctx));
    bot.action('link:start', async (ctx) => { await ctx.answerCbQuery(); await startLink(ctx); });

    async function startLink(ctx) {
        setStep(ctx.chat.id, 'await_phone');
        await ctx.reply(
            `📱 *ربط حساب TAKI*\n\nأرسل رقم جوالك المسجّل في تاكي:\n_مثال: 0512345678_`,
            { parse_mode: 'MarkdownV2',
              reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', 'link:cancel')]]).reply_markup }
        );
    }

    bot.action('link:cancel', async (ctx) => {
        await ctx.answerCbQuery();
        setStep(ctx.chat.id, 'idle');
        const s = await refreshSession(ctx.chat.id);
        await sendMenu(ctx, s);
    });

    // ── /deals ────────────────────────────────────────────────────────────────
    bot.command('deals', async (ctx) => showDeals(ctx));
    bot.action('browse:deals', async (ctx) => { await ctx.answerCbQuery(); await showDeals(ctx); });

    async function showDeals(ctx) {
        if (!checkRL(`tg:deals:${ctx.chat.id}`)) {
            return ctx.reply('⚠️ الرجاء الانتظار قبل المحاولة مجدداً\\.');
        }
        const deals = await getActiveDeals(8);
        if (!deals.length) {
            return ctx.reply('📭 *لا توجد عروض نشطة حالياً*\nتحقق لاحقاً\\!', {
                parse_mode: 'MarkdownV2',
                reply_markup: backBtn('menu:back').reply_markup
            });
        }
        let msg = `🔥 *أحدث العروض النشطة*\n\n`;
        const btns = [];
        deals.forEach((d, i) => {
            const pct = d.discount_percentage ||
                Math.round(((d.original_price - d.discounted_price) / d.original_price) * 100);
            const qty = d.is_unlimited ? 'غير محدود' : (d.quantity ?? '—');
            msg += `*${i + 1}\\. ${md(d.item_name)}*\n`;
            msg += `🏪 ${md(d.shop_name)}   📍 ${md(d.city || d.region || '—')}\n`;
            msg += `💰 *${md(d.discounted_price)} ر\\.س* ~~${md(d.original_price)}~~ — خصم *${pct}%*\n`;
            msg += `📦 الكمية: ${md(qty)}\n\n`;
            btns.push([Markup.button.url(`👁 ${String(d.item_name).substring(0, 28)}`, `${APP_URL}/#/deal/${d.id}`)]);
        });
        btns.push([Markup.button.callback('◀️ رجوع للقائمة', 'menu:back')]);
        await ctx.reply(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: Markup.inlineKeyboard(btns).reply_markup,
            link_preview_options: { is_disabled: true }
        });
    }

    // ── Back to menu ──────────────────────────────────────────────────────────
    bot.action('menu:back', async (ctx) => {
        await ctx.answerCbQuery();
        const s = await refreshSession(ctx.chat.id);
        await sendMenu(ctx, s);
    });

    // ─────────────────────────────────────────────────────────────────────────
    //  BUYER ACTIONS
    // ─────────────────────────────────────────────────────────────────────────

    // My bookings
    bot.action('buyer:bookings', async (ctx) => {
        await ctx.answerCbQuery();
        const s = await refreshSession(ctx.chat.id);
        if (!s.userId) return ctx.reply('❗ *اربط حسابك أولاً*\nاضغط /link', { parse_mode: 'MarkdownV2' });
        const result = await rpc('bot_get_my_bookings', { p_chat_id: ctx.chat.id });
        if (!result || !result.length) {
            return ctx.reply('📭 *لا توجد حجوزات بعد*', {
                parse_mode: 'MarkdownV2',
                reply_markup: backBtn('menu:back').reply_markup
            });
        }
        let msg = `🎟 *حجوزاتي* \\(${result.length}\\)\n\n`;
        result.forEach((b, i) => {
            msg += `*${i + 1}\\. ${md(b.deal_name)}*\n`;
            msg += `🏪 ${md(b.shop_name)}\n`;
            msg += `📋 الكود: \`${md(b.barcode)}\`\n`;
            msg += `📦 الكمية: ${md(b.quantity)}\n`;
            msg += `${statusLabel(b.status)}\n`;
            msg += `⏰ ${md(fmtDate(b.booked_at))}\n\n`;
        });
        await ctx.reply(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: backBtn('menu:back').reply_markup
        });
    });

    // Notifications toggle
    bot.action('buyer:notif', async (ctx) => {
        await ctx.answerCbQuery();
        const s = await refreshSession(ctx.chat.id);
        if (!s.userId) return ctx.reply('❗ *اربط حسابك أولاً*', { parse_mode: 'MarkdownV2' });
        await ctx.reply(
            `🔔 *التنبيهات عبر تيليجرام*\n\nتنبيهاتك مُفعَّلة على هذا الحساب\\.\nلتغيير إعدادات التنبيهات الذكية، افتح التطبيق:`,
            {
                parse_mode: 'MarkdownV2',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.webApp('⚙️ إعدادات التنبيهات', APP_URL + '/#/profile')],
                    [Markup.button.callback('◀️ رجوع', 'menu:back')]
                ]).reply_markup
            }
        );
    });

    // Buyer profile
    bot.action('buyer:profile', async (ctx) => {
        await ctx.answerCbQuery();
        const s = await refreshSession(ctx.chat.id);
        if (!s.userId) return ctx.reply('❗ *اربط حسابك أولاً*', { parse_mode: 'MarkdownV2' });
        await ctx.reply(
            `👤 *حسابي*\n\n*الاسم:* ${md(s.name)}\n*نوع الحساب:* ${s.userType === 'buyer' ? 'مشتري' : md(s.userType)}\n\nلتعديل بياناتك افتح التطبيق:`,
            {
                parse_mode: 'MarkdownV2',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.webApp('✏️ تعديل الحساب', APP_URL + '/#/profile')],
                    [Markup.button.callback('◀️ رجوع', 'menu:back')]
                ]).reply_markup
            }
        );
    });

    // ─────────────────────────────────────────────────────────────────────────
    //  SELLER ACTIONS
    // ─────────────────────────────────────────────────────────────────────────

    // Stats
    bot.command('stats', async (ctx) => showSellerStats(ctx));
    bot.action('seller:stats', async (ctx) => { await ctx.answerCbQuery(); await showSellerStats(ctx); });

    async function showSellerStats(ctx) {
        const s = await refreshSession(ctx.chat.id);
        if (!s.userId || s.userType !== 'merchant') {
            return ctx.reply('❗ هذا الخيار للتجار فقط\\. اربط حسابك بـ /link', { parse_mode: 'MarkdownV2' });
        }
        const stats = await rpc('bot_get_seller_stats', { p_chat_id: ctx.chat.id });
        if (!stats) return ctx.reply('⚠️ تعذّر تحميل الإحصائيات\\. حاول لاحقاً\\.', { parse_mode: 'MarkdownV2' });

        const expiry = stats.subscription_expires_at
            ? fmtDate(stats.subscription_expires_at) : '—';
        const plan = stats.subscription_plan || 'مجاني';

        const msg =
            `📊 *إحصائيات متجر ${md(stats.shop)}*\n\n` +
            `📦 إجمالي الحجوزات: *${md(stats.total_bookings)}*\n` +
            `🌅 حجوزات اليوم: *${md(stats.today_bookings)}*\n` +
            `⏳ بانتظار التأكيد: *${md(stats.pending_bookings)}*\n` +
            `🏷 عروض نشطة: *${md(stats.active_deals)}*\n` +
            `💰 إجمالي الإيرادات: *${md(stats.total_revenue)} ر\\.س*\n\n` +
            `🔖 الخطة: *${md(plan)}*\n` +
            `📅 تنتهي في: *${md(expiry)}*`;

        await ctx.reply(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: backBtn('menu:back').reply_markup
        });
    }

    // Incoming bookings (seller)
    bot.action('seller:bookings', async (ctx) => {
        await ctx.answerCbQuery();
        const s = await refreshSession(ctx.chat.id);
        if (!s.userId || s.userType !== 'merchant') return;

        const list = await rpc('bot_get_seller_bookings', { p_chat_id: ctx.chat.id });
        if (!list || !list.length) {
            return ctx.reply('✅ *لا توجد حجوزات معلقة حالياً*', {
                parse_mode: 'MarkdownV2',
                reply_markup: backBtn('menu:back').reply_markup
            });
        }
        let msg = `📦 *الحجوزات الواردة* \\(${list.length}\\)\n\n`;
        list.forEach((b, i) => {
            msg += `*${i + 1}\\.* \`${md(b.barcode)}\`\n`;
            msg += `👤 ${md(b.user_name)}  📞 ${md(b.user_phone)}\n`;
            msg += `🛍 ${md(b.deal_name)}  📦 ×${md(b.quantity)}\n`;
            msg += `${statusLabel(b.status)}`;
            if (b.notes) msg += `  📝 ${md(b.notes)}`;
            msg += `\n⏰ ${md(fmtDate(b.booked_at))}\n\n`;
        });
        msg += `💡 _أرسل \`/complete BARCODE\` لإتمام أي حجز_`;
        await ctx.reply(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: backBtn('menu:back').reply_markup
        });
    });

    // Verify flow
    bot.command('verify', async (ctx) => startVerify(ctx));
    bot.action('seller:verify', async (ctx) => { await ctx.answerCbQuery(); await startVerify(ctx); });

    async function startVerify(ctx) {
        const s = await refreshSession(ctx.chat.id);
        if (!s.userId || s.userType !== 'merchant') {
            return ctx.reply('❗ هذا الخيار للتجار فقط\\.', { parse_mode: 'MarkdownV2' });
        }
        // Check if barcode passed inline: /verify ABC123
        const code = sanitize((ctx.message?.text || '').split(' ')[1], 20);
        if (code) return doVerify(ctx, code);

        setStep(ctx.chat.id, 'await_barcode_verify');
        await ctx.reply(
            `🔍 *تحقق من حجز*\n\nأرسل كود الحجز \\(الباركود\\):`,
            { parse_mode: 'MarkdownV2',
              reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', 'menu:back')]]).reply_markup }
        );
    }

    async function doVerify(ctx, barcode) {
        const result = await rpc('bot_verify_booking', { p_chat_id: ctx.chat.id, p_barcode: barcode });
        setStep(ctx.chat.id, 'idle');
        if (!result || !result.success) {
            const err = result?.error;
            const msg = err === 'not_found' ? '❌ *الكود غير موجود أو لا ينتمي لمتجرك*'
                      : err === 'not_merchant' ? '❗ حساب التاجر غير مرتبط'
                      : '⚠️ حدث خطأ، حاول لاحقاً';
            return ctx.reply(msg, { parse_mode: 'MarkdownV2',
                reply_markup: backBtn('menu:back').reply_markup });
        }
        const statusOK = result.status !== 'completed' && result.status !== 'cancelled';
        const msg =
            `${statusOK ? '✅' : '⚠️'} *نتيجة التحقق*\n\n` +
            `📋 الكود: \`${md(result.barcode)}\`\n` +
            `👤 العميل: *${md(result.user_name)}*\n` +
            `📞 الجوال: ${md(result.user_phone)}\n` +
            `🛍 العرض: ${md(result.deal_name)}\n` +
            `📦 الكمية: ${md(result.quantity)}\n` +
            `${statusLabel(result.status)}\n` +
            (result.notes ? `📝 ملاحظة: ${md(result.notes)}\n` : '') +
            `⏰ ${md(fmtDate(result.booked_at))}`;

        const btns = [];
        if (statusOK) {
            btns.push([Markup.button.callback(`✅ إتمام الحجز`, `complete:${result.barcode}`)]);
        }
        btns.push([Markup.button.callback('◀️ رجوع', 'menu:back')]);
        await ctx.reply(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: Markup.inlineKeyboard(btns).reply_markup
        });
    }

    // Complete booking via button
    bot.action(/^complete:(.+)$/, async (ctx) => {
        await ctx.answerCbQuery('جاري إتمام الحجز…');
        const barcode = ctx.match[1];
        await doComplete(ctx, barcode);
    });

    // /complete BARCODE
    bot.command('complete', async (ctx) => {
        const s = await refreshSession(ctx.chat.id);
        if (!s.userId || s.userType !== 'merchant') return;
        const code = sanitize((ctx.message?.text || '').split(' ')[1], 20);
        if (!code) return ctx.reply('❗ أرسل: `/complete BARCODE`', { parse_mode: 'MarkdownV2' });
        await doComplete(ctx, code);
    });

    async function doComplete(ctx, barcode) {
        const result = await rpc('bot_complete_booking', { p_chat_id: ctx.chat.id, p_barcode: barcode });
        if (!result || !result.success) {
            const err = result?.error;
            const msg = err === 'already_completed' ? '⚠️ هذا الحجز مكتمل مسبقاً'
                      : err === 'not_found' ? '❌ الكود غير موجود'
                      : '⚠️ حدث خطأ، حاول لاحقاً';
            return ctx.reply(msg, { parse_mode: 'MarkdownV2',
                reply_markup: backBtn('menu:back').reply_markup });
        }
        await ctx.reply(
            `🏁 *تم إتمام الحجز بنجاح\\!*\n\n👤 العميل: *${md(result.user_name)}*\n📦 الكمية: ${md(result.quantity)}`,
            { parse_mode: 'MarkdownV2',
              reply_markup: backBtn('menu:back').reply_markup }
        );
    }

    // My deals (seller)
    bot.action('seller:deals', async (ctx) => {
        await ctx.answerCbQuery();
        const s = await refreshSession(ctx.chat.id);
        if (!s.userId || s.userType !== 'merchant') return;

        const list = await rpc('bot_get_seller_deals', { p_chat_id: ctx.chat.id });
        if (!list || !list.length) {
            return ctx.reply('📭 *لا توجد عروض بعد*\nأضف أول عرض بالضغط على "إضافة عرض"', {
                parse_mode: 'MarkdownV2',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback('➕ إضافة عرض', 'seller:addDeal')],
                    [Markup.button.callback('◀️ رجوع', 'menu:back')]
                ]).reply_markup
            });
        }
        let msg = `🏷 *عروضي* \\(${list.length}\\)\n\n`;
        const btns = [];
        list.forEach((d, i) => {
            const qty = d.is_unlimited ? 'غير محدود' : (d.quantity ?? '—');
            msg += `*${i + 1}\\. ${md(d.item_name)}*\n`;
            msg += `💰 ${md(d.discounted_price)} ر\\.س — خصم ${md(d.discount_percentage)}%\n`;
            msg += `📦 ${md(qty)}   ${statusLabel(d.status)}\n\n`;
            const toggleLabel = d.status === 'active' ? '⏸ إيقاف' : '▶️ تفعيل';
            const toggleStatus = d.status === 'active' ? 'paused' : 'active';
            btns.push([
                Markup.button.callback(`${toggleLabel} "${String(d.item_name).substring(0,20)}"`, `toggleDeal:${d.id}:${toggleStatus}`),
            ]);
        });
        btns.push([Markup.button.callback('➕ إضافة عرض', 'seller:addDeal')]);
        btns.push([Markup.button.callback('◀️ رجوع', 'menu:back')]);
        await ctx.reply(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: Markup.inlineKeyboard(btns).reply_markup
        });
    });

    // Toggle deal
    bot.action(/^toggleDeal:(.+):(.+)$/, async (ctx) => {
        await ctx.answerCbQuery('جاري التحديث…');
        const [, dealId, status] = ctx.match;
        const result = await rpc('bot_toggle_deal', { p_chat_id: ctx.chat.id, p_deal_id: dealId, p_status: status });
        if (result?.success) {
            await ctx.reply(`✅ تم ${status === 'active' ? 'تفعيل' : 'إيقاف'} العرض\\.`,
                { parse_mode: 'MarkdownV2',
                  reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🏷 العروض', 'seller:deals'),
                    Markup.button.callback('◀️ القائمة', 'menu:back')]]).reply_markup });
        } else {
            await ctx.reply('⚠️ تعذّر تحديث العرض\\. حاول لاحقاً\\.', { parse_mode: 'MarkdownV2' });
        }
    });

    // Seller profile
    bot.action('seller:profile', async (ctx) => {
        await ctx.answerCbQuery();
        const s = await refreshSession(ctx.chat.id);
        if (!s.userId) return;
        const stats = await rpc('bot_get_seller_stats', { p_chat_id: ctx.chat.id });
        const plan = stats?.subscription_plan || 'مجاني';
        const expiry = stats?.subscription_expires_at ? fmtDate(stats.subscription_expires_at) : '—';
        await ctx.reply(
            `👤 *حسابي*\n\n*الاسم:* ${md(s.name)}\n*المتجر:* ${md(s.shop)}\n*الخطة:* ${md(plan)}\n*تنتهي في:* ${md(expiry)}\n\nلتعديل البيانات افتح التطبيق:`,
            { parse_mode: 'MarkdownV2',
              reply_markup: Markup.inlineKeyboard([
                [Markup.button.webApp('✏️ تعديل الحساب', APP_URL + '/#/seller')],
                [Markup.button.callback('◀️ رجوع', 'menu:back')]
              ]).reply_markup }
        );
    });

    // ─────────────────────────────────────────────────────────────────────────
    //  ADD DEAL — Multi-step guided flow
    // ─────────────────────────────────────────────────────────────────────────
    bot.action('seller:addDeal', async (ctx) => {
        await ctx.answerCbQuery();
        const s = await refreshSession(ctx.chat.id);
        if (!s.userId || s.userType !== 'merchant') return;
        setStep(ctx.chat.id, 'deal_name');
        getSession(ctx.chat.id).temp = {};
        await ctx.reply(
            `➕ *إضافة عرض جديد*\n\n*الخطوة 1/5* — اسم المنتج أو الخدمة:`,
            { parse_mode: 'MarkdownV2',
              reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', 'addDeal:cancel')]]).reply_markup }
        );
    });

    bot.action('addDeal:cancel', async (ctx) => {
        await ctx.answerCbQuery();
        setStep(ctx.chat.id, 'idle');
        getSession(ctx.chat.id).temp = {};
        await ctx.reply('❌ *تم إلغاء إضافة العرض*', { parse_mode: 'MarkdownV2',
            reply_markup: backBtn('menu:back').reply_markup });
    });

    // ─────────────────────────────────────────────────────────────────────────
    //  ADMIN ACTIONS
    // ─────────────────────────────────────────────────────────────────────────
    bot.action('admin:stats', async (ctx) => {
        await ctx.answerCbQuery();
        const s = await refreshSession(ctx.chat.id);
        if (!s.isAdmin) return ctx.reply('❗ غير مصرح\\.', { parse_mode: 'MarkdownV2' });
        const stats = await rpc('bot_get_admin_stats', { p_chat_id: ctx.chat.id });
        if (!stats || !stats.success) return ctx.reply('⚠️ غير مصرح أو حدث خطأ\\.', { parse_mode: 'MarkdownV2' });
        const msg =
            `📊 *إحصائيات منصة TAKI*\n\n` +
            `👥 إجمالي المستخدمين: *${md(stats.total_users)}*\n` +
            `🏪 التجار: *${md(stats.merchants)}*\n` +
            `🛍 المشترون: *${md(stats.buyers)}*\n\n` +
            `🏷 العروض النشطة: *${md(stats.active_deals)}*\n` +
            `📦 إجمالي الحجوزات: *${md(stats.total_bookings)}*\n` +
            `🌅 حجوزات اليوم: *${md(stats.today_bookings)}*\n\n` +
            `🚩 بلاغات معلقة: *${md(stats.pending_reports)}*`;
        await ctx.reply(msg, {
            parse_mode: 'MarkdownV2',
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.webApp('🛡 لوحة الإدارة الكاملة', APP_URL + '/#/admin')],
                [Markup.button.callback('◀️ رجوع', 'menu:back')]
            ]).reply_markup
        });
    });

    bot.action('admin:reports', async (ctx) => {
        await ctx.answerCbQuery();
        const s = await refreshSession(ctx.chat.id);
        if (!s.isAdmin) return;
        await ctx.reply(
            `🚩 *البلاغات المعلقة*\n\nلمراجعة وإدارة البلاغات افتح لوحة الإدارة:`,
            { parse_mode: 'MarkdownV2',
              reply_markup: Markup.inlineKeyboard([
                [Markup.button.webApp('🛡 مركز الإدارة', APP_URL + '/#/admin')],
                [Markup.button.callback('◀️ رجوع', 'menu:back')]
              ]).reply_markup }
        );
    });

    // ─────────────────────────────────────────────────────────────────────────
    //  FREE TEXT HANDLER — handles all multi-step flows + shortcuts
    // ─────────────────────────────────────────────────────────────────────────
    bot.on('text', async (ctx) => {
        if (!checkRL(`tg:text:${ctx.chat.id}`)) return;
        const s = getSession(ctx.chat.id);
        const text = sanitize(ctx.message.text, 500);
        const lc = text.toLowerCase();

        // ── Multi-step: account linking ──────────────────────────────────────
        if (s.step === 'await_phone') {
            const phone = text.trim();
            if (!isPhone(phone)) {
                return ctx.reply(`❌ *صيغة غير صحيحة*\nأرسل الرقم هكذا: \`05XXXXXXXX\``,
                    { parse_mode: 'MarkdownV2' });
            }
            const result = await rpc('bot_link_telegram', { p_phone: phone, p_chat_id: ctx.chat.id });
            if (!result || !result.success) {
                const err = result?.error;
                const msg = err === 'phone_not_found'
                    ? `❌ *الرقم غير مسجّل*\nتأكد من الرقم أو سجّل في التطبيق أولاً:\n${APP_URL}`
                    : err === 'suspended'
                    ? '🚫 *هذا الحساب موقوف\\. تواصل مع الدعم\\.*'
                    : '⚠️ حدث خطأ، حاول لاحقاً';
                setStep(ctx.chat.id, 'idle');
                return ctx.reply(msg, { parse_mode: 'MarkdownV2' });
            }
            // Link successful — update session
            s.userId   = result.id;
            s.userType = result.user_type;
            s.name     = result.name;
            s.shop     = result.shop || null;
            s.isAdmin  = !!(result.is_super_admin ||
                (result.admin_permissions && result.admin_permissions.length > 0));
            setStep(ctx.chat.id, 'idle');
            await ctx.reply(
                `✅ *تم ربط حسابك بنجاح\\!*\n\nأهلاً *${md(result.name)}* 👋`,
                { parse_mode: 'MarkdownV2' }
            );
            await sendMenu(ctx, s);
            return;
        }

        // ── Multi-step: barcode verify ────────────────────────────────────────
        if (s.step === 'await_barcode_verify') {
            const barcode = text.trim().toUpperCase();
            setStep(ctx.chat.id, 'idle');
            return doVerify(ctx, barcode);
        }

        // ── Multi-step: add deal (5 steps) ────────────────────────────────────
        const CANCEL_BTN = Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء', 'addDeal:cancel')]]).reply_markup;

        if (s.step === 'deal_name') {
            if (text.length < 3) return ctx.reply('❗ الاسم قصير جداً، حاول مجدداً:');
            s.temp.name = text;
            setStep(ctx.chat.id, 'deal_orig_price');
            return ctx.reply(`*الخطوة 2/5* — السعر الأصلي \\(بالريال\\):\n_مثال: 250_`,
                { parse_mode: 'MarkdownV2', reply_markup: CANCEL_BTN });
        }
        if (s.step === 'deal_orig_price') {
            if (!isPrice(text)) return ctx.reply('❗ أرسل رقماً صحيحاً للسعر، مثل: `150`',
                { parse_mode: 'MarkdownV2' });
            s.temp.origPrice = parseFloat(text);
            setStep(ctx.chat.id, 'deal_disc_price');
            return ctx.reply(`*الخطوة 3/5* — السعر بعد الخصم \\(بالريال\\):`,
                { parse_mode: 'MarkdownV2', reply_markup: CANCEL_BTN });
        }
        if (s.step === 'deal_disc_price') {
            if (!isPrice(text) || parseFloat(text) >= s.temp.origPrice) {
                return ctx.reply(`❗ السعر يجب أن يكون أقل من ${s.temp.origPrice} ر\\.س`, { parse_mode: 'MarkdownV2' });
            }
            s.temp.discPrice = parseFloat(text);
            const pct = Math.round(((s.temp.origPrice - s.temp.discPrice) / s.temp.origPrice) * 100);
            setStep(ctx.chat.id, 'deal_qty');
            return ctx.reply(
                `✅ نسبة الخصم: *${pct}%*\n\n*الخطوة 4/5* — الكمية المتاحة:\n_أرسل 0 لكمية غير محدودة_`,
                { parse_mode: 'MarkdownV2', reply_markup: CANCEL_BTN }
            );
        }
        if (s.step === 'deal_qty') {
            if (!isQty(text)) return ctx.reply('❗ أرسل رقم الكمية، مثال: `10` أو `0` لغير محدود');
            s.temp.qty = parseInt(text);
            setStep(ctx.chat.id, 'deal_desc');
            return ctx.reply(`*الخطوة 5/5* — وصف مختصر للعرض:`,
                { parse_mode: 'MarkdownV2', reply_markup: CANCEL_BTN });
        }
        if (s.step === 'deal_desc') {
            s.temp.desc = text.substring(0, 300);
            setStep(ctx.chat.id, 'deal_confirm');
            const pct = Math.round(((s.temp.origPrice - s.temp.discPrice) / s.temp.origPrice) * 100);
            const msg =
                `📋 *تأكيد العرض الجديد*\n\n` +
                `🏷 *الاسم:* ${md(s.temp.name)}\n` +
                `💰 *السعر:* ~~${md(s.temp.origPrice)}~~ → *${md(s.temp.discPrice)} ر\\.س* \\(${pct}%\\)\n` +
                `📦 *الكمية:* ${s.temp.qty === 0 ? 'غير محدودة' : md(s.temp.qty)}\n` +
                `📝 *الوصف:* ${md(s.temp.desc)}\n\n` +
                `_سيُحفظ كمسودة — فعّله من التطبيق أو من قائمة عروضي_`;
            return ctx.reply(msg, {
                parse_mode: 'MarkdownV2',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.callback('✅ إضافة العرض', 'addDeal:confirm')],
                    [Markup.button.callback('❌ إلغاء', 'addDeal:cancel')]
                ]).reply_markup
            });
        }

        // ── Keyword shortcuts ─────────────────────────────────────────────────
        if (['menu','قائمة','القائمة','ابدأ','start'].some(k => lc === k)) {
            const ns = await refreshSession(ctx.chat.id);
            return sendMenu(ctx, ns);
        }
        if (['عروض','deals','تخفيضات'].some(k => lc.includes(k))) return showDeals(ctx);
        if (['مساعدة','help'].some(k => lc === k)) return showHelp(ctx);

        // Default
        const ns = await refreshSession(ctx.chat.id);
        await ctx.reply(
            ns.userId
                ? 'اختر من القائمة 👇 أو اكتب /menu'
                : 'اكتب /menu لعرض القائمة أو /link لربط حسابك\\.',
            { parse_mode: 'MarkdownV2',
              reply_markup: roleMenu(ns).reply_markup }
        );
    });

    // Confirm add deal
    bot.action('addDeal:confirm', async (ctx) => {
        await ctx.answerCbQuery('جاري الإضافة…');
        const s = getSession(ctx.chat.id);
        const t = s.temp || {};
        if (!t.name) return ctx.reply('⚠️ انتهت صلاحية الجلسة. ابدأ من جديد.', { reply_markup: backBtn('menu:back').reply_markup });

        const result = await rpc('bot_add_deal', {
            p_chat_id: ctx.chat.id,
            p_item_name: t.name,
            p_original_price: t.origPrice,
            p_discounted_price: t.discPrice,
            p_quantity: t.qty,
            p_description: t.desc,
            p_category: 'other'
        });
        setStep(ctx.chat.id, 'idle');
        s.temp = {};

        if (!result || !result.success) {
            const err = result?.error;
            return ctx.reply(
                err === 'invalid_price' ? '❌ السعر بعد الخصم يجب أن يكون أقل من الأصلي\\.' : '⚠️ تعذّر إضافة العرض، حاول لاحقاً\\.',
                { parse_mode: 'MarkdownV2', reply_markup: backBtn('menu:back').reply_markup }
            );
        }
        await ctx.reply(
            `✅ *تم إنشاء العرض كمسودة بنجاح\\!*\n\nالخصم: *${result.discount}%*\n\nفعّله الآن من قائمة عروضي أو من التطبيق:`,
            { parse_mode: 'MarkdownV2',
              reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('🏷 عروضي', 'seller:deals')],
                [Markup.button.webApp('🚀 فتح التطبيق', APP_URL + '/#/seller')],
                [Markup.button.callback('◀️ القائمة', 'menu:back')]
              ]).reply_markup }
        );
    });

    // Error handler
    bot.catch((err, ctx) => {
        console.error(`Bot error [${ctx?.updateType}]:`, err?.message || err);
    });

    // Telegram webhook route
    app.post('/webhook/telegram', (req, res) => {
        if (!TELEGRAM_WEBHOOK_SECRET) return res.status(503).json({ error: 'not configured' });
        if (req.headers['x-telegram-bot-api-secret-token'] !== TELEGRAM_WEBHOOK_SECRET)
            return res.status(403).json({ error: 'Forbidden' });
        bot.handleUpdate(req.body, res);
    });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SUPABASE REALTIME — push new bookings to seller's Telegram
// ═══════════════════════════════════════════════════════════════════════════════
if (supabase && bot) {
    supabase
        .channel('bot-new-bookings')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings' }, async (payload) => {
            const b = payload.new;
            if (!b.store_id) return;
            try {
                const { data: seller } = await supabase
                    .from('users')
                    .select('telegram_chat_id, name')
                    .eq('id', b.store_id)
                    .eq('notify_via_telegram', true)
                    .maybeSingle();
                if (!seller?.telegram_chat_id) return;
                await bot.telegram.sendMessage(
                    seller.telegram_chat_id,
                    `🔔 *حجز جديد وارد\\!*\n\n📋 الكود: \`${md(b.barcode)}\`\n👤 ${md(b.user_name || '—')}\n📦 الكمية: ${b.booked_quantity}\n\nاضغط لتأكيد:`,
                    {
                        parse_mode: 'MarkdownV2',
                        reply_markup: Markup.inlineKeyboard([
                            [Markup.button.callback('✅ تحقق وأتمم', `complete:${b.barcode}`)],
                            [Markup.button.callback('📦 كل الحجوزات', 'seller:bookings')]
                        ]).reply_markup
                    }
                );
            } catch (e) { console.warn('Notify seller failed:', e.message); }
        })
        .subscribe();
    console.log('📡 Realtime: booking notifications active');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SUPABASE REALTIME — smart-alert & deal notifications to buyers
// ═══════════════════════════════════════════════════════════════════════════════
const BOT_DEBOUNCE = new Map();
const BOT_DEBOUNCE_MS = 20_000;

if (supabase) {
    supabase
        .channel('bot-user-notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, async (payload) => {
            const n = payload.new;
            if (n.type !== 'deal' && n.type !== 'marketing') return;
            const last = BOT_DEBOUNCE.get(n.user_id) || 0;
            if (Date.now() - last < BOT_DEBOUNCE_MS) return;
            try {
                const { data: user } = await supabase
                    .from('users')
                    .select('telegram_chat_id, notify_via_telegram, preferred_lang')
                    .eq('id', n.user_id)
                    .maybeSingle();
                if (!user?.telegram_chat_id || !user.notify_via_telegram) return;
                const isEn = (user.preferred_lang || '').startsWith('en');
                const msg = isEn
                    ? (n.meta_data?.bot_message_en || `${n.title_en}\n\n${n.body_en}`)
                    : (n.meta_data?.bot_message_ar || `${n.title_ar}\n\n${n.body_ar}`);
                await bot.telegram.sendMessage(user.telegram_chat_id, msg);
                BOT_DEBOUNCE.set(n.user_id, Date.now());
            } catch (e) { console.warn('Alert push failed:', e.message); }
        })
        .subscribe();
    console.log('📡 Realtime: user notifications active');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WHATSAPP CLOUD API
// ═══════════════════════════════════════════════════════════════════════════════
async function sendWhatsApp(to, payload) {
    if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) return null;
    try {
        const r = await fetch(
            `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
            { method: 'POST',
              headers: { Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }) }
        );
        if (!r.ok) { console.warn('WhatsApp send failed:', r.status, await r.text().catch(() => '')); return null; }
        return r.json();
    } catch (e) { console.error('WhatsApp error:', e.message); return null; }
}

function waMenu() {
    return { type: 'interactive', interactive: {
        type: 'button',
        body: { text: 'أهلاً في TAKI 🛍️\nاختر:' },
        action: { buttons: [
            { type: 'reply', reply: { id: 'wa_deals',    title: '🔥 العروض' } },
            { type: 'reply', reply: { id: 'wa_bookings', title: '🎟 حجوزاتي' } },
            { type: 'reply', reply: { id: 'wa_help',     title: '🆘 مساعدة' } }
        ] }
    } };
}

app.get('/webhook/whatsapp', (req, res) => {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === WHATSAPP_VERIFY_TOKEN && WHATSAPP_VERIFY_TOKEN)
        return res.status(200).send(req.query['hub.challenge']);
    res.status(403).send('Forbidden');
});

app.post('/webhook/whatsapp', async (req, res) => {
    if (!WHATSAPP_APP_SECRET) return res.status(503).json({ error: 'not configured' });
    const sig = req.headers['x-hub-signature-256'];
    if (!sig) return res.status(401).json({ error: 'Missing signature' });
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const expected = 'sha256=' + crypto.createHmac('sha256', WHATSAPP_APP_SECRET).update(raw).digest('hex');
    try {
        if (Buffer.from(sig).length !== Buffer.from(expected).length ||
            !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
            return res.status(403).json({ error: 'Invalid signature' });
    } catch { return res.status(403).json({ error: 'Invalid signature' }); }

    let body;
    try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
    res.status(200).send('OK');

    try {
        for (const entry of body?.entry || []) {
            for (const change of entry.changes || []) {
                for (const msg of change.value?.messages || []) {
                    const from = msg.from;
                    if (!from || !checkRL(`wa:${from}`)) continue;
                    if (msg.type === 'text') {
                        const t = sanitize(msg.text?.body || '', 200).toLowerCase();
                        if (['hi','hello','مرحبا','السلام','menu','قائمة','start'].some(k => t.includes(k))) {
                            await sendWhatsApp(from, waMenu());
                        } else if (['deals','عروض','تخفيضات'].some(k => t.includes(k))) {
                            const deals = await getActiveDeals(3);
                            const body = deals.length
                                ? '🔥 أحدث العروض:\n\n' + deals.map((d,i) => `${i+1}. ${d.item_name} — ${d.discounted_price} ر.س (${d.shop_name})`).join('\n') + `\n\n🌐 ${APP_URL}`
                                : '📭 لا توجد عروض نشطة حالياً.';
                            await sendWhatsApp(from, { type: 'text', text: { body, preview_url: false } });
                        } else { await sendWhatsApp(from, waMenu()); }
                    } else if (msg.type === 'interactive') {
                        const id = msg.interactive?.button_reply?.id;
                        if (id === 'wa_deals') {
                            const deals = await getActiveDeals(3);
                            const body = deals.length
                                ? '🔥 العروض:\n\n' + deals.map((d,i) => `${i+1}. ${d.item_name} — ${d.discounted_price} ر.س`).join('\n') + `\n\n${APP_URL}`
                                : '📭 لا توجد عروض.';
                            await sendWhatsApp(from, { type: 'text', text: { body, preview_url: false } });
                        } else if (id === 'wa_bookings') {
                            await sendWhatsApp(from, { type: 'text', text: { body: `📦 لإدارة حجوزاتك:\n${APP_URL}/#/bookings`, preview_url: false } });
                        } else if (id === 'wa_help') {
                            await sendWhatsApp(from, { type: 'text', text: { body: '🆘 اكتب "عروض" أو افتح التطبيق:\n' + APP_URL, preview_url: false } });
                        }
                    }
                }
            }
        }
    } catch (e) { console.error('WhatsApp processing error:', e.message); }
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({
        status: 'active', version: BOT_VERSION, mode: BOT_MODE,
        uptime_sec: Math.round(process.uptime()),
        services: {
            telegram: !!bot,
            supabase: !!supabase,
            whatsapp: !!(WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_ACCESS_TOKEN)
        }
    });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`🚀 TAKI Bot v${BOT_VERSION} | port ${PORT} | mode: ${BOT_MODE}`);
    if (!TELEGRAM_TOKEN) console.warn('⚠️  TELEGRAM_BOT_TOKEN missing');
    if (!SUPABASE_URL)   console.warn('⚠️  SUPABASE_URL missing — offline mode');
});

if (bot && BOT_MODE === 'polling') {
    bot.launch({ dropPendingUpdates: true })
        .then(() => console.log('🤖 Bot LIVE in polling mode'))
        .catch(e => console.error('❌ Polling failed:', e.message));
}

process.once('SIGINT',  () => bot?.stop('SIGINT'));
process.once('SIGTERM', () => bot?.stop('SIGTERM'));
