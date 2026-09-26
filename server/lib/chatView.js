/**
 * lib/chatView.js — منطقُ عرض محادثة الحجز، مشتركاً بين البوتين (v14.93)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 لماذا وُجد: كان هذا المنطق منسوخاً في `bot.js` و`flows/whatsapp.js`،
 *    وانحرفت النسختان معاً عن القاعدة انحرافاً صامتاً دام من v12.22:
 *    كلتاهما تفحص رموز أخطاءٍ **لا تُرجعها `bot_send_booking_message` أبداً**
 *    (`cap_reached` · `cancelled` · `completed` · `expired` · `bad_length`)
 *    بينما القاعدة تقول (`limit_reached` · `chat_closed` · `bad_body`).
 *    والنتيجة: كل خطأ محادثةٍ في البوتين كان يسقط إلى «تعذّر الإرسال» العامّ —
 *    فمن بلغ الحدّ لم يُخبَر أنه بلغه، ومن كتب ٦٠٠ حرف لم يعرف لماذا رُفض.
 *
 * فالعلاج ليس تصحيح النسختين بل إلغاء الثانية: مفرداتُ الأخطاء هنا وحدها،
 * **منسوخةً من نصّ الدالة لا من الذاكرة**.
 *
 * 🪤 وأي رمزٍ جديد يُضاف في القاعدة يُضاف هنا — ولا يُكتب في البوتين.
 */

const { countMessages } = require('../../shared/arPlural');

/** الحالات التي تُغلق المحادثة — يطابق حارس `bot_send_booking_message`. */
const FINISHED = ['cancelled', 'completed', 'expired'];

const isFinished = (status) => FINISHED.includes(status);

/** `cap = 0` تعني بلا حدّ (v14.93). */
const canSend = (status, myCount, cap) =>
    !isFinished(status) && (!cap || Number(myCount) < Number(cap));

/**
 * رمزُ الخطأ ⇐ مفتاحُ ترجمةٍ ووسائطه.
 * تُمرَّر أسماء المفاتيح لأن البوتين يختلفان في نصوصهما (MarkdownV2 مقابل نصّ).
 */
function errorKey(err, cap, lang, keys) {
    switch (err) {
        case 'limit_reached': return [keys.cap, [countMessages(Number(cap) || 0, lang)]];
        case 'chat_closed':   return [keys.finished, []];
        case 'bad_body':      return [keys.badBody, []];
        default:              return [keys.failed, []];
    }
}

/** سطر العدّاد: كسرٌ حين يوجد حدّ، وعددٌ مجرّد حين لا حدّ. */
const countLabel = (myCount, cap) => (cap > 0 ? `${myCount}/${cap}` : `${myCount}`);

/**
 * ترويسة المحادثة في واتساب: سلسلتان لا واحدة، كي لا يُعرض «٣/0» حين لا حدّ.
 * تُرجع `[مفتاح, وسائط]` جاهزةً لـ`tr(...)`.
 */
const headArgs = (r, cap, keys) => (cap > 0
    ? [keys.head, [r.barcode, r.deal_name, r.other_name, r.my_count, r.other_count, cap]]
    : [keys.headNoCap, [r.barcode, r.deal_name, r.other_name, r.my_count, r.other_count]]);

/** تأكيد الإرسال: يذكر الكسر حين يوجد حدّ فقط. */
const sentArgs = (r, keys) => {
    const cap = Number(r.cap) || 0;
    return cap > 0 ? [keys.sent, [r.my_count, cap]] : [keys.sentNoCap, [r.my_count]];
};

/** دعوةُ الكتابة: تذكر الحدّ مصوغاً حين يوجد، وتصمت عنه حين لا حدّ. */
const promptArgs = (cap, lang, keys) => (cap > 0
    ? [keys.prompt, [countMessages(Number(cap), lang)]]
    : [keys.promptNoCap, []]);

/**
 * نصّ بطاقة المحادثة في واتساب كاملاً: الترويسة + آخر ثماني رسائل + وسمُ
 * الانتهاء. كان مؤلَّفاً داخل `flows/whatsapp.js`، ولا شيء فيه يخصّ واتساب
 * إلا أسماءُ مفاتيحه — فصار هنا، و`tr` تُمرَّر كي لا تعرف هذه الوحدة اللغة.
 */
function waBody(r, cap, bc, tr, keys) {
    const [hk, ha] = headArgs({ ...r, barcode: bc }, cap, keys);
    let body = tr(hk, ...ha);
    const msgs = Array.isArray(r.messages) ? r.messages : [];
    body += msgs.length
        ? '\n\n' + msgs.slice(-8).map(m => tr(m.mine ? keys.me : keys.them, m.body)).join('\n')
        : tr(keys.empty);
    if (isFinished(r.status)) body += '\n\n' + tr(keys.finished);
    return body;
}

/**
 * نصّ بطاقة المحادثة في تيليجرام. `md` و`fmtTime` تُمرَّران لأن التهريب
 * وتنسيق الوقت خاصّان بذلك البوت، أمّا التركيب فواحد.
 */
/**
 * 🔴 سقفُ رسالة تيليجرام **٤٠٩٦ حرفاً**، وتجاوزُه يردّ خطأً فتُفرَغ الشاشة
 *    تماماً بلا أي نصّ — لا رسالة ولا تنبيه. وكان هذا مستحيلاً بالحدّ القديم
 *    (٣+٣ رسائل ≈ ٣٢٠٠ حرفاً بالكاد)، فلمّا رُفع القيد في v14.93 صار **حتمياً**
 *    عند الرسالة الثامنة تقريباً. أي أن رفع القيد كان سيكسر المحادثة في
 *    تيليجرام بالضبط عند من يستعملها أكثر.
 *    حارسان لا واحد: قصُّ القائمة إلى آخر `PAGE`، ثمّ **سقفُ طولٍ صريح**
 *    لأن رسالةً واحدة قد تبلغ ٥٠٠ حرفٍ وحدها والترويسة والذيل فوقها.
 */
const TG_LIMIT = 3900;          // دون ٤٠٩٦ بهامشٍ للذيل والتهريب
const TG_PAGE  = 12;            // آخر ١٢ رسالة تكفي لسياقٍ مفهوم

function tgBody(r, cap, { tr, md, fmtTime, statusLabel, div, keys }) {
    const head = `💬 *${tr(keys.title)}* \`${md(r.barcode)}\`\n🛍 ${md(r.deal_name)} • ${statusLabel(r.status)}\n👤 ${tr(keys.with)}: *${md(r.other_name)}*\n${div}\n\n`;
    const all = r.messages || [];
    const shown = all.slice(-TG_PAGE);
    let tail = `${div}\n✍️ ${tr(keys.yourMessages)}: *${countLabel(r.my_count, cap)}*`;
    if (!canSend(r.status, r.my_count, cap)) {
        tail += `\n${tr(isFinished(r.status) ? keys.finished : keys.capReached)}`;
    }

    let mid = '';
    if (!all.length) mid = tr(keys.empty) + '\n';
    else {
        if (all.length > shown.length) mid += `_${tr(keys.older, all.length - shown.length)}_\n\n`;
        for (const x of shown) {
            const who = x.mine ? tr(keys.you) : `👤 ${md(r.other_name)}`;
            mid += `${who} _\\(${md(fmtTime(x.at))}\\)_\n${md(x.body)}\n\n`;
        }
    }

    // حارسٌ ثانٍ: لو طالت الرسائل المعروضة نفسها، تُسقَط الأقدم منها حتى نتّسع.
    while (head.length + mid.length + tail.length > TG_LIMIT && mid.includes('\n\n')) {
        const cut = mid.indexOf('\n\n', mid.indexOf('\n\n') + 2);
        if (cut < 0) break;
        mid = mid.slice(cut + 2);
    }
    // وثالثٌ أخير: قصٌّ خامّ لا يترك الرسالة تتجاوز السقف بحالٍ.
    if (head.length + mid.length + tail.length > TG_LIMIT) {
        mid = mid.slice(0, Math.max(0, TG_LIMIT - head.length - tail.length - 4)) + '…\n\n';
    }
    return head + mid + tail;
}

/**
 * إرسالُ مرفقات المحادثة بعد البطاقة — كان منسوخاً في البوتين.
 * 🪤 ولماذا بعدها لا داخلها: لا تيليجرام ولا واتساب يعرض صورةً داخل رسالة
 *    نصّية/أزرار، ورابطُ المستودع الخاصّ لا يُفتح بلا توقيع. والتوقيع عمره
 *    ١٥ دقيقة، لكن الطرفين يُنزّلان الصورة إلى خوادمهما فورَ الإرسال — فبقاؤها
 *    معروضةً لا يعتمد على بقاء الرابط.
 * و`limit` يمنع إغراق محادثةٍ طويلة عند كل فتح.
 */
async function sendAttachments(msgs, r, { sign, send, caption, limit = 0 }) {
    const withAtt = (msgs || []).filter(m => m.attachment);
    const list = limit > 0 ? withAtt.slice(-limit) : withAtt;
    for (const m of list) {
        let sig;
        try { sig = await sign(m.attachment); } catch { sig = null; }
        if (!sig || !sig.url) continue;
        // فشلُ صورةٍ واحدة لا يُسقط البقيّة ولا البطاقة.
        try { await send(sig.url, caption(m)); }
        catch (e) { console.warn('chat photo:', e.message); }
    }
}

module.exports = { TG_LIMIT, TG_PAGE, FINISHED, isFinished, canSend, errorKey, countLabel, headArgs, sentArgs, promptArgs, waBody, tgBody, sendAttachments };
