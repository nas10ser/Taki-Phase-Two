#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# TAKI · إثباتُ مفتاح النسخ **على خادم جدة** — حين لا يكون gpg على جهاز ناصر
#
# 🔴 لماذا هذا إثباتٌ تامٌّ لا تقريبيّ: الخطوةُ ① تُطابق بصمةَ مفتاح الخادم
#    بالبصمة المثبَّتة في `verify-backup-key.sh` — وهي نفسُها بصمةُ ما على
#    ورقة الحفظ (يتحقّق منها `escrow-backup-key.sh` قبل أن يكتب الورقة).
#    فإن فكّ مفتاحُ الخادم نسخةً حقيقيّةً مرفوعة، فقد فكّتها الورقةُ بالضرورة.
#
# 🪤 ولا يُغني هذا عن تثبيت GPG Suite يوماً ما: غايةُ الورقة أن تُستعاد النسخة
#    حين **لا يكون الخادمُ موجوداً** — وحينها يلزم gpg على جهازٍ ما. هذا يُثبت
#    صلاحيّةَ المفتاح اليوم، لا يُغني عن الأداة غداً.
#
# 🔇 ولا يُطبع المفتاحُ ولا رابطُ القراءة في أيّ سطر، ولا يُكتب أيٌّ منهما على
#    قرص الخادم: يصلان في البيئة (`PAR` و`FP`) ويُقرأ المفتاحُ في متغيّر.
#
# يُشغَّل من `verify-backup-key.sh` وحده عبر stdin — لا يُنسخ إلى الخادم.
# ═══════════════════════════════════════════════════════════════════════════
set -u

MIN_DUMP_BYTES=100000
MIN_TABLE_DATA=25
KEYFILE=/root/.taki_backup_key

W=$(mktemp -d /tmp/taki-vfy.XXXXXX); trap 'rm -rf "$W"' EXIT INT TERM
fail() { echo "❌ $1"; exit 1; }

[ -n "${PAR:-}" ] || fail "رابطُ القراءة لم يصل الخادم."
[ -n "${FP:-}"  ] || fail "بصمةُ المرجع لم تصل الخادم."
[ -f "$KEYFILE" ] || fail "مفتاحُ النسخ غير موجودٍ على الخادم ($KEYFILE) — وهذا عطلٌ جسيم."

KEY=$(tr -d '[:space:]' < "$KEYFILE")
[ ${#KEY} -eq 64 ] || fail "مفتاحُ الخادم ليس ٦٤ محرفاً (طولُه ${#KEY})."
GOT=$(printf '%s' "$KEY" | sha256sum | cut -d' ' -f1)
[ "$GOT" = "$FP" ] || fail "بصمةُ مفتاح الخادم (${GOT:0:8}…) لا تطابق بصمةَ ورقتك (${FP:0:8}…)."
echo "① ✅ مفتاحُ الخادم ٦٤ محرفاً وبصمتُه تطابق ورقتك (${FP:0:8}…)"

BASE="${PAR%%\?*}"
curl -fsS --max-time 90 "${PAR}?fields=name,size,timeCreated" -o "$W/l.json" \
  || fail "تعذّر سردُ مستودع النسخ (شبكةٌ مقطوعة أو انتهى رابطُ القراءة)."

NEWEST=$(python3 - "$W/l.json" <<'PY'
import sys, json
o = json.load(open(sys.argv[1])).get('objects', [])
h = [x for x in o if x['name'].startswith('hourly/') and x['name'].endswith('.tar.gpg')]
h.sort(key=lambda x: x['timeCreated'])
print(h[-1]['name'] if h else '')
PY
)
[ -n "$NEWEST" ] || fail "لا توجد أيُّ نسخةِ ساعةٍ في المستودع — هذا فشلٌ لا نجاح."
echo "② أحدثُ نسخةٍ مرفوعة: $NEWEST"

curl -fsS --max-time 900 -o "$W/c.gpg" "${BASE}${NEWEST}" || fail "تعذّر تنزيلُ النسخة."
# 🪤 اللاحقةُ `%.tar.gpg` لا `%.gpg`: الأخيرةُ تُنتج اسماً غيرَ موجودٍ فيبدو
#    ملفُّ البصمة مفقوداً وهو حاضر (وقع هذا الخطأ في فحصٍ يدويّ ٩ نوفمبر).
SIB="${NEWEST%.tar.gpg}.sha256"
curl -fsS --max-time 60 -o "$W/c.sha256" "${BASE}${SIB}" \
  || fail "ملفُّ البصمة المجاور مفقود ($SIB) — فلا أفرّق بين تنزيلٍ تالفٍ ومفتاحٍ خاطئ."
A=$(sha256sum "$W/c.gpg" | cut -d' ' -f1)
E=$(tr -d '[:space:]' < "$W/c.sha256")
[ "$A" = "$E" ] || fail "بصمةُ الملفّ المنزَّل لا تطابق المرفوعة — التنزيلُ تالف، والمفتاحُ بريء."
echo "③ ✅ سلامةُ التنزيل مؤكّدة ($(du -h "$W/c.gpg" | cut -f1))"

set +e
gpg --batch --quiet --yes --decrypt --passphrase-file <(printf '%s' "$KEY") \
    "$W/c.gpg" > "$W/out.bin" 2>"$W/e"
rc=$?
set -e
[ $rc -eq 0 ] || { echo "④ ❌ المفتاحُ لم يفكّ النسخة (gpg أعاد $rc)."; sed -n '1,3p' "$W/e"; exit 1; }
echo "④ ✅ المفتاحُ فكّ النسخةَ فعلاً"

D="$W/out.bin"
if [ "$(head -c 5 "$D")" != "PGDMP" ]; then
    mkdir -p "$W/x" && tar -xf "$W/out.bin" -C "$W/x" 2>/dev/null
    D=$(find "$W/x" -name '*.dump' | head -1)
    [ -n "$D" ] || fail "فُكّ التشفير لكن لا نسخةَ قاعدةٍ في الناتج."
    [ "$(head -c 5 "$D")" = "PGDMP" ] || fail "الناتجُ ليس نسخةَ PostgreSQL."
fi
SZ=$(wc -c < "$D")
echo "⑤ ✅ بصمةُ PGDMP حاضرة · $((SZ / 1048576)) م.ب"
[ "$SZ" -ge "$MIN_DUMP_BYTES" ] || fail "النسخةُ المفكوكة $SZ بايت — دون عقدِ المنتِج ($MIN_DUMP_BYTES)."

TD=0
if docker cp "$D" supabase-db:/tmp/v.dump >/dev/null 2>&1; then
    TD=$(docker exec supabase-db pg_restore -l /tmp/v.dump 2>/dev/null | grep -c 'TABLE DATA')
    docker exec supabase-db rm -f /tmp/v.dump >/dev/null 2>&1
fi
echo "⑥ جداولُ البيانات داخلها: $TD (المطلوب ≥ $MIN_TABLE_DATA)"
[ "$TD" -ge "$MIN_TABLE_DATA" ] || fail "عددُ الجداول دون العقد."

echo
echo "✅ المفتاحُ الذي على ورقتك يفتح أحدثَ نسخةٍ مرفوعة — مُثبَتٌ بالتنفيذ."
echo "   (ويبقى تثبيتُ GPG Suite مطلوباً ليومٍ لا يكون فيه هذا الخادمُ موجوداً.)"
