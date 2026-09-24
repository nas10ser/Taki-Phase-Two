import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';
import { complaintRepository, ComplaintCategory } from '../repositories/complaintRepository';
import { useEscClose } from '../hooks/useEscClose';
// 🪤 الرقم لا يُصاغ يدوياً: «6 ساعة» خطأ نحويّ، و«1 hours» مثله.
//    هذا الملفّ هو المكان الوحيد الذي يتحوّل فيه رقمُ ساعاتٍ إلى نصّ.
import { holdLabelGen } from '../utils/bookingHold';

/**
 * نموذج الشكوى (v14.92).
 *
 * 🔴 ما كان ناقصاً: **المرفقات**. وسياسةُ الاسترداد المنشورة توجّه المشتري
 *    إلى هذا الزرّ بعينه وتطلب منه «رقم العملية وتاريخها ولقطة كشف البنك
 *    وأي إثبات إضافي» — والنموذج ثلاثةُ حقولٍ نصّية لا تقبل ملفاً واحداً.
 *    أي أن وثيقةً قانونية كانت تَعِد بما لا يستطيع الكود استقباله.
 *
 * والمرفقات تذهب إلى مستودعٍ **خاص**: لا يقرؤها إلا صاحب الشكوى وفريق
 * الإدارة، وبرابطٍ موقّتٍ لا بعنوانٍ دائم — فكشفُ حسابٍ بنكيّ ليس صورة منتج.
 */

type Props = { isRTL: boolean; onClose: () => void };

const CATS: { key: ComplaintCategory; ar: string; en: string }[] = [
    { key: 'app_issue',   ar: 'مشكلة في التطبيق', en: 'App issue' },
    { key: 'store_issue', ar: 'مشكلة مع متجر',     en: 'Store issue' },
    { key: 'payment',     ar: 'دفع / سعر',         en: 'Payment / price' },
    { key: 'suggestion',  ar: 'اقتراح / تحسين',    en: 'Suggestion' },
    { key: 'other',       ar: 'أخرى',              en: 'Other' },
];

const ComplaintDialog: React.FC<Props> = ({ isRTL, onClose }) => {
    // v14.63 — Escape يُغلق الحوار
    useEscClose(true, onClose);
    const { user, customAlert, platformSettings } = useApp();
    const [cat, setCat] = useState<ComplaintCategory>('app_issue');
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    const [files, setFiles] = useState<File[]>([]);
    const [fileErr, setFileErr] = useState('');
    const pickRef = useRef<HTMLInputElement>(null);
    const slaHours = Number(platformSettings?.complaintsSlaHours) || 24;

    const addFiles = (list: FileList | null) => {
        if (!list?.length) return;
        setFileErr('');
        const next = [...files];
        for (const f of Array.from(list)) {
            if (next.length >= complaintRepository.MAX_FILES) {
                setFileErr(isRTL
                    ? `أقصى عدد مرفقات ${complaintRepository.MAX_FILES}.`
                    : `Maximum ${complaintRepository.MAX_FILES} attachments.`);
                break;
            }
            if (f.size > 5 * 1024 * 1024) {
                setFileErr(isRTL
                    ? `«${f.name}» أكبر من ٥ ميجابايت.`
                    : `"${f.name}" is larger than 5 MB.`);
                continue;
            }
            next.push(f);
        }
        setFiles(next);
        if (pickRef.current) pickRef.current.value = '';
    };

    const submit = async () => {
        if (busy) return;
        const msg = message.trim();
        if (msg.length < 5) {
            customAlert(isRTL ? '⚠️ اكتب تفاصيل الشكوى (5 أحرف على الأقل).' : '⚠️ Please describe your complaint (min 5 chars).');
            return;
        }
        if (!user?.id) {
            customAlert(isRTL ? '⚠️ سجّل الدخول أولاً.' : '⚠️ Please sign in first.');
            return;
        }
        setBusy(true);
        const res = await complaintRepository.create({
            userId: user.id,
            userRole: user.userType,
            category: cat,
            subject,
            message: msg,
        });

        // 🪤 المرفقات تُرفع **بعد** إنشاء الشكوى لأن مسارها يحمل معرّفها،
        //    وفشلُ مرفقٍ لا يُسقط الشكوى نفسها: تصل، ويُقال له ما لم يُرفع.
        let failed = 0;
        if (res.ok && res.id && files.length) {
            const paths: string[] = [];
            for (const f of files) {
                const up = await complaintRepository.uploadAttachment(user.id, res.id, f);
                if (up.ok && up.path) paths.push(up.path); else failed++;
            }
            if (paths.length) await complaintRepository.saveAttachments(res.id, paths);
        }
        setBusy(false);

        if (res.ok) {
            onClose();
            const sent = files.length - failed;
            customAlert(isRTL
                ? `✅ وصلت شكواك.${files.length ? ` (${sent} من ${files.length} مرفقاً)` : ''}\n`
                  + `نردّ خلال ${holdLabelGen(slaHours, true)}، ويصلك الردّ إشعاراً — وتتابعها من «حسابي ← شكاواي».`
                + (failed ? `\n⚠️ تعذّر رفع ${failed} مرفقاً — أرسلها في ردٍّ لاحق.` : '')
                : `✅ Your complaint was received. We reply within ${holdLabelGen(slaHours, false)}; you'll get a notification, and you can follow it in Account → My complaints.`);
        } else {
            // v13.15 — رسالة حدّ الطلبات (⏳ بلاغات كثيرة…) تُعرض كما هي من القاعدة
            customAlert(res.msg || (isRTL
                ? '❌ تعذّر الإرسال. تحقق من الاتصال وحاول مرة أخرى.'
                : '❌ Could not send. Check your connection and try again.'));
        }
    };

    const overlay = (
        <div dir={isRTL ? 'rtl' : 'ltr'} onClick={onClose}
            style={{ position: 'fixed', inset: 0, zIndex: 100001, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            <div onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={isRTL ? 'شكوى' : 'Complaint'}
                style={{
                    background: 'var(--card-bg, #fff)', color: 'var(--text-primary, #111)',
                    width: '100%', maxWidth: 520, borderTopLeftRadius: 24, borderTopRightRadius: 24,
                    padding: 20, paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
                    boxShadow: '0 -8px 30px rgba(0,0,0,0.25)', maxHeight: '88vh', overflowY: 'auto',
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <h3 style={{ margin: 0, fontWeight: 900, fontSize: '1.05rem' }}>
                        📣 {isRTL ? 'إرسال شكوى للإدارة' : 'Send a complaint'}
                    </h3>
                    <button type="button" onClick={onClose} aria-label={isRTL ? 'إغلاق' : 'Close'}
                        style={{ background: 'var(--body-bg,#eee)', border: 'none', borderRadius: '50%', width: 32, height: 32, fontWeight: 900, cursor: 'pointer', color: 'var(--text-primary,#111)' }}>
                        ✕
                    </button>
                </div>
                <p style={{ marginTop: 0, marginBottom: 14, fontSize: '0.8rem', color: 'var(--text-secondary, #666)', fontWeight: 600, lineHeight: 1.7 }}>
                    {isRTL
                        ? 'شكواك تصل الإدارة مباشرة وتُراجَع من مركز التحكم.'
                        : 'Your complaint goes straight to the admin and is reviewed in the control center.'}
                </p>

                <div style={{ fontWeight: 800, fontSize: '0.85rem', marginBottom: 8 }}>{isRTL ? 'النوع' : 'Category'}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {CATS.map(c => {
                        const active = cat === c.key;
                        return (
                            <button key={c.key} type="button" onClick={() => setCat(c.key)}
                                style={{
                                    padding: '8px 14px', borderRadius: 999,
                                    border: active ? '2px solid var(--primary)' : '1.5px solid var(--gray-200, #ddd)',
                                    background: active ? 'var(--primary)' : 'transparent',
                                    color: active ? '#fff' : 'var(--text-primary, #111)',
                                    fontWeight: 800, fontSize: '0.8rem', cursor: 'pointer',
                                }}>
                                {isRTL ? c.ar : c.en}
                            </button>
                        );
                    })}
                </div>

                <input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={isRTL ? 'العنوان (اختياري)' : 'Subject (optional)'}
                    style={{
                        width: '100%', padding: 13, borderRadius: 12, marginBottom: 10,
                        border: '1.5px solid var(--gray-200, #ddd)', background: 'var(--body-bg, #f7f7f7)',
                        color: 'var(--text-primary, #111)', outline: 'none', fontSize: '0.9rem', fontFamily: 'inherit',
                    }}
                />
                <textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder={isRTL ? 'اكتب تفاصيل شكواك…' : 'Describe your complaint…'}
                    style={{
                        width: '100%', minHeight: 120, padding: 14, borderRadius: 14,
                        border: '1.5px solid var(--gray-200, #ddd)', background: 'var(--body-bg, #f7f7f7)',
                        color: 'var(--text-primary, #111)', outline: 'none', resize: 'vertical',
                        fontSize: '0.9rem', fontFamily: 'inherit',
                    }}
                />

                {/* ── المرفقات (v14.92) ──────────────────────────────────
                    سياسةُ الاسترداد تطلب «رقم العملية ولقطة كشف البنك» —
                    فلا بدّ من حقلٍ يستقبلها. مستودعٌ خاص، ورابطٌ موقّت. */}
                <div style={{ marginTop: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                        <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>
                            {isRTL ? 'مرفقات (اختياري)' : 'Attachments (optional)'}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary, #666)', fontWeight: 600 }}>
                            {isRTL
                                ? `صور أو PDF — حتى ${complaintRepository.MAX_FILES} ملفات، ٥ ميجابايت لكلٍّ`
                                : `Images or PDF — up to ${complaintRepository.MAX_FILES} files, 5 MB each`}
                        </span>
                    </div>

                    <input
                        ref={pickRef}
                        type="file"
                        multiple
                        accept="image/*,.pdf,application/pdf"
                        onChange={(e) => addFiles(e.target.files)}
                        style={{ display: 'none' }}
                        aria-hidden="true"
                        tabIndex={-1}
                    />
                    <button
                        type="button"
                        onClick={() => pickRef.current?.click()}
                        disabled={busy || files.length >= complaintRepository.MAX_FILES}
                        style={{
                            width: '100%', padding: 12, borderRadius: 12, cursor: 'pointer',
                            border: '1.5px dashed var(--gray-200, #ddd)', background: 'var(--body-bg, #f7f7f7)',
                            color: 'var(--text-primary, #111)', fontWeight: 800, fontSize: '0.85rem',
                            opacity: files.length >= complaintRepository.MAX_FILES ? 0.55 : 1,
                        }}
                    >
                        📎 {isRTL ? 'أضف صورة أو ملفاً' : 'Add an image or file'}
                    </button>

                    {fileErr && (
                        <div style={{ marginTop: 8, fontSize: '0.76rem', fontWeight: 700, color: 'var(--danger, #c0392b)' }}>
                            {fileErr}
                        </div>
                    )}

                    {files.length > 0 && (
                        <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
                            {files.map((f, i) => (
                                <div key={`${f.name}-${i}`}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        padding: '8px 10px', borderRadius: 10,
                                        background: 'var(--body-bg, #f7f7f7)', border: '1px solid var(--gray-200, #ddd)',
                                    }}>
                                    <span aria-hidden="true">{f.type === 'application/pdf' ? '📄' : '🖼️'}</span>
                                    <span style={{ flex: 1, minWidth: 0, fontSize: '0.78rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {f.name}
                                    </span>
                                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #666)', fontWeight: 700 }}>
                                        {(f.size / 1024).toFixed(0)} KB
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setFiles(files.filter((_, k) => k !== i))}
                                        aria-label={isRTL ? `احذف ${f.name}` : `Remove ${f.name}`}
                                        style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: 900, color: 'var(--text-secondary,#666)' }}
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <p style={{ marginTop: 14, marginBottom: 0, fontSize: '0.76rem', fontWeight: 700, color: 'var(--text-secondary, #666)', lineHeight: 1.8 }}>
                    {isRTL
                        ? `نردّ خلال ${holdLabelGen(slaHours, true)}، ويصلك الردّ إشعاراً. وتتابع شكواك من «حسابي ← شكاواي».`
                        : `We reply within ${holdLabelGen(slaHours, false)} and notify you. Follow it in Account → My complaints.`}
                </p>

                <button type="button" onClick={submit} disabled={busy}
                    style={{
                        marginTop: 16, width: '100%', padding: 15, borderRadius: 14,
                        background: busy ? 'var(--gray-400, #999)' : 'var(--primary)', color: '#fff',
                        fontWeight: 900, fontSize: '1rem', border: 'none', cursor: busy ? 'default' : 'pointer',
                    }}>
                    {busy
                        ? (isRTL ? '⏳ جاري الإرسال…' : '⏳ Sending…')
                        : (isRTL ? '📣 إرسال الشكوى' : '📣 Send complaint')}
                </button>
            </div>
        </div>
    );

    return createPortal(overlay, document.body);
};

export default ComplaintDialog;
