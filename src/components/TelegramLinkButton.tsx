import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../services/supabaseClient';

/**
 * TelegramLinkButton — securely binds the logged-in TAKI account to Telegram.
 *
 * Security: the one-time token is minted by the `bot_create_link_token` RPC
 * which reads `auth.uid()` — so a token can ONLY be created by the genuinely
 * authenticated account owner. The bot consumes it and binds the Telegram
 * identity to THIS account. No phone numbers, no guessable identifiers, no way
 * for anyone else to claim your account.
 */
const BOT_USERNAME = 'TakiKSA_bot';

const TelegramLinkButton: React.FC<{ compact?: boolean }> = ({ compact }) => {
    const { language, customAlert } = useApp();
    const isAr = language !== 'en';
    const [busy, setBusy] = useState(false);

    const handleLink = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const { data, error } = await supabase.rpc('bot_create_link_token');
            if (error || !data) {
                customAlert(isAr
                    ? '⚠️ تعذّر إنشاء رابط الربط. تأكد من تسجيل دخولك وحاول مجدداً.'
                    : '⚠️ Could not create the link. Make sure you are signed in and try again.');
                return;
            }
            const url = `https://t.me/${BOT_USERNAME}?start=link_${data}`;
            // Open Telegram directly; the bot links the account on tap.
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
            disabled={busy}
            style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                width: '100%', padding: compact ? '12px 16px' : '15px 18px',
                borderRadius: 14, border: 'none', cursor: busy ? 'wait' : 'pointer',
                background: 'linear-gradient(135deg, #229ED9 0%, #2AABEE 100%)',
                color: '#fff', fontSize: compact ? 14 : 15, fontWeight: 700,
                boxShadow: '0 4px 14px rgba(34,158,217,0.35)',
                opacity: busy ? 0.7 : 1, transition: 'transform .15s ease',
            }}
            onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.98)')}
            onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M9.04 15.47 8.7 19.9c.46 0 .66-.2.9-.43l2.17-2.06 4.5 3.28c.82.45 1.42.21 1.63-.76l2.96-13.9c.27-1.24-.45-1.73-1.26-1.43L2.2 9.86c-1.2.47-1.18 1.14-.2 1.44l4.5 1.4 10.45-6.58c.49-.32.94-.14.57.18z"/>
            </svg>
            {busy
                ? (isAr ? 'جاري الفتح…' : 'Opening…')
                : (isAr ? 'ربط حسابي بتيليجرام' : 'Link my Telegram')}
        </button>
    );
};

export default TelegramLinkButton;
