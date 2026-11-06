-- ═══════════════════════════════════════════════════════════════════════════
-- v15.57c — كتلةُ تسجيلٍ حُقنت ثلاثَ مرّات في `find_email_by_phone`
-- ═══════════════════════════════════════════════════════════════════════════
-- قِيس في نصّ الدالّة الحيّ: **ثلاثُ كتلٍ متطابقةٍ حرفياً**، بنفس الشرط
-- (`IF found_email IS NOT NULL`) ونفسِ الإدراج ونفسِ معالج الاستثناء،
-- متتاليةٌ بلا فاصل. أي أن كلَّ بحثٍ ناجحٍ عن بريدٍ برقم جوّال يكتب
-- **ثلاثةَ صفوفٍ متطابقة** في `activity_log`.
--
-- 🪤 وهذا أثرُ «الاستبدال الشامل داخل ملفّ» (درسٌ مسجَّل في v14.63): استبدالٌ
--    نصّيٌّ طُبّق أكثرَ من مرّةٍ على نفس المرساة. ولا يكسر شيئاً ولا يُخطئ،
--    فلا يظهر إلّا بعدٍّ صريحٍ لمرّات ورود النصّ في `pg_get_functiondef`.
--
-- والضررُ ليس تجميلياً: `activity_log` جدولُ تدقيقٍ يُقرأ في «إدارة العمليات»،
-- وثلاثةُ صفوفٍ لحدثٍ واحد تُفسد أيَّ عدٍّ أو تحقيق. وهو أيضاً ثلاثةُ أضعاف
-- الكتابة على جدولٍ ينمو مع كلّ محاولة دخول.
--
-- 🔴 وتُبنى الدالّةُ من **نصّها الحيّ** لا من نسخةٍ في المستودع: ١٨٩ دالّةً
--    موجودةٌ على الخادم وحده، وإعادةُ كتابةِ واحدةٍ من الذاكرة تمحو ما لا نعلمه.
-- ═══════════════════════════════════════════════════════════════════════════

DO $fix$
DECLARE
  v_src  text;
  v_new  text;
  v_blk  text;
  v_before int;
  v_after  int;
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;

  v_src := pg_get_functiondef('public.find_email_by_phone(text)'::regprocedure);

  -- عدُّ مرّاتِ ورودِ الإدراج **قبل** أي تعديل — فالحكمُ على رقمٍ لا على ظنّ.
  v_before := (length(v_src) - length(replace(v_src, 'INSERT INTO public.activity_log', '')))
              / length('INSERT INTO public.activity_log');
  IF v_before = 1 THEN
    RAISE NOTICE 'ℹ️ الدالّةُ مُصلَحةٌ سلفاً (إدراجٌ واحد) — لا تغيير.';
    RETURN;
  END IF;
  IF v_before <> 3 THEN
    RAISE EXCEPTION 'المتوقَّعُ ٣ إدراجاتٍ والموجودُ % — النصُّ ليس ما قِيس. أوقِفت.', v_before;
  END IF;

  -- الكتلةُ الواحدة كما هي حرفياً في النصّ الحيّ.
  v_blk := E'    IF found_email IS NOT NULL THEN\n'
        || E'      BEGIN\n'
        || E'        INSERT INTO public.activity_log (action, entity_type, entity_id, metadata)\n'
        || E'        VALUES (''phone_email_lookup'', ''auth'', left(digits_only, 4) || ''****'',\n'
        || E'                jsonb_build_object(''ip'', v_ip));\n'
        || E'      EXCEPTION WHEN OTHERS THEN NULL;\n'
        || E'      END;\n'
        || E'    END IF;\n';

  -- 🪤 ويُتحقَّق أن المرساة موجودةٌ **ثلاثَ مرّات متتالية** قبل الاستبدال:
  --    `replace` على نصٍّ غير موجود لا يُخطئ، فيبدو الإصلاحُ ناجحاً وهو لم يقع.
  IF position(v_blk || v_blk || v_blk IN v_src) = 0 THEN
    RAISE EXCEPTION 'الكتلُ الثلاثُ المتتالية غيرُ مطابقةٍ حرفياً — أوقِفت بلا تعديل.';
  END IF;

  v_new := replace(v_src, v_blk || v_blk || v_blk, v_blk);

  v_after := (length(v_new) - length(replace(v_new, 'INSERT INTO public.activity_log', '')))
             / length('INSERT INTO public.activity_log');
  IF v_after <> 1 THEN
    RAISE EXCEPTION 'بعد الاستبدال بقي % إدراجاً — أوقِفت.', v_after;
  END IF;
  -- ولا يُحذف إلّا ما قُصد: الفرقُ في الطول = كتلتان بالضبط.
  IF length(v_src) - length(v_new) <> 2 * length(v_blk) THEN
    RAISE EXCEPTION 'الفرقُ في الطول % والمتوقَّع % — حُذف ما لم يُقصد. أوقِفت.',
                    length(v_src) - length(v_new), 2 * length(v_blk);
  END IF;

  EXECUTE v_new;
  RAISE NOTICE '✓ أُعيد بناءُ الدالّة: % ⇐ % إدراجاً', v_before, v_after;
END
$fix$;

-- ═══ التحقّقُ السلوكيّ: تُنادى فعلاً ويُعدّ ما كتبته ═══════════════════════
DO $behave$
DECLARE v_n0 int; v_n1 int; v_cnt int;
BEGIN
  SELECT count(*) INTO v_n0 FROM public.activity_log WHERE action = 'phone_email_lookup';

  -- 🪤 ولا تُنادى برقمٍ وهميّ: الإدراجُ لا يقع إلّا عند **إيجاد** بريد،
  --    فلو جُرّبت برقمٍ غير موجودٍ لمرّ الاختبارُ كاذباً بصفر كتابة.
  --    يُؤخذ جوّالُ حسابٍ حقيقيّ من القاعدة.
  PERFORM public.find_email_by_phone(
    (SELECT COALESCE(au.phone, au.raw_user_meta_data->>'phone', au.raw_user_meta_data->>'contact_phone')
       FROM auth.users au
       JOIN public.users pu ON pu.id = au.id::text AND pu.user_type <> 'admin'
      WHERE COALESCE(au.phone, au.raw_user_meta_data->>'phone', au.raw_user_meta_data->>'contact_phone') IS NOT NULL
      LIMIT 1));

  SELECT count(*) INTO v_n1 FROM public.activity_log WHERE action = 'phone_email_lookup';
  v_cnt := v_n1 - v_n0;

  IF v_cnt = 0 THEN
    RAISE NOTICE 'ℹ️ لا حسابَ بجوّالٍ صالحٍ للاختبار — يُكتفى بفحص النصّ.';
  ELSIF v_cnt <> 1 THEN
    RAISE EXCEPTION 'نداءٌ واحد كتب % صفّاً — المتوقَّع ١', v_cnt;
  ELSE
    RAISE NOTICE '✓ نداءٌ واحد ⇒ صفٌّ واحد (كان ثلاثة)';
  END IF;

  IF (SELECT (length(pg_get_functiondef('public.find_email_by_phone(text)'::regprocedure))
             - length(replace(pg_get_functiondef('public.find_email_by_phone(text)'::regprocedure),
                              'INSERT INTO public.activity_log','')))
             / length('INSERT INTO public.activity_log')) <> 1 THEN
    RAISE EXCEPTION 'النصُّ الحيُّ ما زال يحمل أكثرَ من إدراج';
  END IF;
END
$behave$;

SELECT 'إدراجاتُ activity_log في الدالّة' AS بند,
       ((length(pg_get_functiondef('public.find_email_by_phone(text)'::regprocedure))
       - length(replace(pg_get_functiondef('public.find_email_by_phone(text)'::regprocedure),
                        'INSERT INTO public.activity_log','')))
       / length('INSERT INTO public.activity_log'))::text AS قيمة,
       '✅' AS حالة;
