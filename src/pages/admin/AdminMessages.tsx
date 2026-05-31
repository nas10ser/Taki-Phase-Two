/**
 * AdminMessages (v11.24) — مراقبة الرسائل اللحظية.
 *
 * Lists every booking conversation on the platform, newest activity first,
 * with both parties' identities + the booking barcode. The admin opens any
 * thread to read it live (realtime + 8s poll fallback), delete any message,
 * or warn either party. Moderation actions (delete/warn) are gated on the
 * `action_moderate_messages` permission; the tab itself on `tab_messages`.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { supabase } from '../../services/supabaseClient';
import { adminMessageRepository, AdminThread, AdminMessage } from '../../repositories/adminMessageRepository';

const timeAgo = (iso: string | null): string => {
    if (!iso) return '';
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 60000);
    if (m < 1) return 'الآن';
    if (m < 60) return `قبل ${m} د`;
    const h = Math.floor(m / 60);
    if (h < 24) return `قبل ${h} س`;
    return `قبل ${Math.floor(h / 24)} ي`;
};

const AdminMessages: React.FC = () => {
    const { customAlert, customConfirm, customPrompt, hasPermission } = useApp();
    const canModerate = hasPermission('action_moderate_messages');

    const [threads, setThreads] = useState<AdminThread[]>([]);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [active, setActive] = useState<AdminThread | null>(null);
    const [messages, setMessages] = useState<AdminMessage[]>([]);
    const [loadingMsgs, setLoadingMsgs] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);

    const loadThreads = useCallback(async () => {
        const list = await adminMessageRepository.listThreads(search, 200);
        setThreads(list);
        setLoading(false);
    }, [search]);

    // Initial + search-driven load, plus an 8s poll so new conversations
    // surface even if realtime misses (iOS Safari throttles SW/WS).
    useEffect(() => {
        setLoading(true);
        loadThreads();
        const id = window.setInterval(loadThreads, 8000);
        return () => window.clearInterval(id);
    }, [loadThreads]);

    // Realtime: any new message anywhere refreshes the thread list and, if the
    // affected thread is open, its messages — "lحظة بلحظة" as requested.
    useEffect(() => {
        const channel = supabase
            .channel('admin-msg-monitor')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'booking_messages' }, (payload: any) => {
                loadThreads();
                const bc = (payload?.new || payload?.old)?.barcode;
                if (active && bc === active.barcode) openThread(active, true);
            })
            .subscribe();
        return () => { supabase.removeChannel(channel); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, loadThreads]);

    const openThread = async (t: AdminThread, silent = false) => {
        setActive(t);
        if (!silent) setLoadingMsgs(true);
        const msgs = await adminMessageRepository.getMessages(t.barcode);
        setMessages(msgs);
        setLoadingMsgs(false);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: silent ? 'auto' : 'smooth' }), 50);
    };

    const handleDelete = async (m: AdminMessage) => {
        if (!canModerate) { await customAlert('🚫 لا تملك صلاحية حذف الرسائل'); return; }
        const ok = await customConfirm('حذف هذه الرسالة نهائياً؟');
        if (!ok) return;
        const prev = messages;
        setMessages(messages.filter(x => x.id !== m.id)); // optimistic
        const res = await adminMessageRepository.deleteMessage(m.id);
        if (!res.success) {
            setMessages(prev);
            await customAlert('❌ ' + (res.error ?? 'فشل الحذف'));
        }
    };

    const handleWarn = async (userId: string | null, name: string | null) => {
        if (!userId) return;
        if (!canModerate) { await customAlert('🚫 لا تملك صلاحية الإنذار'); return; }
        const msg = await customPrompt(`نص الإنذار لـ "${name || 'المستخدم'}":`);
        if (!msg || !msg.trim()) return;
        const res = await adminMessageRepository.warnUser(userId, msg.trim());
        await customAlert(res.success ? '✅ تم إرسال الإنذار' : '❌ ' + (res.error ?? 'فشل الإرسال'));
    };

    return (
        <div className="space-y-4 animate-fade-in" dir="rtl">
            <div>
                <h1 className="text-2xl font-extrabold text-[var(--text-primary)]">💬 مراقبة الرسائل</h1>
                <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                    كل المحادثات بين المشترين والتجار، لحظة بلحظة. {canModerate ? 'يمكنك الحذف والإنذار.' : '(عرض فقط — بلا صلاحية حذف/إنذار)'}
                </p>
            </div>

            <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔎 بحث بالاسم، المتجر، الجوال، أو الكود..."
                className="w-full px-4 py-3 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-xl text-sm outline-none focus:border-blue-500"
            />

            <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-4">
                {/* Threads list */}
                <div className="space-y-2 max-h-[70vh] overflow-y-auto">
                    {loading ? (
                        Array.from({ length: 5 }).map((_, i) => <div key={i} className="taki-skeleton h-20 rounded-2xl" />)
                    ) : threads.length === 0 ? (
                        <div className="text-center text-sm text-[var(--text-secondary)] py-10 bg-[var(--card-bg)] rounded-2xl border border-dashed border-[var(--border-color)]">
                            لا توجد محادثات بعد.
                        </div>
                    ) : (
                        threads.map((t) => (
                            <button
                                key={t.barcode}
                                onClick={() => openThread(t)}
                                className={`w-full text-right p-3 rounded-2xl border transition-all ${
                                    active?.barcode === t.barcode
                                        ? 'border-blue-500 bg-blue-500/10'
                                        : 'border-[var(--border-color)] bg-[var(--card-bg)] hover:border-blue-300'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="font-bold text-sm text-[var(--text-primary)] truncate">
                                        🛒 {t.buyerName || '—'} ↔ 🏪 {t.sellerShop || t.sellerName || '—'}
                                    </div>
                                    <span className="text-[10px] text-[var(--text-secondary)] flex-shrink-0">{timeAgo(t.lastAt)}</span>
                                </div>
                                <div className="text-xs text-[var(--text-secondary)] truncate mt-0.5">{t.lastBody}</div>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                    <span className="text-[10px] font-mono bg-[var(--body-bg)] px-1.5 py-0.5 rounded">{t.barcode}</span>
                                    <span className="text-[10px] text-[var(--text-secondary)]">{t.messageCount} رسالة</span>
                                    {t.bookingStatus && <span className="text-[10px] text-[var(--text-secondary)]">• {t.bookingStatus}</span>}
                                </div>
                            </button>
                        ))
                    )}
                </div>

                {/* Thread view */}
                <div className="bg-[var(--card-bg)] rounded-2xl border border-[var(--border-color)] flex flex-col min-h-[50vh] max-h-[70vh]">
                    {!active ? (
                        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-secondary)]">
                            اختر محادثة لعرضها
                        </div>
                    ) : (
                        <>
                            {/* Header with both parties */}
                            <div className="p-3 border-b border-[var(--border-color)] flex items-center justify-between gap-2 flex-wrap">
                                <div className="text-xs">
                                    <div className="font-bold text-[var(--text-primary)]">
                                        🛒 {active.buyerName || '—'} {active.buyerPhone ? `(${active.buyerPhone})` : ''}
                                    </div>
                                    <div className="text-[var(--text-secondary)] mt-0.5">
                                        🏪 {active.sellerShop || active.sellerName || '—'} • كود: <span className="font-mono">{active.barcode}</span>
                                    </div>
                                </div>
                                {canModerate && (
                                    <div className="flex gap-1.5">
                                        <button onClick={() => handleWarn(active.buyerId, active.buyerName)}
                                            className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-700 text-[11px] font-bold hover:bg-amber-500/25">
                                            ⚠️ إنذار المشتري
                                        </button>
                                        <button onClick={() => handleWarn(active.sellerId, active.sellerShop || active.sellerName)}
                                            className="px-2.5 py-1.5 rounded-lg bg-amber-500/15 text-amber-700 text-[11px] font-bold hover:bg-amber-500/25">
                                            ⚠️ إنذار التاجر
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                                {loadingMsgs ? (
                                    <div className="text-center text-sm text-[var(--text-secondary)] py-6">...جاري التحميل</div>
                                ) : messages.length === 0 ? (
                                    <div className="text-center text-sm text-[var(--text-secondary)] py-6">لا رسائل.</div>
                                ) : (
                                    messages.map((m) => {
                                        const isBuyer = m.senderRole === 'buyer';
                                        return (
                                            <div key={m.id} className={`flex ${isBuyer ? 'justify-start' : 'justify-end'}`}>
                                                <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${isBuyer ? 'bg-[var(--body-bg)]' : 'bg-blue-500/15'}`}>
                                                    <div className="flex items-center gap-2 mb-0.5">
                                                        <span className="text-[10px] font-bold text-[var(--text-secondary)]">
                                                            {isBuyer ? '🛒' : '🏪'} {m.senderName || m.senderRole}
                                                        </span>
                                                        <span className="text-[9px] text-[var(--text-secondary)]">{timeAgo(m.createdAt)}</span>
                                                        {canModerate && (
                                                            <button onClick={() => handleDelete(m)}
                                                                className="text-[9px] text-red-500 font-bold hover:underline mr-auto">
                                                                حذف
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="text-sm text-[var(--text-primary)] whitespace-pre-wrap break-words">{m.body}</div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={bottomRef} />
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdminMessages;
