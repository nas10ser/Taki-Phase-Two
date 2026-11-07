-- ═══════════════════════════════════════════════════════════════════════════
-- v15.64 — سقفُ البثّ الحيّ يُنتزع من الكود ويصير مشتقّاً من العتاد
-- ═══════════════════════════════════════════════════════════════════════════
-- أمرُ ناصر: «اجعله بدون سقف ورقم محدد استعدادا لملايين المستخدمين».
--
-- 🔴 والسقفُ لم يكن حيث ظننتُه. قِيس بالتجربة:
--    ١) `UPDATE _realtime.tenants SET max_concurrent_users=50000` ⇒ نجح.
--    ٢) أُعيد إنشاءُ حاوية البثّ ⇒ عاد **٢٠٠**.
--    السببُ في `seeds.exs` داخل الحاوية: البذرُ (`SEED_SELF_HOST=true`)
--    **يحذف صفَّ المستأجر ويُعيد إدراجه** عند كل إقلاع.
--    ٣) فغيّرتُ **افتراضاتَ الأعمدة** (`ALTER COLUMN … SET DEFAULT`) ⇒ أُعيد
--       التشغيلُ فعاد **٢٠٠ أيضاً**: Ecto يُرسل قيمَه هو مُدمجةً في الإصدار،
--       فلا يرى افتراضَ القاعدة إطلاقاً.
--
-- ⇒ فالموضعُ الوحيد الذي يصمد أمام البذر هو **مشغّلٌ في القاعدة**.
--
-- 🪤 وتعطيلُ `SEED_SELF_HOST` كان أسهل — ومرفوض: البذرُ هو ما يُزامن
--    `tenants.jwt_secret` مع `API_JWT_SECRET` في البيئة. ودوّرنا سرّ JWT
--    قبل أيّامٍ قليلة ⇒ تعطيلُه يُجمّد السرّ على قيمةٍ تُرمى عند أوّل تدوير،
--    فيصمت البثُّ الحيُّ كلُّه بلا أي رسالة خطأ.
--
-- 🪤 ولا يُكتب الرقمُ في المشغّل: المشغّلُ يقرأ `public.taki_realtime_limits`،
--    و`scripts/tune-server.sh` يكتبها **من `nproc` والذاكرة**. فترقيةُ
--    الخادم = إعادةُ تشغيل السكربت، بلا هجرةٍ ولا تعديل كود.
--    وعمودٌ `NULL` يعني «لا تفرض هذا» — فالهجرةُ وحدها لا تُغيّر سلوكاً.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── حارس: يرفض التنفيذ على مختبر طوكيو ───────────────────────────────────
DO $$
BEGIN
  IF COALESCE(obj_description('public'::regnamespace, 'pg_namespace'), '')
     = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'هذه قاعدةُ المختبر (طوكيو) — الهجرةُ لجدة وحدها.';
  END IF;
  IF to_regclass('_realtime.tenants') IS NULL THEN
    RAISE EXCEPTION 'لا جدول _realtime.tenants — ليست قاعدةَ سوبابيس المستضافة.';
  END IF;
END $$;

-- ── ١) جدولُ السقوف: مصدرٌ واحدٌ يكتبه السكربتُ من العتاد ────────────────
CREATE TABLE IF NOT EXISTS public.taki_realtime_limits (
  id                       boolean PRIMARY KEY DEFAULT true CHECK (id),
  max_concurrent_users     integer,
  max_events_per_second    integer,
  max_joins_per_second     integer,
  max_channels_per_client  integer,
  max_bytes_per_second     bigint,
  max_payload_size_in_kb   integer,
  max_presence_events_per_second integer,
  derived_from             text,      -- «نواة واحدة · ٥٩٠١ م.ب» — ليُعرف مصدرُ الرقم
  updated_at               timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.taki_realtime_limits IS
  'سقوفُ البثّ الحيّ — يكتبها scripts/tune-server.sh مشتقّةً من عتاد الخادم. '
  'NULL في عمودٍ = لا تفرض هذا السقف. يفرضها مشغّلٌ على _realtime.tenants '
  'لأن بذرَ حاوية البثّ يحذف الصفّ ويُعيد إدراجه عند كل إقلاع.';

INSERT INTO public.taki_realtime_limits (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- 🪤 ولا تُقرأ من المتصفّح: ليست إعداداً للتطبيق بل سقفَ بنيةٍ تحتيّة.
ALTER TABLE public.taki_realtime_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.taki_realtime_limits FROM PUBLIC;
REVOKE ALL ON public.taki_realtime_limits FROM anon, authenticated;

-- ── ٢) المشغّلُ الذي يفرضها على كل إدراجٍ أو تحديث ───────────────────────
CREATE OR REPLACE FUNCTION _realtime.taki_force_tenant_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE L public.taki_realtime_limits;
BEGIN
  SELECT * INTO L FROM public.taki_realtime_limits WHERE id;
  IF NOT FOUND THEN RETURN NEW; END IF;   -- لا سقوفَ مضبوطة ⇒ لا تدخّل

  -- COALESCE على جهة السقف: عمودٌ NULL يترك ما أرسله البذر كما هو.
  NEW.max_concurrent_users     := COALESCE(L.max_concurrent_users,     NEW.max_concurrent_users);
  NEW.max_events_per_second    := COALESCE(L.max_events_per_second,    NEW.max_events_per_second);
  NEW.max_joins_per_second     := COALESCE(L.max_joins_per_second,     NEW.max_joins_per_second);
  NEW.max_channels_per_client  := COALESCE(L.max_channels_per_client,  NEW.max_channels_per_client);
  NEW.max_bytes_per_second     := COALESCE(L.max_bytes_per_second,     NEW.max_bytes_per_second);
  NEW.max_payload_size_in_kb   := COALESCE(L.max_payload_size_in_kb,   NEW.max_payload_size_in_kb);
  NEW.max_presence_events_per_second :=
      COALESCE(L.max_presence_events_per_second, NEW.max_presence_events_per_second);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tr_taki_force_tenant_limits ON _realtime.tenants;
CREATE TRIGGER tr_taki_force_tenant_limits
  BEFORE INSERT OR UPDATE ON _realtime.tenants
  FOR EACH ROW EXECUTE FUNCTION _realtime.taki_force_tenant_limits();

-- ── ٣) التحقّق: سلوكيٌّ ويرفع استثناءً ───────────────────────────────────
-- 🪤 وجودُ المشغّل لا يُثبت أنه يفرض: يُجرَّب بقيمةٍ اختباريّة ثمّ تُعاد NULL.
--    (وجدولُ ✅/❌ وحده لا يُفشل psql — فالتحقّقُ `DO` يرفع.)
DO $$
DECLARE v integer; probe integer := 424242;
BEGIN
  UPDATE public.taki_realtime_limits SET max_concurrent_users = probe WHERE id;
  UPDATE _realtime.tenants SET max_concurrent_users = 200;        -- ما يفعله البذر
  SELECT max_concurrent_users INTO v FROM _realtime.tenants LIMIT 1;
  IF v IS DISTINCT FROM probe THEN
    RAISE EXCEPTION 'المشغّلُ لا يفرض السقف: كُتب 200 فقُرئ % (المتوقَّع %)', v, probe;
  END IF;

  -- والعكسُ: NULL يعني «لا تفرض» — وإلّا صار الجدولُ سجناً لا إعداداً.
  UPDATE public.taki_realtime_limits SET max_concurrent_users = NULL WHERE id;
  UPDATE _realtime.tenants SET max_concurrent_users = 777;
  SELECT max_concurrent_users INTO v FROM _realtime.tenants LIMIT 1;
  IF v IS DISTINCT FROM 777 THEN
    RAISE EXCEPTION 'NULL لم يُترك حرّاً: كُتب 777 فقُرئ %', v;
  END IF;

  RAISE NOTICE '✅ المشغّلُ يفرض عند الضبط، ويُخلّي عند NULL.';
END $$;

-- ── ٤) جدولُ القراءة (أوّلُ سطرٍ اسمُ الخادم) ─────────────────────────────
SELECT 'الخادم' AS "البند", current_setting('server_version') AS "القيمة",
       CASE WHEN COALESCE(obj_description('public'::regnamespace,'pg_namespace'),'')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ المختبر' ELSE '✅ جدة' END AS "الحالة"
UNION ALL SELECT 'جدولُ السقوف',
       (SELECT count(*)::text FROM public.taki_realtime_limits),
       CASE WHEN to_regclass('public.taki_realtime_limits') IS NOT NULL THEN '✅' ELSE '❌' END
UNION ALL SELECT 'المشغّل', 'tr_taki_force_tenant_limits',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger
                         WHERE tgname='tr_taki_force_tenant_limits' AND NOT tgisinternal)
            THEN '✅' ELSE '❌' END
UNION ALL SELECT 'سقفُ المتزامنين الآن',
       (SELECT max_concurrent_users::text FROM _realtime.tenants LIMIT 1),
       'ℹ️ يكتبه tune-server.sh';
