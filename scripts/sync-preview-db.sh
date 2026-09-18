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

# 🪤 خادم جدة لا يملك `psql` على المضيف — الأداة داخل حاوية القاعدة وحدها.
# فكل نداء للهدف يمرّ عبرها، والملفّات تُمرَّر بالأنبوب لا بالمسار (الحاوية
# لا ترى /tmp المضيف). والرابط يُمرَّر متغيّرَ بيئةٍ لا معاملَ سطرِ أوامر،
# فلا يظهر في `ps` لأي مستخدمٍ آخر على الجهاز.
dst() {   # dst <args…>            — استعلامٌ قصير
  sudo docker exec -e PGURL="$PREVIEW_DB_URL" "$SRC_CONTAINER" \
    bash -c 'psql "$PGURL" "$@"' -- "$@"
}
dst_file() {  # dst_file <path>     — ملفٌّ كامل عبر stdin
  sudo docker exec -i -e PGURL="$PREVIEW_DB_URL" "$SRC_CONTAINER" \
    bash -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -q -f -' < "$1"
}


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
DST_MARKER=$(dst -At -c "SELECT coalesce(obj_description('public'::regnamespace,'pg_namespace'),'');" | tr -d '\r')
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
# 🪤 ثلاثة أشياء تُحذف من المخطّط قبل تطبيقه، وكلٌّ منها كسر التشغيل فعلاً:
#  ١) `\restrict` و`\unrestrict` — أوامر psql لا SQL، يُدرجها pg_dump 17.
#  ٢) `CREATE SCHEMA public` — الهدف أنشأناه للتوّ، فيفشل بـ«already exists».
#  ٣) 🔴 `COMMENT ON SCHEMA public` — **الأخطر**. تعليق جدة «standard public
#     schema»، فتطبيقُه يمسح وسم `TAKI_LAB_TOKYO_MARKER_v1382` من المعاينة.
#     وحينها يصير المختبر غير مميّز عن الإنتاج: حارسُ كل هجرة إنتاج يظنّه
#     جدة فيُنفَّذ عليه، وهذا السكربتُ نفسه يفقد حارسه المعكوس.
#  ٤) `ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin` — دورٌ لا يملكه
#     مستخدم مجمّع Supabase، فيردّ «permission denied» في آخر سطرٍ من المخطّط.
#     والامتيازات الافتراضية ضُبطت أصلاً في خطوة إعادة بناء المخطّط.
sed -i -E '/^\\(restrict|unrestrict)/d; /^CREATE SCHEMA public;/d; /^COMMENT ON SCHEMA public /d; /^ALTER SCHEMA public OWNER/d; /^ALTER DEFAULT PRIVILEGES FOR ROLE /d' "$WORK/schema.sql"
if grep -qE '^(CREATE SCHEMA public;|COMMENT ON SCHEMA public )' "$WORK/schema.sql"; then
  echo "❌ لم تُحذف عبارات مخطّط public — أوقفت قبل أن يُمسح الوسم." >&2; exit 1
fi
echo "  $(wc -c < "$WORK/schema.sql" | awk '{printf "%.1f", $1/1024/1024}') ميجابايت"

# ── ٢) تفريغ الهدف وإعادة بنائه ────────────────────────────────────────────
say "تفريغ مخطّط المعاينة وإعادة بنائه"
sudo docker exec -i -e PGURL="$PREVIEW_DB_URL" "$SRC_CONTAINER" bash -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -f -' <<'RESET'
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

# 🪤 الامتدادات المثبّتة في مخطّط `public` تُحذف مع المخطّط، والفهارس التي
# تعتمد عليها تفشل بعدها بـ«operator class does not exist». على جدة هناك
# واحد: `pg_trgm` (يخدم البحث العربي المطبّع). فيُعاد إنشاؤه **قبل** التطبيق،
# ويُقرأ من المصدر لا يُكتب باليد — فأي امتدادٍ يُضاف لاحقاً يُنقل تلقائياً.
say "امتدادات مخطّط public"
PUB_EXT=$(sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At -c "
  SELECT string_agg(format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA public;', e.extname), E'\n')
  FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE n.nspname = 'public';")
if [ -n "$PUB_EXT" ]; then
  printf '%s\n' "$PUB_EXT" > "$WORK/ext.sql"
  dst_file "$WORK/ext.sql" && echo "  ✅ $(grep -c CREATE "$WORK/ext.sql") امتداداً" \
    || { echo "  ❌ تعذّر إنشاء الامتدادات — الفهارس ستفشل" >&2; exit 1; }
else
  echo "  لا امتداد في public"
fi

say "تطبيق المخطّط"
dst_file "$WORK/schema.sql"

# ── ٣) مشغّلات auth.users ومستودعات التخزين ───────────────────────────────
# 🪤 درسٌ مدفوع: استخراج `public` وحده يُسقط مشغّلات `auth.users` — فالتسجيل
# الجديد لا يُنشئ ملفّ مستخدم — ويُسقط سياسات `storage.objects` فلا يرفع تاجر صورة.
# الوسم يُقاس بعد التطبيق لا يُفترض: لو أعاده المخطّط رغم الحذف لانكشف هنا.
POST_MARKER=$(dst -At -c "SELECT coalesce(obj_description('public'::regnamespace,'pg_namespace'),'');" | tr -d '\r')
if [ "$POST_MARKER" != "TAKI_LAB_TOKYO_MARKER_v1382" ]; then
  echo "❌ ضاع وسم المختبر بعد تطبيق المخطّط (قرأت «${POST_MARKER:-لا شيء}»). أُعيده الآن." >&2
  dst -q -c "COMMENT ON SCHEMA public IS 'TAKI_LAB_TOKYO_MARKER_v1382';"
fi

say "مشغّلات الحسابات ومستودعات التخزين"
sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At -c "
  SELECT string_agg(pg_get_triggerdef(t.oid) || ';', E'\n')
  FROM pg_trigger t WHERE t.tgrelid='auth.users'::regclass AND NOT t.tgisinternal;
" > "$WORK/auth_triggers.sql"
dst_file "$WORK/auth_triggers.sql" || {
  echo "  ⚠️ تعذّر تطبيق مشغّلات الحسابات — التسجيل في المعاينة لن يُنشئ ملفّاً" >&2; }

sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At -c "
  SELECT string_agg(format(
    'INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types) VALUES (%L,%L,%L,%s,%L) ON CONFLICT (id) DO UPDATE SET public=EXCLUDED.public, file_size_limit=EXCLUDED.file_size_limit, allowed_mime_types=EXCLUDED.allowed_mime_types;',
    id, name, public, coalesce(file_size_limit::text,'NULL'), allowed_mime_types), E'\n')
  FROM storage.buckets;
" > "$WORK/buckets.sql"
dst_file "$WORK/buckets.sql"

# 🔴 وسياسات `storage.objects` **ومشغّلاتها** — لا المستودعات وحدها.
# نسخُ المستودعات بلا سياساتها يعطي معاينةً يرفع فيها أي أحد أي شيء في أي مسار،
# فتُجرَّب ميزةٌ بنجاح ثم تُرفض على الإنتاج. والعكس أسوأ: حمايةٌ تبدو موجودة.
say "سياسات التخزين ومشغّلاتها"
# 🪤 فخّان اصطدتُهما هنا، وكلاهما كان يُنتج معاينةً تُخالف الإنتاج بصمت:
#  ١) `pg_get_expr` **يحذف تأهيل** أي دالةٍ في مسار البحث الحالي — فتُرسَم
#     السياسة `owner = uid()` بدل `auth.uid()`، وتفشل على الهدف بـ«function
#     uid() does not exist». الحلّ: `SET search_path = pg_catalog` فيُؤهَّل كلّ شيء.
#  ٢) مخطّط `storage` يملكه `supabase_storage_admin` على Supabase المُدار،
#     و`postgres` **لا يستطيع** إنشاء دوالٍّ فيه (ولا SET ROLE إليه). لكنه
#     **يستطيع** إنشاء السياسات والمشغّلات على `storage.objects` — قِيس.
#     فدوالُّ المشغّلات تُنقل إلى `public` ويُشار إليها من هناك.
# 🪤 ولا يُكتب `SET search_path` داخل `-c`: psql يطبع وسم الأمر «SET» سطراً
# أوّل في المخرجات، فيصير الملفّ `SET` ثم `DROP POLICY` — خطأ نحوي. يُمرَّر
# متغيّرَ بيئةٍ للجلسة بدلاً من ذلك.
sudo docker exec -e PGOPTIONS='-c search_path=pg_catalog' "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At -c "
  WITH pol AS (
    SELECT format('DROP POLICY IF EXISTS %I ON storage.objects; CREATE POLICY %I ON storage.objects FOR %s TO %s%s%s;',
             p.polname, p.polname,
             CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT' WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
             -- الأدوار تُنسخ حرفياً: تحويل TO public إلى authenticated يغيّر السلوك بصمت (درس v14.38).
             coalesce((SELECT string_agg(quote_ident(r.rolname), ', ') FROM pg_roles r WHERE r.oid = ANY(p.polroles)), 'public'),
             coalesce(' USING (' || pg_get_expr(p.polqual, p.polrelid) || ')', ''),
             coalesce(' WITH CHECK (' || pg_get_expr(p.polwithcheck, p.polrelid) || ')', '')) AS stmt
    FROM pg_policy p WHERE p.polrelid = 'storage.objects'::regclass
  ) SELECT string_agg(stmt, E'\n') FROM pol;" > "$WORK/storage_pol.sql"
dst_file "$WORK/storage_pol.sql" && echo "  ✅ السياسات" || { echo "  ❌ لم تُنسخ السياسات" >&2; exit 1; }

# دوال مشغّلات التخزين → تُنشأ في `public` (لا يُسمح بالكتابة في `storage`)
sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At -c "
  SELECT coalesce(string_agg(replace(pg_get_functiondef(p.oid), 'FUNCTION storage.', 'FUNCTION public.') || ';', E'\n'), '')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'storage' AND p.proname LIKE 'taki%';" > "$WORK/storage_fn.sql"
if [ -s "$WORK/storage_fn.sql" ]; then
  dst_file "$WORK/storage_fn.sql" && echo "  ✅ دوال المشغّلات (في public)" || echo "  ⚠️ دوال المشغّلات لم تُنقل" >&2
fi

sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At -c "
  SELECT coalesce(string_agg('DROP TRIGGER IF EXISTS ' || quote_ident(t.tgname) || ' ON storage.objects; '
           || replace(pg_get_triggerdef(t.oid), 'FUNCTION storage.', 'FUNCTION public.') || ';', E'\n'), '')
  FROM pg_trigger t WHERE t.tgrelid = 'storage.objects'::regclass AND NOT t.tgisinternal
    AND t.tgname LIKE 'tr_taki%';" > "$WORK/storage_trg.sql"
if [ -s "$WORK/storage_trg.sql" ]; then
  dst_file "$WORK/storage_trg.sql" && echo "  ✅ مشغّلات التخزين" || echo "  ⚠️ المشغّلات لم تُنقل" >&2
fi

# ── ٤) بيانات المرجع وحدها — بلا أي بيانٍ شخصي ────────────────────────────
say "بيانات المرجع (بلا بيانات أشخاص)"
REF_TABLES="regions cities locations sa_cities_geo platform_settings"
for t in $REF_TABLES; do
  if sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At \
       -c "SELECT to_regclass('public.$t') IS NOT NULL;" | grep -q '^t$'; then
    # 🪤 بعض جداول المرجع تملؤها الهجرة بقيمٍ افتراضية، و`COPY` لا يعرف
    # `ON CONFLICT` — فالنسخ يصطدم بـduplicate key. تُفرَّغ أوّلاً: هذه جداول
    # مرجعٍ بلا بيانات أشخاص، والمصدر هو الحقيقة.
    dst -q -c "TRUNCATE public.$t CASCADE;" >/dev/null 2>&1 || true
    sudo docker exec "$SRC_CONTAINER" pg_dump -U "$SRC_USER" -d postgres \
      --data-only --no-owner -t "public.$t" \
      | sed '/^\\restrict/d; /^\\unrestrict/d' > "$WORK/$t.sql"
    dst_file "$WORK/$t.sql" \
      && echo "  ✅ $t" || echo "  ⚠️ $t لم يُنسخ"
  fi
done

# ── ٥) التحقّق: الهدف يطابق المصدر، وبلا بيانات أشخاص ─────────────────────
say "التحقّق"
read -r S_FN S_TB S_PL <<< "$(sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At -F' ' -c "
  SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'),
         (SELECT count(*) FROM pg_tables WHERE schemaname='public'),
         (SELECT count(*) FROM pg_policies WHERE schemaname='public');")"
read -r D_FN D_TB D_PL D_USERS <<< "$(dst -At -F' ' -c "
  SELECT (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind='f'),
         (SELECT count(*) FROM pg_tables WHERE schemaname='public'),
         (SELECT count(*) FROM pg_policies WHERE schemaname='public'),
         (SELECT count(*) FROM public.users);")"

printf '  الجداول  %s → %s\n  السياسات %s → %s\n' "$S_TB" "$D_TB" "$S_PL" "$D_PL"
rc=0
# دوال مشغّلات التخزين نُقلت إلى `public` على الهدف، فالمتوقَّع أكبر بعددها.
MOVED=$(sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At -c "
  SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='storage' AND p.proname LIKE 'taki%';" | tr -d '\r')
EXPECT_FN=$(( S_FN + MOVED ))
printf '  الدوال   %s → %s (متوقَّع %s)\n' "$S_FN" "$D_FN" "$EXPECT_FN"
[ "$EXPECT_FN" = "$D_FN" ] || { echo "  ❌ الدوال لا تطابق (متوقَّع $EXPECT_FN = $S_FN + $MOVED منقولة)"; rc=1; }
[ "$S_TB" = "$D_TB" ] || { echo "  ❌ الجداول لا تطابق"; rc=1; }
[ "$S_PL" = "$D_PL" ] || { echo "  ❌ السياسات لا تطابق"; rc=1; }
[ "$D_USERS" = "0" ]  || { echo "  ❌ المعاينة فيها $D_USERS مستخدماً — يجب أن تكون صفراً"; rc=1; }
S_SP=$(sudo docker exec "$SRC_CONTAINER" psql -U "$SRC_USER" -d postgres -At -c "SELECT count(*) FROM pg_policy WHERE polrelid='storage.objects'::regclass;")
D_SP=$(dst -At -c "SELECT count(*) FROM pg_policy WHERE polrelid='storage.objects'::regclass;" | tr -d '\r')
printf '  سياسات التخزين %s → %s\n' "$S_SP" "$D_SP"
[ "$S_SP" = "$D_SP" ] || { echo "  ❌ سياسات التخزين لا تطابق — الرفع في المعاينة سيسلك غير سلوك الإنتاج"; rc=1; }
[ "$rc" = "0" ] && echo "  ✅ المعاينة تطابق الإنتاج مخطَّطاً، وبلا بيانات أشخاص" \
                || { echo "  الفرق يعني مخطّطاً ناقصاً — لا تعتمد هذه المعاينة" >&2; exit 1; }
