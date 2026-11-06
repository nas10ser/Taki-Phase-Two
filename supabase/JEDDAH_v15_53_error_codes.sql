-- ═══════════════════════════════════════════════════════════════════════════
-- v15.53 — كلُّ حارسٍ كان يقول «Something went wrong» للمستخدم
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 عيبٌ جذريٌّ أُثبت بالقياس على الإنتاج، وشكوى ناصر («تعذّر حفظ التغيير —
--    Something went wrong» عند تجديد عرضٍ في حساب N15) ليست إلا أحدَ وجوهه.
--
-- **PostgREST يُترجم رموزَ أخطاء PL/pgSQL إلى حالاتِ HTTP، و`P0001` وحدها**
-- **هي التي تصل المستخدمَ برسالتها. وكلُّ `P00xx` غيرها ⇒ 500 ونصٌّ عامّ.**
-- قِيس بدالّةِ فحصٍ مؤقّتة ترفع نفسَ الرسالة العربية بكلّ رمز، عبر HTTP حقيقيّ:
--
--     P0001 ⇒ 400  {"code":"P0001", … ,"message":"رسالةٌ عربيّةٌ للاختبار"}
--     P0002 ⇒ 500  Something went wrong   (text/plain)
--     P0022 ⇒ 500  Something went wrong
--     P0024 ⇒ 500  Something went wrong
--     P0028 ⇒ 500  Something went wrong
--     23514 ⇒ 400  {"code":"23514", … ,"message":"رسالةٌ عربيّةٌ للاختبار"}
--
-- وفي المنصّة **٢٤ رمزاً مخصَّصاً في نحو ٥٠ موضعاً** — أي أن كلَّ حارسٍ
-- كُتبت له رسالةٌ عربيّةٌ دقيقةٌ كان يقول للمستخدم جملةً عمياء:
--   • المشتري يضغط «استلمت طلبي» قبل المهلة (P0028/P0029)
--   • نفادُ الكمّية عند الحجز (P0010) — حارسُ البيع الزائد **بلا رسالة**
--   • التوصيلُ خارج النطاق (P0013) · حدُّ الطلبات (P0011)
--   • إلغاءُ طلبٍ مدفوع (P0014) · حذفُ مستخدمٍ له طلبات (P0015)
--   • ومتجرٌ غير موثَّق (P0024) — وهو بعينه ما أصاب ناصراً.
--
-- 🪤 وهو صنفُ «الزرُّ الصامت» بعينه الذي حاربه المشروع مراراً، لكنه هنا في
--    **طبقةِ النقل** لا في الكود: الرسالةُ تُكتب وتُرفع ولا تعبر الأنبوب.
--
-- العلاج: الرمزُ الذي يعبر هو `P0001`، والرمزُ الآليُّ ينتقل إلى `HINT`
-- (يُعيده PostgREST في `hint` ولا يستعمله أحدٌ اليوم — قِيس). فالرسالةُ تصل،
-- والعميلُ يبقى قادراً على التفريع آلياً.
-- 🪤 و`DETAIL` **لا يصلح** حاملاً: مستعملٌ أصلاً للثواني المتبقّية في P0028.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
END
$guard$;

DO $convert$
DECLARE
  r record;
  v_src text; v_out text;
  v_before int; v_after int; v_total int := 0; v_fns int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prokind = 'f'
       AND pg_get_functiondef(p.oid) ~ $re$ERRCODE\s*=\s*'P0(0(0[02-9]|[1-9][0-9]))'$re$
     ORDER BY p.proname
  LOOP
    v_src := r.def;
    -- عددُ المواضع قبل، كي يُثبت أن الاستبدال وقع فعلاً (لا «كسرةٌ لا تُحقن»).
    v_before := (SELECT count(*) FROM regexp_matches(v_src, $re$ERRCODE\s*=\s*'(P0(?:0(?:0[02-9]|[1-9][0-9])))'$re$, 'g'));
    IF v_before = 0 THEN CONTINUE; END IF;

    v_out := regexp_replace(v_src,
      $re$ERRCODE\s*=\s*'(P0(?:0(?:0[02-9]|[1-9][0-9])))'$re$,
      $rp$ERRCODE = 'P0001', HINT = '\1'$rp$, 'g');

    v_after := (SELECT count(*) FROM regexp_matches(v_out, $re$ERRCODE\s*=\s*'(P0(?:0(?:0[02-9]|[1-9][0-9])))'$re$, 'g'));
    IF v_after <> 0 THEN
      RAISE EXCEPTION '❌ بقي % رمزاً غيرَ محوَّلٍ في % — أوقِفت', v_after, r.proname;
    END IF;
    IF length(v_out) <= length(v_src) THEN
      RAISE EXCEPTION '❌ لم يطل النصُّ بعد الاستبدال في % — لم يقع شيء', r.proname;
    END IF;
    -- والرسائلُ نفسُها لا تُمسّ: عددُ `RAISE EXCEPTION` كما هو.
    IF (SELECT count(*) FROM regexp_matches(v_out, 'RAISE\s+EXCEPTION', 'g'))
       <> (SELECT count(*) FROM regexp_matches(v_src, 'RAISE\s+EXCEPTION', 'g')) THEN
      RAISE EXCEPTION '❌ تغيّر عددُ الاستثناءات في % — أوقِفت', r.proname;
    END IF;

    EXECUTE v_out;
    v_total := v_total + v_before; v_fns := v_fns + 1;
  END LOOP;
  RAISE NOTICE 'حُوّل % موضعاً في % دالّة', v_total, v_fns;
  IF v_total = 0 THEN
    RAISE NOTICE 'ℹ️ لا رموزَ مخصَّصةً باقية — التحويلُ تمّ سابقاً';
  END IF;
END
$convert$;

-- ═══════════════════════════════════════════════════════════════════════════
-- تحقّقٌ سلوكيّ: الرسالةُ تصل، والرمزُ الآليُّ باقٍ
-- ═══════════════════════════════════════════════════════════════════════════
DO $behave$
DECLARE v_msg text; v_hint text; v_state text;
BEGIN
  BEGIN
    -- (١) صفرُ رمزٍ مخصَّصٍ باقٍ في أيّ دالّة
    IF EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.prokind='f'
         AND pg_get_functiondef(p.oid) ~ $re$ERRCODE\s*=\s*'P0(0(0[02-9]|[1-9][0-9]))'$re$) THEN
      RAISE EXCEPTION '❌ بقيت رموزٌ مخصَّصةٌ لا يعبرها PostgREST';
    END IF;

    -- (٢) استثناءٌ حقيقيّ من دالّةٍ محوَّلة: الرمزُ P0001 والآليُّ في HINT.
    -- 🪤 ولا يُختبر حارسُ التوثيق من هنا: جلسةُ `psql` «نظامٌ» دائماً
    --    (`session_user = supabase_admin`) فيُعفيها `taki_is_system_caller`
    --    قبل أن تبلغ ما نفحصه — وهو درسُ v14.96 الذي مرّ فيه اختبارٌ كاذباً
    --    مرّتين. فيُختار مسارٌ يعتمد `auth.uid()` وحده، والإثباتُ النهائيّ
    --    **طلبٌ حقيقيٌّ عبر PostgREST** يُجرى بعد التطبيق.
    BEGIN
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub','ced5ba57-e5da-4b69-9f33-25165696e7f8','role','authenticated')::text, true);
      PERFORM public.complete_booking('ZZ-NO-SUCH-BARCODE-ZZ');
      RAISE EXCEPTION '❌ لم يرفض complete_booking باركوداً غيرَ موجود';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT, v_hint = PG_EXCEPTION_HINT, v_state = RETURNED_SQLSTATE;
      IF v_msg LIKE '❌%' THEN RAISE EXCEPTION '%', v_msg; END IF;
      IF v_state <> 'P0001' THEN
        RAISE EXCEPTION '❌ الرمزُ % لا P0001 — لن تعبر الرسالةُ أنبوبَ PostgREST', v_state;
      END IF;
      IF COALESCE(v_hint,'') <> 'P0002' THEN
        RAISE EXCEPTION '❌ الرمزُ الآليُّ ضاع (hint=%) — فلا يستطيع العميلُ التفريع', COALESCE(v_hint,'∅');
      END IF;
      IF COALESCE(btrim(v_msg),'') = '' THEN
        RAISE EXCEPTION '❌ الرسالةُ فارغة';
      END IF;
    END;

    -- (٣) و`DETAIL` لم يُزَح: مهلةُ الختم ما زالت تحمل الثواني
    IF pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure)
         NOT LIKE '%DETAIL = v_left::text%' THEN
      RAISE EXCEPTION '❌ ضاعت الثواني المتبقّية من DETAIL';
    END IF;
    IF pg_get_functiondef('public.buyer_confirm_receipt(text)'::regprocedure)
         NOT LIKE '%HINT = ''P0028''%' THEN
      RAISE EXCEPTION '❌ رمزُ P0028 الآليُّ لم يُحفظ';
    END IF;

    RAISE EXCEPTION 'TAKI_V1553_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'TAKI_V1553_ROLLBACK' THEN RAISE; END IF;
  END;
END
$behave$;

NOTIFY pgrst, 'reload schema';

SELECT 'الخادم' AS "البند", COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'جدة — الإنتاج') AS "القيمة"
UNION ALL SELECT 'رموزٌ مخصَّصةٌ باقية (يجب ٠)',
  (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f'
      AND pg_get_functiondef(p.oid) ~ $re$ERRCODE\s*=\s*'P0(0(0[02-9]|[1-9][0-9]))'$re$)
UNION ALL SELECT 'دوالُّ تحمل الرمزَ الآليَّ في HINT',
  (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f'
      AND pg_get_functiondef(p.oid) ~ $re$HINT\s*=\s*'P0[0-9]{3}'$re$)
UNION ALL SELECT 'الرموزُ المحفوظة',
  (SELECT string_agg(DISTINCT m[1], ' · ' ORDER BY m[1]) FROM pg_proc p
     JOIN pg_namespace n ON n.oid=p.pronamespace,
     LATERAL regexp_matches(pg_get_functiondef(p.oid), $re$HINT\s*=\s*'(P0[0-9]{3})'$re$, 'g') m
    WHERE n.nspname='public' AND p.prokind='f');
