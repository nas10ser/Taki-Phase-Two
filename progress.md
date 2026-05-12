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

## 🗓 سجل v10.x

| إصدار | الموضوع |
|--------|---------|
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
