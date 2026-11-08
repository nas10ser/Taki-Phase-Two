-- ════════════════════════════════════════════════════════════════════════
-- TAKI · v15.79 — تقويةُ التفويض: عشرُ ثغراتٍ مقيسةٍ في سطح الكتابة والقراءة
--
-- الخادمُ المستهدَف: **جدة (الإنتاج)**. يرفض التنفيذَ على مختبر طوكيو.
-- الدورُ المنفِّذ: **`supabase_admin`** (هو وحده `rolsuper` على هذه القاعدة —
-- قِيس: `pg_roles.rolsuper = t` له و`f` لـ`postgres`). وثلاثٌ من الدوالّ
-- المُستبدَلة هنا **يملكها `postgres`**، و`CREATE OR REPLACE` يُبقي المالكَ
-- والصلاحياتَ كما هي — فلا يتبدّل وضعُ الأمان بالاستبدال. (وهذا مقيسٌ لا
-- مفترض: الفحصُ ⑩ أدناه يرفع استثناءً إن تبدّل المالك.)
--
-- 🪤 **المميِّزُ يتبع وضعَ الأمان لا الذوقَ** (درسُ v14.93، وهو مقلوبٌ هنا):
--    الحرّاسُ الثلاثةُ التي أُعيد كتابتها (`tr_guard_user_privileges` ·
--    `tr_guard_booking_integrity` · `tr_guard_rating_purchase`) كلُّها
--    **`SECURITY INVOKER`** (قِيس: `prosecdef = f`)، ولذلك
--    `current_user` فيها هو **المنادي الحقيقيّ**: `authenticated` للمتصفّح،
--    و`postgres` داخل أيّ دالّةٍ إداريّةٍ `DEFINER` يملكها `postgres`،
--    و`supabase_admin` للكرون (قِيس: كلُّ ٣٧ وظيفةً في `cron.job` باسم
--    `supabase_admin`).
--    🔴 ولذلك **لا يصحّ هنا `taki_is_system_caller()`**: هي تقرأ
--    `session_user`، وهو `authenticator` لكلّ طلبٍ من الويب **بما فيها
--    نداءُ `admin_suspend_account`** — فاستعمالُها كان سيُسقط الإيقافَ
--    الإداريَّ نفسَه. (هي الصحيحةُ في كودِ `DEFINER`، لا هنا.)
--
-- ما يُغلقه هذا الملفّ، مرتَّباً بالخطورة:
--   ① 🔴 `users`: كلُّ موثَّقٍ كان يمحو عقوبتَه بنفسه — `is_suspended` ·
--      `booking_banned_until` · `booking_ban_reason` · `under_review` ·
--      `deleted_at` · `purge_after` · `admin_notes` كلُّها كانت قابلةً
--      للكتابة على صفّه (سياسةُ `users_update_admin` تقبل `uid()=id`، ومنحُ
--      `UPDATE` على مستوى الجدول، و`tr_guard_user_privileges` يحرس
--      **الامتيازاتِ وحدها** بـ`UPDATE OF user_type, is_super_admin,
--      admin_permissions`). ⇒ وُسِّعت قائمةُ أعمدة المشغّل وجسمُ الحارس.
--   ② 🔴 `booking_messages`: سياسةُ الإدراج تربط `sender_role` بـ`uid()`
--      و**لا تربط `sender_id` بشيء** ⇒ مشترٍ يُدرج رسالةً باسم غيره،
--      فيُشعل الرصدَ الآليَّ على حسابٍ بريء حتى يوقفه. ⇒ أُسقط السطحُ
--      المباشر (لا يناديه الموقع: `bookingRepository.sendMessage:511` تنادي
--      `send_booking_message`)، **ومع ذلك** يُشتقّ `sender_id` في مشغّلٍ
--      قبليّ من `sender_role` وصفِّ الحجز — لا من قيمةِ العميل أبداً.
--   ③ `activity_log`: شرطُ الإدراج يقبل `user_id IS NULL` ⇒ أيُّ موثَّقٍ
--      يُلفّق سجلَّ العمليات الإداريّ. ولا كاتبَ له من المتصفّح إطلاقاً.
--   ④ `bookings`: حذفٌ مباشرٌ يحرق كمّيةَ التاجر إلى الأبد (مشغّلُ إعادة
--      الكمّية `AFTER INSERT OR UPDATE` لا `DELETE`). ولا منادٍ له.
--   ⑤ `bookings`: التاجرُ كان يُعيد كتابة اسمِ المشتري وجوّالِه وملاحظتِه.
--   ⑥ `ratings`: مراجعةٌ تُنقَل إلى عرضٍ لم يُشترَ (الحارسُ يتحقّق من
--      المتجر لا من العرض، و`set_rating_store_id` قبليٌّ على الإدراج وحده).
--   ⑦ `has_admin_permission()` و`is_super_admin()` تتجاهلان `deleted_at`
--      خلافاً لـ`taki_admin_perm()` ⇒ أدمنٌ محذوفٌ ناعماً يكتب في سبعِ
--      سياساتٍ تعتمد عليهما.
--   ⑧ `platform_settings_select`: آخرُ `is_admin()` باقيةٍ في سياسةٍ
--      (قِيس: العددُ ١ في كلّ المخطّط) ⇒ أيُّ أدمنٍ يقرأ كلَّ المفاتيح.
--   ⑨ `platform_settings_write_scoped`: بلا نطاقِ مفاتيح ⇒ أدمنُ شكاوى
--      يُبدّل إعداداتِ الدفع والضريبة والتسعير.
--   ⑩ `sellers_public`: تنشر `user_type` ⇒ زائرٌ مجهولٌ يفرز حساباتِ
--      الإدارة ويقرأ جوّالَها وإحداثيّاتِها.
--
-- 🪤 ما لم أفعله ولماذا — مكتوبٌ كي لا يُعاد فتحه:
--   • **لم أمسّ `bookings_update_auth`**: شرطُ `WITH CHECK` الحيّ **يُعيد**
--     تأكيدَ عضويّة الطرف أصلاً، وسياساتُ بوستجرس **لا ترى `OLD`** فلا
--     تستطيع قولَ «نفسُ الطرف بنفس الدور». فإعادةُ بنائها تغييرٌ بصفر أثر —
--     وهو بالضبط «حارسٌ لا يمكن أن يفشل». الفرضُ الحقيقيّ في المشغّل ⑤.
--   • **لم أُضِف مشغّلَ إعادةِ الكمّية عند الحذف**: قِيس أنّ **لا دالّةَ
--     واحدةً** في القاعدة تحذف حجزاً (صفرُ `DELETE FROM bookings` في ٦٤٤
--     دالّة)، فبإسقاط سطح العميل لا يبقى حاذفٌ إلّا جلسةُ قاعدةٍ بصلاحية
--     المالك. واختراعُ حسابِ مخزونٍ هنا كان سيصادم نموذجَ v15.02/03
--     (`on_hand` + الحجوزات على أربعة محاور) ⇒ خطرُ بيعٍ زائد مقابل لا شيء.
--   • **لم أُعدّل `tr_rate_limit_message`**: إعفاؤها يقرأ `NEW.sender_id`،
--     وقد صار هذا العمودُ **مشتقّاً على الخادم** بمشغّلٍ يسبقها في الترتيب
--     (الفحص ⑤ يرفع استثناءً إن ظهر مشغّلٌ قبليٌّ يسبقه اسمُه).
--   • **لم أمسّ منحَ `anon` على `has_admin_permission`/`is_super_admin`**:
--     سبعُ سياساتٍ تناديهما وهي `TO public`، فالزائرُ المجهول **ينفّذهما
--     فعلاً** عند كلّ قراءةٍ للبانرات والحملات. وسحبُ المنح كان سيُفشل
--     تقييمَ السياسة بخطأ صلاحيّة ⇒ حجبُ البانرات عن الزوّار (كسرُ v14.38
--     نفسُه بوجهٍ آخر).
--
-- 🪤 وفخٌّ كِدتُ أقع فيه في ①: نصُّ الحارس الحيّ يُنهي بذيلٍ يسمح
--    بـ`user_type` إلى `buyer`/`seller` — وهو ما يُرقّي المشتريَ تاجراً من
--    `CompleteProfile`. فاستبدالُ الذيل برفضٍ شامل (كما في مقترح التدقيق)
--    كان **سيكسر ترقيةَ الحساب**. الذيلُ باقٍ حرفياً، والرفضُ الجديد قبله.
--
-- 🪤 وفخٌّ ثانٍ مقيس: فرعُ `INSERT` في الحارس يقول
--    `NEW.admin_permissions IS NOT NULL`، والعمودُ `NOT NULL DEFAULT '{}'`
--    ⇒ **الشرطُ صادقٌ دائماً**، أي أنّ أيّ `INSERT` مباشرٍ على `public.users`
--    من المتصفّح **مرفوضٌ اليوم أصلاً** وسياسةُ `users_insert_own` ميّتة.
--    فزيادةُ أعمدةٍ على ذلك الفرع **بصفر أثر** — أُضيفت للصحّة لا للسلوك،
--    ولم أُصلح الشرطَ لأنّ إصلاحَه **يُرخي** حارساً قائماً.
--
-- 🔴 رموزُ الأخطاء: كلُّ رفضٍ جديدٍ يحمل `42501` — وهو رمزٌ قياسيّ
--    (`insufficient_privilege`) يُحوّله PostgREST إلى 403 برسالته، خلافاً
--    للرموز المخصَّصة التي تصير ٥٠٠ عامّاً. ⇒ **لا تغييرَ لازماً في
--    `src/` ولا في البوتين** لهذه الهجرة.
--
-- 🔬 الفحوصُ أدناه **تُنفّذ هجماتٍ حقيقية** داخل معاملاتٍ فرعيّةٍ تُلغى
--    بعلامةٍ صريحة (`TAKI_PROBE_ROLLBACK`)، فأثرُها على البيانات **صفر**.
--    ولكلّ فحصٍ سالبٍ **شاهدٌ موجب** يُثبت أنّ الطلبَ بلغ الحارسَ فعلاً —
--    وإلّا صرخ «غيرُ قاطع» بدل أن يمرّ كاذباً (درس v14.77: صفرُ صفوفٍ
--    بسبب RLS يُبرّئ كوداً معطوباً).
-- ════════════════════════════════════════════════════════════════════════

-- ── حارسُ الخادم: هذه هجرةُ إنتاج ───────────────────────────────────────
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION '⛔ هذه هجرةُ إنتاج (جدة) — ومُنعت على مختبر طوكيو.';
  END IF;
END $guard$;


-- ════════════════════════════════════════════════════════════════════════
-- ① 🔴 `users` — أعمدةُ الفرض صارت يخدمها الخادم وحده
-- ════════════════════════════════════════════════════════════════════════
-- قِيس على جدة: `tr_guard_user_privileges` مشغّلُه
-- `BEFORE UPDATE OF user_type, is_super_admin, admin_permissions` وحدها،
-- و`has_column_privilege('authenticated','users','is_suspended','UPDATE')`
-- صادقة، ولا مشغّلَ آخر على `users` يذكر عمودَ عقوبةٍ واحداً.
-- والدالّةُ `SECURITY INVOKER` ⇒ `current_user` هو المنادي الحقيقيّ.
CREATE OR REPLACE FUNCTION public.tr_guard_user_privileges()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
DECLARE
  v_touches_privilege boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- 🪤 `admin_permissions` عمودٌ `NOT NULL DEFAULT '{}'`، فهذا الشرطُ
    --    صادقٌ دائماً — وهو سلوكُ الإنتاج اليوم، أُبقي حرفياً. والأعمدةُ
    --    المضافةُ بعده للصحّة لا للسلوك (أثرُها صفر ما بقي الشرطُ أعلاه).
    v_touches_privilege :=
         NEW.user_type = 'admin'
      OR coalesce(NEW.is_super_admin, false)
      OR NEW.admin_permissions IS NOT NULL
      OR coalesce(NEW.is_suspended, false)
      OR coalesce(NEW.under_review, false)
      OR coalesce(NEW.is_anonymized, false)
      OR NEW.under_review_at      IS NOT NULL
      OR NEW.booking_banned_until IS NOT NULL
      OR NEW.booking_ban_reason   IS NOT NULL
      OR NEW.deleted_at           IS NOT NULL
      OR NEW.purge_after          IS NOT NULL
      OR NEW.anonymized_at        IS NOT NULL
      OR NEW.admin_notes          IS NOT NULL;
  ELSE
    v_touches_privilege :=
      -- الامتيازات (كما كانت)
         NEW.user_type            IS DISTINCT FROM OLD.user_type
      OR NEW.is_super_admin       IS DISTINCT FROM OLD.is_super_admin
      OR NEW.admin_permissions    IS DISTINCT FROM OLD.admin_permissions
      -- v15.79 — أعمدةُ الفرض: العقوبةُ والمراجعةُ والحذفُ والتجهيلُ
      OR NEW.is_suspended         IS DISTINCT FROM OLD.is_suspended
      OR NEW.under_review         IS DISTINCT FROM OLD.under_review
      OR NEW.under_review_at      IS DISTINCT FROM OLD.under_review_at
      OR NEW.booking_banned_until IS DISTINCT FROM OLD.booking_banned_until
      OR NEW.booking_ban_reason   IS DISTINCT FROM OLD.booking_ban_reason
      OR NEW.deleted_at           IS DISTINCT FROM OLD.deleted_at
      OR NEW.purge_after          IS DISTINCT FROM OLD.purge_after
      OR NEW.is_anonymized        IS DISTINCT FROM OLD.is_anonymized
      OR NEW.anonymized_at        IS DISTINCT FROM OLD.anonymized_at
      OR NEW.admin_notes          IS DISTINCT FROM OLD.admin_notes;
  END IF;

  -- كتابةٌ لا تمسّ شيئاً من ذلك تمرّ كما هي (فالحفظُ الجزئيّ للملفّ الشخصيّ
  -- ونداءُ «احفظ» مكرَّراً بنفس القيمة لا يُرفضان).
  IF NOT v_touches_privilege THEN
    RETURN NEW;
  END IF;

  -- المنادونَ الموثوقون: الدوالُّ الإداريّة (`DEFINER` ⇒ المالك)، والكرون
  -- (قِيس: `cron.job.username = supabase_admin` في الوظائف كلِّها)، ودورُ
  -- الخدمة. 🪤 يبقى `current_user` لأنّ هذه الدالّةَ `INVOKER` — ولو كانت
  -- `DEFINER` لصار الشرطُ صادقاً في كلّ نداءٍ ولم يمنع أحداً (v14.93).
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- الأدمنُ الأعلى يُدير الأدوار. (وبعد ⑦ صارت `is_super_admin()` ترفض
  -- الأدمنَ المحذوفَ ناعماً أيضاً.)
  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'forbidden: cannot create a privileged account'
      USING ERRCODE = '42501';
  END IF;

  -- v15.79 — الرفضُ الجديد **قبل** الذيل القديم، فلا يُمسّ الذيل.
  IF NEW.is_suspended         IS DISTINCT FROM OLD.is_suspended
  OR NEW.under_review         IS DISTINCT FROM OLD.under_review
  OR NEW.under_review_at      IS DISTINCT FROM OLD.under_review_at
  OR NEW.booking_banned_until IS DISTINCT FROM OLD.booking_banned_until
  OR NEW.booking_ban_reason   IS DISTINCT FROM OLD.booking_ban_reason
  OR NEW.deleted_at           IS DISTINCT FROM OLD.deleted_at
  OR NEW.purge_after          IS DISTINCT FROM OLD.purge_after
  OR NEW.is_anonymized        IS DISTINCT FROM OLD.is_anonymized
  OR NEW.anonymized_at        IS DISTINCT FROM OLD.anonymized_at
  OR NEW.admin_notes          IS DISTINCT FROM OLD.admin_notes THEN
    RAISE EXCEPTION 'forbidden: account enforcement fields are server-managed'
      USING ERRCODE = '42501';
  END IF;

  -- ── الذيلُ القديم، حرفياً: ترقيةُ المشتري تاجراً تبقى تعمل ─────────────
  IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
    RAISE EXCEPTION 'forbidden: is_super_admin is not self-editable'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.admin_permissions IS DISTINCT FROM OLD.admin_permissions THEN
    RAISE EXCEPTION 'forbidden: admin_permissions is not self-editable'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.user_type IS DISTINCT FROM OLD.user_type
     AND NEW.user_type NOT IN ('buyer', 'seller') THEN
    RAISE EXCEPTION 'forbidden: cannot grant yourself the % role', NEW.user_type
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$fn$;

-- قائمةُ الأعمدة على المشغّل هي ما يُقرّر **هل يُستدعى الحارسُ أصلاً**:
-- `UPDATE OF` يُقاس بقائمةِ أعمدة الجُملة لا بما تغيّر فعلاً. فعمودٌ ناقصٌ
-- هنا = حارسٌ لا يعمل، بلا أيّ صوت.
DROP TRIGGER IF EXISTS tr_guard_user_privileges ON public.users;
CREATE TRIGGER tr_guard_user_privileges
  BEFORE UPDATE OF
      user_type, is_super_admin, admin_permissions,
      is_suspended, under_review, under_review_at,
      booking_banned_until, booking_ban_reason,
      deleted_at, purge_after, is_anonymized, anonymized_at, admin_notes
  ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.tr_guard_user_privileges();

-- (مشغّلُ الإدراج `tr_guard_user_privileges_ins` يبقى كما هو — بلا قائمةِ
--  أعمدة، فهو يُستدعى على كلّ إدراج.)


-- ════════════════════════════════════════════════════════════════════════
-- ② 🔴 `booking_messages` — `sender_id` يُشتقّ على الخادم، والسطحُ يُسقَط
-- ════════════════════════════════════════════════════════════════════════
-- قِيس: `booking_messages_insert_party` تربط `sender_role` بـ`uid()` ولا
-- تذكر `sender_id`؛ ولا قيدٌ على العمود (القيودُ: طولُ النصّ ودورُ المرسِل
-- فقط)؛ و`authenticated` يملك `INSERT` على الجدول وعلى كلّ أعمدته.
-- والمنادي الشرعيّ الوحيد من الموقع `src/repositories/bookingRepository.ts:511`
-- وهو ينادي `send_booking_message` (دالّةُ `DEFINER`)، والبوتان ينادون
-- `bot_send_booking_message`. ⇒ السطحُ المباشر بلا منادٍ.
DROP POLICY IF EXISTS booking_messages_insert_party ON public.booking_messages;

-- 🪤 سحبُ المنح يُكتب للاثنين: `REVOKE … FROM PUBLIC` لا يُلغي منحَ `anon`
--    المباشر ولا العكس.
REVOKE INSERT ON TABLE public.booking_messages FROM PUBLIC;
REVOKE INSERT ON TABLE public.booking_messages FROM anon;
REVOKE INSERT ON TABLE public.booking_messages FROM authenticated;

-- الحزامُ والمشدّ: حتى لو عاد سطحٌ مباشرٌ يوماً، لا يستطيع أحدٌ أن يُسمّي
-- غيرَه مرسِلاً. والاشتقاقُ **من `sender_role` وصفِّ الحجز** — وهو المعرِّفُ
-- الوحيد الذي تربطه سياسةُ RLS بـ`uid()` — لا من `sender_id` الذي يرسله
-- العميل، ولا من `auth.uid()` (فهي `NULL` في مسار البوت فيصير العمودُ
-- `NULL` على عمودٍ `NOT NULL` ⇒ كسرُ محادثةِ البوت).
-- 🪤 و`SECURITY DEFINER` هنا ليست تفويضاً بل رؤية: القراءةُ من
--    `public.bookings` تحت RLS قد تعود بصفر صفوف **بلا خطأ** فيُترك العمودُ
--    كما أرسله العميل (درس v14.77). نُسخ نفسُ وضعِ
--    `tr_booking_message_recipient` الذي يقرأ نفسَ الصفّ.
CREATE OR REPLACE FUNCTION public.tr_bm_force_sender()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  v_party text;
BEGIN
  SELECT CASE WHEN NEW.sender_role = 'buyer' THEN b.user_id ELSE b.store_id END
    INTO v_party
    FROM public.bookings b
   WHERE b.barcode = NEW.barcode;

  -- حجزٌ غيرُ موجود: يُترك العمودُ كما هو ليفشلَ الإدراجُ بخطأ المفتاح
  -- الأجنبيّ الصريح، لا بخطأ `NULL` مُضلِّل.
  IF v_party IS NOT NULL THEN
    NEW.sender_id := v_party;
  END IF;

  RETURN NEW;
END;
$fn$;

-- 🪤 الاسمُ عقدٌ لا تجميل: بوستجرس يُشغّل مشغّلاتِ الصفّ **بترتيب الاسم
--    أبجدياً**، و`tr_rate_limit_message` (في `tr_aa_…`) تُعفي الأدمنَ
--    بقراءة `NEW.sender_id`. فلو تلا هذا المشغّلُ ذاك لبقي الإعفاءُ معتمداً
--    على قيمةِ العميل. قِيس على القاعدة نفسِها (`en_US.UTF-8`):
--    `'tr_a0_…' < 'tr_aa_…'` صادقة. والفحصُ ⑤ يرفع استثناءً إن ظهر مشغّلٌ
--    قبليٌّ على الإدراج يسبقه اسمُه.
DROP TRIGGER IF EXISTS tr_a0_bm_force_sender ON public.booking_messages;
CREATE TRIGGER tr_a0_bm_force_sender
  BEFORE INSERT ON public.booking_messages
  FOR EACH ROW EXECUTE FUNCTION public.tr_bm_force_sender();

-- سوبابيس تمنح `anon` التنفيذَ على كلّ دالّةٍ عامّةٍ جديدة تلقائياً
-- (قِيس: `pg_default_acl` للمخطّط `public` فيه `anon=X`).
REVOKE ALL ON FUNCTION public.tr_bm_force_sender() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tr_bm_force_sender() FROM anon;
REVOKE ALL ON FUNCTION public.tr_bm_force_sender() FROM authenticated;


-- ════════════════════════════════════════════════════════════════════════
-- ③ `activity_log` — سجلُّ العمليات لا يُلفَّق
-- ════════════════════════════════════════════════════════════════════════
-- قِيس: شرطُ الإدراج `uid()::text = user_id OR user_id IS NULL` — والفرعُ
-- الثاني يقبل صفّاً بلا نسبةٍ إلى أحد، بأيّ `user_type` وأيّ `action`.
-- ولا مشغّلَ على الجدول، ولا كاتبَ له في `src/` ولا `server/` (قِيس:
-- `src/repositories/operationsRepository.ts` يقرأ عبر
-- `admin_operations_log` فقط). والكتّابُ الشرعيّون دوالُّ `DEFINER` تتجاوز
-- RLS أصلاً ⇒ **يُسقَط السطحُ ولا يُضيَّق**.
DROP POLICY IF EXISTS activity_insert_self ON public.activity_log;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.activity_log FROM PUBLIC;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.activity_log FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.activity_log FROM authenticated;
-- يبقى `SELECT` كما هو: سياسةُ `activity_select_admin` هي الحاكمة
-- (`taki_admin_perm('tab_tools')`) وشاشةُ «إدارة العمليات» تعتمدها.


-- ════════════════════════════════════════════════════════════════════════
-- ④ `bookings` — الحذفُ المباشر يُسقَط
-- ════════════════════════════════════════════════════════════════════════
-- قِيس: `bookings_delete_own` تسمح للمشتري **وللتاجر** بحذفِ حجزٍ غيرِ
-- مدفوعٍ ولا مفوتَرٍ ولا منتهٍ. و`trg_adjust_deal_quantity` مُعلَنٌ
-- `AFTER INSERT OR UPDATE` ⇒ الحذفُ **لا يُعيد الكمّية أبداً**: احجز ثمّ
-- احذف = وحدةٌ تُمحى من عرضِ التاجر بلا بيعٍ ولا إلغاءٍ مسجَّل.
-- ولا منادي: `bookingRepository.remove` (السطر ٤٨٢) بصفر مواضعِ نداء،
-- و**صفرُ دالّةٍ** في القاعدة تحذف حجزاً. والمسارُ الشرعيّ `cancel_booking`
-- الذرّيّ (يضبط الحالةَ فيُعيد المشغّلُ الكمّية ويُسجّل `cancelled_by`).
DROP POLICY IF EXISTS bookings_delete_own ON public.bookings;

REVOKE DELETE ON TABLE public.bookings FROM PUBLIC;
REVOKE DELETE ON TABLE public.bookings FROM anon;
REVOKE DELETE ON TABLE public.bookings FROM authenticated;
-- (`tr_guard_booking_delete` — حارسُ الفاتورة المرقَّمة P0016 — يبقى شبكةَ
--  أمانٍ لأيّ حذفٍ بصلاحية المالك.)


-- ════════════════════════════════════════════════════════════════════════
-- ⑤ `bookings` — هويّةُ المشتري على طلبه لا يكتبها التاجر
-- ════════════════════════════════════════════════════════════════════════
-- قِيس: قائمةُ `tr_guard_booking_integrity` تُجمّد المالَ ودورةَ الحياة
-- كلَّها (٣١ عموداً) **وتُغفل** `user_name` و`user_phone` و`notes` و
-- `created_at` ⇒ التاجرُ يُعيد كتابةَ اسمِ المشتري وجوّالِه على طلبِ
-- المشتري نفسِه. والفاتورةُ الضريبيّة لقطةٌ مجمّدة فلا أثرَ ماليّ — لكنّ
-- سجلَّ التواصل الذي يراه المشتري والاسمَ في إشعار المحادثة يصيران بيدِ
-- التاجر.
-- والكاتبُ الشرعيّ الوحيد لهذه الأعمدة `bookingRepository.save` (السطر
-- ٣٦٨) وهو يُدرجها لحظةَ إنشاء الطلب ولا يُعيد كتابتها (قِيس: نداءٌ واحد
-- في `AppContext.tsx:2490` ونداءٌ في `botService.ts:172`، كلاهما إنشاء).
-- و`prep_time` تبقى مكتوبةً — حقلُ التاجر المشروع.
CREATE OR REPLACE FUNCTION public.tr_guard_booking_integrity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  -- The lifecycle RPCs, pg_cron and the payment function all run as the owner.
  -- 🪤 `INVOKER` عمداً: `current_user` هنا هو المنادي الحقيقيّ.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF coalesce(NEW.status, 'pending') <> 'pending' THEN
      RAISE EXCEPTION 'forbidden: a new booking must start as pending'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.paid_at          IS NOT NULL
    OR NEW.paid_amount      IS NOT NULL
    OR NEW.payment_provider IS NOT NULL
    OR NEW.payment_ref      IS NOT NULL
    OR NEW.payment_expected IS NOT NULL
    OR NEW.total_amount     IS NOT NULL
    OR NEW.completed_at     IS NOT NULL
    OR NEW.completed_by     IS NOT NULL
    OR NEW.cancelled_by     IS NOT NULL
    OR NEW.merchant_note    IS NOT NULL THEN
      RAISE EXCEPTION 'forbidden: payment and lifecycle fields are set by the server'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE from a client session: identity, money, stock and lifecycle frozen.
  -- 🪤 سياسةُ RLS **لا تستطيع** قولَ هذا: بوستجرس لا يُمرّر `OLD` إلى
  --    السياسات، فهذه القائمةُ هي الموضعُ الوحيدُ الممكن. عمودٌ يُحذف منها
  --    يصير مكتوباً للطرفين فوراً وبلا أيّ صوت.
  IF NEW.barcode          IS DISTINCT FROM OLD.barcode
  OR NEW.backup_code      IS DISTINCT FROM OLD.backup_code
  OR NEW.deal_id          IS DISTINCT FROM OLD.deal_id
  OR NEW.user_id          IS DISTINCT FROM OLD.user_id
  OR NEW.store_id         IS DISTINCT FROM OLD.store_id
  OR NEW.booked_quantity  IS DISTINCT FROM OLD.booked_quantity
  OR NEW.booked_at        IS DISTINCT FROM OLD.booked_at
  OR NEW.expiry_time      IS DISTINCT FROM OLD.expiry_time
  OR NEW.status           IS DISTINCT FROM OLD.status
  OR NEW.completed_at     IS DISTINCT FROM OLD.completed_at
  OR NEW.completed_by     IS DISTINCT FROM OLD.completed_by
  OR NEW.paid_at          IS DISTINCT FROM OLD.paid_at
  OR NEW.paid_amount      IS DISTINCT FROM OLD.paid_amount
  OR NEW.payment_provider IS DISTINCT FROM OLD.payment_provider
  OR NEW.payment_ref      IS DISTINCT FROM OLD.payment_ref
  OR NEW.payment_expected IS DISTINCT FROM OLD.payment_expected
  OR NEW.total_amount     IS DISTINCT FROM OLD.total_amount
  OR NEW.payment_method   IS DISTINCT FROM OLD.payment_method
  OR NEW.selected_options IS DISTINCT FROM OLD.selected_options
  OR NEW.cancelled_by     IS DISTINCT FROM OLD.cancelled_by
  OR NEW.merchant_note    IS DISTINCT FROM OLD.merchant_note
  OR NEW.location_id      IS DISTINCT FROM OLD.location_id
  OR NEW.fulfillment      IS DISTINCT FROM OLD.fulfillment
  OR NEW.delivery_address IS DISTINCT FROM OLD.delivery_address
  OR NEW.refund_state     IS DISTINCT FROM OLD.refund_state
  OR NEW.refund_claimed_at IS DISTINCT FROM OLD.refund_claimed_at
  OR NEW.refunded_at      IS DISTINCT FROM OLD.refunded_at
  OR NEW.refund_ref       IS DISTINCT FROM OLD.refund_ref
  OR NEW.refund_amount    IS DISTINCT FROM OLD.refund_amount
  OR NEW.refund_reason    IS DISTINCT FROM OLD.refund_reason
  OR NEW.refund_by        IS DISTINCT FROM OLD.refund_by
  OR NEW.delivery_fee     IS DISTINCT FROM OLD.delivery_fee
  -- v15.79 — هويّةُ المشتري وملاحظتُه وتاريخُ الطلب
  OR NEW.user_name        IS DISTINCT FROM OLD.user_name
  OR NEW.user_phone       IS DISTINCT FROM OLD.user_phone
  OR NEW.notes            IS DISTINCT FROM OLD.notes
  OR NEW.created_at       IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'forbidden: booking payment and lifecycle fields are server-managed'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$fn$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑥ `ratings` — المراجعةُ لا تُنقَل إلى عرضٍ لم يُشترَ
-- ════════════════════════════════════════════════════════════════════════
-- قِيس: `ratings_update_own` تُعيد تأكيدَ `user_id` وحده؛ والحارسُ يتحقّق
-- من **المتجر** لا من العرض؛ و`set_rating_store_id` مُعلَنٌ
-- `BEFORE INSERT` وحده ⇒ على التعديل يصير `store_id` و`deal_id` بيدِ
-- العميل ⇒ شراءٌ واحد يشتري حقَّ وضعِ نجمةٍ واحدةٍ على كلّ عروضِ التاجر،
-- وشارةُ «مشترٍ موثَّق» تشهد لها.
-- وقِيس قبل الشحن: عددُ المراجعات الحيّة التي **لا** يقابلها شراءٌ مكتملٌ
-- **لنفس العرض** = صفر ⇒ بوّابةُ العرض تسري على القديم والجديد بلا كسر.
-- 🪤 والمُجمِّدُ قبل إعفاءِ الأدمن عمداً: أعمدةُ الهويّة غيرُ قابلةٍ
--    للتعديل لأحدٍ إلّا مسارِ الخادم — ولا أداةَ إداريّةً تُحرّك مراجعة
--    (قِيس: `update_rating` تكتب النجمةَ والتعليقَ فقط، و`admin_delete_rating`
--    تحذف، وكلتاهما `DEFINER` فتُعفى بـ`current_user`).
-- 🪤 و`is_admin()` استُبدلت بـ`taki_admin_perm('tab_reports')`: الأولى
--    تُرجع TRUE لأيّ أدمنٍ حين لا يوجد إطارُ `admin_*` على مكدّس النداء —
--    وهذا بالضبط حالُ مشغّلٍ على جدول (v14.38).
CREATE OR REPLACE FUNCTION public.tr_guard_rating_purchase()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $fn$
BEGIN
  -- Trusted server paths: the bot RPCs, admin tooling and pg_cron all run as
  -- the owner. The bot's own flow is barcode-driven, so it is gated already.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- v15.79 — هويّةُ المراجعة مجمّدةٌ بعد الإنشاء (قبل أيّ إعفاء).
  IF TG_OP = 'UPDATE' THEN
    IF NEW.user_id  IS DISTINCT FROM OLD.user_id
    OR NEW.deal_id  IS DISTINCT FROM OLD.deal_id
    OR NEW.store_id IS DISTINCT FROM OLD.store_id THEN
      RAISE EXCEPTION 'forbidden: a review cannot be moved to another deal, store or user'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- أدواتُ البلاغات (كان هنا `is_admin()` — راجع أعلاه).
  IF public.taki_admin_perm('tab_reports') THEN
    RETURN NEW;
  END IF;

  -- Belt and braces next to the RLS policy: never review as somebody else.
  IF NEW.user_id IS DISTINCT FROM auth.uid()::text THEN
    RAISE EXCEPTION 'forbidden: cannot review on behalf of another user'
      USING ERRCODE = '42501';
  END IF;

  -- البوّابةُ الفعليّة: شراءٌ مكتملٌ **لهذا العرض** من هذا المتجر.
  IF NOT EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.user_id  = NEW.user_id
       AND b.store_id = NEW.store_id
       AND b.deal_id  = NEW.deal_id
       AND b.status   = 'completed'
  ) THEN
    RAISE EXCEPTION 'forbidden: only a completed purchase of this deal allows a review'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$fn$;

-- (المشغّلُ الحيّ اسمُه `tr_zz_guard_rating_purchase` ويُستدعى
--  `BEFORE INSERT OR UPDATE` — لا يُمسّ، فالتعديلُ في جسمِ الدالّة وحده.
--  🪤 واسمُه لا يُطابق اسمَ دالّته: مَن يكتب `DROP TRIGGER
--  tr_guard_rating_purchase` يُسقط لا شيء ويظنّ أنه أصلح.)


-- ════════════════════════════════════════════════════════════════════════
-- ⑦ المميِّزان القديمان يوافقان المميِّزَ القانونيّ على `deleted_at`
-- ════════════════════════════════════════════════════════════════════════
-- قِيس: `taki_admin_perm()` تحمل `AND u.deleted_at IS NULL`، و
-- `has_admin_permission()` و`is_super_admin()` **لا**. وسبعُ سياساتٍ تعتمد
-- عليهما (`banners_write_tools` · `moderation_terms_write_reports` ·
-- `promo_write_tools` · `exp_write_launch` · `platform_settings_write_scoped`
-- · `admin_permission_log_super_read` · `admin_permission_log_super_insert`)
-- ⇒ أدمنٌ محذوفٌ ناعماً يفقد كلَّ شيءٍ إلّا الكتابةَ في هذه السبع.
-- 🪤 التوقيعان **بحرفهما**: زيادةُ معاملٍ تُنشئ نسخةً ثانية فيصير النداءُ
--    ملتبساً («function is not unique») وتسكت الطبقاتُ كلُّها (v14.25).
-- 🪤 والمنحُ **لا يُمسّ**: السياساتُ السبعُ `TO public`، فالزائرُ المجهول
--    ينفّذهما عند كلّ قراءةٍ للبانرات — وسحبُ منحِ `anon` يُفشل تقييمَ
--    السياسة بخطأ صلاحيّةٍ فيحجب البانرات عنه.
CREATE OR REPLACE FUNCTION public.has_admin_permission(perm text, uid text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  target_uid TEXT;
  is_super BOOLEAN;
  perms TEXT[];
BEGIN
  target_uid := COALESCE(uid, auth.uid()::text);
  IF target_uid IS NULL OR perm IS NULL OR perm = '' THEN RETURN FALSE; END IF;
  SELECT u.is_super_admin, u.admin_permissions
    INTO is_super, perms
  FROM public.users u
  WHERE u.id = target_uid
    AND u.user_type = 'admin'
    AND u.deleted_at IS NULL;          -- v15.79
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF COALESCE(is_super, FALSE) THEN RETURN TRUE; END IF;
  RETURN perm = ANY(COALESCE(perms, '{}'::TEXT[]));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.is_super_admin(uid text DEFAULT NULL::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
DECLARE
  target_uid TEXT;
  found BOOLEAN;
BEGIN
  target_uid := COALESCE(uid, auth.uid()::text);
  IF target_uid IS NULL THEN RETURN FALSE; END IF;
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = target_uid
      AND u.user_type = 'admin'
      AND u.is_super_admin = TRUE
      AND u.deleted_at IS NULL         -- v15.79
  ) INTO found;
  RETURN found;
END;
$fn$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑧ `platform_settings_select` — آخرُ `is_admin()` في سياسة
-- ════════════════════════════════════════════════════════════════════════
-- قِيس في كلّ المخطّط: عددُ السياسات التي تنادي `is_admin()` العارية = **١**،
-- وهي هذه. و`is_admin()` تقرأ مكدّسَ النداء بـ`GET DIAGNOSTICS PG_CONTEXT`
-- فتبحث عن إطار `admin_*`؛ وداخل سياسةِ RLS لا إطار ⇒ `RETURN TRUE` لأيّ
-- أدمن. ⇒ أدمنٌ صلاحيّتُه «الرئيسية» وحدها يقرأ المفاتيحَ الخمسةَ والأربعين
-- كلَّها لا الخمسةَ والعشرين المسموحةَ للعموم.
--
-- 🔴 الطريقةُ إلزاميّة (v14.92): تُعاد السياسةُ من **نصّها الحيّ** بـ
--    `pg_get_expr(polqual, polrelid)` ويُستبدل المميِّزُ وحده. ونسخةٌ
--    مكتوبةٌ في ملفّ هجرةٍ كانت ستحذف مفاتيحَ سماحٍ لا نعلم بها.
-- 🪤 والأدوارُ تُنسخ حرفياً: `TO public` (قِيس). وتقييدُها بـ`authenticated`
--    كان سيحجب الثيمَ الموسميَّ ومفاتيحَ البوتين عن كلّ زائر.
-- 🪤 والصلاحياتُ الثلاثُ اختيرت من الشاشات التي تقرأ مفتاحاً **خارج** قائمة
--    السماح، لا بالذوق: `moderation_settings` و`cancel_abuse_settings` ←
--    `AdminModeration.tsx:182-183` (`tab_reports`) · `direct_pay_enabled` و
--    `enabled_pay_providers` ← `AdminInvoices.tsx:129-130` (`tab_launch`) ·
--    `season_event_dates` ← `AdminTools.tsx:631` (`tab_tools`).
-- ℹ️ و`taki_admin_perm` تُمرّر الأدمنَ الأعلى بنفسها
--    (`COALESCE(is_super_admin,false) OR …`) فلا حاجةَ لفرعٍ رابع.
DO $pol_select$
DECLARE
  v_using text;
  v_new   text;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_using
    FROM pg_policy pol
   WHERE pol.polname = 'platform_settings_select'
     AND pol.polrelid = 'public.platform_settings'::regclass;

  IF v_using IS NULL THEN
    RAISE EXCEPTION '❌ السياسةُ platform_settings_select غير موجودة — اقرأ قبل أن تكتب';
  END IF;

  -- خاملةُ التكرار: الثانيةُ تنصرف بلا عمل، ولا تُخطئ.
  IF position('is_admin()' IN v_using) = 0 THEN
    IF position('taki_admin_perm' IN v_using) > 0 THEN
      RAISE NOTICE 'ℹ️ platform_settings_select مطبَّقةٌ سابقاً — لا عمل';
      RETURN;
    END IF;
    RAISE EXCEPTION '❌ حالةٌ غيرُ معروفة: لا is_admin ولا taki_admin_perm في السياسة. النصّ: %', v_using;
  END IF;

  v_new := replace(
    v_using,
    '( SELECT is_admin() AS is_admin)',
    '( SELECT public.taki_admin_perm(''tab_tools'')) '
      || 'OR ( SELECT public.taki_admin_perm(''tab_launch'')) '
      || 'OR ( SELECT public.taki_admin_perm(''tab_reports''))'
  );

  -- 🪤 الاستبدالُ على نصٍّ غير موجود **لا يُخطئ**: يبدو الحارسُ عاجزاً وهو
  --    سليم. يُتحقَّق من وقوعِ الحقن قبل أيّ شيء (v14.86).
  IF v_new = v_using THEN
    RAISE EXCEPTION '❌ لم يقع الاستبدال: شكلُ نداء is_admin() تغيّر. النصّ: %', v_using;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings';
  EXECUTE format(
    'CREATE POLICY platform_settings_select ON public.platform_settings FOR SELECT TO public USING (%s)',
    v_new);
END $pol_select$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑨ `platform_settings_write_scoped` — الدفعُ والضريبةُ والتسعيرُ للأعلى
-- ════════════════════════════════════════════════════════════════════════
-- قِيس: سياسةُ الكتابة `FOR ALL` **بلا أيّ شرطِ مفتاح**، وسياسةُ القراءة
-- تحمل قائمةَ سماحٍ صريحة ⇒ أدمنٌ صلاحيّتُه `tab_reports` (مُعالجُ الشكاوى)
-- يُبدّل `enabled_pay_providers` و`tax_settings` و`basic_plan_price_sar`.
--
-- 🪤 ولم أبنِ «قائمةَ سماحٍ لكلّ صلاحيّة»: ذلك يستلزم جردَ خمسةٍ وأربعين
--    مفتاحاً على اثنتي عشرة صلاحيّة، ونسيانُ مفتاحٍ واحدٍ **يُسكت زرَّ حفظٍ
--    قائماً** (وهو أسوأُ من الثغرة: ثغرةٌ كامنةٌ مقابل كسرٍ مؤكَّد). المنعُ
--    صار **قائمةَ منعٍ صغيرةً ومُعلَّلة** تفشل مغلقة: مفاتيحُ المال وحدها
--    للأعلى، وكلُّ ما عداها كما هو اليوم بالضبط.
-- 🪤 والسياسةُ تُبنى من **نصّها الحيّ** ويُضاف شرطٌ واحدٌ بـ`AND` — فلا
--    يُحذف فرعُ صلاحيّةٍ لا نعلم به.
-- ℹ️ أثرُ اليوم **صفر**: الأدمنُ الوحيد على الإنتاج هو الأعلى
--    (قِيس: أدمنٌ واحد، محذوفون ناعماً صفر). ويسري الشرطُ لحظةَ أوّل تفويض.

-- مصدرٌ واحدٌ لقائمة المنع — يُقرأ من السياسة ومن الفحص ومن أيّ شاشةٍ لاحقة.
CREATE OR REPLACE FUNCTION public.taki_setting_is_protected(p_key text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $fn$
  SELECT p_key = ANY (ARRAY[
    -- الدفع والبوّابات
    'payment_gateway_enabled', 'payment_gateway_provider',
    'payment_gateway_publishable_key', 'payment_gateway_webhook_url',
    'payment_publishable_key', 'enabled_pay_providers', 'direct_pay_enabled',
    -- الضريبة
    'tax_settings', 'merchant_vat',
    -- التسعير والباقات
    'basic_plan_price_sar', 'extra_branch_fee_sar', 'trial_days',
    'trial_warning_days_before', 'included_branches', 'default_package_id',
    'location_packages',
    -- الشراء داخل التطبيق
    'iap_products', 'iap_allow_sandbox',
    -- مفتاحُ دفعِ الإشعارات العامّ (تبديلُه يُسكت كلَّ الإشعارات)
    'vapid_public_key'
  ]::text[]);
$fn$;

-- 🪤 السياسةُ `TO public` فالزائرُ المجهول **يقيّم** تعبيرَها عند كلّ
--    قراءةٍ لـ`platform_settings` (شرطُ `USING` لسياسةِ `FOR ALL` يسري على
--    `SELECT` أيضاً). فبلا منحِ تنفيذٍ لـ`anon` يفشل التقييمُ بخطأ صلاحيّة
--    ويعمى الموقعُ العامّ تماماً.
REVOKE ALL ON FUNCTION public.taki_setting_is_protected(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taki_setting_is_protected(text) TO anon, authenticated;

DO $pol_write$
DECLARE
  v_using text;
  v_check text;
  v_cond  text := '(( SELECT public.is_super_admin()) OR NOT public.taki_setting_is_protected(key))';
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid),
         pg_get_expr(pol.polwithcheck, pol.polrelid)
    INTO v_using, v_check
    FROM pg_policy pol
   WHERE pol.polname = 'platform_settings_write_scoped'
     AND pol.polrelid = 'public.platform_settings'::regclass;

  IF v_using IS NULL OR v_check IS NULL THEN
    RAISE EXCEPTION '❌ السياسةُ platform_settings_write_scoped ناقصةٌ أو غير موجودة';
  END IF;

  -- خاملةُ التكرار
  IF position('taki_setting_is_protected' IN v_using) > 0
     AND position('taki_setting_is_protected' IN v_check) > 0 THEN
    RAISE NOTICE 'ℹ️ platform_settings_write_scoped مطبَّقةٌ سابقاً — لا عمل';
    RETURN;
  END IF;

  IF position('has_admin_permission' IN v_using) = 0 THEN
    RAISE EXCEPTION '❌ نصُّ السياسة الحيّ لا يحمل has_admin_permission — انحرف عمّا قِيس. النصّ: %', v_using;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS platform_settings_write_scoped ON public.platform_settings';
  EXECUTE format(
    'CREATE POLICY platform_settings_write_scoped ON public.platform_settings '
    || 'FOR ALL TO public USING ((%s) AND %s) WITH CHECK ((%s) AND %s)',
    v_using, v_cond, v_check, v_cond);
END $pol_write$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑩ `store_analytics_events` — الأدمنُ يُعرَف بصلاحيّته لا بنوعه
-- ════════════════════════════════════════════════════════════════════════
-- قِيس: شرطُ القراءة فرعُه الثاني `uid()::text IN (SELECT users.id FROM users
-- WHERE users.user_type = 'admin')` — استعلامٌ خامٌّ في `public.users` بلا
-- أيّ شرطِ صلاحيّة، وهو السياسةُ الوحيدةُ في المخطّط التي تفعل ذلك.
-- وجارتُها `site_sessions_admin_read` تقول `taki_admin_perm('tab_analytics')`
-- ⇒ وُحِّدتا. (والكاتبُ دالّةُ `DEFINER` فلا سياسةَ إدراجٍ تُمسّ.)
DO $pol_an$
DECLARE v_using text;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_using
    FROM pg_policy pol
   WHERE pol.polname = 'an_select_owner_or_admin'
     AND pol.polrelid = 'public.store_analytics_events'::regclass;

  IF v_using IS NULL THEN
    RAISE EXCEPTION '❌ السياسةُ an_select_owner_or_admin غير موجودة';
  END IF;

  IF position('taki_admin_perm' IN v_using) > 0 THEN
    RAISE NOTICE 'ℹ️ an_select_owner_or_admin مطبَّقةٌ سابقاً — لا عمل';
    RETURN;
  END IF;

  -- حارسُ انحراف: النصُّ المقيس يحمل الاستعلامَ الخامّ. إن لم يحمله فقد
  -- تغيّرت السياسةُ بعد القياس، ولا يُكتب فوق ما لم يُقرأ.
  IF position('user_type' IN v_using) = 0 THEN
    RAISE EXCEPTION '❌ نصُّ an_select_owner_or_admin الحيّ انحرف عمّا قِيس. النصّ: %', v_using;
  END IF;

  EXECUTE 'DROP POLICY IF EXISTS an_select_owner_or_admin ON public.store_analytics_events';
  EXECUTE
    'CREATE POLICY an_select_owner_or_admin ON public.store_analytics_events '
    || 'FOR SELECT TO public USING ('
    || '  (( SELECT auth.uid()))::text = store_id'
    || '  OR ( SELECT public.taki_admin_perm(''tab_analytics''))'
    || ')';
END $pol_an$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑪ `sellers_public` — الدليلُ العامّ لا يقول مَن الإدارة
-- ════════════════════════════════════════════════════════════════════════
-- قِيس حيّاً بلا حساب: `?select=id,name,user_type,contact_phone,lat,lng
-- &user_type=eq.admin` يُعيد المتجرَ المملوكَ لحساب الإدارة باسمه وجوّالِه
-- وإحداثيّاته بدقّةٍ كاملة. والجوّالُ والإحداثيّات **عامّةٌ بالتصميم** لمتجر
-- (هي بياناتُ تواصلِه)، أمّا `user_type` فهو ما يسمح بفرزِ حساباتِ الإدارة
-- — وهو ما تمنعه قاعدةُ «لا تسمية إدارةٍ في أيّ نصٍّ ظاهر».
--
-- 🪤 ولم أُسقط العمود: `CREATE OR REPLACE VIEW` **لا يستطيع حذفَ عمود**،
--    فإسقاطُه يستلزم `DROP VIEW` ⇒ يضيع مشغّلُ «قراءةٌ فقط»
--    (`tr_sellers_public_readonly` — v13.75) وتضيع المنحُ. والأسوأ:
--    `PUBLIC_SELLER_COLUMNS` في `src/repositories/userRepository.ts:22`
--    تطلب `user_type` صراحةً، فحذفُه يُرجع ٤٠٠ فيرتدّ العميلُ إلى جدول
--    `users` الذي لا يقرأ منه الزائرُ شيئاً ⇒ **دليلُ المتاجر يعمى للزوّار**.
--    ⇒ العمودُ باقٍ بنفس الاسم والنوع، وقيمتُه صارت مشتقّةً.
-- ℹ️ وقِيس أنّ لا موضعَ واحداً في `src/` يقرأ `user_type` من صفّ دليل
--    (كلُّ فحوص `userType === 'admin'` على ملفّ المستخدم نفسِه المقروء من
--    `users`)، فالاشتقاقُ بلا أثرٍ على الواجهة.
CREATE OR REPLACE VIEW public.sellers_public AS
  SELECT
    u.id,
    u.name,
    u.shop,
    u.avatar_url,
    u.bio,
    u.contact_phone,
    -- v15.79 — لا تُنشر حقيقةُ النوع. الشرطُ أدناه يستثني المشتريَ أصلاً،
    -- و`CASE` تُبقي الاشتقاقَ صحيحاً لو تغيّر الشرطُ يوماً.
    CASE WHEN u.user_type = 'buyer' THEN 'buyer'::text ELSE 'seller'::text END AS user_type,
    u.lat,
    u.lng,
    u.google_maps_link,
    u.working_hours,
    u.preferred_lang,
    u.created_at
  FROM public.users u
  WHERE u.user_type <> 'buyer'
    AND u.deleted_at IS NULL
    AND COALESCE(u.is_suspended, false) = false;

-- يُعاد تأكيدُ الخاصّية والمنح (خاملةُ التكرار). `CREATE OR REPLACE VIEW`
-- يُبقي المالكَ والمنحَ والمشغّلَ، والتأكيدُ هنا لا يُغيّر شيئاً ويُثبت العقد.
ALTER VIEW public.sellers_public SET (security_barrier = true);
GRANT SELECT ON public.sellers_public TO anon, authenticated;

NOTIFY pgrst, 'reload schema';


-- ════════════════════════════════════════════════════════════════════════
-- التحقّق — كلُّه `DO` يرفع استثناءً
-- 🪤 جدولُ ✅/❌ **لا يُفشل psql**: صفٌّ يقول ❌ ليس خطأً في SQL وحالةُ
--    الخروج تبقى صفراً (v14.50). فالجدولُ في النهاية للقراءة وحدها، وكلُّ
--    حكمٍ هنا فوقه.
-- ════════════════════════════════════════════════════════════════════════

-- ① الخادمُ جدة
DO $v_server$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION '❌ مختبرُ طوكيو';
  END IF;
END $v_server$;

-- ② المالكُ ووضعُ الأمان لم يتبدّلا بالاستبدال — وإلّا انقلب معنى
--    `current_user` في ثلاثة حرّاس، واكتسبت دالّتا الأدمن صلاحياتِ المالك.
DO $v_owner$
DECLARE r record; bad text := '';
BEGIN
  FOR r IN
    SELECT p.proname, p.prosecdef, pg_get_userbyid(p.proowner) AS owner
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND p.proname IN ('tr_guard_user_privileges','tr_guard_booking_integrity',
                         'tr_guard_rating_purchase','has_admin_permission','is_super_admin')
  LOOP
    IF r.owner <> 'postgres' THEN
      bad := bad || format(' %s(owner=%s)', r.proname, r.owner);
    END IF;
    IF r.proname LIKE 'tr_guard_%' AND r.prosecdef THEN
      bad := bad || format(' %s(صارت DEFINER!)', r.proname);
    END IF;
    IF r.proname IN ('has_admin_permission','is_super_admin') AND NOT r.prosecdef THEN
      bad := bad || format(' %s(فقدت DEFINER!)', r.proname);
    END IF;
  END LOOP;
  IF bad <> '' THEN
    RAISE EXCEPTION '❌ تبدّل المالكُ أو وضعُ الأمان:%', bad;
  END IF;
END $v_owner$;

-- ③ قائمةُ أعمدة مشغّل `users` تشمل أعمدةَ الفرض كلَّها
DO $v_cols$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(c.col, ', ') INTO v_missing
    FROM (VALUES ('user_type'),('is_super_admin'),('admin_permissions'),
                 ('is_suspended'),('under_review'),('under_review_at'),
                 ('booking_banned_until'),('booking_ban_reason'),
                 ('deleted_at'),('purge_after'),('is_anonymized'),
                 ('anonymized_at'),('admin_notes')) AS c(col)
   WHERE NOT EXISTS (
     SELECT 1
       FROM pg_trigger t
       JOIN pg_class rel ON rel.oid = t.tgrelid
       JOIN unnest(t.tgattr) AS a(attnum) ON true
       JOIN pg_attribute att ON att.attrelid = t.tgrelid AND att.attnum = a.attnum
      WHERE NOT t.tgisinternal
        AND rel.oid = 'public.users'::regclass
        AND t.tgname = 'tr_guard_user_privileges'
        AND att.attname = c.col);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '❌ أعمدةٌ خارج قائمة المشغّل (فالحارسُ لا يُستدعى لها): %', v_missing;
  END IF;
END $v_cols$;

-- ④ 🔬 هجومٌ حقيقيّ على `users`: شاهدٌ موجبٌ ثمّ فحصٌ سالب، والأثرُ صفر.
DO $v_users_probe$
DECLARE
  v_uid    text;
  v_rows   int;
  v_role   text;
  v_posok  boolean := false;
  v_negok  boolean := false;
  v_code   text := '';
BEGIN
  SELECT id INTO v_uid
    FROM public.users
   WHERE user_type <> 'admin'
     AND COALESCE(is_suspended, false) = false
     AND deleted_at IS NULL
   ORDER BY created_at
   LIMIT 1;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION '❌ غيرُ قاطع: لا حسابَ غيرَ إداريٍّ سليمٍ لإجراء الفحص عليه';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);
    SELECT current_user INTO v_role;
    IF v_role <> 'authenticated' THEN
      RAISE EXCEPTION 'TAKI_PROBE_SETUP: لم يتبدّل الدور (هو %)', v_role;
    END IF;
    IF auth.uid()::text IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'TAKI_PROBE_SETUP: auth.uid() لا يطابق الهويّة المنتحَلة';
    END IF;

    -- الشاهدُ الموجب: كتابةٌ بلا تغييرٍ على نفس العمود. تُثبت ثلاثةً معاً:
    -- أنّ RLS تُبلّغ الصفَّ، وأنّ المشغّلَ يُستدعى على هذا العمود، وأنّ
    -- الحفظَ المتكرّرَ بنفس القيمة لم يُكسر.
    UPDATE public.users SET is_suspended = is_suspended WHERE id = v_uid;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'TAKI_PROBE_SETUP: الشاهدُ الموجب لم يبلغ الصفَّ (صفوف=%)', v_rows;
    END IF;
    v_posok := true;

    -- الفحصُ السالب: رفعُ العقوبة عن نفسه.
    BEGIN
      UPDATE public.users SET is_suspended = true,
                              booking_banned_until = NULL,
                              admin_notes = NULL
       WHERE id = v_uid;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_negok := false;                        -- مرّ! الحارسُ لم يمنع
    EXCEPTION WHEN insufficient_privilege THEN
      v_negok := true;
      v_code  := SQLSTATE;
    END;

    RAISE EXCEPTION 'TAKI_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'TAKI_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);

  IF NOT v_posok THEN
    RAISE EXCEPTION '❌ غيرُ قاطع: الشاهدُ الموجب لم ينجح';
  END IF;
  IF NOT v_negok THEN
    RAISE EXCEPTION '❌ ما زال الموثَّقُ يمحو عقوبتَه بنفسه — الحارسُ لم يمنع';
  END IF;
  RAISE NOTICE '✅ users: الرفضُ وقع بـ% والشاهدُ الموجب مرّ', v_code;
END $v_users_probe$;

-- ⑤ `booking_messages`: السطحُ ذهب، والمشغّلُ موجودٌ ويسبق المحدِّدَ للمعدّل
DO $v_bm$
DECLARE v_earlier text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy pol
              WHERE pol.polrelid = 'public.booking_messages'::regclass
                AND pol.polname = 'booking_messages_insert_party') THEN
    RAISE EXCEPTION '❌ سياسةُ الإدراج المباشر ما زالت قائمة';
  END IF;
  IF has_table_privilege('authenticated', 'public.booking_messages', 'INSERT') THEN
    RAISE EXCEPTION '❌ authenticated ما زال يملك INSERT على الجدول';
  END IF;
  -- 🪤 منحٌ على مستوى العمود ينجو من سحبِ منحِ الجدول
  IF has_column_privilege('authenticated', 'public.booking_messages', 'sender_id', 'INSERT') THEN
    RAISE EXCEPTION '❌ بقي منحُ INSERT على عمود sender_id';
  END IF;
  IF has_table_privilege('anon', 'public.booking_messages', 'INSERT') THEN
    RAISE EXCEPTION '❌ anon ما زال يملك INSERT';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t
                  WHERE t.tgrelid = 'public.booking_messages'::regclass
                    AND NOT t.tgisinternal
                    AND t.tgname = 'tr_a0_bm_force_sender') THEN
    RAISE EXCEPTION '❌ مشغّلُ اشتقاقِ المرسِل غير موجود';
  END IF;
  -- أيّ مشغّلٍ قبليٍّ على الإدراج يسبقه اسمُه يُعيد فتح العيب
  SELECT string_agg(t.tgname, ', ') INTO v_earlier
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.booking_messages'::regclass
     AND NOT t.tgisinternal
     AND (t.tgtype & 2) <> 0          -- BEFORE
     AND (t.tgtype & 4) <> 0          -- INSERT
     AND t.tgname < 'tr_a0_bm_force_sender';
  IF v_earlier IS NOT NULL THEN
    RAISE EXCEPTION '❌ مشغّلٌ قبليٌّ يسبق اشتقاقَ المرسِل: %', v_earlier;
  END IF;
END $v_bm$;

-- ⑥ ولا صفَّ محادثةٍ واحدٌ يخالف الاشتقاق (أي أنّ المشغّلَ مطابقٌ للواقع)
DO $v_bm_rows$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad
    FROM public.booking_messages m
    JOIN public.bookings b ON b.barcode = m.barcode
   WHERE m.sender_id IS DISTINCT FROM
         (CASE WHEN m.sender_role = 'buyer' THEN b.user_id ELSE b.store_id END);
  IF v_bad > 0 THEN
    RAISE EXCEPTION '❌ % صفَّ محادثةٍ لا يطابق الاشتقاق — يلزم فحصُ تلفيقٍ سابق', v_bad;
  END IF;
END $v_bm_rows$;

-- ⑦ `activity_log` و`bookings`: لا سياسةَ ولا منح
DO $v_al_bk$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy pol
              WHERE pol.polrelid = 'public.activity_log'::regclass AND pol.polcmd = 'a') THEN
    RAISE EXCEPTION '❌ بقيت سياسةُ إدراجٍ على activity_log';
  END IF;
  IF has_table_privilege('authenticated', 'public.activity_log', 'INSERT')
     OR has_table_privilege('anon', 'public.activity_log', 'INSERT') THEN
    RAISE EXCEPTION '❌ بقي منحُ INSERT على activity_log';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy pol
                  WHERE pol.polrelid = 'public.activity_log'::regclass
                    AND pol.polname = 'activity_select_admin') THEN
    RAISE EXCEPTION '❌ ضاعت سياسةُ قراءةِ الأدمن على activity_log';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_policy pol
              WHERE pol.polrelid = 'public.bookings'::regclass AND pol.polcmd = 'd') THEN
    RAISE EXCEPTION '❌ بقيت سياسةُ حذفٍ على bookings';
  END IF;
  IF has_table_privilege('authenticated', 'public.bookings', 'DELETE')
     OR has_table_privilege('anon', 'public.bookings', 'DELETE') THEN
    RAISE EXCEPTION '❌ بقي منحُ DELETE على bookings';
  END IF;
  -- والمسارُ الشرعيّ باقٍ: الإدراجُ والتعديلُ والقراءة
  IF NOT (has_table_privilege('authenticated', 'public.bookings', 'INSERT')
          AND has_table_privilege('authenticated', 'public.bookings', 'UPDATE')
          AND has_table_privilege('authenticated', 'public.bookings', 'SELECT')) THEN
    RAISE EXCEPTION '❌ كُسر مسارُ الحجز: ضاع منحٌ لازم على bookings';
  END IF;
END $v_al_bk$;

-- ⑧ 🔬 هجومٌ حقيقيّ: التاجرُ يُعيد كتابةَ جوّالِ المشتري
DO $v_bk_probe$
DECLARE
  v_bc text; v_store text; v_rows int; v_posok boolean := false; v_negok boolean := false;
BEGIN
  SELECT b.barcode, b.store_id INTO v_bc, v_store
    FROM public.bookings b
    JOIN public.users u ON u.id = b.store_id
   WHERE b.store_id IS NOT NULL
   ORDER BY b.created_at DESC
   LIMIT 1;
  IF v_bc IS NULL THEN
    RAISE EXCEPTION '❌ غيرُ قاطع: لا حجزَ لإجراء الفحص عليه';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_store, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    -- شاهدٌ موجب: حقلُ التاجر المشروع يبقى مكتوباً
    UPDATE public.bookings SET prep_time = prep_time WHERE barcode = v_bc;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'TAKI_PROBE_SETUP: الشاهدُ الموجب لم يبلغ الصفَّ (صفوف=%)', v_rows;
    END IF;
    v_posok := true;

    -- فحصٌ سالب: `coalesce(...)||'X'` فالقيمةُ تختلف دائماً ولو كان العمودُ فارغاً
    BEGIN
      UPDATE public.bookings
         SET user_phone = coalesce(user_phone, '') || 'X'
       WHERE barcode = v_bc;
      v_negok := false;
    EXCEPTION WHEN insufficient_privilege THEN
      v_negok := true;
    END;

    RAISE EXCEPTION 'TAKI_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'TAKI_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);

  IF NOT v_posok THEN RAISE EXCEPTION '❌ غيرُ قاطع: شاهدُ prep_time لم ينجح'; END IF;
  IF NOT v_negok THEN RAISE EXCEPTION '❌ التاجرُ ما زال يُعيد كتابةَ جوّال المشتري'; END IF;
  RAISE NOTICE '✅ bookings: جوّالُ المشتري مجمَّدٌ و prep_time يعمل';
END $v_bk_probe$;

-- ⑨ 🔬 هجومٌ حقيقيّ: نقلُ مراجعةٍ إلى عرضٍ آخر
DO $v_rt_probe$
DECLARE
  v_id text; v_owner text; v_rows int; v_posok boolean := false; v_negok boolean := false;
BEGIN
  SELECT r.id, r.user_id INTO v_id, v_owner
    FROM public.ratings r
   WHERE r.deleted_at IS NULL
     AND r.deal_id IS NOT NULL      -- 🪤 بلا هذا يصير `deal_id||'X'` = NULL فلا يختلف
     AND r.user_id IS NOT NULL
   ORDER BY r.created_at DESC
   LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION '❌ غيرُ قاطع: لا مراجعةَ حيّةً بعرضٍ محدَّدٍ لإجراء الفحص';
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    PERFORM set_config('role', 'authenticated', true);

    -- شاهدٌ موجب: تعديلُ النجمةِ بنفس القيمة يمرّ ⇒ بوّابةُ الشراء بالعرض
    -- تسري على الصفوف القائمة بلا كسر.
    UPDATE public.ratings SET score = score WHERE id = v_id;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'TAKI_PROBE_SETUP: شاهدُ score لم يبلغ الصفَّ (صفوف=%)', v_rows;
    END IF;
    v_posok := true;

    BEGIN
      UPDATE public.ratings SET deal_id = deal_id || 'X' WHERE id = v_id;
      v_negok := false;
    EXCEPTION WHEN insufficient_privilege THEN
      v_negok := true;
    END;

    RAISE EXCEPTION 'TAKI_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'TAKI_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;

  PERFORM set_config('role', 'none', true);
  PERFORM set_config('request.jwt.claims', '', true);

  IF NOT v_posok THEN RAISE EXCEPTION '❌ غيرُ قاطع: شاهدُ score لم ينجح'; END IF;
  IF NOT v_negok THEN RAISE EXCEPTION '❌ ما زالت المراجعةُ تُنقَل إلى عرضٍ آخر'; END IF;
  RAISE NOTICE '✅ ratings: هويّةُ المراجعة مجمَّدةٌ وتعديلُ النجمة يعمل';
END $v_rt_probe$;

-- ⑩ المميِّزان صارا يقرآن `deleted_at` — والأدمنُ الحيّ ما زال يمرّ
DO $v_perm$
DECLARE v_admin text; v_bad text := '';
BEGIN
  IF regexp_replace(pg_get_functiondef('public.has_admin_permission(text,text)'::regprocedure),
                    '--[^\n]*', '', 'g') !~ 'deleted_at' THEN
    v_bad := v_bad || ' has_admin_permission';
  END IF;
  IF regexp_replace(pg_get_functiondef('public.is_super_admin(text)'::regprocedure),
                    '--[^\n]*', '', 'g') !~ 'deleted_at' THEN
    v_bad := v_bad || ' is_super_admin';
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION '❌ بقيت بلا شرطِ deleted_at:%', v_bad;
  END IF;

  -- الشاهدُ الموجب: الأدمنُ الأعلى الحيّ لا يُخرَج من بابِه
  SELECT id INTO v_admin FROM public.users
   WHERE user_type = 'admin' AND COALESCE(is_super_admin, false) AND deleted_at IS NULL
   LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION '❌ غيرُ قاطع: لا أدمنَ أعلى سليمٌ للمقارنة';
  END IF;
  IF NOT public.is_super_admin(v_admin) THEN
    RAISE EXCEPTION '❌ الأدمنُ الأعلى الحيّ لم يَعُد يمرّ is_super_admin';
  END IF;
  IF NOT public.has_admin_permission('tab_tools', v_admin) THEN
    RAISE EXCEPTION '❌ الأدمنُ الأعلى الحيّ لم يَعُد يمرّ has_admin_permission';
  END IF;

  -- والمنحُ باقٍ للزائر: سبعُ سياساتٍ TO public تنادي الدالّتين
  IF NOT has_function_privilege('anon', 'public.has_admin_permission(text,text)', 'EXECUTE')
     OR NOT has_function_privilege('anon', 'public.is_super_admin(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ ضاع منحُ anon ⇒ تقييمُ سياساتِ البانرات يفشل للزائر';
  END IF;
END $v_perm$;

-- ⑪ لا `is_admin()` عاريةٌ في أيّ سياسةٍ بعد اليوم، وقائمةُ السماح كاملة
DO $v_settings$
DECLARE v_n int; v_using text; v_keys int;
BEGIN
  SELECT count(*) INTO v_n
    FROM pg_policy pol
   WHERE coalesce(pg_get_expr(pol.polqual, pol.polrelid), '')
      || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ~ '\mis_admin\(';
  IF v_n <> 0 THEN
    RAISE EXCEPTION '❌ بقيت % سياسةً تنادي is_admin() العارية', v_n;
  END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_using
    FROM pg_policy pol
   WHERE pol.polname = 'platform_settings_select'
     AND pol.polrelid = 'public.platform_settings'::regclass;
  IF v_using IS NULL THEN
    RAISE EXCEPTION '❌ ضاعت سياسةُ قراءةِ الإعدادات';
  END IF;
  -- 🪤 قائمةُ السماحِ هي ما يرى الزائرُ. عنصرٌ يضيع = ميزةٌ عامّةٌ تعمى.
  v_keys := array_length(string_to_array(v_using, '''::text'), 1) - 1;
  IF v_keys < 25 THEN
    RAISE EXCEPTION '❌ قائمةُ السماح نقصت: % عنصراً فقط', v_keys;
  END IF;
  IF position('taki_admin_perm' IN v_using) = 0 THEN
    RAISE EXCEPTION '❌ لم يُركَّب المميِّزُ الواعي بالصلاحية';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy pol
                  WHERE pol.polname = 'platform_settings_select'
                    AND pol.polrelid = 'public.platform_settings'::regclass
                    AND 0 = ANY(pol.polroles)) THEN
    RAISE EXCEPTION '❌ أدوارُ السياسة لم تُنسخ حرفياً (ليست TO public)';
  END IF;
END $v_settings$;

-- ⑫ 🔬 الزائرُ المجهول ما زال يقرأ ما له، ولا يقرأ ما ليس له
DO $v_anon$
DECLARE v_pub int; v_prot int;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    PERFORM set_config('role', 'anon', true);
    SELECT count(*) INTO v_pub  FROM public.platform_settings WHERE key = 'seasonal_theme';
    SELECT count(*) INTO v_prot FROM public.platform_settings WHERE key = 'payment_gateway_webhook_url';
    RAISE EXCEPTION 'TAKI_PROBE_ROLLBACK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'TAKI_PROBE_ROLLBACK' THEN RAISE; END IF;
  END;
  PERFORM set_config('role', 'none', true);

  IF v_pub <> 1 THEN
    RAISE EXCEPTION '❌ عمي الموقعُ العامّ: الزائرُ لم يقرأ seasonal_theme';
  END IF;
  IF v_prot <> 0 THEN
    RAISE EXCEPTION '❌ الزائرُ يقرأ مفتاحاً خارج قائمة السماح';
  END IF;
  RAISE NOTICE '✅ الزائر: قائمةُ السماح تعمل والمفاتيحُ الأخرى محجوبة';
END $v_anon$;

-- ⑬ نطاقُ مفاتيح المال مُركَّبٌ على جانبَي سياسةِ الكتابة، وأسماؤه حقيقيّة
DO $v_prot$
DECLARE v_u text; v_c text; v_missing text;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid), pg_get_expr(pol.polwithcheck, pol.polrelid)
    INTO v_u, v_c
    FROM pg_policy pol
   WHERE pol.polname = 'platform_settings_write_scoped'
     AND pol.polrelid = 'public.platform_settings'::regclass;
  IF v_u IS NULL OR position('taki_setting_is_protected' IN v_u) = 0
                 OR position('taki_setting_is_protected' IN coalesce(v_c, '')) = 0 THEN
    RAISE EXCEPTION '❌ نطاقُ المفاتيح غيرُ مُركَّبٍ على الجانبين';
  END IF;
  IF position('has_admin_permission' IN v_u) = 0 THEN
    RAISE EXCEPTION '❌ ضاعت فروعُ الصلاحيّات من سياسةِ الكتابة';
  END IF;
  -- 🪤 مفتاحٌ مكتوبٌ خطأً في القائمة يحمي لا شيء ولا يصرخ
  SELECT string_agg(k, ', ') INTO v_missing
    FROM (SELECT key AS k FROM public.platform_settings) s
   WHERE false;   -- placeholder, replaced below
  SELECT string_agg(k, ', ') INTO v_missing FROM (
    SELECT k FROM unnest(ARRAY[
      'payment_gateway_enabled','payment_gateway_provider',
      'payment_gateway_publishable_key','payment_gateway_webhook_url',
      'payment_publishable_key','enabled_pay_providers','direct_pay_enabled',
      'tax_settings','merchant_vat',
      'basic_plan_price_sar','extra_branch_fee_sar','trial_days',
      'trial_warning_days_before','included_branches','default_package_id',
      'location_packages','iap_products','iap_allow_sandbox','vapid_public_key'
    ]::text[]) AS k
     WHERE NOT EXISTS (SELECT 1 FROM public.platform_settings ps WHERE ps.key = k)
  ) m;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION '❌ مفاتيحُ منعٍ لا وجودَ لها (فلا تحمي شيئاً): %', v_missing;
  END IF;
  IF NOT public.taki_setting_is_protected('tax_settings') THEN
    RAISE EXCEPTION '❌ مفتاحُ الضريبة غيرُ محميّ';
  END IF;
  IF public.taki_setting_is_protected('seasonal_theme') THEN
    RAISE EXCEPTION '❌ مفتاحٌ عامٌّ صُنّف محميّاً (حالةٌ موجبةٌ كاذبة)';
  END IF;
  IF NOT has_function_privilege('anon', 'public.taki_setting_is_protected(text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ بلا منحٍ لـanon يفشل تقييمُ السياسة فيعمى الموقعُ العامّ';
  END IF;
END $v_prot$;

-- ⑭ تحليلاتُ المتاجر صارت بصلاحيّة لا بنوع
DO $v_an$
DECLARE v_using text;
BEGIN
  SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_using
    FROM pg_policy pol
   WHERE pol.polname = 'an_select_owner_or_admin'
     AND pol.polrelid = 'public.store_analytics_events'::regclass;
  IF v_using IS NULL OR position('taki_admin_perm' IN v_using) = 0 THEN
    RAISE EXCEPTION '❌ سياسةُ تحليلاتِ المتاجر لم تُركَّب';
  END IF;
  IF v_using ~ 'FROM users' THEN
    RAISE EXCEPTION '❌ بقي الاستعلامُ الخامُّ في public.users داخل السياسة';
  END IF;
END $v_an$;

-- ⑮ `sellers_public`: لا إدارةَ في الدليل، وكلُّ شيءٍ آخر كما كان
DO $v_view$
DECLARE v_admins int; v_rows int; v_expect int;
BEGIN
  SELECT count(*) INTO v_admins FROM public.sellers_public WHERE user_type = 'admin';
  IF v_admins <> 0 THEN
    RAISE EXCEPTION '❌ الدليلُ ما زال يقول من الإدارة (% صفّاً)', v_admins;
  END IF;

  -- العددُ لم ينقص: الدليلُ لم يفقد متجراً
  SELECT count(*) INTO v_rows FROM public.sellers_public;
  SELECT count(*) INTO v_expect FROM public.users u
   WHERE u.user_type <> 'buyer' AND u.deleted_at IS NULL
     AND COALESCE(u.is_suspended, false) = false;
  IF v_rows <> v_expect THEN
    RAISE EXCEPTION '❌ عددُ صفوفِ الدليل تغيّر: % بدل %', v_rows, v_expect;
  END IF;

  -- والعقدُ مع العميل باقٍ: العمودُ موجودٌ بنفس الاسم (وإلّا رجع ٤٠٠ وعمي الدليل)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'sellers_public'
                    AND column_name = 'user_type') THEN
    RAISE EXCEPTION '❌ ضاع العمودُ user_type ⇒ PUBLIC_SELLER_COLUMNS يُرجع ٤٠٠';
  END IF;
  IF NOT (has_table_privilege('anon', 'public.sellers_public', 'SELECT')
          AND has_table_privilege('authenticated', 'public.sellers_public', 'SELECT')) THEN
    RAISE EXCEPTION '❌ ضاع منحُ القراءة على الدليل';
  END IF;
  IF has_table_privilege('anon', 'public.sellers_public', 'UPDATE')
     OR has_table_privilege('anon', 'public.sellers_public', 'INSERT')
     OR has_table_privilege('anon', 'public.sellers_public', 'DELETE') THEN
    RAISE EXCEPTION '❌ صار الدليلُ قابلاً للكتابة من الزائر (كسرُ v13.75)';
  END IF;
  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.sellers_public'::regclass))
     <> 'postgres' THEN
    RAISE EXCEPTION '❌ تبدّل مالكُ الدليل ⇒ تبدّل تجاوزُه لـRLS';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class
                  WHERE oid = 'public.sellers_public'::regclass
                    AND reloptions::text ~ 'security_barrier=true') THEN
    RAISE EXCEPTION '❌ ضاعت خاصّيةُ security_barrier';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid = 'public.sellers_public'::regclass
                    AND NOT tgisinternal AND tgname = 'tr_sellers_public_readonly') THEN
    RAISE EXCEPTION '❌ ضاع مشغّلُ «قراءةٌ فقط» على الدليل (v13.75)';
  END IF;
END $v_view$;


-- ════════════════════════════════════════════════════════════════════════
-- جدولُ القراءة (بعد كلّ الأحكام أعلاه — لا يُفشل شيئاً بنفسه)
-- ════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS بند,
       coalesce(obj_description('public'::regnamespace, 'pg_namespace'), 'جدة — الإنتاج') AS قيمة
UNION ALL SELECT '① أعمدةُ الفرض على users داخل قائمة المشغّل',
  (SELECT count(*)::text FROM pg_trigger t
     JOIN unnest(t.tgattr) AS a(attnum) ON true
    WHERE t.tgrelid = 'public.users'::regclass AND t.tgname = 'tr_guard_user_privileges')
UNION ALL SELECT '② سياسةُ إدراج booking_messages المباشرة',
  CASE WHEN NOT EXISTS (SELECT 1 FROM pg_policy
                         WHERE polrelid = 'public.booking_messages'::regclass
                           AND polname = 'booking_messages_insert_party')
       THEN '✅ أُسقطت' ELSE '❌ قائمة' END
UNION ALL SELECT '② منحُ INSERT على booking_messages لـauthenticated',
  CASE WHEN NOT has_table_privilege('authenticated','public.booking_messages','INSERT')
       THEN '✅ سُحب' ELSE '❌ باقٍ' END
UNION ALL SELECT '③ منحُ INSERT على activity_log',
  CASE WHEN NOT has_table_privilege('authenticated','public.activity_log','INSERT')
       THEN '✅ سُحب' ELSE '❌ باقٍ' END
UNION ALL SELECT '④ منحُ DELETE على bookings',
  CASE WHEN NOT has_table_privilege('authenticated','public.bookings','DELETE')
       THEN '✅ سُحب' ELSE '❌ باقٍ' END
UNION ALL SELECT '⑧ سياساتٌ تنادي is_admin() العارية',
  (SELECT count(*)::text FROM pg_policy pol
    WHERE coalesce(pg_get_expr(pol.polqual,pol.polrelid),'')
       || coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),'') ~ '\mis_admin\(')
UNION ALL SELECT '⑨ مفاتيحُ المال المحميّة',
  (SELECT count(*)::text FROM public.platform_settings
    WHERE public.taki_setting_is_protected(key))
UNION ALL SELECT '⑪ حساباتُ إدارةٍ ظاهرةٌ في الدليل العامّ',
  (SELECT count(*)::text FROM public.sellers_public WHERE user_type = 'admin')
UNION ALL SELECT 'سياساتُ RLS الكليّة',
  (SELECT count(*)::text FROM pg_policy pol JOIN pg_class c ON c.oid = pol.polrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public');


-- ════════════════════════════════════════════════════════════════════════
-- ROLLBACK — عودةٌ إلى حالةِ ما قبل v15.79، كتلةً كتلة.
-- 🔴 قراءةٌ قبل الاستعمال: كلُّ كتلةٍ هنا **تُعيد فتحَ ثغرةٍ مقيسة**. لا
--    تُنفَّذ إلّا بقرارِ ناصر وبعد معرفة ماذا تُعيد. والاستعادةُ الكاملةُ
--    تكون بالنسخة الاحتياطيّة لا بهذا.
-- ════════════════════════════════════════════════════════════════════════
--
-- ① users — إعادةُ الحارس إلى الامتيازات وحدها (يُعيد: محوُ العقوبة ذاتياً)
--   DROP TRIGGER IF EXISTS tr_guard_user_privileges ON public.users;
--   CREATE TRIGGER tr_guard_user_privileges
--     BEFORE UPDATE OF user_type, is_super_admin, admin_permissions
--     ON public.users FOR EACH ROW EXECUTE FUNCTION public.tr_guard_user_privileges();
--   -- وجسمُ الدالّة يُستعاد بنصّه السابق من
--   -- supabase/JEDDAH_v14_38_subpermissions.sql أو من نسخةِ القاعدة.
--
-- ② booking_messages — إعادةُ السطح المباشر (يُعيد: تلفيقُ مُرسِل)
--   DROP TRIGGER IF EXISTS tr_a0_bm_force_sender ON public.booking_messages;
--   DROP FUNCTION IF EXISTS public.tr_bm_force_sender();
--   GRANT INSERT ON TABLE public.booking_messages TO authenticated;
--   CREATE POLICY booking_messages_insert_party ON public.booking_messages
--     FOR INSERT TO public WITH CHECK (EXISTS ( SELECT 1
--       FROM bookings b
--      WHERE ((b.barcode = booking_messages.barcode)
--        AND (((booking_messages.sender_role = 'buyer'::text)
--              AND ((( SELECT uid() AS uid))::text = b.user_id))
--          OR ((booking_messages.sender_role = 'seller'::text)
--              AND ((( SELECT uid() AS uid))::text = b.store_id))))));
--
-- ③ activity_log — (يُعيد: تلفيقُ سجلّ العمليات)
--   GRANT INSERT, UPDATE, DELETE ON TABLE public.activity_log TO authenticated;
--   CREATE POLICY activity_insert_self ON public.activity_log
--     FOR INSERT TO public
--     WITH CHECK (((( SELECT uid() AS uid))::text = user_id) OR (user_id IS NULL));
--
-- ④ bookings — (يُعيد: حرقُ كمّية التاجر بالحذف)
--   GRANT DELETE ON TABLE public.bookings TO authenticated;
--   CREATE POLICY bookings_delete_own ON public.bookings FOR DELETE TO public
--     USING ((paid_at IS NULL) AND (status <> ALL (ARRAY['completed'::text,'cancelled'::text]))
--       AND (NOT (EXISTS ( SELECT 1 FROM order_invoices oi
--            WHERE ((oi.barcode = bookings.barcode) AND (oi.invoice_no IS NOT NULL)))))
--       AND ((( SELECT (uid())::text AS uid) = user_id)
--         OR (( SELECT (uid())::text AS uid) = store_id)));
--
-- ⑤ bookings — حذفُ أربعةِ أسطرٍ من قائمةِ التجميد في
--   public.tr_guard_booking_integrity(): user_name · user_phone · notes ·
--   created_at. (يُعيد: التاجرُ يكتب هويّةَ المشتري.) النصُّ السابق كاملاً
--   في supabase/JEDDAH_v14_11_booking_total.sql ومشتقّاته.
--
-- ⑥ ratings — حذفُ كتلةِ التجميد وشرطِ `b.deal_id = NEW.deal_id`، وإعادةُ
--   `IF public.is_admin() THEN RETURN NEW; END IF;` مكان
--   `taki_admin_perm('tab_reports')`. (يُعيد: نقلُ المراجعة.)
--
-- ⑦ المميِّزان — حذفُ سطرِ `AND u.deleted_at IS NULL` من
--   public.has_admin_permission(text,text) و public.is_super_admin(text)
--   بـ CREATE OR REPLACE بنفس التوقيعَين. (يُعيد: أدمنٌ محذوفٌ يكتب.)
--
-- ⑧ platform_settings_select — (يُعيد: أدمنٌ فرعيٌّ يقرأ كلَّ المفاتيح)
--   DO $rb$ DECLARE v text; BEGIN
--     SELECT pg_get_expr(polqual, polrelid) INTO v FROM pg_policy
--      WHERE polname='platform_settings_select'
--        AND polrelid='public.platform_settings'::regclass;
--     v := replace(v, '( SELECT public.taki_admin_perm(''tab_tools'')) '
--                     'OR ( SELECT public.taki_admin_perm(''tab_launch'')) '
--                     'OR ( SELECT public.taki_admin_perm(''tab_reports''))',
--                     '( SELECT is_admin() AS is_admin)');
--     EXECUTE 'DROP POLICY platform_settings_select ON public.platform_settings';
--     EXECUTE format('CREATE POLICY platform_settings_select ON public.platform_settings '
--                    'FOR SELECT TO public USING (%s)', v);
--   END $rb$;
--
-- ⑨ platform_settings_write_scoped — (يُعيد: أدمنُ شكاوى يبدّل الدفع)
--   DROP POLICY IF EXISTS platform_settings_write_scoped ON public.platform_settings;
--   CREATE POLICY platform_settings_write_scoped ON public.platform_settings
--     FOR ALL TO public
--     USING ((( SELECT is_super_admin() AS is_super_admin)
--             OR has_admin_permission('tab_tools'::text)
--             OR has_admin_permission('tab_launch'::text)
--             OR has_admin_permission('tab_reports'::text)))
--     WITH CHECK ((( SELECT is_super_admin() AS is_super_admin)
--             OR has_admin_permission('tab_tools'::text)
--             OR has_admin_permission('tab_launch'::text)
--             OR has_admin_permission('tab_reports'::text)));
--   DROP FUNCTION IF EXISTS public.taki_setting_is_protected(text);
--
-- ⑩ store_analytics_events — (يُعيد: أيُّ أدمنٍ يقرأ تحليلاتِ كلّ تاجر)
--   DROP POLICY IF EXISTS an_select_owner_or_admin ON public.store_analytics_events;
--   CREATE POLICY an_select_owner_or_admin ON public.store_analytics_events
--     FOR SELECT TO public
--     USING (((( SELECT uid() AS uid))::text = store_id)
--        OR ((( SELECT uid() AS uid))::text IN ( SELECT users.id FROM users
--             WHERE (users.user_type = 'admin'::text))));
--
-- ⑪ sellers_public — (يُعيد: فرزُ حساباتِ الإدارة بلا حساب)
--   CREATE OR REPLACE VIEW public.sellers_public AS
--     SELECT u.id, u.name, u.shop, u.avatar_url, u.bio, u.contact_phone,
--            u.user_type, u.lat, u.lng, u.google_maps_link, u.working_hours,
--            u.preferred_lang, u.created_at
--       FROM public.users u
--      WHERE u.user_type <> 'buyer' AND u.deleted_at IS NULL
--        AND COALESCE(u.is_suspended, false) = false;
--   NOTIFY pgrst, 'reload schema';
-- ════════════════════════════════════════════════════════════════════════
