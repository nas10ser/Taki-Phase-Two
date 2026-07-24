// v12.98 — تتبّع عمق التنقّل داخل التطبيق + «رجوع ذكي».
//
// المشكلة: أزرار «العودة» التي تستدعي history.push('/') تُنشئ إدخالاً جديداً في
// السجل (PUSH) فيقفز مدير التمرير للأعلى بدل استعادة موضع الصفحة السابقة. الرجوع
// الحقيقي (POP عبر goBack) هو ما يجعل المدير يستعيد الموضع بالضبط.
//
// لكن goBack() الأعمى قد يخرج من التطبيق كلياً إذا كان المستخدم دخل مباشرةً على
// صفحة عميقة (رابط خارجي/إشعار) بلا تاريخ داخلي. لذا نعدّ كم انتقالاً PUSH تمّ
// داخل جلسة التطبيق: إن كان > 0 فالرجوع آمن (يبقى داخل التطبيق ويستعيد الموضع)،
// وإلا نسقط إلى وجهة افتراضية (الرئيسية غالباً).

let appNavDepth = 0;

/** يُستدعى من ScrollManager عند كل انتقال ليعكس عمق السجل داخل التطبيق. */
export const bumpNavDepth = (action: string): void => {
    if (action === 'PUSH') appNavDepth += 1;
    else if (action === 'POP') appNavDepth = Math.max(0, appNavDepth - 1);
    // REPLACE لا يغيّر العمق (يستبدل الإدخال الحالي بلا إضافة/حذف).
};

/** هل يوجد تاريخ تنقّل داخل التطبيق يمكن الرجوع إليه بأمان؟ */
export const canGoBackInApp = (): boolean => appNavDepth > 0;

/**
 * رجوع ذكي: يستعيد الموضع السابق بالضبط (goBack → POP) إن وُجد تاريخ داخلي،
 * وإلا ينتقل للوجهة الافتراضية.
 */
export const smartBack = (
    history: { goBack: () => void; push: (path: string) => void },
    fallback = '/'
): void => {
    if (appNavDepth > 0) history.goBack();
    else history.push(fallback);
};
