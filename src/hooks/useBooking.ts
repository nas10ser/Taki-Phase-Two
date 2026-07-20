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

    const bookDeal = useCallback((deal: Deal, quantity: number = 1, userId: string = 'anon', prepTime?: string, notes?: string, selectedOptions?: Array<{ g: string; c: string; qty?: number }>): Booking => {
        // v12.53 — selectedOptions: اختيارات المنتج المهيكلة (حارس المخزون يقرؤها)
        return contextBookDeal(deal, quantity, userId, prepTime, notes, selectedOptions);
    }, [contextBookDeal]);

    // Bookings auto-expire 2h after creation regardless of deal lifespan.
    const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
    const effectiveExpiry = (b: Booking): number =>
        Math.min(b.expiryTime, (b.bookedAt || Date.now()) + TWO_HOURS_MS);

    const isBooked = useCallback((dealId: string): boolean => {
        return bookings.some((b) => b.deal.id === dealId && b.userId === user?.id && b.status !== 'completed' && b.status !== 'cancelled' && effectiveExpiry(b) > Date.now());
    }, [bookings, user?.id]);

    const getBooking = useCallback((dealId: string): Booking | undefined => {
        return bookings.find((b) => b.deal.id === dealId && b.userId === user?.id && b.status !== 'completed' && b.status !== 'cancelled' && effectiveExpiry(b) > Date.now());
    }, [bookings, user?.id]);

    const cancelBooking = useCallback((barcode: string) => {
        contextCancelBooking(barcode);
    }, [contextCancelBooking]);

    const completeBooking = useCallback((barcode: string) => {
        contextCompleteBooking(barcode);
    }, [contextCompleteBooking]);

    const acknowledgeBooking = useCallback((barcode: string) => {
        contextAcknowledgeBooking(barcode);
    }, [contextAcknowledgeBooking]);

    return { bookings, bookDeal, isBooked, getBooking, cancelBooking, completeBooking, acknowledgeBooking };
};
