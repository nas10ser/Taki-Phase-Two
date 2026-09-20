-- ════════════════════════════════════════════════════════════════════════════
-- v14.68c — البوت يقرأ الرمز أيضاً · ورقم فاتورة الاشتراك واحدٌ لا اثنان
-- ════════════════════════════════════════════════════════════════════════════
-- تكملة v14.68/v14.68b. بعدها لا يبقى في المستودع مُرمِّزٌ لرمز زاتكا لفاتورة
-- طلب: الموقع والبوتان يقرؤون `zatca_tlv` من نفس اللقطة المجمّدة.
--
-- وفيها إصلاحٌ قِيس اليوم على جدة: **فاتورة الاشتراك الواحدة تحمل رقمين**.
-- البريد الذي يرسله المشغّل يطبع `INV-<معرّف الصفّ>` بينما الصفحة المطبوعة
-- تطبع `INV-000003` من `invoice_no` — أي أن التاجر يملك ورقتين برقمين
-- مختلفين لنفس العملية، وهو كسرٌ لتسلسلٍ ضريبيّ يُفترض ألّا يُكسر.
-- قِيس: صفّان، وكلاهما `invoice_no` غير فارغ (٣ و٤) — فالاختلاف واقعٌ لا احتمال.
-- 🪤 `tr_invoice_no` مشغّل BEFORE INSERT و`tr_notify_subscription_invoice`
--    مشغّل AFTER — فـ`NEW.invoice_no` مملوءة لحظة البريد (فُحص الترتيب).
--
-- 🪤 التواقيع لم تتغيّر في الدوال الثلاث فـ`CREATE OR REPLACE` آمنة. ولو أُضيف
--    معاملٌ لوجب `DROP` أولاً وإلا صار النداء ملتبساً وسكت البوتان.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'رُفض: هذا خادم المختبر (طوكيو) — هجرات الإنتاج تُطبَّق على جدة';
  END IF;
END $guard$;

BEGIN;

-- ١) فاتورة البوتين: الرمز يأتي جاهزاً ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bot_get_booking_invoice(p_uid text, p_barcode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_rf      public.booking_refunds%ROWTYPE;
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
  -- v14.21 — بيانات الاسترداد في نفس النداء: الإشعار الدائن يجب أن يظهر على
  -- ورقة الفاتورة، وإلا بقيت تقول «مدفوع» عن مالٍ عاد لصاحبه.
  SELECT * INTO v_rf FROM public.booking_refunds WHERE barcode = v_b.barcode;

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
    'refund_status',   v_rf.status,
    'credit_note_no',  v_rf.credit_note_no,
    'refund_amount',   v_rf.refund_amount,
    'refund_ref',      v_rf.refund_ref,
    'refunded_at',     v_rf.refunded_at,
    'invoice_no',    v_inv.invoice_no,
    'issued_at',     v_inv.issued_at,
    'seller_name',   COALESCE(v_inv.seller->>'name', v_shop),
    'seller_address',v_inv.seller->>'address',
    'vat_number',    v_vat_no,
    'cr_number',     v_cr,
    'vat_rate',      v_rate,
    'vat_base',      v_base,
    'vat_amount',    v_tax,
    -- v14.68 — رمز زاتكا يُرمَّز في القاعدة: كانت نسخة في الموقع ونسخة في البوت
    -- تختلفان لاسمٍ بائعٍ أطول من ٢٥٥ بايتاً، أي رمزان لمستندٍ ضريبيّ واحد.
    -- 🪤 الشرط `v_inv.total > 0` ليس زينة: `v_total` أعلاه يرتدّ إلى مصادر أخرى
    --    حين تكون اللقطة صفراً، فيصير المطبوع غير المرمَّز على نفس الورقة.
    'zatca_tlv',     CASE
                       WHEN v_tax IS NULL OR v_vat_no IS NULL
                         OR COALESCE(v_inv.total, 0) <= 0 THEN NULL
                       ELSE public.taki_zatca_tlv(
                              COALESCE(v_inv.seller->>'name', v_shop, ''),
                              v_vat_no,
                              to_char(COALESCE(v_inv.issued_at, v_inv.created_at, now())
                                        AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                              to_char(v_inv.total,  'FM9999999990.00'),
                              to_char(v_tax,        'FM9999999990.00'))
                     END,
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
$function$;

-- ٢) فاتورة الموقع: نفس الحارس حرفياً (`total > 0`) ──────────────────────────
-- v14.68b كانت ترمّز كلّما وُجدت ضريبةٌ ورقمٌ ضريبي. لكن الطرف الآخر يرتدّ إلى
-- مصدرٍ آخر للإجمالي حين تكون اللقطة صفراً — فيختلف المطبوع عن المرمَّز على
-- ورقةٍ واحدة. الشرط هنا يجعل الرمز دالّةً خالصة في صفّ اللقطة وحده، فيخرج
-- **نفس النصّ** من القارئَين لنفس الباركود.
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
  IF v_me <> COALESCE(v_row.buyer_id, '') AND v_me <> v_row.store_id AND NOT public.is_admin() THEN
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

-- ٣) رقم فاتورة الاشتراك في البريد = الرقم المطبوع نفسه ─────────────────────
CREATE OR REPLACE FUNCTION public.notify_subscription_invoice()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s jsonb; v_tax jsonb; v_name text;
  v_vat_on boolean; v_rate numeric; v_incl boolean;
  v_gross numeric; v_vat numeric; v_net numeric; v_total numeric;
  v_entity text; v_period text; v_title text; v_body text; v_html text;
  vars jsonb;
BEGIN
  IF NEW.merchant_id IS NOT NULL AND (
       (TG_OP = 'INSERT' AND NEW.status = 'paid')
    OR (TG_OP = 'UPDATE' AND NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')
  ) THEN
    s := public.taki_msg_setting('sub_new');
    IF NOT COALESCE((s->>'enabled')::boolean, true)
       OR NOT COALESCE((s->'channels'->>'email')::boolean, false) THEN
      RETURN NEW;   -- in-app activation notice comes from the store_profiles trigger
    END IF;

    SELECT u.name INTO v_name FROM users u WHERE u.id = NEW.merchant_id;
    vars := jsonb_build_object(
      'store',   COALESCE(v_name,''),
      'plan',    COALESCE(NEW.plan_id, CASE WHEN COALESCE(NEW.branches_count,0) > 0
                       THEN 'باقة حتى ' || NEW.branches_count || ' مواقع' ELSE 'اشتراك تاكي' END),
      'price',   trim(to_char(COALESCE(NEW.amount,0), 'FM999999990.00')),
      'expires', COALESCE(to_char(NEW.period_end, 'YYYY-MM-DD'), '—'));
    v_title := public.taki_render_template(s->>'title_ar', vars);
    v_body  := public.taki_render_template(s->>'body_ar',  vars);

    IF COALESCE((s->>'email_invoice')::boolean, true) THEN
      v_tax    := COALESCE((SELECT value FROM platform_settings WHERE key = 'tax_settings'), '{}'::jsonb);
      v_vat_on := COALESCE((v_tax->>'vat_enabled')::boolean, false);
      v_rate   := COALESCE(NULLIF(v_tax->>'vat_rate','')::numeric, 15);
      v_incl   := COALESCE((v_tax->>'prices_include_vat')::boolean, true);
      v_entity := COALESCE(NULLIF(v_tax->>'entity_name',''), 'TAKI — تاكي');
      v_gross  := COALESCE(NEW.amount, 0);
      v_vat    := CASE WHEN v_vat_on THEN
                    CASE WHEN v_incl THEN round(v_gross * v_rate / (100 + v_rate), 2)
                         ELSE round(v_gross * v_rate / 100, 2) END
                  ELSE 0 END;
      v_net    := CASE WHEN v_incl THEN v_gross - v_vat ELSE v_gross END;
      v_total  := CASE WHEN v_incl THEN v_gross ELSE v_gross + v_vat END;
      v_period := CASE WHEN NEW.period_start IS NOT NULL AND NEW.period_end IS NOT NULL
                    THEN to_char(NEW.period_start,'YYYY-MM-DD') || ' ← ' || to_char(NEW.period_end,'YYYY-MM-DD')
                    ELSE '—' END;
      v_html := '<p>' || replace(v_body, E'\n', '<br>') || '</p>'
        || '<div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-top:14px;background:#fafafa;">'
        || '<div style="font-weight:800;font-size:15px;margin-bottom:8px;">🧾 '
        || CASE WHEN v_vat_on AND COALESCE(v_tax->>'vat_number','') <> '' THEN 'فاتورة ضريبية' ELSE 'فاتورة' END /* v13.37 */
        || '</div>'
        || '<div style="font-size:12px;color:#6b7280;margin-bottom:10px;">' || v_entity
        || CASE WHEN COALESCE(v_tax->>'cr_number','') <> '' THEN ' — سجل/وثيقة: ' || (v_tax->>'cr_number') ELSE '' END
        || CASE WHEN v_vat_on AND COALESCE(v_tax->>'vat_number','') <> '' THEN ' — الرقم الضريبي: ' || (v_tax->>'vat_number') ELSE '' END
        || '</div>'
        || '<table style="width:100%;border-collapse:collapse;font-size:13px;">'
        || '<tr><td style="border:1px solid #e5e5e5;padding:7px 10px;">رقم الفاتورة</td><td style="border:1px solid #e5e5e5;padding:7px 10px;font-weight:700;">INV-' || CASE WHEN NEW.invoice_no IS NOT NULL
                     THEN lpad(NEW.invoice_no::text, 6, '0')
                     ELSE NEW.id::text END || '</td></tr>'
        || '<tr><td style="border:1px solid #e5e5e5;padding:7px 10px;">التاريخ</td><td style="border:1px solid #e5e5e5;padding:7px 10px;">' || to_char(COALESCE(NEW.paid_at, NEW.created_at) AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI') || '</td></tr>'
        || '<tr><td style="border:1px solid #e5e5e5;padding:7px 10px;">العميل (التاجر)</td><td style="border:1px solid #e5e5e5;padding:7px 10px;">' || COALESCE(v_name,'—') || '</td></tr>'
        || CASE WHEN COALESCE((SELECT vat_number FROM store_profiles WHERE store_id = NEW.merchant_id), '') <> ''
             THEN '<tr><td style="border:1px solid #e5e5e5;padding:7px 10px;">الرقم الضريبي للعميل</td><td style="border:1px solid #e5e5e5;padding:7px 10px;">' || (SELECT vat_number FROM store_profiles WHERE store_id = NEW.merchant_id) || '</td></tr>'
             ELSE '' END
        || '<tr><td style="border:1px solid #e5e5e5;padding:7px 10px;">البيان</td><td style="border:1px solid #e5e5e5;padding:7px 10px;">اشتراك باقة مواقع'
        || CASE WHEN COALESCE(NEW.branches_count,0) > 0 THEN ' (' || NEW.branches_count || ' مواقع)' ELSE '' END
        || ' — الفترة: ' || v_period || '</td></tr>'
        || '<tr><td style="border:1px solid #e5e5e5;padding:7px 10px;">الصافي</td><td style="border:1px solid #e5e5e5;padding:7px 10px;">' || trim(to_char(v_net,'FM999999990.00')) || ' ر.س</td></tr>'
        || CASE WHEN v_vat_on THEN '<tr><td style="border:1px solid #e5e5e5;padding:7px 10px;">ضريبة القيمة المضافة (' || trim(to_char(v_rate,'FM990.00')) || '%)</td><td style="border:1px solid #e5e5e5;padding:7px 10px;">' || trim(to_char(v_vat,'FM999999990.00')) || ' ر.س</td></tr>' ELSE '' END
        || '<tr><td style="border:1px solid #e5e5e5;padding:7px 10px;background:#fffbe6;font-weight:800;">الإجمالي</td><td style="border:1px solid #e5e5e5;padding:7px 10px;background:#fffbe6;font-weight:800;">' || trim(to_char(v_total,'FM999999990.00')) || ' ر.س</td></tr>'
        || '</table>'
        || '<div style="font-size:11px;color:#9ca3af;margin-top:8px;">للنسخة الرسمية القابلة للطباعة (مع رمز QR): صفحة الاشتراك ← «🧾 فواتيري».</div>'
        || '</div>';
      PERFORM public.taki_queue_email(NEW.merchant_id, 'sub_new', v_title, public.taki_email_wrap(v_title, v_html));
    ELSE
      PERFORM public.taki_queue_email(NEW.merchant_id, 'sub_new', v_title,
          public.taki_email_wrap(v_title, '<p>' || replace(v_body, E'\n', '<br>') || '</p>'));
    END IF;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notify_subscription_invoice: %', SQLERRM;
  RETURN NEW;
END $function$;

COMMIT;

-- ── تحقّقٌ يرفع استثناءً ─────────────────────────────────────────────────────
DO $verify$
DECLARE
  n       int;
  v       jsonb;
  w       jsonb;
  v_bc    text;
  v_buyer text;
BEGIN
  SELECT count(*) INTO n FROM pg_proc
   WHERE proname='bot_get_booking_invoice' AND pronamespace='public'::regnamespace;
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ bot_get_booking_invoice = % (نسختان ⇒ نداءٌ ملتبس)', n; END IF;

  SELECT count(*) INTO n FROM pg_proc
   WHERE proname='notify_subscription_invoice' AND pronamespace='public'::regnamespace;
  IF n <> 1 THEN RAISE EXCEPTION 'فشل: نسخ notify_subscription_invoice = %', n; END IF;

  -- البريد لم يعد يطبع معرّف الصفّ رقماً للفاتورة
  IF pg_get_functiondef('public.notify_subscription_invoice()'::regprocedure)
       LIKE '%INV-'' || NEW.id%' THEN
    RAISE EXCEPTION 'فشل: بريد الاشتراك ما زال يطبع معرّف الصفّ رقمَ فاتورة';
  END IF;

  -- ── الاختبار الحقيقي: لقطةٌ مفبركة داخل كتلةٍ تُلغى ───────────────────
  -- (صفر فاتورة اليوم تحمل ضريبة، فالمسار نائم — ولا يُقال «يعمل» بلا قياس.)
  BEGIN
    SELECT barcode, buyer_id INTO v_bc, v_buyer
      FROM public.order_invoices WHERE buyer_id IS NOT NULL ORDER BY barcode LIMIT 1;
    IF v_bc IS NULL THEN RAISE EXCEPTION 'فشل: لا توجد فاتورة للاختبار'; END IF;

    UPDATE public.order_invoices
       SET seller   = COALESCE(seller,'{}'::jsonb)
                      || jsonb_build_object('vat_number','310122393500003','name','متجر الاختبار'),
           vat_rate = 15, vat_base = 100, vat_amount = 15, total = 115
     WHERE barcode = v_bc;

    -- الموقع (بهوية المشتري)
    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', v_buyer, 'role','authenticated')::text, true);
    v := public.get_order_invoice(v_bc);
    IF v IS NULL OR COALESCE(v->>'zatca_tlv','') = '' THEN
      RAISE EXCEPTION 'فشل: الموقع لم يُرجع رمزاً لفاتورةٍ بضريبة';
    END IF;

    -- البوت (بهوية المشتري نفسه)
    w := public.bot_get_booking_invoice(v_buyer, v_bc);
    IF COALESCE(w->>'ok','false') <> 'true' THEN
      RAISE EXCEPTION 'فشل: البوت لم يُرجع الفاتورة (%)', COALESCE(w->>'reason','?');
    END IF;
    IF COALESCE(w->>'zatca_tlv','') <> COALESCE(v->>'zatca_tlv','') THEN
      RAISE EXCEPTION 'فشل: اختلف رمز الموقع عن رمز البوت لنفس الطلب';
    END IF;

    -- الاختبار السالب: بلا رقمٍ ضريبي لا رمز — على الطرفين معاً
    UPDATE public.order_invoices SET seller = (COALESCE(seller,'{}'::jsonb) - 'vat_number')
     WHERE barcode = v_bc;
    IF public.get_order_invoice(v_bc)->>'zatca_tlv' IS NOT NULL
       OR public.bot_get_booking_invoice(v_buyer, v_bc)->>'zatca_tlv' IS NOT NULL THEN
      RAISE EXCEPTION 'فشل: صدر رمزٌ لفاتورةٍ بلا رقمٍ ضريبي';
    END IF;

    -- كل ما فُبرك أعلاه يُلغى بهذا الاستثناء المقصود
    RAISE EXCEPTION 'ROLLBACK_TEST_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ROLLBACK_TEST_OK' THEN RAISE; END IF;
  END;
END $verify$;

SELECT 'v14.68c' AS "الهجرة",
       (SELECT count(*) FROM order_invoices) AS "فواتير الطلبات",
       (SELECT count(*) FROM order_invoices WHERE vat_amount IS NOT NULL) AS "بضريبة",
       (SELECT count(*) FROM subscription_payments WHERE invoice_no IS NOT NULL) AS "اشتراكات مرقَّمة";
