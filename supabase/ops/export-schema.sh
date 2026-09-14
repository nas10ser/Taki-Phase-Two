#!/bin/bash
# يُعيد توليد supabase/schema/00-full-schema.sql من خادم جدة الحيّ،
# ويرفض الكتابة إن عثر على قيمة سرّ أو صفّ بيانات (المستودع عام).
set -euo pipefail
OUT="$(cd "$(dirname "$0")/../.." && pwd)/supabase/schema/00-full-schema.sql"
TMP=$(mktemp)
ssh -i ~/.ssh/taki_oracle ubuntu@141.147.142.147 \
  'sudo docker exec supabase-db pg_dump -U supabase_admin -d postgres --schema-only \
     --no-owner --no-privileges -n public -n auth -n storage' 2>/dev/null > "$TMP"
[ "$(wc -l < "$TMP")" -gt 20000 ] || { echo "❌ التصدير قصير بشكل مريب"; exit 1; }
grep -qE '^(INSERT INTO|COPY )' "$TMP" && { echo "❌ التصدير يحمل بيانات — لا يُرفع"; exit 1; }
grep -oE "'[A-Za-z0-9+/_=-]{40,}'" "$TMP" | grep -v ABCDEFGH && { echo "❌ قيمة تشبه سرّاً"; exit 1; }
{ sed -n '1,12p' "$OUT"; cat "$TMP"; } > "$OUT.new" && mv "$OUT.new" "$OUT"
echo "✅ حُدِّث $(basename "$OUT") — $(wc -l < "$OUT") سطراً"
