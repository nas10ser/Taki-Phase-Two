# لماذا `"alias": { "buffer": false }` في package.json

`@supabase/storage-js` فيه سطرٌ واحد (في `uploadOrUpdate`):

```js
if (typeof Buffer !== "undefined") return Buffer.from(data).toString("base64");
```

وهو ارتدادٌ لبيئة **Node** — فالمتصفّح لا يملك `Buffer` فيأخذ المسارَ الأصليّ.

🔴 لكن Parcel يرى الاسمَ المجرّد `Buffer` فيحقن حشوة `node:buffer` كاملةً في
**حزمة الدخول** (قِيس: ٥٧ ك.ب مصدراً). والمفارقةُ أن الحقنَ **يجعل الشرطَ
صحيحاً**، فيستعمل المتصفّحُ حشوةً جافاسكربتية بدل `btoa`/`TextEncoder`
الأصليّين — أي أننا دفعنا ٥٧ ك.ب لنحصل على مسارٍ **أبطأ**.

✅ وقطعُها آمن، وفُحص كلُّ موضعٍ يذكر الاسم:
- `storage-js` — الشرطُ يصير خطأً فيسلك مسارَ المتصفّح (وهو الصحيح).
- `shared/zatcaTlv.js` — يأخذ فرعَ `btoa` في المتصفّح، ويقرأ `Buffer` عبر
  `globalThis['Buf'+'fer']` فلا يراه المُجمِّعُ أصلاً، ويبقى يعمل في Node
  (البوتان) حيث `Buffer` عامٌّ حقيقيّ لا حشوة.
- `src/services/pushService.ts` — `BufferSource` **نوعٌ** لا قيمة، بصفر أثرٍ
  في المُخرَج.

🪤 ولا تُعاد الحشوةُ بحجّة «ربّما يحتاجها شيء»: حارسٌ في `check-bundle-budget.js`
يرفض ظهور `node_modules/buffer` في حزم الدخول — فإن احتاجها مسارٌ جديد فهو
يحتاج إعادةَ كتابةٍ لا حشوة.
