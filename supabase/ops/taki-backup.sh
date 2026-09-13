#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
# نسخة تاكي اليومية — ٣:٣٠ فجراً بتوقيت الرياض (قبل تحديثات الأمان بساعة)
#
# v14.16 (١٣ سبتمبر ٢٠٢٦): أُضيفت **صور المستودع**. كانت النسخة تأخذ القاعدة
# وحدها، فلو ضاع ملف صورة لم يكن يُستعاد من أي مكان — والقاعدة تحمل الروابط
# لا الصور. (اكتُشف أثناء حذف الصور اليتيمة: لا نسخة تحميها.)
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
DIR=/home/ubuntu/backups
IMGDIR=/opt/taki/supabase/volumes/storage
TS=$(date +%F_%H%M)
OUT="$DIR/taki-$TS.dump"
IMG="$DIR/taki-images-$TS.tar.gz"

# ── ١) القاعدة ────────────────────────────────────────────────────────────
docker exec supabase-db pg_dump -U supabase_admin -d postgres -Fc > "$OUT" 2>>"$DIR/backup.log"
SZ=$(stat -c%s "$OUT" 2>/dev/null || echo 0)
if [ "$SZ" -lt 500000 ]; then
  echo "$(date -Is) FAIL db size=$SZ" >> "$DIR/backup.log"; rm -f "$OUT"; exit 1
fi
echo "$(date -Is) OK $OUT $SZ bytes" >> "$DIR/backup.log"

# ── ٢) الصور ──────────────────────────────────────────────────────────────
# نفس حارس الحجم: نسخةٌ أصغر من ميجابايت واحد مشبوهة، فلا تُستبدل بها سليمة.
tar czf "$IMG" -C "$IMGDIR" . 2>>"$DIR/backup.log"
ISZ=$(stat -c%s "$IMG" 2>/dev/null || echo 0)
if [ "$ISZ" -lt 1000000 ]; then
  echo "$(date -Is) FAIL images size=$ISZ" >> "$DIR/backup.log"; rm -f "$IMG"
else
  echo "$(date -Is) OK $IMG $ISZ bytes" >> "$DIR/backup.log"
fi

# ── ٣) الاحتفاظ بآخر ١٤ من كل نوع ────────────────────────────────────────
ls -1t "$DIR"/taki-*.dump 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$DIR"/taki-images-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
