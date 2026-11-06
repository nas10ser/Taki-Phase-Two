/**
 * cdp-shot.js — تصويرٌ بتحكّمٍ كامل عبر بروتوكول أدوات كروم (CDP).
 * ═══════════════════════════════════════════════════════════════════════════
 * أربعةُ دروسٍ دُفع ثمنُها هنا، وكلُّها تفشل **بصمت** أو بتجمّدٍ بلا رسالة:
 *
 * ١) 🔴 **`--screenshot` في سطر الأوامر لا يكفي.** جُرّب فالتقط نافذةَ
 *    «وين مدينتك؟» تغطّي الشاشة — وهي أوّلُ ما يراه زائرٌ جديد. ولقطةٌ
 *    معظمُها نافذةُ إذنٍ يرفضها المتجران (تُظهر حاجزاً لا منتجاً). وتخطّيها
 *    يحتاج كتابةً في التخزين المحلّيّ **لأصل الموقع** قبل التصيير.
 *
 * ٢) 🔴 **`clip.scale` يُضرب في `deviceScaleFactor` ولا يحلّ محلّه.**
 *    قِيس بالعزل: dsf=2 مع scale=2 أخرجت **١٧٦٠×٣٨٢٤** لا ٨٨٠×١٩١٢.
 *    وبـ٣ و٣ تُطلب لقطةٌ بتسعة أضعاف (٣٤ ميجابكسل) فيتجمّد المحرّكُ بلا
 *    خطأ — ثمّ تتعطّل كلُّ أوامر المحاكاة بعده. ⇒ الكثافةُ في المحاكاة
 *    وحدها، والقصُّ ١:١ دائماً.
 *
 * ٣) 🔴 **التصويرُ ينتظر إطاراً مستقرّاً لا يأتي**: في صفحة تاكي حلقاتُ
 *    `requestAnimationFrame` دائمة (شريطُ البانرات · مؤقّتُ كلّ بطاقة ·
 *    بلاطاتُ الخريطة). وإيقافُ الحركة بـCSS لا يمسّها — هي جافاسكربت.
 *
 * ٤) 🪤 **ولا باكتيك داخل القوالب النصّية أدناه** — ولو في تعليقٍ عربيّ:
 *    أوّلُ واحدٍ يُغلق القالب فينفجر الملفُّ عند التحميل. (وقع مرّتين،
 *    ولذلك صار نصُّ الحقن مصفوفةَ أسطرٍ تُوصَل، لا قالباً نصّياً.)
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dbg = (...a) => { if (process.env.TAKI_SHOT_DEBUG) console.log('      ·', ...a); };

/** يُجمّد كلَّ ما يمنع استقرارَ الإطار. */
const FREEZE_JS = [
    '(() => {',
    '  const st = document.createElement("style");',
    '  st.textContent = "*,*::before,*::after{animation:none!important;' +
        'transition:none!important;scroll-behavior:auto!important}";',
    '  document.head.appendChild(st);',
    '  document.querySelectorAll("video").forEach(v => { try { v.pause(); } catch (e) {} });',
    '  window.requestAnimationFrame = () => 0;',
    '  try { window.stop(); } catch (e) {}',
    '  document.querySelectorAll("img").forEach(im => {',
    '    if (!im.complete) { try { im.removeAttribute("src"); } catch (e) {} }',
    '  });',
    '  const top = setTimeout(() => {}, 0);',
    '  for (let i = 1; i <= top; i++) { clearTimeout(i); clearInterval(i); }',
    '  return "frozen:" + top;',
    '})()',
].join('\n');

/** يُغلق أيَّ نافذةٍ بقيت فوق المحتوى. */
const DISMISS_JS = [
    '(() => { let n = 0;',
    '  document.querySelectorAll("button, a").forEach(b => {',
    '    const t = (b.textContent || "").trim();',
    '    if (/^(لاحقاً|Later|إغلاق|Close|تخطّي|Skip|✕|×)$/.test(t)) { b.click(); n++; }',
    '  });',
    '  return n; })()',
].join('\n');

class Cdp {
    constructor(ws) {
        this.ws = ws; this.id = 0; this.waiting = new Map(); this.sessionId = null;
        ws.addEventListener('message', (ev) => {
            const m = JSON.parse(ev.data);
            if (m.id && this.waiting.has(m.id)) {
                const { ok, fail } = this.waiting.get(m.id); this.waiting.delete(m.id);
                if (m.error) fail(new Error(m.error.message)); else ok(m.result);
            }
        });
    }
    send(method, params = {}, ms = 45000) {
        const id = ++this.id;
        return new Promise((ok, fail) => {
            this.waiting.set(id, { ok, fail });
            this.ws.send(JSON.stringify({ id, method, params, ...(this.sessionId ? { sessionId: this.sessionId } : {}) }));
            setTimeout(() => { if (this.waiting.delete(id)) fail(new Error('مهلةُ ' + method)); }, ms);
        });
    }
}

async function capture(cfg) {
    if (!fs.existsSync(CHROME)) throw new Error('لا يوجد Google Chrome');
    const port = 9400 + Math.floor(Math.abs(Date.now() / 1000) % 500);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'taki-shot-'));
    const chrome = spawn(CHROME, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
        '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
        '--window-size=600,1000', 'about:blank',
    ], { stdio: 'ignore' });

    let sock = null;
    const cleanup = () => {
        try { if (sock) sock.close(); } catch { /* ignore */ }
        try { chrome.kill(); } catch { /* ignore */ }
        try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    };

    let wsUrl = null;
    for (let i = 0; i < 60 && !wsUrl; i++) {
        await sleep(400);
        try {
            const r = await fetch('http://127.0.0.1:' + port + '/json/version');
            wsUrl = (await r.json()).webSocketDebuggerUrl;
        } catch { /* لم يُقلع بعد */ }
    }
    if (!wsUrl) { cleanup(); throw new Error('تعذّر الاتصالُ بكروم'); }

    sock = new WebSocket(wsUrl);
    await new Promise((ok, fail) => { sock.addEventListener('open', ok); sock.addEventListener('error', fail); });
    const page = new Cdp(sock);

    // 🔴 **صفحةٌ جديدةٌ لكلّ لقطة** — وهذا ما حسم الأمر بعد أربع محاولات:
    //    حين يتجمّد المحرّكُ على لقطةٍ واحدة لا يتعافى أبداً، وتتعطّل بعدها
    //    حتى `Emulation.setDeviceMetricsOverride` — فتسقط اللقطاتُ الباقية
    //    كلُّها بسبب واحدةٍ. وهدفُ الصفحةِ المستقلّة أن يكون العطلُ **محصوراً**:
    //    تُغلق الصفحةُ المتعثّرة ويبدأ التالي على محرّكٍ نظيف.
    //    والكلفةُ تحميلٌ إضافيّ لكلّ لقطة — مقبولةٌ تماماً لاثنتي عشرة لقطة.
    const results = [];
    fs.mkdirSync(cfg.outDir, { recursive: true });

    const shoot = async (size, p) => {
        const { targetId } = await page.send('Target.createTarget', { url: 'about:blank' }, 20000);
        const { sessionId } = await page.send('Target.attachToTarget', { targetId, flatten: true }, 20000);
        const prev = page.sessionId;
        page.sessionId = sessionId;
        try {
            await page.send('Page.enable', {}, 15000);
            await page.send('Runtime.enable', {}, 15000);
            await page.send('Emulation.setDeviceMetricsOverride', {
                width: size.w, height: size.h, deviceScaleFactor: size.dpr,
                mobile: size.mobile !== false,
            }, 20000);

            if (cfg.seed) {
                // الكتابةُ في التخزين المحلّيّ تلزمها زيارةُ **نفس الأصل** أوّلاً.
                await page.send('Page.navigate', { url: cfg.site + '/robots.txt' }, 25000);
                await sleep(1200);
                const js = Object.entries(cfg.seed)
                    .map(([k, v]) => 'localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(v) + ');')
                    .join('');
                await page.send('Runtime.evaluate',
                    { expression: '(()=>{try{' + js + 'return "ok"}catch(e){return ""+e}})()' }, 20000);
            }

            await page.send('Page.navigate', { url: cfg.site + p.url }, 30000);
            await sleep(p.wait || 6000);
            await page.send('Runtime.evaluate', { expression: DISMISS_JS }, 20000);
            await sleep(800);
            const f = await page.send('Runtime.evaluate', { expression: FREEZE_JS }, 20000);
            dbg('تجميد:', f && f.result && f.result.value);
            await sleep(1200);

            const r = await page.send('Page.captureScreenshot', {
                format: 'png', captureBeyondViewport: true,
                clip: { x: 0, y: 0, width: size.w, height: size.h, scale: 1 },
            }, 40000);
            return r.data;
        } finally {
            page.sessionId = prev;
            try { await page.send('Target.closeTarget', { targetId }, 10000); } catch { /* ignore */ }
        }
    };

    try {
        for (const size of cfg.sizes) {
            dbg('مقاس', size.name);
            for (const p of cfg.pages) {
                dbg('صفحة', p.slug);
                let data = null;
                for (let attempt = 1; attempt <= 2 && data === null; attempt++) {
                    try { data = await shoot(size, p); }
                    catch (e) { dbg('تعثّرت (' + attempt + '/٢):', e.message); await sleep(1500); }
                }
                const name = size.name + '/' + p.slug;
                if (data === null) { results.push({ name, w: 0, h: 0, want: size.px, bytes: 0 }); continue; }
                const out = path.join(cfg.outDir, size.name + '-' + p.slug + '.png');
                fs.writeFileSync(out, Buffer.from(data, 'base64'));
                const b = fs.readFileSync(out).subarray(0, 24);
                results.push({ file: out, name, w: b.readUInt32BE(16), h: b.readUInt32BE(20),
                               want: size.px, bytes: fs.statSync(out).size });
            }
        }
        cleanup();
        return results;
    } catch (e) {
        cleanup();
        throw e;
    }
}

module.exports = { capture };
