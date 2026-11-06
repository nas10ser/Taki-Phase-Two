/**
 * capacitor.config.ts — تطبيقا المتجرين (v15.58)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **لماذا تُحزَم الواجهةُ محلياً ولا يُفتح الموقعُ من الشبكة** (أهمُّ قرارٍ هنا):
 *    Capacitor يسمح بالأمرين — `server.url` يجعل التطبيقَ يعرض
 *    `https://www.takisa.net` مباشرةً، وهو أسهلُ ويحدَّث بلا نشرٍ في المتجر.
 *    لكنّه **بالضبط ما يرفضه البند ٤٫٢ عند أبل** («الحدُّ الأدنى من
 *    الوظائف»): تطبيقٌ ليس إلا موقعاً مُغلَّفاً يُرفض رفضاً معروفاً متكرّراً.
 *    ⇒ `webDir: 'dist'` بلا `server.url`: الحزمةُ داخل التطبيق، والطلباتُ
 *      وحدها تذهب إلى `api.takisa.net`. وهذا يعني أيضاً أن أوّلَ إطارٍ يُرسم
 *      بلا شبكة، وأن التطبيق يعمل جزئياً بلا اتّصال.
 *
 * 🪤 واسمُ المشروع لاتينيّ (`TAKI`) عمداً: اسمُ مشروع Xcode وGradle يدخل في
 *    مساراتِ ملفّاتٍ وأسماءِ أهداف، والعربيُّ فيها مصدرُ أعطالٍ لا طائلَ منها.
 *    **والاسمُ الظاهر للمستخدم عربيٌّ** — يُضبط في `Info.plist`
 *    (`CFBundleDisplayName`) و`strings.xml` (`app_name`)، ويُترجَم في المتجرين.
 *
 * 🪤 و`androidScheme: 'https'` إلزاميّ لا تجميل: بـ`http` يرفض أندرويدُ
 *    الحديث تخزينَ الكوكيز الآمنة ويعطّل خصائصَ تشترط سياقاً آمناً
 *    (الموقع · الكاميرا · العاملُ الخدميّ) — فتنكسر نصفُ المنصّة بصمت.
 */

import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'net.takisa.app',
    appName: 'TAKI',
    webDir: 'dist',

    // سياقٌ آمن في المنصّتين: `https://localhost` على أندرويد،
    // و`capacitor://localhost` على آيفون (الافتراضيّ هناك).
    android: { allowMixedContent: false },
    server: {
        androidScheme: 'https',
        // 🪤 ولا `cleartext`: أيُّ طلبٍ غيرِ مشفَّر يُرفض — والمنصّةُ كلُّها HTTPS.
        cleartext: false,
    },

    ios: {
        // آيفون: الخلفيةُ تحت شريط الحالة تتبع ثيم الموقع (نيفي #0f172a).
        backgroundColor: '#0f172a',
        contentInset: 'always',
        limitsNavigationsToAppBoundDomains: false,
    },

    plugins: {
        SplashScreen: {
            // 🪤 شاشةُ البدء تُخفى **من الكود** بعد أوّل رسمٍ حقيقيّ، لا بمؤقّت:
            //    مؤقّتٌ ثابت إمّا يومض (أقصر من التحميل) أو يُبطئ بلا سبب.
            launchAutoHide: false,
            backgroundColor: '#0f172a',
            androidScaleType: 'CENTER_CROP',
            showSpinner: false,
            splashFullScreen: true,
            splashImmersive: false,
        },
        StatusBar: {
            style: 'DARK',              // أيقوناتٌ فاتحة فوق الشريط الداكن
            backgroundColor: '#0f172a',
            overlaysWebView: false,
        },
        PushNotifications: {
            // الصوتُ والشارةُ والتنبيهُ — والإذنُ يُطلب بزرٍّ صريح لا عند الفتح
            // (قاعدةٌ قائمة في المنصّة منذ v14.13).
            presentationOptions: ['badge', 'sound', 'alert'],
        },
        Keyboard: { resize: 'native' },
    },
};

export default config;
