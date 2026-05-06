import { supabase } from '../services/supabaseClient';

export interface Banner {
    id: string;
    title_ar: string;
    title_en: string;
    image_url: string;
    target_url?: string;
    deal_id?: string;
    store_id?: string;
    position: string;
    is_active: boolean;
    display_order: number;
    expires_at?: string;
}

export const bannerRepository = {
    async getActive(position: string = 'home_top'): Promise<Banner[]> {
        const { data, error } = await supabase
            .from('banners')
            .select('*')
            .eq('is_active', true)
            .eq('position', position)
            .order('display_order', { ascending: true });
        
        if (error) {
            console.error('Error fetching banners:', error);
            return [];
        }
        return data || [];
    },

    async create(banner: Partial<Banner>): Promise<Banner | null> {
        const { data, error } = await supabase
            .from('banners')
            .insert(banner)
            .select()
            .single();
        
        if (error) throw error;
        return data;
    },

    async delete(id: string): Promise<void> {
        const { error } = await supabase
            .from('banners')
            .delete()
            .eq('id', id);
        if (error) throw error;
    }
};
