#!/usr/bin/env node
/**
 * preview-env.js — بيئة المعاينة تُعرّف نفسها (v14.61)
 * ═══════════════════════════════════════════════════════════════════════════
 * المشكلة: بناءُ المعاينة على Vercel يحتاج `SUPABASE_URL` و`SUPABASE_ANON_KEY`
 * لبيئة **Preview**، وضبطُهما يحتاج لوحة Vercel — ولا أملك إليها طريقاً برمجياً
 * (لا أداة في واجهة Vercel لضبط المتغيّرات، ولا توكن على الجهاز). فكان الخيار
 * إمّا أن ينتظر المشروعُ ضغطاتٍ يدوية، أو أن تُعرِّف المعاينةُ نفسها.
 *
 * الحلّ: Vercel تحقن `VERCEL_ENV` في كل بناء **تلقائياً وبلا أي إعداد**
 * (production | preview | development). فحين يكون البناءُ معاينةً ولم يُضبط
 * عنوانُ قاعدة، نكتب قاعدة المعاينة في `.env` — وParcel يقرؤه.
 *
 * ── لماذا هذا آمن ──────────────────────────────────────────────────────────
 * • لا يعمل إلا إذا كان `VERCEL_ENV === 'preview'` حرفياً. بناءُ الإنتاج لا
 *   يمرّ من هنا إطلاقاً، فلا يمكن أن يُوجَّه الموقعُ الحقيقي إلى قاعدة فارغة.
 * • ولا يعمل إذا كان `SUPABASE_URL` مضبوطاً أصلاً — فلو أضاف ناصر متغيّرات
 *   Preview لاحقاً فهي التي تسود، وهذا الملفّ يصمت.
 * • والقيمتان أدناه **عامّتان بطبيعتهما**: عنوانٌ عام، ومفتاح `anon` يُسلَّم
 *   لكل زائر في حزمة المتصفّح. وقاعدة المعاينة لا تحوي بيانات عملاء إطلاقاً
 *   (صفر مستخدم وصفر حجز — يفرضها `scripts/sync-preview-db.sh` ويفحصها).
 *   فليست سرّاً يُخبَّأ، ووضعُها هنا لا يكشف شيئاً.
 */

const fs = require('fs');
const path = require('path');

const PREVIEW = {
    SUPABASE_URL: 'https://kbmqzxcjdankdgiovctm.supabase.co',
    SUPABASE_ANON_KEY:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
        'eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtibXF6eGNqZGFua2RnaW92Y3RtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NjM0MDYsImV4cCI6MjA5MjEzOTQwNn0.' +
        '1NAgosGhIx0_5WB8r53C0ss1jZnnTe_PGs6Ij-Bygwk',
    // 🪤 الكابتشا مفروضة على خادم جدة منذ ٣ سبتمبر، ومفتاح Turnstile مسجَّل
    // لنطاق الإنتاج وحده — فالتسجيل والدخول في المعاينة كانا سيُرفضان على
    // مضيفٍ لا يعرفه Cloudflare. مفتاح الاختبار الرسمي من Cloudflare يمرّ دائماً.
    TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
};

if (process.env.VERCEL_ENV !== 'preview') {
    process.exit(0);                       // إنتاجٌ أو محلّي: لا شأن لنا
}

if (process.env.SUPABASE_URL) {
    console.log('ℹ️ بناء معاينة، والمتغيّرات مضبوطة في Vercel — تُستعمل كما هي.');
    process.exit(0);
}

const envPath = path.resolve(__dirname, '..', '.env');
let existing = '';
try { existing = fs.readFileSync(envPath, 'utf8'); } catch { /* لا ملف — يُنشأ */ }

const lines = [];
for (const [k, v] of Object.entries(PREVIEW)) {
    if (new RegExp(`^${k}=`, 'm').test(existing)) continue;   // لا نُدهس قيمةً موجودة
    lines.push(`${k}=${v}`);
}

if (!lines.length) {
    console.log('ℹ️ بناء معاينة، و.env يحوي القيم أصلاً.');
    process.exit(0);
}

fs.writeFileSync(envPath, (existing ? existing.replace(/\n*$/, '\n') : '') + lines.join('\n') + '\n');
console.log(`🔎 بناء معاينة (VERCEL_ENV=preview) — وُجّهت إلى قاعدة المعاينة: ${new URL(PREVIEW.SUPABASE_URL).host}`);
console.log(`   (${lines.length} متغيّراً كُتب في .env · الإنتاج لا يمرّ من هنا إطلاقاً)`);
