#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAKI · حارسُ ملفّي الربط — ولماذا كان فحصُهما قبل اليوم غيرَ قابلٍ للفشل
 *
 * 🔴 قِيس على الإنتاج (٨ نوفمبر ٢٠٢٦) قبل هذا الحارس:
 *     GET https://www.takisa.net/.well-known/apple-app-site-association
 *       → 200 · content-type: application/json · والجسمُ **HTML** (١٥٩١٨ بايتاً)
 *     GET https://www.takisa.net/.well-known/assetlinks.json  → 404
 *     GET https://takisa.net/.well-known/…                     → 308
 *
 *   ثلاثُ آلياتٍ تراكمت، ورابعةٌ أخفتها:
 *   ① الملفّان لم يُكتبا قطّ — كاتباهما يحتاجان قيمةً لا يملكها إلا ناصر.
 *   ② قاعدةُ SPA في `vercel.json` تستثني ما ينتهي بامتدادٍ فقط، و
 *      `apple-app-site-association` **بلا امتداد** عمداً (كما تطلب أبل) ⇒
 *      تُعاد كتابتُه إلى `index.html` فيعود ٢٠٠ بجسم HTML.
 *   ③ وترويسةُ `Content-Type: application/json` **مُعلَّقةٌ على مسارٍ فارغ**،
 *      فتُلبِس HTML ثوبَ JSON — أي أنّ ترويسةَ السلامة هي التمويه.
 *   ④ وأمرا التحقّق المطبوعان `curl -s …` بلا `-f`: الخروجُ صفرٌ على ٤٠٤
 *      وعلى جسمِ HTML. فحصان لا يستطيعان الفشل.
 *
 * ولذلك هذا الحارسُ **لا يَسأل الشبكة**: يعمل في CI بلا شبكة، ولا يُخدَع
 * بردٍّ مخزَّنٍ في مُخبّئ. يفحص المصدرَ والعقدَ.
 *
 * 🪤 ولا يفشل لأنّ الملفّين غائبان: غيابُهما حالةٌ مشروعةٌ قبل أن يشتري ناصر
 *    حسابَي المتجرين (بصمةُ توقيع قوقل ومُعرِّفُ فريق أبل لا يُخترعان).
 *    لكنه **يفشل** إن رُجع استثناءُ `.well-known` من التوجيه — وهو الشرطُ
 *    الذي، لو رُجع، أعاد الملفَّ السليمَ إلى ٢٠٠-بجسمِ-HTML بلا أيّ أثر.
 * ═══════════════════════════════════════════════════════════════════════════
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WK = path.join(ROOT, '.well-known');
const AASA = path.join(WK, 'apple-app-site-association');
const AL = path.join(WK, 'assetlinks.json');
const APP_ID = 'net.takisa.app';          // capacitor.config.ts · android/app/build.gradle

const errors = [];
const notes = [];
const read = (p) => fs.readFileSync(p, 'utf8');

// ── ① العقدُ في التوجيه — يُفحص **دائماً**, حاضراً كان الملفّان أو غائبين ──
let vj;
try { vj = JSON.parse(read(path.join(ROOT, 'vercel.json'))); }
catch (e) { errors.push(`vercel.json لا يُقرأ: ${e.message}`); }

if (vj) {
    const spa = (vj.rewrites || []).find((r) => String(r.destination) === '/index.html');
    if (!spa) {
        errors.push('لا قاعدةَ SPA في vercel.json — تغيّرت البنيةُ فلا يَحرس هذا الفحصُ شيئاً.');
    } else if (!String(spa.source).includes('well-known')) {
        errors.push(
            'قاعدةُ SPA تبتلع `/.well-known/`:\n'
            + `     ${spa.source}\n`
            + '     فيعود `apple-app-site-association` (وهو بلا امتدادٍ عمداً) **٢٠٠ بجسم HTML**،\n'
            + '     وترويسةُ `application/json` تُلبِسه ثوبَ JSON ⇒ أبل لا تتحقّق أبداً، ولا أثرَ في أيّ سجلّ.\n'
            + '     العلاج: استثنِ المسار في `source` — `/((?!\\.well-known/)(?!.*\\.[a-zA-Z0-9]+$).*)`'
        );
    }
    const apex = (vj.redirects || []).find((r) =>
        (r.has || []).some((h) => h.type === 'host' && h.value === 'takisa.net'));
    if (!apex) {
        notes.push('لا تحويلَ من الجذر (تغيّرت البنية)');
    } else if (!String(apex.source).includes('well-known')) {
        errors.push(
            'تحويلُ الجذر يَلتقط `/.well-known/`:\n'
            + `     ${apex.source}\n`
            + '     وأبل **لا تتبع تحويلاً** عند جلب ملفّ الربط، والجذرُ معلَنٌ في\n'
            + '     `App.entitlements` و`AndroidManifest.xml` ⇒ إعلانٌ لا يتحقّق أبداً.'
        );
    }
    // والترويسةُ التي تُلبِس النوعَ يجب أن تبقى — أبل تتجاهل أيَّ نوعٍ آخر
    const hdr = (vj.headers || []).find((h) => String(h.source).includes('apple-app-site-association'));
    if (!hdr) {
        errors.push('سقطت ترويسةُ `Content-Type: application/json` لملفّ أبل — وأبل تتجاهل أيَّ نوعٍ آخر.');
    }
}

// ── ② الملفّان: غيابٌ مشروع، أو حضورٌ يُفحص بالتحليل لا بالنصّ ──────────────
const haveAASA = fs.existsSync(AASA);
const haveAL = fs.existsSync(AL);

if (!haveAASA && !haveAL) {
    notes.push('الملفّان غائبان (الروابطُ العميقة مُطفأة) — حالةٌ مشروعةٌ قبل حسابَي المتجرين');
} else {
    // أبل
    if (!haveAASA) {
        errors.push('`.well-known/assetlinks.json` موجودٌ و`apple-app-site-association` غائب — نصفُ ربط.');
    } else {
        if (fs.existsSync(AASA + '.json')) {
            errors.push('`apple-app-site-association.json` موجود — أبل تطلبه **بلا امتداد** بهذا الاسم بالضبط.');
        }
        const t = read(AASA);
        if (/<!DOCTYPE|<html/i.test(t)) {
            errors.push('ملفُّ أبل يحوي HTML — هذا هو العَرَضُ بعينه الذي أُنشئ هذا الحارسُ له.');
        } else {
            let j;
            try { j = JSON.parse(t); }
            catch (e) { errors.push(`ملفُّ أبل ليس JSON سليماً: ${e.message}`); }
            if (j) {
                const ids = j?.applinks?.details?.[0]?.appIDs;
                const RE = new RegExp('^[A-Z0-9]{10}\\.' + APP_ID.replace(/\./g, '\\.') + '$');
                if (!Array.isArray(ids) || ids.length !== 1 || !RE.test(ids[0])) {
                    errors.push(
                        `applinks.details[0].appIDs يجب أن يكون عنصراً واحداً بالشكل <TEAMID>.${APP_ID}`
                        + `\n     الموجود: ${JSON.stringify(ids)}`
                    );
                }
                const wc = j?.webcredentials?.apps?.[0];
                if (wc && !RE.test(wc)) {
                    errors.push(`webcredentials.apps[0] لا يطابق الشكل: ${wc}`);
                }
            }
        }
    }
    // أندرويد
    if (!haveAL) {
        errors.push('`apple-app-site-association` موجودٌ و`assetlinks.json` غائب — نصفُ ربط.');
    } else {
        let a;
        try { a = JSON.parse(read(AL)); }
        catch (e) { errors.push(`assetlinks.json ليس JSON سليماً: ${e.message}`); }
        if (a) {
            const e0 = Array.isArray(a) ? a[0] : null;
            if (!e0 || a.length !== 1) {
                errors.push('assetlinks.json يجب أن يكون مصفوفةً بعنصرٍ واحد.');
            } else {
                if (e0.target?.namespace !== 'android_app') errors.push('target.namespace ليس `android_app`.');
                if (e0.target?.package_name !== APP_ID) {
                    errors.push(`target.package_name «${e0.target?.package_name}» لا يطابق ${APP_ID}`);
                }
                const fp = e0.target?.sha256_cert_fingerprints?.[0];
                if (typeof fp !== 'string' || !/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fp)) {
                    errors.push(`بصمةُ SHA-256 بصيغةٍ خاطئة: ${String(fp).slice(0, 24)}…`);
                } else if (/^(00:)+00$/.test(fp) || /^(AA:)+AA$/.test(fp)) {
                    errors.push('بصمةُ SHA-256 قيمةٌ وهميّة — ملفٌّ يُنشر بقيمةٍ وهميّةٍ أسوأُ من غيابه.');
                }
            }
        }
    }
}

// ── ③ ولا أمرَ تحقّقٍ مطبوعٍ لا يستطيع الفشل ────────────────────────────────
// 🪤 الطابعُ يُخبر ناصرَ بأمرٍ ينسخه، فأمرٌ يُخرِج صفراً على ٤٠٤ يُطَمئِنه كذباً.
for (const f of ['scripts/set-assetlinks.js', 'scripts/set-apple-appsite.js']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const body = read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/[^\n]*/gm, '');
    for (const m of body.match(/curl [^'"`\n]*/g) || []) {
        if (!/(^|\s)-[a-zA-Z]*f/.test(m)) {
            errors.push(
                `${f} — أمرُ تحقّقٍ بلا \`-f\`: «${m.trim().slice(0, 60)}»\n`
                + '     بلا `-f` يَخرج curl بصفرٍ على ٤٠٤ وعلى جسم HTML — فيُطمئن كذباً.'
            );
        }
    }
}

if (errors.length) {
    console.error('\n❌ البناء متوقّف: ملفّا الربط (App Links / Universal Links)');
    for (const e of errors) console.error('   • ' + e);
    console.error('');
    process.exit(1);
}
console.log(
    '✅ ملفّا الربط: التوجيهُ يستثني `.well-known` · الترويسةُ قائمة'
    + (notes.length ? ` · ${notes.join(' · ')}` : '')
);
