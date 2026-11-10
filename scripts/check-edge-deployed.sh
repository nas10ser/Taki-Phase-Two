#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# TAKI · هل ما يعمل على جدة هو ما في المستودع؟
#
# 🔴 **العيبُ الذي كشفه هذا الفحصُ أوّلَ مرّة (١٠ نوفمبر ٢٠٢٦):** دالّتان
#    منشورتان كانتا متخلّفتين عن المستودع **بإصلاحَين أمنيَّين**:
#      • `merchant-pay` — ثغرةُ «مبلغٌ مجهول = مدفوع» (أُغلقت في المستودع
#        بـv15.79 ولم تُنشر): استبدالُ المبلغ الغائب بإجمالي الفاتورة يجعل
#        المقارنة `got >= expected` صحيحةً **دائماً**.
#      • `stock-webhook` — تمريرُ `p_observed_at` (v15.80) غيرُ منشور، فحارسُ
#        `STALE_OBSERVATION` لا يُمسك جسماً مُعاداً إطلاقاً.
#    و`npm test` **لا يستطيع كشفَ هذا**: Vercel تبني بلا شبكةٍ إلى جدة،
#    و`check-edge-parity.js` يفحص **المستودع** لا المنشور. فالجردُ كان يقول
#    «١١ دالّة كما هو متوقَّع» وهو صادقٌ في المستودع وكاذبٌ على الخادم.
#
# ⇒ يُشغَّل **يدوياً قبل كلّ إصدارٍ كبير** ومعه `security-probe.sh`:
#      bash scripts/check-edge-deployed.sh
#
# 🪤 ويقارن **كلّ ملفّات** كلّ دالّة لا `index.ts` وحده: `merchant-pay` تملك
#    `adapters.ts` و`helpers.ts`، وكان الانحرافُ في `adapters.ts` أيضاً.
# 🪤 و`main` موجِّهُ منصّة سوبابيس لا دالّةٌ لنا — يُستثنى صراحةً، ولا يُستثنى
#    بالصمت: غيابُه من المستودع **ليس** انحرافاً، وغيابُ غيرِه انحرافٌ صارخ.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

HOST=ubuntu@207.127.99.122
KEY="$HOME/.ssh/taki_jeddah2"
REMOTE=/opt/taki/supabase/volumes/functions
LOCAL="$(cd "$(dirname "$0")/.." && pwd)/supabase/functions"
PLATFORM_ONLY="main"

[ -f "$KEY" ] || { echo "❌ مفتاحُ جدة غير موجود: $KEY"; exit 1; }
[ -d "$LOCAL" ] || { echo "❌ مجلّدُ الدوالّ غير موجود: $LOCAL"; exit 1; }

echo "🔍 مقارنةُ الدوالّ الحافّة: جدة ↔ المستودع"
echo

TMP=$(mktemp -d /tmp/taki-edge.XXXXXX); trap 'rm -rf "$TMP"' EXIT

ssh -o ConnectTimeout=25 -i "$KEY" "$HOST" \
  "cd $REMOTE 2>/dev/null && for d in */; do n=\${d%/}; for f in \$(sudo ls \"\$n\" 2>/dev/null); do \
     case \"\$f\" in *.ts) echo \"\$n/\$f \$(sudo shasum -a 256 \"\$n/\$f\" | cut -d' ' -f1)\";; esac; done; done" \
  > "$TMP/remote.txt" 2>/dev/null || { echo "❌ تعذّر الوصول إلى جدة."; exit 1; }

REMOTE_N=$(wc -l < "$TMP/remote.txt" | tr -d ' ')
[ "$REMOTE_N" -ge 10 ] || { echo "❌ قُرئ $REMOTE_N ملفّاً فقط من الخادم — مسحٌ فارغٌ لا نجاح."; exit 1; }

drift=0; missing=0; orphan=0; same=0
while read -r rel hash; do
  fn="${rel%%/*}"
  if [ "$fn" = "$PLATFORM_ONLY" ]; then continue; fi
  if [ ! -f "$LOCAL/$rel" ]; then
    echo "  🔴 $rel — منشورٌ **بلا مصدرٍ في المستودع**"
    orphan=$((orphan+1)); continue
  fi
  L=$(shasum -a 256 "$LOCAL/$rel" | cut -d' ' -f1)
  if [ "$L" = "$hash" ]; then
    same=$((same+1))
  else
    echo "  🔴 $rel — المنشورُ يختلف عن المستودع"
    echo "       منشور ${hash:0:16}…  ·  مستودع ${L:0:16}…"
    drift=$((drift+1))
  fi
done < "$TMP/remote.txt"

# والعكس: ما في المستودع ولم يُنشر
for d in "$LOCAL"/*/; do
  n=$(basename "$d")
  [ "$n" = "_shared" ] && continue
  for f in "$d"*.ts; do
    [ -f "$f" ] || continue
    rel="$n/$(basename "$f")"
    grep -q "^$rel " "$TMP/remote.txt" || { echo "  🔴 $rel — في المستودع و**لم يُنشر**"; missing=$((missing+1)); }
  done
done

echo
if [ $((drift+missing+orphan)) -eq 0 ]; then
  echo "✅ $same ملفّاً منشوراً يطابق المستودع بايتاً ببايت · صفرُ انحراف"
  exit 0
fi
echo "❌ انحراف: $drift مختلف · $missing غيرُ منشور · $orphan بلا مصدر  (و$same مطابقاً)"
echo
echo "   النشرُ (بعد مراجعةِ الفرق — ولا يُنشر شيءٌ بلا قراءةِ ما يتغيّر):"
echo "     scp -i ~/.ssh/taki_jeddah2 supabase/functions/<الدالّة>/<الملفّ> $HOST:/tmp/x.ts"
echo "     ssh -i ~/.ssh/taki_jeddah2 $HOST 'sudo cp /tmp/x.ts $REMOTE/<الدالّة>/<الملفّ> \\"
echo "        && sudo docker restart supabase-edge-functions'"
echo "   🪤 واحفظ نسخةً من المنشور قبل الاستبدال، وتحقّق من السجلّ بعد التشغيل:"
echo "     sudo docker logs --since 60s supabase-edge-functions | grep -i error"
exit 1
