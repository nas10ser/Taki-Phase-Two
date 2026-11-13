#!/usr/bin/env node
/**
 * حارسُ نافذة المحادثة بعد الإغلاق (v16.18) — node scripts/check-chat-window.js
 *
 * ── العيبُ الذي يحرسه، وهو **بلاغُ ناصر نفسُه** ─────────────────────────
 * «في قسم الأسئلة، عندما يريد المشتري يتواصل مع التاجر للاسترداد كتبتَ أن
 *  الطريقة عبر الشات — علماً أن الشات يغلق بعد الاستلام. فكيف يتواصل معه؟»
 * أي **وعدٌ في نصٍّ ظاهرٍ لا ينفّذه الكود**. وهذا الحارسُ يربط الطرفين:
 *   ① لا نصَّ يَعِد بالمحادثة بعد الإغلاق إلّا ومعه المدّةُ من مصدرها الحيّ.
 *   ② ولا رقمَ ساعاتٍ مكتوبٌ بيدٍ في أيّ نصٍّ ظاهر.
 *   ③ والقاعدةُ موضعٌ واحد: الدالّةُ والمشغّلُ يناديان `taki_chat_window_open`.
 *   ④ ومرآةُ الواجهة تطابق جدولَ حقيقة القاعدة — **مقيساً بالتنفيذ**.
 *   ⑤ والتاجرُ يرى المحادثةَ في **السجلّ** أيضاً، وإلّا كتب المشتري ولا قارئ.
 *
 * 🪤 ويُجرَّد التعليقُ قبل أيّ فحصِ نصّ — هذا الملفُّ يذكر كلَّ ما يبحث عنه.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const R = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/^[ \t]*\/\/[^\n]*$/gm, '')
    .replace(/^\s*--[^\n]*$/gm, '');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
    console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
    if (!ok && detail) console.log(`      ${detail}`);
    ok ? pass++ : fail++;
};

console.log('\nنافذةُ المحادثة بعد إغلاق الطلب');

// ① + ② النصُّ الظاهر
const faq = strip(R('src/pages/legal/FAQ.tsx'));
const promises = [...faq.matchAll(/[^.]*محادثة الطلب[^.]*\./g)].map((m) => m[0]);
check('الأسئلةُ تَعِد بمحادثة الطلب', promises.length >= 2, `وجدتُ ${promises.length}`);
check('وكلُّ وعدٍ معه المدّةُ من مصدرها الحيّ',
    promises.length > 0 && promises.every((t) => /<ChatWindowHours \/>/.test(t)),
    promises.filter((t) => !/<ChatWindowHours \/>/.test(t)).map((t) => t.trim().slice(0, 70)).join(' | '));
check('ولا نصَّ يقول «شات الحجز» بعد أن تغيّر السلوك', !/شات الحجز/.test(faq));
// رقمُ ساعاتٍ مكتوبٌ بيدٍ بجوار كلمة محادثة
const handWritten = /محادث[^.]{0,80}?\b\d{1,4}\s*(ساعة|ساعات|يوم|أيام)/.test(faq);
check('ولا رقمَ ساعاتٍ مكتوبٌ بيدٍ في نصّ المحادثة', !handWritten);

// ③ القاعدةُ موضعٌ واحد
const sql = strip(R('supabase/JEDDAH_v16_18_chat_after_close.sql'));
check('الهجرةُ ترقّع الموضعين معاً',
    /ARRAY\['send_booking_message',\s*'tr_guard_message_block'\]/.test(sql)
    && /v_hit <> 2/.test(sql),
    'القاعدةُ مكتوبةٌ في الدالّة وفي مشغّلٍ على الجدول — وترقيعُ أحدهما يُنتج إصلاحاً لا يعمل');
check('وتُثبت سلوكياً لا نصّياً', /send_booking_message\(v_bar/.test(sql)
    && /TAKI_PROBE_ROLLBACK/.test(sql));

// ④ مرآةُ الواجهة — مُقاسةٌ بالتنفيذ
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'taki-chatwin-'));
try {
    execFileSync('npx', ['tsc', path.join(root, 'src/utils/chatWindow.ts'),
        '--outDir', out, '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck'],
        { cwd: root, stdio: 'pipe' });
    const { isChatOpen } = require(path.join(out, 'chatWindow.js'));
    const H = 72, now = Date.UTC(2026, 10, 13, 12, 0, 0);
    const hr = 3600_000;
    const cases = [
        ['طلبٌ قائم ⇒ مفتوح', { status: 'pending', expiryTime: now - 400 * hr }, true],
        ['طلبٌ مؤكَّد ⇒ مفتوح', { status: 'acknowledged' }, true],
        ['أُغلق قبل ساعة ⇒ مفتوح', { status: 'completed', completedAt: now - 1 * hr }, true],
        ['أُغلق قبل ٤٠٠ ساعة ⇒ مقفل', { status: 'completed', completedAt: now - 400 * hr }, false],
        ['ملغيٌّ بلا لحظةِ إغلاق ⇒ مقفل', { status: 'cancelled' }, false],
        ['منتهٍ يُقاس بـexpiry ⇒ مفتوح', { status: 'expired', expiryTime: now - 2 * hr }, true],
    ];
    for (const [name, b, want] of cases) {
        check(`المرآة: ${name}`, isChatOpen(b, H, now) === want,
            `النتيجة ${isChatOpen(b, H, now)} والمتوقَّع ${want}`);
    }
    check('المرآة: صفرُ ساعاتٍ ⇒ تُقفل لحظةَ الإغلاق',
        isChatOpen({ status: 'completed', completedAt: now }, 0, now) === false);
    fs.rmSync(out, { recursive: true, force: true });
} catch (e) {
    check('ترجمةُ مرآة الواجهة وتشغيلُها', false, String(e.stdout || e.message).slice(0, 300));
}

// ⑤ التاجرُ يرى المحادثةَ في السجلّ
const sd = strip(R('src/pages/SellerDashboard.tsx'));
const pastIdx = sd.indexOf('[...pastOrders]');
const activeIdx = sd.indexOf('activeOrders.map');
check('محادثةُ الطلب تظهر في سجلّ التاجر أيضاً',
    pastIdx > 0 && activeIdx > pastIdx
    && /<OrderChatPanel[\s\S]{0,160}hideWhenClosed/.test(sd.slice(pastIdx, activeIdx)),
    'بلا هذا يكتب المشتري بعد الإغلاق ولا يرى التاجرُ رسالتَه أبداً');
// واللوحةُ النشطةُ تستعمل نفسَ المكوّن — فلا بوّابتان تنحرفان
check('وقائمةُ «نشطة» تستعمل نفسَ المكوّن',
    /<OrderChatPanel[^>]*myRole="seller"[^>]*\/>/.test(sd.slice(activeIdx)));
const panel = strip(R('src/components/OrderChatPanel.tsx'));
check('والبوّابةُ داخله تقرأ الإعدادَ الحيّ',
    /isChatOpen\(order,\s*platformSettings\.chatAfterCloseHours\)/.test(panel));

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ناجح · ${fail} فاشل\n`);
process.exit(fail === 0 ? 0 : 1);
