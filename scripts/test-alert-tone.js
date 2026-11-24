#!/usr/bin/env node
/**
 * test-alert-tone.js — النغمةُ **تُشغَّل فعلاً**، لا تُقرأ (v16.57)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **ولماذا تشغيلٌ لا `grep`**: العيبُ الذي أبلغ عنه ناصر (صوتٌ مكتوبٌ في
 *    الكود منذ v16.02 ولا يُسمع) **لا يظهر في أيّ فحصٍ نصّيّ** — السطرُ
 *    `new Audio(...).play()` سليمٌ تماماً قراءةً، وسقوطُه سلوكُ متصفّحٍ:
 *    إذنُ التشغيل التلقائي يُمنح **للعنصر الذي لمسه المستخدم**، وعنصرٌ يُولد
 *    لحظةَ الإشعار لا يرثه. فلا يُثبته إلّا تشغيلٌ يُحاكي تلك السياسة.
 *
 * فيُترجَم الملفُّ ويُنفَّذ تحت متصفّحٍ وهميّ:
 *   · `Audio` تُسجّل كم عنصراً أُنشئ، و`play()` **تُرفض** إلّا على عنصرٍ
 *     سبق أن شُغّل داخل نافذةِ تفاعلٍ من المستخدم (هذه هي السياسةُ الحقيقيّة).
 *   · المؤقّتاتُ وهميّةٌ فيُقفز الزمنُ ساعةً في ملّي ثانية.
 *
 * 🪤 ومخرَجُ الترجمة **داخل المشروع** (`node_modules/.cache-*`): حلُّ الوحدات
 *    يصعد من موضع الملفّ (درس v16.28).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'node_modules', '.cache-alert-tone');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

console.log('\nنغمةُ التنبيه — تُشغَّل فعلاً تحت سياسة المتصفّح');

// ── ترجمةُ الخدمة وحدها ─────────────────────────────────────────────────────
fs.rmSync(out, { recursive: true, force: true });
try {
    execFileSync('npx', ['tsc', 'src/services/notificationSound.ts',
        '--outDir', out, '--module', 'commonjs', '--target', 'es2017',
        '--lib', 'es2017,dom', '--skipLibCheck', '--strict'],
        { cwd: root, stdio: 'pipe' });
} catch (e) {
    console.log('  ✗ تعذّرت ترجمةُ الخدمة');
    console.log(String(e.stdout || e.stderr || e).slice(0, 2000));
    process.exit(1);
}

// ── متصفّحٌ وهميّ ────────────────────────────────────────────────────────────
let created = 0, plays = 0, rejected = 0, pauses = 0;
let inGesture = false;           // هل نحن داخل نافذةِ تفاعلٍ من المستخدم؟

class FakeAudio {
    constructor(src) { created++; this.src = src; this.volume = 1; this.currentTime = 0; this._blessed = false; }
    play() {
        // 🔴 السياسةُ الحقيقيّة: الإذنُ يُمنح للعنصر الذي شُغّل أثناء التفاعل.
        if (inGesture) this._blessed = true;
        if (!this._blessed) { rejected++; return Promise.reject(new Error('NotAllowedError')); }
        plays++; return Promise.resolve();
    }
    pause() { pauses++; }
}

const listeners = [];
global.Audio = FakeAudio;
global.window = {
    addEventListener: (ev, fn, opts) => listeners.push({ ev, fn, once: !!(opts && opts.once) }),
};
global.document = { hidden: false };

// مؤقّتاتٌ وهميّة — تُستبدل قبل الاستيراد، والنداءُ يحلّها لحظةَ الاستدعاء
let seq = 0, clock = 0;
const timers = [];
global.setInterval = (fn, ms) => { const t = { id: ++seq, fn, ms, next: clock + ms }; timers.push(t); return t.id; };
global.clearInterval = (id) => { const i = timers.findIndex(t => t.id === id); if (i > -1) timers.splice(i, 1); };
const advance = (ms) => {
    const end = clock + ms;
    for (;;) {
        const due = timers.filter(t => t.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        clock = due.next; due.next += due.ms; due.fn();
    }
    clock = end;
};
/** لمسةُ مستخدمٍ حقيقيّة: تُطلق المستمعين داخل نافذةِ التفاعل. */
const touch = async (ev = 'pointerdown') => {
    inGesture = true;
    for (const l of listeners.filter(l => l.ev === ev)) l.fn();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    inGesture = false;
};

const S = require(path.join(out, 'notificationSound.js'));

(async () => {
    // ── ① قبل أيّ لمسة: النغمةُ محجوبة (وهذا هو العيبُ الذي أبلغ عنه ناصر) ──
    S.playSound();
    await Promise.resolve();
    check('قبل أيّ تفاعلٍ: المتصفّحُ يحجب النغمة (وهذا سلوكُه لا عيبُنا)',
        plays === 0 && rejected >= 1,
        `plays=${plays} · rejected=${rejected} — لو مرّت هنا فالمحاكاةُ خاطئة ولا قيمةَ لباقي الفحوص`);

    // ── ② ثمّ لمسةٌ واحدة تفتح القفل ──────────────────────────────────────
    S.unlockSound();
    check('و`unlockSound` تربط ثلاثةَ أحداثٍ بـ`once`',
        listeners.length === 3 && listeners.every(l => l.once),
        `ربطَ ${listeners.length} حدثاً`);
    await touch('pointerdown');
    check('واللمسةُ تفتح القفلَ صامتةً ثمّ تُوقف',
        pauses >= 1, 'النغمةُ تُسمع عند اللمسة نفسِها — إزعاجٌ لا فتحُ قفل');

    const beforeReal = plays;
    S.playSound(); await Promise.resolve();
    check('🔴 وبعدها النغمةُ **تُسمع فعلاً**',
        plays === beforeReal + 1,
        'هذا هو جوهرُ الإصلاح: العنصرُ المفتوحُ قفلُه يُعاد استعماله');

    // ── ③ والعنصرُ واحدٌ لا واحدٌ لكلّ نغمة ────────────────────────────────
    S.playSound(); S.playSound(); await Promise.resolve();
    check('وعنصرُ الصوت **واحدٌ** مهما تكرّرت النغمة',
        created === 1,
        `أُنشئ ${created} عنصراً — وكلُّ عنصرٍ جديدٍ يبدأ محجوباً، وهو العيبُ بعينه`);

    // ── ④ لا تُشغَّل والصفحةُ مخفيّة ────────────────────────────────────────
    const beforeHidden = plays;
    global.document.hidden = true;
    S.playSound(); await Promise.resolve();
    check('ولا تُشغَّل والصفحةُ مخفيّة',
        plays === beforeHidden, 'المتصفّحُ يكتم الخلفيّة أصلاً، فالمحاولةُ دورةٌ ضائعة');
    global.document.hidden = false;

    // ── ⑤ التكرار: يبدأ ويتوقّف بالقائمة ──────────────────────────────────
    S.syncRepeating(['order:A', 'order:B']);
    check('وقائمةٌ بطلبين تُنشئ مؤقّتين',
        S.activeRepeatCount() === 2, `العدد = ${S.activeRepeatCount()}`);

    let p = plays;
    advance(15000); await Promise.resolve();
    check('وكلُّ دورةٍ تُنتج نغمةً لكلّ طلبٍ معلّق',
        plays === p + 2, `أُنتجت ${plays - p} نغمة بدل ٢`);

    S.syncRepeating(['order:A', 'order:B']);
    check('ونداءٌ ثانٍ بنفس القائمة **لا يُضاعف** المؤقّتات',
        S.activeRepeatCount() === 2 && timers.length === 2,
        `مؤقّتات=${timers.length} — طلبان معلّقان ينتجان نغمتين متداخلتين`);

    // ── ⑥ 🔴 والاستلامُ يُسكتها — بأيّ مسارٍ وصل ─────────────────────────
    S.syncRepeating(['order:B']);           // «A» استُلم أو أُلغي
    check('🔴 واستلامُ طلبٍ (أو إلغاؤه) يُسكت نغمتَه وحدها',
        S.activeRepeatCount() === 1, 'أمرُ ناصر: تتكرّر «إلى أن يُستلم أو يُلغى»');
    p = plays; advance(15000); await Promise.resolve();
    check('فتبقى نغمةُ الطلبِ الآخرِ وحدها',
        plays === p + 1, `أُنتجت ${plays - p} نغمة بدل ١`);

    S.syncRepeating([]);
    p = plays; advance(60000); await Promise.resolve();
    check('وقائمةٌ فارغةٌ تُسكت الكلّ — صفرُ نغمةٍ بعدها',
        S.activeRepeatCount() === 0 && timers.length === 0 && plays === p,
        `عدد=${S.activeRepeatCount()} · مؤقّتات=${timers.length} · نغمات=${plays - p}`);

    // ── ⑦ وسقفُ الساعة شبكةَ أمان ─────────────────────────────────────────
    S.syncRepeating(['order:night']);
    advance(3 * 60 * 60 * 1000); await Promise.resolve();
    check('وتطبيقٌ منسيٌّ مفتوحاً لا يدقّ إلى الصباح',
        S.activeRepeatCount() === 0,
        'السقفُ شبكةُ أمانٍ: ساعةٌ تكفي أيَّ طلبٍ حقيقيّ ثمّ يتوقّف');

    S.stopAllRepeating();
    console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل`);
    console.log(`   (عناصرُ صوتٍ أُنشئت: ${created} · نغماتٌ سُمعت: ${plays} · محجوبة: ${rejected})\n`);
    process.exit(fail === 0 ? 0 : 1);
})();
