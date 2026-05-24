/**
 * Booking Repository — Data access layer for bookings.
 * All data operations are server-only via Supabase.
 */
import { supabase } from '../services/supabaseClient';
import { dealRepository } from './dealRepository';
import { logger } from '../utils/logger';

export interface BookingMessage {
    id: string;
    barcode: string;
    senderId: string;
    senderRole: 'buyer' | 'seller';
    body: string;
    createdAt: number;
    readAt: number | null;
}

export interface Booking {
    deal: any;
    barcode: string;
    backupCode: string;
    expiryTime: number;
    bookedAt: number;
    /** Epoch ms when the booking was marked completed (DB trigger sets
     *  `completed_at` on status flip to 'completed'). Used by v11.19 to
     *  hide the buyer's phone call button 2 hours after completion. */
    completedAt?: number;
    bookedQuantity: number;
    userId: string;
    userName?: string;
    userPhone?: string;
    prepTime?: string;
    notes?: string;          // Buyer's note attached at booking time
    merchantNote?: string;   // Seller's note left when acknowledging the order
    status: 'pending' | 'acknowledged' | 'completed' | 'cancelled';
    /** Messages exchanged on this booking. Up to 3 from each side
     *  (buyer + seller). Loaded lazily — undefined means "not fetched yet". */
    messages?: BookingMessage[];
}

const mapMessage = (m: any): BookingMessage => ({
    id: m.id,
    barcode: m.barcode,
    senderId: m.sender_id,
    senderRole: m.sender_role,
    body: m.body,
    createdAt: new Date(m.created_at).getTime(),
    readAt: m.read_at ? new Date(m.read_at).getTime() : null,
});

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

    getByUser: async (userId: string, knownDeals?: any[]): Promise<Booking[]> => {
        try {
            // Fetch bookings where user is buyer (user_id) OR seller (store_id),
            // so the same call hydrates both sides of the transaction.
            const { data, error } = await supabase
                .from('bookings')
                .select('*')
                .or(`user_id.eq.${userId},store_id.eq.${userId}`);
            if (data && !error) {
                // Resolve the deal object WITHOUT re-fetching the entire deals
                // (+ ratings) tables. Before v10.71 this called
                // dealRepository.getAll() — two extra heavy Tokyo round-trips
                // on the critical path every time bookings loaded. Now: reuse
                // the caller's already-loaded deals; if absent, fetch only the
                // handful of deal rows these bookings actually reference.
                let deals: any[] = Array.isArray(knownDeals) ? knownDeals : [];
                const haveIds = new Set(deals.map(d => d.id));
                const missingIds = Array.from(
                    new Set(data.map(b => b.deal_id).filter(id => id && !haveIds.has(id)))
                );
                if (missingIds.length > 0) {
                    const { data: dealRows } = await supabase
                        .from('deals')
                        .select('*')
                        .in('id', missingIds);
                    if (Array.isArray(dealRows)) {
                        deals = deals.concat(dealRows.map(dealRepository.mapRowToDeal));
                    }
                }
                const remoteBookings: Booking[] = data.map(b => ({
                    barcode: b.barcode,
                    backupCode: b.backup_code,
                    deal: deals.find(d => d.id === b.deal_id) || { id: b.deal_id, storeId: b.store_id, itemName: 'تخفيض' },
                    userId: b.user_id,
                    userName: b.user_name || undefined,
                    userPhone: b.user_phone || undefined,
                    bookedQuantity: b.booked_quantity,
                    prepTime: b.prep_time,
                    notes: b.notes,
                    merchantNote: b.merchant_note,
                    status: b.status as Booking['status'],
                    bookedAt: b.booked_at,
                    completedAt: b.completed_at ? new Date(b.completed_at).getTime() : undefined,
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
                    userName: data.user_name || undefined,
                    userPhone: data.user_phone || undefined,
                    bookedQuantity: data.booked_quantity,
                    prepTime: data.prep_time,
                    notes: data.notes,
                    merchantNote: data.merchant_note,
                    status: data.status as Booking['status'],
                    bookedAt: data.booked_at,
                    completedAt: data.completed_at ? new Date(data.completed_at).getTime() : undefined,
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
                // Denormalize the buyer's name + phone onto the booking row.
                // The seller's order list is a single bookings query and RLS
                // does not let a seller read the buyer's `users` row, so
                // without this the seller only ever saw the raw UUID. Captured
                // at booking time = correct even if the buyer renames later.
                user_name: booking.userName ?? null,
                user_phone: booking.userPhone ?? null,
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

    updateStatus: async (barcode: string, status: Booking['status'], merchantNote?: string): Promise<void> => {
        // Atomic, awaited status transition via server-side RPC.
        // The RPC guards the precondition (status was pending/acknowledged),
        // checks auth, and raises a clear error if anything is off. This is
        // the v10.20 fix for the "completion silently reverts" bug — the
        // previous fire-and-forget `.update()` could fail without the
        // optimistic UI ever noticing.
        try {
            let rpcName: string;
            let args: Record<string, any>;
            if (status === 'completed') {
                rpcName = 'complete_booking';
                args = { p_barcode: barcode };
            } else if (status === 'acknowledged') {
                rpcName = 'acknowledge_booking';
                args = { p_barcode: barcode, p_merchant_note: merchantNote ?? null };
            } else if (status === 'cancelled') {
                rpcName = 'cancel_booking';
                args = { p_barcode: barcode };
            } else {
                throw new Error(`Unsupported status transition: ${status}`);
            }

            const { data, error } = await supabase.rpc(rpcName, args);
            if (error) throw error;
            if (!data) {
                throw new Error('RPC returned no row');
            }
            logger.log('✅ Booking status updated via RPC:', barcode, '→', status);
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

    // ── Messages thread ──────────────────────────────────────────
    getMessages: async (barcode: string): Promise<BookingMessage[]> => {
        const { data, error } = await supabase
            .from('booking_messages')
            .select('*')
            .eq('barcode', barcode)
            .order('created_at', { ascending: true });
        if (error) {
            console.warn('Fetch booking messages failed:', error.message);
            return [];
        }
        return (data || []).map(mapMessage);
    },

    sendMessage: async (barcode: string, body: string): Promise<BookingMessage> => {
        const { data, error } = await supabase.rpc('send_booking_message', {
            p_barcode: barcode,
            p_body: body,
        });
        if (error) throw error;
        if (!data) throw new Error('RPC returned no row');
        return mapMessage(data);
    },

    markMessagesRead: async (barcode: string): Promise<number> => {
        const { data, error } = await supabase.rpc('mark_booking_messages_read', {
            p_barcode: barcode,
        });
        if (error) {
            console.warn('Mark-read failed:', error.message);
            return 0;
        }
        return Number(data) || 0;
    },

    clearAll: async (): Promise<void> => {
        // Remote clear not allowed
    }
};
