import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';

/**
 * v12.35 — «ثبّت التطبيق» recommendation banner for MOBILE BROWSERS only.
 *
 * The owner's store-launch requirement: someone opening taki from Safari/Chrome
 * on a phone gets a friendly nudge to install the app, but the website keeps
 * working normally underneath (non-blocking, dismissible).
 *
 * Behavior matrix:
 *  - Already installed (standalone / navigator.standalone) ........ never shows
 *  - Inside the Telegram Mini App ................................. never shows
 *  - Desktop ...................................................... never shows
 *  - Android/Chrome ....... captures `beforeinstallprompt` and offers a real
 *                           one-tap native install sheet
 *  - iOS Safari ........... shows the two-step «شارك ← أضف إلى الشاشة الرئيسية»
 *                           instructions (Apple offers no install API)
 *  - «لاحقاً» ............. snoozes for 10 days (localStorage)
 *  - Native install done .. remembered forever (appinstalled event)
 */

const SNOOZE_KEY = 'taki_install_snooze_until';
const DONE_KEY = 'taki_install_done';
const SNOOZE_DAYS = 10;

const isStandalone = (): boolean =>
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true;

const isTelegramWebApp = (): boolean =>
    !!(window as any)?.Telegram?.WebApp?.initData;

const isMobile = (): boolean =>
    /android|iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ masquerades as macOS but has touch points.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isIOS = (): boolean =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const InstallPrompt: React.FC = () => {
    const { language } = useApp();
    const isRTL = language === 'ar';
    const [visible, setVisible] = useState(false);
    const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
    const [showIosSteps, setShowIosSteps] = useState(false);

    useEffect(() => {
        try {
            if (isStandalone() || isTelegramWebApp() || !isMobile()) return;
            if (localStorage.getItem(DONE_KEY) === '1') return;
            const snoozedUntil = Number(localStorage.getItem(SNOOZE_KEY) || 0);
            if (snoozedUntil > Date.now()) return;
        } catch { return; }

        // Android/Chrome fires this when the site qualifies for install; keep
        // the event so «تثبيت» can open the REAL native install sheet.
        const onBeforeInstall = (e: Event) => {
            e.preventDefault();
            setDeferredPrompt(e);
        };
        const onInstalled = () => {
            try { localStorage.setItem(DONE_KEY, '1'); } catch { /* private mode */ }
            setVisible(false);
        };
        window.addEventListener('beforeinstallprompt', onBeforeInstall);
        window.addEventListener('appinstalled', onInstalled);

        // Give the visitor a few seconds with the content before recommending.
        const t = setTimeout(() => setVisible(true), 5000);
        return () => {
            clearTimeout(t);
            window.removeEventListener('beforeinstallprompt', onBeforeInstall);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    if (!visible) return null;

    const snooze = () => {
        try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86400000)); } catch { /* private mode */ }
        setVisible(false);
    };

    const install = async () => {
        if (deferredPrompt) {
            try {
                deferredPrompt.prompt();
                const choice = await deferredPrompt.userChoice;
                if (choice?.outcome === 'accepted') {
                    try { localStorage.setItem(DONE_KEY, '1'); } catch { /* private mode */ }
                }
            } catch { /* sheet dismissed */ }
            setVisible(false);
            return;
        }
        // iOS (or Android before the event fires): show the manual steps.
        setShowIosSteps(true);
    };

    return (
        <div
            dir={isRTL ? 'rtl' : 'ltr'}
            style={{
                position: 'fixed',
                left: 12,
                right: 12,
                bottom: 'calc(84px + env(safe-area-inset-bottom, 0px))',
                zIndex: 1500,
                background: 'var(--card-bg)',
                border: '1.5px solid var(--border-color)',
                borderRadius: 18,
                boxShadow: '0 10px 30px rgba(0,0,0,0.25)',
                padding: '12px 14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                animation: 'taki-slide-up 0.35s ease',
            }}
        >
            <style>{`@keyframes taki-slide-up { from { transform: translateY(24px); opacity: 0; } to { transform: none; opacity: 1; } }`}</style>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <img
                    src="/logo192.png"
                    alt="TAKI"
                    width={44}
                    height={44}
                    style={{ borderRadius: 12, flexShrink: 0 }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text-primary)' }}>
                        {isRTL ? 'ثبّت تطبيق TAKI 📲' : 'Install the TAKI app 📲'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                        {isRTL
                            ? 'أسرع، يعمل من شاشتك الرئيسية، وتصلك العروض أولاً بأول.'
                            : 'Faster, launches from your home screen, offers reach you first.'}
                    </div>
                </div>
                <button
                    onClick={snooze}
                    aria-label={isRTL ? 'إغلاق' : 'Close'}
                    style={{
                        background: 'none', border: 'none', color: 'var(--text-secondary)',
                        fontSize: 18, cursor: 'pointer', padding: 4, flexShrink: 0,
                    }}
                >✕</button>
            </div>

            {showIosSteps ? (
                <div style={{
                    fontSize: 12.5, lineHeight: 2, color: 'var(--text-primary)',
                    background: 'var(--body-bg)', borderRadius: 12, padding: '10px 12px',
                }}>
                    {isIOS() ? (
                        isRTL ? (
                            <>1️⃣ اضغط زر المشاركة <b>⬆️</b> بأسفل المتصفح<br />2️⃣ اختر <b>«إضافة إلى الشاشة الرئيسية ➕»</b><br />3️⃣ اضغط <b>«إضافة»</b> — وستجد TAKI بين تطبيقاتك</>
                        ) : (
                            <>1️⃣ Tap the Share button <b>⬆️</b><br />2️⃣ Choose <b>“Add to Home Screen ➕”</b><br />3️⃣ Tap <b>Add</b> — TAKI appears with your apps</>
                        )
                    ) : (
                        isRTL ? (
                            <>افتح قائمة المتصفح <b>⋮</b> ثم اختر <b>«إضافة إلى الشاشة الرئيسية»</b> أو <b>«تثبيت التطبيق»</b></>
                        ) : (
                            <>Open the browser menu <b>⋮</b> and choose <b>“Add to Home screen”</b> / <b>“Install app”</b></>
                        )
                    )}
                </div>
            ) : (
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        onClick={install}
                        style={{
                            flex: 2, padding: '10px 0', borderRadius: 12, border: 'none',
                            background: 'linear-gradient(135deg, #10b981, #0d9488)',
                            color: '#fff', fontWeight: 800, fontSize: 13.5, cursor: 'pointer',
                            fontFamily: 'inherit',
                        }}
                    >
                        {isRTL ? '📲 تثبيت التطبيق' : '📲 Install app'}
                    </button>
                    <button
                        onClick={snooze}
                        style={{
                            flex: 1, padding: '10px 0', borderRadius: 12,
                            border: '1px solid var(--border-color)', background: 'transparent',
                            color: 'var(--text-secondary)', fontWeight: 700, fontSize: 13,
                            cursor: 'pointer', fontFamily: 'inherit',
                        }}
                    >
                        {isRTL ? 'لاحقاً' : 'Later'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default InstallPrompt;
