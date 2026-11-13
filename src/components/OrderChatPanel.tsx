/**
 * OrderChatPanel — محادثةُ الطلب حيث تُفتح، وبوّابتُها معها (v16.18)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 **لماذا خرجت من `SellerDashboard`**: المحادثةُ كانت في قائمة «نشطة»
 *    وحدها. وبعد v16.18 صار المشتري يكتب عن عيبٍ في بضاعته **بعد** إغلاق
 *    الطلب — والبطاقةُ حينها انتقلت إلى «السجلّ». أي أن الرسالةَ تُقبل على
 *    القاعدة **ولا يراها التاجرُ أبداً**: إصلاحٌ نصفُه عيب.
 *    فصارت المحادثةُ في القائمتين، وبوّابتُها في موضعٍ واحدٍ يُقرأ.
 *
 * 🪤 وخروجُها إلى هنا فرضَته السقّافة (`check-file-size.js`) — والقاعدةُ عند
 *    رفضها «قلّص لا ترفع السقف». وكان الخروجُ مكسباً: الشرطُ كان سيُكتب
 *    مرّتين في نفس الملفّ، ونسختان تنحرفان.
 * 🔴 والقاعدةُ هي الحَكَم (`taki_chat_window_open` على جدة) — وهذا مرآةٌ
 *    لا حارس: وظيفتُه ألّا يُعرض مربّعُ كتابةٍ يرفضه الخادم.
 */
import React from 'react';
import BookingThread from './BookingThread';
import { useApp } from '../context/AppContext';
import { isChatOpen } from '../utils/chatWindow';

const OrderChatPanel: React.FC<{
    order: { barcode: string; status?: string; completedAt?: number | null; expiryTime?: number | null };
    myRole: 'buyer' | 'seller';
    /** `true` في قوائم «السجلّ»: لا يُعرض شيءٌ أصلاً بعد انتهاء النافذة. */
    hideWhenClosed?: boolean;
}> = ({ order, myRole, hideWhenClosed = false }) => {
    const { platformSettings } = useApp();
    const open = isChatOpen(order, platformSettings.chatAfterCloseHours);
    if (hideWhenClosed && !open) return null;
    return <BookingThread barcode={order.barcode} myRole={myRole} />;
};

export default OrderChatPanel;
