-- ════════════════════════════════════════════════════════════════════════════
-- v14.77 — المشاركة تُربط بالحساب، لا بنصّ الجوال
-- ════════════════════════════════════════════════════════════════════════════
-- v14.65 جعلت السحب يُبلّغ الفائز، والربط كان بالجوال نصّاً:
--     JOIN users u ON nullif(btrim(u.phone),'') = e.phone
-- و`contest_entries` **لا تحمل عمود حساب إطلاقاً** (قِيس: ١٤ عموداً، لا
-- `user_id` فيها). فالنصّ هو الرابط الوحيد — وله ثلاثة آثار كلها صامتة:
--
--   🔴 ١) **من غيّر جوّاله بعد المشاركة لا يصله إشعار الفوز.** الصفّ يحمل
--         الجوال القديم، والحساب يحمل الجديد، فالوصلة تسقط ولا خطأ يُرفع —
--         وهو بعينه العيب الذي بُنيت v14.65 لإغلاقه، يعود من باب آخر.
--   🔴 ٢) **«مشاركة واحدة لكل مستخدم» تُلتفّ بتغيير الجوال**: الفحص
--         `where e.phone = v_phone`، فبجوالٍ جديد يشارك نفس الحساب ثانيةً.
--   🔴 ٣) **حذف الحساب لا يمسح اسمه وجوّاله من المشاركات**: قِيس أن
--         `purge_expired_accounts` لا تذكر `contest_entries` إطلاقاً، فبيانات
--         من طلب حذف حسابه تبقى فيها إلى الأبد — خلافاً لوعد v14.19.
--
-- الحلّ: عمود `user_id` يُختم لحظة المشاركة، ويصير هو الرابط في المواضع
-- الثلاثة. و`phone` يبقى **لقطةً مجمّدة** للتواصل (كما الفاتورة تماماً): هو ما
-- أعطاه المشارك يوم شارك، ولا يتغيّر بتغيّر حسابه.
--
-- 🪤 الوصلة إلى `users` هنا `ON DELETE SET NULL` لا `CASCADE`: كل مفتاح أجنبي
--    قائم إلى `users` في هذه القاعدة هو CASCADE، ولو قلّدتُه لكان حذفُ حسابٍ
--    يمحو سجلّ فوزٍ سُلِّمت جائزته. السجلّ يبقى، والهويّة تُجهَّل.
-- 🪤 والربط بالجوال **لا يُحذف** بل يصير احتياطياً: صفوفٌ قديمة (وأيّ صفٍّ
--    كُتب قبل هذه الهجرة) لا تحمل `user_id`، فلو اكتفيتُ بالعمود الجديد
--    لسقط إشعارُها. الشرط `(user_id = … OR (user_id IS NULL AND phone = …))`.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

-- ١) العمود + الفهرس + الردم ─────────────────────────────────────────────────
ALTER TABLE public.contest_entries
  ADD COLUMN IF NOT EXISTS user_id text;

DO $fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.contest_entries'::regclass
       AND conname  = 'contest_entries_user_id_fkey'
  ) THEN
    ALTER TABLE public.contest_entries
      ADD CONSTRAINT contest_entries_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;
  END IF;
END $fk$;

CREATE INDEX IF NOT EXISTS idx_contest_entries_user
  ON public.contest_entries (contest_id, user_id);

-- ردم الصفوف القائمة من الجوال (مرّةً واحدة). جوالٌ يطابق أكثر من حساب يُترك
-- فارغاً عمداً — تخمين الهوية أسوأ من تركها للمسار الاحتياطي.
UPDATE public.contest_entries e
   SET user_id = u.id
  FROM public.users u
 WHERE e.user_id IS NULL
   AND nullif(btrim(u.phone), '') = btrim(e.phone)
   AND (SELECT count(*) FROM public.users u2
         WHERE nullif(btrim(u2.phone), '') = btrim(e.phone)) = 1;

-- ٢) المشاركة تُختم بالحساب ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_contest_entry(
  p_contest_id uuid, p_name text, p_phone text, p_answers jsonb, p_social jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c record; q jsonb; v_score int := 0; v_max int := 0; v_qual boolean;
  ans text; pts int;
  correct_set jsonb; n_correct int;
  v_uid text := auth.uid()::text;
  v_name text; v_phone text; v_role text;
begin
  if v_uid is null then
    raise exception 'يجب تسجيل الدخول للمشاركة في المسابقة';
  end if;
  -- identity (+ role) from THEIR account; client values are ignored
  select coalesce(nullif(btrim(name), ''), 'مشارك'), nullif(btrim(phone), ''), user_type
    into v_name, v_phone, v_role
  from users where id = v_uid;
  if v_phone is null then
    raise exception 'أكمل رقم جوالك في حسابك أولاً ثم شارك';
  end if;

  select * into c from contests where id = p_contest_id;
  if not found then raise exception 'المسابقة غير موجودة'; end if;
  if c.status <> 'active' then raise exception 'المسابقة غير مفعّلة حالياً'; end if;
  if c.starts_at is not null and now() < c.starts_at then raise exception 'المسابقة لم تبدأ بعد'; end if;
  if c.ends_at  is not null and now() > c.ends_at  then raise exception 'انتهت مدة المسابقة'; end if;

  -- audience gate (admins bypass so the owner can test any audience)
  if v_role is distinct from 'admin' then
    if c.audience = 'sellers' and v_role is distinct from 'seller' then
      raise exception 'هذه المسابقة مخصّصة للتجار فقط';
    end if;
    if c.audience = 'buyers' and v_role = 'seller' then
      raise exception 'هذه المسابقة مخصّصة للمشترين فقط';
    end if;
  end if;

  -- ONE entry per user — v14.77: بالحساب أوّلاً، وبالجوال للصفوف التي سبقت
  -- العمود. الاكتفاء بالجوال كان يسمح بمشاركةٍ ثانية بعد تغييره.
  if exists (
    select 1 from contest_entries e
     where e.contest_id = p_contest_id
       and (e.user_id = v_uid or (e.user_id is null and btrim(e.phone) = v_phone))
  ) then
    raise exception 'لقد شاركت في هذه المسابقة من قبل — لكل مشارك محاولة واحدة فقط';
  end if;

  for q in select * from jsonb_array_elements(c.questions) loop
    -- v12.37: multi-correct — correctAnswers[] first, legacy correctAnswer fallback
    correct_set := q->'correctAnswers';
    if correct_set is null or jsonb_typeof(correct_set) <> 'array' then
      correct_set := '[]'::jsonb;
    end if;
    if jsonb_array_length(correct_set) = 0
       and coalesce(btrim(q->>'correctAnswer'), '') <> '' then
      correct_set := jsonb_build_array(q->>'correctAnswer');
    end if;
    select count(*) into n_correct
      from jsonb_array_elements_text(correct_set) v where btrim(v) <> '';
    if n_correct > 0 then
      pts := coalesce(nullif(q->>'points','')::int, 1);
      v_max := v_max + pts;
      ans := btrim(coalesce(p_answers ->> (q->>'id'), ''));
      if ans <> '' and exists (
        select 1 from jsonb_array_elements_text(correct_set) v
         where btrim(v) <> '' and lower(btrim(v)) = lower(ans)
      ) then
        v_score := v_score + pts;
      end if;
    end if;
  end loop;

  v_qual := case
              when c.pass_mode = 'collect'     then true
              when c.pass_mode = 'any'         then v_score > 0
              when v_max = 0                   then true
              else v_score >= v_max
            end;

  insert into contest_entries (contest_id, user_id, name, phone, answers, social_answers, score, max_score, qualified)
  values (p_contest_id, v_uid, v_name, v_phone, coalesce(p_answers,'{}'::jsonb), coalesce(p_social,'{}'::jsonb), v_score, v_max, v_qual);

  return jsonb_build_object('success', true, 'qualified', v_qual, 'score', v_score, 'max_score', v_max);
end; $function$;

-- ٣) «هل شاركتُ؟» تسأل الحساب ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.my_contest_entry(p_contest_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_uid text := auth.uid()::text; v_phone text; r record;
begin
  if v_uid is null then return jsonb_build_object('entered', false); end if;
  select nullif(btrim(phone), '') into v_phone from users where id = v_uid;
  -- v14.77 — الحساب هو الرابط؛ الجوال احتياطيّ للصفوف التي سبقت العمود.
  -- (ولم يعد غيابُ الجوال يعني «لم يشارك»: من شارك ثم مسح جوّاله كان يُقال له
  --  إنه لم يشارك، فيحاول ويُردّ بخطأ «شاركتَ من قبل».)
  select score, max_score, qualified into r
    from contest_entries
   where contest_id = p_contest_id
     and (user_id = v_uid or (user_id is null and v_phone is not null and btrim(phone) = v_phone));
  if not found then return jsonb_build_object('entered', false); end if;
  return jsonb_build_object('entered', true, 'qualified', r.qualified, 'score', r.score, 'max_score', r.max_score);
end; $function$;

-- ٤) السحب يُبلّغ بالحساب ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.draw_contest_winners(p_contest_id uuid, p_count integer DEFAULT 1)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v        jsonb;
  v_title  text;
  v_prize  text;
  v_sent   int := 0;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'forbidden: admin only'; END IF;

  SELECT title, COALESCE(NULLIF(btrim(prize), ''), '') INTO v_title, v_prize
    FROM contests WHERE id = p_contest_id;

  -- Never reset existing winners; draw only from not-yet-winners.
  WITH picked AS (
    SELECT id FROM contest_entries
    WHERE contest_id = p_contest_id AND qualified = true AND is_winner = false
    ORDER BY random() LIMIT GREATEST(1, COALESCE(p_count, 1))
  ), upd AS (
    UPDATE contest_entries e SET is_winner = true
    FROM picked WHERE e.id = picked.id
    RETURNING e.name, e.phone, e.created_at
  )
  SELECT jsonb_agg(jsonb_build_object('name', name, 'phone', phone) ORDER BY created_at) INTO v FROM upd;

  UPDATE contests SET status = 'drawn', updated_at = now() WHERE id = p_contest_id;

  -- v14.65 — إشعارٌ لكل فائزٍ له حساب. الإدراج لا يُسقط السحب إن تعذّر.
  -- v14.77 — الربط بالحساب (`user_id`) لا بنصّ الجوال، فمن غيّر جوّاله بعد
  -- المشاركة يصله إشعارُه. والجوال يبقى مساراً احتياطياً للصفوف الأقدم.
  BEGIN
    WITH winners AS (
      SELECT DISTINCT COALESCE(e.user_id, u.id) AS user_id
      FROM contest_entries e
      LEFT JOIN users u
             ON e.user_id IS NULL
            AND nullif(btrim(u.phone), '') = btrim(e.phone)
      WHERE e.contest_id = p_contest_id
        AND e.is_winner = true
        AND COALESCE(e.user_id, u.id) IS NOT NULL
    ), ins AS (
      INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
      SELECT w.user_id,
             '🎉 مبروك! فزت في المسابقة',
             '🎉 Congratulations! You won',
             'فزت في «' || COALESCE(v_title, 'المسابقة') || '»'
               || CASE WHEN v_prize <> '' THEN ' — الجائزة: ' || v_prize ELSE '' END
               || '. سنتواصل معك لتسليم الجائزة.',
             'You won “' || COALESCE(v_title, 'the contest') || '”'
               || CASE WHEN v_prize <> '' THEN ' — prize: ' || v_prize ELSE '' END
               || '. We will contact you to hand it over.',
             'system',
             jsonb_build_object('audience', 'buyer', 'actionUrl', '/contests', 'contestId', p_contest_id)
      FROM winners w
      -- لا يُكرَّر الإشعار على سحبةٍ ثانية لنفس المسابقة
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications n
        WHERE n.user_id = w.user_id
          AND n.type = 'system'
          AND n.meta_data->>'contestId' = p_contest_id::text
      )
      RETURNING 1
    )
    SELECT count(*) INTO v_sent FROM ins;
  EXCEPTION WHEN OTHERS THEN
    v_sent := -1;   -- تعذّر الإبلاغ: السحب صحيح والجدول يقول ذلك
  END;

  RETURN jsonb_build_object('winners', COALESCE(v, '[]'::jsonb), 'notified', v_sent);
END $function$;

-- ٥) حذف الحساب يمسح هويّته من المشاركات ─────────────────────────────────────
-- v14.19 وعدت بتجهيل بيانات من طلب حذف حسابه، وقِيس أن `purge_expired_accounts`
-- **لا تذكر `contest_entries` إطلاقاً** — فاسم من حذف حسابه وجوّاله يبقيان فيها
-- إلى الأبد. السجلّ يبقى (فسجلّ الفوز وتسليم الجائزة لا يُمحى)، والهويّة تُجهَّل.
--
-- 🪤 وأُعيدت الدالّة **كاملةً** لا بترقيعٍ نصّيّ على جسمها الحيّ: التعديل الآليّ
--    على `pg_get_functiondef` يُصيب ما لا يُقصد (درس v14.63). وما دونها حرفُ
--    حرفٍ من النسخة القائمة على جدة، والفرق سطران في القسم (ج).
CREATE OR REPLACE FUNCTION public.purge_expired_accounts()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_n integer := 0; r record; v_mask text;
BEGIN
  FOR r IN
    SELECT id FROM public.users
     WHERE purge_after IS NOT NULL AND purge_after < now()
       AND COALESCE(is_anonymized, false) = false
  LOOP
    v_mask := 'deleted+' || substr(md5(r.id), 1, 12) || '@takisa.invalid';

    -- (أ) الصفّ العامّ
    UPDATE public.users
       SET name = 'مستخدم محذوف',
           shop = NULL, bio = NULL, address = NULL, avatar_url = NULL,
           phone = NULL, contact_phone = NULL,
           email = v_mask,
           lat = NULL, lng = NULL,
           delivery_address = NULL,
           notif_keywords = NULL, smart_alerts = NULL, followed_merchants = NULL,
           telegram_id = NULL, telegram_chat_id = NULL, whatsapp_chat_id = NULL,
           telegram_link_otp = NULL, telegram_link_otp_expires_at = NULL,
           consent_ip = NULL, consent_user_agent = NULL,
           is_anonymized = true, anonymized_at = now(),
           purge_after = NULL
     WHERE id = r.id;

    -- (ب) صفّ المصادقة **وهويّاته**. 🪤 v14.22 نظّفت `auth.users` وحدها، و
    --     `auth.identities.identity_data` تحمل البريد والاسم والجوال والعنوان.
    BEGIN
      UPDATE auth.users
         SET email = v_mask, phone = NULL, encrypted_password = '',
             raw_user_meta_data = '{}'::jsonb,
             email_change = NULL, phone_change = NULL
       WHERE id::text = r.id;
      UPDATE auth.identities
         SET identity_data = jsonb_build_object('sub', r.id, 'email', v_mask)
       WHERE user_id::text = r.id;
      DELETE FROM auth.refresh_tokens WHERE user_id = r.id;
      DELETE FROM auth.sessions WHERE user_id::text = r.id;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'auth scrub skipped for %: %', r.id, SQLERRM;
    END;

    -- (ج) ما يحمل هويّته خارج صفّه
    DELETE FROM public.user_addresses     WHERE user_id = r.id;
    DELETE FROM public.push_subscriptions WHERE user_id = r.id;
    DELETE FROM public.delivery_tracks    WHERE user_id = r.id;
    DELETE FROM public.email_outbox       WHERE user_id = r.id;
    DELETE FROM public.notifications      WHERE user_id = r.id;
    UPDATE public.ratings SET user_name = 'مستخدم محذوف' WHERE user_id = r.id;
    -- v14.77 — المشاركات: السجلّ يبقى والهويّة تُجهَّل.
    UPDATE public.contest_entries
       SET name = 'مشارك محذوف', phone = ''
     WHERE user_id = r.id;

    -- (د) الطلبات تبقى سجلّاً للتاجر، بلا اسم ولا جوال ولا ما يقود لبيته
    UPDATE public.bookings
       SET user_name = NULL, user_phone = NULL,
           delivery_address = CASE
             WHEN delivery_address IS NULL THEN NULL
             ELSE delivery_address - 'phone' - 'details' - 'lat' - 'lng' END
     WHERE user_id = r.id;

    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$function$;

-- ٦) تحقّقات تُفشل الهجرة إن كذبت ─────────────────────────────────────────────
DO $verify$
DECLARE n int; d text;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='contest_entries' AND column_name='user_id';
  IF n <> 1 THEN RAISE EXCEPTION 'العمود user_id لم يُنشأ'; END IF;

  SELECT confdeltype::text INTO d FROM pg_constraint
   WHERE conrelid='public.contest_entries'::regclass AND conname='contest_entries_user_id_fkey';
  IF d IS DISTINCT FROM 'n' THEN
    RAISE EXCEPTION 'الوصلة إلى users ليست ON DELETE SET NULL (جاءت %) — CASCADE هنا يمحو سجلّ الفوز', d;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n2 ON n2.oid=p.pronamespace
   WHERE n2.nspname='public' AND p.proname='draw_contest_winners';
  IF d NOT LIKE '%e.user_id%' THEN RAISE EXCEPTION 'السحب ما زال يربط بالجوال وحده'; END IF;

  SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n2 ON n2.oid=p.pronamespace
   WHERE n2.nspname='public' AND p.proname='submit_contest_entry';
  IF d NOT LIKE '%e.user_id = v_uid%' THEN RAISE EXCEPTION 'حارس المشاركة الواحدة ما زال بالجوال وحده'; END IF;

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace n2 ON n2.oid=p.pronamespace
   WHERE n2.nspname='public' AND p.proname='submit_contest_entry';
  IF n <> 1 THEN RAISE EXCEPTION 'نسختان من submit_contest_entry — النداء صار ملتبساً (%)', n; END IF;

  RAISE NOTICE '✅ v14.77 مطبَّقة';
END $verify$;

SELECT current_setting('server_version') AS "الخادم",
       (SELECT count(*) FROM public.contest_entries)                          AS "مشاركات",
       (SELECT count(*) FROM public.contest_entries WHERE user_id IS NOT NULL) AS "مربوطة بحساب";
