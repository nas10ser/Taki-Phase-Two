-- ════════════════════════════════════════════════════════════════════════════
-- v14.71b — قراءة البوتين تتبع الكاتب الموحَّد
-- ════════════════════════════════════════════════════════════════════════════
-- v14.71 وحّدت **الكتابة** (`taki_set_store_card` يكتب `users` و`store_profiles`
-- معاً)، فصار العمودان متطابقين من اليوم فصاعداً. لكن **القراءة** في البوتين
-- ظلّت مقلوبة: تفضّل `store_profiles` على `users`.
--
-- ولماذا يهمّ إن كان العمودان متطابقين؟ لأن التطابق يبدأ اليوم لا أمس: أي صفٍّ
-- كتبه الموقعُ قبل v14.71 يحمل القيمة في `users` وحده. القراءة المقلوبة تُظهر
-- ذلك الصفّ **فارغاً** في البوت إلى الأبد. (قِيس: صفر صفوف تفترق اليوم — فهذا
-- تصحيحُ اتجاهٍ لا إصلاحُ بيانات، وثمنه صفر.)
--
-- 🪤 `users` هو العمود الذي لا يكون أقدم من الآخر أبداً: البوت كان يكتب
--    الاثنين، والموقع يكتب `users` وحده. فالأولوية له، والارتداد للآخر.
-- 🪤 والتوقيعان لم يتغيّرا، فـ`CREATE OR REPLACE` آمنة هنا.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

CREATE OR REPLACE FUNCTION public.bot_get_store(p_telegram_id bigint, p_store_id text, p_whatsapp_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_now bigint := (extract(epoch from now())*1000)::bigint;
  v_name text; v_avatar text; v_bio text; v_city text; v_region text;
  v_avg numeric; v_cnt int; v_deals int; v_uid text;
  v_following boolean := false; v_blocked boolean := false; v_arr jsonb;
  v_wh jsonb; v_areal int; v_afake int;
BEGIN
  SELECT coalesce(nullif(btrim(u.shop),''), nullif(btrim(u.name),''), 'متجر'),
         coalesce(nullif(btrim(coalesce(u.avatar_url,'')),''), sp.avatar_url),
         coalesce(nullif(btrim(coalesce(u.bio,'')),''), sp.bio), u.working_hours
    INTO v_name, v_avatar, v_bio, v_wh
  FROM users u LEFT JOIN store_profiles sp ON sp.store_id=u.id
  WHERE u.id=p_store_id LIMIT 1;

  IF v_name IS NULL THEN
    SELECT max(shop_name) INTO v_name FROM deals WHERE store_id=p_store_id;
    IF v_name IS NULL THEN RETURN NULL; END IF;
  END IF;

  SELECT max(city), max(region) INTO v_city, v_region
    FROM deals WHERE store_id=p_store_id AND status='active';
  SELECT count(*) INTO v_deals
    FROM deals WHERE store_id=p_store_id AND status='active'
      AND (starts_at IS NULL OR starts_at<=v_now);
  SELECT round(avg(r.score)::numeric,1), count(*) INTO v_avg, v_cnt
    FROM ratings r JOIN deals d2 ON d2.id=r.deal_id
    WHERE d2.store_id=p_store_id AND r.deleted_at IS NULL;
  SELECT count(*) FILTER (WHERE is_real), count(*) FILTER (WHERE NOT is_real)
    INTO v_areal, v_afake FROM deal_authenticity_votes WHERE store_id=p_store_id;

  IF p_telegram_id IS NOT NULL OR p_whatsapp_id IS NOT NULL THEN
    v_uid := public._bot_uid(p_telegram_id, p_whatsapp_id);
    IF v_uid IS NOT NULL THEN
      SELECT (p_store_id = ANY(coalesce(followed_merchants,'{}'))),
             (p_store_id = ANY(coalesce(blocked_merchants,'{}')))
        INTO v_following, v_blocked FROM users WHERE id=v_uid;
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', x.id, 'item_name', x.item_name,
    'original_price', x.original_price, 'discounted_price', x.discounted_price,
    'discount_percentage', coalesce(x.discount_percentage,
        round(((x.original_price-x.discounted_price)/nullif(x.original_price,0))*100)::int)
  ) ORDER BY x.created_at DESC), '[]'::jsonb) INTO v_arr
  FROM (SELECT * FROM deals WHERE store_id=p_store_id AND status='active'
          AND (starts_at IS NULL OR starts_at<=v_now)
        ORDER BY created_at DESC LIMIT 8) x;

  RETURN jsonb_build_object(
    'store_id', p_store_id, 'name', v_name, 'avatar', v_avatar, 'bio', v_bio,
    'city', v_city, 'region', v_region,
    'rating_avg', coalesce(v_avg,0), 'rating_count', coalesce(v_cnt,0),
    'auth_real', coalesce(v_areal,0), 'auth_fake', coalesce(v_afake,0),
    'active_deals', coalesce(v_deals,0),
    'working_hours', v_wh, 'open_status', public.store_is_open(v_wh),
    'following', coalesce(v_following,false), 'blocked', coalesce(v_blocked,false),
    'deals', v_arr
  );
END; $function$;

CREATE OR REPLACE FUNCTION public.bot_list_followed(p_telegram_id bigint, p_whatsapp_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_uid text; v_now bigint := (extract(epoch from now())*1000)::bigint; v_ids text[]; v_arr jsonb;
BEGIN
  SELECT id, COALESCE(followed_merchants,'{}') INTO v_uid, v_ids
    FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_linked'); END IF;
  IF v_ids IS NULL OR array_length(v_ids,1) IS NULL THEN
    RETURN jsonb_build_object('success',true,'merchants','[]'::jsonb);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'store_id', u.id,
    'name', COALESCE(NULLIF(btrim(u.shop),''), NULLIF(btrim(u.name),''), 'متجر'),
    'avatar', COALESCE(nullif(btrim(coalesce(u.avatar_url,'')),''), sp.avatar_url),
    'bio', COALESCE(nullif(btrim(coalesce(u.bio,'')),''), sp.bio),
    'rating_avg', COALESCE((SELECT round(avg(r.score)::numeric,1) FROM ratings r JOIN deals d2 ON d2.id=r.deal_id
                            WHERE d2.store_id=u.id AND r.deleted_at IS NULL),0),
    'rating_count', COALESCE((SELECT count(*) FROM ratings r JOIN deals d2 ON d2.id=r.deal_id
                            WHERE d2.store_id=u.id AND r.deleted_at IS NULL),0),
    'active_deals', COALESCE((SELECT count(*) FROM deals d WHERE d.store_id=u.id AND d.status='active'
                            AND (d.starts_at IS NULL OR d.starts_at<=v_now)),0)
  )), '[]'::jsonb) INTO v_arr
  FROM users u LEFT JOIN store_profiles sp ON sp.store_id=u.id
  WHERE u.id = ANY(v_ids);
  RETURN jsonb_build_object('success',true,'merchants',v_arr);
END; $function$;

-- ── ودَينٌ صغير أُغلق في حينه ────────────────────────────────────────────────
-- `taki_store_card()` أُنشئت في v14.71 كقارئٍ موحَّد، ثم اتّضح أن القارئَين
-- أعلاه يقرآن داخل `SELECT … INTO` واحدة فلا يكسبان من ندائها شيئاً. دالةٌ لا
-- يناديها أحد دَينٌ برمجيّ لا اختصار — فتُحذف في نفس الإصدار الذي أنشأها.
DROP FUNCTION IF EXISTS public.taki_store_card(text);

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE
  n int; sid text; b jsonb;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='taki_store_card'
              AND pronamespace='public'::regnamespace) THEN
    RAISE EXCEPTION 'فشل: دالةٌ لا يناديها أحد ما زالت قائمة';
  END IF;

  FOREACH sid IN ARRAY ARRAY['bot_get_store','bot_list_followed'] LOOP
    SELECT count(*) INTO n FROM pg_proc
     WHERE proname=sid AND pronamespace='public'::regnamespace;
    IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ % = %', sid, n; END IF;
  END LOOP;

  -- الاختبار الذي يهمّ: صفٌّ على الطريقة القديمة (users وحده) يراه البوت.
  BEGIN
    SELECT u.id INTO sid FROM public.users u
     WHERE (u.user_type IN ('seller','admin') OR nullif(btrim(coalesce(u.shop,'')),'') IS NOT NULL)
       AND u.deleted_at IS NULL ORDER BY u.id LIMIT 1;
    IF sid IS NULL THEN RAISE EXCEPTION 'فشل: لا تاجر للاختبار'; END IF;

    -- نُحاكي صفّاً قديماً: القيمة في `users` وحده، و`store_profiles` فارغ.
    UPDATE public.users SET bio = 'نبذةُ صفٍّ قديم', avatar_url = 'https://api.takisa.net/x/old.jpg' WHERE id = sid;
    UPDATE public.store_profiles SET bio = NULL, avatar_url = NULL WHERE store_id = sid;

    b := public.bot_get_store(NULL::bigint, sid, NULL::text);
    IF coalesce(b->>'bio','') <> 'نبذةُ صفٍّ قديم' THEN
      RAISE EXCEPTION 'فشل: البوت لا يرى نبذة صفٍّ قديم (%)', coalesce(b->>'bio','∅');
    END IF;
    IF coalesce(b->>'avatar','') <> 'https://api.takisa.net/x/old.jpg' THEN
      RAISE EXCEPTION 'فشل: البوت لا يرى شعار صفٍّ قديم (%)', coalesce(b->>'avatar','∅');
    END IF;

    -- والارتداد ما زال قائماً: قيمةٌ في `store_profiles` وحده تُقرأ أيضاً.
    UPDATE public.users SET bio = NULL, avatar_url = NULL WHERE id = sid;
    UPDATE public.store_profiles SET bio = 'نبذةٌ من البوت' WHERE store_id = sid;
    b := public.bot_get_store(NULL::bigint, sid, NULL::text);
    IF coalesce(b->>'bio','') <> 'نبذةٌ من البوت' THEN
      RAISE EXCEPTION 'فشل: سقط الارتداد إلى store_profiles (%)', coalesce(b->>'bio','∅');
    END IF;

    RAISE EXCEPTION 'ROLLBACK_TEST_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TEST_OK' THEN RAISE; END IF;
  END;
END $verify$;

SELECT 'v14.71b' AS "الهجرة",
       (SELECT count(*) FROM pg_proc WHERE proname IN ('bot_get_store','bot_list_followed')
                                       AND pronamespace='public'::regnamespace) AS "قارئان";
