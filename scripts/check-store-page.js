#!/usr/bin/env node
/**
 * حارسُ حمولة صفحة المتجر (v16.20) — node scripts/check-store-page.js
 *
 * ── ما يحرسه، وكلُّه مقيسٌ من الإنتاج ───────────────────────────────────
 * فتحٌ **مباشر** لـ`/store/<id>` كان **١٩ نداءً**، سبعةٌ منها عن نفس المتجر.
 * وأغربُها `users?select=*` التي تعود **`[]` لكلّ زائر** (RLS تحصر `users`).
 *
 *   ① لا عودةَ لنداءٍ مستقلٍّ من الصفحة (`findById` · الفروع · سقفُ الباقة).
 *   ② والأجوبةُ المجلوبةُ مع الحمولة **تُزرع بمفاتيح المنادين حرفاً بحرف** —
 *      مفتاحٌ مخالفٌ يُنتج نداءً زائداً **بلا أيّ خطأٍ ظاهر**.
 *   ③ وصفُّ المالك مقصورٌ على أعمدة الشاشة، لا `users` كاملاً.
 *   ④ والدالّةُ `SECURITY INVOKER` — وهي كلُّ ما يفصل الزائرَ عن صفّ المالك.
 *
 * 🪤 ويُجرَّد التعليقُ قبل أيّ فحصِ نصّ — هذا الملفُّ يذكر كلَّ ما يبحث عنه.
 */
const fs = require('fs');
const path = require('path');
const R = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/^\s*--[^\n]*$/gm, '');

let pass = 0, fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${n}`); if (!ok && d) console.log('      ' + d); ok ? pass++ : fail++; };

console.log('\nحمولةُ صفحة المتجر — نداءٌ واحد');

const page = strip(R('src/pages/StoreDetails.tsx'));
const hook = strip(R('src/hooks/useStorePage.ts'));
const sql = strip(R('supabase/JEDDAH_v16_20_store_page.sql'));

// ① لا نداءَ مستقلاً عاد إلى الصفحة
check('الصفحةُ تستعمل الحمولةَ الواحدة', /useStorePage\(/.test(page));
for (const [n, re] of [
    ['لا userRepository.findById فيها', /userRepository\s*\.\s*findById/],
    ['لا جلبَ فروعٍ مستقلّ', /branchRepository\s*\.\s*list(ByMerchant|Displayed)/],
    // 🪤 ويُضيَّق النمطُ إلى **سقف الباقة** وحده: قراءةُ `vat_number, cr_number`
    //    في نفس الملفّ مشروعةٌ وتقع عند **طباعة الفاتورة** لا عند فتح الصفحة،
    //    ونمطٌ عامٌّ على اسم الجدول كان سيتّهمها (فحصٌ يصرخ كذباً أسوأ من غيابه).
    ['لا قراءةَ لسقف الباقة مستقلّة', /select\(\s*['"]max_branches['"]/],
]) check(n, !re.test(page), 'عاد نداءٌ مستقلٌّ — والعقدُ نداءٌ واحد');

// ② الزرعُ بمفاتيح المنادين حرفاً بحرف
const keys = [
    ['store_policies', 'src/repositories/refundRepository.ts'],
    ['store_is_verified', 'src/repositories/verificationRepository.ts'],
    ['store_follower_count', 'src/repositories/userRepository.ts'],
];
for (const [k, file] of keys) {
    const caller = strip(R(file));
    const used = new RegExp('`' + k + ':\\$\\{storeId\\}`').test(caller);
    const primed = new RegExp('primeAsyncMemo\\(\\s*`' + k + ':\\$\\{storeId\\}`').test(hook);
    check(`«${k}» يُزرع بنفس مفتاح منادِيه`, used && primed,
        `المنادي=${used} · الزرع=${primed} — ومفتاحٌ مخالفٌ يُنتج نداءً زائداً بلا خطأ`);
}
// 🪤 ويُقاس داخل **كتلة النجاح** وحدها: `setData` ترد قبلها مرّتين (التصفير
//    ومسارُ الخطأ)، فمقارنةُ أوّلِ ورودٍ في الملفّ كانت تمرّ دائماً — كسرةُ
//    «انقل الزرعَ بعد التصيير» مرّت خضراء حتى ضُيِّق المدى.
{
    const ok = hook.indexOf('const row: any = p;');
    const body = ok > 0 ? hook.slice(ok) : '';
    check('والزرعُ يسبق التصيير',
        ok > 0 && body.indexOf('primeAsyncMemo') > 0
        && body.indexOf('primeAsyncMemo') < body.indexOf('setData({'),
        'لو صُيِّر قبل الزرع لسبق مكوّنٌ الزرعَ بنداءٍ من عنده');
}

// ③ عقدُ صفّ المالك
const ownerMatch = /'owner',\s*\(SELECT jsonb_build_object\(([\s\S]*?)\)\s*FROM public\.users/.exec(sql);
const ownerKeys = ownerMatch ? ownerMatch[1] : '';
const got = [...ownerKeys.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
check('صفُّ المالك مقصورٌ على أعمدة الشاشة',
    JSON.stringify(got) === JSON.stringify(['address', 'google_maps_link', 'id', 'lat', 'lng', 'name', 'shop']),
    `وجدتُ: ${got.join(', ')} — وجدولُ users يحمل consent_ip و telegram_link_otp و delivery_address`);
check('ولا to_jsonb(u) في الدالّة', !/to_jsonb\(u\)/.test(sql));

// ④ الأمان
check('الدالّةُ SECURITY INVOKER', (sql.match(/^SECURITY INVOKER$/gm) || []).length === 1);
check('ولا تقرأ * من store_profiles', !/store_profiles[^;]*to_jsonb/.test(sql));
check('والهجرةُ تُثبت نطاقَ الزائر بدور anon', /SET LOCAL ROLE anon/.test(sql));

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
