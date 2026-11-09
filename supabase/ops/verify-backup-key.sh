#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# TAKI — هل ما زال المفتاحُ يفكّ النسخ الاحتياطية؟ (الفحص الوحيد الذي يُثبت ذلك)
#
# 🔴 الفراغُ الذي يسدّه هذا الملفّ، مقيساً لا مُخمَّناً:
#   `grep -rn "gpg" .github/` يُرجع سطرين فقط، كلاهما
#   `o['name'].endswith('.tar.gpg')` — أي أن الحراسةَ كلَّها تطابق **لاحقةَ
#   اسمِ ملفّ**. فلا شيءٌ في المستودع اختبر يوماً أن المفتاح يفكّ النصّ المشفّر.
#   الفحصُ اليوميّ يُجيب «هل وصلت البايتات؟» ولا يُجيب «هل نقدر أن نقرأها؟»،
#   وهذا هو فخُّ CLAUDE.md بعينه: «غير موجود» ليس نجاحاً، وصفوفٌ خضراءُ كثيرة
#   تُثبت الوصولَ لا القراءة. آخرُ فكِّ تشفيرٍ مُثبَت قبل هذا الملفّ:
#   ١٤ سبتمبر ٢٠٢٦.
#
# 🔴 وماكُ ناصر لم يكن يستطيع الفحصَ إطلاقاً: `which gpg gpg2` ⇒ غير موجود،
#   و`sq`/`rnp`/`gpgconf` وموديولا python (`gnupg`/`pgpy`) كلُّها غائبة.
#   أي أن **النسخةَ التي يُفترض أن تنجو الخادم كانت على الجهاز الوحيد الذي
#   لا يستطيع استعمالها**. والعلاجُ **GPG Suite** من gpgtools.org (ملفٌّ
#   يُفتح ويُضغط «Install»، بلا سطرِ أوامر) — و`brew` على جهازه معطوبٌ فعلاً
#   (فهرسُ الصيغ من ٢٠١٧ ونسخةٌ مبتورة)، و`libpq` **ليست مطلوبة**: هذا
#   السكربت يُثبت النسخةَ ببصمة `PGDMP` وعدُّ الجداول وحده يُترك بدونها.
#
# الاستعمال:
#   bash supabase/ops/verify-backup-key.sh              ← الفحص الحقيقي (شبكة)
#   bash supabase/ops/verify-backup-key.sh --selfcheck  ← فحصُ الحرّاس وحدها، بلا شبكة ولا مفتاح
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
export LC_ALL=en_US.UTF-8

SERVER_FP='e722582fd0652c0f4f40e6f65f468f7cfd4d101b753c80bdebf3061fb469e327'
KEYS_FILE="$HOME/Desktop/TAKI/محلّي/مفاتيح/TAKI-مفتاح-النسخ-الاحتياطي.txt"
PAR_FILE="$HOME/.taki_backup_list_par"
HERE="$(cd "$(dirname "$0")" && pwd)"

# الأرضيّةُ ليست رقماً مُختلقاً: هي **عقدُ المنتِج نفسه** — `taki-backup-hourly.sh`
# على جدة يرفض أيَّ dump أصغر من ١٠٠٠٠٠ بايت (`[ "$SZ" -gt 100000 ]`)، فما
# يصلنا لا يكون أصغر من ذلك إلّا إذا كان تالفاً. (المقيس اليوم ٥٫٦ م.ب.)
MIN_DUMP_BYTES=100000
# و٢٥ أرضيّةٌ تحت الواقع بكثير: المقيس اليوم ١٢٩ مُدخَلَ «TABLE DATA» على ٧٧ جدولاً.
MIN_TABLE_DATA=25

# ───────────────────────────────────────────────────────────────────────────
# --selfcheck: يحرس الحرّاس. لا شبكة، لا مفتاح، فيصلح للعمل في سلسلة الاختبار.
# 🪤 ثلاثةُ فخاخٍ رُوعيت هنا بعينها:
#   (أ) حارسٌ يمسك **تعليقَه هو** — فتُحذف أسطرُ التعليق قبل أيّ بحث.
#   (ب) حارسٌ يمسك **قائمةَ علاماته هي** — ولذلك لا يُفحَص هذا الملفّ كلُّه،
#       بل مقطعُ التشغيل الحقيقي وحده (بعد `# >>> REALRUN`).
#   (ج) مسحٌ فارغٌ يبدو نجاحاً — فكلُّ عدٍّ يُطبع، وكلُّ استخراجٍ يُشترط ألّا يكون فارغاً.
# ───────────────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--selfcheck" ]; then
  ESC="$HERE/escrow-backup-key.sh"; VER="$HERE/verify-backup-key.sh"
  fail=0
  # 🪤 و`fail` عدّادٌ لا راية: براية واحدة كان التأكيدُ الثاني يرى `fail` كما
  #   تركه الأوّل فيطبع «✓» بعد «❌» في نفس المخرَج. قِيس وصُحّح.
  bad() { echo "❌ $1"; fail=$((fail+1)); }
  # 🪤 و«✓» لا يُطبع إلّا إن لم تُسجَّل مخالفةٌ في هذا التأكيد بعينه — وإلّا
  #   ظهرت «انحرفت» و«متطابقة» في مخرَجٍ واحد، وهو مخرَجٌ يُضلّل قارئه.
  mark=0
  at() { mark=$fail; }
  ok() { [ "$fail" -eq "$mark" ] && echo "   $1"; return 0; }

  for f in "$ESC" "$VER"; do
    [ -s "$f" ] || bad "ملفٌّ مفقود أو فارغ: $f"
  done
  [ $fail -eq 0 ] || { echo "❌ فحصُ الحرّاس سقط."; exit 1; }

  # تجريدُ أسطر التعليق وحدها — لا `sed 's/#.*$//'`، فذاك يبتر `${#KEY}` نفسه.
  strip() { grep -v '^[[:space:]]*#' "$1" || true; }
  # ومقطعُ التشغيل الحقيقي من verify، كي لا تُصدّق قائمةُ العلامات نفسها.
  realrun() { awk 'f; /^# >>> REALRUN/{f=1}' "$1" | grep -v '^[[:space:]]*#' || true; }

  at
  esc_code=$(strip "$ESC")
  ver_code=$(realrun "$VER")
  EC=$(printf '%s\n' "$esc_code" | wc -l | tr -d ' ')
  VC=$(printf '%s\n' "$ver_code" | wc -l | tr -d ' ')
  { [ "$EC" -ge 40 ] && [ "$VC" -ge 40 ]; } \
    || bad "المسحُ شبهُ فارغ (escrow $EC سطراً · verify-realrun $VC سطراً) — إشارةُ خطأٍ في الاستخراج لا نجاح."
  ok "✓ المسحُ غيرُ فارغ: escrow $EC سطراً · مقطعُ التشغيل في verify $VC سطراً"

  # (١) كتلةُ قراءة المفتاح **متطابقةٌ حرفياً** في الملفّين — نسخةٌ تنحرف تعني
  #     حارساً موجوداً في ملفٍّ وغائباً عن الآخر.
  at
  blk() { awk '/^# >>> KEYREAD/,/^# <<< KEYREAD/' "$1"; }
  A=$(blk "$ESC"); B=$(blk "$VER")
  AL=$(printf '%s\n' "$A" | wc -l | tr -d ' ')
  { [ -n "$A" ] && [ "$AL" -ge 12 ]; } \
    || bad "كتلةُ KEYREAD لم تُستخرج من escrow ($AL سطراً) — مسحٌ فارغ لا سليم."
  [ "$A" = "$B" ] || bad "كتلةُ KEYREAD انحرفت بين الملفّين — أعِدها متطابقة."
  ok "✓ كتلةُ KEYREAD متطابقة في الملفّين ($AL سطراً)"

  at
  # (٢) بصمةُ الخادم مثبَّتةٌ في كودِ الملفّين لا في تعليقٍ.
  for f in "$ESC" "$VER"; do
    n=$(strip "$f" | grep -cF -e "$SERVER_FP" || true)
    [ "${n:-0}" -ge 1 ] || bad "بصمةُ الخادم غائبةٌ عن كودِ $(basename "$f") (وُجدت ${n:-0} مرّة)"
  done
  ok "✓ بصمةُ الخادم ${SERVER_FP:0:8}… مثبَّتةٌ في كودِ الملفّين"

  at
  # (٣) حرّاسُ escrow الأربعة — بعلامةٍ بنيويّة لا بكلمةٍ مفتاحية.
  for needle in '-f "$KEYS_FILE"' '-n "$KEY"' '${#KEY} -eq 64' '"$KEY_FP" = "$SERVER_FP"'; do
    n=$(printf '%s\n' "$esc_code" | grep -cF -e "$needle" || true)
    [ "${n:-0}" -ge 1 ] || bad "حارسٌ مفقود في escrow: $needle"
  done
  ok "✓ حرّاسُ escrow الأربعة موجودة (وجودُ الملفّ · الفراغ · الطول · البصمة)"

  at
  # (٤) الترتيب: الحارسُ **قبل** المصرف. حارسٌ بعد كتابة الورقة لا يحرس شيئاً.
  g_line=$(printf '%s\n' "$esc_code" | grep -nF '"$KEY_FP" = "$SERVER_FP"' | head -1 | cut -d: -f1 || true)
  w_line=$(printf '%s\n' "$esc_code" | grep -nF 'cat > "$PAGE"' | head -1 | cut -d: -f1 || true)
  if [ -z "$g_line" ] || [ -z "$w_line" ]; then
    bad "لم أجد سطرَ البصمة (${g_line:-غائب}) أو سطرَ كتابة الورقة (${w_line:-غائب}) — مسحٌ فارغ."
  elif [ "$g_line" -ge "$w_line" ]; then
    bad "حارسُ البصمة (سطر $g_line) ليس قبل كتابة الورقة (سطر $w_line)."
  else
    ok "✓ حارسُ البصمة في السطر $g_line وكتابةُ الورقة في $w_line — الترتيب سليم"
  fi

  at
  # (٥) الورقةُ خارج المشروع، والفحصُ داخل السكربت لا بالثقة.
  printf '%s\n' "$esc_code" | grep -qF 'mktemp -d /tmp/taki-escrow' \
    || bad "escrow لم يعد يكتب في /tmp — ورقةٌ بجوار النصّ المشفّر تُبطل التشفير."
  printf '%s\n' "$esc_code" | grep -qF 'REPO_ROOT' \
    || bad "escrow فقد فحصَ «المسارُ خارج المشروع»."
  ok "✓ الورقةُ خارج المشروع، والفحصُ مكتوبٌ داخل السكربت"

  at
  # (٦) ولا يُطبع المفتاحُ أبداً. (علاماتٌ حرفيّةٌ ضيّقة — فـ`printf '%s' "$KEY"`
  #     المُستعمل للبصمة ولملفّ كلمة المرور مشروعٌ ولا يُطبع شيئاً للشاشة.)
  for leak in 'echo "$KEY"' 'echo $KEY' 'echo "${KEY}"' "printf '%s\\n' \"\$KEY\""; do
    for pair in "escrow-backup-key.sh|$esc_code" "verify-backup-key.sh|$ver_code"; do
      nm="${pair%%|*}"; code="${pair#*|}"
      n=$(printf '%s\n' "$code" | grep -cF -e "$leak" || true)
      [ "${n:-0}" -eq 0 ] || bad "$nm يطبع قيمةَ المفتاح: $leak"
    done
  done
  ok "✓ لا موضعَ يطبع قيمةَ المفتاح"

  at
  # (٧) وverify يفشل مغلقاً على بوّاباته.
  for needle in '-f "$PAR_FILE"' 'command -v gpg' 'تعذّر الوصول' 'rc=$?' 'PGDMP'; do
    n=$(printf '%s\n' "$ver_code" | grep -cF -e "$needle" || true)
    [ "${n:-0}" -ge 1 ] || bad "حارسٌ مفقود في مقطع التشغيل بـverify: $needle"
  done
  ok "✓ حرّاسُ verify موجودة (الرابط · gpg · وصولُ المستودع · قراءةُ \$? مباشرةً · بصمةُ PGDMP)"

  [ $fail -eq 0 ] || { echo "❌ فحصُ الحرّاس سقط."; exit 1; }
  echo "✅ فحصُ الحرّاس سليم — ٧ تأكيدات + تأكيدُ «المسحُ غيرُ فارغ»."
  exit 0
fi

# >>> REALRUN — ما بعد هذا السطر هو الفحصُ الحقيقي، وهو وحده ما يفحصه --selfcheck.
command -v gpg >/dev/null 2>&1 || {
  echo "❌ أداةُ فكّ التشفير gpg غير مثبّتة على هذا الجهاز، فلا يمكن فحصُ المفتاح."
  echo
  # 🔴 كانت الرسالةُ هنا «brew install gnupg libpq» وفيها خطآن قِيسا ٩ نوفمبر:
  #   ① `libpq` **ليست مطلوبةً إطلاقاً**: هذا السكربت يُثبت أن الناتج نسخةٌ
  #      حقيقيّة ببصمة `PGDMP` في أوّل الملفّ، ولا ينادي `pg_restore` ولا `psql`.
  #      مطلبٌ زائدٌ يُطيل خطوةً يدويّةً على غير مبرمج، ويزيد احتمالَ فشلها.
  #   ② و`brew` على جهاز ناصر **معطوبٌ فعلاً**: `Homebrew 4.6.6` وفهرسُ الصيغ
  #      آخرُ تحديثٍ له ٢٠١٧-١٢-١٩ ونسخةٌ مبتورة ⇒ أيُّ تثبيتٍ ينفجر بـ
  #      `undefined method 'compatibility_version'`. وmacOS 12 تُصنّفها
  #      Homebrew «غيرَ مدعومة». فإحالةُ غيرِ المبرمج إلى brew إحالةٌ إلى جدار.
  echo "   الطريقُ الأقصرُ والأوثق (بلا سطرِ أوامر):"
  echo "     ١. افتح https://gpgtools.org وحمّل «GPG Suite»."
  echo "     ٢. افتح الملفَّ المنزَّل واضغط «Install» حتى ينتهي."
  echo "     ٣. أغلق هذه النافذة وافتح Terminal من جديد، ثمّ أعِد هذا الأمر."
  echo
  echo "   (وإن فضّلتَ سطرَ الأوامر وكان brew سليماً عندك: brew install gnupg"
  echo "    — وحدها، بلا libpq. وإن انفجر برسالة compatibility_version فـbrew"
  echo "    عندك قديمٌ ويحتاج إصلاحاً أطولَ من تثبيت GPG Suite.)"
  exit 1; }

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

[ -f "$PAR_FILE" ] || {
  echo "❌ رابطُ قراءة المستودع مفقود: $PAR_FILE"
  echo "   يُنشأ من لوحة أوراكل ← taki-backups ← Pre-Authenticated Requests (قراءة وسرد)."
  exit 1; }
PAR=$(tr -d '[:space:]' < "$PAR_FILE"); BASE="${PAR%%\?*}"

WORK=$(mktemp -d /tmp/taki-verify.XXXXXX)
case "$WORK" in "$HOME/Desktop/TAKI"*) echo "❌ مسارٌ مؤقّت داخل المشروع — توقّف."; exit 1;; esac
trap 'rm -rf "$WORK"' EXIT INT TERM

echo "⬇︎  أسرد مستودع النسخ…"
curl -fsS --max-time 90 "${PAR}?fields=name,size,timeCreated" -o "$WORK/list.json" || {
  echo "❌ تعذّر الوصول إلى مستودع النسخ (أوراكل). شبكةٌ مقطوعة أو رابطُ القراءة انتهى."
  echo "   ينتهي رابطُ القراءة taki-monitor-reader في ١ سبتمبر ٢٠٢٧ (مقيسٌ من أوراكل)."
  exit 1; }

# 🪤 «لا شيء موجود» ليس نجاحاً (درس v14.57): قائمةٌ فارغة تُفشِل، لا تمرّ خضراء.
NEWEST=$(python3 - "$WORK/list.json" <<'PY'
import sys, json
o = json.load(open(sys.argv[1])).get('objects', [])
h = [x for x in o if x['name'].startswith('hourly/') and x['name'].endswith('.tar.gpg')]
h.sort(key=lambda x: x['timeCreated'])
print(h[-1]['name'] if h else '')
PY
)
[ -n "$NEWEST" ] || {
  echo "❌ لا توجد أيُّ نسخةِ ساعةٍ في المستودع — هذا فشلٌ لا نجاح."
  echo "   راجع الرفعَ على الخادم: /var/log/taki-backup.log"; exit 1; }
echo "   أحدثُ نسخةِ ساعة: $NEWEST"

# 🪤 الاسمُ ينتهي بـ`.tar.gpg` وليس أرشيف tar إطلاقاً: نسخةُ الساعة هي
#   `pg_dump -Fc` مشفَّرةً مباشرةً (قِيس: `head -c 5` ⇒ PGDMP). واللاحقةُ
#   موروثةٌ من تسمية النسخة الليلية وحدها.
SIB="${NEWEST%.tar.gpg}.sha256"
curl -fsS --max-time 600 -o "$WORK/c.gpg" "${BASE}${NEWEST}" || {
  echo "❌ تعذّر تنزيلُ النسخة من المستودع."; exit 1; }
curl -fsS --max-time 60 -o "$WORK/c.sha256" "${BASE}${SIB}" || {
  echo "❌ ملفُّ البصمة المجاور مفقود ($SIB) — فلا أفرّق بين تنزيلٍ تالفٍ ومفتاحٍ خاطئ."
  echo "   🪤 ورفعُ ملفّ البصمة على الخادم لا يُفحَص رمزُه (curl بلا تحقّق)، فغيابُه محتمل."
  exit 1; }

A=$(shasum -a 256 "$WORK/c.gpg" | awk '{print $1}')
E=$(tr -d '[:space:]' < "$WORK/c.sha256")
[ "$A" = "$E" ] || {
  echo "❌ بصمةُ الملفّ المنزَّل لا تطابق البصمةَ المرفوعة — التنزيلُ تالف، والمفتاحُ بريء."
  exit 1; }
echo "✓ سلامةُ التنزيل مؤكَّدة ($(du -h "$WORK/c.gpg" | cut -f1))"

# 🪤 `$?` يُقرأ على سطره وحده. و`set +e` لحظةً واحدة لأن `set -e` كان سيُخرج
#   السكربتَ قبل أن أقرأ الرمز، و`|| true` كان سيطمسه فيصير صفراً دائماً.
set +e
gpg --batch --quiet --yes --decrypt --passphrase-file <(printf '%s' "$KEY") \
    "$WORK/c.gpg" > "$WORK/db.dump" 2>"$WORK/gpg.err"
rc=$?
set -e
[ $rc -eq 0 ] || {
  echo "❌ المفتاحُ لم يفكّ النسخة (gpg أعاد $rc) — راجعني فوراً."
  echo "   The escrowed key no longer opens the backups."
  sed -n '1,4p' "$WORK/gpg.err"; exit 1; }

SZ=$(wc -c < "$WORK/db.dump" | tr -d ' ')
MAGIC=$(head -c 5 "$WORK/db.dump")
[ "$MAGIC" = "PGDMP" ] || {
  echo "❌ فُكّ التشفير لكن المخرَج ليس نسخةَ PostgreSQL (بدايتُه «$MAGIC»)."; exit 1; }
[ "$SZ" -ge "$MIN_DUMP_BYTES" ] || {
  echo "❌ النسخةُ المفكوكة $SZ بايت — أصغرُ من عقدِ المنتِج نفسه ($MIN_DUMP_BYTES)."; exit 1; }

# عدُّ الجداول طبقةٌ دلاليّةٌ فوق تحقّق السلامة الذي يفعله gpg نفسه.
# و`pg_restore` يأتي من libpq وهي keg-only عند brew فلا تدخل المسار تلقائياً.
PGR=$(command -v pg_restore || true)
if [ -z "$PGR" ]; then
  P="$(brew --prefix libpq 2>/dev/null || true)/bin/pg_restore"
  [ -x "$P" ] && PGR="$P" || PGR=""
fi
if [ -n "$PGR" ]; then
  TD=$("$PGR" -l "$WORK/db.dump" 2>/dev/null | grep -c 'TABLE DATA' || true)
  [ "${TD:-0}" -ge "$MIN_TABLE_DATA" ] || {
    echo "❌ النسخةُ فُكّت لكنها تحمل ${TD:-0} جدولَ بياناتٍ فقط (المطلوب ≥ $MIN_TABLE_DATA)."; exit 1; }
  echo "✅ المفتاحُ يفكّ أحدثَ نسخة — $TD جدولَ بيانات، $((SZ/1048576)) م.ب."
  echo "   The escrowed key still opens the newest backup ($TD table-data entries)."
else
  echo "✅ المفتاحُ يفكّ أحدثَ نسخة — نسخةُ PostgreSQL صحيحة، $((SZ/1048576)) م.ب."
  echo "   The escrowed key still opens the newest backup (valid PostgreSQL dump)."
  echo "ℹ️  عدُّ الجداول تُرك: pg_restore غير مثبّت — وهو **اختياريّ**، والتحقّقُ تمّ ببصمة PGDMP."
fi
echo "   التاريخ: $(date +%F) · النسخة المفحوصة: $NEWEST"
