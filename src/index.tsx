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
// already signed in. Everywhere else: render immediately (zero added latency).
if (isTelegramMiniApp()) {
    const safety = new Promise((res) => setTimeout(res, 4000));
    Promise.race([initTelegramMiniApp(), safety]).finally(renderApp);
} else {
    renderApp();
}
