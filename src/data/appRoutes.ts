/**
 * مساراتُ التطبيق — مصدرٌ واحد للتحقّق من أيّ رابطٍ داخليّ (v16.44)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 العيبُ الذي وُلد له (بلاغُ ناصر ١٩ نوفمبر ٢٠٢٦): «عند رفع إشعار ترويجي
 *    يقول إن الصفحة غير موجودة» — ولقطتُه تُظهر `/seller-dashboard`.
 *    والمقيس على جدة: الحملةُ `promo_seed_seller_growth` كانت تحمل
 *    `action_url = '/seller-dashboard?tab=form'`، **والمسارُ في التطبيق
 *    `/seller`**. فكلُّ تاجرٍ ضغط زرَّ تلك الحملة وصل إلى «الصفحة غير موجودة».
 *
 * 🔴 **وهذا أخطرُ من رابطٍ مكسور في صفحة**: الحملةُ تُبَثّ إلى كلّ التجّار،
 *    فالخطأُ الواحد يصل الجميع دفعةً واحدة — ولا شيء يصرخ، لأن مسارَ
 *    `vercel.json` يُعيد `index.html` لأيّ مسارٍ بلا امتداد فيردّ ٢٠٠،
 *    ثمّ يعرض الموجّهُ صفحةَ «غير موجودة». أي أن السجلّات تقول «نجاح».
 *
 * 🪤 ولا تُكتب القائمةُ بيدٍ هنا: `scripts/check-app-routes.js` يستخرجها من
 *    `src/App.tsx` نفسِه ويُفشل البناء إن انحرفت — فإعادةُ تسمية مسارٍ تُمسَك
 *    عند البناء لا عند أوّل تاجرٍ يضغط.
 */

/** المساراتُ الثابتة (بلا وسائط). */
export const STATIC_ROUTES = [
    '/', '/about', '/admin', '/bookings', '/complaints', '/complete-profile',
    '/contact', '/contests', '/dashboard', '/deals', '/delete-account', '/faq',
    '/favorites', '/nearby', '/notifications', '/privacy', '/profile', '/refund',
    '/register', '/seasonal', '/seller', '/subscription', '/terms',
    // 🪤 مسارٌ حقيقيٌّ في الموجّه يُحوّل إلى الجذر: بعضُ العملاء يفتحون
    //    `/index.html` حرفاً (اختصارٌ محفوظ أو تطبيقٌ مثبَّت قديم). أمسكه
    //    `check-app-routes.js` حين قارن القائمةَ بالموجّه — ولم أكن أعرفه.
    '/index.html',
] as const;

/** المساراتُ ذاتُ الوسيط — يُقبل أيُّ قيمةٍ غير فارغة مكان الوسيط. */
export const PARAM_ROUTES = [
    '/booking/:barcode', '/deal/:id', '/store/:id',
] as const;

/**
 * هل هذا رابطٌ داخليٌّ صالح؟ يقبل المسار مع `?query` و`#hash`.
 * 🪤 والروابطُ الخارجية (`https://…`) **ليست من شأن هذه الدالّة**: لها حارسُ
 *    المضيف المنفصل، وخلطُ الاثنين يجعل أحدَهما يُمرّر ما يرفضه الآخر.
 */
export const isInternalRoute = (raw: string): boolean => {
    const v = (raw || '').trim();
    if (!v.startsWith('/')) return false;
    if (v.startsWith('//')) return false;            // `//evil.com` مسارٌ ظاهراً ومضيفٌ فعلاً
    const path = v.split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
    if ((STATIC_ROUTES as readonly string[]).includes(path)) return true;
    const segs = path.split('/').filter(Boolean);
    return (PARAM_ROUTES as readonly string[]).some((r) => {
        const rs = r.split('/').filter(Boolean);
        if (rs.length !== segs.length) return false;
        return rs.every((s, i) => (s.startsWith(':') ? segs[i].length > 0 : s === segs[i]));
    });
};
