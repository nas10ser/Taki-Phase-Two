/**
 * perf-probe.js — قياسُ سلاسة الواجهة بالأرقام، لا بالانطباع.
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **يُقاس على جوّالٍ متوسّطٍ لا على ماك**: الفرقُ ليس تفصيلاً. جهازُ
 *    التطوير أسرعُ من جوّال المستخدم بأربعةِ أضعافٍ على الأقلّ، وشبكةُ
 *    المكتب أسرعُ من ٤G بكثير. فقياسٌ بلا خنقٍ يقول «ممتاز» عن تجربةٍ
 *    بطيئةٍ فعلاً — وهو أسوأُ من لا قياس.
 *    الإعدادُ هنا: **٤× خنقِ معالج** و**١٫٦ م.بت/ث مع ١٥٠ م.ث تأخّر** —
 *    وهو ما تستعمله أدواتُ قوقل الرسميّة لمحاكاة الجوّال.
 *
 * ما يُقاس (وكلُّها مقاييسُ تجربةٍ حقيقيّة لا أرقامٌ تجميلية):
 *   • **LCP** — متى يرى المستخدمُ أكبرَ عنصرٍ في الشاشة. (جيّد ≤ ٢٥٠٠ م.ث)
 *   • **CLS** — كم ترتجّ الصفحةُ تحت إصبعه. (جيّد ≤ ٠٫١)
 *   • **TBT** — كم مللي ثانيةٍ كان الخيطُ الرئيسيّ **مشغولاً فلا يستجيب**.
 *     وهذا بالضبط ما يسمّيه المستخدمُ «التطبيقُ ثقيل». (جيّد ≤ ٢٠٠)
 *   • **المهامُّ الطويلة** — كلُّ مهمّةٍ تتجاوز ٥٠ م.ث تُسقط إطاراتٍ.
 *   • **إطاراتُ التمرير** — النسبةُ المئويّة للإطارات التي تجاوزت ١٦٫٧ م.ث.
 *   • الحجمُ المنقول · الذاكرةُ · عددُ الطلبات.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** يراقب مقاييسَ الويب الحيويّة من داخل الصفحة قبل أن تبدأ. */
const OBSERVER_JS = [
    '(() => {',
    '  window.__taki = { lcp: 0, cls: 0, longTasks: [], fcp: 0 };',
    '  try {',
    '    new PerformanceObserver(l => { for (const e of l.getEntries())',
    '      window.__taki.lcp = Math.max(window.__taki.lcp, e.startTime); })',
    '      .observe({ type: "largest-contentful-paint", buffered: true });',
    '  } catch (e) {}',
    '  try {',
    '    new PerformanceObserver(l => { for (const e of l.getEntries())',
    '      if (!e.hadRecentInput) window.__taki.cls += e.value; })',
    '      .observe({ type: "layout-shift", buffered: true });',
    '  } catch (e) {}',
    '  try {',
    '    new PerformanceObserver(l => { for (const e of l.getEntries())',
    '      window.__taki.longTasks.push(Math.round(e.duration)); })',
    '      .observe({ type: "longtask", buffered: true });',
    '  } catch (e) {}',
    '  try {',
    '    new PerformanceObserver(l => { for (const e of l.getEntries())',
    '      if (e.name === "first-contentful-paint") window.__taki.fcp = e.startTime; })',
    '      .observe({ type: "paint", buffered: true });',
    '  } catch (e) {}',
    '  return "observing";',
    '})()',
].join('\n');

/** يجمع النتيجةَ بعد استقرار الصفحة. */
const COLLECT_JS = [
    '(() => {',
    '  const t = window.__taki || {};',
    '  const nav = performance.getEntriesByType("navigation")[0] || {};',
    '  const res = performance.getEntriesByType("resource");',
    '  let bytes = 0, js = 0, img = 0;',
    '  for (const r of res) {',
    '    const s = r.transferSize || 0; bytes += s;',
    '    if (/\\.js(\\?|$)/.test(r.name)) js += s;',
    '    if (/\\.(png|jpe?g|webp|gif|svg)(\\?|$)/.test(r.name)) img += s;',
    '  }',
    '  const lt = t.longTasks || [];',
    '  return JSON.stringify({',
    '    fcp: Math.round(t.fcp || 0),',
    '    lcp: Math.round(t.lcp || 0),',
    '    cls: Math.round((t.cls || 0) * 1000) / 1000,',
    '    tbt: lt.reduce((a, d) => a + Math.max(0, d - 50), 0),',
    '    longTasks: lt.length,',
    '    longest: lt.length ? Math.max.apply(null, lt) : 0,',
    '    domReady: Math.round(nav.domContentLoadedEventEnd || 0),',
    '    requests: res.length,',
    '    kb: Math.round(bytes / 1024),',
    '    kbJs: Math.round(js / 1024),',
    '    kbImg: Math.round(img / 1024),',
    '    heapMb: Math.round(((performance.memory || {}).usedJSHeapSize || 0) / 1048576),',
    '    nodes: document.querySelectorAll("*").length,',
    // 🔴 دليلُ أن المقيسَ هو تطبيقُنا لا صفحةً أخرى. أُضيف بعد قياسٍ كامل
    //    خرج بـ«✅ FCP ٩٠٤ م.ث · TBT ٢٦» وهو يقيس **صفحةَ تحدّي روبوتاتٍ من
    //    فيرسِل** حُجب بها عنواني بعد استجوابٍ متكرّر للإنتاج. والعلاماتُ كانت
    //    في المخرَج نفسِه: طلبٌ واحد · ١٥ ك.ب · ٢٣ عقدة · صفرُ تمرير.
    //    و**قياسٌ يبدو ممتازاً لأنه قاس الشيءَ الخطأ أسوأُ من لا قياس.**
    '    appMarkers: {',
    '      root: !!document.getElementById("root"),',
    '      rootKids: document.getElementById("root") ? document.getElementById("root").children.length : 0,',
    // 🪤 والعلامةُ **عدُّ سكربتاتٍ خارجيّةٍ من نفس الأصل**، لا نمطُ اسمٍ.
    //    أوّلُ كتابةٍ بحثت عن `TAKI.<بصمة>.js` فخرج الناتجُ مهرَّباً مرّتين
    //    (`/TAKI\\.[…]/` = شرطةٌ مائلةٌ ثمّ أيُّ محرف) فلم يُطابق شيئاً أبداً
    //    وأطلقَ الحارسُ إنذاراً كاذباً على قياسٍ سليم. واسمُ الحزمة اصطلاحٌ
    //    يتغيّر؛ أمّا «صفحةٌ تحمّل سكربتاتٍ من أصلها» فعقدٌ لا يتغيّر —
    //    وصفحةُ التحدّي تحمل سكربتاً **مضمَّناً** بلا أيّ ملفّ خارجيّ.
    '      extScripts: Array.from(document.scripts)',
    '        .filter(x => x.src && x.src.indexOf(location.origin) === 0).length,',
    '      title: (document.title || "").slice(0, 60),',
    '    },',
    '  });',
    '})()',
].join('\n');

/** تمريرٌ مُبرمَجٌ يقيس الإطاراتِ المتأخّرة — وهو «الإحساسُ بالسلاسة» نفسُه. */
const SCROLL_JS = [
    '(async () => {',
    '  const frames = [];',
    '  let last = performance.now(), stop = false;',
    '  const tick = (now) => { frames.push(now - last); last = now;',
    '                          if (!stop) requestAnimationFrame(tick); };',
    '  requestAnimationFrame(tick);',
    '  const step = Math.max(300, window.innerHeight * 0.8);',
    '  for (let i = 0; i < 12; i++) {',
    '    window.scrollBy(0, step);',
    '    await new Promise(r => setTimeout(r, 260));',
    '  }',
    '  stop = true;',
    '  await new Promise(r => setTimeout(r, 120));',
    '  const f = frames.slice(3);',
    // 🔴 العتبةُ ٢٠ لا ١٦٫٧: شاشةُ ٦٠ هرتز تُعطي إطاراتٍ بـ١٦٫٧±اهتزاز، فقياسٌ',
    // عند ١٦٫٧ يعدّ **الإطارَ السليم** متأخّراً. قِيس فعلاً: ٤٠٪ «تأخّر»',
    // ووسيطُ الإطار ١٧ م.ث وأسوأُه ١٧ — أي ٥٨٫٨ إطاراً/ث، وهي سلاسةٌ تامّة.',
    // والجنكُ الحقيقيُّ يبدأ عند تخطّي إطارٍ كامل (٣٣ م.ث).',
    '  const late = f.filter(d => d > 20).length;',
    '  const bad = f.filter(d => d > 33).length;',
    '  f.sort((a, b) => a - b);',
    '  return JSON.stringify({',
    '    frames: f.length,',
    '    fps: f.length ? Math.round(10000 / (f.reduce((a,b)=>a+b,0) / f.length)) / 10 : 0,',
    '    scrolled: Math.round(window.scrollY),',
    '    latePct: f.length ? Math.round(late * 1000 / f.length) / 10 : 0,',
    '    stallPct: f.length ? Math.round(bad * 1000 / f.length) / 10 : 0,',
    '    p50: Math.round(f[Math.floor(f.length * 0.5)] || 0),',
    '    p95: Math.round(f[Math.floor(f.length * 0.95)] || 0),',
    '    worst: Math.round(f[f.length - 1] || 0),',
    // 🔴 سقفُ العرض يُكشف ويُعلَن، ولا يُسمّى تقطيعاً. كلُّ قياسٍ هنا خرج
    //    بـ«١٠٠٪ إطاراتٍ مُتخطّاة · أسوأ ٣٣ م.ث»، وهو **انتظامٌ تامّ** عند
    //    ٣٠ إطاراً — أي أن المتصفّحَ بلا رأسٍ مسقوفٌ عند ٣٠ هرتز، لا أن
    //    الصفحةَ تتقطّع. والدليلُ: التشتّتُ شبهُ صفرٍ (p50 = الأسوأ).
    //    وإنذارٌ على حدٍّ في المُحاكي يُدرّب على تجاهل الإنذارات.
    '    vsyncCapped: (() => {',
    '      if (f.length < 20) return false;',
    '      const p50 = f[Math.floor(f.length * 0.5)] || 0;',
    '      const p95 = f[Math.floor(f.length * 0.95)] || 0;',
    '      return p50 > 28 && p50 < 38 && (p95 - p50) < 6;',
    '    })(),',
    '  });',
    '})()',
].join('\n');

/** يُجمّع الزمنَ الذاتيّ من تحليل المعالج حسب الملفّ ثمّ حسب الدالّة. */
function summarizeProfile(prof) {
    if (!prof || !prof.nodes || !prof.samples) return null;
    const byId = new Map(prof.nodes.map(n => [n.id, n]));
    const self = new Map();
    const dt = prof.timeDeltas || [];
    for (let i = 0; i < prof.samples.length; i++) {
        const n = byId.get(prof.samples[i]);
        if (!n) continue;
        self.set(n.id, (self.get(n.id) || 0) + Math.max(0, (dt[i] || 0) / 1000));
    }
    const files = new Map(), fns = [];
    for (const [id, ms] of self) {
        const n = byId.get(id); const cf = n.callFrame || {};
        const url = (cf.url || '(محرّك)').split('/').pop().split('?')[0] || '(محرّك)';
        files.set(url, (files.get(url) || 0) + ms);
        if (ms >= 15) fns.push({ fn: cf.functionName || '(مجهولة)', url, ms: Math.round(ms) });
    }
    fns.sort((a, b) => b.ms - a.ms);
    return {
        totalMs: Math.round([...self.values()].reduce((a, b) => a + b, 0)),
        files: [...files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
                 .map(([f, ms]) => ({ file: f, ms: Math.round(ms) })),
        top: fns.slice(0, 10),
    };
}

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
    send(method, params = {}, ms = 60000) {
        const id = ++this.id;
        return new Promise((ok, fail) => {
            this.waiting.set(id, { ok, fail });
            this.ws.send(JSON.stringify({ id, method, params, ...(this.sessionId ? { sessionId: this.sessionId } : {}) }));
            setTimeout(() => { if (this.waiting.delete(id)) fail(new Error('مهلةُ ' + method)); }, ms);
        });
    }
}

/**
 * @param {{site:string, pages:Array, seed?:Object, cpu?:number, net?:Object}} cfg
 */
async function probe(cfg) {
    if (!fs.existsSync(CHROME)) throw new Error('لا يوجد Google Chrome');
    const port = 9600 + Math.floor(Math.abs(Date.now() / 1000) % 300);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'taki-perf-'));
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
    const cdp = new Cdp(sock);

    const out = [];
    try {
        for (const p of cfg.pages) {
            // 🪤 صفحةٌ جديدةٌ لكلّ قياس: المقاييسُ تراكميّة، وإعادةُ الاستعمال
            //    تخلط صفحةً بأخرى (ودرسُ مصوّر اللقطات: محرّكٌ متعثّرٌ لا يتعافى).
            const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }, 20000);
            const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, 20000);
            cdp.sessionId = sessionId;
            try {
                await cdp.send('Page.enable', {}, 15000);
                await cdp.send('Runtime.enable', {}, 15000);
                await cdp.send('Network.enable', {}, 15000);
                // 🔴 الخدمةُ العاملة تُصفّر `transferSize` لكلّ مورد، فيقول
                //    القياسُ «نُقل صفر ك.ب» وهو عجزُ أداةٍ لا إنجازُ تطبيق.
                //    تُتخطّى للقياس وحده كي تُرى الأحجامُ الحقيقيّة.
                try { await cdp.send('Network.setBypassServiceWorker', { bypass: true }, 10000); } catch { /* قديم */ }
                await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }, 10000);
                await cdp.send('Emulation.setDeviceMetricsOverride',
                    { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, 20000);
                if (cfg.cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cfg.cpu }, 15000);
                if (cfg.net) await cdp.send('Network.emulateNetworkConditions', cfg.net, 15000);

                if (cfg.seed) {
                    await cdp.send('Page.navigate', { url: cfg.site + '/robots.txt' }, 30000);
                    await sleep(1500);
                    const js = Object.entries(cfg.seed)
                        .map(([k, v]) => 'localStorage.setItem(' + JSON.stringify(k) + ',' + JSON.stringify(v) + ');')
                        .join('');
                    await cdp.send('Runtime.evaluate', { expression: '(()=>{try{' + js + 'return "ok"}catch(e){return ""+e}})()' }, 20000);
                }

                // المراقبُ يُحقن **قبل** التصفّح وإلّا فاتته أوّلُ المقاييس.
                await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: OBSERVER_JS }, 15000);
                // 🔴 و«TBT عالٍ» ليست تشخيصاً — المطلوب **أيُّ دالّةٍ** تستهلك
                //    الخيط. فيُشغَّل محلّلُ المعالج أثناء التحميل ويُجمَّع
                //    الزمنُ الذاتيّ لكلّ إطارِ تنفيذٍ حسب ملفّه.
                let profile = null;
                try {
                    await cdp.send('Profiler.enable', {}, 15000);
                    await cdp.send('Profiler.setSamplingInterval', { interval: 200 }, 10000);
                    await cdp.send('Profiler.start', {}, 15000);
                } catch { /* بلا تحليل */ }

                await cdp.send('Page.navigate', { url: cfg.site + p.url }, 60000);
                await sleep(p.wait || 12000);

                try {
                    const pr = await cdp.send('Profiler.stop', {}, 30000);
                    profile = summarizeProfile(pr.profile);
                } catch { /* بلا تحليل */ }

                const m = await cdp.send('Runtime.evaluate', { expression: COLLECT_JS, returnByValue: true }, 30000);
                const metrics = JSON.parse(m.result.value || '{}');

                const sc = await cdp.send('Runtime.evaluate',
                    { expression: SCROLL_JS, awaitPromise: true, returnByValue: true }, 60000);
                const scroll = JSON.parse(sc.result.value || '{}');

                out.push({ page: p.slug, ...metrics, scroll, profile });
            } catch (e) {
                out.push({ page: p.slug, error: e.message });
            } finally {
                cdp.sessionId = null;
                try { await cdp.send('Target.closeTarget', { targetId }, 10000); } catch { /* ignore */ }
            }
        }
        cleanup();
        return out;
    } catch (e) { cleanup(); throw e; }
}

module.exports = { probe };
