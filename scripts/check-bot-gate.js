// حارسُ بوّابة البوت (v15.49) — node scripts/check-bot-gate.js
//
// ── لماذا وُلد هذا الحارس ──────────────────────────────────────────────────
// فحصٌ مستقلّ أبلغ أن `bot_complete_booking` «ممنوحةٌ لـanon وبلا حارس»،
// لأن `pg_get_functiondef` لا يحوي `_bot_gate_ok`. **وكان بلاغاً كاذباً**:
// الدالّةُ تُعرّف المنادي بـ`_bot_uid()`، و`_bot_uid` **هي** التي تنادي
// `_bot_gate_ok` — فبلا الترويسة تعود NULL ويُردّ النداء. قِيس على الإنتاج
// من خارج القاعدة: بلا سرٍّ `not_seller`، وبسرٍّ صحيح `not_found`.
// ⇒ **الحراسةُ تُقاس بمسار النداء لا بورودِ اسمٍ في النصّ** (٧٢ من ٩٩ دالّة
//   تبدو بلا حارس وهي محروسة، و١٤ لا تحتاجه لأنها دليلٌ عامّ).
//
// وما بقي خطراً حقيقياً: دالّةُ `bot_*` **جديدة** تُكتب غداً تقرأ بيانات شخصٍ
// وتنسى المسارين معاً — تُمنح لـanon تلقائياً (فخُّ سوبابيس الموثَّق) فتصير
// باباً مفتوحاً بلا أيّ صوت. فهذا الحارسُ **قائمةُ سماحٍ لا منع**: كلُّ دالّةٍ
// تُفترض محتاجةً للحراسة إلا ما أُعلن ولماذا.
//
// 🪤 ومداه ملفّاتُ المستودع وحدها — و١٨٩ دالّة على الخادم ليست في أيّ ملفّ.
//    فهو يحرس الجديدَ لا يجرد القديم؛ وجردُ القديم استعلامٌ على جدة.
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'supabase');
const stripSql = (s) => s.replace(/^[ \t]*--[^\n]*$/gm, '').replace(/--[^\n]*$/gm, '');

/** دليلٌ عامّ: لا هويّةَ فيها ولا بياناتَ شخص — نفسُ ما يراه زائرُ الموقع. */
const PUBLIC_CATALOGUE = new Set([
    'bot__loc_key', 'bot_active_banners', 'bot_active_season', 'bot_browse_deals',
    'bot_geo_cities', 'bot_geo_locations', 'bot_geo_regions', 'bot_get_categories',
    'bot_get_store_reviews', 'bot_is_enabled', 'bot_list_packages',
    'bot_payments_enabled', 'bot_search', 'bot_season_campaign',
]);

/**
 * 🪤 ومدى الحكم: إصدارُ v15 وما بعده. ما قبله **نسخُه في المستودع أقدمُ من
 * الخادم** (١٨٩ دالّة لا ملفَّ لها أصلاً)، فحكمٌ عليها حكمٌ على نصٍّ ميت —
 * وقد قِيست خمسُها حيّاً في ٦ نوفمبر ٢٠٢٦ فكلُّها محروسةٌ بـ`_bot_uid`
 * (bot_add_deal · bot_get_seller_deal · bot_get_store · bot_list_branches ·
 * bot_update_deal). فتُعدّ ولا تُفشِل، ويُطبع عددُها فلا يختفي الدَّين.
 */
const JUDGE_FROM = 15.0;
/** رقمُ الإصدار من اسم الملفّ (v15_49 ⇒ 15.49)؛ وما لا رقمَ له قديمٌ. */
const verOf = (f) => {
    const m = f.match(/v(\d+)[_.](\d+)/i);
    return m ? Number(m[1]) + Number(m[2]) / 100 : 0;
};

/** غلافٌ يُفوّض الحراسةَ إلى دالّةٍ محروسة — ويُتحقَّق أنه يناديها فعلاً. */
const DELEGATES = { bot_delivery_quote: 'bot_delivery_quote_at' };

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

// 🪤 وتُرتَّب بالإصدار لا بالاسم: `migration_v11_73` تسبق `JEDDAH_v14_18`
//    أبجدياً (الكبيرُ قبل الصغير في ASCII) فكانت النسخةُ الأقدم تغلب الأحدث.
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql'))
    .sort((a, b) => verOf(a) - verOf(b));
const seen = new Map();   // الاسم ⇐ أحدثُ تعريفٍ له في المستودع

for (const f of files) {
    const sql = stripSql(fs.readFileSync(path.join(dir, f), 'utf8'));
    const re = /CREATE OR REPLACE FUNCTION public\.(bot_[a-z0-9_]+)\s*\(/g;
    let m;
    while ((m = re.exec(sql))) {
        const rest = sql.slice(m.index);
        const end = rest.search(/\$function\$\s*;|\$\$\s*;/);
        seen.set(m[1], { file: f, ver: verOf(f), body: end > 0 ? rest.slice(0, end) : rest });
    }
}

check('وُجدت دوالُّ بوتٍ في المستودع', seen.size > 0, 'نمطُ الاستخراج معطوب — فحصٌ لا يفحص');

let older = 0;
for (const [name, { file, ver, body }] of [...seen].sort()) {
    if (ver < JUDGE_FROM && !PUBLIC_CATALOGUE.has(name) && !DELEGATES[name]) { older++; continue; }
    if (PUBLIC_CATALOGUE.has(name)) {
        // 🪤 ومُعلَنةٌ «عامّة» لا يعني مُسلَّمةً: لا تلمس هويّةَ أحد.
        const touchesPeople = /\busers\b|\bbookings\b|\buser_addresses\b|\bbooking_messages\b|delivery_address|telegram_id|whatsapp_chat_id/.test(body);
        check(`${name}: دليلٌ عامّ بلا بياناتِ شخص`, !touchesPeople,
            `أُعلنت عامّةً في ${file} لكنّ جسمها يمسّ بياناتَ أشخاص — تُحذف من قائمة السماح أو تُحرَس`);
        continue;
    }
    if (DELEGATES[name]) {
        check(`${name}: غلافٌ يُفوّض إلى ${DELEGATES[name]}`,
            body.includes('public.' + DELEGATES[name] + '('),
            'أُعلن مُفوِّضاً ولا ينادي الدالّةَ المحروسة');
        continue;
    }
    check(`${name}: محروسةٌ بمسارٍ حقيقيّ`,
        body.includes('_bot_gate_ok') || body.includes('_bot_uid'),
        `${file}: لا `+'`_bot_gate_ok`'+` ولا `+'`_bot_uid`'+` — وسوبابيس تمنحها لـanon تلقائياً`);
}

console.log(`  ℹ ${older} دالّةً نسخُها في المستودع أقدمُ من v${JUDGE_FROM.toFixed(2)} — قِيست حيّاً، لا تُحكَم من نصٍّ ميت`);
console.log(fail === 0
    ? `\n✅ كلُّ دالّة بوتٍ في المستودع محروسةٌ أو مُعلَنةٌ عامّة (${pass} فحصاً)`
    : `\n❌ ${fail} فحصاً سقط من ${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
