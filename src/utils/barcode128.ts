// v12.88 — مولّد باركود Code 128 (SVG خالص، بلا أي مكتبة خارجية).
//
// يُستخدم لطباعة رمز الكاشير (SKU) باركوداً قابلاً للمسح في فاتورة الطلب،
// فيمرّر الكاشير القارئ فيُضاف المنتج/الإضافة تلقائياً لسلّة نظامه.
//
// نستخدم Code 128B (يغطّي كل ASCII المطبوع 32–126: حروف/أرقام/رموز مثل «-»)
// وهو ما تدعمه غالبية قارئات وأنظمة الكاشير. بلا اعتماد على أي حزمة (تفادياً
// لتضخّم الحزمة، وليعمل داخل مستند الفاتورة المستقل).

// v14.68 — الجدول والخوارزمية انتقلا إلى `shared/code128.js`: **نسخةٌ واحدة**
// يقرؤها الموقع والبوتان. كانا منسوخَين هنا وفي `server/lib/invoicePdf.js`،
// فكان أوّل تصحيحٍ لأحدهما يجعل ورقة التاجر تحمل رمزاً يخالف ورقة البوت لنفس
// الطلب. (قِيس قبل النقل: النسختان متطابقتان على ٩ عيّنات — إلا أن نسخة الموقع
// كانت تطبع الكلمة «null» باركوداً حين يصلها فراغ. النسخة الموحّدة ترفضه.)
import { encode128B } from '../../shared/code128';

export interface Barcode128Opts {
  /** ارتفاع القضبان بالبكسل (افتراضي 46) */
  height?: number;
  /** عرض الوحدة الواحدة بالبكسل (افتراضي 2 — أوضح للمسح) */
  moduleWidth?: number;
  /** هامش جانبي أبيض (quiet zone) بالبكسل (افتراضي 10) */
  margin?: number;
}

/**
 * يبني باركود Code 128B بصيغة SVG (نص) قابل للتضمين مباشرة في HTML الفاتورة.
 * يعيد '' إذا كان النص فارغاً/غير صالح.
 */
export const code128SVG = (text: string, opts: Barcode128Opts = {}): string => {
  const height = opts.height ?? 46;
  const moduleWidth = opts.moduleWidth ?? 2;
  const margin = opts.margin ?? 10;

  const modules = encode128B(text);
  if (!modules) return '';

  let x = margin;
  let rects = '';
  let isBar = true; // يبدأ النمط دائماً بقضيب
  for (let i = 0; i < modules.length; i++) {
    const w = parseInt(modules[i], 10) * moduleWidth;
    if (isBar) rects += `<rect x="${x}" y="0" width="${w}" height="${height}" fill="#000"/>`;
    x += w;
    isBar = !isBar;
  }
  const totalW = x + margin;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${height}" viewBox="0 0 ${totalW} ${height}" shape-rendering="crispEdges"><rect x="0" y="0" width="${totalW}" height="${height}" fill="#fff"/>${rects}</svg>`;
};
