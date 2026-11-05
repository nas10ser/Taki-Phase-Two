-- ═══════════════════════════════════════════════════════════════════════════
-- v15.47 — لحظةُ فتح الزرّ لا ترجع إلى الوراء
-- ═══════════════════════════════════════════════════════════════════════════
-- كشفه الفحصُ المستقلّ لإصدارات ٤٢–٤٤، وهو عيبٌ في v15.44 من صنعي:
-- المرساةُ المزدوجة كانت تختار مرساةَ التأكيد **متى وُجدت**، فتاجرٌ يؤكّد
-- متأخّراً — بعد أن تكون الفتحةُ الاحتياطيّة قد فتحت الزرَّ — **يسحب من
-- المشتري زرّاً صار في يده**: يراه عند ١:٥٠ من مهلةِ ساعتين، ثم يختفي عند
-- ١:٥٥ لأن التاجر ضغط «تأكيد استلام الطلب».
--
-- والعقدُ الصحيح: التأكيدُ **يُعجّل** الفتح ولا يؤجّله أبداً ⇒ تُؤخذ الأسبقُ
-- من المرساتين. ولا يتغيّر شيءٌ في الحالة الشائعة (تأكيدٌ سريع ⇒ مرساتُه
-- أسبقُ فتحكم).
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_self_close_opens_at(public.bookings)') IS NULL THEN
    RAISE EXCEPTION 'أساسُ v15.44 غائب — أوقِفت.';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.taki_self_close_opens_at(p_booking bookings)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- 🔴 والسقفُ الخارجيّ ليس تجميلاً: بلا `LEAST` كان فرعُ «أُكِّد» ينفجر.
  --    مهلةُ ١٥ دقيقة (أرضيّةُ v15.43) + تأكيدٌ بعد ٦ ⇒ فتحةٌ عند +١٦ ومهلةٌ
  --    تنتهي عند +١٥ ⇒ **نافذةٌ خالية**، ثمّ يُلغى الطلب. وقِيس أن ٩٫١٪ من
  --    التأكيدات تقع بعد خمس دقائق — فليست حالةً نادرة. ومثلُه أدمنيّاً:
  --    `self_close_minutes` يقبل حتى ١٤٤٠ دقيقة، فرقمٌ كبير كان يُقفل الميزةَ
  --    على المنصّة كلّها بلا أن يقول أحدٌ شيئاً.
  -- ⇒ الزرُّ يُفتح دائماً قبل انتهاء المهلة بدقيقةٍ على الأقلّ، ولا يُفتح
  --   أبداً قبل مهلةِ الختم من لحظة الحجز.
  -- 🔴 v15.46 — صفرٌ يعني «بلا مهلة» لا «بلا إزاحة».
  --    بدون هذا السطر كان `ms = 0` يجعل الفرعَ الاحتياطيّ
  --    `GREATEST(booked+0, expiry-0)` = `expiry`، ثمّ يقصّه السقفُ إلى
  --    `expiry − دقيقة` — أي أن **ضبطَ المهلة على صفر يُنتج أطولَ انتظارٍ
  --    ممكن**، عكسَ ما يقرؤه المدير تماماً. وتوأماه في الموقع والبوت يُرجعان
  --    «مفتوح» عند الصفر، فكانت الشاشةُ تعرض الزرَّ والخادمُ يرفضه.
  SELECT CASE WHEN public.taki_self_close_minutes() <= 0
              THEN COALESCE(p_booking.booked_at, 0)
  ELSE LEAST(
    -- 🔴 v15.46 — واللحظةُ **لا ترجع إلى الوراء أبداً**: كانت الصيغةُ تختار
    --    مرساةَ التأكيد إن وُجدت، فتاجرٌ يؤكّد متأخّراً (بعد أن فتحت الفتحةُ
    --    الاحتياطيّة) كان **يسحب من المشتري زرّاً صار في يده**: يراه عند
    --    ١:٥٠ ثم يختفي عند ١:٥٥ لأن التاجر ضغط «تأكيد الاستلام». ⇒ تُؤخذ
    --    **الأسبقُ** من المرساتين، فالتأكيدُ يُعجّل الفتحَ ولا يؤجّله أبداً.
    LEAST(
      CASE
        WHEN p_booking.acknowledged_at IS NOT NULL
          THEN GREATEST(COALESCE(p_booking.booked_at, 0) + v.ms,
                        (EXTRACT(EPOCH FROM p_booking.acknowledged_at)*1000)::bigint + v.ms)
        WHEN p_booking.status = 'acknowledged'      -- صفٌّ أُكِّد قبل v15.44
          THEN COALESCE(p_booking.booked_at, 0) + v.ms
        ELSE 9223372036854775807
      END,
      GREATEST(COALESCE(p_booking.booked_at, 0) + v.ms,
               COALESCE(NULLIF(p_booking.expiry_time, 0), 9223372036854775807) - v.ms)
    ),
    COALESCE(NULLIF(p_booking.expiry_time, 0), 9223372036854775807) - 60000) END
  FROM (SELECT (public.taki_self_close_minutes() * 60000)::bigint AS ms) v;
$function$;

-- ── تحقّقٌ سلوكيّ: الزرُّ لا يُسحب بعد أن يُعطى ────────────────────────────
DO $behave$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_ms bigint := (public.taki_self_close_minutes() * 60000)::bigint;
  v_now bigint := (EXTRACT(EPOCH FROM NOW())*1000)::bigint;
  v_before bigint; v_after bigint;
BEGIN
  -- صفٌّ اصطناعيّ في الذاكرة — بلا إدراج (التسلسلُ لا يعود بالإرجاع).
  SELECT * INTO v_b FROM public.bookings LIMIT 1;
  v_b.booked_at   := v_now - 7200000;                 -- حُجز قبل ساعتين
  v_b.expiry_time := v_now + 300000;                  -- وتنتهي بعد ٥ دقائق
  v_b.status      := 'pending';
  v_b.acknowledged_at := NULL;
  v_before := public.taki_self_close_opens_at(v_b);

  -- التاجرُ يؤكّد الآن — متأخّراً
  v_b.status := 'acknowledged';
  v_b.acknowledged_at := NOW();
  v_after := public.taki_self_close_opens_at(v_b);

  IF v_after > v_before THEN
    RAISE EXCEPTION '❌ تأخّرت لحظةُ الفتح بعد التأكيد (% ⇐ %) — الزرُّ يُسحب من يد المشتري', v_before, v_after;
  END IF;

  -- وتأكيدٌ مبكّرٌ ما زال يُعجّل
  v_b.booked_at := v_now;
  v_b.expiry_time := v_now + 7200000;
  v_b.acknowledged_at := NOW();
  IF public.taki_self_close_opens_at(v_b) <> v_now + v_ms THEN
    RAISE EXCEPTION '❌ التأكيدُ المبكّر لم يَعُد يُعجّل الفتح';
  END IF;
END
$behave$;

SELECT 'المرساةُ لا ترجع' AS "البند",
  CASE WHEN position('LEAST(' IN pg_get_functiondef('public.taki_self_close_opens_at(public.bookings)'::regprocedure)) > 0
       THEN '✅' ELSE '❌' END AS "القيمة";
