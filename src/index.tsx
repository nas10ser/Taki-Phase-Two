import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './context/AppContext';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import { initSentry } from './services/sentry';
import { isTelegramMiniApp, initTelegramMiniApp } from './services/telegramMiniApp';

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
if (isTelegramMiniApp() && !wantsTgLink) {
    const safety = new Promise((res) => setTimeout(res, 4000));
    Promise.race([initTelegramMiniApp(), safety]).finally(renderApp);
} else {
    renderApp();
}
