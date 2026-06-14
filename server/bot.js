/**
 * TAKI Bot — v11.74  |  بوت تاكي الاحترافي الآمن
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
const BOT_VERSION              = '11.74.0';

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
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

const { md, money, numEsc, fmtDate, fmtDay, fmtTime, prepLabel, statusLabel, STATUS, DIV, sanitize, isPrice, isQty, priceBlock } = F;
const { CAT, catLabel, catKeyboard } = C;
const { haversineKm, fmtKm, parseLatLng, extractFromMapsUrl, resolveGoogleLocation, placeLink, dirLink, driveInfo, remainingText, durationEndsAt } = G;

const W = path => APP_URL + path;   // web deep-link (BrowserRouter, no #)

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

// ── Load/refresh session from DB (identity = telegram_id) ─────────────────────
async function refreshSession(ctx) {
    const s = getSession(tgId(ctx));
    const user = await rpc('bot_get_user', { p_telegram_id: tgId(ctx) });
    if (user) {
        s.userId   = user.id;
        s.userType = user.user_type;
        s.name     = user.name;
        s.shop     = user.shop || null;
        s.isAdmin  = !!(user.is_super_admin || user.user_type === 'admin' || (user.admin_permissions?.length > 0));
        rpc('bot_touch_chat', { p_telegram_id: tgId(ctx), p_chat_id: chatId(ctx) }); // keep chat id fresh
        if (s.userType === 'seller') {
            const st = await rpc('bot_get_seller_stats', { p_telegram_id: tgId(ctx) });
            if (st) { s.pendingBookings = st.pending_bookings || 0; s.activeDeals = st.active_deals || 0; }
        }
    } else { s.userId = null; s.userType = null; s.isAdmin = false; }
    return s;
}

// ── Keyboards ─────────────────────────────────────────────────────────────────
const KB_BACK = () => Markup.inlineKeyboard([[Markup.button.callback('◀️  رجوع للقائمة','menu:back')]]);

function kbGuest() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🚀  ابدأ الآن — تصفّح العروض','browse:menu')],
        [Markup.button.callback('🔗  دخول وربط حسابي','link:start')],
        [Markup.button.webApp('🛍  دخول سريع (متسوّق)', APP_URL)],
        [Markup.button.callback('🆘  مساعدة','help')]
    ]);
}
function kbBuyer() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🔥  تصفح العروض','browse:menu'), Markup.button.callback('🎟  حجوزاتي','buyer:bookings')],
        [Markup.button.callback('🔎  بحث','search:start'), Markup.button.callback('🎁  المسابقات','contests:list')],
        [Markup.button.callback('🔔  تنبيهاتي','buyer:notif'),  Markup.button.callback('👤  حسابي','buyer:profile')],
        [Markup.button.webApp('🚀  فتح تاكي', APP_URL)],
        [Markup.button.callback('🆘  مساعدة','help'), Markup.button.callback('🚪  تسجيل الخروج','logout')]
    ]);
}
function kbSeller(s) {
    const pBadge = s.pendingBookings > 0 ? `  •  ${s.pendingBookings}` : '';
    return Markup.inlineKeyboard([
        [Markup.button.callback('📊  إحصائياتي','seller:stats'), Markup.button.callback(`📦  الحجوزات${pBadge}`,'seller:bookings')],
        [Markup.button.callback('✅  تحقق من حجز','seller:verify'), Markup.button.callback('🏷  عروضي','seller:deals')],
        [Markup.button.callback('➕  إضافة عرض','seller:addDeal'), Markup.button.callback('📍  مواقعي','seller:branches')],
        [Markup.button.callback('💳  الاشتراك','seller:sub'), Markup.button.callback('🏪  حساب المتجر','seller:profile')],
        [Markup.button.callback('🔔  التنبيهات','alerts:open'), Markup.button.callback('🆘  مساعدة','help')],
        [Markup.button.callback('🚪  تسجيل الخروج','logout')],
        [Markup.button.webApp('🚀  لوحة التاجر', W('/seller'))]
    ]);
}
function kbAdmin() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('📊  إحصائيات المنصة','admin:stats'), Markup.button.callback('🚩  البلاغات','admin:reports')],
        [Markup.button.callback('🔥  تصفح العروض','browse:menu'), Markup.button.callback('🎟  حجوزاتي','buyer:bookings')],
        [Markup.button.callback('🔔  التنبيهات','alerts:open'), Markup.button.callback('👤  حسابي','buyer:profile')],
        [Markup.button.webApp('🛡  لوحة الإدارة الكاملة', W('/admin'))],
        [Markup.button.callback('🆘  مساعدة','help'), Markup.button.callback('🚪  تسجيل الخروج','logout')]
    ]);
}
function roleKb(s) {
    if (s.isAdmin)                 return kbAdmin();
    if (s.userType === 'seller')   return kbSeller(s);
    if (s.userType === 'buyer')    return kbBuyer();
    return kbGuest();
}
function roleMsg(s) {
    if (s.isAdmin)
        return `🛡 *لوحة الأدمن — TAKI*\n${DIV}\nمرحباً *${md(s.name)}* 👋\n\n📌 اختر من الأزرار:`;
    if (s.userType === 'seller') {
        const p = s.pendingBookings > 0 ? `\n⏳ *لديك ${s.pendingBookings} حجز بانتظار التأكيد*` : '\n✅ لا حجوزات معلقة';
        return `🏪 *لوحة التاجر — ${md(s.shop||s.name)}*\n${DIV}${p}\n🏷 عروض نشطة: ${s.activeDeals}\n\n📌 اختر من الأزرار:`;
    }
    if (s.userType === 'buyer')
        return `👋 *أهلاً ${md(s.name)}*\n${DIV}\n🛍 تصفّح العروض، احجز، وتابع حجوزاتك\\.\n\n📌 اختر من الأزرار:`;
    return `✨🛍️ *أهلاً بك في تاكي* 🛍️✨\n${DIV}\n` +
           `منصة الحجز الذكي لأقوى العروض والتخفيضات في السعودية 🇸🇦\n\n` +
           `🔥 *تصفّح مئات العروض* بالصور والأسعار\n` +
           `⚡️ *احجز بضغطة واحدة* — والباركود يوصلك فوراً\n` +
           `📍 *عروض قريبة منك* بحسب موقعك\n` +
           `🔔 *تنبيهات ذكية* لما ينزل اللي يهمّك\n\n` +
           `👇 *اضغط «ابدأ» وخلّنا نبدأ\\!*\n` +
           `_🏪 تاجر؟ اربط حسابك وأدِر متجرك كاملاً من هنا._`;
}
async function sendMain(ctx, s) {
    await ctx.reply(roleMsg(s), { parse_mode:'MarkdownV2', reply_markup: roleKb(s).reply_markup });
}

// ═══════════════════════════════════════════════════════════════════════════════
if (bot) {

bot.telegram.setMyCommands([
    { command:'start',    description:'القائمة الرئيسية' },
    { command:'deals',    description:'تصفح العروض' },
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

// Lazy identity refresh: if we don't yet know who this chat belongs to (e.g. the
// user just linked their account from the Mini App), load their profile from the
// DB BEFORE any handler runs — so حجوزاتي / الحجوزات / إلخ recognise them without
// needing /start first. Once known it's a no-op (no further DB hit).
bot.use(async (ctx, next) => {
    try { const id = tgId(ctx); if (id && !getSession(id).userId) await refreshSession(ctx); }
    catch { /* never block the update */ }
    return next();
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
            s.userId=result.id; s.userType=result.user_type; s.name=result.name; s.shop=result.shop||null;
            s.isAdmin=!!(result.is_super_admin || result.user_type==='admin' || (result.admin_permissions?.length>0));
            if (s.userType==='seller') { const st = await rpc('bot_get_seller_stats',{p_telegram_id:tgId(ctx)}); if (st) { s.pendingBookings=st.pending_bookings||0; s.activeDeals=st.active_deals||0; } }
            await ctx.reply(`✅ *تم ربط حسابك بنجاح\\!*\nأهلاً *${md(s.name)}* 👋`, { parse_mode:'MarkdownV2' });
            return sendMain(ctx, s);
        }
        await ctx.reply(`⚠️ *رابط الربط غير صالح أو منتهي*\nأنشئ رابطاً جديداً من حسابك في الموقع \\(تنتهي صلاحيته خلال 15 دقيقة\\)\\.`, { parse_mode:'MarkdownV2' });
    }
    const s = await refreshSession(ctx);
    await sendMain(ctx, s);
});

bot.command('menu', async ctx => { const s = await refreshSession(ctx); await sendMain(ctx, s); });
bot.action('menu:back', async ctx => { await ctx.answerCbQuery(); const s = await refreshSession(ctx); await sendMain(ctx, s); });

// ── Help ──────────────────────────────────────────────────────────────────────
bot.command('help', ctx => showHelp(ctx));
bot.action('help', async ctx => { await ctx.answerCbQuery(); showHelp(ctx); });
async function showHelp(ctx) {
    const s = getSession(tgId(ctx));
    let m = `🆘 *مساعدة TAKI*\n${DIV}\n`;
    if (!s.userId) m += `🔗 اربط حسابك للوصول لكل الميزات: /link\n\n`;
    m += `📌 *الأوامر:*\n/menu — القائمة\n/deals — تصفّح العروض\n/link — ربط الحساب\n/bookings — حجوزاتي\n/alerts — تنبيهاتي\n`;
    if (s.userType==='seller'||s.isAdmin) m += `/stats — إحصائياتي\n/verify — تحقق من حجز\n`;
    if (s.userId) m += `/logout — تسجيل الخروج\n`;
    m += `\n💡 تقدر أيضاً تكتب: عروض، حجوزاتي، تنبيهات، مساعدة\\.`;
    // NOTE: APP_URL contains '.' and '-' which are MarkdownV2-special — escape it
    // (an unescaped URL here was making the whole Help message fail to send).
    m += `\n🌐 الموقع: ${md(APP_URL)}`;
    const rows = [[Markup.button.webApp('🚀 فتح تاكي', APP_URL)]];
    if (!s.userId) rows.push([Markup.button.callback('🔗 ربط حسابي','link:start')]);
    rows.push([Markup.button.callback('◀️  رجوع للقائمة','menu:back')]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
}

// ── Logout (unlink this Telegram identity from the account) ───────────────────
bot.command('logout', ctx => startLogout(ctx));
bot.action('logout', async ctx => { await ctx.answerCbQuery(); startLogout(ctx); });
async function startLogout(ctx) {
    const s = getSession(tgId(ctx));
    if (!s.userId) { const ns = await refreshSession(ctx); return sendMain(ctx, ns); }
    await ctx.reply(
        `🚪 *تسجيل الخروج*\n${DIV}\nسيُفصل حسابك عن البوت وتتوقف الإشعارات\\.\nتقدر تربطه من جديد في أي وقت ✅\n\nهل أنت متأكد؟`,
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🚪 نعم، سجّل خروجي','logout:yes')],
            [Markup.button.callback('◀️ تراجع','menu:back')]
        ]).reply_markup });
}
bot.action('logout:yes', async ctx => {
    await ctx.answerCbQuery('جاري تسجيل الخروج…');
    const r = await rpc('bot_unlink', { p_telegram_id: tgId(ctx) });
    const s = getSession(tgId(ctx));
    s.userId=null; s.userType=null; s.isAdmin=false; s.name=null; s.shop=null;
    s.geo=null; s.pendingBookings=0; s.activeDeals=0; s.temp={}; s.step='idle';
    await ctx.reply(r?.success ? `✅ *تم تسجيل خروجك بنجاح*\nنتشرّف بعودتك 👋` : `ℹ️ حسابك غير مربوط بالبوت أصلاً\\.`, { parse_mode:'MarkdownV2' });
    return sendMain(ctx, s);
});

// ── Link account (secure — token minted in authenticated web session) ─────────
bot.command('link', ctx => startLink(ctx));
bot.action('link:start', async ctx => { await ctx.answerCbQuery(); startLink(ctx); });
async function startLink(ctx) {
    await ctx.reply(
        `🔗 *الدخول وربط حسابك بتاكي*\n${DIV}\n` +
        `اضغط الزر بالأسفل لفتح *تاكي داخل تيليجرام* وسجّل دخولك \\(تاجر أو متسوّق\\)\\.\n` +
        `بمجرد دخولك سيُفتح *حسابي* ويُربط حسابك بتيليجرام *تلقائياً* ✅\n` +
        `وإن لم يكن لديك حساب، أنشئ حساباً في نفس الصفحة ثم يُربط 👌\n\n` +
        `🔒 آمن تماماً: الربط بهويتك في تيليجرام بعد دخولك \\(لا أحد يربط حسابك سواك\\)\\.`,
        { parse_mode:'MarkdownV2',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.webApp('🔗  الدخول وربط حسابي', W('/register?tglink=1'))],
            [Markup.button.webApp('🛍  أو تصفّح كمتسوّق', APP_URL)],
            [Markup.button.callback('◀️  رجوع','menu:back')]
          ]).reply_markup }
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  Browse v11 — filters + categories + nearby + rich deal detail
//  (mirrors the web app: distance & drive-time, sponsors ⭐, deal-type, stock)
// ═══════════════════════════════════════════════════════════════════════════════

const SORTMAP     = { p:'popular', d:'discount', n:'newest', s:'sponsored', x:'nearby' };
const SORT_TITLE  = { popular:'🔥 الأكثر طلباً', discount:'💸 الأكثر خصماً', newest:'🆕 أحدث العروض', sponsored:'⭐ المميّزة والرعاة', nearby:'📍 الأقرب إليك' };
const SORT_SHORT  = { p:'🔥 الأكثر طلباً', d:'💸 الأكثر خصماً', n:'🆕 الأحدث', x:'📍 الأقرب' };
const PAGE   = 6;

// Full deal-type block: how it ends (days/specific date/quantity) + what's left.
function dealTypeBlock(d){
    const lines=[];
    if(d.expiry_type==='stock'){ lines.push(d.is_unlimited ? '📦 الكمية: غير محدودة' : `📦 المتبقّي: *${numEsc(d.quantity??0)}* قطعة`); }
    else if(d.expiry_type==='date' && d.expiry_date){ lines.push(`📅 ساري حتى: *${md(d.expiry_date)}*`); if(!d.is_unlimited) lines.push(`📦 المتبقّي: *${numEsc(d.quantity??0)}*`); }
    else { const r=remainingText(d); lines.push(r ? `⏳ ينتهي خلال: *${md(r)}*` : '⏳ عرض لفترة محدودة'); if(!d.is_unlimited) lines.push(`📦 المتبقّي: *${numEsc(d.quantity??0)}*`); }
    return lines.join('\n');
}
function sponsorWord(d){ return d.sponsor_label==='sponsor' ? 'راعٍ رسمي' : 'إعلان مميّز'; }
function sponsorTag(d){ if(!d.is_sponsored) return ''; return `⭐️ ━━━━━ *${sponsorWord(d)}* ━━━━━ ⭐️`; }
// placeLink / dirLink / driveInfo → lib/geo.js
// One clear expiry/type line — shows HOW the deal ends (by time vs by quantity)
// plus the exact end date & time when it's time-based. Mirrors the website. v11.72
function browseExpiryLine(d){
    if(d.expiry_type==='stock'){
        return d.is_unlimited ? '📦 النوع: حسب الكمية • متوفّر' : `📦 ينتهي بنفاد الكمية • متبقّي *${numEsc(d.quantity??0)}* قطعة`;
    }
    if(d.expiry_type==='date' && d.expiry_date){
        const stk = d.is_unlimited ? '' : ` • متبقّي *${numEsc(d.quantity??0)}*`;
        return `⏳ ينتهي بالوقت • 📅 *${md(fmtDate(d.expiry_date))}*${stk}`;
    }
    const r = remainingText(d), end = durationEndsAt(d);
    const when = end ? `  \\(📅 ${md(fmtDate(end))}\\)` : '';
    const stk = d.is_unlimited ? '' : ` • متبقّي *${numEsc(d.quantity??0)}*`;
    return r ? `⏳ ينتهي بالوقت • خلال *${md(r)}*${when}${stk}` : `⏳ عرض لفترة محدودة${stk}`;
}
// One self-contained browse CARD (its own message + a tap button) — like the
// deals page. Tappable location, before/after price, expiry date/type. v11.72
function browseCard(d, n, geo){
    const save = Math.max(0, Number(d.original_price) - Number(d.discounted_price));
    const dist = (geo && d.distance_km!=null) ? `  •  🚗 ${numEsc(d.distance_km)} كم` : '';
    const pl = placeLink(d);
    const loc = pl ? `[📍 ${md(d.city||d.region||'الموقع')}](${pl})` : `📍 ${md(d.city||d.region||'—')}`;
    const price = save > 0
        ? `🟢 *${money(d.discounted_price)} ر\\.س*  \\(قبل ~${money(d.original_price)}~ • خصم ${numEsc(d.discount_percentage)}%\\)`
        : `🟢 *${money(d.discounted_price)} ر\\.س*`;
    const head = d.is_sponsored
        ? `⭐️ *${sponsorWord(d)}*\n*${numEsc(n)}\\.* 🏷 *${md(d.item_name)}*`
        : `*${numEsc(n)}\\.* 🏷 *${md(d.item_name)}*`;
    return `${head}\n🏪 ${md(d.shop_name)}  •  ${loc}${dist}\n${price}\n${browseExpiryLine(d)}`;
}

bot.command('deals', ctx => showBrowseMenu(ctx));
bot.action('browse:menu', async ctx => { await ctx.answerCbQuery(); showBrowseMenu(ctx); });
bot.action(/^deals:(\d+)$/, async ctx => { await ctx.answerCbQuery(); renderList(ctx,'n','-',+ctx.match[1]); }); // legacy alias
async function showBrowseMenu(ctx){
    const s=getSession(tgId(ctx));
    await sendBanners(ctx);   // Task 5a — promotional banner(s) appear ABOVE the offers
    const near = s.geo ? '📍 العروض الأقرب إليك' : '📍 العروض حولي (شارك موقعك)';
    await ctx.reply(`🛍 *تصفّح العروض*\n${DIV}\nاختر طريقة العرض التي تناسبك:`, { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔎 بحث (متجر / عرض / تاجر)','search:start')],
            [Markup.button.callback('🔥 الأكثر طلباً','br:p:-:0'), Markup.button.callback('💸 الأكثر خصماً','br:d:-:0')],
            [Markup.button.callback('🆕 الأحدث','br:n:-:0'), Markup.button.callback('⭐ المميّزة والرعاة','br:s:-:0')],
            [Markup.button.callback('📂 حسب التصنيف','browse:cats')],
            [Markup.button.callback(near,'browse:near')],
            [Markup.button.callback('🎁 المسابقات والجوائز','contests:list')],
            [Markup.button.callback('◀️ رجوع للقائمة','menu:back')]
        ]).reply_markup });
}

// ── Banners shown above the offers (Task 5a) — image cards with a tap action ───
async function sendBanners(ctx){
    let banners = [];
    try { banners = await rpc('bot_active_banners', {}) || []; } catch { banners = []; }
    for (const b of banners.slice(0,3)){
        const btns = [];
        if (b.deal_id)       btns.push([Markup.button.callback('🛍 شوف العرض', `deal:${b.deal_id}`)]);
        else if (b.store_id) btns.push([Markup.button.callback('🏪 شوف المتجر', `store:${b.store_id}`)]);
        else if (b.target_url && /^https?:\/\//i.test(b.target_url)) btns.push([Markup.button.url('🔗 التفاصيل', b.target_url)]);
        const cap = `📣 *${md(b.title)}*`;
        const rm  = btns.length ? { reply_markup: Markup.inlineKeyboard(btns).reply_markup } : {};
        if (b.image_url){ try { await ctx.replyWithPhoto(b.image_url, { caption: cap, parse_mode:'MarkdownV2', ...rm }); continue; } catch { /* fall through to text */ } }
        await ctx.reply(cap, { parse_mode:'MarkdownV2', ...rm });
    }
}

// ── Search: deals + stores by keyword (Task 4) — mirrors the website search ────
bot.command('search', async ctx => { setStep(tgId(ctx),'await_search'); await ctx.reply('🔎 *البحث*\nاكتب ما تبحث عنه \\(اسم عرض، متجر، تاجر، مدينة أو تصنيف\\):', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ القائمة','browse:menu')]]).reply_markup }); });
bot.action('search:start', async ctx => {
    await ctx.answerCbQuery();
    setStep(tgId(ctx),'await_search');
    await ctx.reply('🔎 *البحث*\nاكتب ما تبحث عنه \\(اسم عرض، متجر، تاجر، مدينة أو تصنيف\\):', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ رجوع','browse:menu')]]).reply_markup });
});
async function runSearch(ctx, q){
    setStep(tgId(ctx),'idle');
    const r = await rpc('bot_search', { p_query: q, p_limit: 8 });
    const deals  = (r && Array.isArray(r.deals))  ? r.deals  : [];
    const stores = (r && Array.isArray(r.stores)) ? r.stores : [];
    if (!deals.length && !stores.length){
        return ctx.reply(`🔎 *لا نتائج لـ* «${md(q)}»\nجرّب كلمة أعمّ أو تصنيفاً مختلفاً\\.`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔎 بحث جديد','search:start'), Markup.button.callback('◀️ القائمة','browse:menu')]]).reply_markup });
    }
    const s = getSession(tgId(ctx));
    s.temp.listCb = 'browse:menu';
    await ctx.reply(`🔎 *نتائج البحث عن* «${md(q)}»\n${DIV}\n🛍 عروض: *${numEsc(deals.length)}*  •  🏪 متاجر: *${numEsc(stores.length)}*`, { parse_mode:'MarkdownV2' });
    for (const st of stores.slice(0,6)){
        const where = [st.city, st.region].filter(Boolean).join(' • ');
        await ctx.reply(`🏪 *${md(st.shop_name)}*${where?`\n📍 ${md(where)}`:''}\n🏷 عروض نشطة: *${numEsc(st.deals_n)}*`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🏪 صفحة المتجر','store:'+st.store_id)]]).reply_markup });
    }
    for (let i=0;i<deals.length;i++){
        const d = deals[i];
        await ctx.reply(browseCard(d, i+1, null), { parse_mode:'MarkdownV2', link_preview_options:{is_disabled:true}, reply_markup: Markup.inlineKeyboard([[Markup.button.callback('📋 التفاصيل والحجز', `deal:${d.id}`)]]).reply_markup });
    }
    await ctx.reply(`${DIV}`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔎 بحث جديد','search:start'), Markup.button.callback('◀️ القائمة','browse:menu')]]).reply_markup });
}

// ── Contests & prizes (Task 5b) — list, details, and in-bot entry (quiz+social) ─
bot.command('contests', ctx => showContests(ctx));
bot.action('contests:list', async ctx => { await ctx.answerCbQuery(); showContests(ctx); });
async function showContests(ctx){
    const list = await rpc('bot_list_contests', { p_telegram_id: tgId(ctx) }) || [];
    if (!list.length) return ctx.reply(`🎁 *المسابقات والجوائز*\n${DIV}\nلا توجد مسابقة فعّالة الآن\\.\n_تابعنا — تنزل مسابقات وجوائز قريباً 🎉_`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔄 تحديث','contests:list'), Markup.button.callback('◀️ القائمة','browse:menu')]]).reply_markup });
    await ctx.reply(`🎁 *المسابقات والجوائز* \\(${numEsc(list.length)}\\)\n${DIV}\n_شارك واربح — كل مسابقة في بطاقة 👇_`, { parse_mode:'MarkdownV2' });
    for (const c of list){
        let m = `🎁 *${md(c.title)}*`;
        if (c.prize)       m += `\n🏆 الجائزة: *${md(c.prize)}*`;
        if (c.description) m += `\n${md(String(c.description).slice(0,200))}`;
        if (c.ends_at)     m += `\n⏰ تنتهي: ${md(fmtDay(c.ends_at))}`;
        const label = c.entered ? '✅ شاركت — التفاصيل' : '🎁 شارك الآن';
        await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback(label, `contest:open:${c.id}`)]]).reply_markup });
    }
    await ctx.reply(`${DIV}`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔄 تحديث','contests:list'), Markup.button.callback('◀️ القائمة','browse:menu')]]).reply_markup });
}
bot.action(/^contest:open:([0-9a-fA-F-]+)$/, async ctx => { await ctx.answerCbQuery(); openContest(ctx, ctx.match[1]); });
async function openContest(ctx, id){
    const c = await rpc('bot_get_contest', { p_telegram_id: tgId(ctx), p_contest_id: id });
    if (!c) return ctx.reply('⚠️ المسابقة غير متاحة\\.', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎁 المسابقات','contests:list')]]).reply_markup });
    let m = `🎁 *${md(c.title)}*\n${DIV}`;
    if (c.prize)       m += `\n🏆 الجائزة: *${md(c.prize)}*`;
    if (c.description) m += `\n\n${md(String(c.description).slice(0,400))}`;
    if (c.ends_at)     m += `\n\n⏰ تنتهي: ${md(fmtDay(c.ends_at))}`;
    const qn = Array.isArray(c.questions) ? c.questions.length : 0;
    const sn = Array.isArray(c.social_tasks) ? c.social_tasks.length : 0;
    if (qn||sn) m += `\n📝 ${numEsc(qn)} سؤال${sn?` • ${numEsc(sn)} مهمة`:''}`;
    const btns = [];
    if (!c.live)          m += '\n\n_⏰ هذه المسابقة لم تعد متاحة._';
    else if (c.entered)   m += `\n\n✅ *شاركت في هذه المسابقة* — بالتوفيق 🤞`;
    else if (!c.linked) { m += '\n\n❗ سجّل دخولك لتشارك\\.'; btns.push([Markup.button.callback('🔗 ربط حسابي','link:start')]); }
    else if (!c.has_phone){ m += '\n\n❗ أضف رقم جوالك في حسابك ثم شارك\\.'; btns.push([Markup.button.webApp('✏️ أكمل جوالك', W('/profile'))]); }
    else                  btns.push([Markup.button.callback('🎁 ابدأ المشاركة', `contest:go:${id}`)]);
    btns.push([Markup.button.callback('◀️ المسابقات','contests:list')]);
    const rm = { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup };
    if (c.banner_image){ try { return await ctx.replyWithPhoto(c.banner_image, { caption:m, ...rm }); } catch { /* fall through */ } }
    await ctx.reply(m, rm);
}
bot.action(/^contest:go:([0-9a-fA-F-]+)$/, async ctx => { await ctx.answerCbQuery(); startContestQuiz(ctx, ctx.match[1]); });
async function startContestQuiz(ctx, id){
    const c = await rpc('bot_get_contest', { p_telegram_id: tgId(ctx), p_contest_id: id });
    if (!c || !c.live)  return ctx.reply('⚠️ المسابقة لم تعد متاحة\\.', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎁 المسابقات','contests:list')]]).reply_markup });
    if (c.entered)      return openContest(ctx, id);
    if (!c.linked)      return ctx.reply('❗ سجّل دخولك أولاً عبر «ربط حسابي»\\.', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔗 ربط حسابي','link:start')]]).reply_markup });
    if (!c.has_phone)   return ctx.reply('❗ أضف رقم جوالك في حسابك ثم شارك\\.', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.webApp('✏️ أكمل جوالك', W('/profile'))]]).reply_markup });
    const s = getSession(tgId(ctx));
    s.temp.cwiz = { id, questions: Array.isArray(c.questions)?c.questions:[], social: Array.isArray(c.social_tasks)?c.social_tasks:[], answers:{}, social_answers:{}, qi:0, si:0 };
    return askContestStep(ctx);
}
// Drives the quiz one step at a time: questions first, then social tasks, then submit.
async function askContestStep(ctx){
    const s = getSession(tgId(ctx)); const w = s.temp.cwiz; if (!w) return;
    if (w.qi < w.questions.length){
        const q = w.questions[w.qi];
        const prompt = `❓ *سؤال ${numEsc(w.qi+1)}/${numEsc(w.questions.length)}*\n${md(q.prompt||'')}`;
        if (q.type === 'choice' && Array.isArray(q.options) && q.options.length){
            const rows = q.options.map((opt,idx) => [Markup.button.callback(String(opt).slice(0,60), `cq:${idx}`)]);
            if (!q.required) rows.push([Markup.button.callback('⏭ تخطّي','cq:skip')]);
            rows.push([Markup.button.callback('❌ إلغاء','contests:list')]);
            setStep(tgId(ctx),'idle');
            return ctx.reply(prompt, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
        }
        setStep(tgId(ctx),'await_contest_answer');
        const rows = [];
        if (!q.required) rows.push([Markup.button.callback('⏭ تخطّي','cq:skip')]);
        rows.push([Markup.button.callback('❌ إلغاء','contests:list')]);
        return ctx.reply(`${prompt}\n\n_اكتب إجابتك:_`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
    }
    if (w.si < w.social.length){
        const t = w.social[w.si];
        setStep(tgId(ctx),'await_contest_social');
        return ctx.reply(`📲 *مهمة ${numEsc(w.si+1)}/${numEsc(w.social.length)}*\n${md(t.prompt||'')}\n\n_اكتب إجابتك:_`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('⏭ تخطّي','cq:skip')],[Markup.button.callback('❌ إلغاء','contests:list')]]).reply_markup });
    }
    return submitContest(ctx);
}
bot.action(/^cq:(\d+|skip)$/, async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx)); const w = s.temp.cwiz;
    if (!w) return ctx.reply('⚠️ انتهت جلسة المسابقة — افتحها من جديد\\.', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎁 المسابقات','contests:list')]]).reply_markup });
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
        const msg = e==='already_entered' ? '✅ شاركت في هذه المسابقة من قبل — لكل مشارك محاولة واحدة فقط\\.'
            : e==='no_phone'    ? '❗ أضف رقم جوالك في حسابك ثم شارك\\.'
            : e==='not_linked'  ? '❗ سجّل دخولك أولاً\\.'
            : e==='ended'       ? '⏰ انتهت مدة المسابقة\\.'
            : e==='not_started' ? '⏳ المسابقة لم تبدأ بعد\\.'
            : e==='not_active'  ? '⚠️ المسابقة غير مفعّلة حالياً\\.'
            : (e==='sellers_only'||e==='buyers_only') ? '⚠️ هذه المسابقة مخصّصة لفئة مختلفة\\.'
            : '⚠️ تعذّرت المشاركة، حاول لاحقاً\\.';
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎁 المسابقات','contests:list')]]).reply_markup });
    }
    const head  = r.qualified ? '🎉 *تم تسجيل مشاركتك — وتأهّلت\\!*' : '✅ *تم تسجيل مشاركتك بنجاح\\!*';
    const score = (r.max_score>0) ? `\n📊 نتيجتك: *${numEsc(r.score)}/${numEsc(r.max_score)}*` : '';
    await ctx.reply(`${head}${score}\n${DIV}\nبالتوفيق 🤞 — تابع إشعاراتك لإعلان الفائزين\\.`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎁 مسابقات أخرى','contests:list'), Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
}

// br:<sortLetter>:<category|->:<offset>
bot.action(/^br:([pdnsx]):([A-Za-z_\-]+):(\d+)$/, async ctx => { await ctx.answerCbQuery(); await renderList(ctx, ctx.match[1], ctx.match[2], +ctx.match[3]); });
async function renderList(ctx, sortLetter, cat, offset){
    if(!checkRL(`br:${chatId(ctx)}`)) return;
    const s=getSession(tgId(ctx));
    const sort=SORTMAP[sortLetter]||'newest';
    const geo=(sort==='nearby')?s.geo:undefined;
    if(sort==='nearby' && !geo) return askLocation(ctx);
    const deals=await rpc('bot_browse_deals',{ p_sort:sort, p_category:(cat&&cat!=='-')?cat:null,
        p_lat:geo?geo.lat:null, p_lng:geo?geo.lng:null, p_radius_km:null, p_limit:PAGE, p_offset:offset })||[];
    const catName=(cat&&cat!=='-')?`  ·  ${catLabel(cat)}`:'';
    s.temp.listCb=`br:${sortLetter}:${cat||'-'}:${offset}`;
    if(!deals.length){
        const msg=offset===0?`📭 *لا توجد عروض مطابقة*${geo?'\nجرّب توسيع المنطقة أو تصنيفاً آخر\\.':''}`:'📭 *لا مزيد من العروض*';
        return ctx.reply(`${SORT_TITLE[sort]}${md(catName)}\n${DIV}\n\n${msg}`, { parse_mode:'MarkdownV2',
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback('📂 تصنيف آخر','browse:cats'),Markup.button.callback('◀️ القائمة','browse:menu')]]).reply_markup });
    }
    // Header, then ONE self-contained card per deal (button attached) — exactly
    // like the deals page, so each deal is its own tappable box. v11.72
    await ctx.reply(`${SORT_TITLE[sort]}${md(catName)}\n${DIV}\n_كل عرض في بطاقة مستقلة — اضغط «التفاصيل والحجز» تحته 👇_`, { parse_mode:'MarkdownV2' });
    for(let i=0;i<deals.length;i++){
        const d=deals[i];
        await ctx.reply(browseCard(d, offset+i+1, geo), { parse_mode:'MarkdownV2', link_preview_options:{is_disabled:true},
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback(`📋 التفاصيل والحجز${d.is_sponsored?' ⭐':''}`, `deal:${d.id}`)]]).reply_markup });
    }
    const rows=[];
    const nav=[];
    if(offset>0) nav.push(Markup.button.callback('◀️ السابق',`br:${sortLetter}:${cat||'-'}:${Math.max(0,offset-PAGE)}`));
    if(deals.length===PAGE) nav.push(Markup.button.callback('التالي ▶️',`br:${sortLetter}:${cat||'-'}:${offset+PAGE}`));
    if(nav.length) rows.push(nav);
    const sw=[];
    ['p','d','n'].forEach(sl=>{ if(sl!==sortLetter) sw.push(Markup.button.callback(SORT_SHORT[sl],`br:${sl}:${cat||'-'}:0`)); });
    if(s.geo && sortLetter!=='x') sw.push(Markup.button.callback(SORT_SHORT.x,`br:x:${cat||'-'}:0`));
    if(sw.length) rows.push(sw);
    rows.push([Markup.button.callback('📂 التصنيفات','browse:cats'),Markup.button.callback('◀️ القائمة','browse:menu')]);
    await ctx.reply(`${DIV}\n📄 صفحة ${md(String(Math.floor(offset/PAGE)+1))} • اختر التالي أو رتّب بطريقة أخرى:`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
}

// Category picker (counts respect the user's shared location when available).
bot.action('browse:cats', async ctx => { await ctx.answerCbQuery(); showCats(ctx); });
async function showCats(ctx){
    const s=getSession(tgId(ctx));
    const cats=await rpc('bot_get_categories',{ p_lat:s.geo?s.geo.lat:null, p_lng:s.geo?s.geo.lng:null, p_radius_km:null })||[];
    if(!cats.length) return ctx.reply('📭 *لا توجد تصنيفات نشطة حالياً*', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ القائمة','browse:menu')]]).reply_markup });
    const rows=[]; let row=[];
    cats.forEach(c=>{ row.push(Markup.button.callback(`${catLabel(c.category)} (${c.n})`,`br:n:${c.category}:0`)); if(row.length===2){ rows.push(row); row=[]; } });
    if(row.length) rows.push(row);
    rows.push([Markup.button.callback('◀️ القائمة','browse:menu')]);
    await ctx.reply(`📂 *التصنيفات المتوفّرة*\n${DIV}\nاختر تصنيفاً لعرض عروضه:`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
}

// Nearby — ask the user to share their location (Telegram location keyboard).
bot.action('browse:near', async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); if(s.geo) return renderList(ctx,'x','-',0); askLocation(ctx); });
function askLocation(ctx){
    return ctx.reply('📍 *العروض حولك*\nشارك موقعك لأرتّب لك العروض حسب الأقرب وأحسب المسافة بالسيارة 🚗', { parse_mode:'MarkdownV2',
        reply_markup: Markup.keyboard([[Markup.button.locationRequest('📍 مشاركة موقعي الآن')],['❌ إلغاء']]).resize().oneTime().reply_markup });
}
bot.on('location', async ctx => {
    const loc=ctx.message && ctx.message.location; if(!loc) return;
    const s=getSession(tgId(ctx));
    // تدفّق التاجر يلتقط موقعاً (إضافة/تعديل/فرع عبر «مشاركة موقعي»)؟
    try { if (await sellerH.handleLocation(ctx, s, loc.latitude, loc.longitude)) return; } catch (e) { console.warn('loc:', e.message); }
    s.geo={ lat:loc.latitude, lng:loc.longitude };
    // Persist onto the linked account (one DB, one source) so we can later push
    // "عروض حولك" notifications by proximity. Fire-and-forget — never block UX.
    if (s.userId) rpc('bot_set_location', { p_telegram_id: tgId(ctx), p_lat: loc.latitude, p_lng: loc.longitude });
    const saved = s.userId ? '\n📌 _حفظنا موقعك لنرسل لك عروض ما حولك_' : '';
    await ctx.reply(`✅ *تم تحديد موقعك* — إليك الأقرب إليك:${saved}`, { parse_mode:'MarkdownV2', reply_markup: Markup.removeKeyboard().reply_markup });
    await renderList(ctx,'x','-',0);
});

// ── Deal detail (rich: images album + deal-type + distance/drive + sponsor) ────
bot.action(/^deal:([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    const dealId = ctx.match[1];
    const d = await rpc('bot_get_deal', { p_deal_id: dealId, p_telegram_id: tgId(ctx) });
    if (!d) return ctx.reply('⏰ *انتهى هذا العرض* أو لم يعد متاحاً للحجز\\.\n_تصفّح العروض المتاحة الآن 👇_', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔥 العروض المتاحة','browse:menu')]]).reply_markup });
    const s = getSession(tgId(ctx));
    s.temp.dealId = dealId; s.temp.dealName = d.item_name; s.temp.dealQty = 1;
    const tag  = sponsorTag(d);
    const cat  = d.category ? `\n🏷 التصنيف: ${md(catLabel(d.category))}` : '';
    const rating = d.rating_count>0 ? `\n⭐ التقييم: *${md(String(d.rating_avg))}* \\(${d.rating_count} تقييم\\)` : '';
    const prep = d.prep_time ? `\n⏱ وقت التجهيز: ${md(d.prep_time)}` : '';
    const desc = d.description ? `\n\n📝 *الملاحظات:*\n${md(String(d.description).slice(0,500))}` : '';
    let geoBlock='';
    const di = await driveInfo(s.geo, d);
    if (di) geoBlock = `\n📍 المسافة: *${numEsc(fmtKm(di.straight))} كم* \\(مباشرة\\)\n🚗 بالسيارة: *${di.est?'~':''}${numEsc(di.min)} دقيقة* \\(${numEsc(fmtKm(di.km))} كم${di.est?' تقريباً':''}\\)`;
    else if (d.map_lat!=null) geoBlock = `\n📍 شارك موقعك لمعرفة المسافة والوقت بالسيارة`;
    const caption =
        `${tag?tag+'\n':''}🏷 *${md(d.item_name)}*\n${DIV}\n🏪 ${md(d.shop_name)}   📍 ${md(d.city||d.region||'—')}${cat}${rating}\n\n` +
        priceBlock(d.original_price, d.discounted_price, d.discount_percentage) +
        `\n\n${dealTypeBlock(d)}${prep}${geoBlock}${desc}`;
    const btns = [];
    if (s.userId && s.userType !== 'seller') btns.push([Markup.button.callback('📥  احجز الآن','book:qty')]);
    else if (!s.userId) btns.push([Markup.button.webApp('🛍  سجّل دخولك لتحجز', APP_URL)]);
    if (d.store_id) {
        // Tap the merchant to open their store profile (Task 6).
        btns.push([Markup.button.callback('🏪 صفحة المتجر / التاجر', `store:${d.store_id}`)]);
        const folRow = [];
        if (s.userId) folRow.push(Markup.button.callback(d.following ? '✅ متابِع — إلغاء' : '➕ متابعة المتجر', d.following ? `folAsk:${d.store_id}` : `fol:${d.store_id}`));
        folRow.push(Markup.button.callback('⭐ التقييمات', `revw:${d.store_id}`));
        btns.push(folRow);
    }
    const dl = dirLink(d, s.geo);
    const row2=[];
    if (dl) row2.push(Markup.button.url('🧭 الاتجاهات', dl));
    if (!s.geo && d.map_lat!=null) row2.push(Markup.button.callback('📍 احسب المسافة','browse:near'));
    if (row2.length) btns.push(row2);
    btns.push([Markup.button.callback('◀️  رجوع للعروض', s.temp.listCb || 'browse:menu')]);
    const extra = { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup };
    const imgs = Array.isArray(d.images) ? d.images.filter(Boolean) : [];
    if (imgs.length > 1) {
        try { await ctx.replyWithMediaGroup(imgs.slice(0,5).map(u => ({ type:'photo', media:u }))); } catch { /* ignore album errors */ }
        return ctx.reply(caption, { ...extra, link_preview_options:{is_disabled:true} });
    }
    const one = imgs[0] || d.image;
    if (one) { try { return await ctx.replyWithPhoto(one, { caption, ...extra }); } catch { /* fall through to text */ } }
    await ctx.reply(caption, { ...extra, link_preview_options:{is_disabled:true} });
});

// ── Store: follow / block / reviews ───────────────────────────────────────────
bot.action(/^fol:(.+)$/, async ctx => {
    const r = await rpc('bot_toggle_follow', { p_telegram_id: tgId(ctx), p_store_id: ctx.match[1] });
    if (!r?.success) return ctx.answerCbQuery('❗ سجّل دخولك أولاً', { show_alert:true });
    return ctx.answerCbQuery(r.following ? '🔔 تابعت المتجر — بتوصلك عروضه الجديدة' : 'تم إلغاء المتابعة', { show_alert:true });
});
bot.action(/^blk:(.+)$/, async ctx => {
    const r = await rpc('bot_toggle_block', { p_telegram_id: tgId(ctx), p_store_id: ctx.match[1] });
    if (!r?.success) return ctx.answerCbQuery('❗ سجّل دخولك أولاً', { show_alert:true });
    return ctx.answerCbQuery(r.blocked ? '🚫 تم حظر المتجر — لن تظهر لك عروضه' : '✅ تم إلغاء الحظر', { show_alert:true });
});
// Confirm screens (mirror the app's «هل أنت متأكد؟») — unfollow + block. v11.72
bot.action(/^folAsk:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const sid = ctx.match[1];
    await ctx.reply('⚠️ *تأكيد إلغاء المتابعة*\nلن تصلك عروض هذا المتجر الجديدة بعد الآن\\.\nهل تريد إلغاء المتابعة؟', { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback('✅ نعم، ألغِ المتابعة',`fol:${sid}`)],[Markup.button.callback('◀️ تراجع','menu:back')]]).reply_markup });
});
bot.action(/^blkAsk:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const sid = ctx.match[1];
    await ctx.reply('🚫 *تأكيد حظر المتجر*\nلن تظهر لك عروض هذا المتجر إطلاقاً\\.\nهل تريد الحظر؟', { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🚫 نعم، احظر',`blk:${sid}`)],[Markup.button.callback('◀️ تراجع','menu:back')]]).reply_markup });
});
bot.action(/^revw:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const sid = ctx.match[1];
    const r = await rpc('bot_get_store_reviews', { p_store_id: sid, p_limit: 6 });
    if (!r?.success) return ctx.reply('⚠️ تعذّر تحميل التقييمات\\.', { parse_mode:'MarkdownV2' });
    const stars = n => '⭐'.repeat(Math.max(0, Math.min(5, Math.round(n))));
    let m = `⭐ *تقييمات المتجر*\n${DIV}\n`;
    if (r.count>0) m += `التقييم العام: *${md(String(r.avg))}* \\(${r.count} تقييم\\)\n\n`;
    const revs = r.reviews||[];
    if (!revs.length) m += '_لا توجد تقييمات بعد_';
    else for (const v of revs) {
        m += `${stars(v.score)}  _${md(v.user)}_\n`;
        if (v.comment) m += `${md(v.comment)}\n`;
        if (v.reply) m += `↩️ _رد التاجر:_ ${md(v.reply)}\n`;
        m += `\n`;
    }
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🚫 حظر المتجر',`blkAsk:${sid}`)],[Markup.button.callback('◀️ رجوع للعروض','browse:menu')]]).reply_markup });
});

// ── Store profile (buyer taps the merchant from a deal/booking) — Task 6 ──────
bot.action(/^store:(.+)$/, async ctx => { await ctx.answerCbQuery(); await renderStore(ctx, ctx.match[1]); });
async function renderStore(ctx, storeId) {
    const s = getSession(tgId(ctx));
    const st = await rpc('bot_get_store', { p_telegram_id: tgId(ctx), p_store_id: storeId });
    if (!st) return ctx.reply('⚠️ تعذّر فتح صفحة المتجر — ربما لم يعد متاحاً\\.', { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    const stars  = st.rating_count>0 ? `\n⭐ التقييم: *${md(String(st.rating_avg))}* \\(${st.rating_count} تقييم\\)` : '\n⭐ لا تقييمات بعد';
    const where  = [st.city, st.region].filter(Boolean).join(' • ');
    const loc    = where ? `\n📍 ${md(where)}` : '';
    const bio    = st.bio ? `\n\n📝 _${md(String(st.bio).slice(0,300))}_` : '';
    const m = `🏪 *${md(st.name)}*\n${DIV}${stars}${loc}\n🏷 عروض نشطة: *${numEsc(st.active_deals)}*${bio}`;
    const btns = [];
    const folRow = [];
    if (s.userId) folRow.push(Markup.button.callback(st.following ? '✅ متابِع — إلغاء' : '➕ متابعة المتجر', st.following ? `folAsk:${storeId}` : `fol:${storeId}`));
    folRow.push(Markup.button.callback('⭐ التقييمات', `revw:${storeId}`));
    btns.push(folRow);
    const deals = Array.isArray(st.deals) ? st.deals : [];
    deals.slice(0,8).forEach(d => btns.push([Markup.button.callback(`🏷 ${String(d.item_name).slice(0,26)} — ${(+d.discounted_price)} ر.س`, `deal:${d.id}`)]));
    btns.push([Markup.button.webApp('🌐 صفحة المتجر كاملة', W(`/store/${storeId}`))]);
    btns.push([Markup.button.callback('◀️ رجوع للعروض', s.temp.listCb || 'browse:menu')]);
    const extra = { parse_mode:'MarkdownV2', link_preview_options:{is_disabled:true}, reply_markup: Markup.inlineKeyboard(btns).reply_markup };
    if (st.avatar) { try { return await ctx.replyWithPhoto(st.avatar, { caption:m, parse_mode:'MarkdownV2', reply_markup: extra.reply_markup }); } catch { /* fall through to text */ } }
    await ctx.reply(m, extra);
}

// ── Rate a completed booking (⭐ 1–5 + optional comment) ───────────────────────
bot.action(/^rate:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const bc = ctx.match[1];
    await ctx.reply('⭐ *قيّم تجربتك*\nاختر عدد النجوم:', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('⭐',`rst:${bc}:1`), Markup.button.callback('⭐⭐',`rst:${bc}:2`), Markup.button.callback('⭐⭐⭐',`rst:${bc}:3`)],
        [Markup.button.callback('⭐⭐⭐⭐',`rst:${bc}:4`), Markup.button.callback('⭐⭐⭐⭐⭐',`rst:${bc}:5`)],
        [Markup.button.callback('◀️ رجوع','buyer:bookings')]
    ]).reply_markup });
});
bot.action(/^rst:(.+):([1-5])$/, async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    s.temp.rateBarcode = ctx.match[1]; s.temp.rateScore = +ctx.match[2];
    setStep(tgId(ctx),'await_rate_comment');
    await ctx.reply(`${'⭐'.repeat(+ctx.match[2])}\n📝 اكتب تعليقك \\(اختياري\\) أو تخطَّ:`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('تخطّي وإرسال ✅','rateskip')],[Markup.button.callback('❌ إلغاء','buyer:bookings')]]).reply_markup });
});
bot.action('rateskip', async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); setStep(tgId(ctx),'idle'); const r = await rpc('bot_rate_store', { p_telegram_id: tgId(ctx), p_barcode: s.temp.rateBarcode, p_score: s.temp.rateScore, p_comment: null }); return afterRate(ctx, r); });
async function afterRate(ctx, r) {
    if (!r?.success) {
        const e=r?.error; const msg = e==='not_completed' ? '⚠️ تقدر تقيّم بعد إتمام الحجز فقط\\.' : e==='not_found' ? '❌ الحجز غير موجود\\.' : e==='bad_score' ? '❗ التقييم من 1 إلى 5\\.' : e==='not_linked' ? '❗ سجّل دخولك أولاً\\.' : '⚠️ تعذّر التقييم\\.';
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎟 حجوزاتي','buyer:bookings')]]).reply_markup });
    }
    await ctx.reply(`✅ *شكراً لتقييمك\\!*  ${'⭐'.repeat(r.score||0)}`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎟 حجوزاتي','buyer:bookings')],[Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
}

// ── Booking: quantity → confirm → book ────────────────────────────────────────
bot.action('book:qty', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    if (!s.userId) return ctx.reply('❗ سجّل دخولك أولاً عبر زر «فتح تاكي»\\.', { parse_mode:'MarkdownV2' });
    if (!s.temp.dealId) return ctx.reply('⚠️ انتهت الجلسة، اختر العرض مجدداً\\.', { parse_mode:'MarkdownV2' });
    await ctx.reply(`📦 *كم قطعة تريد؟*\n_${md(s.temp.dealName)}_`, { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [1,2,3,5].map(q => Markup.button.callback(`${q}`, `bq:${q}`)),
            [Markup.button.callback('10','bq:10'), Markup.button.callback('كمية أخرى ✏️','bq:custom')],
            [Markup.button.callback('◀️ رجوع', s.temp.dealId ? `deal:${s.temp.dealId}` : 'browse:menu'), Markup.button.callback('❌ إلغاء','menu:back')]
        ]).reply_markup });
});
bot.action(/^bq:(\d+)$/, async ctx => { await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); s.temp.dealQty = +ctx.match[1]; setStep(tgId(ctx),'idle'); await askPrep(ctx, s); });
bot.action('bq:custom', async ctx => { await ctx.answerCbQuery(); setStep(tgId(ctx),'await_book_qty'); await ctx.reply('✏️ أرسل الكمية المطلوبة:', { reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ رجوع','book:qty')]]).reply_markup }); });

// Step 2 — pickup / prep time (mirrors the website's prep-time field)
async function askPrep(ctx, s) {
    await ctx.reply(`⏱ *متى تستلم طلبك؟*\n📦 الكمية: *${s.temp.dealQty}*`, { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🚶 عند الوصول','prep:arrival'), Markup.button.callback('١٥ دقيقة','prep:15')],
            [Markup.button.callback('٣٠ دقيقة','prep:30'), Markup.button.callback('٤٥ دقيقة','prep:45')],
            [Markup.button.callback('٦٠ دقيقة','prep:60'), Markup.button.callback('وقت آخر ✏️','prep:custom')],
            [Markup.button.callback('◀️ رجوع','book:qty'), Markup.button.callback('❌ إلغاء','menu:back')]
        ]).reply_markup });
}
bot.action('prep:arrival', async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); s.temp.prepTime='arrival'; await askNote(ctx,s); });
bot.action(/^prep:(\d+)$/, async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); s.temp.prepTime=`${ctx.match[1]}min`; await askNote(ctx,s); });
bot.action('prep:custom', async ctx => { await ctx.answerCbQuery(); setStep(tgId(ctx),'await_prep'); await ctx.reply('✏️ أرسل عدد دقائق التجهيز \\(مثل 20\\):', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ رجوع','book:back:prep')]]).reply_markup }); });
// Back-navigation: re-show the prep / note steps preserving the in-progress booking. (Task 1)
bot.action('book:back:prep', async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); setStep(tgId(ctx),'idle'); await askPrep(ctx, s); });
bot.action('book:back:note', async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); setStep(tgId(ctx),'idle'); await askNote(ctx, s); });

// Step 3 — optional note to the seller
async function askNote(ctx, s) {
    setStep(tgId(ctx),'idle');
    await ctx.reply(`📝 *ملاحظة للتاجر؟* \\(اختياري\\)\n_مثل: نوع الطلب، تفضيلات معينة…_`, { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✏️ أضف ملاحظة','note:add')],
            [Markup.button.callback('تخطّي والمتابعة ➡️','note:skip')],
            [Markup.button.callback('◀️ رجوع','book:back:prep'), Markup.button.callback('❌ إلغاء','menu:back')]
        ]).reply_markup });
}
bot.action('note:add', async ctx => { await ctx.answerCbQuery(); setStep(tgId(ctx),'await_note'); await ctx.reply('✏️ اكتب ملاحظتك \\(حتى 300 حرف\\):', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ رجوع','book:back:note')]]).reply_markup }); });
bot.action('note:skip', async ctx => { await ctx.answerCbQuery(); const s=getSession(tgId(ctx)); s.temp.notes=null; await bookConfirm(ctx,s); });

// Step 4 — confirm (shows quantity + prep + note + total)
async function bookConfirm(ctx, s) {
    setStep(tgId(ctx),'idle');
    // NOTE: pass p_telegram_id so PostgREST resolves the (text,bigint) overload
    // unambiguously — the bare (text) overload was dropped (v11.74) because the
    // ambiguity made this call fail with "function is not unique" → the booking
    // wrongly reported «انتهى هذا العرض أثناء الحجز». (Task 7 fix.)
    const d = await rpc('bot_get_deal', { p_deal_id: s.temp.dealId, p_telegram_id: tgId(ctx) });
    if (!d) return ctx.reply('⏰ *انتهى هذا العرض* أثناء الحجز ولم يعد متاحاً\\.', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔥 العروض المتاحة','browse:menu')]]).reply_markup });
    const total = d.discounted_price * s.temp.dealQty;
    let m = `✅ *تأكيد الحجز*\n${DIV}\n🛍 ${md(d.item_name)}\n🏪 ${md(d.shop_name)}\n\n📦 الكمية: *${s.temp.dealQty}*\n⏱ الاستلام: *${md(prepLabel(s.temp.prepTime))}*`;
    if (s.temp.notes) m += `\n📝 ملاحظتك: _${md(s.temp.notes)}_`;
    m += `\n💰 الإجمالي: *${money(total)} ر\\.س*\n${DIV}\nهل تؤكّد؟`;
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('✅  نعم، احجز','book:confirm')],
        [Markup.button.callback('◀️ رجوع','book:back:note'), Markup.button.callback('❌  إلغاء','menu:back')]
    ]).reply_markup });
}
bot.action('book:confirm', async ctx => {
    await ctx.answerCbQuery('جاري الحجز…');
    const s = getSession(tgId(ctx));
    if (!s.temp.dealId) return ctx.reply('⚠️ انتهت الجلسة\\.', { parse_mode:'MarkdownV2' });
    const result = await rpc('bot_book_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.dealId, p_quantity: s.temp.dealQty||1, p_notes: s.temp.notes||null, p_prep_time: s.temp.prepTime||'arrival' });
    const bc = result?.barcode;
    s.temp.dealId = null; s.temp.dealQty = 1; s.temp.prepTime = null; s.temp.notes = null;
    if (!result?.success) {
        const e = result?.error;
        const m = e==='deal_inactive'   ? '⏰ *انتهى هذا العرض* ولم يعد متاحاً للحجز\\.\n_تصفّح عروضاً أخرى متاحة الآن 👇_'
                : e==='deal_not_found'  ? '❌ *لم نجد هذا العرض* — ربما حُذف\\.\n_تصفّح العروض المتاحة 👇_'
                : e==='no_quantity'     ? `⚠️ *نفدت الكمية* — المتاح الآن: *${result.available??0}* فقط\\.`
                : e==='not_linked'      ? '❗ سجّل دخولك أولاً\\.'
                : e==='suspended'       ? '🚫 حسابك موقوف\\.'
                : '⚠️ تعذّر الحجز، حاول لاحقاً\\.';
        return ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔥 تصفّح العروض','browse:menu')],[Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
    }
    // Mark this barcode so the outbox skips the duplicate "confirmed" alert below.
    if (bc) botBookedBarcodes.add(bc);
    const expiry = result.expiry_at ? fmtDate(result.expiry_at) : '—';
    await ctx.reply(
        `🎉 *تم الحجز بنجاح\\!*\n${DIV}\n🛍 ${md(result.deal_name)}\n🏪 ${md(result.shop_name)}\n📦 الكمية: *${result.quantity}*\n⏱ الاستلام: *${md(prepLabel(result.prep_time))}*\n\n📋 *باركود حجزك:*\n\n        🔖  \`${md(bc)}\`\n\n${DIV}\n⏰ صالح حتى: ${md(expiry)}\n💡 _أظهر هذا الباركود للبائع عند الاستلام_`,
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('💬 محادثة التاجر',`chat:${bc}`)],
            ...(result.store_id ? [[Markup.button.callback('🏪 صفحة المتجر / التاجر',`store:${result.store_id}`)]] : []),
            [Markup.button.callback('🎟  حجوزاتي','buyer:bookings'), Markup.button.callback('🔥 عروض','deals:0')],
            [Markup.button.callback('◀️ القائمة','menu:back')]
        ]).reply_markup });
});

// ── Buyer: my bookings (split: current vs previous) ───────────────────────────
bot.command('bookings', ctx => buyerBookingsMenu(ctx));
bot.action('buyer:bookings', async ctx => { await ctx.answerCbQuery(); buyerBookingsMenu(ctx); });
bot.action('buyer:bk:current',  async ctx => { await ctx.answerCbQuery(); showBuyerBookings(ctx, 'current'); });
bot.action('buyer:bk:previous', async ctx => { await ctx.answerCbQuery(); showBuyerBookings(ctx, 'previous'); });
async function buyerBookingsMenu(ctx) {
    const s = getSession(tgId(ctx));
    if (!s.userId) return ctx.reply('❗ سجّل دخولك أولاً\\.', { parse_mode:'MarkdownV2', reply_markup: kbGuest().reply_markup });
    await ctx.reply(`🎟 *حجوزاتي*\n${DIV}\nاختر نوع الحجوزات اللي تبي تشوفها:`, { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('📌 الحالية','buyer:bk:current'), Markup.button.callback('🗂 السابقة','buyer:bk:previous')],
            [Markup.button.callback('◀️ القائمة','menu:back')]
        ]).reply_markup });
}
// scope: 'current' (قيد الانتظار/مؤكد) | 'previous' (مكتمل/ملغي/منتهٍ)
async function showBuyerBookings(ctx, scope='current') {
    const s = getSession(tgId(ctx));
    if (!s.userId) return ctx.reply('❗ سجّل دخولك أولاً\\.', { parse_mode:'MarkdownV2', reply_markup: kbGuest().reply_markup });
    const list = await rpc('bot_get_my_bookings', { p_telegram_id: tgId(ctx), p_scope: scope });
    if (!list?.length) {
        const empty = scope==='previous' ? '🗂 *لا توجد حجوزات سابقة بعد*' : '📭 *لا توجد حجوزات حالية*\nابدأ حجزك الأول\\!';
        return ctx.reply(empty, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔥 تصفح العروض','deals:0')],[Markup.button.callback('◀️ رجوع','buyer:bookings')]]).reply_markup });
    }
    const title = scope==='previous' ? '🗂 *حجوزاتي السابقة*' : '📌 *حجوزاتي الحالية*';
    const shown = list.slice(0, 10);
    const more  = list.length - shown.length;
    // Cache current values so each edit prompt can show the OLD value first. v11.70
    s.temp.bkCache = s.temp.bkCache || {};
    for (const x of list) s.temp.bkCache[x.barcode] = { quantity:x.quantity, prep_time:x.prep_time, notes:x.notes, deal_name:x.deal_name };
    // Header, then ONE self-contained card per booking (buttons attached to it) —
    // so it's always clear which «محادثة/تعديل/قيّم» belongs to which booking. v11.70
    await ctx.reply(`${title} \\(${list.length}${more>0?` — أحدث ${shown.length}`:''}\\)\n${DIV}\n_كل حجز في بطاقة مستقلة وأزراره تحته 👇_`, { parse_mode:'MarkdownV2' });
    for (let i=0;i<shown.length;i++){
        const b = shown[i];
        let m = `*${i+1}\\.* 🛍 *${md(b.deal_name)}*\n🏪 ${md(b.shop_name)}\n📋 \`${md(b.barcode)}\`\n📦 الكمية: *${b.quantity}*  •  ⏱ ${md(prepLabel(b.prep_time))}\n${statusLabel(b.status)}  •  📅 ${md(fmtDay(b.booked_at))}`;
        if ((b.status==='pending'||b.status==='acknowledged') && b.expiry_time) m += `\n⏰ *ينتهي الحجز:* ${md(fmtDate(b.expiry_time))}`;
        if (b.notes) m += `\n📝 _${md(b.notes)}_`;
        const chatLabel = b.unread>0 ? `💬 محادثة (${b.unread})` : '💬 محادثة';
        const row = [Markup.button.callback(chatLabel, `chat:${b.barcode}`)];
        if (b.status==='pending')   row.push(Markup.button.callback('✏️ تعديل', `edit:${b.barcode}`));
        if (b.status==='completed') row.push(Markup.button.callback('⭐ قيّم', `rate:${b.barcode}`));
        const rows = [row];
        if (b.store_id) rows.push([Markup.button.callback('🏪 صفحة المتجر / التاجر', `store:${b.store_id}`)]);
        if (b.status==='pending'||b.status==='acknowledged') rows.push([Markup.button.callback('🚫 إلغاء الحجز', `cancel:${b.barcode}`)]);
        await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup });
    }
    await ctx.reply(`${DIV}${more>0?`\n_يوجد ${more} حجز أقدم غير معروض._`:''}`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔄 تحديث',`buyer:bk:${scope}`), Markup.button.callback('◀️ رجوع','buyer:bookings')]]).reply_markup });
}
bot.action(/^cancel:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const bc = ctx.match[1];
    await ctx.reply(`⚠️ *تأكيد الإلغاء*\nإلغاء الحجز \`${md(bc)}\`؟`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('⚠️ نعم، ألغِ','doCancel:'+bc)],[Markup.button.callback('◀️ لا','buyer:bookings')]]).reply_markup });
});
bot.action(/^doCancel:(.+)$/, async ctx => {
    await ctx.answerCbQuery('جاري الإلغاء…');
    const result = await rpc('bot_cancel_booking', { p_telegram_id: tgId(ctx), p_barcode: ctx.match[1] });
    if (result?.success) await ctx.reply('✅ *تم إلغاء الحجز*', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎟 حجوزاتي','buyer:bookings')],[Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
    else { const m = result?.error==='cannot_cancel' ? '❌ لا يمكن إلغاء هذا الحجز\\.' : '⚠️ تعذّر الإلغاء\\.'; await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup }); }
});

// ── Booking chat (buyer ↔ seller, 3 messages each side) ───────────────────────
bot.action(/^chat:(.+)$/, async ctx => { await ctx.answerCbQuery(); await renderChat(ctx, ctx.match[1]); });
async function renderChat(ctx, barcode) {
    const r = await rpc('bot_booking_chat', { p_telegram_id: tgId(ctx), p_barcode: barcode });
    if (!r?.success) {
        const e=r?.error; const msg = e==='not_authorized' ? '⚠️ لا تملك صلاحية هذه المحادثة\\.' : e==='not_found' ? '❌ الحجز غير موجود\\.' : e==='not_linked' ? '❗ سجّل دخولك أولاً\\.' : '⚠️ تعذّر فتح المحادثة\\.';
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
    let m = `💬 *محادثة الحجز* \`${md(r.barcode)}\`\n🛍 ${md(r.deal_name)} • ${statusLabel(r.status)}\n👤 مع: *${md(r.other_name)}*\n${DIV}\n\n`;
    const msgs = r.messages || [];
    if (!msgs.length) m += '_لا توجد رسائل بعد — ابدأ المحادثة 👇_\n';
    else for (const x of msgs) {
        const who = x.mine ? '🟢 أنت' : `👤 ${md(r.other_name)}`;
        m += `${who} _\\(${md(fmtTime(x.at))}\\)_\n${md(x.body)}\n\n`;
    }
    m += `${DIV}\n✍️ رسائلك: *${r.my_count}/3*`;
    const btns = [];
    const canSend = r.status !== 'cancelled' && r.my_count < 3;
    if (canSend) btns.push([Markup.button.callback('✏️ اكتب رسالة', `chatmsg:${r.barcode}`)]);
    else if (r.status !== 'cancelled') m += `\n_🚫 وصلت الحد الأقصى لرسائلك_`;
    btns.push([Markup.button.callback('🔄 تحديث', `chat:${r.barcode}`), Markup.button.callback('◀️ رجوع', r.role==='seller'?'seller:bookings':'buyer:bookings')]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup });
}
bot.action(/^chatmsg:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    s.temp.chatBarcode = ctx.match[1];
    setStep(tgId(ctx),'await_chat_msg');
    await ctx.reply('✏️ اكتب رسالتك \\(حتى 500 حرف\\):', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء',`chat:${ctx.match[1]}`)]]).reply_markup });
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
    const cur = v ? `\n${DIV}\n🛍 *${md(v.deal_name||'')}*\n🔢 الكمية: *${md(String(v.quantity??'—'))}*  •  ⏱ ${md(prepLabel(v.prep_time))}${v.notes?`\n📝 _${md(v.notes)}_`:''}` : '';
    await ctx.reply(`✏️ *تعديل الحجز* \`${md(bc)}\`${cur}\n${DIV}\nوش تبي تعدّل؟\n_تظهر القيمة الحالية قبل التعديل • متاح ما دام «قيد الانتظار»._`, { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🔢 الكمية',`editqty:${bc}`), Markup.button.callback('⏱ وقت الاستلام',`editprep:${bc}`)],
            [Markup.button.callback('📝 الملاحظة',`editnote:${bc}`)],
            [Markup.button.callback('◀️ رجوع','buyer:bookings')]
        ]).reply_markup });
});
bot.action(/^editqty:(.+)$/, async ctx => { await ctx.answerCbQuery(); const bc=ctx.match[1]; const s=getSession(tgId(ctx)); s.temp.editBarcode=bc; const v=bkVal(ctx,bc); setStep(tgId(ctx),'await_edit_qty'); await ctx.reply(`🔢 *الكمية الحالية:* ${md(String(v?.quantity??'—'))}\n${DIV}\nأرسل الكمية الجديدة:`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء',`edit:${bc}`)]]).reply_markup }); });
bot.action(/^editnote:(.+)$/, async ctx => { await ctx.answerCbQuery(); const bc=ctx.match[1]; const s=getSession(tgId(ctx)); s.temp.editBarcode=bc; const v=bkVal(ctx,bc); setStep(tgId(ctx),'await_edit_note'); await ctx.reply(`📝 *الملاحظة الحالية:*\n_${md(v?.notes||'— لا توجد —')}_\n${DIV}\nأرسل الملاحظة الجديدة \\(حتى 300 حرف\\):`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء',`edit:${bc}`)]]).reply_markup }); });
bot.action(/^editprep:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const bc = ctx.match[1];
    const v = bkVal(ctx, bc);
    await ctx.reply(`⏱ *وقت الاستلام الحالي:* ${md(prepLabel(v?.prep_time))}\n${DIV}\nاختر الوقت الجديد:`, { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🚶 عند الوصول',`eprep:${bc}:arrival`), Markup.button.callback('١٥ د',`eprep:${bc}:15`)],
            [Markup.button.callback('٣٠ د',`eprep:${bc}:30`), Markup.button.callback('٤٥ د',`eprep:${bc}:45`), Markup.button.callback('٦٠ د',`eprep:${bc}:60`)],
            [Markup.button.callback('◀️ رجوع',`edit:${bc}`)]
        ]).reply_markup });
});
bot.action(/^eprep:(.+):(arrival|\d+)$/, async ctx => {
    await ctx.answerCbQuery('جاري الحفظ…');
    const pv = ctx.match[2]==='arrival' ? 'arrival' : `${ctx.match[2]}min`;
    const r = await rpc('bot_update_booking', { p_telegram_id: tgId(ctx), p_barcode: ctx.match[1], p_prep_time: pv });
    return afterEdit(ctx, r);
});
async function afterEdit(ctx, r) {
    if (!r?.success) {
        const e=r?.error; const msg = e==='not_editable' ? '⚠️ لا يمكن التعديل — الحجز لم يعد «قيد الانتظار»\\.' : e==='no_quantity' ? `⚠️ المتاح: *${r.available??0}* فقط\\.` : e==='not_found' ? '❌ الحجز غير موجود\\.' : '⚠️ تعذّر التعديل\\.';
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎟 حجوزاتي','buyer:bookings')]]).reply_markup });
    }
    await ctx.reply('✅ *تم تعديل الحجز*', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎟 حجوزاتي','buyer:bookings')],[Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
}
// ── Alerts manager — keyword alerts + Telegram on/off (buyer, seller, admin) ──
bot.command('alerts', ctx => showAlerts(ctx));
bot.action('buyer:notif', async ctx => { await ctx.answerCbQuery(); showAlerts(ctx); });
bot.action('alerts:open',  async ctx => { await ctx.answerCbQuery(); showAlerts(ctx); });
async function showAlerts(ctx) {
    const s = getSession(tgId(ctx));
    if (!s.userId) return ctx.reply('❗ سجّل دخولك أولاً عبر «ربط حسابي»\\.', { parse_mode:'MarkdownV2', reply_markup: kbGuest().reply_markup });
    const a = await rpc('bot_get_alerts', { p_telegram_id: tgId(ctx) });
    if (!a?.success) return ctx.reply('⚠️ تعذّر تحميل التنبيهات\\.', { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    const kws = Array.isArray(a.keywords) ? a.keywords : [];
    let m = `🔔 *تنبيهاتي*\n${DIV}\n📲 تنبيهات تيليجرام: *${a.notify_via_telegram ? '🟢 مفعّلة' : '🔴 موقوفة'}*\n`;
    m += kws.length
        ? `\n🏷 *كلماتك المفتاحية* \\(${kws.length}\\):\nنرسل لك تنبيهاً فور نزول عرض يطابق إحداها 👇`
        : `\n_لا توجد كلمات تنبيه بعد — أضف كلمة \\(مثل: عطور، آيفون\\) لتصلك عروضها فور نزولها\\._`;
    if (a.smart_count>0) m += `\n\n⚙️ لديك *${a.smart_count}* تنبيه ذكي متقدّم \\(منطقة/مسافة/تصنيف\\) — تُدار من الموقع\\.`;
    const btns = [];
    kws.forEach((k,i) => btns.push([Markup.button.callback(`🗑  ${String(k).slice(0,30)}`, `alerts:rm:${i}`)]));
    btns.push([Markup.button.callback('➕ أضف كلمة تنبيه','alerts:add')]);
    btns.push([Markup.button.callback(a.notify_via_telegram ? '🔕 إيقاف تنبيهات تيليجرام' : '🔔 تفعيل تنبيهات تيليجرام', `alerts:toggle:${a.notify_via_telegram?'0':'1'}`)]);
    btns.push([Markup.button.webApp('⚙️ تنبيهات متقدّمة', W('/profile'))]);
    btns.push([Markup.button.callback('◀️ رجوع','menu:back')]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup });
}
bot.action('alerts:add', async ctx => {
    await ctx.answerCbQuery();
    if (!getSession(tgId(ctx)).userId) return;
    setStep(tgId(ctx),'await_alert_kw');
    await ctx.reply('✏️ اكتب كلمة التنبيه \\(مثل: عطور، مطاعم، آيفون\\):', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء','alerts:open')]]).reply_markup });
});
bot.action(/^alerts:rm:(\d+)$/, async ctx => {
    await ctx.answerCbQuery('جاري الحذف…');
    await rpc('bot_remove_notif_keyword', { p_telegram_id: tgId(ctx), p_index: +ctx.match[1] });
    return showAlerts(ctx);
});
bot.action(/^alerts:toggle:([01])$/, async ctx => {
    await ctx.answerCbQuery(ctx.match[1]==='1' ? '🔔 تم التفعيل' : '🔕 تم الإيقاف');
    await rpc('bot_set_telegram_notif', { p_telegram_id: tgId(ctx), p_enabled: ctx.match[1]==='1' });
    return showAlerts(ctx);
});
bot.action('buyer:profile', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    await ctx.reply(`👤 *حسابي*\n${DIV}\nالاسم: *${md(s.name)}*\nالنوع: مشتري`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.webApp('✏️ تعديل الحساب', W('/profile'))],[Markup.button.callback('◀️ رجوع','menu:back')]]).reply_markup });
});

// ── Seller: stats ─────────────────────────────────────────────────────────────
bot.command('stats', ctx => showSellerStats(ctx));
bot.action('seller:stats', async ctx => { await ctx.answerCbQuery(); showSellerStats(ctx); });
async function showSellerStats(ctx) {
    const s = await refreshSession(ctx);
    if (!s.userId || s.userType!=='seller') return ctx.reply('❗ هذا الخيار للتجار فقط\\.', { parse_mode:'MarkdownV2' });
    const st = await rpc('bot_get_seller_stats', { p_telegram_id: tgId(ctx) });
    if (!st) return ctx.reply('⚠️ تعذّر تحميل الإحصائيات\\.', { parse_mode:'MarkdownV2' });
    const plan = st.subscription_plan || 'مجاني';
    const expiry = st.subscription_expires_at ? fmtDay(st.subscription_expires_at) : '—';
    await ctx.reply(
        `📊 *إحصائيات ${md(st.shop||s.name)}*\n${DIV}\n🌅 حجوزات اليوم: *${st.today_bookings}*\n📦 إجمالي الحجوزات: *${st.total_bookings}*\n⏳ بانتظار التأكيد: *${st.pending_bookings}*\n🏷 عروض نشطة: *${st.active_deals}*\n💰 الإيرادات: *${money(st.total_revenue)} ر\\.س*\n\n${DIV}\n🔖 الخطة: *${md(plan)}*\n📅 تنتهي: *${md(expiry)}*`,
        { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
}

// ── Seller: bookings (split: active vs previous) ──────────────────────────────
bot.action('seller:bookings', async ctx => { await ctx.answerCbQuery(); sellerBookingsMenu(ctx); });
bot.action('seller:bk:current',  async ctx => { await ctx.answerCbQuery(); showSellerBookings(ctx, 'current'); });
bot.action('seller:bk:previous', async ctx => { await ctx.answerCbQuery(); showSellerBookings(ctx, 'previous'); });
async function sellerBookingsMenu(ctx) {
    const s = getSession(tgId(ctx));
    if (!s.userId || s.userType!=='seller') return;
    const p = s.pendingBookings>0 ? `\n⏳ *${s.pendingBookings}* بانتظار التأكيد` : '';
    await ctx.reply(`📦 *حجوزات متجرك*${p}\n${DIV}\nاختر نوع الحجوزات:`, { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🟢 النشطة','seller:bk:current'), Markup.button.callback('🗂 السابقة','seller:bk:previous')],
            [Markup.button.callback('◀️ القائمة','menu:back')]
        ]).reply_markup });
}
// scope: 'current' (قيد الانتظار/مؤكد) | 'previous' (مكتمل/ملغي/منتهٍ)
async function showSellerBookings(ctx, scope='current') {
    const s = getSession(tgId(ctx));
    if (!s.userId || s.userType!=='seller') return;
    const list = await rpc('bot_get_seller_bookings', { p_telegram_id: tgId(ctx), p_scope: scope });
    if (!list?.length) {
        const empty = scope==='previous' ? '🗂 *لا توجد حجوزات سابقة بعد*' : '✅ *لا توجد حجوزات نشطة حالياً*';
        return ctx.reply(empty, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ رجوع','seller:bookings')]]).reply_markup });
    }
    const title = scope==='previous' ? '🗂 *حجوزات سابقة*' : '🟢 *حجوزات نشطة*';
    const shown = list.slice(0, 10);
    const more  = list.length - shown.length;
    // One self-contained card per booking — buttons attached, never detached. v11.70
    await ctx.reply(`${title} \\(${list.length}${more>0?` — أحدث ${shown.length}`:''}\\)\n${DIV}\n_كل حجز في بطاقة مستقلة وأزراره تحته 👇_`, { parse_mode:'MarkdownV2' });
    for (let i=0;i<shown.length;i++){
        const b = shown[i];
        let m = `*${i+1}\\.* 📋 \`${md(b.barcode)}\`\n👤 *${md(b.user_name)}*  📞 ${md(b.user_phone)}\n🛍 ${md(b.deal_name)}  •  📦 ×${b.quantity}  •  ⏱ ${md(prepLabel(b.prep_time))}\n${statusLabel(b.status)}  •  📅 ${md(fmtDate(b.booked_at))}`;
        if ((b.status==='pending'||b.status==='acknowledged') && b.expiry_time) m += `\n⏰ *ينتهي الحجز:* ${md(fmtDate(b.expiry_time))}`;
        if (b.notes) m += `\n📝 _${md(b.notes)}_`;
        const row = [];
        if (b.status==='pending') row.push(Markup.button.callback('👍 تأكيد', `ack:${b.barcode}`));
        if (b.status==='pending'||b.status==='acknowledged') row.push(Markup.button.callback('🏁 إتمام', `complete:${b.barcode}`));
        row.push(Markup.button.callback(b.unread>0 ? `💬 محادثة (${b.unread})` : '💬 محادثة', `chat:${b.barcode}`));
        await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([row]).reply_markup });
    }
    await ctx.reply(`${DIV}${more>0?`\n_يوجد ${more} حجز أقدم غير معروض._`:''}`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔄 تحديث',`seller:bk:${scope}`), Markup.button.callback('◀️ رجوع','seller:bookings')]]).reply_markup });
}
bot.action(/^ack:(.+)$/, async ctx => {
    await ctx.answerCbQuery('جاري التأكيد…');
    const result = await rpc('bot_acknowledge_booking', { p_telegram_id: tgId(ctx), p_barcode: ctx.match[1] });
    if (result?.success) await ctx.reply(`👍 *تم تأكيد الاستلام*\nالعميل: *${md(result.user_name)}*`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('📦 الحجوزات','seller:bookings')],[Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
    else await ctx.reply('⚠️ تعذّر التأكيد\\.', { parse_mode:'MarkdownV2' });
});
// Completing a booking offers an OPTIONAL message to the buyer (delivered to
// web + app + bot, same instant — mirrors the app's delivery note). v11.72
bot.action(/^complete:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const bc = ctx.match[1];
    getSession(tgId(ctx)).temp.completeBarcode = bc;
    await ctx.reply(`🏁 *إتمام الحجز* \`${md(bc)}\`\n${DIV}\nتقدر ترفق *رسالة للعميل* مع تأكيد الاستلام \\(اختياري\\)\\.`, { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✏️ أضف رسالة ثم أتمّ',`completeMsg:${bc}`)],
            [Markup.button.callback('🏁 إتمام بدون رسالة',`completeGo:${bc}`)],
            [Markup.button.callback('◀️ رجوع','seller:bookings')]
        ]).reply_markup });
});
bot.action(/^completeGo:(.+)$/, async ctx => { await ctx.answerCbQuery('جاري الإتمام…'); doComplete(ctx, ctx.match[1], null); });
bot.action(/^completeMsg:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx)); s.temp.completeBarcode = ctx.match[1];
    setStep(tgId(ctx),'await_complete_msg');
    await ctx.reply('✏️ اكتب رسالتك للعميل \\(حتى 300 حرف\\):', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ بدون رسالة',`completeGo:${ctx.match[1]}`)]]).reply_markup });
});
bot.command('complete', async ctx => { const c = sanitize((ctx.message?.text||'').split(' ')[1],20); if (!c) return ctx.reply('❗ `/complete BARCODE`',{parse_mode:'MarkdownV2'}); doComplete(ctx, c, null); });
async function doComplete(ctx, barcode, message) {
    setStep(tgId(ctx),'idle');
    const result = await rpc('bot_complete_booking', { p_telegram_id: tgId(ctx), p_barcode: barcode, p_message: message||null });
    if (!result?.success) {
        const e = result?.error;
        const m = e==='already_completed' ? '⚠️ مكتمل مسبقاً\\.' : e==='not_found' ? '❌ الكود غير موجود في متجرك\\.' : e==='cancelled' ? '⚠️ هذا الحجز ملغى\\.' : '⚠️ خطأ، حاول لاحقاً\\.';
        return ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
    const sent = message ? '\n📨 _وأُرسلت رسالتك للعميل_' : '';
    await ctx.reply(`🏁 *تم إتمام الحجز\\!*\n👤 ${md(result.user_name)}  📦 ${result.quantity}${sent}`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('📦 الحجوزات','seller:bookings')],[Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
}

// ── Seller: verify ────────────────────────────────────────────────────────────
bot.command('verify', ctx => startVerify(ctx));
bot.action('seller:verify', async ctx => { await ctx.answerCbQuery(); startVerify(ctx); });
bot.action('verify:manual', async ctx => { await ctx.answerCbQuery(); askBarcode(ctx); });
async function startVerify(ctx) {
    const s = getSession(tgId(ctx));
    if (!s.userId || s.userType!=='seller') return ctx.reply('❗ للتجار فقط\\.', { parse_mode:'MarkdownV2' });
    const c = sanitize((ctx.message?.text||'').split(' ')[1],20);
    if (c) return doVerify(ctx, c);
    // Options — mirror the app: type the code / pick from the list / camera scanner. v11.72
    await ctx.reply(`✅ *تحقّق من حجز*\n${DIV}\nاختر طريقة التحقّق التي تناسبك 👇`, { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('⌨️ إدخال الباركود يدوياً','verify:manual')],
            [Markup.button.callback('📋 اختيار من قائمة الحجوزات','seller:bk:current')],
            [Markup.button.webApp('📷 مسح بالكاميرا (ماسح التطبيق)', W('/seller?tab=scanner'))],
            [Markup.button.callback('◀️ القائمة','menu:back')]
        ]).reply_markup });
}
async function askBarcode(ctx) {
    setStep(tgId(ctx),'await_barcode');
    await ctx.reply(`⌨️ *أدخل الباركود*\nأرسل كود الباركود الظاهر لدى العميل \\(أو الكود الاحتياطي\\):`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء','menu:back')]]).reply_markup });
}
async function doVerify(ctx, barcode) {
    const r = await rpc('bot_verify_booking', { p_telegram_id: tgId(ctx), p_barcode: barcode });
    setStep(tgId(ctx),'idle');
    if (!r?.success) return ctx.reply(r?.error==='not_found' ? '❌ *الكود غير موجود في متجرك*' : '⚠️ خطأ، حاول لاحقاً', { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    const ok = r.status!=='completed' && r.status!=='cancelled';
    let m = `${ok?'✅':'⚠️'} *نتيجة التحقق*\n${DIV}\n📋 \`${md(r.barcode)}\`\n👤 *${md(r.user_name)}*  📞 ${md(r.user_phone)}\n🛍 ${md(r.deal_name)}  📦 ${r.quantity}\n${statusLabel(r.status)}\n⏰ ${md(fmtDate(r.booked_at))}`;
    if (r.notes) m += `\n📝 ${md(r.notes)}`;
    const btns = [];
    if (ok && r.status==='pending') btns.push([Markup.button.callback('👍 تأكيد الاستلام', `ack:${r.barcode}`)]);
    if (ok) btns.push([Markup.button.callback('🏁 إتمام الحجز', `complete:${r.barcode}`)]);
    btns.push([Markup.button.callback('◀️ رجوع','menu:back')]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup });
}

// ── Seller: subscription / packages (subscribe from Telegram, simulated payment) ─
bot.action('seller:sub', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    if (!s.userId || s.userType!=='seller') return ctx.reply('❗ هذا الخيار للتجار فقط\\.', { parse_mode:'MarkdownV2' });
    const sub = await rpc('bot_get_subscription', { p_telegram_id: tgId(ctx) });
    if (!sub?.success) return ctx.reply('⚠️ تعذّر تحميل الاشتراك\\.', { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    const planAr = sub.plan==='premium' ? 'مدفوعة (Premium)' : sub.plan==='trial' ? 'تجريبية' : 'مجانية';
    const exp = sub.expires_at ? fmtDay(sub.expires_at) : '—';
    const statusLine = sub.active ? '🟢 *فعّال*' : '🔴 *غير فعّال*';
    await ctx.reply(
        `💳 *اشتراكك الحالي*\n${DIV}\n🔖 الباقة: *${md(planAr)}*\n${statusLine}\n📍 حد المواقع: *${sub.max_branches}*\n📅 تنتهي: *${md(exp)}*\n${DIV}\n_اختر باقة للاشتراك أو الترقية_`,
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔼 الباقات والاشتراك','seller:packages')],[Markup.button.callback('◀️ رجوع','menu:back')]]).reply_markup });
});
bot.action('seller:packages', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    if (!s.userId || s.userType!=='seller') return;
    const pkgs = await rpc('bot_list_packages', {});
    const list = Array.isArray(pkgs) ? pkgs.filter(p => p.active!==false) : [];
    if (!list.length) return ctx.reply('⚠️ لا توجد باقات متاحة حالياً\\.', { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    let m = `📦 *باقات المواقع*\n${DIV}\n_الدفع محاكى حالياً — يُفعّل الاشتراك فوراً_\n\n`;
    const btns = [];
    list.forEach(p => {
        const price = Math.round((p.price||0) * (1 - (p.discount||0)/100));
        m += `• *${md(p.ar||('باقة '+p.id))}* — حتى *${p.max}* موقع — *${money(price)}* ر\\.س/شهر\n`;
        btns.push([Markup.button.callback(`${p.ar||('باقة '+p.id)} — ${price} ر.س`, `subpkg:${p.id}`)]);
    });
    btns.push([Markup.button.callback('◀️ رجوع','seller:sub')]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup });
});
bot.action(/^subpkg:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const pkgs = await rpc('bot_list_packages', {});
    const p = (Array.isArray(pkgs)?pkgs:[]).find(x => String(x.id)===ctx.match[1]);
    if (!p) return ctx.reply('⚠️ الباقة غير متاحة\\.', { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    const price = Math.round((p.price||0) * (1 - (p.discount||0)/100));
    await ctx.reply(
        `🧾 *تأكيد الاشتراك*\n${DIV}\n🔖 ${md(p.ar||('باقة '+p.id))}\n📍 حتى *${p.max}* موقع\n💰 *${money(price)}* ر\\.س لمدة *${p.durationDays||30}* يوم\n${DIV}\n_الدفع محاكى — سيُفعّل فوراً_\nهل تؤكّد؟`,
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('✅ تأكيد واشتراك',`subgo:${p.id}`)],[Markup.button.callback('❌ إلغاء','seller:packages')]]).reply_markup });
});
bot.action(/^subgo:(\d+)$/, async ctx => {
    await ctx.answerCbQuery('جاري التفعيل…');
    const r = await rpc('bot_subscribe_plan', { p_telegram_id: tgId(ctx), p_package_id: +ctx.match[1] });
    if (!r?.success) {
        const e=r?.error; const msg = e==='not_seller' ? '❗ للتجار فقط\\.' : e==='bad_package' ? '⚠️ الباقة غير متاحة\\.' : '⚠️ تعذّر الاشتراك، حاول لاحقاً\\.';
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
    await ctx.reply(
        `🎉 *تم تفعيل اشتراكك\\!*\n${DIV}\n🔖 ${md(r.plan_ar)}\n📍 حد المواقع: *${r.max_branches}*\n💰 *${money(r.price)}* ر\\.س\n📅 ساري حتى: *${md(fmtDay(r.expires_at))}*\n\n_تقدر الآن تنشر عروضك حسب حدّ باقتك ✅_`,
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🏷 عروضي','seller:deals'), Markup.button.callback('➕ إضافة عرض','seller:addDeal')],[Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
});

// ── Seller: profile ───────────────────────────────────────────────────────────
bot.action('seller:profile', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    const st = await rpc('bot_get_seller_stats', { p_telegram_id: tgId(ctx) });
    const plan = st?.subscription_plan || 'مجاني';
    const expiry = st?.subscription_expires_at ? fmtDay(st.subscription_expires_at) : '—';
    await ctx.reply(`👤 *حسابي*\n${DIV}\nالاسم: *${md(s.name)}*\nالمتجر: *${md(s.shop||s.name)}*\nالخطة: *${md(plan)}*\nتنتهي: *${md(expiry)}*`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.webApp('✏️ تعديل المتجر', W('/seller'))],[Markup.button.callback('◀️ رجوع','menu:back')]]).reply_markup });
});

// ── Admin ─────────────────────────────────────────────────────────────────────
bot.action('admin:stats', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    if (!s.isAdmin) return ctx.reply('❗ غير مصرح\\.', { parse_mode:'MarkdownV2' });
    const st = await rpc('bot_get_admin_stats', { p_telegram_id: tgId(ctx) });
    if (!st?.success) return ctx.reply('⚠️ غير مصرح أو خطأ\\.', { parse_mode:'MarkdownV2' });
    await ctx.reply(`📊 *إحصائيات منصة TAKI*\n${DIV}\n👥 المستخدمون: *${st.total_users}*  \\(🏪 ${st.merchants}  🛍 ${st.buyers}\\)\n🏷 عروض نشطة: *${st.active_deals}*\n📦 إجمالي الحجوزات: *${st.total_bookings}*\n🌅 اليوم: *${st.today_bookings}*\n🚩 بلاغات معلقة: *${st.pending_reports}*`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.webApp('🛡 لوحة الإدارة', W('/admin'))],[Markup.button.callback('◀️ رجوع','menu:back')]]).reply_markup });
});
bot.action('admin:reports', async ctx => { await ctx.answerCbQuery(); await ctx.reply('🚩 *البلاغات المعلقة*\nراجعها من لوحة الإدارة:', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.webApp('🛡 مركز الإدارة', W('/admin'))],[Markup.button.callback('◀️ رجوع','menu:back')]]).reply_markup }); });

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
    if (text === '❌ إلغاء') { setStep(tgId(ctx),'idle'); s.temp.locCtx=null; await ctx.reply('تم الإلغاء\\.', { parse_mode:'MarkdownV2', reply_markup: Markup.removeKeyboard().reply_markup }); const ns = await refreshSession(ctx); return sendMain(ctx, ns); }

    // Session-loss guards: if the edit context vanished (e.g. bot restarted between
    // tapping a field and typing), say so clearly instead of a confusing fall-through. v11.72
    if (['await_edit_qty','await_edit_note'].includes(s.step) && !s.temp.editBarcode) {
        setStep(tgId(ctx),'idle');
        return ctx.reply('⚠️ انتهت جلسة التعديل — افتح «✏️ تعديل» على الحجز من جديد\\.', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎟 حجوزاتي','buyer:bookings')]]).reply_markup });
    }

    if (s.step === 'await_barcode') { setStep(tgId(ctx),'idle'); return doVerify(ctx, text.trim().toUpperCase()); }
    if (s.step === 'await_book_qty') {
        if (!isQty(text) || +text < 1) return ctx.reply('❗ أرسل رقماً صحيحاً (مثل 2):');
        s.temp.dealQty = +text; setStep(tgId(ctx),'idle'); return askPrep(ctx, s);
    }
    if (s.step === 'await_prep') {
        if (!isQty(text) || +text < 1 || +text > 1440) return ctx.reply('❗ أرسل عدد دقائق صحيح (مثل 20):');
        s.temp.prepTime = `${+text}min`; setStep(tgId(ctx),'idle'); return askNote(ctx, s);
    }
    if (s.step === 'await_note') {
        s.temp.notes = text.slice(0,300); setStep(tgId(ctx),'idle'); return bookConfirm(ctx, s);
    }
    if (s.step === 'await_chat_msg') {
        const bc = s.temp.chatBarcode; setStep(tgId(ctx),'idle');
        if (!bc) return ctx.reply('⚠️ انتهت الجلسة\\.', { parse_mode:'MarkdownV2' });
        const r = await rpc('bot_send_booking_message', { p_telegram_id: tgId(ctx), p_barcode: bc, p_body: text });
        if (!r?.success) {
            const e=r?.error; const msg = e==='cap_reached' ? '🚫 وصلت الحد الأقصى \\(٣ رسائل\\)\\.' : e==='cancelled' ? '⚠️ الحجز ملغى — لا يمكن الإرسال\\.' : e==='bad_length' ? '❗ الرسالة فارغة أو طويلة جداً\\.' : '⚠️ تعذّر الإرسال\\.';
            await ctx.reply(msg, { parse_mode:'MarkdownV2' });
        }
        return renderChat(ctx, bc);
    }
    if (s.step === 'await_complete_msg') {
        const bc = s.temp.completeBarcode; setStep(tgId(ctx),'idle');
        if (!bc) return ctx.reply('⚠️ انتهت الجلسة، افتح الحجز من جديد\\.', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('📦 الحجوزات','seller:bookings')]]).reply_markup });
        return doComplete(ctx, bc, text.slice(0,300));
    }
    if (s.step === 'await_edit_qty') {
        if (!isQty(text) || +text < 1) return ctx.reply('❗ أرسل رقماً صحيحاً (مثل 2):');
        setStep(tgId(ctx),'idle');
        const r = await rpc('bot_update_booking', { p_telegram_id: tgId(ctx), p_barcode: s.temp.editBarcode, p_quantity: +text });
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
            const e=r?.error; const msg = e==='exists' ? '⚠️ هذه الكلمة مضافة مسبقاً\\.' : e==='too_many' ? '⚠️ وصلت الحد الأقصى \\(20 كلمة\\)\\.' : e==='bad_length' ? '❗ الكلمة قصيرة أو طويلة جداً \\(2–40 حرفاً\\)\\.' : e==='not_linked' ? '❗ سجّل دخولك أولاً\\.' : '⚠️ تعذّر الإضافة\\.';
            await ctx.reply(msg, { parse_mode:'MarkdownV2' });
        } else {
            await ctx.reply('✅ *تمت إضافة الكلمة* — بنرسل لك العروض المطابقة فور نزولها\\.', { parse_mode:'MarkdownV2' });
        }
        return showAlerts(ctx);
    }
    if (s.step === 'await_search') {                                 // Task 4
        const q = text.trim().slice(0,60);
        if (q.length < 2) return ctx.reply('❗ اكتب كلمة بحث أوضح \\(حرفان على الأقل\\):', { parse_mode:'MarkdownV2' });
        return runSearch(ctx, q);
    }
    if (s.step === 'await_contest_answer') {                         // Task 5b — quiz
        const w = s.temp.cwiz; setStep(tgId(ctx),'idle');
        if (!w) return ctx.reply('⚠️ انتهت جلسة المسابقة — افتحها من جديد\\.', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎁 المسابقات','contests:list')]]).reply_markup });
        const q = w.questions[w.qi]; if (q) w.answers[q.id] = text.slice(0,200); w.qi++;
        return askContestStep(ctx);
    }
    if (s.step === 'await_contest_social') {                         // Task 5b — social tasks
        const w = s.temp.cwiz; setStep(tgId(ctx),'idle');
        if (!w) return ctx.reply('⚠️ انتهت جلسة المسابقة — افتحها من جديد\\.', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎁 المسابقات','contests:list')]]).reply_markup });
        const t = w.social[w.si]; if (t) w.social_answers[t.id] = text.slice(0,200); w.si++;
        return askContestStep(ctx);
    }
    if (['menu','قائمة','القائمة','ابدأ','start','مرحبا','مرحباً','اهلا','أهلا','السلام عليكم'].includes(lc)) { const ns = await refreshSession(ctx); return sendMain(ctx, ns); }
    if (['عروض','deals','تخفيضات'].some(k=>lc.includes(k))) return showBrowseMenu(ctx);
    if (['بحث','search'].includes(lc)) { setStep(tgId(ctx),'await_search'); return ctx.reply('🔎 *البحث*\nاكتب ما تبحث عنه \\(اسم عرض، متجر، تاجر، مدينة أو تصنيف\\):', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ القائمة','browse:menu')]]).reply_markup }); }
    if (['مسابقات','مسابقة','جوائز','contests'].some(k=>lc.includes(k))) return showContests(ctx);
    if (['مساعدة','help'].includes(lc)) return showHelp(ctx);
    if (['حجوزاتي','bookings'].includes(lc)) return buyerBookingsMenu(ctx);
    if (['تنبيهات','تنبيهاتي','alerts'].includes(lc)) return showAlerts(ctx);
    if (['خروج','تسجيل الخروج','تسجيل خروج','logout'].includes(lc)) return startLogout(ctx);
    if (['ربط','link'].includes(lc)) return startLink(ctx);

    const ns = await refreshSession(ctx);
    await ctx.reply(ns.userId ? 'اختر من القائمة 👇' : 'اكتب /menu للقائمة أو /link لربط حسابك\\.', { parse_mode:'MarkdownV2', reply_markup: roleKb(ns).reply_markup });
});

bot.catch((err,ctx) => console.error(`Bot error [${ctx?.updateType}]:`, err?.message||err));

app.post('/webhook/telegram', (req, res) => {
    if (!TELEGRAM_WEBHOOK_SECRET) return res.status(503).json({ error:'not configured' });
    if (req.headers['x-telegram-bot-api-secret-token'] !== TELEGRAM_WEBHOOK_SECRET) return res.status(403).json({ error:'Forbidden' });
    bot.handleUpdate(req.body, res);
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
        if (isMsg) rows.push([Markup.button.callback('💬 فتح المحادثة',`chat:${bc}`)]);
        else if (aud==='seller' && ev==='new') { rows.push([Markup.button.callback('👍 تأكيد',`ack:${bc}`), Markup.button.callback('🏁 إتمام',`complete:${bc}`)]); rows.push([Markup.button.callback('💬 محادثة',`chat:${bc}`)]); }
        else if (aud==='buyer'  && ev==='completed') rows.push([Markup.button.callback('⭐ قيّم',`rate:${bc}`)]);
        else if (aud==='buyer'  && ev==='new') rows.push([Markup.button.callback('🎟 حجوزاتي','buyer:bookings'), Markup.button.callback('💬 محادثة',`chat:${bc}`)]);
        else if (aud==='buyer'  && (ev==='acknowledged' || ev==='warning')) rows.push([Markup.button.callback('💬 محادثة',`chat:${bc}`)]);
        else rows.push([Markup.button.callback('📦 الحجوزات', aud==='seller'?'seller:bookings':'buyer:bookings')]);
    }
    // Reports → admin (مركز البلاغات) • analytics → the relevant stats screen. v11.72
    else if (n.type==='report')    rows.push([Markup.button.callback('🚩 عرض البلاغات','admin:reports')]);
    else if (n.type==='analytics') rows.push([Markup.button.callback('📊 الإحصائيات', aud==='admin'?'admin:stats':'seller:stats')]);
    // A "فتح" deep-link for content notifications that point somewhere specific.
    const dealId = n.meta_data?.deal_id || n.meta_data?.dealId;
    const storeId = n.meta_data?.store_id || n.meta_data?.storeId;
    let url = null;
    if (n.type==='booking' && bc) url = W(`/booking/${bc}`);
    else if (dealId)  url = W(`/deal/${dealId}`);
    else if (storeId) url = W(`/store/${storeId}`);
    else if (n.meta_data?.action_url) url = n.meta_data.action_url;

    // ── Telegram ──
    if (n.telegram_chat_id && n.notify_via_telegram) {
        const text = custom ? `${icon} ${md(custom)}` : `${icon} *${md(title)}*\n${md(body)}`;
        const kbRows = rows.slice();
        if (!kbRows.length && url) kbRows.push([Markup.button.url(en?'🔗 Open':'🔗 فتح', url)]);
        try {
            await bot.telegram.sendMessage(n.telegram_chat_id, text,
                { parse_mode:'MarkdownV2', link_preview_options:{is_disabled:true},
                  ...(kbRows.length ? { reply_markup: Markup.inlineKeyboard(kbRows).reply_markup } : {}) });
        } catch(e) { console.warn('TG notif:', e.message); }
    }
    // ── WhatsApp (parity) — live the instant WHATSAPP_* creds are set; sendWA is a
    //    no-op until then. NB: outside Meta's 24h service window an *approved
    //    template* is required (free-form text only delivers inside the window).
    if (n.whatsapp_chat_id && n.notify_via_whatsapp && WHATSAPP_PHONE_NUMBER_ID && WHATSAPP_ACCESS_TOKEN) {
        const waBody = `${icon} ${custom || `${title}\n${body}`}${url?`\n\n${url}`:''}`.slice(0,4096);
        try { await sendWA(n.whatsapp_chat_id, { type:'text', text:{ body: waBody, preview_url:true } }); }
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
        try {
            let batch;
            do {
                batch = await rpc('bot_pull_outbox', { p_limit: 25 });
                if (Array.isArray(batch) && batch.length) {
                    for (const n of batch) { try { await deliverNotification(n); } catch(e) { console.warn('deliver:', e.message); } }
                }
            } while (Array.isArray(batch) && batch.length === 25);   // drain a backlog fast
        } catch(e) { console.warn('outbox poll:', e.message); }
        finally { outboxBusy = false; }
    }
    setInterval(drainOutbox, 2000).unref?.();
    console.log('📤 إشعارات البوت عبر outbox — سحب كل ثانيتين (آمن مع مفتاح anon: حجوزات + رسائل + تنبيهات + تحليلات + كل أحداث الموقع — يصل شبه فوري كالتطبيق)');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WhatsApp Cloud API — interactive browse, categories, nearby & deal detail
//  Mirrors the Telegram browse layer (same RPCs). Booking is completed in the
//  app via a secure deep-link (no phone-based identity — matches our security
//  model). All replies are free-form inside the 24h customer-service window.
// ═══════════════════════════════════════════════════════════════════════════════
async function sendWA(to, payload) {
    if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) return null;
    try {
        const r = await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
            method:'POST', headers:{ Authorization:`Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type':'application/json' },
            body: JSON.stringify({ messaging_product:'whatsapp', recipient_type:'individual', to, ...payload }) });
        if (!r.ok) { console.warn('WA send:', r.status); return null; }
        return r.json();
    } catch(e) { console.error('WA error:', e.message); return null; }
}

// Per-user shared location (TTL 30 min) so "nearby" works across messages.
const waGeo = new Map();
setInterval(() => { const n=Date.now(); for (const [k,v] of waGeo) if (n-v.t > 30*60_000) waGeo.delete(k); }, 10*60_000).unref?.();

function waText(d, geo) {
    const L = [];
    L.push(`🏷 ${d.item_name}`);
    L.push(`🏪 ${d.shop_name}  •  📍 ${d.city||d.region||'—'}`);
    L.push(`🟢 ${d.discounted_price} ر.س  (بدل ${d.original_price}) — خصم ${d.discount_percentage}%`);
    if (d.expiry_type==='stock') L.push(d.is_unlimited ? '📦 متوفّر' : `📦 المتبقّي: ${d.quantity??0} قطعة`);
    else if (d.expiry_type==='date' && d.expiry_date) L.push(`📅 ساري حتى: ${d.expiry_date}`);
    else { const r=remainingText(d); if (r) L.push(`⏳ ينتهي خلال: ${r}`); }
    if (geo && d.distance_km!=null) L.push(`📍 يبعد ${d.distance_km} كم عنك`);
    if (d.prep_time) L.push(`⏱ التجهيز: ${d.prep_time}`);
    if (d.description) L.push(`\n📝 ${String(d.description).slice(0,400)}`);
    L.push(`\n🔗 احجز الآن داخل تطبيق تاكي:\n${APP_URL}/deal/${d.id}`);
    return L.join('\n');
}
function waMainMenu(from) {
    return sendWA(from, { type:'interactive', interactive:{
        type:'button',
        header:{ type:'text', text:'TAKI 🛍️' },
        body:{ text:'أهلاً بك في تاكي — عروض وتخفيضات السعودية. اختر ما يناسبك:' },
        action:{ buttons:[
            { type:'reply', reply:{ id:'wa_deals', title:'🔥 العروض' } },
            { type:'reply', reply:{ id:'wa_cats',  title:'📂 التصنيفات' } },
            { type:'reply', reply:{ id:'wa_near',  title:'📍 حولي' } },
        ]}
    }});
}
function waAskLocation(from) {
    return sendWA(from, { type:'interactive', interactive:{
        type:'location_request_message',
        body:{ text:'📍 شارك موقعك لأرتّب لك العروض حسب الأقرب وأحسب المسافة 🚗' },
        action:{ name:'send_location' }
    }});
}
async function waBrowse(from, sort, cat) {
    const geo = (sort==='nearby') ? waGeo.get(from) : null;
    if (sort==='nearby' && !geo) return waAskLocation(from);
    const deals = await rpc('bot_browse_deals', { p_sort:sort, p_category:(cat&&cat!=='all')?cat:null,
        p_lat:geo?geo.lat:null, p_lng:geo?geo.lng:null, p_radius_km:null, p_limit:10, p_offset:0 }) || [];
    if (!deals.length) return sendWA(from, { type:'text', text:{ body:'📭 لا توجد عروض مطابقة حالياً.', preview_url:false } });
    const TITLE = { popular:'🔥 الأكثر طلباً', discount:'💸 الأكثر خصماً', newest:'🆕 أحدث العروض', sponsored:'⭐ المميّزة والرعاة', nearby:'📍 الأقرب إليك' };
    const rows = deals.slice(0,10).map(d => ({
        id:`wa_deal:${d.id}`,
        title:String(d.item_name).slice(0,24),
        description:`${d.discounted_price} ر.س • خصم ${d.discount_percentage}%${geo&&d.distance_km!=null?` • ${d.distance_km}كم`:''}`.slice(0,72)
    }));
    return sendWA(from, { type:'interactive', interactive:{
        type:'list',
        header:{ type:'text', text:(TITLE[sort]||'العروض').slice(0,60) },
        body:{ text:'اختر عرضاً لعرض تفاصيله وصوره وحجزه 👇' },
        footer:{ text:'TAKI' },
        action:{ button:'تصفّح العروض', sections:[{ title:((cat&&cat!=='all')?catLabel(cat):'العروض').slice(0,24), rows }] }
    }});
}
async function waCategories(from) {
    const geo = waGeo.get(from);
    const cats = await rpc('bot_get_categories', { p_lat:geo?geo.lat:null, p_lng:geo?geo.lng:null, p_radius_km:null }) || [];
    if (!cats.length) return sendWA(from, { type:'text', text:{ body:'📭 لا توجد تصنيفات نشطة حالياً.', preview_url:false } });
    const rows = cats.slice(0,10).map(c => ({ id:`wa_cat:${c.category}`, title:catLabel(c.category).slice(0,24), description:`${c.n} عرض متاح`.slice(0,72) }));
    return sendWA(from, { type:'interactive', interactive:{
        type:'list', header:{ type:'text', text:'📂 التصنيفات' }, body:{ text:'اختر تصنيفاً لعرض عروضه:' },
        action:{ button:'التصنيفات', sections:[{ title:'المتوفّرة الآن', rows }] }
    }});
}
async function waDealDetail(from, id) {
    const d = await rpc('bot_get_deal', { p_deal_id:id });
    if (!d) return sendWA(from, { type:'text', text:{ body:'⚠️ العرض لم يعد متاحاً.', preview_url:false } });
    const geo = waGeo.get(from);
    const img = (Array.isArray(d.images) && d.images.filter(Boolean)[0]) || d.image;
    if (img) await sendWA(from, { type:'image', image:{ link:img, caption: waText(d, geo).slice(0,1024) } });
    else     await sendWA(from, { type:'text',  text:{ body: waText(d, geo), preview_url:true } });
    const dl = dirLink(d, geo);
    if (dl) await sendWA(from, { type:'text', text:{ body:`🧭 الاتجاهات بالسيارة:\n${dl}`, preview_url:false } });
}

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
        for (const entry of body?.entry||[]) for (const change of entry.changes||[]) for (const msg of change.value?.messages||[]) {
            const from = msg.from; if (!from || !checkRL(`wa:${from}`)) continue;
            if (msg.type==='text') {
                const t = sanitize(msg.text?.body||'',200).toLowerCase();
                if (['deal','عرض','عروض','تخفيض','خصم'].some(k=>t.includes(k))) await waBrowse(from,'newest',null);
                else if (['تصنيف','صنف','فئة','category'].some(k=>t.includes(k))) await waCategories(from);
                else if (['حول','قرب','أقرب','اقرب','near','موقع'].some(k=>t.includes(k))) await waBrowse(from,'nearby',null);
                else await waMainMenu(from);
            } else if (msg.type==='interactive') {
                const ir = msg.interactive || {};
                const id = (ir.button_reply && ir.button_reply.id) || (ir.list_reply && ir.list_reply.id) || '';
                if      (id==='wa_deals') await waBrowse(from,'newest',null);
                else if (id==='wa_cats')  await waCategories(from);
                else if (id==='wa_near')  { waGeo.get(from) ? await waBrowse(from,'nearby',null) : waAskLocation(from); }
                else if (id.startsWith('wa_deal:')) await waDealDetail(from, id.slice(8));
                else if (id.startsWith('wa_cat:'))  await waBrowse(from,'newest', id.slice(7));
                else await waMainMenu(from);
            } else if (msg.type==='location' && msg.location) {
                waGeo.set(from, { lat:msg.location.latitude, lng:msg.location.longitude, t:Date.now() });
                await sendWA(from, { type:'text', text:{ body:'✅ تم تحديد موقعك — إليك الأقرب إليك:', preview_url:false } });
                await waBrowse(from,'nearby',null);
            }
        }
    } catch(e) { console.error('WA processing:', e.message); }
});

// ── Health + Boot ─────────────────────────────────────────────────────────────
app.get('/health', (_,res) => res.json({ status:'active', version:BOT_VERSION, mode:BOT_MODE, uptime:Math.round(process.uptime()), services:{ telegram:!!bot, supabase:!!supabase, photo_upload:!!BOT_GATEWAY_SECRET } }));
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
