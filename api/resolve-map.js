// ═══════════════════════════════════════════════════════════════════════════
// resolve-map — فكّ روابط خرائط جوجل المختصرة على الخادم (v14.54)
// ═══════════════════════════════════════════════════════════════════════════
// الغرض: التاجر يلصق رابط `maps.app.goo.gl` لموقع محلّه، والمتصفّح لا يستطيع
// تتبّعه (CORS/CSP) — فنفكّه هنا ونُعيد الإحداثيات.
//
// ما كان مكسوراً قبل v14.54، مقيساً لا مفترضاً:
//  🔴 **مفتوحة للإنترنت كلّه.** ناديتُها من سطر الأوامر بلا أي هوية فردّت ٢٠٠
//     ونتيجةً كاملة. وحارس «الأصل» الموجود فيها لا يحرس شيئاً: يضبط ترويسة
//     CORS للمتصفّح ولا يمنع تشغيل الدالة — وقائمتُه لا تحوي `www.takisa.net`
//     أصلاً. ضابطٌ لا يُنفَّذ على أحد ليس ضابطاً.
//  🔴 **قائمة النطاقات تُفحص على القفزة الأولى وحدها.** الحلقة تقرأ `Location`
//     ثم `continue` فتجلب العنوان التالي **بلا إعادة فحص**. ورابطُ جوجل مختصر
//     يُنشئه أي أحد ويوجّهه حيث شاء — فالفحصُ الأوّل يحرس الباب ويترك النافذة.
//  🔴 **بلا حدّ معدّل** — نداءٌ بلا سقف على حصّة Vercel المجانية.
//
// وما صار الآن:
//  ١) **توثيق**: لا يُنفَّذ شيء قبل أن تقول القاعدة إن المنادي تاجرٌ موثَّق غير
//     موقوف. السياسة في `taki_map_gate()` داخل القاعدة لا هنا — تُعدَّل بلا
//     نشر، ولا تفترق نسختان منها. ولا سرّ جديد: نمرّر JWT المستخدم نفسه.
//  ٢) **حدّ معدّل**: ٢٠ نداءً/ساعة لكل تاجر، بعدّاد ذرّي في القاعدة
//     (`rate_limit_counters`) — لا في ذاكرة النسخة، فعدّادُ الذاكرة يُصفَّر مع
//     كل نسخةٍ باردة وهو حدٌّ لا يحدّ.
//  ٣) **كل قفزة تُفحص**: `assertAllowed()` تُنادى على العنوان الأوّل وعلى كل
//     `Location` وكل `meta refresh` قبل جلبه. وأي عنوان خارج القائمة يُنهي
//     المحاولة بدل أن يُتبع.
//  ٤) **لا يُعاد عنوانٌ خارج القائمة** إلى المتصفّح، فلا يصير الردّ قناةَ تسريب.
// ═══════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = (process.env.SUPABASE_URL || 'https://api.takisa.net').replace(/\/+$/, '');
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

const tryExtract = (text) => {
    if (!text || typeof text !== 'string') return null;

    let decoded = text;
    try { decoded = decodeURIComponent(text); } catch (e) { /* نصّ غير مُرمَّز */ }

    // صندوق السعودية التقريبي — إحداثيةٌ خارجه ليست موقع محلّ.
    const isValidKSA = (lat, lng) => lat > 15 && lat < 33 && lng > 33 && lng < 56;

    let bestMatch = null;
    const trySet = (latStr, lngStr) => {
        const lat = parseFloat(latStr);
        const lng = parseFloat(lngStr);
        if (isValidKSA(lat, lng)) { bestMatch = { lat, lng }; return true; }
        return false;
    };

    const patterns = [
        /@(-?\d+\.\d+)\s*(?:,|%2C)\s*(-?\d+\.\d+)/gi,
        /[?&](?:q|ll|query|center|markers|latlng|daddr|destination)=(-?\d+\.\d+)\s*(?:,|%2C)\s*(-?\d+\.\d+)/gi,
    ];

    for (const p of patterns) {
        for (const m of [...text.matchAll(p)]) if (trySet(m[1], m[2])) return bestMatch;
        for (const m of [...decoded.matchAll(new RegExp(p.source, 'gi'))]) if (trySet(m[1], m[2])) return bestMatch;
    }

    const lat3d = text.match(/!3d(-?\d+\.\d+)/) || decoded.match(/!3d(-?\d+\.\d+)/);
    const lng2d = text.match(/!(?:2d|4d)(-?\d+\.\d+)/) || decoded.match(/!(?:2d|4d)(-?\d+\.\d+)/);
    if (lat3d && lng2d && trySet(lat3d[1], lng2d[1])) return bestMatch;

    const brute = [
        ...text.matchAll(/(-?\d+\.\d+)\s*(?:,|%2C)\s*(-?\d+\.\d+)/g),
        ...decoded.matchAll(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/g),
    ];
    for (const b of brute) if (trySet(b[1], b[2])) return bestMatch;

    return null;
};

// ═══════════════ الأمان: قائمة النطاقات، وتُفحص عند كل قفزة ═══════════════
const ALLOWED_HOSTS = [
    'maps.app.goo.gl',
    'goo.gl',
    'maps.google.com',
    'www.google.com',
    'google.com',
    'maps.google.com.sa',
    'maps.google.co.uk',
];

/**
 * 🪤 الفحص على السلسلة النصّية (`/^https?:\/\/127\./`) لا يكفي ولم يعد مستعملاً:
 * `http://0x7f.1/` و`http://2130706433/` و`http://127.1/` كلها المضيف المحلّي
 * ولا يطابقها. فالفحص هنا على **اسم المضيف بعد التحليل** وعلى الشكل الرقمي.
 */
const isPrivateHost = (hostname) => {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
    if (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')) return true;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
    if (m) {
        const [a, b] = [Number(m[1]), Number(m[2])];
        if (a === 10 || a === 127 || a === 0) return true;
        if (a === 172 && b >= 16 && b <= 31) return true;
        if (a === 192 && b === 168) return true;
        if (a === 169 && b === 254) return true;   // بيانات وصف السحابة
        if (a >= 224) return true;                  // بثّ متعدّد ومحجوز
        return false;
    }
    // شكلٌ رقميّ غير منقّط (عشري/ثماني/ستّ عشري) = محاولةُ تحايل لا عنوان خرائط.
    if (/^(0x[0-9a-f]+|\d+)$/.test(h)) return true;
    return false;
};

/** يرمي عند أي عنوان لا يجوز جلبه — تُنادى على العنوان الأوّل وعلى كل قفزة. */
function assertAllowed(urlStr) {
    let u;
    try { u = new URL(urlStr); } catch { throw new Error('BAD_URL'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('BAD_SCHEME');
    if (isPrivateHost(u.hostname)) throw new Error('PRIVATE_HOST');
    const ok = ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
    if (!ok) throw new Error('HOST_NOT_ALLOWED');
    return u;
}

/** سياسة الدخول تُسأل من القاعدة بهوية المستخدم نفسه — لا سرّ هنا. */
async function gate(authHeader, deadline) {
    if (!authHeader || !/^Bearer\s+\S+/i.test(authHeader)) return { ok: false, error: 'AUTH_REQUIRED' };
    if (!ANON_KEY) return { ok: false, error: 'SERVER_MISCONFIGURED' };
    let r;
    // 🪤 كان هذا النداء **بلا مهلة**: قاعدةٌ بطيئة تُعلّق الطلب كلّه قبل أن
    // يبدأ العدّ أصلاً، والعميل يقطع عند الثامنة فيدور الزرّ بلا نهاية.
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), Math.max(500, (deadline || Date.now() + 4000) - Date.now()));
    try {
        r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/taki_map_gate`, {
            method: 'POST',
            headers: { apikey: ANON_KEY, Authorization: authHeader, 'Content-Type': 'application/json' },
            body: '{}',
            signal: ac.signal,
        });
    } catch {
        // تعذّر سؤال القاعدة ⇒ **نمنع**. البوّابة تفشل مغلقةً لا مفتوحة.
        return { ok: false, error: 'GATE_UNAVAILABLE' };
    }
    finally { clearTimeout(timer); }
    if (!r.ok) return { ok: false, error: 'AUTH_REQUIRED' };
    const d = await r.json().catch(() => null);
    return d && d.ok === true ? { ok: true } : { ok: false, error: (d && d.error) || 'FORBIDDEN' };
}

module.exports = async (req, res) => {
    // 🪤 لا تخزين مشترك: الردّ يعتمد على هوية المنادي وحدّ معدّله، فتخزينُه
    // على الحافة كان سيخدم إجابةَ تاجرٍ لآخر ويلتفّ على الحدّ.
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Authorization');

    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type');
        return res.status(204).end();
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'method not allowed' });

    // 🪤 v14.64 — الميزانية تبدأ **قبل** البوّابة لا بعدها: نداء البوّابة كان
    // خارج العدّ تماماً، فقاعدةٌ بطيئة تستهلك مهلة العميل كلّها قبل أن يبدأ
    // الحلّ أصلاً. العميل يقطع عند ٨ ثوانٍ، فنُنهي نحن عند ٦٫٥ ونردّ بجواب.
    const deadline = Date.now() + 6500;

    const g = await gate(req.headers && req.headers.authorization, deadline);
    if (!g.ok) {
        const code = g.error === 'RATE_LIMIT' ? 429 : (g.error === 'GATE_UNAVAILABLE' ? 503 : 401);
        return res.status(code).json({ error: g.error });
    }

    const target = (req.query && req.query.url) || '';
    if (!target || typeof target !== 'string') return res.status(400).json({ error: 'missing url' });

    let first;
    try { first = assertAllowed(target); } catch (e) {
        return res.status(403).json({ error: 'URL domain not allowed. Only Google Maps links are accepted.', reason: e.message });
    }

    try {
        let current = first.toString();
        // كل جلبٍ خارجي يأخذ ما بقي من الميزانية المُعلنة أعلاه، لا مهلةً
        // خاصّة به — وإلا صار مجموعُ المهل أضعافَ ما ينتظره العميل.
        const fetchWithTimeout = async (url, opts = {}) => {
            const left = Math.max(500, deadline - Date.now());
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), left);
            try {
                return await fetch(url, { ...opts, signal: ac.signal });
            } finally {
                clearTimeout(timer);
            }
        };

        let html = '';
        let coords = tryExtract(current);

        for (let i = 0; i < 6 && !coords && Date.now() < deadline; i++) {
            // ترويسة واتساب تجعل خرائط جوجل تُعيد وسوم OpenGraph بدل تطبيقٍ
            // جافاسكربتي أو صفحة موافقة — نفس ما يحدث عند لصق الرابط في واتساب.
            const resp = await fetchWithTimeout(current, {
                redirect: 'manual',
                headers: { 'User-Agent': 'WhatsApp/2.21.12.21 A', 'Accept-Language': 'en-US,en;q=0.9' },
            });

            const loc = resp.headers.get('location');
            if (loc) {
                const next = loc.startsWith('http') ? loc : new URL(loc, current).toString();
                // ★ هنا كان الثقب: كان يُجلب بلا فحص. الآن كل قفزة تُفحص.
                assertAllowed(next);
                current = next;
                coords = tryExtract(current);
                continue;
            }

            html = await resp.text().catch(() => '');

            const metaRefresh = html.match(/<meta[^>]+http-equiv=["']?refresh["']?[^>]+content=["']?\d+;\s*url=([^"']+)["']?/i);
            if (metaRefresh && metaRefresh[1]) {
                const raw = metaRefresh[1].replace(/&amp;/g, '&');
                const next = raw.startsWith('http') ? raw : new URL(raw, current).toString();
                assertAllowed(next);
                current = next;
                coords = tryExtract(current);
                continue;
            }

            coords = tryExtract(current) || tryExtract(html);
            break;
        }

        // ارتداد: حوِّل اسم المكان إلى إحداثيات عبر خدمة الأسماء المفتوحة.
        if (!coords && html) {
            const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
            const placeName = titleMatch && titleMatch[1]
                .replace(/\s*[-|·]\s*Google Maps.*$/i, '')
                .replace(/^Google Maps[:\s-]*/i, '')
                .trim();

            if (placeName && placeName.length > 3 && placeName.length < 200 && placeName !== 'Google Maps') {
                const geo = await fetchWithTimeout(
                    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(placeName)}&countrycodes=sa&limit=1`,
                    { headers: { 'User-Agent': 'TakiApp/1.0 (+https://www.takisa.net)' } }
                ).then((r) => r.json()).catch(() => null);
                if (geo && geo[0]) coords = { lat: parseFloat(geo[0].lat), lng: parseFloat(geo[0].lon) };
            }
        }

        // العنوان النهائي يُعاد فقط إن بقي داخل القائمة — فلا يصير الردّ قناةَ
        // تسريبٍ لوجهةٍ خارجية بلغتها السلسلة.
        let safeUrl = null;
        try { assertAllowed(current); safeUrl = current; } catch { safeUrl = null; }

        return res.status(200).json({ url: safeUrl, lat: coords ? coords.lat : null, lng: coords ? coords.lng : null });
    } catch (e) {
        const msg = e && e.message;
        if (msg === 'HOST_NOT_ALLOWED' || msg === 'PRIVATE_HOST' || msg === 'BAD_URL' || msg === 'BAD_SCHEME') {
            // تحويلٌ خرج من القائمة أثناء التتبّع — نقف ولا نُتبعه.
            return res.status(403).json({ error: 'redirect left the allowed Google Maps domains', reason: msg });
        }
        return res.status(502).json({ error: 'upstream error' });
    }
};

// تُصدَّر للاختبار وحده (`scripts/test-map-ssrf.js`). ضابطُ أمانٍ بلا اختبار
// ضابطٌ مجهول: لا يُعرف أنه يعمل إلا يوم يُهاجَم.
module.exports._internals = { assertAllowed, isPrivateHost, ALLOWED_HOSTS, tryExtract };
