/**
 * flows/sellerDeals.js — تدفّق التاجر الكامل: إضافة/تعديل العرض + المواقع.
 * مطابق لنموذج الموقع 100%: طريقة الانتهاء (كمية/ساعات/أيام/تاريخ)، المقاس،
 * الفئة المستهدفة، العرض القادم (مجدول)، الموقع (محفوظ/منطقة→مدينة→مول-سوق/
 * رابط قوقل/مشاركة)، الصور (١–٤ إجباري)، الباقة محسوبة، وتعديل كامل + إعادة تفعيل.
 *
 * يُسجّل أزراره عبر register(bot, deps)، ويُرجِع معالِجات النص/الصورة/الموقع
 * لينادِيها bot.js من معالِجاته المفردة (يبقى نموذج المعالج الواحد سليماً).
 */
const { Markup } = require('telegraf');
const F = require('../lib/format');
const C = require('../lib/catalog');
const G = require('../lib/geo');
const { tgId, getSession, setStep } = require('../lib/session');
const { tr } = require('../lib/i18n');   // request-scoped translation (ar/en) — v11.86

const {
    md, money, fmtDay, fmtDate, DIV, isPrice, isQty,
    normalizeDigits, parseFlexibleDate, priceBlock, statusLabel,
} = F;
const { catLabel, catKeyboard, genderLabel, GENDER } = C;
const { remainingText, resolveGoogleLocation } = G;

const MAX_IMAGES = 4;
const YEAR_MIN   = 525600;            // مدة افتراضية لعرض «بالكمية» (سنة)
const DAY_MS     = 86400000;
const MIN_LEAD   = 10 * 60_000;       // العرض القادم: ١٠ دقائق على الأقل من الآن

// ── deps المحقونة من bot.js ────────────────────────────────────────────────────
let rpc, uploadPhoto, W, refreshSession, sendMain, KB_BACK;

// ── كيبوردات وأدوات صغيرة ───────────────────────────────────────────────────────
const btn = (t, d) => Markup.button.callback(t, d);
const kbCancel  = () => Markup.inlineKeyboard([[btn(tr('sd34_cancel'), 'sd:cancel')]]).reply_markup;
// كيبورد «رجوع + إلغاء» للخطوات النصّية (مهمة ١). الوجهة flow-aware عند اللزوم.
const kbBack    = backCb => Markup.inlineKeyboard([[btn(tr('sd36_back'), backCb), btn(tr('sd34_cancel'), 'sd:cancel')]]).reply_markup;
const backToExpiry = s => s.temp.flow === 'edit' ? `ede:expiry:${s.temp.editDealId}` : 'adb:expiry';
const backToQty    = s => s.temp.flow === 'edit' ? `ede:qty:${s.temp.editDealId}`    : 'adb:qty';
const toDeals   = () => Markup.inlineKeyboard([[btn(tr('sd39_mydeals'), 'seller:deals')], [btn(tr('sd39_menu'), 'menu:back')]]).reply_markup;
const isSeller  = s => s.userId && s.userType === 'seller';
const dealEnded = d => d.status !== 'active';
function resetTemp(s) { s.temp = {}; }
function reply(ctx, text, markup) { return ctx.reply(text, { parse_mode: 'MarkdownV2', link_preview_options: { is_disabled: true }, ...(markup ? { reply_markup: markup } : {}) }); }

// حساب دقائق الانتهاء + تاريخ الانتهاء حسب النوع، بالنسبة لنقطة بداية (الآن أو موعد البدء).
function computeExpiry(type, a, anchorMs) {
    if (type === 'hours')    return { minutes: Math.max(1, (a.expiryHours || 0) * 60), expiry_date: null };
    if (type === 'duration') return { minutes: Math.max(1, (a.expiryDays || 0) * 1440), expiry_date: null };
    if (type === 'date')     return { minutes: Math.max(1, Math.floor(((a.expiryEndMs || 0) - anchorMs) / 60000)), expiry_date: a.expiryDateIso || null };
    return { minutes: YEAR_MIN, expiry_date: null }; // stock
}
// وصف طريقة الانتهاء للمراجعة/الملخّص.
function expirySummary(a) {
    if (a.expiryType === 'stock')    return tr('sd54_byqty');
    if (a.expiryType === 'hours')    return tr('sd55_hours', md(String(a.expiryHours)));
    if (a.expiryType === 'duration') return tr('sd56_days', md(String(a.expiryDays)));
    if (a.expiryType === 'date')     return tr('sd57_until', md(fmtDay(a.expiryEndMs)));
    return '—';
}

// ════════════════════════════════════════════════════════════════════════════════
function register(bot, deps) {
    ({ rpc, uploadPhoto, W, refreshSession, sendMain, KB_BACK } = deps);

    // ── إلغاء عام لكل تدفّقات التاجر ──────────────────────────────────────────────
    bot.action('sd:cancel', async ctx => {
        await ctx.answerCbQuery();
        setStep(tgId(ctx), 'idle'); resetTemp(getSession(tgId(ctx)));
        await ctx.reply(tr('sd69_cancelled'), { parse_mode: 'MarkdownV2', reply_markup: Markup.removeKeyboard().reply_markup });
        await reply(ctx, tr('sd70_backtomenu'), KB_BACK().reply_markup);
    });

    // ════════ عروضي (نشطة / منتهية) — بطاقة لكل عرض ════════════════════════════════
    bot.action('seller:deals',        async ctx => { await ctx.answerCbQuery(); dealsMenu(ctx); });
    bot.action('seller:deals:active', async ctx => { await ctx.answerCbQuery(); showDeals(ctx, 'active'); });
    bot.action('seller:deals:ended',  async ctx => { await ctx.answerCbQuery(); showDeals(ctx, 'ended'); });

    // ════════ إضافة عرض ════════════════════════════════════════════════════════════
    bot.action('seller:addDeal', async ctx => { await ctx.answerCbQuery(); startAdd(ctx); });
    bot.action(/^adcat:([A-Za-z_]+)$/, async ctx => { await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); if (!s.temp.add) return; s.temp.add.category = ctx.match[1]; askGender(ctx); });
    bot.action(/^adgen:([a-z]+)$/, async ctx => { await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); if (!s.temp.add) return; s.temp.add.gender = ctx.match[1]; askSize(ctx); });
    bot.action('ad:skipDesc', async ctx => { await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); if (s.temp.add) s.temp.add.desc = ''; askPrice(ctx); });
    bot.action('ad:review',  async ctx => { await ctx.answerCbQuery(); goReview(ctx); });
    bot.action('ad:publish', async ctx => { await ctx.answerCbQuery(tr('sd84_publishing')); doPublish(ctx); });

    // ── المقاس: منتقي سريع (مشترك add+edit) — أزرار جاهزة + كتابة حرّة + بدون + رجوع (مهمة ٢) ──
    bot.action(/^sz:set:([A-Za-z0-9]{1,12})$/, async ctx => { await ctx.answerCbQuery(); pickedSize(ctx, ctx.match[1]); });
    bot.action('sz:free', async ctx => { await ctx.answerCbQuery(); askSizeText(ctx); });
    bot.action('sz:none', async ctx => { await ctx.answerCbQuery(); pickedSize(ctx, null); });
    bot.action('sz:menu', async ctx => { await ctx.answerCbQuery(); showSizePicker(ctx); });

    // ── رجوع للخطوة السابقة في تدفّق الإضافة (مهمة ١/٩) ──
    bot.action(/^adb:(name|cat|gender|size|desc|price|expiry|qty|sched|loc)$/, async ctx => {
        await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); if (!s.temp.add) return;
        const map = { name: askName, cat: askCategory, gender: askGender, size: askSize, desc: askDesc, price: askPrice, expiry: askExpiry, qty: askQty, sched: askSchedule, loc: askLocation };
        const fn = map[ctx.match[1]]; if (fn) return fn(ctx);
    });
    // ── مهمة ٩: «إبقاء والمتابعة» — يبقي القيمة الحالية وينتقل للخطوة التالية ──
    bot.action(/^adk:(name|cat|gender|size|desc|price)$/, async ctx => {
        await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); if (!s.temp.add) return;
        const next = { name: askCategory, cat: askGender, gender: askSize, size: askDesc, desc: askPrice, price: askExpiry };
        const fn = next[ctx.match[1]]; if (fn) return fn(ctx);
    });
    // ── مهمة ٩: «تعديل» قيمة خطوة نصّية (يعيد طلب الإدخال) ──
    bot.action(/^ade2:(name|desc|price)$/, async ctx => {
        await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); if (!s.temp.add) return;
        if (ctx.match[1] === 'name')  { setStep(tgId(ctx), 'ad_name'); return reply(ctx, tr('sd107_newname'), kbBack('adb:name')); }
        if (ctx.match[1] === 'desc')  { setStep(tgId(ctx), 'ad_desc'); return reply(ctx, tr('sd108_newdesc'), Markup.inlineKeyboard([[btn(tr('sd108_nodesc'), 'ad:skipDesc')], [btn(tr('sd36_back'), 'adb:desc')]]).reply_markup); }
        if (ctx.match[1] === 'price') { setStep(tgId(ctx), 'ad_orig'); return reply(ctx, tr('sd109_newprice'), kbBack('adb:price')); }
    });

    // ── حفظ الموقع الجديد كموقع دائم للتاجر؟ (مهمة ٣) ──
    bot.action(/^loc:save:([01])$/, async ctx => { await ctx.answerCbQuery(); finishSaveLocation(ctx, ctx.match[1] === '1'); });

    // ════════ تعديل عرض ════════════════════════════════════════════════════════════
    bot.action(/^dedit:([a-zA-Z0-9_-]+)$/, async ctx => { await ctx.answerCbQuery(); openEdit(ctx, ctx.match[1]); });
    bot.action(/^ede:(name|price|qty|desc|cat|gender|size|expiry|sched|photos|loc|reactivate|preview):([a-zA-Z0-9_-]+)$/, async ctx => {
        await ctx.answerCbQuery(); editField(ctx, ctx.match[1], ctx.match[2]);
    });

    // ════════ تبديل الحالة / حذف ═════════════════════════════════════════════════════
    bot.action(/^tglAsk:([a-zA-Z0-9_-]+):(active|paused)$/, async ctx => {
        await ctx.answerCbQuery();
        const [, id, st] = ctx.match;
        const q = st === 'paused'
            ? tr('sd126_confirmpause')
            : tr('sd127_confirmactivate');
        await reply(ctx, q, Markup.inlineKeyboard([[btn(st === 'paused' ? tr('sd128_yespause') : tr('sd128_yesactivate'), `toggle:${id}:${st}`)], [btn(tr('sd128_undo'), 'seller:deals')]]).reply_markup);
    });
    bot.action(/^toggle:([a-zA-Z0-9_-]+):(active|paused)$/, async ctx => {
        await ctx.answerCbQuery(tr('sd131_updating'));
        const [, id, st] = ctx.match;
        const r = await rpc('bot_toggle_deal', { p_telegram_id: tgId(ctx), p_deal_id: id, p_status: st });
        if (r?.success) await reply(ctx, st === 'active' ? tr('sd134_activated') : tr('sd134_paused'), toDeals());
        else if (r?.error === 'blocked') await reply(ctx, tr('sd135_blocked'), KB_BACK().reply_markup);
        else await reply(ctx, tr('sd136_updatefail'), KB_BACK().reply_markup);
    });
    bot.action(/^delDeal:([a-zA-Z0-9_-]+)$/, async ctx => {
        await ctx.answerCbQuery();
        getSession(tgId(ctx)).temp.delId = ctx.match[1];
        await reply(ctx, tr('sd141_confirmdelete'), Markup.inlineKeyboard([[btn(tr('sd141_yesdelete'), 'doDelDeal')], [btn(tr('sd141_no'), 'seller:deals')]]).reply_markup);
    });
    bot.action('doDelDeal', async ctx => {
        await ctx.answerCbQuery(tr('cm_deleting'));
        const s = getSession(tgId(ctx));
        if (!s.temp.delId) return reply(ctx, tr('sd146_sessionended'), toDeals());
        const r = await rpc('bot_delete_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.delId });
        s.temp.delId = null;
        if (r?.success) await reply(ctx, tr('sd149_deleted'), toDeals());
        else await reply(ctx, r?.error === 'has_bookings' ? tr('sd150_hasbookings', r.count) : tr('sd150_deletefail'), toDeals());
    });

    // ════════ منتقي طريقة الانتهاء (مشترك add+edit) ═══════════════════════════════════
    bot.action(/^xp:(stock|hours|duration|date)$/, async ctx => { await ctx.answerCbQuery(); pickedExpiryType(ctx, ctx.match[1]); });
    bot.action(/^xpd:(\d+|custom)$/, async ctx => { await ctx.answerCbQuery(); pickedEndDate(ctx, ctx.match[1]); });
    // مهمة ١٠ — تاريخ بداية العرض ضمن خيار «بتاريخ محدّد» (يُسأل قبل النهاية).
    bot.action(/^xds2:(\d+|custom)$/, async ctx => { await ctx.answerCbQuery(); pickedDealStart(ctx, ctx.match[1]); });

    // ════════ منتقي الكمية (مشترك) ═══════════════════════════════════════════════════
    bot.action(/^xq:(\d+|unlimited|custom)$/, async ctx => { await ctx.answerCbQuery(); pickedQty(ctx, ctx.match[1]); });

    // ════════ الجدولة / العرض القادم (مشترك) ══════════════════════════════════════════
    bot.action('xs:now',   async ctx => { await ctx.answerCbQuery(); onScheduleChosen(ctx, null, false); });
    bot.action('xs:clear', async ctx => { await ctx.answerCbQuery(); onScheduleChosen(ctx, null, true); });
    bot.action('xs:set',   async ctx => { await ctx.answerCbQuery(); askStartDate(ctx); });
    bot.action(/^xsd:(\d+|custom)$/, async ctx => { await ctx.answerCbQuery(); pickedStartDate(ctx, ctx.match[1]); });

    // ════════ منتقي الموقع (مشترك add+edit+branch) ════════════════════════════════════
    bot.action(/^loc:pick:(\d+)$/, async ctx => { await ctx.answerCbQuery(); pickSavedLoc(ctx, +ctx.match[1]); });
    bot.action('loc:region', async ctx => { await ctx.answerCbQuery(); pickRegion(ctx); });
    bot.action(/^loc:rg:([A-Za-z0-9_-]+)$/, async ctx => { await ctx.answerCbQuery(); pickCity(ctx, ctx.match[1]); });
    bot.action(/^loc:ct:([A-Za-z0-9_-]+)$/, async ctx => { await ctx.answerCbQuery(); pickType(ctx, ctx.match[1]); });
    bot.action(/^loc:tp:(mall|market)$/, async ctx => { await ctx.answerCbQuery(); pickLocList(ctx, ctx.match[1]); });
    bot.action(/^loc:lc:(\d+)$/, async ctx => { await ctx.answerCbQuery(); pickMapLocation(ctx, +ctx.match[1]); });
    bot.action('loc:link',  async ctx => { await ctx.answerCbQuery(); askLink(ctx); });
    bot.action('loc:share', async ctx => { await ctx.answerCbQuery(); askShare(ctx); });
    bot.action('loc:menu',  async ctx => { await ctx.answerCbQuery(); askLocation(ctx); });

    // ════════ منتقي الصور (مشترك) ═════════════════════════════════════════════════════
    bot.action('ph:done',  async ctx => { await ctx.answerCbQuery(); onPhotosDone(ctx); });
    bot.action('ph:reset', async ctx => { await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); s.temp.photos = []; await reply(ctx, tr('sd181_photos_reset'), kbCancel()); });

    // ════════ مواقعي (الفروع) ═════════════════════════════════════════════════════════
    bot.action('seller:branches', async ctx => { await ctx.answerCbQuery(); showBranches(ctx); });
    bot.action('brAdd', async ctx => {
        await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); if (!isSeller(s)) return;
        resetTemp(s); s.temp.flow = 'branch'; s.temp.branchId = null;
        setStep(tgId(ctx), 'br_name');
        await reply(ctx, tr('sd189_add_branch', DIV), kbCancel());
    });
    bot.action(/^brEdit:([A-Za-z0-9_-]+)$/, async ctx => {
        await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); s.temp.branchId = ctx.match[1];
        setStep(tgId(ctx), 'br_rename');
        await reply(ctx, tr('sd194_branch_rename'), kbCancel());
    });
    bot.action(/^brMove:([A-Za-z0-9_-]+)$/, async ctx => {
        await ctx.answerCbQuery(); const s = getSession(tgId(ctx));
        resetTemp(s); s.temp.flow = 'branch'; s.temp.branchId = ctx.match[1]; s.temp.branchMove = true;
        askLocation(ctx, tr('sd199_update_branch_loc'));
    });
    bot.action(/^brDel:([A-Za-z0-9_-]+)$/, async ctx => {
        await ctx.answerCbQuery();
        await reply(ctx, tr('sd203_confirm_del_branch'), Markup.inlineKeyboard([[btn(tr('sd203_yes_delete'), `brDelYes:${ctx.match[1]}`)], [btn(tr('sd203_no'), 'seller:branches')]]).reply_markup);
    });
    bot.action(/^brDelYes:([A-Za-z0-9_-]+)$/, async ctx => {
        await ctx.answerCbQuery(tr('cm_deleting'));
        const r = await rpc('bot_remove_branch', { p_telegram_id: tgId(ctx), p_branch_id: ctx.match[1] });
        if (r?.success) await reply(ctx, tr('sd208_branch_deleted'));
        else await reply(ctx, r?.error === 'locked' ? tr('sd209_branch_locked') : tr('sd209_del_failed'));
        return showBranches(ctx);
    });
    bot.action(/^brSaveDeal:(\d+)$/, async ctx => {
        await ctx.answerCbQuery(tr('cm_saving'));
        const s = getSession(tgId(ctx)); const chip = (s.temp.locChips || [])[+ctx.match[1]];
        if (!chip) return reply(ctx, tr('sd215_session_expired'), Markup.inlineKeyboard([[btn(tr('sd215_my_locations'), 'seller:branches')]]).reply_markup);
        const r = await rpc('bot_save_branch', { p_telegram_id: tgId(ctx), p_name: chip.name || tr('cm_location'), p_region: chip.region || null, p_city: chip.city || null, p_location_id: chip.location_id || null, p_map_lat: chip.map_lat ?? null, p_map_lng: chip.map_lng ?? null, p_google_maps_link: chip.google_maps_link || null });
        await reply(ctx, r?.success ? tr('sd217_branch_saved') : tr('sd217_save_failed'));
        return showBranches(ctx);
    });

    registerEditPickers(bot);
    return { handleText, handlePhoto, handleLocation };
}

// ════════════════════════════════════════════════════════════════════════════════
//  عروضي
// ════════════════════════════════════════════════════════════════════════════════
async function dealsMenu(ctx) {
    const s = getSession(tgId(ctx)); if (!isSeller(s)) return;
    await reply(ctx, tr('sd230_my_deals', DIV), Markup.inlineKeyboard([
        [btn(tr('sd231_active_deals'), 'seller:deals:active'), btn(tr('sd231_ended_deals'), 'seller:deals:ended')],
        [btn(tr('sd232_add_deal'), 'seller:addDeal'), btn(tr('sd232_my_locations'), 'seller:branches')],
        [btn(tr('sd233_menu'), 'menu:back')],
    ]).reply_markup);
}
function dealCardExpiry(d) {
    if (d.status === 'expired') return tr('sd237_expired');
    if (d.expiry_type === 'date' && d.expiry_date) return tr('sd238_valid_until', md(fmtDay(d.expiry_date)));
    if (d.expiry_type === 'stock') return d.is_unlimited ? tr('sd239_no_date_by_qty') : tr('sd239_ends_when_sold_out');
    const r = remainingText(d); return r ? tr('sd240_ends_in', md(r)) : null;
}
async function showDeals(ctx, scope) {
    const s = getSession(tgId(ctx)); if (!isSeller(s)) return;
    const all = await rpc('bot_get_seller_deals', { p_telegram_id: tgId(ctx) });
    if (!all?.length) return reply(ctx, tr('sd245_no_deals_yet'), Markup.inlineKeyboard([[btn(tr('sd245_add_first_deal'), 'seller:addDeal')], [btn(tr('sd245_back'), 'menu:back')]]).reply_markup);
    const list = all.filter(d => scope === 'ended' ? dealEnded(d) : !dealEnded(d));
    const title = scope === 'ended' ? tr('sd247_ended_deals') : tr('sd247_active_deals');
    const other = scope === 'ended' ? [tr('sd248_active'), 'seller:deals:active'] : [tr('sd248_ended'), 'seller:deals:ended'];
    if (!list.length) return reply(ctx, tr('sd249_no_deals_section', title, DIV), Markup.inlineKeyboard([[btn(other[0], other[1])], [btn(tr('sd249_add_deal'), 'seller:addDeal'), btn(tr('sd249_back'), 'seller:deals')]]).reply_markup);
    const shown = list.slice(0, 12), more = list.length - shown.length;
    await reply(ctx, tr('sd251_deals_header', title, list.length, (more > 0 ? tr('sd251_first_n', shown.length) : ''), DIV));
    for (let i = 0; i < shown.length; i++) {
        const d = shown[i];
        const qty = d.is_unlimited ? tr('sd254_unlimited') : tr('sd254_pieces', (d.quantity ?? '—'));
        let m = `*${i + 1}\\.* 🏷 *${md(d.item_name)}*\n${statusLabel(d.status)}\n💵 ${money(d.original_price)} ← 🟢 *${money(d.discounted_price)}* ر\\.س \\(${md(d.discount_percentage)}%\\)\n📦 ${md(qty)}`;
        if (d.category) m += `  •  🗂 ${md(catLabel(d.category))}`;
        const exp = dealCardExpiry(d); if (exp) m += `\n${exp}`;
        if (d.bookings_count) m += tr('sd258_bookings_count', d.bookings_count);
        const tStatus = d.status === 'active' ? 'paused' : 'active';
        const tLabel  = d.status === 'active' ? tr('sd260_pause') : tr('sd260_activate');
        await reply(ctx, m, Markup.inlineKeyboard([[btn(tr('sd261_edit'), `dedit:${d.id}`), btn(tLabel, `tglAsk:${d.id}:${tStatus}`), btn(tr('sd261_delete'), `delDeal:${d.id}`)]]).reply_markup);
    }
    await reply(ctx, tr('sd263_footer', DIV, (more > 0 ? tr('sd263_more_hidden', more) : '')), Markup.inlineKeyboard([
        [btn(other[0], other[1]), btn(tr('sd264_refresh'), scope === 'ended' ? 'seller:deals:ended' : 'seller:deals:active')],
        [btn(tr('sd265_add_deal'), 'seller:addDeal'), btn(tr('sd265_menu'), 'menu:back')],
    ]).reply_markup);
}

// ════════════════════════════════════════════════════════════════════════════════
//  إضافة عرض — معالج الخطوات
// ════════════════════════════════════════════════════════════════════════════════
async function startAdd(ctx) {
    const s = getSession(tgId(ctx)); if (!isSeller(s)) return;
    resetTemp(s); s.temp.flow = 'add'; s.temp.add = { images: [] };
    await reply(ctx, tr('sd275_add_new_deal', DIV));
    return askName(ctx);
}
// مهمة ٩ — عند الرجوع لخطوة فيها قيمة، نعرضها مع «تعديل/متابعة» بدل إعادة السؤال أعمى.
function addVal(ctx) { return (getSession(tgId(ctx)).temp.add) || {}; }
async function askName(ctx) {
    const a = addVal(ctx);
    if (a.name) {
        setStep(tgId(ctx), 'idle');
        return reply(ctx, tr('sd284_step1_name', DIV, md(a.name)), Markup.inlineKeyboard([
            [btn(tr('sd285_edit_name'), 'ade2:name'), btn(tr('sd285_continue'), 'adk:name')],
            [btn(tr('sd286_cancel'), 'sd:cancel')],
        ]).reply_markup);
    }
    setStep(tgId(ctx), 'ad_name');
    await reply(ctx, tr('sd290_step1_ask_name'), kbCancel());
}
async function askCategory(ctx) {
    const a = addVal(ctx);
    setStep(tgId(ctx), 'idle');
    const cur = a.category ? tr('sd295_cur_category', DIV, md(catLabel(a.category))) : '';
    const rows = [...catKeyboard('adcat:')];
    if (a.category) rows.push([btn(tr('sd297_continue_same_cat'), 'adk:cat')]);
    rows.push([btn(tr('sd298_back'), 'adb:name'), btn(tr('sd298_cancel'), 'sd:cancel')]);
    await reply(ctx, tr('sd299_step2_category', cur), Markup.inlineKeyboard(rows).reply_markup);
}
async function askGender(ctx) {
    const a = addVal(ctx);
    setStep(tgId(ctx), 'idle');
    const cur = a.gender ? tr('sd304_cur_gender', DIV, md(genderLabel(a.gender))) : '';
    const rows = [
        [btn(GENDER.all, 'adgen:all'), btn(GENDER.men, 'adgen:men')],
        [btn(GENDER.women, 'adgen:women'), btn(GENDER.kids, 'adgen:kids')],
    ];
    if (a.gender) rows.push([btn(tr('sd309_continue_same_gender'), 'adk:gender')]);
    rows.push([btn(tr('sd310_back'), 'adb:cat'), btn(tr('sd310_cancel'), 'sd:cancel')]);
    await reply(ctx, tr('sd311_step3_gender', cur), Markup.inlineKeyboard(rows).reply_markup);
}
// ── المقاس: منتقي سريع مشترك (add + edit) — يضمن ظهور خيارات دائماً (مهمة ٢) ──
const SIZE_PRESETS = ['S', 'M', 'L', 'XL', 'XXL'];
function sizePickerKb(isEdit, id) {
    const rows = [];
    for (let i = 0; i < SIZE_PRESETS.length; i += 3) rows.push(SIZE_PRESETS.slice(i, i + 3).map(z => btn(z, `sz:set:${z}`)));
    rows.push([btn(tr('sd318_other_size'), 'sz:free'), btn(tr('sd318_no_size'), 'sz:none')]);
    rows.push([btn(tr('sd319_back'), isEdit ? `dedit:${id}` : 'adb:gender')]);
    return Markup.inlineKeyboard(rows).reply_markup;
}
async function askSize(ctx) { // سياق الإضافة
    const a = addVal(ctx);
    setStep(tgId(ctx), 'idle');
    const cur = a.size ? tr('sd325_cur_size', DIV, md(a.size)) : '';
    if (a.size) {
        const rows = [];
        for (let i = 0; i < SIZE_PRESETS.length; i += 3) rows.push(SIZE_PRESETS.slice(i, i + 3).map(z => btn(z, `sz:set:${z}`)));
        rows.push([btn(tr('sd329_other_size'), 'sz:free'), btn(tr('sd329_no_size'), 'sz:none')]);
        rows.push([btn(tr('sd330_continue_same_size'), 'adk:size')]);
        rows.push([btn(tr('sd331_back'), 'adb:gender')]);
        return reply(ctx, tr('sd332_step4_size', cur), Markup.inlineKeyboard(rows).reply_markup);
    }
    await reply(ctx, tr('sd334_step4_size_pick'), sizePickerKb(false));
}
function showSizePicker(ctx) { // مشترك — يُستدعى من sz:menu ومن التعديل
    const s = getSession(tgId(ctx));
    if (s.temp.flow === 'edit') {
        const d = s.temp.editDeal || {};
        return reply(ctx, tr('sd340_size_current', md(d.size || '—'), DIV), sizePickerKb(true, s.temp.editDealId));
    }
    return askSize(ctx);
}
async function askSizeText(ctx) {
    const s = getSession(tgId(ctx));
    setStep(tgId(ctx), s.temp.flow === 'edit' ? 'ed_size' : 'ad_size');
    return reply(ctx, tr('sd347_size_text_prompt'), Markup.inlineKeyboard([[btn(tr('sd347_back'), 'sz:menu')]]).reply_markup);
}
async function pickedSize(ctx, val) {
    const s = getSession(tgId(ctx));
    if (s.temp.flow === 'edit') {
        const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.editDealId, p_size: val || '' });
        return afterEditSave(ctx, r);
    }
    if (s.temp.add) { s.temp.add.size = val || null; return askDesc(ctx); }
}
async function askDesc(ctx) {
    const a = addVal(ctx);
    if (a.desc) {
        setStep(tgId(ctx), 'idle');
        return reply(ctx, tr('sd361_step5_desc_current', DIV, md(a.desc)), Markup.inlineKeyboard([
            [btn(tr('sd362_edit_desc'), 'ade2:desc'), btn(tr('sd362_continue'), 'adk:desc')],
            [btn(tr('sd363_back'), 'adb:size'), btn(tr('sd363_cancel'), 'sd:cancel')],
        ]).reply_markup);
    }
    setStep(tgId(ctx), 'ad_desc');
    await reply(ctx, tr('sd367_step5_desc_prompt'), Markup.inlineKeyboard([[btn(tr('sd367_skip_desc'), 'ad:skipDesc')], [btn(tr('sd367_back'), 'adb:size'), btn(tr('sd367_cancel'), 'sd:cancel')]]).reply_markup);
}
async function askPrice(ctx) {
    const a = addVal(ctx);
    if (a.orig && a.disc) {
        setStep(tgId(ctx), 'idle');
        const pct = Math.round(((a.orig - a.disc) / a.orig) * 100);
        return reply(ctx, tr('sd374_step6_price_current', DIV, money(a.orig), money(a.disc), pct), Markup.inlineKeyboard([
            [btn(tr('sd375_edit_price'), 'ade2:price'), btn(tr('sd375_continue'), 'adk:price')],
            [btn(tr('sd376_back'), 'adb:desc'), btn(tr('sd376_cancel'), 'sd:cancel')],
        ]).reply_markup);
    }
    setStep(tgId(ctx), 'ad_orig');
    await reply(ctx, tr('sd380_step6_orig_prompt'), Markup.inlineKeyboard([[btn(tr('sd380_back'), 'adb:desc'), btn(tr('sd380_cancel'), 'sd:cancel')]]).reply_markup);
}
async function askExpiry(ctx) {
    setStep(tgId(ctx), 'idle');
    await reply(ctx, tr('sd384_step8_expiry'), Markup.inlineKeyboard([
        [btn(tr('sd385_by_stock'), 'xp:stock'), btn(tr('sd385_by_hours'), 'xp:hours')],
        [btn(tr('sd386_by_days'), 'xp:duration'), btn(tr('sd386_by_date'), 'xp:date')],
        [btn(tr('sd387_back'), 'adb:price'), btn(tr('sd387_cancel'), 'sd:cancel')],
    ]).reply_markup);
}

// ════════════════════════════════════════════════════════════════════════════════
//  طريقة الانتهاء (مشترك add + edit) — السياق في s.temp.flow
// ════════════════════════════════════════════════════════════════════════════════
function expTarget(s) { return s.temp.flow === 'edit' ? (s.temp.edraft || (s.temp.edraft = {})) : s.temp.add; }
async function pickedExpiryType(ctx, type) {
    const s = getSession(tgId(ctx)); const t = expTarget(s); if (!t) return;
    t.expiryType = type;
    // غير-تاريخ يُلغي أي بداية مجدولة سبق ضبطها داخل تدفّق التاريخ، حتى لا تُتخطّى
    // خطوة «عرض قادم» خطأً بعد الرجوع وتغيير النوع (مهمة ١٠).
    if (type !== 'date' && s.temp.flow === 'add' && s.temp.add) { s.temp.add.scheduleDone = false; s.temp.add.startsAt = null; }
    if (type === 'stock')    { t.expiryHours = null; t.expiryDays = null; t.expiryEndMs = null; t.expiryDateIso = null; return onExpiryChosen(ctx); }
    if (type === 'hours')    { setStep(tgId(ctx), 'ad_hours'); return reply(ctx, tr('sd402_ask_hours'), kbBack(backToExpiry(s))); }
    if (type === 'duration') { setStep(tgId(ctx), 'ad_days');  return reply(ctx, tr('sd403_ask_days'), kbBack(backToExpiry(s))); }
    // date: في الإضافة نسأل تاريخ *البداية* أولاً ثم النهاية (مهمة ١٠). في التعديل
    // نكتفي بتاريخ النهاية (الجدولة تُعدَّل من زرّها المستقل).
    if (s.temp.flow === 'add') return askDealStartDate(ctx);
    return askEndDate(ctx);
}
// مهمة ١٠ — موعد بداية العرض (ضمن «بتاريخ محدّد»). أي بداية مستقبلية تُجدول العرض
// تلقائياً (لا يظهر للمشترين حتى موعده) — تماماً كالموقع.
async function askDealStartDate(ctx) {
    setStep(tgId(ctx), 'idle');
    await reply(ctx, tr('sd413_step8a_start_date'), Markup.inlineKeyboard([
        [btn(tr('sd414_start_now'), 'xds2:0')],
        [btn(tr('sd415_tomorrow'), 'xds2:1'), btn(tr('sd415_in_2_days'), 'xds2:2'), btn(tr('sd415_in_3_days'), 'xds2:3')],
        [btn(tr('sd416_in_a_week'), 'xds2:7'), btn(tr('sd416_custom_start'), 'xds2:custom')],
        [btn(tr('sd417_back'), 'adb:expiry'), btn(tr('sd417_cancel'), 'sd:cancel')],
    ]).reply_markup);
}
async function pickedDealStart(ctx, key) {
    const s = getSession(tgId(ctx)); const t = expTarget(s); if (!t) return;
    if (key === 'custom') { setStep(tgId(ctx), 'ad_dealstart'); return reply(ctx, tr('sd422_custom_start_prompt'), kbBack('adb:expiry')); }
    const days = +key;
    t.startsAt = days > 0 ? Date.now() + days * DAY_MS : null;  // الآن = بلا جدولة
    t.scheduleDone = true;                                       // البداية حُسمت هنا → تخطّي خطوة «عرض قادم»
    return askEndDate(ctx);
}
async function askEndDate(ctx) {
    const s = getSession(tgId(ctx)); const t = expTarget(s) || {};
    setStep(tgId(ctx), 'idle');
    const startLine = t.startsAt ? tr('sd431_starts_scheduled', md(fmtDay(t.startsAt))) : tr('sd431_starts_now');
    await reply(ctx, tr('sd432_step8b_end_date', startLine), Markup.inlineKeyboard([
        [btn(tr('sd433_week'), 'xpd:7'), btn(tr('sd433_two_weeks'), 'xpd:14')],
        [btn(tr('sd434_month'), 'xpd:30'), btn(tr('sd434_two_months'), 'xpd:60'), btn(tr('sd434_three_months'), 'xpd:90')],
        [btn(tr('sd435_custom_date'), 'xpd:custom')],
        [btn(tr('sd436_back'), s.temp.flow === 'add' ? 'adb:expiry' : backToExpiry(s)), btn(tr('sd436_cancel'), 'sd:cancel')],
    ]).reply_markup);
}
async function pickedEndDate(ctx, key) {
    const s = getSession(tgId(ctx)); const t = expTarget(s); if (!t) return;
    if (key === 'custom') { setStep(tgId(ctx), 'ad_date'); return reply(ctx, tr('sd441_custom_end_prompt'), kbBack(backToExpiry(s))); }
    // المدد السريعة تُحسب من موعد البداية (إن جُدول) لا من الآن — مطابق للموقع.
    const anchor = t.startsAt && t.startsAt > Date.now() ? t.startsAt : Date.now();
    const ms = anchor + (+key) * DAY_MS;
    t.expiryEndMs = ms; t.expiryDateIso = new Date(ms).toISOString().slice(0, 10);
    return onExpiryChosen(ctx);
}
// عند اكتمال اختيار الانتهاء: add → ينتقل للكمية؛ edit → يحفظ فوراً.
async function onExpiryChosen(ctx) {
    const s = getSession(tgId(ctx));
    if (s.temp.flow === 'edit') return saveEditField(ctx, 'expiry');
    return askQty(ctx);
}

// ════════════════════════════════════════════════════════════════════════════════
//  الكمية (مشترك)
// ════════════════════════════════════════════════════════════════════════════════
async function askQty(ctx) {
    const s = getSession(tgId(ctx)); const t = expTarget(s);
    setStep(tgId(ctx), 'idle');
    // عرض «بالكمية» يلزمه عدد محدّد (لا خيار غير محدود) — مطابق للموقع.
    const stock = t && t.expiryType === 'stock';
    const rows = [[btn('5', 'xq:5'), btn('10', 'xq:10'), btn('20', 'xq:20'), btn('50', 'xq:50')], [btn(tr('sd463_custom_qty'), 'xq:custom')]];
    if (!stock) rows.splice(1, 0, [btn(tr('sd464_unlimited'), 'xq:unlimited')]);
    const back = s.temp.flow === 'edit' ? btn(tr('sd465_back'), `dedit:${s.temp.editDealId}`) : btn(tr('sd465_back'), 'adb:expiry');
    rows.push([back, btn(tr('sd466_cancel'), 'sd:cancel')]);
    await reply(ctx, tr('sd467_step9_qty', stock ? tr('sd467_qty_required') : ''), Markup.inlineKeyboard(rows).reply_markup);
}
async function pickedQty(ctx, key) {
    const s = getSession(tgId(ctx)); const t = expTarget(s); if (!t) return;
    if (key === 'custom') { setStep(tgId(ctx), 'ad_qty'); return reply(ctx, tr('sd471_custom_qty_prompt'), kbBack(backToQty(s))); }
    if (key === 'unlimited') { t.unlimited = true; t.qty = null; } else { t.unlimited = false; t.qty = +key; }
    return onQtyChosen(ctx);
}
async function onQtyChosen(ctx) {
    const s = getSession(tgId(ctx));
    if (s.temp.flow === 'edit') return saveEditField(ctx, 'qty');
    // إذا حُسم موعد البدء ضمن «بتاريخ محدّد» (مهمة ١٠) نتخطّى خطوة «عرض قادم».
    if (s.temp.add && s.temp.add.scheduleDone) return askLocation(ctx);
    return askSchedule(ctx);
}

// ════════════════════════════════════════════════════════════════════════════════
//  الجدولة / عرض قادم (مشترك)
// ════════════════════════════════════════════════════════════════════════════════
async function askSchedule(ctx) {
    setStep(tgId(ctx), 'idle');
    await reply(ctx, tr('sd488_step10_schedule'), Markup.inlineKeyboard([
        [btn(tr('sd489_publish_now'), 'xs:now')],
        [btn(tr('sd490_schedule_start'), 'xs:set')],
        [btn(tr('sd491_back'), 'adb:qty'), btn(tr('sd491_cancel'), 'sd:cancel')],
    ]).reply_markup);
}
async function askStartDate(ctx) {
    setStep(tgId(ctx), 'idle');
    await reply(ctx, tr('sd496_pick_start_date'), Markup.inlineKeyboard([
        [btn(tr('sd497_tomorrow'), 'xsd:1'), btn(tr('sd497_in3days'), 'xsd:3'), btn(tr('sd497_inweek'), 'xsd:7')],
        [btn(tr('sd498_custom_date'), 'xsd:custom')],
        [btn(tr('sd499_cancel'), 'sd:cancel')],
    ]).reply_markup);
}
async function pickedStartDate(ctx, key) {
    if (key === 'custom') { setStep(tgId(ctx), 'ad_startdate'); return reply(ctx, tr('sd503_type_start_date'), kbBack('xs:set')); }
    const ms = Date.now() + (+key) * DAY_MS;
    return onScheduleChosen(ctx, ms, false);
}
async function onScheduleChosen(ctx, startsAt, clear) {
    const s = getSession(tgId(ctx));
    if (s.temp.flow === 'edit') {
        const id = s.temp.editDealId;
        const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: id, p_starts_at: startsAt || null, p_clear_schedule: !!clear });
        if (!r?.success) return reply(ctx, tr('sd512_schedule_update_fail'), toDeals());
        await reply(ctx, clear ? tr('sd513_schedule_cleared') : tr('sd513_schedule_set', md(fmtDate(startsAt))));
        return openEdit(ctx, id);
    }
    s.temp.add.startsAt = startsAt || null;
    return askLocation(ctx);
}

// ════════════════════════════════════════════════════════════════════════════════
//  منتقي الموقع (مشترك add + edit + branch)
// ════════════════════════════════════════════════════════════════════════════════
// رابط خريطة لموقع محفوظ (إحداثيات إن وُجدت، وإلا رابط قوقل المخزّن).
function chipMapUrl(b) {
    if (b.map_lat != null && b.map_lng != null) return `https://www.google.com/maps/search/?api=1&query=${b.map_lat},${b.map_lng}`;
    return b.google_maps_link || null;
}
const mdUrl = u => String(u).replace(/([)\\])/g, '\\$1'); // تهريب آمن لرابط داخل [..](..)
async function askLocation(ctx, intro) {
    const s = getSession(tgId(ctx));
    setStep(tgId(ctx), 'idle');
    const r = await rpc('bot_list_branches', { p_telegram_id: tgId(ctx) });
    const chips = (r && r.branches) || [];
    s.temp.locChips = chips;
    const cap = r ? tr('sd535_package_cap', r.used, r.max) : '';
    const full = r && r.used >= r.max;
    // مهمة ٧ — عند بلوغ حدّ الباقة في عرض (إضافة/تعديل) لا نسمح بموقع *جديد*
    // إطلاقاً (يُرفض لاحقاً عند النشر فيحبط التاجر). نسمح فقط بإعادة استخدام موقع
    // نشط مسبقاً (🔒 محسوب أصلاً) لأنه لا يزيد عدد المواقع المتميّزة. الفروع لا
    // تُحسب حتى تُربط بعرض نشط، فلا تُقيَّد.
    const gateNew = full && s.temp.flow !== 'branch';
    const pickable = chips.map((b, i) => ({ b, i })).filter(x => !gateNew || x.b.locked);
    // قائمة معرّفة لكل موقع + رابط خريطة — لتعرف «أين كل موقع» وتختار بثقة.
    let savedList = '';
    pickable.slice(0, 8).forEach(({ b }, n) => {
        const u = chipMapUrl(b);
        const place = [b.city, b.region].filter(Boolean).join(' • ');
        const lk = u ? ` — [🗺 اعرض على الخريطة](${mdUrl(u)})` : '';
        savedList += `\n*${n + 1}\\.* 📍 *${md(String(b.name || tr('cm_location')).slice(0, 40))}*${b.locked ? ' 🔒' : ''}${place ? ' — ' + md(place) : ''}${lk}`;
    });
    const rows = [];
    pickable.slice(0, 8).forEach(({ b, i }, n) => rows.push([btn(`${n + 1} • 📍 ${String(b.name || tr('cm_location')).slice(0, 28)}${b.locked ? ' 🔒' : ''}`, `loc:pick:${i}`)]));
    if (!gateNew) {
        rows.push([btn(tr('sd554_region_city_mall'), 'loc:region')]);
        rows.push([btn(tr('sd555_google_link_coords'), 'loc:link'), btn(tr('sd555_share_my_loc'), 'loc:share')]);
    } else {
        rows.push([btn(tr('sd557_upgrade_plan'), 'seller:packages')]);
        rows.push([btn(tr('sd558_manage_locations'), 'seller:branches')]);
    }
    // في تدفّق التاريخ (مهمة ١٠) نتخطّى خطوة «عرض قادم»، فالرجوع يجب أن يعود للكمية
    // لا لخطوة لم تظهر (وإلا قد يُلغي «انشره الآن» تاريخ البدء المجدول).
    const addBack = (s.temp.add && s.temp.add.scheduleDone) ? 'adb:qty' : 'adb:sched';
    const backBtn = s.temp.flow === 'branch' ? btn(tr('sd_my_locations'), 'seller:branches')
        : s.temp.flow === 'add' ? btn(tr('cm_back'), addBack)
        : btn(tr('cm_back'), `dedit:${s.temp.editDealId}`);
    rows.push([backBtn, btn(tr('sd34_cancel'), 'sd:cancel')]);
    const head = intro || (s.temp.flow === 'add' ? tr('sd567_loc_head_add') : tr('sd567_loc_head_change'));
    const tip = savedList ? tr('sd568_available_locations', savedList) : '';
    const fullMsg = gateNew
        ? tr('sd570_plan_limit_reached')
        : '';
    await reply(ctx, `${head}\n${cap ? md(cap) + '\n' : ''}${fullMsg}${gateNew ? '' : tr('sd572_loc_choose_saved')}${tip}`, Markup.inlineKeyboard(rows).reply_markup);
}
async function pickSavedLoc(ctx, i) {
    const s = getSession(tgId(ctx)); const b = (s.temp.locChips || [])[i];
    if (!b) return reply(ctx, tr('sd576_session_ended_loc'), kbCancel());
    return onLocationChosen(ctx, { location_id: b.location_id || null, custom_location_name: b.name || null, map_lat: b.map_lat ?? null, map_lng: b.map_lng ?? null, region: b.region || null, city: b.city || null, google: b.google_maps_link || null, name: b.name }, false);
}
async function pickRegion(ctx) {
    const regions = await rpc('bot_geo_regions', {}) || [];
    if (!regions.length) return reply(ctx, tr('sd581_regions_load_fail'), backLocKb(ctx));
    const rows = []; for (let i = 0; i < regions.length; i += 2) rows.push(regions.slice(i, i + 2).map(r => btn(r.name, `loc:rg:${r.id}`)));
    rows.push([btn(tr('sd583_back'), 'loc:menu')]);
    await reply(ctx, tr('sd584_choose_region'), Markup.inlineKeyboard(rows).reply_markup);
}
async function pickCity(ctx, regionId) {
    const s = getSession(tgId(ctx)); s.temp.pickRegion = regionId;
    const cities = await rpc('bot_geo_cities', { p_region: regionId }) || [];
    if (!cities.length) return reply(ctx, tr('sd589_no_cities'), backLocKb(ctx));
    s.temp.pickCities = cities;
    const rows = []; for (let i = 0; i < cities.length; i += 2) rows.push(cities.slice(i, i + 2).map(c => btn(c.name, `loc:ct:${c.id}`)));
    rows.push([btn(tr('sd592_back_regions'), 'loc:region')]);
    await reply(ctx, tr('sd593_choose_city'), Markup.inlineKeyboard(rows).reply_markup);
}
async function pickType(ctx, cityId) {
    const s = getSession(tgId(ctx)); s.temp.pickCity = cityId;
    const c = (s.temp.pickCities || []).find(x => x.id === cityId); s.temp.pickCityObj = c || null;
    await reply(ctx, tr('sd598_loc_type'), Markup.inlineKeyboard([
        [btn(tr('sd599_mall'), 'loc:tp:mall'), btn(tr('sd599_market'), 'loc:tp:market')],
        [btn(tr('sd600_share_instead'), 'loc:share'), btn(tr('sd600_google_link'), 'loc:link')],
        [btn(tr('sd601_back'), `loc:rg:${s.temp.pickRegion}`)],
    ]).reply_markup);
}
async function pickLocList(ctx, type) {
    const s = getSession(tgId(ctx));
    const locs = await rpc('bot_geo_locations', { p_city: s.temp.pickCity, p_type: type }) || [];
    if (!locs.length) {
        return reply(ctx, tr('sd608_no_locations', (type === 'mall' ? tr('sd608_malls') : tr('sd608_markets'))), Markup.inlineKeyboard([
            [btn(tr('sd609_use_city_center'), 'loc:tp:city')],
            [btn(tr('sd610_google_link'), 'loc:link'), btn(tr('sd610_share_my_loc'), 'loc:share')],
            [btn(tr('sd611_back'), `loc:ct:${s.temp.pickCity}`)],
        ]).reply_markup);
    }
    s.temp.pickLocs = locs;
    const rows = locs.slice(0, 16).map((l, i) => [btn(`📍 ${String(l.name).slice(0, 36)}`, `loc:lc:${i}`)]);
    rows.push([btn(tr('cm_back'), `loc:ct:${s.temp.pickCity}`)]);
    await reply(ctx, `${type === 'mall' ? tr('sd617_choose_mall') : tr('sd617_choose_market')}`, Markup.inlineKeyboard(rows).reply_markup);
}
async function pickMapLocation(ctx, i) {
    const s = getSession(tgId(ctx)); const l = (s.temp.pickLocs || [])[i];
    if (!l) return reply(ctx, tr('sd621_session_ended_pick'), backLocKb(ctx));
    const c = s.temp.pickCityObj;
    return onLocationChosen(ctx, { location_id: l.id, custom_location_name: l.name, map_lat: l.lat, map_lng: l.lng, region: s.temp.pickRegion || (c && c.regionId) || null, city: s.temp.pickCity || null, google: null, name: l.name }, true);
}
// «مركز المدينة» كموقع مخصّص حين لا مولات/أسواق.
async function pickCityCenter(ctx) {
    const s = getSession(tgId(ctx)); const c = s.temp.pickCityObj;
    if (!c) return reply(ctx, tr('sd628_session_ended_pick'), backLocKb(ctx));
    return onLocationChosen(ctx, { location_id: null, custom_location_name: c.name, map_lat: c.lat, map_lng: c.lng, region: s.temp.pickRegion || null, city: c.id, google: null, name: c.name }, true);
}
function backLocKb(ctx) { return Markup.inlineKeyboard([[btn(tr('sd631_loc_options'), 'loc:menu')]]).reply_markup; }
async function askLink(ctx) {
    setStep(tgId(ctx), 'loc_link');
    await reply(ctx, tr('sd634_ask_link'), Markup.inlineKeyboard([[btn(tr('sd634_loc_options'), 'loc:menu')]]).reply_markup);
}
async function askShare(ctx) {
    setStep(tgId(ctx), 'loc_share');
    await ctx.reply(tr('sd638_share_prompt'), { reply_markup: Markup.keyboard([[Markup.button.locationRequest(tr('sd638_share_now'))], [tr('sd638_cancel')]]).resize().oneTime().reply_markup });
}
// عند اختيار/تحديد موقع نهائياً (من أي مصدر).
async function onLocationChosen(ctx, loc, isNew) {
    const s = getSession(tgId(ctx));
    await ctx.reply(tr('sd643_loc_set'), { reply_markup: Markup.removeKeyboard().reply_markup }).catch(() => {});
    if (s.temp.flow === 'branch') {
        const name = s.temp.branchMove ? null : (s.temp.branchName || loc.name || loc.custom_location_name || tr('cm_location'));
        const r = await rpc('bot_save_branch', { p_telegram_id: tgId(ctx), p_branch_id: s.temp.branchId || null, p_name: name, p_region: loc.region || null, p_city: loc.city || null, p_location_id: loc.location_id || null, p_map_lat: loc.map_lat ?? null, p_map_lng: loc.map_lng ?? null, p_google_maps_link: loc.google || null });
        await reply(ctx, r?.success ? tr('sd647_branch_saved', md(r.name || name || tr('cm_location'))) : tr('sd647_branch_save_fail'));
        return showBranches(ctx);
    }
    if (s.temp.flow === 'edit') {
        const id = s.temp.editDealId;
        const r = await rpc('bot_set_deal_location', { p_telegram_id: tgId(ctx), p_deal_id: id, p_location_id: loc.location_id || null, p_custom_location_name: loc.custom_location_name || loc.name || null, p_map_lat: loc.map_lat ?? null, p_map_lng: loc.map_lng ?? null, p_region: loc.region || null, p_city: loc.city || null, p_google_maps_link: loc.google || null });
        if (!r?.success) { await reply(ctx, r?.error === 'blocked' ? tr('sd653_loc_blocked') : tr('sd653_loc_update_fail'), toDeals()); return openEdit(ctx, id); }
        await reply(ctx, tr('sd654_loc_updated'));
        if (isNew) return offerSaveLocation(ctx, loc, 'edit', id);   // مهمة ٣: خيّره يحفظه دائماً
        return openEdit(ctx, id);
    }
    // add
    s.temp.add.loc = loc;
    if (isNew) return offerSaveLocation(ctx, loc, 'add', null);       // مهمة ٣
    return askPhotos(ctx);
}
// خيار صريح: حفظ الموقع الجديد كموقع دائم في «مواقعي» (بدل الحفظ الصامت). مهمة ٣.
function offerSaveLocation(ctx, loc, kind, editId) {
    const s = getSession(tgId(ctx));
    s.temp.pendingLoc = loc; s.temp.locSaveCtx = kind; s.temp.locSaveEditId = editId || null;
    return reply(ctx, tr('sd667_save_loc_prompt'), Markup.inlineKeyboard([
        [btn(tr('sd668_save_yes'), 'loc:save:1')],
        [btn(tr('sd669_save_no'), 'loc:save:0')],
    ]).reply_markup);
}
async function finishSaveLocation(ctx, doSave) {
    const s = getSession(tgId(ctx));
    const loc = s.temp.pendingLoc; const kind = s.temp.locSaveCtx; const editId = s.temp.locSaveEditId;
    s.temp.pendingLoc = null; s.temp.locSaveCtx = null; s.temp.locSaveEditId = null;
    if (doSave && loc) {
        const r = await rpc('bot_save_branch', { p_telegram_id: tgId(ctx), p_name: loc.name || loc.custom_location_name || tr('cm_location'), p_region: loc.region || null, p_city: loc.city || null, p_location_id: loc.location_id || null, p_map_lat: loc.map_lat ?? null, p_map_lng: loc.map_lng ?? null, p_google_maps_link: loc.google || null });
        await reply(ctx, r?.success ? tr('sd678_saved_ok') : tr('sd678_saved_fail'));
    }
    if (kind === 'edit' && editId) return openEdit(ctx, editId);
    return askPhotos(ctx);
}

// ════════════════════════════════════════════════════════════════════════════════
//  الصور (١ إلى ٤، إجباري ≥١) — مشترك
// ════════════════════════════════════════════════════════════════════════════════
async function askPhotos(ctx) {
    const s = getSession(tgId(ctx));
    s.temp.photos = s.temp.photos || [];
    setStep(tgId(ctx), s.temp.flow === 'edit' ? 'ed_photo' : 'ad_photo');
    const head = s.temp.flow === 'edit' ? tr('sd691_photos_head_edit') : tr('sd691_photos_head_add');
    const back = s.temp.flow === 'edit' ? `dedit:${s.temp.editDealId}` : 'adb:loc';
    await reply(ctx, tr('sd693_photos_body', head), kbBack(back));
}
function photoProgressKb(n) {
    const rows = [];
    if (n >= 1) rows.push([btn(tr('sd697_photos_done', n, MAX_IMAGES), 'ph:done')]);
    rows.push([btn(tr('sd698_photos_reset'), 'ph:reset'), btn(tr('sd698_cancel'), 'sd:cancel')]);
    return Markup.inlineKeyboard(rows).reply_markup;
}
async function onPhotosDone(ctx) {
    const s = getSession(tgId(ctx)); const imgs = s.temp.photos || [];
    if (!imgs.length) return reply(ctx, tr('sd703_need_one_photo'), kbCancel());
    if (s.temp.flow === 'edit') {
        const id = s.temp.editDealId;
        const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: id, p_images: imgs });
        if (!r?.success) return reply(ctx, tr('sd707_photos_save_fail'), toDeals());
        await reply(ctx, tr('sd708_photos_updated', imgs.length));
        return openEdit(ctx, id);
    }
    s.temp.add.images = imgs;
    return goReview(ctx);
}

// ════════════════════════════════════════════════════════════════════════════════
//  مراجعة ونشر
// ════════════════════════════════════════════════════════════════════════════════
async function goReview(ctx) {
    const s = getSession(tgId(ctx)); const a = s.temp.add; if (!a) return;
    setStep(tgId(ctx), 'idle');
    const pct = Math.round(((a.orig - a.disc) / a.orig) * 100);
    const qty = a.unlimited ? 'غير محدودة' : md(String(a.qty));
    const loc = a.loc ? (a.loc.name || a.loc.custom_location_name || (a.loc.city || 'موقع مخصّص')) : 'بدون';
    const sched = a.startsAt ? `\n🚀 عرض قادم — يبدأ: *${md(fmtDate(a.startsAt))}*` : '';
    const size = a.size ? `\n📏 المقاس: ${md(a.size)}` : '';
    const desc = a.desc ? `\n📝 ${md(a.desc)}` : '';
    await reply(ctx,
        tr('sd727_review', DIV, md(a.name), md(catLabel(a.category)), md(genderLabel(a.gender)), size, priceBlock(a.orig, a.disc, pct), expirySummary(a), qty, sched, md(loc), a.images.length, desc),
        Markup.inlineKeyboard([[btn(tr('sd731_publish'), 'ad:publish')], [btn(tr('sd731_cancel'), 'sd:cancel')]]).reply_markup);
}
async function doPublish(ctx) {
    const s = getSession(tgId(ctx)); const a = s.temp.add;
    if (!a || !a.name) return reply(ctx, tr('sd735_session_ended'), toDeals());
    if (!a.images || !a.images.length) { setStep(tgId(ctx), 'ad_photo'); return reply(ctx, tr('sd736_need_one_photo'), kbCancel()); }
    const anchor = a.startsAt || Date.now();
    if (a.expiryType === 'date' && a.expiryEndMs && a.expiryEndMs <= anchor)
        return reply(ctx, tr('sd739_end_after_start'), Markup.inlineKeyboard([[btn(tr('sd739_edit_end_date'), 'xp:date')], [btn(tr('sd739_cancel'), 'sd:cancel')]]).reply_markup);
    const ex = computeExpiry(a.expiryType, a, anchor);
    const r = await rpc('bot_add_deal', {
        p_telegram_id: tgId(ctx), p_item_name: a.name, p_original_price: a.orig, p_discounted_price: a.disc,
        p_quantity: a.unlimited ? 0 : (a.qty || 0), p_description: a.desc || '', p_category: a.category || 'other',
        p_images: a.images || [], p_location_id: a.loc?.location_id || null, p_custom_location_name: a.loc?.custom_location_name || a.loc?.name || null,
        p_map_lat: a.loc?.map_lat ?? null, p_map_lng: a.loc?.map_lng ?? null, p_region: a.loc?.region || null, p_city: a.loc?.city || null,
        p_google_maps_link: a.loc?.google || null, p_size: a.size || null, p_gender: a.gender || 'all',
        p_expiry_type: a.expiryType, p_expiry_date: ex.expiry_date, p_expires_in_minutes: ex.minutes,
        p_starts_at: a.startsAt || null, p_is_unlimited: !!a.unlimited,
    });
    setStep(tgId(ctx), 'idle'); const ok = r?.success; resetTemp(s);
    if (!ok) {
        const overCap = r?.error === 'blocked' && /LOCATION_LIMIT/i.test(String(r?.detail || ''));
        const m = r?.error === 'invalid_price' ? tr('sd753_invalid_price')
            : overCap ? tr('sd754_over_cap')
            : r?.error === 'blocked' ? tr('sd755_publish_blocked') : tr('sd755_publish_fail');
        return reply(ctx, m, Markup.inlineKeyboard([[btn(tr('sd756_my_locations'), 'seller:branches'), btn(tr('sd756_subscription'), 'seller:sub')], [btn(tr('sd756_menu'), 'menu:back')]]).reply_markup);
    }
    const liveLine = a.startsAt ? tr('sd758_upcoming_line') : tr('sd758_live_line');
    await reply(ctx, tr('sd759_published_ok', DIV, r.discount, liveLine), Markup.inlineKeyboard([[btn(tr('sd759_my_deals'), 'seller:deals'), btn(tr('sd759_another_deal'), 'seller:addDeal')], [btn(tr('sd759_menu'), 'menu:back')]]).reply_markup);
    // Ask for working hours the first time only — once set they stay fixed across
    // all future products (the seller changes them only from «ساعات العمل»). v11.77
    try {
        const hr = await rpc('bot_get_store_hours', { p_telegram_id: tgId(ctx) });
        const wh = hr?.working_hours;
        if (!(wh && wh.enabled && wh.days)) {
            await reply(ctx, tr('sd766_add_hours_prompt'), Markup.inlineKeyboard([[btn(tr('sd766_add_hours'), 'seller:hours')], [btn(tr('sd766_later'), 'menu:back')]]).reply_markup);
        }
    } catch { /* ignore */ }
}

// ════════════════════════════════════════════════════════════════════════════════
//  تعديل عرض (مطابق للموقع) — كل الحقول + إعادة تفعيل + معاينة
// ════════════════════════════════════════════════════════════════════════════════
async function getDeal(ctx, id) { return rpc('bot_get_seller_deal', { p_telegram_id: tgId(ctx), p_deal_id: id }); }
async function openEdit(ctx, id) {
    const s = getSession(tgId(ctx)); if (!isSeller(s)) return;
    const d = await getDeal(ctx, id);
    if (!d) return reply(ctx, tr('sd778_deal_not_found'), Markup.inlineKeyboard([[btn(tr('sd778_my_deals'), 'seller:deals')]]).reply_markup);
    s.temp.editDealId = id; s.temp.editDeal = d; s.temp.flow = 'edit'; s.temp.edraft = {};
    const qty = d.is_unlimited ? '♾ غير محدود' : md(String(d.quantity ?? '—'));
    const exp = d.expiry_type === 'date' && d.expiry_date ? `🗓 حتى ${md(fmtDay(d.expiry_date))}` : d.expiry_type === 'stock' ? '📦 بالكمية' : (remainingText(d) ? `⏳ ${md(remainingText(d))}` : '—');
    const sched = d.starts_at && Number(d.starts_at) > Date.now() ? `\n🚀 مجدول: ${md(fmtDate(Number(d.starts_at)))}` : '';
    const cur = `${DIV}\n🏷 *${md(d.item_name)}*  •  ${statusLabel(d.status)}\n💵 ${money(d.original_price)} ← 🟢 ${money(d.discounted_price)} ر\\.س \\(${md(d.discount_percentage)}%\\)\n📦 ${qty}  •  🗂 ${md(catLabel(d.category))}  •  ${md(genderLabel(d.gender || 'all'))}\n📏 المقاس: ${md(d.size || '—')}  •  🖼 الصور: ${Array.isArray(d.images) ? d.images.length : 0}\n⏳ ${exp}${sched}`;
    const rows = [
        [btn(tr('sd785_edit_name'), `ede:name:${id}`), btn(tr('sd785_edit_price'), `ede:price:${id}`)],
        [btn(tr('sd786_edit_qty'), `ede:qty:${id}`), btn(tr('sd786_edit_desc'), `ede:desc:${id}`)],
        [btn(tr('sd787_edit_cat'), `ede:cat:${id}`), btn(tr('sd787_edit_gender'), `ede:gender:${id}`)],
        [btn(tr('sd788_edit_size'), `ede:size:${id}`), btn(tr('sd788_edit_expiry'), `ede:expiry:${id}`)],
        [btn(tr('sd789_edit_sched'), `ede:sched:${id}`), btn(tr('sd789_edit_photos'), `ede:photos:${id}`)],
        [btn(tr('sd790_edit_loc'), `ede:loc:${id}`), btn(tr('sd790_edit_preview'), `ede:preview:${id}`)],
    ];
    if (dealEnded(d)) rows.push([btn(tr('sd792_reactivate'), `ede:reactivate:${id}`)]);
    else rows.push([btn(tr('sd793_pause'), `tglAsk:${id}:paused`)]);
    rows.push([btn(tr('sd794_delete'), `delDeal:${id}`), btn(tr('sd794_back'), 'seller:deals')]);
    await reply(ctx, tr('sd795_edit_deal', cur, DIV), Markup.inlineKeyboard(rows).reply_markup);
}
async function editField(ctx, field, id) {
    const s = getSession(tgId(ctx));
    s.temp.editDealId = id; s.temp.flow = 'edit';
    const d = s.temp.editDeal && s.temp.editDeal.id === id ? s.temp.editDeal : await getDeal(ctx, id);
    if (!d) return reply(ctx, tr('sd801_edit_session_ended'), Markup.inlineKeyboard([[btn(tr('sd801_my_deals'), 'seller:deals')]]).reply_markup);
    s.temp.editDeal = d; s.temp.edraft = {};
    if (field === 'name')  { setStep(tgId(ctx), 'ed_name');  return reply(ctx, tr('sd803_edit_name_prompt', md(d.item_name || '—'), DIV), kbCancel()); }
    if (field === 'price') { setStep(tgId(ctx), 'ed_orig');  return reply(ctx, tr('sd804_edit_price_prompt', money(d.original_price), money(d.discounted_price), DIV), kbCancel()); }
    if (field === 'desc')  { setStep(tgId(ctx), 'ed_desc');  return reply(ctx, tr('sd805_edit_desc_prompt', md(d.description || tr('sd805_none')), DIV), kbCancel()); }
    if (field === 'size')  { return showSizePicker(ctx); }
    if (field === 'qty')   { s.temp.edraft = { expiryType: d.expiry_type }; return askQty(ctx); }
    if (field === 'cat')   { return reply(ctx, tr('sd808_edit_cat_prompt', md(catLabel(d.category)), DIV), Markup.inlineKeyboard([...catKeyboard('adcat:edit:'), [btn(tr('sd808_cancel'), `dedit:${id}`)]]).reply_markup); }
    if (field === 'gender'){ return reply(ctx, tr('sd809_edit_gender_prompt', md(genderLabel(d.gender || 'all')), DIV), Markup.inlineKeyboard([[btn(GENDER.all, 'adgen:edit:all'), btn(GENDER.men, 'adgen:edit:men')], [btn(GENDER.women, 'adgen:edit:women'), btn(GENDER.kids, 'adgen:edit:kids')], [btn(tr('sd809_cancel'), `dedit:${id}`)]]).reply_markup); }
    if (field === 'expiry'){ return askExpiry(ctx); }
    if (field === 'sched') { return reply(ctx, tr('sd811_sched_title'), Markup.inlineKeyboard([[btn(tr('sd811_publish_now'), 'xs:clear')], [btn(tr('sd811_schedule'), 'xs:set')], [btn(tr('sd811_back'), `dedit:${id}`)]]).reply_markup); }
    if (field === 'photos'){ return previewImagesThen(ctx, d, () => askPhotos(ctx)); }
    if (field === 'loc')   { return askLocation(ctx, tr('sd813_change_loc')); }
    if (field === 'reactivate') { return reactivate(ctx, id); }
    if (field === 'preview')    { return previewDeal(ctx, d); }
}
// أزرار تعديل التصنيف/الفئة في سياق التعديل (prefix ...:edit:)
function registerEditPickers(bot) {
    bot.action(/^adcat:edit:([A-Za-z_]+)$/, async ctx => { await ctx.answerCbQuery(tr('sd819_saving')); const s = getSession(tgId(ctx)); const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.editDealId, p_category: ctx.match[1] }); afterEditSave(ctx, r); });
    bot.action(/^adgen:edit:([a-z]+)$/, async ctx => { await ctx.answerCbQuery(tr('sd820_saving')); const s = getSession(tgId(ctx)); const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.editDealId, p_gender: ctx.match[1] }); afterEditSave(ctx, r); });
    bot.action('loc:tp:city', async ctx => { await ctx.answerCbQuery(); pickCityCenter(ctx); });
}
async function reactivate(ctx, id) {
    const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: id, p_status: 'active' });
    if (r?.success) { await reply(ctx, tr('sd825_reactivated')); return openEdit(ctx, id); }
    const overCap = r?.error === 'blocked' && /LOCATION_LIMIT/i.test(String(r?.detail || ''));
    return reply(ctx, overCap ? tr('sd827_over_location_limit') : tr('sd827_reactivate_failed'), Markup.inlineKeyboard([[btn(tr('sd827_btn_subscription'), 'seller:sub'), btn(tr('sd827_btn_my_locations'), 'seller:branches')], [btn(tr('sd827_btn_back'), `dedit:${id}`)]]).reply_markup);
}
// حفظ حقل تعديل عام ثم العودة لقائمة التعديل.
async function saveEditField(ctx, which) {
    const s = getSession(tgId(ctx)); const id = s.temp.editDealId; const t = s.temp.edraft || {}; const a = s.temp.add;
    let args = { p_telegram_id: tgId(ctx), p_deal_id: id };
    if (which === 'expiry') {
        const d = s.temp.editDeal || {};
        const anchor = (d.starts_at && Number(d.starts_at) > Date.now()) ? Number(d.starts_at) : Date.now();
        if (t.expiryType === 'date' && t.expiryEndMs && t.expiryEndMs <= anchor) return reply(ctx, tr('sd836_end_date_future'), Markup.inlineKeyboard([[btn(tr('sd836_btn_retry'), `ede:expiry:${id}`)]]).reply_markup);
        const ex = computeExpiry(t.expiryType, t, anchor);
        args.p_expiry_type = t.expiryType; args.p_expiry_date = ex.expiry_date; args.p_expires_in_minutes = ex.minutes;
    } else if (which === 'qty') {
        const src = s.temp.flow === 'edit' ? t : a;
        args.p_quantity = src.unlimited ? 0 : (src.qty || 0); args.p_is_unlimited = !!src.unlimited;
    }
    const r = await rpc('bot_update_deal', args);
    return afterEditSave(ctx, r);
}
async function afterEditSave(ctx, r) {
    const s = getSession(tgId(ctx)); const id = s.temp.editDealId;
    if (!r?.success) {
        const e = r?.error; const msg = e === 'invalid_price' ? tr('sd849_invalid_price') : e === 'not_found' ? tr('sd849_not_found') : tr('sd849_edit_failed');
        return reply(ctx, msg, Markup.inlineKeyboard([[btn(tr('cm_back'), `dedit:${id}`)]]).reply_markup);
    }
    s.temp.editDeal = null; // أعد الجلب لإظهار القيمة المحدّثة
    await reply(ctx, tr('sd853_saved'));
    return openEdit(ctx, id);
}
async function previewImagesThen(ctx, d, next) {
    const imgs = Array.isArray(d.images) ? d.images.filter(Boolean) : [];
    if (imgs.length) { try { await ctx.replyWithMediaGroup(imgs.slice(0, 4).map(u => ({ type: 'photo', media: u }))); } catch { /* ignore */ } }
    return next();
}
async function previewDeal(ctx, d) {
    const imgs = Array.isArray(d.images) ? d.images.filter(Boolean) : [];
    const cap = `${tr('sd863_preview_header')}\n${DIV}\n🏷 *${md(d.item_name)}*\n` + priceBlock(d.original_price, d.discounted_price, d.discount_percentage) + `\n📦 ${d.is_unlimited ? 'غير محدود' : md(String(d.quantity ?? '—'))}${d.size ? `\n📏 ${md(d.size)}` : ''}${d.description ? `\n📝 ${md(String(d.description).slice(0, 300))}` : ''}`;
    const back = Markup.inlineKeyboard([[btn(tr('sd864_btn_back_to_edit'), `dedit:${d.id}`)]]).reply_markup;
    if (imgs.length > 1) { try { await ctx.replyWithMediaGroup(imgs.slice(0, 4).map(u => ({ type: 'photo', media: u }))); } catch { /* ignore */ } return reply(ctx, cap, back); }
    if (imgs[0]) { try { return await ctx.replyWithPhoto(imgs[0], { caption: cap, parse_mode: 'MarkdownV2', reply_markup: back }); } catch { /* fall through */ } }
    return reply(ctx, cap + tr('sd867_no_images_hint'), back);
}

// ════════════════════════════════════════════════════════════════════════════════
//  مواقعي (الفروع) — كل المواقع (محفوظة + مواقع عروض) مع وسم وإتاحة حذف/تعديل
// ════════════════════════════════════════════════════════════════════════════════
function branchPlace(b) {
    if (b.map_lat != null && b.map_lng != null) return `[🗺 الموقع على الخريطة](https://www.google.com/maps/search/?api=1&query=${b.map_lat},${b.map_lng})`;
    if (b.google_maps_link) return `[🗺 الموقع](${b.google_maps_link})`;
    return '';
}
function branchWhere(b) { const p = [b.city, b.region].filter(Boolean); return p.length ? md(p.join(' • ')) : tr('sd878_custom_location'); }
async function showBranches(ctx) {
    const s = getSession(tgId(ctx)); if (!isSeller(s)) return reply(ctx, tr('sd880_sellers_only'));
    const r = await rpc('bot_list_branches', { p_telegram_id: tgId(ctx) });
    if (!r?.success) return reply(ctx, tr('sd882_load_locations_failed'), KB_BACK().reply_markup);
    const branches = r.branches || []; s.temp.locChips = branches;
    const full = r.used >= r.max;
    let head = tr('sd885_my_locations_head', r.max, r.used);
    head += full ? tr('sd886_plan_full') : tr('sd886_add_hint');
    await reply(ctx, head);
    for (let i = 0; i < branches.length; i++) {
        const b = branches[i]; const pl = branchPlace(b);
        const tag = b.locked ? tr('sd890_tag_locked') : tr('sd890_tag_unlinked');
        const m = `📍 *${md(b.name || tr('cm_location'))}*${b.is_primary ? tr('sd891_primary') : ''}${b.is_active === false ? tr('sd891_inactive') : ''}\n${branchWhere(b)}${pl ? '\n' + pl : ''}\n${tag}`;
        let kb;
        if (b.kind === 'deal') {
            // موقع عرض نشط غير محفوظ كفرع → اعرضه واسمح بحفظه (تعديله/حذفه عبر العرض نفسه).
            kb = Markup.inlineKeyboard([[btn(tr('sd895_btn_save_to_locations'), `brSaveDeal:${i}`)]]).reply_markup;
        } else {
            const row = [btn(tr('sd897_btn_rename'), `brEdit:${b.id}`), btn(tr('sd897_btn_change_location'), `brMove:${b.id}`)];
            const row2 = b.locked ? [] : [btn(tr('sd898_btn_delete'), `brDel:${b.id}`)];
            kb = Markup.inlineKeyboard(row2.length ? [row, row2] : [row]).reply_markup;
        }
        await reply(ctx, m, kb);
    }
    if (!branches.length) await reply(ctx, tr('sd903_no_locations_yet'));
    await reply(ctx, `${DIV}`, Markup.inlineKeyboard([
        [btn(tr('sd905_btn_add_location'), 'brAdd')],
        [btn(tr('sd906_btn_manage_on_map'), W('/seller')), btn(tr('sd906_btn_menu'), 'menu:back')],
    ]).reply_markup);
}

// ════════════════════════════════════════════════════════════════════════════════
//  معالِجات النص/الصورة/الموقع (يناديها bot.js من معالِجاته المفردة)
//  تُرجِع true إن استهلكت الخطوة، وإلا false ليكمل bot.js.
// ════════════════════════════════════════════════════════════════════════════════
async function handleText(ctx, s, text) {
    const step = s.step || 'idle';
    const SELLER_STEPS = ['ad_name', 'ad_size', 'ad_desc', 'ad_orig', 'ad_disc', 'ad_hours', 'ad_days', 'ad_date', 'ad_dealstart', 'ad_qty', 'ad_startdate', 'loc_link', 'br_name', 'br_rename', 'ed_name', 'ed_orig', 'ed_disc', 'ed_desc', 'ed_size'];
    if (!SELLER_STEPS.includes(step)) return false;

    // إلغاء من كيبورد الرد أثناء أي خطوة تاجر.
    if (text === tr('sd34_cancel')) { setStep(tgId(ctx), 'idle'); resetTemp(s); await ctx.reply(tr('sd920_cancelled'), { parse_mode: 'MarkdownV2', reply_markup: Markup.removeKeyboard().reply_markup }); const ns = await refreshSession(ctx); await sendMain(ctx, ns); return true; }

    const a = s.temp.add || {}; const t = s.temp.edraft || (s.temp.edraft = {});
    // ── إضافة ──
    if (step === 'ad_name') { if (text.length < 3) { await reply(ctx, tr('sd924_name_too_short')); return true; } a.name = text.slice(0, 120); await askCategory(ctx); return true; }
    if (step === 'ad_size') { a.size = text.slice(0, 40); await askDesc(ctx); return true; }
    if (step === 'ad_desc') { a.desc = text.slice(0, 500); await askPrice(ctx); return true; }
    if (step === 'ad_orig') { if (!isPrice(text)) { await reply(ctx, tr('sd927_send_valid_number')); return true; } a.orig = +normalizeDigits(text); setStep(tgId(ctx), 'ad_disc'); await reply(ctx, tr('sd927_step7_discounted'), kbBack('adb:price')); return true; }
    if (step === 'ad_disc') { if (!isPrice(text) || +normalizeDigits(text) >= a.orig) { await reply(ctx, tr('sd928_must_be_less_than', md(String(a.orig)))); return true; } a.disc = +normalizeDigits(text); await askExpiry(ctx); return true; }
    if (step === 'ad_hours') { const n = +normalizeDigits(text); if (!isQty(text) || n < 1 || n > 8760) { await reply(ctx, tr('sd929_valid_hours')); return true; } expTarget(s).expiryHours = n; await onExpiryChosen(ctx); return true; }
    if (step === 'ad_days')  { const n = +normalizeDigits(text); if (!isQty(text) || n < 1 || n > 365) { await reply(ctx, tr('sd930_valid_days')); return true; } expTarget(s).expiryDays = n; await onExpiryChosen(ctx); return true; }
    // مهمة ١٠ — تاريخ بداية العرض (نصّي) ضمن «بتاريخ محدّد».
    if (step === 'ad_dealstart') { const dt = parseFlexibleDate(text); if (!dt || dt.ms < Date.now() + MIN_LEAD) { await reply(ctx, tr('sd_date_future')); return true; } const tt = expTarget(s); tt.startsAt = dt.ms; tt.scheduleDone = true; await askEndDate(ctx); return true; }
    if (step === 'ad_date')  { const dt = parseFlexibleDate(text); const tt = expTarget(s); const anchor = tt.startsAt && tt.startsAt > Date.now() ? tt.startsAt : Date.now(); if (!dt || dt.ms <= anchor) { await reply(ctx, tr('sd933_end_after_start')); return true; } tt.expiryEndMs = dt.ms; tt.expiryDateIso = dt.iso; await onExpiryChosen(ctx); return true; }
    if (step === 'ad_qty')   { if (!isQty(text)) { await reply(ctx, tr('sd934_send_quantity')); return true; } const tq = expTarget(s); tq.qty = +normalizeDigits(text); tq.unlimited = false; await onQtyChosen(ctx); return true; }
    if (step === 'ad_startdate') { const dt = parseFlexibleDate(text); if (!dt || dt.ms < Date.now() + MIN_LEAD) { await reply(ctx, tr('sd_date_future')); return true; } await onScheduleChosen(ctx, dt.ms, false); return true; }

    // ── موقع (رابط/إحداثيات) — مشترك ──
    if (step === 'loc_link') {
        const g = await resolveGoogleLocation(text);
        if (!g) { await reply(ctx, tr('sd940_location_not_understood')); return true; }
        await onLocationChosen(ctx, { location_id: null, custom_location_name: null, map_lat: g.lat, map_lng: g.lng, region: null, city: null, google: /^https?:\/\//i.test(text.trim()) ? text.trim() : null, name: 'موقع مخصّص' }, true);
        return true;
    }
    // ── فروع ──
    if (step === 'br_name')   { if (text.length < 2) { await reply(ctx, tr('sd945_location_name_too_short')); return true; } s.temp.branchName = text.slice(0, 60); askLocation(ctx, tr('sd945_location_for', md(text.slice(0, 60)))); return true; }
    if (step === 'br_rename') { if (text.length < 2) { await reply(ctx, tr('sd946_name_too_short')); return true; } setStep(tgId(ctx), 'idle'); const r = await rpc('bot_save_branch', { p_telegram_id: tgId(ctx), p_branch_id: s.temp.branchId, p_name: text.slice(0, 60) }); await reply(ctx, r?.success ? tr('sd946_name_updated') : tr('sd946_update_failed')); await showBranches(ctx); return true; }

    // ── تعديل ──
    if (step === 'ed_name') { if (text.length < 3) { await reply(ctx, tr('sd949_name_too_short')); return true; } const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.editDealId, p_item_name: text.slice(0, 120) }); await afterEditSave(ctx, r); return true; }
    if (step === 'ed_orig') { if (!isPrice(text)) { await reply(ctx, tr('sd950_send_valid_number')); return true; } t.deOrig = +normalizeDigits(text); setStep(tgId(ctx), 'ed_disc'); await reply(ctx, tr('sd950_now_send_discounted'), kbCancel()); return true; }
    if (step === 'ed_disc') { if (!isPrice(text) || +normalizeDigits(text) >= t.deOrig) { await reply(ctx, tr('sd951_must_be_less_than', md(String(t.deOrig)))); return true; } const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.editDealId, p_original_price: t.deOrig, p_discounted_price: +normalizeDigits(text) }); await afterEditSave(ctx, r); return true; }
    if (step === 'ed_desc') { const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.editDealId, p_description: text.slice(0, 500) }); await afterEditSave(ctx, r); return true; }
    if (step === 'ed_size') { const v = text.trim() === '-' ? '' : text.slice(0, 40); const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.editDealId, p_size: v }); await afterEditSave(ctx, r); return true; }
    return false;
}
async function handlePhoto(ctx, s) {
    if (s.step !== 'ad_photo' && s.step !== 'ed_photo') return false;
    const photos = ctx.message.photo || [];
    const fileId = photos[photos.length - 1]?.file_id;
    s.temp.photos = s.temp.photos || [];
    if (s.temp.photos.length >= MAX_IMAGES) { await reply(ctx, tr('sd961_max_images', MAX_IMAGES), photoProgressKb(s.temp.photos.length)); return true; }
    if (!fileId) { await reply(ctx, tr('sd962_image_read_failed')); return true; }
    await ctx.reply(tr('sd963_uploading_image')).catch(() => {});
    const url = await uploadPhoto(ctx, fileId);
    if (url) { s.temp.photos.push(url); await reply(ctx, tr('sd965_image_uploaded', s.temp.photos.length, MAX_IMAGES) + (s.temp.photos.length < MAX_IMAGES ? tr('sd965_send_more') : ''), photoProgressKb(s.temp.photos.length)); }
    else await reply(ctx, tr('sd966_image_upload_failed'), photoProgressKb(s.temp.photos.length));
    return true;
}
async function handleLocation(ctx, s, lat, lng) {
    if (s.step !== 'loc_share') return false;
    await onLocationChosen(ctx, { location_id: null, custom_location_name: null, map_lat: lat, map_lng: lng, region: null, city: null, google: null, name: 'موقعي المشترك' }, true);
    return true;
}

module.exports = { register, registerEditPickers };
