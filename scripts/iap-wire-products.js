#!/usr/bin/env node
/**
 * iap-wire-products.js — يربط معرّفاتَ منتجات المتجرين بباقاتنا (v15.67)
 * ═══════════════════════════════════════════════════════════════════════════
 * يُشغَّل مرّةً بعد إنشاء المنتجات في App Store Connect و Play Console:
 *
 *   node scripts/iap-wire-products.js \
 *     net.takisa.app.sub.loc1=1  net.takisa.app.sub.loc3=2  …
 *
 *   node scripts/iap-wire-products.js --list     # ما هو مربوطٌ الآن
 *   node scripts/iap-wire-products.js --check    # يتحقّق ولا يكتب
 *
 * 🪤 ولا يُكتب الربطُ في الكود: إنشاءُ منتَجٍ جديد في المتجرين يجب ألّا
 *    يحتاج نشرَ تطبيقٍ ومراجعةً أسبوعاً. المصدرُ `platform_settings.iap_products`،
 *    وهو مُدرَجٌ في قائمة سماح RLS (هجرة v15.67) — ولولاه عاد `SELECT` بصفر
 *    صفوفٍ **بلا خطأ** فظهرت الشاشةُ «لا باقات» بلا سبب.
 *
 * 🪤 ويُدمَج ولا يُدهَس: الربطُ تراكميّ، فإضافةُ باقةٍ لا تمحو الباقيات.
 * 🔴 ويُرفض معرّفُ باقةٍ غيرُ موجودٍ أو غيرُ مفعَّل: ربطٌ خاطئ يعني تاجراً
 *    يدفع لأبل ويُفعَّل له **غيرُ ما اشترى** — وهو عيبٌ لا يظهر إلا بشكوى.
 */

const { execFileSync } = require('child_process');

const KEY = process.env.TAKI_SSH_KEY || `${process.env.HOME}/.ssh/taki_jeddah2`;
const HOST = process.env.TAKI_SSH_HOST || 'ubuntu@207.127.99.122';

// 🪤 ويُسوّى الفراغُ إلى سطرٍ واحد قبل التمرير: `JSON.stringify` يحوّل السطرَ
//    الجديد إلى `\n` **حرفيّةً** داخل نصّ الصدفة، فيصل psql شرطةً مائلةً
//    و«n» فينفجر `syntax error at or near "\"`. وقع فعلاً.
// 🔴 وأخطرُ منه: الانهيارُ كان يُخرج بـ١ فبدا أن حارسَ «باقةٌ غير موجودة»
//    يعمل — وهو لم يُنادَ أصلاً. **خروجٌ بـ١ للسبب الخطأ يُبرّئ حارساً عاجزاً.**
const one = (q) => String(q).replace(/\s+/g, ' ').trim();
const sql = (q) => execFileSync('ssh', ['-i', KEY, HOST,
    `sudo docker exec supabase-db psql -U supabase_admin -d postgres -At -c ${JSON.stringify(one(q))}`],
    { encoding: 'utf8', maxBuffer: 8 << 20 }).trim();

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const checkOnly = args.includes('--check');
const pairs = args.filter((a) => !a.startsWith('--'));

// ── حارسٌ: لا يُضبط المختبرُ أبداً ───────────────────────────────────────────
const mark = sql("SELECT COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')");
if (mark === 'TAKI_LAB_TOKYO_MARKER_v1382') {
    console.error('❌ هذه قاعدةُ المختبر (طوكيو) — أُوقف.');
    process.exit(1);
}

const show = () => {
    const rows = sql(`SELECT COALESCE(string_agg(kv.key||' ⇒ باقة '||(kv.value->>'package_id'), ' || ' ORDER BY kv.key), '(لا ربطَ بعد)')
                        FROM public.platform_settings ps, LATERAL jsonb_each(ps.value) kv
                       WHERE ps.key='iap_products'`);
    console.log('الربطُ الحاليّ:\n' + rows.split(' || ').map((l) => '  ' + l).join('\n'));
};

if (listOnly) { show(); process.exit(0); }

if (!pairs.length) {
    console.error('استعمال: node scripts/iap-wire-products.js <productId>=<packageId> …  [--check]');
    console.error('         node scripts/iap-wire-products.js --list');
    process.exit(2);
}

// ── الباقاتُ المفعَّلة فعلاً — المرجعُ هو الكتالوج لا المُدخَل ──────────────
const live = sql(`SELECT COALESCE(string_agg((pkg->>'id')||':'||(pkg->>'ar')||':'||(pkg->>'max'), '|'), '')
                    FROM public.platform_settings ps, LATERAL jsonb_array_elements(ps.value) pkg
                   WHERE ps.key='location_packages' AND COALESCE((pkg->>'active')::boolean,false)`);
const packages = new Map(live ? live.split('|').map((r) => {
    const [id, ar, max] = r.split(':');
    return [Number(id), { ar, max }];
}) : []);
if (!packages.size) { console.error('❌ لا باقةً مفعَّلةً في الكتالوج.'); process.exit(1); }

const map = {};
let bad = 0;
for (const p of pairs) {
    const m = /^([A-Za-z0-9._-]{3,120})=(\d{1,6})$/.exec(p);
    if (!m) { console.error(`❌ صيغةٌ خاطئة: «${p}» — المطلوب productId=packageId`); bad = 1; continue; }
    const [, pid, num] = m;
    const pkgId = Number(num);
    if (!packages.has(pkgId)) {
        console.error(`❌ الباقةُ ${pkgId} غيرُ موجودةٍ أو غيرُ مفعَّلة — المتاح: ${[...packages.keys()].join(', ')}`);
        bad = 1; continue;
    }
    if (map[pid] !== undefined) { console.error(`❌ المعرّف «${pid}» مكرّرٌ في المُدخَل`); bad = 1; continue; }
    map[pid] = pkgId;
}
// 🪤 وباقةٌ واحدةٌ لمعرّفين = تاجرٌ يُفعَّل له غيرُ ما اشترى. يُرفض.
const seen = new Map();
for (const [pid, n] of Object.entries(map)) {
    if (seen.has(n)) { console.error(`❌ الباقةُ ${n} مربوطةٌ بمعرّفين: «${seen.get(n)}» و«${pid}»`); bad = 1; }
    seen.set(n, pid);
}
if (bad) process.exit(1);

console.log('سيُربط:');
for (const [pid, n] of Object.entries(map)) {
    const p = packages.get(n);
    console.log(`  ${pid.padEnd(34)} ⇒ باقة ${n} (${p.ar} · ${p.max} موقعاً)`);
}

if (checkOnly) { console.log('\nℹ️ فحصٌ فقط — لم يُكتب شيء.'); process.exit(0); }

const payload = JSON.stringify(Object.fromEntries(
    Object.entries(map).map(([pid, n]) => [pid, { package_id: n }])));
sql(`INSERT INTO public.platform_settings (key, value)
     VALUES ('iap_products', ${JSON.stringify(payload)}::jsonb)
     ON CONFLICT (key) DO UPDATE
       SET value = public.platform_settings.value || EXCLUDED.value`);

// ── ولا يُصدَّق الكتابةُ بلا قراءةٍ بعدها (درسُ الخزنة في v14.44) ──────────
let okAll = true;
for (const [pid, n] of Object.entries(map)) {
    const got = sql(`SELECT COALESCE((value->${JSON.stringify(pid)}->>'package_id'), '')
                       FROM public.platform_settings WHERE key='iap_products'`);
    const ok = got === String(n);
    console.log(`  ${ok ? '✅' : '❌'} ${pid} ⇒ ${got || '(لا شيء)'}`);
    if (!ok) okAll = false;
}
if (!okAll) { console.error('\n❌ الكتابةُ لم تُثبَت بالقراءة.'); process.exit(1); }
console.log('\n✅ رُبطت وقُرئت. ويبقى على الخادم ضبطُ أسرار أبل/قوقل (store/README §ج ٤).');
show();
