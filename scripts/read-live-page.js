#!/usr/bin/env node
/**
 * read-live-page.js — نصُّ صفحةٍ حيّةٍ **بعد تصييرها** (v16.57)
 * ═══════════════════════════════════════════════════════════════════════════
 * الموقعُ تطبيقُ صفحةٍ واحدة، فـ`curl` يُعيد القشرةَ لا المحتوى — وكلُّ تحقّقٍ
 * من نصٍّ ظاهر على الإنتاج كان يحتاج جهازَ ناصر. وهذه الأداةُ تُغلق الفجوة:
 * كروم بلا رأسٍ عبر بروتوكول المطوّرين، وتُطبع `innerText` بعد استقرار الصفحة.
 *
 * 🪤 ولا يُستعمل `--virtual-time-budget`: الصفحةُ فيها حلقاتُ رسمٍ (بانر
 *    متحرّك) فلا يستقرّ الزمنُ الوهميُّ أبداً — قِيس فتجاوز خمسَ دقائقَ ولم
 *    ينتهِ. الانتظارُ هنا بسقفٍ حقيقيّ وشرطٍ على طول النصّ.
 * 🪤 ولا تُستعمل في سلسلة البناء: تحتاج شبكةً وكروم، وVercel تبني بلا كليهما.
 *
 *   node scripts/read-live-page.js <العنوان> [كلماتٌ للبحث…]
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const url = process.argv[2];
const needles = process.argv.slice(3);
if (!url) { console.error('الاستعمال: node scripts/read-live-page.js <url> [needles…]'); process.exit(2); }

const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
if (!CHROME) { console.error('❌ لا متصفّحَ مثبَّت'); process.exit(2); }

const PORT = 9222 + (process.pid % 500);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'taki-cdp-'));
const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-dev-shm-usage', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`,
    'about:blank',
], { stdio: 'ignore' });

const wait = (ms) => new Promise(r => setTimeout(r, ms));
const bye = (code) => { try { chrome.kill('SIGKILL'); } catch { /* */ } try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* */ } process.exit(code); };

(async () => {
    // ① انتظارُ المنفذ
    let ws = null;
    for (let i = 0; i < 60 && !ws; i++) {
        try {
            const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
            ws = (await r.json()).webSocketDebuggerUrl;
        } catch { await wait(250); }
    }
    if (!ws) { console.error('❌ تعذّر فتح المتصفّح'); bye(2); }

    const sock = new WebSocket(ws);
    let id = 0; const waiting = new Map();
    const send = (method, params, sessionId) => new Promise((res, rej) => {
        const mid = ++id; waiting.set(mid, { res, rej });
        sock.send(JSON.stringify({ id: mid, method, params: params || {}, sessionId }));
    });
    sock.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && waiting.has(m.id)) {
            const w = waiting.get(m.id); waiting.delete(m.id);
            m.error ? w.rej(new Error(m.error.message)) : w.res(m.result);
        }
    });
    await new Promise((res, rej) => { sock.addEventListener('open', res); sock.addEventListener('error', rej); });

    // ② هدفٌ جديد ونجلس عليه
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Page.enable', {}, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Page.navigate', { url }, sessionId);

    // ③ انتظارٌ بشرطٍ على المحتوى لا بزمنٍ أعمى (سقفٌ ٤٥ ثانية)
    let text = '', ok = false, lastLen = -1;
    for (let i = 0; i < 90; i++) {
        await wait(500);
        try {
            const r = await send('Runtime.evaluate', {
                expression: '(document.body && document.body.innerText) || ""',
                returnByValue: true,
            }, sessionId);
            text = (r.result && r.result.value) || '';
            // 🪤 والعتبةُ لا تكون رقماً كبيراً اعتباطاً: «١٥٠٠ محرفاً» حذّرت
            //    كذباً على `/register` (٢٢٤ محرفاً وهي **مُصيَّرةٌ كاملةً** —
            //    صفحةُ زرّين). فالشرطُ: جسمٌ غيرُ فارغٍ ثبت طولُه دورتين.
            if (text.length > 150 && text.length === lastLen) { ok = true; if (i > 4) break; }
            lastLen = text.length;
        } catch { /* الصفحةُ تُبدَّل */ }
    }

    console.log(`العنوان: ${url}`);
    console.log(`طولُ النصّ المُصيَّر: ${text.length} محرفاً${ok ? '' : '  ⚠️ لم يثبت الطولُ — قد لا تكون صُيِّرت'}`);
    let bad = 0;
    for (const n of needles) {
        const hit = text.includes(n);
        console.log(`  ${hit ? '✅ ظاهر ' : '❌ غائب '} «${n.length > 60 ? n.slice(0, 60) + '…' : n}»`);
        if (!hit) bad++;
    }
    if (!needles.length) console.log('\n' + text.slice(0, 4000));
    bye(ok && bad === 0 ? 0 : 1);
})().catch(e => { console.error('❌ ' + (e && e.message)); bye(2); });
