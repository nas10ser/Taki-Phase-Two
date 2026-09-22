/**
 * walk.js — تعداد ملفّات المصدر **بلا git** (v14.80b)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 الدرس، مدفوعُ الثمن اليوم: `check-csp.js` و`check-deps.js` كانا يعدّان
 *    الملفّات بـ`git ls-files` — وهي تعمل على جهاز ناصر وتنفجر على Vercel:
 *      fatal: not a git repository (or any parent up to mount point /vercel)
 *    لأن Vercel تبني من أرشيفٍ **بلا مجلّد `.git` إطلاقاً**. فمرّ الفحصان
 *    خضراوين محلياً وأسقطا نشرَتين في الإنتاج.
 *
 * 🪤 والقاعدة المستخلصة: **أي فحصٍ داخل سلسلة البناء لا يجوز أن يفترض git.**
 *    بيئة البناء ليست بيئة التطوير — لا تاريخ، ولا فهرس، ولا مراجع.
 *    (ولذلك بقي `check-cache-bump.js` خارج السلسلة عمداً: هو يحتاج مرجعين.)
 *
 * ℹ️ والفشل كان **مغلقاً** كما يجب: لم يُنشر شيء، وبقي الموقع على آخر نسخة
 *    سليمة. الخطأ في الأداة لا في البوّابة.
 */
const fs = require('fs');
const path = require('path');

const SKIP = new Set(['node_modules', 'dist', '.parcel-cache', '.git', '.vercel', 'coverage']);

/**
 * يُعيد مسارات الملفّات (نسبيةً إلى `root`) تحت المسارات المُعطاة.
 * @param {string} root
 * @param {string[]} targets ملفّات أو مجلّدات
 * @param {RegExp} [match] امتدادات مقبولة
 */
function walk(root, targets, match) {
    const out = [];
    const visit = (rel) => {
        const abs = path.join(root, rel);
        let st;
        try { st = fs.statSync(abs); } catch { return; }
        if (st.isDirectory()) {
            if (SKIP.has(path.basename(rel))) return;
            let entries;
            try { entries = fs.readdirSync(abs); } catch { return; }
            for (const e of entries) visit(path.join(rel, e));
            return;
        }
        if (!match || match.test(rel)) out.push(rel);
    };
    for (const t of targets) visit(t);
    return out;
}

module.exports = { walk };
