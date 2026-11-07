#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# tune-server.sh — سقوفُ الخادم تُشتقّ من عتاده، لا تُكتب رقماً
# ───────────────────────────────────────────────────────────────────────────
# أمرُ ناصر (٧ نوفمبر ٢٠٢٦): «اجعله بدون سقف ورقم محدد استعدادا لملايين
# المستخدمين، وفي حال زاد عدد المستخدمين سوف ارقي السيرفر».
#
# 🔴 فالرقمُ المكتوب هو العيبُ نفسُه: «٢٠٠ متصل» و«١٠٠ اتّصال» و«٤٠ في
#    المجمّع» أرقامٌ لا تتحرّك مع العتاد — فترقيةُ الخادم تُضاعف المعالجَ
#    والذاكرةَ **ولا تُغيّر شيئاً**، ويبقى الجدارُ حيث كان. وقِيس ذلك:
#    مجمّعُ PostgREST كان ٤٠ على خادمٍ بأربع أنوية و٢٤ ج.ب، وبقي ٤٠ بعد
#    الانتقال إلى نواةٍ واحدة و٥٫٩ — الرقمُ لم يكن صحيحاً في الحالتين.
#
# ⇒ كلُّ قيمةٍ هنا **تُحسب من `nproc` ومن الذاكرة ومن حجم القاعدة**. وبعد أي
#    ترقية:  bash scripts/tune-server.sh --apply   فتُعاد الحسبةُ وحدها.
#
# 🪤 و«بلا سقف» لا تعني «بلا حدّ»: الحدُّ يبقى، لكنه **العتادُ** لا رقمٌ
#    مخترَع. ولأن صفرَ حاويةٍ عندنا لها حدُّ ذاكرة (قِيس)، فرفعُ سقف البثّ
#    الحيّ وحده يعني أن موجةً واحدة تأكل الـ٥٫٩ ج.ب فتسقط **القاعدةُ معها**.
#    ولذلك يُنقل الحدُّ إلى حاوية البثّ نفسها: تُقتل وتعود وحدها، ويبقى
#    الموقعُ واقفاً. حدٌّ مشتقٌّ من الرام، لا رقمٌ مكتوب.
#
# 🪤 وبعضُ القيم تحتاج **إعادةَ تشغيل القاعدة** (انقطاعُ ثوانٍ). ولذلك:
#    نسخةٌ احتياطيّةٌ أوّلاً، ثمّ تحقّقٌ بعد الإقلاع، ثمّ **تراجعٌ تلقائيّ**
#    إن لم تُقلع — فرقمٌ أكبرُ ممّا تحتمله الذاكرة يمنع بوستجرس من العمل
#    أصلاً، وبلا تراجعٍ آليٍّ يبقى الموقعُ معطّلاً حتى يتدخّل أحد.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail

# 🪤 الخطوةُ التي تحتاج إعادةَ تشغيل (max_connections · shared_buffers) **لا
#    تجري مع `--apply` وحده**: انقطاعُ الإنتاج قرارُ ناصر لا قرارُ سكربت.
#    فصلُها علَماً صريحاً يجعل كلَّ تشغيلٍ عاديٍّ **بلا انقطاع** بيقين.
APPLY=0; RESTART=0
for a in "$@"; do
  case "$a" in
    --apply)   APPLY=1 ;;
    --restart) APPLY=1; RESTART=1 ;;
    *) echo "استعمال: tune-server.sh [--apply] [--restart]" >&2; exit 2 ;;
  esac
done

SSH_KEY="${TAKI_SSH_KEY:-$HOME/.ssh/taki_jeddah2}"
SSH_HOST="${TAKI_SSH_HOST:-ubuntu@207.127.99.122}"
[ -f "$SSH_KEY" ] || { echo "❌ مفتاحُ جدة غير موجود: $SSH_KEY" >&2; exit 1; }

ssh -i "$SSH_KEY" "$SSH_HOST" "sudo bash -s -- $APPLY $RESTART" <<'REMOTE'
set -uo pipefail
APPLY="${1:-0}"; RESTART="${2:-0}"
cd /opt/taki/supabase

P() { docker exec supabase-db psql -U supabase_admin -d postgres -At -c "$1"; }

# ── حارسٌ: لا يُضبط المختبرُ أبداً ────────────────────────────────────────
MARK=$(P "SELECT COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')" 2>/dev/null)
if [ "$MARK" = "TAKI_LAB_TOKYO_MARKER_v1382" ]; then
  echo "❌ هذه قاعدةُ المختبر — أوقِفت."; exit 1
fi
RT=$(docker ps --format '{{.Names}}' | grep -m1 realtime) || true
[ -n "$RT" ] || { echo "❌ حاويةُ البثّ الحيّ غير موجودة"; exit 1; }

# ── ١) ما يملكه الجهاز ────────────────────────────────────────────────────
CORES=$(nproc)
RAM_MB=$(free -m | awk '/Mem:/{print $2}')
DB_MB=$(( $(P "SELECT pg_database_size('postgres')") / 1048576 ))
HIT=$(P "SELECT round(100.0*sum(blks_hit)/nullif(sum(blks_hit+blks_read),0),2) FROM pg_stat_database")
# ما تستهلكه بقيّةُ الخدمات فعلاً (بلا القاعدة) — لا تقديراً.
DISK_MB=$(df -Pm /var/lib/docker 2>/dev/null | awk 'NR==2{print $2}')
[ -n "${DISK_MB:-}" ] || DISK_MB=$(df -Pm / | awk 'NR==2{print $2}')
OTHER_MB=$(docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' \
  | grep -v supabase-db | awk '{print $2}' | sed 's/MiB//;s/GiB/*1024/' \
  | awk -F'*' '{s += ($2 ? $1*$2 : $1)} END {printf "%d", s+0}')

echo "═══ العتادُ المقيس ═══"
echo "  أنوية: $CORES · رام: ${RAM_MB} م.ب · خدماتٌ أخرى: ${OTHER_MB} م.ب"
echo "  القاعدة: ${DB_MB} م.ب · إصابةُ المخزَن المؤقّت: ${HIT}% · القرص: ${DISK_MB} م.ب"

# ── ٢) الحسبة — كلُّ رقمٍ مشتقّ، وكلُّ صيغةٍ مشروحة ───────────────────────
OS_RESERVE=$(( 512 + OTHER_MB ))                 # النظامُ + بقيّةُ الحاويات
DB_BUDGET=$(( RAM_MB - OS_RESERVE ))             # ما يبقى للقاعدة
[ "$DB_BUDGET" -lt 512 ] && DB_BUDGET=512

# `shared_buffers`: **مشتقٌّ من حجم البيانات لا من الرام وحدها.**
# 🪤 القاعدةُ الذهبيّة «ربعُ الرام» تُهدر هنا: القاعدة ٨٧ م.ب والإصابة ١٠٠٪،
#    فـ١ ج.ب مخزَناً مؤقّتاً لبياناتٍ كلُّها في الذاكرة أصلاً = صفرُ أثرٍ
#    وبكلفة ذاكرةٍ تحتاجها الاتصالات. فالصحيحُ ضِعفُ البيانات، **مسقوفاً**
#    بربع الميزانيّة — فينمو وحده مع نموّ القاعدة إلى ملايين الصفوف.
SHB=$(( DB_MB * 2 ))
[ "$SHB" -lt 128 ] && SHB=128
[ "$SHB" -gt $(( DB_BUDGET / 4 )) ] && SHB=$(( DB_BUDGET / 4 ))

CONN_BUDGET=$(( DB_BUDGET - SHB ))
# كلُّ اتّصالٍ ≈ ٨ م.ب في أسوأ الحالات (work_mem + حِملُ العملية).
MAXCONN=$(( CONN_BUDGET / 8 ))
# 🪤 وسقفٌ أعلى من الأنوية: اتصالاتٌ فوق ذلك لا تزيد إنتاجيّةً — تزيد
#    **تزاحماً**. وهي مع ذلك فسحةٌ نافعة: الاتّصالُ الزائد يصير **بطيئاً**
#    لا **مرفوضاً**، و«too many connections» يعني موقعاً يردّ أخطاءً.
CEIL=$(( CORES * 300 ))
[ "$MAXCONN" -gt "$CEIL" ] && MAXCONN=$CEIL
[ "$MAXCONN" -lt 100 ] && MAXCONN=100

# `work_mem`: ما يضمن ألّا تنفجر الذاكرةُ لو فرز كلُّ اتّصالٍ مرّتين معاً.
WORK_KB=$(( (CONN_BUDGET * 1024) / (MAXCONN * 2) ))
[ "$WORK_KB" -lt 4096 ] && WORK_KB=4096
[ "$WORK_KB" -gt 65536 ] && WORK_KB=65536

ECS=$(( RAM_MB - OS_RESERVE ))                   # ما يظنّه المخطّطُ متاحاً
[ "$ECS" -lt 256 ] && ECS=256
MAINT=$(( DB_BUDGET / 16 ))
[ "$MAINT" -lt 64 ] && MAINT=64; [ "$MAINT" -gt 2048 ] && MAINT=2048

# مجمّعُ PostgREST: **من الأنوية لا من `max_connections`.** المجمّعُ حاكمُ
# تزامنٍ للعمل الفعليّ، و`max_connections` فسحةٌ ضدّ الفشل الصلب — غرضان
# مختلفان فصيغتان مختلفتان. و٤٠ هو المقيسُ العاملُ على نواةٍ واحدة.
PGRST_POOL=$(( CORES * 40 ))
[ "$PGRST_POOL" -gt $(( MAXCONN / 3 )) ] && PGRST_POOL=$(( MAXCONN / 3 ))
[ "$PGRST_POOL" -lt 20 ] && PGRST_POOL=20

PARWORK=$CORES
PARGATHER=$(( CORES > 1 ? CORES / 2 : 0 ))

# البثُّ الحيّ: **بلا سقفٍ عمليّ** (أمرُ ناصر) — والجدارُ يصير العتادَ.
RT_USERS=$(( CORES * 50000 ))
RT_EVENTS=$(( CORES * 10000 ))
RT_JOINS=$(( CORES * 5000 ))
RT_PRESENCE=$(( CORES * 10000 ))
RT_CHANNELS=1000
RT_PAYLOAD_KB=3000
RT_BYTES=$(( CORES * 50 * 1024 * 1024 ))
# وبديلُ السقف: حدُّ ذاكرةٍ على حاوية البثّ = ٤٠٪ من الرام (مشتقّ).
# فإن تجاوزته تُقتل وتعود وحدها **وتبقى القاعدةُ والموقعُ واقفين**.
RT_MEM_MB=$(( RAM_MB * 40 / 100 ))

# حدودُ إنذار الطاقة: **نِسَبٌ من القرص المقيس** لا أرقاماً لخادمٍ ماضٍ.
# (كانت ٤ ج.ب للقاعدة و٢٠ للصور — مُعايَرةً لجهاز ٢٤ ج.ب مات في أكتوبر.)
# والقاعدةُ والصورُ يتقاسمان نفس القرص، ومجموعُ الحرجين ٧٥٪ يُبقي فسحةً
# للـWAL والنسخ والسجلّات — فالقرصُ الممتلئ يُفشل كلَّ أمرٍ بصمت (درسٌ مدفوع).
DB_WARN_MB=$(( DISK_MB * 20 / 100 ));   DB_CRIT_MB=$(( DISK_MB * 30 / 100 ))
ST_WARN_MB=$(( DISK_MB * 30 / 100 ));   ST_CRIT_MB=$(( DISK_MB * 45 / 100 ))

echo
echo "═══ الحسبة (كلُّها مشتقّة) ═══"
printf "  %-24s %s\n"       "max_connections"       "$MAXCONN"
printf "  %-24s %s م.ب\n"   "shared_buffers"        "$SHB"
printf "  %-24s %s ك.ب\n"   "work_mem"              "$WORK_KB"
printf "  %-24s %s م.ب\n"   "maintenance_work_mem"  "$MAINT"
printf "  %-24s %s م.ب\n"   "effective_cache_size"  "$ECS"
printf "  %-24s %s\n"       "PGRST_DB_POOL"         "$PGRST_POOL"
printf "  %-24s %s\n"       "بثّ: متزامنون"          "$RT_USERS"
printf "  %-24s %s\n"       "بثّ: أحداث/ث"           "$RT_EVENTS"
printf "  %-24s %s م.ب/ث\n" "بثّ: نطاق"              "$(( RT_BYTES / 1048576 ))"
printf "  %-24s %s م.ب\n"   "حدُّ ذاكرة حاوية البثّ"  "$RT_MEM_MB"
printf "  %-24s %s / %s م.ب\n" "إنذارُ حجم القاعدة"    "$DB_WARN_MB" "$DB_CRIT_MB"
printf "  %-24s %s / %s م.ب\n" "إنذارُ حجم الصور"      "$ST_WARN_MB" "$ST_CRIT_MB"

if [ "$APPLY" != "1" ]; then
  echo; echo "ℹ️ عرضٌ فقط. بلا انقطاع: --apply · ومعه رفعُ الاتصالات: --restart"; exit 0
fi

TS=$(date +%Y%m%d-%H%M%S)
echo; echo "═══ التنفيذ ═══"
cp -a docker-compose.taki.yml "docker-compose.taki.yml.bak.tune.$TS"
docker exec supabase-db bash -c 'cp -a "$PGDATA/postgresql.auto.conf" "$PGDATA/postgresql.auto.conf.bak.'"$TS"'"' 2>/dev/null
echo "  ✓ نسخٌ احتياطيّة .bak.*$TS"

# ── ٣) ما يسري بإعادة تحميلٍ فقط (بلا انقطاع) ────────────────────────────
P "ALTER SYSTEM SET work_mem = '${WORK_KB}kB'" >/dev/null
P "ALTER SYSTEM SET maintenance_work_mem = '${MAINT}MB'" >/dev/null
P "ALTER SYSTEM SET effective_cache_size = '${ECS}MB'" >/dev/null
P "ALTER SYSTEM SET max_parallel_workers = ${PARWORK}" >/dev/null
P "ALTER SYSTEM SET max_parallel_workers_per_gather = ${PARGATHER}" >/dev/null
# 🪤 و`random_page_cost=4` قيمةُ قرصٍ دوّار من التسعينيّات: على SSD تجعل
#    المخطّطَ يتجنّب الفهارسَ بلا سبب — وفهارسُنا هي كلُّ شيء هنا.
P "ALTER SYSTEM SET random_page_cost = 1.1" >/dev/null
P "ALTER SYSTEM SET effective_io_concurrency = 200" >/dev/null
P "SELECT pg_reload_conf()" >/dev/null
echo "  ✓ إعداداتٌ سرت بإعادة تحميل"

# ── ٤) ما يحتاج إعادةَ تشغيل — وبقاعدةِ فسحة ─────────────────────────────
CUR_MAXCONN=$(P "SELECT current_setting('max_connections')")
CUR_SHB=$(( $(P "SELECT setting::bigint FROM pg_settings WHERE name='shared_buffers'") * 8 / 1024 ))
NEEDS=0
if [ "$RESTART" != "1" ]; then
  echo "  ⏸ بلا إعادة تشغيل: max_connections يبقى $CUR_MAXCONN (المحسوب $MAXCONN)"
  echo "     للرفع: bash scripts/tune-server.sh --restart"
  MAXCONN="$CUR_MAXCONN"   # لئلّا يتّهم التحقّقُ قيمةً لم نطلب كتابتها
else
[ "$CUR_MAXCONN" != "$MAXCONN" ] && { P "ALTER SYSTEM SET max_connections = ${MAXCONN}" >/dev/null; NEEDS=1; }
# 🪤 فسحةُ ٥٠٪ لـ`shared_buffers`: الصيغةُ تتحرّك مع نموّ القاعدة بايتاً
#    بايتاً، فبلا فسحةٍ يُعاد تشغيلُ الإنتاج لفرقِ ميجاباتٍ لا أثرَ له.
if [ "$(( SHB * 2 ))" -gt "$(( CUR_SHB * 3 ))" ] || [ "$(( SHB * 3 ))" -lt "$(( CUR_SHB * 2 ))" ]; then
  P "ALTER SYSTEM SET shared_buffers = '${SHB}MB'" >/dev/null; NEEDS=1
else
  echo "  ⏸ shared_buffers يبقى ${CUR_SHB} م.ب (المحسوب ${SHB} داخل الفسحة · الإصابة ${HIT}%)"
fi
fi

if [ "$NEEDS" = "1" ]; then
  echo "  … إعادةُ تشغيل القاعدة (انقطاعُ ثوانٍ)"
  docker restart supabase-db >/dev/null
  OK=0
  for i in $(seq 1 40); do sleep 3
    docker exec supabase-db pg_isready -U supabase_admin -d postgres >/dev/null 2>&1 && { OK=1; break; }
  done
  if [ "$OK" != "1" ]; then
    echo "  ❌ لم تُقلع القاعدة — تراجعٌ تلقائيّ"
    docker exec supabase-db bash -c 'cp -a "$PGDATA/postgresql.auto.conf.bak.'"$TS"'" "$PGDATA/postgresql.auto.conf"' 2>/dev/null \
      || docker exec supabase-db bash -c 'rm -f "$PGDATA/postgresql.auto.conf"'
    docker restart supabase-db >/dev/null
    for i in $(seq 1 40); do sleep 3; docker exec supabase-db pg_isready -U supabase_admin -d postgres >/dev/null 2>&1 && break; done
    echo "  ↩︎ أُعيدت الإعداداتُ السابقة."; exit 1
  fi
  echo "  ✓ القاعدةُ أقلعت"
fi

# ── ٥) مجمّعُ PostgREST + حدُّ ذاكرة البثّ (في ملفّ التجاوز = دائمان) ────
python3 - "$PGRST_POOL" "$RT_MEM_MB" <<'INNER'
import re, subprocess, sys, shutil
pool, rtmem = sys.argv[1], sys.argv[2]
p = '/opt/taki/supabase/docker-compose.taki.yml'
s = open(p, encoding='utf-8').read()

# ("لا تغيير" ليست "غير موجود": استبدالُ ٤٠ بـ٤٠ يُنتج نصّاً مطابقاً،
#  فمقارنةُ النصّين وحدها تتّهم مفتاحاً سليماً بالغياب. وقع فعلاً.)
if not re.search(r'PGRST_DB_POOL:\s*\d+', s):
    print('  ❌ PGRST_DB_POOL غير موجود في ملفّ التجاوز'); sys.exit(1)
s = re.sub(r'PGRST_DB_POOL:\s*\d+', 'PGRST_DB_POOL: ' + pool, s, count=1)
print('  ✓ PGRST_DB_POOL ⇐ ' + pool)

# حدُّ ذاكرة البثّ — خاملُ التكرار، وتحت مفتاح `services` **القائم**.
# (إلحاقُ `services:` في النهاية يُنتج مفتاحاً مكرّراً فينفجر YAML كلُّه.)
TAG = '# taki-rt'
if re.search(r'^\s+mem_limit:.*# taki-rt', s, re.M):
    s = re.sub(r'^(\s+)mem_limit:.*# taki-rt.*$',
               lambda m: m.group(1) + 'mem_limit: ' + rtmem + 'm  ' + TAG, s, flags=re.M)
    print('  ✓ حدُّ ذاكرة البثّ ⇐ ' + rtmem + ' م.ب')
elif re.search(r'^  realtime:\s*$', s, re.M):
    s = re.sub(r'^  realtime:[ \t]*$',
               '  realtime:\n    mem_limit: ' + rtmem + 'm  ' + TAG, s, count=1, flags=re.M)
    print('  ✓ حدُّ ذاكرة البثّ أُضيف إلى خدمةٍ قائمة (' + rtmem + ' م.ب)')
else:
    m = re.search(r'^services:[ \t]*$', s, re.M)
    if not m:
        print('  ❌ لا مفتاح services في ملفّ التجاوز'); sys.exit(1)
    s = s[:m.end()] + '\n  realtime:\n    mem_limit: ' + rtmem + 'm  ' + TAG + s[m.end():]
    print('  ✓ خدمةُ البثّ أُدرجت تحت services بحدٍّ ' + rtmem + ' م.ب')

# ولا يُكتب الملفُّ الحيُّ قبل أن تُثبت صياغتُه: يُجرَّب على نسخةٍ
# بـ`docker compose config`، ولا يُنقل إلّا إن مرّت.
tmp = p + '.candidate'
open(tmp, 'w', encoding='utf-8').write(s)
r = subprocess.run(['docker', 'compose', '-f', 'docker-compose.yml',
                    '-f', 'docker-compose.caddy.yml', '-f', tmp, 'config', '--quiet'],
                   cwd='/opt/taki/supabase', capture_output=True, text=True)
if r.returncode != 0:
    import os; os.unlink(tmp)          # لا يُترك مرشّحٌ خلفَ فشل
    print('  ❌ المرشّحُ معطوبُ الصياغة — لم يُمسّ الملفّ الحيّ:')
    print('     ' + (r.stderr or r.stdout).strip().splitlines()[-1]); sys.exit(1)
shutil.move(tmp, p)
print('  ✓ الصياغةُ أُثبتت ثمّ نُقل الملفّ')
INNER
RC=$?
if [ "$RC" != "0" ]; then
  echo "  ❌ تعذّر ضبطُ ملفّ التجاوز — أُوقف قبل إعادة إنشاء أي حاوية."
  echo "     النسخةُ السليمة: docker-compose.taki.yml.bak.tune.$TS"
  exit 1
fi

# ── ٦) سقوفُ البثّ الحيّ ─────────────────────────────────────────────────
# 🪤 **لا تُكتب في `_realtime.tenants` مباشرةً**: بذرُ حاوية البثّ
#    (`SEED_SELF_HOST=true`) يحذف الصفَّ ويُعيد إدراجه عند كل إقلاع، فأي
#    كتابةٍ هنا تعيش حتى أوّل إعادة إنشاء ثمّ تعود ٢٠٠ بصمت. وقِيس ذلك
#    مرّتين: مرّةً بالتحديث المباشر، ومرّةً بتغيير افتراضات الأعمدة (Ecto
#    يُرسل قيمَه هو فلا يرى افتراضَ القاعدة). الموضعُ الصامد: جدولُ السقوف
#    + مشغّلٌ يفرضه (هجرة v15.64).
P "INSERT INTO public.taki_realtime_limits (id,
     max_concurrent_users, max_events_per_second, max_joins_per_second,
     max_channels_per_client, max_bytes_per_second, max_payload_size_in_kb,
     max_presence_events_per_second, derived_from, updated_at)
   VALUES (true, ${RT_USERS}, ${RT_EVENTS}, ${RT_JOINS}, ${RT_CHANNELS},
           ${RT_BYTES}, ${RT_PAYLOAD_KB}, ${RT_PRESENCE},
           '${CORES} نواة · ${RAM_MB} م.ب رام', now())
   ON CONFLICT (id) DO UPDATE SET
     max_concurrent_users = EXCLUDED.max_concurrent_users,
     max_events_per_second = EXCLUDED.max_events_per_second,
     max_joins_per_second = EXCLUDED.max_joins_per_second,
     max_channels_per_client = EXCLUDED.max_channels_per_client,
     max_bytes_per_second = EXCLUDED.max_bytes_per_second,
     max_payload_size_in_kb = EXCLUDED.max_payload_size_in_kb,
     max_presence_events_per_second = EXCLUDED.max_presence_events_per_second,
     derived_from = EXCLUDED.derived_from, updated_at = now()" >/dev/null \
  && echo "  ✓ جدولُ السقوف كُتب (يفرضه المشغّل عند كل بذر)" \
  || { echo "  ❌ تعذّر كتابةُ جدول السقوف — هل طُبّقت هجرةُ v15.64؟"; exit 1; }
# حدودُ الطاقة: **دمجٌ** (`||`) لا دهساً — فشاشةُ «الأدوات ← حدود السعة»
# تكتب في نفس الصفّ (التهدئة · البريد · الكرون)، ودهسُه يمحو ضبطَ ناصر.
P "INSERT INTO public.platform_settings (key, value)
   VALUES ('capacity_limits', jsonb_build_object(
     'db_size_warn_mb', ${DB_WARN_MB}, 'db_size_crit_mb', ${DB_CRIT_MB},
     'storage_warn_mb', ${ST_WARN_MB}, 'storage_crit_mb', ${ST_CRIT_MB}))
   ON CONFLICT (key) DO UPDATE SET value = public.platform_settings.value || EXCLUDED.value" >/dev/null \
  && echo "  ✓ حدودُ إنذار الطاقة اشتُقّت من القرص (${DISK_MB} م.ب)"

# والصفُّ الحيُّ يُحدَّث الآن ليسري فوراً — والمشغّلُ يفرض نفسَ القيم.
P "UPDATE _realtime.tenants SET max_concurrent_users = ${RT_USERS}" >/dev/null

# يسري الحدُّ على الحاوية العاملة بلا إعادة إنشاء (والملفّ يُثبّته للمستقبل).
docker update --memory "${RT_MEM_MB}m" --memory-swap "$(( RT_MEM_MB * 2 ))m" "$RT" >/dev/null 2>&1 \
  && echo "  ✓ الحدُّ سرى على الحاوية العاملة" || echo "  ⚠️ لم يسرِ الحدُّ حياً — يسري عند أوّل إعادة إنشاء"

C="docker compose -f docker-compose.yml -f docker-compose.caddy.yml -f docker-compose.taki.yml"
$C config --quiet || { echo "  ❌ إعدادٌ معطوب — النسخةُ في docker-compose.taki.yml.bak.tune.$TS"; exit 1; }
$C up -d --no-deps rest realtime >/dev/null 2>&1
sleep 20

# ── ٧) التحقّق — يُقرأ الواقعُ لا النيّة ─────────────────────────────────
echo; echo "═══ التحقّق ═══"
BAD=0
chk() { [ "$2" = "$3" ] && echo "  ✅ $1 = $2" || { echo "  ❌ $1 = $2 (المتوقَّع $3)"; BAD=1; }; }
chk "max_connections"  "$(P "SELECT current_setting('max_connections')")" "$MAXCONN"
chk "work_mem"         "$(P "SELECT current_setting('work_mem')")" "${WORK_KB}kB"
chk "random_page_cost" "$(P "SELECT current_setting('random_page_cost')")" "1.1"
chk "PGRST_DB_POOL"    "$(docker exec supabase-rest env 2>/dev/null | grep -m1 '^PGRST_DB_POOL=' | cut -d= -f2)" "$PGRST_POOL"
chk "بثّ: متزامنون"     "$(P "SELECT max_concurrent_users FROM _realtime.tenants LIMIT 1")" "$RT_USERS"
chk "حدُّ ذاكرة البثّ"   "$(( $(docker inspect -f '{{.HostConfig.Memory}}' "$RT") / 1048576 ))" "$RT_MEM_MB"
chk "إنذارُ حجم القاعدة" "$(P "SELECT value->>'db_size_warn_mb' FROM public.platform_settings WHERE key='capacity_limits'")" "$DB_WARN_MB"
chk "لا سقفَ للمستخدمين" "$(P "SELECT (value ? 'users_warn')::text FROM public.platform_settings WHERE key='capacity_limits'")" "false"
AK=$(grep -m1 '^ANON_KEY=' .env | cut -d= -f2)
chk "القاعدةُ عبر الشبكة" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 -H "apikey: $AK" -H "Authorization: Bearer $AK" 'https://api.takisa.net/rest/v1/regions?select=id&limit=1')" "200"
chk "الموقع"            "$(curl -s -o /dev/null -w '%{http_code}' --max-time 25 https://www.takisa.net/)" "200"
echo "  اتصالاتٌ مستعملة: $(P "SELECT count(*) FROM pg_stat_activity") من $MAXCONN"
[ "$BAD" = "0" ] && echo "✅ الضبطُ تمّ وقِيس." || { echo "❌ فشلَ تحقّقٌ — النسخُ في .bak.*$TS"; exit 1; }
REMOTE
