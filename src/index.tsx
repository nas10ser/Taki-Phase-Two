import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './context/AppContext';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';

// One-time initialization: clear old data on shape changes
const INIT_KEY = 'taki_initialized_v8';
if (!localStorage.getItem(INIT_KEY)) {
    localStorage.clear();
    localStorage.setItem(INIT_KEY, 'true');
}

const container = document.getElementById('root');
const root = createRoot(container!);

root.render(
    <ErrorBoundary>
        <AppProvider>
            <App />
        </AppProvider>
    </ErrorBoundary>
);
