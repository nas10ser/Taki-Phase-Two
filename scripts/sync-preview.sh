#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# sync-preview.sh — أمرٌ واحد يزامن قاعدة المعاينة (v14.81)
# ════════════════════════════════════════════════════════════════════════════
# الاستعمال:   bash ~/Desktop/TAKI/scripts/sync-preview.sh
#
# 🪤 لماذا وُجد: كان الرابط يُركَّب يدوياً في كل مرّة — يُقرأ القالب من ملفّ
#    المفاتيح، وتُقرأ الكلمة من **رقم سطرٍ** بعينه، ثم يُلصقان. وأرقام السطور
#    تزحف مع أول تعديلٍ على الملف، فأضاع ذلك وقتاً فعلياً: رسالة
#    «password authentication failed» بدت كلمةً خاطئة، وكانت في الحقيقة
#    **قالباً بحرف `<PW>` لم يُستبدل** (٤ محارف).
#    الآن تُقرأ بالاسم `PREVIEW_DB_PASSWORD=` فلا يزحف شيء.
#
# 🔒 ولا يطبع السرّ إطلاقاً: يُقرأ في متغيّر، ويُمرَّر بـ`$VAR`، ولا يظهر في
#    `ps` (يُمرَّر عبر بيئة ssh لا في سطر الأوامر)، ولا في أي سجلّ.
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

KEYS="$HOME/Desktop/TAKI-مفاتيح-الخدمات.txt"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BOX="ubuntu@141.147.142.147"
SSH_KEY="$HOME/.ssh/taki_oracle"
HOSTPART="postgres.kbmqzxcjdankdgiovctm"
POOLER="aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres"

[ -r "$KEYS" ] || { echo "✗ لم أجد ملفّ المفاتيح: $KEYS"; exit 1; }

# القراءة بالاسم لا بالموضع. `cut -d= -f2-` يحفظ أي `=` داخل الكلمة نفسها.
PW="$(grep -m1 '^PREVIEW_DB_PASSWORD=' "$KEYS" | cut -d= -f2- | tr -d '[:space:]')" || true

if [ -z "${PW:-}" ]; then
    cat >&2 <<'MSG'
✗ لم أجد PREVIEW_DB_PASSWORD في ملفّ المفاتيح (القسم ٥).
  أضف سطراً بهذا الشكل بالضبط، بلا مسافات حول علامة يساوي:
      PREVIEW_DB_PASSWORD=<الكلمة>
MSG
    exit 1
fi

# حارسٌ يمنع تكرار ما وقع: قالبٌ لم يُستبدل، أو قيمةٌ قصيرة لا تكون كلمة سرّ.
case "$PW" in
    *'<'*|*'>'*)
        echo "✗ القيمة ما زالت قالباً (تحوي < أو >) — الصق الكلمة الحقيقية مكانها." >&2
        exit 1 ;;
esac
if [ "${#PW}" -lt 12 ]; then
    echo "✗ الكلمة ${#PW} محارف فقط — أقصر من أن تكون كلمة سرّ قاعدة. بدّلها من اللوحة." >&2
    exit 1
fi

# ترميز ما قد يكسر عنوان الاتصال (@ : / ? # % …) بلا طباعة أي شيء.
PW_ENC="$(PW="$PW" python3 -c 'import os,urllib.parse; print(urllib.parse.quote(os.environ["PW"], safe=""))')"
URL="postgresql://${HOSTPART}:${PW_ENC}@${POOLER}"

echo "▸ الكلمة قُرئت من ملفّ المفاتيح (${#PW} محرفاً) — لا تُطبع."
echo "▸ نسخ سكربت المزامنة إلى خادم جدة…"
scp -q -i "$SSH_KEY" "$REPO/scripts/sync-preview-db.sh" "$BOX:/tmp/s.sh"

echo "▸ تشغيل المزامنة (قد تستغرق ٥–١٥ دقيقة)…"
# 🪤 بعد تبديل الكلمة مباشرةً قد يردّ المجمّع 28P01 مرّةً — وهو متوقَّع وموثَّق
#    عند سوبابيس. نُعيد المحاولة مرّتين قبل أن نُعلن فشلاً، فلا يُظنّ أن الكلمة
#    خاطئة وهي صحيحة.
attempt=1
while [ "$attempt" -le 3 ]; do
    if ssh -i "$SSH_KEY" -o ConnectTimeout=30 "$BOX" \
         "PREVIEW_DB_URL='$URL' timeout 1200 bash /tmp/s.sh"; then
        echo "✅ تمّت المزامنة."
        exit 0
    fi
    if [ "$attempt" -lt 3 ]; then
        echo "… المحاولة $attempt لم تنجح (قد يكون المجمّع لم يلتقط الكلمة الجديدة بعد). إعادة خلال ٢٠ ثانية."
        sleep 20
    fi
    attempt=$((attempt + 1))
done

echo "✗ فشلت المزامنة بعد ٣ محاولات." >&2
echo "  إن كانت الرسالة «password authentication failed» فالكلمة في الملفّ لا تطابق اللوحة." >&2
exit 1
