import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useHistory } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { supabase } from '../services/supabaseClient';
import Navbar from '../components/Navbar';
import BottomNav from '../components/BottomNav';
import { CATEGORIES } from '../data/mock';
import { toHijri } from '../utils/helpers';

/**
 * Universal Booking Receipt — /booking/:barcode
 *
 * The destination for booking / sale notifications. Before v11.57 a "💰 إتمام
 * بيع جديد" notification opened /deal/{id}, which rendered "العرض غير موجود"
 * whenever the deal had since been deleted (e.g. a finished promo or a bot
 * test deal). This page instead resolves the BOOKING by its barcode via the
 * SECURITY-DEFINER RPC get_booking_card — authorized for the booking's buyer,
 * its seller, or any admin — and shows the full receipt IN the app, exactly as
 * if the order had been placed here. It survives a deleted deal (the item
 * fields just come back empty) and degrades gracefully for genuinely-removed
 * test bookings instead of dead-ending on a scary error page.
 */

interface ReceiptData {
    error?: string;
    barcode: string;
    backup_code?: string | null;
    status: 'pending' | 'acknowledged' | 'completed' | 'cancelled';
    booked_quantity: number;
    booked_at?: number | null;
    expiry_time?: number | null;
    completed_at?: string | null;
    prep_time?: string | null;
    notes?: string | null;
    merchant_note?: string | null;
    deal_id?: string | null;
    deal_exists?: boolean;
    item_name?: string | null;
    shop_name?: string | null;
    category?: string | null;
    image?: string | null;
    original_price?: number | null;
    discounted_price?: number | null;
    discount_percentage?: number | null;
    city?: string | null;
    region?: string | null;
    buyer_name?: string | null;
    buyer_phone?: string | null;
    store_id?: string | null;
    user_id?: string | null;
    viewer_is_buyer?: boolean;
    viewer_is_seller?: boolean;
    viewer_is_admin?: boolean;
}

const GREEN = 'var(--primary)';
const AMBER = '#f59e0b';
const RED = '#f43f5e';
const BLUE = '#3b82f6';

const BookingReceipt: React.FC = () => {
    const { barcode } = useParams<{ barcode: string }>();
    const history = useHistory();
    const { language, user, isAuthReady } = useApp();
    const isRTL = language === 'ar';
    const t = (ar: string, en: string) => (isRTL ? ar : en);

    const [data, setData] = useState<ReceiptData | null>(null);
    const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'missing' | 'network'>('loading');

    const load = useCallback(async () => {
        setState('loading');
        try {
            const { data: res, error } = await supabase.rpc('get_booking_card', { p_barcode: barcode });
            if (error) { setState('network'); return; }
            const r = res as ReceiptData | null;
            if (!r || (r.error && r.error === 'not_found')) { setState('missing'); return; }
            if (r.error === 'forbidden' || r.error === 'bad_request') { setState('forbidden'); return; }
            setData(r);
            setState('ready');
        } catch {
            setState('network');
        }
    }, [barcode]);

    useEffect(() => { if (isAuthReady) load(); }, [isAuthReady, load]);

    const wrap = (children: React.ReactNode) => (
        <div className="page-content" style={{ background: 'var(--body-bg)', minHeight: '100vh', paddingBottom: 100, direction: isRTL ? 'rtl' : 'ltr' }}>
            <Navbar />
            <div style={{ padding: '20px 16px', maxWidth: 560, margin: '0 auto' }}>{children}</div>
            <BottomNav />
        </div>
    );

    const centeredCard = (emoji: string, title: string, sub: string, cta?: { label: string; to: string }) => (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 24, padding: '48px 24px', textAlign: 'center', boxShadow: 'var(--shadow-sm)' }}>
            <div style={{ fontSize: '3.4rem', marginBottom: 16 }}>{emoji}</div>
            <div style={{ fontWeight: 900, fontSize: '1.2rem', color: 'var(--text-primary)' }}>{title}</div>
            <div style={{ color: 'var(--text-secondary)', marginTop: 10, fontSize: '0.92rem', lineHeight: 1.6 }}>{sub}</div>
            <button
                onClick={() => (cta ? history.push(cta.to) : history.push('/notifications'))}
                style={{ marginTop: 24, padding: '12px 28px', borderRadius: 14, background: GREEN, color: '#fff', border: 'none', fontWeight: 900, cursor: 'pointer', fontSize: '0.95rem' }}
            >
                {cta ? cta.label : t('العودة للإشعارات', 'Back to notifications')}
            </button>
        </div>
    );

    if (!isAuthReady || state === 'loading') {
        return wrap(
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: 60, gap: 16 }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', border: '3px solid var(--border-color)', borderTopColor: GREEN, animation: 'taki-spin 0.8s linear infinite' }} />
                <style>{`@keyframes taki-spin{to{transform:rotate(360deg)}}`}</style>
                <div style={{ color: 'var(--text-secondary)', fontWeight: 700 }}>{t('جاري تحميل الإيصال…', 'Loading receipt…')}</div>
            </div>
        );
    }
    if (!user && state === 'forbidden') {
        return wrap(centeredCard('🔒', t('يرجى تسجيل الدخول', 'Please sign in'), t('سجّل دخولك لعرض تفاصيل الحجز.', 'Sign in to view this booking.'), { label: t('تسجيل الدخول', 'Sign in'), to: '/register' }));
    }
    if (state === 'forbidden') {
        return wrap(centeredCard('🚫', t('غير مصرّح', 'Not allowed'), t('لا تملك صلاحية عرض هذا الحجز.', 'You are not allowed to view this booking.')));
    }
    if (state === 'missing') {
        return wrap(centeredCard('🗂️', t('هذا الحجز لم يعد متاحاً', 'This booking is no longer available'), t('قد يكون حجزاً تجريبياً قديماً تم حذفه. تصفّح أحدث العروض من الرئيسية.', 'It may be an old test booking that was removed. Browse the latest deals from Home.'), { label: t('تصفّح العروض', 'Browse deals'), to: '/' }));
    }
    if (state === 'network' || !data) {
        return wrap(
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 24, padding: '48px 24px', textAlign: 'center', boxShadow: 'var(--shadow-sm)' }}>
                <div style={{ fontSize: '3rem', marginBottom: 14 }}>📶</div>
                <div style={{ fontWeight: 900, color: 'var(--text-primary)' }}>{t('تعذّر تحميل الإيصال', 'Could not load the receipt')}</div>
                <button onClick={load} style={{ marginTop: 22, padding: '12px 28px', borderRadius: 14, background: GREEN, color: '#fff', border: 'none', fontWeight: 900, cursor: 'pointer' }}>{t('إعادة المحاولة', 'Retry')}</button>
            </div>
        );
    }

    // ── Ready ──────────────────────────────────────────────────────────────
    const cancelled = data.status === 'cancelled';
    const done = data.status === 'completed';
    const ack = data.status === 'acknowledged' || done;
    const accent = cancelled ? RED : done ? GREEN : ack ? BLUE : AMBER;

    const statusInfo: Record<ReceiptData['status'], { emoji: string; ar: string; en: string }> = {
        pending: { emoji: '⏳', ar: 'قيد الانتظار', en: 'Pending' },
        acknowledged: { emoji: '👨‍🍳', ar: 'قيد التجهيز', en: 'Preparing' },
        completed: { emoji: '🎉', ar: 'تم الاستلام', en: 'Completed' },
        cancelled: { emoji: '❌', ar: 'ملغي', en: 'Cancelled' },
    };
    const si = statusInfo[data.status] || statusInfo.pending;
    const cat = CATEGORIES.find(c => c.id === data.category);
    const qty = data.booked_quantity || 1;
    const unit = Number(data.discounted_price ?? 0);
    const orig = Number(data.original_price ?? 0);
    const total = unit * qty;
    const saved = Math.max(0, (orig - unit) * qty);
    const money = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });

    const fmtDateTime = (ms?: number | string | null): { greg: string; hijri: string } | null => {
        if (ms == null) return null;
        const d = typeof ms === 'number' ? new Date(ms) : new Date(ms);
        if (isNaN(d.getTime())) return null;
        const greg = d.toLocaleString(isRTL ? 'ar-SA' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' });
        const iso = d.toISOString().slice(0, 10);
        return { greg, hijri: toHijri(iso) };
    };
    const booked = fmtDateTime(data.booked_at);
    const completed = fmtDateTime(data.completed_at);

    const row = (label: string, value: React.ReactNode) => (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px dashed var(--border-color)' }}>
            <span style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.9rem' }}>{label}</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 800, fontSize: '0.95rem', textAlign: isRTL ? 'left' : 'right' }}>{value}</span>
        </div>
    );

    const node = (active: boolean, color: string) => ({
        width: 30, height: 30, borderRadius: 15, flexShrink: 0,
        background: active ? color : 'var(--gray-200)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem', fontWeight: 900,
    } as React.CSSProperties);
    const bar = (active: boolean, color: string) => ({ flex: 1, height: 3, background: active ? color : 'var(--gray-200)', borderRadius: 2 } as React.CSSProperties);
    const stepLbl = { fontSize: '0.66rem', fontWeight: 800, color: 'var(--text-secondary)', textAlign: 'center', marginTop: 5 } as React.CSSProperties;

    const chatTo = data.viewer_is_buyer
        ? `/bookings?barcode=${data.barcode}`
        : data.viewer_is_seller
            ? `/seller?tab=orders&barcode=${data.barcode}`
            : null;

    return wrap(
        <>
            {/* Hero status card */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 24, boxShadow: 'var(--shadow-sm)', overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ height: 6, background: accent }} />
                <div style={{ padding: '22px 22px 6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                        <div style={{ width: 56, height: 56, borderRadius: 18, background: `${accent}1a`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.7rem' }}>{si.emoji}</div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 900, fontSize: '1.15rem', color: accent }}>{isRTL ? si.ar : si.en}</div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', fontWeight: 700 }}>{t('حجز عبر تاكي', 'TAKI booking')}</div>
                        </div>
                    </div>

                    {/* Progress timeline (hidden for cancelled-from-pending visual noise) */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', padding: '4px 4px 18px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 56 }}>
                            <div style={node(true, cancelled ? RED : GREEN)}>{cancelled ? '✕' : '✓'}</div>
                            <div style={stepLbl}>{t('مؤكد', 'Booked')}</div>
                        </div>
                        <div style={{ flex: 1, paddingTop: 13 }}><div style={bar(cancelled || ack, cancelled ? RED : GREEN)} /></div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 56 }}>
                            <div style={node(cancelled || ack, cancelled ? RED : BLUE)}>{cancelled ? '✕' : ack ? '✓' : ''}</div>
                            <div style={stepLbl}>{t('قيد التجهيز', 'Preparing')}</div>
                        </div>
                        <div style={{ flex: 1, paddingTop: 13 }}><div style={bar(cancelled || done, cancelled ? RED : GREEN)} /></div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 56 }}>
                            <div style={node(cancelled || done, cancelled ? RED : GREEN)}>{cancelled ? '✕' : done ? '✓' : ''}</div>
                            <div style={stepLbl}>{t('مكتمل', 'Done')}</div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Item card */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 24, boxShadow: 'var(--shadow-sm)', padding: 18, marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    <div style={{ width: 76, height: 76, borderRadius: 18, overflow: 'hidden', flexShrink: 0, background: 'var(--gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem' }}>
                        {data.image ? <img src={data.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : (cat?.emoji || '🛍️')}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 900, fontSize: '1.05rem', color: 'var(--text-primary)' }}>
                            {data.item_name || t('منتج غير متوفّر', 'Item unavailable')}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', fontWeight: 700, fontSize: '0.85rem', marginTop: 4 }}>
                            🏪 {data.shop_name || '—'}{(data.city || data.region) ? `  •  📍 ${data.city || data.region}` : ''}
                        </div>
                        {cat && <div style={{ display: 'inline-block', marginTop: 8, fontSize: '0.72rem', fontWeight: 800, color: 'var(--text-secondary)', background: 'var(--gray-100)', padding: '3px 10px', borderRadius: 20 }}>{cat.emoji} {isRTL ? cat.ar : cat.en}</div>}
                    </div>
                </div>

                <div style={{ marginTop: 14 }}>
                    {row(t('الكمية', 'Quantity'), `×${qty}`)}
                    {unit > 0 && row(t('سعر القطعة', 'Unit price'), `${money(unit)} ${t('ر.س', 'SAR')}`)}
                    {unit > 0 && row(t('الإجمالي', 'Total'), <span style={{ color: GREEN, fontSize: '1.05rem' }}>{money(total)} {t('ر.س', 'SAR')}</span>)}
                    {saved > 0 && row(t('وفّرت', 'You saved'), <span style={{ color: GREEN }}>{money(saved)} {t('ر.س', 'SAR')}</span>)}
                    {data.prep_time && row(t('وقت التجهيز', 'Prep time'), data.prep_time)}
                </div>
            </div>

            {/* Barcode card */}
            <div style={{ background: 'var(--card-bg)', border: `1.5px solid ${accent}`, borderRadius: 24, boxShadow: 'var(--shadow-sm)', padding: '20px 18px', marginBottom: 16, textAlign: 'center' }}>
                <div style={{ color: 'var(--text-secondary)', fontWeight: 800, fontSize: '0.8rem', marginBottom: 8 }}>{t('باركود الحجز', 'Booking barcode')}</div>
                <div style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: '1.9rem', letterSpacing: '0.35rem', color: 'var(--text-primary)' }}>{data.barcode}</div>
                {data.backup_code && <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', fontWeight: 700, marginTop: 6 }}>{t('كود احتياطي', 'Backup')}: {data.backup_code}</div>}
                {!done && !cancelled && <div style={{ color: 'var(--text-secondary)', fontSize: '0.78rem', marginTop: 10 }}>{t('أظهر هذا الباركود للبائع عند الاستلام', 'Show this barcode to the seller on pickup')}</div>}
            </div>

            {/* Details card */}
            <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 24, boxShadow: 'var(--shadow-sm)', padding: 18, marginBottom: 16 }}>
                {booked && row(t('وقت الحجز', 'Booked at'), <span>{booked.greg}{booked.hijri ? ` — ${booked.hijri}` : ''}</span>)}
                {done && completed && row(t('وقت الاستلام', 'Completed at'), <span>{completed.greg}{completed.hijri ? ` — ${completed.hijri}` : ''}</span>)}
                {(data.viewer_is_seller || data.viewer_is_admin) && data.buyer_name && row(t('العميل', 'Customer'), data.buyer_name)}
                {(data.viewer_is_seller || data.viewer_is_admin) && data.buyer_phone && row(t('جوال العميل', 'Customer phone'), <a href={`tel:${data.buyer_phone}`} style={{ color: GREEN, textDecoration: 'none' }}>{data.buyer_phone}</a>)}
                {data.notes && row(t('ملاحظة العميل', 'Customer note'), data.notes)}
                {data.merchant_note && row(t('ملاحظة التاجر', 'Seller note'), data.merchant_note)}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {chatTo && (
                    <button onClick={() => history.push(chatTo)} style={{ padding: '14px', borderRadius: 16, background: GREEN, color: '#fff', border: 'none', fontWeight: 900, cursor: 'pointer', fontSize: '0.98rem' }}>
                        💬 {t('فتح المحادثة', 'Open chat')}
                    </button>
                )}
                {data.deal_exists && data.deal_id && (
                    <button onClick={() => history.push(`/deal/${data.deal_id}`)} style={{ padding: '14px', borderRadius: 16, background: 'var(--card-bg)', color: 'var(--text-primary)', border: '1.5px solid var(--border-color)', fontWeight: 800, cursor: 'pointer', fontSize: '0.95rem' }}>
                        🛍️ {t('عرض المنتج', 'View product')}
                    </button>
                )}
                <button onClick={() => history.push('/notifications')} style={{ padding: '13px', borderRadius: 16, background: 'transparent', color: 'var(--text-secondary)', border: 'none', fontWeight: 800, cursor: 'pointer', fontSize: '0.9rem' }}>
                    ◀️ {t('رجوع للإشعارات', 'Back to notifications')}
                </button>
            </div>
        </>
    );
};

export default BookingReceipt;
