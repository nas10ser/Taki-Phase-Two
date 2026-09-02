# قوالب بريد GoTrue — ثنائية اللغة (عربي / إنجليزي)

كل ملف هنا هو قالب Go (`html/template`) يقرأه GoTrue على خادم جدة عبر HTTPS.

## كيف تُختار اللغة
GoTrue يمرّر `raw_user_meta_data` للقالب باسم `.Data`. الموقع يكتب فيه
`lang: 'ar' | 'en'` لحظة التسجيل، وتريجر على `public.users` يبقيه مطابقاً
لـ`preferred_lang` كلما غيّر المستخدم لغته. القالب يقرأ `.Data.lang`:

    {{ $en := false }}{{ if .Data }}{{ if .Data.lang }}{{ if eq (print .Data.lang) "en" }}{{ $en = true }}{{ end }}{{ end }}{{ end }}

الافتراضي **عربي** — أي بريد بلا `lang` (حسابات ما قبل هذا الإصدار،
أو دعوة أدمن) يصل بالعربية.

## لماذا هيكل HTML واحد ونصوص مشروطة؟
`html/template` يحسب «سياق المخرج» لكل فرع من `{{ if }}`، ويرفض القالب
بخطأ `cannot compute output context` لو اختلف السياق بين الفرعين. لذلك
الوسوم واحدة دائماً، والمشروط هو النصّ وقيمة `dir` فقط. والتصميم موسَّط
فيعمل مع الاتجاهين بلا أي `style` مشروط.

## المتغيّرات المتاحة
`.ConfirmationURL` · `.Token` · `.TokenHash` · `.Email` · `.NewEmail`
`.SiteURL` · `.RedirectTo` · `.Data` (= `raw_user_meta_data`)

## النشر
    bash scripts/deploy-email-templates.sh

القوالب تُنسخ إلى `/opt/taki/supabase/volumes/proxy/caddy/email-templates/`
ويخدمها Caddy على `https://api.takisa.net/email-templates/<name>.html`.
GoTrue يخزّنها مؤقتاً **١٠ دقائق** (`MAILER_TEMPLATE_MAX_AGE`)، فأي تعديل
يسري خلال ١٠ دقائق بلا إعادة تشغيل — والسكربت يعيد تحميلها فوراً.

## العناوين (Subjects)
ليست هنا — هي قوالب Go قصيرة داخل `docker-compose.taki.yml` على الخادم،
لأن GoTrue يقرأها من متغيّر بيئة لا من ملف. نسخة منها في
`supabase/email-templates/subjects.env` للمرجع.
