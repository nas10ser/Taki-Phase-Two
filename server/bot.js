/**
 * TAKI Bot — v9.0  |  بوت تاكي الاحترافي
 * ═══════════════════════════════════════════
 * لوحة تاجر كاملة + لوحة مشتري + لوحة أدمن
 * حجز، إلغاء، تحقق، إتمام، إضافة وحذف عروض
 * كل شيء من داخل تيليجرام — بدون فتح الموقع
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
const WHATSAPP_VERIFY_TOKEN    = process.env.WHATSAPP_VERIFY_TOKEN || '';
const WHATSAPP_APP_SECRET      = process.env.WHATSAPP_APP_SECRET || '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_ACCESS_TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN || '';
const APP_URL                  = process.env.APP_URL || 'https://taki-test-eight.vercel.app';
const BOT_MODE                 = (process.env.BOT_MODE || 'webhook').toLowerCase();
const PORT                     = process.env.PORT || 3000;
const BOT_VERSION              = '9.0.0';

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const bot = TELEGRAM_TOKEN ? new Telegraf(TELEGRAM_TOKEN) : null;

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use('/webhook/whatsapp', express.raw({ type: 'application/json', limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

// Global rate limit
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

// ── Input helpers ─────────────────────────────────────────────────────────────
const sanitize = (s, max=400) => (!s||typeof s!=='string') ? '' : s.replace(/<[^>]*>/gm,'').trim().slice(0,max);
const isPhone  = p => /^05\d{8}$/.test(p);
const isPrice  = p => /^\d+(\.\d{1,2})?$/.test(String(p)) && +p > 0;
const isQty    = q => /^\d+$/.test(String(q)) && +q >= 0;

// MarkdownV2 escape
const md = t => t == null ? '' : String(t).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');

// Date formatter (Saudi locale)
const fmtDate = d => { try { return new Date(d).toLocaleDateString('ar-SA',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return String(d); } };
const fmtDay  = d => { try { return new Date(d).toLocaleDateString('ar-SA',{year:'numeric',month:'short',day:'numeric'}); } catch { return String(d); } };

// Status labels
const STATUS = { pending:'⏳ قيد الانتظار', acknowledged:'✅ مؤكد', completed:'🏁 مكتمل', cancelled:'❌ ملغي', active:'🟢 نشط', paused:'⏸ موقوف', draft:'📝 مسودة', expired:'🔴 منتهي' };
const statusLabel = s => STATUS[s] || md(s);

// Divider line (for MarkdownV2)
const DIV = '━━━━━━━━━━━━━━━━━━━━━━';

// ── Session State (in-memory, 30-min TTL) ─────────────────────────────────────
const sessions = new Map();
const TTL = 30 * 60_000;
function getSession(chatId) {
    const k = String(chatId);
    let s = sessions.get(k);
    if (!s || Date.now() - s.at > TTL) {
        s = { step:'idle', userId:null, userType:null, name:null, shop:null,
              isAdmin:false, pendingBookings:0, activeDeals:0, temp:{}, at:Date.now() };
        sessions.set(k, s);
    }
    s.at = Date.now();
    return s;
}
function setStep(chatId, step, extra={}) {
    const s = getSession(chatId); s.step = step; Object.assign(s, extra);
}
setInterval(() => { const n=Date.now(); for(const[k,v]of sessions) if(n-v.at>TTL) sessions.delete(k); }, 10*60_000).unref?.();

// ── Supabase RPC ──────────────────────────────────────────────────────────────
async function rpc(fn, args) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase.rpc(fn, args);
        if (error) { console.error(`RPC ${fn}:`, error.message); return null; }
        return data;
    } catch(e) { console.error(`RPC ${fn} ex:`, e.message); return null; }
}

async function getDeals(limit=8, offset=0) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase.from('deals')
            .select('id,item_name,shop_name,original_price,discounted_price,discount_percentage,quantity,is_unlimited,city,region,prep_time,description')
            .eq('status','active').order('created_at',{ascending:false}).range(offset, offset+limit-1);
        return error ? [] : (data||[]);
    } catch { return []; }
}

// ── Load/refresh user session from DB ─────────────────────────────────────────
async function refreshSession(chatId) {
    const s = getSession(chatId);
    const user = await rpc('bot_get_user', { p_chat_id: chatId });
    if (user) {
        s.userId   = user.id;
        s.userType = user.user_type;
        s.name     = user.name;
        s.shop     = user.shop || null;
        s.isAdmin  = !!(user.is_super_admin || (user.admin_permissions?.length > 0));
        if (user.user_type === 'merchant') {
            // Grab quick counts for seller menu header
            const st = await rpc('bot_get_seller_stats', { p_chat_id: chatId });
            if (st) { s.pendingBookings = st.pending_bookings || 0; s.activeDeals = st.active_deals || 0; }
        }
    }
    return s;
}

// ── Keyboards ─────────────────────────────────────────────────────────────────
const KB_BACK = (action='main') => Markup.inlineKeyboard([[Markup.button.callback('◀️  رجوع للقائمة','menu:'+action)]]);

function kbGuest() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🔗  ربط حسابي','link:start')],
        [Markup.button.callback('🔥  تصفح العروض','deals:0')],
        [Markup.button.webApp('🚀  فتح تاكي',APP_URL)],
        [Markup.button.callback('🆘  مساعدة','help')]
    ]);
}
function kbBuyer() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🔥  تصفح العروض','deals:0'), Markup.button.callback('🎟  حجوزاتي','buyer:bookings')],
        [Markup.button.callback('🔔  تنبيهاتي','buyer:notif'),  Markup.button.callback('👤  حسابي','buyer:profile')],
        [Markup.button.webApp('🚀  فتح تاكي (دخول تلقائي)',APP_URL)],
        [Markup.button.callback('🆘  مساعدة','help')]
    ]);
}
function kbSeller(s) {
    const pBadge = s.pendingBookings > 0 ? ` (${s.pendingBookings})` : '';
    return Markup.inlineKeyboard([
        [Markup.button.callback('📊  إحصائياتي','seller:stats'), Markup.button.callback(`📦  الحجوزات${pBadge}`,'seller:bookings')],
        [Markup.button.callback('✅  تحقق من حجز','seller:verify'), Markup.button.callback('🏷  عروضي','seller:deals')],
        [Markup.button.callback('➕  إضافة عرض','seller:addDeal'), Markup.button.callback('👤  حسابي','seller:profile')],
        [Markup.button.webApp('🚀  لوحة التاجر',APP_URL+'/#/seller'), Markup.button.callback('🆘  مساعدة','help')]
    ]);
}
function kbAdmin() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('📊  إحصائيات المنصة','admin:stats'), Markup.button.callback('🚩  البلاغات المعلقة','admin:reports')],
        [Markup.button.webApp('🛡  لوحة الإدارة الكاملة',APP_URL+'/#/admin')],
        [Markup.button.callback('🆘  مساعدة','help')]
    ]);
}
function roleKb(s) {
    if (s.isAdmin)                  return kbAdmin();
    if (s.userType === 'merchant')  return kbSeller(s);
    if (s.userType === 'buyer')     return kbBuyer();
    return kbGuest();
}
function roleMsg(s) {
    if (s.isAdmin)
        return `🛡 *لوحة الأدمن — TAKI*\n${DIV}\nمرحباً *${md(s.name)}*\n\n📌 اختر ما تريد:`;
    if (s.userType === 'merchant') {
        const p = s.pendingBookings > 0 ? `\n⏳ *حجوزات معلقة: ${s.pendingBookings}*` : '';
        const a = s.activeDeals > 0 ? `\n🏷 عروض نشطة: ${s.activeDeals}` : '';
        return `🏪 *لوحة التاجر — ${md(s.shop||s.name)}*\n${DIV}${p}${a}\n\n📌 اختر ما تريد:`;
    }
    if (s.userType === 'buyer')
        return `👋 *أهلاً ${md(s.name)}*\n${DIV}\n🛍 لوحة المشتري\n\n📌 اختر ما تريد:`;
    return `🛍️ *أهلاً في TAKI*\n${DIV}\nمنصة الحجز الذكي للعروض والتخفيضات 🇸🇦\n\n🔹 تصفح مئات العروض\n🔹 احجز بضغطة واحدة\n🔹 احفظ باركود حجزك\n${DIV}\nللاستفادة من كل المزايا\nاربط حسابك أولاً 👇`;
}

async function sendMain(ctx, s) {
    await ctx.reply(roleMsg(s), { parse_mode:'MarkdownV2', reply_markup: roleKb(s).reply_markup });
}

// ═══════════════════════════════════════════════════════════════════════════════
if (bot) {

// ── Bot command menu ──────────────────────────────────────────────────────────
bot.telegram.setMyCommands([
    { command:'start',    description:'القائمة الرئيسية — Main Menu' },
    { command:'deals',    description:'تصفح العروض' },
    { command:'link',     description:'ربط حسابي' },
    { command:'bookings', description:'حجوزاتي' },
    { command:'stats',    description:'الإحصائيات (للتجار)' },
    { command:'verify',   description:'تحقق من حجز (للتجار)' },
    { command:'help',     description:'مساعدة' }
]).catch(e => console.warn('setMyCommands:', e.message));

// ── /start ────────────────────────────────────────────────────────────────────
bot.start(async ctx => {
    if (!checkRL(`start:${ctx.chat.id}`)) return;
    const s = await refreshSession(ctx.chat.id);
    await sendMain(ctx, s);
});

// ── /menu + back ──────────────────────────────────────────────────────────────
bot.command('menu', async ctx => { const s = await refreshSession(ctx.chat.id); await sendMain(ctx, s); });
bot.action(/^menu:(.+)$/, async ctx => { await ctx.answerCbQuery(); const s = await refreshSession(ctx.chat.id); await sendMain(ctx, s); });

// ── /help ─────────────────────────────────────────────────────────────────────
bot.command('help', ctx => showHelp(ctx));
bot.action('help', async ctx => { await ctx.answerCbQuery(); showHelp(ctx); });

async function showHelp(ctx) {
    const s = getSession(ctx.chat.id);
    let msg = `🆘 *مساعدة TAKI*\n${DIV}\n`;
    if (!s.userId) msg += `🔗 اربط حسابك أولاً لتصل لكل الميزات\n/link — ربط حسابك\n\n`;
    msg += `📌 *الأوامر:*\n`;
    msg += `/menu — القائمة الرئيسية\n`;
    msg += `/deals — العروض النشطة\n`;
    msg += `/link — ربط / تغيير الحساب\n`;
    msg += `/bookings — حجوزاتي\n`;
    if (s.userType==='merchant'||s.isAdmin) { msg += `/stats — إحصائياتي\n/verify — تحقق من حجز\n`; }
    msg += `\n${DIV}\n🌐 الموقع: ${APP_URL}`;
    await ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ربط الحساب
// ═══════════════════════════════════════════════════════════════════════════════
bot.command('link', ctx => startLink(ctx));
bot.action('link:start', async ctx => { await ctx.answerCbQuery(); startLink(ctx); });

async function startLink(ctx) {
    setStep(ctx.chat.id, 'await_phone');
    await ctx.reply(
        `🔗 *ربط حساب TAKI*\n${DIV}\nأرسل رقم جوالك المسجّل في تاكي:\n_مثال: 0512345678_`,
        { parse_mode:'MarkdownV2',
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌  إلغاء','menu:back')]]).reply_markup }
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  تصفح العروض + حجز
// ═══════════════════════════════════════════════════════════════════════════════
bot.command('deals', ctx => showDeals(ctx, 0));
bot.action(/^deals:(\d+)$/, async ctx => { await ctx.answerCbQuery(); showDeals(ctx, +ctx.match[1]); });

async function showDeals(ctx, offset=0) {
    if (!checkRL(`deals:${ctx.chat.id}`)) return;
    const deals = await getDeals(8, offset);
    if (!deals.length && offset===0) {
        return ctx.reply(`📭 *لا توجد عروض نشطة حالياً*\nعُد لاحقاً\\!`, {
            parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
    let msg = `🔥 *العروض النشطة*\n${DIV}\n\n`;
    const rows = [];
    deals.forEach((d,i) => {
        const pct = d.discount_percentage || Math.round(((d.original_price-d.discounted_price)/d.original_price)*100);
        const qty = d.is_unlimited ? '∞ غير محدود' : `${d.quantity??0} متبقي`;
        msg += `*${offset+i+1}\\.* *${md(d.item_name)}*\n`;
        msg += `🏪 ${md(d.shop_name)}  📍 ${md(d.city||d.region||'—')}\n`;
        msg += `💰 *${md(d.discounted_price)} ر\\.س*  ~~${md(d.original_price)}~~  🏷 *${pct}%*\n`;
        msg += `📦 ${md(qty)}\n\n`;
        rows.push([Markup.button.callback(`${offset+i+1}  ${String(d.item_name).slice(0,22)} — ${d.discounted_price} ر.س`, `deal:${d.id}`)]);
    });

    // Navigation
    const nav = [];
    if (offset > 0) nav.push(Markup.button.callback('◀️  السابق', `deals:${offset-8}`));
    if (deals.length === 8) nav.push(Markup.button.callback('التالي  ▶️', `deals:${offset+8}`));
    if (nav.length) rows.push(nav);
    rows.push([Markup.button.callback('◀️  رجوع للقائمة','menu:back')]);

    await ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup, link_preview_options:{is_disabled:true} });
}

// Deal detail page
bot.action(/^deal:([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    const dealId = ctx.match[1];
    const d = await rpc('bot_get_deal', { p_deal_id: dealId });
    if (!d) return ctx.reply('⚠️ العرض غير متاح حالياً\\.', { parse_mode:'MarkdownV2' });

    const pct = d.discount_percentage || Math.round(((d.original_price-d.discounted_price)/d.original_price)*100);
    const qty = d.is_unlimited ? 'غير محدود' : `${d.quantity??0} قطعة متبقية`;
    const prep = d.prep_time ? `\n⏱ وقت التجهيز: ${md(d.prep_time)}` : '';
    const desc = d.description ? `\n\n📝 ${md(d.description)}` : '';

    const msg =
        `🏷 *${md(d.item_name)}*\n${DIV}\n` +
        `🏪 *${md(d.shop_name)}*  📍 ${md(d.city||d.region||'—')}\n\n` +
        `💰 *${md(d.discounted_price)} ر\\.س*\n` +
        `~~السعر الأصلي: ${md(d.original_price)} ر\\.س~~\n` +
        `🏷 *وفّر ${pct}%*\n\n` +
        `📦 الكمية المتاحة: *${md(qty)}*${prep}${desc}`;

    const s = getSession(ctx.chat.id);
    // Store selected deal in session
    s.temp.dealId   = dealId;
    s.temp.dealName = d.item_name;
    s.temp.shopName = d.shop_name;
    s.temp.dealQty  = 1;

    const btns = [];
    if (s.userId) {
        btns.push([Markup.button.callback('📥  احجز الآن','book:qty')]);
    } else {
        btns.push([Markup.button.callback('🔗  سجّل دخول لتحجز','link:start')]);
    }
    btns.push([Markup.button.url('🌐  عرض الصورة على الموقع', `${APP_URL}/#/deal/${dealId}`)]);
    btns.push([Markup.button.callback('◀️  رجوع للعروض','deals:0')]);

    await ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup, link_preview_options:{is_disabled:true} });
});

// Quantity selection
bot.action('book:qty', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    if (!s.userId) return ctx.reply('❗ اربط حسابك أولاً\nاضغط /link', { parse_mode:'MarkdownV2' });
    if (!s.temp.dealId) return ctx.reply('⚠️ انتهت صلاحية الجلسة، ابحث عن العرض مجدداً\\.', { parse_mode:'MarkdownV2' });

    const msg = `📦 *كم قطعة تريد من:*\n_${md(s.temp.dealName)}_\n${DIV}\nاختر الكمية:`;
    const row1 = [1,2,3,5].map(q => Markup.button.callback(`${q}`, `bq:${q}`));
    const row2 = [Markup.button.callback('10', 'bq:10'), Markup.button.callback('كمية أخرى ✏️', 'bq:custom')];
    await ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([row1, row2, [Markup.button.callback('❌  إلغاء','menu:back')]]).reply_markup });
});

bot.action(/^bq:(\d+)$/, async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    s.temp.dealQty = +ctx.match[1];
    await showBookingConfirm(ctx, s);
});
bot.action('bq:custom', async ctx => {
    await ctx.answerCbQuery();
    setStep(ctx.chat.id, 'await_book_qty');
    await ctx.reply(`✏️ أرسل الكمية التي تريدها:`, { reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌  إلغاء','menu:back')]]).reply_markup });
});

async function showBookingConfirm(ctx, s) {
    const d = await rpc('bot_get_deal', { p_deal_id: s.temp.dealId });
    if (!d) return ctx.reply('⚠️ العرض لم يعد متاحاً\\.', { parse_mode:'MarkdownV2' });

    const total = (d.discounted_price * s.temp.dealQty).toFixed(2);
    const msg =
        `✅ *تأكيد الحجز*\n${DIV}\n` +
        `🛍 ${md(d.item_name)}\n` +
        `🏪 ${md(d.shop_name)}\n\n` +
        `📦 الكمية: *${s.temp.dealQty}*\n` +
        `💰 *${md(total)} ر\\.س*\n${DIV}\nهل تأكد الحجز؟`;

    await ctx.reply(msg, { parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('✅  نعم، احجز الآن','book:confirm')],
            [Markup.button.callback('❌  إلغاء','menu:back')]
        ]).reply_markup });
}

bot.action('book:confirm', async ctx => {
    await ctx.answerCbQuery('جاري الحجز…');
    const s = getSession(ctx.chat.id);
    if (!s.temp.dealId) return ctx.reply('⚠️ انتهت الجلسة، حاول مجدداً\\.', { parse_mode:'MarkdownV2' });

    const result = await rpc('bot_book_deal', {
        p_chat_id:  ctx.chat.id,
        p_deal_id:  s.temp.dealId,
        p_quantity: s.temp.dealQty || 1,
        p_notes:    null
    });

    s.temp.dealId = null; s.temp.dealQty = 1;

    if (!result?.success) {
        const err = result?.error;
        const msg = err==='deal_inactive'   ? '⚠️ عذراً، هذا العرض انتهى\\.'
                  : err==='no_quantity'     ? `⚠️ الكمية المتاحة: *${result.available??0}* فقط\\.`
                  : err==='not_linked'      ? '❗ اربط حسابك أولاً /link'
                  : '⚠️ تعذّر إتمام الحجز، حاول لاحقاً\\.';
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }

    const expiry = result.expiry_at ? fmtDate(result.expiry_at) : '—';
    const prep   = result.prep_time ? `\n⏱ وقت التجهيز: ${md(result.prep_time)}` : '';

    await ctx.reply(
        `✅ *تم الحجز بنجاح\\!*\n${DIV}\n` +
        `🛍 ${md(result.deal_name)}\n` +
        `🏪 ${md(result.shop_name)}\n` +
        `📦 الكمية: *${result.quantity}*${prep}\n\n` +
        `${DIV}\n📋 *باركود حجزك:*\n\n` +
        `       🔖  \`${result.barcode}\`\n\n` +
        `${DIV}\n⏰ صالح حتى: ${md(expiry)}\n💡 _أرسل الباركود للبائع عند استلام الطلب_`,
        { parse_mode:'MarkdownV2',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('🎟  حجوزاتي الكاملة','buyer:bookings')],
            [Markup.button.callback('◀️  رجوع للقائمة','menu:back')]
          ]).reply_markup }
    );
});

// ═══════════════════════════════════════════════════════════════════════════════
//  لوحة المشتري
// ═══════════════════════════════════════════════════════════════════════════════
bot.command('bookings', async ctx => { await ctx.answerCbQuery?.(); showBuyerBookings(ctx); });
bot.action('buyer:bookings', async ctx => { await ctx.answerCbQuery(); showBuyerBookings(ctx); });

async function showBuyerBookings(ctx) {
    const s = getSession(ctx.chat.id);
    if (!s.userId) return ctx.reply('❗ *اربط حسابك أولاً*\nاضغط /link', { parse_mode:'MarkdownV2' });
    const list = await rpc('bot_get_my_bookings', { p_chat_id: ctx.chat.id });
    if (!list?.length) return ctx.reply(`📭 *لا توجد حجوزات بعد*\nتصفح العروض وابدأ حجزك الأول\\!`, {
        parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔥  تصفح العروض','deals:0')],[Markup.button.callback('◀️  رجوع','menu:back')]]).reply_markup });

    let msg = `🎟 *حجوزاتي* \\(${list.length}\\)\n${DIV}\n\n`;
    const btns = [];
    list.forEach((b,i) => {
        msg += `*${i+1}\\.* *${md(b.deal_name)}*\n`;
        msg += `🏪 ${md(b.shop_name)}\n`;
        msg += `📋 الباركود: \`${md(b.barcode)}\`\n`;
        msg += `📦 الكمية: ${b.quantity}   ${statusLabel(b.status)}\n`;
        msg += `⏰ ${md(fmtDay(b.booked_at))}\n\n`;
        if (b.status==='pending'||b.status==='acknowledged')
            btns.push([Markup.button.callback(`🚫  إلغاء حجز "${String(b.deal_name).slice(0,20)}"`,`cancel:${b.barcode}`)]);
    });
    btns.push([Markup.button.callback('◀️  رجوع للقائمة','menu:back')]);
    await ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup });
}

// Cancel booking — confirmation
bot.action(/^cancel:(.+)$/, async ctx => {
    await ctx.answerCbQuery();
    const barcode = ctx.match[1];
    await ctx.reply(
        `⚠️ *تأكيد الإلغاء*\n${DIV}\nهل تريد إلغاء الحجز:\n\`${md(barcode)}\`\n\n_لا يمكن التراجع عن الإلغاء_`,
        { parse_mode:'MarkdownV2',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('⚠️  نعم، ألغِ الحجز', `doCancel:${barcode}`)],
            [Markup.button.callback('◀️  لا، رجوع','buyer:bookings')]
          ]).reply_markup }
    );
});
bot.action(/^doCancel:(.+)$/, async ctx => {
    await ctx.answerCbQuery('جاري الإلغاء…');
    const barcode = ctx.match[1];
    const result = await rpc('bot_cancel_booking', { p_chat_id: ctx.chat.id, p_barcode: barcode });
    if (result?.success) {
        await ctx.reply(`✅ *تم إلغاء الحجز بنجاح*\nسيتم استرداد الكمية للعرض\\.`, {
            parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎟  حجوزاتي','buyer:bookings')],[Markup.button.callback('◀️  القائمة','menu:back')]]).reply_markup });
    } else {
        const err = result?.error;
        const msg = err==='cannot_cancel' ? `❌ لا يمكن إلغاء حجز ${statusLabel(result.status||'')}\\.`
                  : '⚠️ تعذّر الإلغاء، حاول لاحقاً\\.';
        await ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
});

bot.action('buyer:notif', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(`🔔 *التنبيهات عبر تيليجرام*\n${DIV}\nتنبيهاتك مفعّلة على هذا الجهاز\\.\nلإدارة التنبيهات الذكية افتح التطبيق:`,
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.webApp('⚙️  إعدادات التنبيهات',APP_URL+'/#/profile')],[Markup.button.callback('◀️  رجوع','menu:back')]]).reply_markup });
});
bot.action('buyer:profile', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    if (!s.userId) return ctx.reply('❗ اربط حسابك أولاً /link', { parse_mode:'MarkdownV2' });
    await ctx.reply(`👤 *حسابي*\n${DIV}\n*الاسم:* ${md(s.name)}\n*نوع الحساب:* مشتري\n\nلتعديل بياناتك:`,
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.webApp('✏️  تعديل الحساب',APP_URL+'/#/profile')],[Markup.button.callback('◀️  رجوع','menu:back')]]).reply_markup });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  لوحة التاجر
// ═══════════════════════════════════════════════════════════════════════════════

// — الإحصائيات —
bot.command('stats', ctx => showSellerStats(ctx));
bot.action('seller:stats', async ctx => { await ctx.answerCbQuery(); showSellerStats(ctx); });

async function showSellerStats(ctx) {
    const s = await refreshSession(ctx.chat.id);
    if (!s.userId || s.userType!=='merchant') return ctx.reply('❗ هذا الخيار للتجار فقط\\.', { parse_mode:'MarkdownV2' });
    const st = await rpc('bot_get_seller_stats', { p_chat_id: ctx.chat.id });
    if (!st) return ctx.reply('⚠️ تعذّر تحميل الإحصائيات\\.', { parse_mode:'MarkdownV2' });
    const plan   = st.subscription_plan || 'مجاني';
    const expiry = st.subscription_expires_at ? fmtDay(st.subscription_expires_at) : '—';
    await ctx.reply(
        `📊 *إحصائيات ${md(st.shop||s.name)}*\n${DIV}\n` +
        `🌅 حجوزات اليوم: *${st.today_bookings}*\n` +
        `📦 إجمالي الحجوزات: *${st.total_bookings}*\n` +
        `⏳ بانتظار التأكيد: *${st.pending_bookings}*\n` +
        `🏷 عروض نشطة: *${st.active_deals}*\n` +
        `💰 إجمالي الإيرادات: *${md(st.total_revenue)} ر\\.س*\n\n` +
        `${DIV}\n🔖 الخطة: *${md(plan)}*\n📅 تنتهي: *${md(expiry)}*`,
        { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup }
    );
}

// — الحجوزات الواردة —
bot.action('seller:bookings', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    if (!s.userId || s.userType!=='merchant') return;
    const list = await rpc('bot_get_seller_bookings', { p_chat_id: ctx.chat.id });
    if (!list?.length) return ctx.reply(`✅ *لا توجد حجوزات معلقة*\nكل شيء نظيف\\!`, {
        parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });

    let msg = `📦 *الحجوزات الواردة* \\(${list.length}\\)\n${DIV}\n\n`;
    const btns = [];
    list.forEach((b,i) => {
        msg += `*${i+1}\\.* \`${md(b.barcode)}\`\n`;
        msg += `👤 ${md(b.user_name)}  📞 ${md(b.user_phone)}\n`;
        msg += `🛍 ${md(b.deal_name)}  📦 ×${b.quantity}\n`;
        msg += `${statusLabel(b.status)}`;
        if (b.notes) msg += `  📝 _${md(b.notes)}_`;
        msg += `\n⏰ ${md(fmtDate(b.booked_at))}\n\n`;
        const row = [];
        if (b.status==='pending')
            row.push(Markup.button.callback(`👍 تأكيد ${b.barcode}`, `ack:${b.barcode}`));
        row.push(Markup.button.callback(`✅ إتمام ${b.barcode}`, `complete:${b.barcode}`));
        if (row.length) btns.push(row);
    });
    btns.push([Markup.button.callback('◀️  رجوع للقائمة','menu:back')]);
    await ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup });
});

// Acknowledge booking
bot.action(/^ack:(.+)$/, async ctx => {
    await ctx.answerCbQuery('جاري التأكيد…');
    const result = await rpc('bot_acknowledge_booking', { p_chat_id: ctx.chat.id, p_barcode: ctx.match[1] });
    if (result?.success) {
        await ctx.reply(`👍 *تم تأكيد استلام الحجز*\nالعميل: *${md(result.user_name)}*\nالحجز الآن في حالة "مؤكد"\\.`,
            { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('📦  كل الحجوزات','seller:bookings')],[Markup.button.callback('◀️  القائمة','menu:back')]]).reply_markup });
    } else {
        await ctx.reply('⚠️ تعذّر التأكيد\\.', { parse_mode:'MarkdownV2' });
    }
});

// Complete booking (from button or /complete)
bot.action(/^complete:(.+)$/, async ctx => { await ctx.answerCbQuery('جاري الإتمام…'); doComplete(ctx, ctx.match[1]); });
bot.command('complete', async ctx => {
    const code = sanitize((ctx.message?.text||'').split(' ')[1], 20);
    if (!code) return ctx.reply('❗ أرسل: `/complete BARCODE`', { parse_mode:'MarkdownV2' });
    doComplete(ctx, code);
});

async function doComplete(ctx, barcode) {
    const result = await rpc('bot_complete_booking', { p_chat_id: ctx.chat.id, p_barcode: barcode });
    if (!result?.success) {
        const err = result?.error;
        const msg = err==='already_completed' ? '⚠️ هذا الحجز مكتمل مسبقاً\\.'
                  : err==='not_found' ? '❌ الكود غير موجود أو لا ينتمي لمتجرك\\.'
                  : '⚠️ حدث خطأ، حاول لاحقاً\\.';
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
    await ctx.reply(
        `🏁 *تم إتمام الحجز بنجاح\\!*\n${DIV}\n👤 العميل: *${md(result.user_name)}*\n📦 الكمية: ${result.quantity}`,
        { parse_mode:'MarkdownV2',
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('📦  كل الحجوزات','seller:bookings')],[Markup.button.callback('◀️  القائمة','menu:back')]]).reply_markup });
}

// — التحقق من حجز —
bot.command('verify', ctx => startVerify(ctx));
bot.action('seller:verify', async ctx => { await ctx.answerCbQuery(); startVerify(ctx); });

async function startVerify(ctx) {
    const s = getSession(ctx.chat.id);
    if (!s.userId || s.userType!=='merchant') return ctx.reply('❗ للتجار فقط\\.', { parse_mode:'MarkdownV2' });
    const code = sanitize((ctx.message?.text||'').split(' ')[1], 20);
    if (code) return doVerify(ctx, code);
    setStep(ctx.chat.id, 'await_barcode');
    await ctx.reply(`🔍 *تحقق من حجز*\n${DIV}\nأرسل كود الباركود:`, {
        parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌  إلغاء','menu:back')]]).reply_markup });
}

async function doVerify(ctx, barcode) {
    const result = await rpc('bot_verify_booking', { p_chat_id: ctx.chat.id, p_barcode: barcode });
    setStep(ctx.chat.id, 'idle');
    if (!result?.success) {
        const msg = result?.error==='not_found' ? '❌ *الكود غير موجود أو لا ينتمي لمتجرك*'
                  : '⚠️ حدث خطأ، حاول لاحقاً';
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
    const ok = result.status!=='completed' && result.status!=='cancelled';
    const msg =
        `${ok?'✅':'⚠️'} *نتيجة التحقق*\n${DIV}\n` +
        `📋 الكود: \`${md(result.barcode)}\`\n` +
        `👤 العميل: *${md(result.user_name)}*  📞 ${md(result.user_phone)}\n` +
        `🛍 ${md(result.deal_name)}\n` +
        `📦 الكمية: ${result.quantity}   ${statusLabel(result.status)}\n` +
        (result.notes ? `📝 ${md(result.notes)}\n` : '') +
        `⏰ ${md(fmtDate(result.booked_at))}`;
    const btns = [];
    if (ok && result.status==='pending')
        btns.push([Markup.button.callback('👍  تأكيد الاستلام', `ack:${result.barcode}`)]);
    if (ok)
        btns.push([Markup.button.callback('🏁  إتمام الحجز', `complete:${result.barcode}`)]);
    btns.push([Markup.button.callback('◀️  رجوع للقائمة','menu:back')]);
    await ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup });
}

// — عروضي —
bot.action('seller:deals', async ctx => { await ctx.answerCbQuery(); showSellerDeals(ctx); });

async function showSellerDeals(ctx) {
    const s = getSession(ctx.chat.id);
    if (!s.userId || s.userType!=='merchant') return;
    const list = await rpc('bot_get_seller_deals', { p_chat_id: ctx.chat.id });
    if (!list?.length) return ctx.reply(`📭 *لا توجد عروض بعد*`, {
        parse_mode:'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([[Markup.button.callback('➕  أضف أول عرض','seller:addDeal')],[Markup.button.callback('◀️  رجوع','menu:back')]]).reply_markup });

    let msg = `🏷 *عروضي* \\(${list.length}\\)\n${DIV}\n\n`;
    const btns = [];
    list.forEach((d,i) => {
        const qty = d.is_unlimited ? 'غير محدود' : (d.quantity??'—');
        msg += `*${i+1}\\.* *${md(d.item_name)}*\n`;
        msg += `💰 ${md(d.discounted_price)} ر\\.س — خصم ${md(d.discount_percentage)}%\n`;
        msg += `📦 ${md(qty)}   ${statusLabel(d.status)}\n\n`;
        const toggleLabel = d.status==='active' ? '⏸  إيقاف' : '▶️  تفعيل';
        const toggleStatus = d.status==='active' ? 'paused' : 'active';
        // Store deal ID in session for delete
        btns.push([
            Markup.button.callback(`${toggleLabel}`, `toggle:${d.id}:${toggleStatus}`),
            Markup.button.callback(`🗑 حذف`, `delDeal:${d.id}`)
        ]);
    });
    btns.push([Markup.button.callback('➕  إضافة عرض جديد','seller:addDeal')]);
    btns.push([Markup.button.callback('◀️  رجوع للقائمة','menu:back')]);
    await ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup });
}

// Toggle deal
bot.action(/^toggle:([a-zA-Z0-9_-]+):(active|paused)$/, async ctx => {
    await ctx.answerCbQuery('جاري التحديث…');
    const [,dealId, status] = ctx.match;
    const result = await rpc('bot_toggle_deal', { p_chat_id: ctx.chat.id, p_deal_id: dealId, p_status: status });
    if (result?.success) {
        await ctx.reply(`${status==='active'?'🟢 تم تفعيل':'⏸ تم إيقاف'} العرض\\.`,
            { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🏷  قائمة العروض','seller:deals')],[Markup.button.callback('◀️  القائمة','menu:back')]]).reply_markup });
    } else {
        await ctx.reply('⚠️ تعذّر التحديث\\.', { parse_mode:'MarkdownV2' });
    }
});

// Delete deal — confirmation
bot.action(/^delDeal:([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    const dealId = ctx.match[1];
    getSession(ctx.chat.id).temp.deleteDealId = dealId;
    await ctx.reply(`🗑 *تأكيد الحذف*\n${DIV}\nهل تريد حذف هذا العرض؟\n\n_ملاحظة: لا يمكن حذف عرض عليه حجوزات معلقة_`,
        { parse_mode:'MarkdownV2',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.callback('⚠️  نعم، احذف العرض','doDelDeal')],
            [Markup.button.callback('◀️  لا، رجوع','seller:deals')]
          ]).reply_markup });
});
bot.action('doDelDeal', async ctx => {
    await ctx.answerCbQuery('جاري الحذف…');
    const s = getSession(ctx.chat.id);
    const dealId = s.temp.deleteDealId;
    if (!dealId) return ctx.reply('⚠️ انتهت الجلسة\\.', { parse_mode:'MarkdownV2' });
    const result = await rpc('bot_delete_deal', { p_chat_id: ctx.chat.id, p_deal_id: dealId });
    s.temp.deleteDealId = null;
    if (result?.success) {
        await ctx.reply(`🗑 *تم حذف العرض بنجاح*`, {
            parse_mode:'MarkdownV2',
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🏷  عروضي','seller:deals')],[Markup.button.callback('◀️  القائمة','menu:back')]]).reply_markup });
    } else {
        const err = result?.error;
        const msg = err==='has_bookings' ? `❌ *لا يمكن الحذف*\nيوجد *${result.count}* حجز معلق على هذا العرض\\.\nأتمّ الحجوزات أولاً\\.`
                  : '⚠️ تعذّر الحذف\\.';
        await ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️  رجوع','seller:deals')]]).reply_markup });
    }
});

// — حساب التاجر —
bot.action('seller:profile', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    if (!s.userId) return;
    const st = await rpc('bot_get_seller_stats', { p_chat_id: ctx.chat.id });
    const plan = st?.subscription_plan || 'مجاني';
    const expiry = st?.subscription_expires_at ? fmtDay(st.subscription_expires_at) : '—';
    await ctx.reply(`👤 *حسابي*\n${DIV}\n*الاسم:* ${md(s.name)}\n*المتجر:* ${md(s.shop||s.name)}\n*الخطة:* ${md(plan)}\n*تنتهي في:* ${md(expiry)}\n\nلتعديل البيانات أو الصور:`,
        { parse_mode:'MarkdownV2',
          reply_markup: Markup.inlineKeyboard([[Markup.button.webApp('✏️  تعديل الحساب',APP_URL+'/#/seller')],[Markup.button.callback('◀️  رجوع','menu:back')]]).reply_markup });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  إضافة عرض — 5 خطوات
// ═══════════════════════════════════════════════════════════════════════════════
bot.action('seller:addDeal', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    if (!s.userId || s.userType!=='merchant') return;
    s.temp = {};
    setStep(ctx.chat.id, 'deal_name');
    await ctx.reply(`➕ *إضافة عرض جديد*\n${DIV}\n*الخطوة 1 من 5* — اسم المنتج أو الخدمة:`,
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌  إلغاء','menu:back')]]).reply_markup });
});
bot.action('addDeal:cancel', async ctx => {
    await ctx.answerCbQuery();
    setStep(ctx.chat.id, 'idle'); getSession(ctx.chat.id).temp = {};
    await ctx.reply('❌ *تم إلغاء إضافة العرض*', { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
});
bot.action('addDeal:confirm', async ctx => {
    await ctx.answerCbQuery('جاري الإضافة…');
    const s = getSession(ctx.chat.id), t = s.temp||{};
    if (!t.name) return ctx.reply('⚠️ انتهت الجلسة، ابدأ من جديد\\.', { parse_mode:'MarkdownV2' });
    const result = await rpc('bot_add_deal', {
        p_chat_id: ctx.chat.id, p_item_name: t.name,
        p_original_price: t.orig, p_discounted_price: t.disc,
        p_quantity: t.qty, p_description: t.desc, p_category: 'other'
    });
    setStep(ctx.chat.id, 'idle'); s.temp = {};
    if (!result?.success) {
        const msg = result?.error==='invalid_price' ? '❌ السعر بعد الخصم يجب أن يكون أقل من الأصلي\\.'
                  : '⚠️ تعذّر إضافة العرض، حاول لاحقاً\\.';
        return ctx.reply(msg, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
    await ctx.reply(
        `✅ *تم إنشاء العرض كمسودة\\!*\n${DIV}\nالخصم: *${result.discount}%*\n\nفعّله الآن من قائمة عروضي:`,
        { parse_mode:'MarkdownV2',
          reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🏷  تفعيل العرض','seller:deals')],[Markup.button.callback('➕  إضافة عرض آخر','seller:addDeal')],[Markup.button.callback('◀️  القائمة','menu:back')]]).reply_markup });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  لوحة الأدمن
// ═══════════════════════════════════════════════════════════════════════════════
bot.action('admin:stats', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(ctx.chat.id);
    if (!s.isAdmin) return ctx.reply('❗ غير مصرح\\.', { parse_mode:'MarkdownV2' });
    const st = await rpc('bot_get_admin_stats', { p_chat_id: ctx.chat.id });
    if (!st?.success) return ctx.reply('⚠️ غير مصرح أو حدث خطأ\\.', { parse_mode:'MarkdownV2' });
    await ctx.reply(
        `📊 *إحصائيات منصة TAKI*\n${DIV}\n` +
        `👥 المستخدمون: *${st.total_users}*  \\(🏪 ${st.merchants}  🛍 ${st.buyers}\\)\n\n` +
        `🏷 عروض نشطة: *${st.active_deals}*\n` +
        `📦 إجمالي الحجوزات: *${st.total_bookings}*\n` +
        `🌅 حجوزات اليوم: *${st.today_bookings}*\n\n` +
        `🚩 بلاغات معلقة: *${st.pending_reports}*`,
        { parse_mode:'MarkdownV2',
          reply_markup: Markup.inlineKeyboard([[Markup.button.webApp('🛡  لوحة الإدارة الكاملة',APP_URL+'/#/admin')],[Markup.button.callback('◀️  رجوع','menu:back')]]).reply_markup });
});
bot.action('admin:reports', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(`🚩 *البلاغات المعلقة*\n${DIV}\nلمراجعة البلاغات وإدارتها:`,
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.webApp('🛡  مركز الإدارة',APP_URL+'/#/admin')],[Markup.button.callback('◀️  رجوع','menu:back')]]).reply_markup });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  معالج النصوص الحرة — خطوات متعددة + اختصارات
// ═══════════════════════════════════════════════════════════════════════════════
bot.on('text', async ctx => {
    if (!checkRL(`text:${ctx.chat.id}`)) return;
    const s = getSession(ctx.chat.id);
    const text = sanitize(ctx.message.text, 500);
    const lc   = text.toLowerCase().trim();
    const CANCEL_KB = Markup.inlineKeyboard([[Markup.button.callback('❌  إلغاء','addDeal:cancel')]]).reply_markup;

    // ── ربط الحساب ──────────────────────────────────────────────────────────
    if (s.step === 'await_phone') {
        const phone = text.trim();
        if (!isPhone(phone)) return ctx.reply(`❌ *صيغة غير صحيحة*\nأرسل الرقم هكذا:\n\`05XXXXXXXX\``, { parse_mode:'MarkdownV2' });
        const result = await rpc('bot_link_telegram', { p_phone: phone, p_chat_id: ctx.chat.id });
        if (!result?.success) {
            setStep(ctx.chat.id, 'idle');
            const msg = result?.error==='phone_not_found'
                ? `❌ *الرقم غير مسجّل في تاكي*\nتأكد من الرقم أو سجّل في التطبيق أولاً:\n${APP_URL}`
                : result?.error==='suspended' ? '🚫 *هذا الحساب موقوف\\. تواصل مع الدعم\\.*'
                : '⚠️ حدث خطأ، حاول لاحقاً';
            return ctx.reply(msg, { parse_mode:'MarkdownV2' });
        }
        s.userId=result.id; s.userType=result.user_type; s.name=result.name; s.shop=result.shop||null;
        s.isAdmin=!!(result.is_super_admin||(result.admin_permissions?.length>0));
        setStep(ctx.chat.id, 'idle');
        if (s.userType==='merchant') {
            const st = await rpc('bot_get_seller_stats',{p_chat_id:ctx.chat.id});
            if (st) { s.pendingBookings=st.pending_bookings||0; s.activeDeals=st.active_deals||0; }
        }
        await ctx.reply(`✅ *تم الربط بنجاح\\!*\nأهلاً *${md(s.name)}* 👋`, { parse_mode:'MarkdownV2' });
        return sendMain(ctx, s);
    }

    // ── تحقق من باركود ─────────────────────────────────────────────────────
    if (s.step === 'await_barcode') {
        setStep(ctx.chat.id, 'idle');
        return doVerify(ctx, text.trim().toUpperCase());
    }

    // ── كمية حجز مخصصة ──────────────────────────────────────────────────────
    if (s.step === 'await_book_qty') {
        if (!isQty(text) || +text < 1) return ctx.reply('❗ أرسل رقماً صحيحاً للكمية (مثل 2 أو 10):');
        s.temp.dealQty = +text;
        setStep(ctx.chat.id, 'idle');
        return showBookingConfirm(ctx, s);
    }

    // ── إضافة عرض — 5 خطوات ──────────────────────────────────────────────────
    if (s.step === 'deal_name') {
        if (text.length < 3) return ctx.reply('❗ الاسم قصير جداً، حاول مجدداً:');
        s.temp.name = text;
        setStep(ctx.chat.id, 'deal_orig_price');
        return ctx.reply(`*الخطوة 2 من 5* — السعر الأصلي \\(ريال\\):\n_مثال: 250_`, { parse_mode:'MarkdownV2', reply_markup: CANCEL_KB });
    }
    if (s.step === 'deal_orig_price') {
        if (!isPrice(text)) return ctx.reply('❗ أرسل رقماً صحيحاً، مثال: `150`', { parse_mode:'MarkdownV2' });
        s.temp.orig = +text;
        setStep(ctx.chat.id, 'deal_disc_price');
        return ctx.reply(`*الخطوة 3 من 5* — السعر بعد الخصم \\(ريال\\):`, { parse_mode:'MarkdownV2', reply_markup: CANCEL_KB });
    }
    if (s.step === 'deal_disc_price') {
        if (!isPrice(text) || +text >= s.temp.orig) return ctx.reply(`❗ السعر يجب أن يكون أقل من ${s.temp.orig} ر\\.س`, { parse_mode:'MarkdownV2' });
        s.temp.disc = +text;
        const pct = Math.round(((s.temp.orig-s.temp.disc)/s.temp.orig)*100);
        setStep(ctx.chat.id, 'deal_qty');
        return ctx.reply(`✅ نسبة الخصم: *${pct}%*\n\n*الخطوة 4 من 5* — الكمية المتاحة:\n_أرسل 0 لكمية غير محدودة_`, { parse_mode:'MarkdownV2', reply_markup: CANCEL_KB });
    }
    if (s.step === 'deal_qty') {
        if (!isQty(text)) return ctx.reply('❗ أرسل رقم الكمية، مثال: `10` أو `0` لغير محدود');
        s.temp.qty = +text;
        setStep(ctx.chat.id, 'deal_desc');
        return ctx.reply(`*الخطوة 5 من 5* — وصف مختصر للعرض:`, { parse_mode:'MarkdownV2', reply_markup: CANCEL_KB });
    }
    if (s.step === 'deal_desc') {
        s.temp.desc = text.slice(0,300);
        setStep(ctx.chat.id, 'deal_confirm');
        const pct = Math.round(((s.temp.orig-s.temp.disc)/s.temp.orig)*100);
        const msg =
            `📋 *مراجعة العرض الجديد*\n${DIV}\n` +
            `🏷 *الاسم:* ${md(s.temp.name)}\n` +
            `💰 ~~${md(s.temp.orig)}~~ → *${md(s.temp.disc)} ر\\.س* \\(${pct}%\\)\n` +
            `📦 *الكمية:* ${s.temp.qty===0?'غير محدودة':md(s.temp.qty)}\n` +
            `📝 *الوصف:* ${md(s.temp.desc)}\n\n` +
            `_سيُحفظ كمسودة، فعّله بعدها من قائمة عروضي_`;
        return ctx.reply(msg, { parse_mode:'MarkdownV2',
            reply_markup: Markup.inlineKeyboard([[Markup.button.callback('✅  إضافة العرض','addDeal:confirm')],[Markup.button.callback('❌  إلغاء','addDeal:cancel')]]).reply_markup });
    }

    // ── اختصارات ─────────────────────────────────────────────────────────────
    if (['menu','قائمة','القائمة','ابدأ','start','مرحبا','مرحباً','أهلا','أهلاً'].includes(lc)) {
        const ns = await refreshSession(ctx.chat.id); return sendMain(ctx, ns);
    }
    if (['عروض','deals','تخفيضات'].some(k=>lc.includes(k))) return showDeals(ctx,0);
    if (['مساعدة','help'].includes(lc)) return showHelp(ctx);
    if (['حجوزاتي','bookings'].includes(lc)) return showBuyerBookings(ctx);

    // Default
    const ns = await refreshSession(ctx.chat.id);
    await ctx.reply(ns.userId ? 'اختر من القائمة أدناه 👇' : 'اكتب /menu لعرض القائمة أو /link لربط حسابك\\.', {
        parse_mode:'MarkdownV2', reply_markup: roleKb(ns).reply_markup });
});

// Error handler
bot.catch((err,ctx) => console.error(`Bot error [${ctx?.updateType}]:`, err?.message||err));

// Telegram webhook
app.post('/webhook/telegram', (req, res) => {
    if (!TELEGRAM_WEBHOOK_SECRET) return res.status(503).json({ error: 'not configured' });
    if (req.headers['x-telegram-bot-api-secret-token'] !== TELEGRAM_WEBHOOK_SECRET) return res.status(403).json({ error: 'Forbidden' });
    bot.handleUpdate(req.body, res);
});

} // end if(bot)

// ═══════════════════════════════════════════════════════════════════════════════
//  Realtime: إشعار التاجر عند كل حجز جديد
// ═══════════════════════════════════════════════════════════════════════════════
if (supabase && bot) {
    supabase.channel('bot-new-bookings')
        .on('postgres_changes', { event:'INSERT', schema:'public', table:'bookings' }, async payload => {
            const b = payload.new;
            if (!b.store_id) return;
            try {
                const { data: seller } = await supabase.from('users')
                    .select('telegram_chat_id').eq('id', b.store_id).eq('notify_via_telegram', true).maybeSingle();
                if (!seller?.telegram_chat_id) return;
                await bot.telegram.sendMessage(seller.telegram_chat_id,
                    `🔔 *حجز جديد وارد\\!*\n${DIV}\n📋 الكود: \`${md(b.barcode)}\`\n👤 ${md(b.user_name||'—')}  📞 ${md(b.user_phone||'—')}\n📦 الكمية: ${b.booked_quantity}`,
                    { parse_mode:'MarkdownV2',
                      reply_markup: Markup.inlineKeyboard([[Markup.button.callback('👍 تأكيد',`ack:${b.barcode}`), Markup.button.callback('🏁 إتمام',`complete:${b.barcode}`)]]).reply_markup }
                );
            } catch(e) { console.warn('Notify seller:', e.message); }
        }).subscribe();
    console.log('📡 Realtime: إشعارات الحجز مفعّلة');
}

// Realtime: تنبيهات ذكية للمشترين
const DEBOUNCE = new Map();
if (supabase && bot) {
    supabase.channel('bot-user-notifs')
        .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications' }, async payload => {
            const n = payload.new;
            if (n.type!=='deal' && n.type!=='marketing') return;
            if (Date.now() - (DEBOUNCE.get(n.user_id)||0) < 20_000) return;
            try {
                const { data: user } = await supabase.from('users')
                    .select('telegram_chat_id, notify_via_telegram, preferred_lang').eq('id', n.user_id).maybeSingle();
                if (!user?.telegram_chat_id || !user.notify_via_telegram) return;
                const isEn = (user.preferred_lang||'').startsWith('en');
                const msg = isEn ? (n.meta_data?.bot_message_en||`${n.title_en}\n\n${n.body_en}`)
                                 : (n.meta_data?.bot_message_ar||`${n.title_ar}\n\n${n.body_ar}`);
                await bot.telegram.sendMessage(user.telegram_chat_id, msg);
                DEBOUNCE.set(n.user_id, Date.now());
            } catch(e) { console.warn('Alert push:', e.message); }
        }).subscribe();
    console.log('📡 Realtime: التنبيهات الذكية مفعّلة');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WhatsApp Cloud API
// ═══════════════════════════════════════════════════════════════════════════════
async function sendWA(to, payload) {
    if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) return null;
    try {
        const r = await fetch(`https://graph.facebook.com/v22.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
            method:'POST', headers:{ Authorization:`Bearer ${WHATSAPP_ACCESS_TOKEN}`, 'Content-Type':'application/json' },
            body: JSON.stringify({ messaging_product:'whatsapp', recipient_type:'individual', to, ...payload })
        });
        if (!r.ok) { console.warn('WA send:', r.status); return null; }
        return r.json();
    } catch(e) { console.error('WA error:', e.message); return null; }
}

app.get('/webhook/whatsapp', (req, res) => {
    if (req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===WHATSAPP_VERIFY_TOKEN && WHATSAPP_VERIFY_TOKEN)
        return res.status(200).send(req.query['hub.challenge']);
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
        for (const entry of body?.entry||[]) {
            for (const change of entry.changes||[]) {
                for (const msg of change.value?.messages||[]) {
                    const from = msg.from; if (!from || !checkRL(`wa:${from}`)) continue;
                    if (msg.type==='text') {
                        const t = sanitize(msg.text?.body||'',200).toLowerCase();
                        const waMenu = { type:'interactive', interactive:{ type:'button', body:{text:'أهلاً في TAKI 🛍️\nاختر:'}, action:{buttons:[{type:'reply',reply:{id:'wa_deals',title:'🔥 العروض'}},{type:'reply',reply:{id:'wa_bookings',title:'🎟 حجوزاتي'}},{type:'reply',reply:{id:'wa_help',title:'🆘 مساعدة'}}]} } };
                        if (['hi','hello','مرحبا','السلام','menu','قائمة','start'].some(k=>t.includes(k))) await sendWA(from, waMenu);
                        else if (['deals','عروض','تخفيضات'].some(k=>t.includes(k))) {
                            const deals = await getDeals(3);
                            const bodyTxt = deals.length ? '🔥 أحدث العروض:\n\n' + deals.map((d,i)=>`${i+1}. ${d.item_name} — ${d.discounted_price} ر.س (${d.shop_name})`).join('\n') + `\n\n${APP_URL}` : '📭 لا توجد عروض نشطة.';
                            await sendWA(from, {type:'text', text:{body:bodyTxt, preview_url:false}});
                        } else await sendWA(from, waMenu);
                    } else if (msg.type==='interactive') {
                        const id = msg.interactive?.button_reply?.id;
                        if (id==='wa_deals') { const deals=await getDeals(3); await sendWA(from,{type:'text',text:{body:deals.length?'🔥 '+deals.map((d,i)=>`${i+1}. ${d.item_name} — ${d.discounted_price} ر.س`).join('\n')+`\n\n${APP_URL}`:'📭 لا توجد عروض.',preview_url:false}}); }
                        else if (id==='wa_bookings') await sendWA(from,{type:'text',text:{body:`📦 لإدارة حجوزاتك:\n${APP_URL}/#/bookings`,preview_url:false}});
                        else if (id==='wa_help') await sendWA(from,{type:'text',text:{body:'🆘 اكتب "عروض" أو افتح:\n'+APP_URL,preview_url:false}});
                    }
                }
            }
        }
    } catch(e) { console.error('WA processing:', e.message); }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  Health + Boot
// ═══════════════════════════════════════════════════════════════════════════════
app.get('/health', (_,res) => res.json({ status:'active', version:BOT_VERSION, mode:BOT_MODE, uptime:Math.round(process.uptime()), services:{ telegram:!!bot, supabase:!!supabase, whatsapp:!!(WHATSAPP_PHONE_NUMBER_ID&&WHATSAPP_ACCESS_TOKEN) } }));

app.listen(PORT, () => {
    console.log(`🚀 TAKI Bot v${BOT_VERSION} | port ${PORT} | mode: ${BOT_MODE}`);
    if (!TELEGRAM_TOKEN) console.warn('⚠️  TELEGRAM_BOT_TOKEN missing');
    if (!SUPABASE_URL)   console.warn('⚠️  SUPABASE_URL missing');
});

if (bot && BOT_MODE === 'polling') {
    bot.launch({ dropPendingUpdates: true })
        .then(() => console.log('🤖 Bot LIVE — polling mode'))
        .catch(e => console.error('❌ Launch failed:', e.message));
}

process.once('SIGINT',  () => bot?.stop('SIGINT'));
process.once('SIGTERM', () => bot?.stop('SIGTERM'));
