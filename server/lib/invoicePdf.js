'use strict';
/**
 * invoicePdf.js — فاتورة الحجز PDF للبوتين (v14.06 — طلب ناصر)
 *
 * لماذا PDF لا نصّاً؟ الفاتورة النصية في المحادثة لا تحمل باركوداً، فلا يستطيع
 * التاجر مسح رقم الطلب ولا رموز الكاشير (SKU) عند التسليم — وهو بيت القصيد.
 *
 * هذا الملف **نسخة من مستند الموقع** `src/utils/printInvoice.ts` لا تصميم جديد:
 *  • عرض الصفحة ٣٨٤pt = `.invoice{max-width:384px}` وهامش ١٨ = `body{padding:18px}`،
 *    فكل مقاس خطّ في القالب (px) يُنقل هنا رقماً واحداً (pt) بلا تحويل.
 *  • نفس الألوان (paid/cod/void/delivery) ونفس ترتيب الصفوف ونفس النصوص حرفياً.
 *  • أي تعديل على أحد المستندين يجب أن يُنقل للآخر — القالبان توأمان مقصودان،
 *    ولا يمكن توحيدهما في ملف واحد لأن الموقع يبني HTML والبوت يرسم PDF.
 *
 * الرموز التعبيرية (✅ ❌ 💵) تُرسم **أشكالاً متّجهة** لا محارف: خط Tajawal بلا
 * جدول رموز تعبيرية، وإدراج خط إيموجي كامل (≈٥٠٠ كيلوبايت) لطباعة أحادية اللون
 * لا يستحق — والشكل المتّجه أوضح على الطابعة الحرارية.
 *
 * بلا متصفح ولا خدمة خارجية: pdfkit + خط «Tajawal» (خط الموقع نفسه، رخصة OFL)
 * مضمَّن من server/assets/fonts، والباركود يُرسم مستطيلاتٍ متّجهية فيُمسح بدقة.
 *
 * ── فخّ العربية في pdfkit (قِيس ٣ سبتمبر ٢٠٢٦) ─────────────────────────────
 * pdfkit يقسّم النص على المسافات ليخزّن تشكيل كل كلمة، ثم يرصّ الكلمات بترتيبها
 * المنطقي — وfontkit يعكس حروف كل كلمة وحدها، فيخرج السطر العربي **بترتيب
 * كلمات معكوس** («الطلب رقم» بدل «رقم الطلب»). تمرير `features: []` يلغي هذا
 * التقسيم فيُرصّ السطر كتلةً واحدة صحيحة. ولأن fontkit يعكس أيضاً الأرقام
 * اللاتينية داخل الكتلة العربية، نقسّم السطر إلى مقاطع اتجاهية ونرصّها يدوياً
 * من اليمين لليسار — فيبقى «125.50» لا «05.521». كل نصّ هنا يمرّ من drawLine.
 */

const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const FONT_REGULAR = path.join(FONT_DIR, 'Tajawal-Regular.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'Tajawal-Bold.ttf');

// ── الألوان — مطابقة لـprintInvoice.ts حرفياً ──────────────────────────────
const C = {
    text: '#0f172a', muted: '#64748b', line: '#cbd5e1', lineSoft: '#e2e8f0', addon: '#475569',
    sku: '#334155', noteBg: '#f1f5f9', foot: '#94a3b8', stamp: '#94a3b8',
    paidBg: '#dcfce7', paidFg: '#166534', paidBd: '#16a34a',
    codBg: '#fef3c7', codFg: '#92400e', codBd: '#d97706',
    voidBg: '#fee2e2', voidFg: '#991b1b', voidBd: '#dc2626',
    dlvBg: '#eff6ff', dlvFg: '#1e40af', dlvBd: '#93c5fd',
};

// المقاسات = القالب: .invoice{max-width:384px} داخل body{padding:18px}
const CONTENT_W = 384;
const MARGIN = 18;
const PAGE_W = CONTENT_W + MARGIN * 2;

// أحجام الخطوط = قيم CSS في القالب، px → pt واحداً بواحد
const F = {
    shop: 22, sub: 12, row: 13, item: 15, addon: 13, sku: 11,
    total: 17, pay: 15, paySub: 11, note: 12, stamp: 12, foot: 10,
    dMain: 12, dSub: 11, dGeo: 10, qrCap: 9,
};

// ── Code 128B — نفس جدول src/utils/barcode128.ts ─────────────────────────
const PATTERNS = [
    '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
    '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
    '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
    '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
    '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
    '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
    '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
    '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
    '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
    '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
    '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104, STOP = 106;

/** سلسلة عروض العناصر (قضبان/فراغات بالتناوب، تبدأ بقضيب) أو null. */
function encode128B(text) {
    // نرفض ما ليس فيه محرف مقروء واحد (مسافات فقط) — نفس حارس الموقع حرفاً بحرف:
    // باركود مسافةٍ واحدة يُمسح إلى فراغ فيوهم التاجر أنه يعمل.
    const src = String(text == null ? '' : text).replace(/[^\x20-\x7E]/g, '');
    if (!src.trim()) return null;
    const values = [START_B];
    for (let i = 0; i < src.length; i++) values.push(src.charCodeAt(i) - 32);
    let sum = START_B;
    for (let i = 1; i < values.length; i++) sum += values[i] * i;
    values.push(sum % 103);
    values.push(STOP);
    return values.map(v => PATTERNS[v]).join('');
}
const modulesCount = (m) => [...m].reduce((s, d) => s + parseInt(d, 10), 0);

// ── ZATCA TLV (المرحلة الأولى) — نفس src/utils/invoice.ts ─────────────────
function zatcaTlvBase64(seller, vat, iso, total, vatAmt) {
    const parts = [];
    [seller, vat, iso, total, vatAmt].forEach((v, i) => {
        const bytes = Buffer.from(String(v == null ? '' : v), 'utf8');
        parts.push(Buffer.from([i + 1, Math.min(255, bytes.length)]), bytes.subarray(0, 255));
    });
    return Buffer.concat(parts).toString('base64');
}
/** صيغة الرقم الضريبي السعودي: ١٥ رقماً يبدأ وينتهي بـ«3» — نفس zatcaQr.ts. */
const isValidSaudiVat = (v) => /^3\d{13}3$/.test(String(v == null ? '' : v).trim());

// ── النصّ ثنائي الاتجاه ─────────────────────────────────────────────────────
const RTL_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LTR_RE = /[A-Za-z0-9À-ɏ]/;
// ⚠️ كل محرف لا يملك له الخطُّ رسماً يُطبع **مربعاً فارغاً** (.notdef) — بما في
// ذلك المحارف الخفيّة. وTajawal يفتقد: الرموز التعبيرية، والأسهم (↳)، وعلامات
// التحكّم الخفيّة (RLM/LRM) التي يحقنها Intl داخل التاريخ. تُحذف كلها هنا،
// وما يهمّ منها بصرياً (↳ · ✅ · ❌ · 💵) يُرسم شكلاً متّجهاً بدل محرف.
// قِيس بـfontkit: hasGlyphForCodePoint = false لـ0x21B3 و0x200F و0x2713.
const STRIP_RE = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200B}-\u{200F}\u{061C}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{FEFF}\u{00AD}]/gu;
const clean = (s) => String(s == null ? '' : s).replace(STRIP_RE, '').replace(/\s+/g, ' ').trim();

// الأقواس ذات الانعكاس (Bidi_Mirrored): في السياق العربي يُرسم «(» بشكل «)».
// المتصفح يفعلها تلقائياً؛ رسمُ PDF لا يفعل، فكان القوس يظهر مقلوباً:
// «)مضمّنة(» بدل «(مضمّنة)» — قِيس بمقارنة الصفحة بالـPDF بنفس البيانات.
const MIRROR = { '(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«' };
const mirrorRtl = (t) => t.replace(/[()\[\]{}<>«»]/g, c => MIRROR[c] || c);

/** يقسّم النص إلى مقاطع {dir:'R'|'L', text} — المحايد يتبع جيرانه، وإلا اتجاه الفقرة. */
function bidiRuns(text, paraDir) {
    const chars = [...text];
    const cls = chars.map(c => RTL_RE.test(c) ? 'R' : LTR_RE.test(c) ? 'L' : 'N');
    for (let i = 0; i < cls.length; i++) {
        if (cls[i] !== 'N') continue;
        let j = i;
        while (j < cls.length && cls[j] === 'N') j++;
        const prev = i > 0 ? cls[i - 1] : null;
        const next = j < cls.length ? cls[j] : null;
        const t = (prev && prev === next) ? prev : paraDir;
        for (let k = i; k < j; k++) cls[k] = t;
        i = j - 1;
    }
    const out = [];
    let cur = null;
    chars.forEach((c, i) => {
        if (cur && cur.dir === cls[i]) cur.text += c;
        else { cur = { dir: cls[i], text: c }; out.push(cur); }
    });
    for (const r of out) if (r.dir === 'R') r.text = mirrorRtl(r.text);
    return out;
}

/** مبلغ بهللتين وأرقام لاتينية — نفس fmtSAR في src/utils/vat.ts. */
const fmtSAR = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0).toFixed(2);

/** تقريب مقفول الحساب: الضريبة أولاً ثم الأساس — نفس splitInclusive في vat.ts. */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
function splitInclusive(gross, rate) {
    const r = Number.isFinite(Number(rate)) ? Number(rate) : 15;
    if (!Number.isFinite(gross) || gross <= 0) return { base: 0, vat: 0, total: 0 };
    const vat = round2((gross * r) / (100 + r));
    return { base: round2(gross - vat), vat, total: round2(gross) };
}

/** نفس تنسيق تاريخ القالب: ar-SA ميلادي بأرقام لاتينية، بتوقيت الرياض. */
function fmtDate(ms, rtl) {
    const n = Number(ms);
    const d = new Date(Number.isFinite(n) && n > 0 ? n : String(ms || ''));
    if (isNaN(d.getTime())) return '';
    try {
        return new Intl.DateTimeFormat(rtl ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
            timeZone: 'Asia/Riyadh',
        }).format(d);
    } catch { return d.toISOString().slice(0, 16).replace('T', ' '); }
}

// سقف مواصفة PDF لأبعاد الصفحة: 14400 وحدة (٢٠٠ بوصة). الفاتورة صفحة واحدة
// متّصلة (كورقة الطابعة الحرارية)، فطلبٌ ضخم — مئة خيار وأكثر، وهو ممكن حين
// يحجز المشتري عشرين قطعة لكل منها اختياراتها — يدفع الارتفاع نحو هذا السقف
// فيخرج ملف يرفضه القارئ. الحلّ: نُخطِّط الفاتورة أولاً، وإن تجاوزت الحدّ الآمن
// نُعيد التخطيط بعدد أقل من باركودات الأصناف **مع سطر ظاهر يقول ذلك** —
// الاقتطاع الصامت أسوأ من الاقتطاع، لأن التاجر يظنّ أن ما بين يديه كامل.
const MAX_PAGE_H = 14000;

/**
 * يُخطِّط الفاتورة: يحسب ارتفاعها ويُسجّل عمليات الرسم بإحداثيات مطلقة.
 * @param {object} v ناتج `bot_get_booking_invoice` (ok=true)
 * @param {'ar'|'en'} lang لغة المستخدم في البوت
 * @param {number} maxItemBarcodes أقصى عدد أصناف يُطبع لها باركود (Infinity = بلا حد)
 * @param {number} maxItemLines أقصى عدد أصناف تُطبع أصلاً (Infinity = بلا حد)
 */
async function planInvoice(v, lang, maxItemBarcodes, maxItemLines) {
    if (!v || typeof v !== 'object') throw new Error('invoicePdf: بيانات الفاتورة مفقودة');
    const rtl = lang !== 'en';
    const L = (ar, en) => (rtl ? ar : en);
    const cur = L('ر.س', 'SAR');
    const paraDir = rtl ? 'R' : 'L';

    // ── المرحلة ١: خطّة رسم بارتفاع محسوب (pdfkit يريد مقاس الصفحة مقدَّماً) ──
    const m = new PDFDocument({ size: [PAGE_W, 3000], margin: 0, autoFirstPage: true });
    m.registerFont('R', FONT_REGULAR).registerFont('B', FONT_BOLD);
    const ops = [];
    let y = MARGIN;

    const setFont = (doc, bold, size) => doc.font(bold ? 'B' : 'R').fontSize(size);
    const widthOf = (doc, text, bold, size, spacing) => {
        setFont(doc, bold, size);
        return doc.widthOfString(text, { features: [], characterSpacing: spacing || 0 });
    };

    /** سطر واحد (لا يلتفّ) بمحاذاة داخل [x, x+w]. */
    const drawLine = (doc, str, x, yy, w, o) => {
        const size = o.size || F.row, bold = !!o.bold, spacing = o.spacing || 0;
        setFont(doc, bold, size);
        doc.fillColor(o.color || C.text);
        const runs = bidiRuns(str, paraDir).map(r => ({ ...r, w: widthOf(doc, r.text, bold, size, spacing) }));
        const total = runs.reduce((s, r) => s + r.w, 0);
        const align = o.align || (rtl ? 'right' : 'left');
        let sx = align === 'right' ? x + w - total : align === 'center' ? x + (w - total) / 2 : x;
        const visual = paraDir === 'R' ? [...runs].reverse() : runs;
        for (const r of visual) {
            doc.text(r.text, sx, yy, { lineBreak: false, width: r.w + 4, features: [], characterSpacing: spacing });
            sx += r.w;
        }
    };

    /** يقسّم نصاً إلى أسطر بعرض أقصى (بالكلمات — والكلمة الأطول من السطر تُكسر). */
    const wrap = (doc, str, w, bold, size) => {
        const words = clean(str).split(' ').filter(Boolean);
        const lines = [];
        let line = '';
        for (const word of words) {
            const cand = line ? `${line} ${word}` : word;
            if (widthOf(doc, cand, bold, size) <= w || !line) line = cand;
            else { lines.push(line); line = word; }
        }
        if (line) lines.push(line);
        return lines;
    };

    /** نصّ ملتفّ — يزيد y ويسجّل الرسم. */
    const text = (str, o = {}) => {
        const size = o.size || F.row, bold = !!o.bold, lh = size * (o.lineHeight || 1.45);
        const x = MARGIN + (o.indent || 0), w = CONTENT_W - (o.indent || 0);
        const lines = wrap(m, str, w, bold, size);
        if (!lines.length) return;
        const yy = y;
        ops.push(doc => lines.forEach((ln, i) => drawLine(doc, ln, x, yy + i * lh, w, o)));
        y += lines.length * lh + (o.gap == null ? 2 : o.gap);
    };

    /** صفّ «مفتاح … قيمة» — .row في القالب: المفتاح جهة البداية والقيمة جهة النهاية. */
    const row = (k, val, o = {}) => {
        const size = o.size || F.row;
        const kw = Math.min(CONTENT_W * 0.5, widthOf(m, clean(k), true, size) + 6);
        const vw = CONTENT_W - kw - 8;
        const vLines = wrap(m, val, vw, true, o.valueSize || size);
        const lh = size * 1.45;
        const yy = y;
        ops.push(doc => {
            const kx = rtl ? MARGIN + CONTENT_W - kw : MARGIN;
            const vx = rtl ? MARGIN : MARGIN + kw + 8;
            drawLine(doc, clean(k), kx, yy, kw, { size, bold: true, color: o.keyColor || C.muted, align: rtl ? 'right' : 'left' });
            vLines.forEach((ln, i) => drawLine(doc, ln, vx, yy + i * lh, vw, {
                size: o.valueSize || size, bold: true, color: o.valueColor || C.text, align: rtl ? 'left' : 'right',
            }));
        });
        y += Math.max(1, vLines.length) * lh + 3;
    };

    const hr = (o = {}) => {
        const yy = y + (o.top == null ? 4 : o.top);
        ops.push(doc => {
            doc.save().lineWidth(o.width || 1).strokeColor(o.color || C.line);
            if (o.dashed !== false) doc.dash(3, { space: 3 });
            doc.moveTo(MARGIN, yy).lineTo(MARGIN + CONTENT_W, yy).stroke();
            doc.restore();
        });
        y = yy + (o.gap == null ? 6 : o.gap);
    };
    const space = (n) => { y += n; };

    /** باركود Code128 موسّط + نصّه تحته (.ordercode / .barcode + .li-sku). */
    const barcode = (code, height, label) => {
        const mod = encode128B(code);
        if (!mod) return false;
        const n = modulesCount(mod);
        // عرض الوحدة: أكبر ما يتّسع (سقف 2 كالموقع) — أدقّ مسحاً على الطابعة.
        const mw = Math.max(0.85, Math.min(2, Math.floor((CONTENT_W / n) * 100) / 100));
        const bw = n * mw;
        const x0 = MARGIN + (CONTENT_W - bw) / 2;
        const yy = y;
        ops.push(doc => {
            doc.save().fillColor('#000');
            let cx = x0, bar = true;
            for (const d of mod) {
                const w = parseInt(d, 10) * mw;
                if (bar) doc.rect(cx, yy, w, height).fill();
                cx += w; bar = !bar;
            }
            doc.restore();
        });
        y += height + 2;
        if (label) text(label, { size: F.sku, bold: true, color: C.sku, align: 'center', spacing: 1, gap: 4 });
        return true;
    };

    // ── الأشكال المتّجهة بديلاً عن ✅ ❌ 💵 (Tajawal بلا إيموجي) ─────────────
    const ICON_W = 15;
    const icons = {
        check: (doc, x, yy, c) => {
            doc.save().lineWidth(2.2).strokeColor(c).lineCap('round').lineJoin('round')
                .moveTo(x + 1.5, yy + 7).lineTo(x + 5.5, yy + 11).lineTo(x + 13, yy + 2).stroke().restore();
        },
        cross: (doc, x, yy, c) => {
            doc.save().lineWidth(2.2).strokeColor(c).lineCap('round')
                .moveTo(x + 2, yy + 2).lineTo(x + 12, yy + 11)
                .moveTo(x + 12, yy + 2).lineTo(x + 2, yy + 11).stroke().restore();
        },
        cash: (doc, x, yy, c) => {
            doc.save().lineWidth(1.4).strokeColor(c)
                .roundedRect(x + 0.8, yy + 1.5, 13, 9.5, 1.6).stroke()
                .circle(x + 7.3, yy + 6.3, 2.3).stroke().restore();
        },
        // ↳ لا رسم له في Tajawal — نرسم الخطّاف نفسه (نازل ثم يمين، مع رأس سهم)
        hook: (doc, x, yy, c) => {
            doc.save().lineWidth(1.1).strokeColor(c).lineCap('round').lineJoin('round')
                .moveTo(x + 11.5, yy + 0.5).lineTo(x + 11.5, yy + 6).lineTo(x + 1.8, yy + 6).stroke()
                .moveTo(x + 4.8, yy + 3.4).lineTo(x + 1.6, yy + 6).lineTo(x + 4.8, yy + 8.6).stroke()
                .restore();
        },
        truck: (doc, x, yy, c) => {
            doc.save().lineWidth(1.3).strokeColor(c)
                .rect(x + 0.8, yy + 2, 8, 6.5).stroke()
                .moveTo(x + 8.8, yy + 4).lineTo(x + 13.2, yy + 4).lineTo(x + 13.2, yy + 8.5).lineTo(x + 8.8, yy + 8.5).stroke()
                .circle(x + 3.6, yy + 10.2, 1.5).stroke()
                .circle(x + 11, yy + 10.2, 1.5).stroke().restore();
        },
    };

    /** بانر ملوّن بعنوان (بأيقونة) وسطر فرعي — .pay / .status في القالب. */
    const banner = (icon, title, sub, bg, fg, bd) => {
        const inner = CONTENT_W - 24;
        const t = clean(title);
        const tw = widthOf(m, t, true, F.pay);
        const sLines = sub ? wrap(m, sub, inner, true, F.paySub) : [];
        const h = 10 + F.pay * 1.4 + (sLines.length ? sLines.length * F.paySub * 1.4 + 3 : 0) + 8;
        const yy = y;
        ops.push(doc => {
            doc.save().roundedRect(MARGIN, yy, CONTENT_W, h, 10).fillAndStroke(bg, bd).restore();
            // العنوان + الأيقونة ككتلة موسّطة: الأيقونة في جهة البداية (يمين بالعربية)
            const blockW = tw + 6 + ICON_W;
            const bx = MARGIN + (CONTENT_W - blockW) / 2;
            const ty = yy + 9;
            const iconX = rtl ? bx + tw + 6 : bx;
            const textX = rtl ? bx : bx + ICON_W + 6;
            if (icons[icon]) icons[icon](doc, iconX, ty + (F.pay - 13) / 2 + 1, fg);
            drawLine(doc, t, textX, ty, tw + 4, { size: F.pay, bold: true, color: fg, align: rtl ? 'right' : 'left' });
            let sy = ty + F.pay * 1.4 + 3;
            sLines.forEach(ln => { drawLine(doc, ln, MARGIN + 12, sy, inner, { size: F.paySub, bold: true, color: fg, align: 'center' }); sy += F.paySub * 1.4; });
        });
        y += h + 8;
    };

    /** صندوق رمادي للملاحظات — .note في القالب. */
    const note = (str, align) => {
        const inner = CONTENT_W - 20;
        const lines = wrap(m, str, inner, false, F.note);
        if (!lines.length) return;
        const h = lines.length * F.note * 1.45 + 12;
        const yy = y;
        ops.push(doc => {
            doc.save().roundedRect(MARGIN, yy, CONTENT_W, h, 8).fill(C.noteBg).restore();
            lines.forEach((ln, i) => drawLine(doc, ln, MARGIN + 10, yy + 6 + i * F.note * 1.45, inner, { size: F.note, color: C.text, align }));
        });
        y += h + 8;
    };

    // ── البيانات ─────────────────────────────────────────────────────────────
    const shop = clean(v.shop_name) || L('متجر', 'Store');
    const vatOk = isValidSaudiVat(v.vat_number);
    const paid = !!v.paid;
    const delivery = v.fulfillment === 'delivery';
    const addr = (delivery && v.delivery && typeof v.delivery === 'object') ? v.delivery : null;
    const totalAmount = Number(v.total) > 0 ? Number(v.total) : null;
    const fee = Number(v.delivery_fee) > 0 ? Number(v.delivery_fee) : 0;
    const items = Array.isArray(v.items) ? v.items.filter(it => it && it.label) : [];
    const prepMinutes = String(v.prep_time == null ? '' : v.prep_time).replace(/[^\d]/g, '');
    const prep = v.prep_time === 'arrival'
        ? L('عند الوصول', 'On arrival')
        : (prepMinutes ? `${prepMinutes} ${L('دقيقة', 'min')}` : '');

    // ── .head — اسم المتجر ونوع المستند ───────────────────────────────────
    text(shop, { size: F.shop, bold: true, align: 'center', gap: 1 });
    if (vatOk) {
        text(L('فاتورة ضريبية مبسطة', 'Simplified Tax Invoice'), { size: F.sub, bold: true, color: C.muted, align: 'center', gap: 0 });
        text(`${L('الرقم الضريبي', 'VAT No')}: ${v.vat_number}`, { size: F.sub, color: C.muted, align: 'center', gap: 0 });
    } else {
        text(L('فاتورة / سند طلب', 'Order receipt'), { size: F.sub, color: C.muted, align: 'center', gap: 0 });
    }
    hr({ width: 2, gap: 10 });

    // ── .ordercode — باركود رقم الطلب دائماً (يمسحه التاجر فيفتح الطلب) ──
    space(2);
    barcode(String(v.barcode || ''), 54, `${L('رقم الطلب', 'Order #')}: ${v.barcode || ''}`);
    hr({ width: 2, gap: 8, top: 6 });

    // ── .row — الصفوف بترتيب القالب ───────────────────────────────────────
    row(L('رقم الطلب', 'Order #'), String(v.barcode || ''));
    if (v.backup_code && v.backup_code !== v.barcode) row(L('كود احتياطي', 'Backup code'), String(v.backup_code));
    if (v.booked_at) row(L('التاريخ', 'Date'), fmtDate(v.booked_at, rtl));
    if (v.buyer_name) row(L('المشتري', 'Buyer'), clean(v.buyer_name) + (v.buyer_phone ? ` — ${clean(v.buyer_phone)}` : ''));
    row(L('الكمية', 'Qty'), String(v.quantity == null ? 1 : v.quantity));
    if (Number(v.unit_price) > 0) row(L('سعر القطعة', 'Unit price'), `${fmtSAR(v.unit_price)} ${cur}`);
    if (prep) row(L('وقت التجهيز', 'Prep'), prep);
    if (v.location_name) row(L('الفرع', 'Branch'), clean(v.location_name));
    row(L('طريقة الاستلام', 'Fulfillment'),
        delivery ? L('توصيل إلى العنوان', 'Home delivery') : L('استلام من المتجر', 'Pickup at store'),
        { valueColor: delivery ? C.dlvFg : C.text });

    // ── .delivery — عنوان المشتري (يشاركه الخادم مع التاجر مع الحجز) ─────
    if (addr) {
        const inner = CONTENT_W - 22;
        const head = `${L('التوصيل إلى', 'Deliver to')}: ${[addr.label, addr.details, addr.city].map(clean).filter(Boolean).join(' — ') || L('عنوان المشتري', 'Buyer address')}`;
        const l1 = wrap(m, head, inner, true, F.dMain);
        const l2 = addr.phone ? wrap(m, `${L('جوال التوصيل', 'Delivery phone')}: ${clean(addr.phone)}`, inner, false, F.dSub) : [];
        const l3 = (addr.lat != null && addr.lng != null && Number.isFinite(Number(addr.lat)))
            ? [`${L('الإحداثيات', 'Coordinates')}: ${Number(addr.lat).toFixed(5)}, ${Number(addr.lng).toFixed(5)}`] : [];
        const h = l1.length * F.dMain * 1.6 + l2.length * F.dSub * 1.5 + l3.length * F.dGeo * 1.5 + 14;
        const yy = y;
        ops.push(doc => {
            doc.save().roundedRect(MARGIN, yy, CONTENT_W, h, 8).fillAndStroke(C.dlvBg, C.dlvBd).restore();
            let ty = yy + 6;
            l1.forEach(ln => { drawLine(doc, ln, MARGIN + 11, ty, inner, { size: F.dMain, bold: true, color: C.dlvFg }); ty += F.dMain * 1.6; });
            l2.forEach(ln => { drawLine(doc, ln, MARGIN + 11, ty, inner, { size: F.dSub, bold: true, color: C.dlvFg }); ty += F.dSub * 1.5; });
            l3.forEach(ln => { drawLine(doc, ln, MARGIN + 11, ty, inner, { size: F.dGeo, bold: true, color: C.muted }); ty += F.dGeo * 1.5; });
        });
        y += h + 4;
    }

    // ── .items — كل صنف ببباركود رمزه (SKU) كما في القالب ────────────────
    hr({ gap: 6, top: 10 });
    const all = items.length ? items : [{ label: v.item_name, qty: v.quantity, sku: v.main_sku, kind: 'main' }];
    // ورقة واحدة لها سقف مادّي: نطبع ما يتّسع ونُعلن الباقي. الأولوية للإجمالي
    // وبانر الدفع والأختام — فقدُها أخطر بكثير من فقد سطر صنف.
    const drawn = Number.isFinite(maxItemLines) ? all.slice(0, Math.max(0, maxItemLines)) : all;
    const omitted = all.length - drawn.length;
    let barcodesDrawn = 0, skuAsText = 0;
    drawn.forEach((it) => {
        const isAddon = it.kind === 'addon';
        const qtyPrefix = Number(it.qty) > 1 ? `${it.qty}× ` : '';
        const label = `${qtyPrefix}${clean(it.label)}`;
        if (isAddon) {
            // «↳» رسماً متّجهاً في جهة البداية، والنصّ بعده — مثل .li.addon في القالب.
            const lw = widthOf(m, label, true, F.addon);
            const lines = wrap(m, label, CONTENT_W - 12 - 14, true, F.addon);
            const lh = F.addon * 1.45;
            const yy = y;
            ops.push(doc => {
                const inner = CONTENT_W - 12 - 14;
                const bx = rtl ? MARGIN : MARGIN + 12;
                const hookX = rtl ? MARGIN + CONTENT_W - 12 - 12 : MARGIN;
                icons.hook(doc, hookX, yy + 2, C.addon);
                lines.forEach((ln, i) => drawLine(doc, ln, bx, yy + i * lh, inner, {
                    size: F.addon, bold: true, color: C.addon,
                }));
            });
            void lw;
            y += Math.max(1, lines.length) * lh + 4;
        } else {
            text(label, { size: F.item, bold: true, color: C.text, gap: 4 });
        }
        const sku = String(it.sku == null ? '' : it.sku).trim();
        if (sku) {
            // بلا SKU (أو بعد استنفاد السقف): يُطبع الرمز نصّاً ليُدخله الكاشير يدوياً
            // — نفس الخطة البديلة في قالب الموقع.
            if (barcodesDrawn < maxItemBarcodes && barcode(sku, 42, `SKU: ${sku}`)) barcodesDrawn++;
            else { text(`SKU: ${sku}`, { size: F.sku, bold: true, color: C.sku, align: 'center', spacing: 1, gap: 4 }); skuAsText++; }
        }
        space(4);
        ops.push(((yy) => (doc) => doc.save().lineWidth(1).strokeColor(C.lineSoft).dash(3, { space: 3 })
            .moveTo(MARGIN, yy).lineTo(MARGIN + CONTENT_W, yy).stroke().restore())(y));
        space(7);
    });

    // اقتطاعٌ **معلَن**: حين تُجبرنا ضخامة الطلب على تقليل الباركودات نقول ذلك
    // على الورقة نفسها. التاجر الذي يرى «SKU: 1234» نصّاً يعرف أنه يُدخله يدوياً،
    // أما ورقة تنقص باركودات بلا بيان فتُقرأ كأنها كاملة.
    if (omitted > 0) {
        note(L(`لم تتّسع الورقة لكل الأصناف: طُبع ${drawn.length} من ${all.length}، وبقيت ${omitted} — تظهر كاملة في تطبيق تاكي على رقم الطلب نفسه.`,
              `One sheet could not fit every line: ${drawn.length} of ${all.length} printed, ${omitted} omitted — see the full list in the TAKI app under this order number.`), 'center');
    }
    if (skuAsText > 0 && Number.isFinite(maxItemBarcodes)) {
        note(L(`طلب كبير: طُبعت باركودات ${barcodesDrawn} صنفاً، و${skuAsText} صنفاً برموزها نصّاً (تُدخل يدوياً في الكاشير) — لأن ورقة واحدة لا تتّسع لأكثر.`,
              `Large order: ${barcodesDrawn} item barcodes printed; ${skuAsText} items show their SKU as text (enter manually) — one sheet cannot fit more.`), 'center');
    }

    // ── رسوم التوصيل ثم الإجمالي وتفصيل الضريبة — نفس منطق القالب ────────
    if (fee > 0) row(L('رسوم التوصيل', 'Delivery fee'), `${fmtSAR(fee)} ${cur}`, { size: F.row });
    const solidTotalRule = () => {
        space(4);
        ops.push(((yy) => (doc) => doc.save().lineWidth(2).strokeColor(C.text)
            .moveTo(MARGIN, yy).lineTo(MARGIN + CONTENT_W, yy).stroke().restore())(y));
        space(6);
    };
    if (totalAmount != null) {
        if (vatOk && v.vat_amount != null) {
            const s = splitInclusive(totalAmount, v.vat_rate);
            row(L('المجموع قبل الضريبة', 'Subtotal (excl. VAT)'), `${fmtSAR(s.base)} ${cur}`);
            row(L(`ضريبة القيمة المضافة ${v.vat_rate == null ? 15 : v.vat_rate}٪ (مضمّنة)`, `VAT ${v.vat_rate == null ? 15 : v.vat_rate}% (included)`), `${fmtSAR(s.vat)} ${cur}`);
            solidTotalRule();
            row(L('الإجمالي شامل الضريبة', 'Total (VAT incl.)'), `${fmtSAR(s.total)} ${cur}`, { size: F.total, keyColor: C.text });
        } else {
            solidTotalRule();
            row(L('الإجمالي', 'Total'), `${fmtSAR(totalAmount)} ${cur}`, { size: F.total, keyColor: C.text });
            note(L('المتجر غير مسجّل في ضريبة القيمة المضافة — لم تُحصَّل ضريبة على هذا الطلب.', 'Store not VAT-registered — no VAT was charged.'), 'center');
        }
        if (v.total_source === 'estimate') {
            text(L('الإجمالي محسوب من سعر العرض وقد لا يشمل إضافات اتُّفق عليها مع التاجر.', 'Total is derived from the deal price and may exclude extras agreed with the merchant.'),
                { size: F.sku, color: C.muted, gap: 6 });
        }
    }

    // ── رمز زاتكا QR — للتاجر المسجّل ضريبياً فقط ───────────────────────
    let qrBuf = null;
    if (vatOk && totalAmount != null && v.vat_amount != null) {
        const s = splitInclusive(totalAmount, v.vat_rate);
        try {
            const tlv = zatcaTlvBase64(shop, String(v.vat_number),
                new Date(Number(v.booked_at) || 0).toISOString(), fmtSAR(s.total), fmtSAR(s.vat));
            qrBuf = await QRCode.toBuffer(tlv, { errorCorrectionLevel: 'M', margin: 2, width: 260 });
        } catch { qrBuf = null; }
        if (qrBuf) {
            const qw = 130;   // = width="130" في القالب
            const yy = y + 6;
            ops.push(doc => doc.image(qrBuf, MARGIN + (CONTENT_W - qw) / 2, yy, { width: qw }));
            y = yy + qw + 2;
            text(L('رمز الفوترة الإلكترونية — امسحه بتطبيق زاتكا للتحقق', 'ZATCA e-invoicing QR'),
                { size: F.qrCap, color: C.foot, align: 'center', gap: 6 });
        }
    }

    // ── .pay / .status — بانرات الدفع والحالة (نفس نصوص القالب) ───────────
    space(2);
    if (v.status === 'cancelled') {
        const who = v.cancelled_by === 'buyer' ? L('أُلغِي من العميل', 'Cancelled by the buyer')
            : v.cancelled_by === 'seller' ? L('أُلغِي من التاجر', 'Cancelled by the merchant')
            : (v.cancelled_by === 'expired' || v.cancelled_by === 'system') ? L('أُلغِي تلقائياً (انتهت مهلة الاستلام)', 'Auto-cancelled (pickup window expired)')
            : L('أُلغِي', 'Cancelled');
        banner('cross', L('الطلب ملغي', 'Order cancelled'),
            `${who} — ${L('لم تتم أي محاسبة على العميل', 'No charge was made')}`, C.voidBg, C.voidFg, C.voidBd);
    } else {
        if (paid) {
            banner('check', L('مدفوع إلكترونياً', 'Paid online'),
                `${L('وصل حساب التاجر — لا تطلب مبلغاً من العميل', 'Sent to merchant — do not collect cash')}${v.paid_amount != null ? ` (${fmtSAR(v.paid_amount)} ${cur})` : ''}`,
                C.paidBg, C.paidFg, C.paidBd);
        } else if (v.payment_method === 'online') {
            // نيّة الدفع إلكترونية ولم يُسدَّد بعد — لا نطبع «مدفوع» لما لم يُدفع.
            banner('cash', L('الدفع إلكتروني — بانتظار السداد', 'Online payment — pending'),
                L('يُسدَّد عبر بوابة التاجر قبل التسليم', 'Paid via the merchant’s gateway before handover'),
                C.codBg, C.codFg, C.codBd);
        } else {
            banner(delivery ? 'truck' : 'cash',
                delivery ? L('الدفع عند التوصيل', 'Pay on delivery') : L('الدفع عند الاستلام', 'Pay at pickup'),
                L('استلم المبلغ نقداً/شبكة من العميل', 'Collect payment from the buyer'),
                C.codBg, C.codFg, C.codBd);
        }
        if (v.status === 'completed') {
            banner('check', L('الطلب مكتمل', 'Order completed'),
                paid ? L('حوسب العميل إلكترونياً — وصل حساب التاجر', 'Charged online — sent to merchant')
                    : L('حوسب العميل عند الاستلام (نقداً/شبكة)', 'Charged at pickup (cash/card)'),
                C.paidBg, C.paidFg, C.paidBd);
        }
    }

    // ── .note — ملاحظات الطرفين ────────────────────────────────────────────
    if (v.buyer_note) note(`${L('ملاحظة المشتري', 'Buyer note')}: ${clean(v.buyer_note)}`);
    if (v.merchant_note) note(`${L('ملاحظة التاجر', 'Merchant note')}: ${clean(v.merchant_note)}`);

    // ── .stamp — خانتا التوقيع ────────────────────────────────────────────
    space(16);
    {
        const bw = CONTENT_W * 0.45;
        const yy = y;
        ops.push(doc => {
            doc.save().lineWidth(1).strokeColor(C.stamp)
                .moveTo(MARGIN, yy).lineTo(MARGIN + bw, yy)
                .moveTo(MARGIN + CONTENT_W - bw, yy).lineTo(MARGIN + CONTENT_W, yy).stroke().restore();
            const a = L('توقيع/ختم التاجر', 'Merchant stamp'), b = L('استلمت الطلب', 'Received');
            drawLine(doc, rtl ? a : b, MARGIN, yy + 4, bw, { size: F.stamp, color: C.muted, align: 'center' });
            drawLine(doc, rtl ? b : a, MARGIN + CONTENT_W - bw, yy + 4, bw, { size: F.stamp, color: C.muted, align: 'center' });
        });
        y += 24;
    }

    // ── .foot — التذييل النظامي ───────────────────────────────────────────
    space(6);
    text(vatOk
        ? L('فاتورة ضريبية مبسطة صادرة إلكترونياً عبر منصة تاكي نيابةً عن المتجر (المرحلة الأولى من الفوترة الإلكترونية).', 'Simplified tax invoice issued electronically via TAKI on behalf of the store.')
        : L('صادرة عبر منصة تاكي — سند تشغيلي وليس فاتورة ضريبية. الفاتورة الضريبية (زاتكا) تصدر من نظام التاجر.', 'Issued via TAKI — operational receipt, not a tax invoice.'),
        { size: F.foot, color: C.foot, align: 'center', lineHeight: 1.6, gap: 1 });
    text('www.takisa.net', { size: F.foot, color: C.foot, align: 'center', gap: 0 });
    y += MARGIN;
    m.end();
    return { ops, height: Math.ceil(y), rtl, barcodesDrawn, skuAsText, items: drawn.length, itemsAll: all.length, omitted };
}

/**
 * يبني فاتورة PDF من ناتج `bot_get_booking_invoice`.
 * @param {object} v ناتج الدالة (ok=true)
 * @param {'ar'|'en'} lang لغة المستخدم في البوت
 * @returns {Promise<Buffer>}
 */
async function buildInvoicePdf(v, lang) {
    const rtl = lang !== 'en';
    let plan = await planInvoice(v, lang, Infinity, Infinity);
    if (plan.height > MAX_PAGE_H) {
        // (١) قلّل باركودات الأصناف — الرمز يُطبع نصّاً فيُدخله الكاشير يدوياً.
        const perBarcode = 59;                    // باركود ٤٢ + سطر الرمز + فراغ
        const drop = Math.ceil((plan.height - MAX_PAGE_H) / perBarcode) + 1;
        plan = await planInvoice(v, lang, Math.max(0, plan.barcodesDrawn - drop), Infinity);
        // (٢) ما زالت أطول؟ إذن العدد نفسه لا يتّسع: احسب ما يسعه القالب فعلاً
        //     (بقياس ارتفاع فاتورة بلا أصناف ومتوسّط ارتفاع الصنف) ثم أعلِن البقية.
        if (plan.height > MAX_PAGE_H) {
            const bare = await planInvoice(v, lang, 0, 0);
            const perItem = Math.max(8, (plan.height - bare.height) / Math.max(1, plan.items));
            const fit = Math.max(1, Math.floor((MAX_PAGE_H - bare.height - 60) / perItem));
            plan = await planInvoice(v, lang, 0, fit);
            // احتياطي أخير: إن أخطأ التقدير (نصوص طويلة تلتفّ) قلّص مرّتين ثم اقبل.
            for (let i = 0; i < 2 && plan.height > MAX_PAGE_H; i++) {
                plan = await planInvoice(v, lang, 0, Math.max(1, Math.floor(plan.items * 0.7)));
            }
        }
    }
    const H = Math.min(MAX_PAGE_H, plan.height);
    return await new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: [PAGE_W, H], margin: 0,
            info: {
                Title: `TAKI ${v.barcode || ''}`, Author: 'TAKI — takisa.net',
                Subject: rtl ? 'فاتورة طلب' : 'Order invoice', Creator: 'TAKI',
            },
            pdfVersion: '1.5', lang: rtl ? 'ar-SA' : 'en',
        });
        doc.registerFont('R', FONT_REGULAR).registerFont('B', FONT_BOLD);
        const chunks = [];
        doc.on('data', c => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
        try {
            doc.rect(0, 0, PAGE_W, H).fill('#ffffff');
            for (const op of plan.ops) op(doc);
            doc.end();
        } catch (e) { reject(e); }
    });
}

/** اسم ملف آمن للإرسال: TAKI-<barcode>.pdf */
const invoiceFileName = (v) => `TAKI-${String((v && v.barcode) || 'invoice').replace(/[^A-Za-z0-9_-]/g, '')}.pdf`;

/** الخطوط موجودة؟ يُفحص عند الإقلاع فيُسجَّل تحذير مبكّر بدل فشل صامت. */
const fontsAvailable = () => fs.existsSync(FONT_REGULAR) && fs.existsSync(FONT_BOLD);

module.exports = { buildInvoicePdf, invoiceFileName, fontsAvailable, encode128B, zatcaTlvBase64, bidiRuns, splitInclusive };
