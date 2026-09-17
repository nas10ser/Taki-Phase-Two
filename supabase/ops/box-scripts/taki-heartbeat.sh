#!/usr/bin/env bash
# taki-heartbeat.sh — نبض تاكي كل عشر دقائق (v14.55)
#
# 🔴 لماذا الفحص السريع هنا لا على GitHub: مراقبة GitHub مجدولةٌ كل عشر دقائق
# منذ أغسطس، وقياسُ آخر ٣٠ تشغيلاً أعطى وسيطاً **٢٠٥ دقيقة** (أسوأها ٤١٤).
# جدولةُ GitHub بذلُ أفضل لا ضمان. أمّا كرون هذا الخادم فمُثبَتُ الانضباط.
# فالسريع هنا، والخارجي هناك — ولكلٍّ ما يُحسنه.
#
# والتنبيه يُكتب إشعاراً في القاعدة داخل `taki_write_heartbeat`، فيلتقطه صندوق
# البوت الصادر خلال ثوانٍ ويصل جوّال ناصر. لا بريد ولا انتظار.
#
# 🪤 وأي فحصٍ **لم يُنفَّذ** يُمرَّر NULL لا «سليم»: تعطّلُ الأداة نفسها يجب أن
# يُنتج تحذيراً، لا «كل شيء بخير».
set -uo pipefail

DISK=$(df --output=pcent / | tail -1 | tr -dc '0-9')
MEM=$(free | awk '/^Mem:/ {printf "%d", ($2-$7)/$2*100}')

BACKUP_DIR=/home/ubuntu/backups
if LATEST=$(ls -1t "$BACKUP_DIR"/*.dump 2>/dev/null | head -1) && [ -n "$LATEST" ]; then
  AGE=$(awk -v n="$(date +%s)" -v m="$(stat -c %Y "$LATEST")" 'BEGIN{printf "%.2f",(n-m)/3600}')
else
  AGE=999
fi

# الموقع — من الخادم نفسه، فهو فحصُ «هل Vercel يخدم» لا فحصُ شبكتنا الداخلية.
SITE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://www.takisa.net/) || SITE=""
[ -n "$SITE" ] || SITE=000
case "$SITE" in ''|*[!0-9]*) SITE_SQL=NULL ;; *) SITE_SQL="$SITE" ;; esac

# البوت — وجودُ العملية ليس صحّة: نشترط أن تكون خدمتا تيليجرام والقاعدة حيّتين.
BOT_JSON=$(curl -s --max-time 25 https://taki-bot-l0ll.onrender.com/health) || BOT_JSON=""
if [ -z "$BOT_JSON" ]; then
  BOT_SQL=false
else
  BOT_SQL=$(printf '%s' "$BOT_JSON" | python3 -c "
import json,sys
try: d=json.load(sys.stdin)
except Exception: print('false'); raise SystemExit
s=d.get('services') or {}
print('true' if d.get('status')=='active' and s.get('telegram') is True and s.get('supabase') is True else 'false')
" 2>/dev/null) || BOT_SQL=false
fi
[ "$BOT_SQL" = "true" ] || [ "$BOT_SQL" = "false" ] || BOT_SQL=false

docker exec supabase-db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -At \
  -c "SELECT public.taki_write_heartbeat(${DISK}, ${MEM}, ${AGE}, ${SITE_SQL}, ${BOT_SQL});"
