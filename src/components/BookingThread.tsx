import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { arMessages } from '../utils/arPlural';
import type { BookingMessage } from '../repositories/bookingRepository';
import { chatAttachments } from '../services/chatAttachments';
import { clickable } from '../utils/clickable';

/**
 * المرفق داخل الفقاعة. المستودع خاصّ، فالصورة لا تُعرض بعنوان مباشر وإنما
 * برابط موقّع يُطلب عند ظهورها. ولذلك تُطلب **مرّة واحدة لكل رسالة** لا عند
 * كل إعادة رسم — وإلا صار فتح المحادثة عشرين نداءً للخادم.
 */
const Attachment: React.FC<{ path: string; isRTL: boolean }> = ({ path, isRTL }) => {
    const [url, setUrl] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let alive = true;
        chatAttachments.signedUrl(path).then(u => {
            if (!alive) return;
            if (u) setUrl(u); else setFailed(true);
        });
        return () => { alive = false; };
    }, [path]);

    if (failed) {
        return (
            <div style={{ fontSize: '0.75rem', fontWeight: 700, opacity: 0.8, marginBottom: 6 }}>
                {isRTL ? '📎 تعذّر تحميل الصورة — حدّث الصفحة' : '📎 Could not load the image'}
            </div>
        );
    }
    return (
        <div style={{
            marginBottom: 6, borderRadius: 10, overflow: 'hidden',
            background: 'rgba(0,0,0,0.08)', minHeight: url ? 0 : 90,
        }}>
            {url && (
                <img
                    src={url}
                    alt={isRTL ? 'مرفق' : 'attachment'}
                    onError={() => setFailed(true)}
                    {...clickable(() => window.open(url, '_blank', 'noopener,noreferrer'), isRTL ? 'فتح المرفق' : 'Open attachment')}
                    style={{ display: 'block', width: '100%', maxHeight: 220, objectFit: 'cover', cursor: 'zoom-in' }}
                />
            )}
        </div>
    );
};

/**
 * Two-party message thread between buyer and seller for a single booking.
 *
 * v14.93 — الحدّ لم يعد ثلاثاً ولا رقماً مثبَّتاً: مصدره
 * `platform_settings.chat_limits.per_booking`، و**صفرٌ يعني بلا حدّ** وهو
 * الافتراض. السبب المقيس: مع التوصيل كانت ثلاث رسائل تُقفل المحادثة قبل أن
 * يتّفق الطرفان على العنوان. والقاعدة هي الحَكَم (`send_booking_message`)،
 * وهذا العدّاد مرآةٌ لها لا مصدر.
 * 🪤 والحارس الباقي `per_hour` لكل مرسِل عبر كل حجوزاته — فهو الجدار التالي.
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
        customAlert,
        platformSettings,
    } = useApp();
    const isRTL = language === 'ar';
    /** 0 = بلا حدّ. */
    const cap = platformSettings.chatLimits.perBooking;

    const booking = (bookings as any[]).find(b => b.barcode === barcode);
    const messages: BookingMessage[] = booking?.messages || [];
    const haveMessagesFetched = booking?.messages !== undefined;

    const [draft, setDraft] = useState('');
    const [sending, setSending] = useState(false);
    const [pending, setPending] = useState<{ file: File; preview: string } | null>(null);
    const [uploading, setUploading] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);

    // معاينة الصورة عنوان blob يحجز ذاكرة حتى يُحرَّر. إغلاق البطاقة قبل
    // الإرسال كان يتركه معلّقاً — ومع بطاقات كثيرة يتراكم بلا حدّ.
    useEffect(() => () => { if (pending) URL.revokeObjectURL(pending.preview); }, [pending]);
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
    const remainingForMe = cap > 0 ? Math.max(0, cap - mineCount) : Infinity;
    const reachedMyCap = cap > 0 && mineCount >= cap;

    const handleSend = async () => {
        const text = draft.trim();
        if ((!text && !pending) || sending || reachedMyCap) return;
        setSending(true);
        try {
            let path: string | null = null;
            if (pending) {
                setUploading(true);
                const up = await chatAttachments.upload(barcode, pending.file);
                setUploading(false);
                if (!up.ok) {
                    // الرفع فشل ⇒ لا تُرسل الرسالة بلا صورتها ولا تُفرغ ما كتبه.
                    await customAlert('⚠️ ' + (up.error || (isRTL ? 'تعذّر رفع الصورة' : 'Upload failed')));
                    return;
                }
                path = up.path!;
            }
            await sendBookingMessage(barcode, text, path);
            setDraft('');
            if (pending) { URL.revokeObjectURL(pending.preview); setPending(null); }
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
                <div style={{ fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary, var(--gray-400))' }}>
                    {cap > 0
                        ? (isRTL ? `أنت: ${mineCount}/${cap} — الطرف الآخر: ${theirCount}/${cap}`
                                 : `You: ${mineCount}/${cap} — Other: ${theirCount}/${cap}`)
                        /* بلا حدّ: يُعرض العدد لا الكسر — كسرٌ مقامُه لا نهاية لا معنى له. */
                        : (isRTL ? `${mineCount} لك · ${theirCount} له` : `${mineCount} yours · ${theirCount} theirs`)}
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
                                {m.attachmentPath && <Attachment path={m.attachmentPath} isRTL={isRTL} />}
                                {m.body === '📎' && m.attachmentPath ? null : m.body}
                                <div style={{
                                    fontSize: '0.75rem',
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
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    textAlign: 'center',
                }}>
                    {isRTL
                        ? `⚠️ وصلت الحد الأقصى (${arMessages(cap)}). للاستيضاح، اتصل بالطرف الآخر مباشرة.`
                        : `⚠️ You've reached the ${cap}-message limit. For anything else, contact the other party directly.`}
                </div>
            ) : (
                <div>
                {pending && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8,
                        padding: 8, borderRadius: 12, background: 'var(--body-bg)',
                        border: '1px solid var(--border-color)',
                    }}>
                        <img src={pending.preview} alt="" style={{ width: 46, height: 46, borderRadius: 8, objectFit: 'cover' }} />
                        <div style={{ flex: 1, minWidth: 0, fontSize: '0.75rem', fontWeight: 800, color: 'var(--text-secondary)' }}>
                            {isRTL ? 'صورة مرفقة' : 'Image attached'}
                            <div style={{ fontWeight: 700, opacity: 0.8 }}>
                                {(pending.file.size / 1048576).toFixed(1)} {isRTL ? 'م.ب' : 'MB'}
                            </div>
                        </div>
                        <button
                            onClick={() => { URL.revokeObjectURL(pending.preview); setPending(null); }}
                            style={{ background: 'none', border: 'none', color: '#f43f5e', fontWeight: 900, fontSize: '0.75rem', cursor: 'pointer' }}
                        >
                            {isRTL ? 'إزالة' : 'Remove'}
                        </button>
                    </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <input
                        ref={fileRef}
                        aria-label={isRTL ? 'إرفاق صورة' : 'Attach an image'}
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={e => {
                            const f = e.target.files?.[0];
                            // تصفير القيمة: بلا هذا لا يُطلق اختيارُ نفس الملف مرّتين متتاليتين أي حدث.
                            e.target.value = '';
                            if (!f) return;
                            if (f.size > 5 * 1024 * 1024) {
                                customAlert(isRTL
                                    ? `⚠️ الصورة ${(f.size / 1048576).toFixed(1)} م.ب — الحدّ ٥ م.ب.`
                                    : `⚠️ ${(f.size / 1048576).toFixed(1)} MB — limit is 5 MB.`);
                                return;
                            }
                            if (pending) URL.revokeObjectURL(pending.preview);
                            setPending({ file: f, preview: URL.createObjectURL(f) });
                        }}
                    />
                    <button
                        onClick={() => fileRef.current?.click()}
                        disabled={sending || !!pending}
                        title={isRTL ? 'إرفاق صورة' : 'Attach an image'}
                        aria-label={isRTL ? 'إرفاق صورة' : 'Attach an image'}
                        style={{
                            background: 'var(--body-bg)', border: '1.5px solid var(--border-color)',
                            borderRadius: 12, minWidth: 44, minHeight: 40, fontSize: '1.05rem',
                            cursor: (sending || pending) ? 'not-allowed' : 'pointer',
                            opacity: (sending || pending) ? 0.5 : 1,
                        }}
                    >📎</button>
                    <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value.slice(0, 500))}
                        onKeyDown={handleKey}
                        placeholder={cap > 0
                            ? (isRTL ? `اكتب رسالتك… (متبقي ${remainingForMe})` : `Type your message… (${remainingForMe} left)`)
                            : (isRTL ? 'اكتب رسالتك…' : 'Type your message…')}
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
                        disabled={(!draft.trim() && !pending) || sending}
                        style={{
                            background: (!draft.trim() && !pending) || sending ? 'var(--gray-200)' : 'var(--primary)',
                            color: (!draft.trim() && !pending) || sending ? 'var(--text-secondary, var(--gray-400))' : '#ffffff',
                            border: 'none',
                            borderRadius: 12,
                            padding: '0 16px',
                            minHeight: 40,
                            fontWeight: 900,
                            fontSize: '0.8rem',
                            cursor: (!draft.trim() && !pending) || sending ? 'not-allowed' : 'pointer',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {uploading ? (isRTL ? 'يرفع…' : 'Uploading…') : sending ? '…' : (isRTL ? 'إرسال' : 'Send')}
                    </button>
                </div>
                </div>
            )}
        </div>
    );
};

export default BookingThread;
