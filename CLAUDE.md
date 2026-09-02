# TAKI — برومت Claude (يتحمّل تلقائياً كل جلسة)

## 👤 من أنا
أنا **ناصر**، مالك TAKI (منصة حجز التخفيضات في السعودية). **لست مبرمجاً** — لا أفهم الكود ولا الأوامر.

## ⚠️ أوامري الثابتة (لا تتغير)
- نفّذ كل شيء بنفسك. **لا تطلب مني أوامر تقنية إلا للضرورة القصوى** — وحين تضطر، أعطني أمراً واحداً جاهزاً للّصق، وقل ماذا أتوقّع أن أرى، وماذا يعني كل احتمال.
- ردّ بالعربي دائماً. وقل لي ماذا أفعل بالضبط (افتح هذا الرابط، اضغط هذا الزر).
- دقة عالية + احترافية + أحدث التقنيات + شكل عصري.
- **بدون دين برمجي** (no tech debt) + أحدث معايير الأمان ضد الاختراقات.
- **لا تقل «تمّ» إلا بعد قياس.** الفرق بين «الكود يبدو صحيحاً» و«جرّبته فنجح» هو ما كلّفنا إصدارات كاملة.

---

## 🏗 البنية التقنية
- React 18 + Parcel 2 + TypeScript + Supabase + Vercel
- المسار المحلي على ماك ناصر: `/Users/nasser/Desktop/TAKI`
- Repo: `https://github.com/nas10ser/Taki-Phase-Two` (فرع `main`) — ⚠️ **عام** فلا يُرفع إليه أي سرّ ولا بيانات عملاء
- الإنتاج: **`https://www.takisa.net`** (النطاق الرئيسي — الجذر `takisa.net` و`taki-test-eight.vercel.app` **يحوّلان إليه بـ308 مع حفظ المسار**)
- القاعدة: **`https://api.takisa.net`** (نفس خادم جدة؛ الاسم القديم `141-147-142-147.sslip.io` يبقى يعمل فلا تنكسر صور العروض القديمة)
- النطاق على **Cloudflare** — كل السجلات **DNS only (سحابة رمادية)**: `www`+`@` CNAME إلى Vercel، و`api` A إلى `141.147.142.147`
- Vercel: `nasser-projects1/taki-test` (مفوّض كـ `nalaumari-8916`، Env vars مشفّرة)
- **الإصدار الحالي: v13.92** (آخر إصدار في `progress.md` — الأحدث في الأعلى)

### 🔴 قاعدتان: أيّهما الحقيقية؟
- **جدة = الإنتاج المعتمد** (`api.takisa.net` — وسابقاً `141-147-142-147.sslip.io`، مستضاف ذاتياً على أوراكل). **قرار ناصر (٨ أغسطس ٢٠٢٦): أي تعديل على القاعدة يُعتمد على جدة.**
- **طوكيو `kbmqzxcjdankdgiovctm`** (Supabase MCP) = **مختبر ونسخة احتياطية فقط**. لا يُعتمد إصلاح لأنه نجح عليه.
- **كيف تعرف أيّهما أمامك بيقين** — علامة داخل المخطط:
  ```sql
  SELECT obj_description('public'::regnamespace, 'pg_namespace');
  -- 'TAKI_LAB_TOKYO_MARKER_v1382' = المختبر
  ```
  🪤 **درس مكلف (٢٢ أغسطس):** هجرات أسابيع ذهبت للمختبر لا لجدة، لأن لوحة supabase.com سهلة الفتح وجدة تحتاج طريقاً خاصاً. **كل ملف هجرة يجب أن يبدأ بحارس يرفض التنفيذ على المختبر، وينتهي بجدول ✅/❌ أوّل سطر فيه اسم الخادم.**

### 🔑 الدخول لخادم جدة (من جهاز ناصر فقط)
```bash
ssh -i ~/.ssh/taki_oracle ubuntu@141.147.142.147
```
- المفتاح `~/.ssh/taki_oracle` على ماك ناصر وحده و**لا يُرفع للمستودع أبداً**.
- جهاز أوراكل: `taki-supabase-jeddah` في `me-jeddah-1` · حاوية القاعدة **`supabase-db`**
- الدور المالك **`supabase_admin`** — **لا `postgres`**، فهو لا يملك الدوال ويفشل بـ`must be owner of function`.
- ⚠️ **«Run Command» في أوراكل غير متاح على هذا الجهاز** (ليست ضمن إضافات الوكيل الإحدى عشرة) — لا تُضِع وقتاً فيها، SSH هو الطريق.
- ⚠️ لوحة Studio محمية بـBasic Auth و**كلمة سرّها مفقودة** (لم تعد لازمة بعد SSH؛ تُقرأ من `.env` على الخادم عند الحاجة).

**تشغيل ملف هجرة على جدة (الطريقة المُختبَرة):**
```bash
ssh -i ~/.ssh/taki_oracle ubuntu@141.147.142.147 \
  'curl -fsSL -o /tmp/m.sql <رابط raw ببصمة الكوميت> && sudo docker exec -i supabase-db \
   psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -f - < /tmp/m.sql' \
  2>&1 | tee ~/Desktop/result.txt
```

### 💾 النسخة الاحتياطية اليومية (ضُبطت ٢٢ أغسطس ٢٠٢٦)
- `/usr/local/bin/taki-backup.sh` عبر `/etc/cron.d/taki-backup` — **٣:٣٠ فجراً بتوقيت الرياض**، تسبق تحديثات الأمان التلقائية (٤:٣٠).
- تحتفظ بآخر **١٤** نسخة في `/home/ubuntu/backups` + سجل `backup.log`، **وترفض أي نسخة أصغر من ٥٠٠ كيلوبايت** فلا تُستبدل نسخة سليمة بفاسدة.
- **اختبار الاستعادة أُجري فعلاً ونجح:** ٣٨٤ دالة · ٥٠ جدولاً · ٢١ عرضاً · ٨٩ حجزاً · ١١٢ رسالة — مطابقة للحيّ.
  ```bash
  ssh -i ~/.ssh/taki_oracle ubuntu@141.147.142.147 'sudo bash -s' <<'EOF'
  LATEST=$(ls -1t /home/ubuntu/backups/taki-*.dump | head -1)
  docker exec supabase-db psql -U supabase_admin -d postgres -c 'CREATE DATABASE taki_restore_test;'
  docker exec -i supabase-db pg_restore -U supabase_admin -d taki_restore_test --no-owner --no-privileges < "$LATEST"
  docker exec supabase-db psql -U supabase_admin -d taki_restore_test -c "SELECT count(*) FROM public.bookings;"
  docker exec supabase-db psql -U supabase_admin -d postgres -c 'DROP DATABASE taki_restore_test;'
  EOF
  ```
  (تحذيرات `pg_restore` عن `cron.*` طبيعية — عدّادات pg_cron لا بيانات تطبيق.)
- 🔴 **ناقص:** النسخ على **نفس الخادم**. لو فُقد الجهاز فُقدت معه. يلزم نسخ خارج الخادم.

### 🔍 فحص اكتمال الخادم
`supabase/JEDDAH_COMPLETENESS_CHECK.sql` — يستخرج آلياً كل ما يناديه الكود ويقارنه بالخادم. **يقرأ فقط.**
آخر تشغيل (٢٢ أغسطس): **٢١٦/٢١٦ دالة · ٢٨/٢٨ جدولاً · حارس البوت ✅**.
⚠️ لالتقاط دوال البوت لا تكتفِ بنمط `.rpc('اسم')` — `server/bot.js` يناديها عبر غلاف `rpc(fn, args)` بلا نقطة، وثلاث دوال تُسنَد لمتغيّر (`acknowledge/cancel/complete_booking`).

### 🌐 النطاق (٣١ أغسطس ٢٠٢٦)
`takisa.net` على Cloudflare. الموقع `www.takisa.net` (Vercel، شهادة تلقائية) والقاعدة `api.takisa.net`
(خادم جدة خلف **Caddy** الذي يجلب شهادة Let's Encrypt وحده). Caddy يخدم **الاسمين في كتلة واحدة**
(`{$PROXY_DOMAIN}, api.takisa.net {`) فيتشاركان نفس الإعداد بلا ازدواج.

**الشبكة لم تعد محجوبة في الجلسات** — يمكن الوصول مباشرة إلى الموقع والقاعدة بـ`curl`،
والفحص الأمني الحيّ يُشغَّل محلياً: `cd ~/Desktop/TAKI && bash scripts/security-probe.sh`.

⚠️ **الصور القديمة** في `deals.images` مخزَّنة بعنوان `sslip.io` كاملاً — لذلك يجب أن يبقى ذلك
الاسم يعمل، أو تُعاد كتابة العناوين في القاعدة.

### 📧 قوالب البريد (v13.92)
GoTrue **لا يدعم قالباً لكل لغة**، لكنه يمرّر `raw_user_meta_data` للقالب باسم `.Data`
و**يُمرّر العنوان (Subject) عبر نفس محرّك القوالب** — فقالب واحد يفرّع على `.Data.lang`
يكفي بلا Edge Function ولا خدمة وسيطة. **الافتراضي عربي.**
- القوالب: `supabase/email-templates/*.html` → `bash scripts/deploy-email-templates.sh`
  → يخدمها Caddy على `https://api.takisa.net/email-templates/` (خارج basic_auth عمداً).
  GoTrue يخزّنها **١٠ دقائق**، فأي تعديل يسري خلالها بلا إعادة تشغيل.
- العناوين: `GOTRUE_MAILER_SUBJECTS_*` في `/opt/taki/supabase/docker-compose.taki.yml`
  على جدة (نسخة في `supabase/email-templates/docker-compose.taki.yml` — **عدّلهما معاً**).
- مصدر اللغة: `Register.tsx` يرسل `lang` → `handle_new_user` يحفظها في
  `users.preferred_lang` → تريجر `tr_sync_auth_lang` يزامن أي تغيير لاحق لبيانات الحساب.

🪤 **ثلاثة فخاخ تُسقط القالب بصمت** إلى الإنجليزي المدمج (بلا أي خطأ ظاهر):
`html/template` يرفض اختلاف سياق HTML بين فرعَي `{{ if }}` · `eq .Data.lang "en"` وحدها
تنفجر عند غياب المفتاح فلا بد من حارسَي `{{ if .Data }}{{ if .Data.lang }}` ·
و`$` في ملفات compose تعني متغيّر بيئة فتُكتب `$$`
(و`docker compose config` يُعيد ترميزها فلا يصلح دليلاً — اقرأ المتغيّر من داخل حاوية).

---

## 🔄 آلية التنفيذ (كل تعديل)
1. عدّل الكود في الـworktree الحالي
2. ارفع `CACHE_NAME` في `sw.js` (`taki-cache-vXX.YY`) — **إلزامي لكل نشر**
3. `npm run typecheck` ثم `npm run build` — لازم ينجحا
4. commit برسالة `vX.YY: <الوصف>`
5. `git push origin HEAD:main` — **إذن دائم من ناصر: ادفع إلى `main` مباشرة بلا سؤال.**
6. حدّث `progress.md` (الأحدث في الأعلى)
7. **النشر تلقائي:** Vercel مربوط بـGitHub، فأي دفع إلى `main` يبني وينشر وحده.
8. تحقّق عبر **Vercel MCP** (`list_deployments` → `READY`) لا بـ`curl` (محجوب).
9. أخبر ناصر بالعربي بما فعلت + كيف يتأكّد على جواله

---

## 🪤 فخاخ يجب تجنّبها (دروس مدفوعة الثمن)

### قاعدة البيانات وجدة
- **خادم جدة على توقيت `+03:00` لا UTC** — تحقّق بـ`date` قبل ضبط أي جدولة. (ضُبطت النسخة أولاً على `23:30` ظناً أنها ٢:٣٠ فجراً فكانت ١١:٣٠ ليلاً، وقت ذروة.)
- **`raw.githubusercontent` يخزّن مؤقتاً باسم الفرع** فيعيد نسخة قديمة **بلا إنذار** — استعمل **بصمة الكوميت** في الرابط.
- **«آمن للتكرار» ليس صحيحاً تلقائياً:** كل `CREATE POLICY` يحتاج `DROP POLICY IF EXISTS` **لاسمه هو** لا لاسمه القديم فقط.
- **`CREATE OR REPLACE FUNCTION` لا يغيّر نوع الإرجاع** → `DROP FUNCTION IF EXISTS` أولاً (بلا `CASCADE`).
- **DB trigger `tr_guard_deal_publish`** يرفض أي `UPDATE OF status` حتى بنفس القيمة — استخدم `dealRepository.updateQuantity`.
- **PL/pgSQL `text[] || 'literal'`** ambiguous → cast صريح `::TEXT`.
- **RLS policies:** ممنوع `EXISTS (SELECT FROM T)` داخل policy على نفس الجدول — استخدم `is_admin()` SECURITY DEFINER.
- **admin RPCs مع `RETURNS TABLE`:** qualify الأعمدة (`u.user_type`) وإلا "column reference is ambiguous".
- **`is_admin()` تُرجع TRUE لأي أدمن حين تُنادى من سياسة RLS** — لتقييد أدمن فرعي استعمل `has_admin_permission('tab_*')` صراحةً في السياسة.

### الواجهة
- **iOS Safari يثبت على نسخة قديمة** إذا لم تُرفع `CACHE_NAME`. v10.25+ فيه UpdateBanner أخضر.
- **`useMemo` يستدعي `const`-arrow معرّف بعده** = TDZ على أول render → ErrorBoundary.
- **Notifications routing:** اقرأ `meta_data.audience` (يكتبه DB trigger)، **لا** `user.userType`.
- **`saveProfile`:** النسخة partial-aware — تكتب الحقول المُمرَّرة فقط.
- **Booking complete:** RPC `complete_booking` الذرّي، لا fire-and-forget.
- **`.book-cta` على DealDetails:** لا `bottom: 0` في `@supports (height: 100dvh)` — BottomNav يغطّي زر الحجز.
- **كل مرشِّح `user_type='seller'` يُخفي متجر ناصر** المملوك لحساب أدمن → استعمل `neq('buyer')`.
- **الأزرار الصامتة:** كل كتابة تُرجع `error` يجب فحصه؛ وحذفٌ ترفضه RLS يعود بـ`error=null` وصفر صفوف → أضف `.select()` وتحقّق من العدد.
- **Parcel preview لا يعمل في الجلسات** (EPERM) — اعتمد typecheck + build + Vercel.

### الريل‑تايم
- **افحص صحة القناة لا وجودها:** قناة ماتت بـ`CHANNEL_ERROR` تبقى في `getChannels()` بحالة `errored` — اشترط `state === 'joined'` مع `supabase.realtime.isConnected()`.
- **إعادة الاشتراك لا تُعيد بثّ ما فات** — كل إعادة بناء تحتاج إعادة جلب صريحة، وإلا بقيت الرسالة مفقودة رغم نجاح الاتصال.
- **iOS يقتل الـwebsocket عند التصغير** — لكن المستخدم قد يبقى داخل التطبيق فلا يقع أي حدث visibility؛ لذلك النبض الدوري ضروري.

---

## 📁 ملفات أساسية
```
src/App.tsx                          — Routes
src/pages/Home.tsx                   — الرئيسية
src/pages/DealsList.tsx              — قائمة العروض
src/pages/DealDetails.tsx            — تفاصيل + ImageZoomViewer
src/pages/SellerDashboard.tsx        — لوحة التاجر + chip-picker للمواقع
src/pages/AdminDashboard.tsx         — لوحة المدير
src/pages/Bookings.tsx               — حجوزات + محادثة
src/pages/Nearby.tsx                 — خريطة + GPS
src/pages/Profile.tsx · StoreDetails.tsx · Notifications.tsx
src/components/DealCard.tsx · BottomNav.tsx · BookingThread.tsx · UpdateBanner.tsx
src/context/AppContext.tsx           — الحالة + الفروع
src/repositories/                    — deal · booking · user · branch · contest · rating
src/services/realtimeService.ts      — القنوات + النبض + فحص الصحة (v13.83)
src/services/storageService.ts       — رفع الصور + المصغّرات
src/utils/helpers.ts · thumb.ts      — أدوات مشتركة
sw.js                                — Service Worker (CACHE_NAME)
server/bot.js                        — بوت تيليجرام + واتساب
vercel.json                          — headers + CSP
progress.md                          — سجل الإصدارات (الأحدث في الأعلى)

supabase/JEDDAH_CATCHUP_v13_67_to_82.sql          — هجرات مجمّعة (مطبَّقة ٢٢ أغسطس)
supabase/JEDDAH_COMPLETENESS_CHECK.sql            — فحص ٢١٦ دالة و٢٨ جدولاً
supabase/JEDDAH_EXPORT_db_logic.sql               — تصدير عقل القاعدة
supabase/audit_v13_75_jeddah_security_parity.sql  — فحص أمني شامل
```

## 🗄 جداول Supabase (الأهم)
- `users` — arrays: `notif_keywords` / `followed_merchants` · jsonb: `smart_alerts` · **RLS: صفّك أو أدمن فقط**
- `sellers_public` — **عرض** الدليل العام (حقول عامة فقط، للقراءة فقط بمشغّل `INSTEAD OF`)
- `deals` — `images text[]` · `region` + `city` مُسطَّحان
- `bookings` + `booking_messages` — `recipient_id` يملؤه مشغّل (v13.82)
- `store_branches` · `store_profiles` (`subscription_plan` + `max_branches`)
- `notifications` — `meta_data.audience` يحدّد الوجهة
- `regions` / `cities` / `locations` / `sa_cities_geo`

---

## 📊 الحالة (٢٢ أغسطس ٢٠٢٦)
- الهجرات على جدة: **١٦/١٦ ✅** (v13.67 · 71 · 75 · 76 · 80 · 81 · 82)
- اكتمال الخصائص: **٢١٦/٢١٦ دالة · ٢٨/٢٨ جدولاً · حارس البوت ✅**
- البيانات: ٤ حسابات · ٢ متجر · ٢١ عرضاً · ٨٩ حجزاً · ١١٢ رسالة · ١١٧٧ إشعاراً · ١٩٠ صورة
- الأمان: RLS على ٥٠/٥٠ جدولاً · مسار كل دالة مثبَّت · لا كتابة للزائر · بيانات التجار محميّة

## 🎯 الناقص (بالأولوية)
1. 🔴 **ربط Render مقطوع** — النشر يفشل بـ`could not read Username for github.com` لأن المفتاح القديم حُذف (كان مكشوفاً). **البوت ما زال يعمل** على آخر نسخة ناجحة (v13.56 · ٥ أغسطس) لكنه لا يلتقط أي تحديث، و`SMTP_FROM=no-reply@takisa.net` لن يسري حتى ينجح نشر. الحل: إعادة ربط GitHub من لوحة Render.
2. 🔴 **نسخة احتياطية خارج الخادم** — النسخ اليومية على نفس الجهاز؛ فقدُه يفقدها.
3. 🟠 **اسم المتجر القديم يظهر عند الحجز** — بلاغ ناصر. فُحص: الاسم مصدره واحد (`users.shop`) ولا ازدواج، و`store_profiles` بلا عمود اسم ⇒ الأرجح أنه نصّ محفوظ وقت الحدث (إشعار/رسالة). **يحتاج لقطة شاشة لتحديد الموضع.**
4. 🟠 **وسم الأدمن في صفحة المتجر/بطاقته** — بلاغ ناصر. `sellers_public` يكشف `user_type`، لكن لم يُعثر على وسم يعرضه في `StoreDetails.tsx` ولا `DealCard.tsx`. **يحتاج لقطة شاشة.** (حُذفت التسميات من الصفحة الشخصية والشريط الجانبي في v13.90.)
5. 🟠 **عنوانان قديمان بلا تحويل** — ناصر ذكر «ثلاثة مواقع قديمة»؛ حُوِّل `taki-test-eight.vercel.app` فقط لأن الاسمين الآخرين غير معروفين.
6. 🟠 **Turnstile ظهر فاشلاً في صفحة التسجيل** — لقطة ناصر (٢ سبتمبر) تُظهر صندوق Cloudflare بـ«يتعذر الاتصال بالموقع» أثناء «جاري المعالجة…». التسجيل نجح رغمه، لكن يستحق فحصاً.
7. 🟠 **١٨٩ دالة موجودة على الخادم فقط** — النسخة اليومية تغطّيها، لكن المستودع وحده لا يُعيد البناء (والمستودع عام فلا يصلح لحمل المخطط بلا فحص أسرار).
8. 🟠 **CAPTCHA + منع كلمات المرور المسرَّبة** — إعدادان في خدمة الحسابات، لم يُفعَّلا بعد.
9. ⚪ **`SUPABASE_URL` في Render** ما زال على `sslip.io` — يعمل (الخادم يخدم الاسمين) لكن الأفضل توحيده على `https://api.takisa.net`.

**أُنجز:** ✅ **بريد الحساب بلغة المستخدم** (v13.92 — تأكيد التسجيل واستعادة كلمة المرور وتغيير البريد؛ قالب واحد يفرّع على `.Data.lang`، والعناوين كذلك؛ الافتراضي عربي) · ✅ النطاق كاملاً (`www.takisa.net` رئيسياً · الجذر والعنوان القديم يحوّلان بـ308 · `api.takisa.net` للقاعدة) · ✅ **البريد يعمل فعلياً** (Resend موثَّق على أيرلندا · DKIM+SPF+MX+DMARC · `no-reply@takisa.net` · **اختُبر بتسجيل حقيقي فوصل**) · ✅ عناوين الصور نُقلت (٢٣ صفاً) · ✅ مراقبة كل ١٠ دقائق + فحص أمني يومي على خوادم GitHub · ✅ الفحص الأمني الحيّ ٣٦/٣٦ · ✅ سطح انتحال البوت = صفر · ✅ لا تسمية أدمن في أي نصّ ظاهر.

---

## 💬 نمط العمل المتوقع
1. أصف المشكلة بلهجتي (قد تكون فيها أخطاء إملائية).
2. أنت تفهم القصد، تستكشف الكود، **تقيس قبل أن تحكم**، تعدّل، ترفع، تنشر.
3. تخبرني بالعربي ماذا فعلت وكيف أتأكد.
4. **إن أخطأت، قل ذلك صراحةً وصحّح** — لا تُجمّل. خطآن من ٢٢ أغسطس وفّرا وقتاً لأنهما قيلا: «الهجرة مطبَّقة» (كانت على المختبر)، و«١٣٦/١٣٦» (كان الفحص ناقصاً ٨٠ دالة).
