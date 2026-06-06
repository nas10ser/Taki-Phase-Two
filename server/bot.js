/**
 * TAKI Bot Server — Telegram & WhatsApp Cloud API
 *
 * v7.0 — Modernized for 2026:
 *   • Telegram inline keyboards + callback queries
 *   • Bot Commands menu auto-published on startup (/setMyCommands)
 *   • Bilingual (Arabic / English) — auto-detect from chat language
 *   • WhatsApp Cloud API — full message handler (text + interactive buttons + lists)
 *   • Webhook signature verification (Telegram secret token + WhatsApp X-Hub-Signature-256)
 *   • Per-chat rate limiting, input sanitization
 *   • No hardcoded secrets — everything via env vars
 *   • Graceful degradation: runs in offline mode if SUPABASE / TELEGRAM env vars are missing
 */

// Load a local .env when present (no-op on hosts like Railway/Render that inject
// env vars directly, and harmless if dotenv isn't installed).
try { require('dotenv').config(); } catch { /* dotenv optional */ }

const express = require('express');
const crypto = require('crypto');
const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// WhatsApp HMAC verification requires the EXACT raw bytes that Meta signed.
// Re-stringifying req.body after express.json() reformats whitespace/key order
// and breaks signature comparison, so capture the raw buffer for that route
// before JSON parsing. Use raw parser only on /webhook/whatsapp; every other
// route keeps the standard express.json() behavior.
app.use('/webhook/whatsapp', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// Global rate-limit middleware — protects every endpoint from burst abuse,
// independent of the per-chat rate limit applied inside bot handlers below.
// 300 req / 5 min / IP is generous enough for legitimate Telegram + WhatsApp
// webhook traffic while shedding flood attempts.
const globalRateLimitMap = new Map();
const GLOBAL_RL_WINDOW_MS = 5 * 60 * 1000;
const GLOBAL_RL_MAX = 300;
app.use((req, res, next) => {
    // Skip the health check so monitoring probes don't get throttled.
    if (req.path === '/health') return next();
    const ip = req.ip || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = globalRateLimitMap.get(ip);
    if (!entry || now - entry.start > GLOBAL_RL_WINDOW_MS) {
        globalRateLimitMap.set(ip, { start: now, count: 1 });
        return next();
    }
    entry.count++;
    if (entry.count > GLOBAL_RL_MAX) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    next();
});
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of globalRateLimitMap) {
        if (now - v.start > GLOBAL_RL_WINDOW_MS * 2) globalRateLimitMap.delete(k);
    }
}, 10 * 60 * 1000).unref?.();

// ====================== CONFIG ======================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || ''; // anon-only; service-role would bypass RLS
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET || '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const APP_URL = process.env.APP_URL || 'https://taki.app';
// Run mode: 'webhook' (production, needs a public HTTPS URL) or 'polling'
// (local testing — the bot pulls updates from Telegram itself, so NO public URL
// is required). Set BOT_MODE=polling in server/.env to try it on your machine.
const BOT_MODE = (process.env.BOT_MODE || 'webhook').toLowerCase();
const BOT_VERSION = '7.0.0';

const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const bot = TELEGRAM_TOKEN ? new Telegraf(TELEGRAM_TOKEN) : null;

// ====================== SECURITY: Rate Limiting ======================
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30;               // requests / window / key

function checkRateLimit(key) {
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(key, { start: now, count: 1 });
        return true;
    }
    entry.count++;
    return entry.count <= RATE_LIMIT_MAX;
}

setInterval(() => {
    const now = Date.now();
    for (const [key, val] of rateLimitMap) {
        if (now - val.start > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(key);
    }
}, 5 * 60 * 1000).unref?.();

// ====================== SECURITY: Input Sanitization ======================
function sanitize(str, maxLen = 200) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/<[^>]*>?/gm, '').trim().substring(0, maxLen);
}
function isValidPhone(phone) { return /^05\d{8}$/.test(phone); }
function isValidBarcode(code) { return /^[A-Z0-9-]{4,20}$/i.test(code); }

// Detect language from Telegram chat metadata. Defaults to Arabic for Saudi market.
function detectLang(ctx) {
    const code = ctx?.from?.language_code || '';
    return code.toLowerCase().startsWith('ar') || code === '' ? 'ar' : 'en';
}
const T = {
    welcome: {
        ar: '🛍️ أهلاً بك في *TAKI*\n\nمنصة الحجوزات الذكية للعروض والتخفيضات في المملكة\\.\n\nاختر من القائمة:',
        en: '🛍️ Welcome to *TAKI*\n\nThe smart booking platform for exclusive deals across Saudi Arabia\\.\n\nChoose from the menu:'
    },
    deals: {
        ar: '🔥 أحدث التخفيضات',
        en: '🔥 Latest Deals'
    },
    noDeals: {
        ar: '📭 لا توجد عروض نشطة حالياً\\. عُد لاحقاً!',
        en: '📭 No active deals right now\\. Check back later!'
    },
    rateLimit: {
        ar: '⚠️ تم تجاوز حد المحاولات، حاول بعد دقيقة\\.',
        en: '⚠️ Rate limit exceeded, try again in a minute\\.'
    },
    help: {
        ar: '🆘 *الأوامر المتاحة:*\n\n/deals — عرض التخفيضات النشطة\n/bookings — إدارة حجوزاتك\n/verify — التحقق من حجز\n/profile — حسابي\n/lang — تغيير اللغة\n/help — هذه الرسالة',
        en: '🆘 *Available commands:*\n\n/deals — Active discounts\n/bookings — Manage bookings\n/verify — Verify a booking\n/profile — My account\n/lang — Change language\n/help — This message'
    }
};

// MarkdownV2 escape — required for /sendMessage parse_mode='MarkdownV2'
function escapeMd(text) {
    if (!text) return '';
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

// ====================== Supabase Helpers ======================
async function getActiveDeals(limit = 5) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('deals')
            .select('id, item_name, shop_name, original_price, discounted_price, discount_percentage, quantity, status, created_at')
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(limit);
        return error ? [] : (data || []);
    } catch (e) {
        console.error('DB Error:', e);
        return [];
    }
}

async function getStoreBookings(userId) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('bookings')
            .select('id, barcode, booked_quantity, status, booked_at')
            .eq('store_id', userId)
            .eq('status', 'pending')
            .order('booked_at', { ascending: false });
        return error ? [] : (data || []);
    } catch (e) {
        console.error('DB Error:', e);
        return [];
    }
}

async function verifyBooking(barcode) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('bookings')
            .select('id, barcode, booked_quantity, status, booked_at')
            .eq('barcode', barcode)
            .maybeSingle();
        return error ? null : data;
    } catch (e) { return null; }
}

async function findUserByPhone(phone) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('users')
            .select('id, name, phone, user_type')
            .eq('phone', phone)
            .maybeSingle();
        return error ? null : data;
    } catch (e) { return null; }
}

// ====================== Telegram Bot — Modern UX ======================
if (bot) {
    // Persistent bottom command menu — appears in Telegram's '/' picker.
    // Set once at startup; localized per user via setMyCommands(scope).
    bot.telegram.setMyCommands([
        { command: 'start',    description: 'بدء — Start' },
        { command: 'deals',    description: 'العروض — Deals' },
        { command: 'bookings', description: 'حجوزاتي — My Bookings' },
        { command: 'verify',   description: 'تحقق من حجز — Verify Booking' },
        { command: 'profile',  description: 'حسابي — My Profile' },
        { command: 'lang',     description: 'اللغة — Language' },
        { command: 'help',     description: 'مساعدة — Help' }
    ]).catch(err => console.warn('setMyCommands failed:', err.message));

    // Build the main inline keyboard — reused across /start and /menu
    function mainMenu(lang) {
        return Markup.inlineKeyboard([
            [
                Markup.button.callback(lang === 'ar' ? '🔥 العروض' : '🔥 Deals', 'menu:deals'),
                Markup.button.callback(lang === 'ar' ? '🎟️ حجوزاتي' : '🎟️ Bookings', 'menu:bookings')
            ],
            [
                Markup.button.callback(lang === 'ar' ? '✅ تحقق من حجز' : '✅ Verify', 'menu:verify'),
                Markup.button.callback(lang === 'ar' ? '👤 حسابي' : '👤 Profile', 'menu:profile')
            ],
            [
                // web_app opens TAKI INSIDE Telegram with auto-login (no link).
                Markup.button.webApp(lang === 'ar' ? '🚀 افتح TAKI (دخول تلقائي)' : '🚀 Open TAKI (auto sign-in)', APP_URL),
            ],
            [
                Markup.button.callback(lang === 'ar' ? '🆘 مساعدة' : '🆘 Help', 'menu:help')
            ]
        ]);
    }

    bot.start(async (ctx) => {
        const lang = detectLang(ctx);
        await ctx.reply(T.welcome[lang], {
            parse_mode: 'MarkdownV2',
            reply_markup: mainMenu(lang).reply_markup
        });
    });

    bot.command('menu', async (ctx) => {
        const lang = detectLang(ctx);
        await ctx.reply(lang === 'ar' ? '📋 *القائمة الرئيسية*' : '📋 *Main Menu*', {
            parse_mode: 'MarkdownV2',
            reply_markup: mainMenu(lang).reply_markup
        });
    });

    bot.command('deals', async (ctx) => sendDealsList(ctx));
    bot.action('menu:deals', async (ctx) => { await ctx.answerCbQuery(); await sendDealsList(ctx); });

    async function sendDealsList(ctx) {
        const lang = detectLang(ctx);
        if (!checkRateLimit(`tg_deals_${ctx.chat.id}`)) {
            return ctx.reply(T.rateLimit[lang], { parse_mode: 'MarkdownV2' });
        }
        const deals = await getActiveDeals(5);
        if (deals.length === 0) {
            return ctx.reply(T.noDeals[lang], { parse_mode: 'MarkdownV2' });
        }
        let message = `${T.deals[lang]}\n\n`;
        const buttons = [];
        deals.forEach((deal, idx) => {
            const discount = deal.discount_percentage
                || Math.round(((deal.original_price - deal.discounted_price) / deal.original_price) * 100);
            message += `*${idx + 1}\\. ${escapeMd(deal.item_name)}*\n`;
            message += `🏪 ${escapeMd(deal.shop_name)}\n`;
            message += `💰 *${escapeMd(deal.discounted_price)}* ر\\.س — خصم ${discount}%\n`;
            message += `📦 ${deal.quantity === null ? (lang === 'ar' ? 'غير محدود' : 'unlimited') : `${deal.quantity}`}\n\n`;
            buttons.push([Markup.button.url(
                (lang === 'ar' ? '👁️ ' : '👁️ ') + escapeMd(deal.item_name).slice(0, 30),
                `${APP_URL}/#/deal/${deal.id}`
            )]);
        });
        await ctx.reply(message, {
            parse_mode: 'MarkdownV2',
            reply_markup: Markup.inlineKeyboard(buttons).reply_markup,
            link_preview_options: { is_disabled: true }
        });
    }

    bot.command('bookings', async (ctx) => sendBookingsPrompt(ctx));
    bot.action('menu:bookings', async (ctx) => { await ctx.answerCbQuery(); await sendBookingsPrompt(ctx); });

    async function sendBookingsPrompt(ctx) {
        const lang = detectLang(ctx);
        const args = (ctx.message?.text || '').split(' ').slice(1);
        const phone = sanitize(args[0], 15);

        if (!phone) {
            return ctx.reply(
                lang === 'ar'
                    ? '📱 أرسل رقم جوالك بعد الأمر:\n`/bookings 05xxxxxxxx`'
                    : '📱 Send your phone after the command:\n`/bookings 05xxxxxxxx`',
                { parse_mode: 'MarkdownV2' }
            );
        }
        if (!checkRateLimit(`tg_bookings_${ctx.chat.id}`)) {
            return ctx.reply(T.rateLimit[lang], { parse_mode: 'MarkdownV2' });
        }
        if (!isValidPhone(phone)) {
            return ctx.reply(lang === 'ar' ? '❌ صيغة رقم الجوال غير صحيحة\\.' : '❌ Invalid phone format\\.', { parse_mode: 'MarkdownV2' });
        }
        const user = await findUserByPhone(phone);
        if (!user) {
            return ctx.reply(lang === 'ar' ? '❌ الرقم غير مسجل في المنصة\\.' : '❌ Phone not registered\\.', { parse_mode: 'MarkdownV2' });
        }
        const bookings = await getStoreBookings(user.id);
        if (bookings.length === 0) {
            return ctx.reply(lang === 'ar' ? '📭 لا توجد حجوزات معلقة\\.' : '📭 No pending bookings\\.', { parse_mode: 'MarkdownV2' });
        }
        let msg = `📦 *${lang === 'ar' ? 'الحجوزات المعلقة' : 'Pending Bookings'}* \\(${bookings.length}\\):\n\n`;
        bookings.forEach((b, idx) => {
            msg += `${idx + 1}\\. \`${escapeMd(b.barcode)}\`\n`;
            msg += `   📦 ${b.booked_quantity}\n`;
            msg += `   ⏰ ${escapeMd(new Date(b.booked_at).toLocaleString('ar-SA'))}\n\n`;
        });
        await ctx.reply(msg, { parse_mode: 'MarkdownV2' });
    }

    bot.command('verify', async (ctx) => sendVerifyFlow(ctx));
    bot.action('menu:verify', async (ctx) => {
        await ctx.answerCbQuery();
        const lang = detectLang(ctx);
        await ctx.reply(
            lang === 'ar'
                ? '🔍 أرسل كود الحجز بهذه الصيغة:\n`/verify ABC12345`'
                : '🔍 Send the booking code as:\n`/verify ABC12345`',
            { parse_mode: 'MarkdownV2' }
        );
    });

    async function sendVerifyFlow(ctx) {
        const lang = detectLang(ctx);
        if (!checkRateLimit(`tg_verify_${ctx.chat.id}`)) {
            return ctx.reply(T.rateLimit[lang], { parse_mode: 'MarkdownV2' });
        }
        const code = sanitize((ctx.message?.text || '').split(' ')[1], 20);
        if (!code) {
            return ctx.reply(
                lang === 'ar' ? '🔍 أرسل الكود:\n`/verify ABC12345`' : '🔍 Send the code:\n`/verify ABC12345`',
                { parse_mode: 'MarkdownV2' }
            );
        }
        if (!isValidBarcode(code)) {
            return ctx.reply(lang === 'ar' ? '❌ صيغة الكود غير صحيحة\\.' : '❌ Invalid code format\\.', { parse_mode: 'MarkdownV2' });
        }
        const booking = await verifyBooking(code.toUpperCase());
        if (!booking) {
            return ctx.reply(lang === 'ar' ? '❌ كود غير موجود أو منتهي\\.' : '❌ Code not found or expired\\.', { parse_mode: 'MarkdownV2' });
        }
        const status = booking.status === 'pending'
            ? (lang === 'ar' ? 'قيد الانتظار' : 'Pending')
            : booking.status === 'acknowledged'
            ? (lang === 'ar' ? 'مؤكد' : 'Acknowledged')
            : booking.status;
        await ctx.reply(
            `✅ *${lang === 'ar' ? 'الحجز صحيح' : 'Valid Booking'}*\n\n` +
            `📦 ${escapeMd(String(booking.booked_quantity))}\n` +
            `📋 ${escapeMd(status)}\n` +
            `⏰ ${escapeMd(new Date(booking.booked_at).toLocaleString('ar-SA'))}`,
            { parse_mode: 'MarkdownV2' }
        );
    }

    bot.command('profile', async (ctx) => sendProfile(ctx));
    bot.action('menu:profile', async (ctx) => { await ctx.answerCbQuery(); await sendProfile(ctx); });

    async function sendProfile(ctx) {
        const lang = detectLang(ctx);
        await ctx.reply(
            lang === 'ar'
                ? `👤 *حسابك على TAKI*\n\nافتح التطبيق داخل تيليجرام — سَيُسجّل دخولك *تلقائياً* بهويتك، وكل شيء \\(عروض، حجز، حسابك\\) يعمل من هنا\\.`
                : `👤 *Your TAKI Account*\n\nOpen the app inside Telegram — you'll be signed in *automatically*, and everything works right here\\.`,
            {
                parse_mode: 'MarkdownV2',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.webApp(lang === 'ar' ? '🚀 افتح TAKI (دخول تلقائي)' : '🚀 Open TAKI (auto sign-in)', APP_URL)]
                ]).reply_markup
            }
        );
    }

    bot.command('register', (ctx) => {
        const lang = detectLang(ctx);
        ctx.reply(
            lang === 'ar'
                ? `📝 *الدخول / إنشاء حساب:*\n\nاضغط الزر بالأسفل — يفتح TAKI داخل تيليجرام ويُنشئ حسابك ويُسجّل دخولك *تلقائياً*\\. لا حاجة لكتابة أي بيانات\\.`
                : `📝 *Sign in / Create account:*\n\nTap below — TAKI opens inside Telegram and signs you in *automatically*\\. No typing needed\\.`,
            {
                parse_mode: 'MarkdownV2',
                reply_markup: Markup.inlineKeyboard([
                    [Markup.button.webApp(lang === 'ar' ? '🚀 افتح TAKI (دخول تلقائي)' : '🚀 Open TAKI (auto sign-in)', APP_URL)]
                ]).reply_markup
            }
        );
    });

    bot.command('lang', (ctx) => {
        ctx.reply('🌐 اختر اللغة / Choose language', {
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('🇸🇦 العربية', 'lang:ar'), Markup.button.callback('🇺🇸 English', 'lang:en')]
            ]).reply_markup
        });
    });
    bot.action(/lang:(.+)/, async (ctx) => {
        const lang = ctx.match[1];
        await ctx.answerCbQuery(lang === 'ar' ? '✅ تم اختيار العربية' : '✅ English selected');
        await ctx.reply(T.welcome[lang], {
            parse_mode: 'MarkdownV2',
            reply_markup: mainMenu(lang).reply_markup
        });
    });

    bot.command('help', (ctx) => {
        const lang = detectLang(ctx);
        ctx.reply(T.help[lang], { parse_mode: 'MarkdownV2' });
    });
    bot.action('menu:help', async (ctx) => {
        await ctx.answerCbQuery();
        const lang = detectLang(ctx);
        await ctx.reply(T.help[lang], { parse_mode: 'MarkdownV2' });
    });

    // Free-form messages — keyword routing
    bot.on('text', async (ctx) => {
        const text = (ctx.message.text || '').trim().toLowerCase();
        const lang = detectLang(ctx);
        if (text === 'تسجيل' || text === 'register' || text === 'signup') return ctx.reply(T.help[lang], { parse_mode: 'MarkdownV2' });
        if (text === 'العروض' || text === 'deals' || text === 'تخفيضات') return sendDealsList(ctx);
        if (text === 'menu' || text === 'قائمة' || text === 'القائمة') {
            return ctx.reply(lang === 'ar' ? '📋 *القائمة الرئيسية*' : '📋 *Main Menu*', {
                parse_mode: 'MarkdownV2',
                reply_markup: mainMenu(lang).reply_markup
            });
        }
        ctx.reply(lang === 'ar' ? 'اكتب /menu لعرض القائمة\\.' : 'Type /menu to see options\\.', { parse_mode: 'MarkdownV2' });
    });

    bot.catch((err, ctx) => {
        console.error(`Bot error for ${ctx.updateType}:`, err);
    });

    // Telegram Webhook — secret token verification REQUIRED.
    // If TELEGRAM_WEBHOOK_SECRET isn't configured, we hard-reject every
    // POST with 503 rather than silently accepting unsigned updates from
    // any source on the internet.
    app.post('/webhook/telegram', (req, res) => {
        if (!TELEGRAM_WEBHOOK_SECRET) {
            console.warn('⚠️ Telegram webhook hit but TELEGRAM_WEBHOOK_SECRET is not set — rejecting.');
            return res.status(503).json({ error: 'Webhook not configured' });
        }
        const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
        if (secretHeader !== TELEGRAM_WEBHOOK_SECRET) {
            console.warn('⚠️ Telegram webhook: invalid secret token');
            return res.status(403).json({ error: 'Forbidden' });
        }
        bot.handleUpdate(req.body, res);
    });
}

// ====================== Supabase Realtime — booking notifications ======================
if (supabase && bot) {
    supabase
        .channel('bot-bookings')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings' }, async (payload) => {
            const booking = payload.new;
            console.log(`📦 New booking detected: ${booking.barcode}`);
            // Look up seller's telegram_chat_id (if column exists) and notify
            if (booking.store_id) {
                try {
                    const { data: seller } = await supabase
                        .from('users')
                        .select('telegram_chat_id, name')
                        .eq('id', booking.store_id)
                        .maybeSingle();
                    if (seller?.telegram_chat_id) {
                        await bot.telegram.sendMessage(
                            seller.telegram_chat_id,
                            `🔔 *حجز جديد*\n\nكود: \`${escapeMd(booking.barcode)}\`\nالكمية: ${booking.booked_quantity}`,
                            { parse_mode: 'MarkdownV2' }
                        );
                    }
                } catch (err) { console.warn('Notify failed:', err.message); }
            }
        })
        .subscribe();
    console.log('📡 Supabase Realtime listener active for bookings');
}

// ====================== Supabase Realtime — smart-alert notifications ======================
// Prepared in v10.64 but inert by default: each user opts in by setting
// `telegram_chat_id` (or `whatsapp_chat_id`) AND flipping `notify_via_telegram`
// (or `notify_via_whatsapp`) to TRUE. Until then the listener fires and exits
// immediately. The DB trigger pre-renders the pretty multi-line message in
// `meta_data.bot_message_ar/_en` so we forward it verbatim — no formatting
// happens in the bot, which avoids MarkdownV2 escape footguns on emoji-heavy
// strings.
const RECENT_BOT_SENDS = new Map(); // userId → epoch ms, used as a soft per-user rate-limit
const BOT_PER_USER_DEBOUNCE_MS = 20 * 1000;

if (supabase) {
    supabase
        .channel('bot-notifications')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, async (payload) => {
            const notif = payload.new;
            // Only forward smart-alert / deal types — booking notifications are
            // already handled by the dedicated bookings listener above.
            if (notif.type !== 'deal' && notif.type !== 'marketing') return;
            // Soft debounce so a backfill that produces many rows for one user
            // doesn't fire a burst of Telegram messages in the same second.
            const last = RECENT_BOT_SENDS.get(notif.user_id) || 0;
            if (Date.now() - last < BOT_PER_USER_DEBOUNCE_MS) return;

            try {
                const { data: user } = await supabase
                    .from('users')
                    .select('telegram_chat_id, whatsapp_chat_id, notify_via_telegram, notify_via_whatsapp, language')
                    .eq('id', notif.user_id)
                    .maybeSingle();
                if (!user) return;

                const langIsEn = (user.language || '').toLowerCase().startsWith('en');
                const message = langIsEn
                    ? (notif.meta_data?.bot_message_en || `${notif.title_en}\n\n${notif.body_en}`)
                    : (notif.meta_data?.bot_message_ar || `${notif.title_ar}\n\n${notif.body_ar}`);

                let didSend = false;
                if (bot && user.telegram_chat_id && user.notify_via_telegram) {
                    try {
                        await bot.telegram.sendMessage(user.telegram_chat_id, message);
                        didSend = true;
                    } catch (err) { console.warn('Telegram alert push failed:', err.message); }
                }
                if (user.whatsapp_chat_id && user.notify_via_whatsapp) {
                    try {
                        await sendWhatsAppMessage(user.whatsapp_chat_id, {
                            type: 'text',
                            text: { body: message }
                        });
                        didSend = true;
                    } catch (err) { console.warn('WhatsApp alert push failed:', err.message); }
                }
                if (didSend) RECENT_BOT_SENDS.set(notif.user_id, Date.now());
            } catch (err) {
                console.warn('Alert dispatch failed:', err.message);
            }
        })
        .subscribe();
    console.log('📡 Supabase Realtime listener active for smart-alert notifications (inert until users opt in)');
}

// ====================== WhatsApp Cloud API ======================
async function sendWhatsAppMessage(to, payload) {
    if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
        console.warn('⚠️ WhatsApp not configured — skipping send');
        return null;
    }
    try {
        const response = await fetch(
            `https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to,
                    ...payload
                })
            }
        );
        if (!response.ok) {
            const errBody = await response.text().catch(() => '');
            console.warn('WhatsApp send failed:', response.status, errBody);
            return null;
        }
        return response.json();
    } catch (e) {
        console.error('WhatsApp send error:', e.message);
        return null;
    }
}

function whatsappMainMenu(lang) {
    return {
        type: 'interactive',
        interactive: {
            type: 'button',
            body: { text: lang === 'ar' ? 'مرحباً بك في TAKI! اختر:' : 'Welcome to TAKI! Choose:' },
            action: {
                buttons: [
                    { type: 'reply', reply: { id: 'wa_deals', title: lang === 'ar' ? '🔥 العروض' : '🔥 Deals' } },
                    { type: 'reply', reply: { id: 'wa_bookings', title: lang === 'ar' ? '🎟️ حجوزاتي' : '🎟️ Bookings' } },
                    { type: 'reply', reply: { id: 'wa_help', title: lang === 'ar' ? '🆘 مساعدة' : '🆘 Help' } }
                ]
            }
        }
    };
}

// WhatsApp webhook verification — Meta calls GET on subscribe
app.get('/webhook/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN && WHATSAPP_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
});

// WhatsApp incoming messages — verify HMAC, then route.
//
// Security posture:
//   1. WHATSAPP_APP_SECRET MUST be set. If it isn't, we hard-reject all
//      POSTs with 503 — silently skipping verification would let any
//      attacker post forged events to /webhook/whatsapp.
//   2. The HMAC is computed over the *raw* request bytes (captured by
//      express.raw above), not over a re-serialized object.
//   3. timingSafeEqual is wrapped in try/catch because it throws on
//      length mismatch, which itself leaks no information.
app.post('/webhook/whatsapp', async (req, res) => {
    if (!WHATSAPP_APP_SECRET) {
        console.warn('⚠️ WhatsApp webhook hit but WHATSAPP_APP_SECRET is not set — rejecting.');
        return res.status(503).json({ error: 'Webhook not configured' });
    }

    const signature = req.headers['x-hub-signature-256'];
    if (!signature || typeof signature !== 'string') {
        return res.status(401).json({ error: 'Missing signature' });
    }

    // req.body is a Buffer here because of express.raw on this route.
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
    const expected = 'sha256=' + crypto.createHmac('sha256', WHATSAPP_APP_SECRET).update(rawBody).digest('hex');

    let signatureValid = false;
    try {
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expected);
        if (sigBuf.length === expBuf.length) {
            signatureValid = crypto.timingSafeEqual(sigBuf, expBuf);
        }
    } catch { /* signatureValid stays false */ }

    if (!signatureValid) {
        console.warn('⚠️ WhatsApp webhook: invalid signature');
        return res.status(403).json({ error: 'Invalid signature' });
    }

    // Parse the verified raw body into JSON now that we trust it.
    let parsedBody;
    try {
        parsedBody = JSON.parse(rawBody.toString('utf8'));
    } catch {
        return res.status(400).json({ error: 'Invalid JSON' });
    }

    // Acknowledge immediately — Meta retries if it doesn't get a 200 in 20s
    res.status(200).send('OK');

    // Process asynchronously
    try {
        const entries = parsedBody?.entry || [];
        for (const entry of entries) {
            const changes = entry.changes || [];
            for (const change of changes) {
                const messages = change.value?.messages || [];
                for (const msg of messages) {
                    const from = msg.from;
                    if (!from) continue;
                    if (!checkRateLimit(`wa_${from}`)) continue;

                    // Detect lang from contact profile if available
                    const lang = 'ar'; // default ar; can be improved with contact profile.locale

                    if (msg.type === 'text') {
                        const text = sanitize(msg.text?.body || '', 200).toLowerCase();
                        if (['hi', 'hello', 'مرحبا', 'السلام عليكم', 'menu', 'قائمة', 'start'].some(k => text.includes(k))) {
                            await sendWhatsAppMessage(from, whatsappMainMenu(lang));
                        } else if (['deals', 'عروض', 'تخفيضات'].some(k => text.includes(k))) {
                            const deals = await getActiveDeals(3);
                            if (!deals.length) {
                                await sendWhatsAppMessage(from, { type: 'text', text: { body: '📭 لا توجد عروض نشطة حالياً.' } });
                            } else {
                                let body = '🔥 أحدث العروض:\n\n';
                                deals.forEach((d, i) => {
                                    body += `${i + 1}. ${d.item_name} — ${d.discounted_price} ر.س (${d.shop_name})\n`;
                                });
                                body += `\n🌐 ${APP_URL}`;
                                await sendWhatsAppMessage(from, { type: 'text', text: { body, preview_url: false } });
                            }
                        } else {
                            await sendWhatsAppMessage(from, whatsappMainMenu(lang));
                        }
                    } else if (msg.type === 'interactive') {
                        const replyId = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id;
                        if (replyId === 'wa_deals') {
                            const deals = await getActiveDeals(3);
                            const body = deals.length
                                ? '🔥 أحدث العروض:\n\n' + deals.map((d, i) => `${i + 1}. ${d.item_name} — ${d.discounted_price} ر.س`).join('\n') + `\n\n🌐 ${APP_URL}`
                                : '📭 لا توجد عروض نشطة.';
                            await sendWhatsAppMessage(from, { type: 'text', text: { body, preview_url: false } });
                        } else if (replyId === 'wa_bookings') {
                            await sendWhatsAppMessage(from, { type: 'text', text: { body: `📦 لإدارة حجوزاتك، افتح التطبيق:\n${APP_URL}/#/bookings`, preview_url: false } });
                        } else if (replyId === 'wa_help') {
                            await sendWhatsAppMessage(from, { type: 'text', text: { body: '🆘 اكتب: "عروض" أو "menu" أو زر التطبيق:\n' + APP_URL, preview_url: false } });
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error('WhatsApp processing error:', e.message);
    }
});

// ====================== Health Check ======================
app.get('/health', (req, res) => {
    res.json({
        status: 'active',
        version: BOT_VERSION,
        services: {
            telegram: !!bot,
            supabase: !!supabase,
            whatsapp: !!(WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_ACCESS_TOKEN)
        },
        uptime_sec: Math.round(process.uptime())
    });
});

// ====================== Boot ======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 TAKI Bot Server v${BOT_VERSION} active on port ${PORT} (mode: ${BOT_MODE})`);
    if (!TELEGRAM_TOKEN) console.warn('⚠️ TELEGRAM_BOT_TOKEN missing — Telegram bot disabled');
    if (!SUPABASE_URL) console.warn('⚠️ SUPABASE_URL missing — running in offline mode');
    if (!WHATSAPP_ACCESS_TOKEN) console.warn('⚠️ WHATSAPP_ACCESS_TOKEN missing — outbound WhatsApp disabled (inbound webhook still works)');
});

// Local-test mode: pull updates via long-polling (no public URL / webhook needed).
// launch() auto-deletes any existing webhook first, so it's safe to switch back
// and forth between local polling and production webhook.
if (bot && BOT_MODE === 'polling') {
    bot.launch({ dropPendingUpdates: true })
        .then(() => console.log('🤖 Telegram bot is LIVE in POLLING mode — message it now to test.'))
        .catch((err) => console.error('❌ Polling launch failed:', err.message));
}

// Graceful shutdown
process.once('SIGINT', () => bot?.stop('SIGINT'));
process.once('SIGTERM', () => bot?.stop('SIGTERM'));
