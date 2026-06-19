import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../services/supabaseClient';
import { isTelegramMiniApp, ensureTelegramLinked } from '../services/telegramMiniApp';

/**
 * TelegramLinkButton — binds the TAKI account to Telegram, two ways:
 *
 *  • Inside Telegram (Mini App): the signed initData lets us link DIRECTLY and
 *    instantly — no bot round-trip. If the user has no account yet we create one
 *    via Telegram first, then link. (This is the path the bot's "ربط حسابي"
 *    web_app button uses → /profile?tglink=1, which auto-runs the same flow.)
 *
 *  • In a normal browser: mint a one-time token (`bot_create_link_token`, reads
 *    auth.uid()) and open the bot, which binds the account on Start.
 *
 * Security: linking always requires proof — either Telegram's signed initData
 * (Mini App) or a server-minted token for the authenticated account (browser).
 * No phone numbers, no guessable identifiers, no way to claim someone else's
 * account.
 */
const BOT_USERNAME = 'TakiKSA_bot';

const TelegramLinkButton: React.FC<{ compact?: boolean }> = ({ compact }) => {
    const { language, customAlert, platformSettings } = useApp();
    const isAr = language !== 'en';
    const [busy, setBusy] = useState(false);
    const [linked, setLinked] = useState(false);

    // Admin kill-switch: when the Telegram bot is disabled platform-wide, hide the
    // linking entry point entirely (request 2). Re-enabling restores it live.
    if (!platformSettings.telegramBotEnabled) return null;

    const handleLink = async () => {
        if (busy || linked) return;
        setBusy(true);
        try {
            // Inside Telegram → link THIS signed-in account directly. It never
            // creates a duplicate account anymore — if no one is signed in we send
            // the user to the sign-in / create choice instead (v11.71).
            if (isTelegramMiniApp()) {
                const r = await ensureTelegramLinked();
                if (r === 'linked') {
                    setLinked(true);
                    customAlert(isAr ? '✅ تم ربط حسابك بتيليجرام بنجاح.' : '✅ Your account is now linked to Telegram.');
                } else if (r === 'not_authenticated') {
                    customAlert(isAr
                        ? 'سجّل دخولك لحسابك (أو أنشئ حساباً) أولاً، ثم سيُربط بتيليجرام تلقائياً.'
                        : 'Sign in to your account (or create one) first — it will then link to Telegram automatically.');
                    try { window.location.assign('/register?tglink=1'); } catch { /* ignore */ }
                } else {
                    customAlert(isAr
                        ? '⚠️ تعذّر الربط داخل تيليجرام. أعد فتح التطبيق من البوت وحاول مجدداً.'
                        : '⚠️ Could not link inside Telegram. Reopen the app from the bot and retry.');
                }
                return;
            }

            // Normal browser → one-time token + open the bot.
            const { data, error } = await supabase.rpc('bot_create_link_token');
            if (error || !data) {
                customAlert(isAr
                    ? '⚠️ لإتمام الربط افتح «تاكي» من داخل تيليجرام (زر «فتح تاكي»)، أو سجّل دخولك أولاً ثم أعد المحاولة.'
                    : '⚠️ To finish linking, open TAKI from inside Telegram (the "Open TAKI" button), or sign in first and retry.');
                return;
            }
            const url = `https://t.me/${BOT_USERNAME}?start=link_${data}`;
            const win = window.open(url, '_blank');
            if (!win && navigator.clipboard) {
                await navigator.clipboard.writeText(url);
                customAlert(isAr
                    ? '🔗 تم نسخ رابط الربط. افتح تيليجرام والصقه لإتمام الربط.'
                    : '🔗 Link copied. Open Telegram and paste it to finish linking.');
            }
        } catch {
            customAlert(isAr ? '⚠️ حدث خطأ، حاول لاحقاً.' : '⚠️ Something went wrong, try again later.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <button
            onClick={handleLink}
            disabled={busy || linked}
            style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', padding: compact ? '12px 16px' : '15px 18px',
                borderRadius: 14, border: 'none', cursor: busy ? 'wait' : linked ? 'default' : 'pointer',
                background: linked
                    ? 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)'
                    : 'linear-gradient(135deg, #229ED9 0%, #2AABEE 100%)',
                color: '#fff', fontSize: compact ? 14 : 15, fontWeight: 700,
                boxShadow: linked ? '0 4px 14px rgba(22,163,74,0.35)' : '0 4px 14px rgba(34,158,217,0.35)',
                opacity: busy ? 0.7 : 1, transition: 'transform .15s ease',
            }}
            onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.98)')}
            onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M9.04 15.47 8.7 19.9c.46 0 .66-.2.9-.43l2.17-2.06 4.5 3.28c.82.45 1.42.21 1.63-.76l2.96-13.9c.27-1.24-.45-1.73-1.26-1.43L2.2 9.86c-1.2.47-1.18 1.14-.2 1.44l4.5 1.4 10.45-6.58c.49-.32.94-.14.57.18z"/>
            </svg>
            {linked
                ? (isAr ? '✅ حسابك مرتبط بتيليجرام' : '✅ Linked to Telegram')
                : busy
                    ? (isAr ? 'جاري الربط…' : 'Linking…')
                    : (isAr ? 'ربط حسابي بتيليجرام' : 'Link my Telegram')}
        </button>
    );
};

export default TelegramLinkButton;
