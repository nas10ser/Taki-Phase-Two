/**
 * 🪤 v14.64 — `declare module '*.png';` (بلا جسم) يجعل TypeScript يعطي الوحدةَ
 * شكلاً ضمنياً **بلا تصدير افتراضي**، فيخرج الاستيراد في الحزمة كائناً فارغاً
 * `{}`. وقد كلّفنا ذلك خريطةً كاملة: `L.Icon.Default.mergeOptions({iconUrl:{}})`
 * ⇒ العنوان `[object Object]` ⇒ كل دبابيس الخريطة صور مكسورة. التصريح الصحيح
 * يقول إن الافتراضي **نصّ** (عنوان الملف بعد البصم).
 */
declare module '*.png' { const src: string; export default src; }
declare module '*.jpg' { const src: string; export default src; }
declare module '*.jpeg' { const src: string; export default src; }
declare module '*.svg' { const src: string; export default src; }
declare module '*.gif' { const src: string; export default src; }
declare module '*.css';
