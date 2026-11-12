#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# TAKI · إشعالُ مضيف الصور `img.takisa.net` على خادم جدة — بأمرٍ واحد
#
#   bash scripts/setup-image-cdn-caddy.sh
#
# ما يفعله، بالترتيب، ولا يمضي خطوةً إن فشلت التي قبلها:
#   ① يرفض العملَ إن لم يُحلّ `img.takisa.net` بعد — كتلةٌ لمضيفٍ بلا سجلّ
#     تجعل Caddy تطلب شهادةً لا تستطيع إثباتَها فتُعيد المحاولة أبداً (وهو
#     العيبُ الذي كلّفنا `{$PROXY_DOMAIN}`).
#   ② ينسخ الإعدادَ احتياطياً على الخادم بختمٍ زمنيّ.
#   ③ يرفع Caddyfile المستودع ويفحص صيغتَه **داخل الحاوية** قبل أي تحميل.
#   ④ يُعيد التحميل (reload) لا التشغيل — بلا انقطاعِ ثانيةٍ على `api`.
#   ⑤ ينتظر الشهادة، ثمّ **يقيس**: صورةٌ حقيقيّةٌ تصل · والمساراتُ الممنوعة
#     تردّ 404 · و`api.takisa.net` ما زال يخدم كلَّ شيء.
#   ⑥ وإن فشل أيُّ قياس: **يُعيد النسخة الاحتياطية ويُحمّلها** ثمّ يخرج بخطأ.
#
# 🔇 لا يطبع هذا السكربت أيَّ سرّ.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

HOST_SSH="${TAKI_SSH_HOST:-ubuntu@207.127.99.122}"
KEY="${TAKI_SSH_KEY:-$HOME/.ssh/taki_jeddah2}"
CDN_HOST="${1:-img.takisa.net}"
API_HOST="api.takisa.net"
REMOTE_DIR=/opt/taki/supabase/volumes/proxy/caddy
LOCAL_CADDY="$(cd "$(dirname "$0")/.." && pwd)/supabase/ops/caddy/Caddyfile"

say()  { printf '%s\n' "$*"; }
die()  { printf '❌ %s\n' "$*" >&2; exit 1; }
ssh_() { ssh -o ConnectTimeout=25 -i "$KEY" "$HOST_SSH" "$@"; }

[ -f "$KEY" ]         || die "مفتاحُ جدة غير موجود: $KEY"
[ -f "$LOCAL_CADDY" ] || die "Caddyfile غيرُ موجودٍ في المستودع: $LOCAL_CADDY"
grep -q "^$CDN_HOST {" "$LOCAL_CADDY" || die "كتلةُ «$CDN_HOST» ليست في Caddyfile المستودع."

say "🖼  إشعالُ مضيف الصور: $CDN_HOST"
say ""

# ── ① شرطُ DNS ────────────────────────────────────────────────────────────
say "① هل يُحلّ الاسم؟"
IPS=$(dig +short "$CDN_HOST" A | grep -E '^[0-9.]+$' | tr '\n' ' ')
if [ -z "$IPS" ]; then
    die "«$CDN_HOST» لا يُحلّ بعد — لم يُضَف سجلُّ DNS.
   في Cloudflare ← takisa.net ← DNS ← Add record:
     Type=A · Name=img · IPv4=207.127.99.122 · Proxy status=🟠 Proxied
   ثمّ أعِد تشغيل هذا الأمر. (ولا تُنشر الكتلةُ قبل ذلك عمداً.)"
fi
say "   ✅ يُحلّ إلى: $IPS"
if printf '%s' "$IPS" | grep -q '207\.127\.99\.122'; then
    say "   ℹ️  رماديّ (DNS only) — يصل الخادمَ مباشرةً. يعمل، لكن **بلا شبكةِ توصيل**."
    PROXIED=0
else
    say "   ✅ برتقاليّ (Proxied) — خلف شبكة Cloudflare. وهذا هو الغرض."
    PROXIED=1
fi
say ""

# ── ② نسخةٌ احتياطية ──────────────────────────────────────────────────────
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BAK="$REMOTE_DIR/Caddyfile.bak-$STAMP"
say "② نسخةٌ احتياطيةٌ على الخادم: $(basename "$BAK")"
ssh_ "sudo cp $REMOTE_DIR/Caddyfile $BAK" || die "تعذّرت النسخةُ الاحتياطية."
say "   ✅"
say ""

restore() {
    say ""
    say "↩️  إعادةُ الإعداد السابق…"
    ssh_ "sudo cp $BAK $REMOTE_DIR/Caddyfile && sudo docker exec supabase-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile" >/dev/null 2>&1 \
        && say "   ✅ عاد الإعدادُ السابق وحُمّل." \
        || say "   🔴 تعذّرت الإعادةُ تلقائياً — النسخةُ في $BAK"
}

# ── ③ الرفعُ وفحصُ الصيغة ─────────────────────────────────────────────────
say "③ رفعُ الإعداد وفحصُ صيغته داخل الحاوية"
scp -q -o ConnectTimeout=25 -i "$KEY" "$LOCAL_CADDY" "$HOST_SSH:/tmp/Caddyfile.new" || { restore; die "تعذّر الرفع."; }
ssh_ "sudo cp /tmp/Caddyfile.new $REMOTE_DIR/Caddyfile && rm -f /tmp/Caddyfile.new" || { restore; die "تعذّر النسخ."; }
if ! ssh_ "sudo docker exec supabase-caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile" 2>&1 | tail -3; then
    restore; die "فحصُ الصيغة فشل — لم يُحمَّل شيء."
fi
say "   ✅ الصيغةُ سليمة"
say ""

# ── ④ إعادةُ التحميل ──────────────────────────────────────────────────────
say "④ إعادةُ التحميل (بلا إعادة تشغيل)"
ssh_ "sudo docker exec supabase-caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile" >/dev/null 2>&1 \
    || { restore; die "فشل التحميل."; }
say "   ✅"
say ""

# ── ⑤ القياس ──────────────────────────────────────────────────────────────
say "⑤ القياس"
SAMPLE=$(ssh_ "sudo docker exec supabase-db psql -U supabase_admin -d postgres -At -c \"SELECT name FROM storage.objects WHERE bucket_id='deals' AND name LIKE '%\\\\_t.jpg' ORDER BY name LIMIT 1\"" 2>/dev/null | tr -d '\r')
[ -n "$SAMPLE" ] || { restore; die "لا مصغّرةَ في المستودع للتجربة."; }
IMG_PATH="/storage/v1/object/public/deals/$SAMPLE"

say "   ينتظر الشهادة…"
OK=0
for i in $(seq 1 24); do
    CODE=$(curl -s -o /tmp/taki-cdn.bin -w '%{http_code}' --max-time 20 "https://$CDN_HOST$IMG_PATH" 2>/dev/null)
    if [ "$CODE" = "200" ]; then OK=1; break; fi
    sleep 10
done
if [ "$OK" != "1" ]; then
    ERR=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$CDN_HOST$IMG_PATH" 2>&1)
    say "   🔴 لم يردّ 200 بعد أربع دقائق (آخرُ رمز: $ERR)"
    say "      · 525/526 ⇒ وضعُ التشفير في Cloudflare خاطئ: SSL/TLS ← Overview ← **Full**"
    say "      · حلقةُ تحويل ⇒ الوضعُ «Flexible» — غيّره إلى **Full**"
    say "      · 404 ⇒ المسارُ خارج قائمة السماح في الكتلة"
    ssh_ "sudo docker logs --since 5m supabase-caddy 2>&1 | grep -iE 'img\.takisa|certificate|acme' | tail -12" || true
    restore; exit 1
fi

SIZE=$(wc -c < /tmp/taki-cdn.bin | tr -d ' ')
MAGIC=$(head -c 2 /tmp/taki-cdn.bin | od -An -tx1 | tr -d ' \n')
[ "$MAGIC" = "ffd8" ] || { restore; die "الردُّ ٢٠٠ لكنّه ليس JPEG (بصمة=$MAGIC) — ردُّ وسيطٍ أو صفحةُ خطأ."; }
say "   ✅ صورةٌ حقيقيّة: $SIZE بايت · بصمةُ JPEG صحيحة"

ORIG=$(curl -s -o /tmp/taki-orig.bin -w '%{size_download}' --max-time 20 "https://$API_HOST$IMG_PATH")
if [ "$SIZE" = "$ORIG" ]; then say "   ✅ مطابقةٌ للأصل بايتاً ببايت ($ORIG)"; else { restore; die "الحجمُ يخالف الأصل: $SIZE مقابل $ORIG"; }; fi

say "   المساراتُ الممنوعة على هذا الاسم:"
FAIL=0
for p in "/rest/v1/users?select=*" "/auth/v1/settings" "/functions/v1/phone-login" "/email-templates/recovery.html" "/storage/v1/object/public/chat/x" "/storage/v1/render/image/public/deals/x.jpg?width=300" "/" ; do
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$CDN_HOST$p")
    if [ "$c" = "404" ]; then say "      ✅ 404  $p"; else say "      🔴 $c  $p"; FAIL=1; fi
done
c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST "https://$CDN_HOST$IMG_PATH")
if [ "$c" = "404" ] || [ "$c" = "405" ]; then say "      ✅ $c  POST على الصورة (GET/HEAD وحدهما)"; else say "      🔴 $c  POST مرّ!"; FAIL=1; fi
[ "$FAIL" = "0" ] || { restore; die "سطحٌ مكشوفٌ على الاسم الجديد — أُعيد الإعدادُ السابق."; }

say "   لا تفاوضَ على الصيغة (شرطُ مخزنٍ مشترك):"
CT_W=$(curl -s -o /dev/null -D- --max-time 20 -H 'Accept: image/webp,image/*,*/*' "https://$CDN_HOST$IMG_PATH" | grep -i '^content-type' | tr -d '\r' | awk '{print $2}')
CT_J=$(curl -s -o /dev/null -D- --max-time 20 -H 'Accept: image/jpeg,*/*'        "https://$CDN_HOST$IMG_PATH" | grep -i '^content-type' | tr -d '\r' | awk '{print $2}')
if [ "$CT_W" = "$CT_J" ] && [ -n "$CT_W" ]; then
    say "      ✅ $CT_W لكلّ قيم Accept — صيغةٌ واحدة، فلا تُسمَّم ذاكرةُ الحافة"
else
    say "      🔴 صيغتان لنفس العنوان: webp⇒$CT_W · jpeg⇒$CT_J"
    restore; die "تفاوضٌ على الصيغة بلا Vary — لا يصلح لمخزنٍ مشترك."
fi

say "   الأصلُ القديم ما زال يعمل:"
for u in "https://$API_HOST$IMG_PATH|200" "https://$API_HOST/rest/v1/|200"; do
    url="${u%|*}"; want="${u#*|}"
    c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url")
    [ "$c" = "$want" ] && say "      ✅ $c  ${url#https://}" || { say "      🔴 $c (المتوقَّع $want)  ${url#https://}"; FAIL=1; }
done
c=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "https://$API_HOST/")
[ "$c" = "404" ] && say "      ✅ 404  لوحةُ Studio ما زالت مغلقة" || { say "      🔴 $c  جذرُ api تغيّر!"; FAIL=1; }
[ "$FAIL" = "0" ] || { restore; die "تأثّر الأصلُ القديم — أُعيد الإعدادُ السابق."; }

if [ "$PROXIED" = "1" ]; then
    say "   تخزينُ الحافة (ثلاثُ طلبات):"
    for i in 1 2 3; do
        st=$(curl -s -D- -o /dev/null --max-time 20 "https://$CDN_HOST$IMG_PATH" | grep -i '^cf-cache-status' | tr -d '\r' | awk '{print $2}')
        say "      $i: cf-cache-status=${st:-(غائبة)}"
    done
fi

say ""
say "✅ $CDN_HOST يعمل، والسطحُ محصورٌ بصور العروض العامّة."
say "   الخطوةُ الأخيرة:  node scripts/set-image-cdn.js $CDN_HOST"
say "   وللإيقاف فوراً:   node scripts/set-image-cdn.js --off"
