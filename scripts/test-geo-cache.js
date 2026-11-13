#!/usr/bin/env node
/**
 * اختبارُ مخزون المولات — **تنفيذيّ**: يُترجَم الملفُّ الحقيقيُّ ويُشغَّل (v16.20)
 *
 * العقدُ ستُّ خصائص، وكلُّها عيوبٌ وقعت في مشروعنا من قبل بصيغٍ أخرى:
 *   ① مخزونٌ طازج يُقرأ · ② وبعد انتهاء العمر لا يُقرأ.
 *   ③ **وفراغٌ لا يُخزَّن**: الجلبُ الأصليُّ يرفض الفراغ ويُبقي البديلَ
 *      المدمج؛ فخزنُ الفراغ يُجمّده ستَّ ساعات.
 *   ④ **وطابعُ زمنٍ في المستقبل يُرفض**: ساعةُ جهازٍ مضبوطةٌ للوراء كانت
 *      تجعل المخزونَ «طازجاً أبداً».
 *   ⑤ ومحتوىً تالفٌ لا يُسقط الإقلاع. · ⑥ والتفريغُ يُفرّغ فعلاً.
 */
const { execFileSync } = require('child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const root = path.join(__dirname, '..');
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'taki-geo-'));

// `localStorage` غير موجودٍ في node — نُركّبه قبل التحميل.
const store = new Map();
global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
};

try {
    execFileSync('npx', ['tsc', path.join(root, 'src/utils/geoCache.ts'),
        '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
        { cwd: root, stdio: 'pipe' });
} catch (e) {
    console.error('✗ تعذّرت الترجمة:', String(e.stdout || e.message).slice(0, 300));
    process.exit(1);
}
const G = require(path.join(out, 'geoCache.js'));

let pass = 0, fail = 0;
const check = (n, ok, d) => { console.log(`${ok ? '  ✓' : '  ✗'} ${n}`); if (!ok && d) console.log('      ' + d); ok ? pass++ : fail++; };

console.log('\nمخزونُ المولات — مُقاسٌ بالتنفيذ');
const NOW = 1_700_000_000_000;
const rows = [{ id: 'm1', name: 'مول', type: 'mall', cityId: 'khobar', lat: 1, lng: 2 }];

store.clear(); G.writeGeoCache(rows, NOW);
check('① مخزونٌ طازجٌ يُقرأ', JSON.stringify(G.readGeoCache(NOW + 1000)) === JSON.stringify(rows));
check('② وبعد انتهاء العمر لا يُقرأ', G.readGeoCache(NOW + G.GEO_TTL_MS + 1) === null);

// 🪤 الحارسان (عند الكتابة وعند القراءة) **متكافئان**، فاختبارٌ يقرأ بعد
//    الكتابة يمرّ بكسرِ أيٍّ منهما وحده. يُفصلان: الكتابةُ تُقاس بالمخزون
//    نفسِه، والقراءةُ تُقاس بصفٍّ مزروعٍ يدوياً.
store.clear(); G.writeGeoCache([], NOW);
check('③ فراغٌ لا يُكتب في المخزون أصلاً', store.size === 0,
    `كُتب: ${store.get('taki-geo-v1')}`);
store.clear(); store.set('taki-geo-v1', JSON.stringify({ at: NOW, rows: [] }));
check('③ب وصفرُ صفوفٍ مزروعٌ لا يُقرأ مخزوناً', G.readGeoCache(NOW) === null);

store.clear(); G.writeGeoCache(rows, NOW + 10 * 60_000);
check('④ طابعٌ في المستقبل يُرفض', G.readGeoCache(NOW) === null);

store.clear(); store.set('taki-geo-v1', '{ليس جيسون');
check('⑤ محتوىً تالفٌ لا يُسقط شيئاً', G.readGeoCache(NOW) === null);

store.clear(); G.writeGeoCache(rows, NOW); G.clearGeoCache();
check('⑥ التفريغُ يُفرّغ', G.readGeoCache(NOW) === null);

const m = G.mapGeoRow({ id: 7, name: 'س', name_en: '', type: 'market', city_id: 'c', lat: '1.5', lng: '2.5' });
check('⑦ التحويلُ يُطبّع الأرقامَ والفراغَ والمعرّف',
    m.id === '7' && m.type === 'market' && m.nameEn === undefined && m.lat === 1.5, JSON.stringify(m));
// 🪤 و«النوعُ يُطبّع» لا يُثبت بقيمةٍ صحيحةٍ أصلاً — يلزم قيمةٌ غريبة.
check('⑧ ونوعٌ غيرُ معروفٍ يصير mall لا يمرّ كما هو',
    G.mapGeoRow({ id: 1, type: 'MALL' }).type === 'mall'
    && G.mapGeoRow({ id: 1, type: null }).type === 'mall'
    && G.mapGeoRow({ id: 1 }).type === 'mall',
    JSON.stringify([G.mapGeoRow({ id: 1, type: 'MALL' }).type, G.mapGeoRow({ id: 1, type: null }).type]));

fs.rmSync(out, { recursive: true, force: true });
console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
