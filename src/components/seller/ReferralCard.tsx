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
    // v12.34 — تكبير الباركود بالضغط (شاشة كاملة) + مشاركته كصورة.
    const [qrZoom, setQrZoom] = useState(false);
    const [sharingQr, setSharingQr] = useState(false);
    const [savingQr, setSavingQr] = useState(false);

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
    // v12.34 — دقة أعلى (700px) للطباعة والمشاركة كصورة بجودة ممتازة.
    const qrUrl = link ? `https://api.qrserver.com/v1/create-qr-code/?size=700x700&margin=12&data=${encodeURIComponent(link)}` : '';

    // v12.34 — مشاركة الباركود نفسه كصورة PNG (وليس الرابط فقط): نجلب صورة
    // QR ثم نمررها لقائمة المشاركة (واتساب/الصور/…). إن لم يدعم الجهاز مشاركة
    // الملفات نحفظها كملف تنزيل، وأسوأ حالة نرشد للطريقة اليدوية.
    const fetchQrFile = async (): Promise<File> => {
        const resp = await fetch(qrUrl, { mode: 'cors' });
        if (!resp.ok) throw new Error('qr fetch failed');
        const blob = await resp.blob();
        return new File([blob], `taki-qr-${code || 'store'}.png`, { type: 'image/png' });
    };

    // iOS لا يسمح لمواقع الويب بالكتابة في الاستديو (الصور) مباشرة — رابط
    // التنزيل يذهب لتطبيق «الملفات» (ما لاحظه ناصر v12.36). الطريق الرسمي
    // الوحيد للاستديو هو ورقة المشاركة: خيار «حفظ الصورة» فيها يحفظ في الصور.
    const isIOS = (): boolean =>
        /iphone|ipad|ipod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const downloadQr = async () => {
        if (savingQr) return;
        setSavingQr(true);
        try {
            const file = await fetchQrFile();
            const nav: any = navigator;
            if (isIOS() && nav.canShare?.({ files: [file] }) && nav.share) {
                await nav.share({ files: [file], title: 'TAKI QR' });
                onAlert(isRTL
                    ? '💡 اختر «حفظ الصورة» من القائمة لتُحفظ في الاستديو (تطبيق الصور).'
                    : '💡 Choose “Save Image” from the sheet to store it in your Photos.');
                return;
            }
            const url = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            onAlert(isRTL ? '✅ تم حفظ صورة الباركود في التنزيلات.' : '✅ QR image saved to your downloads.');
        } catch (e: any) {
            // إلغاء ورقة المشاركة ليس خطأ.
            if (!String(e?.name || '').includes('Abort')) {
                onAlert(isRTL ? '⚠️ تعذّر الحفظ — اضغط مطوّلاً على صورة الباركود واختر «إضافة إلى الصور».' : '⚠️ Save failed — long-press the QR image and choose “Add to Photos”.');
            }
        } finally {
            setSavingQr(false);
        }
    };

    const shareQrImage = async () => {
        if (!qrUrl || sharingQr) return;
        setSharingQr(true);
        try {
            const file = await fetchQrFile();
            const nav: any = navigator;
            if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
                await nav.share({
                    files: [file],
                    title: 'TAKI',
                    text: isRTL ? 'امسح الباركود وسجّل في تاكي عبر متجرنا 🎁' : 'Scan to join TAKI via our store 🎁',
                });
                return;
            }
            // الجهاز لا يدعم مشاركة الملفات → نحفظ الصورة بدلاً من ذلك.
            await downloadQr();
        } catch (e: any) {
            // إلغاء المستخدم للمشاركة ليس خطأ — أي فشل آخر نرشده للبديل.
            if (!String(e?.name || '').includes('Abort')) {
                onAlert(isRTL ? '⚠️ تعذّرت مشاركة الصورة — جرّب «حفظ الباركود» ثم أرسله من الصور.' : '⚠️ Could not share the image — try “Save QR” then send it from your photos.');
            }
        } finally {
            setSharingQr(false);
        }
    };

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
                                <div style={{ textAlign: 'center', background: '#ffffff', borderRadius: 16, padding: 18, border: '1px solid var(--border-color)' }}>
                                    {/* v12.34 — الباركود أكبر (يملأ عرض البطاقة حتى 340px) + اضغط للتكبير */}
                                    <img
                                        src={qrUrl}
                                        alt="Referral QR"
                                        onClick={() => setQrZoom(true)}
                                        style={{ width: '100%', maxWidth: 340, height: 'auto', borderRadius: 10, cursor: 'zoom-in', display: 'block', margin: '0 auto' }}
                                    />
                                    <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#0369a1', marginTop: 8 }}>
                                        {isRTL ? '🔍 اضغط على الباركود لتكبيره ملء الشاشة' : '🔍 Tap the QR to view fullscreen'}
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                                        <button type="button" onClick={shareQrImage} disabled={sharingQr}
                                            style={{ flex: 1.4, background: 'linear-gradient(135deg, #10b981, #059669)', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 8px', fontWeight: 900, fontSize: '0.8rem', cursor: sharingQr ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: sharingQr ? 0.7 : 1 }}>
                                            {sharingQr
                                                ? (isRTL ? '⏳ جاري التجهيز…' : '⏳ Preparing…')
                                                : (isRTL ? '📤 مشاركة الباركود كصورة' : '📤 Share QR as image')}
                                        </button>
                                        <button type="button" onClick={downloadQr} disabled={savingQr}
                                            style={{ flex: 1, background: '#0f172a', color: '#fff', border: 'none', borderRadius: 12, padding: '12px 8px', fontWeight: 900, fontSize: '0.8rem', cursor: savingQr ? 'wait' : 'pointer', fontFamily: 'inherit', opacity: savingQr ? 0.7 : 1 }}>
                                            {savingQr
                                                ? (isRTL ? '⏳ جاري التجهيز…' : '⏳ Preparing…')
                                                : isIOS()
                                                    ? (isRTL ? '📷 حفظ في الاستديو' : '📷 Save to Photos')
                                                    : (isRTL ? '⬇️ حفظ الصورة' : '⬇️ Save image')}
                                        </button>
                                    </div>
                                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#334155', marginTop: 10, lineHeight: 1.6 }}>
                                        {isRTL
                                            ? 'اطبع الباركود وعلّقه في متجرك أو أرسله لعملائك — مسحه يفتح صفحة التسجيل مباشرة في المتصفح (لا يحتاج العميل تحميل أي تطبيق).'
                                            : 'Print this QR in your store or send it to customers — scanning opens the signup page directly in the browser (no app install needed).'}
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

            {/* v12.34 — تكبير ملء الشاشة: خلفية بيضاء نقية = مسح أسهل للكاميرا */}
            {qrZoom && (
                <div
                    onClick={() => setQrZoom(false)}
                    style={{
                        position: 'fixed', inset: 0, zIndex: 99995,
                        background: 'rgba(10,14,25,0.92)', backdropFilter: 'blur(6px)',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        padding: 20, cursor: 'zoom-out',
                    }}
                >
                    <div style={{ background: '#ffffff', borderRadius: 24, padding: 22, maxWidth: '92vw' }}>
                        <img src={qrUrl} alt="Referral QR" style={{ width: 'min(80vw, 460px)', height: 'auto', display: 'block', borderRadius: 12 }} />
                        <div style={{ textAlign: 'center', fontSize: '0.85rem', fontWeight: 900, color: '#0f172a', marginTop: 10, fontFamily: 'monospace', direction: 'ltr' }}>{code}</div>
                    </div>
                    <div style={{ color: '#e2e8f0', fontWeight: 800, fontSize: '0.85rem', marginTop: 16 }}>
                        {isRTL ? 'اضغط في أي مكان للإغلاق' : 'Tap anywhere to close'}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReferralCard;
