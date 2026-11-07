#!/usr/bin/env node
/**
 * backfill-hero.js — يُنشئ توأمَ الهيرو `_h.jpg` للصور المرفوعة قبل v15.71.
 * ═══════════════════════════════════════════════════════════════════════════
 *   node scripts/backfill-hero.js --check    # يُحصي الناقص ولا يكتب
 *   node scripts/backfill-hero.js            # يُنشئ الناقص
 *
 * 🔴 ولماذا: محوّلُ الصور على الخادم **لا يخزّن شيئاً** (قِيس: بارد ≈ متكرّر)
 *    ويكلّف ٤١٢ م.ث معالجاً لكلّ طلب — سقفُ ~٢٫٤ مشاهدةٍ في الثانية على
 *    نواةٍ واحدة. فبقاءُ الصور القديمة على المحوّل يجعل كلَّ مشاهدةِ عرضٍ
 *    قديمٍ ضربةً على المعالج. والتوأمُ الثابتُ يُخدَم بصفر معالجة.
 *
 * 🪤 و**لا يُمسّ أصلٌ واحد**: الإنشاءُ إضافيٌّ بحت. أصولُ التجّار بياناتُهم،
 *    وإعادةُ ضغطها فوق نفسها قرارٌ لا يُتَّخذ في سكربتِ تحسين — ولو كانت
 *    ٥٫٤ ميجابايت. (وثمانيةُ ملفّاتٍ تتجاوز الميجابايت تساوي ٦٥٪ من حجم
 *    المستودع، كلُّها مرفوعةٌ يومَ الانتقال قبل أن يوجد الضغط.)
 *
 * 🪤 ويُنشأ التوأمُ من **المحوّل نفسِه** لا بأداةٍ محلّيّة: فيكون الناتجُ
 *    مطابقاً لما كان يُقدَّم، فلا يرى المستخدمُ فرقاً — ويُدفع ثمنُ التحويل
 *    مرّةً واحدةً إلى الأبد بدل مرّةٍ لكلّ مشاهد.
 */
const { execFileSync } = require('child_process');

const KEY = process.env.TAKI_SSH_KEY || `${process.env.HOME}/.ssh/taki_jeddah2`;
const HOST = process.env.TAKI_SSH_HOST || 'ubuntu@207.127.99.122';
const CHECK = process.argv.includes('--check');
const one = (q) => String(q).replace(/\s+/g, ' ').trim();
const sql = (q) => execFileSync('ssh', ['-i', KEY, HOST,
    `sudo docker exec supabase-db psql -U supabase_admin -d postgres -At -c ${JSON.stringify(one(q))}`],
    { encoding: 'utf8', maxBuffer: 16 << 20 }).trim();

if (sql("SELECT COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')")
    === 'TAKI_LAB_TOKYO_MARKER_v1382') {
    console.error('❌ قاعدةُ المختبر — أُوقف.'); process.exit(1);
}

// أصولٌ لها مصغّرةٌ (أي موسومةٌ t=1) ولا هيروَ لها.
const rows = sql(`SELECT o.name FROM storage.objects o
   WHERE o.bucket_id='deals'
     AND o.name NOT LIKE '%\\_t.jpg' AND o.name NOT LIKE '%\\_h.jpg'
     AND EXISTS (SELECT 1 FROM storage.objects t WHERE t.bucket_id='deals'
                  AND t.name = regexp_replace(o.name,'\\.[A-Za-z]+$','_t.jpg'))
     AND NOT EXISTS (SELECT 1 FROM storage.objects h WHERE h.bucket_id='deals'
                  AND h.name = regexp_replace(o.name,'\\.[A-Za-z]+$','_h.jpg'))
   ORDER BY o.name`).split('\n').filter(Boolean);

console.log(`  أصولٌ ناقصةُ التوأم: ${rows.length}`);
if (!rows.length) { console.log('✅ لا ناقص.'); process.exit(0); }
for (const r of rows.slice(0, 8)) console.log('    • ' + r);
if (rows.length > 8) console.log(`    … و${rows.length - 8} غيرها`);
if (CHECK) { console.log('\nℹ️ فحصٌ فقط — لم يُكتب شيء.'); process.exit(0); }

// يُنفَّذ على الخادم: جلبٌ من المحوّل ثمّ رفعٌ بمفتاح الخدمة.
//
// 🔴 والأسماءُ تُمرَّر في **ملفٍّ** لا على نفس المَدخل مع السكربت. أوّلُ كتابةٍ
//    دفعت `script + '\n' + names` إلى `bash -s`، فقرأت الحلقةُ `while read`
//    ما بقي على المَدخل **بعد** أن حلّل bash السكربت — وbash يقرأ بأجزاء،
//    فالحدُّ غيرُ مضمون. وقع فعلاً: عُدّ آخرُ سطرٍ من السكربت نفسِه اسمَ
//    صورةٍ (`❌ تحويل echo "المجموع…" ⇒ 000`). نجح المرّةَ الأولى بالحظّ لا
//    بالتصميم، والخلطُ بينهما هو العيب.
const LIST = '/tmp/taki-hero-list.txt';
execFileSync('ssh', ['-i', KEY, HOST, `cat > ${LIST}`],
    { input: rows.join('\n') + '\n', encoding: 'utf8' });
const script = `
set -uo pipefail
cd /opt/taki/supabase
SR=$(grep -m1 '^SERVICE_ROLE_KEY=' .env | cut -d= -f2)
OK=0; BAD=0
while read -r NAME; do
  [ -n "$NAME" ] || continue
  STEM="\${NAME%.*}"
  OUT="/tmp/h.jpg"
  CODE=$(curl -s -o "$OUT" -w '%{http_code}' --max-time 60 \
    "https://api.takisa.net/storage/v1/render/image/public/deals/$NAME?width=1080&quality=78")
  if [ "$CODE" != "200" ] || [ ! -s "$OUT" ]; then
    echo "  ❌ تحويل $NAME ⇒ $CODE"; BAD=$((BAD+1)); continue
  fi
  # 🪤 والتحويلُ قد يُنتج **أكبرَ من الأصل** لصورةٍ صغيرةٍ أصلاً (قِيس: أصلٌ
  #    ٢٠٥ ك.ب ⇒ تحويلٌ ٢٢٥). فيُنسخ الأصلُ توأماً بدلاً منه.
  ORIG_SZ=$(curl -s -o /dev/null -w '%{size_download}' --max-time 60 \
    "https://api.takisa.net/storage/v1/object/public/deals/$NAME")
  NEW_SZ=$(stat -c%s "$OUT")
  if [ "$ORIG_SZ" -gt 0 ] && [ "$NEW_SZ" -ge "$ORIG_SZ" ]; then
    curl -s -o "$OUT" --max-time 60 \
      "https://api.takisa.net/storage/v1/object/public/deals/$NAME"
    echo "  ℓ $NAME: التحويلُ أكبرُ من الأصل — نُسخ الأصل"
  fi
  UP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 60 -X POST \
    -H "Authorization: Bearer $SR" -H "Content-Type: image/jpeg" \
    -H "Cache-Control: max-age=31536000" -H "x-upsert: false" \
    --data-binary "@$OUT" \
    "https://api.takisa.net/storage/v1/object/deals/\${STEM}_h.jpg")
  if [ "$UP" = "200" ] || [ "$UP" = "409" ]; then
    echo "  ✓ \${STEM}_h.jpg ($(( $(stat -c%s "$OUT") / 1024 )) ك.ب)"; OK=$((OK+1))
  else
    echo "  ❌ رفع \${STEM}_h.jpg ⇒ $UP"; BAD=$((BAD+1))
  fi
done < ${LIST}
rm -f ${LIST}
echo "  المجموع: نجح $OK · فشل $BAD"
`;
const out = execFileSync('ssh', ['-i', KEY, HOST, 'sudo bash -s'],
    { input: script, encoding: 'utf8', maxBuffer: 16 << 20 });
console.log(out.trim());

// ولا يُصدَّق إلا بقراءةٍ بعده.
const left = sql(`SELECT count(*) FROM storage.objects o
   WHERE o.bucket_id='deals' AND o.name NOT LIKE '%\\_t.jpg' AND o.name NOT LIKE '%\\_h.jpg'
     AND EXISTS (SELECT 1 FROM storage.objects t WHERE t.bucket_id='deals'
                  AND t.name = regexp_replace(o.name,'\\.[A-Za-z]+$','_t.jpg'))
     AND NOT EXISTS (SELECT 1 FROM storage.objects h WHERE h.bucket_id='deals'
                  AND h.name = regexp_replace(o.name,'\\.[A-Za-z]+$','_h.jpg'))`);
console.log(`\n  الباقي بلا توأم: ${left}`);
if (Number(left) > 0) { console.error('❌ لم يُكتمل الملء.'); process.exit(1); }
console.log('✅ كلُّ صورةٍ موسومةٍ لها توأمُ هيرو ثابت.');
