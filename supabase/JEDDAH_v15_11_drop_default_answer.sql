-- ═══════════════════════════════════════════════════════════════════════════
-- v15.11 — يُحذف «الجواب الافتراضيّ»: السؤالُ عند الضغط يكفي
-- ═══════════════════════════════════════════════════════════════════════════
-- ملاحظةُ ناصر على الشاشة: «أنا كنت أقصد إذا عند النقر على استرداد يتم سؤال
-- التاجر إذا الكمية تنقص أو لا».
--
-- والسؤالُ منفَّذٌ فعلاً منذ v15.09 في شاشتَي الردّ معاً. لكنّ بطاقةَ «الجواب
-- الافتراضيّ» بقيت في «سياسات متجري» تشرح حالةً حافّة (فكُّ إدارة تاكي لردٍّ
-- عالق) — **فأربكت مالك المنصّة نفسه**.
--
-- 🔴 وإن أربكت من بناها، فهي تُربك التاجر يقيناً. ومفتاحٌ لا يفهمه صاحبُه
--    يُضبط بالخطأ، فيصير أخطرَ من غيابه. يُحذف:
--      • البطاقةُ من الشاشة.
--      • والعمودُ من القاعدة — فمفتاحٌ بلا شاشةٍ إعدادٌ خفيّ، وهو الفخُّ
--        المسجَّل عندنا من الجهة الأخرى.
--      • والقراءةُ من الدالّتين، فيبقى مفهومٌ واحد: **جوابُ التاجر لهذا
--        الطلب**، وإن لم يُسأل أحدٌ فالافتراض «نعم رجعت» (أمرُ ناصر الأوّل).
--
-- 🪤 ولا يُحذف `bookings.refund_restock`: هو جوابُ التاجر نفسه، وهو المطلوب.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='bookings' AND column_name='refund_restock') THEN
    RAISE EXCEPTION 'v15.09 غير مطبَّقة — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) الدالّتان تقرآن جوابَ التاجر وحده
-- ═══════════════════════════════════════════════════════════════════════════
DO $patch$
DECLARE src text; src0 text; sig text; v_n int := 0;
BEGIN
  FOREACH sig IN ARRAY ARRAY[
    'public.taki_settle_booking_refund(text,boolean,text,text)',
    'public.resolve_booking_refund(text,text,text,numeric,text,text,boolean)'
  ] LOOP
    src := pg_get_functiondef(sig::regprocedure);
    src0 := src;
    IF position('refund_restocks' IN src) = 0 THEN
      RAISE NOTICE 'ℹ️ % مرقوعةٌ أصلاً.', sig; CONTINUE;
    END IF;
    -- 🪤 تُزال قراءةُ ملفّ المتجر ويبقى الجواب — ويُكتب النصّ سلسلةً واحدة:
    --    ربطُ E'…' بـ'…' في PostgreSQL خطأُ تركيبٍ أسقط هجرةً ثلاثَ مرّات.
    src := regexp_replace(src,
      'COALESCE\(v_b\.refund_restock,\s*\n?\s*\(SELECT sp\.refund_restocks FROM public\.store_profiles sp\s*\n?\s*WHERE sp\.store_id = v_b\.store_id\), true\)',
      'COALESCE(v_b.refund_restock, true)');
    src := regexp_replace(src,
      'COALESCE\(p_restock, \(SELECT sp\.refund_restocks FROM public\.store_profiles sp\s*\n?\s*WHERE sp\.store_id = v_b\.store_id\), true\)',
      'COALESCE(p_restock, v_b.refund_restock, true)');
    IF src = src0 THEN
      RAISE EXCEPTION '❌ لم تقع الرقعة على % — النمط لم يطابق.', sig;
    END IF;
    EXECUTE src;
    IF position('refund_restocks' IN pg_get_functiondef(sig::regprocedure)) > 0 THEN
      RAISE EXCEPTION '❌ % ما زالت تقرأ الإعداد المحذوف.', sig;
    END IF;
    v_n := v_n + 1;
  END LOOP;
  RAISE NOTICE '✅ % دالّةً تقرأ جوابَ التاجر وحده.', v_n;
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) البابُ والعمود يُحذفان
-- ═══════════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.merchant_set_refund_restock(boolean);
ALTER TABLE public.store_profiles DROP COLUMN IF EXISTS refund_restocks;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) تحقّقٌ يرفع استثناءً
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='store_profiles' AND column_name='refund_restocks') THEN
    RAISE EXCEPTION '❌ العمود ما زال موجوداً — إعدادٌ خفيّ بلا شاشة.';
  END IF;
  IF to_regprocedure('public.merchant_set_refund_restock(boolean)') IS NOT NULL THEN
    RAISE EXCEPTION '❌ البابُ ما زال موجوداً.';
  END IF;
  -- 🔴 والأهمّ: جوابُ التاجر ما زال يُقرأ — وإلا حُذف المفهومُ كلُّه بالخطأ
  IF position('COALESCE(v_b.refund_restock, true)' IN
       pg_get_functiondef('public.taki_settle_booking_refund(text,boolean,text,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ التسويةُ لم تعد تقرأ جوابَ التاجر — حُذف المفهوم لا الإعداد.';
  END IF;
  IF position('COALESCE(p_restock, v_b.refund_restock, true)' IN
       pg_get_functiondef('public.resolve_booking_refund(text,text,text,numeric,text,text,boolean)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ البابُ اليدويّ لم يعد يقرأ الجواب.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='bookings' AND column_name='refund_restock') THEN
    RAISE EXCEPTION '❌ حُذف جوابُ التاجر نفسه بالخطأ.';
  END IF;
  -- ولا دالّةَ في القاعدة كلّها ما زالت تذكر الإعداد المحذوف
  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid=p.pronamespace
   WHERE ns.nspname='public' AND p.prokind='f'
     AND pg_get_functiondef(p.oid) LIKE '%refund_restocks%';
  IF n > 0 THEN RAISE EXCEPTION '❌ % دالّةً ما زالت تذكر الإعداد المحذوف.', n; END IF;

  RAISE NOTICE '✅ v15.11: مفهومٌ واحد — جوابُ التاجر لهذا الطلب، وافتراضُه «نعم رجعت».';
END
$verify$;
