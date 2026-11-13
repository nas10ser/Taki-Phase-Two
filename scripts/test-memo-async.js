#!/usr/bin/env node
/**
 * اختبارُ `memoAsync` — **تنفيذيّ لا نصّيّ** (v16.17)
 *
 * يُترجَم الملفُّ الحقيقيُّ بـtsc إلى مجلّدٍ مؤقّت ثمّ يُشغَّل، فما يُقاس هو
 * الكودُ الذي يُشحن لا نسخةٌ منه. والعقدُ خمسُ خصائص:
 *   ① نداءان متزامنان على نفس المفتاح ⇒ **تشغيلٌ واحد**.
 *   ② نداءٌ ثانٍ داخل العمر ⇒ بلا تشغيل.
 *   ③ نداءٌ بعد العمر ⇒ تشغيلٌ جديد (ذاكرةٌ بلا عمرٍ تكذب على التاجر).
 *   ④ **الفشلُ لا يُخزَّن** — وإلّا جمّد خطأُ شبكةٍ عابرٌ دقيقةً كاملة.
 *   ⑤ مفتاحان مختلفان ⇒ تشغيلان (مفتاحٌ ناقصٌ يُسلّم جوابَ متجرٍ لآخر).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'taki-memo-'));
try {
    execFileSync('npx', ['tsc', path.join(root, 'src/utils/memoAsync.ts'),
        '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
        { cwd: root, stdio: 'pipe' });
} catch (e) {
    console.error('✗ تعذّرت ترجمةُ memoAsync.ts:', String(e.stdout || e.message).slice(0, 400));
    process.exit(1);
}
const { memoAsync, clearAsyncMemo, reserveAsyncMemo, primeAsyncMemo } = require(path.join(out, 'memoAsync.js'));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    console.log('\nmemoAsync — مُقاسٌ بالتنفيذ');

    // ① نداءان متزامنان
    clearAsyncMemo();
    let runs = 0;
    const slow = async () => { runs++; await sleep(40); return 'A'; };
    const [a, b] = await Promise.all([memoAsync('k', 5000, slow), memoAsync('k', 5000, slow)]);
    check('نداءان متزامنان ⇒ تشغيلٌ واحد', runs === 1 && a === 'A' && b === 'A', `runs=${runs}`);

    // ② داخل العمر
    const c = await memoAsync('k', 5000, slow);
    check('نداءٌ داخل العمر ⇒ بلا تشغيل', runs === 1 && c === 'A', `runs=${runs}`);

    // ③ بعد العمر
    await sleep(60);
    await memoAsync('k', 50, slow);
    check('نداءٌ بعد العمر ⇒ تشغيلٌ جديد', runs === 2, `runs=${runs}`);

    // ④ الفشلُ لا يُخزَّن
    clearAsyncMemo();
    let fruns = 0;
    const boom = async () => { fruns++; throw new Error('شبكة'); };
    await memoAsync('f', 5000, boom).catch(() => {});
    await memoAsync('f', 5000, boom).catch(() => {});
    check('الفشلُ لا يُخزَّن', fruns === 2, `fruns=${fruns}`);

    // ⑤ مفتاحان مختلفان
    clearAsyncMemo();
    let kruns = 0;
    const idn = async () => { kruns++; return kruns; };
    const r1 = await memoAsync('s:1', 5000, idn);
    const r2 = await memoAsync('s:2', 5000, idn);
    check('مفتاحان مختلفان ⇒ تشغيلان وجوابان', kruns === 2 && r1 !== r2, `kruns=${kruns}`);

    // ⑥ التفريغ يعمل فعلاً
    clearAsyncMemo();
    let zruns = 0;
    const z = async () => { zruns++; return 'z'; };
    await memoAsync('z', 5000, z);
    clearAsyncMemo();
    await memoAsync('z', 5000, z);
    check('clearAsyncMemo يُفرّغ فعلاً', zruns === 2, `zruns=${zruns}`);

    // ⑦ الحجزُ بوعدٍ طائر — وهو ما يُسقط نداءات الأبناء فعلاً
    clearAsyncMemo();
    let childRuns = 0;
    let settle; const bundle = new Promise((r) => { settle = r; });
    reserveAsyncMemo('k2', bundle.then((v) => ({ data: v })));
    const childAsk = memoAsync('k2', 5000, async () => { childRuns++; return { data: 'own' }; });
    settle('bundled');
    const got = await childAsk;
    check('⑦ الابنُ ينضمّ للوعد المحجوز ولا يفتح نداءه',
        childRuns === 0 && got.data === 'bundled', `runs=${childRuns} got=${JSON.stringify(got)}`);

    // ⑧ ولا يدهس الحجزُ جواباً حيّاً
    // 🪤 ويُقرأ **بعد** أن يُحسم وعدُ الحجز: القراءةُ الفوريّة تُصيب `done`
    //    فتمرّ ولو كان الحجزُ قد داس — والدهسُ يقع عند الحسم لا عند الحجز.
    clearAsyncMemo();
    primeAsyncMemo('k3', { data: 'الأقدمُ حيّ' });
    reserveAsyncMemo('k3', Promise.resolve({ data: 'الوافدُ' }));
    await new Promise((r) => setTimeout(r, 20));
    const keep = await memoAsync('k3', 5000, async () => ({ data: 'نداءٌ' }));
    check('⑧ ولا يدهس الحجزُ جواباً حيّاً', keep.data === 'الأقدمُ حيّ', JSON.stringify(keep));

    // ⑨ وبعد الحسم يُخزَّن فيُصيب السائلُ المتأخّر بلا شبكة
    clearAsyncMemo();
    let lateRuns = 0;
    reserveAsyncMemo('k4', Promise.resolve({ data: 'جاهز' }));
    await memoAsync('k4', 5000, async () => { lateRuns++; return { data: 'x' }; });
    await new Promise((r) => setTimeout(r, 10));
    const late = await memoAsync('k4', 5000, async () => { lateRuns++; return { data: 'x' }; });
    check('⑨ والسائلُ المتأخّرُ يُصيب المخزون', lateRuns === 0 && late.data === 'جاهز', `runs=${lateRuns}`);

    fs.rmSync(out, { recursive: true, force: true });
    console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
    process.exit(fail === 0 ? 0 : 1);
})();
