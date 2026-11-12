/**
 * OrderCloseActions — كيف يُختم طلبٌ في لوحة التاجر (v15.42)
 * ═══════════════════════════════════════════════════════════════════════════
 * كان هذا كلّه داخل `SellerDashboard.tsx`، والسقّافة تمنع نموّه سطراً واحداً
 * عمداً. فحين احتاج اختصارُ التسليم مكاناً، كان الصواب **تقليصاً حقيقياً**:
 * خرجت كلُّ طرق إغلاق الطلب إلى ملفٍّ واحد — فصار للمسألة موضعٌ واحد يُقرأ.
 *
 * وفيه ثلاثُ طرقٍ لا واحدة، وترتيبُها مقصود:
 *   ١) مسحُ كود المشتري   — الأصل، فوريٌّ بلا أي مهلة.
 *   ٢) كتابةُ الكود يدوياً — بديلُ المسح حين تتعذّر الكاميرا، فوريٌّ كذلك.
 *   ٣) «تم التسليم» بلا كود — أمرُ ناصر (v15.42)، و**بعد مهلةٍ** وحدها.
 *
 * 🔴 ولماذا المهلة على الثالثة وحدها: الكودُ شاهدٌ على حضور المشتري، والختمُ
 *    بلا كودٍ بلا شاهد — فلو كان فورياً أمكن ختمُ كلِّ طلبٍ لحظةَ وصوله.
 *    ومسارُ الكود يبقى فورياً فلا يُؤذى عميلٌ واقفٌ عند الصندوق بعد دقيقتين.
 * 🔴 والقاعدة هي الحَكَم: `merchant_handover_booking` تفرض نفسَ المهلة
 *    (P0028) وتتحقّق من ملكيّة المتجر — وهذه الشاشة مرآةٌ لا حارس.
 *
 * 🪤 وحدُّ هذا كلِّه، مقيساً ومذكوراً كي لا يُفهم أكثر مما هو (فحصُ ٤٢–٤٤):
 *    **الكودُ ليس إثباتَ حضورٍ أمام التاجر** — `bookings.barcode` معروضٌ على
 *    بطاقة الطلب في لوحته هو، والطريقان ١ و٢ يقارنان المكتوبَ بذلك الحقل.
 *    فالمهلةُ على الطريق الثالث تؤخّر الختمَ بلا شاهد، ولا تمنع تاجراً ينسخ
 *    الكودَ من شاشته. و`complete_booking`/`bot_complete_booking` بلا بوّابةِ
 *    مهلةٍ **عمداً**: لا مسارَ كودٍ في تيليجرام أصلاً، فحجبُها يترك تاجرَ
 *    تيليجرام بلا وسيلةِ ختمٍ إطلاقاً. والإصلاحُ الحقيقيّ قيمةٌ قصيرةُ العمر
 *    يرسمها **جهازُ المشتري** — قرارٌ بانتظار ناصر، لا ثغرةٌ منسيّة.
 */
import React from 'react';
import SelfCloseNotice from '../SelfCloseNotice';
import { bookingRepository } from '../../repositories/bookingRepository';
import { normalizeArabicNumerals } from '../../utils/helpers';

interface Props {
    order: { barcode: string; backupCode?: string; bookedAt?: number | null;
             acknowledgedAt?: number | null; expiryTime?: number | null; status?: string };
    isRTL: boolean;
    manualCode: string;
    onManualCodeChange: (v: string) => void;
    inputStyle: React.CSSProperties;
    onScan: () => void;
    completeBooking: (barcode: string) => Promise<boolean> | Promise<void> | void;
    refresh: () => Promise<void> | void;
    customAlert: (msg: string) => Promise<void> | void;
    customConfirm: (msg: string) => Promise<boolean>;
}

export const OrderCloseActions: React.FC<Props> = ({
    order, isRTL, manualCode, onManualCodeChange, inputStyle, onScan,
    completeBooking, refresh, customAlert, customConfirm,
}) => {
    /** الكودُ المُدخل يطابق الباركود أو الرمز الاحتياطي. */
    const codeMatches = (): boolean => {
        const entered = normalizeArabicNumerals((manualCode || '').trim().toUpperCase());
        if (!entered) return false;
        return entered === (order.barcode || '').trim().toUpperCase()
            || entered === (order.backupCode || '').trim().toUpperCase();
    };

    const closeByCode = async () => {
        if (!codeMatches()) {
            await customAlert(isRTL ? 'رمز غير صحيح!' : 'Invalid code!');
            return;
        }
        if (!(await customConfirm(isRTL ? 'هل تم استلام المنتج؟' : 'Product received?'))) return;
        await completeBooking(order.barcode);
        onManualCodeChange('');
        await refresh();
    };

    return (
        <>
            <button onClick={onScan} style={{ flex: 1, padding: '12px', borderRadius: 16, background: 'var(--body-bg)', border: '1px solid var(--border-color)', fontWeight: 800, color: 'var(--text-primary)', transition: 'all 0.2s', cursor: 'pointer' }}>
                {isRTL ? '📷 مسح الكود' : '📷 Scan'}
            </button>
            <div style={{ display: 'flex', flex: 2, gap: 8 }}>
                <input
                    placeholder={isRTL ? 'الرمز المرجعي..' : 'Enter code..'}
                    style={{ ...inputStyle, padding: '12px', flex: 1, minWidth: 100, marginBottom: 0 }}
                    value={manualCode}
                    onChange={e => onManualCodeChange(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') void closeByCode(); }}
                />
                <button onClick={() => void closeByCode()}
                    style={{ width: 60, height: 48, borderRadius: 12, background: 'var(--primary)', color: 'white', border: 'none', fontWeight: 900, cursor: 'pointer' }}>
                    {isRTL ? 'تحقق' : 'Go'}
                </button>
            </div>

            {/* ٣) اختصارُ التسليم بلا كود — أمرُ ناصر، وبعد المهلة وحدها. */}
            <div style={{ width: '100%', marginTop: 8 }}>
                <SelfCloseNotice
                    booking={order}
                    beforeAck={(left, hold) => (isRTL
                        ? `الكود يعمل الآن: امسحه أو اكتبه ليُغلق الطلب فوراً. وزرّ «تم التسليم (بدون كود)» يظهر بعد ${hold} من ضغطك «تأكيد استلام الطلب» — أو بعد ${left} تلقائياً إن لم تؤكّد.`
                        : `The code works now: scan or type it to close the order immediately. The “Handed over (no code)” button appears ${hold} after you press “Confirm receipt” — or automatically in ${left} if you never confirm.`)}
                    waiting={(left, hold) => (isRTL
                        ? `الكود يعمل الآن: امسحه أو اكتبه ليُغلق الطلب فوراً. وزرّ «تم التسليم (بدون كود)» يظهر بعد ${left} (${hold} من تأكيدك).`
                        : `The code works now: scan or type it to close the order immediately. The “Handed over (no code)” button appears in ${left} (${hold} after you confirmed).`)}
                >
                    <button onClick={async () => {
                        if (!(await customConfirm(isRTL
                            ? 'تسليم الطلب بدون كود المشتري؟ سيُغلق الطلب نهائياً.'
                            : 'Hand over without the buyer’s code? The order will be closed.'))) return;
                        try {
                            await bookingRepository.merchantHandover(order.barcode);
                            await refresh();
                            await customAlert(isRTL ? '✅ تم تسليم الطلب وإغلاقه.' : '✅ Order handed over and closed.');
                        } catch (err: any) {
                            // رسالةُ القاعدة عربيةٌ وجاهزة — لا زرّ صامت (درس v13.71).
                            await customAlert(err?.message || (isRTL ? 'تعذّر إتمام التسليم' : 'Could not complete handover'));
                        }
                    }}
                        style={{
                            width: '100%', padding: '12px', borderRadius: 14, border: 'none',
                            background: 'linear-gradient(135deg, #10b981, #047857)', color: '#fff',
                            fontWeight: 900, fontSize: '0.85rem', cursor: 'pointer',
                            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.28)',
                        }}>
                        {isRTL ? '✅ تم التسليم (بدون كود)' : '✅ Handed over (no code)'}
                    </button>
                </SelfCloseNotice>
            </div>
        </>
    );
};

export default OrderCloseActions;
