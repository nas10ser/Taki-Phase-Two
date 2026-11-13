#!/usr/bin/env node
/**
 * اختبارُ مسار التقييمات الواحد — **تنفيذيّ** (v16.24)
 *
 * 🔴 العيبُ الذي يحرسه (قِيس على الإنتاج، فتحُ `/store/<id>` مباشرةً):
 *    نداءان لـ`ratings` بفارق **٣١ م.ث** ومجموعتا المعرّفات فيهما متطابقتان
 *    تقريباً — نفسُ الصفوف تُنزَّل مرّتين. وثالثةٌ تختبئ داخل `getAll()`:
 *    **نسخةٌ ثانيةٌ من نفس الكود بلا سقفِ صفوفٍ إطلاقاً**.
 *
 * والعقدُ ستُّ خصائص:
 *   ① مجموعتان متداخلتان ⇒ استعلامٌ واحدٌ للناقص فقط.
 *   ② وما طُلب ولا تقييماتٍ له **يُسجَّل** — وإلّا أُعيد سؤالُ الخادم عنه أبداً.
 *   ③ وبعد انتهاء العمر يُعاد السؤال.
 *   ④ والإبطالُ يُعيد سؤالَ ذلك العرض وحده.
 *   ⑤ والسقفُ يُمرَّر فعلاً إلى الاستعلام.
 *   ⑥ والفشلُ لا يُجمَّد: استعلامٌ فاشلٌ لا يُسجَّل جواباً.
 */
const { execFileSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const root = path.join(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'taki-rh-'));

// نُركّب طبقةَ سوبابيس: كلُّ استعلامٍ يُسجَّل بمعرّفاته وسقفِه.
const calls = [];
let rows = [];
let failNext = false;
const chain = () => {
    const st = { ids: null, limit: null };
    const api = {
        select: () => api, is: () => api, order: () => api,
        in: (_c, v) => { st.ids = v; return api; },
        limit: (n) => { st.limit = n; calls.push(st); return Promise.resolve(
            failNext ? { data: null, error: { message: 'شبكة' } }
                     : { data: rows.filter(r => st.ids.includes(String(r.deal_id))), error: null }); },
    };
    return api;
};
const fakeModule = `exports.supabase = { from: ${String(() => chain())} };`;

try {
    execFileSync('npx', ['tsc', path.join(root, 'src/repositories/ratingsHydrator.ts'),
        '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
        { cwd: root, stdio: 'pipe' });
} catch (e) { console.error('✗ ترجمة:', String(e.stdout || e.message).slice(0, 400)); process.exit(1); }

// نحقن المُركَّب مكان خدمة سوبابيس الحقيقيّة.
const Module = require('module');
const origResolve = Module._resolveFilename;
const stub = path.join(out, '__supabase_stub.js');
fs.writeFileSync(stub, 'module.exports = { supabase: global.__fakeSupabase };');
Module._resolveFilename = function (req, ...rest) {
    if (/services\/supabaseClient$/.test(req)) return stub;
    return origResolve.call(this, req, ...rest);
};
global.__fakeSupabase = { from: () => chain() };
// 🪤 tsc يحفظ شجرةَ المجلّدات حين يستورد الملفُّ من خارج مجلّده، فالمُخرَجُ
//    قد يقع في `repositories/` لا في الجذر. نبحث عنه بدل أن نفترض مكانه.
const findOut = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) { const r = findOut(f); if (r) return r; }
        else if (e.name === 'ratingsHydrator.js') return f;
    }
    return null;
};
const built = findOut(out);
if (!built) { console.error('✗ لم أجد المُخرَج المترجَم'); process.exit(1); }
const H = require(built);

let pass = 0, fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${n}`); if (!ok && d) console.log('      ' + d); ok ? pass++ : fail++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log('\nمسارُ التقييمات الواحد — مُقاسٌ بالتنفيذ');
    rows = [
        { id: 'r1', deal_id: 'A', user_id: 'u', user_name: 'ن', score: 5, comment: 'ممتاز', created_at: '2026-11-13T09:00:00Z', liked_by: [], like_count: 0 },
        { id: 'r2', deal_id: 'B', user_id: 'u', user_name: 'ن', score: 4, comment: '', created_at: '2026-11-13T09:00:00Z', liked_by: ['x'], like_count: 1 },
    ];

    // ① تداخلٌ ⇒ الناقصُ فقط
    H.invalidateRatings(); calls.length = 0;
    const m1 = await H.hydrateRatingsFor(['A', 'B', 'C']);
    const m2 = await H.hydrateRatingsFor(['A', 'B', 'D']);
    check('① مجموعتان متداخلتان ⇒ استعلامان بالناقص فقط',
        calls.length === 2 && JSON.stringify(calls[1].ids) === JSON.stringify(['D']),
        `${calls.length} استعلاماً · الثاني=${JSON.stringify(calls[1] && calls[1].ids)}`);
    check('  ومحتواها صحيح', m1.A.length === 1 && m1.A[0].comment === 'ممتاز'
        && m1.C.length === 0 && m2.B[0].likeCount === 1, JSON.stringify(m1.A));

    // ② المعرّفُ بلا تقييماتٍ يُسجَّل
    calls.length = 0;
    await H.hydrateRatingsFor(['C']);
    check('② عرضٌ بلا تقييماتٍ لا يُعاد سؤالُه', calls.length === 0, `${calls.length} استعلاماً`);

    // ④ الإبطالُ يستهدف عرضاً واحداً
    calls.length = 0;
    H.invalidateRatings('A');
    await H.hydrateRatingsFor(['A', 'B']);
    check('④ الإبطالُ يُعيد سؤالَ ذلك العرض وحده',
        calls.length === 1 && JSON.stringify(calls[0].ids) === JSON.stringify(['A']),
        JSON.stringify(calls.map(c => c.ids)));

    // ⑤ السقف
    check('⑤ السقفُ يُمرَّر إلى الاستعلام', calls[0].limit === H.RATINGS_HYDRATE_CAP, String(calls[0].limit));

    // ③ بعد انتهاء العمر يُعاد السؤال — بزمنٍ محقونٍ لا بانتظارٍ حرفيّ
    H.invalidateRatings(); calls.length = 0;
    const T0 = 1_700_000_000_000;
    await H.hydrateRatingsFor(['A'], T0);
    await H.hydrateRatingsFor(['A'], T0 + 1000);
    const midway = calls.length;
    await H.hydrateRatingsFor(['A'], T0 + 60_001);
    check('③ داخلَ العمر بلا سؤال، وبعده يُعاد',
        midway === 1 && calls.length === 2, `${midway} ثمّ ${calls.length}`);

    // ⑥ الفشلُ لا يُجمَّد
    H.invalidateRatings(); calls.length = 0; failNext = true;
    await H.hydrateRatingsFor(['Z']);
    failNext = false;
    const before = calls.length;
    await H.hydrateRatingsFor(['Z']);
    check('⑥ الفشلُ لا يُخزَّن جواباً', calls.length === before + 1, `${before} ثمّ ${calls.length}`);

    fs.rmSync(out, { recursive: true, force: true });
    console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
    process.exit(fail === 0 ? 0 : 1);
})();
