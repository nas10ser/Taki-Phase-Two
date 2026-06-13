/**
 * lib/format.js — تنسيق النصوص والأرقام والتواريخ (MarkdownV2-safe).
 * أدوات نقيّة بلا حالة، يستعملها البوت وكل التدفّقات. مستخرَجة من bot.js v11.72.
 */

// إزالة وسوم HTML + قصّ الطول (حماية من الإدخال الضار).
const sanitize = (s, max = 400) => (!s || typeof s !== 'string') ? '' : s.replace(/<[^>]*>/gm, '').trim().slice(0, max);

// تطبيع الأرقام العربية/الفارسية إلى لاتينية (المستخدم قد يكتب ٢٥٠).
const normalizeDigits = s => String(s == null ? '' : s)
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));

const isPrice = p => /^\d+(\.\d{1,2})?$/.test(normalizeDigits(p).trim()) && +normalizeDigits(p) > 0;
const isQty   = q => /^\d+$/.test(normalizeDigits(q).trim()) && +normalizeDigits(q) >= 0;

// MarkdownV2 escape — إلزامي لكل نص يُرسل بـ parse_mode:'MarkdownV2'.
const md = t => t == null ? '' : String(t).replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
const numEsc = v => md(String(v)); // رقم آمن للـ MarkdownV2 (يهرب النقطة)

const fmtDate = d => { try { return new Date(d).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return String(d); } };
const fmtDay  = d => { try { return new Date(d).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' }); } catch { return String(d); } };
const fmtTime = d => { try { return new Date(d).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };
const money   = v => md(Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));

// prep_time مخزَّن متوافقاً مع الويب: 'arrival' أو 'NNmin'.
const prepLabel = pt => { if (!pt || pt === 'arrival' || pt === '0min' || pt === '0') return 'عند الوصول'; const n = String(pt).replace('min', '').trim(); return /^\d+$/.test(n) ? `${n} دقيقة` : String(pt); };

const STATUS = { pending: '⏳ قيد الانتظار', acknowledged: '✅ مؤكد', completed: '🏁 مكتمل', cancelled: '❌ ملغي', active: '🟢 نشط', paused: '⏸ موقوف', draft: '📝 مسودة', expired: '🔴 منتهي' };
const statusLabel = s => STATUS[s] || md(s);
const DIV = '━━━━━━━━━━━━━━━━━━';

// كتلة السعر الواضحة (قبل/بعد/التوفير) — تُرجع نصاً MarkdownV2.
function priceBlock(orig, disc, pct) {
    const save = Math.max(0, Number(orig) - Number(disc));
    const p = pct || (orig > 0 ? Math.round((save / orig) * 100) : 0);
    return `💵 السعر قبل: *${money(orig)}* ر\\.س\n` +
           `🟢 بعد الخصم: *${money(disc)}* ر\\.س\n` +
           `🔻 توفيرك: *${money(save)}* ر\\.س \\(${p}%\\)`;
}

// تحليل تاريخ مكتوب بمرونة → { iso:'YYYY-MM-DD', ms } أو null.
// يقبل: 2026-07-15 · 15/7/2026 · 15-7-2026 · 2026/7/15 (بعد تطبيع الأرقام).
function parseFlexibleDate(text) {
    const t = normalizeDigits(text).trim().replace(/\s+/g, '');
    let y, mo, d;
    let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);          // YYYY-MM-DD
    if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else {
        m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);          // DD-MM-YYYY
        if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; } else return null;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0)); // ظهراً UTC لتفادي انزياح المنطقة
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return { iso, ms: dt.getTime() };
}

module.exports = {
    sanitize, normalizeDigits, isPrice, isQty, md, numEsc,
    fmtDate, fmtDay, fmtTime, money, prepLabel,
    STATUS, statusLabel, DIV, priceBlock, parseFlexibleDate,
};
