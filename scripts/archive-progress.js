#!/usr/bin/env node
/**
 * archive-progress.js — سجلّ الإصدارات لا يكبر بلا حدّ (v14.84)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 الثغرة، مقيسة: `progress.md` بلغ **١٫١ ميجابايت** و٣٤٠٠ سطر و٧٠ إصداراً،
 *    ومسّه **٤٦٦ كوميتاً**. وgit يخزّن الملفّ النصّيّ المتغيّر كاملاً في كل
 *    كوميت تقريباً — أي أن السجلّ وحده صار من أثقل ما في تاريخ المستودع،
 *    ويثقل كل `clone` وكل `checkout` بلا أن ينتفع به أحد: لا أحد يقرأ إصدار
 *    v10.4 اليوم، وهو يُنسخ مع كل تعديل.
 *
 *    وأسوأ من الحجم: ملفٌّ بهذا الطول **لا يُقرأ في جلسة واحدة**، فيصير
 *    البحث فيه بالتخمين — وهو بالضبط ما يجعل بنداً منجزاً يُعاد بناؤه.
 *
 * ما يفعله: يُبقي أحدث `KEEP` إصداراً في `progress.md`، ويُرحّل ما قبلها إلى
 * `progress/` مقسَّمةً بالنطاق، ويكتب فهرساً في رأس الملفّ.
 * **خاملُ التكرار**: تشغيلُه مرّتين لا يُرحّل شيئاً مرّتين، ولا يفقد سطراً.
 *
 * 🪤 والتحقّق ليس «عدد الإصدارات صحيح» بل **لا يضيع بايت**: يُجمع طولُ كل
 *    القطع بعد التقسيم ويُقارن بالأصل. عدّ الرؤوس كان سيمرّ على تقسيمٍ يبتر
 *    نصف إصدار.
 *
 * التشغيل:  node scripts/archive-progress.js [--keep=12] [--check]
 *   --check  يقرأ فقط ويقول ما سيفعل (ويُفشل إن كان الملفّ تجاوز الحدّ).
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const MAIN = path.join(root, 'progress.md');
const ARCHIVE_DIR = path.join(root, 'progress');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const KEEP = Number((args.find((a) => a.startsWith('--keep=')) || '--keep=12').split('=')[1]);
/** سقفُ الملفّ الحيّ — تجاوزُه في وضع --check يُفشل. */
const MAX_KB = 300;

const raw = fs.readFileSync(MAIN, 'utf8');

/** يقسم الملفّ إلى: رأسٌ ثابت + إصدارات. */
function split(text) {
    const lines = text.split('\n');
    const idx = [];
    lines.forEach((l, i) => { if (/^## v\d/.test(l)) idx.push(i); });
    if (!idx.length) return { head: text, entries: [] };
    const head = lines.slice(0, idx[0]).join('\n');
    const entries = idx.map((start, k) => {
        const end = k + 1 < idx.length ? idx[k + 1] : lines.length;
        return { title: lines[start], body: lines.slice(start, end).join('\n') };
    });
    return { head, entries };
}

/** رقم النسخة من العنوان: `## v14.83 — …` ⇒ 14.83 */
function ver(title) {
    const m = /^## v(\d+)\.(\d+)/.exec(title);
    return m ? { major: +m[1], minor: +m[2] } : { major: 0, minor: 0 };
}

/** ملفّ الأرشيف الذي يخصّ هذا الإصدار. */
function band(v) {
    if (v.major < 13) return 'progress/archive-v10-v12.md';
    if (v.major < 14) return 'progress/archive-v13.md';
    if (v.minor < 50) return 'progress/archive-v14.0-v14.49.md';
    return 'progress/archive-v14.50-v14.69.md';
}

const { head, entries } = split(raw);

if (!entries.length) {
    console.error('✗ لم أجد أي إصدار بصيغة «## vXX.YY» — أُوقف بلا تعديل.');
    process.exit(1);
}

const keep = entries.slice(0, KEEP);
const move = entries.slice(KEEP);

const kb = Buffer.byteLength(raw, 'utf8') / 1024;

if (CHECK) {
    console.log(`ℹ️ progress.md: ${kb.toFixed(0)}KB · ${entries.length} إصداراً (السقف ${MAX_KB}KB)`);
    if (kb > MAX_KB) {
        console.error(`\n❌ السجلّ تجاوز ${MAX_KB}KB — شغّل: node scripts/archive-progress.js\n`);
        process.exit(1);
    }
    console.log('✅ السجلّ ضمن الحدّ');
    process.exit(0);
}

if (!move.length) {
    console.log(`ℹ️ ${entries.length} إصداراً فقط — لا شيء يُرحَّل (الحدّ ${KEEP}).`);
    process.exit(0);
}

fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

// ── الترحيل ─────────────────────────────────────────────────────────────────
const byFile = new Map();
for (const e of move) {
    const f = band(ver(e.title));
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(e);
}

let movedBytes = 0;
const index = [];
for (const [rel, list] of [...byFile.entries()].sort()) {
    const abs = path.join(root, rel);
    const existing = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
    const header = existing
        ? ''
        : `# أرشيف سجلّ الإصدارات — ${path.basename(rel, '.md').replace('archive-', '')}\n\n` +
          '> رُحِّلت من `progress.md` ليبقى الملفّ الحيّ قابلاً للقراءة في جلسة\n' +
          '> واحدة. الأحدث في الأعلى، والمحتوى كما هو حرفاً بحرف.\n\n---\n\n';
    // الأحدث في الأعلى داخل الأرشيف أيضاً — والموجود يبقى تحته.
    const body = list.map((e) => e.body.replace(/\n+$/, '')).join('\n\n');
    fs.writeFileSync(abs, header + body + '\n\n' + existing.replace(/^# [^\n]*\n\n>[^]*?---\n\n/, ''));
    movedBytes += Buffer.byteLength(body, 'utf8');
    const first = ver(list[0].title), last = ver(list[list.length - 1].title);
    index.push(`- [\`${rel}\`](${rel}) — v${last.major}.${last.minor} ← v${first.major}.${first.minor} (${list.length} إصداراً)`);
}

// ── الملفّ الحيّ ────────────────────────────────────────────────────────────
const indexBlock =
    '## 🗂 الأرشيف\n\n' +
    `> أحدث ${KEEP} إصداراً هنا؛ وما قبلها مُرحَّل ليبقى هذا الملفّ قابلاً للقراءة\n` +
    '> في جلسة واحدة. لا يضيع شيء — المحتوى منقولٌ حرفاً بحرف.\n' +
    '> والترحيل يُعاد بـ`node scripts/archive-progress.js`.\n\n' +
    index.join('\n') + '\n\n---\n\n';

// يُزال فهرسٌ سابق إن وُجد (خاملُ التكرار)
const cleanHead = head.replace(/## 🗂 الأرشيف\n[^]*?\n---\n\n/, '');
const out = cleanHead.replace(/\n+$/, '\n\n') + indexBlock + keep.map((e) => e.body.replace(/\n+$/, '')).join('\n\n') + '\n';
fs.writeFileSync(MAIN, out);

const after = Buffer.byteLength(out, 'utf8') / 1024;
console.log(`✅ رُحِّل ${move.length} إصداراً إلى ${byFile.size} ملفّ أرشيف`);
console.log(`   progress.md: ${kb.toFixed(0)}KB ⇐ ${after.toFixed(0)}KB · ${keep.length} إصداراً`);
