#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# sync-preview-db.sh — يبني قاعدة المعاينة (طوكيو) من مخطّط جدة (v14.58)
# ═══════════════════════════════════════════════════════════════════════════
# يُشغَّل **على خادم جدة**، لأن الاستخراج والدفع يصيران محلّيين فلا يمرّ
# ميجابايت المخطّط عبر أي وسيط:
#
#   scp scripts/sync-preview-db.sh ubuntu@141.147.142.147:~/
#   ssh ubuntu@141.147.142.147 'PREVIEW_DB_URL="postgresql://…" bash ~/sync-preview-db.sh'
#
# ولماذا سكربتٌ لا عمليةٌ يدوية: قاعدةُ المعاينة **تتعفّن مع أوّل هجرة قادمة**.
# مزامنةٌ لمرّة واحدة تعطي معاينةً تكذب بعد أسبوع — وهي أسوأ من لا معاينة، لأن
# ميزةً تُجرَّب عليها بنجاح قد تنكسر على الإنتاج. فالمزامنة تُعاد بعد كل هجرة،
# وثمنُها أمرٌ واحد.
#
# ── ما يُنسخ وما لا يُنسخ ──────────────────────────────────────────────────
# يُنسخ: **المخطّط كاملاً** (٤٨٢ دالة · ٦٠ جدولاً · ١٢٤ سياسة) + جداول المرجع
#        التي لا تحوي بياناً شخصياً (المناطق · المدن · المواقع) + حسابان
#        اصطناعيان للتجربة.
# 🔴 لا يُنسخ أبداً: `users` · `bookings` · `booking_messages` · `notifications`
#        · `user_addresses` · `order_invoices` · `delivery_tracks` — أي شيء فيه
#        اسمٌ أو جوّالٌ أو بريدٌ أو عنوان. طوكيو مشروعٌ مجانيّ على طرفٍ ثالث
#        خارج السعودية، ووضعُ بيانات عملاء عليه لا يجوز مهما كان «للتجربة».
#        (وُجد فيها فعلاً ٤ حسابات و٨١ حجزاً و٣ جوّالات قبل هذه الأداة — أُزيلت.)
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

: "${PREVIEW_DB_URL:?ضع رابط قاعدة المعاينة في PREVIEW_DB_URL (من لوحة Supabase ← Settings ← Database ← Connection string / URI)}"

SRC_CONTAINER="${SRC_CONTAINER:-supabase-db}"
SRC_USER="${SRC_USER:-supabase_admin}"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

say() { printf '\n▸ %s\n' "$1"; }

# ── حارسان لا يُلتَفّ عليهما ────────────────────────────────────────────────
say "الحارس: أين المصدر وأين الهدف؟"
SRC_MARKER=$(sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At \
  -c "SELECT coalesce(obj_description('public'::regnamespace,'pg_namespace'),'');")
if [ "$SRC_MARKER" = "TAKI_LAB_TOKYO_MARKER_v1382" ]; then
  echo "❌ المصدر هو المختبر لا الإنتاج. أوقفت." >&2; exit 1
fi
echo "  المصدر: جدة ✅"

# 🔴 والحارس المعكوس أهمّ: لو أُعطي هذا السكربت رابط **الإنتاج** بالخطأ لمسح
# قاعدة تاكي كلها. فلا يُكمل إلا إذا كان الهدف يحمل وسم المختبر صراحةً.
DST_MARKER=$(psql "$PREVIEW_DB_URL" -At -c "SELECT coalesce(obj_description('public'::regnamespace,'pg_namespace'),'');")
if [ "$DST_MARKER" != "TAKI_LAB_TOKYO_MARKER_v1382" ]; then
  cat >&2 <<MSG
❌ الهدف لا يحمل وسم المختبر (قرأت: «${DST_MARKER:-لا وسم}»).
   هذا السكربت يمسح مخطّط الهدف كاملاً. لن يعمل إلا على قاعدةٍ موسومة صراحةً:
     COMMENT ON SCHEMA public IS 'TAKI_LAB_TOKYO_MARKER_v1382';
MSG
  exit 1
fi
echo "  الهدف: مختبر المعاينة ✅"

# ── ١) استخراج المخطّط ──────────────────────────────────────────────────────
say "استخراج مخطّط جدة"
sudo docker exec "$SRC_CONTAINER" pg_dump -U "$SRC_USER" -d postgres \
  --schema-only --no-owner -n public > "$WORK/schema.sql"
# 🪤 pg_dump 17 يُدرج `\restrict` و`\unrestrict` — وهي أوامر psql لا SQL،
# فتُسقط أي منفذٍ لا يمرّ عبر psql. تُحذف لتبقى الملفّات صالحةً بأي طريق.
sed -i '/^\\restrict/d; /^\\unrestrict/d' "$WORK/schema.sql"
echo "  $(wc -c < "$WORK/schema.sql" | awk '{printf "%.1f", $1/1024/1024}') ميجابايت"

# ── ٢) تفريغ الهدف وإعادة بنائه ────────────────────────────────────────────
say "تفريغ مخطّط المعاينة وإعادة بنائه"
psql "$PREVIEW_DB_URL" -v ON_ERROR_STOP=1 <<'RESET'
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
-- الوسم يُعاد **فوراً**: ضياعه يعني أن حارس هجرات الإنتاج يظنّ المختبرَ إنتاجاً.
COMMENT ON SCHEMA public IS 'TAKI_LAB_TOKYO_MARKER_v1382';
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL   ON SCHEMA public TO postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
RESET

say "تطبيق المخطّط"
psql "$PREVIEW_DB_URL" -v ON_ERROR_STOP=1 -q -f "$WORK/schema.sql"

# ── ٣) مشغّلات auth.users ومستودعات التخزين ───────────────────────────────
# 🪤 درسٌ مدفوع: استخراج `public` وحده يُسقط مشغّلات `auth.users` — فالتسجيل
# الجديد لا يُنشئ ملفّ مستخدم — ويُسقط سياسات `storage.objects` فلا يرفع تاجر صورة.
say "مشغّلات الحسابات ومستودعات التخزين"
sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At -c "
  SELECT string_agg(pg_get_triggerdef(t.oid) || ';', E'\n')
  FROM pg_trigger t WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal;
" > "$WORK/auth_triggers.sql"
psql "$PREVIEW_DB_URL" -v ON_ERROR_STOP=1 -q -f "$WORK/auth_triggers.sql" || {
  echo "  ⚠️ تعذّر تطبيق مشغّلات الحسابات — التسجيل في المعاينة لن يُنشئ ملفّاً" >&2; }

sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At -c "
  SELECT string_agg(format(
    'INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types) VALUES (%L,%L,%L,%s,%L) ON CONFLICT (id) DO UPDATE SET public=EXCLUDED.public, file_size_limit=EXCLUDED.file_size_limit, allowed_mime_types=EXCLUDED.allowed_mime_types;',
    id, name, public, coalesce(file_size_limit::text,'NULL'), allowed_mime_types), E'\n')
  FROM storage.buckets;
" > "$WORK/buckets.sql"
psql "$PREVIEW_DB_URL" -v ON_ERROR_STOP=1 -q -f "$WORK/buckets.sql"

# ── ٤) بيانات المرجع وحدها — بلا أي بيانٍ شخصي ────────────────────────────
say "بيانات المرجع (بلا بيانات أشخاص)"
REF_TABLES="regions cities locations sa_cities_geo platform_settings"
for t in $REF_TABLES; do
  if sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At \
       -c "SELECT to_regclass('public.$t') IS NOT NULL;" | grep -q '^t$'; then
    sudo docker exec "$SRC_CONTAINER" pg_dump -U "$SRC_USER" -d postgres \
      --data-only --no-owner -t "public.$t" \
      | sed '/^\\restrict/d; /^\\unrestrict/d' > "$WORK/$t.sql"
    psql "$PREVIEW_DB_URL" -v ON_ERROR_STOP=1 -q -f "$WORK/$t.sql" \
      && echo "  ✅ $t" || echo "  ⚠️ $t لم يُنسخ"
  fi
done

# ── ٥) التحقّق: الهدف يطابق المصدر، وبلا بيانات أشخاص ─────────────────────
say "التحقّق"
read -r S_FN S_TB S_PL <<< "$(sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At -F' ' -c "
  SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'),
         (SELECT count(*) FROM pg_tables WHERE schemaname='public'),
         (SELECT count(*) FROM pg_policies WHERE schemaname='public');")"
read -r D_FN D_TB D_PL D_USERS <<< "$(psql "$PREVIEW_DB_URL" -At -F' ' -c "
  SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'),
         (SELECT count(*) FROM pg_tables WHERE schemaname='public'),
         (SELECT count(*) FROM pg_policies WHERE schemaname='public'),
         (SELECT count(*) FROM public.users);")"

printf '  الدوال   %s → %s\n  الجداول  %s → %s\n  السياسات %s → %s\n' "$S_FN" "$D_FN" "$S_TB" "$D_TB" "$S_PL" "$D_PL"
rc=0
[ "$S_FN" = "$D_FN" ] || { echo "  ❌ الدوال لا تطابق"; rc=1; }
[ "$S_TB" = "$D_TB" ] || { echo "  ❌ الجداول لا تطابق"; rc=1; }
[ "$S_PL" = "$D_PL" ] || { echo "  ❌ السياسات لا تطابق"; rc=1; }
[ "$D_USERS" = "0" ]  || { echo "  ❌ المعاينة فيها $D_USERS مستخدماً — يجب أن تكون صفراً"; rc=1; }
[ "$rc" = "0" ] && echo "  ✅ المعاينة تطابق الإنتاج مخطَّطاً، وبلا بيانات أشخاص" \
                || { echo "  الفرق يعني مخطّطاً ناقصاً — لا تعتمد هذه المعاينة" >&2; exit 1; }
