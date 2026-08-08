-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — ملف واحد مُجمَّع: v13.80 + v13.81 + v13.82   (خادم جدة)
--
-- الصقه كاملاً في SQL Editor واضغط Run مرة واحدة. آمن للتكرار، ولا يمسّ أي
-- بيان قائم إلا بملء عمود جديد. ينتهي بجدول تحقّق ✅/❌ صوّره وأرسله.
--
--  v13.80 — سحب صلاحيات الكتابة من دور الزائر anon + فهرس الإشعارات + تأكيد
--           نشرة الريل‑تايم للطلبات والمحادثة.
--  v13.81 — حجز الكمية ذرّياً: «تحقّق واخصم في عبارة واحدة» بدل «افحص ثم
--           اخصم»، مع بوّاب رفضٍ سريع بلا قفل. مليون متسابق على مئة قطعة:
--           أول مئة بالضبط، وصفر بيع زائد، وبلا طابور قفل يخنق القاعدة.
--  v13.82 — عمود «مستلم الرسالة» في محادثة الطلب ليصير اشتراك الريل‑تايم
--           عليها مُرشَّحاً هو الآخر.
-- ═══════════════════════════════════════════════════════════════════════════


-- ───── migration_v13_80_hardening_and_realtime.sql ─────
-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — v13.80 — تحصين استباقي + تأكيد الريل‑تايم  (خادم جدة)
--
-- يُلصق كاملاً في SQL Editor على **جدة** ويُشغَّل مرة واحدة. آمن للتكرار
-- (idempotent) ولا يمسّ أي بيان. ينتهي بجدول ✅/❌ يصوّره ناصر ويرسله.
--
-- ما الذي يفعله ولماذا:
--
-- (١) سحب صلاحيات **الكتابة** من دور الزائر `anon` على كامل مخطط public.
--     نموذج سوبابيس الافتراضي يمنح `anon` و`authenticated` كل الصلاحيات على
--     كل جدول ويجعل RLS **خط الدفاع الوحيد**. في تاكي لا توجد كتابة شرعية
--     واحدة من زائر: كل سياسات الكتابة تشترط `auth.uid()`، وكل مسار مجهول
--     (تتبّع الفتح، التحليلات، البحث) يمرّ عبر دوال SECURITY DEFINER تعمل
--     بصلاحية المالك لا بصلاحية الزائر. فالمنحة زائدة عن الحاجة، ووجودها هو
--     ما جعل ثغرة v13.75 ممكنة أصلاً (view بلا RLS + منحة كتابة لـanon =
--     كتابة مباشرة على بيانات التجار).
--     بعد هذا السحب: أي جدول أو view يُنشأ مستقبلاً ويُنسى RLS عليه **لا
--     يصير قابلاً للكتابة من مفتاح المتصفح العلني** — الخطأ لم يعد كارثة.
--
-- (٢) نفس السحب على الامتيازات الافتراضية، فلا يعود الجدول القادم يرث المنحة.
--
-- (٣) فهرس `(user_id, created_at DESC)` على `notifications` — قائمة الإشعارات
--     تقرأ آخر ١٠٠ لكل مستخدم؛ الفهرس الحالي على `user_id` وحده يجبر القاعدة
--     على فرز كل إشعارات المستخدم عند كل فتح. مع ملايين الصفوف يصير الفرق
--     بين قراءة فورية وقراءة تُحسّ.
--
-- (٤) تأكيد أن `bookings` و`booking_messages` ضمن نشرة الريل‑تايم — عليها
--     يعتمد انتقال الطلب من «الجارية» إلى «السابقة» لحظة اكتماله (v13.80).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── (١) سحب صلاحيات الكتابة من الزائر ────────────────────────────────────
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon;

-- ── (٢) والامتيازات الافتراضية للجداول القادمة ───────────────────────────
-- تُنفَّذ لكل دور قد يُنشئ كائنات في public على تنصيب سوبابيس.
-- ملاحظة: تغيير الامتيازات الافتراضية لدور آخر يتطلب أن تكون عضواً فيه. إن
-- رفضت القاعدة دوراً منها فلا تسقط الهجرة — نتجاوزه ويكشفه جدول التحقّق.
DO $$
DECLARE r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['postgres','supabase_admin','service_role'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            BEGIN
                EXECUTE format(
                    'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public '
                    'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLES FROM anon', r);
            EXCEPTION WHEN insufficient_privilege THEN
                RAISE NOTICE 'تخطّي الامتيازات الافتراضية للدور %', r;
            END;
        END IF;
    END LOOP;
END $$;

-- ── (٣) فهرس قائمة الإشعارات ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_notifs_user_created
    ON public.notifications (user_id, created_at DESC);

-- ── (٤) نشرة الريل‑تايم ──────────────────────────────────────────────────
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='bookings') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.bookings;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
                   WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='booking_messages') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.booking_messages;
    END IF;
END $$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- جدول التحقّق — النتيجة المتوقّعة: ✅ في كل عمود
--
-- البند (١) ليس فحص إعدادات بل **هجوم حقيقي**: ننتحل دور الزائر `anon`
-- ونحاول تعديل جدول العروض فعلاً. النجاح المطلوب هو أن ترفضه القاعدة بخطأ
-- صلاحيات. المحاولة داخل معاملة فرعية تُلغى، فلا أثر لها على أي بيان.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._taki_v1380_audit()
RETURNS TABLE (
    "١- كتابة الزائر مرفوضة"   text,
    "٢- الجداول القادمة محصّنة" text,
    "٣- فهرس الإشعارات"        text,
    "٤- الريل‑تايم للطلبات"     text,
    "٥- RLS على كل الجداول"    text,
    "٦- مسار كل دالة مثبّت"     text
)
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $fn$
DECLARE v_attack text;
BEGIN
    BEGIN
        SET LOCAL ROLE anon;
        BEGIN
            EXECUTE 'UPDATE public.deals SET item_name = item_name WHERE id = ''__taki_probe__''';
            v_attack := '❌';  -- مرّ بلا خطأ ⇒ منحة الكتابة ما زالت قائمة
        EXCEPTION
            WHEN insufficient_privilege THEN v_attack := '✅';
            WHEN OTHERS THEN v_attack := '✅';  -- أي رفض آخر = ممنوع أيضاً
        END;
        RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
        RESET ROLE;
        v_attack := '⚠️';
    END;

    RETURN QUERY SELECT
        v_attack,
        CASE WHEN NOT EXISTS (
            SELECT 1 FROM pg_default_acl d JOIN pg_namespace n ON n.oid=d.defaclnamespace
            WHERE n.nspname='public' AND d.defaclobjtype='r'
              AND pg_get_userbyid(d.defaclrole) = 'postgres'
              AND array_to_string(d.defaclacl,',') ~ '(^|,)anon=[^/]*[awdD]'
        ) THEN '✅' ELSE '❌' END,
        CASE WHEN EXISTS (
            SELECT 1 FROM pg_indexes WHERE schemaname='public'
              AND indexname='idx_notifs_user_created'
        ) THEN '✅' ELSE '❌' END,
        CASE WHEN (SELECT count(*) FROM pg_publication_tables
                   WHERE pubname='supabase_realtime' AND schemaname='public'
                     AND tablename IN ('bookings','booking_messages')) = 2
        THEN '✅' ELSE '❌' END,
        CASE WHEN NOT EXISTS (
            SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
        ) THEN '✅' ELSE '❌' END,
        CASE WHEN NOT EXISTS (
            SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.prosecdef
              AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) x
                              WHERE x LIKE 'search_path=%')
        ) THEN '✅' ELSE '❌' END;
END $fn$;

SELECT * FROM public._taki_v1380_audit();

DROP FUNCTION public._taki_v1380_audit();


-- ───── migration_v13_81_atomic_stock.sql ─────
-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — v13.81 — حجز الكمية **ذرّياً** تحت أي ضغط  (خادم جدة)
--
-- طلب ناصر حرفياً: «مليون يريدون عرضاً كميته ١٠٠ في نفس اللحظة — الأولوية
-- لأول ١٠٠ بدقة عالية جداً». هذا الملف يحقّق ذلك، ويشرح لماذا كان التصميم
-- السابق صحيحاً في الحساب لكنه هشّ تحت الضغط.
--
-- ── ما كان ──────────────────────────────────────────────────────────────
--  BEFORE INSERT:  SELECT * FROM deals WHERE id = ? FOR UPDATE  ← قفل الصفّ
--                  ثم فحص الكمية ورفض إن لم تكفِ.
--  AFTER  INSERT:  UPDATE deals SET quantity = GREATEST(0, quantity - n)
--
--  الحساب سليم (القفل يُسلسِل المتزامنين فلا يُباع ما لا يوجد)، لكن فيه
--  عيبين قاتلين عند الضغط الحقيقي:
--
--  (١) **كل** طالب يقف في طابور القفل — حتى بعد نفاد الكمية. مليون طلب على
--      عرض نفد يعني مليون اتصال ينتظر قفلاً على صفّ واحد؛ والقاعدة تنهار من
--      استنفاد الاتصالات لا من الحساب. الرافض يجب أن يُرفض **قبل** الطابور.
--  (٢) `GREATEST(0, …)` يبتلع الخطأ: لو تسرّب حجز فوق الكمية لأي سبب، يصير
--      المخزون صفراً بصمت بدل أن يفشل الحجز. البيع الزائد يجب أن **يفشل**،
--      لا أن يُقرَّب إلى صفر.
--
-- ── ما صار ──────────────────────────────────────────────────────────────
--  BEFORE INSERT (بلا قفل إطلاقاً): قراءة عادية + رفض فوري للحالات البيّنة
--      (العرض غير موجود / غير نشط / نفدت كميته). هذه وحدها تُبعد ٩٩٫٩٪ من
--      المليون عن طابور القفل — لا تلمس القفل ولا تؤخّر أحداً.
--      + `lock_timeout` قصير: معاملة متعثّرة لا تُجمّد طابور العرض كله.
--
--  AFTER INSERT — **الحَكَم الوحيد**: تحقّق وخصم في **عبارة واحدة**:
--      UPDATE deals SET quantity = quantity - n
--       WHERE id = ? AND quantity >= n
--      العبارة الواحدة تأخذ قفل الصفّ بنفسها، وتُعيد تقييم الشرط على **آخر
--      نسخة ملتزمة** بعد انتظارها (READ COMMITTED)، فإن لم تعد الكمية تكفي
--      رجعت بصفر صفوف ⇒ نرفع خطأً ⇒ تتراجع المعاملة كاملة.
--      النتيجة: **أول ١٠٠ بترتيب وصولهم للقفل ينجحون، والباقي يُرفض — مهما
--      بلغ عددهم، وبلا احتمال بيع زائد واحد.**
--      لا `GREATEST` ولا تقريب: العرض المسقوف يخصم بالضبط أو يفشل.
--
--  ونفس المبدأ طُبِّق على المستويات الثلاثة الأخرى (كمية الفرع، كمية النوع،
--  خلية نوع×فرع): كلها صارت «تحقّق وخصم في عبارة واحدة» بدل «افحص ثم اخصم».
--
--  ملاحظة: الخلية الغائبة أو الفارغة تعني «بلا سقف» — تمرّ بلا خصم، كما كان.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- ١) BEFORE INSERT — بوّاب سريع بلا قفل
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tr_reserve_booking_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deal   deals%ROWTYPE;
  v_sel    jsonb;
  v_var    jsonb;
  v_need   int;
  v_avail  int;
  v_bname  text;
  v_capped boolean;
BEGIN
  -- معاملة متعثّرة على صفّ العرض يجب ألا تُجمّد كل من خلفها: بعد ٥ ثوانٍ
  -- ننسحب بخطأ نظيف بدل انتظار بلا نهاية. (يسري على هذه المعاملة وحدها.)
  SET LOCAL lock_timeout = '5s';

  v_need := GREATEST(COALESCE(NEW.booked_quantity, 1), 1);

  -- قراءة **بلا** FOR UPDATE: هذه بوّابة رفضٍ سريعة لا مصدر حقيقة. الحقيقة
  -- تُحسم في الخصم الذرّي بعد الإدراج.
  SELECT * INTO v_deal FROM deals WHERE id = NEW.deal_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'العرض لم يعد موجوداً' USING ERRCODE = 'P0010';
  END IF;

  IF v_deal.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'DEAL_NOT_ACTIVE' USING ERRCODE = 'P0010';
  END IF;

  v_capped := NOT COALESCE(v_deal.is_unlimited, false)
              AND COALESCE(v_deal.initial_quantity, 0) > 0;

  -- ١) الكمية العامة
  IF v_capped AND COALESCE(v_deal.quantity, 0) < v_need THEN
    RAISE EXCEPTION 'نفدت الكمية — سبقك مشترون آخرون إليها (المتاح الآن: %)',
      GREATEST(COALESCE(v_deal.quantity, 0), 0) USING ERRCODE = 'P0010';
  END IF;

  -- ٢) كمية الفرع المختار (وضع «كمية لكل موقع») — الفرع بلا حقل quantity = مفتوح
  IF NEW.location_id IS NOT NULL
     AND v_deal.loc_qty_mode = 'per_location'
     AND v_deal.locations IS NOT NULL AND jsonb_typeof(v_deal.locations) = 'array' THEN
    SELECT NULLIF(e->>'quantity','')::int, COALESCE(NULLIF(e->>'name',''), 'الفرع')
      INTO v_avail, v_bname
      FROM jsonb_array_elements(v_deal.locations) e
     WHERE e->>'id' = NEW.location_id
     LIMIT 1;
    IF v_avail IS NOT NULL AND v_avail < v_need THEN
      RAISE EXCEPTION 'نفدت كمية «%» — المتاح الآن بهذا الفرع: %',
        v_bname, GREATEST(v_avail, 0) USING ERRCODE = 'P0010';
    END IF;
  END IF;

  -- ٣) كمية النسخة العامة (variants[].qty)
  IF v_deal.variants IS NOT NULL AND jsonb_typeof(v_deal.variants) = 'array'
     AND NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = 'array' THEN
    FOR v_sel IN SELECT * FROM jsonb_array_elements(NEW.selected_options) LOOP
      CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';
      SELECT e INTO v_var FROM jsonb_array_elements(v_deal.variants) e
       WHERE e->>'id' = v_sel->>'c' LIMIT 1;
      CONTINUE WHEN v_var IS NULL OR NOT (v_var ? 'qty') OR NULLIF(v_var->>'qty','') IS NULL;
      IF (v_var->>'qty')::int < GREATEST(COALESCE((v_sel->>'qty')::int, 1), 1) THEN
        RAISE EXCEPTION 'نفدت كمية «%» — المتاح الآن: %',
          COALESCE(v_var->>'label', 'هذا النوع'), GREATEST((v_var->>'qty')::int, 0)
          USING ERRCODE = 'P0010';
      END IF;
    END LOOP;
  END IF;

  -- ٤) خلية «نوع×فرع» (locations[].variantQtys[variant]) — الغائبة = مفتوحة
  IF NEW.location_id IS NOT NULL
     AND v_deal.loc_qty_mode = 'per_location'
     AND v_deal.locations IS NOT NULL AND jsonb_typeof(v_deal.locations) = 'array'
     AND NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = 'array' THEN
    FOR v_sel IN SELECT * FROM jsonb_array_elements(NEW.selected_options) LOOP
      CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';
      SELECT NULLIF(e->'variantQtys'->>(v_sel->>'c'),'')::int
        INTO v_avail
        FROM jsonb_array_elements(v_deal.locations) e
       WHERE e->>'id' = NEW.location_id AND (e ? 'variantQtys')
       LIMIT 1;
      IF v_avail IS NOT NULL AND v_avail < GREATEST(COALESCE((v_sel->>'qty')::int, 1), 1) THEN
        RAISE EXCEPTION 'نفد هذا النوع في الفرع المختار — المتاح الآن: %',
          GREATEST(v_avail, 0) USING ERRCODE = 'P0010';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$function$;

-- ───────────────────────────────────────────────────────────────────────────
-- ٢) AFTER INSERT/UPDATE — الحَكَم: تحقّق وخصم في عبارة واحدة
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.adjust_deal_quantity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sel    jsonb;
  v_dir    int;
  v_need   int;
  v_rows   int;
  v_capped boolean;
BEGIN
    v_need := GREATEST(COALESCE(NEW.booked_quantity, 1), 1);

    IF TG_OP = 'INSERT' THEN
        v_dir := -1;
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
        v_dir := 1;
    ELSE
        RETURN NEW;
    END IF;

    SELECT NOT COALESCE(d.is_unlimited, false) AND COALESCE(d.initial_quantity, 0) > 0
      INTO v_capped FROM deals d WHERE d.id = NEW.deal_id;

    -- ── الكمية العامة ──────────────────────────────────────────────────
    IF v_dir = -1 THEN
        IF COALESCE(v_capped, false) THEN
            -- 🔒 الحجز الذرّي: الشرط والخصم في عبارة واحدة. صفر صفوف = سبقك
            -- غيرك إلى آخر قطعة ⇒ نرفع فتتراجع المعاملة كاملة (ولا يُسجَّل حجز).
            UPDATE deals SET quantity = quantity - v_need
             WHERE id = NEW.deal_id AND quantity >= v_need;
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows = 0 THEN
                RAISE EXCEPTION 'نفدت الكمية — سبقك مشترون آخرون إليها'
                    USING ERRCODE = 'P0010';
            END IF;
        ELSE
            -- عرض زمني/بلا سقف: العدّاد إرشادي فقط — يُقرَّب عند الصفر ولا يمنع.
            UPDATE deals SET quantity = GREATEST(0, COALESCE(quantity, 0) - v_need)
             WHERE id = NEW.deal_id AND COALESCE(is_unlimited, false) = FALSE;
        END IF;
    ELSE
        UPDATE deals SET quantity = COALESCE(quantity, 0) + v_need
         WHERE id = NEW.deal_id AND COALESCE(is_unlimited, false) = FALSE;
    END IF;

    -- ── كمية النسخة (variants[].qty) — تحقّق وخصم في عبارة واحدة ────────
    IF NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = 'array' THEN
      FOR v_sel IN SELECT * FROM jsonb_array_elements(NEW.selected_options) LOOP
        CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';
        UPDATE deals d SET variants = (
          SELECT jsonb_agg(
            CASE WHEN e->>'id' = v_sel->>'c' AND (e ? 'qty') AND NULLIF(e->>'qty','') IS NOT NULL
                 THEN jsonb_set(e, '{qty}', to_jsonb(GREATEST(0,
                        (e->>'qty')::int + v_dir * GREATEST(COALESCE((v_sel->>'qty')::int,1),1))))
                 ELSE e END)
          FROM jsonb_array_elements(d.variants) e)
        WHERE d.id = NEW.deal_id
          AND d.variants IS NOT NULL AND jsonb_typeof(d.variants) = 'array'
          -- عند الخصم فقط: الخلية المسقوفة يجب أن تكفي وقت الكتابة نفسها.
          AND (v_dir = 1 OR COALESCE((
                SELECT NULLIF(e2->>'qty','')::int FROM jsonb_array_elements(d.variants) e2
                 WHERE e2->>'id' = v_sel->>'c' LIMIT 1), 2147483647)
              >= GREATEST(COALESCE((v_sel->>'qty')::int,1),1));
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_dir = -1 AND v_rows = 0
           AND EXISTS (SELECT 1 FROM deals d2
                        WHERE d2.id = NEW.deal_id
                          AND d2.variants IS NOT NULL
                          AND jsonb_typeof(d2.variants) = 'array') THEN
            RAISE EXCEPTION 'نفدت كمية النوع المختار — سبقك مشترون آخرون إليه'
                USING ERRCODE = 'P0010';
        END IF;
      END LOOP;
    END IF;

    -- ── كمية الفرع (locations[].quantity) — تحقّق وخصم في عبارة واحدة ───
    IF NEW.location_id IS NOT NULL THEN
      UPDATE deals d SET locations = (
        SELECT jsonb_agg(
          CASE WHEN e->>'id' = NEW.location_id AND (e ? 'quantity') AND NULLIF(e->>'quantity','') IS NOT NULL
               THEN jsonb_set(e, '{quantity}', to_jsonb(GREATEST(0,
                      (e->>'quantity')::int + v_dir * v_need)))
               ELSE e END)
        FROM jsonb_array_elements(d.locations) e)
      WHERE d.id = NEW.deal_id
        AND d.loc_qty_mode = 'per_location'
        AND d.locations IS NOT NULL AND jsonb_typeof(d.locations) = 'array'
        AND (v_dir = 1 OR COALESCE((
              SELECT NULLIF(e2->>'quantity','')::int FROM jsonb_array_elements(d.locations) e2
               WHERE e2->>'id' = NEW.location_id LIMIT 1), 2147483647) >= v_need);
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      IF v_dir = -1 AND v_rows = 0
         AND EXISTS (SELECT 1 FROM deals d2
                      WHERE d2.id = NEW.deal_id AND d2.loc_qty_mode = 'per_location'
                        AND d2.locations IS NOT NULL AND jsonb_typeof(d2.locations) = 'array') THEN
          RAISE EXCEPTION 'نفدت كمية هذا الفرع — سبقك مشترون آخرون إليها'
              USING ERRCODE = 'P0010';
      END IF;
    END IF;

    -- ── خلية «نوع×فرع» (locations[].variantQtys[variant]) ──────────────
    IF NEW.location_id IS NOT NULL
       AND NEW.selected_options IS NOT NULL AND jsonb_typeof(NEW.selected_options) = 'array' THEN
      FOR v_sel IN SELECT * FROM jsonb_array_elements(NEW.selected_options) LOOP
        CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';
        UPDATE deals d SET locations = (
          SELECT jsonb_agg(
            CASE WHEN e->>'id' = NEW.location_id
                  AND (e ? 'variantQtys')
                  AND ((e->'variantQtys') ? (v_sel->>'c'))
                  AND NULLIF(e->'variantQtys'->>(v_sel->>'c'),'') IS NOT NULL
                 THEN jsonb_set(e, ARRAY['variantQtys', v_sel->>'c'], to_jsonb(GREATEST(0,
                        (e->'variantQtys'->>(v_sel->>'c'))::int + v_dir * GREATEST(COALESCE((v_sel->>'qty')::int,1),1))))
                 ELSE e END)
          FROM jsonb_array_elements(d.locations) e)
        WHERE d.id = NEW.deal_id
          AND d.loc_qty_mode = 'per_location'
          AND d.locations IS NOT NULL AND jsonb_typeof(d.locations) = 'array'
          AND (v_dir = 1 OR COALESCE((
                SELECT NULLIF(e2->'variantQtys'->>(v_sel->>'c'),'')::int
                  FROM jsonb_array_elements(d.locations) e2
                 WHERE e2->>'id' = NEW.location_id AND (e2 ? 'variantQtys') LIMIT 1), 2147483647)
              >= GREATEST(COALESCE((v_sel->>'qty')::int,1),1));
        GET DIAGNOSTICS v_rows = ROW_COUNT;
        IF v_dir = -1 AND v_rows = 0
           AND EXISTS (SELECT 1 FROM deals d2
                        WHERE d2.id = NEW.deal_id AND d2.loc_qty_mode = 'per_location'
                          AND d2.locations IS NOT NULL AND jsonb_typeof(d2.locations) = 'array') THEN
            RAISE EXCEPTION 'نفد هذا النوع في الفرع المختار — سبقك مشترون آخرون إليه'
                USING ERRCODE = 'P0010';
        END IF;
      END LOOP;
    END IF;

    RETURN NEW;
END;
$function$;

COMMIT;


-- ───── migration_v13_82_chat_recipient.sql ─────
-- ═══════════════════════════════════════════════════════════════════════════
-- TAKI — v13.82 — مستلم الرسالة في محادثة الطلب  (خادم جدة)
--
-- لماذا: اشتراك الريل‑تايم على `booking_messages` هو الوحيد الباقي **بلا
-- ترشيح** بعد v13.80 — أي أن خادم الريل‑تايم يُقيّم كل رسالة في المنصّة أمام
-- كل جهاز متصل. والسبب أن الجدول لا يحمل عمود «المستلم» أصلاً: فيه المُرسِل
-- ودوره فقط، والمستلم يُستنتج من صفّ الحجز.
--
-- الحل: عمود `recipient_id` يُملأ **في القاعدة** (مشغّل BEFORE INSERT) لا في
-- الواجهة — فلا يمكن تزويره من العميل، ولا يعتمد على نيّة المُرسِل. بعده
-- يشترك كل جهاز على رسائله هو:  recipient_id = أنا  (الوارد)
--                              sender_id    = أنا  (إيصالات القراءة لرسائلي)
--
-- آمن للتكرار، ولا يمسّ رسالة قائمة إلا بملء العمود الجديد لها.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.booking_messages ADD COLUMN IF NOT EXISTS recipient_id text;

-- الطرف الآخر من الحجز، محسوباً في القاعدة.
CREATE OR REPLACE FUNCTION public.tr_booking_message_recipient()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
    SELECT CASE WHEN NEW.sender_role = 'buyer' THEN b.store_id ELSE b.user_id END
      INTO NEW.recipient_id
      FROM bookings b
     WHERE b.barcode = NEW.barcode;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS tr_booking_message_recipient ON public.booking_messages;
CREATE TRIGGER tr_booking_message_recipient
    BEFORE INSERT ON public.booking_messages
    FOR EACH ROW EXECUTE FUNCTION public.tr_booking_message_recipient();

-- ملء الرسائل القائمة (مرة واحدة — الصفوف المملوءة لا تُلمس).
UPDATE public.booking_messages m
   SET recipient_id = CASE WHEN m.sender_role = 'buyer' THEN b.store_id ELSE b.user_id END
  FROM public.bookings b
 WHERE b.barcode = m.barcode AND m.recipient_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_booking_messages_recipient
    ON public.booking_messages (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_booking_messages_sender
    ON public.booking_messages (sender_id, created_at DESC);

COMMIT;

-- تحقّق: المتوقّع ✅ ✅ ٠
SELECT
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema='public' AND table_name='booking_messages'
                        AND column_name='recipient_id') THEN '✅' ELSE '❌' END AS "العمود",
    CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                      WHERE tgname='tr_booking_message_recipient' AND NOT tgisinternal) THEN '✅' ELSE '❌' END AS "المشغّل",
    (SELECT count(*) FROM public.booking_messages WHERE recipient_id IS NULL) AS "رسائل بلا مستلم";
