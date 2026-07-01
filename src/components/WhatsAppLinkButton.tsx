import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase } from '../services/supabaseClient';

/**
 * WhatsAppLinkButton — binds the TAKI account to WhatsApp.
 *
 * Same security model as Telegram: linking requires a one-time token minted for
 * the AUTHENTICATED account (`bot_create_link_token`, reads auth.uid()). We then
 * open a wa.me deep link that pre-fills "link_<token>"; when the user hits send,
 * the bot consumes it (bot_consume_link_token, p_whatsapp_id => their number) and
 * binds this number to the account. No phone-based claiming — the proof is the
 * server-minted token, never the number itself.
 *
 * Stays HIDDEN until the admin sets both `whatsapp_bot_enabled = true` and a
 * `whatsapp_bot_number` in platform_settings — so it ships dormant alongside the
 * dormant bot and lights up the instant the WhatsApp credentials are live.
 */
const WhatsAppLinkButton: React.FC<{ compact?: boolean }> = ({ compact }) => {
    const { language, customAlert, platformSettings } = useApp();
    const isAr = language !== 'en';
    const [busy, setBusy] = useState(false);

    const number = (platformSettings.whatsappBotNumber || '').replace(/\D/g, '');
    // Show whenever the channel is enabled (parity with Telegram). The actual
    // link needs the official WhatsApp number; until the admin sets it we show a
    // friendly "coming soon" instead of hiding the whole section. v12.06
    if (!platformSettings.whatsappBotEnabled) return null;

    const handleLink = async () => {
        if (busy) return;
        if (!number) {
            customAlert(isAr ? '🟢 ربط واتساب قيد التفعيل — سيتوفّر قريباً.' : '🟢 WhatsApp linking is coming soon.');
            return;
        }
        setBusy(true);
        try {
            const { data, error } = await supabase.rpc('bot_create_link_token');
            if (error || !data) {
                customAlert(isAr
                    ? '⚠️ سجّل دخولك لحسابك أولاً ثم أعد المحاولة لربط واتساب.'
                    : '⚠️ Sign in to your account first, then retry to link WhatsApp.');
                return;
            }
            const url = `https://wa.me/${number}?text=${encodeURIComponent('link_' + data)}`;
            const win = window.open(url, '_blank');
            if (!win && navigator.clipboard) {
                await navigator.clipboard.writeText(url);
                customAlert(isAr
                    ? '🔗 تم نسخ رابط الربط. افتح واتساب والصقه ثم أرسله لإتمام الربط.'
                    : '🔗 Link copied. Open WhatsApp, paste it and send to finish linking.');
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
                background: 'linear-gradient(135deg, #128C7E 0%, #25D366 100%)',
                color: '#fff', fontSize: compact ? 14 : 15, fontWeight: 700,
                boxShadow: '0 4px 14px rgba(37,211,102,0.35)',
                opacity: busy ? 0.7 : 1, transition: 'transform .15s ease',
            }}
            onMouseDown={e => (e.currentTarget.style.transform = 'scale(0.98)')}
            onMouseUp={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.16c-.25.69-1.43 1.32-1.97 1.4-.5.08-1.14.11-1.84-.12-.42-.13-.97-.31-1.67-.61-2.94-1.27-4.86-4.23-5.01-4.43-.15-.2-1.2-1.6-1.2-3.05 0-1.45.76-2.16 1.03-2.46.27-.3.59-.37.79-.37.2 0 .39 0 .56.01.18.01.42-.07.66.5.25.59.84 2.04.91 2.19.07.15.12.32.02.52-.1.2-.15.32-.3.49-.15.17-.31.39-.45.52-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.02 1.12 1 2.07 1.31 2.37 1.46.3.15.47.13.65-.08.18-.2.74-.86.94-1.16.2-.3.39-.25.66-.15.27.1 1.7.8 1.99.95.3.15.5.22.57.35.07.13.07.74-.18 1.43Z"/>
            </svg>
            {busy
                ? (isAr ? 'جاري التحضير…' : 'Preparing…')
                : (isAr ? 'ربط حسابي بواتساب' : 'Link my WhatsApp')}
        </button>
    );
};

export default WhatsAppLinkButton;
