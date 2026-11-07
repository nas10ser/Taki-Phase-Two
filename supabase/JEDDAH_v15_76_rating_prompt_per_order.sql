-- ════════════════════════════════════════════════════════════════════════
-- TAKI · v15.76 — نافذةُ التقييم تصير **لكلّ طلب** لا لكلّ عمرٍ
--
-- 🔴 بلاغُ ناصر (للمرّة الثالثة): «عند اكتمال تسليم الطلب من قبل المشتري
--    او التاجر بلا كود لا يظهر تقييم المصداقيه والمتجر».
--
-- القياسُ الذي أنهى الحَيرة (٧ نوفمبر ٢٠٢٦، على جدة):
--   ١) المساراتُ الثلاثة متطابقةٌ في القاعدة: `complete_booking` (بكود) و
--      `buyer_confirm_receipt` و`merchant_handover_booking` (بلا كود) كلُّها
--      تكتب `status='completed'`، و`guard_booking_status` يختم `completed_at`
--      للثلاثة. قِيس: ٨٥ طلباً مكتملاً، **صفرٌ** بلا `completed_at`.
--      ⇒ فلا عيبَ خاصٌّ بـ«بلا كود» إطلاقاً. بحثي السابق كان في المكان الخطأ.
--   ٢) العيبُ الحقيقيّ في **القاعدة الحاكمة**: الدالّةُ كانت تنتهي بـ
--      `WHERE NOT (has_rating AND has_vote)` — و`has_rating` تعني «قيّم هذا
--      المتجرَ **مرّةً في حياته**» (فهرسٌ فريد `ratings_store_user_active_uq`
--      يسمح بتقييمٍ واحدٍ لكلّ متجر). فمن قيّم متجراً مرّةً **لا يُسأل عنه
--      أبداً بعدها** — بكودٍ أو بلا كود. قِيس على حساب ناصر: قيّم المتجرين
--      في يونيو ٢٠٢٦، فالدالّةُ تُرجع له **صفر** صفوفٍ اليوم من ٩ طلباتٍ
--      ختمها بلا كود هذا الأسبوع.
--   ٣) وفي الواجهة ثانيهما: `proceed = () => setRatingStep(prevReview ?
--      'done' : 'rate')` — فمن له تقييمٌ سابق يُقفَز به فوق النجوم.
--
-- العلاجُ: الوسمُ **لكلّ طلب** لا لكلّ عمر.
--   • عمودٌ `bookings.rating_prompt_at` = «سُئل عن هذا الطلب وأُغلقت نافذته».
--   • الدالّةُ تُرجع كلَّ طلبٍ مكتملٍ لم يُسأل عنه بعد — وتُرجع معه تقييمَه
--     السابق وتصويتَه من **القاعدة** لا من العروض المحمَّلة (كانت الواجهة
--     تبحث في `dealsRef` فإن لم يكن عرضُ المتجر محمَّلاً ظنّت «لا تقييم
--     سابق» ⇒ `addRating` تصطدم بالفهرس الفريد = زرٌّ صامت).
--   • `rating_prompt_seen(barcode)` يَسِم الطلبَ عند الإنجاز أو «لاحقاً»،
--     على **الخادم** فلا تُعيد النافذةُ نفسها على جهازٍ ثانٍ.
--
-- 🪤 وردمُ الماضي بنفس شرط الاستبعاد القديم — فلا تنفجر ٧٩ نافذةً في وجه
--    من أتمّ تقييمَه وتصويتَه قبل اليوم.
-- ════════════════════════════════════════════════════════════════════════

-- ───── حارسُ المختبر: هذه هجرةُ إنتاج ─────
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION '⛔ هذه هجرةُ إنتاج (جدة) — ومُنعت على مختبر طوكيو.';
  END IF;
END $guard$;

-- ───── ١) العمود ─────
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS rating_prompt_at timestamptz;

COMMENT ON COLUMN public.bookings.rating_prompt_at IS
  'v15.76 — لحظةُ إغلاق نافذة التقييم لهذا الطلب (إنجازاً أو «لاحقاً»). NULL = لم يُسأل بعد.';

CREATE INDEX IF NOT EXISTS bookings_rating_prompt_pending_idx
  ON public.bookings (user_id, completed_at DESC)
  WHERE status = 'completed' AND rating_prompt_at IS NULL;

-- ───── ٢) ردمُ الماضي بنفس شرط الاستبعاد القديم ─────
UPDATE public.bookings b
   SET rating_prompt_at = COALESCE(b.completed_at, now())
 WHERE b.status = 'completed'
   AND b.rating_prompt_at IS NULL
   AND EXISTS (SELECT 1 FROM public.ratings r
                WHERE r.user_id = b.user_id AND r.store_id = b.store_id
                  AND r.deleted_at IS NULL)
   AND EXISTS (SELECT 1 FROM public.deal_authenticity_votes v
                WHERE v.user_id = b.user_id AND v.deal_id = b.deal_id);

-- ───── ٣) الدالّةُ الحاكمة: لكلّ طلبٍ مرّةً واحدة ─────
CREATE OR REPLACE FUNCTION public.pending_rating_prompts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'barcode',      t.barcode,
           'deal_id',      t.deal_id,
           'store_id',     t.store_id,
           'shop_name',    t.shop_name,
           'completed_at', t.completed_at,
           -- 🪤 مصدرٌ واحد: الوسمان يُشتقّان من الحمولة نفسها فلا ينحرفان عنها.
           'has_rating',   (t.prev_rating IS NOT NULL),
           'has_vote',     (t.my_vote IS NOT NULL),
           'my_vote',      t.my_vote,
           'prev_rating',  t.prev_rating)
           ORDER BY t.completed_at DESC), '[]'::jsonb)
    FROM (
      SELECT b.barcode, b.deal_id, b.store_id, b.completed_at,
             coalesce(d.shop_name, nullif(u.shop, ''), u.name) AS shop_name,
             (SELECT v.is_real FROM public.deal_authenticity_votes v
               WHERE v.user_id = b.user_id AND v.deal_id = b.deal_id
               LIMIT 1) AS my_vote,
             (SELECT jsonb_build_object('id', r.id, 'deal_id', r.deal_id,
                                        'score', r.score,
                                        'comment', coalesce(r.comment, ''))
                FROM public.ratings r
               WHERE r.user_id = b.user_id AND r.store_id = b.store_id
                 AND r.deleted_at IS NULL
               LIMIT 1) AS prev_rating
        FROM public.bookings b
        LEFT JOIN public.deals d ON d.id = b.deal_id
        LEFT JOIN public.users u ON u.id = b.store_id
       WHERE b.user_id = auth.uid()::text
         AND b.status = 'completed'
         AND b.completed_at >= now() - interval '7 days'
         AND b.rating_prompt_at IS NULL
         -- العرضُ لا بدّ أن يبقى: التصويتُ والتقييمُ كلاهما مرتبطٌ بـ`deal_id`
         -- بمفتاحٍ أجنبيّ، فطلبٌ بعرضٍ محذوفٍ حذفاً صلباً لا يُمكن تقييمه.
         AND d.id IS NOT NULL
       ORDER BY b.completed_at DESC
       LIMIT 20
    ) t;
$function$;

REVOKE ALL ON FUNCTION public.pending_rating_prompts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pending_rating_prompts() FROM anon;
GRANT EXECUTE ON FUNCTION public.pending_rating_prompts() TO authenticated;

-- ───── ٤) وسمُ الطلب: المشتري وحده، وعلى صفّه وحده ─────
CREATE OR REPLACE FUNCTION public.rating_prompt_seen(p_barcode text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid text := auth.uid()::text;
  v_n   integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'يجب تسجيل الدخول' USING ERRCODE = '28000';
  END IF;
  UPDATE public.bookings
     SET rating_prompt_at = now()
   WHERE barcode = upper(btrim(p_barcode))
     AND user_id = v_uid
     AND rating_prompt_at IS NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$function$;

REVOKE ALL ON FUNCTION public.rating_prompt_seen(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rating_prompt_seen(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rating_prompt_seen(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ════════════════════════════════════════════════════════════════════════
-- التحقّق: كلُّه `DO` يرفع استثناءً — فجدولُ ✅/❌ لا يُفشل psql وحده.
-- ════════════════════════════════════════════════════════════════════════

-- ① البنية
DO $v1$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='bookings'
                    AND column_name='rating_prompt_at') THEN
    RAISE EXCEPTION '❌ العمود rating_prompt_at غائب';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='rating_prompt_seen') THEN
    RAISE EXCEPTION '❌ الدالّة rating_prompt_seen غائبة';
  END IF;
END $v1$;

-- ② القاعدةُ القديمة اندثرت فعلاً، والجديدة سارية (بعد تجريد التعليقات —
--    درسُ «الحارسُ يقرأ تعليقَه»)
DO $v2$
DECLARE src text;
BEGIN
  SELECT regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g')
    INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='pending_rating_prompts';
  IF src LIKE '%NOT (t.has_rating AND t.has_vote)%' THEN
    RAISE EXCEPTION '❌ شرطُ العمر القديم ما زال في الدالّة';
  END IF;
  IF src NOT LIKE '%rating_prompt_at IS NULL%' THEN
    RAISE EXCEPTION '❌ الدالّة لا تقرأ وسمَ الطلب';
  END IF;
  IF src NOT LIKE '%prev_rating%' OR src NOT LIKE '%my_vote%' THEN
    RAISE EXCEPTION '❌ الدالّة لا تُرجع التقييمَ السابق ولا التصويت';
  END IF;
END $v2$;

-- ③ اختبارٌ سلوكيّ على بياناتٍ حقيقيّة، موجبٌ وسالب، بلا أثرٍ صافٍ.
--    (كلُّه في معاملةٍ واحدة: الوسمُ يُرفع ثمّ يُعاد في نفس الكتلة.)
DO $v3$
DECLARE
  v_uid text; v_bc text; v_prev timestamptz; v_hit boolean;
BEGIN
  SELECT b.user_id, b.barcode, b.rating_prompt_at
    INTO v_uid, v_bc, v_prev
    FROM public.bookings b
    JOIN public.deals d ON d.id = b.deal_id
   WHERE b.status = 'completed'
     AND b.completed_at >= now() - interval '7 days'
     AND EXISTS (SELECT 1 FROM public.ratings r
                  WHERE r.user_id=b.user_id AND r.store_id=b.store_id AND r.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM public.deal_authenticity_votes v
                  WHERE v.user_id=b.user_id AND v.deal_id=b.deal_id)
   ORDER BY b.completed_at DESC
   LIMIT 1;

  IF v_bc IS NULL THEN
    RAISE EXCEPTION '❌ لا عيّنةَ اختبار: لا طلبَ مكتملاً أتمّ صاحبُه التقييمَ والتصويت — الاختبارُ الذي لا يختبر شيئاً أسوأُ من لا اختبار';
  END IF;

  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- موجب: طلبٌ لم يُسأل عنه يظهر **رغم** أنّ التقييمَ والتصويتَ تامّان
  UPDATE public.bookings SET rating_prompt_at = NULL WHERE barcode = v_bc;
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(public.pending_rating_prompts()) e
                  WHERE e->>'barcode' = v_bc) INTO v_hit;
  IF NOT v_hit THEN
    RAISE EXCEPTION '❌ فشل الموجب: الطلب % لم يظهر وهو غيرُ موسوم', v_bc;
  END IF;

  -- وحمولتُه تحمل التقييمَ السابق فعلاً (لا تعتمد الواجهةُ على عرضٍ محمَّل)
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(public.pending_rating_prompts()) e
                  WHERE e->>'barcode' = v_bc
                    AND e->'prev_rating' IS NOT NULL
                    AND jsonb_typeof(e->'prev_rating') = 'object'
                    AND (e->'prev_rating'->>'score') IS NOT NULL) INTO v_hit;
  IF NOT v_hit THEN
    RAISE EXCEPTION '❌ الحمولة بلا prev_rating صالح للطلب %', v_bc;
  END IF;

  -- سالب: بعد الوسم يختفي
  UPDATE public.bookings SET rating_prompt_at = now() WHERE barcode = v_bc;
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(public.pending_rating_prompts()) e
                  WHERE e->>'barcode' = v_bc) INTO v_hit;
  IF v_hit THEN
    RAISE EXCEPTION '❌ فشل السالب: الوسمُ لا يُخفي الطلب %', v_bc;
  END IF;

  -- وإعادةُ الحال كما كان بالضبط (صفرُ أثرٍ على الإنتاج)
  UPDATE public.bookings SET rating_prompt_at = v_prev WHERE barcode = v_bc;
  RAISE NOTICE '✅ اختبارٌ سلوكيّ موجب+سالب نجح على الطلب % (أُعيد وسمُه كما كان)', v_bc;
END $v3$;

-- ④ وسمُ الطلب يرفض المجهول
DO $v4$
BEGIN
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.rating_prompt_seen('0000000000');
    RAISE EXCEPTION '❌ rating_prompt_seen قبلت نداءً بلا هويّة';
  EXCEPTION WHEN sqlstate '28000' THEN
    NULL; -- الرمزُ بعينه لا «أيّ استثناء»
  END;
END $v4$;

-- ───── جدولُ القراءة (للعين فقط — التحقّقُ أعلاه هو الحَكَم) ─────
SELECT 'الخادم' AS بند,
       coalesce(obj_description('public'::regnamespace,'pg_namespace'),'جدة — الإنتاج') AS قيمة
UNION ALL SELECT 'العمود rating_prompt_at',
  CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='bookings' AND column_name='rating_prompt_at')
  THEN '✅' ELSE '❌' END
UNION ALL SELECT 'طلباتٌ مكتملة مردومة (وُسمت)',
  (SELECT count(*)::text FROM public.bookings WHERE status='completed' AND rating_prompt_at IS NOT NULL)
UNION ALL SELECT 'طلباتٌ مكتملة تنتظر السؤال',
  (SELECT count(*)::text FROM public.bookings WHERE status='completed' AND rating_prompt_at IS NULL)
UNION ALL SELECT 'rating_prompt_seen ممنوحةٌ لـauthenticated',
  CASE WHEN has_function_privilege('authenticated','public.rating_prompt_seen(text)','EXECUTE')
  THEN '✅' ELSE '❌' END
UNION ALL SELECT 'anon ممنوعةٌ من الدالّتين',
  CASE WHEN NOT has_function_privilege('anon','public.rating_prompt_seen(text)','EXECUTE')
        AND NOT has_function_privilege('anon','public.pending_rating_prompts()','EXECUTE')
  THEN '✅' ELSE '❌' END;
