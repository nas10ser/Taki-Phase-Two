#!/bin/bash
# يُعيد توليد supabase/APPLIED.md بالقياس من الخادم الحيّ.
# شغّله بعد كل موجة هجرات: bash supabase/ops/build-applied-log.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
TMP=$(mktemp -d)
ssh -i ~/.ssh/taki_oracle ubuntu@141.147.142.147 \
 "sudo docker exec supabase-db psql -U supabase_admin -d postgres -t -A -c \"
  SELECT 'f:'||p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
  UNION SELECT 't:'||table_name FROM information_schema.tables WHERE table_schema='public';\"" \
 2>/dev/null > "$TMP/objects.txt"
[ "$(wc -l < "$TMP/objects.txt")" -gt 300 ] || { echo "❌ جرد الخادم قصير بشكل مريب"; exit 1; }
python3 - "$TMP/objects.txt" <<'PY'
import re, sys, subprocess, glob
have = {h.lower() for h in open(sys.argv[1]).read().split()}
rows = []
for f in sorted(glob.glob('supabase/*.sql')):
    src = open(f, encoding='utf-8', errors='replace').read()
    d  = {'f:'+m.lower() for m in re.findall(r'CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?"?(\w+)', src, re.I)}
    d |= {'t:'+m.lower() for m in re.findall(r'CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?"?(\w+)', src, re.I)}
    date = subprocess.run(['git','log','--diff-filter=A','--format=%ad','--date=short','-1','--',f],
                          capture_output=True, text=True).stdout.strip() or '—'
    rows.append((date, f.split('/')[-1], len(d), len(d & have)))
for date, name, n, ok in sorted(rows):
    st = '— (فحص/تدقيق)' if n == 0 else (f'✅ {ok}/{n}' if ok == n else f'⚠️ {ok}/{n}')
    print(f"| {date} | `{name}` | {n or '—'} | {st} |")
PY
