#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# TAKI · تصديرُ «عقل القاعدة» من جدة إلى لقطةٍ في المستودع — أمرٌ واحد
#
#   bash scripts/export-db-logic.sh
#
# 🪤 لماذا أُعيد كتابةُ هذا كلّه (قِيس ٨ نوفمبر ٢٠٢٦):
#   كان `supabase/JEDDAH_EXPORT_db_logic.sql` يقول إنّ **١٨٩ دالّة لا مصدرَ
#   لها في المستودع إطلاقاً**، وإنّ «فقدَ جدة ⇒ لا يُعاد بناءُ التطبيق».
#   وقِيس فكان الرقمُ خطأً: من ٦٤٢ دالّةٍ حيّة، **ستّةَ عشرَ وحدها** لا تُعرَّف
#   في المستودع — **وكلُّها من إضافة `pg_trgm`** لا من تاكي. أي أنّ كلَّ
#   دوالّنا مصدرُها محفوظ.
#
#   والخطرُ الحقيقيُّ مختلفٌ عمّا كُتب، وهو أهدأُ وأخطر: **انحرافُ التعريف**.
#   نسخةُ المستودع تبقى بالاسم نفسِه وقد صارت أقدمَ من الحيّة — مثالٌ مقيس:
#   `send_booking_message` في `supabase/schema/00-full-schema.sql` يثبّت
#   `>= 3` بينما الحيّةُ تنادي `taki_chat_limits()`. فالبحثُ عن «هل الدالّة
#   موجودة؟» يطمئن كذباً؛ والسؤالُ الصحيح «هل تعريفُها هو هو؟».
#   ولذلك هذا السكربت يكتب لقطةً، و`scripts/check-db-logic-drift.sh` يقيس
#   الفرقَ بينها وبين الحيّ.
#
# 🔒 ولا يُكتب في مستودعٍ عامّ شيءٌ لم يُفحص: الملفُّ يُفحص قبل الكتابة بحثاً
#    عن توكناتٍ وسلاسلَ عالية الإنتروبيا، ويُرفض إن وُجد شيء. (الأجسامُ تقرأ
#    الأسرار من الخزنة **بالاسم**، فلا قيمةَ سرٍّ فيها — وهذا مقيسٌ لا مفترَض.)
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail

BOX="${TAKI_BOX:-ubuntu@207.127.99.122}"
KEY="${TAKI_KEY:-$HOME/.ssh/taki_jeddah2}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/supabase/schema/10-live-db-logic.sql"
QUIET=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out)   OUT="$2"; shift 2 ;;
    --quiet) QUIET=1; shift ;;
    *)       echo "⛔ وسيطٌ غيرُ معروف: $1"; exit 2 ;;
  esac
done
TMP="$(mktemp -t taki-dblogic.XXXXXX)"
trap 'rm -f "$TMP" "$TMP.q"' EXIT

say() { [ "$QUIET" -eq 1 ] || printf '%s\n' "$*"; }

[ -f "$KEY" ] || { say "⛔ لا يوجد مفتاحُ الدخول: $KEY"; exit 1; }

# ── ① الاستعلام. يبدأ بحارسٍ يرفض المختبر: لقطةٌ من طوكيو تُدخل المستودعَ
#     كذباً مريحاً (دروسُ ٢٢ أغسطس: هجراتُ أسابيعَ ذهبت للمختبر لا لجدة).
cat > "$TMP.q" <<'SQL'
\pset pager off
\pset footer off
\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION '⛔ هذه لقطةُ إنتاج (جدة) — ومُنعت على مختبر طوكيو.';
  END IF;
END $guard$;

SELECT '-- ═══ TAKI · لقطةُ عقل القاعدة الحيّة ═══'
    || E'\n-- @@VOLATILE الخادم: ' || coalesce(host(inet_server_addr())::text, 'محلّي-داخل-الحاوية')
    || E'\n-- القاعدة: ' || current_database()
    || E'\n-- النسخة: '  || substring(version() from 'PostgreSQL [0-9.]+')
    || E'\n-- @@VOLATILE وُلِّدت: ' || to_char(now() AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || ' (توقيت الرياض)'
    || E'\n-- 🪤 مولَّدٌ آلياً بـscripts/export-db-logic.sh — لا يُحرَّر بيد.'
    || E'\n--    وهو لقطةٌ للمقارنة والتعافي، وليس ملفَّ هجرة: لا تُشغّله.'
    || E'\n';

-- الدوال: الأكثرُ عرضةً للانحراف، فتُصدَّر كاملةً بترويسةِ أمنٍ لكلٍّ منها.
SELECT E'\n\n-- ═══ FUNCTION ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
    || CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END
    || ' owner=' || pg_get_userbyid(p.proowner)
    || ' search_path=' || coalesce(array_to_string(p.proconfig, ','), 'NOT_SET')
    || ' anon=' || CASE WHEN p.proacl IS NULL OR has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'YES' ELSE 'no' END
    || E' ═══\n' || pg_get_functiondef(p.oid) || ';'
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
 WHERE n.nspname = 'public' AND p.prokind = 'f' AND d.objid IS NULL   -- دوالُّ الإضافات ليست لنا
 ORDER BY p.proname, pg_get_function_identity_arguments(p.oid);

SELECT E'\n\n-- ═══ TRIGGERS ═══';
SELECT pg_get_triggerdef(t.oid) || ';'
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND NOT t.tgisinternal
 ORDER BY c.relname, t.tgname;

SELECT E'\n\n-- ═══ RLS POLICIES (public) ═══';
SELECT '-- ' || tablename || ' · ' || policyname || E'\n'
    || 'CREATE POLICY ' || quote_ident(policyname) || ' ON public.' || quote_ident(tablename)
    || ' FOR ' || cmd || ' TO ' || array_to_string(roles, ', ')
    || coalesce(E'\n  USING (' || qual || ')', '')
    || coalesce(E'\n  WITH CHECK (' || with_check || ')', '') || ';'
  FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname;

SELECT E'\n\n-- ═══ RLS POLICIES (storage) ═══';
SELECT '-- storage.' || tablename || ' · ' || policyname || E'\n'
    || 'CREATE POLICY ' || quote_ident(policyname) || ' ON storage.' || quote_ident(tablename)
    || ' FOR ' || cmd || ' TO ' || array_to_string(roles, ', ')
    || coalesce(E'\n  USING (' || qual || ')', '')
    || coalesce(E'\n  WITH CHECK (' || with_check || ')', '') || ';'
  FROM pg_policies WHERE schemaname = 'storage' ORDER BY tablename, policyname;

SELECT E'\n\n-- ═══ VIEWS ═══';
SELECT '-- ' || viewname || E'\nCREATE OR REPLACE VIEW public.' || quote_ident(viewname)
    || E' AS\n' || definition
  FROM pg_views WHERE schemaname = 'public' ORDER BY viewname;

SELECT E'\n\n-- ═══ RLS STATE ═══';
SELECT '-- ' || c.relname || ' rls=' || c.relrowsecurity || ' forced=' || c.relforcerowsecurity
    || ' policies=' || (SELECT count(*) FROM pg_policies pp WHERE pp.schemaname='public' AND pp.tablename=c.relname)
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r' ORDER BY c.relname;

SELECT E'\n\n-- ═══ GRANTS TO anon / authenticated ═══';
SELECT '-- ' || table_name || ' ' || grantee || ' : ' || string_agg(privilege_type, ',' ORDER BY privilege_type)
  FROM information_schema.role_table_grants
 WHERE table_schema='public' AND grantee IN ('anon','authenticated','PUBLIC')
 GROUP BY table_name, grantee ORDER BY grantee, table_name;

SELECT E'\n\n-- ═══ CRON JOBS ═══';
SELECT '-- [' || jobid || '] ' || schedule || ' active=' || active || ' :: ' || replace(command, E'\n', ' ')
  FROM cron.job ORDER BY jobid;
SQL

say "① أقرأ العقلَ الحيّ من جدة…"
ssh -o ConnectTimeout=25 -i "$KEY" "$BOX" 'cat > /tmp/taki-dblogic.sql' < "$TMP.q"
ssh -o ConnectTimeout=25 -i "$KEY" "$BOX" \
  'sudo docker exec -i supabase-db psql -U supabase_admin -d postgres -At -f - < /tmp/taki-dblogic.sql' > "$TMP"
rc=$?
[ "$rc" -eq 0 ] || { say "⛔ فشل الاستعلام (حالة $rc) — لم يُكتب شيء."; exit 1; }

LINES=$(wc -l < "$TMP" | tr -d ' ')
# 🪤 حدٌّ أدنى: استعلامٌ نجح جزئياً أو قاعدةٌ فارغة تكتب ملفاً صغيراً فتُفسد
#    اللقطة بهدوء — تماماً كما ترفض النسخةُ الاحتياطية أيّ نسخةٍ أصغر من ٥٠٠ ك.ب.
if [ "$LINES" -lt 5000 ]; then
  say "⛔ اللقطةُ قصيرةٌ بغير المعقول ($LINES سطراً) — لم يُكتب شيء."
  exit 1
fi

say "② أفحصُها قبل أن تدخل مستودعاً عامّاً…"
BAD=0
if grep -qE 'eyJ[A-Za-z0-9_-]{20,}\.' "$TMP"; then say "   ❌ توكنٌ شبيهٌ بـJWT"; BAD=1; fi
if grep -qE '\b(re_[A-Za-z0-9]{16,}|sk_(live|test)_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{30,}|rnd_[A-Za-z0-9]{20,})\b' "$TMP"; then say "   ❌ مفتاحُ خدمةٍ بصيغةٍ معروفة"; BAD=1; fi
# سلاسلُ عالية الإنتروبيا: نستثني أسماءَ SQL الطويلة (تحوي '_' دائماً تقريباً)
if grep -oE '[A-Za-z0-9+/]{44,}={0,2}' "$TMP" | grep -qv '_'; then say "   ❌ سلسلةٌ عالية الإنتروبيا"; BAD=1; fi
[ "$BAD" -eq 0 ] || { say "⛔ اللقطةُ تحوي ما يشبه سرّاً — لم يُكتب شيء. راجعني."; exit 1; }
say "   ✅ صفرُ توكن · صفرُ مفتاحٍ معروف · صفرُ سلسلةٍ عالية الإنتروبيا"

mkdir -p "$(dirname "$OUT")"
mv "$TMP" "$OUT"
say "③ كُتبت: supabase/schema/10-live-db-logic.sql  ($LINES سطراً)"
say ""
say "   للمقارنة لاحقاً:  bash scripts/check-db-logic-drift.sh"
