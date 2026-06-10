/**
 * TAKI Bot — v10.0  |  بوت تاكي الاحترافي الآمن
 * ═══════════════════════════════════════════════════════
 * الأمان:
 *   • الهوية عبر telegram_id الذي يضمنه تيليجرام تشفيرياً في كل تحديث.
 *   • ربط الحسابات الموجودة عبر رمز لمرة واحدة يُولَّد فقط داخل جلسة
 *     ويب مسجّلة الدخول (bot_create_link_token يقرأ auth.uid()). لا ربط
 *     بالرقم إطلاقاً — لا يستطيع أحد انتحال حسابك.
 *   • كل العمليات عبر دوال SECURITY DEFINER بمفتاح anon (لا service-role).
 *   • رفع الصور عبر Edge Function محمية بسرّ مشترك (لا مفاتيح في العميل).
 *
 * الميزات: تصفح + صور + حجز + إلغاء (مشتري) — إحصائيات + حجوزات + تحقق +
 *   إتمام + إضافة/تفعيل/حذف عروض مع صورة (تاجر) — إحصائيات منصة (أدمن).
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
const BOT_VERSION              = '10.0.0';

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

// ── Helpers ───────────────────────────────────────────────────────────────────
const tgId   = ctx => ctx.from?.id;
const chatId = ctx => ctx.chat?.id;
const W      = path => APP_URL + path;                 // web deep-link (BrowserRouter, no #)
const sanitize = (s, max=400) => (!s||typeof s!=='string') ? '' : s.replace(/<[^>]*>/gm,'').trim().slice(0,max);
const isPrice  = p => /^\d+(\.\d{1,2})?$/.test(String(p)) && +p > 0;
const isQty    = q => /^\d+$/.test(String(q)) && +q >= 0;
// MarkdownV2 escape
const md = t => t == null ? '' : String(t).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
const fmtDate = d => { try { return new Date(d).toLocaleDateString('ar-SA',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return String(d); } };
const fmtDay  = d => { try { return new Date(d).toLocaleDateString('ar-SA',{year:'numeric',month:'short',day:'numeric'}); } catch { return String(d); } };
const money = v => md(Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));

const STATUS = { pending:'⏳ قيد الانتظار', acknowledged:'✅ مؤكد', completed:'🏁 مكتمل', cancelled:'❌ ملغي', active:'🟢 نشط', paused:'⏸ موقوف', draft:'📝 مسودة', expired:'🔴 منتهي' };
const statusLabel = s => STATUS[s] || md(s);
const DIV = '━━━━━━━━━━━━━━━━━━';

// Clear price block
function priceBlock(orig, disc, pct) {
    const save = Math.max(0, Number(orig) - Number(disc));
    const p = pct || (orig > 0 ? Math.round((save / orig) * 100) : 0);
    return `💵 السعر قبل: *${money(orig)}* ر\\.س\n` +
           `🟢 بعد الخصم: *${money(disc)}* ر\\.س\n` +
           `🔻 توفيرك: *${money(save)}* ر\\.س \\(${p}%\\)`;
}

// ── Session State ─────────────────────────────────────────────────────────────
const sessions = new Map();
const TTL = 30 * 60_000;
function getSession(id) {
    const k = String(id);
    let s = sessions.get(k);
    if (!s || Date.now() - s.at > TTL) {
        s = { step:'idle', userId:null, userType:null, name:null, shop:null,
              isAdmin:false, pendingBookings:0, activeDeals:0, temp:{}, at:Date.now() };
        sessions.set(k, s);
    }
    s.at = Date.now();
    return s;
}
function setStep(id, step, extra={}) { const s = getSession(id); s.step = step; Object.assign(s, extra); }
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
            .select('id,item_name,shop_name,original_price,discounted_price,discount_percentage,quantity,is_unlimited,city,region')
            .eq('status','active').order('created_at',{ascending:false}).range(offset, offset+limit-1);
        return error ? [] : (data||[]);
    } catch { return []; }
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
        [Markup.button.callback('🔥  تصفح العروض','deals:0')],
        [Markup.button.callback('🔗  ربط حسابي (تاجر / مستخدم)','link:start')],
        [Markup.button.webApp('🚀  دخول سريع (متسوّق)', APP_URL)],
        [Markup.button.callback('🆘  مساعدة','help')]
    ]);
}
function kbBuyer() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('🔥  تصفح العروض','deals:0'), Markup.button.callback('🎟  حجوزاتي','buyer:bookings')],
        [Markup.button.callback('🔔  تنبيهاتي','buyer:notif'),  Markup.button.callback('👤  حسابي','buyer:profile')],
        [Markup.button.webApp('🚀  فتح تاكي', APP_URL)],
        [Markup.button.callback('🆘  مساعدة','help')]
    ]);
}
function kbSeller(s) {
    const pBadge = s.pendingBookings > 0 ? `  •  ${s.pendingBookings}` : '';
    return Markup.inlineKeyboard([
        [Markup.button.callback('📊  إحصائياتي','seller:stats'), Markup.button.callback(`📦  الحجوزات${pBadge}`,'seller:bookings')],
        [Markup.button.callback('✅  تحقق من حجز','seller:verify'), Markup.button.callback('🏷  عروضي','seller:deals')],
        [Markup.button.callback('➕  إضافة عرض','seller:addDeal'), Markup.button.callback('👤  حسابي','seller:profile')],
        [Markup.button.webApp('🚀  لوحة التاجر', W('/seller')), Markup.button.callback('🆘  مساعدة','help')]
    ]);
}
function kbAdmin() {
    return Markup.inlineKeyboard([
        [Markup.button.callback('📊  إحصائيات المنصة','admin:stats'), Markup.button.callback('🚩  البلاغات','admin:reports')],
        [Markup.button.webApp('🛡  لوحة الإدارة الكاملة', W('/admin'))],
        [Markup.button.callback('🆘  مساعدة','help')]
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
    return `🛍️ *أهلاً بك في TAKI*\n${DIV}\nمنصة الحجز الذكي للعروض والتخفيضات 🇸🇦\n\n` +
           `🔹 تصفّح مئات العروض بالصور\n🔹 احجز بضغطة واحدة من تيليجرام\n🔹 احفظ باركود حجزك\n\n` +
           `📌 للتجار: اربط حسابك لإدارة متجرك كاملاً من هنا\\.`;
}
async function sendMain(ctx, s) {
    await ctx.reply(roleMsg(s), { parse_mode:'MarkdownV2', reply_markup: roleKb(s).reply_markup });
}

// ═══════════════════════════════════════════════════════════════════════════════
if (bot) {

bot.telegram.setMyCommands([
    { command:'start',    description:'القائمة الرئيسية' },
    { command:'deals',    description:'تصفح العروض' },
    { command:'link',     description:'ربط حسابي' },
    { command:'bookings', description:'حجوزاتي' },
    { command:'stats',    description:'الإحصائيات (تاجر)' },
    { command:'verify',   description:'تحقق من حجز (تاجر)' },
    { command:'help',     description:'مساعدة' }
]).catch(e => console.warn('setMyCommands:', e.message));

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
    m += `📌 *الأوامر:*\n/menu — القائمة\n/deals — العروض\n/link — ربط الحساب\n/bookings — حجوزاتي\n`;
    if (s.userType==='seller'||s.isAdmin) m += `/stats — إحصائياتي\n/verify — تحقق من حجز\n`;
    m += `\n🌐 الموقع: ${APP_URL}`;
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
}

// ── Link account (secure — token minted in authenticated web session) ─────────
bot.command('link', ctx => startLink(ctx));
bot.action('link:start', async ctx => { await ctx.answerCbQuery(); startLink(ctx); });
async function startLink(ctx) {
    await ctx.reply(
        `🔗 *ربط حسابك بتاكي*\n${DIV}\n` +
        `للأمان التام، الربط يتم من داخل حسابك في الموقع \\(لا أحد يربط حسابك سواك\\):\n\n` +
        `1️⃣ افتح تاكي وسجّل دخولك\n` +
        `2️⃣ اذهب إلى *حسابي* 👤\n` +
        `3️⃣ اضغط *«ربط حسابي بتيليجرام»*\n\n` +
        `سيفتح تيليجرام تلقائياً ويربط حسابك فوراً ✅`,
        { parse_mode:'MarkdownV2',
          reply_markup: Markup.inlineKeyboard([
            [Markup.button.url('🔐  افتح حسابي في الموقع', W('/profile'))],
            [Markup.button.webApp('🛍  أو ادخل كمتسوّق سريعاً', APP_URL)],
            [Markup.button.callback('◀️  رجوع','menu:back')]
          ]).reply_markup }
    );
}

// ── Browse deals (paginated) ──────────────────────────────────────────────────
bot.command('deals', ctx => showDeals(ctx, 0));
bot.action(/^deals:(\d+)$/, async ctx => { await ctx.answerCbQuery(); showDeals(ctx, +ctx.match[1]); });
async function showDeals(ctx, offset=0) {
    if (!checkRL(`deals:${chatId(ctx)}`)) return;
    const deals = await getDeals(8, offset);
    if (!deals.length && offset===0)
        return ctx.reply(`📭 *لا توجد عروض نشطة حالياً*\nعُد لاحقاً\\!`, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    let m = `🔥 *العروض النشطة*\n${DIV}\n\n`;
    const rows = [];
    deals.forEach((d,i) => {
        const pct = d.discount_percentage || Math.round(((d.original_price-d.discounted_price)/d.original_price)*100);
        const qty = d.is_unlimited ? '∞' : `${d.quantity??0} متبقٍ`;
        m += `*${offset+i+1}\\.* *${md(d.item_name)}*\n`;
        m += `🏪 ${md(d.shop_name)}   📍 ${md(d.city||d.region||'—')}\n`;
        m += `🟢 *${money(d.discounted_price)} ر\\.س*  \\(خصم ${pct}%\\)   📦 ${md(qty)}\n\n`;
        rows.push([Markup.button.callback(`${offset+i+1}  •  ${String(d.item_name).slice(0,24)}`, `deal:${d.id}`)]);
    });
    const nav = [];
    if (offset > 0) nav.push(Markup.button.callback('◀️ السابق', `deals:${Math.max(0,offset-8)}`));
    if (deals.length === 8) nav.push(Markup.button.callback('التالي ▶️', `deals:${offset+8}`));
    if (nav.length) rows.push(nav);
    rows.push([Markup.button.callback('◀️  رجوع للقائمة','menu:back')]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(rows).reply_markup, link_preview_options:{is_disabled:true} });
}

// ── Deal detail (with photo) ──────────────────────────────────────────────────
bot.action(/^deal:([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    const dealId = ctx.match[1];
    const d = await rpc('bot_get_deal', { p_deal_id: dealId });
    if (!d) return ctx.reply('⚠️ العرض لم يعد متاحاً\\.', { parse_mode:'MarkdownV2' });
    const pct = d.discount_percentage || Math.round(((d.original_price-d.discounted_price)/d.original_price)*100);
    const qty = d.is_unlimited ? 'غير محدود' : `${d.quantity??0} قطعة`;
    const prep = d.prep_time ? `\n⏱ التجهيز: ${md(d.prep_time)}` : '';
    const desc = d.description ? `\n\n📝 ${md(d.description)}` : '';
    const caption =
        `🏷 *${md(d.item_name)}*\n${DIV}\n🏪 ${md(d.shop_name)}   📍 ${md(d.city||d.region||'—')}\n\n` +
        priceBlock(d.original_price, d.discounted_price, pct) +
        `\n\n📦 المتاح: *${md(qty)}*${prep}${desc}`;
    const s = getSession(tgId(ctx));
    s.temp.dealId = dealId; s.temp.dealName = d.item_name; s.temp.dealQty = 1;
    const btns = [];
    if (s.userId && s.userType !== 'seller') btns.push([Markup.button.callback('📥  احجز الآن','book:qty')]);
    else if (!s.userId) btns.push([Markup.button.webApp('🛍  سجّل دخولك لتحجز', APP_URL)]);
    btns.push([Markup.button.callback('◀️  رجوع للعروض','deals:0')]);
    const extra = { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup };
    if (d.image) { try { return await ctx.replyWithPhoto(d.image, { caption, ...extra }); } catch { /* fall through */ } }
    await ctx.reply(caption, { ...extra, link_preview_options:{is_disabled:true} });
});

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
            [Markup.button.callback('❌  إلغاء','menu:back')]
        ]).reply_markup });
});
bot.action(/^bq:(\d+)$/, async ctx => { await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); s.temp.dealQty = +ctx.match[1]; await bookConfirm(ctx, s); });
bot.action('bq:custom', async ctx => { await ctx.answerCbQuery(); setStep(tgId(ctx),'await_book_qty'); await ctx.reply('✏️ أرسل الكمية المطلوبة:', { reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء','menu:back')]]).reply_markup }); });
async function bookConfirm(ctx, s) {
    const d = await rpc('bot_get_deal', { p_deal_id: s.temp.dealId });
    if (!d) return ctx.reply('⚠️ العرض لم يعد متاحاً\\.', { parse_mode:'MarkdownV2' });
    const total = d.discounted_price * s.temp.dealQty;
    await ctx.reply(
        `✅ *تأكيد الحجز*\n${DIV}\n🛍 ${md(d.item_name)}\n🏪 ${md(d.shop_name)}\n\n📦 الكمية: *${s.temp.dealQty}*\n💰 الإجمالي: *${money(total)} ر\\.س*\n${DIV}\nهل تؤكّد؟`,
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('✅  نعم، احجز','book:confirm')],[Markup.button.callback('❌  إلغاء','menu:back')]]).reply_markup });
}
bot.action('book:confirm', async ctx => {
    await ctx.answerCbQuery('جاري الحجز…');
    const s = getSession(tgId(ctx));
    if (!s.temp.dealId) return ctx.reply('⚠️ انتهت الجلسة\\.', { parse_mode:'MarkdownV2' });
    const result = await rpc('bot_book_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.dealId, p_quantity: s.temp.dealQty||1, p_notes: null });
    s.temp.dealId = null; s.temp.dealQty = 1;
    if (!result?.success) {
        const e = result?.error;
        const m = e==='deal_inactive' ? '⚠️ عذراً، العرض انتهى\\.'
                : e==='no_quantity'   ? `⚠️ المتاح: *${result.available??0}* فقط\\.`
                : e==='not_linked'    ? '❗ سجّل دخولك أولاً\\.'
                : e==='suspended'     ? '🚫 حسابك موقوف\\.'
                : '⚠️ تعذّر الحجز، حاول لاحقاً\\.';
        return ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
    const expiry = result.expiry_at ? fmtDate(result.expiry_at) : '—';
    const prep   = result.prep_time ? `\n⏱ التجهيز: ${md(result.prep_time)}` : '';
    await ctx.reply(
        `🎉 *تم الحجز بنجاح\\!*\n${DIV}\n🛍 ${md(result.deal_name)}\n🏪 ${md(result.shop_name)}\n📦 الكمية: *${result.quantity}*${prep}\n\n📋 *باركود حجزك:*\n\n        🔖  \`${result.barcode}\`\n\n${DIV}\n⏰ صالح حتى: ${md(expiry)}\n💡 _أظهر هذا الباركود للبائع عند الاستلام_`,
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🎟  حجوزاتي','buyer:bookings')],[Markup.button.callback('🔥 عروض أخرى','deals:0'), Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
});

// ── Buyer: my bookings ────────────────────────────────────────────────────────
bot.command('bookings', ctx => showBuyerBookings(ctx));
bot.action('buyer:bookings', async ctx => { await ctx.answerCbQuery(); showBuyerBookings(ctx); });
async function showBuyerBookings(ctx) {
    const s = getSession(tgId(ctx));
    if (!s.userId) return ctx.reply('❗ سجّل دخولك أولاً\\.', { parse_mode:'MarkdownV2', reply_markup: kbGuest().reply_markup });
    const list = await rpc('bot_get_my_bookings', { p_telegram_id: tgId(ctx) });
    if (!list?.length)
        return ctx.reply(`📭 *لا توجد حجوزات بعد*\nابدأ حجزك الأول\\!`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔥 تصفح العروض','deals:0')],[Markup.button.callback('◀️ رجوع','menu:back')]]).reply_markup });
    let m = `🎟 *حجوزاتي* \\(${list.length}\\)\n${DIV}\n\n`;
    const btns = [];
    list.forEach((b,i) => {
        m += `*${i+1}\\.* *${md(b.deal_name)}*\n🏪 ${md(b.shop_name)}\n📋 \`${md(b.barcode)}\`  📦 ${b.quantity}\n${statusLabel(b.status)}  •  ${md(fmtDay(b.booked_at))}\n\n`;
        if (b.status==='pending'||b.status==='acknowledged') btns.push([Markup.button.callback(`🚫 إلغاء «${String(b.deal_name).slice(0,18)}»`, `cancel:${b.barcode}`)]);
    });
    btns.push([Markup.button.callback('◀️  رجوع للقائمة','menu:back')]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup });
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
bot.action('buyer:notif', async ctx => {
    await ctx.answerCbQuery();
    await ctx.reply(`🔔 *التنبيهات مفعّلة على تيليجرام*\nستصلك تنبيهات العروض الجديدة هنا\\.`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.webApp('⚙️ إعدادات التنبيهات', W('/profile'))],[Markup.button.callback('◀️ رجوع','menu:back')]]).reply_markup });
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

// ── Seller: incoming bookings ─────────────────────────────────────────────────
bot.action('seller:bookings', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    if (!s.userId || s.userType!=='seller') return;
    const list = await rpc('bot_get_seller_bookings', { p_telegram_id: tgId(ctx) });
    if (!list?.length) return ctx.reply('✅ *لا توجد حجوزات معلقة*', { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    let m = `📦 *الحجوزات الواردة* \\(${list.length}\\)\n${DIV}\n\n`;
    const btns = [];
    list.forEach((b,i) => {
        m += `*${i+1}\\.* \`${md(b.barcode)}\`\n👤 ${md(b.user_name)}  📞 ${md(b.user_phone)}\n🛍 ${md(b.deal_name)}  📦 ×${b.quantity}\n${statusLabel(b.status)}`;
        if (b.notes) m += `  📝 _${md(b.notes)}_`;
        m += `\n⏰ ${md(fmtDate(b.booked_at))}\n\n`;
        const row = [];
        if (b.status==='pending') row.push(Markup.button.callback(`👍 تأكيد`, `ack:${b.barcode}`));
        row.push(Markup.button.callback(`🏁 إتمام ${b.barcode}`, `complete:${b.barcode}`));
        btns.push(row);
    });
    btns.push([Markup.button.callback('◀️  رجوع للقائمة','menu:back')]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup });
});
bot.action(/^ack:(.+)$/, async ctx => {
    await ctx.answerCbQuery('جاري التأكيد…');
    const result = await rpc('bot_acknowledge_booking', { p_telegram_id: tgId(ctx), p_barcode: ctx.match[1] });
    if (result?.success) await ctx.reply(`👍 *تم تأكيد الاستلام*\nالعميل: *${md(result.user_name)}*`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('📦 الحجوزات','seller:bookings')],[Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
    else await ctx.reply('⚠️ تعذّر التأكيد\\.', { parse_mode:'MarkdownV2' });
});
bot.action(/^complete:(.+)$/, async ctx => { await ctx.answerCbQuery('جاري الإتمام…'); doComplete(ctx, ctx.match[1]); });
bot.command('complete', async ctx => { const c = sanitize((ctx.message?.text||'').split(' ')[1],20); if (!c) return ctx.reply('❗ `/complete BARCODE`',{parse_mode:'MarkdownV2'}); doComplete(ctx, c); });
async function doComplete(ctx, barcode) {
    const result = await rpc('bot_complete_booking', { p_telegram_id: tgId(ctx), p_barcode: barcode });
    if (!result?.success) {
        const e = result?.error;
        const m = e==='already_completed' ? '⚠️ مكتمل مسبقاً\\.' : e==='not_found' ? '❌ الكود غير موجود في متجرك\\.' : e==='cancelled' ? '⚠️ هذا الحجز ملغى\\.' : '⚠️ خطأ، حاول لاحقاً\\.';
        return ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
    await ctx.reply(`🏁 *تم إتمام الحجز\\!*\n👤 ${md(result.user_name)}  📦 ${result.quantity}`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('📦 الحجوزات','seller:bookings')],[Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
}

// ── Seller: verify ────────────────────────────────────────────────────────────
bot.command('verify', ctx => startVerify(ctx));
bot.action('seller:verify', async ctx => { await ctx.answerCbQuery(); startVerify(ctx); });
async function startVerify(ctx) {
    const s = getSession(tgId(ctx));
    if (!s.userId || s.userType!=='seller') return ctx.reply('❗ للتجار فقط\\.', { parse_mode:'MarkdownV2' });
    const c = sanitize((ctx.message?.text||'').split(' ')[1],20);
    if (c) return doVerify(ctx, c);
    setStep(tgId(ctx),'await_barcode');
    await ctx.reply(`🔍 *تحقق من حجز*\nأرسل كود الباركود:`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء','menu:back')]]).reply_markup });
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

// ── Seller: my deals ──────────────────────────────────────────────────────────
bot.action('seller:deals', async ctx => { await ctx.answerCbQuery(); showSellerDeals(ctx); });
async function showSellerDeals(ctx) {
    const s = getSession(tgId(ctx));
    if (!s.userId || s.userType!=='seller') return;
    const list = await rpc('bot_get_seller_deals', { p_telegram_id: tgId(ctx) });
    if (!list?.length) return ctx.reply('📭 *لا توجد عروض بعد*', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('➕ أضف أول عرض','seller:addDeal')],[Markup.button.callback('◀️ رجوع','menu:back')]]).reply_markup });
    let m = `🏷 *عروضي* \\(${list.length}\\)\n${DIV}\n\n`;
    const btns = [];
    list.forEach((d,i) => {
        const qty = d.is_unlimited ? 'غير محدود' : (d.quantity??'—');
        m += `*${i+1}\\.* *${md(d.item_name)}*\n🟢 ${money(d.discounted_price)} ر\\.س \\(${md(d.discount_percentage)}%\\)  📦 ${md(qty)}  ${statusLabel(d.status)}\n\n`;
        const tStatus = d.status==='active' ? 'paused' : 'active';
        const tLabel  = d.status==='active' ? '⏸ إيقاف' : '▶️ تفعيل';
        btns.push([Markup.button.callback(`${tLabel} «${String(d.item_name).slice(0,14)}»`, `toggle:${d.id}:${tStatus}`), Markup.button.callback('🗑 حذف', `delDeal:${d.id}`)]);
    });
    btns.push([Markup.button.callback('➕ إضافة عرض','seller:addDeal')]);
    btns.push([Markup.button.callback('◀️ رجوع للقائمة','menu:back')]);
    await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard(btns).reply_markup });
}
bot.action(/^toggle:([a-zA-Z0-9_-]+):(active|paused)$/, async ctx => {
    await ctx.answerCbQuery('جاري التحديث…');
    const [,id,st] = ctx.match;
    const r = await rpc('bot_toggle_deal', { p_telegram_id: tgId(ctx), p_deal_id: id, p_status: st });
    if (r?.success) await ctx.reply(`${st==='active'?'🟢 تم التفعيل':'⏸ تم الإيقاف'}`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🏷 عروضي','seller:deals')],[Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
    else if (r?.error==='blocked') await ctx.reply('⚠️ تعذّر التفعيل — تأكد من فعالية اشتراكك وحدّ المواقع\\.', { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    else await ctx.reply('⚠️ تعذّر التحديث\\.', { parse_mode:'MarkdownV2' });
});
bot.action(/^delDeal:([a-zA-Z0-9_-]+)$/, async ctx => {
    await ctx.answerCbQuery();
    getSession(tgId(ctx)).temp.delId = ctx.match[1];
    await ctx.reply('🗑 *تأكيد الحذف*\nهل تحذف هذا العرض؟\n_لا يمكن حذف عرض عليه حجوزات معلقة_', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('⚠️ نعم، احذف','doDelDeal')],[Markup.button.callback('◀️ لا','seller:deals')]]).reply_markup });
});
bot.action('doDelDeal', async ctx => {
    await ctx.answerCbQuery('جاري الحذف…');
    const s = getSession(tgId(ctx));
    if (!s.temp.delId) return ctx.reply('⚠️ انتهت الجلسة\\.', { parse_mode:'MarkdownV2' });
    const r = await rpc('bot_delete_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.delId });
    s.temp.delId = null;
    if (r?.success) await ctx.reply('🗑 *تم حذف العرض*', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🏷 عروضي','seller:deals')],[Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
    else { const m = r?.error==='has_bookings' ? `❌ *لا يمكن الحذف*\nيوجد ${r.count} حجز معلق\\. أتمّها أولاً\\.` : '⚠️ تعذّر الحذف\\.'; await ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('◀️ رجوع','seller:deals')]]).reply_markup }); }
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

// ── Add deal (6 steps incl. optional photo) ───────────────────────────────────
bot.action('seller:addDeal', async ctx => {
    await ctx.answerCbQuery();
    const s = getSession(tgId(ctx));
    if (!s.userId || s.userType!=='seller') return;
    s.temp = { images: [] };
    setStep(tgId(ctx),'deal_name');
    await ctx.reply(`➕ *إضافة عرض جديد*\n${DIV}\n*1 من 6* — اسم المنتج أو الخدمة:`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء','addDeal:cancel')]]).reply_markup });
});
bot.action('addDeal:cancel', async ctx => { await ctx.answerCbQuery(); setStep(tgId(ctx),'idle'); getSession(tgId(ctx)).temp={}; await ctx.reply('❌ *تم الإلغاء*', { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup }); });
bot.action('addDeal:skipPhoto', async ctx => { await ctx.answerCbQuery(); await addDealReview(ctx, getSession(tgId(ctx))); });
bot.action('addDeal:confirm', async ctx => {
    await ctx.answerCbQuery('جاري النشر…');
    const s = getSession(tgId(ctx)), t = s.temp||{};
    if (!t.name) return ctx.reply('⚠️ انتهت الجلسة\\.', { parse_mode:'MarkdownV2' });
    const r = await rpc('bot_add_deal', { p_telegram_id: tgId(ctx), p_item_name: t.name, p_original_price: t.orig, p_discounted_price: t.disc, p_quantity: t.qty, p_description: t.desc, p_category: 'other', p_images: t.images||[] });
    setStep(tgId(ctx),'idle'); s.temp={};
    if (!r?.success) {
        const m = r?.error==='invalid_price' ? '❌ السعر بعد الخصم يجب أن يكون أقل من الأصلي\\.'
                : r?.error==='blocked' ? '⚠️ تعذّر النشر — تأكد من فعالية اشتراكك\\.' : '⚠️ تعذّر النشر، حاول لاحقاً\\.';
        return ctx.reply(m, { parse_mode:'MarkdownV2', reply_markup: KB_BACK().reply_markup });
    }
    await ctx.reply(`🎉 *تم نشر العرض مباشرةً\\!*\n${DIV}\nالخصم: *${r.discount}%*\nالعرض ظاهر الآن في الموقع والبوت ✅`, { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🏷 عروضي','seller:deals'), Markup.button.callback('➕ عرض آخر','seller:addDeal')],[Markup.button.callback('◀️ القائمة','menu:back')]]).reply_markup });
});
async function addDealReview(ctx, s) {
    setStep(tgId(ctx),'deal_confirm');
    const t = s.temp, pct = Math.round(((t.orig-t.disc)/t.orig)*100);
    const photo = (t.images?.length) ? '\n🖼 صورة: مرفقة ✅' : '\n🖼 صورة: بدون';
    await ctx.reply(
        `📋 *مراجعة العرض*\n${DIV}\n🏷 ${md(t.name)}\n` + priceBlock(t.orig, t.disc, pct) +
        `\n📦 الكمية: ${t.qty===0?'غير محدودة':md(t.qty)}\n📝 ${md(t.desc)}${photo}\n\n_سيُنشر مباشرةً ويظهر في الموقع_`,
        { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('✅ نشر العرض','addDeal:confirm')],[Markup.button.callback('❌ إلغاء','addDeal:cancel')]]).reply_markup });
}

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

// ── Photo handler (add-deal step 6) ───────────────────────────────────────────
bot.on('photo', async ctx => {
    const s = getSession(tgId(ctx));
    if (s.step !== 'deal_photo') return;
    const photos = ctx.message.photo || [];
    const fileId = photos[photos.length - 1]?.file_id; // largest
    if (!fileId) return ctx.reply('❗ تعذّر قراءة الصورة، حاول مجدداً أو تخطَّ\\.', { parse_mode:'MarkdownV2' });
    await ctx.reply('⏳ جاري رفع الصورة…');
    const url = await uploadPhoto(ctx, fileId);
    if (url) { s.temp.images = [url]; await ctx.reply('✅ تم رفع الصورة\\.', { parse_mode:'MarkdownV2' }); }
    else await ctx.reply('⚠️ تعذّر رفع الصورة — سيُنشر العرض بدون صورة\\.', { parse_mode:'MarkdownV2' });
    await addDealReview(ctx, s);
});

// ── Free text (multi-step flows + shortcuts) ──────────────────────────────────
bot.on('text', async ctx => {
    if (!checkRL(`text:${chatId(ctx)}`)) return;
    const s = getSession(tgId(ctx));
    const text = sanitize(ctx.message.text, 500);
    const lc = text.toLowerCase().trim();
    const CANCEL = Markup.inlineKeyboard([[Markup.button.callback('❌ إلغاء','addDeal:cancel')]]).reply_markup;

    if (s.step === 'await_barcode') { setStep(tgId(ctx),'idle'); return doVerify(ctx, text.trim().toUpperCase()); }
    if (s.step === 'await_book_qty') {
        if (!isQty(text) || +text < 1) return ctx.reply('❗ أرسل رقماً صحيحاً (مثل 2):');
        s.temp.dealQty = +text; setStep(tgId(ctx),'idle'); return bookConfirm(ctx, s);
    }
    if (s.step === 'deal_name') {
        if (text.length < 3) return ctx.reply('❗ الاسم قصير جداً:');
        s.temp.name = text; setStep(tgId(ctx),'deal_orig_price');
        return ctx.reply('*2 من 6* — السعر الأصلي \\(ريال\\):\n_مثال: 250_', { parse_mode:'MarkdownV2', reply_markup: CANCEL });
    }
    if (s.step === 'deal_orig_price') {
        if (!isPrice(text)) return ctx.reply('❗ أرسل رقماً صحيحاً، مثل: `150`', { parse_mode:'MarkdownV2' });
        s.temp.orig = +text; setStep(tgId(ctx),'deal_disc_price');
        return ctx.reply('*3 من 6* — السعر بعد الخصم \\(ريال\\):', { parse_mode:'MarkdownV2', reply_markup: CANCEL });
    }
    if (s.step === 'deal_disc_price') {
        if (!isPrice(text) || +text >= s.temp.orig) return ctx.reply(`❗ يجب أن يكون أقل من ${s.temp.orig} ر\\.س`, { parse_mode:'MarkdownV2' });
        s.temp.disc = +text; const pct = Math.round(((s.temp.orig-s.temp.disc)/s.temp.orig)*100);
        setStep(tgId(ctx),'deal_qty');
        return ctx.reply(`✅ الخصم: *${pct}%*\n\n*4 من 6* — الكمية المتاحة:\n_أرسل 0 لغير محدود_`, { parse_mode:'MarkdownV2', reply_markup: CANCEL });
    }
    if (s.step === 'deal_qty') {
        if (!isQty(text)) return ctx.reply('❗ أرسل رقم الكمية، مثل `10` أو `0`');
        s.temp.qty = +text; setStep(tgId(ctx),'deal_desc');
        return ctx.reply('*5 من 6* — وصف مختصر للعرض:', { parse_mode:'MarkdownV2', reply_markup: CANCEL });
    }
    if (s.step === 'deal_desc') {
        s.temp.desc = text.slice(0,300); setStep(tgId(ctx),'deal_photo');
        return ctx.reply('*6 من 6* — أرسل *صورة* للمنتج 📷\n_أو اضغط تخطّي للنشر بدون صورة_', { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('⏭ تخطّي بدون صورة','addDeal:skipPhoto')],[Markup.button.callback('❌ إلغاء','addDeal:cancel')]]).reply_markup });
    }

    if (['menu','قائمة','القائمة','ابدأ','start','مرحبا','مرحباً','اهلا','أهلا','السلام عليكم'].includes(lc)) { const ns = await refreshSession(ctx); return sendMain(ctx, ns); }
    if (['عروض','deals','تخفيضات'].some(k=>lc.includes(k))) return showDeals(ctx,0);
    if (['مساعدة','help'].includes(lc)) return showHelp(ctx);
    if (['حجوزاتي','bookings'].includes(lc)) return showBuyerBookings(ctx);
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
//  Realtime: notify seller on new booking
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
                    `🔔 *حجز جديد وارد\\!*\n${DIV}\n📋 \`${md(b.barcode)}\`\n👤 ${md(b.user_name||'—')}  📞 ${md(b.user_phone||'—')}\n📦 الكمية: ${b.booked_quantity}`,
                    { parse_mode:'MarkdownV2', reply_markup: Markup.inlineKeyboard([[Markup.button.callback('👍 تأكيد',`ack:${b.barcode}`), Markup.button.callback('🏁 إتمام',`complete:${b.barcode}`)]]).reply_markup });
            } catch(e) { console.warn('Notify seller:', e.message); }
        }).subscribe();
    console.log('📡 Realtime: إشعارات الحجز مفعّلة');
}

// Realtime: smart-alert push to buyers
const DEBOUNCE = new Map();
if (supabase && bot) {
    supabase.channel('bot-user-notifs')
        .on('postgres_changes', { event:'INSERT', schema:'public', table:'notifications' }, async payload => {
            const n = payload.new;
            if (n.type!=='deal' && n.type!=='marketing') return;
            if (Date.now() - (DEBOUNCE.get(n.user_id)||0) < 20_000) return;
            try {
                const { data: u } = await supabase.from('users').select('telegram_chat_id, notify_via_telegram, preferred_lang').eq('id', n.user_id).maybeSingle();
                if (!u?.telegram_chat_id || !u.notify_via_telegram) return;
                const en = (u.preferred_lang||'').startsWith('en');
                const msg = en ? (n.meta_data?.bot_message_en||`${n.title_en}\n\n${n.body_en}`) : (n.meta_data?.bot_message_ar||`${n.title_ar}\n\n${n.body_ar}`);
                await bot.telegram.sendMessage(u.telegram_chat_id, msg);
                DEBOUNCE.set(n.user_id, Date.now());
            } catch(e) { console.warn('Alert push:', e.message); }
        }).subscribe();
    console.log('📡 Realtime: التنبيهات الذكية مفعّلة');
}

// ═══════════════════════════════════════════════════════════════════════════════
//  WhatsApp (minimal)
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
            const waMenu = { type:'interactive', interactive:{ type:'button', body:{text:'أهلاً في TAKI 🛍️'}, action:{buttons:[{type:'reply',reply:{id:'wa_deals',title:'🔥 العروض'}},{type:'reply',reply:{id:'wa_help',title:'🆘 مساعدة'}}]} } };
            if (msg.type==='text') {
                const t = sanitize(msg.text?.body||'',200).toLowerCase();
                if (['deals','عروض'].some(k=>t.includes(k))) { const deals=await getDeals(3); await sendWA(from,{type:'text',text:{body:deals.length?'🔥 '+deals.map((d,i)=>`${i+1}. ${d.item_name} — ${d.discounted_price} ر.س`).join('\n')+`\n\n${APP_URL}`:'📭 لا عروض.',preview_url:false}}); }
                else await sendWA(from, waMenu);
            } else if (msg.type==='interactive') {
                const id = msg.interactive?.button_reply?.id;
                if (id==='wa_deals') { const deals=await getDeals(3); await sendWA(from,{type:'text',text:{body:deals.length?'🔥 '+deals.map((d,i)=>`${i+1}. ${d.item_name} — ${d.discounted_price} ر.س`).join('\n')+`\n\n${APP_URL}`:'📭 لا عروض.',preview_url:false}}); }
                else await sendWA(from,{type:'text',text:{body:'🆘 اكتب "عروض" أو افتح:\n'+APP_URL,preview_url:false}});
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
}
process.once('SIGINT',  () => bot?.stop('SIGINT'));
process.once('SIGTERM', () => bot?.stop('SIGTERM'));
