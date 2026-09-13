-- ═══════════════════════════════════════════════════════════════════════════
-- JEDDAH_v14_17_merchant_tax_invoice.sql
--   فصل ضريبة مبيعات التاجر عن ضريبة اشتراكات المنصّة · لقطة ضريبية داخل
--   الفاتورة · تسلسل أرقام فواتير لكل تاجر · نسبة واحدة في مصدر واحد
--
-- ── ما كان (مقيس على جدة ١٣ سبتمبر ٢٠٢٦) ─────────────────────────────────
--  ١) مفتاح واحد `platform_settings.tax_settings` يقود **أمرين متعاكسين**:
--     ضريبة اشتراكات تاكي (بين شركتين، تُضاف فوق السعر) وضريبة طلب المشتري
--     (تجزئة، يجب أن تكون **مضمّنة** في السعر المعلن). و`prices_include_vat`
--     اليوم = false، وهو الصحيح للاشتراكات والخطأ للطلبات.
--  ٢) خللٌ حسابي نائم: في فرع «تُضاف فوق السعر» تضع `bot_get_booking_invoice`
--     الأساس = الإجمالي كاملاً والضريبة = ١٥٪ منه، والإجمالي لا يتغيّر. أي
--     أن «الأساس + الضريبة ≠ الإجمالي». **تفعيل الضريبة وحده يُخرج فواتير
--     خاطئة بلا نشر أي كود.**
--  ٣) ثلاث نسخ مستقلّة من الحساب تختلف: الموقع يثبّت ١٥٪ مضمّنة ولا يقرأ
--     الإعدادات إطلاقاً · ملفّ PDF للبوتين **يتجاهل** أرقام القاعدة ويعيد
--     الحساب مضمّناً · والقاعدة تتبع `add_on_top`. فالمستند الذي يصل التاجر
--     يخالف ما تقوله القاعدة عن الطلب نفسه.
--  ٤) ثلاثة تعريفات مختلفة لـ«هل التاجر مسجَّل ضريبياً»: القاعدة تقبل أي نصّ
--     غير فارغ، والموقع وPDF يشترطان الصيغة `3…3` بخمسة عشر رقماً.
--  ٥) لا لقطة إطلاقاً: كل فاتورة تُعاد حساباتها من الإعدادات **الحيّة** لحظة
--     الطباعة. فتعديل التاجر لرقمه الضريبي أو اسمه يُعيد كتابة كل فاتورة
--     قديمة بأثر رجعي، ولا أثر لما طُبع فعلاً.
--  ٦) لا رقم فاتورة لطلبات المشترين أصلاً — المعرّف باركود عشوائي. والتسلسل
--     الوحيد الموجود (`taki_invoice_seq`) عامٌّ للاشتراكات، وفيه فجوات فعلية
--     (الرقمان ١ و٢ غير موجودين) وبلا فهرس تفرُّد.
--
-- ── العلاج ────────────────────────────────────────────────────────────────
--  • مفتاح جديد `merchant_vat` لنسبة ضريبة **طلبات التجار** وحدها، و
--    `tax_settings` يبقى لضريبة اشتراكات تاكي. لا يقرأ أحدهما مكان الآخر.
--  • ظهور الضريبة على فاتورة الطلب مربوط **برقم التاجر الضريبي وحده** —
--    لا بمفتاح المنصّة. فتاجرٌ مسجَّل يُصدر فاتورته الضريبية سواء سجّلت تاكي
--    أم لا، والعكس. (البائع في هذا العقد هو التاجر لا المنصّة.)
--  • طلبات التجزئة **مضمّنة الضريبة دائماً** — لا خيار «تُضاف فوق السعر»
--    للطلبات، فيسقط الخلل الحسابي من أصله.
--  • قاعدة الصيغة `^3[0-9]{13}3$` صارت دالّة واحدة تقرأها كل الجهات.
--  • جدول `order_invoices`: **لقطة مجمّدة** لكل طلب (النسبة، الأساس، الضريبة،
--    اسم البائع ورقمه الضريبي وسجلّه وعنوانه) تُكتب لحظة الحجز.
--  • رقم فاتورة **متسلسل لكل تاجر** يُخصَّص لحظة اكتمال الطلب أو دفعه، من
--    عدّاد ذرّي (لا فجوات عند التراجع، ولا تصادم بين تاجرين).
--
-- آمنة للتكرار (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

DO $guard$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
     LIKE 'TAKI_LAB_TOKYO%' THEN
    RAISE EXCEPTION
      'REFUSED: this migration targets the Jeddah production server, but this database is the Tokyo lab (%).',
      obj_description('public'::regnamespace, 'pg_namespace');
  END IF;
END
$guard$;

BEGIN;

-- ═══ ١) نسبة ضريبة طلبات التجار — مفتاح مستقلّ عن اشتراكات المنصّة ════════
INSERT INTO public.platform_settings (key, value, description)
VALUES (
  'merchant_vat',
  '{"rate": 15}'::jsonb,
  'نسبة ضريبة القيمة المضافة على **طلبات التجار** (تجزئة، مضمّنة في السعر). مستقلّة تماماً عن tax_settings التي تخصّ ضريبة اشتراكات تاكي.'
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.taki_merchant_vat_rate()
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT GREATEST(0, LEAST(100, COALESCE(
    (SELECT NULLIF(value->>'rate','')::numeric FROM public.platform_settings WHERE key = 'merchant_vat'),
    15)));
$fn$;

REVOKE ALL ON FUNCTION public.taki_merchant_vat_rate() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taki_merchant_vat_rate() TO anon, authenticated, service_role;

-- النسبة رقمٌ نظاميٌّ عامّ (١٥٪ اليوم) لا سرّ فيه، وحاسبة التاجر في لوحته
-- تعرضه. 🪤 قائمة السماح صريحة: مفتاحٌ غائب عنها يُقرأ صفر صفوف بلا أي خطأ
-- ظاهر فيقع الموقع على افتراضاته (ما وقع في v14.10b).
DROP POLICY IF EXISTS platform_settings_select ON public.platform_settings;
CREATE POLICY platform_settings_select ON public.platform_settings
  FOR SELECT USING (
    key = ANY (ARRAY[
      'oauth_google_enabled','oauth_apple_enabled','telegram_bot_enabled',
      'whatsapp_bot_enabled','whatsapp_bot_number','seasonal_theme',
      'season_campaign','sponsor_layout','banner_autoplay_seconds',
      'payment_gateway_enabled','tax_settings','location_packages',
      'booking_holds','vapid_public_key','merchant_vat'
    ])
    OR (SELECT public.is_admin())
  );

-- ═══ ٢) «هل هذا رقم ضريبي سعودي؟» — تعريفٌ واحد لا ثلاثة ══════════════════
-- خمسة عشر رقماً تبدأ بـ٣ وتنتهي بـ٣ (نفس القاعدة في zatcaQr.ts و invoicePdf.js).
CREATE OR REPLACE FUNCTION public.taki_is_saudi_vat(p_vat text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT COALESCE(btrim(p_vat), '') ~ '^3[0-9]{13}3$';
$fn$;

REVOKE ALL ON FUNCTION public.taki_is_saudi_vat(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.taki_is_saudi_vat(text) TO anon, authenticated, service_role;

-- ═══ ٣) عدّاد أرقام الفواتير — لكل تاجر تسلسله ════════════════════════════
-- في جدولٍ مستقلّ لا في `store_profiles`: تخصيص الرقم يقفل الصفّ، ولا نريد
-- قفل صفّ فيه إعدادات المتجر كلها (التوصيل والاشتراك والبوابة) على كل فاتورة.
CREATE TABLE IF NOT EXISTS public.store_invoice_counters (
  store_id  text PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  last_seq  integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.store_invoice_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.store_invoice_counters FROM PUBLIC;
REVOKE ALL ON TABLE public.store_invoice_counters FROM anon;
REVOKE ALL ON TABLE public.store_invoice_counters FROM authenticated;
GRANT ALL ON TABLE public.store_invoice_counters TO service_role;

-- ═══ ٤) الفاتورة: لقطة مجمّدة لكل طلب ═════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.order_invoices (
  barcode     text PRIMARY KEY REFERENCES public.bookings(barcode) ON DELETE CASCADE,
  store_id    text NOT NULL,
  buyer_id    text,
  seq         integer,          -- NULL = لم يُصدر رقمها بعد
  invoice_no  text,             -- NULL = مسودّة (سند طلب لا فاتورة ضريبية)
  issued_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  currency    text NOT NULL DEFAULT 'SAR',
  total       numeric NOT NULL DEFAULT 0,
  vat_rate    numeric,          -- NULL = التاجر لم يكن مسجَّلاً وقت البيع
  vat_base    numeric,
  vat_amount  numeric,
  seller      jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT order_invoices_seq_per_store UNIQUE (store_id, seq),
  CONSTRAINT order_invoices_no_per_store  UNIQUE (store_id, invoice_no),
  CONSTRAINT order_invoices_sane CHECK (
    total >= 0 AND total <= 1000000
    AND (vat_rate IS NULL OR (vat_rate >= 0 AND vat_rate <= 100))
    AND (vat_amount IS NULL OR vat_amount >= 0)
    AND (vat_base IS NULL OR vat_base >= 0)
  )
);

COMMENT ON TABLE public.order_invoices IS
  'لقطة الفاتورة وقت البيع: النسبة والأساس والضريبة وبيانات البائع. لا يُعاد حسابها أبداً من الإعدادات الحيّة.';

CREATE INDEX IF NOT EXISTS idx_order_invoices_store ON public.order_invoices (store_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_invoices_buyer ON public.order_invoices (buyer_id, created_at DESC);

ALTER TABLE public.order_invoices ENABLE ROW LEVEL SECURITY;
-- القراءة لطرفَي الطلب والإدارة. الكتابة لدوال الخادم وحدها (لا سياسة كتابة).
DROP POLICY IF EXISTS order_invoices_select_parties ON public.order_invoices;
CREATE POLICY order_invoices_select_parties ON public.order_invoices
  FOR SELECT USING (
    (SELECT auth.uid()::text) = buyer_id
    OR (SELECT auth.uid()::text) = store_id
    OR (SELECT public.is_admin())
  );
-- 🪤 الامتيازات الافتراضية تمنح `anon` قراءةَ كل جدول جديد. السياسة تحميه
-- (تشترط هوية)، لكن الحاجز الأول يجب أن يكون المنع لا السياسة وحدها.
REVOKE ALL ON TABLE public.order_invoices FROM PUBLIC;
REVOKE ALL ON TABLE public.order_invoices FROM anon;
GRANT SELECT ON TABLE public.order_invoices TO authenticated;
GRANT ALL ON TABLE public.order_invoices TO service_role;

-- ═══ ٥) كتابة المسودّة لحظة الحجز ═════════════════════════════════════════
-- بعد الإدراج لا قبله: المفتاح الأجنبي يشترط وجود صفّ الحجز.
CREATE OR REPLACE FUNCTION public.tr_af_order_invoice_draft()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_total  numeric;
  v_rate   numeric;
  v_base   numeric;
  v_vat    numeric;
  v_vat_no text;
  v_cr     text;
  v_addr   text;
  v_name   text;
BEGIN
  v_total := round(COALESCE(NEW.total_amount, 0), 2);

  SELECT sp.vat_number, sp.cr_number, sp.address
    INTO v_vat_no, v_cr, v_addr
    FROM public.store_profiles sp WHERE sp.store_id = NEW.store_id;

  SELECT COALESCE(NULLIF(u.shop, ''), u.name)
    INTO v_name
    FROM public.users u WHERE u.id = NEW.store_id;

  -- الضريبة تظهر **برقم التاجر وحده**. ولا خيار «فوق السعر» في التجزئة:
  -- السعر المعلن للمستهلك شامل الضريبة، فالضريبة تُستخرج منه لا تُضاف إليه.
  IF public.taki_is_saudi_vat(v_vat_no) AND v_total > 0 THEN
    v_rate := public.taki_merchant_vat_rate();
    v_base := round(v_total / (1 + v_rate / 100), 2);
    v_vat  := round(v_total - v_base, 2);
  END IF;

  INSERT INTO public.order_invoices
    (barcode, store_id, buyer_id, total, vat_rate, vat_base, vat_amount, seller)
  VALUES (
    NEW.barcode, NEW.store_id, NEW.user_id, v_total, v_rate, v_base, v_vat,
    jsonb_strip_nulls(jsonb_build_object(
      'name',       NULLIF(btrim(COALESCE(v_name, '')), ''),
      'vat_number', NULLIF(btrim(COALESCE(v_vat_no, '')), ''),
      'cr_number',  NULLIF(btrim(COALESCE(v_cr, '')), ''),
      'address',    NULLIF(btrim(COALESCE(v_addr, '')), '')
    )))
  ON CONFLICT (barcode) DO NOTHING;

  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS tr_af_order_invoice_draft ON public.bookings;
CREATE TRIGGER tr_af_order_invoice_draft
  AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tr_af_order_invoice_draft();

-- ═══ ٦) تخصيص رقم الفاتورة — ذرّي وبلا فجوات ══════════════════════════════
CREATE OR REPLACE FUNCTION public.taki_issue_order_invoice(p_barcode text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_store text;
  v_no    text;
  v_seq   integer;
BEGIN
  SELECT store_id, invoice_no INTO v_store, v_no
    FROM public.order_invoices WHERE barcode = p_barcode FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_no IS NOT NULL THEN RETURN v_no; END IF;   -- أُصدرت من قبل: لا تُصدر مرّتين

  -- عدّاد التاجر. `ON CONFLICT DO UPDATE` يقفل الصفّ فيتسلسل تاجران معاً بلا
  -- تصادم، وتراجُع المعاملة يُعيد الرقم فلا تنشأ فجوة.
  INSERT INTO public.store_invoice_counters (store_id, last_seq)
  VALUES (v_store, 1)
  ON CONFLICT (store_id) DO UPDATE
    SET last_seq = public.store_invoice_counters.last_seq + 1,
        updated_at = now()
  RETURNING last_seq INTO v_seq;

  v_no := 'TK-' || lpad(v_seq::text, 6, '0');

  UPDATE public.order_invoices
     SET seq = v_seq, invoice_no = v_no, issued_at = now()
   WHERE barcode = p_barcode;

  RETURN v_no;
END
$fn$;

REVOKE ALL ON FUNCTION public.taki_issue_order_invoice(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_issue_order_invoice(text) FROM anon;
REVOKE ALL ON FUNCTION public.taki_issue_order_invoice(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.taki_issue_order_invoice(text) TO service_role;

-- الرقم يُخصَّص عند توريدٍ حقيقي: اكتمال الطلب أو دفعه إلكترونياً. الطلب الذي
-- انتهت مهلته أو أُلغي قبل الاستلام لا فاتورة ضريبية له — لأنه لم يقع بيع.
CREATE OR REPLACE FUNCTION public.tr_zy_issue_order_invoice()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
     OR (NEW.paid_at IS NOT NULL AND OLD.paid_at IS NULL) THEN
    PERFORM public.taki_issue_order_invoice(NEW.barcode);
  END IF;
  RETURN NULL;
END
$fn$;

DROP TRIGGER IF EXISTS tr_zy_issue_order_invoice ON public.bookings;
CREATE TRIGGER tr_zy_issue_order_invoice
  AFTER UPDATE OF status, paid_at ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tr_zy_issue_order_invoice();

-- ═══ ٧) القارئ الموحَّد — الموقع والبوتان يقرآن هذا وحده ══════════════════
CREATE OR REPLACE FUNCTION public.get_order_invoice(p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_me  text := (SELECT auth.uid()::text);
  v_row public.order_invoices%ROWTYPE;
BEGIN
  IF v_me IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO v_row FROM public.order_invoices WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_me <> COALESCE(v_row.buyer_id, '') AND v_me <> v_row.store_id AND NOT public.is_admin() THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'barcode',    v_row.barcode,
    'invoice_no', v_row.invoice_no,
    'issued_at',  v_row.issued_at,
    'currency',   v_row.currency,
    'total',      v_row.total,
    'vat_rate',   v_row.vat_rate,
    'vat_base',   v_row.vat_base,
    'vat_amount', v_row.vat_amount,
    'seller',     v_row.seller);
END
$fn$;

REVOKE ALL ON FUNCTION public.get_order_invoice(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_order_invoice(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_order_invoice(text) TO authenticated, service_role;

COMMIT;

-- ═══ ٨) فاتورة البوتين تقرأ اللقطة ════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.bot_get_booking_invoice(p_uid text, p_barcode text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_b       public.bookings%ROWTYPE;
  v_d       public.deals%ROWTYPE;
  v_is_buyer  boolean;
  v_is_seller boolean;
  v_vat     jsonb;
  v_vat_no  text;
  v_cr      text;
  v_total   numeric;
  v_rate    numeric;
  v_base    numeric;
  v_tax     numeric;
  v_items   jsonb := '[]'::jsonb;
  v_sel     jsonb;
  v_row     jsonb;
  v_grp     jsonb;
  v_choice  jsonb;
  v_label   text;
  v_has_variant boolean := false;
  v_loc_name text;
  v_shop    text;
  v_buyer_note text;
  v_inv     public.order_invoices%ROWTYPE;
BEGIN
  IF NOT public._bot_gate_ok() THEN RAISE EXCEPTION 'GATE'; END IF;

  SELECT * INTO v_b FROM public.bookings WHERE barcode = upper(btrim(p_barcode));
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  v_is_buyer  := v_b.user_id IS NOT DISTINCT FROM p_uid;
  v_is_seller := v_b.store_id IS NOT DISTINCT FROM p_uid;
  IF NOT (v_is_buyer OR v_is_seller) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  SELECT * INTO v_d FROM public.deals WHERE id = v_b.deal_id;
  SELECT coalesce(nullif(v_d.shop_name,''), nullif(u.shop,''), u.name) INTO v_shop FROM public.users u WHERE u.id = v_b.store_id;

  -- ── الإجمالي ──────────────────────────────────────────────────────────────
  -- v14.11 — الرقم من العمود الذي كتبه الخادم لحظة الحجز: هو نفسه الذي يُطالَب
  -- به الدفع الإلكتروني، فلا تفترق الفاتورة عن المقبوض. القراءة من الملاحظات
  -- بقيت للحجوزات القديمة وحدها (ما قبل الهجرة)، ثم إعادة حساب كملاذ أخير.
  SELECT * INTO v_inv FROM public.order_invoices WHERE barcode = v_b.barcode;

  v_total := COALESCE(
    NULLIF(v_inv.total, 0),
    NULLIF(v_b.paid_amount, 0),
    v_b.total_amount,
    NULLIF(substring(coalesce(v_b.notes, '') FROM 'الإجمالي:\s*([0-9]+(?:\.[0-9]+)?)'), '')::numeric,
    (public.taki_booking_amount(v_b.deal_id, v_b.booked_quantity, v_b.selected_options, v_b.delivery_fee)->>'total')::numeric);

  -- ── الضريبة: من **لقطة الفاتورة** لا من الإعدادات الحيّة (v14.17) ─────────
  -- كانت تُحسب هنا من دالّة وضع ضريبة **اشتراكات تاكي** ومن رقم التاجر
  -- الضريبي **الحالي**. فكان: (أ) تاجرٌ مسجَّل لا تظهر ضريبته حتى تسجّل تاكي،
  -- (ب) وتعديلُ رقمه لاحقاً يُعيد كتابة كل فاتورة قديمة بأثر رجعي،
  -- (ج) وفرع «تُضاف فوق السعر» كان يُخرج «أساس + ضريبة ≠ إجمالي».
  -- اليوم: الأرقام مجمّدة في `order_invoices` لحظة البيع، ومضمّنة دائماً.
  v_vat_no := NULLIF(btrim(COALESCE(v_inv.seller->>'vat_number', '')), '');
  v_cr     := NULLIF(btrim(COALESCE(v_inv.seller->>'cr_number', '')), '');
  v_rate   := v_inv.vat_rate;
  v_base   := v_inv.vat_base;
  v_tax    := v_inv.vat_amount;

  -- ── العناصر: الأنواع (بدل الصنف الأساسي) والإضافات — كل عنصر برمز كاشيره ─
  v_sel := CASE WHEN jsonb_typeof(coalesce(v_b.selected_options, 'null'::jsonb)) = 'array'
                THEN v_b.selected_options ELSE '[]'::jsonb END;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_sel) LOOP
    IF v_row->>'g' = '__variant__' THEN
      SELECT vv INTO v_choice
        FROM jsonb_array_elements(coalesce(v_d.variants, '[]'::jsonb)) vv
       WHERE vv->>'id' = v_row->>'c' LIMIT 1;
      v_label := coalesce(v_choice->>'label', v_row->>'c');
      v_has_variant := true;
      v_items := v_items || jsonb_build_object(
        'label', v_label,
        'qty',   coalesce((v_row->>'qty')::int, 1),
        'sku',   nullif(btrim(coalesce(v_choice->>'posSku','')),''),
        'kind',  'variant');
    ELSE
      SELECT gg INTO v_grp
        FROM jsonb_array_elements(coalesce(v_d.options, '[]'::jsonb)) gg
       WHERE gg->>'id' = v_row->>'g' LIMIT 1;
      SELECT cc INTO v_choice
        FROM jsonb_array_elements(coalesce(v_grp->'choices', '[]'::jsonb)) cc
       WHERE cc->>'id' = v_row->>'c' LIMIT 1;
      IF v_choice IS NULL THEN CONTINUE; END IF;
      v_label := CASE WHEN v_grp->>'title' IS NOT NULL
                      THEN (v_grp->>'title') || ': ' || coalesce(v_choice->>'label', '')
                      ELSE coalesce(v_choice->>'label', '') END;
      v_items := v_items || jsonb_build_object(
        'label', v_label,
        'qty',   coalesce((v_row->>'qty')::int, 1),
        'sku',   nullif(btrim(coalesce(v_choice->>'posSku','')),''),
        'kind',  'addon');
    END IF;
  END LOOP;

  -- الصنف الأساسي يُطبع كعنصر (برمز كاشيره) فقط حين لا أنواع — كالموقع تماماً
  IF NOT v_has_variant THEN
    v_items := jsonb_build_array(jsonb_build_object(
      'label', v_d.item_name, 'qty', coalesce(v_b.booked_quantity, 1),
      'sku', nullif(btrim(coalesce(v_d.pos_sku,'')),''), 'kind', 'main')) || v_items;
  END IF;

  -- اسم الفرع المختار (عرض متعدد المواقع)
  IF v_b.location_id IS NOT NULL AND jsonb_typeof(coalesce(v_d.locations,'null'::jsonb)) = 'array' THEN
    SELECT nullif(e->>'name','') INTO v_loc_name FROM jsonb_array_elements(v_d.locations) e
     WHERE e->>'id' = v_b.location_id LIMIT 1;
  END IF;

  -- ملاحظة المشتري الحرّة (بعد 📝 وقبل سطر 💰) — نفس منطق الموقع
  v_buyer_note := nullif(btrim(coalesce(substring(coalesce(v_b.notes,'') FROM '📝\s*([^\n]*(?:\n(?!💰)[^\n]*)*)'), '')), '');

  RETURN jsonb_build_object(
    'ok',            true,
    'role',          CASE WHEN v_is_seller THEN 'seller' ELSE 'buyer' END,
    'barcode',       v_b.barcode,
    'backup_code',   v_b.backup_code,
    'status',        v_b.status,
    'cancelled_by',  v_b.cancelled_by,
    'item_name',     v_d.item_name,
    'main_sku',      nullif(btrim(coalesce(v_d.pos_sku,'')),''),
    'shop_name',     v_shop,
    'store_id',      v_b.store_id,
    'quantity',      v_b.booked_quantity,
    'unit_price',    v_d.discounted_price,
    'original_price',v_d.original_price,
    'total',         v_total,
    'total_source',  CASE WHEN v_inv.total IS NOT NULL AND v_inv.total > 0 THEN 'invoice'
                          WHEN v_b.paid_amount > 0          THEN 'paid'
                          WHEN v_b.total_amount IS NOT NULL THEN 'order'
                          WHEN v_b.notes ~ 'الإجمالي:'    THEN 'order'
                          ELSE 'estimate' END,
    'invoice_no',    v_inv.invoice_no,
    'issued_at',     v_inv.issued_at,
    'seller_name',   COALESCE(v_inv.seller->>'name', v_shop),
    'seller_address',v_inv.seller->>'address',
    'vat_number',    v_vat_no,
    'cr_number',     v_cr,
    'vat_rate',      v_rate,
    'vat_base',      v_base,
    'vat_amount',    v_tax,
    'paid',          v_b.paid_at IS NOT NULL,
    'paid_amount',   v_b.paid_amount,
    'payment_method',v_b.payment_method,
    'items',         v_items,
    'buyer_name',    CASE WHEN v_is_seller THEN v_b.user_name ELSE NULL END,
    'buyer_phone',   CASE WHEN v_is_seller THEN v_b.user_phone ELSE NULL END,
    'prep_time',     v_b.prep_time,
    'notes',         v_b.notes,
    'buyer_note',    v_buyer_note,
    'merchant_note', v_b.merchant_note,
    'location_name', v_loc_name,
    'fulfillment',   coalesce(v_b.fulfillment, 'pickup'),
    'delivery_fee',  v_b.delivery_fee,
    'delivery',      v_b.delivery_address,
    'booked_at',     v_b.booked_at,
    'completed_at',  v_b.completed_at
  );
END;
$fn$;

COMMIT;

-- ═══ ٩) تعبئة الطلبات القائمة ═════════════════════════════════════════════
BEGIN;

-- مسودّة لكل حجز قديم. لا تاجر مسجَّل ضريبياً اليوم (٠ من ٣)، فكل هذه اللقطات
-- تُكتب بلا ضريبة — وهو الصحيح: لم تُحصَّل ضريبة على تلك الطلبات فعلاً.
INSERT INTO public.order_invoices
  (barcode, store_id, buyer_id, created_at, total, vat_rate, vat_base, vat_amount, seller)
SELECT b.barcode, b.store_id, b.user_id, b.created_at,
       round(COALESCE(b.total_amount, 0), 2),
       CASE WHEN public.taki_is_saudi_vat(sp.vat_number) AND COALESCE(b.total_amount,0) > 0
            THEN public.taki_merchant_vat_rate() END,
       CASE WHEN public.taki_is_saudi_vat(sp.vat_number) AND COALESCE(b.total_amount,0) > 0
            THEN round(b.total_amount / (1 + public.taki_merchant_vat_rate()/100), 2) END,
       CASE WHEN public.taki_is_saudi_vat(sp.vat_number) AND COALESCE(b.total_amount,0) > 0
            THEN round(b.total_amount - round(b.total_amount / (1 + public.taki_merchant_vat_rate()/100), 2), 2) END,
       jsonb_strip_nulls(jsonb_build_object(
         'name',       NULLIF(btrim(COALESCE(NULLIF(u.shop,''), u.name, '')), ''),
         'vat_number', NULLIF(btrim(COALESCE(sp.vat_number, '')), ''),
         'cr_number',  NULLIF(btrim(COALESCE(sp.cr_number, '')), ''),
         'address',    NULLIF(btrim(COALESCE(sp.address, '')), '')))
  FROM public.bookings b
  LEFT JOIN public.store_profiles sp ON sp.store_id = b.store_id
  LEFT JOIN public.users u           ON u.id        = b.store_id
 WHERE NOT EXISTS (SELECT 1 FROM public.order_invoices oi WHERE oi.barcode = b.barcode)
 ORDER BY b.created_at;

-- ثم تخصيص الأرقام للطلبات التي وقع فيها بيعٌ فعلاً — **بالترتيب الزمني**
-- لكل تاجر، فيقرأ تسلسلُه كتاريخٍ لا كعشوائية.
DO $backfill$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT oi.barcode
      FROM public.order_invoices oi
      JOIN public.bookings b ON b.barcode = oi.barcode
     WHERE oi.invoice_no IS NULL
       AND (b.status = 'completed' OR b.paid_at IS NOT NULL)
     ORDER BY b.store_id, COALESCE(b.completed_at, b.created_at), b.barcode
  LOOP
    PERFORM public.taki_issue_order_invoice(r.barcode);
  END LOOP;
END
$backfill$;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- جدول التحقّق — أوّل سطر فيه اسم الخادم
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS "الفحص",
       COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'standard public schema') AS "النتيجة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'') NOT LIKE 'TAKI_LAB_TOKYO%'
            THEN '✅ جدة (إنتاج)' ELSE '❌ المختبر' END AS "الحالة";

SELECT 'مفتاح ضريبة طلبات التجار مستقلّ' AS "الفحص",
       COALESCE((SELECT value::text FROM public.platform_settings WHERE key='merchant_vat'),'—')
       || '  ·  اشتراكات المنصّة: ' ||
       COALESCE((SELECT (value->>'vat_enabled') FROM public.platform_settings WHERE key='tax_settings'),'—') AS "النتيجة",
       CASE WHEN EXISTS (SELECT 1 FROM public.platform_settings WHERE key='merchant_vat') THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'فاتورة لكل حجز' AS "الفحص",
       (SELECT count(*) FROM public.order_invoices)::text || '/' || (SELECT count(*) FROM public.bookings)::text AS "النتيجة",
       CASE WHEN (SELECT count(*) FROM public.order_invoices) = (SELECT count(*) FROM public.bookings)
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'أرقام الفواتير: البيع المكتمل مرقَّم' AS "الفحص",
       (SELECT count(*) FROM public.order_invoices WHERE invoice_no IS NOT NULL)::text || ' مرقَّمة من ' ||
       (SELECT count(*) FROM public.bookings WHERE status='completed' OR paid_at IS NOT NULL)::text || ' بيعاً' AS "النتيجة",
       CASE WHEN (SELECT count(*) FROM public.order_invoices WHERE invoice_no IS NOT NULL)
               = (SELECT count(*) FROM public.bookings WHERE status='completed' OR paid_at IS NOT NULL)
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'تسلسل كل تاجر متّصل بلا فجوة' AS "الفحص",
       COALESCE(string_agg(z.store_id || '=' || z.n || '/' || z.mx, ' · '), 'لا فواتير') AS "النتيجة",
       CASE WHEN COALESCE(bool_and(z.n = z.mx), true) THEN '✅' ELSE '❌' END AS "الحالة"
  FROM (SELECT left(store_id, 8) AS store_id, count(*) AS n, max(seq) AS mx
          FROM public.order_invoices WHERE seq IS NOT NULL GROUP BY store_id) z;

SELECT 'الطلب غير المكتمل بلا رقم فاتورة' AS "الفحص",
       count(*)::text || ' مخالِف' AS "النتيجة",
       CASE WHEN count(*) = 0 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM public.order_invoices oi JOIN public.bookings b ON b.barcode = oi.barcode
 WHERE oi.invoice_no IS NOT NULL AND b.status <> 'completed' AND b.paid_at IS NULL;

SELECT 'الأساس + الضريبة = الإجمالي (الخلل القديم)' AS "الفحص",
       count(*)::text || ' منحرف' AS "النتيجة",
       CASE WHEN count(*) = 0 THEN '✅' ELSE '❌' END AS "الحالة"
  FROM public.order_invoices
 WHERE vat_amount IS NOT NULL AND abs((vat_base + vat_amount) - total) > 0.011;

SELECT 'فاتورة البوتين تقرأ اللقطة لا الإعدادات' AS "الفحص",
       CASE WHEN pg_get_functiondef('public.bot_get_booking_invoice(text,text)'::regprocedure) LIKE '%order_invoices%'
             AND pg_get_functiondef('public.bot_get_booking_invoice(text,text)'::regprocedure) NOT LIKE '%bot_vat_mode%'
            THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_functiondef('public.bot_get_booking_invoice(text,text)'::regprocedure) LIKE '%order_invoices%'
             AND pg_get_functiondef('public.bot_get_booking_invoice(text,text)'::regprocedure) NOT LIKE '%bot_vat_mode%'
            THEN '✅' ELSE '❌' END AS "الحالة";

SELECT 'anon ممنوع من تخصيص رقم فاتورة' AS "الفحص",
       CASE WHEN has_function_privilege('anon','public.taki_issue_order_invoice(text)','EXECUTE')
              OR has_function_privilege('authenticated','public.taki_issue_order_invoice(text)','EXECUTE')
            THEN 'يملكها' ELSE 'ممنوع' END AS "النتيجة",
       CASE WHEN has_function_privilege('anon','public.taki_issue_order_invoice(text)','EXECUTE')
              OR has_function_privilege('authenticated','public.taki_issue_order_invoice(text)','EXECUTE')
            THEN '❌' ELSE '✅' END AS "الحالة";

SELECT 'المتصفّح يقرأ نسبة ضريبة التجار' AS "الفحص",
       CASE WHEN pg_get_expr(polqual, polrelid) LIKE '%merchant_vat%' THEN 'نعم' ELSE 'لا' END AS "النتيجة",
       CASE WHEN pg_get_expr(polqual, polrelid) LIKE '%merchant_vat%' THEN '✅' ELSE '❌' END AS "الحالة"
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
 WHERE c.relname = 'platform_settings' AND p.polname = 'platform_settings_select';

SELECT 'الزائر لا يقرأ الفواتير' AS "الفحص",
       CASE WHEN has_table_privilege('anon','public.order_invoices','SELECT') THEN 'يقرأ' ELSE 'ممنوع' END AS "النتيجة",
       CASE WHEN has_table_privilege('anon','public.order_invoices','SELECT') THEN '❌' ELSE '✅' END AS "الحالة";
