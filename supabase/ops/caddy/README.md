# نسخةُ Caddyfile الحيّة — `/opt/taki/supabase/volumes/proxy/caddy/Caddyfile`

المستودعُ وحده لا يُعيد بناءَ الخادم، فأيُّ تعديلٍ هنا يُطبَّق في الموضعين
معاً (نفسُ قاعدة `supabase/email-templates/docker-compose.taki.yml`).

ما تحمله هذه النسخة اليوم:

- **كتلةٌ واحدة لاسمَين** (`{$PROXY_DOMAIN}, api.takisa.net`) فيتشاركان
  الإعدادَ بلا ازدواجٍ ينحرف.
- **`encode`** (v15.51) — قِيس قبلها: ٣٤٬٣٤٦ بايتاً تُرسَل خاماً حتى حين
  يطلب المتصفّح `gzip,br,zstd`، وصفرُ ترويسةِ `content-encoding` في الردّ.
- **`/email-templates/*` خارج `basic_auth` عمداً**: GoTrue يجلبها بنفسه عبر
  HTTPS، وحجبُها يُسقطه إلى قوالبه الإنجليزية **بصمت**.
- **`header -server`** فلا يُعلَن اسمُ الخادم وإصدارُه.

التطبيقُ بعد أي تعديل (على الخادم):

```
sudo docker exec supabase-proxy caddy reload --config /etc/caddy/Caddyfile
```

---

## ✅ طُبِّق على جدة — ٨ نوفمبر ٢٠٢٦

الترويساتُ الأمنيّة و`no-store` على المسارات المصادَق عليها، وإسقاطُ الاسم
الميت — كلُّها حيّةٌ الآن. والإجراءُ المُستعمَل (ويُعاد كما هو لأيّ تعديلٍ لاحق):

```bash
scp -i ~/.ssh/taki_jeddah2 supabase/ops/caddy/Caddyfile ubuntu@207.127.99.122:/tmp/Caddyfile.new
ssh -i ~/.ssh/taki_jeddah2 ubuntu@207.127.99.122 'sudo bash -s' <<'EOS'
set -euo pipefail
LIVE=/opt/taki/supabase/volumes/proxy/caddy        # ← المسارُ المضموم (قِيس بـdocker inspect)
BAK="$LIVE/Caddyfile.bak.$(date +%Y%m%d-%H%M%S)"
cp -a "$LIVE/Caddyfile" "$BAK"; cp /tmp/Caddyfile.new "$LIVE/Caddyfile"
docker exec supabase-caddy caddy validate --config /etc/caddy/Caddyfile \
  || { cp -a "$BAK" "$LIVE/Caddyfile"; echo "تراجعٌ تلقائيّ"; exit 1; }
docker exec supabase-caddy caddy reload --config /etc/caddy/Caddyfile
EOS
```

🔴 **والتحقّقُ ليس اختيارياً**: إعدادٌ لم يُقَس ردُّه ليس مُطبَّقاً. والقياسُ
الحاسمُ ليس وصولَ الترويسات — بل **أنّ صورَ العروض لم تفقد سنةَ التخزين**،
فمُطابِقٌ أوسعُ من اللازم يُفرّغ كلَّ بطاقةٍ في المنصّة في اللحظة نفسها:

```bash
curl -sS -D- -o /dev/null https://api.takisa.net/rest/v1/ | grep -iE 'cache-control|nosniff|strict-transport'
#   المتوقَّع: no-store, private · nosniff · max-age=63072000; includeSubDomains
curl -sS -D- -o /dev/null 'https://api.takisa.net/storage/v1/object/public/deals/<ملفٌّ حقيقيّ>' | grep -i cache-control
#   المتوقَّع: max-age=31536000   ← **لا** no-store
curl -sS -o /dev/null -w '%{http_code}\n' https://api.takisa.net/        # ٤٠١ (Studio محميّ)
curl -sS -o /dev/null -w '%{http_code}\n' https://api.takisa.net/mcp     # ٤٠٣
```

**ما قِيس يوم التطبيق:** الخمسُ وصلت · الصورةُ حفظت `max-age=31536000` ·
Studio ٤٠١ · `/mcp` ٤٠٣ · وحلقةُ ACME الميتة **٨٥ سطراً في ست ساعاتٍ ⇐ صفر**
(والشهادةُ الحقيقيّة سليمةٌ حتى ٢٨ يناير ٢٠٢٧).
