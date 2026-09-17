#!/usr/bin/env bash
# taki-preview-keepalive.sh — يمنع قاعدة المعاينة من النوم (v14.59)
#
# مشروع Supabase المجاني يُوقَف بعد **٧ أيام بلا أي طلب**، وإيقاظه ضغطةٌ يدوية
# في اللوحة. وناصر ليس مبرمجاً، فمعاينةٌ تحتاج إيقاظاً أسبوعياً معاينةٌ لا
# تُستعمل. وطلبٌ واحد يومياً يُبقيها حيّة إلى الأبد — وهذا أرخص بكثير من بناء
# مكدّس ثانٍ على خادم الإنتاج.
#
# ولا سرّ هنا: المفتاح المستعمل هو المفتاح العلني (anon) وهو عامٌّ بطبيعته.
# والطلب قراءةٌ لجدولٍ مرجعي — لا يكتب شيئاً.
set -uo pipefail

PREVIEW_URL="https://kbmqzxcjdankdgiovctm.supabase.co"
PREVIEW_ANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtibXF6eGNqZGFua2RnaW92Y3RtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjM0MDYsImV4cCI6MjA5MjEzOTQwNn0.1NAgosGhIx0_5WB8r53C0ss1jZnnTe_PGs6Ij-Bygwk"

CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 \
  -H "apikey: $PREVIEW_ANON" -H "Authorization: Bearer $PREVIEW_ANON" \
  "$PREVIEW_URL/rest/v1/") || CODE=000

# ٢٠٠ و٤٠١ و٤٠٤ كلها تعني «المشروع مستيقظ ويردّ». والنائم يردّ ٥٤٠ أو لا يردّ.
case "$CODE" in
  200|401|404) echo "$(date -Is) preview awake ($CODE)" ;;
  *)           echo "$(date -Is) ⚠️ preview not responding ($CODE)" ;;
esac
