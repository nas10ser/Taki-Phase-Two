// ============================================================================
// خريطة موقع ديناميكية — /sitemap.xml
// ----------------------------------------------------------------------------
// الخريطة الثابتة كانت تسرد ١١ صفحة فقط، فكل عرض وكل متجر غير مفهرس إطلاقاً.
// هذه تولّدها من القاعدة عند كل طلب: الصفحات الثابتة + كل عرض منشور غير منتهٍ
// + كل متجر عام. وتُخزَّن على حافة Vercel ساعةً فلا تُثقل القاعدة.
//
// ⚠️ لا تُستعمل هنا سوى بيانات عامة يراها الزائر أصلاً (مفتاح anon + RLS).
// ============================================================================

const SITE = 'https://www.takisa.net';

// حدّ الأمان: خرائط المواقع تسمح بـ٥٠٬٠٠٠ رابط و٥٠ ميغابايت. نبقى دونها بكثير.
const MAX_DEALS = 20000;
const MAX_STORES = 5000;

// الصفحات الثابتة. `hreflang` غير مذكور هنا لأن الموقع يخدم اللغتين على نفس
// العنوان (تبديل داخل التطبيق) — ادّعاء عناوين منفصلة لكل لغة يخلق صفحات
// مكرّرة لا وجود لها، وهو ضرر لا نفع.
const STATIC = [
    ['/',          'hourly',  '1.0'],
    ['/deals',     'hourly',  '0.9'],
    ['/nearby',    'daily',   '0.8'],
    ['/seasonal',  'daily',   '0.8'],
    ['/contests',  'weekly',  '0.7'],
    ['/register',  'monthly', '0.6'],
    ['/about',     'monthly', '0.6'],
    ['/faq',       'monthly', '0.7'],
    ['/contact',   'monthly', '0.5'],
    ['/terms',     'yearly',  '0.3'],
    ['/privacy',   'yearly',  '0.3'],
    ['/refund',    'yearly',  '0.3'],
];

const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const urlTag = (loc, changefreq, priority, lastmod) =>
    '  <url>\n' +
    `    <loc>${esc(loc)}</loc>\n` +
    (lastmod ? `    <lastmod>${esc(lastmod)}</lastmod>\n` : '') +
    `    <changefreq>${changefreq}</changefreq>\n` +
    `    <priority>${priority}</priority>\n` +
    '  </url>\n';

const isoDay = (v) => {
    if (!v) return null;
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

/** استعلام REST مباشر — لا حاجة لمكتبة supabase داخل دالة خادمية. */
const restGet = async (base, key, path) => {
    const r = await fetch(`${base}/rest/v1/${path}`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`supabase ${r.status} على ${path.split('?')[0]}`);
    return r.json();
};

module.exports = async (req, res) => {
    const base = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;

    let body = '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    for (const [path, freq, pri] of STATIC) body += urlTag(SITE + path, freq, pri);

    // فشل القاعدة لا يعني خريطة فارغة: الصفحات الثابتة تُقدَّم على أي حال،
    // لأن خريطة ناقصة خير من خطأ 500 يجعل جوجل يتجاهل الملف كلّياً.
    let note = '';
    if (base && key) {
        try {
            const deals = await restGet(base, key,
                'deals?select=id,updated_at,expiry_date&status=eq.active' +
                `&order=updated_at.desc&limit=${MAX_DEALS}`);
            const now = Date.now();
            for (const d of deals) {
                // العرض المنتهي زمنياً يبقى منشوراً في القاعدة لكنه لا يفيد
                // الزائر القادم من البحث — نستثنيه بدل إغراق الفهرس بصفحات ميتة.
                if (d.expiry_date && new Date(d.expiry_date).getTime() < now) continue;
                body += urlTag(`${SITE}/deal/${d.id}`, 'daily', '0.8', isoDay(d.updated_at));
            }

            const stores = await restGet(base, key,
                `sellers_public?select=id&limit=${MAX_STORES}`);
            for (const s of stores) {
                body += urlTag(`${SITE}/store/${s.id}`, 'weekly', '0.7');
            }
        } catch (e) {
            note = `\n<!-- تعذّر جلب المحتوى الديناميكي: ${esc(e.message)} -->`;
        }
    } else {
        note = '\n<!-- SUPABASE_URL/ANON_KEY غير مضبوطين — الصفحات الثابتة فقط -->';
    }

    body += '</urlset>' + note;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(200).send(body);
};
