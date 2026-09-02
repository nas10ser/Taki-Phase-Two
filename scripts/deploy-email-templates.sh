#!/usr/bin/env bash
# ============================================================================
# نشر قوالب بريد GoTrue ثنائية اللغة إلى خادم جدة.
# ----------------------------------------------------------------------------
# القوالب تُخدَم من Caddy على https://api.takisa.net/email-templates/<name>.html
# وGoTrue يجلبها منها ويخزّنها ١٠ دقائق. السكربت آمن للتكرار:
# يضيف كتلة Caddy مرة واحدة فقط، ويتحقق من كل رابط بعد النشر.
#
#   bash scripts/deploy-email-templates.sh
# ============================================================================
set -euo pipefail

HOST="ubuntu@141.147.142.147"
KEY="$HOME/.ssh/taki_oracle"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/supabase/email-templates"
CADDY_DIR="/opt/taki/supabase/volumes/proxy/caddy"
DEST="$CADDY_DIR/email-templates"
BASE="https://api.takisa.net/email-templates"
FILES=(confirmation.html recovery.html email_change.html)

say()  { printf '\n\033[1m> %s\033[0m\n' "$1"; }
ssh_() { ssh -i "$KEY" -o ConnectTimeout=20 "$HOST" "$@"; }

say "1/4 رفع القوالب"
for f in "${FILES[@]}"; do
  [ -f "$SRC/$f" ] || { echo "مفقود: $SRC/$f"; exit 1; }
done
scp -i "$KEY" -q "${FILES[@]/#/$SRC/}" "$HOST:/tmp/"
ssh_ "sudo mkdir -p '$DEST' && sudo cp ${FILES[*]/#//tmp/} '$DEST/' && sudo chmod 644 '$DEST'/*.html && ls -la '$DEST'"

say "2/4 كتلة Caddy"
if ssh_ "sudo grep -q email-templates '$CADDY_DIR/Caddyfile'"; then
  echo "موجودة مسبقاً - لا تعديل."
else
  echo "ناقصة - أضفها يدوياً أو أعد تشغيل خطوة الإعداد."
  exit 1
fi

say "3/4 إعادة تحميل Caddy (بلا انقطاع)"
# كلمة سر لوحة Studio تُحوَّل لبصمة bcrypt عند الإقلاع، وأي reload جديد يرث
# النص الصريح - فنكرّر التحويل نفسه وإلا رفض Caddy الإعداد.
ssh_ 'sudo docker exec supabase-caddy sh -c "PROXY_AUTH_PASSWORD=\$(caddy hash-password --plaintext \"\$PROXY_AUTH_PASSWORD\") caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1"'

say "4/4 التحقّق من الروابط (من داخل حاوية GoTrue نفسها)"
fail=0
for f in "${FILES[@]}"; do
  out=$(ssh_ "sudo docker exec supabase-auth sh -c 'wget -q -O- --timeout=10 $BASE/$f | wc -c'" 2>/dev/null || echo 0)
  if [ "${out:-0}" -gt 2000 ]; then
    printf 'OK   %-20s %s بايت\n' "$f" "$out"
  else
    printf 'FAIL %-20s غير قابل للجلب (%s)\n' "$f" "${out:-0}"; fail=1
  fi
done
if [ "$fail" = 0 ]; then
  echo ""
  echo "تم: كل القوالب منشورة ويصل إليها GoTrue."
  echo "ملاحظة: GoTrue يخزّن القالب 10 دقائق، فأي تعديل يسري خلالها."
else
  echo ""
  echo "فشل النشر."
  exit 1
fi
