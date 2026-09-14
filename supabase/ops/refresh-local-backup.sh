#!/bin/bash
# يُنزّل أحدث نسخة مشفّرة من أوراكل إلى مجلد المشروع، ويتحقّق من بصمتها.
# النسخة الرابعة: تنجو حتى لو ضاع حساب أوراكل نفسه.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/../.." && pwd)/نسخ-احتياطية"
PARF="$HOME/.taki_backup_list_par"
[ -f "$PARF" ] || { echo "❌ رابط القراءة مفقود. ضعه في $PARF (من لوحة أوراكل ← taki-backups ← Pre-Authenticated Requests)"; exit 1; }
PAR=$(cat "$PARF"); BASE="${PAR%%\?*}"
mkdir -p "$DIR"; cd "$DIR"
N=$(curl -fsS --max-time 60 "${PAR}?fields=name,timeCreated" | python3 -c \
  "import sys,json;o=[x for x in json.load(sys.stdin)['objects'] if x['name'].endswith('.tar.gpg')];o.sort(key=lambda x:x['timeCreated']);print(o[-1]['name'])")
[ -f "$N" ] && { echo "✅ أحدث نسخة ($N) موجودة أصلاً."; exit 0; }
echo "⬇︎  $N"
curl -fsS --max-time 900 -o "$N" "${BASE}${N}"
curl -fsS --max-time 60  -o "${N%.tar.gpg}.sha256" "${BASE}${N%.tar.gpg}.sha256"
A=$(shasum -a 256 "$N" | awk '{print $1}'); E=$(tr -d '[:space:]' < "${N%.tar.gpg}.sha256")
[ "$A" = "$E" ] || { echo "❌ البصمة مختلفة — النسخة تالفة، حُذفت."; rm -f "$N" "${N%.tar.gpg}.sha256"; exit 1; }
echo "✅ نُزّلت وتحقّقت — $(du -h "$N" | cut -f1)"
ls -1t taki-*.tar.gpg | tail -n +4 | while read -r f; do rm -f "$f" "${f%.tar.gpg}.sha256"; echo "🗑  حُذفت القديمة $f"; done
