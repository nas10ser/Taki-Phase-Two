-- ════════════════════════════════════════════════════════════════════════════
-- v16.53 — رقمُ تواصلٍ لكلّ فرع: يُطبَّع ويُتحقَّق في القاعدة، ويصل البوتين
-- ════════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر (٢٠ نوفمبر ٢٠٢٦): «في بروفايل التاجر اجعل لكلّ خريطةٍ أن يضع رقماً
-- خاصاً وعلامةَ الاتصال والواتس، أو قد يكون رقماً موحّداً في البايو على حسب…
-- فتاجرٌ عنده ٣٠ فرعاً ولكلّ فرعٍ رقمٌ خاص… وتاجرٌ ثانٍ رقمٌ موحّدٌ لعشرين
-- فرعاً… وتأكّد أن الخيار متاحٌ حتى عند حجز المشتري الطلبَ لنفس الفرع».
--
-- ── ما قِيس قبل كتابة سطرٍ واحد ────────────────────────────────────────────
--   · `store_branches.phone` **موجودٌ منذ زمن** و`branchRepository` يقرؤه
--     ويكتبه — و**صفرُ فرعٍ من عشرة يحمل رقماً**، لأن لا حقلَ إدخالٍ في أيّ
--     شاشة ولا عرضَ في أيّ مكان. ميزةٌ ميّتةٌ لا عمودٌ ناقص.
--   · `bookings.location_id` يحمل **معرّفَ الفرع** (`br_…`) لا معرّفَ المولّ:
--     قِيس ٢٢ من ٣٠ طلباً موقعُها يطابق فرعاً قائماً، وصفرٌ يطابق مولّاً.
--     ⇒ الربطُ بالفرع مباشرٌ بلا استنتاج.
--   · `bot_booking_contact` و`bot_store_contact` تُعيدان **رقم المتجر الموحّد**
--     وحده، فالبوتان لا يعرفان الفروع إطلاقاً.
--   · 🔴 و`branches_update_own` تسمح للتاجر بالكتابة **مباشرةً** على الجدول
--     من المتصفّح — فتحقّقُ الواجهة وحده ليس حارساً (قاعدةُ المشروع: سياسةٌ
--     ليست حارساً). ⇒ المشغّلُ أدناه هو ما يفرض الصيغة فعلاً.
--
-- 🪤 والرقمُ **لا يُنسخ** داخل الحجز ولا داخل العرض: نسخةٌ مجمّدةٌ من وسيلة
--    تواصلٍ تعني مشترياً يتّصل برقمٍ ميّتٍ بعد أن غيّره التاجر. والتجميدُ يصحّ
--    لاسم المتجر على الفاتورة (v14.36) لأنه اسمُ **لحظة البيع**؛ أمّا رقمُ
--    التواصل فالمرادُ منه أن يعمل **الآن**.
-- ════════════════════════════════════════════════════════════════════════════

-- ── ⓪ حارسُ الخادم: لا تُنفَّذ على المختبر (طوكيو) ─────────────────────────
DO $guard$
BEGIN
    IF obj_description('public'::regnamespace, 'pg_namespace')
       = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
        RAISE EXCEPTION 'هذه هجرةُ إنتاج — الخادمُ أمامها هو المختبر (طوكيو). أوقِف.';
    END IF;
END $guard$;

-- ════════════════════════════════════════════════════════════════════════════
-- ① التطبيعُ والتحقّق في القاعدة — لا في الواجهة وحدها
-- ════════════════════════════════════════════════════════════════════════════
-- 🪤 الأرقامُ العربية (`٠٥٥…`) تصل من لوحة المفاتيح العربية كثيراً، و`tel:`
--    و`wa.me` لا يقبلانها — فتُحوَّل هنا لا في شاشةٍ واحدةٍ من أربع.
-- 🪤 ورقمٌ لا يُنتج رابطاً صالحاً يُرفض: زرٌّ يفتح واتساب ويقول «الرقم غير
--    صالح» يجعل المشتري يستنتج أن المتجر ليس على واتساب — وهو عيبٌ **لا
--    يُخطئ ولا يُسجَّل** في أيّ مكان (درس v14.77).
CREATE OR REPLACE FUNCTION public.taki_norm_branch_phone(p_raw text)
RETURNS text
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v text := COALESCE(p_raw, ''); v_d text;
BEGIN
  -- أرقامٌ عربيةٌ وفارسية ⇐ لاتينية (نفسُ ما يفعله `shared/phone.js`).
  v := translate(v, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789');
  v := btrim(v);
  IF v = '' THEN RETURN NULL; END IF;
  v_d := regexp_replace(v, '[^0-9]', '', 'g');
  IF v_d = '' THEN RAISE EXCEPTION 'BRANCH_PHONE_INVALID' USING ERRCODE = 'P0001'; END IF;
  -- جوّالٌ سعوديّ (بصيغه الأربع) · أو هاتفٌ ثابتٌ بمفتاح منطقة · أو رقمٌ دوليّ.
  IF v_d ~ '^0?5[0-9]{8}$'
     OR v_d ~ '^9665[0-9]{8}$'
     OR v_d ~ '^009665[0-9]{8}$'
     OR v_d ~ '^(011|012|013|014|016|017)[0-9]{7}$'
     OR v_d ~ '^[0-9]{10,15}$'
  THEN
    RETURN left(v, 24);
  END IF;
  RAISE EXCEPTION 'BRANCH_PHONE_INVALID' USING ERRCODE = 'P0001';
END
$function$;

CREATE OR REPLACE FUNCTION public.tg_norm_branch_phone()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  -- 🪤 `SECURITY INVOKER` عمداً: هذا مشغّلُ تطبيعٍ لا حارسُ صلاحية، ولا شيء
  --    فيه يحتاج امتيازَ المالك. (ومميِّزُ «نظام» هنا لا معنى له: التطبيعُ
  --    يصحّ لكلّ كاتب، بشراً كان أو خادماً.)
  IF NEW.phone IS NOT NULL THEN
    NEW.phone := public.taki_norm_branch_phone(NEW.phone);
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS tr_norm_branch_phone ON public.store_branches;
CREATE TRIGGER tr_norm_branch_phone
    BEFORE INSERT OR UPDATE OF phone ON public.store_branches
    FOR EACH ROW EXECUTE FUNCTION public.tg_norm_branch_phone();

-- ════════════════════════════════════════════════════════════════════════════
-- ② تواصلُ الطلب في البوتين: رقمُ الفرع الذي حُجز منه، وإلّا الموحّد
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.bot_booking_contact(
    p_telegram_id bigint, p_barcode text, p_whatsapp_id text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid text; v_role text; v_b bookings%ROWTYPE; v_phone text; v_name text;
        v_bphone text; v_bname text;
BEGIN
  SELECT id, user_type INTO v_uid, v_role FROM users WHERE id = public._bot_uid(p_telegram_id, p_whatsapp_id) AND deleted_at IS NULL LIMIT 1;
  IF v_uid IS NULL THEN RETURN jsonb_build_object('success',false,'error','not_linked'); END IF;
  SELECT * INTO v_b FROM bookings WHERE barcode=UPPER(p_barcode) LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('success',false,'error','not_found'); END IF;
  IF v_uid = v_b.user_id THEN
    SELECT COALESCE(NULLIF(btrim(sp.phone),''), NULLIF(btrim(u.contact_phone),''), NULLIF(btrim(u.phone),'')),
           COALESCE(NULLIF(btrim(u.shop),''), NULLIF(btrim(u.name),''),'المتجر')
      INTO v_phone, v_name
      FROM users u LEFT JOIN store_profiles sp ON sp.store_id=u.id WHERE u.id=v_b.store_id;
    -- v16.53 — رقمُ الفرع الذي حُجز منه يعلو على الموحّد. و`location_id` في
    -- الحجز معرّفُ فرعٍ (قِيس)، والشرطُ على `merchant_id` يمنع فرعَ متجرٍ آخر.
    IF v_b.location_id IS NOT NULL THEN
      SELECT NULLIF(btrim(sb.phone),''), NULLIF(btrim(sb.name_ar),'')
        INTO v_bphone, v_bname
        FROM store_branches sb
       WHERE sb.id = v_b.location_id AND sb.merchant_id = v_b.store_id
       LIMIT 1;
      IF v_bphone IS NOT NULL THEN
        v_phone := v_bphone;
        -- واسمُ الفرع يُضاف للاسم فيعرف المشتري **من** يكلّم، لا رقماً صامتاً.
        IF v_bname IS NOT NULL THEN v_name := v_name || ' — ' || v_bname; END IF;
      END IF;
    END IF;
    RETURN jsonb_build_object('success',true,'phone',v_phone,'name',v_name,'who','store');
  ELSIF v_uid = v_b.store_id THEN
    SELECT NULLIF(btrim(v_b.user_phone),''), COALESCE(NULLIF(btrim(v_b.user_name),''),'العميل') INTO v_phone, v_name;
    RETURN jsonb_build_object('success',true,'phone',v_phone,'name',v_name,'who','buyer');
  END IF;
  RETURN jsonb_build_object('success',false,'error','not_authorized');
END
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- ③ التحقّق — `DO` يرفع استثناءً (الجدولُ وحده لا يُفشل psql)
-- ════════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE v_n integer; v_got text; v_err text;
BEGIN
    -- (أ) التطبيع: أرقامٌ عربية ⇐ لاتينية، وكلُّ صيغةٍ سعوديّةٍ مقبولة
    IF public.taki_norm_branch_phone('٠٥٥١٢٣٤٥٦٧') <> '0551234567' THEN
        RAISE EXCEPTION 'الفحص ①: الأرقامُ العربية لم تُطبَّع — %', public.taki_norm_branch_phone('٠٥٥١٢٣٤٥٦٧');
    END IF;
    IF public.taki_norm_branch_phone('  +966 55 123 4567 ') IS NULL THEN
        RAISE EXCEPTION 'الفحص ①ب: صيغةٌ دوليّةٌ سليمةٌ رُفضت';
    END IF;
    IF public.taki_norm_branch_phone('013 8123456') IS NULL THEN
        RAISE EXCEPTION 'الفحص ①ج: هاتفٌ ثابتٌ سليمٌ رُفض';
    END IF;
    IF public.taki_norm_branch_phone('   ') IS NOT NULL THEN
        RAISE EXCEPTION 'الفحص ①د: الفراغُ لم يصِر NULL (وهو «استعمل الموحّد»)';
    END IF;

    -- (ب) والرقمُ الفاسد يُرفض — **بالرمز المقصود** لا بأيّ استثناء
    BEGIN
        PERFORM public.taki_norm_branch_phone('123');
        RAISE EXCEPTION 'الفحص ②: رقمٌ فاسدٌ (123) قُبل';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
        IF v_err <> 'BRANCH_PHONE_INVALID' THEN
            RAISE EXCEPTION 'الفحص ②ب: رُفض لسببٍ آخر — %', v_err;
        END IF;
    END;
    BEGIN
        PERFORM public.taki_norm_branch_phone('هاتف');
        RAISE EXCEPTION 'الفحص ②ج: نصٌّ بلا أرقامٍ قُبل';
    EXCEPTION WHEN SQLSTATE 'P0001' THEN NULL;
    END;

    -- (ج) المشغّلُ مربوطٌ على الجدول فعلاً، وعلى `phone` تحديداً
    SELECT count(*) INTO v_n FROM pg_trigger
     WHERE tgrelid = 'public.store_branches'::regclass
       AND tgname = 'tr_norm_branch_phone' AND NOT tgisinternal;
    IF v_n <> 1 THEN RAISE EXCEPTION 'الفحص ③: مشغّلُ التطبيع غيرُ مربوط'; END IF;

    -- (د) وتواصلُ الطلب يقرأ الفرعَ فعلاً — يُقاس **جسمُ الدالّة** لا الملفّ،
    --     ومجرَّداً من التعليقات (حارسٌ قد يقرأ تعليقَه هو).
    IF position('store_branches' IN
         regexp_replace(pg_get_functiondef('public.bot_booking_contact'::regproc), '--[^\n]*', '', 'g')) = 0 THEN
        RAISE EXCEPTION 'الفحص ④: تواصلُ الطلب لا يقرأ الفروع';
    END IF;

    RAISE NOTICE '✅ v16.53 — كلُّ الفحوص الأربعة نجحت';
END $verify$;

SELECT 'فروع'               AS "البند", count(*)::text AS "القيمة" FROM public.store_branches
UNION ALL SELECT 'لها رقمٌ خاص', count(*)::text FROM public.store_branches WHERE NULLIF(btrim(COALESCE(phone,'')),'') IS NOT NULL
UNION ALL SELECT 'مشغّلُ التطبيع', (SELECT count(*)::text FROM pg_trigger WHERE tgrelid='public.store_branches'::regclass AND tgname='tr_norm_branch_phone' AND NOT tgisinternal);
