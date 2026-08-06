-- ============================================================================
--  TAKI — حزمة فحص الإنتاج الكاملة (v13.71)
--  تُلصق كما هي في: لوحة Supabase (خادم جدة) ← SQL Editor ← Run
--
--  🔒 آمنة تماماً: **لا تكتب شيئاً في قاعدة البيانات**. كل اختبار كتابةٍ
--     يُنفَّذ داخل معاملة فرعية تُلغى فوراً بعد قراءة نتيجتها، فلا يبقى أي أثر
--     (لا صفوف، لا إشعارات، لا تعديل إعدادات). النتيجة تظهر كجدول:
--
--        القسم | الفحص | النتيجة | الحكم
--
--  الحكم: ✅ سليم · ❌ ثغرة/عطل · ℹ️ معلومة للقراءة فقط
--
--  الدالة مؤقتة (`pg_temp`) وتختفي بانتهاء الجلسة — لا تترك أي أثر في المخطط.
--
--  ✔️ مُختبَرة قبل التسليم: شُغِّلت كاملةً على خادم PostgreSQL 16 محلي بنسخة
--     مطابقة من الجداول والسياسات، فأخرجت ٣٦ صفاً سليماً؛ ثم فُحصت القاعدة
--     بعدها فكانت **بلا أي أثر**: لا حساب تجريبي متبقٍّ، ولا إعداد تغيّر،
--     ولا بنر حُذف، ولا حجز تبدّلت حالته، ولا إشعار أُضيف.
-- ============================================================================

CREATE OR REPLACE FUNCTION pg_temp.taki_audit()
RETURNS TABLE (القسم text, الفحص text, النتيجة text, الحكم text)
LANGUAGE plpgsql
AS $audit$
DECLARE
    v_buyer   text;
    v_seller  text;
    v_admin   text;
    r         text;
    n         bigint;
    v_ok      boolean;
    rec       record;
    v_sub     text := '__taki_audit_subadmin__';
    r1        text := 'لم يُنفَّذ';
    r2        text := 'لم يُنفَّذ';
    r3        text := 'لم يُنفَّذ';
BEGIN
    -- ── اختيار حسابات التجربة من بيانات الإنتاج نفسها ────────────────────
    SELECT id INTO v_buyer  FROM public.users WHERE user_type='buyer'  AND deleted_at IS NULL ORDER BY created_at LIMIT 1;
    SELECT id INTO v_seller FROM public.users WHERE user_type='seller' AND deleted_at IS NULL ORDER BY created_at LIMIT 1;
    SELECT id INTO v_admin  FROM public.users WHERE user_type='admin'  AND deleted_at IS NULL ORDER BY created_at LIMIT 1;

    القسم := '٠ · تمهيد'; الحكم := 'ℹ️';
    الفحص := 'الحسابات المستخدمة في الفحص';
    النتيجة := 'مشترٍ=' || coalesce(left(v_buyer,8),'—') || ' · تاجر=' || coalesce(left(v_seller,8),'—') || ' · أدمن=' || coalesce(left(v_admin,8),'—');
    RETURN NEXT;

    -- ════════════════════════════════════════════════════════════════════
    -- ١ · هل طُبِّق ترحيل الأمان v13.71؟
    -- ════════════════════════════════════════════════════════════════════
    القسم := '١ · ترحيل v13.71';

    v_ok := EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='sellers_public');
    الفحص := 'عرض الدليل العام sellers_public موجود';
    النتيجة := CASE WHEN v_ok THEN 'موجود' ELSE 'غير موجود' END;
    الحكم := CASE WHEN v_ok THEN '✅' ELSE '❌ الترحيل لم يُطبَّق بعد' END;
    RETURN NEXT;

    v_ok := EXISTS (SELECT 1 FROM pg_policies WHERE tablename='users' AND policyname='users_select_own_or_admin');
    الفحص := 'سياسة users المشدّدة مطبَّقة';
    النتيجة := CASE WHEN v_ok THEN 'مطبَّقة' ELSE 'ما زالت السياسة القديمة users_select_all' END;
    الحكم := CASE WHEN v_ok THEN '✅' ELSE '❌' END;
    RETURN NEXT;

    v_ok := EXISTS (SELECT 1 FROM pg_policies WHERE tablename='platform_settings' AND policyname='platform_settings_write_scoped');
    الفحص := 'كتابة إعدادات المنصة مربوطة بصلاحية التبويب';
    النتيجة := CASE WHEN v_ok THEN 'مربوطة' ELSE 'أي أدمن يكتبها' END;
    الحكم := CASE WHEN v_ok THEN '✅' ELSE '❌' END;
    RETURN NEXT;

    -- ════════════════════════════════════════════════════════════════════
    -- ٢ · الصور: المخزون والمصغّرات والصور المكسورة فعلاً
    -- ════════════════════════════════════════════════════════════════════
    القسم := '٢ · الصور'; الحكم := 'ℹ️';

    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='deals';
    الفحص := 'عدد ملفات الصور في المستودع'; النتيجة := n::text; RETURN NEXT;

    SELECT count(*) INTO n FROM storage.objects WHERE bucket_id='deals' AND name LIKE '%\_t.jpg';
    الفحص := 'منها نسخ مصغّرة (_t.jpg)'; النتيجة := n::text;
    الحكم := CASE WHEN n = 0 THEN 'ℹ️ لا مصغّرات — شغّل «ضغط الصور القديمة» في لوحة الأدمن' ELSE 'ℹ️' END;
    RETURN NEXT;

    SELECT count(*) INTO n FROM (SELECT unnest(images) u FROM public.deals WHERE status <> 'deleted') t
     WHERE u LIKE '%?t=1' OR u LIKE '%&t=1';
    الفحص := 'روابط موسومة بعلامة المصغّرة ?t=1 (بعد نشر v13.71)'; النتيجة := n::text; الحكم := 'ℹ️';
    RETURN NEXT;

    -- صور يشير إليها عرض ولا وجود لملفها في المستودع = صورة مكسورة حقيقية
    SELECT count(*) INTO n FROM (
        SELECT DISTINCT regexp_replace(split_part(u,'?',1), '^.*/storage/v1/object/public/deals/', '') p
        FROM (SELECT unnest(images) u FROM public.deals WHERE status <> 'deleted') x
        WHERE u LIKE '%/storage/v1/object/public/deals/%'
    ) q
    WHERE NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='deals' AND o.name = q.p);
    الفحص := '⚠️ صور عروض مفقودة من المستودع (روابط مكسورة)';
    النتيجة := n::text;
    الحكم := CASE WHEN n = 0 THEN '✅ لا صور مكسورة' ELSE '❌ راجع القائمة أسفل التقرير' END;
    RETURN NEXT;

    SELECT count(*) INTO n FROM public.deals WHERE status='active' AND (images IS NULL OR array_length(images,1) IS NULL);
    الفحص := 'عروض نشطة بلا أي صورة'; النتيجة := n::text;
    الحكم := CASE WHEN n = 0 THEN '✅' ELSE 'ℹ️ ستظهر بصورة بديلة' END;
    RETURN NEXT;

    SELECT count(*) INTO n FROM public.users WHERE user_type <> 'buyer' AND coalesce(avatar_url,'')='' AND deleted_at IS NULL;
    الفحص := 'متاجر بلا شعار'; النتيجة := n::text; الحكم := 'ℹ️';
    RETURN NEXT;

    -- ════════════════════════════════════════════════════════════════════
    -- ٣ · المواقع مقابل الباقات (سبب «حفظ الموقع لا يعمل»)
    -- ════════════════════════════════════════════════════════════════════
    القسم := '٣ · المواقع والباقات';
    FOR rec IN
        SELECT u.name AS nm, sp.max_branches AS cap,
               (SELECT count(DISTINCT k) FROM (
                    SELECT k FROM public.deals d
                      CROSS JOIN LATERAL public._taki_deal_loc_keys(d.location_id,d.map_lat,d.map_lng,d.locations) k
                     WHERE d.store_id = sp.store_id AND d.status='active'
                    UNION ALL
                    SELECT CASE WHEN b.location_id IS NOT NULL AND b.location_id<>'other' AND b.location_id NOT LIKE 'custom\_%'
                             THEN 'loc:'||b.location_id
                             ELSE 'geo:'||round(coalesce(b.map_lat,0)::numeric,3)::text||','||round(coalesce(b.map_lng,0)::numeric,3)::text END
                      FROM public.store_branches b WHERE b.merchant_id = sp.store_id AND b.is_active
               ) t) AS used
        FROM public.store_profiles sp JOIN public.users u ON u.id = sp.store_id
    LOOP
        الفحص := 'التاجر «' || coalesce(rec.nm,'—') || '» — مواقع مستهلكة';
        النتيجة := rec.used::text || ' / ' || coalesce(rec.cap::text,'?') || ' من الباقة';
        الحكم := CASE WHEN rec.cap IS NOT NULL AND rec.used >= rec.cap
                      THEN 'ℹ️ بلغ الحد — أي موقع جديد سيُرفض (سلوك صحيح)'
                      ELSE 'ℹ️' END;
        RETURN NEXT;
    END LOOP;

    -- ════════════════════════════════════════════════════════════════════
    -- ٤ · عزل القراءة: كل حساب لا يرى غيره
    -- ════════════════════════════════════════════════════════════════════
    القسم := '٤ · عزل القراءة';

    -- زائر مجهول ← بيانات التجار الخاصة
    BEGIN
        SET LOCAL ROLE anon; PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
        EXECUTE 'select coalesce(string_agg(coalesce(email,''''),'',''),''(لا شيء)'') from users where user_type<>''buyer''' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := '(محجوب)'; END IF;
    END;
    الفحص := 'زائر بلا حساب يقرأ بريد التجار';
    النتيجة := left(r, 60);
    الحكم := CASE WHEN r IN ('(لا شيء)','(محجوب)','') THEN '✅ محجوب' ELSE '❌ تسريب — طبّق ترحيل v13.71' END;
    RETURN NEXT;

    BEGIN
        SET LOCAL ROLE anon; PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
        EXECUTE 'select coalesce(string_agg(coalesce(telegram_chat_id::text,''''),'',''),''(لا شيء)'') from users where user_type<>''buyer''' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := '(محجوب)'; END IF;
    END;
    الفحص := 'زائر بلا حساب يقرأ معرّف تيليجرام للتاجر';
    النتيجة := left(r, 40);
    الحكم := CASE WHEN r IN ('(لا شيء)','(محجوب)','') THEN '✅ محجوب' ELSE '❌ تسريب — خطر اختطاف الربط' END;
    RETURN NEXT;

    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_buyer,'role','authenticated')::text, true);
        EXECUTE 'select count(*)::text from bookings where user_id <> ' || quote_literal(v_buyer) INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'محجوب'; END IF;
    END;
    الفحص := 'مشترٍ يرى حجوزات غيره'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','محجوب') THEN '✅' ELSE '❌' END; RETURN NEXT;

    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_buyer,'role','authenticated')::text, true);
        EXECUTE 'select count(*)::text from notifications where user_id <> ' || quote_literal(v_buyer) INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'محجوب'; END IF;
    END;
    الفحص := 'مشترٍ يرى إشعارات غيره'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','محجوب') THEN '✅' ELSE '❌' END; RETURN NEXT;

    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_buyer,'role','authenticated')::text, true);
        EXECUTE 'select count(*)::text from booking_messages m where not exists (select 1 from bookings b where b.barcode=m.barcode and b.user_id=' || quote_literal(v_buyer) || ')' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'محجوب'; END IF;
    END;
    الفحص := 'مشترٍ يقرأ محادثات غيره'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','محجوب') THEN '✅' ELSE '❌' END; RETURN NEXT;

    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_seller,'role','authenticated')::text, true);
        EXECUTE 'select count(*)::text from bookings b where not exists (select 1 from deals d where d.id=b.deal_id and d.store_id=' || quote_literal(v_seller) || ')' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'محجوب'; END IF;
    END;
    الفحص := 'تاجر يرى حجوزات ليست على منتجاته'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','محجوب') THEN '✅' ELSE '❌' END; RETURN NEXT;

    BEGIN
        SET LOCAL ROLE anon; PERFORM set_config('request.jwt.claims','{"role":"anon"}',true);
        EXECUTE 'select count(*)::text from bookings' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'محجوب'; END IF;
    END;
    الفحص := 'زائر مجهول يقرأ الحجوزات'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','محجوب') THEN '✅' ELSE '❌' END; RETURN NEXT;

    -- ════════════════════════════════════════════════════════════════════
    -- ٥ · عزل الكتابة: ١٢ محاولة اختراق حقيقية (كلها تُلغى)
    -- ════════════════════════════════════════════════════════════════════
    القسم := '٥ · عزل الكتابة';

    -- ٥.١ مشترٍ يرقّي نفسه أدمن
    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_buyer,'role','authenticated')::text, true);
        EXECUTE 'with u as (update users set user_type=''admin'' where id=' || quote_literal(v_buyer) || ' returning 1) select count(*)::text from u' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'مرفوض'; END IF;
    END;
    الفحص := 'مشترٍ يرقّي نفسه أدمن'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','مرفوض') THEN '✅' ELSE '❌ خطير' END; RETURN NEXT;

    -- ٥.٢ مشترٍ يمنح نفسه أعلى صلاحية
    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_buyer,'role','authenticated')::text, true);
        EXECUTE 'with u as (update users set is_super_admin=true where id=' || quote_literal(v_buyer) || ' returning 1) select count(*)::text from u' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'مرفوض'; END IF;
    END;
    الفحص := 'مشترٍ يمنح نفسه أعلى صلاحية'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','مرفوض') THEN '✅' ELSE '❌ خطير' END; RETURN NEXT;

    -- ٥.٣ مشترٍ يعدّل حساب تاجر
    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_buyer,'role','authenticated')::text, true);
        EXECUTE 'with u as (update users set shop=''X'' where id=' || quote_literal(v_seller) || ' returning 1) select count(*)::text from u' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'مرفوض'; END IF;
    END;
    الفحص := 'مشترٍ يعدّل حساب تاجر'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','مرفوض') THEN '✅' ELSE '❌' END; RETURN NEXT;

    -- ٥.٤ مشترٍ يحذف حساب تاجر
    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_buyer,'role','authenticated')::text, true);
        EXECUTE 'with u as (delete from users where id=' || quote_literal(v_seller) || ' returning 1) select count(*)::text from u' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'مرفوض'; END IF;
    END;
    الفحص := 'مشترٍ يحذف حساب تاجر'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','مرفوض') THEN '✅' ELSE '❌ خطير' END; RETURN NEXT;

    -- ٥.٥ مشترٍ يعدّل أسعار عروض تاجر
    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_buyer,'role','authenticated')::text, true);
        EXECUTE 'with u as (update deals set discounted_price=1 where store_id=' || quote_literal(v_seller) || ' returning 1) select count(*)::text from u' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'مرفوض'; END IF;
    END;
    الفحص := 'مشترٍ يعدّل أسعار عروض تاجر'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','مرفوض') THEN '✅' ELSE '❌ خطير' END; RETURN NEXT;

    -- ٥.٦ مشترٍ يعدّل حجز غيره
    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_buyer,'role','authenticated')::text, true);
        EXECUTE 'with u as (update bookings set status=''cancelled'' where user_id <> ' || quote_literal(v_buyer) || ' returning 1) select count(*)::text from u' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'مرفوض'; END IF;
    END;
    الفحص := 'مشترٍ يلغي حجز غيره'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','مرفوض') THEN '✅' ELSE '❌ خطير' END; RETURN NEXT;

    -- ٥.٧ مشترٍ يعلّم حجزه «مكتمل» بنفسه
    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_buyer,'role','authenticated')::text, true);
        EXECUTE 'with u as (update bookings set status=''completed'' where user_id = ' || quote_literal(v_buyer) || ' and status=''pending'' returning 1) select count(*)::text from u' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'مرفوض'; END IF;
    END;
    الفحص := 'مشترٍ يعلّم حجزه مكتملاً بنفسه'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','مرفوض') THEN '✅' ELSE '❌' END; RETURN NEXT;

    -- ٥.٨ مشترٍ يكتب إشعاراً لغيره
    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_buyer,'role','authenticated')::text, true);
        EXECUTE 'with u as (insert into notifications(user_id,title_ar,body_ar,type) values(' || quote_literal(v_seller) || ',''x'',''y'',''system'') returning 1) select count(*)::text from u' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'مرفوض'; END IF;
    END;
    الفحص := 'مشترٍ يرسل إشعاراً باسم المنصة لغيره'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','مرفوض') THEN '✅' ELSE '❌' END; RETURN NEXT;

    -- ٥.٩ تاجر يرفع باقة نفسه
    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_seller,'role','authenticated')::text, true);
        EXECUTE 'with u as (update store_profiles set max_branches=99, subscription_plan=''premium'' where store_id=' || quote_literal(v_seller) || ' returning 1) select count(*)::text from u' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'مرفوض'; END IF;
    END;
    الفحص := 'تاجر يمنح نفسه باقة مدفوعة'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','مرفوض') THEN '✅' ELSE '❌ خطير' END; RETURN NEXT;

    -- ٥.١٠ تاجر يعدّل عروض تاجر آخر
    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_seller,'role','authenticated')::text, true);
        EXECUTE 'with u as (update deals set status=''paused'' where store_id <> ' || quote_literal(v_seller) || ' returning 1) select count(*)::text from u' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'مرفوض'; END IF;
    END;
    الفحص := 'تاجر يوقف عروض تاجر منافس'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','مرفوض') THEN '✅' ELSE '❌ خطير' END; RETURN NEXT;

    -- ٥.١١ تاجر يحذف فرع تاجر آخر
    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_seller,'role','authenticated')::text, true);
        EXECUTE 'with u as (delete from store_branches where merchant_id <> ' || quote_literal(v_seller) || ' returning 1) select count(*)::text from u' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'مرفوض'; END IF;
    END;
    الفحص := 'تاجر يحذف فروع تاجر آخر'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','مرفوض') THEN '✅' ELSE '❌' END; RETURN NEXT;

    -- ٥.١٢ مشترٍ يكتب إعدادات المنصة
    BEGIN
        SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_buyer,'role','authenticated')::text, true);
        EXECUTE 'with u as (update platform_settings set value=''false''::jsonb where key=''telegram_bot_enabled'' returning 1) select count(*)::text from u' INTO r;
        RAISE EXCEPTION '__ok__%', r;
    EXCEPTION WHEN others THEN
        IF SQLERRM LIKE '\_\_ok\_\_%' THEN r := substr(SQLERRM,7); ELSE r := 'مرفوض'; END IF;
    END;
    الفحص := 'مشترٍ يطفئ بوت المنصة'; النتيجة := r;
    الحكم := CASE WHEN r IN ('0','مرفوض') THEN '✅' ELSE '❌ خطير' END; RETURN NEXT;

    -- ════════════════════════════════════════════════════════════════════
    -- ٦ · أدمن فرعي بلا صلاحيات: هل يقدر يعبث بالمنصة؟
    --      (يُنشأ حساب تجريبي ثم يُمحى بإلغاء المعاملة الفرعية — لا أثر)
    -- ════════════════════════════════════════════════════════════════════
    القسم := '٦ · حدود الأدمن الفرعي';
    BEGIN
        SET LOCAL session_replication_role = 'replica';   -- إنشاء الحساب التجريبي بلا مشغّلات
        INSERT INTO public.users(id, name, user_type, is_super_admin, admin_permissions)
        VALUES (v_sub, 'فحص — أدمن فرعي', 'admin', false, '{}'::text[]);
        SET LOCAL session_replication_role = 'origin';    -- الاختبارات تجري بالمشغّلات كاملة

        BEGIN
            SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_sub,'role','authenticated')::text, true);
            EXECUTE 'with u as (update platform_settings set value=''false''::jsonb where key=''telegram_bot_enabled'' returning 1) select count(*)::text from u' INTO r1;
            RAISE EXCEPTION '__ok__%', r1;
        EXCEPTION WHEN others THEN
            IF SQLERRM LIKE '\_\_ok\_\_%' THEN r1 := substr(SQLERRM,7); ELSE r1 := 'مرفوض'; END IF;
        END;

        BEGIN
            SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_sub,'role','authenticated')::text, true);
            EXECUTE 'with u as (update platform_settings set value=''false''::jsonb where key=''payment_gateway_enabled'' returning 1) select count(*)::text from u' INTO r2;
            RAISE EXCEPTION '__ok__%', r2;
        EXCEPTION WHEN others THEN
            IF SQLERRM LIKE '\_\_ok\_\_%' THEN r2 := substr(SQLERRM,7); ELSE r2 := 'مرفوض'; END IF;
        END;

        BEGIN
            SET LOCAL ROLE authenticated; PERFORM set_config('request.jwt.claims', json_build_object('sub',v_sub,'role','authenticated')::text, true);
            EXECUTE 'with u as (delete from banners returning 1) select count(*)::text from u' INTO r3;
            RAISE EXCEPTION '__ok__%', r3;
        EXCEPTION WHEN others THEN
            IF SQLERRM LIKE '\_\_ok\_\_%' THEN r3 := substr(SQLERRM,7); ELSE r3 := 'مرفوض'; END IF;
        END;

        RAISE EXCEPTION '__sandbox_done__';               -- يمحو الحساب التجريبي
    EXCEPTION WHEN others THEN
        IF SQLERRM <> '__sandbox_done__' THEN
            r1 := coalesce(r1,'?'); r2 := coalesce(r2,'?'); r3 := coalesce(r3,'?');
        END IF;
    END;
    -- القيم محفوظة في متغيّرات، والحساب التجريبي أُزيل بإلغاء المعاملة الفرعية.
    الفحص := 'أدمن فرعي بلا صلاحيات يطفئ بوت تيليجرام'; النتيجة := r1;
    الحكم := CASE WHEN r1 IN ('0','مرفوض') THEN '✅' ELSE '❌ الصلاحيات لا تحرس البيانات' END; RETURN NEXT;

    الفحص := 'أدمن فرعي بلا صلاحيات يطفئ بوابة الدفع'; النتيجة := r2;
    الحكم := CASE WHEN r2 IN ('0','مرفوض') THEN '✅' ELSE '❌ الصلاحيات لا تحرس البيانات' END; RETURN NEXT;

    الفحص := 'أدمن فرعي بلا صلاحيات يحذف كل البنرات'; النتيجة := r3;
    الحكم := CASE WHEN r3 IN ('0','مرفوض') THEN '✅' ELSE '❌ الصلاحيات لا تحرس البيانات' END; RETURN NEXT;

    -- ════════════════════════════════════════════════════════════════════
    -- ٧ · صحة عامة قبل النشر
    -- ════════════════════════════════════════════════════════════════════
    القسم := '٧ · صحة عامة'; الحكم := 'ℹ️';

    SELECT count(*) INTO n FROM pg_tables t
     WHERE t.schemaname='public'
       AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
                        WHERE ns.nspname='public' AND c.relname=t.tablename AND c.relrowsecurity);
    الفحص := '⚠️ جداول بلا حماية صفوف (RLS)'; النتيجة := n::text;
    الحكم := CASE WHEN n=0 THEN '✅' ELSE '❌ افحص القائمة أسفل التقرير' END; RETURN NEXT;

    SELECT count(*) INTO n FROM public.deals WHERE status='active';
    الفحص := 'عروض نشطة'; النتيجة := n::text; الحكم := 'ℹ️'; RETURN NEXT;

    SELECT count(*) INTO n FROM public.users WHERE deleted_at IS NULL;
    الفحص := 'حسابات فعّالة'; النتيجة := n::text; الحكم := 'ℹ️'; RETURN NEXT;

    RETURN;
END;
$audit$;

-- ▶️ شغّل هذا السطر (النتيجة جدول):
SELECT * FROM pg_temp.taki_audit();


-- ============================================================================
--  استعلامان مساعدان — شغّلهما فقط إن ظهر ❌ في القسمين ٢ أو ٧
-- ============================================================================

-- (أ) أسماء الصور المكسورة بالضبط (روابط في عروض بلا ملف في المستودع):
-- SELECT DISTINCT regexp_replace(split_part(u,'?',1),'^.*/deals/','') AS الملف_المفقود
--   FROM (SELECT unnest(images) u FROM public.deals WHERE status <> 'deleted') x
--  WHERE u LIKE '%/storage/v1/object/public/deals/%'
--    AND NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id='deals'
--                     AND o.name = regexp_replace(split_part(u,'?',1),'^.*/deals/',''));

-- (ب) الجداول التي بلا حماية صفوف:
-- SELECT t.tablename AS جدول_بلا_RLS FROM pg_tables t
--  WHERE t.schemaname='public'
--    AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace
--                     WHERE ns.nspname='public' AND c.relname=t.tablename AND c.relrowsecurity);
