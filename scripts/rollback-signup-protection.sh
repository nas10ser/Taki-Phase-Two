#!/usr/bin/env bash
# ============================================================================
# تراجُع فوري عن حمايات التسجيل — يُستعمل إن مُنع المستخدمون من التسجيل.
# يعيد آخر نسخة احتياطية من ملف التجاوز ويعيد تشغيل خدمة الحسابات.
#
#   bash scripts/rollback-signup-protection.sh
# ============================================================================
set -euo pipefail

HOST="ubuntu@141.147.142.147"
KEY="$HOME/.ssh/taki_oracle"
DIR="/opt/taki/supabase"

echo "> استرجاع آخر نسخة احتياطية"
ssh -i "$KEY" -o ConnectTimeout=20 "$HOST" "set -e
LAST=\$(ls -1t '$DIR'/docker-compose.taki.yml.bak.* 2>/dev/null | head -1)
[ -n \"\$LAST\" ] || { echo 'لا توجد نسخة احتياطية — لم يُغيَّر شيء.'; exit 1; }
echo \"  النسخة: \$LAST\"
sudo cp \"\$LAST\" '$DIR/docker-compose.taki.yml'
cd '$DIR' && sudo docker compose -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.taki.yml up -d auth 2>&1 | tail -3
for i in \$(seq 1 25); do
  st=\$(sudo docker inspect supabase-auth --format '{{.State.Health.Status}}' 2>/dev/null || echo none)
  [ \"\$st\" = healthy ] && { echo \"  صحّية بعد \$i فحصاً\"; break; }
  sleep 3
done
echo '  الإعداد الحيّ الآن:'
sudo docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E 'CAPTCHA_ENABLED|RATE_LIMIT_EMAIL_SENT' | sed 's/^/    /' || echo '    (الحمايات مُزالة — عاد للافتراضي 30/ساعة)'"

echo
echo "تراجَعنا. جرّب التسجيل على https://www.takisa.net/register"
