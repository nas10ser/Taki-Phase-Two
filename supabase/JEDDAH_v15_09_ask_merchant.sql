-- ═══════════════════════════════════════════════════════════════════════════
-- v15.09 — التاجرُ يُسأل وهو يردّ: «رجعت البضاعة أم لا؟»
-- ═══════════════════════════════════════════════════════════════════════════
-- قرارُ ناصر: «واجعل التاجر يحدد في حال الاسترداد اذا الكميه رجعت او لا، لان
-- احياناً بعض التجار يعطون المشتري كهدية اذا كان فيها عيب وبنفس الوقت يردّ له
-- المبلغ، لذا يُسأل التاجر وهو يردّ».
--
-- 🔴 وهذا يُصحّح تصميمي في v15.06: جعلتُ الإرجاع **إعداداً صامتاً** في ملفّ
--    المتجر. وهو خطأ — لأن الجواب ليس سياسةَ متجرٍ ثابتة بل **واقعةُ طلبٍ
--    بعينه**: نفسُ التاجر يستعيد قطعةً اليوم ويهدي معيبةً غداً ويردّ المال في
--    الحالتين. فإعدادٌ واحدٌ لا يستطيع أن يقول الحقيقة في الحالتين.
--
--    الآن: **السؤالُ عند كلّ ردّ**، وإعدادُ المتجر صار **الجوابَ المقترَح**
--    (يُعرض محدَّداً سلفاً) لا قراراً نيابةً عنه.
--
-- 🪤 وأين يُحفظ الجواب: **لحظةَ الضغط، على الحجز** (`bookings.refund_restock`).
--    ولا يُمرَّر في الطلب وحده لأن رحلة الردّ ثلاثُ محطّات (زرُّ الموقع ⇒
--    دالّةُ الحافة ⇒ البوّابة ⇒ التسوية)، وجوابٌ يعيش في متغيّرٍ يضيع عند أوّل
--    انقطاع، أو عند فكّ الإدارة لردٍّ عالق بعد ساعة.
--
-- 🔴 وعيبٌ ثانٍ من v15.06 يُغلق هنا — والرسالةُ كانت تكذب:
--      PERFORM public.taki_restock_booking(...);
--      GET DIAGNOSTICS v_rows = ROW_COUNT;  v_cancelled := v_rows > 0;
--    و`GET DIAGNOSTICS ROW_COUNT` بعد `PERFORM func()` تُرجع **١ دائماً**
--    (الدالّةُ أعادت صفّاً)، فيصير `v_cancelled` صحيحاً ويقرأ التاجر «وأُلغي
--    الطلب وعادت الكمّية للبيع» — والطلبُ مكتملٌ لم يُلغَ قطّ.
--    الرسالةُ الآن ثلاثيّةُ الفروع وتقول ما حدث فعلاً.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_restock_booking(text,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'v15.06 غير مطبَّقة — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) جوابُ التاجر لهذا الطلب بعينه
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS refund_restock boolean;
COMMENT ON COLUMN public.bookings.refund_restock IS
  'جوابُ التاجر لهذا الردّ: هل عادت البضاعة للمخزون؟ (v15.09) NULL = لم يُسأل ⇒ يُؤخذ الجواب المقترَح من ملفّ المتجر.';

COMMENT ON COLUMN public.store_profiles.refund_restocks IS
  'الجوابُ المقترَح عند كلّ ردّ: هل تعود البضاعة عادةً؟ (v15.09) يُعرض محدَّداً سلفاً، والتاجر يغيّره لكلّ طلبٍ على حدة.';

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) الحجزُ يحمل الجواب — `taki_claim_booking_refund`
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 `CREATE OR REPLACE` مع معاملٍ جديد **لا يستبدل**: يُنشئ نسخةً ثانية
--    فيصير النداء ملتبساً («function is not unique») وتسكت دالّةُ الحافة.
--    فتُحذف القديمة أوّلاً — وهو درسٌ مدفوعُ الثمن في هذا المشروع.
DO $patch_claim$
DECLARE src text;
BEGIN
  IF to_regprocedure('public.taki_claim_booking_refund(text,text,boolean)') IS NOT NULL THEN
    RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN;
  END IF;
  src := pg_get_functiondef('public.taki_claim_booking_refund(text,text)'::regprocedure);

  IF position('p_barcode text, p_reason text DEFAULT NULL::text)' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة التوقيع غير موجودة — أوقِفت.';
  END IF;
  src := replace(src, 'p_barcode text, p_reason text DEFAULT NULL::text)',
                      'p_barcode text, p_reason text DEFAULT NULL::text, p_restock boolean DEFAULT NULL)');

  IF position(E'         refund_ref        = NULL          -- محاولةٌ جديدة ⇒ مرجعٌ جديد' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة كتابة الحجز غير موجودة — أوقِفت.';
  END IF;
  src := replace(src,
    E'         refund_ref        = NULL          -- محاولةٌ جديدة ⇒ مرجعٌ جديد',
    E'         refund_ref        = NULL,         -- محاولةٌ جديدة ⇒ مرجعٌ جديد\n         -- v15.09 — جوابُ التاجر لهذا الردّ، يُحفظ لحظةَ الضغط ليصمد\n         --          عبر رحلة البوّابة وفكِّ الإدارة لردٍّ عالق بعد ساعة.\n         refund_restock    = p_restock');

  EXECUTE src;
  DROP FUNCTION IF EXISTS public.taki_claim_booking_refund(text, text);
  IF to_regprocedure('public.taki_claim_booking_refund(text,text,boolean)') IS NULL THEN
    RAISE EXCEPTION '❌ النسخة الجديدة لم تُنشأ.';
  END IF;
  IF to_regprocedure('public.taki_claim_booking_refund(text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '❌ النسخة القديمة باقية — النداءُ سيصير ملتبساً وتسكت دالّةُ الحافة.';
  END IF;
  RAISE NOTICE '✅ الحجزُ يحمل جوابَ التاجر.';
END
$patch_claim$;

REVOKE ALL ON FUNCTION public.taki_claim_booking_refund(text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_claim_booking_refund(text, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.taki_claim_booking_refund(text, text, boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) التسويةُ تقرأ الجواب — والرسالةُ تقول ما حدث فعلاً
-- ═══════════════════════════════════════════════════════════════════════════
DO $patch_settle$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.taki_settle_booking_refund(text,boolean,text,text)'::regprocedure);
  src0 := src;
  IF position('v_restocked' IN src) > 0 THEN RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN; END IF;

  -- متغيّرٌ يقول ما جرى فعلاً
  src := regexp_replace(src, '(AS \$function\$\s*\nDECLARE)', E'\\1\n  v_restocked boolean := false;');

  -- الجوابُ أوّلاً، ثمّ المقترَح من ملفّ المتجر، ثمّ «نعم» افتراضاً
  IF position(E'  ELSIF v_b.status = ''completed''\n        AND COALESCE((SELECT sp.refund_restocks FROM public.store_profiles sp\n                       WHERE sp.store_id = v_b.store_id), true) THEN\n    PERFORM public.taki_restock_booking(v_b.barcode, NULL, ''refund'');\n    GET DIAGNOSTICS v_rows = ROW_COUNT;\n    v_cancelled := v_rows > 0;' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة فرع الإرجاع غير موجودة — أوقِفت.';
  END IF;
  src := replace(src,
    E'  ELSIF v_b.status = ''completed''\n        AND COALESCE((SELECT sp.refund_restocks FROM public.store_profiles sp\n                       WHERE sp.store_id = v_b.store_id), true) THEN\n    PERFORM public.taki_restock_booking(v_b.barcode, NULL, ''refund'');\n    GET DIAGNOSTICS v_rows = ROW_COUNT;\n    v_cancelled := v_rows > 0;',
    E'  -- v15.09 — جوابُ التاجر لهذا الردّ أوّلاً، ثمّ المقترَح من ملفّ متجره.\n  --           لأن الجواب واقعةُ طلبٍ لا سياسةُ متجر: نفسُ التاجر يستعيد\n  --           قطعةً اليوم ويهدي معيبةً غداً ويردّ المال في الحالتين.\n  ELSIF v_b.status = ''completed''\n        AND COALESCE(v_b.refund_restock,\n                     (SELECT sp.refund_restocks FROM public.store_profiles sp\n                       WHERE sp.store_id = v_b.store_id), true) THEN\n    -- 🔴 ولا تُقرأ نتيجتُه بـGET DIAGNOSTICS: بعد `PERFORM func()` تُرجع\n    --    ١ دائماً، فكانت الرسالةُ تقول «أُلغي الطلب» لطلبٍ مكتملٍ لم يُلغَ.\n    v_restocked := COALESCE((public.taki_restock_booking(v_b.barcode, NULL, ''refund'')->>''ok'')::boolean, false);');

  -- والرسالةُ ثلاثيّةُ الفروع
  IF position(E'CASE WHEN v_cancelled\n              THEN ''وأُلغي الطلب وعادت الكمّية للبيع.''\n              ELSE ''والطلب مُغلق أصلاً وعادت كمّيته إلى مخزونك تلقائياً. تُطفئ ذلك من سياسات متجرك متى شئت.'' END' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة الرسالة العربية غير موجودة — أوقِفت.';
  END IF;
  src := replace(src,
    E'CASE WHEN v_cancelled\n              THEN ''وأُلغي الطلب وعادت الكمّية للبيع.''\n              ELSE ''والطلب مُغلق أصلاً وعادت كمّيته إلى مخزونك تلقائياً. تُطفئ ذلك من سياسات متجرك متى شئت.'' END',
    E'CASE WHEN v_cancelled THEN ''وأُلغي الطلب وعادت الكمّية للبيع.''\n              WHEN v_restocked THEN ''والطلب مكتملٌ، وعادت كمّيته إلى مخزونك كما اخترت.''\n              ELSE ''والطلب مكتملٌ، ولم تعُد كمّيته إلى المخزون كما اخترت.'' END');

  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع أيُّ رقعة.'; END IF;
  EXECUTE src;
  src := pg_get_functiondef('public.taki_settle_booking_refund(text,boolean,text,text)'::regprocedure);
  IF position('v_b.refund_restock' IN src) = 0 THEN
    RAISE EXCEPTION '❌ التسويةُ لا تقرأ جوابَ التاجر.';
  END IF;
  IF position('GET DIAGNOSTICS v_rows = ROW_COUNT;' IN src) > 0
     AND position('taki_restock_booking' IN src) > 0
     AND src ~ 'PERFORM public\.taki_restock_booking[^;]*;\s*\n\s*GET DIAGNOSTICS' THEN
    RAISE EXCEPTION '❌ قراءةُ ROW_COUNT بعد PERFORM ما زالت — الرسالةُ ستكذب.';
  END IF;
  RAISE NOTICE '✅ التسوية: جوابُ التاجر · ورسالةٌ ثلاثيّةُ الفروع تقول ما حدث.';
END
$patch_settle$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) والبابُ اليدويّ — قرارُ التاجر على طلب استرداد
-- ═══════════════════════════════════════════════════════════════════════════
DO $patch_resolve$
DECLARE src text;
BEGIN
  IF to_regprocedure('public.resolve_booking_refund(text,text,text,numeric,text,text,boolean)') IS NOT NULL THEN
    RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN;
  END IF;
  src := pg_get_functiondef('public.resolve_booking_refund(text,text,text,numeric,text,text)'::regprocedure);

  IF src !~ 'p_method text DEFAULT NULL::text\)' THEN
    RAISE EXCEPTION '❌ مرساة التوقيع غير موجودة — أوقِفت.';
  END IF;
  src := regexp_replace(src, '(p_method text DEFAULT NULL::text)\)',
                             '\1, p_restock boolean DEFAULT NULL)');

  IF position(E'  ELSIF v_b.status = ''completed''\n        AND COALESCE((SELECT sp.refund_restocks FROM public.store_profiles sp' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة فرع الإرجاع غير موجودة — أوقِفت.';
  END IF;
  src := replace(src,
    E'  ELSIF v_b.status = ''completed''\n        AND COALESCE((SELECT sp.refund_restocks FROM public.store_profiles sp',
    E'  -- v15.09 — جوابُ التاجر في هذا القرار نفسه، ثمّ المقترَح من ملفّ متجره.\n  ELSIF v_b.status = ''completed''\n        AND COALESCE(p_restock, (SELECT sp.refund_restocks FROM public.store_profiles sp');
  src := replace(src,
    E'                       WHERE sp.store_id = v_b.store_id), true) THEN\n    PERFORM public.taki_restock_booking(v_b.barcode, NULL, ''refund'');',
    E'                       WHERE sp.store_id = v_b.store_id), true) THEN\n    PERFORM public.taki_restock_booking(v_b.barcode, NULL, ''refund'');');

  EXECUTE src;
  DROP FUNCTION IF EXISTS public.resolve_booking_refund(text, text, text, numeric, text, text);
  IF to_regprocedure('public.resolve_booking_refund(text,text,text,numeric,text,text,boolean)') IS NULL THEN
    RAISE EXCEPTION '❌ النسخة الجديدة لم تُنشأ.';
  END IF;
  IF to_regprocedure('public.resolve_booking_refund(text,text,text,numeric,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION '❌ النسخة القديمة باقية — نداءٌ ملتبس.';
  END IF;
  RAISE NOTICE '✅ البابُ اليدويّ يقبل جوابَ التاجر.';
END
$patch_resolve$;

REVOKE ALL ON FUNCTION public.resolve_booking_refund(text,text,text,numeric,text,text,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_booking_refund(text,text,text,numeric,text,text,boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_booking_refund(text,text,text,numeric,text,text,boolean) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) تحقّقٌ يرفع استثناءً — ومعه قياسٌ سلوكيّ للجوابين
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE src text; n int;
BEGIN
  -- (أ) البنية والتوقيعات — ولا نسخةَ ثانية
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='bookings' AND column_name='refund_restock') THEN
    RAISE EXCEPTION '❌ العمود refund_restock غائب — الجوابُ لا مكانَ له.';
  END IF;
  IF to_regprocedure('public.taki_claim_booking_refund(text,text,boolean)') IS NULL
     OR to_regprocedure('public.resolve_booking_refund(text,text,text,numeric,text,text,boolean)') IS NULL THEN
    RAISE EXCEPTION '❌ إحدى الدالّتين لم تُنشأ بتوقيعها الجديد.';
  END IF;
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.proname IN ('taki_claim_booking_refund','resolve_booking_refund');
  IF n <> 2 THEN
    RAISE EXCEPTION '❌ % نسخةً من الدالّتين بدل ٢ — النداءُ سيصير ملتبساً وتسكت دالّةُ الحافة.', n;
  END IF;

  -- (ب) الجوابُ يُحفظ ويُقرأ
  IF position('refund_restock    = p_restock' IN
       pg_get_functiondef('public.taki_claim_booking_refund(text,text,boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الحجزُ لا يحفظ الجواب — سيضيع في رحلة البوّابة.';
  END IF;
  src := regexp_replace(pg_get_functiondef('public.taki_settle_booking_refund(text,boolean,text,text)'::regprocedure), '--[^\n]*', '', 'g');
  IF position('COALESCE(v_b.refund_restock' IN src) = 0 THEN
    RAISE EXCEPTION '❌ التسويةُ لا تقرأ الجواب — الإعدادُ الصامت باقٍ.';
  END IF;
  IF position('COALESCE(p_restock' IN
       regexp_replace(pg_get_functiondef('public.resolve_booking_refund(text,text,text,numeric,text,text,boolean)'::regprocedure), '--[^\n]*', '', 'g')) = 0 THEN
    RAISE EXCEPTION '❌ البابُ اليدويّ لا يقرأ الجواب.';
  END IF;

  -- (ج) 🔴 ولا تُقرأ نتيجةُ PERFORM بـROW_COUNT — الرسالةُ كانت تكذب
  IF src ~ 'PERFORM public\.taki_restock_booking[^;]*;\s*GET DIAGNOSTICS' THEN
    RAISE EXCEPTION '❌ ROW_COUNT بعد PERFORM ما زالت — «أُلغي الطلب» لطلبٍ لم يُلغَ.';
  END IF;
  IF position('v_restocked' IN src) = 0 THEN
    RAISE EXCEPTION '❌ لا متغيّرَ يحمل ما حدث فعلاً.';
  END IF;
  -- والرسالةُ ثلاثيّةُ الفروع وتذكر الاختيار
  IF position('كما اخترت' IN src) = 0 THEN
    RAISE EXCEPTION '❌ الرسالةُ لا تقول إن ما جرى كان اختيار التاجر.';
  END IF;
  IF position('ولم تعُد كمّيته' IN src) = 0 THEN
    RAISE EXCEPTION '❌ لا فرعَ لحالة «لم ترجع البضاعة» — وهي حالةُ الهدية التي طلبها ناصر.';
  END IF;

  -- (د) برهانٌ منطقيّ مباشر على العيب الذي أُصلح
  CREATE TEMP TABLE _t9 (x int);
  INSERT INTO _t9 VALUES (1);
  PERFORM count(*) FROM _t9 WHERE false;   -- صفرُ صفوفٍ منطقياً
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION '❌ افتراضي عن ROW_COUNT خاطئ (%).', n;
  END IF;
  DROP TABLE _t9;

  -- (هـ) والمعادلة سليمة، والأعلام صُحّحت
  SELECT count(*) INTO n FROM public.deals d
   WHERE d.on_hand IS NOT NULL
     AND COALESCE(d.quantity,-1) <> GREATEST(0, d.on_hand - public.taki_open_holds(d.id,NULL,NULL));
  IF n > 0 THEN RAISE EXCEPTION '❌ % عرضاً خرج عن المعادلة.', n; END IF;
  SELECT on_hand INTO n FROM public.deals WHERE id = '1784633827847';
  IF n <> 26 THEN RAISE EXCEPTION '❌ عرضُ الأعلام % بدل ٢٦.', n; END IF;

  RAISE NOTICE '✅ v15.09: التاجرُ يُسأل عند كلّ ردّ · والجوابُ يُحفظ على الحجز · والرسالةُ تقول ما حدث فعلاً.';
END
$verify$;
