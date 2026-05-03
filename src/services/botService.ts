/**
 * TAKI Bot Service — Service layer for Telegram & WhatsApp bot integration.
 * All user-facing operations are exposed here as pure functions
 * so they can be called from bot handlers without needing React context.
 * 
 * NOTE: Currently uses localStorage-based repositories.
 * When migrating to a backend (Phase 2-3 of the roadmap),
 * these functions will call REST API endpoints instead.
 */

import { Deal, REGIONS, CITIES, LOCATIONS, Category, GenderTarget, CATEGORIES } from '../data/mock';
import { dealRepository } from '../repositories/dealRepository';
import { userRepository } from '../repositories/userRepository';
import { bookingRepository } from '../repositories/bookingRepository';
import { validationService } from './validationService';
import { getDistance } from '../utils/helpers';

// ============================================================
// Types for bot interactions
// ============================================================

export interface BotUser {
    id: string;
    name: string;
    phone?: string;
    userType: 'buyer' | 'seller';
    chatId?: string; // Telegram/WhatsApp chat ID
}

export interface BotDealPayload {
    shopName: string;
    itemName: string;
    category: Category;
    gender: GenderTarget;
    size?: string;
    originalPrice: number;
    discountedPrice: number;
    description: string;
    images: string[];
    locationId: string;
    quantity: number | 'unlimited';
    days?: number;
    mapLocation?: { lat: number; lng: number };
}

export interface NearbyQuery {
    lat: number;
    lng: number;
    radiusKm: number;
    category?: Category;
}

// ============================================================
// Bot Service Functions
// ============================================================

export const botService = {
    // --- Authentication ---
    registerUser: async (phone: string, name: string, userType: 'buyer' | 'seller'): Promise<BotUser> => {
        const user: BotUser = {
            id: 'bot_' + Date.now(),
            name: validationService.sanitizeText(name, 50),
            phone,
            userType
        };
        await userRepository.saveProfile(user as any);
        return user;
    },

    loginByPhone: async (phone: string): Promise<BotUser | null> => {
        try {
            const { supabase } = await import('./supabaseClient');
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('phone', phone)
                .maybeSingle();

            if (data && !error) {
                return {
                    id: data.id,
                    name: data.name,
                    phone: data.phone,
                    userType: data.user_type
                };
            }
        } catch (e) {
            console.error('Bot login lookup failed', e);
        }

        return null;
    },

    // --- Deal Management ---
    publishDeal: async (payload: BotDealPayload, sellerId: string): Promise<Deal> => {
        const discount = Math.round(((payload.originalPrice - payload.discountedPrice) / payload.originalPrice) * 100);
        const deal: Deal = {
            id: Date.now().toString(),
            storeId: sellerId,
            shopName: payload.shopName,
            itemName: payload.itemName,
            category: payload.category,
            gender: payload.gender,
            size: payload.size,
            originalPrice: payload.originalPrice,
            discountedPrice: payload.discountedPrice,
            discountPercentage: discount,
            images: payload.images,
            description: validationService.sanitizeText(payload.description, 1000),
            locationId: payload.locationId,
            mapLocation: payload.mapLocation,
            reliabilityScore: 100,
            expiresInMinutes: payload.days ? payload.days * 24 * 60 : 120,
            quantity: payload.quantity,
            initialQuantity: payload.quantity,
            ratings: [],
            createdAt: Date.now(),
            status: 'active'
        };
        await dealRepository.save(deal);
        return deal;
    },

    // --- Search & Discovery ---
    searchDeals: async (query: string): Promise<Deal[]> => {
        const deals = await dealRepository.getAll();
        if (!query) return deals;
        const q = query.toLowerCase();
        return deals.filter(d =>
            d.itemName.toLowerCase().includes(q) ||
            d.shopName.toLowerCase().includes(q) ||
            d.category.toLowerCase().includes(q)
        );
    },

    getDealsByCategory: async (category: Category): Promise<Deal[]> => {
        const deals = await dealRepository.getAll();
        return deals.filter(d => d.category === category || (d.category as string) === 'all');
    },

    getNearbyDeals: async (query: NearbyQuery): Promise<Deal[]> => {
        const deals = await dealRepository.getAll();
        const locs = LOCATIONS.filter(loc => {
            const dist = getDistance(query.lat, query.lng, loc.lat, loc.lng);
            return dist <= query.radiusKm;
        });
        const locIds = locs.map(l => l.id);
        let filtered = deals.filter(d => locIds.includes(d.locationId));
        if (query.category) {
            filtered = filtered.filter(d => d.category === query.category || (d.category as string) === 'all');
        }
        return filtered;
    },

    // --- Booking ---
    bookDeal: async (dealId: string, userId: string): Promise<{ barcode: string; backupCode: string } | null> => {
        const deal = await dealRepository.getById(dealId);
        if (!deal || (deal.quantity !== 'unlimited' && deal.quantity <= 0)) return null;
        const barcode = Math.random().toString(36).substring(2, 10).toUpperCase();
        const backupCode = `TK-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        
        // Update quantity
        await dealRepository.save({ ...deal, quantity: deal.quantity === 'unlimited' ? 'unlimited' : deal.quantity - 1 });
        
        // Create full booking record via repository
        await bookingRepository.save({
            deal: deal,
            barcode: barcode,
            backupCode: backupCode,
            userId: userId,
            bookedQuantity: 1,
            prepTime: 'arrival',
            status: 'pending',
            bookedAt: Date.now(),
            expiryTime: Date.now() + 2 * 60 * 60 * 1000 // 2 hours
        });

        return { barcode, backupCode };
    },

    verifyBooking: async (code: string): Promise<boolean> => {
        const booking = await bookingRepository.getByBarcode(code);
        return !!booking;
    },

    // --- Location Data ---
    getRegions: () => REGIONS,
    getCities: (regionId: string) => CITIES.filter(c => c.regionId === regionId),
    getLocations: (cityId: string) => LOCATIONS.filter(l => l.cityId === cityId),
    getAllCategories: () => CATEGORIES.filter(c => c.id !== 'all').map(c => ({ id: c.id as Category, nameAr: c.ar, nameEn: c.en }))
};

// getDistance is now imported from '../utils/helpers'
