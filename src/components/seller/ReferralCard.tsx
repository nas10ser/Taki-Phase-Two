/**
 * ReferralCard v12.30 — «🔗 رابط دعوة عملائك» في لوحة التاجر.
 *
 * كل تاجر له رمز دعوة قصير (يُنشأ مرة واحدة عبر get_my_referral_code) ورابط
 * تسجيل جاهز + باركود QR. أي عميل يسجّل عبر الرابط يُنسب للمتجر تلقائياً
 * (users.referred_by_store) ويظهر للتاجر عدّاد إحالاته — وفي مركز التحكم
 * يرى ناصر أعلى المتاجر إحالةً ليمنحهم خصومات.
 *
 * لماذا الرابط وليس تطبيقاً؟ تاكي تطبيق ويب (PWA): الرابط/الباركود يفتح
 * الموقع مباشرة في المتصفح حتى لو لم يكن التطبيق مثبتاً — فلا يفقد التاجر
 * عميلاً وصله عبر الباركود (نفس مبدأ QR الحجوزات عبر api.qrserver.com).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../../services/supabaseClient';

const ReferralCard: React.FC<{ isRTL: boolean; onAlert: (msg: string) => void }> = ({ isRTL, onAlert }) => {
    const [open, setOpen] = useState(false);
    const [code, setCode] = useState<string | null>(null);
    const [stats, setStats] = useState<{ total: number; last30: number } | null>(null);
    const [loading, setLoading] = useState(false);
    const [showQr, setShowQr] = useState(false);

    const load = useCallback(async () => {
        if (loading || code) return;
        setLoading(true);
        const [{ data: c, error }, { data: s }] = await Promise.all([
            supabase.rpc('get_my_referral_code'),
            supabase.rpc('my_referral_stats'),
        ]);
        setLoading(false);
        if (error || !c) {
            onAlert(isRTL ? '❌ تعذّر إنشاء رمز الدعوة، حاول لاحقاً' : '❌ Could not create your invite code, try later');
            return;
        }
        setCode(String(c));
        const st = s as any;
        setStats({ total: Number(st?.total) || 0, last30: Number(st?.last30) || 0 });
    }, [loading, code, isRTL, onAlert]);

    useEffect(() => { if (open) load(); }, [open, load]);

    const link = code ? `${window.location.origin}/register?ref=${code}` : '';
    const qrUrl = link ? `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(link)}` : '';

    const copyLink = async () => {
        if (!link) return;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(link);
            } else {
                const el = document.createElement('textarea');
                el.value = link;
                el.style.position = 'fixed';
                el.style.opacity = '0';
                document.body.appendChild(el);
                el.select();
                document.execCommand('copy');
                document.body.removeChild(el);
            }
            onAlert(isRTL ? '✅ تم نسخ رابط الدعوة — شاركه مع عملائك!' : '✅ Invite link copied — share it with your customers!');
        } catch {
            onAlert(isRTL ? '❌ تعذّر النسخ، انسخ الرابط يدوياً' : '❌ Copy failed, copy the link manually');
        }
    };

    const shareLink = async () => {
        if (!link) return;
        try {
            if ((navigator as any).share) {
                await (navigator as any).share({
                    title: 'TAKI',
                    text: isRTL ? 'سجّل في تاكي عبر رابط متجرنا واحصل على أقوى التخفيضات:' : 'Join TAKI via our store link for the best deals:',
                    url: link,
                });
                return;
            }
        } catch { /* المستخدم ألغى المشاركة — لا شيء يُعمل */ }
        copyLink();
    };

    return (
        <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border-color)', borderRadius: 20, padding: 16, boxShadow: '0 4px 20px rgba(0,0,0,0.04)' }}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, background: 'none', border: 'none', cursor: 'pointer', textAlign: isRTL ? 'right' : 'left', fontFamily: 'inherit', padding: 0 }}
            >
                <span style={{ fontSize: '1.6rem', flexShrink: 0 }}>🔗</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: '0.95rem', color: 'var(--text-primary)' }}>
                        {isRTL ? 'رابط دعوة عملائك + باركود' : 'Your customer invite link + QR'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, marginTop: 2, lineHeight: 1.5 }}>
                        {isRTL
                            ? 'كل من يسجّل عبر رابطك يُحسب لمتجرك — وقد تحصل على مكافآت من المنصة لأعلى المتاجر دعوةً.'
                            : 'Everyone who signs up via your link is credited to your store — top referring stores may earn platform rewards.'}
                    </div>
                </div>
                <span style={{ fontSize: '1rem', color: 'var(--text-secondary)', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
            </button>

            {open && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {loading || !code ? (
                        <div style={{ height: 64, borderRadius: 14, background: 'var(--gray-100)', animation: 'pulse 1.5s ease-in-out infinite' }} />
                    ) : (
                        <>
                            {stats && (
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <div style={{ flex: 1, textAlign: 'center', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 14, padding: '10px 8px' }}>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 900, color: '#10b981' }}>{stats.total.toLocaleString(isRTL ? 'ar-SA' : 'en-US')}</div>
                                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{isRTL ? 'سجّلوا عبر رابطك' : 'joined via your link'}</div>
                                    </div>
                                    <div style={{ flex: 1, textAlign: 'center', background: 'var(--body-bg)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '10px 8px' }}>
                                        <div style={{ fontSize: '1.2rem', fontWeight: 900, color: 'var(--text-primary)' }}>{stats.last30.toLocaleString(isRTL ? 'ar-SA' : 'en-US')}</div>
                                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{isRTL ? 'آخر ٣٠ يوماً' : 'last 30 days'}</div>
                                    </div>
                                </div>
                            )}

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--body-bg)', border: '1.5px solid var(--border-color)', borderRadius: 14, padding: '10px 12px' }}>
                                <span style={{ flex: 1, minWidth: 0, fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', direction: 'ltr', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                                    {link}
                                </span>
                                <button type="button" onClick={copyLink} style={{ flexShrink: 0, background: 'var(--primary)', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 12px', fontWeight: 800, fontSize: '0.75rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                                    📋 {isRTL ? 'نسخ' : 'Copy'}
                                </button>
                            </div>

                            <div style={{ display: 'flex', gap: 10 }}>
                                <button type="button" onClick={shareLink} style={{ flex: 1, background: '#25d366', color: '#fff', border: 'none', borderRadius: 14, padding: 12, fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                                    📤 {isRTL ? 'مشاركة الرابط' : 'Share link'}
                                </button>
                                <button type="button" onClick={() => setShowQr(q => !q)} style={{ flex: 1, background: 'var(--dark, #0f172a)', color: '#fff', border: 'none', borderRadius: 14, padding: 12, fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer', fontFamily: 'inherit' }}>
                                    {showQr ? (isRTL ? '🙈 إخفاء الباركود' : '🙈 Hide QR') : (isRTL ? '🔳 عرض الباركود' : '🔳 Show QR')}
                                </button>
                            </div>

                            {showQr && (
                                <div style={{ textAlign: 'center', background: '#ffffff', borderRadius: 16, padding: 16, border: '1px solid var(--border-color)' }}>
                                    <img src={qrUrl} alt="Referral QR" width={220} height={220} style={{ borderRadius: 8 }} />
                                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginTop: 8, lineHeight: 1.6 }}>
                                        {isRTL
                                            ? 'اطبع الباركود وعلّقه في متجرك — مسحه يفتح صفحة التسجيل مباشرة في المتصفح (لا يحتاج العميل تحميل أي تطبيق).'
                                            : 'Print this QR in your store — scanning opens the signup page directly in the browser (no app install needed).'}
                                    </div>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 800, color: '#64748b', marginTop: 6, fontFamily: 'monospace', direction: 'ltr' }}>
                                        {isRTL ? 'رمزك:' : 'Your code:'} {code}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

export default ReferralCard;
