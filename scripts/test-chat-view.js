#!/usr/bin/env node
/**
 * test-chat-view.js — محادثةٌ بلا حدّ يجب ألّا تكسر تيليجرام (v14.93b)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيب الذي يحرسه هذا الاختبار **أحدثَه رفعُ القيد نفسه**: سقفُ رسالة
 *    تيليجرام ٤٠٩٦ حرفاً، وتجاوزُه يردّ خطأً فتُفرَغ الشاشة تماماً — بلا نصّ
 *    ولا تنبيه ولا سطرٍ في أي سجلّ يصرخ. وبالحدّ القديم (٣+٣) كان المجموع
 *    ≈٣٢٠٠ حرفاً فيمرّ بالكاد؛ وبرفع القيد صار التجاوز حتمياً عند الثامنة.
 *    أي أن الميزة كانت ستكسر المحادثة **عند أكثر من يستعملها**.
 *
 * 🪤 ولا يُقاس هذا بقراءة الكود: يُبنى نصٌّ حقيقيّ بأسوأ مدخلٍ ممكن (رسائل
 *    بطول ٥٠٠ حرفاً وهو الحدّ الذي تفرضه القاعدة) ويُقاس طولُه.
 */

const assert = require('assert');
const CHATV = require('../server/lib/chatView');
const { arCount, arMessages, enMessages } = require('../shared/arPlural');

let pass = 0;
const ok = (label, cond) => { assert.ok(cond, `❌ ${label}`); pass++; };

// ── أدوات تُحاكي البوت ────────────────────────────────────────────────────
const tr = (k, ...a) => `[${k}${a.length ? ':' + a.join(',') : ''}]`;
const md = (x) => String(x);
const fmtTime = () => '12:34 م';
const statusLabel = () => 'مؤكد';
const DIV = '━━━━━━━━━━';
const KEYS = {
    title: 'title', with: 'with', empty: 'empty', you: 'you',
    yourMessages: 'ym', finished: 'fin', capReached: 'cap', older: 'older',
};

const mkMsgs = (n, len) => Array.from({ length: n }, (_, i) => ({
    mine: i % 2 === 0, body: 'ب'.repeat(len), at: Date.now(), attachment: null,
}));

const mkR = (msgs, extra = {}) => ({
    barcode: 'TK000123', deal_name: 'حذاء رياضي', other_name: 'ركن الأزياء',
    status: 'pending', my_count: msgs.length, other_count: 0, messages: msgs, ...extra,
});

// ── ١) الحالة التي كانت تكسر: رسائل كثيرة بأقصى طول ───────────────────────
for (const n of [1, 3, 8, 12, 20, 50, 200]) {
    const body = CHATV.tgBody(mkR(mkMsgs(n, 500)), 0, { tr, md, fmtTime, statusLabel, div: DIV, keys: KEYS });
    ok(`طول الرسالة عند ${n} رسالةً = ${body.length} ≤ 4096`, body.length <= 4096);
    ok(`عند ${n}: الذيل موجود (العدّاد لم يُقصّ)`, body.includes('[ym'));
    ok(`عند ${n}: الترويسة موجودة`, body.includes('[title'));
}

// ── ٢) القصّ يُعلن عن نفسه ولا يصمت ───────────────────────────────────────
const many = CHATV.tgBody(mkR(mkMsgs(30, 120)), 0, { tr, md, fmtTime, statusLabel, div: DIV, keys: KEYS });
ok('الرسائل المخفيّة مُعلَنة', many.includes('[older:'));
const few = CHATV.tgBody(mkR(mkMsgs(3, 60)), 0, { tr, md, fmtTime, statusLabel, div: DIV, keys: KEYS });
ok('بلا قصّ لا يُعلَن شيء', !few.includes('[older:'));

// ── ٣) الحدّ صفرٌ = بلا حدّ، ولا يُعرض كسرٌ مقامه صفر ─────────────────────
ok('بلا حدّ: العدّاد عددٌ مجرّد', CHATV.countLabel(7, 0) === '7');
ok('بحدّ: العدّاد كسر', CHATV.countLabel(7, 8) === '7/8');
ok('بلا حدّ: الإرسال مسموح مهما بلغ العدد', CHATV.canSend('pending', 999, 0) === true);
ok('بحدّ: يُمنع عند بلوغه', CHATV.canSend('pending', 8, 8) === false);
ok('بحدّ: مسموح قبله', CHATV.canSend('pending', 7, 8) === true);
for (const st of ['cancelled', 'completed', 'expired']) {
    ok(`حجز ${st}: للقراءة فقط`, CHATV.canSend(st, 0, 0) === false);
}

// ── ٤) مفردات الأخطاء تطابق ما تُرجعه القاعدة فعلاً ───────────────────────
// 🪤 هذه هي التي انحرفت صامتةً منذ v12.22 في البوتين معاً.
const K = { cap: 'K_cap', finished: 'K_fin', badBody: 'K_bad', failed: 'K_fail' };
ok('limit_reached ⇐ رسالة الحدّ', CHATV.errorKey('limit_reached', 3, 'ar', K)[0] === 'K_cap');
ok('limit_reached يمرّر العبارة مصوغة', CHATV.errorKey('limit_reached', 3, 'ar', K)[1][0] === '3 رسائل');
ok('limit_reached بالإنجليزية', CHATV.errorKey('limit_reached', 1, 'en', K)[1][0] === 'one message');
ok('chat_closed ⇐ رسالة الانتهاء', CHATV.errorKey('chat_closed', 0, 'ar', K)[0] === 'K_fin');
ok('bad_body ⇐ رسالة الطول', CHATV.errorKey('bad_body', 0, 'ar', K)[0] === 'K_bad');
ok('رمزٌ مجهول ⇐ العامّ', CHATV.errorKey('whatever', 0, 'ar', K)[0] === 'K_fail');
// والرموز القديمة التي كان البوتان يفحصانها يجب أن تسقط إلى العامّ —
// فلو عاد أحدٌ يكتبها ظنّاً أنها صحيحة، يُكشف هنا.
for (const stale of ['cap_reached', 'cancelled', 'completed', 'expired', 'bad_length']) {
    ok(`الرمز الميت «${stale}» ليس له فرعٌ خاصّ`, CHATV.errorKey(stale, 0, 'ar', K)[0] === 'K_fail');
}

// ── ٥) الجمع العربي في حدوده ──────────────────────────────────────────────
ok('١ رسالة', arMessages(1) === 'رسالة واحدة');
ok('٢ رسالتان', arMessages(2) === 'رسالتان');
ok('٣ رسائل', arMessages(3) === '3 رسائل');
ok('١١ رسالة', arMessages(11) === '11 رسالة');
ok('ساعة مجرورة', arCount(2, 'hours', true) === 'ساعتين');
ok('٢٤ ساعة لا ساعات', arCount(24, 'hours') === '24 ساعة');
ok('ربع ساعة مفردة', arCount(0.25, 'hours') === '0.25 ساعة');
ok('one message', enMessages(1) === 'one message');

console.log(`✅ محادثةٌ بلا حدّ: ${pass} تأكيداً — أطولُ رسالةٍ ممكنة تحت سقف تيليجرام`);
