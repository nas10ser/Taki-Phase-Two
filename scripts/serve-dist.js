#!/usr/bin/env node
/**
 * serve-dist.js — خادمٌ ثابتٌ لمجلّد dist، لقياس الأداء بلا جدار فيرسِل.
 * ═══════════════════════════════════════════════════════════════════════════
 *   node scripts/serve-dist.js &
 *   TAKI_PERF_SITE=http://127.0.0.1:4321 node scripts/perf-audit.js
 *
 * 🪤 ويُعيد `index.html` لأي مسارٍ **بلا امتداد** فقط — لا لكل مسار. و`serve -s`
 *    يُعيدها للجميع، فصورةٌ مكسورة تصل «بنجاح» وهي HTML ولا يصرخ شيء
 *    (فخٌّ كلّف جلسةً كاملة في v14.64).
 * 🪤 ولا يُخدَم ما خارج dist: `..` في المسار يُرفض قبل أي قراءة.
 * 🔴 ويضغط النصوصَ (brotli/gzip) **لأن بلا ضغطٍ يكذب القياس**: قِيس على هذا
 *    الخادم بلا ضغط فنُقل ٩٤٠ ك.ب والإنتاجُ ينقل ٢٥٨ — فيصير LCP وTBT أسوأَ
 *    بأضعافٍ لسببٍ ليس في الكود، ويُتَّهم إصلاحٌ صحيحٌ بأنه أضرّ.
 * 🪤 ولا تُخدَم خرائطُ المصادر (`.map`): المتصفّحُ لا يطلبها إلا بلوحةٍ
 *    مفتوحة، لكن CDP يطلبها فتُحسَب في «ما نُقل» وتضخّمه بلا معنى.
 * 🔴 والضغطُ **يُحسب مرّةً ويُخزَّن**، لا عند كل طلب: الضغطُ الفوريُّ يجري
 *    على نفس المعالج الذي يُقاس عليه الخنقُ ٤×، فيزاحم المتصفّحَ ويضخّم
 *    TBT بأضعاف — قِيس ١٣٦٤ م.ث محلياً مقابل ٦٧٩ على الإنتاج لنفس الصفحة،
 *    والفارقُ كان **خادمي** لا الكود. وأداةُ قياسٍ تُنتج الحِملَ الذي تقيسه
 *    أداةٌ معطوبة.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIST = path.resolve(__dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 4321);
const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
    '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg',
    '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json', '.map': 'application/json',
    '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};

/** ضغطٌ محسوبٌ مرّةً — المفتاح: الترميز + المسار. */
const CACHE = new Map();

if (!fs.existsSync(DIST)) { console.error('❌ لا dist — يُبنى أوّلاً: npm run build'); process.exit(1); }

http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p.includes('..')) { res.writeHead(403).end('no'); return; }
    let f = path.join(DIST, p);
    if (p === '/' || (!path.extname(p) && !fs.existsSync(f))) f = path.join(DIST, 'index.html');
    if (!f.startsWith(DIST)) { res.writeHead(403).end('no'); return; }
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404).end('404'); return; }
    const ext = path.extname(f);
    if (ext === '.map') { res.writeHead(404).end('no maps'); return; }
    const t = TYPES[ext] || 'application/octet-stream';
    const compressible = /^(text\/|application\/(javascript|json|manifest))/.test(t);
    const accept = String(req.headers['accept-encoding'] || '');
    const enc = compressible && /br/.test(accept) ? 'br'
              : compressible && /gzip/.test(accept) ? 'gzip' : null;
    const head = { 'Content-Type': t, 'Cache-Control': 'no-store' };
    let buf;
    if (enc) {
        const key = enc + ':' + f;
        if (!CACHE.has(key)) {
            const raw = fs.readFileSync(f);
            CACHE.set(key, enc === 'br' ? zlib.brotliCompressSync(raw) : zlib.gzipSync(raw));
        }
        buf = CACHE.get(key);
        head['Content-Encoding'] = enc;
    } else {
        buf = fs.readFileSync(f);
    }
    head['Content-Length'] = buf.length;
    res.writeHead(200, head);
    res.end(buf);
}).listen(PORT, '127.0.0.1', () => console.log(`خادمُ dist على http://127.0.0.1:${PORT}`));
