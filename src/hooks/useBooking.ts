import { useCallback } from 'react';
import { Deal, Booking } from '../data/mock';
import { useApp } from '../context/AppContext';

export type { Booking };

export const useBooking = () => {
    const { 
        user,
        bookings, 
        bookDeal: contextBookDeal, 
        cancelBooking: contextCancelBooking, 
        completeBooking: contextCompleteBooking,
        acknowledgeBooking: contextAcknowledgeBooking
    } = useApp();

    const bookDeal = useCallback((deal: Deal, quantity: number = 1, userId: string = 'anon', prepTime?: string, notes?: string, selectedOptions?: Array<{ g: string; c: string; qty?: number }>, locationId?: string | null, paymentMethod?: 'cod' | 'online', fulfillment?: 'pickup' | 'delivery', deliveryAddress?: Record<string, any> | null): Booking & { settled: Promise<{ ok: boolean; error?: string }> } => {
        // v12.53 — selectedOptions: اختيارات المنتج المهيكلة (حارس المخزون يقرؤها)
        // v12.91 — locationId: الفرع المختار للعرض متعدد المواقع (خصم مخزون الفرع)
        // v13.11 — paymentMethod: نية الدفع (cod/online) لإخفاء «ادفع الآن» عن COD
        // v14.06 — fulfillment + deliveryAddress: التوصيل إلى عنوان المشتري
        //          (الرسوم يحسبها حارس القاعدة لا العميل)
        return contextBookDeal(deal, quantity, userId, prepTime, notes, selectedOptions, locationId, paymentMethod, fulfillment, deliveryAddress);
    }, [contextBookDeal]);

    // v14.10 — المهلة يكتبها الخادم وحده الآن، وتختلف بحسب نوع الطلب
    // (استلام ساعتان · توصيل ست ساعات · قابلة للضبط من صفّ إعدادات واحد).
    // ⚠️ كان هنا سقفٌ محلّي `Math.min(expiryTime, bookedAt + ساعتين)` يقصّ أي
    // مهلة أطول — وهو نفس خطأ v12.07 لكن على جانب العميل: كان سيَعتبر طلب
    // التوصيل ميتاً بعد ساعتين وهو حيٌّ في القاعدة، فيُظهر «احجز الآن» على
    // طلبٍ قائم. المهلة الوحيدة الصحيحة هي التي جاءت من الخادم.
    const effectiveExpiry = (b: Booking): number => b.expiryTime;

    const isBooked = useCallback((dealId: string): boolean => {
        return bookings.some((b) => b.deal.id === dealId && b.userId === user?.id && b.status !== 'completed' && b.status !== 'cancelled' && effectiveExpiry(b) > Date.now());
    }, [bookings, user?.id]);

    const getBooking = useCallback((dealId: string): Booking | undefined => {
        return bookings.find((b) => b.deal.id === dealId && b.userId === user?.id && b.status !== 'completed' && b.status !== 'cancelled' && effectiveExpiry(b) > Date.now());
    }, [bookings, user?.id]);

    // 🔴 v14.79 — الأغلفة الثلاثة كانت **تبتلع الوعد**: `(barcode) => { ctx(barcode); }`
    //    تُرجع `void`، فكل `await cancelBooking(...)` عند المنادين كان ينتظر
    //    `undefined` ويمضي فوراً. وهذا هو الموضع الذي مُحي فيه الوعد من نظام
    //    الأنواع — لا الواجهة وحدها. الآن يُعاد الوعد كما هو بنتيجته.
    const cancelBooking = useCallback((barcode: string): Promise<boolean> =>
        contextCancelBooking(barcode), [contextCancelBooking]);

    const completeBooking = useCallback((barcode: string): Promise<boolean> =>
        contextCompleteBooking(barcode), [contextCompleteBooking]);

    const acknowledgeBooking = useCallback((barcode: string, note?: string): Promise<boolean> =>
        contextAcknowledgeBooking(barcode, note), [contextAcknowledgeBooking]);

    return { bookings, bookDeal, isBooked, getBooking, cancelBooking, completeBooking, acknowledgeBooking };
};
