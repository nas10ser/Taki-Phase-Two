-- ════════════════════════════════════════════════════════════════════════════
-- TAKI v14.49 — زرّ «فتح تاكي» في كل بريد المنصّة يحمل النطاق الرسمي
-- ════════════════════════════════════════════════════════════════════════════
-- كُشف أثناء فحص `APP_URL` (١٥ سبتمبر ٢٠٢٦): `taki_email_wrap` — الغلاف الذي
-- يلفّ **كل** بريد تُرسله المنصّة — يحمل `https://taki-test-eight.vercel.app`
-- مكتوباً نصّاً داخل الدالة، ولا يقرأ `APP_URL` ولا أي إعداد.
--
-- تسمّيها سبع دوال: admin_broadcast_notification · admin_notify_user ·
-- admin_test_message_event · notify_subscription_invoice ·
-- taki_store_profiles_subscription_notify · taki_subscription_maintenance ·
-- warn_expiring_bookings. أي أن كل بريد حملة أو إشعار اشتراك أو تنبيه حجز
-- يُظهر للمستخدم اسم vercel لا اسم تاكي.
--
-- الرابط **يعمل** اليوم (النطاق القديم يحوّل بـ308) — فالعطل سمعةٌ لا وظيفة:
-- المستقبِل يرى عنواناً غريباً في زرٍّ يُفترض أنه بريد رسمي من تاكي.
--
-- ✅ آمن: نفس التوقيع ونفس نوع الإرجاع (`text`) فـ`CREATE OR REPLACE` تكفي،
--    ولا فهرس يعتمد عليها (قِيس: صفر)، فوسم `IMMUTABLE` يبقى كما هو.
-- 🪤 ولم أجعلها تقرأ الإعداد من جدول: ذلك يُبطل `IMMUTABLE` وهي وسمٌ يعتمد
--    عليه المخطّط. النطاق ثابتٌ ورسميّ، والحارس الحقيقي هو الفحص في آخر الملف.
--
-- الخادم المستهدف: **جدة (الإنتاج)**. يرفض التنفيذ على مختبر طوكيو.
-- ════════════════════════════════════════════════════════════════════════════

DO $guard$
BEGIN
  IF obj_description('public'::regnamespace, 'pg_namespace') = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN
    RAISE EXCEPTION 'TOKYO_LAB_REFUSED: هذه هجرة إنتاج. نفّذها على جدة.';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.taki_email_wrap(p_title text, p_body_html text)
RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public', 'pg_temp'
AS $function$
SELECT '<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8"></head>'
    || '<body style="margin:0;padding:0;background:#f4f7f6;font-family:-apple-system,''Segoe UI'',Tahoma,Arial,sans-serif;">'
    || '<div style="max-width:600px;margin:0 auto;padding:24px 16px;">'
    || '<div style="background:linear-gradient(135deg,#10b981,#0d9488);border-radius:16px 16px 0 0;padding:22px 24px;text-align:center;">'
    || '<div style="font-size:26px;font-weight:900;color:#ffffff;letter-spacing:1px;">TAKI — تاكي</div>'
    || '<div style="font-size:12px;color:#d1fae5;margin-top:4px;">منصة حجز التخفيضات في السعودية</div></div>'
    || '<div style="background:#ffffff;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 16px 16px;padding:26px 24px;">'
    || '<h1 style="font-size:19px;margin:0 0 14px;color:#111827;text-align:right;">' || COALESCE(p_title,'') || '</h1>'
    || '<div style="font-size:14px;line-height:2;color:#374151;text-align:right;">' || COALESCE(p_body_html,'') || '</div>'
    || '<div style="margin-top:22px;text-align:center;">'
    || '<a href="https://www.takisa.net" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 28px;border-radius:12px;">فتح تاكي</a></div></div>'
    || '<div style="text-align:center;font-size:11px;color:#9ca3af;padding:14px 6px;">وصلتك هذه الرسالة لأنك مشترك في منصة تاكي. يمكنك التحكم بالإشعارات من صفحة حسابك.</div>'
    || '</div></body></html>';
$function$;

COMMENT ON FUNCTION public.taki_email_wrap(text, text) IS
  'v14.49 — غلاف بريد المنصّة. النطاق الرسمي https://www.takisa.net مكتوبٌ هنا نصّاً عمداً (الدالة IMMUTABLE فلا تقرأ جدولاً) — أي تغيير للنطاق يمرّ بهذه الدالة.';

-- ════════════════════════════════════════════════════════════════════════════
-- التحقّق
-- ════════════════════════════════════════════════════════════════════════════
SELECT 'الخادم' AS الفحص,
       CASE WHEN obj_description('public'::regnamespace,'pg_namespace')
                 = 'TAKI_LAB_TOKYO_MARKER_v1382' THEN '❌ مختبر طوكيو'
            ELSE '✅ جدة (الإنتاج)' END AS النتيجة
UNION ALL SELECT 'زرّ البريد يحمل النطاق الرسمي',
       CASE WHEN public.taki_email_wrap('t','b') LIKE '%href="https://www.takisa.net"%'
            THEN '✅ نعم' ELSE '❌ لا' END
UNION ALL SELECT 'لا أثر للنطاق القديم في أي دالة',
       CASE WHEN (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.prokind='f'
                    AND pg_get_functiondef(p.oid) LIKE '%taki-test-eight%') = 0
            THEN '✅ صفر' ELSE '❌ باقٍ' END
UNION ALL SELECT 'الدوال السبع التي تلفّ بريدها ما زالت موجودة',
       (SELECT count(*)::text || '/7' FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.prokind='f'
          AND p.proname IN ('admin_broadcast_notification','admin_notify_user','admin_test_message_event',
                            'notify_subscription_invoice','taki_store_profiles_subscription_notify',
                            'taki_subscription_maintenance','warn_expiring_bookings'))
UNION ALL SELECT 'الوسم IMMUTABLE محفوظ',
       CASE WHEN (SELECT provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
                  WHERE n.nspname='public' AND p.proname='taki_email_wrap') = 'i'
            THEN '✅ نعم' ELSE '❌ تغيّر' END;
