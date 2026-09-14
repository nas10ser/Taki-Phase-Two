-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.32 — الإيقاف يوقف فعلاً (طلب ناصر ٢)
-- ════════════════════════════════════════════════════════════════════════════
-- ما كانت اللوحة تَعِد به: «المستخدم لن يستطيع تسجيل الدخول» · «الحسابات
-- المُعلَّقة لا تستطيع تسجيل الدخول» · «لن يتمكّن من استخدام المنصّة».
-- ما كان يقع فعلاً: `users.is_suspended` عمودٌ يُقرأ في **حارس الحجز وحده**.
-- الموقوف يسجّل الدخول متى شاء، وجلسته المفتوحة تبقى تعمل بلا انقطاع، ويتصفّح
-- ويحادث ويقيّم. والتاجر الموقوف تبقى عروضه معروضة ويستطيع نشر غيرها.
--
-- هذه الهجرة تجعل الوعد صحيحاً:
--   ١. الإيقاف يمنع الدخول فعلاً (`auth.users.banned_until`).
--   ٢. وينهي الجلسات القائمة (حذف `auth.sessions` و`auth.refresh_tokens`).
--   ٣. وعروض التاجر الموقوف تختفي من الرئيسية ومن «القريب مني».
--   ٤. ولا ينشر الموقوف عرضاً جديداً ولا يُحيي قديماً.
--   ٥. ولا يعود بحسابٍ جديد بنفس البريد أو الجوال.
--   ٦. وسببُ رفض الحجز يصل المشتري بدل «تحقق من اتصالك».
--
-- 🔴 وعطبٌ ثالث كُشف في الطريق: عقوبة الإلغاءات المتكررة **تُجدّد نفسها**.
--
-- الخادم المستهدف: **جدة (الإنتاج)**. يرفض التنفيذ على مختبر طوكيو.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'TOKYO_LAB_REFUSED: هذه هجرة إنتاج. نفّذها على جدة.';
  END IF;
END
$guard$;

-- ── ١. الإيقاف: منع الدخول + إنهاء الجلسات ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_suspend_account(
  p_user_id text, p_suspend boolean, p_reason text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_msg text; v_type text; v_uuid uuid; v_sessions int := 0;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Admin only'; END IF;
  SELECT user_type INTO v_type FROM users WHERE id = p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'المستخدم غير موجود'; END IF;
  IF v_type = 'admin' THEN RAISE EXCEPTION 'لا يمكن إيقاف حساب إداري من هنا'; END IF;

  UPDATE users SET is_suspended = p_suspend WHERE id = p_user_id;
  BEGIN v_uuid := p_user_id::uuid; EXCEPTION WHEN others THEN v_uuid := NULL; END;

  IF p_suspend THEN
    -- (أ) منع الدخول. GoTrue يرفض إصدار أي رمز ما دام `banned_until` مستقبلاً.
    --     تاريخٌ بعيد لا «إلى الأبد»: العمود زمنيّ، وفكّ الإيقاف يُفرغه.
    IF v_uuid IS NOT NULL THEN
      UPDATE auth.users SET banned_until = now() + interval '100 years' WHERE id = v_uuid;
      -- (ب) إنهاء ما هو قائم. بلا هذا يبقى الموقوف يعمل من تبويبٍ مفتوح
      --     أسابيع: منعُ الدخول لا يلمس رمزاً صدر قبله.
      DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id;
      WITH d AS (DELETE FROM auth.sessions WHERE user_id = v_uuid RETURNING 1)
      SELECT count(*) INTO v_sessions FROM d;
    END IF;

    v_msg := '⛔ تم إيقاف حسابك من إدارة تاكي' ||
             CASE WHEN COALESCE(TRIM(p_reason), '') <> '' THEN ' — السبب: ' || TRIM(p_reason) ELSE '' END || '.';
    INSERT INTO user_warnings (user_id, user_role, reason, admin_id)
    VALUES (p_user_id, v_type, v_msg, auth.uid()::text);
  ELSE
    IF v_uuid IS NOT NULL THEN
      UPDATE auth.users SET banned_until = NULL WHERE id = v_uuid;
    END IF;
    v_msg := '✅ تم إعادة تفعيل حسابك — أهلاً بعودتك.';
  END IF;

  INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
  VALUES (p_user_id, CASE WHEN p_suspend THEN '⛔ إيقاف الحساب' ELSE '✅ إعادة التفعيل' END,
          CASE WHEN p_suspend THEN '⛔ Account suspended' ELSE '✅ Account restored' END,
          v_msg, v_msg, 'system', jsonb_build_object('audience', 'user'));

  RETURN jsonb_build_object('success', true, 'suspended', p_suspend,
                            'sessions_killed', v_sessions);
END $$;

-- ── ٢. الموقوف لا ينشر ولا يُحيي ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_guard_suspended_publish()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_blocked boolean;
BEGIN
  SELECT (is_suspended OR deleted_at IS NOT NULL) INTO v_blocked
  FROM public.users WHERE id = NEW.store_id;
  IF COALESCE(v_blocked, false) THEN
    RAISE EXCEPTION 'حسابك موقوف — لا يمكنك نشر عروض. تواصل مع إدارة تاكي.'
      USING ERRCODE = 'P0018';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_ab_guard_suspended_publish ON public.deals;
CREATE TRIGGER tr_ab_guard_suspended_publish
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW WHEN (NEW.status = 'active')
  EXECUTE FUNCTION public.taki_guard_suspended_publish();

-- ── ٣. لا عودة بحسابٍ جديد بنفس البريد أو الجوال ────────────────────────────
-- 🪤 القيد الفريد على `users.phone` يمنع تكرار الجوال، لكنه **لا يمنع** بريداً
-- جديداً بجوال جديد. وحساب الموقوف يبقى صفّاً حيّاً، فالقيد نفسه لا يُسقط
-- المحاولة إلا صدفةً. هنا نمنع صراحةً ونقول السبب.
CREATE OR REPLACE FUNCTION public.taki_guard_banned_signup()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_hit text;
BEGIN
  SELECT id INTO v_hit FROM public.users
  WHERE is_suspended = true
    AND id <> NEW.id
    AND (   (NULLIF(btrim(lower(NEW.email)), '') IS NOT NULL
             AND lower(email) = btrim(lower(NEW.email)))
         OR (NULLIF(btrim(NEW.phone), '') IS NOT NULL
             AND regexp_replace(COALESCE(phone,''), '[^0-9]', '', 'g')
               = regexp_replace(NEW.phone, '[^0-9]', '', 'g')) )
  LIMIT 1;
  IF v_hit IS NOT NULL THEN
    RAISE EXCEPTION 'هذا البريد أو الجوال مرتبط بحساب موقوف. تواصل مع إدارة تاكي.'
      USING ERRCODE = 'P0019';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_aa_guard_banned_signup ON public.users;
CREATE TRIGGER tr_aa_guard_banned_signup
  BEFORE INSERT ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.taki_guard_banned_signup();

-- ── ٤. عقوبة الإلغاءات لا تُجدّد نفسها ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.taki_cancel_abuse_scan()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s jsonb; v_cats text[]; v_window int; v_thresh int;
  v_cb boolean; v_ct boolean; v_gap int; v_before int; v_action text; v_ban_days int;
  r record; v_warn_count int; v_last timestamptz; v_wid uuid; v_msg text; v_delay int;
BEGIN
  SELECT value INTO s FROM platform_settings WHERE key = 'cancel_abuse_settings';
  IF s IS NULL OR COALESCE((s->>'enabled')::boolean, false) IS NOT TRUE THEN RETURN; END IF;
  v_cats     := COALESCE(ARRAY(SELECT jsonb_array_elements_text(s->'categories')), '{}');
  v_window   := GREATEST(COALESCE((s->>'window_days')::int, 30), 1);
  v_thresh   := GREATEST(COALESCE((s->>'cancel_threshold')::int, 3), 1);
  v_cb       := COALESCE((s->>'count_buyer_cancel')::boolean, true);
  v_ct       := COALESCE((s->>'count_timeout')::boolean, true);
  v_gap      := GREATEST(COALESCE((s->>'warn_gap_hours')::int, 72), 1);
  v_before   := GREATEST(COALESCE((s->>'warnings_before_action')::int, 3), 1);
  v_action   := COALESCE(s->>'action', 'booking_ban');
  v_ban_days := GREATEST(COALESCE((s->>'ban_days')::int, 7), 1);
  v_delay    := COALESCE((SELECT (value->>'warn_delay_minutes')::int FROM platform_settings WHERE key = 'moderation_settings'), 0);

  FOR r IN
    SELECT b.user_id, u.name, count(*) AS n
    FROM bookings b
    JOIN deals d ON d.id = b.deal_id
    JOIN users u ON u.id = b.user_id
    WHERE b.status = 'cancelled'
      AND ((v_cb AND b.cancelled_by = 'buyer') OR (v_ct AND b.cancelled_by = 'timeout'))
      AND b.created_at >= now() - make_interval(days => v_window)
      AND (cardinality(v_cats) = 0 OR d.category = ANY(v_cats))
      AND u.user_type <> 'admin'
      AND COALESCE(u.is_suspended, false) = false
      AND (u.booking_banned_until IS NULL OR u.booking_banned_until < now())
      -- 🔴 v14.32 — العقوبة كانت تُجدّد نفسها إلى ما لا نهاية.
      -- السبب: فحص المهلة وعدّاد الإنذارات يبحثان عن صفوفٍ نصّها يبدأ بـ
      -- «⚠️ إلغاءات متكررة»، بينما صفّ **العقوبة** نصّه يبدأ بـ«⏸️ تم تعليق
      -- الحجز» أو «⛔ تم إيقاف حسابك». فالماسح لا يرى عقوبته السابقة إطلاقاً.
      -- والنتيجة: مشترٍ عوقب ٧ أيام على ثلاثة إلغاءات، يُعاقَب ٧ أيام أخرى
      -- فور انقضائها على **نفس** الإلغاءات، ويتكرّر حتى تخرج من نافذة الثلاثين
      -- يوماً — أي حظرٌ شبه دائم على مخالفةٍ واحدة.
      -- العلاج: لا يُحسب إلا ما وقع **بعد** آخر إجراء. فالعقوبة مرّة لكل مجموعة.
      AND b.created_at > COALESCE((
            SELECT max(w.created_at) FROM user_warnings w
             WHERE w.user_id = b.user_id
               AND (w.reason LIKE '⏸️ تم تعليق الحجز%'
                 OR w.reason LIKE '⛔ تم إيقاف حسابك بسبب تكرار%')
          ), '-infinity'::timestamptz)
    GROUP BY b.user_id, u.name
    HAVING count(*) >= v_thresh
  LOOP
    -- المهلة بين إنذار وإنذار — يحددها المالك
    -- المهلة تُقاس من آخر **أي** إجراء (إنذاراً كان أو عقوبة) لا من آخر إنذار
    -- وحده — وإلا أنذر الماسحُ من عاقبه قبل ساعة.
    SELECT max(created_at) INTO v_last FROM user_warnings
     WHERE user_id = r.user_id
       AND (reason LIKE '⚠️ إلغاءات متكررة%'
         OR reason LIKE '⏸️ تم تعليق الحجز%'
         OR reason LIKE '⛔ تم إيقاف حسابك بسبب تكرار%');
    IF v_last IS NOT NULL AND v_last > now() - make_interval(hours => v_gap) THEN CONTINUE; END IF;

    SELECT count(*) INTO v_warn_count FROM user_warnings
     WHERE user_id = r.user_id AND reason LIKE '⚠️ إلغاءات متكررة%';

    IF v_warn_count < v_before THEN
      v_msg := format('⚠️ إلغاءات متكررة: رصدنا %s حجوزات ملغاة أو غير مستلمة خلال آخر %s يوماً. تكرار ذلك سيؤدي لتعليق الحجز أو إيقاف الحساب. (إنذار %s من %s)', r.n, v_window, v_warn_count + 1, v_before);
      INSERT INTO user_warnings (user_id, user_role, reason, admin_id)
      VALUES (r.user_id, 'buyer', v_msg, NULL) RETURNING id INTO v_wid;
      IF v_delay <= 0 THEN
        INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
        VALUES (r.user_id, '⚠️ تنبيه من إدارة تاكي', '⚠️ Warning from TAKI', v_msg, v_msg, 'system',
                jsonb_build_object('audience', 'user', 'admin_warning', TRUE));
      ELSE
        INSERT INTO pending_warnings (warning_id, user_id, message, deliver_at)
        VALUES (v_wid, r.user_id, v_msg, now() + make_interval(mins => v_delay));
      END IF;
    ELSE
      IF v_action = 'suspend' THEN
        UPDATE users SET is_suspended = true WHERE id = r.user_id;
        v_msg := '⛔ تم إيقاف حسابك بسبب تكرار إلغاء الحجوزات بعد عدة إنذارات — تواصل مع إدارة تاكي.';
      ELSE
        UPDATE users SET booking_banned_until = now() + make_interval(days => v_ban_days),
                         booking_ban_reason = 'إلغاءات متكررة (آلي)'
         WHERE id = r.user_id;
        v_msg := format('⏸️ تم تعليق الحجز على حسابك لمدة %s أيام بسبب تكرار الإلغاء/عدم الاستلام بعد عدة إنذارات.', v_ban_days);
      END IF;
      INSERT INTO user_warnings (user_id, user_role, reason, admin_id)
      VALUES (r.user_id, 'buyer', v_msg, NULL);
      INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
      VALUES (r.user_id, '⛔ إجراء من إدارة تاكي', '⛔ TAKI enforcement', v_msg, v_msg, 'system',
              jsonb_build_object('audience', 'user', 'admin_warning', TRUE));
      INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type, meta_data)
      SELECT id, '🚫 عقوبة إلغاءات متكررة', '🚫 Cancel-abuse action',
             format('طُبقت عقوبة تلقائية على «%s»: %s', COALESCE(r.name, r.user_id), v_msg),
             'Automatic cancel-abuse action applied', 'system',
             jsonb_build_object('audience', 'admin')
      FROM users WHERE user_type = 'admin';
    END IF;
  END LOOP;
END $function$;


-- ── ٥. محرّك العرض: عروض الموقوف تختفي ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.browse_deals(p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_gender text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_mall text DEFAULT NULL::text, p_store_id text DEFAULT NULL::text, p_season_id text DEFAULT NULL::text, p_sort text DEFAULT 'new'::text, p_mode text DEFAULT 'live'::text, p_open_now boolean DEFAULT false, p_verified boolean DEFAULT false, p_cursor_key double precision DEFAULT NULL::double precision, p_cursor_id text DEFAULT NULL::text, p_limit integer DEFAULT 30, p_blocked text[] DEFAULT NULL::text[], p_exclude_ids text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now bigint := (EXTRACT(epoch FROM now()) * 1000)::bigint;
  v_lim integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 60);
  v_q text := public.taki_norm(p_query);
  v_ts tsquery; v_long boolean := false;
  v_sort text := lower(COALESCE(p_sort, 'new'));
  v_expr text; v_cast text; v_desc boolean; v_dir text; v_cmp text;
  v_where text; v_page_w text; v_closed text[]; v_out jsonb; v_total bigint;
  c_cap constant integer := 5000;
BEGIN
  IF v_q IS NOT NULL THEN
    SELECT to_tsquery('simple', string_agg(quote_literal(t) || ':*', ' & ')) INTO v_ts
      FROM unnest(string_to_array(v_q, ' ')) AS t WHERE t <> '';
    v_long := length(v_q) >= 3;
  END IF;

  IF v_ts IS NOT NULL AND v_sort IN ('best', 'relevance') THEN
    v_expr := format('(ts_rank_cd(d.search_vec, %L::tsquery) * 8 + word_similarity(%L, d.name_norm) * 4'
                     ' + CASE WHEN d.name_norm LIKE %L THEN 3 ELSE 0 END'
                     ' + CASE WHEN d.name_norm LIKE %L THEN 2 ELSE 0 END)',
                     v_ts::text, v_q, v_q || '%', '%' || v_q || '%');
    v_cast := 'double precision'; v_desc := true;
  ELSIF v_sort = 'price' THEN
    v_expr := 'd.discounted_price'; v_cast := 'numeric'; v_desc := false;
  ELSIF v_sort = 'discount' THEN
    v_expr := 'd.discount_percentage'; v_cast := 'integer'; v_desc := true;
  ELSIF v_sort = 'reliability' THEN
    v_expr := 'd.reliability_score'; v_cast := 'integer'; v_desc := true;
  ELSIF v_sort = 'soon' THEN
    v_expr := 'COALESCE(d.starts_at, 0)'; v_cast := 'bigint'; v_desc := false;
  ELSE
    v_expr := 'd.created_at'; v_cast := 'bigint'; v_desc := true;
  END IF;
  v_dir := CASE WHEN v_desc THEN 'DESC' ELSE 'ASC' END;
  v_cmp := CASE WHEN v_desc THEN '<' ELSE '>' END;

  v_where := 'd.status = ''active'''
          || ' AND (d.is_unlimited OR COALESCE(d.quantity,0) > 0 OR COALESCE(d.initial_quantity,0) <= 0)';
  -- v14.32 — عروض متجرٍ موقوف لا تُعرض. كان الإيقاف يُخفي صفحة المتجر من
  -- الدليل وحدها، بينما عروضه تبقى في الرئيسية وفي «القريب مني» ويفتحها
  -- المشترون ويحجزون — أي أن «إيقاف التاجر» لم يكن يوقف بيعه.
  -- الفلترة هنا لا في صفوف العروض: فكّ الإيقاف يُعيدها كما كانت بلا أي إصلاح.
  v_where := v_where || ' AND NOT EXISTS (SELECT 1 FROM public.users su'
                     || ' WHERE su.id = d.store_id AND (su.is_suspended OR su.deleted_at IS NOT NULL))';


  IF lower(COALESCE(p_mode,'live')) = 'coming_soon' THEN
    v_where := v_where || format(' AND d.starts_at IS NOT NULL AND d.starts_at > %s AND d.starts_at <= %s', v_now, v_now + 604800000);
  ELSE
    v_where := v_where || format(' AND COALESCE(d.starts_at, 0) <= %s'
      ' AND %s <= (GREATEST(COALESCE(d.starts_at,0), d.created_at)::bigint'
      '            + (CASE WHEN COALESCE(d.expires_in_minutes,0) = 0 THEN 120 ELSE d.expires_in_minutes END)::bigint * 60000)', v_now, v_now);
  END IF;

  IF NULLIF(p_category,'') IS NOT NULL AND p_category <> 'all' THEN
    v_where := v_where || format(' AND (d.category = %L OR d.category = ''all'')', p_category); END IF;
  IF NULLIF(p_gender,'') IS NOT NULL AND p_gender <> 'all' THEN
    v_where := v_where || format(' AND (d.gender = %L OR d.gender = ''all'')', p_gender); END IF;
  IF NULLIF(p_store_id,'') IS NOT NULL THEN
    v_where := v_where || format(' AND d.store_id = %L', p_store_id); END IF;
  IF NULLIF(p_season_id,'') IS NOT NULL THEN
    v_where := v_where || format(' AND d.season_id = %L', p_season_id); END IF;

  IF NULLIF(p_mall,'') IS NOT NULL THEN
    v_where := v_where || format(' AND d.loc_keys @> ARRAY[%L]::text[]', 'm:' || p_mall);
  ELSIF NULLIF(p_city,'') IS NOT NULL THEN
    v_where := v_where || format(' AND d.loc_keys @> ARRAY[%L]::text[]', 'c:' || p_city);
  ELSIF NULLIF(p_region,'') IS NOT NULL THEN
    v_where := v_where || format(' AND d.loc_keys @> ARRAY[%L]::text[]', 'r:' || p_region);
  END IF;

  -- v13.25 — الحظر والاستثناء (كانا ترشيحاً محلياً على النافذة المُحمّلة)
  IF p_blocked IS NOT NULL AND COALESCE(array_length(p_blocked,1),0) > 0 THEN
    v_where := v_where || format(' AND NOT (d.store_id = ANY(%L::text[]))', p_blocked);
  END IF;
  IF p_exclude_ids IS NOT NULL AND COALESCE(array_length(p_exclude_ids,1),0) > 0 THEN
    v_where := v_where || format(' AND NOT (d.id = ANY(%L::text[]))', p_exclude_ids);
  END IF;

  IF COALESCE(p_open_now,false) THEN
    v_closed := taki_internal.closed_store_ids();
    IF COALESCE(array_length(v_closed,1),0) > 0 THEN
      v_where := v_where || format(' AND NOT (d.store_id = ANY(%L::text[]))', v_closed);
    END IF;
  END IF;

  IF COALESCE(p_verified,false) THEN
    v_where := v_where || ' AND (d.auth_real_count + d.auth_fake_count) > 0 AND d.auth_real_count >= d.auth_fake_count';
  END IF;

  IF v_ts IS NOT NULL THEN
    IF v_long THEN
      v_where := v_where || format(' AND (d.search_vec @@ %L::tsquery OR d.name_norm LIKE %L OR %L <%% d.name_norm)', v_ts::text, '%' || v_q || '%', v_q);
    ELSE
      v_where := v_where || format(' AND d.search_vec @@ %L::tsquery', v_ts::text);
    END IF;
  END IF;

  EXECUTE format('SELECT count(*)::bigint FROM (SELECT 1 FROM public.deals d WHERE %s LIMIT %s) z', v_where, c_cap + 1) INTO v_total;

  v_page_w := v_where;
  IF p_cursor_id IS NOT NULL AND p_cursor_key IS NOT NULL THEN
    v_page_w := v_page_w || format(' AND ((%1$s) %2$s (%3$L)::%4$s OR ((%1$s) = (%3$L)::%4$s AND d.id %2$s %5$L))',
                                   v_expr, v_cmp, p_cursor_key::text, v_cast, p_cursor_id);
  END IF;

  EXECUTE format($q$
    WITH page AS (
      SELECT d.*, (%1$s)::double precision AS _k FROM public.deals d
      WHERE %2$s ORDER BY %1$s %3$s, d.id %3$s LIMIT %4$s
    ), ranked AS (
      SELECT p.*, row_number() OVER (ORDER BY p._k %3$s, p.id %3$s) AS _rn FROM page p
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((SELECT jsonb_agg(to_jsonb(r) - '_k' - '_rn' - 'search_vec' - 'name_norm' - 'loc_keys' ORDER BY r._rn)
                        FROM ranked r WHERE r._rn <= %5$s), '[]'::jsonb),
      'has_more', (SELECT count(*) FROM page) > %5$s,
      'next_key', (SELECT r._k FROM ranked r WHERE r._rn = %5$s),
      'next_id',  (SELECT r.id FROM ranked r WHERE r._rn = %5$s))
  $q$, v_expr, v_page_w, v_dir, v_lim + 1, v_lim) INTO v_out;

  RETURN COALESCE(v_out, jsonb_build_object('rows','[]'::jsonb,'has_more',false))
       || jsonb_build_object('total', LEAST(v_total, c_cap), 'total_capped', v_total > c_cap,
                             'limit', v_lim, 'sort', v_sort);
END $function$;


CREATE OR REPLACE FUNCTION public.browse_nearby(p_lat double precision, p_lng double precision, p_radius_km double precision DEFAULT 0, p_query text DEFAULT NULL::text, p_category text DEFAULT NULL::text, p_region text DEFAULT NULL::text, p_city text DEFAULT NULL::text, p_location_id text DEFAULT NULL::text, p_loc_type text DEFAULT NULL::text, p_open_now boolean DEFAULT false, p_blocked text[] DEFAULT NULL::text[], p_limit integer DEFAULT 30, p_cursor_dist double precision DEFAULT NULL::double precision, p_cursor_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_now   bigint  := (EXTRACT(epoch FROM now()) * 1000)::bigint;
  v_lim   integer := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 60);
  v_q     text    := public.taki_norm(p_query);
  v_ts    tsquery;
  v_long  boolean := false;
  v_where text;
  v_page  text;
  v_dlat  double precision;
  v_dlng  double precision;
  v_closed text[];
  v_out   jsonb;
  v_total bigint;
  c_cap   constant integer := 5000;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL THEN
    RETURN jsonb_build_object('rows','[]'::jsonb,'has_more',false,'total',0,'total_capped',false);
  END IF;

  IF v_q IS NOT NULL THEN
    SELECT to_tsquery('simple', string_agg(quote_literal(t) || ':*', ' & ')) INTO v_ts
      FROM unnest(string_to_array(v_q, ' ')) AS t WHERE t <> '';
    v_long := length(v_q) >= 3;
  END IF;

  -- دورة حياة العرض — نفس قواعد بقية المنصة
  v_where := 'd.status = ''active'''
          || ' AND (d.is_unlimited OR COALESCE(b.quantity, d.quantity, 0) > 0 OR COALESCE(d.initial_quantity,0) <= 0)'
          || format(' AND COALESCE(d.starts_at, 0) <= %s', v_now)
          || format(' AND %s <= (GREATEST(COALESCE(d.starts_at,0), d.created_at)::bigint'
                    ' + (CASE WHEN COALESCE(d.expires_in_minutes,0) = 0 THEN 120'
                    '         ELSE d.expires_in_minutes END)::bigint * 60000)', v_now)
          || ' AND b.lat IS NOT NULL AND b.lng IS NOT NULL';
  -- v14.32 — عروض متجرٍ موقوف لا تُعرض. كان الإيقاف يُخفي صفحة المتجر من
  -- الدليل وحدها، بينما عروضه تبقى في الرئيسية وفي «القريب مني» ويفتحها
  -- المشترون ويحجزون — أي أن «إيقاف التاجر» لم يكن يوقف بيعه.
  -- الفلترة هنا لا في صفوف العروض: فكّ الإيقاف يُعيدها كما كانت بلا أي إصلاح.
  v_where := v_where || ' AND NOT EXISTS (SELECT 1 FROM public.users su'
                     || ' WHERE su.id = d.store_id AND (su.is_suspended OR su.deleted_at IS NOT NULL))';


  -- المرشّح الصندوقي: ضربة فهرس قبل أي حساب مثلثات
  IF COALESCE(p_radius_km, 0) > 0 THEN
    v_dlat := p_radius_km / 111.045;
    v_dlng := p_radius_km / (111.045 * GREATEST(cos(radians(p_lat)), 0.01));
    v_where := v_where || format(
      ' AND b.lat BETWEEN %s AND %s AND b.lng BETWEEN %s AND %s',
      p_lat - v_dlat, p_lat + v_dlat, p_lng - v_dlng, p_lng + v_dlng);
    v_where := v_where || format(
      ' AND public.taki_haversine_km(%s, %s, b.lat, b.lng) <= %s', p_lat, p_lng, p_radius_km);
  END IF;

  IF NULLIF(p_category,'') IS NOT NULL AND p_category <> 'all' THEN
    v_where := v_where || format(' AND (d.category = %L OR d.category = ''all'')', p_category); END IF;
  IF NULLIF(p_region,'') IS NOT NULL THEN
    v_where := v_where || format(' AND b.region = %L', p_region); END IF;
  IF NULLIF(p_city,'') IS NOT NULL THEN
    v_where := v_where || format(' AND b.city = %L', p_city); END IF;
  IF NULLIF(p_location_id,'') IS NOT NULL THEN
    v_where := v_where || format(' AND b.location_id = %L', p_location_id); END IF;
  IF NULLIF(p_loc_type,'') IS NOT NULL THEN
    v_where := v_where || format(
      ' AND EXISTS (SELECT 1 FROM public.locations lt WHERE lt.id = b.location_id AND lt.type = %L)', p_loc_type); END IF;
  IF p_blocked IS NOT NULL AND COALESCE(array_length(p_blocked,1),0) > 0 THEN
    v_where := v_where || format(' AND NOT (d.store_id = ANY(%L::text[]))', p_blocked); END IF;

  IF COALESCE(p_open_now,false) THEN
    v_closed := taki_internal.closed_store_ids();
    IF COALESCE(array_length(v_closed,1),0) > 0 THEN
      v_where := v_where || format(' AND NOT (d.store_id = ANY(%L::text[]))', v_closed);
    END IF;
  END IF;

  -- البحث: نفس الطبقات الثلاث + اسم الفرع (يبحث المستخدم باسم المول أيضاً)
  IF v_ts IS NOT NULL THEN
    IF v_long THEN
      v_where := v_where || format(
        ' AND (d.search_vec @@ %L::tsquery OR d.name_norm LIKE %L OR %L <%% d.name_norm'
        '      OR public.taki_norm(b.branch_name) LIKE %L)',
        v_ts::text, '%' || v_q || '%', v_q, '%' || v_q || '%');
    ELSE
      v_where := v_where || format(
        ' AND (d.search_vec @@ %L::tsquery OR public.taki_norm(b.branch_name) LIKE %L)',
        v_ts::text, '%' || v_q || '%');
    END IF;
  END IF;

  EXECUTE format(
    'SELECT count(*)::bigint FROM (SELECT 1 FROM public.deal_branches b'
    ' JOIN public.deals d ON d.id = b.deal_id WHERE %s LIMIT %s) z', v_where, c_cap + 1) INTO v_total;

  v_page := v_where;
  IF p_cursor_dist IS NOT NULL AND p_cursor_key IS NOT NULL THEN
    v_page := v_page || format(
      ' AND ((public.taki_haversine_km(%1$s, %2$s, b.lat, b.lng) > (%3$L)::double precision)'
      '   OR (public.taki_haversine_km(%1$s, %2$s, b.lat, b.lng) = (%3$L)::double precision'
      '       AND (b.deal_id || ''__'' || b.branch_id) > %4$L))',
      p_lat, p_lng, p_cursor_dist::text, p_cursor_key);
  END IF;

  EXECUTE format($q$
    WITH page AS (
      SELECT d, b, public.taki_haversine_km(%1$s, %2$s, b.lat, b.lng) AS _dist,
             (b.deal_id || '__' || b.branch_id) AS _key
      FROM public.deal_branches b
      JOIN public.deals d ON d.id = b.deal_id
      WHERE %3$s
      ORDER BY _dist ASC, _key ASC
      LIMIT %4$s
    ), ranked AS (
      SELECT p.*, row_number() OVER (ORDER BY p._dist ASC, p._key ASC) AS _rn FROM page p
    )
    SELECT jsonb_build_object(
      'rows', COALESCE((
        SELECT jsonb_agg(
          (to_jsonb(r.d) - 'search_vec' - 'name_norm' - 'loc_keys')
          || jsonb_build_object(
               'distance', r._dist,
               'lat',      (r.b).lat,
               'lng',      (r.b).lng,
               '_key',     r._key,
               '_bId',     (r.b).branch_id,
               '_bLocId',  (r.b).location_id,
               '_bName',   (r.b).branch_name,
               '_bRegion', (r.b).region,
               '_bCity',   (r.b).city)
          || CASE WHEN (r.b).quantity IS NOT NULL
                  THEN jsonb_build_object('quantity', (r.b).quantity)
                  ELSE '{}'::jsonb END
          ORDER BY r._rn)
        FROM ranked r WHERE r._rn <= %5$s), '[]'::jsonb),
      'has_more',  (SELECT count(*) FROM page) > %5$s,
      'next_dist', (SELECT r._dist FROM ranked r WHERE r._rn = %5$s),
      'next_key',  (SELECT r._key  FROM ranked r WHERE r._rn = %5$s))
  $q$, p_lat, p_lng, v_page, v_lim + 1, v_lim) INTO v_out;

  RETURN COALESCE(v_out, jsonb_build_object('rows','[]'::jsonb,'has_more',false))
       || jsonb_build_object('total', LEAST(v_total, c_cap), 'total_capped', v_total > c_cap);
END $function$;


-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'الإيقاف يمنع الدخول',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.admin_suspend_account(text,boolean,text)'))
                 LIKE '%banned_until%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'الإيقاف ينهي الجلسات',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.admin_suspend_account(text,boolean,text)'))
                 LIKE '%auth.sessions%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'حارس نشر الموقوف',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                         WHERE tgrelid='public.deals'::regclass
                           AND tgname='tr_ab_guard_suspended_publish')
            THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'حارس إعادة التسجيل',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                         WHERE tgrelid='public.users'::regclass
                           AND tgname='tr_aa_guard_banned_signup')
            THEN '✅ موجود' ELSE '❌ مفقود' END
UNION ALL SELECT 'عروض الموقوف تختفي (الرئيسية)',
       CASE WHEN pg_get_functiondef(to_regprocedure(
              (SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='browse_deals' LIMIT 1)))
                 LIKE '%su.is_suspended%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'عروض الموقوف تختفي (القريب مني)',
       CASE WHEN pg_get_functiondef(to_regprocedure(
              (SELECT p.oid::regprocedure::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
               WHERE n.nspname='public' AND p.proname='browse_nearby' LIMIT 1)))
                 LIKE '%su.is_suspended%' THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'عقوبة الإلغاءات لا تُجدّد نفسها',
       CASE WHEN pg_get_functiondef(to_regprocedure('public.taki_cancel_abuse_scan()'))
                 LIKE '%تعليق الحجز%' THEN '✅ تُحتسب العقوبات' ELSE '❌ ما زالت تُجدّد' END;
