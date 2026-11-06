#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# capacity-snapshot.sh — لقطةُ سعةٍ من خادم جدة، بأمرٍ واحد (v15.57)
# ───────────────────────────────────────────────────────────────────────────
# لماذا سكربتٌ لا أوامرُ متفرّقة: قاعدةُ المشروع «لا تقل تمّ إلا بعد قياس»
# تحتاج **نفسَ** القياس قبل التغيير وبعده. وأمرٌ يُكتب من الذاكرة في كل مرّة
# يُنتج أرقاماً لا تُقارَن (نافذةٌ مختلفة، جدولٌ منسيّ، وحدةٌ أخرى).
#
# 🪤 **يقرأ فقط.** ولا سطرَ فيه يكتب في الإنتاج — ولا يجوز أن يُضاف.
# 🪤 ولا يُشغَّل في حلقة: الخادم **نواةٌ واحدة**، واختبارُ الحِمل على الإنتاج
#    أسقط الموقعَ خمسَ ساعاتٍ مرّة (درسٌ مسجَّل).
#
# الاستعمال:
#   bash scripts/capacity-snapshot.sh            # يطبع على الشاشة
#   bash scripts/capacity-snapshot.sh > before.txt
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
SSH_KEY="${TAKI_SSH_KEY:-$HOME/.ssh/taki_jeddah2}"
SSH_HOST="${TAKI_SSH_HOST:-ubuntu@207.127.99.122}"

if [ ! -f "$SSH_KEY" ]; then
  echo "❌ مفتاحُ جدة غير موجود: $SSH_KEY" >&2; exit 1
fi

ssh -i "$SSH_KEY" "$SSH_HOST" 'bash -s' <<'REMOTE'
set -uo pipefail
P() { sudo docker exec supabase-db psql -U supabase_admin -d postgres -At -F'|' -c "$1"; }

# 🪤 وأوّلُ سطرٍ يقول أيُّ خادمٍ هذا — فهجراتٌ كاملة ذهبت للمختبر ظنّاً أنها جدة.
echo "== الخادم: $(hostname) · $(date '+%F %T %Z')"
echo "== الوسم: $(P "SELECT COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'(جدة — بلا وسم مختبر)')")"
echo
echo "== حجمُ القاعدة وأكبرُ عشرة جداول"
P "SELECT pg_size_pretty(pg_database_size('postgres'))" | sed 's/^/   المجموع: /'
P "SELECT '   '||rpad(schemaname||'.'||relname,34)||lpad(pg_size_pretty(pg_total_relation_size(relid)),10)
        ||lpad(n_live_tup::text,10)||' صفّاً'
     FROM pg_stat_all_tables
    WHERE schemaname IN ('public','cron','auth','storage','realtime','net')
    ORDER BY pg_total_relation_size(relid) DESC LIMIT 10"
echo
echo "== سجلُّ الكرون (الجدولُ الذي كان ٦٢٪ من القاعدة)"
P "SELECT '   صفوف: '||count(*)||' · حجم: '||pg_size_pretty(pg_total_relation_size('cron.job_run_details'))
        ||' · أقدمُ صفّ: '||COALESCE(min(start_time)::date::text,'—') FROM cron.job_run_details"
echo
echo "== WAL وفتحاتُ النسخ (فتحةٌ ميتة تملأ القرصَ بصمت)"
P "SELECT '   wal: '||pg_size_pretty(sum(size)) FROM pg_ls_waldir()"
P "SELECT '   '||slot_name||' · active='||active||' · متأخّرة '||COALESCE(pg_size_pretty(pg_current_wal_lsn()-restart_lsn),'—')
     FROM pg_replication_slots" 2>/dev/null || echo "   (لا فتحات)"
echo
echo "== هويّةُ النسخ (FULL تكتب الصفَّ القديم كاملاً في WAL عند كل تحديث)"
P "SELECT '   FULL: '||COALESCE(string_agg(c.relname,', ' ORDER BY c.relname),'(لا شيء)')
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relreplident='f'"
P "SELECT '   يُبَثّ: '||count(*)||' جدولاً' FROM pg_publication_tables WHERE pubname='supabase_realtime'"
echo
echo "== إعداداتٌ تهمّ عند النموّ"
P "SELECT '   '||rpad(name,38)||lpad(setting||' '||COALESCE(unit,''),14)||'  ['||source||']'
     FROM pg_settings WHERE name IN ('shared_buffers','effective_cache_size','work_mem','maintenance_work_mem',
     'random_page_cost','effective_io_concurrency','wal_compression','max_connections','jit',
     'autovacuum_vacuum_scale_factor','statement_timeout','idle_in_transaction_session_timeout') ORDER BY name"
echo "   إعداداتُ الأدوار:"
# 🔴 **`pg_db_role_setting` يحمل أسراراً.** طبعتُ هذا السطرَ خاماً مرّةً واحدة
#    فخرجت `app.settings.jwt_secret` كاملةً إلى سجلّ الجلسة — وهو بالضبط ما
#    تمنعه قاعدةُ المشروع. والعلاجُ **قائمةُ سماحٍ لا قائمةُ منع**: نمطُ منعٍ
#    (`%secret%`) يفشل **مفتوحاً** أمام أيّ اسمٍ جديد لم نتوقّعه، وقائمةُ
#    السماح تفشل **مغلقة** فتطمس المجهولَ بدل أن تُذيعه (درسٌ مسجَّل في CLAUDE.md).
P "WITH kv AS (
     SELECT COALESCE(r.rolname,'(القاعدة)') AS who,
            split_part(c,'=',1) AS k,
            substr(c, length(split_part(c,'=',1))+2) AS v
       FROM pg_db_role_setting s
       LEFT JOIN pg_roles r ON r.oid = s.setrole,
            unnest(s.setconfig) AS c)
   SELECT '     '||who||' ⇐ '||string_agg(
            CASE WHEN k IN ('statement_timeout','lock_timeout','search_path',
                            'idle_in_transaction_session_timeout','default_transaction_read_only',
                            'log_statement','session_preload_libraries','work_mem','role',
                            'jit','default_transaction_isolation','client_min_messages')
                 THEN k||'='||v
                 ELSE k||'=<محجوب '||length(v)||' محرفاً>'   -- الطولُ وحده، لا الرأس ولا الذيل
            END, ' · ' ORDER BY k)
     FROM kv GROUP BY who ORDER BY who"
echo
echo "== الطبقةُ الأمامية"
AK=$(sudo grep -m1 '^ANON_KEY=' /opt/taki/supabase/.env | cut -d= -f2)
curl -s -H 'Accept-Encoding: gzip' -H "apikey: $AK" -o /tmp/_c.gz -D /tmp/_h.txt \
     "https://api.takisa.net/rest/v1/cities?select=*" 2>/dev/null
echo "   ضغط: $(grep -i '^content-encoding' /tmp/_h.txt | tr -d '\r' | cut -d' ' -f2- || echo 'لا شيء ❌')" \
     "· $(gunzip -c /tmp/_c.gz 2>/dev/null | wc -c) ⇐ $(wc -c < /tmp/_c.gz) بايت"
echo "   مجمَّع PostgREST: $(sudo docker exec supabase-rest env 2>/dev/null | grep -E '^PGRST_DB_POOL=' | cut -d= -f2 || echo '؟')"
rm -f /tmp/_c.gz /tmp/_h.txt
echo
echo "== الموارد"
free -m | awk '/Mem:/{printf "   رام: %s م.ب مستعمل · %s متاح · %s buff/cache\n",$3,$7,$6}'
echo "   أنوية: $(nproc) · قرص: $(df -h / | awk 'NR==2{print $5" مستعمل من "$2}')"
echo "   سجلّات الحاويات: $(sudo du -sh /var/lib/docker/containers 2>/dev/null | cut -f1)"
sudo docker stats --no-stream --format '   {{.Name}}  {{.CPUPerc}}  {{.MemUsage}}' | sort
REMOTE
