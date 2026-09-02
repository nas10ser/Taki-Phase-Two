#!/usr/bin/env bash
# ============================================================================
# تفعيل حمايات التسجيل على خادم جدة + رفع سقف الرسائل استعداداً للإطلاق.
# ----------------------------------------------------------------------------
# يفعّل ثلاثة أشياء دفعة واحدة:
#   1) Turnstile على الخادم  — الموقع يرسل الرمز منذ v13.52، والخادم يتجاهله
#      حتى الآن. هذا ما يجعل الحماية حقيقية بدل كونها شكلاً في الصفحة.
#   2) منع كلمات المرور المسرَّبة (HIBP).
#   3) رفع GOTRUE_RATE_LIMIT_EMAIL_SENT من 30/ساعة (الافتراضي) إلى قيمة إطلاق.
#
# ⚠️ الترتيب مقصود: رفع السقف قبل تفعيل Turnstile يفتح باباً لإغراق بريدك
#    آلياً. لذلك يجريان معاً في أمر واحد لا ينفصلان.
#
# 🔒 المفتاح السري لا يظهر على الشاشة ولا في سجلّ الأوامر ولا في قائمة
#    العمليات على الخادم — يُقرأ مخفيّاً ويُمرَّر عبر stdin.
#
#   bash scripts/enable-signup-protection.sh
# ============================================================================
set -euo pipefail

HOST="ubuntu@141.147.142.147"
KEY="$HOME/.ssh/taki_oracle"
COMPOSE_DIR="/opt/taki/supabase"
OVERRIDE="$COMPOSE_DIR/docker-compose.taki.yml"
# سقف الرسائل في الساعة. الحدّ الحقيقي بعده هو باقة Resend لا هذا الرقم.
RATE="${TAKI_EMAIL_RATE:-1000}"

say()  { printf '\n\033[1m> %s\033[0m\n' "$1"; }
ssh_() { ssh -i "$KEY" -o ConnectTimeout=20 "$HOST" "$@"; }

# ── 1. المفتاح السري ────────────────────────────────────────────────────────
say "1/6 المفتاح السري لـ Turnstile"
cat <<'HOWTO'
من لوحة Cloudflare:  Turnstile ← الودجت «Taki» ← Settings
انسخ  Secret Key  (وليس Site Key — السرّي هو الطويل الذي يبدأ بـ 0x4AAA…)
الحقل التالي لن يُظهر ما تلصقه. الصق ثم اضغط Enter.
HOWTO
printf 'Secret Key: '
read -rs TURNSTILE_SECRET
echo
[ -n "${TURNSTILE_SECRET:-}" ] || { echo "لم تلصق شيئاً — أُلغي."; exit 1; }

# ── 2. اختبار المفتاح قبل تفعيل أي شيء ──────────────────────────────────────
# Cloudflare تفرّق بين «المفتاح خاطئ» و«الرمز خاطئ». نرسل رمزاً وهميّاً:
#   invalid-input-secret   ⇒ المفتاح غلط     → نتوقّف قبل أن نُقفل التسجيل
#   invalid-input-response ⇒ المفتاح سليم    → نكمل
say "2/6 التحقّق من المفتاح لدى Cloudflare (قبل تفعيل أي شيء)"
VERIFY=$(curl -s --max-time 20 \
  -d "secret=$TURNSTILE_SECRET" -d "response=taki-preflight-dummy" \
  https://challenges.cloudflare.com/turnstile/v0/siteverify || true)
case "$VERIFY" in
  *invalid-input-secret*)
    echo "❌ المفتاح غير صحيح. لم يُغيَّر شيء على الخادم."
    echo "   تأكّد أنك نسخت Secret Key لا Site Key."
    exit 1 ;;
  *invalid-input-response*)
    echo "✅ المفتاح صحيح (Cloudflare رفضت الرمز الوهمي لا المفتاح)." ;;
  *)
    echo "❌ ردّ غير متوقّع من Cloudflare — لم يُغيَّر شيء:"
    echo "   $VERIFY"
    exit 1 ;;
esac

# ── 3. نسخة احتياطية ────────────────────────────────────────────────────────
say "3/6 نسخة احتياطية من الإعداد"
ssh_ "sudo cp '$OVERRIDE' '$OVERRIDE.bak.\$(date +%Y%m%d-%H%M%S)' && ls -1 '$OVERRIDE'.bak.* | tail -1"

# ── 4. كتابة الإعداد (المفتاح يصل عبر stdin لا عبر سطر الأوامر) ─────────────
say "4/6 كتابة الإعداد على الخادم"
printf '%s' "$TURNSTILE_SECRET" | ssh_ "sudo tee /root/.taki_turnstile_secret >/dev/null && sudo chmod 600 /root/.taki_turnstile_secret && echo 'المفتاح خُزّن بصلاحية 600'"
unset TURNSTILE_SECRET

ssh_ "sudo python3 - '$OVERRIDE' '$RATE' <<'PY'
import sys, re
path, rate = sys.argv[1], sys.argv[2]
secret = open('/root/.taki_turnstile_secret', encoding='utf-8').read().strip()
s = open(path, encoding='utf-8').read()

block = '''      # v13.93 — حمايات الإطلاق. الترتيب مقصود: السقف لا يُرفع إلا مع
      # Turnstile مفعّلاً، وإلا صار إغراق البريد آلياً ممكناً.
      GOTRUE_SECURITY_CAPTCHA_ENABLED: \"true\"
      GOTRUE_SECURITY_CAPTCHA_PROVIDER: \"turnstile\"
      GOTRUE_SECURITY_CAPTCHA_SECRET: \"__SECRET__\"
      GOTRUE_PASSWORD_HIBP_ENABLED: \"true\"
      # الافتراضي 30/ساعة على مستوى المنصة كلها — كان سيرفض المسجّل الحادي
      # والثلاثين في أول ساعة إطلاق. الحدّ الحقيقي بعد هذا هو باقة Resend.
      GOTRUE_RATE_LIMIT_EMAIL_SENT: \"__RATE__\"
'''.replace('__SECRET__', secret).replace('__RATE__', rate)

# آمن للتكرار: أزل أي كتلة سابقة ثم أضف الحالية.
s = re.sub(r'\n *# v13\.93 —.*?(?=\n  [a-z]|\Z)', '\n', s, flags=re.S)
for k in ('GOTRUE_SECURITY_CAPTCHA_ENABLED','GOTRUE_SECURITY_CAPTCHA_PROVIDER',
          'GOTRUE_SECURITY_CAPTCHA_SECRET','GOTRUE_PASSWORD_HIBP_ENABLED',
          'GOTRUE_RATE_LIMIT_EMAIL_SENT'):
    s = re.sub(r'\n *' + k + r':.*', '', s)

anchor = '      GOTRUE_MAILER_TEMPLATES_CONFIRMATION:'
assert s.count(anchor) == 1, 'لم أجد كتلة auth في ملف التجاوز'
s = s.replace(anchor, block + anchor)
open(path, 'w', encoding='utf-8').write(s)
print('أُضيفت إعدادات الحماية')
PY"

# ── 5. التطبيق ──────────────────────────────────────────────────────────────
say "5/6 إعادة تشغيل خدمة الحسابات"
ssh_ "cd '$COMPOSE_DIR' && sudo docker compose -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.taki.yml up -d auth 2>&1 | tail -3
for i in \$(seq 1 25); do
  st=\$(sudo docker inspect supabase-auth --format '{{.State.Health.Status}}' 2>/dev/null || echo none)
  [ \"\$st\" = healthy ] && { echo \"صحّية بعد \$i فحصاً\"; exit 0; }
  sleep 3
done
echo 'لم تصبح صحّية'; exit 1"

# ── 6. القياس ───────────────────────────────────────────────────────────────
say "6/6 التحقّق"
ssh_ "sudo docker inspect supabase-auth --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | grep -E 'CAPTCHA_ENABLED|CAPTCHA_PROVIDER|HIBP_ENABLED|RATE_LIMIT_EMAIL_SENT' \
  | sed -E 's/(SECRET)=.*/\1=***مخفي***/'"

echo
ssh_ 'AUTH_IP=$(sudo docker inspect supabase-auth --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}")
body=$(curl -s --max-time 15 -X POST -H "Content-Type: application/json" \
  -d "{\"email\":\"captcha-probe@example.com\",\"password\":\"Aa1!aaaaaaaa\"}" "http://$AUTH_IP:9999/signup")
case "$body" in
  *captcha*) echo "✅ تسجيل بلا رمز تحقّق مرفوض — الحماية تعمل فعلاً." ;;
  *)         echo "❌ تسجيل بلا رمز تحقّق لم يُرفض! الحماية غير فعّالة:"; echo "   $body" ;;
esac'

cat <<'DONE'

──────────────────────────────────────────────────────────────
افتح الآن https://www.takisa.net/register وجرّب تسجيلاً حقيقياً.
لو ظهرت رسالة «تعذّر التحقق من أنك لست روبوتاً» فالمفتاحان غير
متطابقين — تراجَع فوراً بهذا الأمر:

  ssh -i ~/.ssh/taki_oracle ubuntu@141.147.142.147 \
    'cd /opt/taki/supabase && sudo cp $(ls -1t docker-compose.taki.yml.bak.* | head -1) docker-compose.taki.yml && \
     sudo docker compose -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.taki.yml up -d auth'
──────────────────────────────────────────────────────────────
DONE
