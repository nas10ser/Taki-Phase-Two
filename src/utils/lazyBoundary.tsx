import React, { Suspense, lazy } from 'react';

/**
 * مكوّنٌ كسولٌ **بحدِّه الخاصّ** — لا يُخفي أحداً حين يُحمَّل (v16.49)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 بلاغُ ناصر (١٩ نوفمبر ٢٠٢٦): «عند محاولة تعديل المنتج ووضعِ تاريخٍ له
 *    **يعلق**… وحتى عند تغيير موقعه يوجد تعليق». ومعه تقريرُ سنتري من
 *    `https://www.takisa.net/seller?tab=products`:
 *        Error: Map container is already initialized.
 *          at _initContainer (leaflet/src/map/Map.js:1094)
 *          at x (react-leaflet/lib/MapContainer.js:30)
 *
 * ── السلسلةُ كاملةً، **مقروءةً من المصدر المثبَّت لا من الذاكرة** ──────────
 *  ① `react-leaflet@4.2.1` يُنشئ الخريطةَ داخل **ردّ نداءِ مرجع**:
 *       const mapRef = useCallback((node) => {
 *         if (node !== null && context === null) new LeafletMap(node, options);
 *       }, []);                       // ← مصفوفةٌ فارغة
 *     فالمُغلَّفُ يلتقط `context === null` **من أوّل تصيير وإلى الأبد**،
 *     وتنظيفُ الخريطة (`map.remove()`) في `useEffect` **خامل** (passive).
 *
 *  ② و`react-dom@18.3.1` — قُرئ في `cjs/react-dom.development.js`:
 *     · إخفاءُ حدِّ `Suspense` ⇒ `disappearLayoutEffects_begin`: لعقدة DOM
 *       `safelyDetachRef` (يُفصل المرجع)، وللمكوّنات
 *       `commitHookEffectListUnmount(Layout, …)` — **الخاملةُ لا تُنظَّف**.
 *       ⇒ الخريطةُ تبقى حيّةً و`container._leaflet_id` مختوماً.
 *     · والكشفُ ⇒ `reappearLayoutEffectsOnFiber`: `safelyAttachRef` على
 *       **نفس العقدة**، فيُنادى `mapRef(node)` ثانيةً بمُغلَّفٍ يقول
 *       `context === null` ⇒ `new LeafletMap(node)`.
 *
 *  ③ و`leaflet@1.9.4` في `_initContainer`:
 *       else if (container._leaflet_id) throw 'Map container is already initialized.'
 *     ⇒ يُرمى، فيلتقطه حدُّ الأخطاء، **فتتجمّد الشاشةُ أمام التاجر**.
 *
 * ── ولماذا وقع هنا بالذات ────────────────────────────────────────────────
 * 🔴 كانت `SellerDashboard` تلفّ **جسدَها كلَّه** بحدِّ `Suspense` واحد
 *    (٢٩٥٨ ⇐ ٥٤٩٧) وفيه **ثلاثةَ عشرَ مكوّناً كسولاً** مع الخريطة. وكنتُ
 *    كتبتُ فوقه في v14.83: «حدٌّ واحدٌ لكلّ المكوّنات الكسولة… فلا وميض» —
 *    **وهذا تعليلٌ خاطئ**: الحدُّ لا يُظهر بديلاً فحسب، بل **يُخفي الشجرةَ
 *    كلَّها ويفصل مراجعَها**. فكلُّ فتحِ تقويمٍ (`DualCalendarPicker`) أو
 *    كاميرا أو قاصِّ صورةٍ أو سكانر — وكلُّها كسولة — كان يُخفي الخريطةَ
 *    ثمّ يكشفها فتنفجر. وهذا نصُّ بلاغه: «وضعِ تاريخٍ له **يعلق**».
 *
 * ⇒ القاعدةُ من اليوم: **لكلّ مكوّنٍ كسولٍ حدُّه**. تحميلُه يخصُّه وحده،
 *   فلا يُخفي جاراً ولا يُعيد تهيئةَ خريطة. ويحرسها
 *   `scripts/check-lazy-boundary.js`.
 *
 * 🪤 والبديلُ `null` عمداً: هذه مكوّناتٌ **مشروطةُ التصيير** (تُفتح بضغطة)،
 *    والشاشةُ خلفها مرسومةٌ كاملة. فإظهارُ «…» مكانها وميضٌ بلا فائدة.
 */
export function lazyBoundary<P extends object>(
    factory: () => Promise<{ default: React.ComponentType<P> }>,
    fallback: React.ReactNode = null,
): React.FC<P> {
    const Inner = lazy(factory);
    const Bounded: React.FC<P> = (props) => (
        <Suspense fallback={fallback}>
            <Inner {...(props as any)} />
        </Suspense>
    );
    Bounded.displayName = 'LazyBoundary';
    return Bounded;
}

export default lazyBoundary;
