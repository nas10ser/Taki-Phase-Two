/**
 * TAKI Bot Server — Telegram & WhatsApp Integration
 *
 * v9.0 (Phase 2): subscription-aware. New commands /subscription, /branches,
 *                 /trial, /analytics, /sponsor. Trial-end & subscription
 *                 changes are pushed instantly via Supabase Realtime.
 * v8.0 — Security-hardened: webhook verification, rate limiting,
 *         no hardcoded secrets, input sanitization.
 */

const express = require('express');
const crypto = require('crypto');
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// ====================== SECURITY: Rate Limiting ======================
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;

function checkRateLimit(key) {
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now - entry.start > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(key, { start: now, count: 1 });
        return true;
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) return false;
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const [key, val] of rateLimitMap) {
        if (now - val.start > RATE_LIMIT_WINDOW_MS * 2) rateLimitMap.delete(key);
    }
}, 5 * 60 * 1000);

// ====================== SECURITY: Input Sanitization ======================
function sanitize(str, maxLen = 200) {
    if (!str || typeof str !== 'string') return '';
    return str.replace(/<[^>]*>?/gm, '').trim().substring(0, maxLen);
}
function isValidPhone(phone) { return /^05\d{8}$/.test(phone); }
function isValidBarcode(code) { return /^[A-Z0-9-]{4,20}$/i.test(code); }
function isValidUuid(id) { return /^[a-zA-Z0-9_-]{8,64}$/.test(id); }

// Supabase Configuration — never hard-code secrets.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || '';
if (!SUPABASE_URL) console.error('❌ FATAL: SUPABASE_URL is missing!');
const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const bot = TELEGRAM_TOKEN ? new Telegraf(TELEGRAM_TOKEN) : null;

// ====================== Telegram chat-link table (in-memory cache) ======================
// Production deployments should persist this in Supabase. For now we cache
// telegram chat_id ↔ taki user_id lookups in memory and re-hydrate on miss.
const chatIdToUser = new Map();

async function findUserByPhone(phone) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase.from('users').select('*').eq('phone', phone).maybeSingle();
        return error ? null : data;
    } catch { return null; }
}
async function getActiveDeals(limit = 5) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('deals').select('*')
            .eq('status', 'active').order('created_at', { ascending: false }).limit(limit);
        return error ? [] : (data || []);
    } catch (e) { console.error('DB Error:', e); return []; }
}
async function getStoreBookings(storeId) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('bookings').select('*')
            .eq('store_id', storeId).eq('status', 'pending')
            .order('booked_at', { ascending: false });
        return error ? [] : (data || []);
    } catch (e) { console.error('DB Error:', e); return []; }
}
async function verifyBooking(barcode) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase.from('bookings').select('*').eq('barcode', barcode).maybeSingle();
        return error ? null : data;
    } catch { return null; }
}

// ====================== Phase 2 helpers ======================
async function getSubscription(userId) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase.from('merchant_subscriptions')
            .select('*').eq('merchant_id', userId).maybeSingle();
        return error ? null : data;
    } catch { return null; }
}
async function getBranches(userId) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase.from('store_branches')
            .select('*').eq('merchant_id', userId).order('created_at', { ascending: true });
        return error ? [] : (data || []);
    } catch { return []; }
}
async function getStoreFunnel(storeId, days = 30) {
    if (!supabase) return null;
    try {
        const start = new Date(Date.now() - days * 86400000).toISOString();
        const end = new Date().toISOString();
        const { data, error } = await supabase.rpc('get_store_funnel', {
            p_store_id: storeId, p_start: start, p_end: end
        });
        if (error) return null;
        return Array.isArray(data) ? data[0] : data;
    } catch { return null; }
}
async function getSponsorships(merchantId) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase.from('sponsorships')
            .select('*').eq('merchant_id', merchantId)
            .order('created_at', { ascending: false }).limit(10);
        return error ? [] : (data || []);
    } catch { return []; }
}

function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('ar-SA', { year: 'numeric', month: '2-digit', day: '2-digit' });
}
function daysLeft(end) {
    if (!end) return null;
    return Math.max(0, Math.ceil((new Date(end).getTime() - Date.now()) / 86400000));
}

// Resolve telegram chat → taki user (caches by phone-number lookup).
async function resolveCallerUser(ctx) {
    const cached = chatIdToUser.get(ctx.chat.id);
    if (cached) return cached;
    return null;
}
function rememberCaller(chatId, user) { chatIdToUser.set(chatId, user); }

// ====================== Telegram commands ======================
if (bot) {
    bot.start((ctx) => {
        ctx.reply(
            '🛍️ مرحباً بك في نظام TAKI!\n\n' +
            'الأوامر المتاحة:\n' +
            '/login <رقم_جوال> — اربط حسابك بهذه المحادثة\n' +
            '/deals — عرض أحدث التخفيضات\n' +
            '/bookings — حجوزاتك المعلقة (للتجار)\n' +
            '/verify <كود> — التحقق من حجز\n\n' +
            '💎 المرحلة ٢:\n' +
            '/subscription — حالة اشتراكك ومدته\n' +
            '/trial — متبقي من تجربتك المجانية\n' +
            '/branches — فروعك المسجلة\n' +
            '/analytics — تحليلات متجرك (٣٠ يوماً)\n' +
            '/sponsor — رعاياتك النشطة\n\n' +
            '/help — المساعدة'
        );
    });

    bot.command('login', async (ctx) => {
        if (!checkRateLimit(`tg_login_${ctx.chat.id}`)) return ctx.reply('⚠️ تم تجاوز الحد، حاول لاحقاً.');
        const phone = sanitize(ctx.message.text.split(' ')[1], 15);
        if (!phone) return ctx.reply('📱 أرسل رقم جوالك:\n/login 05xxxxxxxx');
        if (!isValidPhone(phone)) return ctx.reply('❌ صيغة رقم الجوال غير صحيحة.');
        const user = await findUserByPhone(phone);
        if (!user) return ctx.reply('❌ هذا الرقم غير مسجل في TAKI.');
        rememberCaller(ctx.chat.id, user);
        ctx.reply(`✅ تم الربط — أهلاً ${user.shop || user.name || ''}.\nاكتب /help لرؤية الأوامر.`);
    });

    bot.command('deals', async (ctx) => {
        const deals = await getActiveDeals(5);
        if (deals.length === 0) { ctx.reply('📭 لا توجد عروض نشطة حالياً.'); return; }
        let message = '🔥 أحدث التخفيضات:\n\n';
        deals.forEach((deal, idx) => {
            const discount = deal.discount_percentage || Math.round(((deal.original_price - deal.discounted_price) / deal.original_price) * 100);
            message += `${idx + 1}. ${deal.item_name}\n`;
            message += `   🏪 ${deal.shop_name}\n`;
            message += `   💰 ${deal.discounted_price} ر.س (خصم ${discount}%)\n`;
            message += `   📦 ${deal.quantity === null ? 'غير محدود' : deal.quantity + ' قطعة'}\n\n`;
        });
        ctx.reply(message);
    });

    bot.command('bookings', async (ctx) => {
        if (!checkRateLimit(`tg_${ctx.chat.id}`)) return ctx.reply('⚠️ تم تجاوز الحد.');
        const phone = sanitize(ctx.message.text.split(' ')[1], 15);
        if (!phone) return ctx.reply('📱 أرسل رقم جوالك بعد الأمر:\n/bookings 05xxxxxxxx');
        if (!isValidPhone(phone)) return ctx.reply('❌ صيغة رقم الجوال غير صحيحة.');
        const user = await findUserByPhone(phone);
        if (!user) return ctx.reply('❌ رقم الجوال غير مسجل.');
        rememberCaller(ctx.chat.id, user);
        const bookings = await getStoreBookings(user.id);
        if (bookings.length === 0) { ctx.reply('📭 لا توجد حجوزات معلقة.'); return; }
        let message = `📦 الحجوزات المعلقة (${bookings.length}):\n\n`;
        bookings.forEach((b, idx) => {
            message += `${idx + 1}. كود: ${b.barcode}\n   📦 ${b.booked_quantity} قطعة\n   ⏰ ${new Date(b.booked_at).toLocaleString('ar-SA')}\n\n`;
        });
        ctx.reply(message);
    });

    bot.command('verify', async (ctx) => {
        if (!checkRateLimit(`tg_verify_${ctx.chat.id}`)) return ctx.reply('⚠️ تم تجاوز الحد.');
        const code = sanitize(ctx.message.text.split(' ')[1], 20);
        if (!code) return ctx.reply('🔍 أرسل كود الحجز:\n/verify XXXXXXXX');
        if (!isValidBarcode(code)) return ctx.reply('❌ صيغة الكود غير صحيحة.');
        const booking = await verifyBooking(code.toUpperCase());
        if (booking) {
            ctx.reply(
                `✅ الحجز صحيح!\n\n` +
                `📦 الكمية: ${booking.booked_quantity}\n` +
                `📋 الحالة: ${booking.status === 'pending' ? 'قيد الانتظار' : booking.status === 'acknowledged' ? 'مؤكد' : booking.status}\n` +
                `⏰ ${new Date(booking.booked_at).toLocaleString('ar-SA')}`
            );
        } else {
            ctx.reply('❌ كود الحجز غير موجود أو انتهت صلاحيته.');
        }
    });

    // Phase 2 — subscription status
    bot.command('subscription', async (ctx) => {
        const user = await resolveCallerUser(ctx);
        if (!user) return ctx.reply('🔒 سجّل دخولك أولاً: /login 05xxxxxxxx');
        const sub = await getSubscription(user.id);
        if (!sub) return ctx.reply('ℹ️ لا يوجد اشتراك مرتبط بهذا الحساب.');
        const days = daysLeft(sub.status === 'trial' ? sub.trial_ends_at : sub.current_period_end);
        const statusLabel = {
            trial: '🎁 تجريبي', active: '✅ نشط', gifted: '💝 منحة من الإدارة',
            frozen: '⛔ مجمّد', past_due: '⏰ متأخر', cancelled: '❌ ملغى'
        }[sub.status] || sub.status;

        let msg = `💎 حالة اشتراكك:\n\n` +
            `الحالة: ${statusLabel}\n` +
            `الفروع: ${sub.branches_count || 1}\n`;
        if (sub.discount_percent) msg += `خصم نشط: ${sub.discount_percent}%\n`;
        if (days != null) msg += `متبقي: ${days} يوماً\n`;
        if (sub.status === 'trial' && sub.trial_ends_at) msg += `تنتهي التجربة: ${fmtDate(sub.trial_ends_at)}\n`;
        if (sub.status === 'frozen') msg += `\n⚠️ لإضافة عروض جديدة، جدّد الاشتراك من التطبيق.`;
        if (sub.grant_reason) msg += `\nسبب المنحة: ${sub.grant_reason}`;
        ctx.reply(msg);
    });

    bot.command('trial', async (ctx) => {
        const user = await resolveCallerUser(ctx);
        if (!user) return ctx.reply('🔒 سجّل دخولك أولاً: /login 05xxxxxxxx');
        const sub = await getSubscription(user.id);
        if (!sub || sub.status !== 'trial') return ctx.reply('ℹ️ لست في فترة تجريبية حالياً.');
        const days = daysLeft(sub.trial_ends_at);
        ctx.reply(
            `🎁 تجربتك المجانية:\n\n` +
            `بدأت: ${fmtDate(sub.trial_starts_at)}\n` +
            `تنتهي: ${fmtDate(sub.trial_ends_at)}\n` +
            `متبقي: ${days} يوماً\n\n` +
            (days <= 3
                ? '🔥 لا تخسر زخم متجرك! اشترك الآن من التطبيق لاستمرار النشر.'
                : '✨ استمتع بكل ميزات TAKI خلال هذه الفترة.')
        );
    });

    bot.command('branches', async (ctx) => {
        const user = await resolveCallerUser(ctx);
        if (!user) return ctx.reply('🔒 سجّل دخولك أولاً: /login 05xxxxxxxx');
        const list = await getBranches(user.id);
        if (list.length === 0) return ctx.reply('🏬 لم تُضِف فروعاً بعد.');
        let msg = `🏬 فروعك (${list.length}):\n\n`;
        list.forEach((b, i) => {
            const status = b.is_active ? '✅' : '⏸️';
            msg += `${i + 1}. ${status} ${b.name_ar}\n`;
            if (b.address) msg += `   📍 ${b.address}\n`;
            if (b.phone) msg += `   📞 ${b.phone}\n`;
            msg += '\n';
        });
        ctx.reply(msg);
    });

    bot.command('analytics', async (ctx) => {
        const user = await resolveCallerUser(ctx);
        if (!user) return ctx.reply('🔒 سجّل دخولك أولاً: /login 05xxxxxxxx');
        const f = await getStoreFunnel(user.id, 30);
        if (!f) return ctx.reply('📊 لا توجد بيانات بعد.');
        ctx.reply(
            `📊 تحليلات متجرك (آخر 30 يوماً):\n\n` +
            `👁️ المشاهدات: ${f.views || 0}\n` +
            `👆 النقرات: ${f.clicks || 0}\n` +
            `🛒 بدأ الحجز: ${f.booking_started || 0}\n` +
            `🚪 ترك الحجز: ${f.booking_abandoned || 0}\n` +
            `✅ أكمل الحجز: ${f.booking_completed || 0}\n` +
            `🧍 جلسات فريدة: ${f.unique_sessions || 0}\n\n` +
            `📈 نسبة التحويل: ${f.conversion_rate || 0}%\n` +
            `📉 نسبة التخلي: ${f.abandoned_rate || 0}%`
        );
    });

    bot.command('sponsor', async (ctx) => {
        const user = await resolveCallerUser(ctx);
        if (!user) return ctx.reply('🔒 سجّل دخولك أولاً: /login 05xxxxxxxx');
        const list = await getSponsorships(user.id);
        if (list.length === 0) return ctx.reply('⭐ لا توجد رعاية مرتبطة بمتجرك.');
        let msg = `⭐ رعاياتك (${list.length}):\n\n`;
        list.forEach((s, i) => {
            msg += `${i + 1}. ${s.title_ar || s.title_en || '(بدون عنوان)'}\n`;
            msg += `   النوع: ${s.type} • ${s.is_active ? 'نشطة' : 'موقوفة'}\n`;
            msg += `   👁️ ${s.impressions || 0} • 👆 ${s.clicks || 0}\n\n`;
        });
        ctx.reply(msg);
    });

    bot.command('register', (ctx) => {
        ctx.reply(
            '📝 للتسجيل في TAKI:\n' +
            '1. افتح التطبيق\n' +
            '2. اختر "إنشاء حساب جديد"\n' +
            '3. أدخل بياناتك (الإيميل + الجوال + كلمة المرور)\n' +
            '4. تحقق من بريدك الإلكتروني\n\n' +
            '🌐 ' + (process.env.APP_URL || 'https://taki.app')
        );
    });

    bot.command('help', (ctx) => {
        ctx.reply(
            '🆘 مساعدة TAKI Bot:\n\n' +
            '/login <رقم> — اربط حسابك بهذه المحادثة\n' +
            '/deals — أحدث التخفيضات\n' +
            '/bookings <رقم> — حجوزاتك المعلقة\n' +
            '/verify <كود> — التحقق من حجز\n\n' +
            '💎 المرحلة ٢:\n' +
            '/subscription — حالة اشتراكك\n' +
            '/trial — تجربتك المجانية\n' +
            '/branches — فروعك\n' +
            '/analytics — تحليلات متجرك\n' +
            '/sponsor — رعاياتك\n'
        );
    });

    bot.on('text', async (ctx) => {
        const text = ctx.message.text;
        if (text === 'تسجيل' || text === 'register') ctx.reply('📝 أرسل /register للمزيد.');
        else if (text === 'العروض' || text === 'deals') {
            const deals = await getActiveDeals(3);
            if (deals.length === 0) ctx.reply('📭 لا توجد عروض نشطة. جرب لاحقاً!');
            else {
                let msg = '🔥 أبرز العروض:\n\n';
                deals.forEach((d, i) => { msg += `${i + 1}. ${d.item_name} — ${d.discounted_price} ر.س (${d.shop_name})\n`; });
                ctx.reply(msg);
            }
        } else ctx.reply('أهلاً بك في TAKI! 🛍️\nاكتب /help للأوامر.');
    });

    app.post(`/webhook/telegram`, (req, res) => {
        if (TELEGRAM_WEBHOOK_SECRET) {
            const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
            if (secretHeader !== TELEGRAM_WEBHOOK_SECRET) {
                console.warn('⚠️ Telegram webhook: invalid secret token');
                return res.status(403).json({ error: 'Forbidden' });
            }
        }
        bot.handleUpdate(req.body, res);
    });
}

// ====================== Realtime: subscription & sponsorship updates ======================
if (supabase && bot) {
    // Subscription state changes — push a Telegram notice for any merchant
    // we have a chat_id for in memory.
    supabase
        .channel('bot-subscriptions')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'merchant_subscriptions' }, (payload) => {
            const before = payload.old;
            const after = payload.new;
            if (!after) return;
            // Find a chat for this merchant.
            const chatEntry = [...chatIdToUser.entries()].find(([, u]) => u.id === after.merchant_id);
            if (!chatEntry) return;
            const [chatId] = chatEntry;
            if (before?.status !== after.status) {
                const map = {
                    trial: '🎁 بدأت فترتك التجريبية!',
                    active: '✅ تم تفعيل اشتراكك.',
                    gifted: '💝 تم منحك اشتراكاً مجانياً من الإدارة!',
                    frozen: '⛔ تم تعليق اشتراكك.',
                    cancelled: '❌ تم إلغاء اشتراكك.'
                };
                const msg = map[after.status];
                if (msg) bot.telegram.sendMessage(chatId, msg).catch(() => {});
            }
        })
        .subscribe();

    // New booking → notify the seller's Telegram chat if linked.
    supabase
        .channel('bot-bookings')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings' }, (payload) => {
            const b = payload.new;
            if (!b) return;
            const chatEntry = [...chatIdToUser.entries()].find(([, u]) => u.id === b.store_id);
            if (!chatEntry) return;
            const [chatId] = chatEntry;
            bot.telegram.sendMessage(chatId,
                `📦 طلب حجز جديد!\nكود: ${b.barcode}\nالكمية: ${b.booked_quantity}`
            ).catch(() => {});
        })
        .subscribe();

    console.log('📡 Realtime listeners active for bookings + subscriptions');
}

// ====================== WhatsApp scaffold (Meta Cloud API) ======================
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET || '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN || '';

app.get('/webhook/whatsapp', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN && WHATSAPP_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
});

async function sendWhatsAppText(toPhone, body) {
    if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) return;
    try {
        const res = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${WHATSAPP_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messaging_product: 'whatsapp',
                to: toPhone,
                type: 'text',
                text: { body }
            })
        });
        if (!res.ok) console.warn('WhatsApp send failed:', res.status, await res.text());
    } catch (e) { console.warn('WhatsApp send error:', e?.message); }
}

app.post('/webhook/whatsapp', async (req, res) => {
    if (WHATSAPP_APP_SECRET) {
        const signature = req.headers['x-hub-signature-256'];
        if (!signature) return res.status(401).json({ error: 'Missing signature' });
        const body = JSON.stringify(req.body);
        const expected = 'sha256=' + crypto.createHmac('sha256', WHATSAPP_APP_SECRET).update(body).digest('hex');
        try {
            if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
                return res.status(403).json({ error: 'Invalid signature' });
            }
        } catch { return res.status(403).json({ error: 'Invalid signature' }); }
    }

    // Process inbound messages.
    try {
        const entry = req.body?.entry?.[0]?.changes?.[0]?.value;
        const message = entry?.messages?.[0];
        if (!message) return res.status(200).send('OK');

        const from = message.from;       // E.164 phone number
        const text = (message.text?.body || '').trim();
        const lower = text.toLowerCase();

        if (!checkRateLimit(`wa_${from}`)) {
            await sendWhatsAppText(from, '⚠️ تم تجاوز الحد، حاول لاحقاً.');
            return res.status(200).send('OK');
        }

        if (lower === '/help' || lower === 'help' || lower === 'مساعدة') {
            await sendWhatsAppText(from,
                'TAKI Bot:\n' +
                '/deals — أحدث العروض\n' +
                '/subscription — اشتراكك\n' +
                '/trial — تجربتك المجانية\n' +
                '/analytics — تحليلات متجرك\n' +
                '/branches — فروعك');
        } else if (lower === '/deals' || lower === 'العروض') {
            const deals = await getActiveDeals(5);
            if (deals.length === 0) await sendWhatsAppText(from, '📭 لا توجد عروض نشطة.');
            else {
                let msg = '🔥 أحدث العروض:\n\n';
                deals.forEach((d, i) => {
                    msg += `${i + 1}. ${d.item_name} — ${d.discounted_price} ر.س (${d.shop_name})\n`;
                });
                await sendWhatsAppText(from, msg);
            }
        } else if (lower === '/subscription' || lower === 'اشتراك') {
            // Match the WhatsApp number to a user phone (normalize 9665… to 05…).
            let phone = from.replace(/\D/g, '');
            if (phone.startsWith('966')) phone = '0' + phone.slice(3);
            const user = await findUserByPhone(phone);
            if (!user) await sendWhatsAppText(from, '❌ لم نجد حسابك. تأكد من رقمك.');
            else {
                const sub = await getSubscription(user.id);
                if (!sub) await sendWhatsAppText(from, 'ℹ️ لا يوجد اشتراك مرتبط.');
                else {
                    const days = daysLeft(sub.status === 'trial' ? sub.trial_ends_at : sub.current_period_end);
                    await sendWhatsAppText(from,
                        `💎 اشتراكك:\nالحالة: ${sub.status}\nالفروع: ${sub.branches_count || 1}\n` +
                        (days != null ? `متبقي: ${days} يوماً\n` : '') +
                        (sub.status === 'frozen' ? '\n⚠️ جدّد لإضافة عروض جديدة.' : '')
                    );
                }
            }
        } else {
            await sendWhatsAppText(from, 'TAKI 🛍️\nاكتب /help للأوامر.');
        }
    } catch (e) {
        console.error('WhatsApp handler error:', e);
    }

    res.status(200).send('OK');
});

// ====================== Health check ======================
app.get('/health', (req, res) => {
    res.json({
        status: 'active',
        version: '9.0.0',
        phase: 'phase_2',
        services: {
            telegram: !!bot,
            supabase: !!supabase,
            whatsapp: !!(WHATSAPP_TOKEN && WHATSAPP_PHONE_NUMBER_ID)
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 TAKI Bot Server v9.0 (Phase 2) listening on ${PORT}`);
    if (!TELEGRAM_TOKEN) console.warn('⚠️ TELEGRAM_BOT_TOKEN missing.');
    if (!supabase) console.warn('⚠️ Supabase not configured.');
});
