/**
 * Booking Repository — Data access layer for bookings.
 * All data operations are server-only via Supabase.
 */
import { supabase } from '../services/supabaseClient';
import { dealRepository } from './dealRepository';
import { logger } from '../utils/logger';

export interface Booking {
    deal: any;
    barcode: string;
    backupCode: string;
    expiryTime: number;
    bookedAt: number;
    bookedQuantity: number;
    userId: string;
    userName?: string;
    userPhone?: string;
    prepTime?: string;
    notes?: string;
    status: 'pending' | 'acknowledged' | 'completed' | 'cancelled';
}

// Status progression rank — higher = more advanced. When local and remote
// disagree on the same barcode (e.g. seller acknowledged offline, remote
// hasn't synced yet, or RLS briefly rejected the update), prefer the higher
// status so a confirmed receipt never reverts to "pending" on refresh.
const STATUS_RANK: Record<Booking['status'], number> = {
    pending: 0,
    acknowledged: 1,
    completed: 2,
    cancelled: 2
};

const moreAdvanced = (a: Booking['status'], b: Booking['status']) =>
    STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;

export const bookingRepository = {
    getAll: async (): Promise<Booking[]> => {
        // Return empty array if not specific to a user, as we don't fetch all bookings anymore
        return [];
    },

    getByUser: async (userId: string): Promise<Booking[]> => {
        try {
            // Fetch bookings where user is buyer (user_id) OR seller (store_id),
            // so the same call hydrates both sides of the transaction.
            const { data, error } = await supabase
                .from('bookings')
                .select('*')
                .or(`user_id.eq.${userId},store_id.eq.${userId}`);
            if (data && !error) {
                const deals = await dealRepository.getAll();
                const remoteBookings: Booking[] = data.map(b => ({
                    barcode: b.barcode,
                    backupCode: b.backup_code,
                    deal: deals.find(d => d.id === b.deal_id) || { id: b.deal_id, storeId: b.store_id, itemName: 'تخفيض' },
                    userId: b.user_id,
                    bookedQuantity: b.booked_quantity,
                    prepTime: b.prep_time,
                    notes: b.notes,
                    status: b.status as Booking['status'],
                    bookedAt: b.booked_at,
                    expiryTime: b.expiry_time
                } as Booking));

                return remoteBookings;
            }
        } catch (e) {
            console.warn('Remote booking fetch failed:', e);
        }
        return [];
    },

    getByStore: async (storeId: string): Promise<Booking[]> => {
        const all = await bookingRepository.getAll();
        return all.filter(b => b.deal?.storeId === storeId);
    },

    getByBarcode: async (barcode: string): Promise<Booking | undefined> => {
        try {
            const { data, error } = await supabase.from('bookings').select('*').or(`barcode.eq.${barcode},backup_code.eq.${barcode}`).single();
            if (data && !error) {
                const deal = await dealRepository.getById(data.deal_id);
                return {
                    barcode: data.barcode,
                    backupCode: data.backup_code,
                    deal: deal || { id: data.deal_id, storeId: data.store_id, itemName: 'تخفيض' },
                    userId: data.user_id,
                    bookedQuantity: data.booked_quantity,
                    prepTime: data.prep_time,
                    notes: data.notes,
                    status: data.status as Booking['status'],
                    bookedAt: data.booked_at,
                    expiryTime: data.expiry_time
                };
            }
        } catch (e) {
            console.error('Remote fetch by barcode failed:', e);
        }
        return undefined;
    },

    save: async (booking: Booking): Promise<void> => {
        // Sync to remote
        try {
            const bookingRecord = {
                barcode: booking.barcode,
                backup_code: booking.backupCode,
                deal_id: booking.deal?.id,
                user_id: booking.userId,
                store_id: booking.deal?.storeId || booking.deal?.store_id, // handle both casing if needed
                booked_quantity: booking.bookedQuantity,
                prep_time: booking.prepTime,
                notes: booking.notes,
                status: booking.status,
                booked_at: booking.bookedAt,
                expiry_time: booking.expiryTime
            };
            const { error } = await supabase.from('bookings').upsert(bookingRecord);
            if (error) throw error;
            logger.log('✅ Booking saved to remote');
        } catch (e) {
            console.error('Remote booking sync failed:', e);
        }
    },

    updateStatus: async (barcode: string, status: Booking['status'], note?: string): Promise<void> => {
        // Direct remote update
        try {
            const updatePayload: any = { status };
            if (note !== undefined) updatePayload.notes = note;

            const { error, data } = await supabase.from('bookings').update(updatePayload).eq('barcode', barcode).select();
            if (error) throw error;
            if (!data || data.length === 0) {
                throw new Error('لم يتم العثور على الحجز أو أنك لا تملك صلاحية التعديل (RLS).');
            }
            logger.log('✅ Booking status updated in remote');
        } catch (e) {
            console.error('Remote status sync failed:', e);
            throw e;
        }
    },

    remove: async (barcode: string): Promise<void> => {
        try {
            await supabase.from('bookings').delete().eq('barcode', barcode);
        } catch (e) {
            console.error('Remote delete failed:', e);
        }
    },

    clearAll: async (): Promise<void> => {
        // Remote clear not allowed
    }
};
