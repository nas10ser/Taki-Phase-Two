# برومت الانتقال للجلسة القادمة — TAKI

> انسخ ما بين الخطوط والصق في بداية أي محادثة جديدة مع Claude/أي مساعد ذكي. سيفهم المشروع فوراً ويبدأ العمل بدون أن أعيد شرح كل شيء.

---

```
أنا ناصر، مالك مشروع TAKI (منصة حجز التخفيضات في السعودية).

⚠️ معلومة مهمة عني: لست مبرمجاً. لا أفهم الكود ولا الأوامر. مهمتك أنت
أن تنفذ كل شيء بنفسك دون أن تطلب مني تشغيل أوامر. ترجم كل شي بالعربي
وقل لي بالضبط شو أفعل (مثلاً: افتح هذا الرابط، اضغط هذا الزر).

═══════════════════════════════════════════════════════════
البنية التقنية
═══════════════════════════════════════════════════════════

• المشروع: React 18 + Parcel 2 + Supabase + TypeScript
• المسار الرئيسي: /Users/nasser/Desktop/TAKI
• الـrepo: https://github.com/nas10ser/Taki-Phase-Two (فرع main)
• الإصدار الحالي: v10.11 (2026-05-10)
• اللغة: العربية RTL (الواجهة) + إنجليزي اختياري
• قاعدة البيانات: Supabase production (فيها MCP متصل: supabase__*)
  - Project ID: kbmqzxcjdankdgiovctm
  - URL: https://kbmqzxcjdankdgiovctm.supabase.co

✅ النشر: التطبيق منشور على Vercel
  https://taki-test-eight.vercel.app (production)
  Vercel project: nasser-projects1/taki-test
  CLI authenticated as: nalaumari-8916 (npx vercel whoami)
  Env vars (مشفّرة على Vercel): SUPABASE_URL + SUPABASE_ANON_KEY

  لإعادة النشر بعد أي تعديل:
    cd ~/Desktop/TAKI && npx vercel deploy --prod --archive=tgz
  
  ⚠️ لازم --archive=tgz لتجنب 5000-files/day quota على الـHobby plan.
     .vercelignore يستثني node_modules/.parcel-cache/.git/.claude.

═══════════════════════════════════════════════════════════
كيف أشغّل التطبيق وأفتحه على الجوال
═══════════════════════════════════════════════════════════

1. على الـMac (Terminal):
   $ cd ~/Desktop/TAKI
   $ npm start
   → يطبع: Server running at http://0.0.0.0:3000

2. على الجوال أحتاج رابط بشكل http://<IP-المحلي>:3000/
   الـIP يتغيّر مع كل تغيير لشبكة Wi-Fi.
   لجلب الـIP الحالي تلقائياً، شغّل:
   $ ipconfig getifaddr en0

3. شرط: الجوال + الـMac على نفس الشبكة (لا يصير الـMac على
   هوت سبوت الآيفون نفسه اللي تختبر منه).

═══════════════════════════════════════════════════════════
آلية الـworktrees (مهمة جداً!)
═══════════════════════════════════════════════════════════

الـrepo يستخدم git worktrees. هذا الكلود يعمل عادةً في:
   /Users/nasser/Desktop/TAKI/.claude/worktrees/<اسم-عشوائي>/

⚠️ هذا منفصل عن المجلد الرئيسي اللي يشغّل npm start فيه!
أي تعديل في الـworktree لا يظهر للمستخدم محلياً ما لم:
   1. تعمل commit في الـworktree
   2. تعمل push origin HEAD:main
   3. تنتقل لـ ~/Desktop/TAKI وتعمل git pull origin main

أوامر مفيدة:
   git -C /Users/nasser/Desktop/TAKI status
   git -C /Users/nasser/Desktop/TAKI pull origin main

═══════════════════════════════════════════════════════════
نمط العمل المتوقع
═══════════════════════════════════════════════════════════

1. أنا أصف المشكلة بلهجتي العادية (قد تكون فيها أخطاء إملائية)
2. أنت تفهم القصد، تستكشف الكود بنفسك، تعدّل، تحفظ، ترفع
3. تخبرني بالعربي ماذا فعلت وكيف أتأكد
4. لا تطلب مني أوامر تقنية إلا للضرورة القصوى
5. التزم بالخطوات: typecheck → commit → push → sync ~/Desktop/TAKI
6. حدّث progress.md عند كل إصدار جديد (الإصدار الأخير في الأعلى)

═══════════════════════════════════════════════════════════
الفخاخ الشائعة (راعها!)
═══════════════════════════════════════════════════════════

✗ Service Worker cache loop:
  بعد v10.1 الـSW يمسح كاشه تلقائياً، لكن أول مرة يلزم أمسحه يدوياً
  (Settings → Safari → Clear History) أو Cmd+Shift+R على الديسكتوب.

✗ تحديث ملف في الـworktree ≠ تحديث محلي:
  لازم push + pull للمجلد الرئيسي. شوف القسم أعلاه.

✗ Trigger DB يرفض UPSERT شامل لجدول deals:
  trigger tr_guard_deal_publish يطلق عند أي UPDATE يلمس status
  حتى لو القيمة لم تتغير. لذلك دالة dealRepository.save (upsert كامل)
  تفشل لو اشتراك التاجر متوقف. الحل: استخدم
  dealRepository.updateQuantity للتحديثات الجزئية للكمية.

✗ Parcel preview لا يشتغل في sandbox:
  لما يحاول preview_start، الـsandbox يرفض بـEPERM. لا تحاول مراراً.
  اعتمد على typecheck + اطلب من ناصر يجرّب على جواله.

✗ الـIP المحلي يتغيّر مع الواي فاي:
  لا تفترض أن http://192.168... ثابت. اجلبه من ipconfig.

✗ Vercel deploy فشل بـapi-upload-free:
  أول نشر بدون .vercelignore رفع 297MB (node_modules + cache + .git)
  وتجاوز 5000-files/day quota → lockout 24h. الحل دائماً:
  - تأكد .vercelignore موجود في root
  - استخدم --archive=tgz في كل deploy

✗ admin_search_users column ambiguous:
  دالة admin_search_users بترجع TABLE فيها user_type. لو سويت
  SELECT user_type INTO … بدون qualifier يطلق "column reference is
  ambiguous". دائماً استخدم u.user_type أو table aliases.

✗ notifications routing عبر user.userType غلط:
  مستخدم واحد قد يكون admin + seller (نفس الحساب). routing
  Notifications.tsx يقرأ meta_data.audience (مكتوبة بـDB trigger
  handle_booking_notification منذ migration tag_booking_notifications_with_audience).

═══════════════════════════════════════════════════════════
الملفات الأكثر استخداماً
═══════════════════════════════════════════════════════════

src/App.tsx                    — Routes (BrowserRouter + lazy)
src/pages/Home.tsx             — الرئيسية + قسم الأكثر تداولاً + كل العروض
src/pages/DealsList.tsx        — صفحة العرض الكامل (شكل Trendyol)
src/pages/DealDetails.tsx      — صفحة منتج + حجز
src/pages/SellerDashboard.tsx  — لوحة التاجر (form/products/orders/scanner)
src/pages/AdminDashboard.tsx   — لوحة المدير
src/components/DealCard.tsx    — كرت المنتج (5:6 aspect)
src/components/Navbar.tsx      — الشريط العلوي
src/components/BottomNav.tsx   — التنقل السفلي
src/context/AppContext.tsx     — كل state التطبيق + bookDeal/updateDealStock
src/repositories/dealRepository.ts — Supabase deals (save/updateQuantity)
src/services/...               — auth, push, validation, إلخ
sw.js                          — Service Worker (network-first navigations)
server/bot.js                  — Telegram + WhatsApp Cloud API bot
supabase/migration_v*.sql      — كل migrations (سجل تاريخي)
progress.md                    — سجل الإصدارات بالعربي (مهم: حدّثه)

═══════════════════════════════════════════════════════════
أوامر بدء سريع
═══════════════════════════════════════════════════════════

# 1. تأكد من البنية
git -C /Users/nasser/Desktop/TAKI status
git status   # في الـworktree الحالي

# 2. typecheck قبل أي commit
npm run typecheck

# 3. commit + push + sync
git add <files>
git commit -m "v10.X: <الوصف>"
git push origin HEAD:main
git -C /Users/nasser/Desktop/TAKI pull origin main

# 4. اعرض الـIP لناصر يفتح من جواله
ipconfig getifaddr en0
# → http://<IP>:3000/

# 5. نشر إنتاج على Vercel (بعد تغييرات معتمدة)
cd ~/Desktop/TAKI
npx vercel deploy --prod --archive=tgz
# → https://taki-test-eight.vercel.app

═══════════════════════════════════════════════════════════
سجل الإصدارات الأخيرة (للسياق)
═══════════════════════════════════════════════════════════

v10.11 — تتبع المشاهدات (DB columns + RPCs ناقصة) + 🚀 Vercel deploy
v10.10 — admin notif يفتح بطاقة الطلب + توسيع التذكرة للمشتري
v10.9 — routing الإشعارات يعتمد على meta_data.audience (مو userType)
v10.8 — إزالة UA grey paint من الأزرار (color-scheme: dark كان يفسد التابات)
v10.7 — notification deep-link + merchant_note عمود منفصل + dark contrast
v10.6 — تخفيف العناصر السوداء + زر تأكيد أخضر + إطار التذكرة برتقالي
v10.5 — كرت 1:1 + .taki-deals-grid (2 جوال / 4-5 ديسكتوب)
v10.4 — ٦ إصلاحات لوحة الإدارة (بانر upload، trial-new-only، search RPC)
v10.0 — تجاوب جوال شامل + DealsList + Bot v7
v10.1 — كسر cache loop للـSW
v10.2 — استعادة WIP (live countdown + label htmlFor)
v10.3 — إصلاح SUBSCRIPTION_REQUIRED للحجز + city filter + كثافة الكروت

═══════════════════════════════════════════════════════════
طلبي الحالي
═══════════════════════════════════════════════════════════

[اكتب هنا ما تريد فعله في هذه الجلسة]
```

---

## كيف تستخدم هذا البرومت

1. افتح جلسة جديدة مع Claude (أو أي مساعد ذكاء اصطناعي مع وصول ملفات)
2. انسخ كل شي بين الـ\`\`\`
3. الصقه في بداية الرسالة
4. اكتب طلبك في آخر سطر بعد "[اكتب هنا]"
5. أرسل

سيفهم المساعد كل السياق فوراً ويبدأ العمل دون أن يكرر السؤال عن البنية.
