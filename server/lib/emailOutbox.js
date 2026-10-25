/**
 * emailOutbox.js — عاملُ طابور البريد (استُخرج من bot.js في v15.20)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 ولماذا استُخرج الآن: السقّافة (`check-file-size.js`) تمنع `bot.js` من
 *    النموّ سطراً واحداً — وهو عند سقفه بالضبط. وكان عاملُ المخزون قد
 *    **أُلحق بسطر مؤقّت البريد نفسه** لأجل ذلك («محايدُ الأسطر»)، فوقع
 *    مُعشَّشاً داخل `if (mailer)` ⇒ متجرٌ بلا بريدٍ مضبوط لا يُسلَّم له أيُّ
 *    حدثِ مخزونٍ أبداً.
 *    ⇒ فالحلُّ الصحيح هو **تقليصٌ حقيقيّ لا سطرٌ مزدوج**: يخرج عاملُ البريد
 *      إلى ملفّه، فيتّسع المكانُ لجدولة عامل المخزون في موضعها الصحيح.
 *      (وهذا هو ما تقوله قاعدةُ المشروع حرفياً: «قلّص، لا ترفع السقف».)
 */

const POLL_MS = 45_000;
const BATCH = 10;

/** يسحب دفعةً من الطابور ويُرسلها. لا يرمي أبداً — يعمل داخل مؤقّت. */
async function drainEmails(rpc, mailer, mailerFrom) {
    let sent = 0, failed = 0;
    try {
        const batch = await rpc('bot_pull_email_outbox', { p_limit: BATCH });
        if (Array.isArray(batch)) for (const m of batch) {
            try {
                await mailer.sendMail({
                    from: `TAKI تاكي <${mailerFrom}>`,
                    to: m.to_email, subject: m.subject, html: m.html,
                });
                await rpc('bot_mark_email', { p_id: m.id, p_ok: true });
                sent++;
            } catch (e) {
                console.error('email send:', m.to_email, e.message);
                await rpc('bot_mark_email', {
                    p_id: m.id, p_ok: false,
                    p_error: String(e.message || e).slice(0, 300),
                });
                failed++;
            }
        }
    } catch (e) { console.warn('email poll:', e.message); }
    return { sent, failed };
}

/** يُشغّل المؤقّت مرّةً واحدة ولا يسمح بتداخل الدفقات. */
function startEmailWorker(rpc, mailer, mailerFrom) {
    let busy = false;
    const tick = async () => {
        if (busy) return;                      // never overlap polls
        busy = true;
        try { await drainEmails(rpc, mailer, mailerFrom); } finally { busy = false; }
    };
    setInterval(tick, POLL_MS).unref?.();
    tick();
}

module.exports = { startEmailWorker, drainEmails, POLL_MS, BATCH };
