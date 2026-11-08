/**
 * waWebhook.js — نقلُ خطّاف واتساب كلُّه (استُخرج من `bot.js` في v15.79)
 * ═══════════════════════════════════════════════════════════════════════════
 * منطقُ القناة كلُّه في `flows/whatsapp.js`؛ وهذا الملفُّ النقلُ وحده:
 * تحقّقُ الخطّاف (GET) + توقيعُ HMAC فوق البايتات الخام (POST) + نافذةُ
 * التكرار + حدُّ المعدّل، ثم تفويضُ كلّ رسالةٍ إلى `WA.handleMessage`.
 * v11.91: مشترٍ+تاجر بالتطابق مع تيليجرام، خامل حتى تُضبط `WHATSAPP_*`.
 *
 * 🪤 ولماذا استُخرج الآن: السقّافة (`check-file-size.js`) تمنع `bot.js` من
 *    النموّ سطراً واحداً، وإصلاحاتُ v15.79 أضافت ثلاثةَ عشر. والقاعدةُ في
 *    CLAUDE.md حرفيّة: «قلّص، لا ترفع السقف» — وهذه الكتلةُ أصلاً **نقلٌ لا
 *    منطق**، فموضعُها الصحيح ملفُّها. (نفسُ ما فعله عاملُ البريد في v15.20.)
 *
 * ✅ وما كان صحيحاً هنا **ولا يُلمس**: `express.raw` مركَّبٌ على هذا المسار
 *    **قبل** `express.json`، فالـHMAC يُحسب فوق البايتات الحقيقية لا فوق
 *    إعادةِ ترميز؛ والمقارنةُ `timingSafeEqual` داخل `try/catch` فاختلافُ
 *    الطول يردّ ٤٠٣ ولا يرمي؛ والتحقّقُ **قبل** `JSON.parse`. هذا هو
 *    الترتيبُ الصحيح، وأيُّ إعادةِ بناءٍ للجسم تُفسده.
 */

const crypto = require('crypto');

/** يُركّب مسارَي GET/POST على تطبيق express. */
function mount(app, { verifyToken, appSecret, WA, GUARD }) {
    app.get('/webhook/whatsapp', (req, res) => {
        if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === verifyToken && verifyToken) return res.status(200).send(req.query['hub.challenge']);
        res.status(403).send('Forbidden');
    });
    app.post('/webhook/whatsapp', async (req, res) => {
        if (!appSecret) return res.status(503).json({ error: 'not configured' });
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));
        const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(raw).digest('hex');
        try { if (!crypto.timingSafeEqual(Buffer.from(req.headers['x-hub-signature-256'] || ''), Buffer.from(expected))) return res.status(403).json({ error: 'Invalid signature' }); }
        catch { return res.status(403).json({ error: 'Invalid signature' }); }
        let body; try { body = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'Bad JSON' }); }
        res.status(200).send('OK');
        try {
            for (const entry of body?.entry || []) for (const change of entry.changes || []) {
                // فشل التسليم يصل كتقرير status ولا يُرى في أي مكان آخر — نسجّله وإلا ضاع السبب (v12.23)
                // 🔴 v15.79 — وكان يُطبع `st.recipient_id`: رقمُ جوّالِ مشترٍ سعوديّ
                //    كاملاً بصيغة E.164 في سجلّ Render — خارجَ جدة، وخارجَ RLS،
                //    وخارجَ تجهيلِ الثلاثين يوماً. والفشلُ مسارٌ عاديّ (رقمٌ ليس
                //    على واتساب · نافذةُ ٢٤ ساعةً مغلقة · قالبٌ مرفوض) ⇒ السجلُّ
                //    يصير قائمةَ جوّالاتِ العملاء. ومعرّفُ ميتا يكفي للربط:
                //    صفُّ القاعدة المفتاحُه هو يحمل المستلمَ، وهناك تسري RLS.
                for (const st of change.value?.statuses || []) if (st.status === 'failed') console.error('WA delivery FAILED → id=%s codes=%s', st.id, (st.errors || []).map(e => e.code).join(','));
                for (const msg of change.value?.messages || []) {
                    // 🪤 نافذةُ تكرارٍ بمعرّف الرسالة: الردُّ ٢٠٠ يُرسل **قبل**
                    //    المعالجة، فضياعُه في الطريق يُعيد ميتا التسليمَ ويُنفَّذ
                    //    الأمرُ مرّتين — و«أكّد» أو «اطلب استرداداً» مكرَّرةً ليست
                    //    بلا أثر. وتوقيعُ ميتا بلا طابعٍ زمنيّ، فلا نافذةَ فيه.
                    const from = msg.from;
                    if (!from || (msg.id && !GUARD.fresh(`wa:${msg.id}`)) || !GUARD.allow(`wa:${from}`, 30, 60_000)) continue;
                    await WA.handleMessage(from, msg);
                }
            }
        } catch (e) { console.error('WA processing:', e.message); }
    });
}

module.exports = { mount };
