/**
 * flows/whatsapp.js — قناة واتساب الكاملة (WhatsApp Cloud API)  |  TAKI v11.93
 * ═══════════════════════════════════════════════════════════════════════════
 * تطابق تامّ مع بوت تيليجرام (مشتري + تاجر) مصمَّم على قيود واتساب — تعيد استخدام
 * نفس دوال Supabase (محايدة للهوية عبر `p_whatsapp_id`) ونفس محرّك i18n (tr + wa_*).
 *
 * قواعد تفادي أخطاء تيليجرام التاريخية (مطبّقة هنا):
 *   • نصّ عادي + *غامق بنجمة واحدة* — لا MarkdownV2 ولا هروب إطلاقاً.
 *   • كل حقل يُقتطع تلقائياً لحدود واتساب (trunc) فلا يُسقط نصٌّ طويل رسالةً كاملة
 *     (نظير فخّ «اختفاء التفاصيل/الفوتر» في تيليجرام).
 *   • كل شاشة فيها مخرج رجوع/قائمة (صفّ «🏠» في القوائم أو زر رجوع) — لا طريق مسدود.
 *   • الهوية عبر p_whatsapp_id في كل RPC — صفر تكرار لمنطق الأعمال.
 *   • مالك المتجر عبر ownsStore() (لا user_type==='seller') — تفادي فخّ الأدمن المالك.
 *   • try/catch حول كل تدفّق — لا تُسقط رسالةٌ بقيّةَ المعالجة.
 *   • كل نصّ ثنائي اللغة عبر tr() (ar/en) — لا مفاتيح يتيمة (مُتحقَّق آلياً).
 *
 * الجلسة بالرقم عبر مخزن lib/session المشترك بمفتاح 'wa:'+phone (نفس TTL/الاكتساح).
 */
const C      = require('../lib/catalog');
const G      = require('../lib/geo');
const F      = require('../lib/format');
const HRS    = require('../lib/hours');
const I18N   = require('../lib/i18n');
const GEO_EN = require('../lib/geoNames.json');
const { getSession } = require('../lib/session');

const { catLabel, CAT, genderLabel, GENDER } = C;
const { dirLink, remainingText, resolveGoogleLocation } = G;
const { sanitize, money, prepLabel, statusLabel, fmtDate, fmtDay, DIV,
        normalizeDigits, isPrice, isQty, parseFlexibleDate, priceBlock } = F;
const tr = I18N.tr;
const numOf = txt => +normalizeDigits(txt);

// حدود حقول واتساب (نقتطع دفاعياً كي لا يُسقِط اسمٌ طويل رسالةً كاملة).
const LIM = { text: 4096, body: 1024, header: 60, footer: 60, btnTitle: 20, rowTitle: 24, rowDesc: 72, listBtn: 20, caption: 1024, rows: 10 };
const trunc = (s, n) => { s = String(s == null ? '' : s); return s.length <= n ? s : s.slice(0, n - 1) + '…'; };
const cur = () => (I18N.lang() === 'en' ? 'SAR' : 'ر.س');           // عملة حسب اللغة
const MAX_IMAGES = 4;
const YEAR_MIN = 525600, DAY_MS = 86400000, MIN_LEAD = 10 * 60_000;

/**
 * إنشاء قناة واتساب. deps: { rpc, APP_URL, botBookedBarcodes }.
 * بيانات الاعتماد تُقرأ من البيئة هنا — القناة خاملة تماماً حتى تُضبط.
 */
function create(deps) {
    const { rpc, APP_URL } = deps;
    const botBookedBarcodes = deps.botBookedBarcodes || new Set();
    const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const TOKEN    = process.env.WHATSAPP_ACCESS_TOKEN || '';
    const GATEWAY  = process.env.BOT_GATEWAY_SECRET || '';
    const SB_URL   = process.env.SUPABASE_URL || '';
    const SB_KEY   = process.env.SUPABASE_ANON_KEY || '';
    const enabled = () => !!(PHONE_ID && TOKEN);
    const W = path => APP_URL + path;

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

    // ── مُغلِّفات الرسائل (كلها تقتطع لحدود واتساب) ───────────────────────────
    const sendText = (to, body) => sendWA(to, { type: 'text', text: { body: trunc(body, LIM.text), preview_url: true } });

    function sendList(to, { header, body, footer, button, sections }) {
        // اقتطاع الصفوف إلى ١٠ كحدّ أقصى عبر كل الأقسام (حدّ واتساب الصارم).
        let left = LIM.rows;
        const secs = [];
        for (const sec of (sections || [])) {
            if (left <= 0) break;
            const rows = (sec.rows || []).slice(0, left);
            left -= rows.length;
            if (rows.length) secs.push({ title: sec.title ? trunc(sec.title, LIM.rowTitle) : undefined, rows });
        }
        const interactive = {
            type: 'list',
            body: { text: trunc(body, LIM.body) },
            action: { button: trunc(button || tr('wa_menu_btn'), LIM.listBtn), sections: secs.length ? secs : [{ rows: [row('wa:menu', tr('wa_row_menu'), '')] }] },
        };
        if (header) interactive.header = { type: 'text', text: trunc(header, LIM.header) };
        if (footer) interactive.footer = { text: trunc(footer, LIM.footer) };
        return sendWA(to, { type: 'interactive', interactive });
    }

    function sendButtons(to, { header, body, footer, buttons }) {
        const interactive = {
            type: 'button',
            body: { text: trunc(body, LIM.body) },
            action: { buttons: buttons.slice(0, 3).map(b => ({ type: 'reply', reply: { id: trunc(b.id, 200), title: trunc(b.title, LIM.btnTitle) } })) },
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

    const row = (id, title, desc) => { const r = { id: trunc(id, 200), title: trunc(title, LIM.rowTitle) }; if (desc) r.description = trunc(desc, LIM.rowDesc); return r; };
    const menuRow = () => row('wa:menu', tr('wa_row_menu'), '');
    const menuBtn = () => ({ id: 'wa:menu', title: tr('wa_row_menu') });
    const backBtn = id => ({ id, title: tr('wa_back') });

    // رفع صورة واتساب (وسيط media) → رابط عام عبر edge function (v3 يدعم مضيف واتساب + توكن).
    async function uploadWaPhoto(mediaId) {
        if (!GATEWAY || !SB_URL || !TOKEN) return null;
        try {
            const m = await fetch(`https://graph.facebook.com/v22.0/${mediaId}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
            const mj = await m.json().catch(() => ({}));
            if (!mj || !mj.url) return null;
            const r = await fetch(`${SB_URL}/functions/v1/bot-upload-image`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-bot-secret': GATEWAY, Authorization: `Bearer ${SB_KEY}`, apikey: SB_KEY },
                body: JSON.stringify({ file_url: mj.url, fetch_auth: `Bearer ${TOKEN}` }),
            });
            const j = await r.json().catch(() => ({}));
            return (j && j.url) || null;
        } catch (e) { console.warn('uploadWaPhoto:', e.message); return null; }
    }

    // ── الجلسة + الهوية ────────────────────────────────────────────────────────
    const waSess   = phone => getSession('wa:' + phone);
    const ownsStore = s => s.userType === 'seller' || !!s.shop;
    const aid = (from, extra = {}) => ({ p_telegram_id: null, p_whatsapp_id: from, ...extra });
    const geoLabel = item => (I18N.lang() === 'en' && item && GEO_EN[item.id]) ? GEO_EN[item.id] : (item ? item.name : '');

    function applyProfile(s, u) {
        s.userId = u.id; s.userType = u.user_type; s.name = u.name; s.phone = u.phone || null;
        s.shop = u.shop || null; s.lang = u.bot_lang || s.lang || 'ar';
        s.isAdmin = !!(u.is_super_admin || u.user_type === 'admin' || (u.admin_permissions && u.admin_permissions.length > 0));
        if (!s.geo && u.lat != null && u.lng != null) s.geo = { lat: Number(u.lat), lng: Number(u.lng) };
    }
    async function waRefresh(from) {
        const s = waSess(from);
        const u = await rpc('bot_get_user', { p_whatsapp_id: from });
        if (u) {
            applyProfile(s, u);
            if (ownsStore(s)) { const st = await rpc('bot_get_seller_stats', aid(from)); if (st) { s.pendingBookings = st.pending_bookings || 0; s.activeDeals = st.active_deals || 0; } }
        } else { s.userId = null; s.userType = null; s.isAdmin = false; }
        return s;
    }

    // ════════════════════════════════════════════════════════════════════════
    //  القائمة الرئيسية (role-aware)
    // ════════════════════════════════════════════════════════════════════════
    function mainMenu(from, s) {
        const linked = !!s.userId, seller = ownsStore(s);
        const langRow = row('wa:lang', tr('wa_row_lang'), tr('wa_row_lang_desc'));
        const browseSec = { title: trunc(tr('wa_sec_browse'), LIM.rowTitle), rows: [
            row('wa:browse', tr('menu_browse'), tr('wa_row_browse_desc')),
            row('wa:cats', tr('wa_row_cats'), tr('wa_row_cats_desc')),
            row('wa:near', tr('menu_nearby'), tr('wa_row_nearby_desc')),
            row('wa:search', tr('menu_search'), tr('wa_row_search_desc')),
        ] };
        const header = tr('wa_menu_title');
        let body, sections;
        if (!linked) {
            body = tr('wa_menu_body_guest');
            sections = [browseSec, { title: trunc(tr('wa_sec_account'), LIM.rowTitle), rows: [
                row('wa:contests', tr('menu_contests'), tr('wa_row_contests_desc')),
                row('wa:link', tr('menu_login_link'), tr('wa_row_link_desc')),
                langRow,
                row('wa:help', tr('menu_help'), tr('wa_row_help_desc')),
            ] }];
        } else if (seller) {
            body = s.isAdmin ? tr('wa_menu_body_admin', s.name) : tr('wa_menu_body_seller', s.shop || s.name);
            const o = []; const p = s.pendingBookings > 0 ? ` (${s.pendingBookings})` : '';
            o.push(row('wa:s:stats', tr('menu_seller_stats'), tr('wa_row_stats_desc')));
            o.push(row('wa:s:orders', tr('menu_seller_bookings') + p, tr('wa_row_orders_desc')));
            o.push(row('wa:s:verify', tr('menu_verify_booking'), tr('wa_row_verify_desc')));
            o.push(row('wa:s:deals', tr('menu_seller_deals'), tr('wa_row_deals_desc')));
            o.push(row('wa:s:add', tr('menu_add_deal'), tr('wa_row_add_desc')));
            o.push(row('wa:s:branches', tr('menu_my_locations'), tr('wa_row_branches_desc')));
            o.push(row('wa:s:hours', tr('menu_working_hours'), tr('wa_row_hours_desc')));
            o.push(row('wa:s:sub', tr('menu_subscription'), tr('wa_row_sub_desc')));
            sections = [
                { title: trunc(tr('wa_sec_store'), LIM.rowTitle), rows: o },
                { title: trunc(tr('wa_sec_account'), LIM.rowTitle), rows: [
                    row('wa:s:profile', tr('menu_store_account'), tr('wa_row_account_desc')),
                    langRow, row('wa:logout', tr('menu_logout'), tr('wa_row_logout_desc')),
                ] },
            ];
        } else {
            body = tr('wa_menu_body_buyer', s.name);
            sections = [browseSec, { title: trunc(tr('wa_sec_account'), LIM.rowTitle), rows: [
                row('wa:bookings', tr('menu_bookings_buyer'), tr('wa_row_bookings_desc')),
                row('wa:alerts', tr('menu_smart_alerts'), tr('wa_row_alerts_desc')),
                row('wa:follows', tr('menu_follows'), tr('wa_row_follows_desc')),
                row('wa:contests', tr('menu_contests'), tr('wa_row_contests_desc')),
                row('wa:account', tr('menu_account'), tr('wa_row_account_desc')),
                langRow, row('wa:logout', tr('menu_logout'), tr('wa_row_logout_desc')),
            ] }];
        }
        // الأدمن المالك: أضف إحصائيات المنصّة كصفّ أول.
        if (linked && s.isAdmin && sections[0]) sections[0].rows.unshift(row('wa:a:stats', tr('menu_platform_stats'), tr('wa_row_pstats_desc')));
        return sendList(from, { header, body, button: tr('wa_menu_btn'), sections });
    }

    // ── الربط / فكّ الربط / اللغة / الحساب / المساعدة ──────────────────────────
    async function doLink(from, s, token) {
        const r = await rpc('bot_consume_link_token', { p_token: token, p_whatsapp_id: from });
        if (r && r.success) {
            applyProfile(s, r); I18N.setLang(s.lang);
            if (ownsStore(s)) { const st = await rpc('bot_get_seller_stats', aid(from)); if (st) { s.pendingBookings = st.pending_bookings || 0; s.activeDeals = st.active_deals || 0; } }
            await sendText(from, tr('wa_link_success', s.name || ''));
            return mainMenu(from, s);
        }
        await sendText(from, tr('wa_link_invalid'));
        return mainMenu(from, s);
    }
    async function linkInstructions(from) { await sendText(from, tr('wa_not_linked_hint')); return sendText(from, tr('wa_open_site', APP_URL)); }
    async function logout(from, s) {
        await rpc('bot_unlink', { p_whatsapp_id: from });
        s.userId = null; s.userType = null; s.isAdmin = false; s.name = null; s.shop = null;
        s.phone = null; s.geo = null; s.temp = {}; s.step = 'idle'; s.pendingBookings = 0; s.activeDeals = 0;
        await sendText(from, tr('wa_logout_done'));
        return mainMenu(from, s);
    }
    async function toggleLang(from, s) {
        s.lang = (s.lang === 'en') ? 'ar' : 'en'; I18N.setLang(s.lang);
        if (s.userId) await rpc('bot_set_lang', { p_telegram_id: null, p_lang: s.lang, p_whatsapp_id: from });
        await sendText(from, tr('wa_lang_changed'));
        return mainMenu(from, s);
    }
    async function accountCard(from, s) {
        if (!s.userId) return linkInstructions(from);
        const role = s.isAdmin ? tr('wa_role_admin') : ownsStore(s) ? tr('wa_role_seller') : tr('wa_role_buyer');
        await sendButtons(from, { body: tr('wa_account_card', s.name || '—', s.phone || '—', role), buttons: [
            { id: 'wa:logout', title: tr('menu_logout') }, menuBtn(),
        ] });
    }
    async function help(from, s) { await sendButtons(from, { body: tr('wa_help_body'), buttons: [menuBtn()] }); }

    // ════════════════════════════════════════════════════════════════════════
    //  التصفّح / التصنيفات / تفاصيل العرض / حولي / المتجر
    // ════════════════════════════════════════════════════════════════════════
    function dealText(d, geo) {
        const L = [];
        L.push(`🏷 *${d.item_name}*`);
        L.push(tr('q2523_wa_shop_city', d.shop_name, (geoLabel({ id: d.city, name: d.city }) || d.city || d.region || '—')));
        L.push(tr('q2524_wa_price', d.discounted_price, d.original_price, d.discount_percentage));
        if (d.expiry_type === 'stock') L.push(d.is_unlimited ? tr('q2525_wa_available') : tr('q2525_wa_remaining', (d.quantity ?? 0)));
        else if (d.expiry_type === 'date' && d.expiry_date) L.push(tr('q2526_wa_valid_until', d.expiry_date));
        else { const r = remainingText(d); if (r) L.push(tr('q2527_wa_ends_in', r)); }
        if (geo && d.distance_km != null) L.push(tr('q2528_wa_distance', d.distance_km));
        if (d.prep_time) L.push(tr('q2529_wa_prep', prepLabel(d.prep_time)));
        const os = d.open_status;
        if (os && os.configured) L.push(HRS.statusText(os));
        if (d.description) L.push(tr('q2530_wa_description', String(d.description).slice(0, 400)));
        return L.join('\n');
    }
    async function browse(from, s, sort, cat, offset) {
        offset = offset || 0;
        const geo = (sort === 'nearby') ? s.geo : (s.geo || null);
        if (sort === 'nearby' && !geo) return askLocation(from);
        const deals = await rpc('bot_browse_deals', {
            p_sort: sort, p_category: (cat && cat !== 'all') ? cat : null,
            p_lat: geo ? geo.lat : null, p_lng: geo ? geo.lng : null,
            p_radius_km: null, p_limit: 9, p_offset: offset, p_open_now: true,
        }) || [];
        if (!deals.length) { if (offset > 0) return browseMenu(from, s); return sendButtons(from, { body: tr('wa_no_deals'), buttons: [{ id: 'wa:cats', title: tr('wa_row_cats') }, menuBtn()] }); }
        const rows = deals.slice(0, 9).map(d => row(`wa:deal:${d.id}`, String(d.item_name),
            `${d.discounted_price} ${cur()} • ${d.discount_percentage}%${geo && d.distance_km != null ? ` • ${d.distance_km}كم` : ''}`));
        if (deals.length >= 9) rows.push(row(`wa:more:${sort}:${cat || '-'}:${offset + 9}`, tr('wa_more_deals'), ''));
        rows.push(menuRow());
        const secTitle = (cat && cat !== 'all') ? catLabel(cat) : tr('sort_t_' + sort);
        return sendList(from, { header: tr('sort_t_' + sort), body: tr('wa_browse_body'), footer: 'TAKI', button: tr('wa_menu_btn'), sections: [{ title: trunc(secTitle, LIM.rowTitle), rows }] });
    }
    async function browseMenu(from, s) {
        await sendList(from, { header: tr('wa_menu_title'), body: tr('wa_browse_pick'), button: tr('wa_menu_btn'), sections: [{ rows: [
            row('wa:br:newest', tr('sort_t_newest'), ''),
            row('wa:br:popular', tr('sort_t_popular'), ''),
            row('wa:br:discount', tr('sort_t_discount'), ''),
            row('wa:near', tr('sort_t_nearby'), ''),
            row('wa:cats', tr('wa_row_cats'), ''),
            menuRow(),
        ] }] });
    }
    async function categories(from, s) {
        const geo = s.geo;
        const cats = await rpc('bot_get_categories', { p_lat: geo ? geo.lat : null, p_lng: geo ? geo.lng : null, p_radius_km: null }) || [];
        if (!cats.length) return sendButtons(from, { body: tr('wa_no_cats'), buttons: [menuBtn()] });
        const rows = cats.slice(0, 9).map(c => row(`wa:cat:${c.category}`, catLabel(c.category), tr('wa_deals_available', c.n)));
        rows.push(menuRow());
        return sendList(from, { header: tr('wa_cats_header'), body: tr('wa_cats_body'), button: tr('wa_menu_btn'), sections: [{ title: trunc(tr('wa_cats_section'), LIM.rowTitle), rows }] });
    }
    async function dealDetail(from, s, id) {
        const d = await rpc('bot_get_deal', { p_deal_id: id, p_telegram_id: null });
        if (!d) return sendButtons(from, { body: tr('wa_deal_gone'), buttons: [{ id: 'wa:browse', title: tr('menu_browse') }, menuBtn()] });
        s.temp.dealId = d.id; s.temp.dealName = d.item_name;
        const geo = s.geo;
        const img = (Array.isArray(d.images) && d.images.filter(Boolean)[0]) || d.image;
        if (img) await sendImage(from, img, dealText(d, geo));
        else await sendText(from, dealText(d, geo));
        const btns = [{ id: `wa:book:${d.id}`, title: tr('wa_book_now') }];
        if (d.store_id) btns.push({ id: `wa:store:${d.store_id}`, title: tr('wa_store_btn') });
        btns.push(menuBtn());
        await sendButtons(from, { body: `*${d.item_name}*`, buttons: btns });
        const dl = dirLink(d, geo);
        if (dl) await sendText(from, tr('wa_directions', dl));
    }
    async function storePage(from, s, storeId) {
        const st = await rpc('bot_get_store', aid(from, { p_store_id: storeId }));
        if (!st) return sendButtons(from, { body: tr('wa_store_not_found'), buttons: [menuBtn()] });
        const place = [st.city, st.region].filter(Boolean).join(' • ') || '—';
        let body = tr('wa_store_head', st.name, place, st.rating_avg || 0, st.rating_count || 0, st.active_deals || 0);
        if (st.bio) body += tr('wa_store_bio', String(st.bio).slice(0, 200));
        const btns = [];
        if (s.userId) btns.push({ id: `wa:fol:${storeId}`, title: st.following ? tr('wa_unfollow') : tr('wa_follow') });
        btns.push(menuBtn());
        await sendButtons(from, { body, buttons: btns });
        const deals = Array.isArray(st.deals) ? st.deals : [];
        if (deals.length) {
            const rows = deals.slice(0, 9).map(d => row(`wa:deal:${d.id}`, d.item_name, `${money(d.discounted_price)} ${cur()} • -${d.discount_percentage}%`));
            rows.push(menuRow());
            await sendList(from, { header: tr('wa_store_deals'), body: tr('wa_pick_deal'), button: tr('wa_menu_btn'), sections: [{ rows }] });
        }
    }
    async function toggleFollow(from, s, storeId) {
        if (!s.userId) return linkInstructions(from);
        const r = await rpc('bot_toggle_follow', aid(from, { p_store_id: storeId }));
        await sendText(from, (r && r.following) ? tr('wa_followed') : tr('wa_unfollowed'));
        return storePage(from, s, storeId);
    }
    function nearbyEntry(from, s) { return s.geo ? browse(from, s, 'nearby', null) : askLocation(from); }

    // ════════════════════════════════════════════════════════════════════════
    //  الحجز: عرض → كمية → استلام → ملاحظة → تأكيد → باركود
    // ════════════════════════════════════════════════════════════════════════
    async function startBook(from, s, id) {
        if (!s.userId) return sendButtons(from, { body: tr('wa_login_first'), buttons: [{ id: 'wa:link', title: tr('menu_login_link') }, menuBtn()] });
        if (id) { s.temp.dealId = id; const d = await rpc('bot_get_deal', { p_deal_id: id, p_telegram_id: null }); s.temp.dealName = d ? d.item_name : ''; }
        if (!s.temp.dealId) return sendText(from, tr('wa_session_ended'));
        s.step = 'idle';
        await sendList(from, { header: tr('wa_book_title'), body: tr('wa_ask_qty', s.temp.dealName || ''), button: tr('wa_menu_btn'), sections: [{ rows: [
            row('wa:bq:1', '1', ''), row('wa:bq:2', '2', ''), row('wa:bq:3', '3', ''),
            row('wa:bq:5', '5', ''), row('wa:bq:10', '10', ''),
            row('wa:bqc', tr('wa_qty_other'), ''),
            row(`wa:deal:${s.temp.dealId}`, tr('wa_back'), ''), menuRow(),
        ] }] });
    }
    async function setQty(from, s, q) { s.temp.dealQty = q; s.step = 'idle'; return askPrep(from, s); }
    async function askPrep(from, s) {
        s.step = 'idle';
        await sendList(from, { header: tr('wa_book_title'), body: tr('wa_ask_prep', s.temp.dealQty || 1), button: tr('wa_menu_btn'), sections: [{ rows: [
            row('wa:prep:arrival', tr('b1069_on_arrival'), ''),
            row('wa:prep:15', tr('wa_prep_min', 15), ''),
            row('wa:prep:30', tr('wa_prep_min', 30), ''),
            row('wa:prep:45', tr('wa_prep_min', 45), ''),
            row('wa:prep:60', tr('wa_prep_min', 60), ''),
            row('wa:prepc', tr('wa_prep_other'), ''),
            row('wa:bback:qty', tr('wa_back'), ''), menuRow(),
        ] }] });
    }
    async function setPrep(from, s, p) { s.temp.prepTime = p; return askNote(from, s); }
    async function askNote(from, s) {
        s.step = 'idle';
        await sendButtons(from, { body: tr('wa_ask_note'), buttons: [
            { id: 'wa:note:add', title: tr('wa_note_add') },
            { id: 'wa:note:skip', title: tr('wa_note_skip') },
            { id: 'wa:bback:prep', title: tr('wa_back') },
        ] });
    }
    async function bookConfirm(from, s) {
        s.step = 'idle';
        const d = await rpc('bot_get_deal', { p_deal_id: s.temp.dealId, p_telegram_id: null });
        if (!d) return sendButtons(from, { body: tr('wa_book_err_notfound'), buttons: [{ id: 'wa:browse', title: tr('menu_browse') }, menuBtn()] });
        const os = d.open_status;
        if (os && os.configured && !os.open) {
            const opens = os.opens_in_min != null ? tr('wa_book_err_opensin', HRS.fmtMins(os.opens_in_min)) : '';
            return sendButtons(from, { body: tr('wa_book_err_closed', opens), buttons: [{ id: 'wa:browse', title: tr('menu_browse') }, menuBtn()] });
        }
        const total = d.discounted_price * (s.temp.dealQty || 1);
        let m = tr('wa_confirm_head', DIV, d.item_name, d.shop_name, s.temp.dealQty || 1, prepLabel(s.temp.prepTime));
        if (s.temp.notes) m += tr('wa_confirm_note', s.temp.notes);
        m += tr('wa_confirm_total', money(total), cur(), DIV);
        if (os && os.configured && os.open && os.closes_in_min != null && os.closes_in_min <= HRS.CLOSING_SOON_MIN) m += tr('wa_confirm_closing', HRS.fmtMins(os.closes_in_min));
        m += tr('wa_confirm_disclaimer');
        await sendButtons(from, { body: m, buttons: [
            { id: 'wa:bookok', title: tr('wa_confirm_btn') },
            { id: 'wa:bback:note', title: tr('wa_back') },
            { id: 'wa:menu', title: tr('wa_cancel') },
        ] });
    }
    async function doBook(from, s) {
        if (!s.temp.dealId) return sendText(from, tr('wa_session_ended'));
        const r = await rpc('bot_book_deal', aid(from, { p_deal_id: s.temp.dealId, p_quantity: s.temp.dealQty || 1, p_notes: s.temp.notes || null, p_prep_time: s.temp.prepTime || 'arrival' }));
        const bc = r && r.barcode; const dealName = s.temp.dealName;
        s.temp.dealId = null; s.temp.dealQty = 1; s.temp.prepTime = null; s.temp.notes = null;
        if (!r || !r.success) {
            const e = r && r.error;
            const m = e === 'deal_inactive' ? tr('wa_book_err_inactive')
                : e === 'deal_not_found' ? tr('wa_book_err_notfound')
                : e === 'shop_closed' ? tr('wa_book_err_closed', r.opens_in_min != null ? tr('wa_book_err_opensin', HRS.fmtMins(r.opens_in_min)) : '')
                : e === 'no_quantity' ? tr('wa_book_err_noqty', r.available ?? 0)
                : e === 'not_linked' ? tr('wa_login_first')
                : e === 'suspended' ? tr('wa_book_err_suspended')
                : tr('wa_book_err_fail');
            return sendButtons(from, { body: m, buttons: [{ id: 'wa:browse', title: tr('menu_browse') }, menuBtn()] });
        }
        if (bc) botBookedBarcodes.add(bc);
        const expiry = r.expiry_at ? fmtDate(new Date(r.expiry_at)) : '—';
        await sendText(from, tr('wa_book_ok', DIV, r.deal_name || dealName, r.shop_name, r.quantity, prepLabel(r.prep_time), bc, expiry));
        await sendButtons(from, { body: tr('wa_pick'), buttons: [
            { id: `wa:chat:${bc}`, title: tr('wa_chat_btn') },
            { id: 'wa:bookings', title: tr('menu_bookings_buyer') },
            menuBtn(),
        ] });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  حجوزاتي (مشتري)
    // ════════════════════════════════════════════════════════════════════════
    async function buyerBookingsMenu(from, s) {
        if (!s.userId) return sendButtons(from, { body: tr('wa_login_first'), buttons: [{ id: 'wa:link', title: tr('menu_login_link') }, menuBtn()] });
        await sendButtons(from, { body: tr('wa_bookings_title'), buttons: [
            { id: 'wa:bk:cur', title: tr('wa_bk_current') },
            { id: 'wa:bk:prev', title: tr('wa_bk_previous') },
            menuBtn(),
        ] });
    }
    async function showBuyerBookings(from, s, scope) {
        const list0 = await rpc('bot_get_my_bookings', aid(from, { p_scope: scope })) || [];
        if (!list0.length) return sendButtons(from, { body: tr(scope === 'previous' ? 'wa_bk_none_prev' : 'wa_bk_none_cur'), buttons: [{ id: 'wa:bookings', title: tr('menu_bookings_buyer') }, menuBtn()] });
        s.temp.bkCache = {}; list0.forEach(b => { s.temp.bkCache[b.barcode] = b; });
        const rows = list0.slice(0, 9).map(b => row(`wa:bk1:${b.barcode}`, b.deal_name || b.barcode, tr('wa_bk_row', statusLabel(b.status), b.quantity, b.unread ? tr('wa_bk_unread', b.unread) : (b.shop_name || ''))));
        rows.push(menuRow());
        await sendList(from, { header: tr(scope === 'previous' ? 'wa_bk_previous' : 'wa_bk_current'), body: tr('wa_bk_pick'), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    function bkVal(s, bc) { return (s.temp.bkCache || {})[bc] || null; }
    async function bookingDetail(from, s, bc) {
        let b = bkVal(s, bc);
        if (!b) { const all = await rpc('bot_get_my_bookings', aid(from, { p_scope: 'all' })) || []; s.temp.bkCache = s.temp.bkCache || {}; all.forEach(x => { s.temp.bkCache[x.barcode] = x; }); b = bkVal(s, bc); }
        if (!b) return sendButtons(from, { body: tr('wa_session_ended'), buttons: [{ id: 'wa:bookings', title: tr('menu_bookings_buyer') }] });
        let extra = '';
        if (b.notes) extra += tr('wa_bk_note', b.notes);
        if (b.expiry_time) extra += tr('wa_bk_valid', fmtDate(new Date(Number(b.expiry_time))));
        const body = tr('wa_bk_detail', bc, DIV, b.deal_name, b.shop_name, b.quantity, prepLabel(b.prep_time), statusLabel(b.status), extra);
        const btns = [{ id: `wa:chat:${bc}`, title: tr('wa_chat_btn') }];
        if (b.status === 'pending') btns.push({ id: `wa:edit:${bc}`, title: tr('wa_bk_edit') });
        else if (b.status === 'completed') btns.push({ id: `wa:rate:${bc}`, title: tr('wa_bk_rate') });
        else btns.push({ id: 'wa:bookings', title: tr('wa_back') });
        await sendButtons(from, { body, buttons: btns.slice(0, 3) });
        const row2 = [];
        if (b.status === 'pending' || b.status === 'acknowledged') row2.push({ id: `wa:cancel:${bc}`, title: tr('wa_bk_cancel') });
        row2.push({ id: `wa:call:${bc}`, title: tr('wa_bk_call') });
        row2.push({ id: 'wa:bookings', title: tr('menu_bookings_buyer') });
        await sendButtons(from, { body: '—', buttons: row2.slice(0, 3) });
    }
    async function askCancel(from, s, bc) {
        await sendButtons(from, { body: tr('wa_cancel_confirm', bc), buttons: [
            { id: `wa:dcancel:${bc}`, title: tr('wa_cancel_yes') }, { id: `wa:bk1:${bc}`, title: tr('wa_back') },
        ] });
    }
    async function doCancel(from, s, bc) {
        const r = await rpc('bot_cancel_booking', aid(from, { p_barcode: bc }));
        await sendText(from, (r && r.success) ? tr('wa_cancel_ok') : tr('wa_cancel_fail'));
        return buyerBookingsMenu(from, s);
    }

    // ── محادثة الحجز (٣+٣) — مشترك مشتري/تاجر ──
    async function showChat(from, s, bc) {
        const r = await rpc('bot_booking_chat', aid(from, { p_barcode: bc }));
        if (!r || !r.success) return sendButtons(from, { body: tr('wa_session_ended'), buttons: [{ id: ownsStore(s) ? 'wa:s:orders' : 'wa:bookings', title: tr('wa_row_menu') }] });
        let body = tr('wa_chat_head', bc, r.deal_name, r.other_name, r.my_count, r.other_count);
        const msgs = Array.isArray(r.messages) ? r.messages : [];
        if (!msgs.length) body += tr('wa_chat_empty');
        else body += '\n\n' + msgs.slice(-8).map(m => m.mine ? tr('wa_chat_me', m.body) : tr('wa_chat_them', m.body)).join('\n');
        const btns = [];
        if (r.my_count < 3 && r.status !== 'cancelled') btns.push({ id: `wa:cmsg:${bc}`, title: tr('wa_chat_send') });
        btns.push({ id: ownsStore(s) ? `wa:so1:${bc}` : `wa:bk1:${bc}`, title: tr('wa_back') });
        btns.push(menuBtn());
        await sendButtons(from, { body, buttons: btns.slice(0, 3) });
    }
    async function promptChat(from, s, bc) { s.temp.chatBarcode = bc; s.step = 'await_chat_msg'; await sendText(from, tr('wa_chat_prompt')); }
    async function sendChat(from, s, body) {
        const bc = s.temp.chatBarcode; s.step = 'idle';
        const r = await rpc('bot_send_booking_message', aid(from, { p_barcode: bc, p_body: body }));
        if (r && r.success) { await sendText(from, tr('wa_chat_sent', r.my_count)); return showChat(from, s, bc); }
        const e = r && r.error;
        await sendText(from, e === 'cap_reached' ? tr('wa_chat_cap') : e === 'cancelled' ? tr('wa_chat_cancelled') : tr('wa_chat_fail'));
        return showChat(from, s, bc);
    }

    // ── تعديل الحجز ──
    async function editBooking(from, s, bc) {
        await sendButtons(from, { body: tr('wa_edit_pick'), buttons: [
            { id: `wa:eqty:${bc}`, title: tr('wa_edit_qty') }, { id: `wa:enote:${bc}`, title: tr('wa_edit_note') }, { id: `wa:bk1:${bc}`, title: tr('wa_back') },
        ] });
    }
    async function promptEditQty(from, s, bc) { const v = bkVal(s, bc); s.temp.editBarcode = bc; s.step = 'await_edit_qty'; await sendText(from, tr('wa_edit_qty_prompt', v ? v.quantity : '—')); }
    async function promptEditNote(from, s, bc) { const v = bkVal(s, bc); s.temp.editBarcode = bc; s.step = 'await_edit_note'; await sendText(from, tr('wa_edit_note_prompt', (v && v.notes) ? v.notes : '—')); }
    async function afterEdit(from, s, r) {
        if (r && r.success) { await sendText(from, tr('wa_edit_ok')); s.temp.bkCache = {}; return bookingDetail(from, s, s.temp.editBarcode); }
        await sendText(from, tr('wa_edit_fail'));
    }

    // ── تقييم ──
    async function startRate(from, s, bc) {
        s.temp.rateBarcode = bc;
        await sendButtons(from, { body: tr('wa_rate_prompt'), buttons: [
            { id: `wa:rst:${bc}:5`, title: '⭐⭐⭐⭐⭐' }, { id: `wa:rst:${bc}:4`, title: '⭐⭐⭐⭐' }, { id: `wa:rst:${bc}:3`, title: '⭐⭐⭐' },
        ] });
        await sendButtons(from, { body: '—', buttons: [
            { id: `wa:rst:${bc}:2`, title: '⭐⭐' }, { id: `wa:rst:${bc}:1`, title: '⭐' }, { id: `wa:bk1:${bc}`, title: tr('wa_back') },
        ] });
    }
    async function setRate(from, s, bc, score) {
        s.temp.rateBarcode = bc; s.temp.rateScore = score; s.step = 'await_rate_comment';
        await sendButtons(from, { body: tr('wa_rate_comment_q'), buttons: [{ id: 'wa:rskip', title: tr('wa_rate_skip') }] });
    }
    async function submitRate(from, s, comment) {
        s.step = 'idle';
        const r = await rpc('bot_rate_store', aid(from, { p_barcode: s.temp.rateBarcode, p_score: s.temp.rateScore, p_comment: comment || null }));
        if (r && r.success) return sendButtons(from, { body: tr('wa_rate_ok', '⭐'.repeat(r.score || 0)), buttons: [{ id: 'wa:bookings', title: tr('menu_bookings_buyer') }, menuBtn()] });
        await sendText(from, tr('wa_rate_fail'));
    }
    async function bookingContact(from, s, bc) {
        const r = await rpc('bot_booking_contact', aid(from, { p_barcode: bc }));
        if (r && r.success && r.phone) return sendButtons(from, { body: tr('wa_contact_phone', r.name || '', r.phone), buttons: [{ id: `wa:bk1:${bc}`, title: tr('wa_back') }] });
        await sendButtons(from, { body: tr('wa_contact_none'), buttons: [{ id: `wa:bk1:${bc}`, title: tr('wa_back') }] });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  بحث / متابَعات
    // ════════════════════════════════════════════════════════════════════════
    async function startSearch(from, s) { s.step = 'await_search'; await sendText(from, tr('wa_search_prompt')); }
    async function runSearch(from, s, q) {
        s.step = 'idle';
        const res = await rpc('bot_search', { p_query: q, p_limit: 9 }) || [];
        if (!res.length) return sendButtons(from, { body: tr('wa_search_none', q), buttons: [{ id: 'wa:search', title: tr('menu_search') }, menuBtn()] });
        const rows = res.slice(0, 9).map(x => (x.kind === 'store')
            ? row(`wa:store:${x.id}`, `🏬 ${x.name || x.item_name || ''}`, x.subtitle || '')
            : row(`wa:deal:${x.id}`, x.item_name || x.name || '', x.discounted_price != null ? `${money(x.discounted_price)} ${cur()}` : (x.subtitle || '')));
        rows.push(menuRow());
        await sendList(from, { header: '🔎', body: tr('wa_search_results', q), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function showFollowing(from, s) {
        if (!s.userId) return linkInstructions(from);
        const r = await rpc('bot_list_followed', aid(from));
        const merchants = (r && r.merchants) || [];
        if (!merchants.length) return sendButtons(from, { body: tr('wa_follows_none'), buttons: [{ id: 'wa:browse', title: tr('menu_browse') }, menuBtn()] });
        const rows = merchants.slice(0, 9).map(m => row(`wa:store:${m.store_id}`, m.name, tr('wa_follow_row', m.rating_avg || 0, m.rating_count || 0, m.active_deals || 0)));
        rows.push(menuRow());
        await sendList(from, { header: tr('menu_follows'), body: tr('wa_follows_title'), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  تنبيهات (كلمات + ذكية)
    // ════════════════════════════════════════════════════════════════════════
    async function showAlerts(from, s) {
        if (!s.userId) return linkInstructions(from);
        const r = await rpc('bot_get_alerts', aid(from));
        if (!r || !r.success) return sendButtons(from, { body: tr('wa_err'), buttons: [menuBtn()] });
        const on = !!r.notify_via_whatsapp;
        const kwc = Array.isArray(r.keywords) ? r.keywords.length : 0;
        await sendButtons(from, { body: tr('wa_alerts_title', on ? tr('wa_alerts_on') : tr('wa_alerts_off'), kwc, r.smart_count || 0), buttons: [
            { id: 'wa:alkw', title: tr('wa_alerts_kw') }, { id: 'wa:alsmart', title: tr('wa_alerts_smart') },
            { id: on ? 'wa:altog:0' : 'wa:altog:1', title: on ? tr('wa_alerts_off_btn') : tr('wa_alerts_on_btn') },
        ] });
        await sendButtons(from, { body: '—', buttons: [menuBtn()] });
    }
    async function toggleAlerts(from, s, on) { await rpc('bot_set_telegram_notif', aid(from, { p_enabled: on })); return showAlerts(from, s); }
    async function showKeywords(from, s) {
        const r = await rpc('bot_get_alerts', aid(from));
        const kws = (r && Array.isArray(r.keywords)) ? r.keywords : [];
        let body = tr('wa_kw_title'); if (!kws.length) body += tr('wa_kw_none');
        const rows = [row('wa:kwadd', tr('wa_kw_add'), '')];
        kws.slice(0, 7).forEach((k, i) => rows.push(row(`wa:kwrm:${i}`, tr('wa_kw_rm', k), '')));
        rows.push(row('wa:alerts', tr('wa_back'), ''), menuRow());
        await sendList(from, { header: tr('wa_alerts_kw'), body, button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function promptKeyword(from, s) { s.step = 'await_kw'; await sendText(from, tr('wa_kw_add_prompt')); }
    async function addKeyword(from, s, kw) {
        s.step = 'idle';
        const r = await rpc('bot_add_notif_keyword', aid(from, { p_keyword: kw }));
        const e = r && r.error;
        await sendText(from, (r && r.success) ? tr('wa_kw_added') : e === 'exists' ? tr('wa_kw_exists') : e === 'too_many' ? tr('wa_kw_toomany') : tr('wa_kw_badlen'));
        return showKeywords(from, s);
    }
    async function removeKeyword(from, s, idx) { await rpc('bot_remove_notif_keyword', aid(from, { p_index: idx })); await sendText(from, tr('wa_kw_removed')); return showKeywords(from, s); }

    function smartDraft(s) { return s.temp.smart || (s.temp.smart = { categories: [], regions: [], cities: [], malls: [], keywords: [], labels: [] }); }
    function smartSummary(s) { const d = smartDraft(s); const p = [...d.labels]; if (d.keywords.length) p.push('🔤 ' + d.keywords.join(', ')); return p.length ? p.join('\n') : tr('wa_smart_none_crit'); }
    async function showSmartAlerts(from, s) {
        const r = await rpc('bot_get_smart_alerts', aid(from));
        const alerts = (r && Array.isArray(r.alerts)) ? r.alerts : [];
        let body = tr('wa_smart_title'); if (!alerts.length) body += tr('wa_smart_none');
        const rows = [row('wa:smnew', tr('wa_smart_new'), '')];
        alerts.slice(0, 6).forEach((a, i) => rows.push(row(`wa:smrm:${i}`, tr('wa_smart_rm', i + 1), '')));
        rows.push(row('wa:alerts', tr('wa_back'), ''), menuRow());
        await sendList(from, { header: tr('wa_alerts_smart'), body, button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function smartNew(from, s) { s.temp.smart = null; smartDraft(s); return smartBuilder(from, s); }
    async function smartBuilder(from, s) {
        s.step = 'idle';
        await sendButtons(from, { body: tr('wa_smart_build', smartSummary(s)), buttons: [
            { id: 'wa:smcat', title: tr('wa_smart_add_cat') }, { id: 'wa:smrg', title: tr('wa_smart_add_rg') }, { id: 'wa:smkw', title: tr('wa_smart_add_kw') },
        ] });
        await sendButtons(from, { body: '—', buttons: [
            { id: 'wa:smsave', title: tr('wa_smart_save') }, { id: 'wa:smclear', title: tr('wa_smart_clear') }, { id: 'wa:alerts', title: tr('wa_back') },
        ] });
    }
    async function smartAddCat(from, s) {
        const rows = Object.keys(CAT).filter(k => k !== 'all').slice(0, 9).map(k => row(`wa:smpc:${k}`, catLabel(k), ''));
        rows.push(row('wa:smbuild', tr('wa_back'), ''));
        await sendList(from, { header: tr('wa_smart_add_cat'), body: tr('wa_pick_category'), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function smartPickCat(from, s, cat) { const d = smartDraft(s); if (!d.categories.includes(cat)) { d.categories.push(cat); d.labels.push('🗂 ' + catLabel(cat)); } return smartBuilder(from, s); }
    async function smartAddRegion(from, s) {
        const regions = await rpc('bot_geo_regions', {}) || []; s.temp.smRegions = regions;
        const rows = regions.slice(0, 9).map(r => row(`wa:smpr:${r.id}`, geoLabel(r), ''));
        rows.push(row('wa:smbuild', tr('wa_back'), ''));
        await sendList(from, { header: tr('wa_smart_add_rg'), body: tr('wa_pick_region'), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function smartPickRegion(from, s, id) { const d = smartDraft(s); const r = (s.temp.smRegions || []).find(x => x.id === id); if (!d.regions.includes(id)) { d.regions.push(id); d.labels.push('🗺 ' + (r ? geoLabel(r) : id)); } return smartBuilder(from, s); }
    async function smartPromptKw(from, s) { s.step = 'await_smart_kw'; await sendText(from, tr('wa_smart_kw_prompt')); }
    async function smartAddKw(from, s, kw) { s.step = 'idle'; const d = smartDraft(s); const k = String(kw).trim().slice(0, 40); if (k && !d.keywords.includes(k)) d.keywords.push(k); return smartBuilder(from, s); }
    async function smartSave(from, s) {
        const d = smartDraft(s);
        const has = d.categories.length || d.regions.length || d.cities.length || d.malls.length || d.keywords.length;
        if (!has) { await sendText(from, tr('wa_smart_empty')); return smartBuilder(from, s); }
        const r = await rpc('bot_add_smart_alert', aid(from, { p_rule: { categories: d.categories, regions: d.regions, cities: d.cities, malls: d.malls, keywords: d.keywords } }));
        s.temp.smart = null;
        if (r && r.success) { await sendText(from, tr('wa_smart_saved')); return showSmartAlerts(from, s); }
        await sendText(from, (r && r.error === 'too_many') ? tr('wa_smart_toomany') : tr('wa_smart_empty'));
        return showSmartAlerts(from, s);
    }
    async function smartClear(from, s) { s.temp.smart = null; smartDraft(s); return smartBuilder(from, s); }
    async function smartRemove(from, s, idx) { await rpc('bot_remove_smart_alert', aid(from, { p_index: idx })); await sendText(from, tr('wa_smart_removed')); return showSmartAlerts(from, s); }

    // ════════════════════════════════════════════════════════════════════════
    //  مسابقات
    // ════════════════════════════════════════════════════════════════════════
    async function showContests(from, s) {
        const list0 = await rpc('bot_list_contests', aid(from)) || [];
        if (!list0.length) return sendButtons(from, { body: tr('wa_contests_none'), buttons: [menuBtn()] });
        s.temp.contests = list0;
        const rows = list0.slice(0, 9).map(c => row(`wa:ct:${c.id}`, c.title, c.entered ? tr('wa_contest_entered') : (c.prize || '')));
        rows.push(menuRow());
        await sendList(from, { header: tr('menu_contests'), body: tr('wa_contests_title'), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function openContest(from, s, id) {
        const c = await rpc('bot_get_contest', aid(from, { p_contest_id: id }));
        if (!c) return sendButtons(from, { body: tr('wa_contests_none'), buttons: [{ id: 'wa:contests', title: tr('menu_contests') }] });
        s.temp.contest = c;
        let body = `🎁 *${c.title}*\n${c.description || ''}`;
        if (c.prize) body += tr('wa_contest_prize', c.prize);
        if (c.entered) return sendButtons(from, { body: body + '\n\n' + tr('wa_contest_done'), buttons: [{ id: 'wa:contests', title: tr('menu_contests') }] });
        if (!c.has_phone) return sendButtons(from, { body: body + '\n\n' + tr('wa_contest_need_link'), buttons: [{ id: 'wa:link', title: tr('menu_login_link') }, { id: 'wa:contests', title: tr('menu_contests') }] });
        const btns = [];
        if (c.live) btns.push({ id: `wa:ctgo:${id}`, title: tr('wa_contest_enter') });
        btns.push({ id: 'wa:contests', title: tr('menu_contests') });
        await sendButtons(from, { body, buttons: btns });
    }
    async function startQuiz(from, s, id) {
        const c = (s.temp.contest && s.temp.contest.id === id) ? s.temp.contest : await rpc('bot_get_contest', aid(from, { p_contest_id: id }));
        if (!c) return showContests(from, s);
        s.temp.contest = c; s.temp.quizIdx = 0; s.temp.quizAns = {};
        return askQuiz(from, s);
    }
    async function askQuiz(from, s) {
        const c = s.temp.contest; const qs = Array.isArray(c.questions) ? c.questions : [];
        if (s.temp.quizIdx >= qs.length) return submitContest(from, s);
        const q = qs[s.temp.quizIdx]; const opts = Array.isArray(q.options) ? q.options : [];
        if (!opts.length) { s.temp.quizIdx++; return askQuiz(from, s); }
        s.temp.quizOpts = opts;
        const rows = opts.slice(0, 9).map((o, i) => row(`wa:cq:${i}`, String(o), ''));
        rows.push(row('wa:contests', tr('wa_cancel'), ''));
        await sendList(from, { header: '🎁', body: tr('wa_contest_q', s.temp.quizIdx + 1, qs.length, q.text || q.question || ''), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function answerQuiz(from, s, optIdx) {
        const c = s.temp.contest; const qs = c.questions || []; const q = qs[s.temp.quizIdx]; const opt = (s.temp.quizOpts || [])[optIdx];
        if (q && opt != null) s.temp.quizAns[q.id] = opt;
        s.temp.quizIdx++; return askQuiz(from, s);
    }
    async function submitContest(from, s) {
        const c = s.temp.contest;
        const r = await rpc('bot_submit_contest_entry', aid(from, { p_contest_id: c.id, p_answers: s.temp.quizAns || {}, p_social: {} }));
        s.temp.contest = null;
        if (r && r.success) return sendButtons(from, { body: tr(r.qualified ? 'wa_contest_win' : 'wa_contest_lose', r.score, r.max_score), buttons: [{ id: 'wa:contests', title: tr('menu_contests') }, menuBtn()] });
        await sendButtons(from, { body: tr('wa_contest_fail'), buttons: [{ id: 'wa:contests', title: tr('menu_contests') }] });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  التاجر — إحصائيات / طلبات / تحقّق
    // ════════════════════════════════════════════════════════════════════════
    function sellerGate(from, s) { if (!ownsStore(s)) { sendButtons(from, { body: tr('wa_sellers_only'), buttons: [menuBtn()] }); return false; } return true; }
    async function sellerStats(from, s) {
        if (!sellerGate(from, s)) return;
        const st = await rpc('bot_get_seller_stats', aid(from));
        if (!st) return sendButtons(from, { body: tr('wa_err'), buttons: [menuBtn()] });
        await sendButtons(from, { body: tr('wa_s_stats', st.shop || s.shop || '', DIV, st.total_bookings || 0, st.today_bookings || 0, st.pending_bookings || 0, st.active_deals || 0, money(st.total_revenue || 0), cur()), buttons: [
            { id: 'wa:s:orders', title: tr('menu_seller_bookings') }, menuBtn(),
        ] });
    }
    async function adminStats(from, s) {
        if (!s.isAdmin) return mainMenu(from, s);
        const st = await rpc('bot_get_admin_stats', aid(from));
        if (!st || !st.success) return sendButtons(from, { body: tr('wa_err'), buttons: [menuBtn()] });
        await sendButtons(from, { body: tr('wa_a_stats', DIV, st.total_users || 0, st.merchants || 0, st.buyers || 0, st.active_deals || 0, st.total_bookings || 0, st.today_bookings || 0, st.pending_reports || 0), buttons: [menuBtn()] });
    }
    async function sellerOrdersMenu(from, s) {
        if (!sellerGate(from, s)) return;
        await sendButtons(from, { body: tr('wa_s_orders_title'), buttons: [
            { id: 'wa:so:cur', title: tr('wa_bk_current') }, { id: 'wa:so:prev', title: tr('wa_bk_previous') }, menuBtn(),
        ] });
    }
    async function showSellerOrders(from, s, scope) {
        if (!sellerGate(from, s)) return;
        const list0 = await rpc('bot_get_seller_bookings', aid(from, { p_scope: scope })) || [];
        if (!list0.length) return sendButtons(from, { body: tr(scope === 'previous' ? 'wa_so_none_prev' : 'wa_so_none_cur'), buttons: [{ id: 'wa:s:orders', title: tr('menu_seller_bookings') }, menuBtn()] });
        s.temp.soCache = {}; list0.forEach(b => { s.temp.soCache[b.barcode] = b; });
        const rows = list0.slice(0, 9).map(b => row(`wa:so1:${b.barcode}`, b.deal_name || b.barcode, tr('wa_so_row', statusLabel(b.status), b.user_name || '—', b.quantity)));
        rows.push(menuRow());
        await sendList(from, { header: tr(scope === 'previous' ? 'wa_bk_previous' : 'wa_bk_current'), body: tr('wa_so_pick'), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    function soVal(s, bc) { return (s.temp.soCache || {})[bc] || null; }
    async function sellerOrderDetail(from, s, bc) {
        let b = soVal(s, bc);
        if (!b) { const all = await rpc('bot_get_seller_bookings', aid(from, { p_scope: 'all' })) || []; s.temp.soCache = s.temp.soCache || {}; all.forEach(x => { s.temp.soCache[x.barcode] = x; }); b = soVal(s, bc); }
        if (!b) return sendButtons(from, { body: tr('wa_session_ended'), buttons: [{ id: 'wa:s:orders', title: tr('menu_seller_bookings') }] });
        const extra = b.notes ? tr('wa_bk_note', b.notes) : '';
        const body = tr('wa_so_detail', bc, b.deal_name, b.user_name || '—', b.user_phone || '—', b.quantity, prepLabel(b.prep_time), statusLabel(b.status), extra);
        const btns = [];
        if (b.status === 'pending') btns.push({ id: `wa:ack:${bc}`, title: tr('wa_ack') });
        if (b.status === 'pending' || b.status === 'acknowledged') btns.push({ id: `wa:done:${bc}`, title: tr('wa_complete') });
        btns.push({ id: `wa:chat:${bc}`, title: tr('wa_chat_btn') });
        await sendButtons(from, { body, buttons: btns.slice(0, 3) });
        await sendButtons(from, { body: '—', buttons: [{ id: `wa:call:${bc}`, title: tr('wa_bk_call') }, { id: 'wa:s:orders', title: tr('menu_seller_bookings') }] });
    }
    async function ackOrder(from, s, bc) {
        const r = await rpc('bot_acknowledge_booking', aid(from, { p_barcode: bc }));
        if (r && r.success) { await sendText(from, tr('wa_ack_ok', r.user_name || '—')); s.temp.soCache = {}; if (s.pendingBookings > 0) s.pendingBookings--; }
        else await sendText(from, tr('wa_ack_fail'));
        return sellerOrderDetail(from, s, bc);
    }
    async function completeOrder(from, s, bc, msg) {
        const r = await rpc('bot_complete_booking', aid(from, { p_barcode: bc, p_message: msg || null }));
        if (r && r.success) { await sendButtons(from, { body: tr('wa_complete_ok', r.user_name || '—', r.quantity), buttons: [{ id: 'wa:s:orders', title: tr('menu_seller_bookings') }, menuBtn()] }); s.temp.soCache = {}; }
        else await sendText(from, tr('wa_complete_fail'));
    }
    async function startVerify(from, s) { if (!sellerGate(from, s)) return; s.step = 'await_barcode'; await sendText(from, tr('wa_verify_title')); }
    async function doVerify(from, s, code) {
        s.step = 'idle';
        const r = await rpc('bot_verify_booking', aid(from, { p_barcode: String(code).toUpperCase() }));
        if (!r || !r.success) return sendButtons(from, { body: tr('wa_verify_notfound'), buttons: [{ id: 'wa:s:verify', title: tr('menu_verify_booking') }, menuBtn()] });
        s.temp.soCache = s.temp.soCache || {}; s.temp.soCache[r.barcode] = { barcode: r.barcode, deal_name: r.deal_name, user_name: r.user_name, user_phone: r.user_phone, quantity: r.quantity, status: r.status, notes: r.notes, prep_time: '' };
        await sendButtons(from, { body: tr('wa_verify_res', r.barcode, r.deal_name, r.user_name || '—', r.user_phone || '—', r.quantity, statusLabel(r.status)), buttons: [
            ...(r.status === 'pending' || r.status === 'acknowledged' ? [{ id: `wa:done:${r.barcode}`, title: tr('wa_complete') }] : []),
            { id: `wa:so1:${r.barcode}`, title: tr('wa_order_details') }, menuBtn(),
        ].slice(0, 3) });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  التاجر — عروضي (قائمة + بطاقة + إيقاف/تفعيل/حذف)
    // ════════════════════════════════════════════════════════════════════════
    async function sellerDealsMenu(from, s) {
        if (!sellerGate(from, s)) return;
        await sendButtons(from, { body: tr('wa_s_deals_title'), buttons: [
            { id: 'wa:sd:active', title: tr('wa_s_deals_active') }, { id: 'wa:sd:ended', title: tr('wa_s_deals_ended') }, { id: 'wa:s:add', title: tr('menu_add_deal') },
        ] });
        await sendButtons(from, { body: '—', buttons: [menuBtn()] });
    }
    async function showSellerDeals(from, s, scope) {
        if (!sellerGate(from, s)) return;
        const all = await rpc('bot_get_seller_deals', aid(from)) || [];
        const list0 = all.filter(d => scope === 'ended' ? d.status !== 'active' : d.status === 'active');
        if (!list0.length) return sendButtons(from, { body: tr('wa_s_deals_none'), buttons: [{ id: 'wa:s:add', title: tr('menu_add_deal') }, { id: 'wa:s:deals', title: tr('wa_back') }, menuBtn()] });
        s.temp.sdCache = {}; list0.forEach(d => { s.temp.sdCache[d.id] = d; });
        const rows = list0.slice(0, 9).map(d => row(`wa:sd1:${d.id}`, d.item_name, tr('wa_s_deal_row', statusLabel(d.status), money(d.discounted_price), cur(), d.is_unlimited ? tr('wa_unlimited') : tr('wa_pcs', d.quantity ?? 0))));
        rows.push(menuRow());
        await sendList(from, { header: scope === 'ended' ? tr('wa_s_deals_ended') : tr('wa_s_deals_active'), body: tr('wa_s_deals_pick'), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    function sdVal(s, id) { return (s.temp.sdCache || {})[id] || null; }
    async function sellerDealDetail(from, s, id) {
        let d = sdVal(s, id);
        if (!d) d = await rpc('bot_get_seller_deal', aid(from, { p_deal_id: id }));
        if (!d) return sendButtons(from, { body: tr('wa_session_ended'), buttons: [{ id: 'wa:s:deals', title: tr('menu_seller_deals') }] });
        s.temp.sdCache = s.temp.sdCache || {}; s.temp.sdCache[id] = d;
        const qty = d.is_unlimited ? tr('wa_unlimited') : tr('wa_pcs', d.quantity ?? 0);
        const desc = d.description ? tr('wa_desc_line', String(d.description).slice(0, 200)) : '';
        const body = tr('wa_s_deal_detail', d.item_name, statusLabel(d.status), priceBlock(d.original_price, d.discounted_price, d.discount_percentage), qty, catLabel(d.category), desc);
        const isActive = d.status === 'active';
        await sendButtons(from, { body, buttons: [
            { id: `wa:ded:menu:${id}`, title: tr('wa_s_deal_edit') },
            { id: isActive ? `wa:tgl:${id}:paused` : `wa:tgl:${id}:active`, title: isActive ? tr('wa_s_deal_pause') : tr('wa_s_deal_activate') },
            { id: `wa:del:${id}`, title: tr('wa_s_deal_delete') },
        ] });
        await sendButtons(from, { body: '—', buttons: [{ id: 'wa:s:deals', title: tr('menu_seller_deals') }, menuBtn()] });
    }
    async function toggleDeal(from, s, id, status) {
        const r = await rpc('bot_toggle_deal', aid(from, { p_deal_id: id, p_status: status }));
        await sendText(from, (r && r.success) ? (status === 'active' ? tr('wa_s_deal_activated') : tr('wa_s_deal_paused')) : tr('wa_edit_fail'));
        s.temp.sdCache = {};
        return sellerDealDetail(from, s, id);
    }
    async function askDeleteDeal(from, s, id) {
        await sendButtons(from, { body: tr('wa_s_deal_del_confirm'), buttons: [{ id: `wa:delok:${id}`, title: tr('wa_s_deal_del_yes') }, { id: `wa:sd1:${id}`, title: tr('wa_back') }] });
    }
    async function doDeleteDeal(from, s, id) {
        const r = await rpc('bot_delete_deal', aid(from, { p_deal_id: id }));
        if (r && r.success) await sendButtons(from, { body: tr('wa_s_deal_deleted'), buttons: [{ id: 'wa:s:deals', title: tr('menu_seller_deals') }, menuBtn()] });
        else await sendText(from, r && r.error === 'has_bookings' ? tr('wa_s_deal_del_hasbk', r.count) : tr('wa_edit_fail'));
    }

    // ── تعديل عرض ──
    async function editDealMenu(from, s, id) {
        const d = sdVal(s, id) || await rpc('bot_get_seller_deal', aid(from, { p_deal_id: id }));
        if (!d) return sendButtons(from, { body: tr('wa_session_ended'), buttons: [{ id: 'wa:s:deals', title: tr('menu_seller_deals') }] });
        s.temp.sdCache = s.temp.sdCache || {}; s.temp.sdCache[id] = d; s.temp.editDealId = id;
        await sendList(from, { header: tr('wa_ed_title', d.item_name), body: tr('wa_ed_pick'), button: tr('wa_menu_btn'), sections: [{ rows: [
            row(`wa:ded:name:${id}`, tr('wa_ed_name'), ''),
            row(`wa:ded:price:${id}`, tr('wa_ed_price'), ''),
            row(`wa:ded:qty:${id}`, tr('wa_ed_qty'), ''),
            row(`wa:ded:desc:${id}`, tr('wa_ed_desc'), ''),
            row(`wa:ded:cat:${id}`, tr('wa_ed_cat'), ''),
            row(`wa:ded:photos:${id}`, tr('wa_ed_photos'), ''),
            row(`wa:sd1:${id}`, tr('wa_back'), ''), menuRow(),
        ] }] });
    }
    async function editDealField(from, s, field, id) {
        s.temp.editDealId = id; s.temp.flow = 'edit';
        const d = sdVal(s, id) || await rpc('bot_get_seller_deal', aid(from, { p_deal_id: id }));
        if (!d) return sendButtons(from, { body: tr('wa_session_ended'), buttons: [{ id: 'wa:s:deals', title: tr('menu_seller_deals') }] });
        s.temp.sdCache = s.temp.sdCache || {}; s.temp.sdCache[id] = d;
        if (field === 'name')  { s.step = 'ed_name'; return sendText(from, tr('wa_ed_name_prompt', d.item_name || '—')); }
        if (field === 'price') { s.step = 'ed_orig'; return sendText(from, tr('wa_ed_orig_prompt', money(d.original_price), money(d.discounted_price))); }
        if (field === 'desc')  { s.step = 'ed_desc'; return sendText(from, tr('wa_ed_desc_prompt')); }
        if (field === 'qty')   { s.temp.flow = 'edit'; s.temp.edraft = { expiryType: d.expiry_type }; return askQtyStep(from, s); }
        if (field === 'cat')   { const rows = Object.keys(CAT).filter(k => k !== 'all').slice(0, 9).map(k => row(`wa:edcat:${k}`, catLabel(k), '')); rows.push(row(`wa:sd1:${id}`, tr('wa_back'), '')); return sendList(from, { header: tr('wa_ed_cat'), body: tr('wa_pick_category'), button: tr('wa_menu_btn'), sections: [{ rows }] }); }
        if (field === 'photos') { s.temp.flow = 'edit'; s.temp.photos = []; return askPhotos(from, s); }
    }
    async function editCat(from, s, cat) { const r = await rpc('bot_update_deal', aid(from, { p_deal_id: s.temp.editDealId, p_category: cat })); return afterDealEdit(from, s, r); }
    async function afterDealEdit(from, s, r) {
        const id = s.temp.editDealId;
        if (!r || !r.success) { await sendText(from, r && r.error === 'invalid_price' ? tr('wa_invalid_price') : tr('wa_edit_fail')); return editDealMenu(from, s, id); }
        s.temp.sdCache = {}; await sendText(from, tr('wa_ed_saved')); return editDealMenu(from, s, id);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  التاجر — إضافة عرض (معالج كامل)
    // ════════════════════════════════════════════════════════════════════════
    function addVal(s) { return s.temp.add || (s.temp.add = { images: [] }); }
    async function startAdd(from, s) {
        if (!sellerGate(from, s)) return;
        s.temp = {}; s.temp.flow = 'add'; s.temp.add = { images: [] };
        await sendText(from, tr('wa_add_start'));
        s.step = 'ad_name';
        await sendText(from, tr('wa_add_name'));
    }
    async function askCategory(from, s) {
        s.step = 'idle';
        const rows = Object.keys(CAT).filter(k => k !== 'all').slice(0, 9).map(k => row(`wa:adcat:${k}`, catLabel(k), ''));
        rows.push(row('wa:adcancel', tr('wa_cancel'), ''));
        await sendList(from, { header: '2/10', body: tr('wa_add_category'), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function askGender(from, s) {
        s.step = 'idle';
        await sendButtons(from, { header: '3/10', body: tr('wa_add_gender'), buttons: [{ id: 'wa:adgen:all', title: genderLabel('all') }, { id: 'wa:adgen:men', title: genderLabel('men') }, { id: 'wa:adgen:women', title: genderLabel('women') }] });
        await sendButtons(from, { body: '—', buttons: [{ id: 'wa:adgen:kids', title: genderLabel('kids') }, { id: 'wa:adcancel', title: tr('wa_cancel') }] });
    }
    async function askSize(from, s) {
        s.step = 'idle';
        await sendButtons(from, { header: '4/10', body: tr('wa_add_size'), buttons: [{ id: 'wa:adsz:S', title: 'S' }, { id: 'wa:adsz:M', title: 'M' }, { id: 'wa:adsz:L', title: 'L' }] });
        await sendButtons(from, { body: '—', buttons: [{ id: 'wa:adszo', title: tr('wa_add_size_other') }, { id: 'wa:adszn', title: tr('wa_add_size_none') }] });
    }
    async function askDesc(from, s) {
        s.step = 'ad_desc';
        await sendButtons(from, { header: '5/10', body: tr('wa_add_desc'), buttons: [{ id: 'wa:adskipdesc', title: tr('wa_add_desc_skip') }, { id: 'wa:adcancel', title: tr('wa_cancel') }] });
    }
    async function askPrice(from, s) { s.step = 'ad_orig'; await sendText(from, tr('wa_add_orig')); }
    async function askExpiry(from, s) {
        s.step = 'idle';
        await sendButtons(from, { header: '8/10', body: tr('wa_add_expiry'), buttons: [{ id: 'wa:adexp:stock', title: tr('wa_exp_stock') }, { id: 'wa:adexp:hours', title: tr('wa_exp_hours') }, { id: 'wa:adexp:duration', title: tr('wa_exp_days') }] });
        await sendButtons(from, { body: '—', buttons: [{ id: 'wa:adexp:date', title: tr('wa_exp_date') }, { id: 'wa:adcancel', title: tr('wa_cancel') }] });
    }
    function expTarget(s) { return s.temp.flow === 'edit' ? (s.temp.edraft || (s.temp.edraft = {})) : addVal(s); }
    async function pickExpiry(from, s, type) {
        const t0 = expTarget(s); t0.expiryType = type;
        if (type === 'stock') { t0.expiryHours = null; t0.expiryDays = null; t0.expiryEndMs = null; t0.expiryDateIso = null; return onExpiryChosen(from, s); }
        if (type === 'hours') { s.step = 'ad_hours'; return sendText(from, tr('wa_exp_hours_prompt')); }
        if (type === 'duration') { s.step = 'ad_days'; return sendText(from, tr('wa_exp_days_prompt')); }
        s.step = 'ad_date'; return sendText(from, tr('wa_exp_date_prompt'));
    }
    async function onExpiryChosen(from, s) { if (s.temp.flow === 'edit') return saveEditExpiry(from, s); return askQtyStep(from, s); }
    async function askQtyStep(from, s) {
        s.step = 'idle';
        const t0 = expTarget(s); const stock = t0 && t0.expiryType === 'stock';
        const rows = [row('wa:adqty:5', '5', ''), row('wa:adqty:10', '10', ''), row('wa:adqty:20', '20', ''), row('wa:adqty:50', '50', ''), row('wa:adqty:custom', tr('wa_add_qty_custom'), '')];
        if (!stock) rows.unshift(row('wa:adqty:unlimited', tr('wa_add_qty_unlimited'), ''));
        rows.push(row('wa:adcancel', tr('wa_cancel'), ''));
        await sendList(from, { header: '9/10', body: tr('wa_add_qty'), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function pickQty(from, s, key) {
        const t0 = expTarget(s);
        if (key === 'custom') { s.step = 'ad_qty'; return sendText(from, tr('wa_add_qty_prompt')); }
        if (key === 'unlimited') { t0.unlimited = true; t0.qty = null; } else { t0.unlimited = false; t0.qty = +key; }
        return onQtyChosen(from, s);
    }
    async function onQtyChosen(from, s) { if (s.temp.flow === 'edit') return saveEditQty(from, s); return askLocation(from, s); }
    async function saveEditExpiry(from, s) {
        const t0 = s.temp.edraft || {}; const id = s.temp.editDealId; const d = sdVal(s, id) || {};
        const anchor = (d.starts_at && Number(d.starts_at) > Date.now()) ? Number(d.starts_at) : Date.now();
        const ex = computeExpiry(t0.expiryType, t0, anchor);
        const r = await rpc('bot_update_deal', aid(from, { p_deal_id: id, p_expiry_type: t0.expiryType, p_expiry_date: ex.expiry_date, p_expires_in_minutes: ex.minutes }));
        return afterDealEdit(from, s, r);
    }
    async function saveEditQty(from, s) {
        const t0 = s.temp.edraft || {};
        const r = await rpc('bot_update_deal', aid(from, { p_deal_id: s.temp.editDealId, p_quantity: t0.unlimited ? 0 : (t0.qty || 0), p_is_unlimited: !!t0.unlimited }));
        return afterDealEdit(from, s, r);
    }
    function computeExpiry(type, a, anchorMs) {
        if (type === 'hours') return { minutes: Math.max(1, (a.expiryHours || 0) * 60), expiry_date: null };
        if (type === 'duration') return { minutes: Math.max(1, (a.expiryDays || 0) * 1440), expiry_date: null };
        if (type === 'date') return { minutes: Math.max(1, Math.floor(((a.expiryEndMs || 0) - anchorMs) / 60000)), expiry_date: a.expiryDateIso || null };
        return { minutes: YEAR_MIN, expiry_date: null };
    }

    // ── موقع العرض (مشترك add/edit/branch) ──
    function locReq(s) { return s; }
    async function askLocationStep(from, s, intro) {
        s.step = 'idle';
        const r = await rpc('bot_list_branches', aid(from));
        const chips = (r && r.branches) || []; s.temp.locChips = chips;
        const full = r && r.used >= r.max;
        const gateNew = full && s.temp.flow !== 'branch';
        const pickable = chips.map((b, i) => ({ b, i })).filter(x => !gateNew || x.b.locked);
        const rows = [];
        pickable.slice(0, 6).forEach(({ b, i }) => rows.push(row(`wa:lsaved:${i}`, `📍 ${b.name || tr('cm_location')}${b.locked ? ' 🔒' : ''}`, [b.city, b.region].filter(Boolean).join(' • '))));
        if (!gateNew) {
            rows.push(row('wa:lregion', tr('wa_loc_region'), ''));
            rows.push(row('wa:llink', tr('wa_loc_link'), ''));
            rows.push(row('wa:lshare', tr('wa_loc_share'), ''));
        } else {
            rows.push(row('wa:s:sub', tr('wa_loc_upgrade'), ''));
        }
        const back = s.temp.flow === 'branch' ? 'wa:s:branches' : s.temp.flow === 'edit' ? `wa:sd1:${s.temp.editDealId}` : 'wa:adcancel';
        rows.push(row(back, tr('wa_back'), ''));
        const head = intro || (gateNew ? tr('wa_loc_full') : tr('wa_add_loc'));
        await sendList(from, { header: s.temp.flow === 'branch' ? tr('menu_my_locations') : '🔟', body: head, button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function pickSavedLoc(from, s, i) {
        const b = (s.temp.locChips || [])[i];
        if (!b) return askLocationStep(from, s);
        return onLocationChosen(from, s, { location_id: b.location_id || null, custom_location_name: b.name || null, map_lat: b.map_lat ?? null, map_lng: b.map_lng ?? null, region: b.region || null, city: b.city || null, google: b.google_maps_link || null, name: b.name }, false);
    }
    async function pickRegion(from, s) {
        const regions = await rpc('bot_geo_regions', {}) || []; s.temp.lRegions = regions;
        const rows = regions.slice(0, 9).map(r => row(`wa:lrg:${r.id}`, geoLabel(r), '')); rows.push(row('wa:lmenu', tr('wa_back'), ''));
        await sendList(from, { header: tr('wa_loc_region'), body: tr('wa_pick_region'), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function pickCity(from, s, regionId) {
        s.temp.lRegion = regionId;
        const cities = await rpc('bot_geo_cities', { p_region: regionId }) || []; s.temp.lCities = cities;
        if (!cities.length) return sendButtons(from, { body: tr('wa_no_locations_here'), buttons: [{ id: 'wa:lregion', title: tr('wa_back') }] });
        const rows = cities.slice(0, 9).map(c => row(`wa:lct:${c.id}`, geoLabel(c), '')); rows.push(row('wa:lregion', tr('wa_back'), ''));
        await sendList(from, { header: tr('wa_pick_city'), body: tr('wa_pick_city'), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function pickType(from, s, cityId) {
        s.temp.lCity = cityId; s.temp.lCityObj = (s.temp.lCities || []).find(x => x.id === cityId) || null;
        await sendButtons(from, { body: tr('wa_pick_loctype'), buttons: [{ id: 'wa:ltp:mall', title: tr('wa_loc_mall') }, { id: 'wa:ltp:market', title: tr('wa_loc_market') }, { id: `wa:lrg:${s.temp.lRegion}`, title: tr('wa_back') }] });
    }
    async function pickLocList(from, s, type) {
        const locs = await rpc('bot_geo_locations', { p_city: s.temp.lCity, p_type: type }) || [];
        if (!locs.length) return sendButtons(from, { body: tr('wa_no_locations_here'), buttons: [{ id: 'wa:llink', title: tr('wa_loc_link') }, { id: 'wa:lshare', title: tr('wa_loc_share') }, { id: `wa:lct:${s.temp.lCity}`, title: tr('wa_back') }] });
        s.temp.lLocs = locs;
        const rows = locs.slice(0, 9).map((l, i) => row(`wa:llc:${i}`, `📍 ${l.name}`, '')); rows.push(row(`wa:lct:${s.temp.lCity}`, tr('wa_back'), ''));
        await sendList(from, { header: type === 'mall' ? tr('wa_loc_mall') : tr('wa_loc_market'), body: tr('wa_pick_mall'), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function pickMapLoc(from, s, i) {
        const l = (s.temp.lLocs || [])[i]; if (!l) return askLocationStep(from, s);
        const c = s.temp.lCityObj;
        return onLocationChosen(from, s, { location_id: l.id, custom_location_name: l.name, map_lat: l.lat, map_lng: l.lng, region: s.temp.lRegion || (c && c.regionId) || null, city: s.temp.lCity || null, google: null, name: l.name }, true);
    }
    async function askLink(from, s) { s.step = 'loc_link'; await sendText(from, tr('wa_loc_link_prompt')); }
    async function onLocationChosen(from, s, loc, isNew) {
        if (s.temp.flow === 'branch') {
            const name = s.temp.branchMove ? null : (s.temp.branchName || loc.name || loc.custom_location_name || tr('cm_location'));
            const r = await rpc('bot_save_branch', aid(from, { p_branch_id: s.temp.branchId || null, p_name: name, p_region: loc.region || null, p_city: loc.city || null, p_location_id: loc.location_id || null, p_map_lat: loc.map_lat ?? null, p_map_lng: loc.map_lng ?? null, p_google_maps_link: loc.google || null }));
            await sendText(from, (r && r.success) ? tr('wa_branch_saved') : tr('wa_edit_fail'));
            return showBranches(from, s);
        }
        if (s.temp.flow === 'edit') {
            const id = s.temp.editDealId;
            const r = await rpc('bot_set_deal_location', aid(from, { p_deal_id: id, p_location_id: loc.location_id || null, p_custom_location_name: loc.custom_location_name || loc.name || null, p_map_lat: loc.map_lat ?? null, p_map_lng: loc.map_lng ?? null, p_region: loc.region || null, p_city: loc.city || null, p_google_maps_link: loc.google || null }));
            await sendText(from, (r && r.success) ? tr('wa_loc_set') : tr('wa_edit_fail'));
            return editDealMenu(from, s, id);
        }
        addVal(s).loc = loc;
        await sendText(from, tr('wa_loc_set'));
        return askPhotos(from, s);
    }

    // ── الصور ──
    async function askPhotos(from, s) {
        s.temp.photos = s.temp.photos || [];
        s.step = s.temp.flow === 'edit' ? 'ed_photo' : 'ad_photo';
        await sendButtons(from, { body: tr('wa_add_photos'), buttons: [{ id: 'wa:adcancel', title: tr('wa_cancel') }] });
    }
    async function onPhoto(from, s, imageMsg) {
        if (s.step !== 'ad_photo' && s.step !== 'ed_photo') return false;
        s.temp.photos = s.temp.photos || [];
        if (s.temp.photos.length >= MAX_IMAGES) { await sendButtons(from, { body: tr('wa_photo_max', MAX_IMAGES), buttons: [{ id: 'wa:adphdone', title: tr('wa_photos_done', s.temp.photos.length) }] }); return true; }
        const mediaId = imageMsg && imageMsg.id;
        if (!mediaId) { await sendText(from, tr('wa_photo_fail')); return true; }
        await sendText(from, tr('wa_photo_uploading'));
        const url = await uploadWaPhoto(mediaId);
        if (url) { s.temp.photos.push(url); await sendButtons(from, { body: tr('wa_photo_added', s.temp.photos.length, MAX_IMAGES), buttons: [{ id: 'wa:adphdone', title: tr('wa_photos_done', s.temp.photos.length) }] }); }
        else await sendButtons(from, { body: tr('wa_photo_fail'), buttons: [{ id: 'wa:adphdone', title: tr('wa_photos_done', s.temp.photos.length) }, { id: 'wa:adcancel', title: tr('wa_cancel') }] });
        return true;
    }
    async function onPhotosDone(from, s) {
        const imgs = s.temp.photos || [];
        if (!imgs.length) { await sendText(from, tr('wa_photo_need_one')); return askPhotos(from, s); }
        if (s.temp.flow === 'edit') {
            const id = s.temp.editDealId;
            const r = await rpc('bot_update_deal', aid(from, { p_deal_id: id, p_images: imgs }));
            return afterDealEdit(from, s, r);
        }
        addVal(s).images = imgs;
        return goReview(from, s);
    }
    function expirySummary(s, a) {
        if (a.expiryType === 'stock') return tr('wa_exp_sum_stock');
        if (a.expiryType === 'hours') return tr('wa_exp_sum_hours', a.expiryHours);
        if (a.expiryType === 'duration') return tr('wa_exp_sum_days', a.expiryDays);
        if (a.expiryType === 'date') return tr('wa_exp_sum_date', fmtDay(a.expiryEndMs));
        return '—';
    }
    async function goReview(from, s) {
        const a = s.temp.add; if (!a) return;
        s.step = 'idle';
        const pct = Math.round(((a.orig - a.disc) / a.orig) * 100);
        const qty = a.unlimited ? tr('wa_unlimited') : String(a.qty);
        const loc = a.loc ? (a.loc.name || a.loc.custom_location_name || a.loc.city || tr('wa_custom_location')) : tr('wa_none');
        const size = a.size ? tr('wa_review_size', a.size) : '';
        const desc = a.desc ? tr('wa_review_desc', a.desc) : '';
        await sendButtons(from, { body: tr('wa_review_title', DIV, a.name, catLabel(a.category), genderLabel(a.gender), size, priceBlock(a.orig, a.disc, pct), expirySummary(s, a), qty, loc, a.images.length, desc), buttons: [
            { id: 'wa:adpub', title: tr('wa_publish') }, { id: 'wa:adcancel', title: tr('wa_cancel') },
        ] });
    }
    async function doPublish(from, s) {
        const a = s.temp.add;
        if (!a || !a.name) { await sendText(from, tr('wa_session_ended')); return sellerDealsMenu(from, s); }
        if (!a.images || !a.images.length) { return askPhotos(from, s); }
        const anchor = a.startsAt || Date.now();
        if (a.expiryType === 'date' && a.expiryEndMs && a.expiryEndMs <= anchor) { await sendText(from, tr('wa_exp_bad_date')); return askExpiry(from, s); }
        const ex = computeExpiry(a.expiryType, a, anchor);
        const r = await rpc('bot_add_deal', aid(from, {
            p_item_name: a.name, p_original_price: a.orig, p_discounted_price: a.disc,
            p_quantity: a.unlimited ? 0 : (a.qty || 0), p_description: a.desc || '', p_category: a.category || 'other',
            p_images: a.images || [], p_location_id: a.loc && a.loc.location_id || null, p_custom_location_name: a.loc && (a.loc.custom_location_name || a.loc.name) || null,
            p_map_lat: a.loc && a.loc.map_lat != null ? a.loc.map_lat : null, p_map_lng: a.loc && a.loc.map_lng != null ? a.loc.map_lng : null,
            p_region: a.loc && a.loc.region || null, p_city: a.loc && a.loc.city || null, p_google_maps_link: a.loc && a.loc.google || null,
            p_size: a.size || null, p_gender: a.gender || 'all', p_expiry_type: a.expiryType, p_expiry_date: ex.expiry_date,
            p_expires_in_minutes: ex.minutes, p_starts_at: a.startsAt || null, p_is_unlimited: !!a.unlimited,
        }));
        s.step = 'idle'; const ok = r && r.success; s.temp = {};
        if (!ok) {
            const overCap = r && r.error === 'blocked' && /LOCATION_LIMIT/i.test(String(r.detail || ''));
            const m = r && r.error === 'invalid_price' ? tr('wa_publish_invalid_price') : overCap ? tr('wa_publish_overcap') : tr('wa_publish_fail');
            return sendButtons(from, { body: m, buttons: [{ id: 'wa:s:branches', title: tr('menu_my_locations') }, { id: 'wa:s:sub', title: tr('menu_subscription') }, menuBtn()] });
        }
        await sendButtons(from, { body: tr('wa_publish_ok', r.discount), buttons: [{ id: 'wa:s:deals', title: tr('menu_seller_deals') }, { id: 'wa:s:add', title: tr('wa_add_another') }, menuBtn()] });
        // اقترح ساعات العمل أول مرة فقط
        try { const hr = await rpc('bot_get_store_hours', aid(from)); const wh = hr && hr.working_hours; if (!(wh && wh.enabled && wh.days)) await sendButtons(from, { body: tr('wa_add_hours_prompt'), buttons: [{ id: 'wa:s:hours', title: tr('menu_working_hours') }, menuBtn()] }); } catch (e) { /* ignore */ }
    }

    // ════════════════════════════════════════════════════════════════════════
    //  التاجر — مواقعي (الفروع)
    // ════════════════════════════════════════════════════════════════════════
    async function showBranches(from, s) {
        if (!sellerGate(from, s)) return;
        s.temp.flow = 'branch';
        const r = await rpc('bot_list_branches', aid(from));
        if (!r || !r.success) return sendButtons(from, { body: tr('wa_err'), buttons: [menuBtn()] });
        const branches = r.branches || []; s.temp.locChips = branches;
        let body = tr('wa_branches_title', r.max, r.used);
        if (!branches.length) body += tr('wa_branches_none');
        const rows = [row('wa:bradd', tr('wa_branch_add'), '')];
        branches.slice(0, 7).forEach((b, i) => {
            const where = [b.city, b.region].filter(Boolean).join(' • ') || tr('wa_custom_location');
            const tag = b.locked ? ' 🔒' : '';
            if (b.kind === 'deal') rows.push(row(`wa:brsave:${i}`, `📍 ${b.name || tr('cm_location')}${tag}`, where));
            else rows.push(row(`wa:brdel:${b.id}`, `🗑 ${b.name || tr('cm_location')}${tag}`, where));
        });
        rows.push(menuRow());
        await sendList(from, { header: tr('menu_my_locations'), body, button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function branchAdd(from, s) { s.temp = {}; s.temp.flow = 'branch'; s.temp.branchId = null; s.step = 'br_name'; await sendText(from, tr('wa_branch_name_prompt')); }
    async function branchDelAsk(from, s, id) { await sendButtons(from, { body: tr('wa_branch_del_confirm'), buttons: [{ id: `wa:brdelok:${id}`, title: tr('wa_s_deal_del_yes') }, { id: 'wa:s:branches', title: tr('wa_back') }] }); }
    async function branchDel(from, s, id) {
        const r = await rpc('bot_remove_branch', aid(from, { p_branch_id: id }));
        await sendText(from, (r && r.success) ? tr('wa_branch_deleted') : (r && r.error === 'locked') ? tr('wa_branch_locked') : tr('wa_edit_fail'));
        return showBranches(from, s);
    }
    async function branchSaveDeal(from, s, i) {
        const chip = (s.temp.locChips || [])[i];
        if (!chip) return showBranches(from, s);
        const r = await rpc('bot_save_branch', aid(from, { p_name: chip.name || tr('cm_location'), p_region: chip.region || null, p_city: chip.city || null, p_location_id: chip.location_id || null, p_map_lat: chip.map_lat ?? null, p_map_lng: chip.map_lng ?? null, p_google_maps_link: chip.google_maps_link || null }));
        await sendText(from, (r && r.success) ? tr('wa_branch_saved') : tr('wa_edit_fail'));
        return showBranches(from, s);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  التاجر — ساعات العمل / الاشتراك / نبذة المتجر
    // ════════════════════════════════════════════════════════════════════════
    async function showHours(from, s) {
        if (!sellerGate(from, s)) return;
        const r = await rpc('bot_get_store_hours', aid(from));
        const wh = r && r.working_hours;
        const summary = (wh && wh.enabled && wh.days) ? HRS.weekLines(wh).join('\n') : tr('wa_hours_none');
        await sendButtons(from, { body: tr('wa_hours_title', summary), buttons: [{ id: 'wa:hall', title: tr('wa_hours_set_all') }, { id: 'wa:hoff', title: tr('wa_hours_off') }, menuBtn()] });
    }
    async function promptHoursAll(from, s) { s.step = 'await_hours_all'; await sendText(from, tr('wa_hours_all_prompt')); }
    function parseHours(text) {
        // يقبل "09:00-23:00" أو "09:00-12:00,16:00-23:00"
        const shifts = [];
        for (const part of String(text).split(/[,،]/)) {
            const m = part.trim().match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
            if (!m) return null;
            const h1 = +m[1], m1 = +m[2], h2 = +m[3], m2 = +m[4];
            if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
            shifts.push([`${String(h1).padStart(2, '0')}:${m[2]}`, `${String(h2).padStart(2, '0')}:${m[4]}`]);
        }
        return shifts.length ? shifts : null;
    }
    async function saveHoursAll(from, s, text) {
        const shifts = parseHours(text);
        if (!shifts) { await sendText(from, tr('wa_hours_bad')); return; }
        s.step = 'idle';
        const days = {}; for (let d = 0; d < 7; d++) days[String(d)] = shifts;
        const r = await rpc('bot_set_store_hours', aid(from, { p_hours: { enabled: true, days } }));
        await sendText(from, (r && r.success) ? tr('wa_hours_saved') : tr('wa_edit_fail'));
        return showHours(from, s);
    }
    async function disableHours(from, s) {
        await rpc('bot_set_store_hours', aid(from, { p_hours: { enabled: false, days: {} } }));
        await sendText(from, tr('wa_hours_disabled'));
        return showHours(from, s);
    }
    async function showSubscription(from, s) {
        if (!sellerGate(from, s)) return;
        const sub = await rpc('bot_get_subscription', aid(from));
        if (!sub || !sub.success) return sendButtons(from, { body: tr('wa_err'), buttons: [menuBtn()] });
        const exp = sub.expires_at ? tr('wa_sub_expires', fmtDay(sub.expires_at)) : '';
        await sendButtons(from, { body: tr('wa_sub_title', sub.plan || 'free', sub.max_branches || 1, sub.active ? tr('wa_sub_active') : tr('wa_sub_inactive'), exp), buttons: [{ id: 'wa:subpk', title: tr('wa_sub_packages') }, menuBtn()] });
    }
    async function showPackages(from, s) {
        const list0 = await rpc('bot_list_packages', {}) || [];
        if (!list0.length) return sendButtons(from, { body: tr('wa_sub_no_packages'), buttons: [{ id: 'wa:s:sub', title: tr('menu_subscription') }, menuBtn()] });
        s.temp.pkgs = list0;
        const en = I18N.lang() === 'en';
        const rows = list0.slice(0, 9).map(p => {
            const price = Math.round((p.price || 0) * (1 - (p.discount || 0) / 100));
            return row(`wa:subgo:${p.id}`, (en ? (p.en || p.ar) : p.ar) || `#${p.id}`, tr('wa_sub_pkg_row', p.max, price, cur()));
        });
        rows.push(row('wa:s:sub', tr('wa_back'), ''), menuRow());
        await sendList(from, { header: tr('wa_sub_packages'), body: tr('wa_sub_pick'), button: tr('wa_menu_btn'), sections: [{ rows }] });
    }
    async function subscribe(from, s, pkgId) {
        const r = await rpc('bot_subscribe_plan', aid(from, { p_package_id: +pkgId }));
        if (r && r.success) return sendButtons(from, { body: tr('wa_sub_ok', r.max_branches), buttons: [{ id: 'wa:s:sub', title: tr('menu_subscription') }, menuBtn()] });
        await sendButtons(from, { body: tr('wa_sub_fail'), buttons: [{ id: 'wa:s:sub', title: tr('menu_subscription') }] });
    }
    async function showStoreProfile(from, s) {
        if (!sellerGate(from, s)) return;
        const st = await rpc('bot_get_store', aid(from, { p_store_id: s.userId }));
        const bio = (st && st.bio) ? String(st.bio).slice(0, 300) : tr('wa_none');
        await sendButtons(from, { body: tr('wa_profile_title', (st && st.name) || s.shop || s.name || '', (st && st.rating_avg) || 0, (st && st.rating_count) || 0, bio), buttons: [{ id: 'wa:bio', title: tr('wa_profile_edit_bio') }, { id: `wa:store:${s.userId}`, title: tr('wa_store_btn') }, menuBtn()] });
    }
    async function promptBio(from, s) { s.step = 'await_bio'; await sendText(from, tr('wa_bio_prompt')); }
    async function saveBio(from, s, text) {
        s.step = 'idle';
        const r = await rpc('bot_update_store_bio', aid(from, { p_bio: text.slice(0, 500) }));
        await sendText(from, (r && r.success) ? tr('wa_bio_saved') : tr('wa_edit_fail'));
        return showStoreProfile(from, s);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  معالج النصّ (آلة الحالة)
    // ════════════════════════════════════════════════════════════════════════
    async function onText(from, s, raw) {
        const text = sanitize(raw, 500);
        const low = text.toLowerCase();
        // إلغاء عام
        if (low === 'cancel' || text === 'إلغاء' || text === 'الغاء') { s.step = 'idle'; s.temp = {}; await sendText(from, tr('wa_cancelled')); return mainMenu(from, s); }
        // ربط
        const linkMatch = text.match(/link_([A-Za-z0-9]+)/i);
        if (linkMatch) return doLink(from, s, linkMatch[1]);
        // قائمة
        if (/^(menu|قائمة|القائمة|البداية|ابدأ|ابدا|start|hi|hello|مرحبا|السلام|اهلا|أهلا)/.test(low)) return mainMenu(from, s);

        // خطوات نصّية حسب الحالة
        switch (s.step) {
            // مشتري
            case 'await_book_qty': { if (!isQty(text) || numOf(text) < 1) { await sendText(from, tr('wa_qty_bad')); return; } return setQty(from, s, numOf(text)); }
            case 'await_prep': { if (!isQty(text) || numOf(text) < 0) { await sendText(from, tr('wa_prep_bad')); return; } return setPrep(from, s, `${numOf(text)}min`); }
            case 'await_note': { s.temp.notes = text.slice(0, 300); return bookConfirm(from, s); }
            case 'await_search': return runSearch(from, s, text.slice(0, 60));
            case 'await_chat_msg': return sendChat(from, s, text.slice(0, 500));
            case 'await_edit_qty': { if (!isQty(text)) { await sendText(from, tr('wa_qty_bad')); return; } const r = await rpc('bot_update_booking', aid(from, { p_barcode: s.temp.editBarcode, p_quantity: numOf(text) })); return afterEdit(from, s, r); }
            case 'await_edit_note': { const r = await rpc('bot_update_booking', aid(from, { p_barcode: s.temp.editBarcode, p_notes: text.slice(0, 300) })); return afterEdit(from, s, r); }
            case 'await_rate_comment': return submitRate(from, s, text.slice(0, 400));
            case 'await_kw': return addKeyword(from, s, text.slice(0, 40));
            case 'await_smart_kw': return smartAddKw(from, s, text);
            // تاجر — تحقّق/إتمام
            case 'await_barcode': return doVerify(from, s, text.trim());
            case 'await_complete_msg': { const bc = s.temp.completeBarcode; s.step = 'idle'; return completeOrder(from, s, bc, text.slice(0, 300)); }
            case 'await_bio': return saveBio(from, s, text);
            case 'await_hours_all': return saveHoursAll(from, s, text);
            // تاجر — إضافة عرض
            case 'ad_name': { if (text.length < 3) { await sendText(from, tr('wa_add_name_short')); return; } addVal(s).name = text.slice(0, 120); return askCategory(from, s); }
            case 'ad_desc': { addVal(s).desc = text.slice(0, 500); return askPrice(from, s); }
            case 'ad_orig': { if (!isPrice(text)) { await sendText(from, tr('wa_add_price_bad')); return; } addVal(s).orig = numOf(text); s.step = 'ad_disc'; return sendText(from, tr('wa_add_disc')); }
            case 'ad_disc': { if (!isPrice(text) || numOf(text) >= addVal(s).orig) { await sendText(from, tr('wa_add_disc_bad', addVal(s).orig)); return; } addVal(s).disc = numOf(text); return askExpiry(from, s); }
            case 'ad_hours': { const n = numOf(text); if (!isQty(text) || n < 1 || n > 8760) { await sendText(from, tr('wa_exp_bad_hours')); return; } expTarget(s).expiryHours = n; return onExpiryChosen(from, s); }
            case 'ad_days': { const n = numOf(text); if (!isQty(text) || n < 1 || n > 365) { await sendText(from, tr('wa_exp_bad_days')); return; } expTarget(s).expiryDays = n; return onExpiryChosen(from, s); }
            case 'ad_date': { const dt = parseFlexibleDate(text); const tt = expTarget(s); const anchor = tt.startsAt && tt.startsAt > Date.now() ? tt.startsAt : Date.now(); if (!dt || dt.ms <= anchor) { await sendText(from, tr('wa_exp_bad_date')); return; } tt.expiryEndMs = dt.ms; tt.expiryDateIso = dt.iso; return onExpiryChosen(from, s); }
            case 'ad_qty': { if (!isQty(text)) { await sendText(from, tr('wa_add_qty_bad')); return; } const tq = expTarget(s); tq.qty = numOf(text); tq.unlimited = false; return onQtyChosen(from, s); }
            case 'loc_link': { const g = await resolveGoogleLocation(text); if (!g) { await sendText(from, tr('wa_loc_bad')); return; } return onLocationChosen(from, s, { location_id: null, custom_location_name: null, map_lat: g.lat, map_lng: g.lng, region: null, city: null, google: /^https?:\/\//i.test(text.trim()) ? text.trim() : null, name: tr('wa_custom_location') }, true); }
            // تاجر — فروع
            case 'br_name': { if (text.length < 2) { await sendText(from, tr('wa_branch_name_prompt')); return; } s.temp.branchName = text.slice(0, 60); return askLocationStep(from, s, tr('wa_branch_loc_for', text.slice(0, 60))); }
            // تاجر — تعديل عرض
            case 'ed_name': { if (text.length < 3) { await sendText(from, tr('wa_add_name_short')); return; } const r = await rpc('bot_update_deal', aid(from, { p_deal_id: s.temp.editDealId, p_item_name: text.slice(0, 120) })); return afterDealEdit(from, s, r); }
            case 'ed_orig': { if (!isPrice(text)) { await sendText(from, tr('wa_add_price_bad')); return; } s.temp.edOrig = numOf(text); s.step = 'ed_disc'; return sendText(from, tr('wa_ed_disc_prompt')); }
            case 'ed_disc': { if (!isPrice(text) || numOf(text) >= s.temp.edOrig) { await sendText(from, tr('wa_add_disc_bad', s.temp.edOrig)); return; } const r = await rpc('bot_update_deal', aid(from, { p_deal_id: s.temp.editDealId, p_original_price: s.temp.edOrig, p_discounted_price: numOf(text) })); return afterDealEdit(from, s, r); }
            case 'ed_desc': { const r = await rpc('bot_update_deal', aid(from, { p_deal_id: s.temp.editDealId, p_description: text.slice(0, 500) })); return afterDealEdit(from, s, r); }
            default: break;
        }

        // كلمات سريعة / افتراضي
        if (['deal', 'عرض', 'عروض', 'تخفيض', 'خصم'].some(k => low.includes(k))) return browse(from, s, 'newest', null);
        if (['تصنيف', 'صنف', 'فئة', 'category', 'categories'].some(k => low.includes(k))) return categories(from, s);
        if (['حول', 'قرب', 'أقرب', 'اقرب', 'near', 'location'].some(k => low.includes(k))) return nearbyEntry(from, s);
        if (['بحث', 'search'].some(k => low.includes(k))) return startSearch(from, s);
        if (['help', 'مساعد', 'مساعدة', '؟', '?'].some(k => low.includes(k))) return help(from, s);
        return mainMenu(from, s);
    }

    // ════════════════════════════════════════════════════════════════════════
    //  معالج الأزرار/القوائم
    // ════════════════════════════════════════════════════════════════════════
    async function onInteractive(from, s, ir) {
        const id = (ir.button_reply && ir.button_reply.id) || (ir.list_reply && ir.list_reply.id) || '';
        if (!id) return mainMenu(from, s);
        const p = id.split(':');   // p[0]==='wa'
        const k = p[1];
        // قائمة / تنقّل عام
        if (id === 'wa:menu' || id === 'm') return mainMenu(from, s);
        if (id === 'wa:browse') return browse(from, s, 'newest', null);
        if (id === 'wa:cats') return categories(from, s);
        if (id === 'wa:near') return nearbyEntry(from, s);
        if (id === 'wa:search') return startSearch(from, s);
        if (id === 'wa:link') return linkInstructions(from);
        if (id === 'wa:lang') return toggleLang(from, s);
        if (id === 'wa:help') return help(from, s);
        if (id === 'wa:account') return accountCard(from, s);
        if (id === 'wa:logout') return logout(from, s);
        if (id === 'wa:bookings') return buyerBookingsMenu(from, s);
        if (id === 'wa:alerts') return showAlerts(from, s);
        if (id === 'wa:follows') return showFollowing(from, s);
        if (id === 'wa:contests') return showContests(from, s);
        if (id === 'wa:a:stats') return adminStats(from, s);
        if (k === 'br') return browse(from, s, p[2], null);
        if (id.startsWith('wa:more:')) return browse(from, s, p[2], p[3] === '-' ? null : p[3], +p[4] || 0);
        if (id.startsWith('wa:deal:')) return dealDetail(from, s, id.slice(8));
        if (id.startsWith('wa:cat:')) return browse(from, s, 'newest', id.slice(7));
        if (id.startsWith('wa:store:')) return storePage(from, s, id.slice(9));
        if (id.startsWith('wa:fol:')) return toggleFollow(from, s, id.slice(7));
        // حجز
        if (id.startsWith('wa:book:')) return startBook(from, s, id.slice(8));
        if (id === 'wa:bback:qty') return startBook(from, s, null);
        if (id === 'wa:bback:prep') return askPrep(from, s);
        if (id === 'wa:bback:note') return askNote(from, s);
        if (id === 'wa:bookok') return doBook(from, s);
        if (id === 'wa:bqc') { s.step = 'await_book_qty'; return sendText(from, tr('wa_ask_qty_custom')); }
        if (k === 'bq') return setQty(from, s, +p[2] || 1);
        if (id === 'wa:prepc') { s.step = 'await_prep'; return sendText(from, tr('wa_ask_prep_custom')); }
        if (k === 'prep') return setPrep(from, s, p[2] === 'arrival' ? 'arrival' : `${p[2]}min`);
        if (id === 'wa:note:add') { s.step = 'await_note'; return sendText(from, tr('wa_ask_note_text')); }
        if (id === 'wa:note:skip') { s.temp.notes = null; return bookConfirm(from, s); }
        // حجوزاتي
        if (id === 'wa:bk:cur') return showBuyerBookings(from, s, 'current');
        if (id === 'wa:bk:prev') return showBuyerBookings(from, s, 'previous');
        if (id.startsWith('wa:bk1:')) return bookingDetail(from, s, id.slice(7));
        if (id.startsWith('wa:cancel:')) return askCancel(from, s, id.slice(10));
        if (id.startsWith('wa:dcancel:')) return doCancel(from, s, id.slice(11));
        if (id.startsWith('wa:chat:')) return showChat(from, s, id.slice(8));
        if (id.startsWith('wa:cmsg:')) return promptChat(from, s, id.slice(8));
        if (id.startsWith('wa:edit:')) return editBooking(from, s, id.slice(8));
        if (id.startsWith('wa:eqty:')) return promptEditQty(from, s, id.slice(8));
        if (id.startsWith('wa:enote:')) return promptEditNote(from, s, id.slice(9));
        if (id === 'wa:rskip') return submitRate(from, s, null);
        if (id.startsWith('wa:rate:')) return startRate(from, s, id.slice(8));
        if (k === 'rst') return setRate(from, s, p[2], +p[3] || 5);
        if (id.startsWith('wa:call:')) return bookingContact(from, s, id.slice(8));
        // تنبيهات
        if (id === 'wa:alkw') return showKeywords(from, s);
        if (id === 'wa:alsmart') return showSmartAlerts(from, s);
        if (k === 'altog') return toggleAlerts(from, s, p[2] === '1');
        if (id === 'wa:kwadd') return promptKeyword(from, s);
        if (k === 'kwrm') return removeKeyword(from, s, +p[2] || 0);
        if (id === 'wa:smnew') return smartNew(from, s);
        if (id === 'wa:smbuild') return smartBuilder(from, s);
        if (id === 'wa:smcat') return smartAddCat(from, s);
        if (id === 'wa:smrg') return smartAddRegion(from, s);
        if (id === 'wa:smkw') return smartPromptKw(from, s);
        if (id === 'wa:smsave') return smartSave(from, s);
        if (id === 'wa:smclear') return smartClear(from, s);
        if (k === 'smrm') return smartRemove(from, s, +p[2] || 0);
        if (k === 'smpc') return smartPickCat(from, s, p[2]);
        if (k === 'smpr') return smartPickRegion(from, s, p.slice(2).join(':'));
        // مسابقات
        if (k === 'ctgo') return startQuiz(from, s, p.slice(2).join(':'));
        if (k === 'ct') return openContest(from, s, p.slice(2).join(':'));
        if (k === 'cq') return answerQuiz(from, s, +p[2] || 0);
        // ── التاجر ──
        if (id === 'wa:s:stats') return sellerStats(from, s);
        if (id === 'wa:s:orders') return sellerOrdersMenu(from, s);
        if (id === 'wa:so:cur') return showSellerOrders(from, s, 'current');
        if (id === 'wa:so:prev') return showSellerOrders(from, s, 'previous');
        if (id.startsWith('wa:so1:')) return sellerOrderDetail(from, s, id.slice(7));
        if (id.startsWith('wa:ack:')) return ackOrder(from, s, id.slice(7));
        if (id.startsWith('wa:done:')) { const bc = id.slice(8); return completeOrder(from, s, bc, null); }
        if (id === 'wa:s:verify') return startVerify(from, s);
        if (id === 'wa:s:deals') return sellerDealsMenu(from, s);
        if (id === 'wa:sd:active') return showSellerDeals(from, s, 'active');
        if (id === 'wa:sd:ended') return showSellerDeals(from, s, 'ended');
        if (id.startsWith('wa:sd1:')) return sellerDealDetail(from, s, id.slice(7));
        if (k === 'tgl') return toggleDeal(from, s, p[2], p[3]);
        if (id.startsWith('wa:delok:')) return doDeleteDeal(from, s, id.slice(9));
        if (id.startsWith('wa:del:')) return askDeleteDeal(from, s, id.slice(7));
        if (k === 'ded') { if (p[2] === 'menu') return editDealMenu(from, s, p.slice(3).join(':')); return editDealField(from, s, p[2], p.slice(3).join(':')); }
        if (k === 'edcat') return editCat(from, s, p[2]);
        if (id === 'wa:s:add') return startAdd(from, s);
        if (id === 'wa:adcancel') { s.step = 'idle'; s.temp = {}; await sendText(from, tr('wa_cancelled')); return mainMenu(from, s); }
        if (k === 'adcat') return (function () { addVal(s).category = p[2]; return askGender(from, s); })();
        if (k === 'adgen') return (function () { addVal(s).gender = p[2]; return askSize(from, s); })();
        if (k === 'adsz') return (function () { addVal(s).size = p[2]; return askDesc(from, s); })();
        if (id === 'wa:adszn') return (function () { addVal(s).size = null; return askDesc(from, s); })();
        if (id === 'wa:adszo') { s.step = 'ad_size'; return sendText(from, tr('wa_add_size_prompt')); }
        if (id === 'wa:adskipdesc') return (function () { addVal(s).desc = ''; return askPrice(from, s); })();
        if (k === 'adexp') return pickExpiry(from, s, p[2]);
        if (k === 'adqty') return pickQty(from, s, p[2]);
        if (id === 'wa:adpub') return doPublish(from, s);
        if (id === 'wa:adphdone') return onPhotosDone(from, s);
        // موقع (مشترك)
        if (id === 'wa:lregion') return pickRegion(from, s);
        if (id === 'wa:lmenu') return askLocationStep(from, s);
        if (k === 'lsaved') return pickSavedLoc(from, s, +p[2] || 0);
        if (k === 'lrg') return pickCity(from, s, p.slice(2).join(':'));
        if (k === 'lct') return pickType(from, s, p.slice(2).join(':'));
        if (k === 'ltp') return pickLocList(from, s, p[2]);
        if (k === 'llc') return pickMapLoc(from, s, +p[2] || 0);
        if (id === 'wa:llink') return askLink(from, s);
        if (id === 'wa:lshare') { s.temp.locShareCtx = true; return askLocation(from); }   // مشاركة الموقع لتعيين موقع العرض/الفرع
        // فروع
        if (id === 'wa:s:branches') return showBranches(from, s);
        if (id === 'wa:bradd') return branchAdd(from, s);
        if (id.startsWith('wa:brdelok:')) return branchDel(from, s, id.slice(11));
        if (id.startsWith('wa:brdel:')) return branchDelAsk(from, s, id.slice(9));
        if (k === 'brsave') return branchSaveDeal(from, s, +p[2] || 0);
        // ساعات / اشتراك / نبذة
        if (id === 'wa:s:hours') return showHours(from, s);
        if (id === 'wa:hall') return promptHoursAll(from, s);
        if (id === 'wa:hoff') return disableHours(from, s);
        if (id === 'wa:s:sub') return showSubscription(from, s);
        if (id === 'wa:subpk') return showPackages(from, s);
        if (k === 'subgo') return subscribe(from, s, p[2]);
        if (id === 'wa:s:profile') return showStoreProfile(from, s);
        if (id === 'wa:bio') return promptBio(from, s);
        return mainMenu(from, s);
    }

    async function onLocation(from, s, loc) {
        // مشاركة موقع لتعيين موقع العرض/الفرع — فقط حين طُلبت صراحةً عبر «مشاركة موقعي».
        if (s.temp.locShareCtx) {
            s.temp.locShareCtx = false;
            return onLocationChosen(from, s, { location_id: null, custom_location_name: null, map_lat: loc.latitude, map_lng: loc.longitude, region: null, city: null, google: null, name: tr('wa_my_shared_loc') }, true);
        }
        // وإلا: موقع المتسوّق للتصفّح القريب
        s.geo = { lat: loc.latitude, lng: loc.longitude, t: Date.now() };
        if (s.userId) rpc('bot_set_location', aid(from, { p_lat: loc.latitude, p_lng: loc.longitude }));
        await sendText(from, tr('wa_loc_set_nearby'));
        return browse(from, s, 'nearby', null);
    }

    // ── نقطة الدخول من webhook: رسالة واحدة ──
    async function handleMessage(from, msg) {
        const s = waSess(from);
        if (!s.userId) await waRefresh(from);
        const lang = s.lang || 'ar';
        return I18N.withLang(lang, async () => {
            try {
                // «مشاركة موقعي» داخل تدفّق التاجر: نضبط علماً قبل وصول الموقع.
                if (msg.type === 'text') return await onText(from, s, (msg.text && msg.text.body) || '');
                if (msg.type === 'interactive') return await onInteractive(from, s, msg.interactive || {});
                if (msg.type === 'image') { const handled = await onPhoto(from, s, msg.image || {}); if (!handled) return mainMenu(from, s); return; }
                if (msg.type === 'location' && msg.location) return await onLocation(from, s, msg.location);
                return await mainMenu(from, s);
            } catch (e) { console.error('WA handleMessage:', e && e.message); try { await sendText(from, tr('wa_err')); } catch { /* ignore */ } }
        });
    }

    // ════════════════════════════════════════════════════════════════════════
    //  إشعارات واتساب (المرحلة ٤) — نصّ + أزرار إجراء داخل نافذة ٢٤ ساعة.
    //  خارجها يلزم قالب معتمد من Meta (نصوص القوالب في progress.md للمالك).
    // ════════════════════════════════════════════════════════════════════════
    const NOTIF_ICON = { booking: '📦', deal: '🆕', marketing: '📣', system: '🔔', follow: '➕', rating: '⭐', review: '⭐', contest: '🎁', survey: '📝', subscription: '💳', report: '🚩', sponsor: '⭐', campaign: '📣', analytics: '📊' };
    async function deliverNotification(n) {
        const to = n.whatsapp_chat_id; if (!to || !enabled()) return;
        const en = (n.preferred_lang || '').startsWith('en');
        return I18N.withLang(en ? 'en' : 'ar', async () => {
            const icon = NOTIF_ICON[n.type] || '🔔';
            const title = (en ? (n.title_en || n.title_ar) : (n.title_ar || n.title_en)) || '';
            const body = (en ? (n.body_en || n.body_ar) : (n.body_ar || n.body_en)) || '';
            const custom = en ? (n.meta_data && n.meta_data.bot_message_en) : (n.meta_data && n.meta_data.bot_message_ar);
            const aud = n.meta_data && n.meta_data.audience; const ev = n.meta_data && n.meta_data.event; const bc = n.meta_data && n.meta_data.barcode;
            const isMsg = !!(n.meta_data && n.meta_data.isMessage);
            const text = custom ? `${icon} ${custom}` : `${icon} *${title}*\n${body}`;
            const btns = [];
            if (n.type === 'booking' && bc) {
                if (isMsg) btns.push({ id: `wa:chat:${bc}`, title: tr('wa_chat_btn') });
                else if (aud === 'seller' && ev === 'new') { btns.push({ id: `wa:ack:${bc}`, title: tr('wa_ack') }, { id: `wa:chat:${bc}`, title: tr('wa_chat_btn') }); }
                else if (aud === 'buyer' && ev === 'completed') btns.push({ id: `wa:rate:${bc}`, title: tr('wa_bk_rate') });
                else btns.push({ id: aud === 'seller' ? 'wa:s:orders' : 'wa:bookings', title: tr('wa_bk_current') });
            }
            btns.push(menuBtn());
            try { if (btns.length >= 1 && btns.length <= 3) await sendButtons(to, { body: text, buttons: btns }); else await sendText(to, text); }
            catch (e) { console.warn('WA notif:', e.message); }
        });
    }

    return { sendWA, sendText, handleMessage, enabled, deliverNotification };
}

module.exports = { create };
