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
