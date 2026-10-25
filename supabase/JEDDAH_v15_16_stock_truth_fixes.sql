-- ═══════════════════════════════════════════════════════════════════════════
-- v15.16 — أربعةُ عيوبٍ في كودٍ مشحون، قبل أيّ بناءٍ جديد فوقه
-- ═══════════════════════════════════════════════════════════════════════════
-- بدأتُ ببند ناصر الأوّل (إعادةُ القراءة)، فدقّقتُ الطرفَ المستقبِل أوّلاً لأن
-- البناءَ الجديد سيجلس فوقه. وخرجت أربعةُ عيوبٍ **تحقّقتُ من كلٍّ منها على
-- النصّ الحيّ على جدة** — لا من قراءة ملفّ. وكلُّها صامتة، وثلاثةٌ منها
-- تُفقد مخزوناً أو تبيع ما ليس موجوداً.
--
-- ١) 🔴 **`ok:true` لا يعني «كُتب».** `taki_set_on_hand` تُرجع
--      `{"ok":true,"skipped":"UNLIMITED"}` و`{"ok":true,"skipped":"STALE_OBSERVATION"}`
--      ولا تكتب شيئاً (سطرا ٢٩ و٣٥ من نصّها الحيّ). وكلُّ مناديها يفحص `ok`
--      وحده. فـ`taki_stock_push` تعدّ التجاوُزَ **تطبيقاً**، وتردّ `applied:1`،
--      و`taki_stock_webhook` تكتب `last_note='OK'` ⇒ والشاشةُ تقول للتاجر
--      «فُهمت وطُبّقت» ولم يُكتب شيء.
--
-- ٢) 🔴 **و`p_observed_at` بلا سقف أعلى.** `taki_stock_push` تُمرّر زمنَ نظام
--      التاجر كما هو، وهو **دائماً غيرُ فارغ** (`COALESCE(p_observed_at, now())`)
--      فيُقدّم علامةَ الزمن في `deals.stock_observed_at` دائماً. فكاشيرٌ يُرسل
--      توقيتَ الرياض كأنّه UTC (فرقُ ٣ ساعات — وهو الخطأ الأشيع في المنطقة)
--      يُقدّم العلامةَ ٣ ساعاتٍ، فتُرفض **كلُّ** كتابةٍ بعدها ثلاثَ ساعات —
--      ومنها تعديلُ التاجر من الموقع نفسه (`merchant_set_stock` تُمرّر `now()`)
--      فيُقال له «✅ حُفظ» ولا يتغيّر رقمٌ، بلا أيّ خطأ في أي سجلّ.
--      🪤 والعلاجُ **قصُّ الزمن لا رفضُ الرسالة**: الرقمُ صحيحٌ وساعتُه خاطئة.
--
-- ٣) 🔴 **وأخطرُها مالياً: وحداتُ الاسترداد تضيع نهائياً.**
--      `taki_restock_booking` تنادي `taki_set_on_hand` ثمّ تفحص `ok` وحده
--      (سطر ٧٨) وتزيد `bookings.restocked_qty` (سطر ٨٢). فمع علامةِ زمنٍ
--      مستقبليّة تُرجع `{"ok":true,"skipped":"STALE_OBSERVATION"}` ⇒ لم يعد
--      المخزونُ، و`restocked_qty` ارتفع ⇒ والمحاولةُ التالية تردّ
--      `{"already":true}` إلى الأبد. المشتري استُرِدّ له، والبضاعةُ لا تُباع
--      ثانيةً أبداً، ولا أثرَ في أيّ مكان.
--      (وهو من عائلة درسٍ مسجَّل: `ROW_COUNT` بعد `PERFORM` دائماً ١ —
--       **تُقرأ قيمةُ الإرجاع** لا نجاحُ النداء.)
--
-- ٤) 🔴 **ومفتاحُ التكرار بصمةُ الجسم بلا نهاية ⇒ بيعٌ زائد.**
--      دالّةُ الحافة تُرسل `p_event_id: null` دائماً، ولا سلّة ولا زد تحمل
--      `event_id` في جذر الرسالة ⇒ فالمفتاحُ هو `sha256(الجسم)`، و`stock_inbox`
--      بلا أيّ تنظيفٍ في المستودع كلّه. فكمّيةٌ تذهب ٥ ⇐ ٨ ⇐ ٥: الرسالةُ
--      الثالثة **مطابقةٌ بايتاً ببايت** للأولى ⇒ `unique_violation` ⇒
--      `{"duplicate":true}` ⇒ تاكي تبقى على ٨ والواقع ٥ **فتبيع ثلاثاً لا
--      تملكها، دائماً**، حتى يصل رقمٌ لم يُرَ قبلاً.
--      🪤 والتعليقُ الذي برّر ذلك في v15.12 خاطئ: «رسالتان متطابقتان تكرارٌ
--         بالتعريف» تصحّ فقط إن لم تُطبَّق قيمةٌ مختلفةٌ بينهما. والكمّياتُ
--         مطلقة ⇒ **إعادةُ تطبيق نفس الرقم بلا أثر، والإفراطُ في الإهمال
--         هو الخطر**. فالمفتاحُ يُصبح بصمةً + نافذةَ خمس دقائق.
--
-- 🪤 والعيبُ الذي كنتُ رصدتُه بنفسي (موتُ `skip_when` بعد أوّل خريطةٍ
--    مُتعلَّمة) يُصلح هنا أيضاً — القسم ٥.
-- ═══════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه هجرة إنتاج (جدّة) — وأنت على قاعدة المختبر. أوقِفت.';
  END IF;
  IF to_regprocedure('public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)') IS NULL
     OR to_regprocedure('public.taki_stock_push(text,jsonb,timestamptz,text)') IS NULL
     OR to_regprocedure('public.taki_stock_webhook(text,jsonb,text)') IS NULL
     OR to_regproc('public.taki_restock_booking') IS NULL THEN
    RAISE EXCEPTION 'إحدى الدوال الأربع المرقوعة غير موجودة — أوقِفت.';
  END IF;
END
$guard$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ١) سقفٌ أعلى لعلامة الزمن — قصٌّ لا رفض
-- ═══════════════════════════════════════════════════════════════════════════
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)'::regprocedure);
  src0 := src;
  IF position('v15.16 clamp2' IN src) > 0 THEN RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN; END IF;

  -- 🔴 وأوّلُ صياغةٍ كتبتُها قصّت إلى `now() + 2 minutes` بحجّةِ «فرقُ ثوانٍ
  --    بين خادمين طبيعيّ» — **وكانت خاطئة، وأمسكها فحصي نفسه**: الفسحةُ
  --    تُعيد العيبَ مصغَّراً. فكاشيرٌ مزحزحٌ ثلاثَ ساعات يُقدّم العلامةَ
  --    دقيقتين عند **كلّ** دفعة، فتبقى تعديلاتُ التاجر من الموقع (`now()`)
  --    مرفوضةً صامتةً كلَّ دقيقتين. والصحيحُ صفرُ فسحة: ساعتُنا هي المرجع،
  --    وتسطيحُ أيّ تقدّمٍ إليها لا يُفقد شيئاً — أمّا الماضي فيبقى مرفوضاً
  --    (وهو وظيفةُ العمود الأصلية).
  IF position(E'  v_at timestamptz := COALESCE(p_observed_at, now());' IN src) > 0 THEN
    src := replace(src, E'  v_at timestamptz := COALESCE(p_observed_at, now());',
      E'  -- v15.16 clamp2 — ساعةُ نظام التاجر لا تُصدَّق إلى المستقبل: فرقُ ٣\n'
      || E'  --   ساعات (توقيت الرياض كأنّه UTC) كان يُجمّد كلّ كتابةٍ بعده —\n'
      || E'  --   ومنها تعديلُ التاجر من الموقع، فيُقال «✅ حُفظ» ولا يُحفظ.\n'
      || E'  v_at timestamptz := LEAST(COALESCE(p_observed_at, now()), now());');
  ELSIF position(E'now() + interval ''2 minutes''' IN src) > 0 THEN
    -- حالةُ ترقيةٍ من أوّل صياغةٍ لي (قُصّت دقيقتين)
    src := replace(src, E'now() + interval ''2 minutes''', E'now()');
    src := replace(src, E'v15.16 clamp', E'v15.16 clamp2');
  ELSE
    RAISE EXCEPTION '❌ مرساة علامة الزمن غير موجودة بأيّ من الصيغتين — أوقِفت بدل الرقع الأعمى.';
  END IF;

  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع الرقعة.'; END IF;
  EXECUTE src;
  src := pg_get_functiondef('public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)'::regprocedure);
  IF position('v15.16 clamp2' IN src) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ.';
  END IF;
  IF position('2 minutes' IN src) > 0 THEN
    RAISE EXCEPTION '❌ بقيت فسحةُ الدقيقتين — وهي تُعيد العيب مصغَّراً.';
  END IF;
  RAISE NOTICE '✅ ١) علامةُ الزمن مقصوصةٌ عند now() بلا فسحة.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٢) «طُبّق» ≠ «لم يُرفض» — محاسبةٌ صادقة في `taki_stock_push`
-- ═══════════════════════════════════════════════════════════════════════════
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.taki_stock_push(text,jsonb,timestamptz,text)'::regprocedure);
  src0 := src;
  IF position('v15.16 skip' IN src) > 0 THEN RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN; END IF;
  IF position(E'  v_unmatched jsonb := ''[]''::jsonb;' IN src) = 0
     OR position(E'    IF COALESCE((v_res->>''ok'')::boolean, false) THEN v_ok := v_ok + 1; ELSE v_skip := v_skip + 1; END IF;' IN src) = 0
     OR position(E'  RETURN jsonb_build_object(''ok'', true, ''applied'', v_ok, ''skipped'', v_skip,' IN src) = 0 THEN
    RAISE EXCEPTION '❌ إحدى مراسي الثلاث غير موجودة — أوقِفت.';
  END IF;

  src := replace(src, E'  v_unmatched jsonb := ''[]''::jsonb;',
    E'  v_unmatched jsonb := ''[]''::jsonb;\n  v_skipwhy   jsonb := ''[]''::jsonb;   -- v15.16 skip: لماذا لم يُكتب');

  src := replace(src,
    E'    IF COALESCE((v_res->>''ok'')::boolean, false) THEN v_ok := v_ok + 1; ELSE v_skip := v_skip + 1; END IF;',
    E'    -- v15.16 skip — `taki_set_on_hand` تُرجع `ok:true` مع `skipped` ولا\n'
    || E'    --   تكتب شيئاً (UNLIMITED · STALE_OBSERVATION). وعدُّها تطبيقاً كان\n'
    || E'    --   يجعل الشاشة تقول «فُهمت وطُبّقت» والرقمُ لم يتحرّك.\n'
    || E'    IF COALESCE((v_res->>''ok'')::boolean, false)\n'
    || E'       AND COALESCE(v_res->>''skipped'', '''') = '''' THEN\n'
    || E'      v_ok := v_ok + 1;\n'
    || E'    ELSE\n'
    || E'      v_skip := v_skip + 1;\n'
    || E'      v_skipwhy := v_skipwhy || to_jsonb(COALESCE(NULLIF(v_res->>''skipped'', ''''),\n'
    || E'                                                  NULLIF(v_res->>''error'', ''''), ''FAILED''));\n'
    || E'    END IF;');

  src := replace(src, E'  RETURN jsonb_build_object(''ok'', true, ''applied'', v_ok, ''skipped'', v_skip,',
    E'  RETURN jsonb_build_object(''ok'', true, ''applied'', v_ok, ''skipped'', v_skip,\n'
    || E'                            ''skip_reasons'', v_skipwhy,');

  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع أيّ رقعة.'; END IF;
  EXECUTE src;
  IF position('v15.16 skip' IN pg_get_functiondef('public.taki_stock_push(text,jsonb,timestamptz,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ ٢) «طُبّق» صار يعني كُتب فعلاً، ومعه سببُ التجاوُز.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٣) الاسترداد: لا تُعلَن الوحداتُ عائدةً قبل أن تعود
-- ═══════════════════════════════════════════════════════════════════════════
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.taki_restock_booking'::regproc);
  src0 := src;
  IF position('v15.16 restock' IN src) > 0 THEN RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN; END IF;
  IF position(E'  IF NOT COALESCE((v_res->>''ok'')::boolean, false) THEN\n    RETURN jsonb_build_object(''ok'', false, ''error'', ''SET_FAILED'', ''detail'', v_res);' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة الاسترداد غير موجودة — أوقِفت.';
  END IF;
  -- 🔴 يُدرَج **قبل** فحص `ok`: الحالةُ الخطيرة هي `ok:true` مع `skipped`.
  --    (وتجاوُزُ UNLIMITED مُعالَجٌ قبل هذا السطر بفرعٍ خاصّ، فلا يُمسّ.)
  src := replace(src,
    E'  IF NOT COALESCE((v_res->>''ok'')::boolean, false) THEN\n    RETURN jsonb_build_object(''ok'', false, ''error'', ''SET_FAILED'', ''detail'', v_res);',
    E'  -- v15.16 restock — كان يزيد `restocked_qty` بعد تجاوُزٍ صامت، فتضيع\n'
    || E'  --   وحداتُ الاسترداد إلى الأبد: المحاولةُ التالية تردّ `already:true`.\n'
    || E'  IF COALESCE(v_res->>''skipped'', '''') <> '''' THEN\n'
    || E'    RETURN jsonb_build_object(''ok'', false, ''error'', ''RESTOCK_NOT_APPLIED'',\n'
    || E'                              ''skipped'', v_res->>''skipped'', ''detail'', v_res);\n'
    || E'  END IF;\n'
    || E'  IF NOT COALESCE((v_res->>''ok'')::boolean, false) THEN\n'
    || E'    RETURN jsonb_build_object(''ok'', false, ''error'', ''SET_FAILED'', ''detail'', v_res);');
  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع الرقعة.'; END IF;
  EXECUTE src;
  IF position('v15.16 restock' IN pg_get_functiondef('public.taki_restock_booking'::regproc)) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ ٣) الاسترداد لا يُعلَن عائداً إلا إذا عاد.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٤) مفتاحُ التكرار: بصمةٌ **في نافذة**، لا بصمةٌ إلى الأبد
-- ═══════════════════════════════════════════════════════════════════════════
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure);
  src0 := src;
  IF position('v15.16 window' IN src) > 0 THEN RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN; END IF;
  IF position(E'                   ''h:'' || encode(extensions.digest(p_body::text, ''sha256''), ''hex''));' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة مفتاح الحدث غير موجودة — أوقِفت.';
  END IF;
  -- 🪤 خمسُ دقائق لا دقيقة: إعاداتُ زد عند ١ و٥ و١٥ دقيقة (موثَّقة)، فنافذةٌ
  --    أقصر تُعيد تطبيقَ نفس الرقم — وذلك **بلا أثر** لأن الكمّيات مطلقة.
  --    والاتجاهُ المقصود واضح: التهاون في الإهمال أخطرُ من التهاون في التكرار.
  src := replace(src,
    E'                   ''h:'' || encode(extensions.digest(p_body::text, ''sha256''), ''hex''));',
    E'                   -- v15.16 window — بصمةٌ + نافذةُ خمس دقائق. وبلا النافذة\n'
    || E'                   -- كانت كمّيةٌ تعود لقيمةٍ سبقت (٥ ⇐ ٨ ⇐ ٥) تُهمَل أبداً\n'
    || E'                   -- فتبقى تاكي على ٨ والواقعُ ٥ ⇒ بيعٌ زائدٌ دائم.\n'
    || E'                   ''h:'' || encode(extensions.digest(p_body::text, ''sha256''), ''hex'')\n'
    || E'                        || '':'' || (floor(extract(epoch from now()) / 300))::bigint::text);');
  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع الرقعة.'; END IF;
  EXECUTE src;
  IF position('v15.16 window' IN pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ ٤) مفتاحُ التكرار صار في نافذةِ خمس دقائق.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٥) `skip_when` لا يموت بأوّل خريطةٍ مُتعلَّمة
-- ═══════════════════════════════════════════════════════════════════════════
-- 🔴 رصدتُه بنفسي ثمّ أكّدته عدستا تدقيقٍ مستقلّتان بسلسلةٍ كاملة:
--    `v_map := COALESCE(v_i.field_map, _taki_provider_map(provider))` ⇒ فأوّلُ
--    خريطةٍ تُتعلَّم (أو يربطها التاجر من الشاشة) **تُقصي خريطةَ المزوّد
--    بكاملها**، و`skip_when` لا يوجد إلا فيها. ⇒ فحارسُ v15.15 (الذي كُتب
--    لئلّا يُصفّر منتجُ زدٍّ الأبُ مخزونَ التاجر) يموت **تماماً عند أوّل
--    استعمالٍ لزرِّ الإصلاح المعروض في نفس الشاشة**.
-- 🪤 ولماذا لم يُمسكه فحصُ v15.15 نفسه: حمولتاه تُحلّان عبر خريطة المزوّد،
--    فبقي `field_map` فارغاً طولَ الاختبار. **الاختبارُ الذي لا يصل الفرعَ
--    المعطوب يُبرّئ البريء.**
-- والعلاجُ دمجٌ لا إحلال: خريطةُ المزوّد أساسٌ، وما يكتبه التاجر يعلو عليها
-- في `id`/`qty` وحدهما — و`skip_when` يبقى لأنّ أحداً لا يكتبه.
DO $patch$
DECLARE src text; src0 text;
BEGIN
  src := pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure);
  src0 := src;
  IF position('v15.16 merge' IN src) > 0 THEN RAISE NOTICE 'ℹ️ مرقوعةٌ أصلاً.'; RETURN; END IF;
  IF position(E'  v_map := COALESCE(v_i.field_map, public._taki_provider_map(v_i.provider));' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة الخريطة غير موجودة — أوقِفت.';
  END IF;
  src := replace(src, E'  v_map := COALESCE(v_i.field_map, public._taki_provider_map(v_i.provider));',
    E'  -- v15.16 merge — دمجٌ لا إحلال: ما يكتبه التاجر يعلو في id/qty،\n'
    || E'  --   و`skip_when` من خريطة المزوّد يبقى لأنّ لا كاتبَ له.\n'
    || E'  v_map := COALESCE(public._taki_provider_map(v_i.provider), ''{}''::jsonb)\n'
    || E'           || COALESCE(v_i.field_map, ''{}''::jsonb);\n'
    || E'  IF v_map = ''{}''::jsonb THEN v_map := NULL; END IF;');
  -- 🪤 وثغرةٌ ثانيةٌ في نفس العيب: الحلقةُ المُتعلِّمة تُحلّ `v_map` بخريطةٍ
  --    جديدةٍ بلا `skip_when`، فيُبطَل الحارسُ **في نفس النداء**. ويُدمج هنا
  --    في الذاكرة فقط — ولا يُحفظ `skip_when` في `field_map` لئلّا يتجمّد
  --    جيلٌ قديمٌ منه ويعلو على خريطة المزوّد لاحقاً.
  IF position(E'        v_map := jsonb_build_object(''id'', v_cand[i][1], ''qty'', v_cand[i][2], ''learned'', true);\n        UPDATE public.stock_integrations SET field_map = v_map WHERE id = v_i.id;' IN src) = 0 THEN
    RAISE EXCEPTION '❌ مرساة الحلقة المُتعلِّمة غير موجودة — أوقِفت.';
  END IF;
  src := replace(src,
    E'        v_map := jsonb_build_object(''id'', v_cand[i][1], ''qty'', v_cand[i][2], ''learned'', true);\n        UPDATE public.stock_integrations SET field_map = v_map WHERE id = v_i.id;',
    E'        v_map := jsonb_build_object(''id'', v_cand[i][1], ''qty'', v_cand[i][2], ''learned'', true);\n'
    || E'        UPDATE public.stock_integrations SET field_map = v_map WHERE id = v_i.id;\n'
    || E'        -- v15.16 merge2 — ويبقى حارسُ المزوّد سارياً في هذا النداء نفسه\n'
    || E'        v_map := COALESCE(public._taki_provider_map(v_i.provider), ''{}''::jsonb) || v_map;');

  IF src = src0 THEN RAISE EXCEPTION '❌ لم تقع الرقعة.'; END IF;
  EXECUTE src;
  IF position('v15.16 merge2' IN pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION '❌ الرقعة لم تُنفَّذ.';
  END IF;
  RAISE NOTICE '✅ ٥) خريطةُ التاجر تُدمج ولا تُقصي حارسَ الصفر.';
END
$patch$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٦) `stock_inbox` جدولٌ ينمو بلا منظّف — وهو سجلُّ تكرارٍ لا سجلُّ أعمال
-- ═══════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS ix_stock_inbox_received ON public.stock_inbox (received_at);

CREATE OR REPLACE FUNCTION public.taki_prune_stock_inbox()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_n int;
BEGIN
  -- 🪤 سبعةُ أيام تكفي بفارقٍ كبير: أطولُ إعادةٍ موثَّقة عند زد ١٥ دقيقة،
  --    ونافذةُ البصمة خمسُ دقائق. والإبقاءُ أبداً كان يُفقد كمّياتٍ (القسم ٤).
  DELETE FROM public.stock_inbox WHERE received_at < now() - interval '7 days';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END
$fn$;
REVOKE ALL ON FUNCTION public.taki_prune_stock_inbox() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.taki_prune_stock_inbox() FROM anon;
REVOKE ALL ON FUNCTION public.taki_prune_stock_inbox() FROM authenticated;

SELECT cron.unschedule('taki-stock-inbox-prune')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-stock-inbox-prune');
-- 🪤 خادمُ جدة على `+03:00` لا UTC (درسٌ مسجَّل): ٣:٥٠ هنا = ٣:٥٠ فجراً
--    بالرياض، بعد النسخة (٣:٣٠) وقبل تحديثات الأمان (٤:٣٠).
SELECT cron.schedule('taki-stock-inbox-prune', '50 3 * * *',
                     $$SELECT public.taki_prune_stock_inbox();$$);

-- ═══════════════════════════════════════════════════════════════════════════
-- ٧) فحصٌ سلوكيٌّ يرفع استثناءً — ومعه **كسرُ كلّ حارس**
-- ═══════════════════════════════════════════════════════════════════════════
-- 🪤 وقاعدتان مدفوعتا الثمن في هذا المشروع تُطبَّقان حرفياً هنا:
--    ١) جدولُ «✅/❌» لا يُفشل `psql` — كلُّ تحقّقٍ `DO` يرفع استثناءً.
--    ٢) الاختبارُ الذي لا يصل الفرعَ المعطوب يُبرّئ البريء. ففحصُ v15.15 مرّ
--       أخضرَ وعيبُ `skip_when` حيٌّ، لأنّ حمولتَيه لم تجعلا `field_map` ممتلئاً.
--       ⇒ فكلُّ فحصٍ هنا يُشغَّل **في الشرط الذي يكسر**، لا في الشرط المريح.
DO $verify$
DECLARE
  v_me text; v_deal text; v_int uuid; v_oh0 int; v_oh int;
  r jsonb; v_ev text; v_src text; v_pg int; v_pu int;
  v_t0 timestamptz := now();   -- 🪤 `now()` لا `clock_timestamp()`: أحداثُ المخزون تُطبَع بـ`now()` فالمقارنةُ بغيرها تُفلتها
  K constant text := 'taki_v1516_probe_0123456789abcdef';
BEGIN
  -- ── (٠) البنيةُ أوّلاً: الرقعُ الخمس حاضرةٌ في النصّ الحيّ ──────────────
  IF position('v15.16 clamp2'  IN pg_get_functiondef('public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)'::regprocedure)) = 0
     OR position('v15.16 skip' IN pg_get_functiondef('public.taki_stock_push(text,jsonb,timestamptz,text)'::regprocedure)) = 0
     OR position('v15.16 window' IN pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure)) = 0
     OR position('v15.16 merge'  IN pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure)) = 0
     OR position('v15.16 restock' IN pg_get_functiondef('public.taki_restock_booking'::regproc)) = 0 THEN
    RAISE EXCEPTION '❌ إحدى الرقع الخمس غائبةٌ عن النصّ الحيّ.';
  END IF;

  -- ── (٠-ب) الاسترداد: يُثبت **ترتيباً** لا سلوكاً، ويُقال ذلك صريحاً ─────
  -- 🔴 ولماذا لا يُثبت سلوكياً: إثباتُه يستلزم تلفيقَ حجزٍ «مكتمل» على قاعدة
  --    الإنتاج، ومشغّلاتُ `bookings` تُطلق إشعاراتٍ حقيقيةً وسجلَّ نشاط
  --    لمستخدمين حقيقيين. فالمقيسُ هنا: الحارسُ **يسبق** زيادةَ `restocked_qty`
  --    في الجسم الحيّ — ومع كون `taki_set_on_hand` تُرجع `skipped` فعلاً
  --    (مُقاسٌ في الفرع «أ» أدناه) تكتمل السلسلة.
  -- 🪤 وأوّلُ صياغةٍ لهذا الفحص **فشلت فشلاً كاذباً**، وهي درسٌ يستحقّ البقاء:
  --    قِستُ `position()` على الجسم كلّه، و`position` تجد **أوّل** ورود —
  --    وهناك زيادةٌ ثانيةٌ لـ`restocked_qty` في فرع «بلا حدّ» تسبق الحارس
  --    عمداً (منتجٌ بلا حدّ لا شيءَ يُعاد إليه). فاتّهم الفحصُ كوداً سليماً.
  --    ⇒ القياسُ الصحيح **داخل المقطع الذي يلي نداء `taki_set_on_hand`**.
  v_src := pg_get_functiondef('public.taki_restock_booking'::regproc);
  v_pg  := position('v_res := public.taki_set_on_hand(' IN v_src);
  IF v_pg = 0 THEN RAISE EXCEPTION '❌ لم يُعثر على نداء taki_set_on_hand.'; END IF;
  v_src := substr(v_src, v_pg);
  v_pg  := position('RESTOCK_NOT_APPLIED' IN v_src);
  v_pu  := position('UPDATE public.bookings SET restocked_qty' IN v_src);
  IF v_pg = 0 OR v_pu = 0 THEN
    RAISE EXCEPTION '❌ لم يُعثر على الحارس أو على زيادة restocked_qty بعد النداء.';
  END IF;
  IF v_pg > v_pu THEN
    RAISE EXCEPTION '❌ الحارسُ بعد الزيادة (%, %) — فلا يمنع فقدانَ الوحدات.', v_pg, v_pu;
  END IF;
  RAISE NOTICE 'ℹ️ الاسترداد: الحارسُ يسبق الزيادة (% < %) — مُثبتٌ ترتيباً.', v_pg, v_pu;

  -- ── عرضٌ صالحٌ للقياس، بلا حجوزٍ معلّقة ────────────────────────────────
  SELECT d.store_id, d.id, d.on_hand INTO v_me, v_deal, v_oh0
    FROM public.deals d
   WHERE d.on_hand IS NOT NULL AND COALESCE(d.is_unlimited, false) = false
     AND public.taki_open_holds(d.id, NULL, NULL) = 0
   ORDER BY d.id LIMIT 1;
  IF v_deal IS NULL THEN RAISE NOTICE 'ℹ️ لا عرضَ صالحٌ — تخطّي السلوكيّ.'; RETURN; END IF;

  INSERT INTO public.stock_integrations
    (store_id, provider, segment, label, api_key_hash, api_key_last4)
  VALUES (v_me, 'zid', 'ecommerce', 'v1516-verify',
          encode(extensions.digest(K, 'sha256'), 'hex'), right(K, 4))
  RETURNING id INTO v_int;
  INSERT INTO public.stock_links (integration_id, store_id, deal_id, external_id)
  VALUES (v_int, v_me, v_deal, 'V1516-SKU');

  -- ╔═ (أ) قصُّ علامة الزمن ════════════════════════════════════════════════╗
  -- زمنٌ ٣ ساعاتٍ في المستقبل: الرقمُ يُكتب، والعلامةُ **لا** تتقدّم ٣ ساعات.
  r := public.taki_stock_push(K, jsonb_build_array(
         jsonb_build_object('external_id', 'V1516-SKU', 'on_hand', v_oh0 + 3)),
         now() + interval '3 hours', 'v1516-clamp-1');
  IF COALESCE((r->>'applied')::int, 0) <> 1 THEN
    RAISE EXCEPTION '❌ رقمٌ صحيحٌ لم يُطبَّق مع زمنٍ مستقبليّ: %', r::text;
  END IF;
  IF (SELECT stock_observed_at FROM public.deals WHERE id = v_deal) > now() THEN
    RAISE EXCEPTION '❌ 🔴 العلامةُ تقدّمت إلى المستقبل (%) — كلُّ كتابةٍ بعدها تُجمَّد.',
      (SELECT stock_observed_at FROM public.deals WHERE id = v_deal);
  END IF;
  -- 🔴 **الكسرةُ الحقيقية**: بلا القصّ، النداءُ التالي بـ`now()` كان يُرفض
  --    `STALE_OBSERVATION` صامتاً. فليُقَس أنه يمرّ الآن.
  r := public.taki_stock_push(K, jsonb_build_array(
         jsonb_build_object('external_id', 'V1516-SKU', 'on_hand', v_oh0 + 4)),
         now(), 'v1516-clamp-2');
  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 + 4 THEN
    RAISE EXCEPTION '❌ 🔴 الكتابةُ بعد زمنٍ مستقبليّ جُمّدت (% بدل %): %',
      v_oh, v_oh0 + 4, r::text;
  END IF;
  RAISE NOTICE '✅ أ) زمنٌ مستقبليٌّ ٣ ساعات: الرقمُ كُتب، والعلامةُ لم تتقدّم، والتاليةُ لم تُجمَّد.';

  -- ╔═ (ب) محاسبةٌ صادقة ═══════════════════════════════════════════════════╗
  -- زمنٌ أقدمُ من العلامة ⇒ تجاوُزٌ حقيقيّ ⇒ يجب أن يُعَدّ تجاوُزاً لا تطبيقاً.
  r := public.taki_stock_push(K, jsonb_build_array(
         jsonb_build_object('external_id', 'V1516-SKU', 'on_hand', v_oh0 + 99)),
         now() - interval '1 hour', 'v1516-stale');
  IF COALESCE((r->>'applied')::int, -1) <> 0 THEN
    RAISE EXCEPTION '❌ 🔴 تجاوُزٌ عُدّ تطبيقاً — الشاشةُ تقول «طُبّقت» ولم يُكتب: %', r::text;
  END IF;
  IF NOT (r->'skip_reasons' @> '["STALE_OBSERVATION"]'::jsonb) THEN
    RAISE EXCEPTION '❌ سببُ التجاوُز لم يُقَل: %', r::text;
  END IF;
  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 + 4 THEN RAISE EXCEPTION '❌ كُتب رقمٌ قديم (%).', v_oh; END IF;
  RAISE NOTICE '✅ ب) تجاوُزٌ عُدّ تجاوُزاً، وسببُه مُعلَن، ولا كتابة.';

  -- ╔═ (ج) نافذةُ التكرار ══════════════════════════════════════════════════╗
  -- 🪤 ويُستعمل مزوّدٌ بلا خريطةٍ (`custom`) لئلّا يتدخّل `skip_when`.
  UPDATE public.stock_integrations SET provider = 'custom' WHERE id = v_int;
  r := public.taki_stock_webhook(K, jsonb_build_object('id', 'V1516-SKU', 'quantity', v_oh0 + 6));
  IF COALESCE((r->'push'->>'applied')::int, 0) <> 1 THEN
    RAISE EXCEPTION '❌ أوّلُ رسالةٍ لم تُطبَّق: %', r::text;
  END IF;
  -- 🪤 ويُنتقى صفُّ البصمة بنمطه لا بـ`ORDER BY received_at`: الكتلةُ كلُّها
  --    معاملةٌ واحدة و`now()` ثابتةٌ فيها، فكلُّ الصفوف بنفس الطابع الزمنيّ
  --    والترتيبُ بينها غيرُ محدَّد — وأوّلُ صياغةٍ لي التقطت مفتاحاً صريحاً
  --    من فحصٍ سابق فاتّهمت الإصلاحَ بأنه لم يقع.
  SELECT event_id INTO v_ev FROM public.stock_inbox
   WHERE integration_id = v_int AND event_id LIKE 'h:%' LIMIT 1;
  IF v_ev IS NULL THEN RAISE EXCEPTION '❌ لم يُسجَّل مفتاحُ بصمةٍ إطلاقاً.'; END IF;
  -- 🔴 المفتاحُ يجب أن يحمل النافذة صراحةً، وإلّا فالإصلاحُ وهم
  IF v_ev !~ '^h:[0-9a-f]{64}:[0-9]+$' THEN
    RAISE EXCEPTION '❌ 🔴 مفتاحُ التكرار بلا نافذةٍ زمنية (%) — فكمّيةٌ تعود لقيمةٍ سبقت تُهمَل أبداً.', v_ev;
  END IF;
  -- نفسُ الجسم فوراً ⇒ تكرارٌ (وهو المطلوب داخل النافذة)
  r := public.taki_stock_webhook(K, jsonb_build_object('id', 'V1516-SKU', 'quantity', v_oh0 + 6));
  IF NOT COALESCE((r->'push'->>'duplicate')::boolean, false) THEN
    RAISE EXCEPTION '❌ إعادةٌ فوريّة لم تُعَدّ تكراراً — فإعادةُ المرسِل تُطبَّق مرّتين: %', r::text;
  END IF;
  -- وبانقضاء النافذة (تُحاكى بحذف صفّها) يُطبَّق نفسُ الرقم ثانيةً
  DELETE FROM public.stock_inbox WHERE integration_id = v_int;
  r := public.taki_stock_webhook(K, jsonb_build_object('id', 'V1516-SKU', 'quantity', v_oh0 + 6));
  IF COALESCE((r->'push'->>'duplicate')::boolean, false) THEN
    RAISE EXCEPTION '❌ 🔴 الجسمُ نفسه بقي مهمَلاً بعد انقضاء النافذة: %', r::text;
  END IF;
  RAISE NOTICE '✅ ج) إعادةٌ فوريّةٌ تُهمَل · ونفسُ الرقم بعد النافذة يُطبَّق · والمفتاحُ يحمل نافذتَه (%).', right(v_ev, 12);

  -- ╔═ (د) `skip_when` لا يموت — وهذا هو الفرعُ الذي برّأه فحصُ v15.15 ═════╗
  UPDATE public.stock_integrations SET provider = 'zid', field_map = NULL WHERE id = v_int;
  PERFORM public.taki_set_on_hand(v_deal, v_oh0 + 7, NULL, NULL, now(), 'verify');
  DELETE FROM public.stock_inbox WHERE integration_id = v_int;
  -- (د-١) بلا خريطةِ تاجر: الحارسُ يعمل (وهو ما قاسه v15.15)
  r := public.taki_stock_webhook(K, jsonb_build_object(
         'id', 'V1516-SKU', 'quantity', 0, 'structure', 'parent', 'stocks', '[]'::jsonb));
  IF COALESCE(r->>'reason', '') <> 'PARENT_OR_UNLIMITED' THEN
    RAISE EXCEPTION '❌ الحارسُ لم يعمل بلا خريطةِ تاجر: %', r::text;
  END IF;
  -- (د-٢) 🔴 **الكسرةُ**: خريطةٌ مُتعلَّمة موجودة — وهي الحالةُ التي كان
  --        الحارسُ يموت فيها تماماً فيُكتب صفرٌ ويُصفّر مخزونُ التاجر.
  UPDATE public.stock_integrations
     SET field_map = '{"id":"id","qty":"quantity","learned":true}'::jsonb WHERE id = v_int;
  DELETE FROM public.stock_inbox WHERE integration_id = v_int;
  r := public.taki_stock_webhook(K, jsonb_build_object(
         'id', 'V1516-SKU', 'quantity', 0, 'structure', 'parent', 'stocks', '[]'::jsonb));
  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 + 7 THEN
    RAISE EXCEPTION '❌ 🔴 مع خريطةٍ مُتعلَّمة كُتب صفرُ المنتج الأب (% ⇐ %) — مخزونُ التاجر صُفّر.',
      v_oh0 + 7, v_oh;
  END IF;
  IF COALESCE(r->>'reason', '') <> 'PARENT_OR_UNLIMITED' THEN
    RAISE EXCEPTION '❌ لم يُرفض لسببه الصحيح مع خريطةٍ مُتعلَّمة: %', r::text;
  END IF;
  -- (د-٣) وخريطةُ التاجر يجب أن **تعلو** فعلاً، وإلّا صار الدمجُ يُعطّل الربط
  UPDATE public.stock_integrations
     SET field_map = '{"id":"weird.code","qty":"weird.left"}'::jsonb WHERE id = v_int;
  DELETE FROM public.stock_inbox WHERE integration_id = v_int;
  r := public.taki_stock_webhook(K, jsonb_build_object(
         'weird', jsonb_build_object('code', 'V1516-SKU', 'left', v_oh0 + 8)));
  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 + 8 THEN
    RAISE EXCEPTION '❌ خريطةُ التاجر لم تعلُ على خريطة المزوّد (% بدل %): %',
      v_oh, v_oh0 + 8, r::text;
  END IF;
  RAISE NOTICE '✅ د) الحارسُ يعمل بخريطةٍ مُتعلَّمة وبلا خريطة · وخريطةُ التاجر تعلو · وصفرُ الأب لا يُكتب.';

  -- ╔═ (هـ) الاستعادة ══════════════════════════════════════════════════════╗
  PERFORM public.taki_set_on_hand(v_deal, v_oh0, NULL, NULL, now(), 'init');
  DELETE FROM public.stock_integrations WHERE id = v_int;
  -- 🪤 مقيَّدٌ بزمن الفحص: حذفُ كلّ `sync` لهذا العرض كان سيمسح سجلّاً حقيقياً.
  DELETE FROM public.stock_events WHERE deal_id = v_deal AND occurred_at >= v_t0;
  SELECT on_hand INTO v_oh FROM public.deals WHERE id = v_deal;
  IF v_oh <> v_oh0 THEN RAISE EXCEPTION '❌ العرضُ % لم يعد إلى %.', v_deal, v_oh0; END IF;
  IF EXISTS (SELECT 1 FROM public.stock_integrations WHERE label = 'v1516-verify') THEN
    RAISE EXCEPTION '❌ بقيّةُ فحصٍ لم تُحذف.';
  END IF;

  RAISE NOTICE '✅ v15.16: أربعةُ عيوبٍ صامتة سُدّت، وكلُّ حارسٍ قِيس في الشرط الذي يكسره.';
END
$verify$;

-- ═══════════════════════════════════════════════════════════════════════════
-- ٨) الجدولُ للقراءة فقط — والتحقّقُ أعلاه هو الذي يُفشل
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS "ما", current_setting('server_version') AS "القيمة"
UNION ALL SELECT 'قصُّ علامة الزمن',
  CASE WHEN position('v15.16 clamp2' IN pg_get_functiondef('public.taki_set_on_hand(text,integer,jsonb,jsonb,timestamptz,text)'::regprocedure)) > 0
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'محاسبةُ «طُبّق»',
  CASE WHEN position('v15.16 skip' IN pg_get_functiondef('public.taki_stock_push(text,jsonb,timestamptz,text)'::regprocedure)) > 0
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'حارسُ الاسترداد',
  CASE WHEN position('v15.16 restock' IN pg_get_functiondef('public.taki_restock_booking'::regproc)) > 0
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'نافذةُ التكرار',
  CASE WHEN position('v15.16 window' IN pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure)) > 0
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'دمجُ skip_when',
  CASE WHEN position('v15.16 merge' IN pg_get_functiondef('public.taki_stock_webhook(text,jsonb,text)'::regprocedure)) > 0
       THEN '✅' ELSE '❌' END
UNION ALL SELECT 'منظّفُ stock_inbox',
  CASE WHEN EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'taki-stock-inbox-prune') THEN '✅' ELSE '❌' END;
