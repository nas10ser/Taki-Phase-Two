#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# TAKI — فحص أمني **حيّ** على الإنتاج (خادم جدة + Vercel)
#
# الفكرة: لا نفحص الإعدادات على الورق — بل ننتحل دور **زائر مجهول** يملك
# مفتاح المتصفح العلني (وهو مفتاح عامّ بطبيعته، يُنزّله كل زائر مع الصفحة)،
# ثم نحاول فعلاً قراءة ما يجب ألا يُقرأ وكتابة ما يجب ألا يُكتب.
#
# لا أسرار في هذا الملف ولا في المستودع: المفتاح العلني والعنوان يُستخرجان
# لحظة التشغيل من النسخة المنشورة نفسها.
#
# كل محاولات الكتابة مصمَّمة لتفشل عند القيود حتى لو نجحت في الصلاحيات، فلا
# يُكتب صفّ واحد على الإنتاج مهما كانت النتيجة. وهذا التمييز بالذات هو
# المطلوب: «مرفوض عند الصلاحيات» ✅  مقابل  «مرّ الصلاحيات ورفضته القيود» ❌.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

SITE="${SITE:-https://taki-test-eight.vercel.app}"
DB="${DB:-https://141-147-142-147.sslip.io}"
DBHOST="${DBHOST:-141-147-142-147.sslip.io}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# جذر المستودع يُشتقّ من موقع السكربت نفسه، فيعمل من أي مجلد
# (كان يقرأ sw.js من مجلد العمل، فيفشل حين يُشغَّل من ~).
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

fail=0; warned=0; passed=0
ok()   { printf '  ✅ %s\n' "$1"; passed=$((passed+1)); }
bad()  { printf '  ❌ %s\n' "$1"; fail=$((fail+1)); }
inf()  { printf '  ⚠️  %s\n' "$1"; warned=$((warned+1)); }
hdr()  { printf '\n═══ %s\n' "$1"; }

# ── ١) استخراج العنوان والمفتاح العلني من النسخة المنشورة ────────────────
hdr "الهوية: ما الذي يخدمه الموقع فعلاً؟"
if ! curl -fsS --max-time 30 "$SITE/" -o "$TMP/index.html"; then
    bad "الموقع لا يستجيب — أُوقف الفحص"; exit 1
fi
ANON=""; FOUND_URL=""; SR_LEAK=""
while read -r s; do
    [ -n "$s" ] || continue
    case "$s" in http*) u="$s";; /*) u="$SITE$s";; *) u="$SITE/$s";; esac
    curl -fsS --max-time 60 "$u" -o "$TMP/chunk.js" || continue
    [ -n "$FOUND_URL" ] || FOUND_URL=$(grep -oE 'https://[A-Za-z0-9.-]+\.(sslip\.io|supabase\.co)' "$TMP/chunk.js" | head -1)
    # كل توكن JWT في الحزمة: نفكّ حمولته ونتأكد أنه ليس مفتاح الخدمة
    while read -r j; do
        [ -n "$j" ] || continue
        payload=$(printf '%s' "$j" | cut -d. -f2)
        # الحشو يدوياً لا بـseq: على BSD يطبع `seq 0 -1` السطرين «0» و«-1»
        # فيُضاف حشوٌ لسلسلة مكتملة أصلاً ويفشل الفكّ بصمت ⇒ «لا مفتاح».
        case $(( (4 - ${#payload} % 4) % 4 )) in
            1) padstr='=' ;; 2) padstr='==' ;; 3) padstr='===' ;; *) padstr='' ;;
        esac
        dec=$(printf '%s%s' "$payload" "$padstr" | tr '_-' '/+' | base64 -d 2>/dev/null)
        [ -n "$dec" ] || dec=$(printf '%s%s' "$payload" "$padstr" | tr '_-' '/+' | openssl base64 -d -A 2>/dev/null)
        case "$dec" in
            *service_role*) SR_LEAK="yes" ;;
            *anon*) [ -n "$ANON" ] || ANON="$j" ;;
        esac
    done < <(grep -oE 'eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}' "$TMP/chunk.js" | sort -u)
    [ -n "$ANON" ] && [ -n "$FOUND_URL" ] && break
done < <(grep -oE "src=[\"']?[^\"' >]+\.js" "$TMP/index.html" \
         | sed -E "s/^src=[\"']?//" | grep -v '^https\?://' )

if [ -z "$ANON" ]; then bad "تعذّر استخراج مفتاح المتصفح من النسخة المنشورة — أُوقف الفحص"; exit 1; fi
if [ "$FOUND_URL" = "$DB" ]; then ok "الموقع المنشور يشير إلى خادم جدة ($FOUND_URL)"
else bad "الموقع المنشور يشير إلى «$FOUND_URL» لا إلى جدة!"; fi
if [ -n "$SR_LEAK" ]; then bad "🚨 مفتاح الخدمة (service_role) مسرَّب داخل حزمة المتصفح — كارثي"
else ok "لا أثر لمفتاح الخدمة داخل حزمة المتصفح"; fi

# ── أدوات الطلب ─────────────────────────────────────────────────────────
req() { # method path [body]
    local m="$1" p="$2" b="${3:-}"
    local a=(-s -o "$TMP/out" -w '%{http_code}' --max-time 30 -X "$m"
             -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -H 'Accept: application/json')
    [ -n "$b" ] && a+=(-H 'Content-Type: application/json' -H 'Prefer: return=minimal' --data "$b")
    CODE=$(curl "${a[@]}" "$DB$p") || CODE=000
    BODY=$(head -c 400 "$TMP/out" 2>/dev/null || printf '')
    ERRC=$(printf '%s' "$BODY" | grep -oE '"code":"[^"]*"' | head -1 | cut -d'"' -f4)
}

read_denied() { # label path
    req GET "$2"
    case "$CODE" in
        401|403|404) ok "$1 — محجوب ($CODE)" ;;
        200) if [ "$BODY" = "[]" ] || [ -z "$BODY" ]; then ok "$1 — لا يُعيد شيئاً للزائر"
             else bad "$1 — 🚨 يُعيد بيانات للزائر: $(printf '%.100s' "$BODY")"; fi ;;
        000) bad "$1 — لا استجابة من الخادم" ;;
        400) inf "$1 — اسم عمود خاطئ في الفحص نفسه ($ERRC) — ليست نتيجة أمنية" ;;
        *)   inf "$1 — رمز غير متوقّع ($CODE ${ERRC:-})" ;;
    esac
}

write_blocked() { # label method path body
    req "$2" "$3" "$4"
    case "$CODE" in
        200|201|204) bad "$1 — 🚨 نجحت الكتابة من زائر مجهول!" ; return ;;
        401|403|404) ok "$1 — مرفوض عند الصلاحيات ($CODE)" ; return ;;
    esac
    case "${ERRC:-}" in
        42501|PGRST301|PGRST302|42P01|PGRST205|PGRST106|PGRST202)
            ok "$1 — مرفوض عند الصلاحيات (${ERRC})" ;;
        23502|23503|23505|23514)
            bad "$1 — 🚨 تجاوز طبقة الصلاحيات ووصل لفحص القيود (${ERRC}) ⇒ الزائر يملك حقّ الكتابة" ;;
        42703|PGRST204|PGRST100|22P02)
            inf "$1 — اسم عمود/حقل خاطئ في الفحص نفسه (${ERRC}) — صحّح الفحص، ليست نتيجة أمنية" ;;
        "") inf "$1 — رمز $CODE بلا تصنيف: $(printf '%.90s' "$BODY")" ;;
        *)  inf "$1 — رُفض بـ${ERRC} (راجعه يدوياً)" ;;
    esac
}

# ── ٢) شاهد الصحّة: بدونه كل «محجوب» أدناه بلا معنى ─────────────────────
hdr "شاهد الصحّة (هل نحن فعلاً نكلّم قاعدة حيّة؟)"
req GET "/rest/v1/deals?select=id&limit=1"
if [ "$CODE" = "200" ] && [ "$BODY" != "[]" ] && [ -n "$BODY" ]; then
    ok "الزائر يقرأ العروض العامة ⇒ القاعدة حيّة والمفتاح صالح"
else
    bad "شاهد الصحّة فشل (رمز $CODE) — بقيّة النتائج غير موثوقة"; exit 1
fi

# ── ٣) القراءة: ما الذي يستطيع زائر مجهول أن يراه؟ ──────────────────────
hdr "تسريب البيانات — محاولات قراءة من زائر مجهول"
read_denied "أرقام جوّالات وبُرُد المستخدمين" "/rest/v1/users?select=phone,email&phone=not.is.null&limit=1"
read_denied "الحجوزات (باركود + بيانات المشتري)" "/rest/v1/bookings?select=barcode,user_id&limit=1"
read_denied "رسائل المحادثات"                   "/rest/v1/booking_messages?select=barcode,body&limit=1"
read_denied "الإشعارات"                          "/rest/v1/notifications?select=id,user_id&limit=1"
read_denied "مفاتيح بوابات الدفع للتجار"        "/rest/v1/merchant_gateways?select=*&limit=1"
read_denied "أحداث التحليلات"                    "/rest/v1/store_analytics_events?select=*&limit=1"
read_denied "مشاركات المسابقات (بيانات شخصية)"  "/rest/v1/contest_entries?select=*&limit=1"
read_denied "أسرار الخزنة"                       "/rest/v1/vault_secrets?select=*&limit=1"

# ── ٤) الكتابة: هل يستطيع زائر مجهول أن يغيّر شيئاً؟ ────────────────────
hdr "الكتابة — محاولات تخريب من زائر مجهول (لا تُكتب أي بيانات)"
write_blocked "إنشاء عرض وهمي"        POST  "/rest/v1/deals" '{"id":"__taki_probe__"}'
write_blocked "تعديل عرض قائم"        PATCH "/rest/v1/deals?id=eq.__taki_probe__" '{"item_name":"__taki_probe__"}'
write_blocked "ترقية حساب إلى مدير"   PATCH "/rest/v1/users?id=eq.__taki_probe__" '{"user_type":"admin"}'
write_blocked "إنشاء حجز مزوّر"       POST  "/rest/v1/bookings" '{"barcode":"__taki_probe__"}'
write_blocked "دسّ رسالة في محادثة"   POST  "/rest/v1/booking_messages" '{"barcode":"__taki_probe__","body":"__taki_probe__","sender_id":"__taki_probe__","sender_role":"buyer"}'
write_blocked "حذف عرض"               DELETE "/rest/v1/deals?id=eq.__taki_probe__" ''
write_blocked "منح اشتراك لنفسه"      PATCH "/rest/v1/store_profiles?store_id=eq.__taki_probe__" '{"subscription_plan":"pro"}'
write_blocked "استدعاء دالة إرسال رسالة" POST "/rest/v1/rpc/send_booking_message" '{"p_barcode":"__taki_probe__","p_body":"__taki_probe__"}'

# ── ٥) الدوال: بوابة البوت والدوال الإدارية ─────────────────────────────
hdr "الدوال المحميّة"
# ── بوّابة البوت: ما الذي يمكن حسمه من الخارج وما الذي لا يمكن ──────────
# الدوال العامة (تصفّح/جغرافيا/بحث/باقات/is_enabled) **مفتوحة بالتصميم** —
# استجابتها بلا سرّ ليست ثغرة، وقد أوقعني هذا في إنذار كاذب أول مرّة.
# والدوال الخاصة بالمستخدم تمرّ عبر `_bot_uid` الذي يستدعي `_bot_gate_ok()`:
# إن ردّت البوّابة بالمنع أعاد NULL ⇒ «not_linked»؛ وإن كانت البوّابة مفتوحة
# لكن الرقم غير مرتبط أعاد NULL أيضاً ⇒ «not_linked» — **ردّان متطابقان
# حرفياً**. فلا يمكن الحسم من الخارج إلا برقم تيليجرام مرتبط فعلاً، ولن
# نستخدم رقم أحد. الحسم مكانه SQL: supabase/JEDDAH_DIAGNOSE_bot_gate.sql
#
# ما نحسمه هنا: أن الدوال الخاصة **لا تُسرّب بيانات** لرقم عشوائي.
# ملاحظة: PostgREST يطابق الدالة بـ**مجموعة أسماء المعاملات** بالضبط — تمرير
# معامل زائد يعطي PGRST202 «الدالة غير موجودة»، وهو خطأ في الفحص لا ثغرة.
probe_bot_fn() { # الدالة  حمولة‑JSON
    req POST "/rest/v1/rpc/$1" "$2"
    case "$BODY" in
        *PGRST202*) inf "$1 — معاملات خاطئة في الفحص نفسه (PGRST202) — ليست نتيجة أمنية" ;;
        null|''|*not_linked*|*'"success": false'*|*'"success":false'*)
            ok "$1 — لا يُعيد بيانات لرقم غير مرتبط" ;;
        *)  bad "🚨 $1 — أعاد بيانات لرقم عشوائي: $(printf '%.90s' "$BODY")" ;;
    esac
}
probe_bot_fn bot_get_user         '{"p_telegram_id":"999999999999"}'
probe_bot_fn bot_get_my_bookings  '{"p_telegram_id":"999999999999"}'
probe_bot_fn bot_get_seller_stats '{"p_telegram_id":"999999999999"}'
probe_bot_fn bot_get_alerts       '{"p_telegram_id":"999999999999"}'
probe_bot_fn bot_booking_contact  '{"p_telegram_id":"999999999999","p_barcode":"__taki_probe__"}'
probe_bot_fn bot_unlink           '{"p_telegram_id":"999999999999"}'
inf "إنفاذ سرّ البوّابة لا يُحسم من الخارج بطبيعته — حُسم داخل جدة ٢٧ أغسطس ٢٠٢٦: مفعّل والسرّ مضبوط و_bot_uid يستدعيه، وسطح الانتحال صفر بعد v13.84. أعِد الحسم بـJEDDAH_VERIFY_bot_surface.sql عند الشك."

req POST "/rest/v1/rpc/bot_get_admin_stats" '{"p_telegram_id":"__taki_probe__"}'
if [ "$CODE" = "200" ] && [ -n "$BODY" ] && [ "$BODY" != "null" ]; then
    bad "🚨 إحصاءات الإدارة متاحة بلا بوّابة: $(printf '%.90s' "$BODY")"
else ok "إحصاءات الإدارة محميّة ($CODE ${ERRC:-})"; fi

# ── ٦) طبقة الشبكة ──────────────────────────────────────────────────────
hdr "سطح الهجوم على خادم جدة"
# ملاحظة: لا يجوز أن يُنتج غيابُ أداةٍ نتيجةَ «مغلق ✅» كاذبة — لذا إن لم
# تتوفّر أداة فحص المنافذ نُعلن التخطّي صراحةً بدل ادّعاء النجاح.
PORTTOOL=""
command -v nc       >/dev/null 2>&1 && PORTTOOL="nc"
[ -n "$PORTTOOL" ] || { command -v timeout >/dev/null 2>&1 && PORTTOOL="timeout"; }
[ -n "$PORTTOOL" ] || { command -v gtimeout >/dev/null 2>&1 && PORTTOOL="gtimeout"; }
port_closed() {
    case "$PORTTOOL" in
        nc)   if nc -z -w 8 "$DBHOST" "$2" >/dev/null 2>&1; then
                  bad "$1 — المنفذ $2 مفتوح للإنترنت"
              else ok "$1 — المنفذ $2 مغلق"; fi ;;
        timeout|gtimeout)
              if "$PORTTOOL" 8 bash -c "exec 3<>/dev/tcp/$DBHOST/$2" 2>/dev/null; then
                  bad "$1 — المنفذ $2 مفتوح للإنترنت"
              else ok "$1 — المنفذ $2 مغلق"; fi ;;
        *)    inf "$1 — المنفذ $2: تُخُطّي (لا أداة فحص منافذ على هذه البيئة)" ;;
    esac
}
port_closed "بوستجريس مباشرة" 5432
port_closed "بوّابة غير مشفّرة" 8000
port_closed "لوحة سوبابيس"     3000

# ── ٧) ترويسات الحماية على الموقع ───────────────────────────────────────
hdr "ترويسات الحماية (Vercel)"
curl -sSI --max-time 30 "$SITE/" | tr 'A-Z' 'a-z' > "$TMP/h.txt"
for w in content-security-policy x-content-type-options x-frame-options referrer-policy strict-transport-security permissions-policy; do
    if grep -q "^$w:" "$TMP/h.txt"; then ok "ترويسة $w"; else bad "ترويسة $w مفقودة"; fi
done

# ── ٨) هل الإنتاج يخدم آخر إصدار؟ ───────────────────────────────────────
hdr "مطابقة الإصدار المنشور للمستودع"
want=$(grep -oE "taki-cache-v[0-9.]+" "$REPO/sw.js" 2>/dev/null | head -1)
got=$(curl -fsS --max-time 30 "$SITE/sw.js" 2>/dev/null | grep -oE "taki-cache-v[0-9.]+" | head -1)
if [ -n "$want" ] && [ "$want" = "$got" ]; then ok "الإنتاج على $got — مطابق للمستودع"
elif [ -z "$got" ]; then bad "تعذّر قراءة sw.js من الإنتاج"
elif [ -z "$want" ]; then inf "تعذّر قراءة sw.js من المستودع ($REPO) — تُخطّي مطابقة الإصدار"
else bad "الإنتاج على «$got» بينما المستودع على «$want» ⇒ نشرٌ ناقص"; fi

# ── الخلاصة ─────────────────────────────────────────────────────────────
printf '\n═══ الخلاصة\n  ناجح: %s   ·   تنبيه: %s   ·   فاشل: %s\n' "$passed" "$warned" "$fail"
[ "$fail" -eq 0 ] || { printf '::error::فشل %s فحصاً أمنياً\n' "$fail"; exit 1; }
printf '  🟢 لم يُخترق شيء من منظور زائر مجهول.\n'
