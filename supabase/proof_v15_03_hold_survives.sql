-- ═══════════════════════════════════════════════════════════════════════════
-- إثباتُ v15.03 — الحجزُ القائم ينجو من حفظ التاجر (تجربةٌ تُلغى بالكامل)
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 هذا الملفّ **ليس هجرة**: يُدخل حجزاً حقيقياً ليُعيد إنتاج العيب، ثمّ
--    يُلغي كلّ شيء. يُشغَّل على جدّة داخل `BEGIN … ROLLBACK` وحده.
--    وسببُ فصله عن الهجرة: إدراجُ صفٍّ وهميّ في `bookings` على الإنتاج —
--    ولو حُذف بعدها — يمرّ على ١٨ مشغّلاً ويكتب في الفواتير والإشعارات.
BEGIN;

ALTER TABLE public.bookings DISABLE TRIGGER USER;

DO $setup$
DECLARE cols text; q int; vq int;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='bookings' AND is_generated='NEVER';
  EXECUTE format(
    'CREATE TEMP TABLE _b AS SELECT %s FROM public.bookings WHERE deal_id=''1784633827847'' LIMIT 1', cols);
  UPDATE _b SET barcode='999999902', status='pending', booked_quantity=3,
    selected_options='[{"c":"v_mrursrivi77f","g":"__variant__","qty":2}]'::jsonb;
  EXECUTE format('INSERT INTO public.bookings (%s) SELECT %s FROM _b', cols, cols);

  -- الحالةُ الابتدائية: التاجر عنده ٢٦ إجمالاً و٧ من الصنف الأوّل، و٣ محجوزة
  -- منها ٢ من ذلك الصنف.
  PERFORM public.taki_set_on_hand('1784633827847', 26,
    '[{"id":"v_mrursrivi77f","onHand":7},{"id":"v_mrurtc7cdz4g","onHand":19}]'::jsonb,
    NULL, now(), 'proof');

  SELECT quantity INTO q FROM public.deals WHERE id='1784633827847';
  SELECT (e->>'qty')::int INTO vq FROM public.deals d, jsonb_array_elements(d.variants) e
   WHERE d.id='1784633827847' AND e->>'id'='v_mrursrivi77f';
  IF q <> 23 THEN RAISE EXCEPTION '❌ التهيئة: المتاح % بدل ٢٣ (٢٦−٣).', q; END IF;
  IF vq <> 5 THEN RAISE EXCEPTION '❌ التهيئة: متاح الصنف % بدل ٥ (٧−٢).', vq; END IF;
  RAISE NOTICE 'ℹ️ الحالة: كامل=٢٦ محجوز=٣ متاح=٢٣ · صنف: كامل=٧ محجوز=٢ متاح=٥';
END
$setup$;

ALTER TABLE public.bookings ENABLE TRIGGER USER;

-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 هنا العيبُ نفسه: حفظٌ من لوحة التاجر — نداءٌ مباشر يكتب الأرقام الكاملة
--    كما يفعل `SellerDashboard.tsx` حرفياً عند كل حفظ.
--    قبل v15.03 كان هذا يُعيد المتاح إلى ٢٦ فتُباع القطعُ الثلاثُ المحجوزة
--    مرّةً ثانية.
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE public.deals
   SET quantity = 26, initial_quantity = 26,
       variants = '[{"id":"v_mrursrivi77f","qty":7,"label":"علم صغير","price":20,"imageIndex":1},
                    {"id":"v_mrurtc7cdz4g","qty":19,"label":"علم كبير","price":50,"imageIndex":0}]'::jsonb,
       description = 'تعديلٌ بريء من التاجر'
 WHERE id = '1784633827847';

DO $proof$
DECLARE q int; oh int; vq int; voh int; h int;
BEGIN
  SELECT quantity, on_hand INTO q, oh FROM public.deals WHERE id='1784633827847';
  SELECT (e->>'qty')::int, (e->>'onHand')::int INTO vq, voh
    FROM public.deals d, jsonb_array_elements(d.variants) e
   WHERE d.id='1784633827847' AND e->>'id'='v_mrursrivi77f';
  h := public.taki_open_holds('1784633827847', NULL, NULL);

  IF oh <> 26 THEN RAISE EXCEPTION '❌ الكامل % بدل ٢٦.', oh; END IF;
  IF q <> 23 THEN
    RAISE EXCEPTION '❌ 🔴 العيبُ قائم: المتاح عاد إلى % بعد حفظ التاجر — ثلاثُ قطعٍ محجوزة ستُباع مرّتين.', q;
  END IF;
  IF voh <> 7 THEN RAISE EXCEPTION '❌ كاملُ الصنف % بدل ٧.', voh; END IF;
  IF vq <> 5 THEN
    RAISE EXCEPTION '❌ 🔴 متاحُ الصنف عاد إلى % بعد حفظ التاجر (المحجوز منه ٢).', vq;
  END IF;
  IF h <> 3 THEN RAISE EXCEPTION '❌ الحجز تغيّر (% بدل ٣).', h; END IF;
  RAISE NOTICE '✅ نجا الحجز: بعد حفظ التاجر ⇒ كامل=٢٦ متاح=٢٣ · صنف كامل=٧ متاح=٥ · محجوز=٣';
END
$proof$;

-- ═══════════════════════════════════════════════════════════════════════════
-- والاتجاه المعاكس: إلغاءُ الحجز يمرّ من `adjust_deal_quantity` (عمق > ١)
-- فيُعيد المتاح ولا يُفسَّر إعلاناً.
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE public.bookings SET status='cancelled' WHERE barcode='999999902';

DO $proof2$
DECLARE q int; oh int; vq int; h int;
BEGIN
  SELECT quantity, on_hand INTO q, oh FROM public.deals WHERE id='1784633827847';
  SELECT (e->>'qty')::int INTO vq FROM public.deals d, jsonb_array_elements(d.variants) e
   WHERE d.id='1784633827847' AND e->>'id'='v_mrursrivi77f';
  h := public.taki_open_holds('1784633827847', NULL, NULL);

  IF h <> 0 THEN RAISE EXCEPTION '❌ المحجوز % بدل صفر بعد الإلغاء.', h; END IF;
  IF oh <> 26 THEN RAISE EXCEPTION '❌ الإلغاء غيّر الكامل (% بدل ٢٦) — البضاعة لم تخرج.', oh; END IF;
  IF q <> 26 THEN RAISE EXCEPTION '❌ المتاح % بدل ٢٦ بعد الإلغاء.', q; END IF;
  IF vq <> 7 THEN RAISE EXCEPTION '❌ متاح الصنف % بدل ٧ بعد الإلغاء.', vq; END IF;
  RAISE NOTICE '✅ الإلغاء: محجوز=٠ كامل=٢٦ متاح=٢٦ · والمعادلة صامدة في الاتجاهين.';
END
$proof2$;

-- ═══════════════════════════════════════════════════════════════════════════
-- والاتجاه الثالث — وهو وحده الذي يحتاج حارسَ العمق: **إدراجُ حجزٍ جديد**
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 لماذا أُضيف هذا القسم: كسرتُ حارسَ العمق عمداً فمرّ الإثبات كلُّه —
--    لأن كلّ حجوزه أُدخلت والمشغّلاتُ معطَّلة، فمسارُ `adjust_deal_quantity`
--    على الإدراج (عمق ٢) لم يُسلَك مرّةً واحدة. واختبارٌ لا يسلك المسار
--    لا يحرسه، وكان سيُبرّئ حارساً لم يُجرَّب.
--    وهنا يُفعَّل ذلك المشغّل **وحده** فيُقاس ما نريد قياسه بالضبط.
ALTER TABLE public.bookings DISABLE TRIGGER USER;
ALTER TABLE public.bookings ENABLE TRIGGER trg_adjust_deal_quantity;

DO $setup3$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position) INTO cols
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='bookings' AND is_generated='NEVER';
  EXECUTE format('CREATE TEMP TABLE _b3 AS SELECT %s FROM public.bookings WHERE barcode=%L',
                 cols, '999999902');
  UPDATE _b3 SET barcode='999999903', status='pending', booked_quantity=4,
    selected_options='[{"c":"v_mrursrivi77f","g":"__variant__","qty":1}]'::jsonb;
  EXECUTE format('INSERT INTO public.bookings (%s) SELECT %s FROM _b3', cols, cols);
END
$setup3$;

DO $proof3$
DECLARE q int; oh int; vq int; voh int; h int;
BEGIN
  SELECT quantity, on_hand INTO q, oh FROM public.deals WHERE id='1784633827847';
  SELECT (e->>'qty')::int, (e->>'onHand')::int INTO vq, voh
    FROM public.deals d, jsonb_array_elements(d.variants) e
   WHERE d.id='1784633827847' AND e->>'id'='v_mrursrivi77f';
  h := public.taki_open_holds('1784633827847', NULL, NULL);

  IF h <> 4 THEN RAISE EXCEPTION '❌ المحجوز % بدل ٤ بعد الإدراج.', h; END IF;
  -- 🔴 الادّعاء الحاسم: حجزُ المشتري **لا يُفسَّر إعلانَ مخزون**
  IF oh <> 26 THEN
    RAISE EXCEPTION '❌ حجزُ مشترٍ نقّص «المخزون الكامل» إلى % — فُسّر إعلاناً، وحارسُ العمق لا يعمل.', oh;
  END IF;
  IF q <> 22 THEN RAISE EXCEPTION '❌ المتاح % بدل ٢٢ (٢٦−٤).', q; END IF;
  IF voh <> 7 THEN RAISE EXCEPTION '❌ كاملُ الصنف تغيّر إلى % — اشتقاقٌ مزدوج.', voh; END IF;
  IF vq <> 6 THEN RAISE EXCEPTION '❌ متاحُ الصنف % بدل ٦ (٧−١).', vq; END IF;
  RAISE NOTICE '✅ الإدراج: محجوز=٤ · الكامل ثابتٌ ٢٦ · متاح=٢٢ · صنف كامل=٧ متاح=٦';
END
$proof3$;

ALTER TABLE public.bookings ENABLE TRIGGER USER;

ROLLBACK;
