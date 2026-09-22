// اختبار «عدّل البوتين معاً» (v14.79) — قاعدةٌ في CLAUDE.md بلا حارس حتى اليوم.
// التشغيل:  node scripts/test-bot-parity.js
//
// 🪤 القاعدة ليست نظرية: v14.71 سجّلت عيباً وقع فعلاً — حقلٌ أُضيف لتيليجرام
//    ولم يُقرأ في واتساب إطلاقاً. والعيب من هذا الصنف **لا يظهر في أي بناء**:
//    الكود سليم في الملفّين، والناقص أن أحدهما لا يعرف الدالّة.
//
// المعيار: كل دالّة قاعدةٍ يناديها طرفٌ يجب أن يناديها الطرف الآخر — أو تكون
// في قائمة استثناءٍ **معلَّلة**. والقائمة تُقرأ، فسطرٌ بلا سبب يُرفض.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const TELEGRAM = ['server/bot.js', 'server/flows/sellerDeals.js'];
const WHATSAPP = ['server/flows/whatsapp.js'];

/**
 * استثناءات مقصودة — كلٌّ بسببه. أي اسمٍ هنا بلا سبب يُفشل الفحص.
 */
const EXCEPT = {
    // ── بنية تحتية يشغّلها **المسار الواحد** (عملية البوت نفسها تخدم القناتين) ──
    bot_pull_outbox:          'صندوق الصادر يُسحب مرّة واحدة للعمليّة كلّها ثم يُوزَّع على القناتين',
    bot_pull_email_outbox:    'طابور البريد يُسحب مرّة واحدة للعمليّة كلّها',
    bot_mark_email:           'تابعٌ لطابور البريد أعلاه',
    bot_report_email_status:  'تابعٌ لطابور البريد أعلاه',
    bot_report_gate:          'بلاغُ الإقلاع عن سرّ البوّابة — مرّة لكل عمليّة لا لكل قناة',
    bot_touch_chat:           'تحديث آخر ظهورٍ لمحادثة تيليجرام — لواتساب مساره الخاص',
    bot_is_enabled:           'مفتاح إيقاف تيليجرام؛ ولواتساب مفتاحه wa_bot_is_enabled',
    wa_bot_is_enabled:        'مفتاح إيقاف واتساب؛ ولتيليجرام مفتاحه bot_is_enabled',

    // ── فجوات خصائص حقيقية في واتساب، مسجّلة عمداً لا مسكوتٌ عنها ──────────
    // (واتساب نائم حتى تصل بيانات اعتماده — فهذه دَينٌ معلوم لا عيبٌ مخفيّ.)
    bot_booking_countdown:    'فجوة واتساب: العدّاد التنازلي للحجز',
    bot_get_store_reviews:    'فجوة واتساب: عرض تقييمات المتجر',
    bot_report:               'فجوة واتساب: الإبلاغ عن حساب',
    bot_store_contact:        'فجوة واتساب: بطاقة تواصل المتجر',
    bot_toggle_block:         'فجوة واتساب: حظر مستخدم',
    bot_vat_mode:             'فجوة واتساب: ضبط الوضع الضريبي',
};

const rpcNames = (files) => {
    const out = new Set();
    for (const f of files) {
        const s = fs.readFileSync(path.join(root, f), 'utf8');
        for (const m of s.matchAll(/\brpc\(\s*'([a-z0-9_]+)'/g)) out.add(m[1]);
        for (const m of s.matchAll(/\.rpc\(\s*'([a-z0-9_]+)'/g)) out.add(m[1]);
    }
    return out;
};

const tg = rpcNames(TELEGRAM);
const wa = rpcNames(WHATSAPP);

let pass = 0, fail = 0;
const report = (name, side) => {
    const why = EXCEPT[name];
    if (why && String(why).trim().length > 10) { pass++; return; }
    console.log(`❌ «${name}» يناديها ${side} وحدها${why ? ' (سببٌ مكتوب قصيرٌ جداً)' : ''}`);
    fail++;
};

for (const n of [...tg].sort()) if (!wa.has(n)) report(n, 'تيليجرام');
for (const n of [...wa].sort()) if (!tg.has(n)) report(n, 'واتساب');

// حارسٌ عكسيّ: استثناءٌ لم يعد له وجود = قائمةٌ تتعفّن
for (const n of Object.keys(EXCEPT)) {
    if (!tg.has(n) && !wa.has(n)) {
        console.log(`❌ الاستثناء «${n}» لم يعد يُنادى من أي بوت — يُحذف من القائمة`);
        fail++;
    }
}

const shared = [...tg].filter((x) => wa.has(x)).length;
console.log(`${fail === 0 ? '✅' : '❌'} تكافؤ البوتين: ${shared} دالّة مشتركة · ${pass} استثناءً معلَّلاً · ${fail} انحرافاً جديداً`);
process.exit(fail === 0 ? 0 : 1);
