import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './context/AppContext';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { initSentry } from './services/sentry';
import { looksLikeTelegram, ensureTelegramSdk, initTelegramMiniApp } from './services/telegramMiniApp';

// Error monitoring — no-op until SENTRY_DSN is configured (see services/sentry.ts).
initSentry();

// One-time initialization: clear old data on shape changes
const INIT_KEY = 'taki_initialized_v8';
if (!localStorage.getItem(INIT_KEY)) {
    localStorage.clear();
    localStorage.setItem(INIT_KEY, 'true');
}

const container = document.getElementById('root');
const root = createRoot(container!);

// ═══════════════════════════════════════════════════════════════════════════
// تطبيقا المتجرين (v15.58): الجسرُ الأصليّ يُحمَّل **ديناميكياً وبشرط**.
// 🪤 ولا يُستورد ساكناً: الموقعُ يُحمَّل في متصفّحٍ لا يعرف Capacitor، وحزمةُ
//    الدخول عند ٦٣٧ ك.ب من سقف ٧٦٠ — فاستيرادٌ ساكنٌ يُدخل إضافاتِ المنصّتين
//    في حزمة **كل زائر**. والشرطُ `window.Capacitor` يحقنه الجسرُ الأصليّ وحده.
// ═══════════════════════════════════════════════════════════════════════════
if ((globalThis as any).Capacitor?.isNativePlatform?.()) {
    void import('./native/capacitor').then(n => n.initNative({
        // رابطٌ عميق: يُفتح داخل التطبيق بالتوجيه لا بإعادة تحميل الصفحة
        // (إعادةُ التحميل تُفقد الحالةَ وتُظهر وميضَ شاشةِ بدءٍ ثانية).
        onDeepLink: (path) => { window.history.pushState({}, '', path);
                                window.dispatchEvent(new PopStateEvent('popstate')); },
        // زرُّ الرجوع: تبتلعه أيُّ نافذةٍ مفتوحة أوّلاً (نفسُ عقد `useBackClose`).
        onBack: () => {
            const esc = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
            document.dispatchEvent(esc);
            return document.querySelector('[data-taki-modal="open"]') !== null;
        },
        // عودةُ المصادقة على المخطَّط المخصَّص (`net.takisa.app://auth/callback`).
        // 🪤 وتُحمَّل الوحدةُ **عند الحاجة** لا ساكنةً: الويبُ لا يحتاجها إطلاقاً.
        onAuthReturn: (frag) => {
            void import('./services/nativeAuthReturn')
                .then(m => m.consumeNativeAuthReturn(frag));
        },
    }));
}

const renderApp = () => root.render(
    <ErrorBoundary>
        <AppProvider>
            <App />
        </AppProvider>
    </ErrorBoundary>
);

// Inside Telegram: auto-login first (with a safety timeout) so the app opens
// already signed in. EXCEPT on the explicit link entry (/profile?tglink=1) —
// there we must NOT auto-create a Telegram buyer session, otherwise an existing
// account (seller/admin) could never be the one that gets linked. On that path
// we render immediately and let the profile page link the chosen/existing
// account (or offer to create one). Everywhere else: render immediately.
const wantsTgLink = (() => {
    try { return new URLSearchParams(window.location.search).get('tglink') === '1'; } catch { return false; }
})();
// Remember the link intent so that AFTER the user signs in (inside Telegram)
// the auth redirector sends them to /profile?tglink=1 to finish linking,
// instead of the normal home/dashboard landing.
if (wantsTgLink) { try { sessionStorage.setItem('taki_tglink', '1'); } catch { /* ignore */ } }
// 🪤 والانتظارُ يقع في **الفرعين** داخل تيليجرام، لا في فرع الدخول وحده:
//    مسارُ الربط (`?tglink=1`) يُصيّر فوراً ثمّ تقرأ صفحةُ «حسابي»
//    `isTelegramMiniApp()` **متزامنةً** — فلو لم يُنتظر السكربتُ هنا لقرأت
//    `undefined` على جهازٍ هو داخل تيليجرام فعلاً، فيصمت زرُّ الربط بلا خطأ.
if (looksLikeTelegram()) {
    const safety = new Promise((res) => setTimeout(res, 4000));
    const boot = ensureTelegramSdk().then(() => (wantsTgLink ? null : initTelegramMiniApp()));
    Promise.race([boot, safety]).finally(renderApp);
} else {
    renderApp();
}
