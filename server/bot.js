/**
 * TAKI Bot Server — Telegram & WhatsApp Integration
 * 
 * This server serves as the bridge between messaging platforms
 * and the TAKI Supabase backend.
 * 
 * v6.0 — Security-hardened: webhook verification, rate limiting,
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
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 30; // max requests per window per IP/chatId

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

// Periodic cleanup of stale rate-limit entries
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

function isValidPhone(phone) {
    return /^05\d{8}$/.test(phone);
}

function isValidBarcode(code) {
    return /^[A-Z0-9-]{4,20}$/i.test(code);
}

// Supabase Configuration — NEVER hardcode URLs or keys
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || ''; // Intentionally anon-only; service key bypasses RLS
if (!SUPABASE_URL) console.error('❌ FATAL: SUPABASE_URL environment variable is missing!');
const supabase = (SUPABASE_URL && SUPABASE_KEY) ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Token setup via Env Vars
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const bot = TELEGRAM_TOKEN ? new Telegraf(TELEGRAM_TOKEN) : null;

// Helper: Get active deals from Supabase
async function getActiveDeals(limit = 5) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('deals')
            .select('*')
            .eq('status', 'active')
            .order('created_at', { ascending: false })
            .limit(limit);
        return error ? [] : (data || []);
    } catch (e) {
        console.error('DB Error:', e);
        return [];
    }
}

// Helper: Get bookings by store
async function getStoreBookings(storeId) {
    if (!supabase) return [];
    try {
        const { data, error } = await supabase
            .from('bookings')
            .select('*')
            .eq('store_id', storeId)
            .eq('status', 'pending')
            .order('booked_at', { ascending: false });
        return error ? [] : (data || []);
    } catch (e) {
        console.error('DB Error:', e);
        return [];
    }
}

// Helper: Verify booking by barcode
async function verifyBooking(barcode) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('bookings')
            .select('*')
            .eq('barcode', barcode)
            .maybeSingle();
        return error ? null : data;
    } catch (e) {
        return null;
    }
}

// Helper: Find user by phone
async function findUserByPhone(phone) {
    if (!supabase) return null;
    try {
        const { data, error } = await supabase
            .from('users')
            .select('*')
            .eq('phone', phone)
            .maybeSingle();
        return error ? null : data;
    } catch (e) {
        return null;
    }
}

if (bot) {
    bot.start((ctx) => {
        ctx.reply(
            '🛍️ مرحباً بك في نظام TAKI!\n\n' +
            'الأوامر المتاحة:\n' +
            '/deals — عرض أحدث التخفيضات\n' +
            '/bookings — عرض حجوزاتك (للتجار)\n' +
            '/verify <كود> — التحقق من حجز\n' +
            '/register — معلومات التسجيل\n' +
            '/help — المساعدة'
        );
    });

    bot.command('deals', async (ctx) => {
        const deals = await getActiveDeals(5);
        if (deals.length === 0) {
            ctx.reply('📭 لا توجد عروض نشطة حالياً.');
            return;
        }

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
        // Rate limit per chat
        if (!checkRateLimit(`tg_${ctx.chat.id}`)) {
            ctx.reply('⚠️ تم تجاوز حد المحاولات، حاول بعد دقيقة.');
            return;
        }

        const phone = sanitize(ctx.message.text.split(' ')[1], 15);
        if (!phone) {
            ctx.reply('📱 أرسل رقم جوالك بعد الأمر:\n/bookings 05xxxxxxxx');
            return;
        }

        if (!isValidPhone(phone)) {
            ctx.reply('❌ صيغة رقم الجوال غير صحيحة. استخدم: 05xxxxxxxx');
            return;
        }

        const user = await findUserByPhone(phone);
        if (!user) {
            ctx.reply('❌ رقم الجوال غير مسجل في المنصة.');
            return;
        }

        const bookings = await getStoreBookings(user.id);
        if (bookings.length === 0) {
            ctx.reply('📭 لا توجد حجوزات معلقة.');
            return;
        }

        let message = `📦 الحجوزات المعلقة (${bookings.length}):\n\n`;
        bookings.forEach((b, idx) => {
            message += `${idx + 1}. كود: ${b.barcode}\n`;
            message += `   📦 ${b.booked_quantity} قطعة\n`;
            message += `   ⏰ ${new Date(b.booked_at).toLocaleString('ar-SA')}\n\n`;
        });

        ctx.reply(message);
    });

    bot.command('verify', async (ctx) => {
        // Rate limit per chat
        if (!checkRateLimit(`tg_verify_${ctx.chat.id}`)) {
            ctx.reply('⚠️ تم تجاوز حد المحاولات، حاول بعد دقيقة.');
            return;
        }

        const code = sanitize(ctx.message.text.split(' ')[1], 20);
        if (!code) {
            ctx.reply('🔍 أرسل كود الحجز بعد الأمر:\n/verify XXXXXXXX');
            return;
        }

        if (!isValidBarcode(code)) {
            ctx.reply('❌ صيغة الكود غير صحيحة.');
            return;
        }

        const booking = await verifyBooking(code.toUpperCase());
        if (booking) {
            ctx.reply(
                `✅ الحجز صحيح!\n\n` +
                `📦 الكمية: ${booking.booked_quantity}\n` +
                `📋 الحالة: ${booking.status === 'pending' ? 'قيد الانتظار' : booking.status === 'acknowledged' ? 'مؤكد' : booking.status}\n` +
                `⏰ وقت الحجز: ${new Date(booking.booked_at).toLocaleString('ar-SA')}`
            );
        } else {
            ctx.reply('❌ كود الحجز غير موجود أو انتهت صلاحيته.');
        }
    });

    bot.command('register', (ctx) => {
        ctx.reply(
            '📝 للتسجيل في TAKI:\n\n' +
            '1. افتح التطبيق أو الموقع\n' +
            '2. اختر "إنشاء حساب جديد"\n' +
            '3. أدخل بياناتك (الإيميل + الجوال + كلمة المرور)\n' +
            '4. تحقق من بريدك الإلكتروني\n\n' +
            '🌐 الرابط: ' + (process.env.APP_URL || 'https://taki.app')
        );
    });

    bot.command('help', (ctx) => {
        ctx.reply(
            '🆘 مساعدة TAKI Bot:\n\n' +
            '/deals — عرض أحدث 5 تخفيضات نشطة\n' +
            '/bookings <رقم_جوال> — عرض حجوزاتك المعلقة\n' +
            '/verify <كود> — التحقق من كود الحجز\n' +
            '/register — معلومات التسجيل\n' +
            '/help — عرض هذه الرسالة'
        );
    });

    bot.on('text', async (ctx) => {
        const text = ctx.message.text;
        if (text === 'تسجيل' || text === 'register') {
            ctx.reply('📝 للتسجيل، زُر التطبيق أو أرسل /register للمزيد.');
        } else if (text === 'العروض' || text === 'deals') {
            // Trigger the deals command
            const deals = await getActiveDeals(3);
            if (deals.length === 0) {
                ctx.reply('📭 لا توجد عروض نشطة حالياً. جرب لاحقاً!');
            } else {
                let msg = '🔥 أبرز العروض:\n\n';
                deals.forEach((d, i) => {
                    msg += `${i + 1}. ${d.item_name} — ${d.discounted_price} ر.س (${d.shop_name})\n`;
                });
                ctx.reply(msg);
            }
        } else {
            ctx.reply('أهلاً بك في TAKI! 🛍️\nاكتب /help لمشاهدة الأوامر المتاحة.');
        }
    });

    // Launch Telegram Webhook — with secret verification
    app.post(`/webhook/telegram`, (req, res) => {
        // Verify webhook secret token if configured
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

// ====================== Supabase Realtime Listener ======================
// Listen for new bookings and notify sellers via Telegram
if (supabase && bot) {
    supabase
        .channel('bot-bookings')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookings' }, async (payload) => {
            const booking = payload.new;
            console.log(`📦 New booking detected: ${booking.barcode}`);
            // In production, look up seller's telegram chat_id and send notification
            // For now, log it
        })
        .subscribe();
    
    console.log('📡 Supabase Realtime listener active for bookings');
}

// WhatsApp Scaffold — with signature verification placeholder
const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || '';
const WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET || '';

app.get('/webhook/whatsapp', (req, res) => {
    // Meta Webhook verification (challenge response)
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN && WHATSAPP_VERIFY_TOKEN) {
        return res.status(200).send(challenge);
    }
    return res.status(403).send('Forbidden');
});

app.post('/webhook/whatsapp', (req, res) => {
    // Verify Meta signature (X-Hub-Signature-256)
    if (WHATSAPP_APP_SECRET) {
        const signature = req.headers['x-hub-signature-256'];
        if (!signature) return res.status(401).json({ error: 'Missing signature' });
        const body = JSON.stringify(req.body);
        const expected = 'sha256=' + crypto.createHmac('sha256', WHATSAPP_APP_SECRET).update(body).digest('hex');
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
            console.warn('⚠️ WhatsApp webhook: invalid signature');
            return res.status(403).json({ error: 'Invalid signature' });
        }
    }
    // Process WhatsApp messages here in the future
    res.status(200).send('OK');
});

// Health Check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'active', 
        version: '5.0.0', 
        services: { 
            telegram: !!bot, 
            supabase: !!supabase,
            whatsapp: false 
        } 
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 TAKI Bot Server v5.0 Active on port ${PORT}`);
    if (!TELEGRAM_TOKEN) console.warn('⚠️ Warning: TELEGRAM_BOT_TOKEN is missing.');
    if (!supabase) console.warn('⚠️ Warning: Supabase not configured. Bot running in offline mode.');
});
