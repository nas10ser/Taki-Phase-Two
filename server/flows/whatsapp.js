/**
 * flows/whatsapp.js — قناة واتساب (WhatsApp Cloud API)  |  TAKI v11.91
 * ═══════════════════════════════════════════════════════════════════════════
 * تُطابق بوت تيليجرام في الميزات لكنها مصمّمة على قيود واتساب — وتعيد استخدام
 * نفس دوال Supabase (صارت محايدة للهوية عبر `p_whatsapp_id`) ونفس محرّك i18n.
 *
 * فروق واتساب عن تيليجرام (صُمِّمت الواجهة عليها — لا نسخ حرفي):
 *   • أزرار تفاعلية ٣ كحدّ أقصى بالرسالة، قائمة ١٠ صفوف كحدّ أقصى.
 *   • نصّ عادي + *غامق بنجمة واحدة* — لا MarkdownV2 ولا هروب.
 *   • لا callback_query — تُقرأ ردود الأزرار/القوائم عبر button_reply.id / list_reply.id.
 *   • الهوية = رقم الجوال (whatsapp_chat_id)، يُكتب فقط عبر رمز ربط من جلسة ويب
 *     مسجّلة الدخول (bot_consume_link_token) — لا انتحال بالرقم.
 *   • نافذة الخدمة ٢٤ ساعة: الردود هنا كلها داخلها (الإشعارات خارجها = قوالب، مرحلة ٤).
 *
 * الجلسة بالرقم عبر مخزن lib/session المشترك بمفتاح 'wa:'+phone (نفس TTL والاكتساح).
 * اللغة لكل مستخدم عبر I18N.withLang(lang, …) — نفس tr() بلا تمرير يدوي.
 *
 * البناء تدريجي بالمراحل (بدون أزرار ميّتة):
 *   مرحلة ١ (هذه): الهوية الموحّدة + ربط/فكّ الحساب + قائمة رئيسية role-aware +
 *     تصفّح/تصنيفات/حولي/تفاصيل عرض + الحساب + اللغة + المساعدة.
 *   مرحلة ٢: حجز + حجوزاتي + محادثة + تنبيهات + مسابقات + بحث.
 *   مرحلة ٣: لوحة التاجر الكاملة.
 */
const C      = require('../lib/catalog');
const G      = require('../lib/geo');
const F      = require('../lib/format');
const HRS    = require('../lib/hours');
const I18N   = require('../lib/i18n');
const GEO_EN = require('../lib/geoNames.json');
const { getSession } = require('../lib/session');

const { catLabel }            = C;
const { dirLink, remainingText } = G;
const { sanitize }            = F;
const tr = I18N.tr;

// حدود حقول واتساب (نقتطع دفاعياً كي لا يُسقِط اسمٌ طويل رسالةً كاملة).
const LIM = { text: 4096, body: 1024, header: 60, footer: 60, btnTitle: 20, rowTitle: 24, rowDesc: 72, listBtn: 20, caption: 1024 };
const trunc = (s, n) => { s = String(s == null ? '' : s); return s.length <= n ? s : s.slice(0, n - 1) + '…'; };
// عملة حسب اللغة (نصّ عادي، لا مفتاح منفصل لازم).
const cur = () => (I18N.lang() === 'en' ? 'SAR' : 'ر.س');

/**
 * إنشاء قناة واتساب. deps: { rpc, APP_URL, botBookedBarcodes }.
 * بيانات اعتماد واتساب تُقرأ من البيئة هنا — فالقناة خاملة تماماً حتى تُضبط.
 */
function create(deps) {
    const { rpc, APP_URL } = deps;
    const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN || '';

    const enabled = () => !!(PHONE_ID && TOKEN);

    // ── الإرسال منخفض المستوى (no-op حتى تُضبط البيانات) ──────────────────────
    async function sendWA(to, payload) {
        if (!enabled()) return null;
        try {
            const r = await fetch(`https://graph.facebook.com/v22.0/${PHONE_ID}/messages`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to, ...payload }),
            });
            if (!r.ok) { console.warn('WA send:', r.status, (await r.text().catch(() => '')).slice(0, 200)); return null; }
            return r.json();
        } catch (e) { console.error('WA error:', e.message); return null; }
    }

    // ── مُغلِّفات الرسائل ─────────────────────────────────────────────────────
    const sendText = (to, body) => sendWA(to, { type: 'text', text: { body: trunc(body, LIM.text), preview_url: true } });

    function sendList(to, { header, body, footer, button, sections }) {
        const interactive = {
            type: 'list',
            body: { text: trunc(body, LIM.body) },
            action: { button: trunc(button || tr('wa_menu_btn'), LIM.listBtn), sections },
        };
        if (header) interactive.header = { type: 'text', text: trunc(header, LIM.header) };
        if (footer) interactive.footer = { text: trunc(footer, LIM.footer) };
        return sendWA(to, { type: 'interactive', interactive });
    }

    function sendButtons(to, { header, body, footer, buttons }) {
        const interactive = {
            type: 'button',
            body: { text: trunc(body, LIM.body) },
            action: { buttons: buttons.slice(0, 3).map(b => ({ type: 'reply', reply: { id: b.id, title: trunc(b.title, LIM.btnTitle) } })) },
        };
        if (header) interactive.header = { type: 'text', text: trunc(header, LIM.header) };
        if (footer) interactive.footer = { text: trunc(footer, LIM.footer) };
        return sendWA(to, { type: 'interactive', interactive });
    }

    const sendImage = (to, link, caption) => sendWA(to, { type: 'image', image: { link, caption: trunc(caption, LIM.caption) } });
    const askLocation = to => sendWA(to, {
        type: 'interactive',
        interactive: { type: 'location_request_message', body: { text: trunc(tr('wa_ask_location'), LIM.body) }, action: { name: 'send_location' } },
    });

    const row = (id, title, desc) => ({ id, title: trunc(title, LIM.rowTitle), description: trunc(desc, LIM.rowDesc) });

    // ── الجلسة + الهوية ────────────────────────────────────────────────────────
    const waSess   = phone => getSession('wa:' + phone);
    const ownsStore = s => s.userType === 'seller' || !!s.shop;

    function applyProfile(s, u) {
        s.userId   = u.id;
        s.userType = u.user_type;
        s.name     = u.name;
        s.phone    = u.phone || null;
        s.shop     = u.shop || null;
        s.lang     = u.bot_lang || s.lang || 'ar';
        s.isAdmin  = !!(u.is_super_admin || u.user_type === 'admin' || (u.admin_permissions?.length > 0));
        if (!s.geo && u.lat != null && u.lng != null) s.geo = { lat: Number(u.lat), lng: Number(u.lng) };
    }

    async function waRefresh(from) {
        const s = waSess(from);
        const u = await rpc('bot_get_user', { p_whatsapp_id: from });
        if (u) applyProfile(s, u);
        else { s.userId = null; s.userType = null; s.isAdmin = false; }
        return s;
    }

    // أسماء الجغرافيا بالإنجليزي (نفس ترجمة الموقع) — تتبع لغة الطلب عبر ALS.
    const geoLabel = item => (I18N.lang() === 'en' && item && GEO_EN[item.id]) ? GEO_EN[item.id] : (item ? item.name : '');

    // ── القائمة الرئيسية (role-aware، قائمة تفاعلية) ───────────────────────────
    function mainMenu(from, s) {
        const linked = !!s.userId;
        const seller = ownsStore(s);
        const langRow = row('wa:lang', tr('wa_row_lang'), tr('wa_row_lang_desc'));
        const browseSec = {
            title: trunc(tr('wa_sec_browse'), LIM.rowTitle),
            rows: [
                row('wa:browse', tr('menu_browse'), tr('wa_row_browse_desc')),
                row('wa:cats',   tr('wa_row_cats'), tr('wa_row_cats_desc')),
                row('wa:near',   tr('menu_nearby'), tr('wa_row_nearby_desc')),
            ],
        };
        const header = tr('wa_menu_title');
        let body, sections;
        if (!linked) {
            body = tr('wa_menu_body_guest');
            sections = [browseSec, {
                title: trunc(tr('wa_sec_account'), LIM.rowTitle),
                rows: [
                    row('wa:link', tr('menu_login_link'), tr('wa_row_link_desc')),
                    langRow,
                    row('wa:help', tr('menu_help'), tr('wa_row_help_desc')),
                ],
            }];
        } else {
            body = seller ? tr('wa_menu_body_seller', s.shop || s.name)
                 : s.isAdmin ? tr('wa_menu_body_admin', s.name)
                 : tr('wa_menu_body_buyer', s.name);
            sections = [browseSec, {
                title: trunc(tr(seller ? 'wa_sec_store' : 'wa_sec_account'), LIM.rowTitle),
                rows: [
                    row('wa:account', seller ? tr('menu_store_account') : tr('menu_account'), tr('wa_row_account_desc')),
                    langRow,
                    row('wa:help', tr('menu_help'), tr('wa_row_help_desc')),
                    row('wa:logout', tr('menu_logout'), tr('wa_row_logout_desc')),
                ],
            }];
        }
        return sendList(from, { header, body, button: tr('wa_menu_btn'), sections });
    }

    // ── الربط / فكّ الربط / اللغة / الحساب / المساعدة ──────────────────────────
    async function doLink(from, s, token) {
        const r = await rpc('bot_consume_link_token', { p_token: token, p_whatsapp_id: from });
        if (r && r.success) {
            applyProfile(s, r);
            I18N.setLang(s.lang);   // استخدم لغة الحساب فوراً في رسالة الترحيب
            await sendText(from, tr('wa_link_success', s.name || ''));
            return mainMenu(from, s);
        }
        await sendText(from, tr('wa_link_invalid'));
        return mainMenu(from, s);
    }

    async function linkInstructions(from) {
        await sendText(from, tr('wa_not_linked_hint'));
        return sendText(from, tr('wa_open_site', APP_URL));
    }

    async function logout(from, s) {
        await rpc('bot_unlink', { p_whatsapp_id: from });
        s.userId = null; s.userType = null; s.isAdmin = false; s.name = null; s.shop = null;
        s.phone = null; s.geo = null; s.temp = {}; s.step = 'idle';
        await sendText(from, tr('wa_logout_done'));
        return mainMenu(from, s);
    }

    async function toggleLang(from, s) {
        s.lang = (s.lang === 'en') ? 'ar' : 'en';
        I18N.setLang(s.lang);   // يؤثّر على هذا الطلب فوراً
        if (s.userId) await rpc('bot_set_lang', { p_telegram_id: null, p_lang: s.lang, p_whatsapp_id: from });
        await sendText(from, tr('wa_lang_changed'));
        return mainMenu(from, s);
    }

    async function accountCard(from, s) {
        if (!s.userId) return linkInstructions(from);
        const role = s.isAdmin ? tr('wa_role_admin') : ownsStore(s) ? tr('wa_role_seller') : tr('wa_role_buyer');
        await sendText(from, tr('wa_account_card', s.name || '—', s.phone || '—', role));
        return mainMenu(from, s);
    }

    async function help(from, s) {
        await sendText(from, tr('wa_help_body'));
        return mainMenu(from, s);
    }

    // ── التصفّح / التصنيفات / تفاصيل العرض / حولي ──────────────────────────────
    function dealText(d, geo) {
        const L = [];
        L.push(`🏷 *${d.item_name}*`);
        L.push(tr('q2523_wa_shop_city', d.shop_name, (geoLabel({ id: d.city, name: d.city }) || d.city || d.region || '—')));
        L.push(tr('q2524_wa_price', d.discounted_price, d.original_price, d.discount_percentage));
        if (d.expiry_type === 'stock') L.push(d.is_unlimited ? tr('q2525_wa_available') : tr('q2525_wa_remaining', (d.quantity ?? 0)));
        else if (d.expiry_type === 'date' && d.expiry_date) L.push(tr('q2526_wa_valid_until', d.expiry_date));
        else { const r = remainingText(d); if (r) L.push(tr('q2527_wa_ends_in', r)); }
        if (geo && d.distance_km != null) L.push(tr('q2528_wa_distance', d.distance_km));
        if (d.prep_time) L.push(tr('q2529_wa_prep', d.prep_time));
        // حالة المحل (مفتوح/مغلق + وقت الفتح) — نفس مصدر الموقع (open_status). الحجز يتم
        // عبر رابط التطبيق الذي يمنع حجز المحل المغلق ويعرض وقت الفتح. v11.92
        const os = d.open_status;
        if (os && os.configured) L.push(HRS.statusText(os));
        if (d.description) L.push(tr('q2530_wa_description', String(d.description).slice(0, 400)));
        L.push(os && os.configured && !os.open ? tr('wa_book_when_open', `${APP_URL}/deal/${d.id}`) : tr('wa_book_on_app', `${APP_URL}/deal/${d.id}`));
        return L.join('\n');
    }

    async function browse(from, s, sort, cat) {
        const geo = (sort === 'nearby') ? s.geo : null;
        if (sort === 'nearby' && !geo) return askLocation(from);
        const deals = await rpc('bot_browse_deals', {
            p_sort: sort, p_category: (cat && cat !== 'all') ? cat : null,
            p_lat: geo ? geo.lat : null, p_lng: geo ? geo.lng : null,
            p_radius_km: null, p_limit: 10, p_offset: 0, p_open_now: false,
        }) || [];
        if (!deals.length) return sendText(from, tr('wa_no_deals'));
        const rows = deals.slice(0, 10).map(d => row(
            `wa:deal:${d.id}`,
            String(d.item_name),
            `${d.discounted_price} ${cur()} • ${d.discount_percentage}%${geo && d.distance_km != null ? ` • ${d.distance_km}كم` : ''}`,
        ));
        const secTitle = (cat && cat !== 'all') ? catLabel(cat) : tr('sort_t_' + sort);
        return sendList(from, {
            header: tr('sort_t_' + sort), body: tr('wa_browse_body'), footer: 'TAKI',
            button: tr('wa_menu_btn'), sections: [{ title: trunc(secTitle, LIM.rowTitle), rows }],
        });
    }

    async function categories(from, s) {
        const geo = s.geo;
        const cats = await rpc('bot_get_categories', { p_lat: geo ? geo.lat : null, p_lng: geo ? geo.lng : null, p_radius_km: null }) || [];
        if (!cats.length) return sendText(from, tr('wa_no_cats'));
        const rows = cats.slice(0, 10).map(c => row(`wa:cat:${c.category}`, catLabel(c.category), tr('wa_deals_available', c.n)));
        return sendList(from, {
            header: tr('wa_cats_header'), body: tr('wa_cats_body'),
            button: tr('wa_menu_btn'), sections: [{ title: trunc(tr('wa_cats_section'), LIM.rowTitle), rows }],
        });
    }

    async function dealDetail(from, s, id) {
        const d = await rpc('bot_get_deal', { p_deal_id: id });
        if (!d) return sendText(from, tr('wa_deal_gone'));
        const geo = s.geo;
        const img = (Array.isArray(d.images) && d.images.filter(Boolean)[0]) || d.image;
        if (img) await sendImage(from, img, dealText(d, geo));
        else     await sendText(from, dealText(d, geo));
        const dl = dirLink(d, geo);
        if (dl) await sendText(from, tr('wa_directions', dl));
    }

    function nearbyEntry(from, s) {
        return s.geo ? browse(from, s, 'nearby', null) : askLocation(from);
    }

    // ── معالجات الأحداث ────────────────────────────────────────────────────────
    async function onText(from, s, raw) {
        const text = sanitize(raw, 300);
        const linkMatch = text.match(/link_([A-Za-z0-9]+)/i);
        if (linkMatch) return doLink(from, s, linkMatch[1]);
        const low = text.toLowerCase();
        if (/(menu|قائمة|القائمة|البداية|ابدأ|ابدا|start|^hi$|^hello$|مرحبا|السلام|اهلا|أهلا)/.test(low)) return mainMenu(from, s);
        if (['deal', 'عرض', 'عروض', 'تخفيض', 'خصم'].some(k => low.includes(k))) return browse(from, s, 'newest', null);
        if (['تصنيف', 'صنف', 'فئة', 'category', 'categories'].some(k => low.includes(k))) return categories(from, s);
        if (['حول', 'قرب', 'أقرب', 'اقرب', 'near', 'موقع', 'location'].some(k => low.includes(k))) return nearbyEntry(from, s);
        if (['help', 'مساعد', 'مساعدة', '؟', '?'].some(k => low.includes(k))) return help(from, s);
        return mainMenu(from, s);
    }

    async function onInteractive(from, s, ir) {
        const id = (ir.button_reply && ir.button_reply.id) || (ir.list_reply && ir.list_reply.id) || '';
        if (id === 'wa:browse')  return browse(from, s, 'newest', null);
        if (id === 'wa:cats')    return categories(from, s);
        if (id === 'wa:near')    return nearbyEntry(from, s);
        if (id === 'wa:link')    return linkInstructions(from);
        if (id === 'wa:lang')    return toggleLang(from, s);
        if (id === 'wa:help')    return help(from, s);
        if (id === 'wa:account') return accountCard(from, s);
        if (id === 'wa:logout')  return logout(from, s);
        if (id.startsWith('wa:deal:')) return dealDetail(from, s, id.slice(8));
        if (id.startsWith('wa:cat:'))  return browse(from, s, 'newest', id.slice(7));
        return mainMenu(from, s);
    }

    async function onLocation(from, s, loc) {
        s.geo = { lat: loc.latitude, lng: loc.longitude, t: Date.now() };
        await sendText(from, tr('wa_loc_set'));
        return browse(from, s, 'nearby', null);
    }

    // ── نقطة الدخول من webhook: رسالة واحدة من المستخدم ──────────────────────────
    // bot.js يتكفّل بالتحقّق من التوقيع وحدّ المعدّل، ثم ينادي هذه لكل رسالة.
    async function handleMessage(from, msg) {
        const s = waSess(from);
        if (!s.userId) await waRefresh(from);   // تعرّف كسول على المستخدم (مثل تيليجرام)
        const lang = s.lang || 'ar';
        return I18N.withLang(lang, async () => {
            try {
                if (msg.type === 'text')        return await onText(from, s, msg.text?.body || '');
                if (msg.type === 'interactive') return await onInteractive(from, s, msg.interactive || {});
                if (msg.type === 'location' && msg.location) return await onLocation(from, s, msg.location);
                return await mainMenu(from, s);
            } catch (e) { console.error('WA handleMessage:', e.message); }
        });
    }

    return { sendWA, sendText, handleMessage, enabled };
}

module.exports = { create };
