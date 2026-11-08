-- ════════════════════════════════════════════════════════════════════════
-- TAKI · v15.80 — الحجبُ يَحجب: علاقةٌ بين شخصين تُفرَض في القاعدة
--                 لا زرٌّ يُصفّي قائمةً
--
-- تُشغَّل على **جدة (الإنتاج)** بالدور `supabase_admin`. آمنةٌ للتكرار،
-- وكلُّها داخل معاملةٍ واحدة (لا `CONCURRENTLY` ولا `ALTER TYPE`).
--
-- ───────────────────────── لماذا، ومقيساً ─────────────────────────
-- 🔴 «لا توجد وسيلةٌ لحجب مُسيء» **خطأ في جملته الأولى، والحقيقةُ أسوأ**:
--    الحجبُ موجودٌ منذ زمن — `users.blocked_merchants` و`toggleBlockMerchant`
--    (`src/context/AppContext.tsx:1274`) وزرُّ 🚫 في صفحة المتجر ونظيرُه في
--    تيليجرام (`bot_toggle_block`). اسمُه «حجب»، ويفهمه المستخدم حجباً،
--    **وهو لا يحجب**: مصفوفةُ نصٍّ على صفِّ الحاجب نفسِه، مفتاحُها *متجرٌ*،
--    لا تقرؤها إلّا أربعُ دوالِّ قراءةٍ تَرسم قوائم.
--    قِيس على جدة (التعليقُ مجرَّدٌ قبل الفحص — درسُ v15.22):
--      • دوالٌّ تقرأ `blocked_merchants`: `bot_get_deal` · `bot_get_store`
--        · `bot_toggle_block` · `handle_smart_alerts_backfill` — **وصفرُ
--        دالّةٍ كاتبةٍ للرسائل**.
--      • فالتاجرُ المحجوب يراسل المشتري من الموقع ومن البوتين، ويصل المشتريَ
--        إشعارٌ ودفعٌ. والسقفُ الوحيد `per_hour=120` لكلّ شخصٍ عبر كلّ حجوزاته
--        (و`per_booking=0` ⇒ **لا سقفَ لكلّ طلب إطلاقاً**).
--      • ولا شكلَ يحجب به **التاجرُ مشترياً**: اسمُ العمود يلزمه أن يعني عكسَه.
--    وقاعدةُ آبل ١٫٢ للمحتوى الذي يُنشئه المستخدمون تشترط وسيلةَ حجبٍ عاملة،
--    فهذا حاجزُ متجرٍ أيضاً لا عيبَ منتجٍ وحده.
--
-- ⚠️ وقِيس أيضاً ما **تغيّر** قبل هذه الهجرة ولا يُعاد إصلاحه:
--    • `authenticated` **لم يبقَ له INSERT** على `booking_messages`، وسياسةُ
--      الإدراج المباشر **مُسقَطة** (v15.79) ⇒ الكاتبان دالّتان فقط.
--    • و`tr_a0_bm_force_sender` **يُثبِّت `sender_id`** من `sender_role` أصلاً.
--    ⇒ فهذا الحارسُ **حزامٌ** لا السدّ الوحيد. وقيمتُه أنه نقطةُ خَنقٍ واحدة
--      يمرّ بها **كلُّ** كاتبٍ حاضرٍ أو قادم، فلا يُنسى في دالّةٍ ثالثة.
--    🪤 ومع ذلك **لا يُشتقّ الفاعلُ من `NEW.sender_id` أبداً**: `sender_role`
--       هو وحده ما كانت سياسةُ RLS تربطه بـ`uid()`، وهو ما يعتمده
--       `tr_booking_message_recipient` الحيّ. والاشتقاقُ من `sender_role`
--       يبقى صحيحاً حتى لو أُسقط مُثبِّتُ `sender_id` غداً.
--
-- ─────────────────── التناظرُ: الطلبُ الجاري لا يُقطع ───────────────────
-- 🔴 تاكي **لا تملك المال**: الدفعُ إلى بوّابة التاجر بمفاتيحه، و`cancel_booking`
--    ترفض إلغاء طلبٍ مدفوع (`P0014`) لأن الردَّ بيد التاجر. فحجبٌ قاطعٌ على
--    طلبٍ مدفوعٍ أو طلبِ توصيلٍ جارٍ **يصنع طلباً لا يُسلَّم ولا يُردّ** —
--    وهذا ضررٌ أحدثناه نحن لا المُسيء.
--    فالاستثناء: ما دام الطلبُ مفتوحاً **ومدفوعاً أو توصيلاً**، لكلٍّ من
--    الطرفين عددٌ محدود من الرسائل (`chat_limits.blocked_inflight`)،
--    **تُحسب من لحظة الحجب لا من أوّل المحادثة** — وإلّا فمن تحدّث قبل الحجب
--    يبلغ سقفَه فوراً فيُستأنَف الضررُ بعينه (توصيلٌ عالق).
--    🪤 وغيرُ المحدود ثقبٌ: لولا الحدُّ لصار كلُّ تاجرٍ له طلبٌ مفتوحٌ
--       غيرَ قابلٍ للحجب. وقِيس أن التاجرَ **لا يستطيع اختلاق طلب**:
--       `bookings_insert_auth` تشترط `uid() = user_id` و`authenticated`
--       وحده يملك INSERT ⇒ المشتري هو من يُنشئ الطلب، فمجموعُ الاستثناء
--       محدودٌ بالطلبات التي فتحها المشتري نفسُه قبل الحجب.
--    وطلبُ الاستلام غيرُ المدفوع **يُحجب قطعاً**: إلغاؤه حرٌّ بلا مالٍ معلّق.
--
-- ─────────────────── ولا يُعلم المحجوبُ أنه محجوب ───────────────────
-- وإلّا صار الحجبُ دعوةً للانتقام. فثلاثةٌ معاً: سياسةُ القراءة تُظهر صفوفَ
-- الحاجب وحده؛ والرمزُ المعاد `P0032`/`P0033` مُعتِمٌ كبقيّة رموز هذا الملفّ
-- (`P0002`…`P0017`) لا كلمةَ «محجوب»؛ ونصُّ الرفض محايدٌ يقرأه القارئ سقفَ
-- رسائلَ عادياً. وفي البوتين يسقط إلى «تعذّر الإرسال» العامّ **عن عمد**
-- (انظر `server/lib/chatView.js`).
--
-- ⚠️ وما لا تمسّه هذه الهجرة عن عمد:
--    • التقييماتُ والبلاغاتُ والشكاوى: الحجبُ لا يُسكت ناقداً. `ratings`
--      عامّةٌ للقراءة، ولو أسكتها الحجبُ لصار أداةَ تاجرٍ يدفن نقّاده.
--      و`tr_guard_report_insert` يبقى بلا فحصِ حجب: تُبلِّغ عمّن حجبتَه دائماً.
--      والمحجوبُ يُمنع من **الردّ العامّ** على تقييمٍ (`set_rating_reply`) لا
--      من التقييم.
--    • الحجزُ نفسُه: لا يُمنع. مَنعُه مسٌّ بمسار المخزون والدفع، وللحاجب
--      مخرجٌ أرخص (يفكّ الحجب) — ويُسجَّل بنداً في التقرير لا يُنفَّذ هنا.
--    • `browse_deals`/`browse_nearby`: تأخذان `p_blocked` من العميل. تثبيتُها
--      في الخادم بندٌ مستقلّ (الأثرُ: حزمةٌ قديمة على آيفون تُرجع عروضَ
--      المحجوب إلى **خلاصة صاحبِها هو** — عيبُ تجربةٍ لا ثقبُ أمان).
--    • `taki_dispatch_smart_alert` (٣٧٣ سطراً): لم يُعَد إصدارُه. مساراتُ
--      النشرِ الثلاثةُ كلُّها مُصفّاةٌ الآن عند المنادي (`handle_smart_alerts_backfill`
--      كان مُصفّىً أصلاً)، فحزامُ الورقةِ زيادةٌ بكلفةِ إعادةِ إصدارِ أطولِ
--      دالّةٍ في المسار.
-- ════════════════════════════════════════════════════════════════════════

-- ① حارسُ المختبر — أوّلُ عبارةٍ دائماً
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION '⛔ هذه هجرةُ إنتاج (جدة) — ومُنعت على مختبر طوكيو.';
  END IF;
END $guard$;

-- ② وشرطٌ مسبقٌ يُفشل الهجرةَ لا يُحذّر: الأعمدةُ والمشغّلاتُ التي يقف
--    عليها التصميم. لو تغيّر أحدُها لاحقاً فالهجرةُ تتوقّف بسببٍ مفهوم،
--    لا تُركّب حارساً يحرس شيئاً غير موجود.
DO $pre$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='bookings' AND column_name='paid_at') THEN
    RAISE EXCEPTION '❌ `bookings.paid_at` غائب — استثناءُ الطلب الجاري يقوم عليه.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='bookings' AND column_name='fulfillment') THEN
    RAISE EXCEPTION '❌ `bookings.fulfillment` غائب — استثناءُ التوصيل يقوم عليه.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='users' AND column_name='blocked_merchants') THEN
    RAISE EXCEPTION '❌ `users.blocked_merchants` غائب — المرآةُ تقوم عليه.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid='public.booking_messages'::regclass AND tgname='tr_aa_rate_limit_message') THEN
    RAISE EXCEPTION '❌ `tr_aa_rate_limit_message` غائب — ترتيبُ الحارس قبله جزءٌ من التصميم.';
  END IF;
END $pre$;

-- ════════════════════════════════════════════════════════════════════════
-- ③ الجدول: علاقةٌ بين شخصين، في الاتجاهين، ومصدرٌ واحد
-- ════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.user_blocks (
  blocker_id text        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id text        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_blocks_pkey       PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self   CHECK (blocker_id <> blocked_id),
  CONSTRAINT user_blocks_reason_len CHECK (reason IS NULL OR length(reason) <= 300)
);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON public.user_blocks(blocked_id);

COMMENT ON TABLE public.user_blocks IS
  'الحجبُ بين شخصين في الاتجاهين — المصدرُ الوحيد. و users.blocked_merchants مرآةٌ مشتقّة (صفوفُ مشترٍ←تاجر) يحفظها مشغّلٌ واحد، تقرؤها دوالُّ التصفية القائمة بلا إعادة كتابة.';
COMMENT ON COLUMN public.user_blocks.created_at IS
  'لحظةُ الحجب. ليست توثيقاً: عليها تُحسب رسائلُ الطلب الجاري المسموحة بعد الحجب.';

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

-- صفوفُك وحدها، ولا UPDATE: فكُّ الحجب **حذفٌ** لا تعديلُ عَلَم.
-- 🪤 ولا يقرأ المحجوبُ أنه محجوب — ولذلك السياسةُ على `blocker_id` وحده.
DROP POLICY IF EXISTS user_blocks_select_own ON public.user_blocks;
CREATE POLICY user_blocks_select_own ON public.user_blocks
  FOR SELECT TO authenticated
  USING ((SELECT auth.uid())::text = blocker_id);

DROP POLICY IF EXISTS user_blocks_insert_own ON public.user_blocks;
CREATE POLICY user_blocks_insert_own ON public.user_blocks
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT auth.uid())::text = blocker_id);

DROP POLICY IF EXISTS user_blocks_delete_own ON public.user_blocks;
CREATE POLICY user_blocks_delete_own ON public.user_blocks
  FOR DELETE TO authenticated
  USING ((SELECT auth.uid())::text = blocker_id);

-- 🔴 والسحبُ من `authenticated` **لازمٌ ولا يُستغنى عنه بالمنح الصريح**:
--    الامتيازاتُ الافتراضيّة على `public` تمنحه `arwdm` على **كلّ جدولٍ
--    جديد** تلقائياً (قِيس: `pg_default_acl` ⇒ `supabase_admin → public :
--    authenticated=arwdm/supabase_admin`). فسحبٌ من `PUBLIC` ومن `anon`
--    وحدهما يترك `UPDATE` قائماً، والمنحُ التالي لا يُنقصه — والنتيجةُ أنّ
--    فاكَّ الحجب يستطيع **تعديلَ `created_at`** فيُمدّد استثناءَ الطلب
--    الجاري بلا حدّ. وهذه صيغةٌ ثالثةٌ من فخّ «REVOKE من جهةٍ لا يُلغي منحَ
--    جهةٍ أخرى»: لا PUBLIC ولا anon — بل المنحُ **الافتراضيّ**.
--    (وقد أمسكها فحصُ هذا الملفّ نفسُه في تجربةٍ مُرجَعة قبل الشحن.)
REVOKE ALL ON public.user_blocks FROM PUBLIC;
REVOKE ALL ON public.user_blocks FROM anon;
REVOKE ALL ON public.user_blocks FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.user_blocks TO postgres;   -- دوالٌّ مملوكةٌ لـpostgres تكتبه
GRANT ALL    ON public.user_blocks TO service_role;

-- ════════════════════════════════════════════════════════════════════════
-- ④ المحدِّد — تعريفٌ **واحد** للبحث، فلا تنحرف نسختان
--    🪤 ولا يُمنح لمستخدمٍ إطلاقاً: وإلّا صار سطحاً يُسأل «هل حجبني فلان؟».
-- ════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.taki_block_since(text, text);
CREATE FUNCTION public.taki_block_since(p_a text, p_b text)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT min(created_at) FROM public.user_blocks
   WHERE (blocker_id = p_a AND blocked_id = p_b)
      OR (blocker_id = p_b AND blocked_id = p_a);
$$;
REVOKE ALL ON FUNCTION public.taki_block_since(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_block_since(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_block_since(text, text) FROM authenticated;
-- 🪤 و`postgres` **ليس superuser هنا** (قِيس: `rolsuper=false`)، ودوالٌّ
--    كثيرةٌ في هذا المسار مملوكةٌ له ⇒ بلا هذا المنح تفشل بـ«permission denied».
GRANT EXECUTE ON FUNCTION public.taki_block_since(text, text) TO postgres, service_role;

DROP FUNCTION IF EXISTS public.taki_is_blocked_pair(text, text);
CREATE FUNCTION public.taki_is_blocked_pair(p_a text, p_b text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT public.taki_block_since(p_a, p_b) IS NOT NULL;
$$;
REVOKE ALL ON FUNCTION public.taki_is_blocked_pair(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_is_blocked_pair(text, text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_is_blocked_pair(text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_is_blocked_pair(text, text) TO postgres, service_role;

-- ════════════════════════════════════════════════════════════════════════
-- ⑤ المرآة — كاتبٌ **واحد** لـ`blocked_merchants`
--    (كان للويب كاتبٌ وللبوت كاتبٌ آخر، وانحرفا: البوتُ لا يُسقط المتابعة
--     فيظلّ مسارُ المتابعة يُشعر من حجبتَه.)
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tr_user_blocks_mirror()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_blocker text; v_blocked text; v_type text;
BEGIN
  v_blocker := COALESCE(NEW.blocker_id, OLD.blocker_id);
  v_blocked := COALESCE(NEW.blocked_id, OLD.blocked_id);
  SELECT user_type INTO v_type FROM public.users WHERE id = v_blocked;

  -- 🪤 بـ«ليس مشترياً» لا بـ«بائع»: متجرُ ناصر يملكه حسابٌ أدمن، ومرشِّحُ
  --    `user_type='seller'` كان يُخفيه دائماً.
  IF COALESCE(v_type, '') = 'buyer' THEN
    RETURN NULL;                       -- حجبُ مشترٍ لا مرآةَ له: العمودُ للمتاجر
  END IF;

  IF TG_OP = 'INSERT' THEN
    UPDATE public.users
       SET blocked_merchants  = ARRAY(SELECT DISTINCT e
                                        FROM unnest(COALESCE(blocked_merchants, '{}'::text[])
                                                    || ARRAY[v_blocked]) e),
           followed_merchants = array_remove(COALESCE(followed_merchants, '{}'::text[]), v_blocked)
     WHERE id = v_blocker;
  ELSE
    UPDATE public.users
       SET blocked_merchants = array_remove(COALESCE(blocked_merchants, '{}'::text[]), v_blocked)
     WHERE id = v_blocker;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_user_blocks_mirror ON public.user_blocks;
CREATE TRIGGER tr_user_blocks_mirror
  AFTER INSERT OR DELETE ON public.user_blocks
  FOR EACH ROW EXECUTE FUNCTION public.tr_user_blocks_mirror();

-- ════════════════════════════════════════════════════════════════════════
-- ⑥ بياناتٌ شخصية ⇒ تُمحى عند التجهيل (قاعدةُ v14.77)
--    🪤 ولم أُعِد إصدارَ `purge_expired_accounts` (١٢٣ سطراً، أُعيدت كتابتُها
--       قبل ساعات): مشغّلٌ عند **عَلَم التجهيل نفسِه** يُغطّي كلَّ مسارٍ
--       يُجهّل حساباً، حاضراً أو قادماً، ولا يحتاج أحداً أن يتذكّر.
--    🪤 و`UPDATE OF` يُطلَق بقائمةِ أعمدةِ العبارة لا بتغيّرِ القيمة
--       (درسٌ مدفوع) ⇒ شرطُ `WHEN` هو الحَكَم.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tr_purge_user_blocks_on_anon()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  DELETE FROM public.user_blocks WHERE blocker_id = NEW.id OR blocked_id = NEW.id;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tr_zz_purge_user_blocks_on_anon ON public.users;
CREATE TRIGGER tr_zz_purge_user_blocks_on_anon
  AFTER UPDATE OF is_anonymized ON public.users
  FOR EACH ROW
  WHEN (COALESCE(NEW.is_anonymized, false) AND NOT COALESCE(OLD.is_anonymized, false))
  EXECUTE FUNCTION public.tr_purge_user_blocks_on_anon();

-- ════════════════════════════════════════════════════════════════════════
-- ⑦ الإعدادُ: عددُ رسائل الطلب الجاري بعد الحجب — **لا رقمٌ في نصّ**
--    ويُعشَّش تحت `chat_limits` القائم عمداً: مفتاحٌ جديدٌ يلزمه ثلاثةُ
--    مواضع (فرعُ التطبيق · قائمةُ الجلب · **قائمةُ السماح في RLS**)، و
--    `chat_limits` **مُدرَجٌ في السماح أصلاً** (قِيس في نصّ السياسة الحيّ)
--    ⇒ صفرُ تعديلٍ على RLS وصفرُ خطرِ «SELECT بصفر صفوفٍ لا بخطأ».
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.taki_chat_limits()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
  SELECT jsonb_build_object(
    'per_booking', GREATEST(0, LEAST(1000, COALESCE((
        SELECT floor((value->>'per_booking')::numeric)::int FROM public.platform_settings
         WHERE key='chat_limits' AND jsonb_typeof(value->'per_booking')='number'), 0))),
    'per_hour',    GREATEST(1, LEAST(10000, COALESCE((
        SELECT floor((value->>'per_hour')::numeric)::int FROM public.platform_settings
         WHERE key='chat_limits' AND jsonb_typeof(value->'per_hour')='number'), 120))),
    'bot_page',    GREATEST(5, LEAST(100, COALESCE((
        SELECT floor((value->>'bot_page')::numeric)::int FROM public.platform_settings
         WHERE key='chat_limits' AND jsonb_typeof(value->'bot_page')='number'), 30))),
    -- v15.80 — رسائلُ طرفٍ محجوبٍ على طلبٍ جارٍ (مدفوعٍ أو توصيل)، تُحسب من
    -- لحظة الحجب. صفرٌ = حجبٌ قاطعٌ حتى على الطلب الجاري (قرارُ تشغيلٍ متاح).
    'blocked_inflight', GREATEST(0, LEAST(50, COALESCE((
        SELECT floor((value->>'blocked_inflight')::numeric)::int FROM public.platform_settings
         WHERE key='chat_limits' AND jsonb_typeof(value->'blocked_inflight')='number'), 3)))
  );
$$;

-- ════════════════════════════════════════════════════════════════════════
-- ⑧ الحارسُ الحقيقيّ — نقطةُ الخَنق الواحدة على الجدول
--    ولا استثناءَ لـ`taki_is_system_caller()`، وهذا **شرطُ قابليّة الإثبات**:
--    جلسةُ psql نفسُها «نظام» (session_user=supabase_admin)، فأيُّ استثناءٍ
--    يجعل كلَّ فحصٍ في هذا الملفّ باطلاً وهو يبدو أخضر (درسُ v14.96).
--    وقِيس أن لا كاتبَ نظاميّاً لهذا الجدول: دالّتان فقط، وصفرُ وظيفةِ كرون.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.tr_guard_message_block()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_b      public.bookings;
  v_actor  text;
  v_other  text;
  v_since  timestamptz;
  v_allow  int;
  v_sent   int;
  v_att    text := NULLIF(btrim(COALESCE(NEW.attachment_path, '')), '');
BEGIN
  SELECT * INTO v_b FROM public.bookings WHERE barcode = NEW.barcode;
  -- حجزٌ غيرُ موجود: يُترك للمفتاح الأجنبيّ ليرفضه بخطأٍ صريح، لا يُبتلع هنا.
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- (أ) محادثةٌ مغلقة. نصُّ الرفض ورمزُه منسوخان حرفياً من `send_booking_message`
  --     الحيّة (`P0001` بلا HINT) — مفرداتُ الأخطاء لا تُخترع نسخةٌ ثانية منها.
  IF v_b.status IN ('cancelled', 'completed', 'expired') THEN
    RAISE EXCEPTION 'انتهى هذا الطلب — المحادثة للقراءة فقط' USING ERRCODE = 'P0001';
  END IF;

  -- (ب) المرفق: تحت مجلّد هذا الحجز، وموجودٌ فعلاً.
  --     🪤 ولا فحصَ مِلكيّةٍ هنا: البوتُ لا يحمل `auth.uid()` إطلاقاً، فشرطُ
  --        `o.owner = auth.uid()` يبقى في دالّة الويب حيث يصحّ وحدها.
  IF v_att IS NOT NULL THEN
    IF split_part(v_att, '/', 1) <> NEW.barcode THEN
      RAISE EXCEPTION 'المرفق لا يخصّ هذا الطلب' USING ERRCODE = 'P0001', HINT = 'P0017';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o
                    WHERE o.bucket_id = 'chat' AND o.name = v_att) THEN
      RAISE EXCEPTION 'المرفق غير موجود' USING ERRCODE = 'P0001', HINT = 'P0017';
    END IF;
  END IF;

  -- (ج) 🔴 الفاعلُ من `sender_role` لا من `sender_id`: الثاني يكتبه العميل،
  --     والأوّلُ وحده ما تربطه سياسةُ RLS بـ`uid()` وما يعتمده
  --     `tr_booking_message_recipient`.
  v_actor := CASE WHEN NEW.sender_role = 'buyer' THEN v_b.user_id  ELSE v_b.store_id END;
  v_other := CASE WHEN NEW.sender_role = 'buyer' THEN v_b.store_id ELSE v_b.user_id  END;

  v_since := public.taki_block_since(v_actor, v_other);
  IF v_since IS NULL THEN RETURN NEW; END IF;

  -- محجوبان. والاستثناءُ الوحيد: طلبٌ مفتوحٌ (ثبت أعلاه) **ومدفوعٌ أو توصيل**.
  IF v_b.paid_at IS NULL AND COALESCE(v_b.fulfillment, '') <> 'delivery' THEN
    RAISE EXCEPTION 'لا يمكن إرسال رسالة في هذه المحادثة'
      USING ERRCODE = 'P0001', HINT = 'P0032';
  END IF;

  -- والعددُ **من لحظة الحجب**: لو حُسب من أوّل المحادثة لبلغ سقفَه فوراً من
  -- تحدّث قبل الحجب — فيعود التوصيلُ عالقاً وهو ما جاء الاستثناءُ لأجله.
  v_allow := (public.taki_chat_limits()->>'blocked_inflight')::int;
  SELECT count(*) INTO v_sent
    FROM public.booking_messages
   WHERE barcode = NEW.barcode
     AND sender_role = NEW.sender_role
     AND created_at >= v_since;

  IF v_allow <= 0 OR v_sent >= v_allow THEN
    RAISE EXCEPTION 'تعذّر إرسال المزيد من الرسائل على هذا الطلب — تواصل مع الطرف الآخر مباشرة'
      USING ERRCODE = 'P0001', HINT = 'P0033';
  END IF;

  RETURN NEW;
END;
$$;

-- `tr_a0_` ليسبق `tr_aa_rate_limit_message`: المشغّلاتُ الصفّية تُطلَق
-- أبجدياً بـ`tgname`، فرسالةٌ محجوبةٌ لا تحرق حصّةَ الساعة.
-- 🪤 ويبقى `tr_a0_bm_force_sender` أسبقَ منه (`bm` < `guard`) — وهذا مقصود،
--    لكنّ الحارسَ لا يعتمد عليه: يشتقّ الفاعلَ بنفسه.
DROP TRIGGER IF EXISTS tr_a0_guard_message_block ON public.booking_messages;
CREATE TRIGGER tr_a0_guard_message_block
  BEFORE INSERT ON public.booking_messages
  FOR EACH ROW EXECUTE FUNCTION public.tr_guard_message_block();

-- ════════════════════════════════════════════════════════════════════════
-- ⑨ البوتُ يحتاج **رمزاً يُخرَّط** لا استثناءً يُرفَع
--    🪤 غلافُ `rpc()` في `server/bot.js:200` يبتلع الاستثناءَ إلى `null`،
--       فحارسٌ يرفع وحده يُظهر «تعذّر الإرسال» العامّ في القناتين.
--       (وهو — للمفارقة — النصُّ الصحيح لعدم الإفصاح. انظر `chatView.js`.)
--    وبـ`CREATE OR REPLACE` بنفس البصمة تماماً ⇒ المنحُ والمالكُ يبقيان.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.bot_send_booking_message(p_telegram_id bigint, p_barcode text, p_body text, p_whatsapp_id text DEFAULT NULL::text, p_attachment_path text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_uid text; v_b bookings%ROWTYPE; v_role text; v_cnt int; v_cap int;
  v_body text := btrim(COALESCE(p_body, ''));
  v_att  text := NULLIF(btrim(COALESCE(p_attachment_path, '')), '');
  v_other text; v_since timestamptz; v_allow int; v_sent int;
BEGIN
  IF NOT public._bot_gate_ok() THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;

  SELECT id INTO v_uid FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_linked'); END IF;

  -- صورةٌ بلا نصّ رسالةٌ كاملة، لكن الجدول يمنع النصّ الفارغ.
  IF v_body = '' AND v_att IS NOT NULL THEN v_body := '📎'; END IF;
  IF v_body = '' OR length(v_body) > 500 THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_body');
  END IF;

  SELECT * INTO v_b FROM bookings WHERE barcode = UPPER(p_barcode) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'not_found'); END IF;
  IF v_uid = v_b.user_id THEN v_role := 'buyer';
  ELSIF v_uid = v_b.store_id THEN v_role := 'seller';
  ELSE RETURN jsonb_build_object('success', false, 'error', 'not_authorized'); END IF;

  IF v_b.status IN ('cancelled','completed','expired') THEN
    RETURN jsonb_build_object('success', false, 'error', 'chat_closed');
  END IF;

  -- المرفق تحت مجلّد هذا الحجز، وموجودٌ فعلاً. (المِلكية تحقّقت منها الدالة
  -- الطرفية قبل الرفع — البوت لا يحمل هوية قاعدة بيانات ليُقارَن بها.)
  IF v_att IS NOT NULL THEN
    IF split_part(v_att, '/', 1) <> v_b.barcode THEN
      RETURN jsonb_build_object('success', false, 'error', 'attachment_outside_booking');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'chat' AND o.name = v_att) THEN
      RETURN jsonb_build_object('success', false, 'error', 'attachment_missing');
    END IF;
  END IF;

  -- v15.80 — الحجب. نفسُ دلالةِ مشغّلِ الجدول حرفياً (مصدرُ البحث واحد:
  -- `taki_block_since`)، لكن **رمزاً** لا استثناءً كي يبلغ القناتين.
  v_other := CASE WHEN v_role = 'buyer' THEN v_b.store_id ELSE v_b.user_id END;
  v_since := public.taki_block_since(v_uid, v_other);
  IF v_since IS NOT NULL THEN
    IF v_b.paid_at IS NULL AND COALESCE(v_b.fulfillment, '') <> 'delivery' THEN
      RETURN jsonb_build_object('success', false, 'error', 'blocked');
    END IF;
    v_allow := (public.taki_chat_limits()->>'blocked_inflight')::int;
    SELECT count(*) INTO v_sent FROM booking_messages
     WHERE barcode = v_b.barcode AND sender_role = v_role AND created_at >= v_since;
    IF v_allow <= 0 OR v_sent >= v_allow THEN
      RETURN jsonb_build_object('success', false, 'error', 'blocked_cap');
    END IF;
  END IF;

  SELECT count(*) INTO v_cnt FROM booking_messages WHERE barcode = v_b.barcode AND sender_role = v_role;
  -- v14.93 — الحدّ من الإعداد، و0 = بلا حدّ.
  v_cap := (public.taki_chat_limits()->>'per_booking')::int;
  IF v_cap > 0 AND v_cnt >= v_cap THEN
    RETURN jsonb_build_object('success', false, 'error', 'limit_reached', 'cap', v_cap);
  END IF;

  INSERT INTO booking_messages (barcode, sender_id, sender_role, body, attachment_path)
  VALUES (v_b.barcode, v_uid, v_role, v_body, v_att);

  RETURN jsonb_build_object('success', true, 'my_count', v_cnt + 1, 'cap', v_cap);
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- ⑩ `bot_toggle_block` يكتب **الجدولَ** لا العمود — فالمرآةُ كاتبٌ واحد
--    وقِيس على الحيّة: `array_append` بلا إزالةِ تكرار، و**لا تُسقط المتابعة**
--    خلافاً للويب ⇒ متجرٌ محجوبٌ من تيليجرام يبقى يُشعر عبر مسار المتابعة.
--    نفسُ البصمة ونفسُ عقدِ الـjsonb (`success`/`blocked`) ⇒ `bot.js:1303`
--    لا يُمَسّ، والمنحُ والمالكُ يبقيان.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.bot_toggle_block(p_telegram_id bigint, p_store_id text, p_whatsapp_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_uid text; v_blocked boolean; v_n int;
BEGIN
  SELECT id INTO v_uid FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success', false, 'error', 'not_linked'); END IF;

  -- 🪤 ويُفحص الهدفُ هنا لا يُترك للمفتاح الأجنبيّ: استثناءٌ مرفوعٌ يبتلعه
  --    غلافُ `rpc()` إلى `null` فيصمت البوت.
  IF v_uid = p_store_id THEN RETURN jsonb_build_object('success', false, 'error', 'self'); END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_store_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_found');
  END IF;

  DELETE FROM public.user_blocks WHERE blocker_id = v_uid AND blocked_id = p_store_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n > 0 THEN
    v_blocked := false;
  ELSE
    INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (v_uid, p_store_id)
      ON CONFLICT DO NOTHING;
    v_blocked := true;
  END IF;

  RETURN jsonb_build_object('success', true, 'blocked', v_blocked);
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- ⑪ الردُّ العامّ على تقييمِ مَن حجبك: ممنوع — والتقييمُ نفسُه لا يُمَسّ
--    مُعادةٌ من نصّها الحيّ (`pg_get_functiondef`) لا من المستودع، وبنفس
--    البصمة ⇒ المنحُ (`authenticated`) والمالكُ (`postgres`) يبقيان.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.set_rating_reply(p_rating_id text, p_reply text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    v_uid text := (auth.uid())::text;
    v_store_id text;
    v_rater_id text;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'auth required';
    END IF;
    -- Only the seller who owns the deal (or an admin) can reply
    SELECT d.store_id, r.user_id INTO v_store_id, v_rater_id FROM public.ratings r
        JOIN public.deals d ON d.id = r.deal_id
        WHERE r.id = p_rating_id AND r.deleted_at IS NULL;
    IF v_store_id IS NULL THEN
        RAISE EXCEPTION 'rating not found';
    END IF;
    IF v_store_id <> v_uid AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = v_uid AND u.user_type='admin') THEN
        RAISE EXCEPTION 'forbidden';
    END IF;
    -- v15.80 — الحجب يقطع الردَّ العامّ لا التقييم. ولو أسكت التقييمَ لصار
    -- أداةَ تاجرٍ يدفن نقّاده، ولذلك `ratings` تبقى كما هي تماماً.
    -- 🪤 ومحوُ الردّ (نصٌّ فارغ) يبقى مسموحاً: سحبُ كلامٍ منشورٍ ليس إساءة.
    IF v_rater_id IS NOT NULL
       AND NULLIF(trim(p_reply), '') IS NOT NULL
       AND public.taki_is_blocked_pair(v_uid, v_rater_id) THEN
        RAISE EXCEPTION 'لا يمكن الرد على هذا التقييم'
          USING ERRCODE = 'P0001', HINT = 'P0032';
    END IF;
    UPDATE public.ratings
        SET reply = NULLIF(trim(p_reply), ''),
            replied_at = CASE WHEN NULLIF(trim(p_reply),'') IS NULL THEN NULL ELSE now() END,
            replied_by = CASE WHEN NULLIF(trim(p_reply),'') IS NULL THEN NULL ELSE v_uid END,
            updated_at = now()
        WHERE id = p_rating_id;
END $$;

-- ════════════════════════════════════════════════════════════════════════
-- ⑫ وعدُ الشاشة يُنفَّذ: فرعانِ من ثلاثةٍ لم يُصفّيا المحجوب
--    قِيس (التعليقُ مجرَّد): `handle_deal_smart_notifications :: NO` ·
--    `taki_dispatch_coming_soon_window :: NO` · `handle_smart_alerts_backfill :: YES`
--    أي أنّ الشرطَ أُضيف إلى واحدٍ من ثلاثة وكُتب نصُّ الواجهة كأنه أُضيف
--    إلى الثلاثة — والتعليقُ في `AppContext.tsx:1267` يؤكّد ما لم يكن.
--    🪤 ويُجمَع المحجوبون **مرّةً واحدة** قبل الحلقة لا استعلاماً لكلّ
--       مستخدم: تلك الحلقةُ قِيست ١٠٫٦ ثانية عند ١٠٠ ألف مستخدم (v13.31).
--    مُعادتان من نصّهما الحيّ، وبنفس البصمة ⇒ المشغّلاتُ والمنحُ تبقى.
-- ════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.handle_deal_smart_notifications()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    deal_region_id  TEXT;
    deal_city_id    TEXT;
    deal_lat        DOUBLE PRECISION;
    deal_lng        DOUBLE PRECISION;
    nearest_row     public.sa_cities_geo;
    rec             RECORD;
    now_ms          BIGINT;
    window_cutoff   BIGINT;
    blk_out         TEXT[];   -- v15.80 — من حجبهم هذا المتجر
    blk_in          TEXT[];   -- v15.80 — من حجبوا هذا المتجر
BEGIN
    IF NEW.status <> 'active' THEN
        RETURN NEW;
    END IF;

    now_ms        := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
    window_cutoff := now_ms + (7 * 24 * 60 * 60 * 1000);  -- 7 days

    -- v11.21 — Hidden phase: deal scheduled further than 7 days out. Only
    -- the merchant who owns it knows about it; no buyer-side fan-out yet.
    -- The pg_cron job `taki_dispatch_coming_soon_window` will pick the
    -- row up as soon as starts_at crosses into the visibility window.
    IF NEW.starts_at IS NOT NULL AND NEW.starts_at > window_cutoff THEN
        RETURN NEW;
    END IF;

    deal_region_id := NEW.region;
    deal_city_id   := NEW.city;
    deal_lat       := NEW.map_lat;
    deal_lng       := NEW.map_lng;

    IF deal_region_id IS NULL OR deal_city_id IS NULL THEN
        SELECT l.city_id, c.region_id,
               COALESCE(deal_lat, l.lat),
               COALESCE(deal_lng, l.lng)
        INTO deal_city_id, deal_region_id, deal_lat, deal_lng
        FROM public.locations l
        LEFT JOIN public.cities c ON c.id = l.city_id
        WHERE l.id = NEW.location_id;
    END IF;

    IF (deal_region_id IS NULL OR deal_city_id IS NULL)
       AND deal_lat IS NOT NULL AND deal_lng IS NOT NULL
    THEN
        SELECT * INTO nearest_row FROM public.find_nearest_sa_city(deal_lat, deal_lng);
        IF nearest_row.city_id IS NOT NULL THEN
            deal_region_id := COALESCE(deal_region_id, nearest_row.region_id);
            deal_city_id   := COALESCE(deal_city_id,   nearest_row.city_id);
        END IF;
    END IF;

    -- v15.80 — الحجبُ في الاتجاهين، ومسحٌ واحدٌ لا واحدٌ لكلّ مستخدم.
    blk_out := ARRAY(SELECT ub.blocked_id FROM public.user_blocks ub WHERE ub.blocker_id = NEW.store_id);
    blk_in  := ARRAY(SELECT ub.blocker_id FROM public.user_blocks ub WHERE ub.blocked_id = NEW.store_id);

    FOR rec IN
        SELECT id, smart_alerts, followed_merchants
        FROM public.users
        WHERE id <> NEW.store_id
          AND deleted_at IS NULL
          -- v13.31 — لا تمرّ على كل مستخدمي المنصة: من لا تنبيهات لديه ولا
          -- يتابع هذا المتجر يخرج من taki_dispatch_smart_alert بـRETURN FALSE
          -- حتماً، فتمريره كان يُنفّذ taki_norm على نص العرض مرة لكل مستخدم
          -- (قِيس: ١٠.٦ ثانية عند ١٠٠ ألف مستخدم — التاجر ينتظرها عند كل إضافة).
          AND ( COALESCE(jsonb_array_length(smart_alerts), 0) > 0
             OR NEW.store_id = ANY(COALESCE(followed_merchants, ARRAY[]::text[])) )
          -- v15.80 — ووعدُ شاشةِ المتجر: «لن تصلك أي تنبيهات منه — حتى لو
          -- طابقت تنبيهك الذكي». كان نصّاً بلا شرط.
          AND NOT (id = ANY(blk_out))
          AND NOT (id = ANY(blk_in))
    LOOP
        PERFORM public.taki_dispatch_smart_alert(
            rec.id,
            rec.followed_merchants,
            rec.smart_alerts,
            NEW,
            deal_region_id, deal_city_id,
            deal_lat, deal_lng,
            FALSE
        );
    END LOOP;

    -- Mark notified so the cron dispatcher never re-fires on this row.
    -- We update directly via UPDATE (not by editing NEW) because AFTER
    -- INSERT triggers can't mutate NEW back to the row.
    UPDATE public.deals SET coming_soon_notified_at = now_ms WHERE id = NEW.id;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.taki_dispatch_coming_soon_window()
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
    deal_rec        public.deals;
    deal_region_id  TEXT;
    deal_city_id    TEXT;
    deal_lat        DOUBLE PRECISION;
    deal_lng        DOUBLE PRECISION;
    nearest_row     public.sa_cities_geo;
    rec             RECORD;
    now_ms          BIGINT;
    window_cutoff   BIGINT;
    processed       INTEGER := 0;
    blk_out         TEXT[];   -- v15.80
    blk_in          TEXT[];   -- v15.80
BEGIN
    now_ms        := (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
    window_cutoff := now_ms + (7 * 24 * 60 * 60 * 1000);

    -- Cap at 50 per tick. With a 5-minute interval that's 600 deals/hour —
    -- well above any realistic burst. Cap exists so a sudden spike (e.g.
    -- a backfill migration that resets coming_soon_notified_at on
    -- hundreds of rows) can't fan out into thousands of notifications in
    -- a single tick and choke the trigger budget.
    FOR deal_rec IN
        SELECT * FROM public.deals
        WHERE status = 'active'
          AND starts_at IS NOT NULL
          AND coming_soon_notified_at IS NULL
          AND starts_at > now_ms                  -- still in the future
          AND starts_at <= window_cutoff          -- inside the 7-day window
        ORDER BY starts_at ASC
        LIMIT 50
    LOOP
        deal_region_id := deal_rec.region;
        deal_city_id   := deal_rec.city;
        deal_lat       := deal_rec.map_lat;
        deal_lng       := deal_rec.map_lng;

        IF deal_region_id IS NULL OR deal_city_id IS NULL THEN
            SELECT l.city_id, c.region_id,
                   COALESCE(deal_lat, l.lat),
                   COALESCE(deal_lng, l.lng)
            INTO deal_city_id, deal_region_id, deal_lat, deal_lng
            FROM public.locations l
            LEFT JOIN public.cities c ON c.id = l.city_id
            WHERE l.id = deal_rec.location_id;
        END IF;

        IF (deal_region_id IS NULL OR deal_city_id IS NULL)
           AND deal_lat IS NOT NULL AND deal_lng IS NOT NULL
        THEN
            SELECT * INTO nearest_row FROM public.find_nearest_sa_city(deal_lat, deal_lng);
            IF nearest_row.city_id IS NOT NULL THEN
                deal_region_id := COALESCE(deal_region_id, nearest_row.region_id);
                deal_city_id   := COALESCE(deal_city_id,   nearest_row.city_id);
            END IF;
        END IF;

        -- v15.80 — نفسُ شرط مشغّلِ النشر: الحجبُ في الاتجاهين، ومسحٌ واحد.
        blk_out := ARRAY(SELECT ub.blocked_id FROM public.user_blocks ub WHERE ub.blocker_id = deal_rec.store_id);
        blk_in  := ARRAY(SELECT ub.blocker_id FROM public.user_blocks ub WHERE ub.blocked_id = deal_rec.store_id);

        FOR rec IN
            SELECT id, smart_alerts, followed_merchants
            FROM public.users
            WHERE id <> deal_rec.store_id
              AND deleted_at IS NULL
              -- v13.31 — نفس إصلاح ترغر الإضافة: المعنيّون فقط
              AND ( COALESCE(jsonb_array_length(smart_alerts), 0) > 0
                 OR deal_rec.store_id = ANY(COALESCE(followed_merchants, ARRAY[]::text[])) )
              AND NOT (id = ANY(blk_out))
              AND NOT (id = ANY(blk_in))
        LOOP
            PERFORM public.taki_dispatch_smart_alert(
                rec.id,
                rec.followed_merchants,
                rec.smart_alerts,
                deal_rec,
                deal_region_id, deal_city_id,
                deal_lat, deal_lng,
                TRUE  -- dedupe: skip if a notification for this (user, deal) already exists
            );
        END LOOP;

        UPDATE public.deals
        SET coming_soon_notified_at = now_ms
        WHERE id = deal_rec.id;

        processed := processed + 1;
    END LOOP;

    RETURN processed;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════
-- ⑬ التحقّقُ البنيويّ — كلُّ تأكيدٍ يرفع استثناءً
--    (جدولُ ✅/❌ لا يُفشل psql: صفٌّ يقول ❌ ليس خطأً في SQL — درسُ v15.00.)
-- ════════════════════════════════════════════════════════════════════════
DO $v_struct$
DECLARE v_src text; v_n int; v_names text[];
BEGIN
  -- (أ) البنية
  IF to_regclass('public.user_blocks') IS NULL THEN
    RAISE EXCEPTION '❌ user_blocks غير موجود'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='user_blocks_not_self') THEN
    RAISE EXCEPTION '❌ قيدُ منعِ حجبِ النفس غائب'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname='idx_user_blocks_blocked') THEN
    RAISE EXCEPTION '❌ فهرسُ الاتجاه المعاكس غائب'; END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public.user_blocks'::regclass) THEN
    RAISE EXCEPTION '❌ RLS غير مفعّلة على user_blocks'; END IF;
  SELECT count(*) INTO v_n FROM pg_policy WHERE polrelid='public.user_blocks'::regclass;
  IF v_n <> 3 THEN RAISE EXCEPTION '❌ سياساتُ user_blocks % لا ٣', v_n; END IF;
  -- ولا UPDATE لأحد: فكُّ الحجب حذفٌ، وتعديلُ `created_at` يُزيد الاستثناء
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema='public' AND table_name='user_blocks'
                AND grantee IN ('authenticated','anon','PUBLIC') AND privilege_type='UPDATE') THEN
    RAISE EXCEPTION '❌ UPDATE ممنوحٌ على user_blocks — تعديلُ created_at يُمدّد استثناءَ الطلب الجاري'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.role_table_grants
              WHERE table_schema='public' AND table_name='user_blocks' AND grantee='anon') THEN
    RAISE EXCEPTION '❌ للزائر المجهول منحٌ على user_blocks'; END IF;

  -- (ب) المحدِّد لا يُمنح لمستخدم — وإلّا صار عرّافَ «هل حجبني فلان؟»
  FOR v_n IN SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname IN ('taki_block_since','taki_is_blocked_pair')
                AND (has_function_privilege('anon', p.oid, 'EXECUTE')
                  OR has_function_privilege('authenticated', p.oid, 'EXECUTE')) LOOP
    RAISE EXCEPTION '❌ المحدِّدُ ممنوحٌ لـanon/authenticated — سطحُ استعلامٍ عن الحجب';
  END LOOP;
  IF NOT has_function_privilege('postgres', 'public.taki_block_since(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ postgres بلا EXECUTE — ودوالُّ المسار مملوكةٌ له وهو ليس superuser'; END IF;

  -- (ج) المشغّلُ مركّبٌ BEFORE INSERT، وبالترتيب المقصود
  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
                  WHERE t.tgrelid='public.booking_messages'::regclass
                    AND t.tgname='tr_a0_guard_message_block'
                    AND p.proname='tr_guard_message_block'
                    AND (t.tgtype::int & 2) > 0 AND (t.tgtype::int & 4) > 0
                    AND NOT t.tgisinternal) THEN
    RAISE EXCEPTION '❌ tr_a0_guard_message_block غير مركّبٍ BEFORE INSERT'; END IF;
  -- 🪤 الترتيبُ يُقرأ من `tgname` لا يُفترض من النيّة
  SELECT array_agg(tgname ORDER BY tgname) INTO v_names
    FROM pg_trigger WHERE tgrelid='public.booking_messages'::regclass AND NOT tgisinternal
      AND (tgtype::int & 2) > 0;
  -- 🪤 ومقارنةٌ يدخلها NULL تُرجع NULL فتمرّ صامتةً: الموضعان يُفحصان أوّلاً.
  IF array_position(v_names,'tr_a0_guard_message_block') IS NULL
  OR array_position(v_names,'tr_aa_rate_limit_message') IS NULL
  OR array_position(v_names,'tr_a0_guard_message_block')
     > array_position(v_names,'tr_aa_rate_limit_message') THEN
    RAISE EXCEPTION '❌ ترتيبُ مشغّلات BEFORE خاطئ (%) — رسالةٌ محجوبةٌ تحرق حصّةَ الساعة',
      COALESCE(array_to_string(v_names, ' → '), '∅'); END IF;

  -- (د) الجسمُ لا الملفّ، والتعليقُ مجرَّدٌ قبل الفحص (درسُ v15.22)
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='tr_guard_message_block';
  IF v_src NOT LIKE '%taki_block_since%' THEN
    RAISE EXCEPTION '❌ جسمُ الحارس لا ينادي taki_block_since'; END IF;
  IF v_src LIKE '%taki_is_system_caller%' THEN
    RAISE EXCEPTION '❌ الحارسُ يستثني النظام — فكلُّ فحصٍ هنا باطلٌ وهو يبدو أخضر'; END IF;
  IF v_src LIKE '%NEW.sender_id%' THEN
    RAISE EXCEPTION '❌ الحارسُ يقرأ NEW.sender_id — عمودٌ يكتبه العميل، فالاشتقاقُ من sender_role'; END IF;

  -- (هـ) ولا كاتبَ ثالثاً ظهر: نقاطُ الفرض مجرودةٌ لا مُفترضة
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f'
     AND regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
         ~* 'INSERT INTO (public\.)?booking_messages';
  IF v_n <> 2 THEN
    RAISE EXCEPTION '❌ كتّابُ booking_messages % لا ٢ — أعِد جردَ نقاط الفرض', v_n; END IF;

  -- (و) وعدُ الشاشة: الفرعانِ يُصفّيان فعلاً، والثالثُ ما زال يُصفّي
  FOR v_src IN
    SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname IN ('handle_deal_smart_notifications','taki_dispatch_coming_soon_window')
  LOOP
    IF v_src NOT LIKE '%user_blocks%' OR v_src NOT LIKE '%blk_out%' OR v_src NOT LIKE '%blk_in%' THEN
      RAISE EXCEPTION '❌ أحدُ مساري النشر لا يُصفّي المحجوب — ونصُّ شاشةِ المتجر يَعِد به';
    END IF;
  END LOOP;
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='handle_smart_alerts_backfill';
  IF v_src NOT LIKE '%blocked_merchants%' THEN
    RAISE EXCEPTION '❌ مسارُ الاستدراك فقد تصفيتَه'; END IF;

  -- (ز) البوتُ يُعيد رمزاً، والمنحُ القائمُ على سطح البوت لم يُفقد
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='bot_send_booking_message';
  IF v_src NOT LIKE '%''blocked''%' OR v_src NOT LIKE '%''blocked_cap''%' THEN
    RAISE EXCEPTION '❌ bot_send_booking_message لا تُعيد رمزَ الحجب — غلافُ rpc() يبتلع الاستثناء'; END IF;
  IF v_src NOT LIKE '%_bot_gate_ok%' THEN
    RAISE EXCEPTION '❌ بوّابةُ سرّ البوت سقطت من bot_send_booking_message'; END IF;
  IF NOT has_function_privilege('anon', 'public.bot_send_booking_message(bigint,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ فُقد منحُ anon على bot_send_booking_message — البوتُ يصل بهذا الدور'; END IF;
  IF NOT has_function_privilege('anon', 'public.bot_toggle_block(bigint,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ فُقد منحُ anon على bot_toggle_block'; END IF;

  -- (ح) ولا كاتبَ ثانياً للمرآة: `bot_toggle_block` لا تكتب العمود بعد اليوم
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='bot_toggle_block';
  IF v_src LIKE '%blocked_merchants%' THEN
    RAISE EXCEPTION '❌ bot_toggle_block ما زالت تكتب العمود — كاتبان للمرآة فتنحرف'; END IF;
  IF v_src NOT LIKE '%user_blocks%' THEN
    RAISE EXCEPTION '❌ bot_toggle_block لا تكتب user_blocks'; END IF;

  -- (ط) الردُّ على التقييم، والتقييمُ نفسُه لم يُمَسّ
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='set_rating_reply';
  IF v_src NOT LIKE '%taki_is_blocked_pair%' THEN
    RAISE EXCEPTION '❌ set_rating_reply بلا فحصِ حجب'; END IF;
  IF NOT has_function_privilege('authenticated', 'public.set_rating_reply(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ فُقد منحُ authenticated على set_rating_reply'; END IF;
  -- والبلاغُ يبقى بلا فحصِ حجب: تُبلِّغ عمّن حجبتَه دائماً
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g') INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='guard_report_insert';
  IF v_src LIKE '%blocked%' THEN
    RAISE EXCEPTION '❌ حارسُ البلاغات صار يفحص الحجب — فمن حجبتَه لا تُبلِّغ عنه'; END IF;

  -- (ي) الإعدادُ موجودٌ ومقروء، ولا رقمَ في نصّ
  IF (public.taki_chat_limits() ->> 'blocked_inflight') IS NULL THEN
    RAISE EXCEPTION '❌ blocked_inflight غائبٌ عن taki_chat_limits()'; END IF;

  -- (ك) مشغّلُ التجهيل
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.users'::regclass
                  AND tgname='tr_zz_purge_user_blocks_on_anon') THEN
    RAISE EXCEPTION '❌ مشغّلُ محوِ الحجب عند التجهيل غير مركّب'; END IF;

  RAISE NOTICE '✅ ⑬ البنيةُ والمنحُ والترتيبُ ونقاطُ الفرض: مُثبتةٌ كلُّها';
END $v_struct$;

-- ════════════════════════════════════════════════════════════════════════
-- ⑭ التحقّقُ السلوكيّ — بتركيبةٍ صناعيّة **تُلغى كلُّها**
--    🪤 الحيلةُ: كلُّ شيءٍ داخل كتلةِ `BEGIN … EXCEPTION` (وهي معاملةٌ
--       فرعيّة)، ويُرفع في آخرها استثناءٌ مُتّفقٌ عليه فيُلغى كلُّ ما فيها —
--       الصفوفُ وآثارُها الجانبيّة معاً (إشعاراتُ الأدمن · التجارب ·
--       عدّاداتُ المعدّل). وأيُّ فشلٍ حقيقيّ يُعاد رفعُه فيُفشل psql.
--    🪤 ومشغّلاتُ `users`/`deals`/`bookings` تُطفأ **داخل** الكتلة لحظةَ بناء
--       التركيبة وتُعاد قبل الفحص: بناءُ حجزٍ حقيقيٍّ يمرّ بعشرين مشغّلاً
--       (توثيقٌ · مخزونٌ · فاتورةٌ · نافذةُ عرض) فيفشل لأسبابٍ لا تخصّ ما نفحص.
--       ⚠️ وهذا يأخذ قفلاً حصرياً على الثلاثة حتى انتهاء الهجرة (ثوانٍ، وستّةُ
--          مستخدمين و١٢٠ حجزاً) — تُشغَّل في وقتٍ هادئ.
-- ════════════════════════════════════════════════════════════════════════
DO $v_behave$
DECLARE
  v_buyer  text := 'blk_t_buyer_'  || floor(random()*1e9)::text;
  v_store  text := 'blk_t_store_'  || floor(random()*1e9)::text;
  v_deal   text := 'blk_t_deal_'   || floor(random()*1e9)::text;
  v_bc_a   text := '9100' || floor(random()*1e6)::text;   -- استلامٌ غيرُ مدفوع
  v_bc_b   text := '9200' || floor(random()*1e6)::text;   -- توصيلٌ جارٍ
  v_bc_c   text := '9300' || floor(random()*1e6)::text;   -- مُغلَق
  v_now    bigint := (EXTRACT(EPOCH FROM now()) * 1000)::bigint;
  v_hint   text;
  v_allow  int;
  v_i      int;
  v_ok     boolean;
BEGIN
  -- 🪤 الباركودُ مفتاحٌ أوّليّ وأطوالُ القائم ٨–١٠ محارف ⇒ تضادٌّ ممكن.
  --    يُفحص صريحاً: رسالةٌ مفهومةٌ تقول «أعِد التشغيل» أرخصُ من انفجارِ PK.
  IF EXISTS (SELECT 1 FROM public.bookings WHERE barcode IN (v_bc_a, v_bc_b, v_bc_c)) THEN
    RAISE EXCEPTION '❌ تضادُّ باركودٍ صناعيٍّ مع حجزٍ قائم — أعِد تشغيل الهجرة (الأرقامُ عشوائيّة)';
  END IF;

  BEGIN
    ALTER TABLE public.users    DISABLE TRIGGER USER;
    ALTER TABLE public.deals    DISABLE TRIGGER USER;
    ALTER TABLE public.bookings DISABLE TRIGGER USER;

    INSERT INTO public.users (id, name, user_type) VALUES
      (v_buyer, 'blk test buyer',  'buyer'),
      (v_store, 'blk test store',  'seller');
    INSERT INTO public.deals (id, store_id, shop_name, item_name, category,
                              original_price, discounted_price, created_at, status)
      VALUES (v_deal, v_store, 'blk test store', 'blk test item', 'other', 10, 5, v_now, 'paused');
    INSERT INTO public.bookings (barcode, backup_code, deal_id, user_id, store_id,
                                 booked_at, expiry_time, status, fulfillment, paid_at) VALUES
      (v_bc_a, v_bc_a, v_deal, v_buyer, v_store, v_now, v_now + 7200000, 'pending',   'pickup',   NULL),
      (v_bc_b, v_bc_b, v_deal, v_buyer, v_store, v_now, v_now + 7200000, 'pending',   'delivery', NULL),
      (v_bc_c, v_bc_c, v_deal, v_buyer, v_store, v_now, v_now + 7200000, 'completed', 'pickup',   NULL);

    ALTER TABLE public.users    ENABLE TRIGGER USER;
    ALTER TABLE public.deals    ENABLE TRIGGER USER;
    ALTER TABLE public.bookings ENABLE TRIGGER USER;

    -- ── (١) سالبٌ: بلا حجبٍ تمرّ. وبلا هذه الحالةِ يبدو حارسٌ يرفض الكلَّ ناجحاً.
    INSERT INTO public.booking_messages (barcode, sender_id, sender_role, body)
      VALUES (v_bc_a, v_store, 'seller', 'حالةٌ سالبة — بلا حجب');

    -- ── (٢) المحادثةُ المغلقة تُرفض من الجدول نفسِه (لا من الدالّة وحدها)
    v_ok := false;
    BEGIN
      INSERT INTO public.booking_messages (barcode, sender_id, sender_role, body)
        VALUES (v_bc_c, v_store, 'seller', 'طلبٌ منتهٍ');
      RAISE EXCEPTION '❌ (٢) رسالةٌ دخلت محادثةً مغلقة';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '❌%' THEN RAISE; END IF;
      IF SQLERRM NOT LIKE '%للقراءة فقط%' THEN
        RAISE EXCEPTION '❌ (٢) الرفضُ لسببٍ آخر: %', SQLERRM; END IF;
      v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION '❌ (٢) لم تبتّ'; END IF;

    -- ── (٣) مرفقٌ من طلبٍ آخر يُرفض بـP0017
    v_ok := false;
    BEGIN
      INSERT INTO public.booking_messages (barcode, sender_id, sender_role, body, attachment_path)
        VALUES (v_bc_a, v_store, 'seller', 'مرفقٌ غريب', v_bc_b || '/x.jpg');
      RAISE EXCEPTION '❌ (٣) مرفقٌ من طلبٍ آخر مرّ';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '❌%' THEN RAISE; END IF;
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF COALESCE(v_hint,'') <> 'P0017' THEN
        RAISE EXCEPTION '❌ (٣) الرفضُ بـhint=% لا P0017 (%)', COALESCE(v_hint,'∅'), SQLERRM; END IF;
      v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION '❌ (٣) لم تبتّ'; END IF;

    -- رسالتان **قبل** الحجب على طلب التوصيل، بزمنٍ سابق: بهما تُقاس النافذة.
    -- (داخل معاملةٍ واحدة `now()` ثابتة، فلو تُركت للافتراضيّ لعُدّت بعدَ الحجب.)
    INSERT INTO public.booking_messages (barcode, sender_id, sender_role, body, created_at)
      VALUES (v_bc_b, v_store, 'seller', 'قبل الحجب ١', now() - interval '2 hours'),
             (v_bc_b, v_store, 'seller', 'قبل الحجب ٢', now() - interval '1 hour');

    -- ── الحجب: المشتري يحجب المتجر
    INSERT INTO public.user_blocks (blocker_id, blocked_id, reason)
      VALUES (v_buyer, v_store, 'اختبار');

    -- ── (٤) المرآةُ تحدَّثت ⇒ دوالُّ التصفية القائمة تعمل بلا إعادة كتابة
    IF NOT (SELECT v_store = ANY(COALESCE(blocked_merchants,'{}'::text[]))
              FROM public.users WHERE id = v_buyer) THEN
      RAISE EXCEPTION '❌ (٤) المرآةُ لم تُحدَّث'; END IF;

    -- ── (٥) الطلبُ غيرُ المدفوع/الاستلام: حجبٌ قاطعٌ بـP0032
    v_ok := false;
    BEGIN
      INSERT INTO public.booking_messages (barcode, sender_id, sender_role, body)
        VALUES (v_bc_a, v_store, 'seller', 'من طرفٍ محجوب');
      RAISE EXCEPTION '❌ (٥) الحارسُ سمح برسالةٍ من طرفٍ محجوب';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '❌%' THEN RAISE; END IF;
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF COALESCE(v_hint,'') <> 'P0032' THEN
        RAISE EXCEPTION '❌ (٥) الرفضُ بـhint=% لا P0032 (%)', COALESCE(v_hint,'∅'), SQLERRM; END IF;
      v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION '❌ (٥) لم تبتّ'; END IF;

    -- ── (٦) 🔴 الاختبارُ الحاسم: `sender_id` مُنتحَل. على حارسٍ يشتقّ الفاعلَ
    --     من `sender_id` **ينجح الإدراج**؛ وعلى هذا يُرفض.
    --     🪤 ويُطفأ `tr_a0_bm_force_sender` لحظةَ الفحص: وهو يُثبّت العمودَ
    --        قبل حارسنا، فلو بقي لكان الفحصُ يُجيز حارساً يقرأ `sender_id`
    --        ويبدو سليماً — أي فحصاً لا يفحص (درسُ «كسرةٌ لا تكسر»).
    ALTER TABLE public.booking_messages DISABLE TRIGGER tr_a0_bm_force_sender;
    v_ok := false;
    BEGIN
      INSERT INTO public.booking_messages (barcode, sender_id, sender_role, body)
        VALUES (v_bc_a, 'garbage_not_a_party', 'seller', 'انتحالُ معرِّف');
      RAISE EXCEPTION '❌ (٦) معرِّفٌ مُنتحَل تجاوز الحارس';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '❌%' THEN RAISE; END IF;
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF COALESCE(v_hint,'') <> 'P0032' THEN
        RAISE EXCEPTION '❌ (٦) الرفضُ بـhint=% لا P0032 (%)', COALESCE(v_hint,'∅'), SQLERRM; END IF;
      v_ok := true;
    END;
    ALTER TABLE public.booking_messages ENABLE TRIGGER tr_a0_bm_force_sender;
    IF NOT v_ok THEN RAISE EXCEPTION '❌ (٦) لم تبتّ'; END IF;

    -- ── (٧) والاتجاهُ الآخر: الحاجبُ نفسُه يُمنع. الحجبُ قطعُ قناةٍ لا إسكاتُ طرف.
    v_ok := false;
    BEGIN
      INSERT INTO public.booking_messages (barcode, sender_id, sender_role, body)
        VALUES (v_bc_a, v_buyer, 'buyer', 'من الحاجب');
      RAISE EXCEPTION '❌ (٧) الحجبُ أحاديُّ الاتجاه';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '❌%' THEN RAISE; END IF;
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF COALESCE(v_hint,'') <> 'P0032' THEN
        RAISE EXCEPTION '❌ (٧) الرفضُ بـhint=% لا P0032', COALESCE(v_hint,'∅'); END IF;
      v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION '❌ (٧) لم تبتّ'; END IF;

    -- ── (٨) الطلبُ الجاري (توصيل): العددُ المسموحُ يمرّ، ثم P0033.
    --     وبما أنّ رسالتين سبقتا الحجبَ، فمرورُ العددِ كاملاً **هو** الدليلُ
    --     على أنّ النافذةَ تبدأ من لحظة الحجب لا من أوّل المحادثة.
    v_allow := (public.taki_chat_limits() ->> 'blocked_inflight')::int;
    IF v_allow < 1 THEN RAISE EXCEPTION '❌ (٨) blocked_inflight=% فلا يُقاس الاستثناء', v_allow; END IF;
    FOR v_i IN 1..v_allow LOOP
      INSERT INTO public.booking_messages (barcode, sender_id, sender_role, body)
        VALUES (v_bc_b, v_store, 'seller', 'تنسيقُ توصيلٍ ' || v_i::text);
    END LOOP;
    -- 🪤 ويُقاس أنها **وصلت** فعلاً: حلقةٌ لا تُدرج شيئاً تجعل الرفضَ التالي
    --    يبدو «بعد العددِ المسموح» وهو رفضٌ من أوّل رسالة.
    SELECT count(*) INTO v_i FROM public.booking_messages WHERE barcode = v_bc_b;
    IF v_i <> v_allow + 2 THEN
      RAISE EXCEPTION '❌ (٨) رسائلُ طلبِ التوصيل % لا % — فالعددُ المسموح لم يمرّ', v_i, v_allow + 2; END IF;
    v_ok := false;
    BEGIN
      INSERT INTO public.booking_messages (barcode, sender_id, sender_role, body)
        VALUES (v_bc_b, v_store, 'seller', 'واحدةٌ زائدة');
      RAISE EXCEPTION '❌ (٨) استثناءُ الطلب الجاري غيرُ محدود — فكلُّ تاجرٍ له طلبٌ مفتوح غيرُ قابلٍ للحجب';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '❌%' THEN RAISE; END IF;
      GET STACKED DIAGNOSTICS v_hint = PG_EXCEPTION_HINT;
      IF COALESCE(v_hint,'') <> 'P0033' THEN
        RAISE EXCEPTION '❌ (٨) الرفضُ بـhint=% لا P0033 (%)', COALESCE(v_hint,'∅'), SQLERRM; END IF;
      v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION '❌ (٨) لم تبتّ'; END IF;

    -- ── (٩) فكُّ الحجب يُعيد القناة، والمرآةُ تنظف
    DELETE FROM public.user_blocks WHERE blocker_id = v_buyer AND blocked_id = v_store;
    IF (SELECT v_store = ANY(COALESCE(blocked_merchants,'{}'::text[]))
          FROM public.users WHERE id = v_buyer) THEN
      RAISE EXCEPTION '❌ (٩) المرآةُ لم تُنظَّف عند فكّ الحجب'; END IF;
    INSERT INTO public.booking_messages (barcode, sender_id, sender_role, body)
      VALUES (v_bc_a, v_store, 'seller', 'بعد فكّ الحجب');

    -- ── (١٠) ومنعُ حجبِ النفس يُفرَض في القاعدة
    --     🪤 وبالقيدِ بعينه لا بأيّ استثناء: فحصٌ يقبل أيَّ خطأٍ ليس فحصاً
    --        (الرفضُ قد يأتي من مفتاحٍ أجنبيٍّ أو سياسةٍ فيُظنّ القيدَ عاملاً).
    v_ok := false;
    BEGIN
      INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (v_buyer, v_buyer);
      RAISE EXCEPTION '❌ (١٠) حجبُ النفس مرّ';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE '❌%' THEN RAISE; END IF;
      GET STACKED DIAGNOSTICS v_hint = CONSTRAINT_NAME;
      IF COALESCE(v_hint,'') <> 'user_blocks_not_self' THEN
        RAISE EXCEPTION '❌ (١٠) الرفضُ بقيدِ «%» لا user_blocks_not_self (%)',
          COALESCE(v_hint,'∅'), SQLERRM; END IF;
      v_ok := true;
    END;
    IF NOT v_ok THEN RAISE EXCEPTION '❌ (١٠) لم تبتّ'; END IF;

    -- ── (١١) التجهيلُ يمحو الحجب (بياناتٌ شخصية — قاعدةُ v14.77)
    INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (v_buyer, v_store);
    UPDATE public.users SET is_anonymized = true WHERE id = v_buyer;
    IF EXISTS (SELECT 1 FROM public.user_blocks
                WHERE blocker_id = v_buyer OR blocked_id = v_buyer) THEN
      RAISE EXCEPTION '❌ (١١) الحجبُ بقي بعد التجهيل'; END IF;

    RAISE NOTICE '✅ ⑭ سلوكياً: ١١ حالةً — سالبٌ · مغلقٌ · مرفقٌ · مرآةٌ · P0032 · انتحالُ معرِّف · اتجاهان · P0033 بعد العددِ المسموح · فكُّ حجب · حجبُ النفس · التجهيل';

    -- وإلغاءُ كلِّ ما سبق — بما فيه آثارُه الجانبيّة
    RAISE EXCEPTION 'TAKI_VERIFY_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    -- 🪤 الاستثناءُ المُتّفق عليه وحده يُبتلع؛ وكلُّ ما عداه يُعاد رفعُه
    --    فيُفشل psql فعلاً (وإلّا كان الفحصُ مستحيلَ الفشل).
    IF SQLERRM <> 'TAKI_VERIFY_ROLLBACK' THEN RAISE; END IF;
  END;
END $v_behave$;

-- ⑮ وجدولٌ للقراءة البشرية — **بعد** كلّ تحقّقٍ رافع
SELECT 'الخادم' AS بند,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace') IS NULL
            THEN 'جدة — الإنتاج' ELSE 'مختبر ⚠️' END AS قيمة
UNION ALL SELECT 'جدولُ الحجب', CASE WHEN to_regclass('public.user_blocks') IS NULL THEN '❌' ELSE '✅' END
UNION ALL SELECT 'صفوفُ حجبٍ قائمة', (SELECT count(*)::text FROM public.user_blocks)
UNION ALL SELECT 'حسابات بمرآةٍ غيرِ فارغة',
       (SELECT count(*)::text FROM public.users WHERE COALESCE(array_length(blocked_merchants,1),0) > 0)
UNION ALL SELECT 'حارسُ الرسائل مُركَّب',
       (SELECT CASE WHEN count(*)=1 THEN '✅' ELSE '❌' END FROM pg_trigger
         WHERE tgrelid='public.booking_messages'::regclass AND tgname='tr_a0_guard_message_block')
UNION ALL SELECT 'ترتيبُ مشغّلات BEFORE',
       (SELECT string_agg(tgname,' → ' ORDER BY tgname) FROM pg_trigger
         WHERE tgrelid='public.booking_messages'::regclass AND NOT tgisinternal AND (tgtype::int & 2) > 0)
UNION ALL SELECT 'كتّابُ booking_messages',
       (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname='public' AND p.prokind='f'
           AND regexp_replace(pg_get_functiondef(p.oid), '--[^' || chr(10) || ']*', '', 'g')
               ~* 'INSERT INTO (public\.)?booking_messages')
UNION ALL SELECT 'رسائلُ طلبٍ جارٍ بعد الحجب (الإعداد)',
       (public.taki_chat_limits() ->> 'blocked_inflight')
UNION ALL SELECT 'سقفُ الرسائل لكلّ طلب (قائم)', (public.taki_chat_limits() ->> 'per_booking')
UNION ALL SELECT 'مشغّلُ المحو عند التجهيل',
       (SELECT CASE WHEN count(*)=1 THEN '✅' ELSE '❌' END FROM pg_trigger
         WHERE tgrelid='public.users'::regclass AND tgname='tr_zz_purge_user_blocks_on_anon');

-- ════════════════════════════════════════════════════════════════════════
-- -- ROLLBACK
-- DROP TRIGGER IF EXISTS tr_a0_guard_message_block ON public.booking_messages;
-- DROP TRIGGER IF EXISTS tr_zz_purge_user_blocks_on_anon ON public.users;
-- DROP TRIGGER IF EXISTS tr_user_blocks_mirror ON public.user_blocks;
-- DROP FUNCTION IF EXISTS public.tr_guard_message_block();
-- DROP FUNCTION IF EXISTS public.tr_purge_user_blocks_on_anon();
-- DROP FUNCTION IF EXISTS public.tr_user_blocks_mirror();
-- -- 🪤 وقبل إسقاط المحدِّد تُعاد الدوالُّ الأربعُ التي تناديه إلى نصّها
-- --    السابق (`bot_send_booking_message` · `bot_toggle_block` ·
-- --    `set_rating_reply` · `handle_deal_smart_notifications` ·
-- --    `taki_dispatch_coming_soon_window`) وإلّا انفجرت عند أوّل نداء.
-- --    ونسخُها السابقةُ تُقرأ من النسخة الاحتياطية الليلية، لا من المستودع
-- --    (`supabase/schema/00-full-schema.sql` متأخّرٌ عن الخادم — مقيس).
-- DROP FUNCTION IF EXISTS public.taki_is_blocked_pair(text, text);
-- DROP FUNCTION IF EXISTS public.taki_block_since(text, text);
-- DROP TABLE IF EXISTS public.user_blocks;      -- ⚠️ يمحو كلَّ حجبٍ سجّله مستخدم
-- -- و`taki_chat_limits()` تعود بإسقاط مفتاح `blocked_inflight` من بنائها.
-- ════════════════════════════════════════════════════════════════════════
