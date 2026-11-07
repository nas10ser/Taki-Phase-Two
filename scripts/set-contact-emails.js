#!/usr/bin/env node
/**
 * set-contact-emails.js — ينشر عناوينَ التواصل في صفحة «اتصل بنا».
 * ═══════════════════════════════════════════════════════════════════════════
 *   node scripts/set-contact-emails.js --show
 *   node scripts/set-contact-emails.js info@takisa.net complain@takisa.net --confirmed
 *   node scripts/set-contact-emails.js --off
 *
 * 🔴 ويشترط `--confirmed` صراحةً. السببُ أنني **لا أستطيع التحقّق**: حاولتُ
 *    فحصَ القبول بـRCPT TO بلا إرسال (فحصٌ قياسيٌّ لا يُرسل رسالة) من جهاز
 *    ناصر ومن خادم جدة، فكلاهما محجوبُ المنفذ ٢٥ — عادةُ مزوّدي السحابة.
 *    وعنوانٌ منشورٌ بلا صندوقٍ يستقبله **أسوأُ من غياب العنوان**: المستخدمُ
 *    يشكو ويظنّ أن شكواه وصلت، والمراجعُ في المتجر يُرسل ولا يُجاب. فالتأكيدُ
 *    بشريٌّ بالضرورة، ويُطلب باسمه لا بالسكوت عنه.
 *
 * 🪤 والصندوقُ يُنشأ من لوحة **زوهو** لا من عندي: MX الجذر إليه (مقيس).
 *    وإنشاؤه لا يمسّ الإرسالَ: ذاك من `send.takisa.net` بـSPF أمازون/Resend
 *    مستقلٍّ تماماً — ولا يحتاج سجلَّ SPF ثانياً على الجذر (وهو ممنوعٌ بأمرك).
 */
const { execFileSync } = require('child_process');

const KEY = process.env.TAKI_SSH_KEY || `${process.env.HOME}/.ssh/taki_jeddah2`;
const HOST = process.env.TAKI_SSH_HOST || 'ubuntu@207.127.99.122';
const one = (q) => String(q).replace(/\s+/g, ' ').trim();
const sql = (q) => execFileSync('ssh', ['-i', KEY, HOST,
    `sudo docker exec supabase-db psql -U supabase_admin -d postgres -At -c ${JSON.stringify(one(q))}`],
    { encoding: 'utf8', maxBuffer: 8 << 20 }).trim();

if (sql("SELECT COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')")
    === 'TAKI_LAB_TOKYO_MARKER_v1382') { console.error('❌ قاعدةُ المختبر.'); process.exit(1); }

const show = () => console.log('  المنشورُ الآن: '
    + (sql("SELECT COALESCE(value::text,'(غائب)') FROM public.platform_settings WHERE key='contact_emails'") || '(غائب)'));

const args = process.argv.slice(2);
if (!args.length || args.includes('--show')) { show(); process.exit(0); }

if (args.includes('--off')) {
    sql(`UPDATE public.platform_settings SET value='{"info": "", "complain": ""}'::jsonb
          WHERE key='contact_emails'`);
    const v = sql("SELECT value::text FROM public.platform_settings WHERE key='contact_emails'");
    if (!/"info": ""/.test(v)) { console.error('❌ لم يُثبت الإخفاء بالقراءة: ' + v); process.exit(1); }
    console.log('✅ أُخفيت العناوينُ من الصفحة.');
    process.exit(0);
}

const addrs = args.filter((a) => !a.startsWith('--'));
const RE = /^[^\s@]+@([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/;
for (const a of addrs) {
    if (!RE.test(a)) { console.error(`❌ صيغةٌ غيرُ صالحة: ${a}`); process.exit(1); }
}
if (!addrs.length) { console.error('❌ لا عنوان. الاستعمال في ترويسة الملفّ.'); process.exit(1); }

// 🪤 ولا عنوانٌ على نطاقٍ غيرِ نطاقنا: بريدُ جيميل في صفحةٍ قانونيّةٍ يُضعف
//    الثقةَ ويُخالف توقّعَ الجهات، وخطأُ كتابةٍ في النطاق يُسلّم الشكاوى لغيرنا.
const OWN = 'takisa.net';
for (const a of addrs) {
    if (!a.toLowerCase().endsWith('@' + OWN)) {
        console.error(`❌ «${a}» ليس على ${OWN} — لا يُنشر عنوانٌ من نطاقٍ آخر\n`
                    + '   في صفحةٍ قانونيّة، وخطأُ نطاقٍ يُسلّم الشكاوى لغير أهلها.');
        process.exit(1);
    }
}

const info = addrs.find((a) => /^info@/i.test(a)) || '';
const complain = addrs.find((a) => /^(complain|complaints|shakwa)@/i.test(a)) || '';
if (!info && !complain) {
    console.error('❌ لم يُعرف دورُ أيّ عنوان. يُتوقَّع `info@…` و/أو `complain@…`.');
    process.exit(1);
}
console.log(`  للنشر: info=«${info || '—'}» · complain=«${complain || '—'}»`);

if (!args.includes('--confirmed')) {
    console.error('\n❌ ناقصٌ `--confirmed`.');
    console.error('   لا أستطيع التحقّقَ من وجود الصندوق: المنفذُ ٢٥ محجوبٌ من جهازك');
    console.error('   ومن خادم جدة معاً، فلا فحصَ قبولٍ ممكن. والنشرُ بلا تحقّقٍ يعني');
    console.error('   مستخدماً يشكو إلى الفراغ وهو يظنّ أن شكواه وصلت.');
    console.error('\n   تأكّد من لوحة زوهو أن الصندوقَ موجودٌ ويستقبل، ثمّ أعِد الأمر');
    console.error('   بـ`--confirmed` في آخره.');
    process.exit(2);
}

sql(`UPDATE public.platform_settings
        SET value = jsonb_build_object('info', ${JSON.stringify(info)},
                                       'complain', ${JSON.stringify(complain)})
      WHERE key='contact_emails'`);
const back = sql("SELECT (value->>'info')||'|'||(value->>'complain') FROM public.platform_settings WHERE key='contact_emails'");
if (back !== `${info}|${complain}`) {
    console.error(`❌ لم تُثبت الكتابةُ بالقراءة: «${back}»`); process.exit(1);
}
console.log('✅ نُشرت في صفحة «اتصل بنا» — وتُخفى فوراً بـ--off.');
