# TAKI — برومت Claude (يتحمّل تلقائياً كل جلسة)

## 👤 من أنا
أنا **ناصر**، مالك TAKI (منصة حجز التخفيضات في السعودية). **لست مبرمجاً** — لا أفهم الكود ولا الأوامر.

## ⚠️ أوامري الثابتة (لا تتغير)
- نفّذ كل شيء بنفسك. **لا تطلب مني تشغيل أوامر تقنية**.
- ردّ بالعربي دائماً. وقل لي ماذا أفعل بالضبط (افتح هذا الرابط، اضغط هذا الزر).
- دقة عالية + احترافية + أحدث التقنيات + شكل عصري.
- **بدون دين برمجي** (no tech debt) + أحدث معايير الأمان ضد الاختراقات.

## 🏗 البنية التقنية
- React 18 + Parcel 2 + TypeScript + Supabase + Vercel
- المسار المحلي: `/Users/nasser/Desktop/TAKI`
- Repo: `https://github.com/nas10ser/Taki-Phase-Two` (فرع `main`)
- Supabase MCP متصل — Project: `kbmqzxcjdankdgiovctm`
- الإنتاج: `https://taki-test-eight.vercel.app`
- Vercel: `nasser-projects1/taki-test` (مفوّض كـ `nalaumari-8916`، Env vars مشفّرة)
- **الإصدار الحالي: v11.72** (آخر إصدار في `progress.md` — الأحدث في الأعلى)

## 🔄 آلية التنفيذ الكاملة (كل تعديل)
1. عدّل الكود في الـworktree الحالي
2. ارفع `CACHE_NAME` في `sw.js` (مثل `taki-cache-vXX.YY`) — إلزامي لكل deploy
3. `npm run typecheck` — لازم ينجح
4. commit برسالة `vX.YY: <الوصف>`
5. `git push origin HEAD:main`
6. مزامنة المجلد المحلي: `git -C /Users/nasser/Desktop/TAKI pull origin main`
7. حدّث `progress.md` (الأحدث في الأعلى)
8. نشر إنتاج: `cd ~/Desktop/TAKI && npx vercel deploy --prod --archive=tgz`
9. تحقّق: `curl -s https://taki-test-eight.vercel.app/sw.js | grep -oE 'taki-cache-v[0-9.]+'`
10. أخبرني بالعربي بما فعلت + كيف أتأكد

## 🪤 فخاخ يجب تجنّبها (Hard-won lessons)
- **`--archive=tgz` إلزامي** في Vercel deploy — بدونه يفشل بـ`api-upload-free quota`.
- **iOS Safari يثبت على نسخة قديمة** إذا ما رفعت `CACHE_NAME` في sw.js. v10.25+ فيه UpdateBanner أخضر داخل التطبيق.
- **DB trigger `tr_guard_deal_publish`** يرفض أي UPDATE OF status حتى بنفس القيمة — استخدم `dealRepository.updateQuantity` للتحديثات الجزئية.
- **PL/pgSQL `text[] || 'literal'`** ambiguous → cast صريح `::TEXT` (v10.60 ضحّى بـsave-deal كاملاً قبل ما أصلحه).
- **RLS policies** ممنوع `EXISTS (SELECT FROM T)` داخل policy على نفس الجدول — استخدم `is_admin()` SECURITY DEFINER.
- **admin RPCs مع `RETURNS TABLE`**: qualify الأعمدة (مثل `u.user_type`) وإلا "column reference is ambiguous".
- **`useMemo` يستدعي `const`-arrow معرّف بعده** = TDZ على أول render → ErrorBoundary (v10.61 hotfix). تحقّق ترتيب التعريفات لما تضيف useMemo.
- **Notifications routing**: اقرأ `meta_data.audience` (DB trigger يكتبه)، **لا** `user.userType`.
- **`saveProfile`**: استخدم النسخة partial-aware (v10.25) — تكتب فقط الحقول المُمرّرة.
- **Booking complete**: استخدم RPC `complete_booking` (v10.20) atomic، لا fire-and-forget.
- **Realtime على iOS Safari**: v10.22 خفّض threshold الـresync لـ1s + pageshow handler.
- **`.book-cta` على DealDetails**: لا تُعد `bottom: 0` في `@supports (height: 100dvh)` — BottomNav يغطّي زر الحجز (v10.58 fix).
- **Parcel preview**: لا يشتغل في sandbox (EPERM) — اعتمد على typecheck + Vercel preview.
- **Worktree ≠ المجلد المحلي ≠ الإنتاج**: لازم commit → push → pull → deploy.

## 📁 ملفات أساسية
```
src/App.tsx                          — Routes
src/pages/Home.tsx                   — الرئيسية
src/pages/DealsList.tsx              — قائمة العروض
src/pages/DealDetails.tsx            — تفاصيل + ImageZoomViewer (swipe v10.60)
src/pages/SellerDashboard.tsx        — لوحة التاجر + chip-picker لـbranches
src/pages/AdminDashboard.tsx         — لوحة المدير
src/pages/Notifications.tsx          — التنقل عبر meta_data.audience
src/pages/Bookings.tsx               — حجوزات + chat
src/pages/Nearby.tsx                 — خريطة + GPS
src/pages/Profile.tsx                — حسابي + تنبيهات ذكية
src/pages/StoreDetails.tsx           — صفحة المتجر
src/components/DealCard.tsx          — كرت 1:1
src/components/Navbar.tsx
src/components/BottomNav.tsx         — البار السفلي (v10.32)
src/components/BookingThread.tsx     — chat المشتري ↔ التاجر (3+3)
src/components/UpdateBanner.tsx      — banner تحديث داخل التطبيق
src/components/PullToRefresh.tsx     — Home + Bookings فقط
src/components/ImageCropEditor.tsx   — Crop حرّ بزوايا قابلة للسحب (v10.62)
src/context/AppContext.tsx           — state + branches + saveBranch/removeBranch
src/repositories/dealRepository.ts
src/repositories/bookingRepository.ts
src/repositories/userRepository.ts   — partial-aware saveProfile
src/repositories/branchRepository.ts — store_branches (list/upsert/remove) v10.59
src/services/realtimeService.ts      — 3 channels + heartbeat + bfcache
src/sw-cleanup.ts                    — applySwUpdate
src/utils/helpers.ts                 — resolveDealLocation + dealMatchesLocation
src/data/mock.ts                     — REGIONS/CITIES/LOCATIONS
sw.js                                — Service Worker (CACHE_NAME)
server/bot.js                        — Telegram + WhatsApp bot
vercel.json                          — headers + CSP + Permissions-Policy
.vercelignore                        — يستثني node_modules/cache
progress.md                          — سجل الإصدارات (الأحدث في الأعلى)
```

## 🗄 جداول مستخدمة في Supabase (الأهم)
- `users` — حقول array: `notif_keywords` / `followed_merchants`، حقل jsonb: `smart_alerts`
- `deals` — `images text[]`, denormalized `region` + `city`
- `bookings` + `booking_messages` — للحجز و chat
- `store_branches` — لوكيشنات التاجر المحفوظة (v10.59 — RLS: own merchant_id)
- `notifications` — `meta_data.audience` يحدّد الـrouting
- `store_profiles` — `subscription_plan` + `max_branches`
- `regions` / `cities` / `locations` / `sa_cities_geo` — جغرافيا السعودية

## 💬 نمط العمل المتوقع
1. أصف المشكلة بلهجتي (قد تكون فيها أخطاء إملائية).
2. أنت تفهم القصد، تستكشف الكود، تعدّل، تحفظ، ترفع، تنشر.
3. تخبرني بالعربي ماذا فعلت وكيف أتأكد.
4. لا تطلب مني أوامر تقنية إلا للضرورة القصوى.
