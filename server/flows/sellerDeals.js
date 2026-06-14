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
const kbCancel  = () => Markup.inlineKeyboard([[btn('❌ إلغاء', 'sd:cancel')]]).reply_markup;
// كيبورد «رجوع + إلغاء» للخطوات النصّية (مهمة ١). الوجهة flow-aware عند اللزوم.
const kbBack    = backCb => Markup.inlineKeyboard([[btn('◀️ رجوع', backCb), btn('❌ إلغاء', 'sd:cancel')]]).reply_markup;
const backToExpiry = s => s.temp.flow === 'edit' ? `ede:expiry:${s.temp.editDealId}` : 'adb:expiry';
const backToQty    = s => s.temp.flow === 'edit' ? `ede:qty:${s.temp.editDealId}`    : 'adb:qty';
const toDeals   = () => Markup.inlineKeyboard([[btn('🏷 عروضي', 'seller:deals')], [btn('◀️ القائمة', 'menu:back')]]).reply_markup;
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
    if (a.expiryType === 'stock')    return `📦 بالكمية`;
    if (a.expiryType === 'hours')    return `⏱ ${md(String(a.expiryHours))} ساعة`;
    if (a.expiryType === 'duration') return `📅 ${md(String(a.expiryDays))} يوم`;
    if (a.expiryType === 'date')     return `🗓 حتى ${md(fmtDay(a.expiryEndMs))}`;
    return '—';
}

// ════════════════════════════════════════════════════════════════════════════════
function register(bot, deps) {
    ({ rpc, uploadPhoto, W, refreshSession, sendMain, KB_BACK } = deps);

    // ── إلغاء عام لكل تدفّقات التاجر ──────────────────────────────────────────────
    bot.action('sd:cancel', async ctx => {
        await ctx.answerCbQuery();
        setStep(tgId(ctx), 'idle'); resetTemp(getSession(tgId(ctx)));
        await ctx.reply('❌ *تم الإلغاء*', { parse_mode: 'MarkdownV2', reply_markup: Markup.removeKeyboard().reply_markup });
        await reply(ctx, '◀️ رجعناك للقائمة', KB_BACK().reply_markup);
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
    bot.action('ad:publish', async ctx => { await ctx.answerCbQuery('جاري النشر…'); doPublish(ctx); });

    // ── المقاس: منتقي سريع (مشترك add+edit) — أزرار جاهزة + كتابة حرّة + بدون + رجوع (مهمة ٢) ──
    bot.action(/^sz:set:([A-Za-z0-9]{1,12})$/, async ctx => { await ctx.answerCbQuery(); pickedSize(ctx, ctx.match[1]); });
    bot.action('sz:free', async ctx => { await ctx.answerCbQuery(); askSizeText(ctx); });
    bot.action('sz:none', async ctx => { await ctx.answerCbQuery(); pickedSize(ctx, null); });
    bot.action('sz:menu', async ctx => { await ctx.answerCbQuery(); showSizePicker(ctx); });

    // ── رجوع للخطوة السابقة في تدفّق الإضافة (مهمة ١) ──
    bot.action(/^adb:(name|cat|gender|size|desc|price|expiry|qty|sched|loc)$/, async ctx => {
        await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); if (!s.temp.add) return;
        const map = { name: askName, cat: askCategory, gender: askGender, size: askSize, desc: askDesc, price: askPrice, expiry: askExpiry, qty: askQty, sched: askSchedule, loc: askLocation };
        const fn = map[ctx.match[1]]; if (fn) return fn(ctx);
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
            ? '⏸ *تأكيد إيقاف العرض*\nسينتقل إلى «العروض المنتهية» ولن يراه المشترون\\.\nهل تريد إيقافه؟'
            : '▶️ *تأكيد تفعيل العرض*\nسيعود نشطاً وظاهراً للمشترين\\.\nهل تريد تفعيله؟';
        await reply(ctx, q, Markup.inlineKeyboard([[btn(st === 'paused' ? '⏸ نعم، أوقفه' : '▶️ نعم، فعّله', `toggle:${id}:${st}`)], [btn('◀️ تراجع', 'seller:deals')]]).reply_markup);
    });
    bot.action(/^toggle:([a-zA-Z0-9_-]+):(active|paused)$/, async ctx => {
        await ctx.answerCbQuery('جاري التحديث…');
        const [, id, st] = ctx.match;
        const r = await rpc('bot_toggle_deal', { p_telegram_id: tgId(ctx), p_deal_id: id, p_status: st });
        if (r?.success) await reply(ctx, st === 'active' ? '🟢 *تم التفعيل*' : '⏸ *تم الإيقاف*', toDeals());
        else if (r?.error === 'blocked') await reply(ctx, '⚠️ تعذّر التفعيل — تأكد من فعالية اشتراكك وحدّ المواقع في باقتك\\.', KB_BACK().reply_markup);
        else await reply(ctx, '⚠️ تعذّر التحديث\\.', KB_BACK().reply_markup);
    });
    bot.action(/^delDeal:([a-zA-Z0-9_-]+)$/, async ctx => {
        await ctx.answerCbQuery();
        getSession(tgId(ctx)).temp.delId = ctx.match[1];
        await reply(ctx, '🗑 *تأكيد الحذف*\nهل تحذف هذا العرض؟\n_لا يمكن حذف عرض عليه حجوزات معلّقة_', Markup.inlineKeyboard([[btn('⚠️ نعم، احذف', 'doDelDeal')], [btn('◀️ لا', 'seller:deals')]]).reply_markup);
    });
    bot.action('doDelDeal', async ctx => {
        await ctx.answerCbQuery('جاري الحذف…');
        const s = getSession(tgId(ctx));
        if (!s.temp.delId) return reply(ctx, '⚠️ انتهت الجلسة\\.', toDeals());
        const r = await rpc('bot_delete_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.delId });
        s.temp.delId = null;
        if (r?.success) await reply(ctx, '🗑 *تم حذف العرض*', toDeals());
        else await reply(ctx, r?.error === 'has_bookings' ? `❌ *لا يمكن الحذف*\nيوجد ${r.count} حجز معلّق\\. أتمّها أولاً\\.` : '⚠️ تعذّر الحذف\\.', toDeals());
    });

    // ════════ منتقي طريقة الانتهاء (مشترك add+edit) ═══════════════════════════════════
    bot.action(/^xp:(stock|hours|duration|date)$/, async ctx => { await ctx.answerCbQuery(); pickedExpiryType(ctx, ctx.match[1]); });
    bot.action(/^xpd:(\d+|custom)$/, async ctx => { await ctx.answerCbQuery(); pickedEndDate(ctx, ctx.match[1]); });

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
    bot.action('ph:reset', async ctx => { await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); s.temp.photos = []; await reply(ctx, '♻️ مُسحت الصور — أرسل صوراً جديدة \\(١ إلى ٤\\):', kbCancel()); });

    // ════════ مواقعي (الفروع) ═════════════════════════════════════════════════════════
    bot.action('seller:branches', async ctx => { await ctx.answerCbQuery(); showBranches(ctx); });
    bot.action('brAdd', async ctx => {
        await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); if (!isSeller(s)) return;
        resetTemp(s); s.temp.flow = 'branch'; s.temp.branchId = null;
        setStep(tgId(ctx), 'br_name');
        await reply(ctx, `➕ *إضافة موقع*\n${DIV}\nاكتب اسم الموقع \\(مثل: فرع النخيل\\):`, kbCancel());
    });
    bot.action(/^brEdit:([A-Za-z0-9_-]+)$/, async ctx => {
        await ctx.answerCbQuery(); const s = getSession(tgId(ctx)); s.temp.branchId = ctx.match[1];
        setStep(tgId(ctx), 'br_rename');
        await reply(ctx, '✏️ أرسل الاسم الجديد للموقع:', kbCancel());
    });
    bot.action(/^brMove:([A-Za-z0-9_-]+)$/, async ctx => {
        await ctx.answerCbQuery(); const s = getSession(tgId(ctx));
        resetTemp(s); s.temp.flow = 'branch'; s.temp.branchId = ctx.match[1]; s.temp.branchMove = true;
        askLocation(ctx, '📍 *تحديث موقع الفرع*');
    });
    bot.action(/^brDel:([A-Za-z0-9_-]+)$/, async ctx => {
        await ctx.answerCbQuery();
        await reply(ctx, '🗑 *تأكيد حذف الموقع*\nهل تريد حذف هذا الموقع؟', Markup.inlineKeyboard([[btn('🗑 نعم، احذف', `brDelYes:${ctx.match[1]}`)], [btn('◀️ لا', 'seller:branches')]]).reply_markup);
    });
    bot.action(/^brDelYes:([A-Za-z0-9_-]+)$/, async ctx => {
        await ctx.answerCbQuery('جاري الحذف…');
        const r = await rpc('bot_remove_branch', { p_telegram_id: tgId(ctx), p_branch_id: ctx.match[1] });
        if (r?.success) await reply(ctx, '🗑 *تم حذف الموقع*');
        else await reply(ctx, r?.error === 'locked' ? '❌ *لا يمكن الحذف*\nهذا الموقع مرتبط بعرض نشط — أوقف العرض أو انقله أولاً\\.' : '⚠️ تعذّر الحذف\\.');
        return showBranches(ctx);
    });
    bot.action(/^brSaveDeal:(\d+)$/, async ctx => {
        await ctx.answerCbQuery('جاري الحفظ…');
        const s = getSession(tgId(ctx)); const chip = (s.temp.locChips || [])[+ctx.match[1]];
        if (!chip) return reply(ctx, '⚠️ انتهت الجلسة، افتح «📍 مواقعي» من جديد\\.', Markup.inlineKeyboard([[btn('📍 مواقعي', 'seller:branches')]]).reply_markup);
        const r = await rpc('bot_save_branch', { p_telegram_id: tgId(ctx), p_name: chip.name || 'موقع', p_region: chip.region || null, p_city: chip.city || null, p_location_id: chip.location_id || null, p_map_lat: chip.map_lat ?? null, p_map_lng: chip.map_lng ?? null, p_google_maps_link: chip.google_maps_link || null });
        await reply(ctx, r?.success ? '✅ *تم حفظ الموقع في مواقعك*' : '⚠️ تعذّر الحفظ\\.');
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
    await reply(ctx, `🏷 *عروضي*\n${DIV}\nاختر نوع العروض التي تريد عرضها:`, Markup.inlineKeyboard([
        [btn('🟢 العروض النشطة', 'seller:deals:active'), btn('🔴 العروض المنتهية', 'seller:deals:ended')],
        [btn('➕ إضافة عرض', 'seller:addDeal'), btn('📍 مواقعي', 'seller:branches')],
        [btn('◀️ القائمة', 'menu:back')],
    ]).reply_markup);
}
function dealCardExpiry(d) {
    if (d.status === 'expired') return '⏰ *منتهٍ*';
    if (d.expiry_type === 'date' && d.expiry_date) return `🗓 ساري حتى: *${md(fmtDay(d.expiry_date))}*`;
    if (d.expiry_type === 'stock') return d.is_unlimited ? '♾ بلا تاريخ \\(حسب الكمية\\)' : '📦 ينتهي بنفاد الكمية';
    const r = remainingText(d); return r ? `⏳ ينتهي خلال: *${md(r)}*` : null;
}
async function showDeals(ctx, scope) {
    const s = getSession(tgId(ctx)); if (!isSeller(s)) return;
    const all = await rpc('bot_get_seller_deals', { p_telegram_id: tgId(ctx) });
    if (!all?.length) return reply(ctx, '📭 *لا توجد عروض بعد*', Markup.inlineKeyboard([[btn('➕ أضف أول عرض', 'seller:addDeal')], [btn('◀️ رجوع', 'menu:back')]]).reply_markup);
    const list = all.filter(d => scope === 'ended' ? dealEnded(d) : !dealEnded(d));
    const title = scope === 'ended' ? '🔴 *العروض المنتهية*' : '🟢 *العروض النشطة*';
    const other = scope === 'ended' ? ['🟢 النشطة', 'seller:deals:active'] : ['🔴 المنتهية', 'seller:deals:ended'];
    if (!list.length) return reply(ctx, `${title}\n${DIV}\n📭 لا يوجد عروض في هذا القسم\\.`, Markup.inlineKeyboard([[btn(other[0], other[1])], [btn('➕ إضافة عرض', 'seller:addDeal'), btn('◀️ رجوع', 'seller:deals')]]).reply_markup);
    const shown = list.slice(0, 12), more = list.length - shown.length;
    await reply(ctx, `${title} \\(${list.length}${more > 0 ? ` — أول ${shown.length}` : ''}\\)\n${DIV}\n_كل عرض في بطاقة وأزراره تحته 👇_`);
    for (let i = 0; i < shown.length; i++) {
        const d = shown[i];
        const qty = d.is_unlimited ? '♾ غير محدود' : `${d.quantity ?? '—'} قطعة`;
        let m = `*${i + 1}\\.* 🏷 *${md(d.item_name)}*\n${statusLabel(d.status)}\n💵 ${money(d.original_price)} ← 🟢 *${money(d.discounted_price)}* ر\\.س \\(${md(d.discount_percentage)}%\\)\n📦 ${md(qty)}`;
        if (d.category) m += `  •  🗂 ${md(catLabel(d.category))}`;
        const exp = dealCardExpiry(d); if (exp) m += `\n${exp}`;
        if (d.bookings_count) m += `\n📥 الحجوزات: *${d.bookings_count}*`;
        const tStatus = d.status === 'active' ? 'paused' : 'active';
        const tLabel  = d.status === 'active' ? '⏸ إيقاف' : '▶️ تفعيل';
        await reply(ctx, m, Markup.inlineKeyboard([[btn('✏️ تعديل', `dedit:${d.id}`), btn(tLabel, `tglAsk:${d.id}:${tStatus}`), btn('🗑 حذف', `delDeal:${d.id}`)]]).reply_markup);
    }
    await reply(ctx, `${DIV}${more > 0 ? `\n_يوجد ${more} عرض إضافي غير معروض._` : ''}`, Markup.inlineKeyboard([
        [btn(other[0], other[1]), btn('🔄 تحديث', scope === 'ended' ? 'seller:deals:ended' : 'seller:deals:active')],
        [btn('➕ إضافة عرض', 'seller:addDeal'), btn('◀️ القائمة', 'menu:back')],
    ]).reply_markup);
}

// ════════════════════════════════════════════════════════════════════════════════
//  إضافة عرض — معالج الخطوات
// ════════════════════════════════════════════════════════════════════════════════
async function startAdd(ctx) {
    const s = getSession(tgId(ctx)); if (!isSeller(s)) return;
    resetTemp(s); s.temp.flow = 'add'; s.temp.add = { images: [] };
    await reply(ctx, `➕ *إضافة عرض جديد*\n${DIV}`);
    return askName(ctx);
}
async function askName(ctx) {
    setStep(tgId(ctx), 'ad_name');
    await reply(ctx, '*الخطوة ١* — اكتب اسم المنتج أو الخدمة:', kbCancel());
}
async function askCategory(ctx) {
    setStep(tgId(ctx), 'idle');
    await reply(ctx, '*الخطوة ٢* — اختر تصنيف العرض:', Markup.inlineKeyboard([...catKeyboard('adcat:'), [btn('◀️ رجوع', 'adb:name'), btn('❌ إلغاء', 'sd:cancel')]]).reply_markup);
}
async function askGender(ctx) {
    setStep(tgId(ctx), 'idle');
    await reply(ctx, '*الخطوة ٣* — الفئة المستهدفة:', Markup.inlineKeyboard([
        [btn(GENDER.all, 'adgen:all'), btn(GENDER.men, 'adgen:men')],
        [btn(GENDER.women, 'adgen:women'), btn(GENDER.kids, 'adgen:kids')],
        [btn('◀️ رجوع', 'adb:cat'), btn('❌ إلغاء', 'sd:cancel')],
    ]).reply_markup);
}
// ── المقاس: منتقي سريع مشترك (add + edit) — يضمن ظهور خيارات دائماً (مهمة ٢) ──
const SIZE_PRESETS = ['S', 'M', 'L', 'XL', 'XXL'];
function sizePickerKb(isEdit, id) {
    const rows = [];
    for (let i = 0; i < SIZE_PRESETS.length; i += 3) rows.push(SIZE_PRESETS.slice(i, i + 3).map(z => btn(z, `sz:set:${z}`)));
    rows.push([btn('✏️ مقاس آخر', 'sz:free'), btn('🚫 بدون مقاس', 'sz:none')]);
    rows.push([btn('◀️ رجوع', isEdit ? `dedit:${id}` : 'adb:gender')]);
    return Markup.inlineKeyboard(rows).reply_markup;
}
async function askSize(ctx) { // سياق الإضافة
    setStep(tgId(ctx), 'idle');
    await reply(ctx, '*الخطوة ٤* — 📏 *المقاس* \\(اختياري\\)\nاختر مقاساً سريعاً، أو اكتب مقاساً حرّاً، أو «بدون»:', sizePickerKb(false));
}
function showSizePicker(ctx) { // مشترك — يُستدعى من sz:menu ومن التعديل
    const s = getSession(tgId(ctx));
    if (s.temp.flow === 'edit') {
        const d = s.temp.editDeal || {};
        return reply(ctx, `📏 *المقاس الحالي:* ${md(d.size || '—')}\n${DIV}\nاختر مقاساً جديداً أو اكتبه:`, sizePickerKb(true, s.temp.editDealId));
    }
    return askSize(ctx);
}
async function askSizeText(ctx) {
    const s = getSession(tgId(ctx));
    setStep(tgId(ctx), s.temp.flow === 'edit' ? 'ed_size' : 'ad_size');
    return reply(ctx, '✏️ اكتب المقاس \\(مثل: S, M, 42 أو أي وصف\\):', Markup.inlineKeyboard([[btn('◀️ رجوع', 'sz:menu')]]).reply_markup);
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
    setStep(tgId(ctx), 'ad_desc');
    await reply(ctx, '*الخطوة ٥* — وصف مختصر للعرض \\(اختياري\\):', Markup.inlineKeyboard([[btn('⏭ تخطّي الوصف', 'ad:skipDesc')], [btn('◀️ رجوع', 'adb:size'), btn('❌ إلغاء', 'sd:cancel')]]).reply_markup);
}
async function askPrice(ctx) {
    setStep(tgId(ctx), 'ad_orig');
    await reply(ctx, '*الخطوة ٦* — السعر الأصلي \\(ريال\\):\n_مثال: 250_', Markup.inlineKeyboard([[btn('◀️ رجوع', 'adb:desc'), btn('❌ إلغاء', 'sd:cancel')]]).reply_markup);
}
async function askExpiry(ctx) {
    setStep(tgId(ctx), 'idle');
    await reply(ctx, `*الخطوة ٨* — كيف ينتهي العرض؟ \\(مثل الموقع\\)`, Markup.inlineKeyboard([
        [btn('📦 بالكمية', 'xp:stock'), btn('⏱ بعدد ساعات', 'xp:hours')],
        [btn('📅 بعدد أيام', 'xp:duration'), btn('🗓 بتاريخ محدّد', 'xp:date')],
        [btn('◀️ رجوع', 'adb:price'), btn('❌ إلغاء', 'sd:cancel')],
    ]).reply_markup);
}

// ════════════════════════════════════════════════════════════════════════════════
//  طريقة الانتهاء (مشترك add + edit) — السياق في s.temp.flow
// ════════════════════════════════════════════════════════════════════════════════
function expTarget(s) { return s.temp.flow === 'edit' ? (s.temp.edraft || (s.temp.edraft = {})) : s.temp.add; }
async function pickedExpiryType(ctx, type) {
    const s = getSession(tgId(ctx)); const t = expTarget(s); if (!t) return;
    t.expiryType = type;
    if (type === 'stock')    { t.expiryHours = null; t.expiryDays = null; t.expiryEndMs = null; t.expiryDateIso = null; return onExpiryChosen(ctx); }
    if (type === 'hours')    { setStep(tgId(ctx), 'ad_hours'); return reply(ctx, '⏱ كم *ساعة* يستمر العرض؟ \\(مثل: 6\\)', kbBack(backToExpiry(s))); }
    if (type === 'duration') { setStep(tgId(ctx), 'ad_days');  return reply(ctx, '📅 كم *يوماً* يستمر العرض؟ \\(مثل: 7\\)', kbBack(backToExpiry(s))); }
    return askEndDate(ctx);
}
async function askEndDate(ctx) {
    setStep(tgId(ctx), 'idle');
    await reply(ctx, `🗓 *تاريخ نهاية العرض*\nاختر مدة سريعة أو اكتب تاريخاً محدّداً\\.\n_موعد البدء تحدّده خطوة «عرض قادم»_`, Markup.inlineKeyboard([
        [btn('أسبوع', 'xpd:7'), btn('أسبوعين', 'xpd:14')],
        [btn('شهر', 'xpd:30'), btn('شهرين', 'xpd:60'), btn('٣ أشهر', 'xpd:90')],
        [btn('✏️ تاريخ محدّد (اكتبه)', 'xpd:custom')],
        [btn('❌ إلغاء', 'sd:cancel')],
    ]).reply_markup);
}
async function pickedEndDate(ctx, key) {
    const s = getSession(tgId(ctx)); const t = expTarget(s); if (!t) return;
    if (key === 'custom') { setStep(tgId(ctx), 'ad_date'); return reply(ctx, '✏️ اكتب تاريخ النهاية \\(مثل: 2026\\-08\\-15 أو 15/8/2026\\):', kbBack(backToExpiry(s))); }
    const ms = Date.now() + (+key) * DAY_MS;
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
    const rows = [[btn('5', 'xq:5'), btn('10', 'xq:10'), btn('20', 'xq:20'), btn('50', 'xq:50')], [btn('✏️ كمية أخرى', 'xq:custom')]];
    if (!stock) rows.splice(1, 0, [btn('♾ غير محدود', 'xq:unlimited')]);
    const back = s.temp.flow === 'edit' ? btn('◀️ رجوع', `dedit:${s.temp.editDealId}`) : btn('◀️ رجوع', 'adb:expiry');
    rows.push([back, btn('❌ إلغاء', 'sd:cancel')]);
    await reply(ctx, `*الخطوة ٩* — الكمية المتاحة${stock ? ' \\(إجباري لعرض الكمية\\)' : ''}:`, Markup.inlineKeyboard(rows).reply_markup);
}
async function pickedQty(ctx, key) {
    const s = getSession(tgId(ctx)); const t = expTarget(s); if (!t) return;
    if (key === 'custom') { setStep(tgId(ctx), 'ad_qty'); return reply(ctx, '✏️ اكتب الكمية المتاحة \\(رقم\\):', kbBack(backToQty(s))); }
    if (key === 'unlimited') { t.unlimited = true; t.qty = null; } else { t.unlimited = false; t.qty = +key; }
    return onQtyChosen(ctx);
}
async function onQtyChosen(ctx) {
    const s = getSession(tgId(ctx));
    if (s.temp.flow === 'edit') return saveEditField(ctx, 'qty');
    return askSchedule(ctx);
}

// ════════════════════════════════════════════════════════════════════════════════
//  الجدولة / عرض قادم (مشترك)
// ════════════════════════════════════════════════════════════════════════════════
async function askSchedule(ctx) {
    setStep(tgId(ctx), 'idle');
    await reply(ctx, `*الخطوة ١٠* — *عرض قادم؟* \\(مجدول\\)\nهل تريد جدولة بدء العرض في وقت لاحق؟`, Markup.inlineKeyboard([
        [btn('🚀 لا، انشره الآن', 'xs:now')],
        [btn('🗓 نعم، جدولة موعد البدء', 'xs:set')],
        [btn('◀️ رجوع', 'adb:qty'), btn('❌ إلغاء', 'sd:cancel')],
    ]).reply_markup);
}
async function askStartDate(ctx) {
    setStep(tgId(ctx), 'idle');
    await reply(ctx, `🗓 *موعد بدء العرض القادم*\nاختر موعداً سريعاً أو اكتب تاريخاً:`, Markup.inlineKeyboard([
        [btn('غداً', 'xsd:1'), btn('بعد ٣ أيام', 'xsd:3'), btn('بعد أسبوع', 'xsd:7')],
        [btn('✏️ تاريخ محدّد (اكتبه)', 'xsd:custom')],
        [btn('❌ إلغاء', 'sd:cancel')],
    ]).reply_markup);
}
async function pickedStartDate(ctx, key) {
    if (key === 'custom') { setStep(tgId(ctx), 'ad_startdate'); return reply(ctx, '✏️ اكتب تاريخ البدء \\(مثل: 2026\\-08\\-01\\):', kbBack('xs:set')); }
    const ms = Date.now() + (+key) * DAY_MS;
    return onScheduleChosen(ctx, ms, false);
}
async function onScheduleChosen(ctx, startsAt, clear) {
    const s = getSession(tgId(ctx));
    if (s.temp.flow === 'edit') {
        const id = s.temp.editDealId;
        const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: id, p_starts_at: startsAt || null, p_clear_schedule: !!clear });
        if (!r?.success) return reply(ctx, '⚠️ تعذّر تحديث الجدولة\\.', toDeals());
        await reply(ctx, clear ? '✅ *أُلغيت الجدولة — العرض ينشر الآن*' : `✅ *تمت الجدولة* — يبدأ ${md(fmtDate(startsAt))}`);
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
    const cap = r ? `📦 باقتك: ${r.used}/${r.max} موقع نشط` : '';
    const full = r && r.used >= r.max;
    // قائمة معرّفة لكل موقع محفوظ + رابط خريطة — لتعرف «أين كل موقع» وتختار بثقة (مهمة ٣).
    let savedList = '';
    chips.slice(0, 8).forEach((b, i) => {
        const u = chipMapUrl(b);
        const place = [b.city, b.region].filter(Boolean).join(' • ');
        const lk = u ? ` — [🗺 اعرض على الخريطة](${mdUrl(u)})` : '';
        savedList += `\n*${i + 1}\\.* 📍 *${md(String(b.name || 'موقع').slice(0, 40))}*${b.locked ? ' 🔒' : ''}${place ? ' — ' + md(place) : ''}${lk}`;
    });
    const rows = [];
    chips.slice(0, 8).forEach((b, i) => rows.push([btn(`${i + 1} • 📍 ${String(b.name || 'موقع').slice(0, 28)}${b.locked ? ' 🔒' : ''}`, `loc:pick:${i}`)]));
    rows.push([btn('🗺 منطقة → مدينة → مول/سوق', 'loc:region')]);
    rows.push([btn('🔗 رابط قوقل / إحداثيات', 'loc:link'), btn('📲 مشاركة موقعي', 'loc:share')]);
    const backBtn = s.temp.flow === 'branch' ? btn('◀️ مواقعي', 'seller:branches')
        : s.temp.flow === 'add' ? btn('◀️ رجوع', 'adb:sched')
        : btn('◀️ رجوع', `dedit:${s.temp.editDealId}`);
    rows.push([backBtn, btn('❌ إلغاء', 'sd:cancel')]);
    const head = intro || (s.temp.flow === 'add' ? '*الخطوة ١١* — 📍 *أين موقع هذا العرض؟*' : '📍 *تغيير الموقع*');
    const tip = savedList ? `\n\n🗂 *مواقعك المحفوظة* — اضغط الرابط لتشوف مكان كل موقع 👇${savedList}` : '';
    await reply(ctx, `${head}\n${cap ? md(cap) + '\n' : ''}${full ? '⚠️ _وصلت حدّ باقتك — اختر موقعاً مستخدماً أو رقِّ باقتك_\n' : ''}اختر موقعاً محفوظاً بالأسفل، أو أضف جديداً 👇${tip}`, Markup.inlineKeyboard(rows).reply_markup);
}
async function pickSavedLoc(ctx, i) {
    const s = getSession(tgId(ctx)); const b = (s.temp.locChips || [])[i];
    if (!b) return reply(ctx, '⚠️ انتهت الجلسة، اختر الموقع من جديد\\.', kbCancel());
    return onLocationChosen(ctx, { location_id: b.location_id || null, custom_location_name: b.name || null, map_lat: b.map_lat ?? null, map_lng: b.map_lng ?? null, region: b.region || null, city: b.city || null, google: b.google_maps_link || null, name: b.name }, false);
}
async function pickRegion(ctx) {
    const regions = await rpc('bot_geo_regions', {}) || [];
    if (!regions.length) return reply(ctx, '⚠️ تعذّر تحميل المناطق — استخدم الرابط أو المشاركة\\.', backLocKb(ctx));
    const rows = []; for (let i = 0; i < regions.length; i += 2) rows.push(regions.slice(i, i + 2).map(r => btn(r.name, `loc:rg:${r.id}`)));
    rows.push([btn('◀️ رجوع', 'loc:menu')]);
    await reply(ctx, '🗺 *اختر المنطقة:*', Markup.inlineKeyboard(rows).reply_markup);
}
async function pickCity(ctx, regionId) {
    const s = getSession(tgId(ctx)); s.temp.pickRegion = regionId;
    const cities = await rpc('bot_geo_cities', { p_region: regionId }) || [];
    if (!cities.length) return reply(ctx, '⚠️ لا مدن لهذه المنطقة — استخدم الرابط أو المشاركة\\.', backLocKb(ctx));
    s.temp.pickCities = cities;
    const rows = []; for (let i = 0; i < cities.length; i += 2) rows.push(cities.slice(i, i + 2).map(c => btn(c.name, `loc:ct:${c.id}`)));
    rows.push([btn('◀️ المناطق', 'loc:region')]);
    await reply(ctx, '🏙 *اختر المدينة:*', Markup.inlineKeyboard(rows).reply_markup);
}
async function pickType(ctx, cityId) {
    const s = getSession(tgId(ctx)); s.temp.pickCity = cityId;
    const c = (s.temp.pickCities || []).find(x => x.id === cityId); s.temp.pickCityObj = c || null;
    await reply(ctx, '🏬 *نوع الموقع:*', Markup.inlineKeyboard([
        [btn('🛍️ مول', 'loc:tp:mall'), btn('🏛️ سوق', 'loc:tp:market')],
        [btn('📲 مشاركة موقعي بدل ذلك', 'loc:share'), btn('🔗 رابط قوقل', 'loc:link')],
        [btn('◀️ رجوع', `loc:rg:${s.temp.pickRegion}`)],
    ]).reply_markup);
}
async function pickLocList(ctx, type) {
    const s = getSession(tgId(ctx));
    const locs = await rpc('bot_geo_locations', { p_city: s.temp.pickCity, p_type: type }) || [];
    if (!locs.length) {
        return reply(ctx, `📭 لا يوجد ${type === 'mall' ? 'مولات' : 'أسواق'} مسجّلة في هذه المدينة\\.\nاستخدم الرابط أو مشاركة الموقع، أو حدّد المدينة كموقع\\.`, Markup.inlineKeyboard([
            [btn('📍 استخدام مركز المدينة', 'loc:tp:city')],
            [btn('🔗 رابط قوقل', 'loc:link'), btn('📲 مشاركة موقعي', 'loc:share')],
            [btn('◀️ رجوع', `loc:ct:${s.temp.pickCity}`)],
        ]).reply_markup);
    }
    s.temp.pickLocs = locs;
    const rows = locs.slice(0, 16).map((l, i) => [btn(`📍 ${String(l.name).slice(0, 36)}`, `loc:lc:${i}`)]);
    rows.push([btn('◀️ رجوع', `loc:ct:${s.temp.pickCity}`)]);
    await reply(ctx, `${type === 'mall' ? '🛍️ *اختر المول:*' : '🏛️ *اختر السوق:*'}`, Markup.inlineKeyboard(rows).reply_markup);
}
async function pickMapLocation(ctx, i) {
    const s = getSession(tgId(ctx)); const l = (s.temp.pickLocs || [])[i];
    if (!l) return reply(ctx, '⚠️ انتهت الجلسة، اختر من جديد\\.', backLocKb(ctx));
    const c = s.temp.pickCityObj;
    return onLocationChosen(ctx, { location_id: l.id, custom_location_name: l.name, map_lat: l.lat, map_lng: l.lng, region: s.temp.pickRegion || (c && c.regionId) || null, city: s.temp.pickCity || null, google: null, name: l.name }, true);
}
// «مركز المدينة» كموقع مخصّص حين لا مولات/أسواق.
async function pickCityCenter(ctx) {
    const s = getSession(tgId(ctx)); const c = s.temp.pickCityObj;
    if (!c) return reply(ctx, '⚠️ انتهت الجلسة، اختر من جديد\\.', backLocKb(ctx));
    return onLocationChosen(ctx, { location_id: null, custom_location_name: c.name, map_lat: c.lat, map_lng: c.lng, region: s.temp.pickRegion || null, city: c.id, google: null, name: c.name }, true);
}
function backLocKb(ctx) { return Markup.inlineKeyboard([[btn('◀️ خيارات الموقع', 'loc:menu')]]).reply_markup; }
async function askLink(ctx) {
    setStep(tgId(ctx), 'loc_link');
    await reply(ctx, `🔗 *موقع عبر رابط قوقل أو إحداثيات*\nالصق *رابط قوقل ماب*، أو أرسل الإحداثيات \\(مثل: 24\\.71, 46\\.67\\):`, Markup.inlineKeyboard([[btn('◀️ خيارات الموقع', 'loc:menu')]]).reply_markup);
}
async function askShare(ctx) {
    setStep(tgId(ctx), 'loc_share');
    await ctx.reply('📲 اضغط الزر بالأسفل لمشاركة موقعك الحالي:', { reply_markup: Markup.keyboard([[Markup.button.locationRequest('📍 مشاركة موقعي الآن')], ['❌ إلغاء']]).resize().oneTime().reply_markup });
}
// عند اختيار/تحديد موقع نهائياً (من أي مصدر).
async function onLocationChosen(ctx, loc, isNew) {
    const s = getSession(tgId(ctx));
    await ctx.reply('✅ تم تحديد الموقع', { reply_markup: Markup.removeKeyboard().reply_markup }).catch(() => {});
    if (s.temp.flow === 'branch') {
        const name = s.temp.branchMove ? null : (s.temp.branchName || loc.name || loc.custom_location_name || 'موقع');
        const r = await rpc('bot_save_branch', { p_telegram_id: tgId(ctx), p_branch_id: s.temp.branchId || null, p_name: name, p_region: loc.region || null, p_city: loc.city || null, p_location_id: loc.location_id || null, p_map_lat: loc.map_lat ?? null, p_map_lng: loc.map_lng ?? null, p_google_maps_link: loc.google || null });
        await reply(ctx, r?.success ? `✅ *تم حفظ الموقع* «${md(r.name || name || 'موقع')}»` : '⚠️ تعذّر حفظ الموقع\\.');
        return showBranches(ctx);
    }
    if (s.temp.flow === 'edit') {
        const id = s.temp.editDealId;
        const r = await rpc('bot_set_deal_location', { p_telegram_id: tgId(ctx), p_deal_id: id, p_location_id: loc.location_id || null, p_custom_location_name: loc.custom_location_name || loc.name || null, p_map_lat: loc.map_lat ?? null, p_map_lng: loc.map_lng ?? null, p_region: loc.region || null, p_city: loc.city || null, p_google_maps_link: loc.google || null });
        if (!r?.success) { await reply(ctx, r?.error === 'blocked' ? '⚠️ هذا موقع جديد يتجاوز حدّ باقتك — اختر موقعاً مستخدماً أو رقِّ باقتك\\.' : '⚠️ تعذّر تحديث الموقع\\.', toDeals()); return openEdit(ctx, id); }
        await reply(ctx, '✅ *تم تحديث موقع العرض*');
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
    return reply(ctx, '💾 *تحفظه كموقع دائم؟*\nأضِفه إلى «📍 مواقعي» لتعيد استخدامه بسرعة في عروضك القادمة\\.', Markup.inlineKeyboard([
        [btn('💾 نعم، احفظه دائماً', 'loc:save:1')],
        [btn('↪️ لا، فقط لهذا العرض', 'loc:save:0')],
    ]).reply_markup);
}
async function finishSaveLocation(ctx, doSave) {
    const s = getSession(tgId(ctx));
    const loc = s.temp.pendingLoc; const kind = s.temp.locSaveCtx; const editId = s.temp.locSaveEditId;
    s.temp.pendingLoc = null; s.temp.locSaveCtx = null; s.temp.locSaveEditId = null;
    if (doSave && loc) {
        const r = await rpc('bot_save_branch', { p_telegram_id: tgId(ctx), p_name: loc.name || loc.custom_location_name || 'موقع', p_region: loc.region || null, p_city: loc.city || null, p_location_id: loc.location_id || null, p_map_lat: loc.map_lat ?? null, p_map_lng: loc.map_lng ?? null, p_google_maps_link: loc.google || null });
        await reply(ctx, r?.success ? '✅ *حُفظ الموقع في «مواقعي»* — جاهز لعروضك القادمة' : '⚠️ تعذّر حفظه كموقع دائم \\(قد تكون وصلت حدّ باقتك\\) — لكنه مُستخدَم في هذا العرض\\.');
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
    const head = s.temp.flow === 'edit' ? '🖼 *تغيير صور العرض*\nأرسل صوراً جديدة لتستبدل الحالية' : '*الخطوة ١٢* — 🖼 *صور المنتج*\nأرسل من *١ إلى ٤ صور* \\(إجباري صورة واحدة على الأقل\\)';
    const back = s.temp.flow === 'edit' ? `dedit:${s.temp.editDealId}` : 'adb:loc';
    await reply(ctx, `${head}\n_يمكنك إرسال عدة صور دفعة واحدة 📷_`, kbBack(back));
}
function photoProgressKb(n) {
    const rows = [];
    if (n >= 1) rows.push([btn(`✅ تم — متابعة (${n}/${MAX_IMAGES})`, 'ph:done')]);
    rows.push([btn('♻️ إعادة البدء', 'ph:reset'), btn('❌ إلغاء', 'sd:cancel')]);
    return Markup.inlineKeyboard(rows).reply_markup;
}
async function onPhotosDone(ctx) {
    const s = getSession(tgId(ctx)); const imgs = s.temp.photos || [];
    if (!imgs.length) return reply(ctx, '❗ أضف صورة واحدة على الأقل قبل المتابعة\\.', kbCancel());
    if (s.temp.flow === 'edit') {
        const id = s.temp.editDealId;
        const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: id, p_images: imgs });
        if (!r?.success) return reply(ctx, '⚠️ تعذّر حفظ الصور\\.', toDeals());
        await reply(ctx, `✅ *تم تحديث الصور* \\(${imgs.length}\\)`);
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
        `📋 *مراجعة العرض قبل النشر*\n${DIV}\n🏷 *${md(a.name)}*\n🗂 ${md(catLabel(a.category))}  •  ${md(genderLabel(a.gender))}${size}\n` +
        priceBlock(a.orig, a.disc, pct) +
        `\n⏳ الانتهاء: ${expirySummary(a)}\n📦 الكمية: ${qty}${sched}\n📍 الموقع: ${md(loc)}\n🖼 الصور: *${a.images.length}*${desc}\n${DIV}\n_سيُنشر ويظهر فوراً في الموقع والتطبيق والبوت بصوره_`,
        Markup.inlineKeyboard([[btn('✅ نشر العرض', 'ad:publish')], [btn('❌ إلغاء', 'sd:cancel')]]).reply_markup);
}
async function doPublish(ctx) {
    const s = getSession(tgId(ctx)); const a = s.temp.add;
    if (!a || !a.name) return reply(ctx, '⚠️ انتهت الجلسة\\.', toDeals());
    if (!a.images || !a.images.length) { setStep(tgId(ctx), 'ad_photo'); return reply(ctx, '❗ يجب إضافة صورة واحدة على الأقل\\.', kbCancel()); }
    const anchor = a.startsAt || Date.now();
    if (a.expiryType === 'date' && a.expiryEndMs && a.expiryEndMs <= anchor)
        return reply(ctx, '⚠️ تاريخ نهاية العرض يجب أن يكون بعد موعد البدء\\. عدّل التاريخ أو الجدولة\\.', Markup.inlineKeyboard([[btn('🗓 تعديل تاريخ النهاية', 'xp:date')], [btn('❌ إلغاء', 'sd:cancel')]]).reply_markup);
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
        const m = r?.error === 'invalid_price' ? '❌ السعر بعد الخصم يجب أن يكون أقل من الأصلي\\.'
            : overCap ? '📍 *تجاوزت حدّ المواقع في باقتك*\nاختر موقعاً مستخدماً مسبقاً، أو احذف موقعاً غير مستخدم، أو رقِّ باقتك\\.'
            : r?.error === 'blocked' ? '⚠️ تعذّر النشر — تأكد من فعالية اشتراكك وحدّ المواقع\\.' : '⚠️ تعذّر النشر، حاول لاحقاً\\.';
        return reply(ctx, m, Markup.inlineKeyboard([[btn('📍 مواقعي', 'seller:branches'), btn('💳 الاشتراك', 'seller:sub')], [btn('◀️ القائمة', 'menu:back')]]).reply_markup);
    }
    const liveLine = a.startsAt ? '🚀 *عرض قادم* — سيبدأ تلقائياً في موعده\\.' : 'العرض ظاهر الآن في الموقع والتطبيق والبوت ✅';
    await reply(ctx, `🎉 *تم النشر بنجاح\\!*\n${DIV}\nالخصم: *${r.discount}%*\n${liveLine}`, Markup.inlineKeyboard([[btn('🏷 عروضي', 'seller:deals'), btn('➕ عرض آخر', 'seller:addDeal')], [btn('◀️ القائمة', 'menu:back')]]).reply_markup);
}

// ════════════════════════════════════════════════════════════════════════════════
//  تعديل عرض (مطابق للموقع) — كل الحقول + إعادة تفعيل + معاينة
// ════════════════════════════════════════════════════════════════════════════════
async function getDeal(ctx, id) { return rpc('bot_get_seller_deal', { p_telegram_id: tgId(ctx), p_deal_id: id }); }
async function openEdit(ctx, id) {
    const s = getSession(tgId(ctx)); if (!isSeller(s)) return;
    const d = await getDeal(ctx, id);
    if (!d) return reply(ctx, '⚠️ العرض غير موجود في متجرك أو انتهت الجلسة\\.', Markup.inlineKeyboard([[btn('🏷 عروضي', 'seller:deals')]]).reply_markup);
    s.temp.editDealId = id; s.temp.editDeal = d; s.temp.flow = 'edit'; s.temp.edraft = {};
    const qty = d.is_unlimited ? '♾ غير محدود' : md(String(d.quantity ?? '—'));
    const exp = d.expiry_type === 'date' && d.expiry_date ? `🗓 حتى ${md(fmtDay(d.expiry_date))}` : d.expiry_type === 'stock' ? '📦 بالكمية' : (remainingText(d) ? `⏳ ${md(remainingText(d))}` : '—');
    const sched = d.starts_at && Number(d.starts_at) > Date.now() ? `\n🚀 مجدول: ${md(fmtDate(Number(d.starts_at)))}` : '';
    const cur = `${DIV}\n🏷 *${md(d.item_name)}*  •  ${statusLabel(d.status)}\n💵 ${money(d.original_price)} ← 🟢 ${money(d.discounted_price)} ر\\.س \\(${md(d.discount_percentage)}%\\)\n📦 ${qty}  •  🗂 ${md(catLabel(d.category))}  •  ${md(genderLabel(d.gender || 'all'))}\n📏 المقاس: ${md(d.size || '—')}  •  🖼 الصور: ${Array.isArray(d.images) ? d.images.length : 0}\n⏳ ${exp}${sched}`;
    const rows = [
        [btn('🏷 الاسم', `ede:name:${id}`), btn('💰 الأسعار', `ede:price:${id}`)],
        [btn('📦 الكمية', `ede:qty:${id}`), btn('📝 الوصف', `ede:desc:${id}`)],
        [btn('🗂 التصنيف', `ede:cat:${id}`), btn('👥 الفئة', `ede:gender:${id}`)],
        [btn('📏 المقاس', `ede:size:${id}`), btn('⏳ طريقة الانتهاء', `ede:expiry:${id}`)],
        [btn('🗓 الجدولة', `ede:sched:${id}`), btn('🖼 الصور', `ede:photos:${id}`)],
        [btn('📍 الموقع', `ede:loc:${id}`), btn('👁 معاينة', `ede:preview:${id}`)],
    ];
    if (dealEnded(d)) rows.push([btn('♻️ إعادة تفعيل بنفس الإعدادات', `ede:reactivate:${id}`)]);
    else rows.push([btn('⏸ إيقاف العرض', `tglAsk:${id}:paused`)]);
    rows.push([btn('🗑 حذف', `delDeal:${id}`), btn('◀️ رجوع', 'seller:deals')]);
    await reply(ctx, `✏️ *تعديل العرض*${cur}\n${DIV}\nاختر ما تريد تعديله — أو فعّله مباشرة بنفس الإعدادات:`, Markup.inlineKeyboard(rows).reply_markup);
}
async function editField(ctx, field, id) {
    const s = getSession(tgId(ctx));
    s.temp.editDealId = id; s.temp.flow = 'edit';
    const d = s.temp.editDeal && s.temp.editDeal.id === id ? s.temp.editDeal : await getDeal(ctx, id);
    if (!d) return reply(ctx, '⚠️ انتهت جلسة التعديل — افتح «✏️ تعديل» من جديد\\.', Markup.inlineKeyboard([[btn('🏷 عروضي', 'seller:deals')]]).reply_markup);
    s.temp.editDeal = d; s.temp.edraft = {};
    if (field === 'name')  { setStep(tgId(ctx), 'ed_name');  return reply(ctx, `🏷 *الاسم الحالي:* ${md(d.item_name || '—')}\n${DIV}\nأرسل الاسم الجديد:`, kbCancel()); }
    if (field === 'price') { setStep(tgId(ctx), 'ed_orig');  return reply(ctx, `💰 *الحالي:* ${money(d.original_price)} ← 🟢 ${money(d.discounted_price)} ر\\.س\n${DIV}\nأرسل *السعر الأصلي* الجديد:`, kbCancel()); }
    if (field === 'desc')  { setStep(tgId(ctx), 'ed_desc');  return reply(ctx, `📝 *الوصف الحالي:*\n_${md(d.description || '— لا يوجد —')}_\n${DIV}\nأرسل الوصف الجديد:`, kbCancel()); }
    if (field === 'size')  { return showSizePicker(ctx); }
    if (field === 'qty')   { s.temp.edraft = { expiryType: d.expiry_type }; return askQty(ctx); }
    if (field === 'cat')   { return reply(ctx, `🗂 *التصنيف الحالي:* ${md(catLabel(d.category))}\n${DIV}\nاختر التصنيف الجديد:`, Markup.inlineKeyboard([...catKeyboard('adcat:edit:'), [btn('❌ إلغاء', `dedit:${id}`)]]).reply_markup); }
    if (field === 'gender'){ return reply(ctx, `👥 *الفئة الحالية:* ${md(genderLabel(d.gender || 'all'))}\n${DIV}\nاختر الفئة:`, Markup.inlineKeyboard([[btn(GENDER.all, 'adgen:edit:all'), btn(GENDER.men, 'adgen:edit:men')], [btn(GENDER.women, 'adgen:edit:women'), btn(GENDER.kids, 'adgen:edit:kids')], [btn('❌ إلغاء', `dedit:${id}`)]]).reply_markup); }
    if (field === 'expiry'){ return askExpiry(ctx); }
    if (field === 'sched') { return reply(ctx, `🗓 *جدولة العرض*`, Markup.inlineKeyboard([[btn('▶️ ينشر الآن (إلغاء الجدولة)', 'xs:clear')], [btn('🗓 جدولة لموعد', 'xs:set')], [btn('◀️ رجوع', `dedit:${id}`)]]).reply_markup); }
    if (field === 'photos'){ return previewImagesThen(ctx, d, () => askPhotos(ctx)); }
    if (field === 'loc')   { return askLocation(ctx, '📍 *تغيير موقع العرض*'); }
    if (field === 'reactivate') { return reactivate(ctx, id); }
    if (field === 'preview')    { return previewDeal(ctx, d); }
}
// أزرار تعديل التصنيف/الفئة في سياق التعديل (prefix ...:edit:)
function registerEditPickers(bot) {
    bot.action(/^adcat:edit:([A-Za-z_]+)$/, async ctx => { await ctx.answerCbQuery('جاري الحفظ…'); const s = getSession(tgId(ctx)); const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.editDealId, p_category: ctx.match[1] }); afterEditSave(ctx, r); });
    bot.action(/^adgen:edit:([a-z]+)$/, async ctx => { await ctx.answerCbQuery('جاري الحفظ…'); const s = getSession(tgId(ctx)); const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.editDealId, p_gender: ctx.match[1] }); afterEditSave(ctx, r); });
    bot.action('loc:tp:city', async ctx => { await ctx.answerCbQuery(); pickCityCenter(ctx); });
}
async function reactivate(ctx, id) {
    const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: id, p_status: 'active' });
    if (r?.success) { await reply(ctx, '♻️ *تم تفعيل العرض بنفس الإعدادات* — ظاهر الآن للمشترين ✅'); return openEdit(ctx, id); }
    const overCap = r?.error === 'blocked' && /LOCATION_LIMIT/i.test(String(r?.detail || ''));
    return reply(ctx, overCap ? '📍 *تجاوزت حدّ المواقع* — احذف موقعاً أو رقِّ باقتك\\.' : '⚠️ تعذّر التفعيل — تأكد من فعالية اشتراكك\\.', Markup.inlineKeyboard([[btn('💳 الاشتراك', 'seller:sub'), btn('📍 مواقعي', 'seller:branches')], [btn('◀️ رجوع', `dedit:${id}`)]]).reply_markup);
}
// حفظ حقل تعديل عام ثم العودة لقائمة التعديل.
async function saveEditField(ctx, which) {
    const s = getSession(tgId(ctx)); const id = s.temp.editDealId; const t = s.temp.edraft || {}; const a = s.temp.add;
    let args = { p_telegram_id: tgId(ctx), p_deal_id: id };
    if (which === 'expiry') {
        const d = s.temp.editDeal || {};
        const anchor = (d.starts_at && Number(d.starts_at) > Date.now()) ? Number(d.starts_at) : Date.now();
        if (t.expiryType === 'date' && t.expiryEndMs && t.expiryEndMs <= anchor) return reply(ctx, '⚠️ تاريخ النهاية يجب أن يكون في المستقبل\\.', Markup.inlineKeyboard([[btn('🗓 إعادة المحاولة', `ede:expiry:${id}`)]]).reply_markup);
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
        const e = r?.error; const msg = e === 'invalid_price' ? '❌ السعر بعد الخصم يجب أن يكون أقل من الأصلي\\.' : e === 'not_found' ? '❌ العرض غير موجود\\.' : '⚠️ تعذّر التعديل\\.';
        return reply(ctx, msg, Markup.inlineKeyboard([[btn('◀️ رجوع', `dedit:${id}`)]]).reply_markup);
    }
    s.temp.editDeal = null; // أعد الجلب لإظهار القيمة المحدّثة
    await reply(ctx, '✅ *تم الحفظ*');
    return openEdit(ctx, id);
}
async function previewImagesThen(ctx, d, next) {
    const imgs = Array.isArray(d.images) ? d.images.filter(Boolean) : [];
    if (imgs.length) { try { await ctx.replyWithMediaGroup(imgs.slice(0, 4).map(u => ({ type: 'photo', media: u }))); } catch { /* ignore */ } }
    return next();
}
async function previewDeal(ctx, d) {
    const imgs = Array.isArray(d.images) ? d.images.filter(Boolean) : [];
    const cap = `👁 *معاينة كما يراها المشتري*\n${DIV}\n🏷 *${md(d.item_name)}*\n` + priceBlock(d.original_price, d.discounted_price, d.discount_percentage) + `\n📦 ${d.is_unlimited ? 'غير محدود' : md(String(d.quantity ?? '—'))}${d.size ? `\n📏 ${md(d.size)}` : ''}${d.description ? `\n📝 ${md(String(d.description).slice(0, 300))}` : ''}`;
    const back = Markup.inlineKeyboard([[btn('◀️ رجوع للتعديل', `dedit:${d.id}`)]]).reply_markup;
    if (imgs.length > 1) { try { await ctx.replyWithMediaGroup(imgs.slice(0, 4).map(u => ({ type: 'photo', media: u }))); } catch { /* ignore */ } return reply(ctx, cap, back); }
    if (imgs[0]) { try { return await ctx.replyWithPhoto(imgs[0], { caption: cap, parse_mode: 'MarkdownV2', reply_markup: back }); } catch { /* fall through */ } }
    return reply(ctx, cap + '\n\n_⚠️ لا صور — أضف صوراً من «🖼 الصور»_', back);
}

// ════════════════════════════════════════════════════════════════════════════════
//  مواقعي (الفروع) — كل المواقع (محفوظة + مواقع عروض) مع وسم وإتاحة حذف/تعديل
// ════════════════════════════════════════════════════════════════════════════════
function branchPlace(b) {
    if (b.map_lat != null && b.map_lng != null) return `[🗺 الموقع على الخريطة](https://www.google.com/maps/search/?api=1&query=${b.map_lat},${b.map_lng})`;
    if (b.google_maps_link) return `[🗺 الموقع](${b.google_maps_link})`;
    return '';
}
function branchWhere(b) { const p = [b.city, b.region].filter(Boolean); return p.length ? md(p.join(' • ')) : 'موقع مخصّص'; }
async function showBranches(ctx) {
    const s = getSession(tgId(ctx)); if (!isSeller(s)) return reply(ctx, '❗ للتجار فقط\\.');
    const r = await rpc('bot_list_branches', { p_telegram_id: tgId(ctx) });
    if (!r?.success) return reply(ctx, '⚠️ تعذّر تحميل المواقع\\.', KB_BACK().reply_markup);
    const branches = r.branches || []; s.temp.locChips = branches;
    const full = r.used >= r.max;
    let head = `📍 *مواقعي*\n${DIV}\n📦 باقتك: حتى *${r.max}* موقع نشط  •  المستخدَم الآن: *${r.used}*\n`;
    head += full ? `\n⚠️ _وصلت حدّ باقتك — احذف موقعاً غير مرتبط أو رقِّ باقتك_` : `\n_أضف موقعاً جديداً برابط قوقل، أو منطقة→مدينة→مول، أو بمشاركة موقعك 👇_`;
    await reply(ctx, head);
    for (let i = 0; i < branches.length; i++) {
        const b = branches[i]; const pl = branchPlace(b);
        const tag = b.locked ? '🔒 مرتبط بعرض نشط \\(محسوب من باقتك\\)' : '🟢 غير مرتبط بعرض — يمكنك حذفه أو تعديله';
        const m = `📍 *${md(b.name || 'موقع')}*${b.is_primary ? '  ⭐ الرئيسي' : ''}${b.is_active === false ? '  •  ⚪️ غير مفعّل' : ''}\n${branchWhere(b)}${pl ? '\n' + pl : ''}\n${tag}`;
        let kb;
        if (b.kind === 'deal') {
            // موقع عرض نشط غير محفوظ كفرع → اعرضه واسمح بحفظه (تعديله/حذفه عبر العرض نفسه).
            kb = Markup.inlineKeyboard([[btn('💾 احفظه في مواقعي', `brSaveDeal:${i}`)]]).reply_markup;
        } else {
            const row = [btn('✏️ إعادة تسمية', `brEdit:${b.id}`), btn('📍 تغيير الموقع', `brMove:${b.id}`)];
            const row2 = b.locked ? [] : [btn('🗑 حذف', `brDel:${b.id}`)];
            kb = Markup.inlineKeyboard(row2.length ? [row, row2] : [row]).reply_markup;
        }
        await reply(ctx, m, kb);
    }
    if (!branches.length) await reply(ctx, '📭 _لا مواقع بعد — أضف أول موقع 👇_');
    await reply(ctx, `${DIV}`, Markup.inlineKeyboard([
        [btn('➕ إضافة موقع جديد', 'brAdd')],
        [btn('🗺 إدارة على الخريطة', W('/seller')), btn('◀️ القائمة', 'menu:back')],
    ]).reply_markup);
}

// ════════════════════════════════════════════════════════════════════════════════
//  معالِجات النص/الصورة/الموقع (يناديها bot.js من معالِجاته المفردة)
//  تُرجِع true إن استهلكت الخطوة، وإلا false ليكمل bot.js.
// ════════════════════════════════════════════════════════════════════════════════
async function handleText(ctx, s, text) {
    const step = s.step || 'idle';
    const SELLER_STEPS = ['ad_name', 'ad_size', 'ad_desc', 'ad_orig', 'ad_disc', 'ad_hours', 'ad_days', 'ad_date', 'ad_qty', 'ad_startdate', 'loc_link', 'br_name', 'br_rename', 'ed_name', 'ed_orig', 'ed_disc', 'ed_desc', 'ed_size'];
    if (!SELLER_STEPS.includes(step)) return false;

    // إلغاء من كيبورد الرد أثناء أي خطوة تاجر.
    if (text === '❌ إلغاء') { setStep(tgId(ctx), 'idle'); resetTemp(s); await ctx.reply('تم الإلغاء\\.', { parse_mode: 'MarkdownV2', reply_markup: Markup.removeKeyboard().reply_markup }); const ns = await refreshSession(ctx); await sendMain(ctx, ns); return true; }

    const a = s.temp.add || {}; const t = s.temp.edraft || (s.temp.edraft = {});
    // ── إضافة ──
    if (step === 'ad_name') { if (text.length < 3) { await reply(ctx, '❗ الاسم قصير جداً، اكتب اسماً أوضح:'); return true; } a.name = text.slice(0, 120); await askCategory(ctx); return true; }
    if (step === 'ad_size') { a.size = text.slice(0, 40); await askDesc(ctx); return true; }
    if (step === 'ad_desc') { a.desc = text.slice(0, 500); await askPrice(ctx); return true; }
    if (step === 'ad_orig') { if (!isPrice(text)) { await reply(ctx, '❗ أرسل رقماً صحيحاً، مثل: `150`'); return true; } a.orig = +normalizeDigits(text); setStep(tgId(ctx), 'ad_disc'); await reply(ctx, '*الخطوة ٧* — السعر بعد الخصم \\(ريال\\):', kbBack('adb:price')); return true; }
    if (step === 'ad_disc') { if (!isPrice(text) || +normalizeDigits(text) >= a.orig) { await reply(ctx, `❗ يجب أن يكون أقل من ${md(String(a.orig))} ر\\.س`); return true; } a.disc = +normalizeDigits(text); await askExpiry(ctx); return true; }
    if (step === 'ad_hours') { const n = +normalizeDigits(text); if (!isQty(text) || n < 1 || n > 8760) { await reply(ctx, '❗ أرسل عدد ساعات صحيح \\(1 إلى 8760\\):'); return true; } expTarget(s).expiryHours = n; await onExpiryChosen(ctx); return true; }
    if (step === 'ad_days')  { const n = +normalizeDigits(text); if (!isQty(text) || n < 1 || n > 365) { await reply(ctx, '❗ أرسل عدد أيام صحيح \\(1 إلى 365\\):'); return true; } expTarget(s).expiryDays = n; await onExpiryChosen(ctx); return true; }
    if (step === 'ad_date')  { const dt = parseFlexibleDate(text); if (!dt || dt.ms <= Date.now()) { await reply(ctx, '❗ تاريخ غير صالح أو في الماضي\\. اكتب مثل: `2026-08-15`'); return true; } const tt = expTarget(s); tt.expiryEndMs = dt.ms; tt.expiryDateIso = dt.iso; await onExpiryChosen(ctx); return true; }
    if (step === 'ad_qty')   { if (!isQty(text)) { await reply(ctx, '❗ أرسل رقم الكمية، مثل `10`'); return true; } const tq = expTarget(s); tq.qty = +normalizeDigits(text); tq.unlimited = false; await onQtyChosen(ctx); return true; }
    if (step === 'ad_startdate') { const dt = parseFlexibleDate(text); if (!dt || dt.ms < Date.now() + MIN_LEAD) { await reply(ctx, '❗ يجب أن يكون موعد البدء في المستقبل \\(بعد ١٠ دقائق على الأقل\\)\\. اكتب مثل: `2026-08-01`'); return true; } await onScheduleChosen(ctx, dt.ms, false); return true; }

    // ── موقع (رابط/إحداثيات) — مشترك ──
    if (step === 'loc_link') {
        const g = await resolveGoogleLocation(text);
        if (!g) { await reply(ctx, '❗ لم أفهم الموقع\\.\nالصق *رابط قوقل ماب* أو أرسل الإحداثيات \\(مثل: 24\\.71, 46\\.67\\)\\.'); return true; }
        await onLocationChosen(ctx, { location_id: null, custom_location_name: null, map_lat: g.lat, map_lng: g.lng, region: null, city: null, google: /^https?:\/\//i.test(text.trim()) ? text.trim() : null, name: 'موقع مخصّص' }, true);
        return true;
    }
    // ── فروع ──
    if (step === 'br_name')   { if (text.length < 2) { await reply(ctx, '❗ اسم الموقع قصير جداً:'); return true; } s.temp.branchName = text.slice(0, 60); askLocation(ctx, `📍 *موقع «${md(text.slice(0, 60))}»*`); return true; }
    if (step === 'br_rename') { if (text.length < 2) { await reply(ctx, '❗ الاسم قصير جداً:'); return true; } setStep(tgId(ctx), 'idle'); const r = await rpc('bot_save_branch', { p_telegram_id: tgId(ctx), p_branch_id: s.temp.branchId, p_name: text.slice(0, 60) }); await reply(ctx, r?.success ? '✅ *تم تحديث اسم الموقع*' : '⚠️ تعذّر التحديث\\.'); await showBranches(ctx); return true; }

    // ── تعديل ──
    if (step === 'ed_name') { if (text.length < 3) { await reply(ctx, '❗ الاسم قصير جداً:'); return true; } const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.editDealId, p_item_name: text.slice(0, 120) }); await afterEditSave(ctx, r); return true; }
    if (step === 'ed_orig') { if (!isPrice(text)) { await reply(ctx, '❗ أرسل رقماً صحيحاً، مثل: `150`'); return true; } t.deOrig = +normalizeDigits(text); setStep(tgId(ctx), 'ed_disc'); await reply(ctx, '💰 الآن أرسل *السعر بعد الخصم* \\(ريال\\):', kbCancel()); return true; }
    if (step === 'ed_disc') { if (!isPrice(text) || +normalizeDigits(text) >= t.deOrig) { await reply(ctx, `❗ يجب أن يكون أقل من ${md(String(t.deOrig))} ر\\.س`); return true; } const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.editDealId, p_original_price: t.deOrig, p_discounted_price: +normalizeDigits(text) }); await afterEditSave(ctx, r); return true; }
    if (step === 'ed_desc') { const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.editDealId, p_description: text.slice(0, 500) }); await afterEditSave(ctx, r); return true; }
    if (step === 'ed_size') { const v = text.trim() === '-' ? '' : text.slice(0, 40); const r = await rpc('bot_update_deal', { p_telegram_id: tgId(ctx), p_deal_id: s.temp.editDealId, p_size: v }); await afterEditSave(ctx, r); return true; }
    return false;
}
async function handlePhoto(ctx, s) {
    if (s.step !== 'ad_photo' && s.step !== 'ed_photo') return false;
    const photos = ctx.message.photo || [];
    const fileId = photos[photos.length - 1]?.file_id;
    s.temp.photos = s.temp.photos || [];
    if (s.temp.photos.length >= MAX_IMAGES) { await reply(ctx, `📸 وصلت الحد الأقصى \\(${MAX_IMAGES} صور\\) — اضغط «تم»\\.`, photoProgressKb(s.temp.photos.length)); return true; }
    if (!fileId) { await reply(ctx, '❗ تعذّر قراءة الصورة، حاول مجدداً\\.'); return true; }
    await ctx.reply('⏳ جاري رفع الصورة…').catch(() => {});
    const url = await uploadPhoto(ctx, fileId);
    if (url) { s.temp.photos.push(url); await reply(ctx, `✅ صورة ${s.temp.photos.length}/${MAX_IMAGES} مرفوعة\\.${s.temp.photos.length < MAX_IMAGES ? ' أرسل المزيد أو اضغط «تم»\\.' : ''}`, photoProgressKb(s.temp.photos.length)); }
    else await reply(ctx, '⚠️ تعذّر رفع الصورة — حاول صورة أخرى\\.', photoProgressKb(s.temp.photos.length));
    return true;
}
async function handleLocation(ctx, s, lat, lng) {
    if (s.step !== 'loc_share') return false;
    await onLocationChosen(ctx, { location_id: null, custom_location_name: null, map_lat: lat, map_lng: lng, region: null, city: null, google: null, name: 'موقعي المشترك' }, true);
    return true;
}

module.exports = { register, registerEditPickers };
