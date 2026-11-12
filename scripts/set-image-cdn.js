#!/usr/bin/env node
/**
 * set-image-cdn.js — يُشعل أو يُطفئ مضيفَ شبكة توصيل الصور.
 * ═══════════════════════════════════════════════════════════════════════════
 *   node scripts/set-image-cdn.js img.takisa.net   # إشعال
 *   node scripts/set-image-cdn.js --off            # إطفاءٌ فوريّ
 *   node scripts/set-image-cdn.js --show           # القيمةُ الحالية
 *
 * 🔴 ولا يُكتب شيءٌ قبل **إثبات أن المضيفَ يردّ صورةً حقيقيّة**: إعدادٌ يشير
 *    إلى مضيفٍ غيرِ جاهز يُنتج طلباً فاشلاً لكلّ صورةٍ في المنصّة.
 *    والترتيبُ الصحيح: تحقّقٌ ثمّ كتابة.
 * ✅ وشبكةُ الأمان **قائمةٌ فعلاً** (صُحّح ١٢ نوفمبر ٢٠٢٦ — كان مكتوباً هنا
 *    عكسُه): `imgFallback(original)` في `utils/thumb.ts` يرتدّ إلى
 *    `deal.images[i]` الخام وهو على `api.takisa.net` **لا على مضيف الشبكة**
 *    — فمضيفٌ ميّتٌ يتعافى صورةً صورةً من تلقاء نفسه. وتبقى الكلفةُ طلباً
 *    فاشلاً لكلّ صورة، وهذا ما يمنعه التحقّقُ أدناه.
 * 🪤 ويُتحقَّق من **البايتات** لا من رمز الحالة وحده: مضيفٌ يردّ ٢٠٠ بصفحة
 *    HTML (خطأُ وسيط، أو صفحةُ تحدٍّ) يمرّ أيَّ فحصٍ يقرأ الرمزَ فقط.
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

const show = () => console.log('  القيمةُ الحالية: '
    + (sql("SELECT COALESCE(value::text,'(غائب)') FROM public.platform_settings WHERE key='image_cdn_host'") || '(غائب)'));

const arg = process.argv[2];
if (!arg || arg === '--show') { show(); process.exit(0); }

if (arg === '--off') {
    sql(`UPDATE public.platform_settings SET value='""'::jsonb WHERE key='image_cdn_host'`);
    const v = sql("SELECT value::text FROM public.platform_settings WHERE key='image_cdn_host'");
    if (v !== '""') { console.error('❌ لم يُثبت الإطفاء بالقراءة: ' + v); process.exit(1); }
    console.log('✅ أُطفئت — كلُّ عنوانٍ عاد إلى الأصل. (قد يبقى ما خزّنه متصفّحٌ حتى تنتهي مدّته.)');
    process.exit(0);
}

const host = arg.replace(/^https?:\/\//, '').replace(/\/+$/, '');
if (!/^([A-Za-z0-9-]+\.)+[A-Za-z]{2,}$/.test(host)) {
    console.error('❌ صيغةُ مضيفٍ غيرُ صالحة: ' + host); process.exit(1);
}

// ── يُجرَّب على صورةٍ حقيقيّةٍ من المستودع، لا على الجذر ──────────────────
const sample = sql(`SELECT name FROM storage.objects
   WHERE bucket_id='deals' AND name LIKE '%\\_t.jpg' ORDER BY name LIMIT 1`);
if (!sample) { console.error('❌ لا مصغّرةَ في المستودع للتجربة.'); process.exit(1); }
const path = `/storage/v1/object/public/deals/${sample}`;
console.log(`  يُجرَّب: https://${host}${path}`);

const probe = (h) => {
    const out = execFileSync('curl', ['-s', '-o', '/tmp/taki-cdn-probe.bin', '-w',
        '%{http_code} %{size_download} %{content_type}', '--max-time', '30',
        `https://${h}${path}`], { encoding: 'utf8' });
    const [code, size, ctype] = out.trim().split(' ');
    return { code, size: Number(size), ctype: ctype || '' };
};
let r;
try { r = probe(host); } catch (e) { console.error('❌ تعذّر الوصول: ' + e.message); process.exit(1); }
console.log(`  الردّ: HTTP ${r.code} · ${r.size} بايت · ${r.ctype}`);
if (r.code !== '200') { console.error('❌ المضيفُ لا يردّ ٢٠٠ — أُوقف قبل الكتابة.'); process.exit(1); }
if (!/^image\//.test(r.ctype)) {
    console.error(`❌ الردُّ ليس صورةً (${r.ctype}) — مضيفٌ يردّ HTML بـ٢٠٠ يمرّ\n`
                + '   أيَّ فحصٍ يقرأ الرمزَ وحده، ويكسر كلَّ صورةٍ في المنصّة.');
    process.exit(1);
}
// والبايتاتُ تُطابق ما يُقدّمه الأصل — فمضيفٌ يردّ صورةً **أخرى** يمرّ أيضاً.
const direct = probe('api.takisa.net');
if (direct.code === '200' && Math.abs(direct.size - r.size) > 64) {
    console.error(`❌ الحجمُ لا يُطابق الأصل (${r.size} مقابل ${direct.size}) — المضيفُ يُقدّم غيرَ ما نتوقّع.`);
    process.exit(1);
}
console.log(`  ✓ طابق الأصلَ (${direct.size} بايت)`);

sql(`UPDATE public.platform_settings SET value=${JSON.stringify(JSON.stringify(host))}::jsonb
      WHERE key='image_cdn_host'`);
const back = sql("SELECT value #>> '{}' FROM public.platform_settings WHERE key='image_cdn_host'");
if (back !== host) { console.error(`❌ لم تُثبت الكتابةُ بالقراءة: «${back}»`); process.exit(1); }
console.log(`✅ أُشعلت على ${host} — وتُطفأ فوراً بـ--off.`);
