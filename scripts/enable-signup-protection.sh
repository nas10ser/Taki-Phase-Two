#!/usr/bin/env bash
# ============================================================================
# تفعيل حمايات التسجيل على خادم جدة + رفع سقف الرسائل استعداداً للإطلاق.
# ----------------------------------------------------------------------------
#   1) Turnstile على الخادم  — الموقع يرسل الرمز منذ v13.52، والخادم يتجاهله
#      حتى الآن. هذا ما يجعل الحماية حقيقية بدل كونها شكلاً في الصفحة.
#   2) منع كلمات المرور المسرَّبة (HIBP).
#   3) رفع GOTRUE_RATE_LIMIT_EMAIL_SENT من 30/ساعة (الافتراضي) إلى قيمة إطلاق.
#
# ⚠️ الترتيب مقصود: رفع السقف قبل تفعيل Turnstile يفتح باباً لإغراق بريدك
#    آلياً. لذلك يجريان معاً في أمر واحد لا ينفصلان.
#
# 🔒 المفتاح لا يظهر على الشاشة ولا في سجلّ الأوامر ولا في قائمة العمليات.
#
#   bash scripts/enable-signup-protection.sh
# ============================================================================
set -euo pipefail

HOST="ubuntu@141.147.142.147"
KEY="$HOME/.ssh/taki_oracle"
COMPOSE_DIR="/opt/taki/supabase"
OVERRIDE="$COMPOSE_DIR/docker-compose.taki.yml"
RATE="${TAKI_EMAIL_RATE:-1000}"

say()  { printf '\n\033[1m> %s\033[0m\n' "$1"; }
ssh_() { ssh -i "$KEY" -o ConnectTimeout=20 "$HOST" "$@"; }

# ── 1. المفتاح السري ────────────────────────────────────────────────────────
say "1/6 المفتاح السري لـ Turnstile"
cat <<'HOWTO'
افتح  https://dash.cloudflare.com  ثم اتبع هذه الأسماء الإنجليزية بالضبط:

  1. من القائمة اليمنى/اليسرى اضغط:            Turnstile
  2. في جدول الودجت اضغط على اسم:              Taki
  3. من الأعلى اضغط تبويب:                     Settings
  4. انزل حتى تجد قسماً عنوانه:                Secret Key
     (تحته زر  Copy  أو  Rotate Secret Key)
  5. اضغط  Copy  ← نُسخ المفتاح.

الفرق المهم:
  Site Key    = يظهر دائماً في الصفحة، ويوضع في الموقع  ← ليس هذا المطلوب
  Secret Key  = مخفيّ خلف زر Copy/Show                  ← هذا المطلوب

الحقل التالي لن يُظهر ما تلصقه (هذا طبيعي). الصق (Cmd+V) ثم اضغط Enter.
HOWTO
printf 'Secret Key: '
read -rs TURNSTILE_SECRET
echo
TURNSTILE_SECRET="$(printf '%s' "${TURNSTILE_SECRET:-}" | tr -d '[:space:]')"
if [ -z "$TURNSTILE_SECRET" ]; then
  echo "❌ لم يصل أي نصّ. اللصق أحياناً لا يعمل في الحقول المخفيّة ببعض الطرفيات."
  echo "   جرّب: انسخ المفتاح، ثم شغّل الأمر مرة أخرى والصق بـ Cmd+V (لن ترى شيئاً)."
  exit 1
fi
echo "طول المفتاح المُستلَم: ${#TURNSTILE_SECRET} حرفاً (لا يُطبع محتواه)."

# ── 2. اختبار المفتاح قبل تفعيل أي شيء ──────────────────────────────────────
# Cloudflare تفرّق بين «المفتاح خاطئ» و«الرمز خاطئ». نرسل رمزاً وهميّاً:
#   invalid-input-secret   ⇒ المفتاح غلط     → نتوقّف قبل أن نُقفل التسجيل
#   missing-input-secret   ⇒ لم يصل شيء
#   invalid-input-response ⇒ المفتاح سليم    → نكمل
# ⚠️ يُنفَّذ من خادم جدة لا من الماك: Cloudflare يخنق الطلبات المتكرّرة من نفس
#    العنوان فيُرجع رداً فارغاً، وهذا ما أفشل المحاولة السابقة — لا المفتاح.
say "2/6 التحقّق من المفتاح لدى Cloudflare (قبل تفعيل أي شيء)"
VERIFY=""
for attempt in 1 2 3; do
  VERIFY=$(printf '%s' "$TURNSTILE_SECRET" | ssh_ 'read -r S; curl -s --max-time 20 \
      --data-urlencode "secret=$S" --data-urlencode "response=taki-preflight-dummy" \
      https://challenges.cloudflare.com/turnstile/v0/siteverify' 2>/dev/null || true)
  [ -n "$VERIFY" ] && break
  echo "  محاولة $attempt: ردّ فارغ (خنق من Cloudflare) — أعيد بعد 5 ثوانٍ…"
  sleep 5
done

case "$VERIFY" in
  *invalid-input-response*)
    echo "✅ المفتاح صحيح (Cloudflare رفضت الرمز الوهمي لا المفتاح)." ;;
  *invalid-input-secret*)
    echo "❌ هذا ليس Secret Key صحيحاً. لم يُغيَّر شيء على الخادم."
    echo "   الأرجح أنك نسخت Site Key. ارجع للخطوة 4 أعلاه: القسم المعنون Secret Key."
    exit 1 ;;
  *missing-input-secret*)
    echo "❌ لم يصل المفتاح للخادم. لم يُغيَّر شيء."
    exit 1 ;;
  "")
    echo "❌ Cloudflare لم تردّ بعد ٣ محاولات — مشكلة شبكة لا مشكلة مفتاح."
    echo "   انتظر دقيقتين وأعد تشغيل الأمر. لم يُغيَّر شيء."
    exit 1 ;;
  *)
    echo "❌ ردّ غير متوقّع — لم يُغيَّر شيء:"
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
لو ظهرت رسالة «تعذّر التحقق من أنك لست روبوتاً» فتراجَع فوراً:

  bash scripts/rollback-signup-protection.sh
──────────────────────────────────────────────────────────────
DONE
