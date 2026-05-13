# TAKI — سجل الإصدارات 📊

> منصة حجز التخفيضات في السعودية. React 18 + Parcel + Supabase + Vercel.
> المالك: ناصر (غير مبرمج — كل التنفيذ يتم من جهة Claude).

## 📌 قواعد ثابتة (لا تتغير)

- **CACHE_NAME في sw.js يجب رفعه كل deploy** (`taki-cache-vXX.YY`) — وإلا iOS Safari يبقى على نسخة قديمة.
- **dealRepository.updateQuantity** للتحديثات الجزئية على deals (الـtrigger `tr_guard_deal_publish` يرفض UPDATE OF status بصمت).
- **notification routing** يقرأ `meta_data.audience` (DB trigger يكتبه)، لا `user.userType`.
- **admin RPCs** بـ`RETURNS TABLE` تحتاج تأهيل (qualify) للأعمدة المتداخلة مع DB columns.
- **Vercel deploy**: `cd ~/Desktop/TAKI && npx vercel deploy --prod --archive=tgz` — `--archive=tgz` إلزامي.
- **Worktree flow**: تعديل في worktree → commit → `git push origin HEAD:main` → `git -C ~/Desktop/TAKI pull origin main` → vercel deploy.

---

## 🗂 backlog (مهام مؤجلة)

- **آلية اشتراك "باقة أعلى" للسماح بأكثر من 3 لوكيشنات** (تم تحديد القاعدة في v10.42): الباقة الأساسية = 3 مواقع فريدة كحد أقصى للمنتجات النشطة. للمزيد لازم باقة مدفوعة. **ناصر سيحدد لاحقاً**: السعر، الفئات (5/10/∞)، نموذج الدفع، وكيف يُعرض الـupsell. الكود الحالي يرفض الإضافة في موقع 4+ مع رسالة "الترقية قريباً"، وزر "إدارة الاشتراك" يفتح `/subscription`.

---

## 🗓 سجل v10.x

| إصدار | الموضوع |
|--------|---------|
| **v10.51** | **تحصين أمني شامل** بعد تنبيه Supabase advisor (143 ثغرة). أهم الإصلاحات: (١) **ERROR حرج**: `sa_cities_geo` كان RLS مغلق — أي anon يقدر يحذف 73 صف مدن السعودية ويعطّل `find_nearest_sa_city`. تم enable RLS + قراءة عامة + كتابة admin-only. (٢) **booking_messages_update_recipient** كانت `WITH CHECK = true` — الطرف المستلم يقدر يعيد كتابة sender_role/content/barcode لأي رسالة! حُذفت كلياً (الـRPC `mark_booking_messages_read` SECURITY DEFINER هو الكاتب الوحيد). (٣) **store_analytics_events.an_insert_anyone** سمحت لـanon بحقن أحداث analytics — حُذفت (كل الكتابات تمر عبر RPCs SECURITY DEFINER). (٤) **storage 'deals'** كان أي anon يقدر يرفع أي ملف بأي حجم — قيّدتها لـauthenticated + صور فقط (JPEG/PNG/WebP/GIF) + سقف 10MB + منع الـlisting، مع الحفاظ على CDN reads. (٥) **16 function بـsearch_path قابل للتغيير** (vector لـsearch_path injection) — pin `SET search_path = 'public'`. (٦) **6 functions cron-only بدون admin check** (`purge_expired_accounts`, `expire_trials`, `cleanup_old_activity`, `prune_analytics_events`, `send_trial_ending_notifications`, `send_trial_warnings`) — أي مستخدم authenticated كان يقدر يستدعيها ويحذف الحسابات أو يفرض انتهاء الفترات التجريبية! `REVOKE EXECUTE FROM anon, authenticated, PUBLIC`. الـ7 admin_* functions تركت لأنها فعلاً تحقق `user_type='admin'` داخلياً. **النتيجة:** 143 → 111 (-32)، 1 ERROR → **0**، 16 search_path → 0، 2 always-true RLS → 0، 1 bucket listing → 0. المتبقي 110 SECURITY DEFINER warnings مقصودة (RPCs للـclient كلها فيها admin checks داخلية) + 1 تحتاج Dashboard (تفعيل Leaked Password Protection). ملف الـmigration: `supabase/migration_v10_51_security_hardening.sql`. |
| **v10.50** | إصلاح ٣ مشاكل في صفحة إنشاء الحساب الجديد. (١) **Database error saving new user** عند كل محاولة تسجيل: السبب trigger `handle_new_seller_trial` كان يحاول `UPDATE users SET trial_starts_at, trial_ends_at` لكن الأعمدة **غير موجودة** في `public.users` — كل صف auth.users جديد كان يفشل بـ `SQLSTATE 42703`. الإصلاح: حذف الـUPDATE المُكرّر (التعليق نفسه يقول "redundant trial tracking"؛ `store_profiles.subscription_started_at/expires_at` هي المصدر الموثوق). (٢) **ألوان غامقة على خلفية غامقة** في checklist قوة كلمة المرور — `var(--accent)` يحُل لـ`#1e293b` (slate-800 شبه أسود) على gradient navy فأصبح غير مقروء. الإصلاح: استبدال صريح بألوان فاتحة (`#10b981` للمحقّق، `#94a3b8` لغير المحقّق) في الـchecklist وفي شاشة verify أيضاً (الإيميل + رسالة "افتح بريدك"). (٣) **حذف حقل "موقع المتجر (المدينة/الحي)"** من نموذج تسجيل التاجر — موقع المتجر الفعلي يُحدد لاحقاً من داخل التطبيق عبر اللوكيشن (نظام v10.42-v10.46 للوكيشنات الثلاث). أُستبدِل بسطر توضيحي صغير "📍 سيتم تحديد موقع المتجر لاحقاً من داخل التطبيق". |
| **v10.49** | "معاينة كمشتري" في حساب الأدمن صارت فعلياً تدخّله كمشتري. كان الأدمن لمّا يضغط 🛒 مشتري من الشريط الجانبي، يروح للصفحة الرئيسية بس الـBottomNav يظل بشريط التاجر (لوحتي/صفحتي) وصفحة "حسابي" تعرض شارة "مدير النظام 👑" وقسم بيانات المتجر. السبب: `BottomNav` كان يقرأ `user.userType === 'admin'` مباشرة (يتجاهل `effectiveUserType`)، وصفحة Profile كذلك. الإصلاح: (١) `BottomNav.tsx` صار يعتمد فقط على `effectiveUserType` — `showSellerNav = (effectiveUserType === 'seller' \|\| 'admin')`. (٢) `Profile.tsx` صار يقرأ `effectiveUserType` لكل فروع العرض (اسم/شارة الدور، الإحصائيات بائع/مشتري، قسم "معلومات التواصل للمتجر"). نتيجة: الأدمن في وضع معاينة كمشتري يشوف شريط المشتري كاملاً (الرئيسية/الإشعارات/حولي/حجوزاتي/حسابي) + شارة "مشتري ⭐" + إحصائيات التوفير، تماماً مثل ما يصير لمّا يضغط معاينة كتاجر. |
| **v10.48** | ثلاث مشاكل في نموذج إضافة العرض على الجوال: (١) **الخريطة لا تتحرك** بعد لصق رابط قوقل ماب رغم استجابة فلتر المنطقة/المدينة. السبب: `MapCenterUpdater` كان يستدعي `setView` بـ`animate:true, duration:0.4` داخل `setTimeout(0)` — على iOS Safari عند فتح modal نجاح فوق الخريطة، `invalidateSize()` يقيس tile-grid بصفر ارتفاع فينقطع الـpan. الإصلاح: pan فوري بـ`animate:false` ثم إعادة `invalidateSize+setView` بعد 300ms كـsafety net، كله داخل try/catch. (٢) **زر "حفظ كموقع دائم للمتجر" يعلّق spinner** للأبد. السبب: `await updateProfile()` بدون أي سقف زمني — لو الـSupabase auth-refresh عالق في الـinTabLock، الـawait ينتظر للأبد. الإصلاح: `withTimeout(updateProfile(...), 15000)` + رسالة "⏱️ تأخر الحفظ، تأكد من اتصال الإنترنت" عند تجاوز السقف. (٣) **نفس المشكلة في "حفظ وإضافة العرض" و"إضافة وتكرار"** — `withTimeout(addDeal/updateDeal, 20000)` + رسالة timeout واضحة. الـhelper `withTimeout` + `TimeoutError` مضافين في `utils/helpers.ts` لإعادة الاستخدام. |
| **v10.47** | **DB-first فعلياً** — إزالة أي تخزين تطبيقي محلي. (١) `addDeal` و `updateDeal` ينتظران الـDB قبل أي تحديث على الـUI (لا optimistic update). إذا الـDB رفض → رسالة فشل واضحة + لا يظهر شيء في الواجهة. (٢) إزالة رسالة "تم الحفظ محلياً لكن المزامنة فشلت" نهائياً — رسالة كاذبة لأنه لا يُحفظ شيء فعلياً عند فشل الـDB. (٣) إزالة `TAKI_LAST_PROMO_*` من localStorage — الـDB column `users.last_promo_check_at` هو المصدر الوحيد للـthrottle. (٤) إزالة `TAKI_LAST_PATH` من localStorage في App.tsx — المسار بعد تسجيل الدخول يُحدد من `user.userType` فقط. (٥) إزالة `TAKI_SEASONAL_NOTIFY` — جدول `push_subscriptions` هو الـopt-in الحقيقي. **يبقى ضرورة تقنية:** Supabase auth tokens (لا يمكن إزالتها) و SW versioning. |
| **v10.46** | فرض حد 3 لوكيشنات على مستوى **قاعدة البيانات** (كان client-only). trigger جديد `tr_enforce_location_cap` على deals يطلق BEFORE INSERT/UPDATE OF (status, location_id, map_lat, map_lng) — يحسب الـlocKey بنفس طريقة الـclient (loc:<id> أو geo:<lat>,<lng> مدور 3 منازل) ويرفض بـ `LOCATION_LIMIT_EXCEEDED` إذا تجاوز. admin يتجاوز. status≠active لا يخضع. `addDeal` و `updateDeal` في AppContext يكشفان الـerror code ويعرضان رسالة عربية محددة (بدل "تم الحفظ محلياً لكن المزامنة فشلت"). ملف migration: `supabase/migration_v10_46_enforce_seller_location_cap.sql`. |
| **v10.45** | إضافة عبارة "تم تغيير موقعك السابق" في banner تجديد العرض المنتهي (v10.44). النص الكامل صار: "انتهت كل عروض موقعه السابق فحُذفت الخانة. تم تغيير موقعك السابق — اختر أحد مواقعك الحالية الـ3 لتجديد هذا العرض:". لا تغيير في الـlogic. |
| **v10.44** | حالة خاصة على قاعدة v10.43 — تجديد عرض منتهي بلوكيشن "محذوف" (بمعنى: انتهت كل عروض الموقع وتحررت الخانة قبل ما يحاول التاجر التجديد). الكشف: editing deal بـstatus غير active، locKey الأصلي ليس في activeKeys، و activeKeys.size = 3. النتيجة: banner برتقالي يظهر فوق قسم الموقع برسالة "تم حذف لوكيشن العرض السابق" + chips قابلة للضغط للمواقع الـ3 الحالية. ضغطة على chip → adoptLocationFromDeal يضبط locationId/region/city/mapPos تلقائياً وينظف googleMapsLink. |
| **v10.43** | تعديل قاعدة v10.42 — التعديل يخضع للحد أيضاً. الـ3 لوكيشنات قيد ثابت على كل العمليات (إضافة + تعديل). نقل منتج موجود لـلوكيشن 4 جديد **ممنوع** الآن — التاجر يجب يحذف كل منتجات أحد مواقعه أولاً لتفريغ خانة. counter مرئي حتى في الـedit mode. زر "حفظ التعديل فقط" يصير معطّل عند wouldExceedLimit. admin بدون قيود (كما كان). |
| **v10.42** | حد أقصى 3 لوكيشنات فريدة لمنتجات التاجر النشطة في الباقة الأساسية. الحساب: locationId مفهرس (مول/سوق) أو إحداثيات مدوّرة لـ3 منازل (~110م) للدبابيس المخصصة. **التعديل** على منتج موجود حر بالكامل (يقدر التاجر ينقل أي منتج لأي مكان حتى لو أنتج 4 لوكيشنات). **الإضافة** الجديدة في لوكيشن 4+ مرفوضة مع رسالة وزر "إدارة الاشتراك". counter مرئي في النموذج "X / 3 مواقع" مع تلوين أصفر/أحمر. admin يتجاوز القاعدة. آلية الـupgrade لباقة أعلى موجودة في backlog. |
| **v10.41** | ثلاث مشاكل مترابطة: (١) **DB**: فشل مزامنة المنتج مع السيرفر `new row violates RLS for table notifications` — الـtrigger `handle_deal_smart_notifications` كان يحاول إدراج إشعارات للمتابعين بصلاحيات الـseller بدل صلاحيات النظام. الإصلاح: `SECURITY DEFINER` على الـfunction. ملف migration: `supabase/migration_v10_41_smart_notifications_security_definer.sql`. (٢) **علم أوكرانيا**: Leaflet 1.9+ يحقن العلم في الـattribution badge؛ أُضيف `attributionControl={false}` على كل MapContainer (SellerDashboard + Nearby). (٣) **الخريطة لا تتمركز** بعد حلّ الرابط/الفلتر: `MapCenterUpdater` يستدعي `flyTo` على tile-grid قديم. أُضيف `invalidateSize()` قبل `setView` ليُعيد Leaflet حساب الـviewport. |
| **v10.40** | لوحة البائع: تبويب "إضافة +" كان يفتح صفحة "السكانر" بدل نموذج الإضافة. السبب: فحص الاشتراك كان يقرأ من `storeProfiles.subscription_expires_at` (حقل قديم لا يُحدّث للتجار في فترة التجربة ولا للـadmin) → `isSubscriptionValid=false` → الـform يسقط للـscanner fallback. الإصلاح: (١) admin يتجاوز فحص الاشتراك دائماً. (٢) المصدر الحقيقي للاشتراك صار `merchant_subscriptions` (status + trial_ends_at + current_period_end). (٣) لو فعلاً لا اشتراك للتاجر، تظهر لوحة "الاشتراك مطلوب" مع زر إدارة الاشتراك بدل صفحة السكانر. |
| **v10.39** | **DB fix حرج** — سياستا RLS على جدول users (`users_select_all` و `users_update_admin`) كانتا تستخدمان `EXISTS (SELECT FROM users ...)` داخل تعريفهما → infinite recursion عند أي UPDATE/UPSERT على users. النتيجة: `saveProfile` يفشل بصمت → "حفظ كموقع دائم" + "إضافة وتكرار" + addDeal trigger smart_notifications كلها معطلة. الإصلاح: استبدال الـsubquery بـ `is_admin()` SECURITY DEFINER. ملف الـmigration: `supabase/migration_v10_38_fix_users_rls_infinite_recursion.sql`. |
| **v10.38** | نموذج إضافة العرض — تعليق spinner عند فشل رابط Google Maps: (١) `handleMapLinkUpdate` يسجّل المحاولة في `lastResolvedLink` حتى عند الفشل، فالضغطات التالية على Save/حفظ كموقع دائم لا تكرر الـresolution. (٢) إخفاء تنبيه الفشل عن الـauto-resolver (يبقى فقط لو ضغط المستخدم "تحديد" يدوياً). (٣) re-entrance guard (Ref) يمنع تشغيل resolution موازية. (٤) spinner منفصل لكل زر (`submitMode` state) — لا يدور الزرّان معاً. (٥) زر "حفظ كموقع دائم" له spinner مستقل ولا ينتظر أكثر من 2s. |
| **v10.37** | نموذج إضافة العرض: (١) تنبيه inline أحمر فوري + حدود حمراء + تعطيل أزرار الحفظ لو `discountedPrice >= originalPrice`. (٢) زر "حفظ كموقع دائم" يحل رابط Google Maps أولاً (cap 3s) قبل الحفظ، فلا يحفظ الإحداثي الافتراضي. (٣) submitAction: نقل الـvalidation السريع قبل بدء الـspinner + تقليل link-resolution timeout من 5s إلى 3s + spinner داخل "إضافة وتكرار" أيضاً — لا تعليق ولا انتظار 5 ثوان للـvalidation. |
| **v10.36** | StoreDetails: العرض الزمني (بدون stock cap) كان يظهر في تبويبَي "نشطة" و"سابقة" معاً لأن `quantity<=0` كان يُعتبر sold-out حتى بدون initialQuantity. الفلترة الآن متطابقة مع SellerDashboard: العرض في "سابقة" فقط إذا status=expired/paused أو (active && sold-out-with-cap) أو (active && timed-out). |
| **v10.35** | BottomNav ثابت فعلياً في كل الصفحات — رفع z-index من 50 إلى 1100 (فوق Leaflet) + `isolation: isolate` على `.leaflet-container` + نقل BottomNav خارج PullToRefresh في Home و Bookings (translateY كان يكسر `position: fixed`) |
| **v10.34** | auto-version-check على كل page load: يقارن CACHE_NAME الـserver مع الـcached محلياً ويـapply تلقائياً إذا اختلف |
| **v10.33** | BottomNav على DealDetails + رفع زر الحجز فوقه + خريطة حولي بـ120 px clearance + Sidebar بدون flex:1 |
| **v10.32** | تثبيت BottomNav (إزالة auto-hide) + فراغ تحت خريطة "حولي" في وضع map-only |
| **v10.31** | إزالة Pull-to-Refresh من حولي + BottomNav يكشف على أي scroll-up (مثل X) |
| **v10.30** | Pull-to-Refresh spinner ≤ 700ms cap + fire-and-forget refresh per page |
| **v10.29** | PTR indicator centered + BottomNav auto-hide بنمط X (لاحقاً أُزيل في v10.32) |
| **v10.28** | Pull-to-Refresh component + applySwUpdate نووي (cache nuke + cache-busted reload) |
| **v10.27** | زر "📍 موقعي" في حولي يمسح فلاتر region/city تلقائياً |
| **v10.26** | Profile header غير sticky (override .premium-bar للـscroll الطبيعي) |
| **v10.25** | partial-aware saveProfile (يمنع wipe المتابعة) + StoreDetails notch + UpdateBanner |
| **v10.24** | عرض المنطقة + المدينة على بطاقة الموقع في DealDetails |
| **v10.23** | فلتر sort في صفحة حجوزاتي (newest-first default) |
| **v10.22** | realtime resync threshold 1s + pageshow bfcache handler + live GPS + Bookings header notch |
| **v10.21** | محادثة المشتري ↔ التاجر (٣+٣ رسائل) — جدول DB + RPCs + realtime + UI |
| **v10.20** | atomic booking RPCs (complete/acknowledge/cancel) + await/rollback — إصلاح "الحجز يرجع" |
| **v10.19** | فلتر region/city: deals.region + deals.city columns + DB trigger update + backfill 6 rows |
| **v10.18** | رسالة التاجر تظهر دائماً في حجوزاتي (status-driven fallback) |
| **v10.17** | إزالة inner scroll من صندوق التصنيفات في Smart Alerts (Profile) |
| **v10.16** | Permissions-Policy: camera=(self) — فتح الكاميرا في الباركود + KM label overflow fix |
| **v10.15** | SW cache bump إجباري كل deploy + وقت الوصول مشي/سيارة في حولي |
| **v10.14** | dark mode --primary → emerald `#10b981` (يصلح 33 موقع نص خفي دفعة واحدة) |
| **v10.13** | زر "✅ تم الحجز" → ينقل لـ/bookings + شارة الإشعارات في الدارك مود + distance badge |
| **v10.12** | Vercel SPA rewrites — يصلح صفحة 404 على أي رابط مباشر |
| **v10.0–v10.11** | (سابق للجلسة) — v10.0 SW cache strategy، v10.1 auto-recovery، v10.4–10.11 إصلاحات الإدارة + Vercel deploy |

---

## 🧠 ذاكرة دائمة (gotchas)

- **Parcel preview لا يشتغل في sandbox (EPERM)** — أعتمد على typecheck + Vercel deploy.
- **Custom location_id (`custom_<ts>`)** لا يطابق LOCATIONS array — حُلت في v10.19 عبر deals.region/city columns + find_nearest_sa_city RPC.
- **iOS Safari pauses realtime websocket في الـbackground** — الـpageshow + 1s threshold يحل ذلك (v10.22, v10.28).
- **controllerchange على iOS قد يأخر ثواني** — applySwUpdate الآن لا ينتظره، يمسح الكاش ويعمل `location.replace` فوراً (v10.28).
