-- ════════════════════════════════════════════════════════════════════════
-- TAKI · v15.80 — سلامةُ المال: سبعةُ أبوابٍ تُغلق
--
-- تُشغَّل على **جدة (الإنتاج)** بالدور `supabase_admin`. آمنةٌ للتكرار،
-- وكلُّها داخل معاملةٍ واحدة (لا `CONCURRENTLY` ولا `ALTER TYPE ADD VALUE`).
--
-- ╔═══════════════════ ما قِيس على جدة قبل كتابة هذا الملفّ ═══════════════╗
-- ║ ٨ نوفمبر ٢٠٢٦ · `obj_description` = (بلا وسم) ⇒ جدة لا مختبر طوكيو.    ║
-- ║ ٦ حسابات · ٣ متاجر · ٢٢ عرضاً (٦ حيّة) · ١٢٠ حجزاً · ٧ طلباتٍ مدفوعة.   ║
-- ║ `postgres` **ليس superuser** (`rolsuper=false`) و`supabase_admin` هو.   ║
-- ╚═══════════════════════════════════════════════════════════════════════╝
--
-- ───────────── الأبوابُ السبعة، وما يُثبت أن كلَّ واحدٍ منها حقيقيّ ─────────────
--
-- ① `resolve_booking_refund` تقبل مبلغاً من العميل وتَطبعه إشعاراً دائناً على
--    فاتورةٍ ضريبيّة **مجمّدة**. النصُّ الحيّ المقيس:
--      `v_amt := round(COALESCE(p_amount, v_r.amount, 0), 2);`
--      `IF NOT (v_amt > 0) THEN … ZERO_AMOUNT`
--    أي أنّ الاختبارَ الوحيد هو «أكبرُ من صفر». والسقفُ الفعليُّ الوحيد اليوم
--    هو قيدُ `booking_refunds_sane` (مليون ريال) — أي **٧٦٩٢٣ ضِعفَ** فاتورةِ
--    ١٣ ريالاً. وتاكي لا تملك المال، فالأثرُ ليس خروجَ نقدٍ منها بل أن يصير
--    **مستندُها الضريبيُّ** أداةَ تخفيضٍ كاذبٍ لوعاء الضريبة: إشعارٌ دائنٌ
--    برقمٍ متسلسلٍ يقول «رُدَّ أكثرُ من قيمة البيع». وأخطرُ منه: مع البابِ ⑦
--    يستطيع **أدمنٌ فرعيّ** أن يطبع ذلك على فاتورةِ تاجرٍ لا يملك متجره.
--
-- ② `tr_validate_booking_options` تحرس **غيرَ الويب** وحدَه:
--      `IF COALESCE(NEW.source,'web') <> 'web' THEN …`
--    و`taki_booking_amount` ترتدّ إلى `discounted_price × qty` حين لا يوجد
--    مدخلُ `__variant__`. فمشترٍ على الويب يَحجب النسخةَ فيختار سعرَه.
--    🔴 والدليلُ من بياناتٍ حيّة لا من استدلال: العرضُ الحيّ `1793442128481`
--       سعرُه ١٣ ونسخُه ١٣/١٨/٢٠ ⇒ «كرتون كبير» (٢٠) يُشترى بـ١٣ = **٣٥٪ خسارةً
--       للتاجر في كلّ قطعة**. (والعرضُ `1784633827847` معاكس: ١٥٠ ونسخُه ٢٠–٥٠،
--       فالحجبُ هناك يُغلي لا يُرخّص — فالعيبُ يقع في عرضٍ بعينه لا في كلّها.)
--    🔴 وبابٌ ثانٍ لم يُرَ قبلُ: المشغّل يفحص **وجودَ مدخل** للمجموعة الإلزاميّة
--       ولا يفحص أنّ الخيارَ المذكورَ موجودٌ أصلاً؛ و`taki_booking_amount`
--       تتجاوز الخيارَ المجهول (`CONTINUE WHEN v_node IS NULL`) فتُسقط ثمنَه.
--       فمدخلٌ `{"g":"<مجموعة>","c":"c_وهميّ"}` يُرضي الحارسَ ويُسقط الإضافة.
--       (اليوم لا خيارَ إلزاميٍّ حيٍّ يحمل سعراً، فالأثرُ المالي صفرٌ **الآن**
--       وتعديلُ تاجرٍ واحدٌ يجعله مالاً. والبيانات: صفرُ حجزٍ من ١٢٠ يُشير إلى
--       مجموعةٍ أو خيارٍ أو نسخةٍ غير موجودة.)
--    ⚠️ نطاقُ الأثر مقيسٌ: صفرُ مجموعةٍ إلزاميّةٍ بلا خيارات · صفرُ نسخةٍ بلا
--       `id` · **صفرُ حجزٍ معلّقٍ** يخالف القاعدة · حجزان **مكتملان** يخالفانها
--       والمشغّلُ `BEFORE INSERT` وحده فلا يُعاد التحقّقُ عليهما أبداً.
--       والعميلُ يُلزم بالقاعدتين أصلاً: `src/pages/DealDetails.tsx:1434-1448`
--       (المجموعاتُ الإلزاميّة) و`src/utils/bookingPreflight.ts:72` (النسخة).
--
-- ③ `webhook_url` الذي يكتبه التاجر يُفحص بشرطٍ واحدٍ في الكاتبين كليهما:
--    `p_webhook_url !~ '^https://'`. فالبوتُ يُرسل إليه من مَخرجه ⇒ SSRF أعمى
--    مع عرّافِ حالةٍ يقرؤه التاجرُ من `stock_events.last_error`.
--    🔴 ولا تُستعمل قائمةُ منعٍ: `!~ '^https://(10|127)\.'` تُفلت العشريَّ
--       (`2130706433`) والثُمانيَّ (`0177.0.0.1`) و`[::1]` و`[::ffff:10.0.0.1]`.
--       فالشكلُ **مُثبِتٌ ببنيته**: مضيفُ DNS مُنقَّطٌ ولاحقتُه حروفٌ خالصة
--       (`[a-z]{2,63}`) — وهذا يرفض كلَّ صيغةِ عنوانٍ رقميٍّ في كلّ ترميز.
--
-- ④ مسارُ تفويض سلّة يثق بـ**رقمٍ يُدّعيه** التاجر (`merchant_stock_claim_parked`
--    تُطابق `remote_id` وحده بلا أيّ ربطٍ بنافذةِ المُطالب)، و
--    `taki_stock_oauth_bind_salla` فرعُها (ب) يَربط توكناً مجهولَ النسبة بمن
--    لديه نافذةٌ مفتوحة. فيُبقي تاجرٌ نافذتَه مفتوحةً ويحصد تثبيتَ الضحية
--    التالية. (كامن: تطبيقُ سلّة غيرُ مسجَّلٍ بعد · صفرُ صفٍّ في
--    `stock_oauth_parked` — قِيسا.) والقاعدةُ في CLAUDE.md v15.22: **هويّةُ
--    متجرٍ لا تُخمَّن إطلاقاً**.
--
-- ⑤ `taki_stock_webhook` تُثبّت `now()` زمناً للرصد وتبني بصمةَ التكرار على
--    `now()` كذلك ⇒ جسمٌ موقَّعٌ مُعادٌ بعد خمس دقائق يدخل دلواً جديداً، ولا
--    يستطيع `STALE_OBSERVATION` أن يمسكه لأنه يُقارَن بزمنٍ وُلد الآن.
--
-- ⑥ تسلسلُ فاتورةِ اشتراكاتِ تاكي نفسِها على `nextval` ⇒ **فجواتٌ قائمةٌ
--    فعلاً**: `taki_invoice_seq.last_value = 37` و`max(invoice_no) = 4`
--    وصفّان (٣ و٤) ⇒ **٣٥ رقماً من ٣٧ مفقود**. والتسلسلُ الضريبيُّ لا فجوةَ
--    فيه. وزيادةً: لا فهرسَ فريداً على `invoice_no` إطلاقاً (قِيس).
--
-- ⑦ سبعُ دوالَّ ماليّة تُميّز «أدمن» بـ`is_admin()` أو بـ`user_type='admin'`
--    خاماً، وليست في `admin_rpc_permissions` (١٠٧ صفّاً، ولا صفَّ لأيٍّ منها
--    — قِيس). و`is_admin()` حين لا تجد إطارَ `admin_*` على مكدّس النداء
--    **تُرجع TRUE لأيّ أدمن** (نصُّها الحيّ: `IF v_perm IS NULL THEN RETURN TRUE`).
--    فالمعالجةُ ليست توسيعَ سجلٍّ يستشيره تعبيرٌ نمطيّ، بل **صلاحيةٌ صريحة**.
--
-- ───────────────────────── وما لا تمسّه هذه الهجرة عن عمد ─────────────────────
-- • قفلُ v14.97 في `taki_claim_booking_refund` (`FOR UPDATE` ثمّ
--   `ALREADY_CLAIMING` **قبل** نداء البوّابة، ونتيجةٌ مجهولةٌ لا تُحرَّر أبداً).
--   قُرئ نصُّه الحيُّ وأُثبت أنه سليم، ولم يُمَسّ: الاسترداد غيرُ آمنٍ للتكرار،
--   وأربعٌ من ستّ بوّابات بلا مفتاح تكرار.
-- • `ensure_active_subscription` — **لا تُعاد بوّابتُها**. نصُّها الحيُّ لا
--   يحمل أيَّ مميِّزٍ للمنادي (تقرأ `user_type` لـ`p_merchant_id` لا للمنادي)،
--   ولها **خمسةُ منادين داخليّين** مقيسين: `bot_add_deal` · `bot_get_subscription`
--   · `bot_toggle_deal` · `bot_update_deal` · `guard_deal_publish`. فإعادةُ
--   بوّابتها تكسرُهم، وليست من هذا الصنف أصلاً.
-- • الحجزان المكتملان المخالفان للقاعدة ② — لا يُلمَسان: فاتورتُهما مجمّدة.
-- ════════════════════════════════════════════════════════════════════════

-- ① حارسُ المختبر — أوّلُ عبارةٍ دائماً
DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION '⛔ هذه هجرةُ إنتاج (جدة) — ومُنعت على مختبر طوكيو.';
  END IF;
END $guard$;

-- ② شروطٌ مسبقة تُفشل الهجرةَ لا تُحذّر
--    🔴 تشديدُ مشغّلٍ يرفض ما تُرسله الواجهةُ الحاليّة **عطلٌ لا إصلاح**. فما
--       قِيس يوم الكتابة يُعاد قياسُه لحظةَ التنفيذ: إن تغيّرت البياناتُ بينهما
--       تتوقّف الهجرةُ ولا تُشحن قاعدةٌ تُسقط حجوزاً حقيقيّة.
DO $pre$
DECLARE
  v_empty_req int; v_no_id int; v_open_bad int; v_unknown_ref int;
BEGIN
  SELECT count(*) INTO v_empty_req
    FROM public.deals d,
         jsonb_array_elements(CASE WHEN jsonb_typeof(d.options) = 'array' THEN d.options ELSE '[]'::jsonb END) g
   WHERE COALESCE((g->>'required')::boolean, false)
     AND COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(g->'choices') = 'array'
                                          THEN g->'choices' ELSE '[]'::jsonb END), 0) = 0
     AND d.status IN ('active', 'paused');
  IF v_empty_req > 0 THEN
    RAISE EXCEPTION '❌ % مجموعةٍ إلزاميّةٍ بلا خيارات على عرضٍ قابلٍ للنشر — تشديدُ المشغّل يجعلها غيرَ قابلةٍ للحجز أبداً. أصلحِ العرضَ أوّلاً.', v_empty_req;
  END IF;

  SELECT count(*) INTO v_no_id
    FROM public.deals d,
         jsonb_array_elements(CASE WHEN jsonb_typeof(d.variants) = 'array' THEN d.variants ELSE '[]'::jsonb END) v
   WHERE NULLIF(btrim(COALESCE(v->>'id', '')), '') IS NULL;
  IF v_no_id > 0 THEN
    RAISE EXCEPTION '❌ % نسخةً بلا `id` — والقاعدةُ الجديدة تُلزم الإشارةَ إلى نسخةٍ موجودة، فستُرفض كلُّ حجوزِ ذلك العرض.', v_no_id;
  END IF;

  -- حجزٌ **قائمٌ** يخالف القاعدة: المشغّلُ `BEFORE INSERT` فلا يُعاد التحقّقُ
  -- عليه — لكن وجودَه يعني أنّ مساراً حيّاً يُنتج ما سنرفضه.
  SELECT count(*) INTO v_open_bad
    FROM public.bookings b JOIN public.deals d ON d.id = b.deal_id
   WHERE b.status IN ('pending', 'acknowledged')
     AND ( (COALESCE(jsonb_typeof(d.variants) = 'array'
                     AND jsonb_array_length(d.variants) > 0, false)
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(b.selected_options) = 'array' THEN b.selected_options ELSE '[]'::jsonb END) s
                   WHERE s->>'g' = '__variant__'))
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(d.options) = 'array' THEN d.options ELSE '[]'::jsonb END) g
                    WHERE COALESCE((g->>'required')::boolean, false)
                      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                               CASE WHEN jsonb_typeof(b.selected_options) = 'array' THEN b.selected_options ELSE '[]'::jsonb END) s
                             WHERE s->>'g' = g->>'id')) );
  IF v_open_bad > 0 THEN
    RAISE EXCEPTION '❌ % حجزاً قائماً يخالف القاعدة الجديدة — راجعه قبل التشديد (كان صفراً يومَ القياس).', v_open_bad;
  END IF;

  SELECT count(*) INTO v_unknown_ref
    FROM public.bookings b JOIN public.deals d ON d.id = b.deal_id
   WHERE b.status IN ('pending', 'acknowledged')
     AND EXISTS (
       SELECT 1 FROM jsonb_array_elements(
           CASE WHEN jsonb_typeof(b.selected_options) = 'array' THEN b.selected_options ELSE '[]'::jsonb END) s
        WHERE CASE WHEN s->>'g' = '__variant__'
                   THEN NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                            CASE WHEN jsonb_typeof(d.variants) = 'array' THEN d.variants ELSE '[]'::jsonb END) v
                          WHERE v->>'id' = s->>'c')
                   ELSE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
                            CASE WHEN jsonb_typeof(d.options) = 'array' THEN d.options ELSE '[]'::jsonb END) g,
                          jsonb_array_elements(CASE WHEN jsonb_typeof(g->'choices') = 'array'
                                                    THEN g->'choices' ELSE '[]'::jsonb END) c
                          WHERE g->>'id' = s->>'g' AND c->>'id' = s->>'c')
              END);
  IF v_unknown_ref > 0 THEN
    RAISE EXCEPTION '❌ % حجزاً قائماً يُشير إلى خيارٍ أو نسخةٍ غير موجودة (كان صفراً يومَ القياس).', v_unknown_ref;
  END IF;

  RAISE NOTICE '✅ ② الشروطُ المسبقة: صفرُ مجموعةٍ فارغة · صفرُ نسخةٍ بلا id · صفرُ حجزٍ قائمٍ مخالف · صفرُ إشارةٍ مجهولة';
END $pre$;


-- ════════════════════════════════════════════════════════════════════════
-- ③ القسم ١ — سقفُ الاسترداد: فاتورةُ الطلب نفسِه هي الحدّ
-- ════════════════════════════════════════════════════════════════════════

-- السقفُ من **ثلاثة مصادرَ تخصُّ هذا الطلبَ وحده** لا من رقمٍ مخترَع:
--   المدفوعُ فعلاً ⇐ إجماليُّ الطلب المجمّد ⇐ إجماليُّ الفاتورة الضريبيّة.
-- 🪤 و`LEAST` في PostgreSQL **تتجاهل NULL** (لا تُعيدها) — فطلبٌ بلا فاتورةٍ
--    مُصدَرةٍ يبقى سقفُه المدفوع/الإجمالي، ولا يصير السقفُ NULL فيُفتح البابُ.
CREATE OR REPLACE FUNCTION public.taki_refund_cap(p_barcode text)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT round(LEAST(
           COALESCE(NULLIF(b.paid_amount, 0), b.total_amount, 0),
           (SELECT oi.total FROM public.order_invoices oi
             WHERE oi.barcode = b.barcode AND oi.total > 0 LIMIT 1)
         ), 2)
    FROM public.bookings b
   WHERE b.barcode = upper(btrim(p_barcode));
$function$;

-- المتبقّي = السقفُ ناقصَ ما رُدَّ فعلاً.
-- 🪤 ويُقال صريحاً: `booking_refunds` مفتاحُها الأساسيُّ `barcode` (صفٌّ واحدٌ
--    لكلّ طلب) و`status='refunded'` تعود مبكّراً من الدالّة ⇒ **الجمعُ التراكميُّ
--    لا يمكن أن يُعدّ أكثرَ من صفٍّ اليوم، فهذا الطرحُ لا يَعضّ الآن**. كُتب
--    لأنّ أوّلَ استردادٍ جزئيٍّ يجعله الحارسَ الوحيد، ويُسمّى عجزُه هنا ولا
--    يُدَّعى أنه يعمل.
CREATE OR REPLACE FUNCTION public.taki_refund_remaining(p_barcode text)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT GREATEST(
           COALESCE(public.taki_refund_cap(p_barcode), 0)
           - COALESCE((SELECT sum(r.refund_amount) FROM public.booking_refunds r
                        WHERE r.barcode = upper(btrim(p_barcode))
                          AND r.status = 'refunded'), 0),
           0);
$function$;

REVOKE ALL ON FUNCTION public.taki_refund_cap(text)       FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_refund_cap(text)       FROM anon;
REVOKE ALL ON FUNCTION public.taki_refund_cap(text)       FROM authenticated;
REVOKE ALL ON FUNCTION public.taki_refund_remaining(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_refund_remaining(text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_refund_remaining(text) FROM authenticated;
-- 🪤 `postgres` **ليس superuser** على هذا الخادم (قِيس `rolsuper=false`)، وأربعٌ
--    من دوالّ القسم ⑦ مملوكةٌ له. فمنحٌ صريحٌ له لازمٌ لكلّ دالّةٍ جديدة، وإلّا
--    فشلت وقتَ التشغيل بخطأِ صلاحيةٍ لا يُمسكه أيُّ بناء.
GRANT EXECUTE ON FUNCTION public.taki_refund_cap(text)       TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.taki_refund_remaining(text) TO postgres, service_role;

COMMENT ON FUNCTION public.taki_refund_cap(text) IS
  'v15.80 — سقفُ استردادِ طلبٍ: أصغرُ (المدفوع/الإجمالي المجمّد، إجماليُّ فاتورته الضريبيّة).';

-- ── وتُعاد `resolve_booking_refund` بنفس البصمة ونفس نوعِ الإرجاع ──────────
-- 🪤 `CREATE OR REPLACE` هنا **صحيحة ولازمة**: البصمةُ لم تتغيّر ولا نوعُ
--    الإرجاع، فلا `DROP` (الذي كان سيُسقط منحَ `authenticated` ويُسكت الواجهة).
--    ولو أُضيف معاملٌ لكانت النتيجةُ حِملاً ثانياً و«function is not unique».
-- 🪤 والرمزُ الجديد `AMOUNT_ABOVE_INVOICE` يعود **بياناً في jsonb** لا استثناءً،
--    فقيدُ «لا يعبُر PostgREST إلا P0001» لا يمسّه أصلاً.
CREATE OR REPLACE FUNCTION public.resolve_booking_refund(
  p_barcode text, p_action text, p_note text DEFAULT NULL::text,
  p_amount numeric DEFAULT NULL::numeric, p_ref text DEFAULT NULL::text,
  p_method text DEFAULT NULL::text, p_restock boolean DEFAULT NULL::boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me        text := (SELECT auth.uid()::text);
  v_b         public.bookings%ROWTYPE;
  v_r         public.booking_refunds%ROWTYPE;
  v_admin     boolean;
  v_amt       numeric;
  v_cap       numeric;
  v_seq       integer;
  v_cn        text;
  v_shop      text;
  v_money     text;
  v_cancelled boolean := false;
  v_rows      integer;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  -- v15.80 ⑦ — صلاحيةٌ ماليّةٌ صريحة بدل `is_admin()`، التي تُرجع TRUE لأيّ
  --   أدمنٍ حين لا يوجد إطارُ `admin_*` على المكدّس (نصُّها الحيّ، درسُ v14.38).
  v_admin := public.taki_admin_finance();

  -- v14.21 — قفل صفّ الحجز. بدونه يسبق «استلمتُ طلبي» تأكيدَ الردّ فيقرأ هذا
  -- النداء حالةً قديمة، فيُصدر إشعاراً دائناً ويقول «أُلغي الطلب» ولا إلغاء وقع.
  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode)) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;
  IF v_me <> v_b.store_id AND NOT v_admin THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_MERCHANT');
  END IF;
  IF v_b.paid_at IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_PAID'); END IF;
  -- v14.97 — لا تسجيلَ يدويّ فوق ردٍّ فوريّ جارٍ أو تمّ.
  IF p_action <> 'decline' AND v_b.refund_state IN ('claiming', 'refunded') THEN
    RETURN jsonb_build_object('ok', false, 'error',
      CASE WHEN v_b.refund_state = 'claiming' THEN 'REFUND_IN_FLIGHT' ELSE 'ALREADY_REFUNDED' END);
  END IF;

  -- 🔴 v15.80 ① — السقفُ يُفحص **هنا**، قبل أيّ قراءةٍ لصفّ الاسترداد وقبل أيّ
  --    كتابة: فمبلغٌ أكبرُ من فاتورةِ الطلب باطلٌ بذاته، لا يصير صالحاً بوجود
  --    طلبِ استردادٍ ولا باطلاً بغيابه. وموضعُه هذا هو أيضاً ما يجعله **قابلاً
  --    للكسر** على أيّ طلبٍ مدفوع بلا إنشاء إشعارٍ دائنٍ ولا إحراقِ رقم.
  --    والسماحُ `0.011` منقولٌ من `supabase/functions/merchant-pay/index.ts:200`
  --    (`got < expected - 0.011`) لا مُخترَعاً — فالسماحان لا ينحرفان.
  IF p_action = 'refund' THEN
    v_cap := public.taki_refund_remaining(v_b.barcode);
    IF p_amount IS NOT NULL AND round(p_amount, 2) > v_cap + 0.011 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'AMOUNT_ABOVE_INVOICE',
                                'cap', v_cap, 'sent', round(p_amount, 2));
    END IF;
  END IF;

  SELECT COALESCE(NULLIF(u.shop,''), u.name) INTO v_shop FROM public.users u WHERE u.id = v_b.store_id;

  -- v14.21 — الحارس **قبل** كل فرع. كان بعد فرع `open`، فيُعاد فتح استرداد
  -- مُغلق ثم يُصدَر له إشعار دائن ثانٍ ويُهدر رقم من سلسلة التاجر.
  SELECT * INTO v_r FROM public.booking_refunds WHERE barcode = v_b.barcode FOR UPDATE;
  IF FOUND AND v_r.status = 'refunded' THEN
    RETURN jsonb_build_object('ok', true, 'already', true, 'status', 'refunded',
                              'credit_note_no', v_r.credit_note_no);
  END IF;

  -- ── التاجر يفتحها بنفسه: يُسجَّل الدَّين ثم يُثبته لاحقاً بمرجع ──────────
  IF p_action = 'open' THEN
    -- v15.80 ① — ومن نفس المصدر: لو كان إجماليُّ الفاتورة أقلَّ من المدفوع
    --   لسُجِّل دَينٌ لا يستطيع التاجرُ تثبيتَه بعدها (الحارسُ أدناه يرفضه)
    --   فيَعلق الطلبُ. والسقفُ هنا يمنع تلك العُقدة من المنشأ.
    --   (قِيس: في الطلباتِ المدفوعة السبعة كلِّها `paid = total = invoice`،
    --    فالسلوكُ اليومَ لا يتغيّر بحرف.)
    v_amt := COALESCE(public.taki_refund_cap(v_b.barcode), 0);
    INSERT INTO public.booking_refunds (barcode, store_id, buyer_id, status, opened_by, amount, merchant_note)
    VALUES (v_b.barcode, v_b.store_id, v_b.user_id, 'approved',
            CASE WHEN v_admin AND v_me <> v_b.store_id THEN 'admin' ELSE 'seller' END,
            v_amt, NULLIF(left(btrim(COALESCE(p_note,'')), 600), ''))
    ON CONFLICT (barcode) DO UPDATE
      SET status = 'approved', merchant_note = EXCLUDED.merchant_note,
          decided_at = now(), decided_by = v_me, updated_at = now();

    -- v14.21 — الصياغة تطابق الشاشة: الطلب **ما زال قائماً** حتى يؤكّد التاجر
    -- التحويل. كانت تقول «ألغى التاجر طلبك» بينما الرمز ما زال قابلاً للمسح.
    PERFORM public._refund_notify(v_b.user_id,
      '↩️ أقرّ التاجر إلغاء طلبك واستردادك', 'The merchant approved cancelling your order and refunding you',
      'أقرّ «' || COALESCE(v_shop,'المتجر') || '» إلغاء الطلب ' || v_b.barcode
        || COALESCE(' (' || NULLIF(btrim(COALESCE(p_note,'')), '') || ')', '')
        || '، والمبلغ ' || trim(to_char(v_amt,'FM999999990.09')) || ' ر.س مستحقّ لك منه. '
        || 'يبقى الطلب في «حجوزاتي» حتى يؤكّد التاجر التحويل، وعندها يُغلق ويصلك إشعار بالمرجع.',
      '"' || COALESCE(v_shop,'The store') || '" approved cancelling order ' || v_b.barcode
        || '. A refund of ' || trim(to_char(v_amt,'FM999999990.09')) || ' SAR is due to you from the merchant. '
        || 'The order stays in «My Bookings» until they confirm the transfer.',
      v_b.barcode, 'buyer', 'refund_approved');

    RETURN jsonb_build_object('ok', true, 'status', 'approved', 'amount', v_amt);
  END IF;

  IF NOT FOUND OR v_r.barcode IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_REQUEST'); END IF;

  -- ── رفض ──────────────────────────────────────────────────────────────────
  IF p_action = 'decline' THEN
    UPDATE public.booking_refunds
       SET status = 'declined', decided_at = now(), decided_by = v_me,
           merchant_note = NULLIF(left(btrim(COALESCE(p_note,'')), 600), ''), updated_at = now()
     WHERE barcode = v_b.barcode;

    PERFORM public._refund_notify(v_b.user_id,
      '↩️ ردّ التاجر على طلب الاسترداد', 'The merchant responded to your refund request',
      'اعتذر «' || COALESCE(v_shop,'المتجر') || '» عن الاسترداد للطلب ' || v_b.barcode || ' وفق سياسته المعلنة.'
        || COALESCE(' السبب: ' || NULLIF(btrim(COALESCE(p_note,'')), ''), '')
        || ' طلبك ما زال قائماً. وإن رأيت في ذلك مخالفة لسياسته المعلنة فارفع شكوى من «📣 الشكاوى» — تاكي تُيسّر التواصل ولا تبتّ في السياسات.',
      '"' || COALESCE(v_shop,'The store') || '" declined the refund for order ' || v_b.barcode || ' under its published policy. Your order still stands.',
      v_b.barcode, 'buyer', 'refund_declined');

    RETURN jsonb_build_object('ok', true, 'status', 'declined');
  END IF;

  -- ── تثبيت ردّ المال ──────────────────────────────────────────────────────
  IF p_action <> 'refund' THEN RETURN jsonb_build_object('ok', false, 'error', 'BAD_ACTION'); END IF;

  v_amt := round(COALESCE(p_amount, v_r.amount, 0), 2);
  IF NOT (v_amt > 0) THEN RETURN jsonb_build_object('ok', false, 'error', 'ZERO_AMOUNT'); END IF;

  -- 🔴 v15.80 ① — وحارسٌ ثانٍ على **القيمة المكتوبة** لا على المُرسَلة وحدها،
  --    وهو يفرّق بين مصدرَين عن عمد:
  --    • رقمٌ أرسله العميلُ ⇒ **يُرفض** صراحةً (وقد رُفض مبكّراً؛ وهذا تكرارُ
  --      حصانةٍ لا زينة: أيُّ فرعٍ جديدٍ يُدخل `p_amount` سيجده هنا).
  --    • رقمٌ كتبه الخادمُ في `booking_refunds.amount` ⇒ **يُقصّ** ولا يُرفض.
  --      ورفضُه كان يَعلق الطلبَ: التاجرُ لا يملك تغييرَ رقمٍ كتبه الخادم،
  --      فيبقى دَينٌ لا يُثبَّت أبداً. والقصُّ لا يُفرط على أحد.
  IF p_amount IS NOT NULL AND v_amt > COALESCE(v_cap, 0) + 0.011 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AMOUNT_ABOVE_INVOICE',
                              'cap', COALESCE(v_cap, 0), 'sent', v_amt);
  END IF;
  IF p_amount IS NULL AND v_amt > COALESCE(v_cap, 0) THEN
    v_amt := COALESCE(v_cap, 0);
    IF NOT (v_amt > 0) THEN RETURN jsonb_build_object('ok', false, 'error', 'ZERO_AMOUNT'); END IF;
  END IF;

  INSERT INTO public.store_invoice_counters (store_id, last_credit_seq)
  VALUES (v_b.store_id, 1)
  ON CONFLICT (store_id) DO UPDATE
    SET last_credit_seq = public.store_invoice_counters.last_credit_seq + 1, updated_at = now()
  RETURNING last_credit_seq INTO v_seq;
  v_cn := 'CN-' || lpad(v_seq::text, 6, '0');

  UPDATE public.booking_refunds
     SET status = 'refunded', decided_at = COALESCE(decided_at, now()), decided_by = v_me,
         merchant_note = COALESCE(NULLIF(left(btrim(COALESCE(p_note,'')), 600), ''), merchant_note),
         refunded_at = now(), refund_amount = v_amt,
         refund_ref = NULLIF(left(btrim(COALESCE(p_ref,'')), 120), ''),
         refund_method = NULLIF(left(btrim(COALESCE(p_method,'')), 40), ''),
         credit_note_no = v_cn, updated_at = now()
   WHERE barcode = v_b.barcode;

  -- الإلغاء وإعادة الكمّية لطلبٍ لم يُستلم بعد. والمكتملُ تعود بضاعته أيضاً
  -- منذ v15.06: يبقى مكتملاً (الفاتورة مجمّدة) وتعود الكمّية حدثاً مستقلّاً.
  IF v_b.status IN ('pending','acknowledged') THEN
    UPDATE public.bookings SET status = 'cancelled', cancelled_by = 'refund' WHERE barcode = v_b.barcode;
  -- v15.06 (طلب ناصر): والمكتملُ تعود بضاعته كذلك — ما لم يُطفئه التاجر.
  -- 🪤 ولا يُنقل إلى «ملغى»: guard_booking_status يُعيد الحالة صامتاً،
  --    والفاتورة الضريبية المجمّدة تتّكئ على نهائيّتها. الإرجاعُ حدثٌ مستقلّ.
  -- v15.09 — جوابُ التاجر في هذا القرار نفسه، ثمّ المقترَح من ملفّ متجره.
  ELSIF v_b.status = 'completed'
        AND COALESCE(p_restock, v_b.refund_restock, true) THEN
    PERFORM public.taki_restock_booking(v_b.barcode, NULL, 'refund');
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_cancelled := v_rows > 0;
  END IF;

  v_money := trim(to_char(v_amt, 'FM999999990.09'));

  PERFORM public._refund_notify(v_b.user_id,
    '✅ أكّد التاجر ردّ المبلغ', 'The merchant confirmed your refund',
    'أكّد «' || COALESCE(v_shop,'المتجر') || '» ردّ ' || v_money || ' ر.س عن الطلب ' || v_b.barcode
      || COALESCE(' — المرجع: ' || NULLIF(btrim(COALESCE(p_ref,'')), ''), '')
      || '. إشعار دائن رقم ' || v_cn || ' على فاتورتك. مدّة وصول المبلغ لحسابك تحدّدها جهة الدفع لا تاكي.',
    '"' || COALESCE(v_shop,'The store') || '" confirmed a refund of ' || v_money || ' SAR for order ' || v_b.barcode
      || COALESCE(' — reference: ' || NULLIF(btrim(COALESCE(p_ref,'')), ''), '')
      || '. Credit note ' || v_cn || ' is on your invoice.',
    v_b.barcode, 'buyer', 'refund_done');

  PERFORM public._refund_notify(v_b.store_id,
    '✅ سُجِّل ردّ المبلغ', 'Refund recorded',
    'سُجِّل ردّ ' || v_money || ' ر.س عن الطلب ' || v_b.barcode || ' بإشعار دائن ' || v_cn || '. '
      || CASE WHEN v_cancelled
              THEN 'وأُلغي الطلب وعادت الكمّية للبيع.'
              ELSE 'والطلب ' || CASE WHEN v_b.status = 'completed' THEN 'مكتملٌ' ELSE 'مُغلق' END
                   || ' وعادت كمّيته إلى مخزونك تلقائياً. تُطفئ ذلك من سياسات متجرك متى شئت.' END,
    'A refund of ' || v_money || ' SAR for order ' || v_b.barcode || ' was recorded as credit note ' || v_cn || '. '
      || CASE WHEN v_cancelled THEN 'The order was cancelled and the stock returned.'
              ELSE 'The order was already closed, so the stock did not return.' END,
    v_b.barcode, 'seller', 'refund_done');

  RETURN jsonb_build_object('ok', true, 'status', 'refunded', 'amount', v_amt,
                            'credit_note_no', v_cn, 'order_cancelled', v_cancelled);
END
$function$;


-- ════════════════════════════════════════════════════════════════════════
-- ④ القسم ٢ — خياراتُ الحجز: قاعدةٌ واحدةٌ لكلّ المصادر
-- ════════════════════════════════════════════════════════════════════════

-- 🔴 القاعدةُ تُخرَج من المشغّل إلى دالّةٍ خالصةٍ **لتكون قابلةً للقياس**: مشغّلٌ
--    لا يُختبَر إلا بإدراجٍ حقيقيّ، وفي `bookings` أحدَ عشرَ مشغّلَ `BEFORE
--    INSERT` أيُّها قد يرفض أوّلاً فيصير «الاختبارُ» شاهدَ زورٍ على سببٍ آخر
--    (درسُ v14.96: رصدتُ رفضاً فكان من سقف المواقع لا من الحارس). والدالّةُ
--    تُنادى مباشرةً فتُثبت السببَ بعينه.
-- تُرجع NULL = سالك · 'NEEDS_OPTIONS' · 'VARIANT_STOCK:<الاسم>:<المتبقّي>'
DROP FUNCTION IF EXISTS public.taki_booking_options_fault(text, jsonb);
CREATE FUNCTION public.taki_booking_options_fault(p_deal_id text, p_selected jsonb)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_opts jsonb; v_vars jsonb; v_grp jsonb; v_sel jsonb; v_var jsonb;
  v_arr  jsonb := CASE WHEN jsonb_typeof(COALESCE(p_selected, 'null'::jsonb)) = 'array'
                       THEN p_selected ELSE '[]'::jsonb END;
BEGIN
  SELECT CASE WHEN jsonb_typeof(d.options)  = 'array' THEN d.options  ELSE '[]'::jsonb END,
         CASE WHEN jsonb_typeof(d.variants) = 'array' THEN d.variants ELSE '[]'::jsonb END
    INTO v_opts, v_vars
    FROM public.deals d WHERE d.id = p_deal_id;
  -- عرضٌ غير موجود: لا قاعدةَ تُطبَّق هنا (المفتاحُ الأجنبيُّ على `deal_id` هو
  -- موضعُ ذلك)، وسلوكُ النصّ السابق نفسُه.
  IF v_opts IS NULL THEN RETURN NULL; END IF;

  -- (١) 🔴 كلُّ مدخلٍ يُشير إلى شيءٍ **موجودٍ فعلاً**. وبلا هذا الشرط يكون
  --     الشرطان (٢) و(٣) قابلَين للتجاوز بمعرّفٍ مخترَع: `taki_booking_amount`
  --     تتجاوز المجهول (`CONTINUE WHEN v_node IS NULL`) فتُسقط ثمنَه، ومدخلٌ
  --     بمعرّفِ نسخةٍ وهميّ يُرضي (٢) ثم يُسقط الأساسَ إلى سعرِ العرض.
  FOR v_sel IN SELECT * FROM jsonb_array_elements(v_arr) LOOP
    IF v_sel->>'g' = '__variant__' THEN
      IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_vars) e WHERE e->>'id' = v_sel->>'c') THEN
        RETURN 'NEEDS_OPTIONS';
      END IF;
    ELSE
      IF NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_opts) g,
             jsonb_array_elements(CASE WHEN jsonb_typeof(g->'choices') = 'array'
                                       THEN g->'choices' ELSE '[]'::jsonb END) c
         WHERE g->>'id' = v_sel->>'g' AND c->>'id' = v_sel->>'c')
      THEN
        RETURN 'NEEDS_OPTIONS';
      END IF;
    END IF;
  END LOOP;

  -- (٢) 🔴 عرضٌ له نسخ ⇒ لا بدّ من اختيار نسخة — **لكلّ المصادر**. كان هذا
  --     الشرطُ داخل `IF COALESCE(NEW.source,'web') <> 'web'`، فالويبُ معفى.
  IF jsonb_array_length(v_vars) > 0
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_arr) s WHERE s->>'g' = '__variant__')
  THEN
    RETURN 'NEEDS_OPTIONS';
  END IF;

  -- (٣) كلُّ مجموعةٍ إلزاميّةٍ مختارة — لكلّ المصادر كذلك
  FOR v_grp IN SELECT * FROM jsonb_array_elements(v_opts) LOOP
    IF COALESCE((v_grp->>'required')::boolean, false)
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_arr) s WHERE s->>'g' = v_grp->>'id')
    THEN
      RETURN 'NEEDS_OPTIONS';
    END IF;
  END LOOP;

  -- (٤) كمّيةُ النسخة المتبقّية تكفي المطلوب (كما كان، بلا تغييرٍ في النصّ)
  FOR v_sel IN SELECT * FROM jsonb_array_elements(v_arr) LOOP
    CONTINUE WHEN v_sel->>'g' IS DISTINCT FROM '__variant__';
    SELECT e INTO v_var FROM jsonb_array_elements(v_vars) e WHERE e->>'id' = v_sel->>'c' LIMIT 1;
    CONTINUE WHEN v_var IS NULL OR NOT (v_var ? 'qty') OR NULLIF(v_var->>'qty','') IS NULL;
    IF (v_var->>'qty')::numeric < GREATEST(COALESCE((v_sel->>'qty')::int,1),1) THEN
      RETURN 'VARIANT_STOCK:' || COALESCE(v_var->>'label','?') || ':'
             || GREATEST((v_var->>'qty')::int, 0)::text;
    END IF;
  END LOOP;

  RETURN NULL;
END
$function$;

REVOKE ALL ON FUNCTION public.taki_booking_options_fault(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_booking_options_fault(text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.taki_booking_options_fault(text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_booking_options_fault(text, jsonb) TO postgres, service_role;

COMMENT ON FUNCTION public.taki_booking_options_fault(text, jsonb) IS
  'v15.80 — قاعدةُ خياراتِ الحجز في نصٍّ واحد، يناديها المشغّلُ ويمكن قياسُها مباشرةً.';

-- والمشغّلُ صار ناقلاً: نفسُ الرسائل حرفياً، ونفسُ الوِصلة (`tr_booking_options`
-- لا تُعاد كتابتُها فالحيويةُ موروثةٌ لا مُدَّعاة).
-- 🪤 ويُحفظ نصُّ `NEEDS_OPTIONS` و`VARIANT_STOCK:%:%` **بايتاً ببايت**: الواجهةُ
--    تُترجمهما بالتعبير النمطيّ في `src/context/AppContext.tsx:2519-2529`،
--    و`msg` هناك هو `error.message` — فإضافةُ `HINT` لا تمسّه (قِيس).
CREATE OR REPLACE FUNCTION public.tr_validate_booking_options()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_fault text;
BEGIN
  v_fault := public.taki_booking_options_fault(NEW.deal_id, NEW.selected_options);
  IF v_fault IS NULL THEN RETURN NEW; END IF;
  IF v_fault = 'NEEDS_OPTIONS' THEN
    RAISE EXCEPTION 'NEEDS_OPTIONS' USING ERRCODE = 'P0001', HINT = 'NEEDS_OPTIONS';
  END IF;
  -- `VARIANT_STOCK:<الاسم>:<المتبقّي>` — عقدٌ نصّيٌّ تقرؤه الواجهةُ والبوتان
  RAISE EXCEPTION '%', v_fault USING ERRCODE = 'P0001', HINT = 'VARIANT_STOCK';
END
$function$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑤ القسم ٣ — عنوانُ الخطّاف: شكلٌ مُثبِتٌ لا قائمةُ منع
-- ════════════════════════════════════════════════════════════════════════

-- 🔴 قائمةُ المنع تفشل **مفتوحةً**: كلُّ صيغةٍ لم تُذكر تمرّ. فالشرطُ موجبٌ
--    ببنيته: مضيفُ DNS مُنقَّطٌ، كلُّ مقطعٍ يبدأ وينتهي بحرفٍ أو رقم، واللاحقةُ
--    **حروفٌ خالصة** — وهذا وحده يرفض كلَّ عنوانٍ رقميٍّ في كلّ ترميز:
--    العشريُّ `2130706433` (بلا نقطة) · الثُمانيُّ `0177.0.0.1` (ينتهي برقم) ·
--    `[::1]` و`[::ffff:10.0.0.1]` (قوسان) · و`127.0.0.1` و`10.0.0.5`.
--    ويرفض معه: معلوماتَ المستخدم (`user@`) والترميزَ المئويّ والفراغاتِ
--    والشُّرطةَ المقلوبة، ومنفذاً غيرَ ٤٤٣ (فحصُ منافذ عرّافٌ كاملٌ بذاته).
-- 🪤 وما لا تستطيعه القاعدةُ ولا يُدَّعى: مضيفٌ شرعيُّ الشكلِ يُحلّ إلى
--    `127.0.0.1` (DNS rebinding). موضعُ ذلك الحلُّ قبل `fetch` في البوت —
--    مذكورٌ في التقرير، وليس من هذا الملفّ.
DROP FUNCTION IF EXISTS public._taki_hook_url_ok(text);
CREATE FUNCTION public._taki_hook_url_ok(p_url text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_auth text; v_host text; v_port text; v_tld text;
BEGIN
  IF p_url IS NULL THEN RETURN false; END IF;
  -- لا تهذيبَ ولا توحيدَ حالة: ما لا يبدأ حرفياً بـ`https://` مرفوضٌ كما كان،
  -- فلا تُوسَّع المدخلاتُ المقبولةُ بحجّة التحسين.
  IF left(p_url, 8) <> 'https://' THEN RETURN false; END IF;
  IF length(p_url) < 12 OR length(p_url) > 500 THEN RETURN false; END IF;
  IF p_url ~ '[[:space:][:cntrl:]]' THEN RETURN false; END IF;

  v_auth := lower(split_part(split_part(split_part(substr(p_url, 9), '/', 1), '?', 1), '#', 1));
  IF v_auth !~ '^[a-z0-9.-]+(:[0-9]{1,5})?$' THEN RETURN false; END IF;

  v_host := split_part(v_auth, ':', 1);
  v_port := CASE WHEN v_auth ~ ':' THEN split_part(v_auth, ':', 2) ELSE '' END;
  IF v_port NOT IN ('', '443') THEN RETURN false; END IF;

  IF v_host !~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$' THEN RETURN false; END IF;

  v_tld := split_part(v_host, '.', (length(v_host) - length(replace(v_host, '.', '')))::int + 1);
  -- 🪤 سببٌ ثانٍ **مستقلّ** لا تجميل: لاحقاتُ الاستخدام الخاصّ (RFC 6761/6762
  --    و`.internal` و`.corp`) تمرّ من شرط الحروف الخالصة وتُشير إلى شبكةٍ
  --    داخليّة. وتُسمّى هنا صريحةً ولا تُترك للشكل.
  IF v_tld IN ('local','localhost','internal','intranet','corp','home','lan',
               'test','example','invalid','onion','i2p','alt') THEN
    RETURN false;
  END IF;

  RETURN true;
END
$function$;

REVOKE ALL ON FUNCTION public._taki_hook_url_ok(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._taki_hook_url_ok(text) FROM anon;
REVOKE ALL ON FUNCTION public._taki_hook_url_ok(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._taki_hook_url_ok(text) TO postgres, service_role;

COMMENT ON FUNCTION public._taki_hook_url_ok(text) IS
  'v15.80 — شكلُ عنوانِ خطّافٍ مقبول: مضيفُ DNS بلاحقةٍ حرفيّة، منفذٌ ٤٤٣ أو لا منفذ، بلا عنوانٍ رقميٍّ بأيّ ترميز.';

-- ── الكاتبان: نفسُ شكلِ الخطأ، ورمزُ `HTTPS_REQUIRED` يبقى لمعناه ───────────
CREATE OR REPLACE FUNCTION public.merchant_create_integration(
  p_provider text, p_segment text DEFAULT NULL::text,
  p_label text DEFAULT NULL::text, p_webhook_url text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_key text; v_sec text; v_id uuid;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  -- v15.20 seller — كان مفتوحاً لأيّ مستخدمٍ موثَّق بما فيهم المشترون.
  --   و`<> 'buyer'` لا `= 'seller'`: متجرُ تاكي مملوكٌ لحساب أدمن.
  IF NOT EXISTS (SELECT 1 FROM public.users u
                  WHERE u.id = v_me AND COALESCE(u.user_type,'buyer') <> 'buyer'
                    AND u.deleted_at IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'SELLERS_ONLY');
  END IF;
  IF EXISTS (SELECT 1 FROM public.stock_integrations s WHERE s.store_id = v_me) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ALREADY_LINKED',
      'hint', 'delete or rotate the existing link instead of creating a second one');
  END IF;
  IF p_webhook_url IS NOT NULL AND p_webhook_url !~ '^https://' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'HTTPS_REQUIRED');
  END IF;
  -- v15.80 ③ — وشكلُ المضيف فوق ذلك: `https` وحده يسمح بـ`https://127.0.0.1/`
  IF p_webhook_url IS NOT NULL AND NOT public._taki_hook_url_ok(p_webhook_url) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WEBHOOK_URL_REJECTED',
      'hint', 'use a public DNS host over https on port 443 — no IP address, no port, no credentials in the URL');
  END IF;
  -- 🪤 يُولَّد على الخادم: مفتاحٌ يمرّ عبر متصفّحٍ أو محادثةٍ صار معروفاً.
  v_key := 'taki_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_sec := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.stock_integrations
    -- v15.23 readonly — الاتجاهُ يُحسم عند الإنشاء: مزوّدٌ نقرأ منه يُنشأ
  --   بـ`in` فقط (قرارُ المالك)، وغيرُه يبقى `both` كما كان.
  (store_id, provider, segment, label, api_key_hash, api_key_last4, webhook_url, webhook_secret, webhook_slug, direction)
  VALUES (v_me, COALESCE(NULLIF(btrim(p_provider),''),'custom'), NULLIF(btrim(p_segment),''),
          NULLIF(btrim(p_label),''),
          encode(extensions.digest(v_key,'sha256'),'hex'), right(v_key, 4),
          NULLIF(btrim(p_webhook_url),''), v_sec,
          encode(extensions.gen_random_bytes(18), 'hex'),
          CASE WHEN public._taki_provider_read(COALESCE(NULLIF(btrim(p_provider),''),'custom')) IS NOT NULL
               THEN 'in' ELSE 'both' END)
  RETURNING id INTO v_id;
  -- 🔴 المفتاحُ يُعاد **مرّةً واحدة فقط** ولا يمكن استرجاعُه بعدها.
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'api_key', v_key,
    'webhook_secret', v_sec, 'shown_once', true,
    'endpoint', 'https://api.takisa.net/rest/v1/rpc/taki_stock_push',
    'hook_url', 'https://api.takisa.net/functions/v1/stock-webhook/h/'
               || (SELECT webhook_slug FROM public.stock_integrations WHERE id = v_id));
END
$function$;

CREATE OR REPLACE FUNCTION public.merchant_update_integration(
  p_id uuid, p_enabled boolean DEFAULT NULL::boolean,
  p_webhook_url text DEFAULT NULL::text, p_label text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_owner text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT store_id INTO v_owner FROM public.stock_integrations WHERE id = p_id;
  IF v_owner IS NULL OR v_owner <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  -- 🪤 خطّافٌ بلا https يُرسل أحداثَ مخزونٍ موقَّعةً على قناةٍ مكشوفة.
  IF p_webhook_url IS NOT NULL AND btrim(p_webhook_url) <> '' AND p_webhook_url !~ '^https://' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'HTTPS_REQUIRED');
  END IF;
  -- v15.80 ③ — ونفسُ الحارس في الكاتب الثاني. ونصٌّ واحدٌ يُستدعى من الموضعين
  --   لا نسختان تنحرفان (درسُ «مفرداتُ الأخطاء في مكانٍ واحد»، v14.96).
  IF p_webhook_url IS NOT NULL AND btrim(p_webhook_url) <> ''
     AND NOT public._taki_hook_url_ok(btrim(p_webhook_url)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'WEBHOOK_URL_REJECTED',
      'hint', 'use a public DNS host over https on port 443 — no IP address, no port, no credentials in the URL');
  END IF;
  UPDATE public.stock_integrations
     SET is_enabled  = COALESCE(p_enabled, is_enabled),
         webhook_url = CASE WHEN p_webhook_url IS NULL THEN webhook_url
                            ELSE NULLIF(btrim(p_webhook_url), '') END,
         label       = CASE WHEN p_label IS NULL THEN label ELSE NULLIF(btrim(p_label), '') END
   WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END
$function$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑥ القسم ٤ — تفويضُ سلّة: لا هويّةَ متجرٍ تُخمَّن
-- ════════════════════════════════════════════════════════════════════════

-- فرعُ «النافذةُ الوحيدة» يُحذف **كلّه**. ومن لا يُعرَف توكنُه يُحفظ جانباً،
-- والتاجرُ يُطالب به — ومطالبتُه تُشترط بنافذةٍ كانت مفتوحةً **له وحده** لحظةَ
-- وصولِ التوكن.
CREATE OR REPLACE FUNCTION public.taki_stock_oauth_bind_salla(p_remote_id text, p_tok jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_id uuid; v_n int; v_park bigint; v_name text;
BEGIN
  IF p_tok IS NULL OR COALESCE(btrim(p_tok->>'access_token'),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_ACCESS_TOKEN');
  END IF;

  -- (أ) المطابقةُ الوحيدةُ المقبولة: متجرٌ ربط قبلاً بنفس الرقم (إعادةُ تفويضٍ
  --     أو تجديد). وهي **إثباتٌ** لأنّ الرقمَ كُتب في ربطٍ سابقٍ تمّ فعلاً.
  SELECT id INTO v_id FROM public.stock_integrations
   WHERE lower(provider) = 'salla'
     AND COALESCE(oauth_remote_id,'') = COALESCE(btrim(p_remote_id),'~')
   LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN public.taki_stock_oauth_store(v_id, p_tok, p_remote_id)
           || jsonb_build_object('matched_by', 'remote_id');
  END IF;

  -- 🔴 v15.80 ④ — وحُذف فرعُ «نافذةٌ مفتوحةٌ واحدة». كان يَربط توكناً مجهولَ
  --    النسبة بمن له نافذة، فيُبقي مهاجمٌ نافذتَه مفتوحةً ويحصد تثبيتَ الضحيّة.
  --    و«واحدةٌ فقط» ليست إثباتاً: المهاجمُ يملك أن يكون الوحيد.
  --    (ويبقى العددُ محسوباً لأنه يُقال للمُطالب في `open_claims`.)
  SELECT count(*) INTO v_n FROM public.stock_integrations
   WHERE lower(provider) = 'salla' AND connect_nonce IS NOT NULL
     AND oauth_attempt_at > now() - interval '30 minutes';

  -- (ب) تُحفظ جانباً. وتخمينُ متجرٍ يعني تسليمَ توكنِ تاجرٍ لتاجرٍ آخر — وهو
  --     أسوأُ ما يمكن أن يحدث في هذا الملفّ كلِّه.
  v_name := 'stock_park:' || encode(extensions.gen_random_bytes(12), 'hex');
  PERFORM vault.create_secret(p_tok::text, v_name, 'TAKI parked stock OAuth token (v15.18)');
  INSERT INTO public.stock_oauth_parked (provider, remote_id, secret_name)
  VALUES ('salla', NULLIF(btrim(COALESCE(p_remote_id,'')),''), v_name)
  RETURNING id INTO v_park;
  RETURN jsonb_build_object('ok', false, 'error', 'PARKED_AWAITING_CLAIM',
    'parked', v_park, 'open_claims', COALESCE(v_n, 0));
END
$function$;

-- والمطالبةُ تُشترط بنافذةِ المُطالب، **وأن تكون النافذةَ الوحيدةَ** المفتوحةَ
-- لحظةَ وصولِ التوكن. وهذا أقوى ممّا كان (رقمٌ يُدّعى وحده) — ويُقال بصراحة
-- إنه **ليس** إثباتاً لأوّل تملّك: من يُثبّت من متجر سلّة بلا أن يضغط «اربط»
-- في تاكي يبقى المهاجمُ هو الحاوي الوحيد. والعلاجُ الكامل تسجيلُ التطبيق في
-- وضع OAuth القياسيّ ليعود `state` كما في مسار زد — والبندُ موقوفٌ على
-- التسجيل أصلاً، فتبنّيه الآن بلا كلفة.
CREATE OR REPLACE FUNCTION public.merchant_stock_claim_parked(p_id uuid, p_remote_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, '');
        v_owner text; v_prov text; v_p record; v_tok jsonb; r jsonb;
        v_n int; v_mine boolean;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT store_id, lower(provider) INTO v_owner, v_prov
    FROM public.stock_integrations WHERE id = p_id;
  IF v_owner IS NULL OR v_owner <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  IF COALESCE(btrim(p_remote_id), '') = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'REMOTE_ID_REQUIRED');
  END IF;
  SELECT * INTO v_p FROM public.stock_oauth_parked
   WHERE provider = v_prov AND claimed_by IS NULL
     AND remote_id = btrim(p_remote_id)
   ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND'); END IF;

  -- 🔴 v15.80 ④ — الرقمُ وحده ادّعاء. فيُشترط معه أنّ نافذةً كانت مفتوحةً
  --    لحظةَ وصولِ التوكن، وأنّها **نافذةُ المُطالب**، وأنّها **الوحيدة**.
  SELECT count(*), COALESCE(bool_or(si.id = p_id), false)
    INTO v_n, v_mine
    FROM public.stock_integrations si
   WHERE lower(si.provider) = v_prov
     AND si.connect_nonce IS NOT NULL
     AND si.oauth_attempt_at IS NOT NULL
     AND si.oauth_attempt_at <= v_p.created_at
     AND si.oauth_attempt_at >  v_p.created_at - interval '30 minutes';
  IF v_n = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_WINDOW',
      'hint', 'press Connect in TAKI first, then install from your store — the token must arrive while your window is open');
  END IF;
  IF NOT v_mine THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOUR_WINDOW');
  END IF;
  IF v_n > 1 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'AMBIGUOUS_WINDOW', 'open_claims', v_n,
      'hint', 'another store had a connect window open at the same moment — retry, or ask TAKI support to bind it');
  END IF;

  SELECT decrypted_secret::jsonb INTO v_tok FROM vault.decrypted_secrets WHERE name = v_p.secret_name;
  IF v_tok IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'SECRET_GONE'); END IF;

  r := public.taki_stock_oauth_store(p_id, v_tok, btrim(p_remote_id));
  IF NOT COALESCE((r->>'ok')::boolean, false) THEN RETURN r; END IF;

  UPDATE public.stock_oauth_parked SET claimed_by = p_id, claimed_at = now() WHERE id = v_p.id;
  DELETE FROM vault.secrets WHERE name = v_p.secret_name;
  RETURN jsonb_build_object('ok', true, 'expires_at', r->>'expires_at');
END
$function$;

-- والعدَّادُ كان عرّافاً عامّاً: أيُّ تاجرٍ يقرأ عددَ التوكنات المحفوظة جانباً
-- في المنصّة كلِّها فيعرف **متى** يهجم. صار يَعدّ ما يستطيع هو مطالبتَه وحده.
CREATE OR REPLACE FUNCTION public.merchant_stock_parked_count(p_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, ''); v_owner text; v_prov text;
BEGIN
  IF v_me IS NULL THEN RETURN 0; END IF;
  SELECT store_id, lower(provider) INTO v_owner, v_prov
    FROM public.stock_integrations WHERE id = p_id;
  IF v_owner IS NULL OR v_owner <> v_me THEN RETURN 0; END IF;
  RETURN (SELECT count(*) FROM public.stock_oauth_parked p
           WHERE p.provider = v_prov AND p.claimed_by IS NULL
             AND p.created_at > now() - interval '7 days'
             AND EXISTS (SELECT 1 FROM public.stock_integrations si
                          WHERE si.id = p_id
                            AND si.connect_nonce IS NOT NULL
                            AND si.oauth_attempt_at IS NOT NULL
                            AND si.oauth_attempt_at <= p.created_at
                            AND si.oauth_attempt_at >  p.created_at - interval '30 minutes'));
END
$function$;

-- ونافذةٌ مفتوحةٌ لا تُجدَّد بكلّ نقرة: تجديدُها يجعل «أبقِ النافذةَ مفتوحة»
-- مجّانيّاً إلى الأبد. والمحاولاتُ محدودةٌ بخمسٍ في الساعة.
CREATE OR REPLACE FUNCTION public.merchant_stock_connect_url(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_me text := NULLIF((SELECT auth.uid())::text, '');
        v_i public.stock_integrations%ROWTYPE; v_app jsonb; v_nonce text;
BEGIN
  IF v_me IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTH_REQUIRED'); END IF;
  SELECT * INTO v_i FROM public.stock_integrations WHERE id = p_id;
  IF v_i.store_id IS NULL OR v_i.store_id <> v_me THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_YOURS');
  END IF;
  v_app := public._taki_stock_app(v_i.provider);
  -- 🔴 يُقال صريحاً ولا يُعرض زرٌّ لا يعمل: تطبيقُ تاكي غيرُ مسجَّلٍ بعد.
  IF v_app IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'APP_NOT_REGISTERED',
      'provider', v_i.provider);
  END IF;

  -- v15.80 ④ — نافذةٌ قائمةٌ تُعاد كما هي، ولا يُفتح غيرُها إلا بحصّة.
  IF v_i.connect_nonce IS NOT NULL
     AND v_i.oauth_attempt_at IS NOT NULL
     AND v_i.oauth_attempt_at > now() - interval '30 minutes' THEN
    v_nonce := v_i.connect_nonce;
  ELSE
    -- 🪤 ويُردّ شكلاً ثابتاً: `taki_rate_check` ترفع استثناءً، وهذه الدالّةُ
    --    عقدُها jsonb. فيُلفّ النداءُ ولا يُغيَّر شكلُ الردّ على الواجهة.
    BEGIN
      PERFORM public.taki_rate_check('stockconnect:' || p_id::text, 5, 3600,
                                     'too many connect attempts — wait and retry');
    EXCEPTION WHEN OTHERS THEN
      RETURN jsonb_build_object('ok', false, 'error', 'RATE_LIMITED');
    END;
    v_nonce := encode(extensions.gen_random_bytes(16), 'hex');
    UPDATE public.stock_integrations
       SET connect_nonce = v_nonce, oauth_attempt_at = now(),
           last_note = 'CONNECT_STARTED'
     WHERE id = p_id;
  END IF;

  IF lower(v_i.provider) = 'zid' THEN
    -- مقيسٌ من https://docs.zid.sa/authorization.md — و`state` تُعاد كما هي
    IF COALESCE(v_app->>'client_id','') = '' OR COALESCE(v_app->>'redirect_uri','') = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'APP_INCOMPLETE');
    END IF;
    RETURN jsonb_build_object('ok', true, 'mode', 'redirect',
      'url', 'https://oauth.zid.sa/oauth/authorize'
          || '?client_id='    || public._taki_urlenc(v_app->>'client_id')
          || '&redirect_uri=' || public._taki_urlenc(v_app->>'redirect_uri')
          || '&response_type=code'
          || '&state='        || public._taki_urlenc(p_id::text || ':' || v_nonce),
      'window_minutes', 30);
  END IF;

  IF lower(v_i.provider) = 'salla' THEN
    -- 🪤 ولا `state` هنا: «الوضعُ السهل» يبدأ برابط تثبيت، والتوكن يصل إلى
    --    عنوان التطبيق العامّ بـ`merchant` وحده. فالنسبةُ بنافذةِ ٣٠ دقيقة،
    --    وإن التبست **لا تُخمَّن** (القسم ٥).
    IF COALESCE(v_app->>'app_id','') = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'APP_INCOMPLETE');
    END IF;
    RETURN jsonb_build_object('ok', true, 'mode', 'install',
      'url', 'https://s.salla.sa/apps/install/' || public._taki_urlenc(v_app->>'app_id'),
      'window_minutes', 30);
  END IF;

  RETURN jsonb_build_object('ok', false, 'error', 'PROVIDER_HAS_NO_OAUTH');
END
$function$;

-- ومخرجٌ مُسجَّلٌ بيد الإدارة: كلُّ حالةٍ تُنتجها المنصّةُ يجب أن يكون لناصر
-- منها مخرجٌ بضغطة (قاعدةُ v14.97). وبحجّةٍ إلزاميّةٍ تُكتب في `activity_log`.
DROP FUNCTION IF EXISTS public.admin_stock_bind_parked(bigint, uuid, text);
CREATE FUNCTION public.admin_stock_bind_parked(p_parked bigint, p_integration uuid, p_note text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_uid text := (SELECT auth.uid())::text;
        v_p record; v_tok jsonb; v_note text; r jsonb; v_store text;
BEGIN
  IF NOT public.taki_admin_perm('tab_sellers') THEN
    RAISE EXCEPTION 'forbidden: tab_sellers required';
  END IF;
  v_note := btrim(COALESCE(p_note, ''));
  -- 🪤 الحجّةُ إلزاميّةٌ لا تجميل: هذا القرارُ يُسلّم توكنَ متجرٍ إلى حسابٍ
  --    بعينه بناءً على ما رآه إنسانٌ خارج النظام. وبعد شهرٍ لن يتذكّر أحدٌ لماذا.
  IF length(v_note) < 10 THEN RAISE EXCEPTION 'NOTE_REQUIRED'; END IF;

  SELECT * INTO v_p FROM public.stock_oauth_parked WHERE id = p_parked FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF v_p.claimed_by IS NOT NULL THEN RAISE EXCEPTION 'ALREADY_CLAIMED'; END IF;

  SELECT store_id INTO v_store FROM public.stock_integrations
   WHERE id = p_integration AND lower(provider) = v_p.provider;
  IF v_store IS NULL THEN RAISE EXCEPTION 'NO_INTEGRATION'; END IF;

  SELECT decrypted_secret::jsonb INTO v_tok FROM vault.decrypted_secrets WHERE name = v_p.secret_name;
  IF v_tok IS NULL THEN RAISE EXCEPTION 'SECRET_GONE'; END IF;

  r := public.taki_stock_oauth_store(p_integration, v_tok, v_p.remote_id);
  IF NOT COALESCE((r->>'ok')::boolean, false) THEN
    RAISE EXCEPTION 'STORE_FAILED: %', COALESCE(r->>'error', '?');
  END IF;

  UPDATE public.stock_oauth_parked SET claimed_by = p_integration, claimed_at = now() WHERE id = v_p.id;
  DELETE FROM vault.secrets WHERE name = v_p.secret_name;

  INSERT INTO public.activity_log (user_id, user_type, action, entity_type, entity_id, metadata)
  VALUES (v_uid, 'admin', 'stock_parked_bound', 'stock_integration', p_integration::text,
          jsonb_build_object('parked', p_parked, 'provider', v_p.provider,
                             'remote_id', v_p.remote_id, 'store_id', v_store, 'note', v_note));

  RETURN jsonb_build_object('ok', true, 'expires_at', r->>'expires_at');
END
$function$;

REVOKE ALL ON FUNCTION public.admin_stock_bind_parked(bigint, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_stock_bind_parked(bigint, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_stock_bind_parked(bigint, uuid, text) TO authenticated, service_role, postgres;

-- 🔴 و`stock_oauth_parked` **بلا منظّفٍ إطلاقاً** (قِيس): صفٌّ لم يُطالَب به
--    يُبقي توكنَ OAuth حيّاً في الخزنة إلى الأبد. والنافذةُ ثلاثون يوماً
--    مشتقّةٌ من عمرِ رمزِ تحديث سلّة (شهرٌ واحد، CLAUDE.md v15.22) — فبعدها
--    التوكنُ ميتٌ أصلاً، ولا رقمَ مخترَع.
DROP FUNCTION IF EXISTS public.taki_prune_stock_parked();
CREATE FUNCTION public.taki_prune_stock_parked()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_n int := 0; v_row record;
BEGIN
  FOR v_row IN
    SELECT id, secret_name FROM public.stock_oauth_parked
     WHERE created_at < now() - interval '30 days'
  LOOP
    -- السرُّ أوّلاً: صفٌّ يُحذف وسرُّه باقٍ يُخلّف توكناً بلا أيّ أثرٍ يقود إليه.
    DELETE FROM vault.secrets WHERE name = v_row.secret_name;
    DELETE FROM public.stock_oauth_parked WHERE id = v_row.id;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END
$function$;

REVOKE ALL ON FUNCTION public.taki_prune_stock_parked() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_prune_stock_parked() FROM anon;
REVOKE ALL ON FUNCTION public.taki_prune_stock_parked() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_prune_stock_parked() TO postgres, service_role;

SELECT cron.unschedule('taki-stock-parked-prune')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-stock-parked-prune');
SELECT cron.schedule('taki-stock-parked-prune', '5 2 * * *',
                     $$SELECT public.taki_prune_stock_parked();$$);


-- ════════════════════════════════════════════════════════════════════════
-- ⑦ القسم ٥ — زمنُ الرصد يأتي من الرسالة لا من `now()`
-- ════════════════════════════════════════════════════════════════════════

-- 🪤 إضافةُ معاملٍ **تُنشئ حِملاً ثانياً** لا تستبدل، فينفجر كلُّ منادٍ بـ
--    «function is not unique». فـ`DROP` أوّلاً (بلا `CASCADE`)، والمنادي
--    الوحيدُ `supabase/functions/stock-webhook/index.ts:144` ينادي **بأسماء
--    المعاملات** عبر PostgREST ومعاملُ الزمن اختياريّ ⇒ الحالةُ الراهنةُ
--    (بلا تمرير) تساوي سلوكَ اليوم بالحرف. فتُشحن القاعدةُ قبل الحافة بأمان.
-- 🪤 ولا فسحةَ مستقبليّةً أبداً: `taki_set_on_hand` تقصّ بـ
--    `LEAST(COALESCE(p_observed_at, now()), now())` — وهذا هو **العلاجُ**
--    لا العيب (v15.22): ساعةٌ مزحزحةٌ للأمام ثلاثَ ساعات لو مرّت لجمّدت كلَّ
--    كتابةٍ بعدها ثلاثَ ساعات، ومنها تعديلُ التاجر من الموقع.
DROP FUNCTION IF EXISTS public.taki_stock_webhook(text, jsonb, text);
CREATE FUNCTION public.taki_stock_webhook(
  p_key text, p_body jsonb, p_event_id text DEFAULT NULL::text,
  p_observed_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_i      public.stock_integrations%ROWTYPE;
  v_hash   text;
  v_map    jsonb;
  v_id     text; v_qty text;
  v_cand   text[][];
  v_pair   text[];
  v_ev     text;
  v_res    jsonb;
  v_obs    timestamptz := COALESCE(p_observed_at, now());
BEGIN
  IF p_key IS NULL OR length(btrim(p_key)) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_KEY');
  END IF;
  v_hash := encode(extensions.digest(btrim(p_key), 'sha256'), 'hex');

  SELECT * INTO v_i FROM public.stock_integrations
   -- v15.17 signal — العنوانُ صار مساراً لكلّ متجر (`/h/<slug>`) لأن
   --   دائرةَ زد القاطعة ترفض إعادةَ استخدام رابطٍ عُطّل («You cannot
   --   recover a webhook by re-using the same target_url»). فيُفصل
   --   العنوانُ عن السرّ: المسارُ يُعاد إصدارُه والمفتاحُ يبقى.
   WHERE (api_key_hash = v_hash OR webhook_slug = btrim(p_key))
     AND is_enabled AND direction IN ('in','both');
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'UNKNOWN_KEY'); END IF;

  -- v15.20 throttle2 — **بعد** التعرّف: مفتاحٌ مجهولٌ لا يمسّ العدّاد،
  --   والمخنوقُ يُوسَم مرّةً لكلّ دفقة. ويُردّ خنقاً لا خطأً: ٥٠٢ تُحسب
  --   فشلاً عند زد (٣٠ في ساعةٍ ⇒ تعطيلُ الخطّاف وإلغاءُ أحداثه)،
  --   و٤٢٩ **لا تُحسب فشلاً** بنصّ وثيقتهم.
  BEGIN
    PERFORM public.taki_rate_check('stockhook:' || left(v_hash, 16), 300, 60,
                                   'too many webhooks — slow down');
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.stock_integrations SET last_note = 'THROTTLED'
     WHERE id = v_i.id AND COALESCE(last_note, '') <> 'THROTTLED';
    RETURN jsonb_build_object('ok', true, 'throttled', true, 'retry_after', 60);
  END;

  -- 🔴 تُحفظ الرسالةُ **دائماً** قبل أيّ محاولة فهم: هي الدليلُ الوحيد على
  --    شكلها الحقيقي، وبدونها لا يستطيع أحدٌ ربطَ الحقول إلا بالتخمين.
  UPDATE public.stock_integrations
     SET last_payload = p_body, last_payload_at = now(), last_seen_at = now()
   WHERE id = v_i.id;

  -- v15.17 signal — تُدرَج إشارةٌ ويُعاد القراءةُ لاحقاً. ولا يُنادى
  --   المزوّدُ من هنا إطلاقاً: وثيقةُ زد تحسب الردَّ البطيء فشلاً
  --   (٣٠ فشلاً في ساعةٍ ⇒ `broken` وتُلغى الأحداثُ المعلّقة).
  IF public._taki_provider_read(v_i.provider) IS NOT NULL THEN
    PERFORM public._taki_stock_enqueue(v_i.id, NULL, 'signal',
              public._taki_jpath(p_body, 'event'), 10);
  END IF;

  IF p_body IS NULL OR jsonb_typeof(p_body) <> 'object' THEN
    UPDATE public.stock_integrations SET last_note = 'BODY_NOT_OBJECT' WHERE id = v_i.id;
    RETURN jsonb_build_object('ok', true, 'stored', true, 'unmapped', true, 'reason', 'BODY_NOT_OBJECT');
  END IF;

  -- خريطةُ التاجر أوّلاً؛ وإلّا تُجرَّب مرشّحاتٌ شائعة على الرسالة نفسها.
  -- v15.16 merge — دمجٌ لا إحلال: ما يكتبه التاجر يعلو في id/qty،
  --   و`skip_when` من خريطة المزوّد يبقى لأنّ لا كاتبَ له.
  v_map := COALESCE(public._taki_provider_map(v_i.provider), '{}'::jsonb)
           || COALESCE(v_i.field_map, '{}'::jsonb);
  IF v_map = '{}'::jsonb THEN v_map := NULL; END IF;
  IF v_map IS NOT NULL THEN
    v_id  := public._taki_jpath(p_body, v_map->>'id');
    v_qty := public._taki_jpath(p_body, v_map->>'qty');
  END IF;

  IF v_id IS NULL OR v_qty IS NULL THEN
    -- 🪤 مرشّحاتٌ لا حقائق: كلُّ زوجٍ يُجرَّب على الرسالة الحقيقية، وما ينجح
    --    يُحفظ خريطةً. ولا يُدَّعى أن نظاماً بعينه يستعمل شكلاً بعينه.
    v_cand := ARRAY[
      ARRAY['data.id',            'data.quantity'],
      ARRAY['data.id',            'data.stock_quantity'],
      ARRAY['data.id',            'data.available_quantity'],
      ARRAY['data.product.id',    'data.product.quantity'],
      ARRAY['data.sku',           'data.quantity'],
      ARRAY['id',                 'quantity'],
      ARRAY['id',                 'stock_quantity'],
      ARRAY['sku',                'quantity'],
      ARRAY['product.id',         'product.quantity'],
      ARRAY['payload.id',         'payload.quantity'],
      ARRAY['external_id',        'on_hand']
    ];
    FOR i IN 1 .. array_length(v_cand, 1) LOOP
      v_pair := v_cand[i:i][1:2];
      v_id  := public._taki_jpath(p_body, v_cand[i][1]);
      v_qty := public._taki_jpath(p_body, v_cand[i][2]);
      IF v_id IS NOT NULL AND v_qty IS NOT NULL AND v_qty ~ '^[0-9]+$' THEN
        v_map := jsonb_build_object('id', v_cand[i][1], 'qty', v_cand[i][2], 'learned', true);
        UPDATE public.stock_integrations SET field_map = v_map WHERE id = v_i.id;
        -- v15.16 merge2 — ويبقى حارسُ المزوّد سارياً في هذا النداء نفسه
        v_map := COALESCE(public._taki_provider_map(v_i.provider), '{}'::jsonb) || v_map;
        EXIT;
      END IF;
      v_id := NULL; v_qty := NULL;
    END LOOP;
  END IF;

  -- v15.15 — هل يقول المزوّدُ إنّ جذرَ رسالته ليس الحقيقة؟
  --           (زد: منتجٌ له أصناف جذرُ كمّيته صفرٌ دائماً.)
  IF v_qty IS NOT NULL AND jsonb_typeof(COALESCE(v_map->'skip_when','null'::jsonb)) = 'array'
     AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_map->'skip_when') c
                  WHERE lower(COALESCE(public._taki_jpath(p_body, c->>'path'), '~absent~'))
                        = lower(c->>'equals')) THEN
    -- يُقلَّد الفرعُ القائم حرفياً: وسمٌ على الاتصال، والحمولةُ محفوظةٌ
    -- في `last_payload` بمشغّلٍ قائم. ولا جدولَ آخر — `stock_inbox`
    -- سجلُّ تكرارٍ لا مخزنُ حمولات (قِيس قبل الكتابة).
    UPDATE public.stock_integrations SET last_note = 'PARENT_OR_UNLIMITED' WHERE id = v_i.id;
    RETURN jsonb_build_object('ok', true, 'stored', true, 'unmapped', true,
      'reason', 'PARENT_OR_UNLIMITED',
      'hint', 'this product keeps its real stock per variant or per location, not at the root');
  END IF;
  IF v_id IS NULL OR v_qty IS NULL OR v_qty !~ '^[0-9]+$' THEN
    -- 🔴 يُقال صراحةً، ولا يُردّ خطأً: رسالةٌ لم نفهمها ليست خطأً عند المرسل،
    --    ورفضُها يجعل نظامه يُعيدها إلى الأبد. تُحفظ ويُطلب ربطُ حقولها.
    UPDATE public.stock_integrations SET last_note = 'UNMAPPED' WHERE id = v_i.id;
    RETURN jsonb_build_object('ok', true, 'stored', true, 'unmapped', true,
      'hint', 'open your TAKI stock-link card and map the fields of the message we just received');
  END IF;

  -- معرّفُ الحدث: من الرسالة إن حملته، وإلّا **بصمةُ محتواها**.
  -- 🔴 وأوّلُ نسخةٍ كتبتُها بنَته بـ`jpath(body,'id') || ':' || …` — و`NULL`
  --    مضروبةً في نصٍّ تعطي `NULL` في SQL، فخرج المعرّف فارغاً ورُفضت كلُّ
  --    رسالةٍ بـ`EVENT_ID_REQUIRED`. أمسكه القياسُ السلوكيّ لا القراءة.
  -- 🪤 والبصمةُ وحدها تكفي: رسالتان متطابقتان تماماً تكرارٌ بالتعريف، وضبطُ
  --    نفس الرقم مرّتين لا أثر له أصلاً (الكمّيات مطلقة).
  -- 🔴 v15.80 ⑤ — والدلوُ من **زمنِ الرسالة** لا من `now()`: جسمٌ موقَّعٌ
  --    يُعاد بعد النافذة كان يدخل دلواً جديداً فيُطبَّق ثانياً، ولا يمسكه
  --    `STALE_OBSERVATION` لأنّ زمنَه كان يُولَد عند الاستقبال لا عند الرصد.
  v_ev := COALESCE(NULLIF(btrim(COALESCE(p_event_id, '')), ''),
                   NULLIF(btrim(COALESCE(public._taki_jpath(p_body, 'event_id'), '')), ''),
                   -- v15.16 window — بصمةٌ + نافذةُ خمس دقائق. وبلا النافذة
                   -- كانت كمّيةٌ تعود لقيمةٍ سبقت (٥ ⇐ ٨ ⇐ ٥) تُهمَل أبداً
                   -- فتبقى تاكي على ٨ والواقعُ ٥ ⇒ بيعٌ زائدٌ دائم.
                   'h:' || encode(extensions.digest(p_body::text, 'sha256'), 'hex')
                        || ':' || (floor(extract(epoch from v_obs) / 300))::bigint::text);

  v_res := public.taki_stock_push(p_key,
             jsonb_build_array(jsonb_build_object('external_id', v_id, 'on_hand', v_qty::int)),
             v_obs, v_ev);

  UPDATE public.stock_integrations
     SET last_note = CASE WHEN COALESCE((v_res->>'applied')::int, 0) > 0 THEN 'OK'
                          WHEN COALESCE((v_res->>'duplicate')::boolean, false) THEN 'DUPLICATE'
                          WHEN jsonb_array_length(COALESCE(v_res->'unmatched','[]'::jsonb)) > 0 THEN 'NOT_LINKED'
                          ELSE 'NO_EFFECT' END
   WHERE id = v_i.id;

  RETURN jsonb_build_object('ok', true, 'external_id', v_id, 'on_hand', v_qty::int, 'push', v_res);
END
$function$;

-- 🪤 والمنحُ يُعاد يدوياً بعد كلّ `DROP`: سوبابيس تمنح `anon` و`authenticated`
--    تلقائياً على الدوالّ الجديدة (الصلاحياتُ الافتراضيّة على `public`).
--    والصورةُ المقيسةُ قبل الهجرة كانت: supabase_admin · postgres · service_role.
REVOKE ALL ON FUNCTION public.taki_stock_webhook(text, jsonb, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_stock_webhook(text, jsonb, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.taki_stock_webhook(text, jsonb, text, timestamptz) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_stock_webhook(text, jsonb, text, timestamptz) TO postgres, service_role;


-- ════════════════════════════════════════════════════════════════════════
-- ⑧ القسم ٦ — رقمُ فاتورةِ اشتراكاتِ تاكي: عدّادُ صفٍّ لا `nextval`
-- ════════════════════════════════════════════════════════════════════════

-- `nextval` **لا يرتدّ** مع المعاملة، فكلُّ إدراجٍ فاشلٍ يحرق رقماً. والقياس:
-- `last_value = 37` · `max(invoice_no) = 4` · صفّان (٣ و٤) ⇒ ٣٥ رقماً مفقوداً.
-- والنمطُ الصحيحُ قائمٌ عندنا أصلاً: `store_invoice_counters` بـ
-- `INSERT … ON CONFLICT DO UPDATE … RETURNING` — ذرّيٌّ، وفشلُ المعاملة يُعيده.
CREATE TABLE IF NOT EXISTS public.taki_invoice_counter (
  -- صفٌّ واحدٌ بالبناء لا بالاتّفاق
  id         boolean     PRIMARY KEY DEFAULT true CHECK (id),
  last_seq   bigint      NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.taki_invoice_counter ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.taki_invoice_counter FROM PUBLIC;
REVOKE ALL ON TABLE public.taki_invoice_counter FROM anon;
REVOKE ALL ON TABLE public.taki_invoice_counter FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.taki_invoice_counter TO postgres, service_role;
COMMENT ON TABLE public.taki_invoice_counter IS
  'v15.80 — عدّادُ فواتير اشتراكات تاكي. يرتدّ مع المعاملة فلا فجوةَ في تسلسلٍ ضريبيّ. لا بياناتٍ شخصيّة فيه.';

-- 🔴 البذرةُ من `GREATEST(max(invoice_no), last_value)` **لا** من `max` وحده:
--    الأرقامُ ٥–٣٧ خرجت فعلاً من `nextval`، وقد يكون أحدُها بلغ مستنداً حُذف
--    صفُّه لاحقاً. والبدءُ من ٥ يُنتج **رقماً ضريبياً مكرّراً** — وهو أسوأُ من
--    فجوة. والتسلسلُ يُحفظ كشاهدٍ على ما خُصّص ولا يُحذف.
INSERT INTO public.taki_invoice_counter (id, last_seq)
VALUES (true, GREATEST(
          COALESCE((SELECT max(invoice_no) FROM public.subscription_payments), 0),
          COALESCE((SELECT last_value FROM public.taki_invoice_seq), 0)))
ON CONFLICT (id) DO UPDATE
  SET last_seq = GREATEST(public.taki_invoice_counter.last_seq, EXCLUDED.last_seq),
      updated_at = now();

-- ولا رقمَ ضريبيٌّ مكرّرٌ بالبناء (قِيس: لا فهرسَ فريداً كان موجوداً)
CREATE UNIQUE INDEX IF NOT EXISTS ux_subscription_payments_invoice_no
  ON public.subscription_payments (invoice_no) WHERE invoice_no IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tr_assign_invoice_no()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_no bigint;
BEGIN
  IF NEW.invoice_no IS NOT NULL THEN RETURN NEW; END IF;
  INSERT INTO public.taki_invoice_counter (id, last_seq)
  VALUES (true, 1)
  ON CONFLICT (id) DO UPDATE
    SET last_seq = public.taki_invoice_counter.last_seq + 1, updated_at = now()
  RETURNING last_seq INTO v_no;
  NEW.invoice_no := v_no;
  RETURN NEW;
END
$function$;

-- 🔴 ومالكُ المشغّل يُنقل إلى `supabase_admin` لزوماً لا تجميلاً: الجدولُ عليه
--    RLS بلا أيّ سياسة (نمطُ `store_invoice_counters`)، و`postgres` **ليس
--    superuser** على هذا الخادم ولا يملك الجدول ⇒ RLS تُصفّر قراءتَه وكتابتَه
--    فيصير المشغّلُ عاجزاً بصمت. والمالكُ الجديدُ superuser فيتجاوزها.
--    (والمشغّلُ لا يُفحَص إذنُه عند الإطلاق بل عند `CREATE TRIGGER`، فالوِصلةُ
--     القائمة لا تتأثّر.)
ALTER FUNCTION public.tr_assign_invoice_no() OWNER TO supabase_admin;


-- ════════════════════════════════════════════════════════════════════════
-- ⑨ القسم ٧ — صلاحيةٌ ماليّةٌ صريحة بدل «هل هو أدمن؟»
-- ════════════════════════════════════════════════════════════════════════

-- مُسنَدٌ واحدٌ، منقولٌ **حرفياً** من بوّابة `admin_unstick_refund` الحيّة
-- (`taki_admin_perm('action_view_finance') OR taki_admin_perm('tab_launch')`)
-- فتبقى عائلةُ الاسترداد على صلاحيةٍ واحدة. وكلُّ صلاحيةٍ هنا **موجودةٌ أصلاً**
-- في `src/data/adminPermissions.ts` (`action_view_finance`:61 · `tab_launch`:51
-- · `tab_sellers`:34 · `action_manage_users`) — ولا يُضاف شيءٌ إلى الكتالوج.
DROP FUNCTION IF EXISTS public.taki_admin_finance();
CREATE FUNCTION public.taki_admin_finance()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public.taki_admin_perm('action_view_finance')
      OR public.taki_admin_perm('tab_launch');
$function$;

REVOKE ALL ON FUNCTION public.taki_admin_finance() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_admin_finance() FROM anon;
REVOKE ALL ON FUNCTION public.taki_admin_finance() FROM authenticated;
-- 🔴 المنحُ الصريحُ لـ`postgres` **لازم**: أربعٌ من الدوالّ أدناه مملوكةٌ له
--    (`get_booking_card` · `invoice_customer_details` ·
--     `confirm_subscription_payment` · `start_trial_for_merchant`)، وهو ليس
--    superuser هنا ⇒ بلا المنح تفشل أربعُ دوالٍّ وقتَ التشغيل بخطأِ صلاحيةٍ
--    لا يُمسكه أيُّ بناءٍ ولا أيُّ `typecheck`.
GRANT EXECUTE ON FUNCTION public.taki_admin_finance() TO postgres, service_role;

COMMENT ON FUNCTION public.taki_admin_finance() IS
  'v15.80 — بوّابةُ الشاشاتِ الماليّة: action_view_finance أو tab_launch. تُسأل بدل is_admin() التي تُرجع TRUE لأيّ أدمنٍ خارج سجلّ الـRPC.';

-- (١) `get_order_invoice` — الفاتورةُ الضريبيّة المجمّدة
CREATE OR REPLACE FUNCTION public.get_order_invoice(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_me  text := (SELECT auth.uid()::text);
  v_row public.order_invoices%ROWTYPE;
  v_vat text;
BEGIN
  IF v_me IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_row FROM public.order_invoices WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- v15.80 ⑦ — والمشتري والتاجرُ لا يتأثّران: الفرعُ المُضيَّقُ هو فرعُ الأدمن
  --   وحده. و`enforcedAt` لـ`action_view_finance` يُسمّي `RLS order_invoices`.
  IF v_me <> COALESCE(v_row.buyer_id, '') AND v_me <> v_row.store_id
     AND NOT public.taki_admin_finance() THEN
    RETURN NULL;
  END IF;
  v_vat := NULLIF(btrim(COALESCE(v_row.seller->>'vat_number', '')), '');
  RETURN jsonb_build_object(
    'barcode',    v_row.barcode,
    'invoice_no', v_row.invoice_no,
    'issued_at',  v_row.issued_at,
    'currency',   v_row.currency,
    'total',      v_row.total,
    'vat_rate',   v_row.vat_rate,
    'vat_base',   v_row.vat_base,
    'vat_amount', v_row.vat_amount,
    'seller',     v_row.seller,
    'zatca_tlv',  CASE
                    WHEN v_row.vat_amount IS NULL OR v_vat IS NULL
                      OR COALESCE(v_row.total, 0) <= 0 THEN NULL
                    ELSE public.taki_zatca_tlv(
                           COALESCE(v_row.seller->>'name', ''),
                           v_vat,
                           to_char(COALESCE(v_row.issued_at, v_row.created_at, now())
                                     AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                           to_char(v_row.total,      'FM9999999990.00'),
                           to_char(v_row.vat_amount, 'FM9999999990.00'))
                  END);
END
$function$;

-- (٢) `get_booking_refund` — مبالغُ الردّ ورقمُ الإشعار الدائن
CREATE OR REPLACE FUNCTION public.get_booking_refund(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_me text := (SELECT auth.uid()::text); v_r public.booking_refunds%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_r FROM public.booking_refunds WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- v15.80 ⑦
  IF v_me <> v_r.buyer_id AND v_me <> v_r.store_id
     AND NOT public.taki_admin_finance() THEN RETURN NULL; END IF;
  RETURN jsonb_build_object(
    'barcode', v_r.barcode, 'status', v_r.status, 'amount', v_r.amount,
    'opened_by', v_r.opened_by, 'reason', v_r.reason, 'requested_at', v_r.requested_at,
    'merchant_note', v_r.merchant_note, 'decided_at', v_r.decided_at,
    'refunded_at', v_r.refunded_at, 'refund_amount', v_r.refund_amount,
    'refund_ref', v_r.refund_ref, 'refund_method', v_r.refund_method,
    'credit_note_no', v_r.credit_note_no);
END
$function$;

-- (٣) `invoice_customer_details` — رقمُ التاجر الضريبيُّ وسجلُّه وعنوانُه
CREATE OR REPLACE FUNCTION public.invoice_customer_details(p_merchant_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_me text := auth.uid()::text; v_out jsonb;
begin
  if v_me is null then return null; end if;
  -- v15.80 ⑦ — ومنادي الأدمن هو `src/pages/admin/AdminTax.tsx:84` لأيّ تاجر،
  --   و`tab_launch` هو ما يفتح «الزكاة والضريبة» بنصّ الكتالوج.
  if v_me <> p_merchant_id and not public.taki_admin_finance() then return null; end if;

  select jsonb_build_object(
    'name',    coalesce(nullif(u.shop,''), u.name),
    'vat',     nullif(sp.vat_number,''),
    'cr',      nullif(sp.cr_number,''),
    'address', coalesce(nullif(sp.address,''), nullif(u.address,'')),
    'email',   coalesce(nullif(sp.email,''), nullif(u.email,'')),
    'phone',   coalesce(nullif(sp.phone,''), nullif(u.contact_phone,''), nullif(u.phone,''))
  ) into v_out
  from users u left join store_profiles sp on sp.store_id = u.id
  where u.id = p_merchant_id;

  return v_out;
end
$function$;

-- (٤) `get_booking_card` — جوّالُ المشتري ولقطةُ عنوانه والمدفوع
CREATE OR REPLACE FUNCTION public.get_booking_card(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b          bookings%ROWTYPE;
  v_d          deals%ROWTYPE;
  v_uid        text := auth.uid()::text;
  v_is_admin   boolean := false;
  v_seller     text;
  v_buyer      text;
  v_deal_found boolean := false;
BEGIN
  IF p_barcode IS NULL OR length(btrim(p_barcode)) = 0 THEN
    RETURN jsonb_build_object('error','bad_request');
  END IF;

  SELECT * INTO v_b FROM bookings WHERE barcode = upper(btrim(p_barcode)) LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  -- v15.80 ⑦ — كان `SELECT (user_type='admin')` خاماً: أيُّ أدمنٍ فرعيٍّ يقرأ
  --   جوّالَ أيِّ مشترٍ وعنوانَه والمدفوع. صار صلاحيةً صريحة.
  IF v_uid IS NOT NULL THEN
    v_is_admin := public.taki_admin_finance();
  END IF;
  v_is_admin := coalesce(v_is_admin,false);

  IF v_uid IS NULL
     OR (v_uid <> coalesce(v_b.user_id,'~') AND v_uid <> coalesce(v_b.store_id,'~') AND NOT v_is_admin) THEN
    RETURN jsonb_build_object('error','forbidden');
  END IF;

  SELECT * INTO v_d FROM deals WHERE id = v_b.deal_id LIMIT 1;
  v_deal_found := FOUND;

  SELECT coalesce(nullif(shop,''), name) INTO v_seller FROM users WHERE id = v_b.store_id;
  v_buyer := coalesce(nullif(v_b.user_name,''), (SELECT name FROM users WHERE id = v_b.user_id));

  RETURN jsonb_build_object(
    'barcode',             v_b.barcode,
    'backup_code',         v_b.backup_code,
    'status',              v_b.status,
    'booked_quantity',     v_b.booked_quantity,
    'booked_at',           v_b.booked_at,
    'expiry_time',         v_b.expiry_time,
    'completed_at',        v_b.completed_at,
    'prep_time',           coalesce(v_b.prep_time, v_d.prep_time),
    'notes',               v_b.notes,
    'merchant_note',       v_b.merchant_note,
    'deal_id',             v_b.deal_id,
    'deal_exists',         v_deal_found,
    'item_name',           v_d.item_name,
    'shop_name',           coalesce(v_d.shop_name, v_seller),
    'category',            v_d.category,
    'image',               (v_d.images)[1],
    'original_price',      v_d.original_price,
    'discounted_price',    v_d.discounted_price,
    'discount_percentage', v_d.discount_percentage,
    'city',                v_d.city,
    'region',              v_d.region,
    'buyer_name',          v_buyer,
    'buyer_phone',         v_b.user_phone,
    'store_id',            v_b.store_id,
    'user_id',             v_b.user_id,
    'payment_method',      v_b.payment_method,
    'paid_at',             v_b.paid_at,
    'paid_amount',         v_b.paid_amount,
    'fulfillment',         coalesce(v_b.fulfillment, 'pickup'),
    'delivery_address',    v_b.delivery_address,
    'delivery_fee',        v_b.delivery_fee,
    'viewer_is_buyer',     (v_uid = v_b.user_id),
    'viewer_is_seller',    (v_uid = v_b.store_id),
    'viewer_is_admin',     v_is_admin
  );
END;
$function$;

-- (٥) `confirm_subscription_payment` — تَختم دفعةَ اشتراكٍ «مدفوعة» وتُفعّلها
--     🪤 ولا منادي لها في المستودع كلِّه (قِيس: `src/` و`server/` و`shared/`
--        و`supabase/functions/` ⇒ صفر). سطحٌ موثَّقٌ بلا مستخدم — يُضيَّق هنا،
--        وقرارُ حذفِه أو بناءِ شاشةٍ له لناصر.
CREATE OR REPLACE FUNCTION public.confirm_subscription_payment(p_payment_id text, p_gateway_reference text)
RETURNS merchant_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_payment subscription_payments;
    v_sub merchant_subscriptions;
BEGIN
    -- v15.80 ⑦ — كان `SELECT user_type … IS DISTINCT FROM 'admin'`: أيُّ أدمنٍ
    --   فرعيٍّ يَختم دفعةً ويُفعّل اشتراكاً. ونصُّ الرسالة يبقى كما هو.
    IF NOT public.taki_admin_finance() THEN
        RAISE EXCEPTION 'Only admins can confirm payments';
    END IF;

    SELECT * INTO v_payment FROM subscription_payments WHERE id = p_payment_id;
    IF v_payment IS NULL THEN
        RAISE EXCEPTION 'Payment not found';
    END IF;

    -- v15.45 — ويُختم **من** ضمِن الدفعة: الصفُّ كان يصير «مدفوعاً» بلا أيّ
    -- أثرٍ لمن أقرّ بوصولها ولا كيف. و`tr_guard_fake_sub_payment` صار يرى
    -- التعديلَ أيضاً (كان `BEFORE INSERT` وحده)، فمزوّدٌ فارغٌ يُرفض بحقّ.
    UPDATE subscription_payments
    SET status = 'paid',
        gateway_provider = COALESCE(NULLIF(gateway_provider, ''), 'admin_confirmed'),
        gateway_reference = p_gateway_reference,
        paid_at = NOW()
    WHERE id = p_payment_id;

    UPDATE merchant_subscriptions
    SET status = 'active',
        current_period_start = COALESCE(v_payment.period_start, NOW()),
        current_period_end = COALESCE(v_payment.period_end, NOW() + interval '30 days'),
        last_renewed_at = NOW(),
        updated_at = NOW()
    WHERE id = v_payment.subscription_id
    RETURNING * INTO v_sub;

    INSERT INTO notifications (user_id, title_ar, title_en, body_ar, body_en, type)
    VALUES (v_payment.merchant_id,
        '✅ تم تجديد اشتراكك', '✅ Subscription renewed',
        'استلمنا دفعتك بنجاح. اشتراكك ساري حتى ' ||
            to_char(COALESCE(v_payment.period_end, NOW() + interval '30 days'), 'YYYY-MM-DD'),
        'We received your payment. Your subscription is active until ' ||
            to_char(COALESCE(v_payment.period_end, NOW() + interval '30 days'), 'YYYY-MM-DD'),
        'system');

    RETURN v_sub;
END;
$function$;

-- (٦) `start_trial_for_merchant` — تُنشئ اشتراكاً تجريبياً لتاجرٍ آخر
--     🔴 والصلاحيةُ هنا ليست ماليّةً بل **إدارةُ التجّار**، ومعها
--        `action_manage_users` لسببٍ مقيس: المشغّلُ `tr_auto_start_trial`
--        (AFTER INSERT OR UPDATE OF user_type ON users) ينادي هذه الدالّة
--        بهويّةِ من قلب الحساب إلى «تاجر»، والسياسةُ الحيّةُ `users_update_admin`
--        تُجيز ذلك القلبَ لحاملِ `action_manage_users` **لا** `tab_sellers`.
--        فاشتراطُ `tab_sellers` وحدَها كان سيُسقط التجربةَ **بصمتٍ تامّ**:
--        المشغّلُ يلفّ النداءَ بـ`EXCEPTION WHEN OTHERS THEN NULL`.
--     🪤 ويبقى فرعُ `auth.uid() IS NULL` كما هو: الكرونُ والسلاسلُ الداخليّة
--        تمرّ منه، وإغلاقُه يكسرها.
CREATE OR REPLACE FUNCTION public.start_trial_for_merchant(p_merchant_id text)
RETURNS merchant_subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_trial_days INTEGER;
    v_basic_plan_id TEXT;
    v_existing merchant_subscriptions;
    v_new merchant_subscriptions;
BEGIN
    -- v12.75: an authenticated caller may only start a trial for HIMSELF
    -- (admins and internal definer/cron chains that carry no other uid pass).
    -- v15.80 ⑦ — و«أدمن» صارت صلاحيةً صريحة بدل `is_admin()`.
    IF auth.uid() IS NOT NULL AND auth.uid()::text <> p_merchant_id
       AND NOT (public.taki_admin_perm('tab_sellers')
             OR public.taki_admin_perm('action_manage_users')) THEN
        RAISE EXCEPTION 'forbidden';
    END IF;

    SELECT * INTO v_existing FROM merchant_subscriptions WHERE merchant_id = p_merchant_id;
    IF FOUND THEN
        RETURN v_existing;
    END IF;

    v_trial_days := COALESCE((get_setting('trial_days', '14'::jsonb))::int, 14);
    SELECT id INTO v_basic_plan_id FROM subscription_plans WHERE code = 'basic' LIMIT 1;

    INSERT INTO merchant_subscriptions (
        merchant_id, plan_id, status,
        trial_starts_at, trial_ends_at, branches_count
    )
    VALUES (
        p_merchant_id, v_basic_plan_id, 'trial',
        NOW(), NOW() + (v_trial_days || ' days')::interval, 1
    )
    RETURNING * INTO v_new;

    RETURN v_new;
END;
$function$;

-- (٧) `resolve_booking_refund` — أُعيدت في القسم ③ ومعها `taki_admin_finance()`

-- والسجلُّ يُستكمَل حزاماً ثانياً — والفرضُ لم يعد عليه: `is_admin()` تستشيره
-- بتعبيرٍ نمطيٍّ على مكدّس النداء، وذاك يفشل مفتوحاً. والصلاحيةُ أعلاه صريحة.
INSERT INTO public.admin_rpc_permissions (rpc_name, required_perm, note) VALUES
  ('resolve_booking_refund',       'action_view_finance', 'v15.80 — ويُفرض صراحةً في جسم الدالّة'),
  ('get_order_invoice',            'action_view_finance', 'v15.80 — فرعُ الأدمن وحده'),
  ('get_booking_refund',           'action_view_finance', 'v15.80 — فرعُ الأدمن وحده'),
  ('get_booking_card',             'action_view_finance', 'v15.80 — جوّالُ المشتري وعنوانه'),
  ('invoice_customer_details',     'action_view_finance', 'v15.80 — الرقمُ الضريبيّ والسجلّ'),
  ('confirm_subscription_payment', 'action_view_finance', 'v15.80 — ختمُ دفعةِ اشتراك'),
  ('start_trial_for_merchant',     'tab_sellers',         'v15.80 — ومعها action_manage_users لمسار المشغّل')
ON CONFLICT (rpc_name, required_perm) DO UPDATE SET note = EXCLUDED.note;


-- ════════════════════════════════════════════════════════════════════════
-- ⑩ التحقّقات — كلُّها `DO` يرفع استثناءً. (وجدولُ ✅/❌ لا يُفشل psql:
--    صفٌّ يقول ❌ ليس خطأً في SQL وحالةُ الخروج تبقى صفراً — درسُ v14.50.)
-- ════════════════════════════════════════════════════════════════════════

-- (أ) القسم ③ — السقفُ يُرفض فعلاً، **ويُقبل** المشروع
--     🔴 جلسةُ psql بلا `auth.uid()`، فالدالّةُ تعود `AUTH_REQUIRED` ولا تبلغ
--        السقفَ أبداً — وذاك فحصٌ يمرّ كاذباً (درسُ v14.96/v15.00). فيُنتحل
--        **التاجرُ المالكُ نفسُه** داخل كتلةٍ فرعيّةٍ تُلغى بعدها.
--     🪤 والنداءان لا يكتبان شيئاً أصلاً (كلاهما يعود قبل العدّاد)، ومع ذلك
--        تُلغى الكتلةُ بسنتينل: لا إشعارَ دائنٍ، ولا رقمَ يُحرق.
DO $v_cap$
DECLARE v_bc text; v_store text; v_cap numeric; v_res jsonb;
BEGIN
  SELECT b.barcode, b.store_id INTO v_bc, v_store
    FROM public.bookings b
   WHERE b.paid_at IS NOT NULL
     AND COALESCE(b.refund_state, '') NOT IN ('claiming', 'refunded')
     AND NOT EXISTS (SELECT 1 FROM public.booking_refunds r
                      WHERE r.barcode = b.barcode AND r.status = 'refunded')
   ORDER BY b.barcode LIMIT 1;
  IF v_bc IS NULL THEN
    RAISE EXCEPTION '❌ لا طلبَ مدفوعاً صالحاً للكسر — ولا يُصدَّق حارسٌ لم يُكسر (كانت سبعةٌ يومَ القياس)';
  END IF;

  v_cap := public.taki_refund_remaining(v_bc);
  IF NOT (v_cap > 0) THEN
    RAISE EXCEPTION '❌ سقفُ الطلب % ليس موجباً (%) — الفحصُ لا يبتّ', v_bc, v_cap;
  END IF;

  BEGIN
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_store, 'role', 'authenticated')::text, true);

    -- سالب: دينارٌ فوق السقف يُرفض **بالرمز المقصود** لا بأيّ رمز
    v_res := public.resolve_booking_refund(v_bc, 'refund', 'كسرةُ تحقّقٍ تُلغى', v_cap + 1, 'TEST', 'test', false);
    IF COALESCE(v_res->>'error', '') <> 'AMOUNT_ABOVE_INVOICE' THEN
      RAISE EXCEPTION '❌ 🔴 سقفُ الاسترداد لم يمنع % فوق السقف % — الردّ: %', v_cap + 1, v_cap, v_res::text;
    END IF;

    -- موجب: والسقفُ نفسُه **لا** يُرفض بذلك الرمز — وإلّا كان الفحصُ يمرّ
    -- برفض كلِّ شيء. والردُّ المتوقَّع `NO_REQUEST` (لا طلبَ استردادٍ مفتوح).
    v_res := public.resolve_booking_refund(v_bc, 'refund', 'كسرةُ تحقّقٍ تُلغى', v_cap, 'TEST', 'test', false);
    IF COALESCE(v_res->>'error', '') = 'AMOUNT_ABOVE_INVOICE' THEN
      RAISE EXCEPTION '❌ السقفُ رفض المبلغَ المشروع % — حارسٌ يرفض كلَّ شيء ليس حارساً', v_cap;
    END IF;
    IF COALESCE(v_res->>'error', '') <> 'NO_REQUEST' THEN
      RAISE EXCEPTION '❌ الفرعُ الموجب انتهى إلى ردٍّ غيرِ متوقَّع: %', v_res::text;
    END IF;

    RAISE EXCEPTION 'TAKI_DISCARD';
  EXCEPTION WHEN others THEN
    -- 🪤 وأيُّ فشلٍ حقيقيٍّ يُعاد رفعُه: لو ابتُلع لصار الفحصُ ضجيجاً
    IF SQLERRM <> 'TAKI_DISCARD' THEN RAISE; END IF;
  END;

  RAISE NOTICE '✅ (أ) سقفُ الاسترداد: % فوق السقف مرفوضٌ بـAMOUNT_ABOVE_INVOICE · والسقفُ % مقبول (الطلب %)',
               v_cap + 1, v_cap, v_bc;
END $v_cap$;

-- (ب) القسم ④ — قاعدةُ الخيارات: سبعُ حالاتٍ معاديةٍ تُرفض وثلاثٌ مشروعةٌ تُقبل
--     🪤 ولا إدراجَ حجزٍ هنا: في `bookings` أحدَ عشرَ مشغّلَ `BEFORE INSERT`
--        (حدُّ المعدّل · الحظر · حدودُ الطلبات · حجزُ المخزون …) وأيُّها قد
--        يرفض أوّلاً فيُنسب الرفضُ إلى الحارس خطأً. فتُنادى القاعدةُ مباشرةً،
--        وحيويّةُ المشغّل تُثبَت بوِصلته لا بنصّه.
DO $v_opt$
DECLARE
  v_deal text; v_vid text; v_vlabel text; v_gid text; v_cid text; v_gdeal text;
  v_f text;
BEGIN
  -- عرضٌ حيٌّ له نسخٌ، وأوّلُ نسخةٍ كمّيتُها تكفي قطعةً واحدة
  SELECT d.id, v->>'id', v->>'label' INTO v_deal, v_vid, v_vlabel
    FROM public.deals d,
         jsonb_array_elements(CASE WHEN jsonb_typeof(d.variants) = 'array' THEN d.variants ELSE '[]'::jsonb END) v
   -- 🪤 ويُفحص الشكلُ قبل التحويل: `::numeric` على قيمةٍ غيرِ رقميّةٍ يرفع
   --    خطأَ تحويلٍ فيسقط الفحصُ **لسببٍ آخر** غيرِ المقصود.
   -- 🪤 وبلا مجموعةٍ إلزاميّة: وإلّا رُفض الفرعُ الموجب لأنّ المجموعةَ غيرُ
   --    مختارة — نفسُ فخّ الفرع الآخر معكوساً.
   WHERE d.status = 'active' AND v->>'qty' ~ '^[0-9]+$' AND (v->>'qty')::int >= 1
     AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(d.options) = 'array' THEN d.options ELSE '[]'::jsonb END) g2
           WHERE COALESCE((g2->>'required')::boolean, false))
   -- وترتيبٌ حاسمٌ لا يتأرجح بين تشغيلين: أكبرُ كمّيةٍ أوّلاً
   ORDER BY d.id, (v->>'qty')::int DESC LIMIT 1;
  IF v_deal IS NULL THEN
    RAISE EXCEPTION '❌ لا عرضَ حيٍّ له نسخةٌ متاحة — الكسرةُ لا تُجرى، ولا يُصدَّق حارسٌ لم يُكسر';
  END IF;

  -- سالب ١: عرضٌ له نسخٌ ولا نسخةَ مختارة (هذا **بالضبط** ما كان الويبُ يُمرّره)
  v_f := public.taki_booking_options_fault(v_deal, '[]'::jsonb);
  IF COALESCE(v_f,'') <> 'NEEDS_OPTIONS' THEN
    RAISE EXCEPTION '❌ 🔴 نسخةٌ غيرُ مختارةٍ قُبلت (الردّ: %) — بابُ تخفيضِ السعر ما زال مفتوحاً', COALESCE(v_f,'(سالك)');
  END IF;

  -- سالب ٢: و`NULL` مثلُ `[]` (الواجهةُ قد لا تُرسل الحقلَ إطلاقاً)
  IF COALESCE(public.taki_booking_options_fault(v_deal, NULL),'') <> 'NEEDS_OPTIONS' THEN
    RAISE EXCEPTION '❌ `selected_options = NULL` قُبلت على عرضٍ له نسخ';
  END IF;

  -- سالب ٣: معرّفُ نسخةٍ مخترَع يُرضي «اختَرْ نسخة» ويُسقط السعرَ — مرفوض
  IF COALESCE(public.taki_booking_options_fault(v_deal,
        jsonb_build_array(jsonb_build_object('g','__variant__','c','v_لا_وجود_له','qty',1))),'') <> 'NEEDS_OPTIONS' THEN
    RAISE EXCEPTION '❌ 🔴 معرّفُ نسخةٍ مجهولٌ قُبل — والحارسُ الجديد قابلٌ للتجاوز بمعرّفٍ مخترَع';
  END IF;

  -- موجب ١: ونسخةٌ **حقيقيّةٌ** بكمّيةٍ كافيةٍ تمرّ — وإلّا كان الحارسُ يرفض كلَّ شيء
  v_f := public.taki_booking_options_fault(v_deal,
           jsonb_build_array(jsonb_build_object('g','__variant__','c',v_vid,'qty',1)));
  IF v_f IS NOT NULL THEN
    RAISE EXCEPTION '❌ نسخةٌ حقيقيّةٌ («%») رُفضت بـ% — حارسٌ يرفض كلَّ شيء ليس حارساً', COALESCE(v_vlabel,'?'), v_f;
  END IF;

  -- سالب ٤: وكمّيةٌ فوق المتاح تُرفض بالعقد النصّيّ `VARIANT_STOCK:…` لا بـNEEDS
  v_f := public.taki_booking_options_fault(v_deal,
           jsonb_build_array(jsonb_build_object('g','__variant__','c',v_vid,'qty',1000000)));
  IF COALESCE(v_f,'') NOT LIKE 'VARIANT_STOCK:%' THEN
    RAISE EXCEPTION '❌ كمّيةٌ فوق المتاح لم تُرفض بالعقد `VARIANT_STOCK:` — الردّ: %', COALESCE(v_f,'(سالك)');
  END IF;

  -- وعرضٌ له مجموعةٌ إلزاميّةٌ بخياراتٍ حقيقيّة
  SELECT d.id, g->>'id', c->>'id' INTO v_gdeal, v_gid, v_cid
    FROM public.deals d,
         jsonb_array_elements(CASE WHEN jsonb_typeof(d.options) = 'array' THEN d.options ELSE '[]'::jsonb END) g,
         jsonb_array_elements(CASE WHEN jsonb_typeof(g->'choices') = 'array' THEN g->'choices' ELSE '[]'::jsonb END) c
   WHERE d.status IN ('active','paused') AND COALESCE((g->>'required')::boolean,false)
     -- 🪤 وبلا نسخ: عرضٌ يجمع الاثنين يُرفض في الفرع الموجب لأنّ النسخةَ
     --    غيرُ مختارة، فيتّهم الفحصُ حارساً سليماً. (قِيس: `1784666008157`
     --    يحمل الاثنين وهو الأوّلُ بترتيب المعرّف.)
     -- 🔴 و`COALESCE` لزومٌ لا زينة: `jsonb_typeof(NULL)` تعود NULL،
     --    و`NOT (NULL AND x)` تعود NULL فيُستثنى الصفُّ **بصمت**. قِيس:
     --    بلا هذا السطر عاد الاستعلامُ صفرَ صفوفٍ وسقط الفحصُ بسببٍ خاطئ.
     AND NOT COALESCE(jsonb_typeof(d.variants) = 'array'
                      AND jsonb_array_length(d.variants) > 0, false)
   ORDER BY d.id, g->>'id', c->>'id' LIMIT 1;
  IF v_gdeal IS NULL THEN
    RAISE EXCEPTION '❌ لا عرضَ له مجموعةٌ إلزاميّة — فرعُ المجموعات لم يُكسر';
  END IF;

  -- سالب ٥: مجموعةٌ إلزاميّةٌ غيرُ مختارة
  IF COALESCE(public.taki_booking_options_fault(v_gdeal, '[]'::jsonb),'') <> 'NEEDS_OPTIONS' THEN
    RAISE EXCEPTION '❌ مجموعةٌ إلزاميّةٌ غيرُ مختارةٍ قُبلت على العرض %', v_gdeal;
  END IF;

  -- سالب ٦: 🔴 وخيارٌ **مخترَع** داخل المجموعة الصحيحة — كان يُرضي الحارسَ
  --   القديمَ ويُسقط ثمنَ الإضافة (`taki_booking_amount` تتجاوز المجهول)
  IF COALESCE(public.taki_booking_options_fault(v_gdeal,
        jsonb_build_array(jsonb_build_object('g',v_gid,'c','c_لا_وجود_له','qty',1))),'') <> 'NEEDS_OPTIONS' THEN
    RAISE EXCEPTION '❌ 🔴 خيارٌ مخترَعٌ قُبل في المجموعة % — بابُ إسقاطِ ثمنِ الإضافة مفتوح', v_gid;
  END IF;

  -- موجب ٢: والخيارُ الحقيقيُّ يمرّ
  v_f := public.taki_booking_options_fault(v_gdeal,
           jsonb_build_array(jsonb_build_object('g',v_gid,'c',v_cid,'qty',1)));
  IF v_f IS NOT NULL THEN
    RAISE EXCEPTION '❌ خيارٌ حقيقيٌّ رُفض بـ% على العرض %', v_f, v_gdeal;
  END IF;

  RAISE NOTICE '✅ (ب) قاعدةُ الخيارات: ستُّ حالاتٍ معاديةٍ مرفوضةٌ بالرمز المقصود · وحالتان مشروعتان مقبولتان';
END $v_opt$;

-- (ج) ووِصلةُ المشغّل قائمةٌ ومفعَّلة، وتُشير إلى الدالّة، والدالّةُ تنادي
--     القاعدة. (نصٌّ لا يُثبت حيويّةً — ولذلك تُثبت الحيويّةُ بـ`tgenabled`
--     لا بالقراءة، والقاعدةُ نفسُها كُسِرت بالنداء في (ب).)
DO $v_wire$
DECLARE v_n int; v_en char;
BEGIN
  SELECT count(*), max(t.tgenabled) INTO v_n, v_en
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.bookings'::regclass
     AND NOT t.tgisinternal
     AND t.tgfoid = 'public.tr_validate_booking_options()'::regprocedure;
  IF v_n <> 1 THEN RAISE EXCEPTION '❌ مشغّلُ خياراتِ الحجز غيرُ مركَّبٍ على `bookings` (العدد %)', v_n; END IF;
  IF v_en <> 'O' THEN RAISE EXCEPTION '❌ المشغّلُ مركَّبٌ ومُعطَّل (tgenabled=%)', v_en; END IF;
  IF regexp_replace(pg_get_functiondef('public.tr_validate_booking_options()'::regprocedure),
                    '--[^\n]*', '', 'g') !~ 'taki_booking_options_fault' THEN
    RAISE EXCEPTION '❌ المشغّلُ لا ينادي القاعدةَ المشتركة';
  END IF;
  -- وما كان خطأً اختفى: لا مميِّزَ مصدرٍ في جسم المشغّل بعد اليوم
  IF regexp_replace(pg_get_functiondef('public.tr_validate_booking_options()'::regprocedure),
                    '--[^\n]*', '', 'g') ~ 'NEW\.source' THEN
    RAISE EXCEPTION '❌ 🔴 مميِّزُ المصدر ما زال في المشغّل — الويبُ قد يبقى معفى';
  END IF;
  RAISE NOTICE '✅ (ج) الوِصلة: مشغّلٌ واحدٌ مفعَّل · ينادي القاعدةَ · ولا مميِّزَ مصدر';
END $v_wire$;

-- (د) القسم ⑤ — عنوانُ الخطّاف: ثلاثةَ عشرَ شكلاً معادياً يُرفض، وثلاثةٌ تُقبل
--     🪤 والشرطُ الذي يعمل فعلاً هو شكلُ المضيف؛ وقائمةُ اللاحقات الخاصّة
--        سببٌ **ثانٍ مستقلّ** (`.local` و`.internal` تمرّان من شرط الحروف).
DO $v_url$
DECLARE
  v_bad text[] := ARRAY[
    'http://hooks.example.com/x',            -- لا https
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://10.0.0.5/x',
    'https://192.168.1.1/x',
    'https://172.16.0.1/x',
    'https://169.254.169.254/latest/meta-data/',
    'https://2130706433/x',                  -- عشريٌّ مضغوط
    'https://0177.0.0.1/x',                  -- ثُمانيّ
    'https://[::1]/x',
    'https://[::ffff:10.0.0.1]/x',
    'https://[fd00::1]/x',
    'https://user@evil.example.com/x',       -- معلوماتُ مستخدم
    'https://evil.example.com@127.0.0.1/x',
    'https://%6c%6f%63%61%6c%68%6f%73%74/x', -- ترميزٌ مئويّ
    'https://metadata.google.internal/x',
    'https://printer.local/x',
    'https://box.lan/x',
    'https://hooks.example.com:8080/x',      -- منفذٌ غيرُ ٤٤٣
    'https://hooks.example.com:22/x',
    'https://hooks.example.com /x',          -- فراغ
    'https://.example.com/x',
    'https://-bad.example.com/x'
  ];
  v_ok text[] := ARRAY[
    'https://hooks.example.com/taki',
    'https://hooks.example.com:443/taki',
    'https://api.merchant.example.co.uk/stock?x=1'
  ];
  v_u text;
BEGIN
  FOREACH v_u IN ARRAY v_bad LOOP
    IF public._taki_hook_url_ok(v_u) THEN
      RAISE EXCEPTION '❌ 🔴 عنوانٌ معادٍ قُبل: %', v_u;
    END IF;
  END LOOP;
  FOREACH v_u IN ARRAY v_ok LOOP
    IF NOT public._taki_hook_url_ok(v_u) THEN
      RAISE EXCEPTION '❌ عنوانٌ مشروعٌ رُفض: % — حارسٌ يرفض كلَّ شيء ليس حارساً', v_u;
    END IF;
  END LOOP;
  -- والكاتبان يُسألانه فعلاً (نصّاً، بعد تجريد التعليق — فالتعليقُ أعلاه
  -- يذكر الاسمَ وكان سيُبرّئ نفسَه: درسُ «حارسٌ يقرأ تعليقَه هو»)
  IF regexp_replace(pg_get_functiondef('public.merchant_create_integration(text,text,text,text)'::regprocedure),
                    '--[^\n]*','','g') !~ '_taki_hook_url_ok' THEN
    RAISE EXCEPTION '❌ `merchant_create_integration` لا تسأل الحارس';
  END IF;
  IF regexp_replace(pg_get_functiondef('public.merchant_update_integration(uuid,boolean,text,text)'::regprocedure),
                    '--[^\n]*','','g') !~ '_taki_hook_url_ok' THEN
    RAISE EXCEPTION '❌ `merchant_update_integration` لا تسأل الحارس';
  END IF;
  RAISE NOTICE '✅ (د) عنوانُ الخطّاف: % شكلاً معادياً مرفوض · % مشروعاً مقبول · والكاتبان يسألانه',
               array_length(v_bad,1), array_length(v_ok,1);
END $v_url$;

-- (هـ) القسم ⑥ — فرعُ «النافذة» اختفى، والمطالبةُ تشترط نافذةَ المُطالب
DO $v_salla$
DECLARE v_src text;
BEGIN
  v_src := regexp_replace(pg_get_functiondef('public.taki_stock_oauth_bind_salla(text,jsonb)'::regprocedure),
                          '--[^\n]*', '', 'g');
  IF v_src ~ 'matched_by.*window' OR v_src ~ 'IF v_n = 1 THEN' THEN
    RAISE EXCEPTION '❌ 🔴 فرعُ «النافذةُ الوحيدة» ما زال يَربط توكناً مجهولَ النسبة';
  END IF;
  IF v_src !~ 'PARKED_AWAITING_CLAIM' THEN
    RAISE EXCEPTION '❌ التوكنُ المجهولُ لا يُحفظ جانباً';
  END IF;

  v_src := regexp_replace(pg_get_functiondef('public.merchant_stock_claim_parked(uuid,text)'::regprocedure),
                          '--[^\n]*', '', 'g');
  IF v_src !~ 'NO_WINDOW' OR v_src !~ 'NOT_YOUR_WINDOW' OR v_src !~ 'AMBIGUOUS_WINDOW' THEN
    RAISE EXCEPTION '❌ المطالبةُ لا تشترط نافذةَ المُطالب';
  END IF;

  IF to_regclass('public.stock_oauth_parked') IS NULL THEN
    RAISE EXCEPTION '❌ جدولُ التوكنات المحفوظة جانباً غائب';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-stock-parked-prune') THEN
    RAISE EXCEPTION '❌ لا منظّفَ لـ`stock_oauth_parked` — توكنٌ غيرُ مُطالَبٍ به يبقى في الخزنة أبداً';
  END IF;
  RAISE NOTICE '✅ (هـ) سلّة: لا تخمينَ نافذة · مطالبةٌ بنافذةِ صاحبها · ومنظّفٌ مجدول';
END $v_salla$;

-- (و) القسم ⑦ — زمنُ الرصد صار من الرسالة، والبصمةُ معه
DO $v_obs$
DECLARE v_src text; v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'taki_stock_webhook';
  IF v_n <> 1 THEN
    RAISE EXCEPTION '❌ `taki_stock_webhook` لها % نسخة — حِملٌ ثانٍ يُفجّر كلَّ منادٍ بـ«function is not unique»', v_n;
  END IF;
  v_src := regexp_replace(pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text,timestamptz)'::regprocedure),
                          '--[^\n]*', '', 'g');
  IF v_src ~ 'epoch from now\(\)' THEN
    RAISE EXCEPTION '❌ 🔴 البصمةُ ما زالت تُبنى على `now()` — جسمٌ مُعادٌ يدخل دلواً جديداً';
  END IF;
  IF v_src !~ 'extract\(epoch from v_obs\)' THEN
    RAISE EXCEPTION '❌ البصمةُ لا تُبنى على زمن الرسالة';
  END IF;
  IF v_src !~ 'v_obs, v_ev' THEN
    RAISE EXCEPTION '❌ زمنُ الرسالة لا يُمرَّر إلى `taki_stock_push`';
  END IF;
  -- ولا فسحةَ مستقبليّة: القصُّ يبقى في `taki_set_on_hand` كما كان
  IF regexp_replace(pg_get_functiondef(
        'public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)'::regprocedure),
        '--[^\n]*','','g') !~ 'LEAST\(COALESCE\(p_observed_at, now\(\)\), now\(\)\)' THEN
    RAISE EXCEPTION '❌ قصُّ الزمن إلى `now()` اختفى من `taki_set_on_hand` — ساعةٌ مزحزحةٌ للأمام تُجمّد كلَّ كتابةٍ بعدها';
  END IF;
  -- والسطحُ لم يُفتح بإعادة الإنشاء (سوبابيس تمنح `anon` تلقائياً)
  IF has_function_privilege('anon', 'public.taki_stock_webhook(text,jsonb,text,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.taki_stock_webhook(text,jsonb,text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ 🔴 `taki_stock_webhook` صارت ممنوحةً للزائر أو للموثَّق بعد إعادة الإنشاء';
  END IF;
  RAISE NOTICE '✅ (و) زمنُ الرصد: نسخةٌ واحدة · من الرسالة · والقصُّ باقٍ · ولا منحَ جديد';
END $v_obs$;

-- (ز) القسم ⑧ — عدّادُ الفاتورة: بذرةٌ صحيحة، ولا `nextval` بعد اليوم
DO $v_inv$
DECLARE v_seed bigint; v_max bigint; v_last bigint; v_src text;
BEGIN
  SELECT last_seq INTO v_seed FROM public.taki_invoice_counter WHERE id;
  SELECT COALESCE(max(invoice_no), 0) INTO v_max FROM public.subscription_payments;
  SELECT COALESCE(last_value, 0) INTO v_last FROM public.taki_invoice_seq;
  IF v_seed IS NULL THEN RAISE EXCEPTION '❌ صفُّ العدّاد غائب'; END IF;
  IF v_seed < GREATEST(v_max, v_last) THEN
    RAISE EXCEPTION '❌ 🔴 البذرةُ % أقلُّ من GREATEST(max=%, seq=%) — الرقمُ القادم قد يكون **مكرّراً** في تسلسلٍ ضريبيّ', v_seed, v_max, v_last;
  END IF;
  v_src := regexp_replace(pg_get_functiondef('public.tr_assign_invoice_no()'::regprocedure), '--[^\n]*', '', 'g');
  IF v_src ~ 'nextval' THEN
    RAISE EXCEPTION '❌ المشغّلُ ما زال على `nextval` — وهي لا ترتدّ مع المعاملة فتَخلق فجوة';
  END IF;
  IF v_src !~ 'taki_invoice_counter' THEN
    RAISE EXCEPTION '❌ المشغّلُ لا يستعمل عدّادَ الصفّ';
  END IF;
  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = 'public.tr_assign_invoice_no()'::regprocedure))
     <> 'supabase_admin' THEN
    RAISE EXCEPTION '❌ مالكُ المشغّل ليس `supabase_admin` — وRLS على العدّاد ستُصفّر كتابتَه بصمت';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public'
                  AND indexname = 'ux_subscription_payments_invoice_no') THEN
    RAISE EXCEPTION '❌ لا فهرسَ فريداً على `invoice_no` — رقمٌ ضريبيٌّ مكرّرٌ ممكنٌ بالبناء';
  END IF;
  RAISE NOTICE '✅ (ز) الفاتورة: البذرةُ % (max=% · seq=%) · بلا nextval · مالكُه supabase_admin · وفهرسٌ فريد',
               v_seed, v_max, v_last;
END $v_inv$;

-- (ح) القسم ⑨ — الصلاحيةُ الماليّة: مركَّبةٌ، ومسؤولةٌ عن السبعة، ومنحُها سليم
DO $v_perm$
DECLARE v_fn text; v_src text; v_missing text := '';
BEGIN
  -- 🔴 المنحُ أوّلاً: بلا `postgres` تفشل أربعُ دوالٍّ وقتَ التشغيل وحدَه
  IF NOT has_function_privilege('postgres', 'public.taki_admin_finance()', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ 🔴 `postgres` لا يملك تنفيذَ `taki_admin_finance()` — وأربعُ دوالٍّ ماليّةٍ مملوكةٌ له (وهو ليس superuser هنا)';
  END IF;
  IF has_function_privilege('anon', 'public.taki_admin_finance()', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ `taki_admin_finance()` ممنوحةٌ للزائر المجهول';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY[
    'public.resolve_booking_refund(text,text,text,numeric,text,text,boolean)',
    'public.get_order_invoice(text)',
    'public.get_booking_refund(text)',
    'public.get_booking_card(text)',
    'public.invoice_customer_details(text)',
    'public.confirm_subscription_payment(text,text)'
  ] LOOP
    v_src := regexp_replace(pg_get_functiondef(v_fn::regprocedure), '--[^\n]*', '', 'g');
    IF v_src !~ 'taki_admin_finance' THEN v_missing := v_missing || v_fn || ' '; END IF;
    -- وما كان خطأً اختفى: لا `is_admin` ولا اختبارُ `user_type` خامٌّ للمنادي
    -- 🪤 والنمطُ `is_admin\s*\(` لا `\mis_admin\M`: الثاني يلتبس بـ`v_is_admin`
    --    (الشُّرطةُ السفليّة حرفُ كلمةٍ فلا حدَّ قبل `is`)، والأوّلُ يطابق النداءَ وحده.
    IF v_src ~ 'is_admin\s*\(' THEN
      RAISE EXCEPTION '❌ 🔴 % ما زالت تسأل `is_admin()` — وهي تُرجع TRUE لأيّ أدمنٍ خارج سجلّ الـRPC', v_fn;
    END IF;
  END LOOP;
  IF v_missing <> '' THEN
    RAISE EXCEPTION '❌ دوالٌّ لا تسأل الصلاحيةَ الماليّة: %', v_missing;
  END IF;

  v_src := regexp_replace(pg_get_functiondef('public.start_trial_for_merchant(text)'::regprocedure), '--[^\n]*', '', 'g');
  IF v_src ~ 'is_admin\s*\(' THEN
    RAISE EXCEPTION '❌ `start_trial_for_merchant` ما زالت على `is_admin()`';
  END IF;
  IF v_src !~ 'tab_sellers' OR v_src !~ 'action_manage_users' THEN
    RAISE EXCEPTION '❌ `start_trial_for_merchant` بلا الصلاحيتين — ومسارُ المشغّل يبتلع فشلَه بصمت';
  END IF;

  -- وكلُّ صلاحيةٍ استعملناها قائمةٌ فعلاً على حسابٍ أو في الكتالوج: تُقاس
  -- بالسجلّ لأنّ الكتالوجَ ملفُّ واجهةٍ لا يُسأل من SQL
  IF NOT EXISTS (SELECT 1 FROM public.admin_rpc_permissions
                  WHERE rpc_name = 'resolve_booking_refund' AND required_perm = 'action_view_finance') THEN
    RAISE EXCEPTION '❌ السجلُّ لم يُستكمَل';
  END IF;
  RAISE NOTICE '✅ (ح) الصلاحيةُ الماليّة: مركَّبةٌ · ممنوحةٌ لـpostgres · محجوبةٌ عن anon · وسبعُ دوالٍّ بلا is_admin';
END $v_perm$;

-- (ط) ولم يُفتح سطحٌ جديدٌ للزائر المجهول بأيّ دالّةٍ أنشأتها هذه الهجرة
DO $v_anon$
DECLARE v_fn text; v_leak text := '';
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.taki_refund_cap(text)',
    'public.taki_refund_remaining(text)',
    'public.taki_booking_options_fault(text,jsonb)',
    'public._taki_hook_url_ok(text)',
    'public.taki_admin_finance()',
    'public.taki_prune_stock_parked()',
    'public.taki_stock_webhook(text,jsonb,text,timestamptz)'
  ] LOOP
    IF has_function_privilege('anon', v_fn::regprocedure::oid, 'EXECUTE') THEN
      v_leak := v_leak || v_fn || ' ';
    END IF;
  END LOOP;
  IF v_leak <> '' THEN RAISE EXCEPTION '❌ 🔴 دوالٌّ جديدةٌ ممنوحةٌ للزائر المجهول: %', v_leak; END IF;
  -- و`admin_stock_bind_parked` ممنوحةٌ للموثَّق عمداً (شاشةُ أدمن) ومحجوبةٌ عن anon
  IF has_function_privilege('anon', 'public.admin_stock_bind_parked(bigint,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION '❌ `admin_stock_bind_parked` ممنوحةٌ للزائر المجهول';
  END IF;
  RAISE NOTICE '✅ (ط) صفرُ سطحٍ جديدٍ للزائر المجهول';
END $v_anon$;


-- ════════════════════════════════════════════════════════════════════════
-- ⑪ جدولٌ للقراءة البشرية — **بعد** كلّ تحقّقٍ رافع
-- ════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS بند,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace') IS NULL
            THEN 'جدة — الإنتاج' ELSE 'مختبر ⚠️' END AS قيمة
UNION ALL SELECT 'سقفُ الاسترداد مُركَّب',
       (SELECT CASE WHEN count(*) = 2 THEN '✅' ELSE '❌' END FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname IN ('taki_refund_cap','taki_refund_remaining'))
UNION ALL SELECT 'طلباتٌ مدفوعةٌ قابلةٌ للاسترداد',
       (SELECT count(*)::text FROM public.bookings
         WHERE paid_at IS NOT NULL AND COALESCE(refund_state,'') NOT IN ('claiming','refunded'))
UNION ALL SELECT 'إشعاراتٌ دائنةٌ قائمةٌ تفوق فاتورتها',
       (SELECT count(*)::text FROM public.booking_refunds r
         WHERE r.status = 'refunded'
           AND COALESCE(r.refund_amount,0) > COALESCE(public.taki_refund_cap(r.barcode),0) + 0.011)
UNION ALL SELECT 'قاعدةُ الخيارات لكلّ المصادر',
       (SELECT CASE WHEN regexp_replace(pg_get_functiondef('public.tr_validate_booking_options()'::regprocedure),
                                        '--[^\n]*','','g') ~ 'NEW\.source'
                    THEN '❌ ما زال فيها مميِّزُ مصدر' ELSE '✅' END)
UNION ALL SELECT 'حجوزاتٌ قائمةٌ تخالف القاعدة',
       (SELECT count(*)::text FROM public.bookings b JOIN public.deals d ON d.id = b.deal_id
         WHERE b.status IN ('pending','acknowledged')
           AND public.taki_booking_options_fault(b.deal_id, b.selected_options) IS NOT NULL)
UNION ALL SELECT 'حجوزاتٌ مكتملةٌ تخالفها (لا تُمَسّ — فاتورةٌ مجمّدة)',
       (SELECT count(*)::text FROM public.bookings b
         WHERE b.status NOT IN ('pending','acknowledged')
           AND public.taki_booking_options_fault(b.deal_id, b.selected_options) IS NOT NULL)
UNION ALL SELECT 'عناوينُ خطّافٍ محفوظةٌ لا تجتاز الحارسَ الجديد',
       (SELECT count(*)::text FROM public.stock_integrations
         WHERE webhook_url IS NOT NULL AND NOT public._taki_hook_url_ok(webhook_url))
UNION ALL SELECT 'توكناتٌ محفوظةٌ جانباً بلا مُطالِب',
       (SELECT count(*)::text FROM public.stock_oauth_parked WHERE claimed_by IS NULL)
UNION ALL SELECT 'منظّفُ المحفوظة جانباً',
       (SELECT COALESCE(max(schedule), '❌ غائب') FROM cron.job WHERE jobname = 'taki-stock-parked-prune')
UNION ALL SELECT 'نسخُ `taki_stock_webhook`',
       (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'taki_stock_webhook')
UNION ALL SELECT 'عدّادُ فاتورةِ الاشتراك (الرقمُ القادم)',
       (SELECT (last_seq + 1)::text FROM public.taki_invoice_counter WHERE id)
UNION ALL SELECT 'أرقامٌ أحرقها `nextval` ولم تبلغ مستنداً',
       (SELECT (COALESCE((SELECT last_value FROM public.taki_invoice_seq),0)
                - (SELECT count(*) FROM public.subscription_payments WHERE invoice_no IS NOT NULL))::text)
UNION ALL SELECT 'دوالٌّ ماليّةٌ بلا صلاحيةٍ صريحة',
       (SELECT count(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prokind = 'f'
           AND p.proname IN ('resolve_booking_refund','get_order_invoice','get_booking_refund',
                             'get_booking_card','invoice_customer_details','confirm_subscription_payment')
           AND regexp_replace(p.prosrc,'--[^\n]*','','g') !~ 'taki_admin_finance')
UNION ALL SELECT 'أدمنٌ فرعيٌّ على الخادم (نطاقُ أثر ⑦)',
       (SELECT count(*)::text FROM public.users
         WHERE user_type = 'admin' AND NOT COALESCE(is_super_admin, false) AND deleted_at IS NULL);


-- ════════════════════════════════════════════════════════════════════════
-- -- ROLLBACK  (تُنفَّذ يداً عند الحاجة — والأسهلُ: نسخةُ ما قبل التنفيذ)
-- -- ملاحظة: كلُّ `CREATE OR REPLACE` أدناه يحتاج **النصَّ الحيَّ السابق**؛
-- -- احتفظ بمخرج `pg_get_functiondef` قبل التنفيذ، أو استعد من نسخةِ الليل.
--
-- -- القسم ⑧ — رقمُ الفاتورة (الأخطرُ رجعةً: لا تُعِد `nextval` بعد إصدارِ أرقامٍ
-- --            من العدّاد، فستُنتج تكراراً. والصحيحُ ضبطُ التسلسل أوّلاً.)
-- SELECT setval('public.taki_invoice_seq',
--               GREATEST((SELECT last_seq FROM public.taki_invoice_counter WHERE id),
--                        (SELECT COALESCE(max(invoice_no),0) FROM public.subscription_payments)), true);
-- CREATE OR REPLACE FUNCTION public.tr_assign_invoice_no() RETURNS trigger
--   LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
--   begin if new.invoice_no is null then new.invoice_no := nextval('taki_invoice_seq'); end if; return new; end $$;
-- ALTER FUNCTION public.tr_assign_invoice_no() OWNER TO postgres;
-- DROP INDEX IF EXISTS public.ux_subscription_payments_invoice_no;
-- DROP TABLE IF EXISTS public.taki_invoice_counter;
--
-- -- القسم ⑦ — إعادةُ البصمةِ الثلاثيّة (والحافةُ تنادي بالأسماء فلا تنكسر)
-- DROP FUNCTION IF EXISTS public.taki_stock_webhook(text, jsonb, text, timestamptz);
-- -- ثمّ أعِد إنشاءَ النسخةِ الثلاثيّة من النصّ المحفوظ، ثمّ:
-- -- REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO postgres, service_role;
--
-- -- القسم ⑥
-- SELECT cron.unschedule('taki-stock-parked-prune')
--  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-stock-parked-prune');
-- DROP FUNCTION IF EXISTS public.taki_prune_stock_parked();
-- DROP FUNCTION IF EXISTS public.admin_stock_bind_parked(bigint, uuid, text);
-- -- وأعِد `taki_stock_oauth_bind_salla` / `merchant_stock_claim_parked` /
-- -- `merchant_stock_parked_count` / `merchant_stock_connect_url` من النصّ المحفوظ.
-- -- 🔴 وإعادةُ فرعِ «النافذة» تُعيد فتحَ بابِ حصدِ تفويضِ تاجرٍ آخر — لا تُعَد
-- --    إلا بقرارٍ صريحٍ من ناصر.
--
-- -- القسم ⑤
-- DROP FUNCTION IF EXISTS public._taki_hook_url_ok(text);
-- -- وأعِد الكاتبين من النصّ المحفوظ (الشرطُ القديم: `!~ '^https://'` وحده).
--
-- -- القسم ④
-- -- أعِد `tr_validate_booking_options` من النصّ المحفوظ، ثمّ:
-- DROP FUNCTION IF EXISTS public.taki_booking_options_fault(text, jsonb);
-- -- 🔴 وهذا يُعيد فتحَ بابِ تخفيضِ المشتري لسعره على الويب.
--
-- -- القسم ③
-- -- أعِد `resolve_booking_refund` من النصّ المحفوظ، ثمّ:
-- DROP FUNCTION IF EXISTS public.taki_refund_remaining(text);
-- DROP FUNCTION IF EXISTS public.taki_refund_cap(text);
--
-- -- القسم ⑨
-- DELETE FROM public.admin_rpc_permissions WHERE note LIKE 'v15.80%';
-- -- أعِد الدوالَّ الستّ + `start_trial_for_merchant` من النصّ المحفوظ، ثمّ:
-- DROP FUNCTION IF EXISTS public.taki_admin_finance();
-- ════════════════════════════════════════════════════════════════════════
