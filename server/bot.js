/**
 * TAKI Bot Server — Telegram & WhatsApp Integration
 * 
 * This server serves as the bridge between messaging platforms
 * and the TAKI Supabase backend.
 * 
 * v5.0 — Now directly connected to Supabase for real-time data.
 */

const express = require('express');
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

// Supabase Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kbmqzxcjdankdgiovctm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// Token setup via Env Vars
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
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
        const phone = ctx.message.text.split(' ')[1];
        if (!phone) {
            ctx.reply('📱 أرسل رقم جوالك بعد الأمر:\n/bookings 05xxxxxxxx');
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
        const code = ctx.message.text.split(' ')[1];
        if (!code) {
            ctx.reply('🔍 أرسل كود الحجز بعد الأمر:\n/verify XXXXXXXX');
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

    // Launch Telegram Webhook
    app.post(`/webhook/telegram`, (req, res) => {
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

// WhatsApp Scaffold
app.post('/webhook/whatsapp', (req, res) => {
    // In production, verify signature from Meta/Twilio
    console.log('WhatsApp Webhook Activity');
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
