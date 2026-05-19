import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import type { BookingMessage } from '../repositories/bookingRepository';

/**
 * Two-party message thread between buyer and seller for a single booking.
 * Hard cap: 3 messages per side (6 total). When a side reaches its limit,
 * the input is disabled with a "contact directly" hint.
 *
 * Loads messages lazily on mount (if not already in the booking row) and
 * marks the opponent's messages as read on view.
 */
interface Props {
    barcode: string;
    /** What role this UI represents — 'buyer' on Bookings.tsx,
     *  'seller' on the SellerDashboard order card. */
    myRole: 'buyer' | 'seller';
}

const BookingThread: React.FC<Props> = ({ barcode, myRole }) => {
    const {
        language,
        bookings,
        sendBookingMessage,
        fetchBookingMessages,
        markBookingMessagesRead,
    } = useApp();
    const isRTL = language === 'ar';

    const booking = (bookings as any[]).find(b => b.barcode === barcode);
    const messages: BookingMessage[] = booking?.messages || [];
    const haveMessagesFetched = booking?.messages !== undefined;

    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const listRef = useRef<HTMLDivElement | null>(null);

    // Lazy load + mark-read.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!haveMessagesFetched) {
                await fetchBookingMessages(barcode);
            }
            if (!cancelled) markBookingMessagesRead(barcode);
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [barcode]);

    // Realtime-gap recovery. iOS Safari kills the realtime websocket whenever
    // the tab backgrounds (incoming call, lock screen, app switch), and any
    // booking_messages INSERT events that fire during that gap are gone for
    // good — the channel re-subscribes but does NOT replay missed rows.
    // Concrete repro that prompted this fix: buyer sent 3 messages, all 3
    // were stored in the DB, but the seller's UI only showed 2/3 because the
    // 3rd INSERT landed while his tab was in the background. Refetching on
    // visibilitychange + window focus + pageshow closes that gap deterministically.
    useEffect(() => {
        // Was the page genuinely hidden since the last refetch? iOS fires a
        // window `focus` when the soft keyboard dismisses (tapping "Send"),
        // which is NOT a return-from-background — refetching there fired a
        // redundant messages query + mark-read write on every single send.
        // The realtime channel already delivers live messages while
        // foregrounded, so on-focus refetch is only needed after a real hide.
        let wasHidden = false;
        const refetch = () => {
            if (document.visibilityState !== 'visible') return;
            fetchBookingMessages(barcode);
            markBookingMessagesRead(barcode);
        };
        const onVisibility = () => {
            if (document.visibilityState === 'hidden') { wasHidden = true; return; }
            if (document.visibilityState === 'visible') { wasHidden = false; refetch(); }
        };
        const onFocus = () => { if (wasHidden) { wasHidden = false; refetch(); } };
        const onPageHide = () => { wasHidden = true; };
        const onPageShow = (e: PageTransitionEvent) => { if (e.persisted) { wasHidden = false; refetch(); } };
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('focus', onFocus);
        window.addEventListener('pagehide', onPageHide);
        window.addEventListener('pageshow', onPageShow as EventListener);
        return () => {
            document.removeEventListener('visibilitychange', onVisibility);
            window.removeEventListener('focus', onFocus);
            window.removeEventListener('pagehide', onPageHide);
            window.removeEventListener('pageshow', onPageShow as EventListener);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [barcode]);

    // Auto-scroll to the latest message whenever the count grows.
    useEffect(() => {
        if (listRef.current) {
            listRef.current.scrollTop = listRef.current.scrollHeight;
        }
    }, [messages.length]);

    const mineCount = messages.filter(m => m.senderRole === myRole).length;
    const theirCount = messages.filter(m => m.senderRole !== myRole).length;
    const remainingForMe = Math.max(0, 3 - mineCount);
    const reachedMyCap = mineCount >= 3;

    const handleSend = async () => {
        const text = draft.trim();
        if (!text || sending || reachedMyCap) return;
        setSending(true);
        try {
            await sendBookingMessage(barcode, text);
            setDraft('');
        } catch {
            // alert already shown by context
        } finally {
            setSending(false);
        }
    };

    const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const meBubbleBg = 'var(--primary)';
    const meBubbleText = '#ffffff';
    const themBubbleBg = 'var(--body-bg)';
    const themBubbleText = 'var(--text-primary)';

    return (
        <div style={{
            marginTop: 16,
            background: 'var(--card-bg)',
            borderRadius: 16,
            border: '1px solid var(--border-color)',
            padding: 14,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
                <div style={{ fontWeight: 900, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                    💬 {isRTL ? 'محادثة الطلب' : 'Order Chat'}
                </div>
                <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary, var(--gray-400))' }}>
                    {isRTL ? `أنت: ${mineCount}/٣ — الطرف الآخر: ${theirCount}/٣` : `You: ${mineCount}/3 — Other: ${theirCount}/3`}
                </div>
            </div>

            {messages.length === 0 ? (
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, var(--gray-400))', textAlign: 'center', padding: '12px 6px', fontStyle: 'italic' }}>
                    {isRTL ? 'لا توجد رسائل بعد — يمكنك إرسال أول رسالة 💬' : 'No messages yet — send the first one 💬'}
                </div>
            ) : (
                <div
                    ref={listRef}
                    style={{
                        maxHeight: 220,
                        overflowY: 'auto',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        paddingInlineEnd: 4,
                        marginBottom: 10,
                    }}
                >
                    {messages.map(m => {
                        const isMine = m.senderRole === myRole;
                        return (
                            <div key={m.id} style={{
                                alignSelf: isMine ? 'flex-end' : 'flex-start',
                                maxWidth: '82%',
                                background: isMine ? meBubbleBg : themBubbleBg,
                                color: isMine ? meBubbleText : themBubbleText,
                                padding: '8px 12px',
                                borderRadius: 14,
                                borderTopRightRadius: isMine && isRTL ? 4 : 14,
                                borderTopLeftRadius: isMine && !isRTL ? 4 : 14,
                                fontSize: '0.85rem',
                                fontWeight: 600,
                                lineHeight: 1.45,
                                boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            }}>
                                {m.body}
                                <div style={{
                                    fontSize: '0.6rem',
                                    fontWeight: 700,
                                    opacity: 0.75,
                                    marginTop: 4,
                                    textAlign: isMine ? (isRTL ? 'left' : 'right') : (isRTL ? 'right' : 'left'),
                                }}>
                                    {new Date(m.createdAt).toLocaleTimeString(isRTL ? 'ar-SA' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                                    {isMine && (m.readAt ? ' ✓✓' : ' ✓')}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {reachedMyCap ? (
                <div style={{
                    background: 'rgba(245, 158, 11, 0.12)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    color: '#b45309',
                    padding: 10,
                    borderRadius: 10,
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    textAlign: 'center',
                }}>
                    {isRTL
                        ? '⚠️ وصلت الحد الأقصى (٣ رسائل). للاستيضاح، اتصل بالطرف الآخر مباشرة.'
                        : '⚠️ You\'ve reached the 3-message limit. For anything else, contact the other party directly.'}
                </div>
            ) : (
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value.slice(0, 500))}
                        onKeyDown={handleKey}
                        placeholder={isRTL
                            ? `اكتب رسالتك… (متبقي ${remainingForMe})`
                            : `Type your message… (${remainingForMe} left)`}
                        rows={1}
                        disabled={sending}
                        style={{
                            flex: 1,
                            minHeight: 40,
                            maxHeight: 100,
                            resize: 'none',
                            padding: '10px 12px',
                            borderRadius: 12,
                            border: '1.5px solid var(--border-color)',
                            background: 'var(--body-bg)',
                            color: 'var(--text-primary)',
                            fontSize: '0.85rem',
                            fontWeight: 600,
                            fontFamily: 'inherit',
                            outline: 'none',
                            direction: isRTL ? 'rtl' : 'ltr',
                        }}
                    />
                    <button
                        onClick={handleSend}
                        disabled={!draft.trim() || sending}
                        style={{
                            background: !draft.trim() || sending ? 'var(--gray-200)' : 'var(--primary)',
                            color: !draft.trim() || sending ? 'var(--text-secondary, var(--gray-400))' : '#ffffff',
                            border: 'none',
                            borderRadius: 12,
                            padding: '0 16px',
                            minHeight: 40,
                            fontWeight: 900,
                            fontSize: '0.8rem',
                            cursor: !draft.trim() || sending ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {sending ? '…' : (isRTL ? 'إرسال' : 'Send')}
                    </button>
                </div>
            )}
        </div>
    );
};

export default BookingThread;
