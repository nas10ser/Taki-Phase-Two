#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# TAKI — ورقةُ حفظِ مفتاح النسخ الاحتياطية (escrow مطبوع، خارج كلّ جهاز)
#
# 🔴 لماذا يوجد هذا الملفّ أصلاً:
#   مفتاحُ فكِّ تشفير النسخ الاحتياطية موجودٌ في **موضعين فقط** — ملفٌّ واحد
#   على خادم جدة (`/root/.taki_backup_key`) ونسخةٌ نصّية واحدة على ماك ناصر.
#   والخادمُ هو نفسُه ما قد يضيع (ضاع فعلاً ٢–١٩ أكتوبر ٢٠٢٦)، وماكُ ناصر
#   بلا نسخةٍ احتياطية تعمل (`tmutil latestbackup` ⇒ خطأ تحميل الوجهة).
#   فكلُّ موضعٍ من الموضعين نقطةُ فشلٍ وحيدة، لا زوجٌ متكافل.
#   وبضياعهما معاً تصير كلُّ النسخ المرفوعة إلى أوراكل ضجيجاً أبدياً —
#   ومعها `.env` (كلمةُ القاعدة · سرُّ التوكن · مفتاحُ الخزنة) لأن الأرشيف
#   الليليّ يحمله.
#
# 🪤 ولا تُكتب نسخةُ المفتاح بجوار النصّ المشفّر إطلاقاً:
#   لا في المستودع، ولا في مجلّد `محلّي/`، ولا في مستودع `taki-backups`.
#   مفتاحٌ بجوار نصٍّ مشفّر يُبطل التشفير كلَّه. فالمخرَجُ هنا ملفٌّ مؤقّت
#   خارج المشروع، يُفتح ليُطبع ثمّ يُحذف — والورقةُ وحدها تبقى.
#
# 🪤 ولا رمزَ QR: رمزٌ يحمل هذا النصّ يدعو إلى تصويره بالجوّال، فيعود المفتاح
#   إلى جهازٍ متّصل بالإنترنت — وهو بالضبط ما نهرب منه. (و`qrencode`/`zint`
#   غير مثبّتين على الجهاز أصلاً.)
#
# الاستعمال:  bash supabase/ops/escrow-backup-key.sh
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
export LC_ALL=en_US.UTF-8

# بصمةُ مفتاح الخادم — قِيست على جدة بـ`sha256sum /root/.taki_backup_key`
# (ملفٌّ ٦٤ بايت بلا سطرٍ جديد، صلاحيات 600 root:root).
# 🔴 هذا السطرُ هو كلُّ الفرق بين «نسخةٌ موثوقة» و«نسخةٌ تالفةٌ بصمت»:
#   بلا مقارنةِ بصمةٍ يُطبَع أيُّ نصٍّ في الملفّ — وحرفٌ واحدٌ مبدَّل أو مسافةٌ
#   زائدة تُنتج ورقةً تبدو سليمةً تماماً ولا تفكّ شيئاً، ولا يُكتشف ذلك إلّا
#   يومَ الكارثة.
SERVER_FP='e722582fd0652c0f4f40e6f65f468f7cfd4d101b753c80bdebf3061fb469e327'

KEYS_FILE="$HOME/Desktop/TAKI/محلّي/مفاتيح/TAKI-مفتاح-النسخ-الاحتياطي.txt"
BUCKET='taki-backups'
REGION='me-jeddah-1'

# >>> KEYREAD — كتلةٌ واحدة بعينها في هذا الملفّ وفي verify-backup-key.sh.
# 🪤 تُقرأ بالاسم لا برقم سطر (درس v14.81: رقمُ السطر يزحف مع أوّل تعديل،
#   فصار استخراجُ كلمةٍ أخرى يُرجع قالباً `<PW>` ويبدو كلمةً خاطئة).
# وأربعةُ حرّاسٍ ترفض **قبل** أن يُنتَج أيُّ شيء، ولكلٍّ رسالتُه:
[ -f "$KEYS_FILE" ] || {
  echo "❌ ملفُّ المفاتيح غير موجود:"; echo "   $KEYS_FILE"
  echo "   راجعني — لا يوجد ما يُحفظ."; exit 1; }
KEY=$(awk '/^المفتاح:/{getline; gsub(/[[:space:]]/,""); print; exit}' "$KEYS_FILE")
[ -n "$KEY" ] || {
  echo "❌ لم أجد سطر «المفتاح:» في ملفّ المفاتيح — فلا مفتاح أقرؤه."
  echo "   لا تُصلحها بتخمين سطر: أعِد الاسمَ كما كان «المفتاح:» بلا مسافة قبل النقطتين."
  exit 1; }
[ ${#KEY} -eq 64 ] || {
  echo "❌ المفتاح في الملفّ ليس ٦٤ محرفاً (طولُه ${#KEY}) — ناقصٌ أو ملتصقٌ بشيء."
  echo "   توقّف. لا تطبع نسخةً ناقصة."; exit 1; }
KEY_FP=$(printf '%s' "$KEY" | shasum -a 256 | cut -d' ' -f1)
[ "$KEY_FP" = "$SERVER_FP" ] || {
  echo "❌ الملفُّ لا يطابق مفتاح الخادم. لا تطبع. راجعني."
  echo "   بصمةُ الملفّ:  ${KEY_FP:0:8}…"
  echo "   بصمةُ الخادم: ${SERVER_FP:0:8}…"; exit 1; }
# <<< KEYREAD

# ── الورقة: ملفٌّ مؤقّت خارج المشروع وخارج «محلّي/» ───────────────────────
OUTDIR=$(mktemp -d /tmp/taki-escrow.XXXXXX)
REPO_ROOT="$HOME/Desktop/TAKI"
case "$OUTDIR" in
  "$REPO_ROOT"*) echo "❌ المسارُ المؤقّت وقع داخل المشروع — توقّف."; rm -rf "$OUTDIR"; exit 1;;
esac
PAGE="$OUTDIR/escrow.html"
trap 'rm -rf "$OUTDIR"' EXIT INT TERM

G1="${KEY:0:16}"; G2="${KEY:16:16}"; G3="${KEY:32:16}"; G4="${KEY:48:16}"
TODAY=$(date +%F)

cat > "$PAGE" <<HTML
<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">
<title>TAKI — مفتاح فكّ النسخ الاحتياطية</title><style>
@page { margin: 14mm; }
body { font-family: -apple-system, "SF Pro Text", sans-serif; color:#000; background:#fff;
       margin:0; padding:10mm; }
h1 { font-size:20pt; margin:0 0 2mm; }
.sub { font-size:10pt; color:#444; margin:0 0 6mm; }
.warn { border:2px solid #000; padding:4mm; font-size:11pt; font-weight:700; margin:0 0 6mm; }
table.grid { border-collapse:collapse; margin:0 0 5mm; }
table.grid td { border:1px solid #000; padding:3mm 4mm; }
td.lbl { font-size:13pt; font-weight:700; width:12mm; text-align:center; background:#eee; }
td.chars { font-family:"SF Mono",Menlo,Consolas,monospace; font-size:34pt;
           letter-spacing:3pt; direction:ltr; text-align:left; white-space:pre; }
.meta { font-size:11pt; line-height:1.9; }
.meta b { font-family:"SF Mono",Menlo,monospace; font-size:10pt; }
.steps { font-size:10.5pt; line-height:1.8; border-top:1px solid #999; padding-top:4mm; margin-top:4mm; }
.foot { font-size:9pt; color:#555; margin-top:5mm; }
</style></head><body>

<h1>🔐 مفتاح فكّ تشفير النسخ الاحتياطية — TAKI</h1>
<p class="sub">تاريخ الطبع: $TODAY · TAKI backup decryption key — printed offline escrow</p>

<div class="warn">
اطبع هذه الورقة ولا تصوّرها بالجوّال، ولا تحفظها كملفّ.<br>
بلا هذا المفتاح لا تُفتح أيُّ نسخة احتياطية إطلاقاً — ولا يُستعاد شيء.<br>
<span style="font-weight:400">Print this sheet. Do not photograph it. Without this key no backup can ever be opened.</span>
</div>

<table class="grid">
<tr><td class="lbl">١</td><td class="chars">$G1</td></tr>
<tr><td class="lbl">٢</td><td class="chars">$G2</td></tr>
<tr><td class="lbl">٣</td><td class="chars">$G3</td></tr>
<tr><td class="lbl">٤</td><td class="chars">$G4</td></tr>
</table>

<p class="meta">
اكتب المجموعات الأربع متّصلةً بلا مسافات ولا أسطر — ٦٤ محرفاً واحداً.<br>
Join the four groups into one 64-character string, no spaces, no newlines.<br><br>
<b>البصمة (sha256): $SERVER_FP</b><br>
<b>المستودع: $BUCKET · المنطقة: $REGION · سحابة أوراكل (Oracle Cloud)</b>
</p>

<div class="steps">
<b style="font-size:11pt">الاستعادة باختصار — والتفصيل في supabase/ops/RECOVERY.md</b><br>
أنشئ خادم أوبنتو جديداً في منطقة $REGION وافتح المنفذين ٨٠ و٤٤٣ · نزّل أحدث ملفّ
<code>.tar.gpg</code> من مستودع <code>$BUCKET</code> في لوحة أوراكل وتحقّق من ملفّ
<code>.sha256</code> المجاور له · فُكَّ التشفير بـ<code>gpg --batch --decrypt
--passphrase-file &lt;ملفّ فيه هذا المفتاح&gt;</code> ثمّ <code>tar -xf -</code> ·
أعِد بناء المنصّة من <code>config.tgz</code> (فيه <code>.env</code> و
<code>docker-compose</code>) والصور من <code>storage.tgz</code> ·
استعِد القاعدة بـ<code>pg_restore</code> إلى قاعدةٍ اسمها <code>postgres</code>
تحديداً · تحقّق من الأعداد · ثمّ وجّه سجلّ <code>api</code> في كلاودفلير إلى
العنوان الجديد (DNS only).<br><br>
<span style="font-size:10pt">English: create a fresh Ubuntu host in $REGION, download the
newest <code>.tar.gpg</code> from the <code>$BUCKET</code> bucket, check its
<code>.sha256</code> sibling, decrypt with this key via <code>gpg --batch --decrypt
--passphrase-file</code>, untar, rebuild from <code>config.tgz</code> and
<code>storage.tgz</code>, <code>pg_restore</code> into a database named exactly
<code>postgres</code>, verify the counts, then repoint the <code>api</code> DNS record.</span>
</div>

<p class="foot">نسختان من هذه الورقة في موضعين ماديّين مختلفين. وبصمةُ الخادم أعلاه هي
ما يُقارَن به أيُّ نسخةٍ مستقبلية — نسخةٌ لا تطابقها لا تُحفظ ولا تُطبع.</p>

</body></html>
HTML

echo "✅ جُهّزت ورقةُ الحفظ."
echo "   طولُ المفتاح: ${#KEY} محرفاً · البصمة تبدأ بـ ${SERVER_FP:0:8}"
echo "   الملفّ المؤقّت: $PAGE   (خارج المشروع، ويُحذف بعد قليل)"
echo
echo "👉 ستُفتح الورقةُ الآن في المتصفّح. اضغط ⌘P واطبع **ورقتين**،"
echo "   واحفظ كلَّ ورقةٍ في مكانٍ ماديٍّ مختلف عن الآخر."
open "$PAGE" 2>/dev/null || echo "⚠️  لم يُفتح المتصفّح تلقائياً — افتح المسار أعلاه يدوياً."
echo
printf '⏎ اضغط Enter بعد أن تنتهي من الطباعة، فأحذف الملفّ المؤقّت: '
read -r _ || true
rm -rf "$OUTDIR"
trap - EXIT INT TERM
echo "🗑  حُذف الملفّ المؤقّت. لم يبقَ من المفتاح أيُّ أثرٍ رقميٍّ جديد."
