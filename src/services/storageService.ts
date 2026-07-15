import { CONFIG } from '../config';
import { supabase } from './supabaseClient';
import { logger } from '../utils/logger';
import { compressImage } from '../utils/imageCompression';

export const storageService = {
    /**
     * v12.31 — سبب رفض آخر رفع (null = لا رفض). تقرؤه نقاط الاستدعاء لعرض
     * رسالة «محتوى غير لائق» بدل «فشل الرفع» العامة عندما يحجب فلتر الصور
     * الإباحية (moderationService) الصورة.
     */
    lastBlockReason: null as 'nsfw' | null,

    get: <T>(key: keyof typeof CONFIG.STORAGE_KEYS): T | null => {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEYS[key]);
        if (!stored) return null;
        try {
            return JSON.parse(stored) as T;
        } catch {
            return null;
        }
    },

    set: <T>(key: keyof typeof CONFIG.STORAGE_KEYS, value: T): void => {
        localStorage.setItem(CONFIG.STORAGE_KEYS[key], JSON.stringify(value));
    },

    remove: (key: keyof typeof CONFIG.STORAGE_KEYS): void => {
        localStorage.removeItem(CONFIG.STORAGE_KEYS[key]);
    },

    // Sensitive Data Handling (Obfuscation as a placeholder for real Encryption)
    getSecure: <T>(key: keyof typeof CONFIG.STORAGE_KEYS): T | null => {
        const stored = localStorage.getItem(CONFIG.STORAGE_KEYS[key]);
        if (!stored) return null;
        try {
            const decoded = atob(stored);
            return JSON.parse(decoded) as T;
        } catch {
            return null;
        }
    },

    setSecure: <T>(key: keyof typeof CONFIG.STORAGE_KEYS, value: T): void => {
        const encoded = btoa(JSON.stringify(value));
        localStorage.setItem(CONFIG.STORAGE_KEYS[key], encoded);
    },

    clear: (): void => {
        localStorage.clear();
    },

    uploadImage: async (rawFile: File): Promise<string | null> => {
        try {
            // v12.31 — فحص الصور الإباحية قبل الرفع (NSFWJS داخل المتصفح).
            // نقطة اختناق واحدة = كل مسارات الرفع (منتجات/بنرات/مسابقات)
            // مفحوصة تلقائياً. الفحص fail-open فلا يعطّل الرفع أبداً.
            storageService.lastBlockReason = null;
            try {
                const { moderationService } = await import('./moderationService');
                const verdict = await moderationService.checkImage(rawFile);
                if (!verdict.ok) {
                    storageService.lastBlockReason = 'nsfw';
                    moderationService.reportBlockedUpload(rawFile.name, verdict);
                    logger.warn(`🚫 upload blocked by NSFW filter: ${verdict.label} ${Math.round((verdict.score || 0) * 100)}%`);
                    return null;
                }
            } catch { /* الفلتر لا يمنع الرفع عند أي عطل */ }

            // Single chokepoint: every upload path (camera, gallery,
            // crop-applied, crop-skipped, decode-fail) flows through here,
            // so compressing here guarantees no raw multi-MB photo ever
            // hits the network. This is the fix for the ~10s/image uploads.
            const file = await compressImage(rawFile);
            logger.info(`📸 Uploading image: ${file.name} — ${Math.round(rawFile.size/1024)}KB → ${Math.round(file.size/1024)}KB`);
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.jpg`;

            // Create a timeout promise
            const timeoutPromise = new Promise<null>((_, reject) => 
                setTimeout(() => reject(new Error('Upload Timeout')), 12000)
            );

            const uploadPromise = (async () => {
                const { data: uploadData, error: uploadError } = await supabase.storage
                    .from('deals')
                    .upload(fileName, file, {
                        cacheControl: '3600',
                        upsert: false
                    });

                if (uploadError) throw uploadError;
                
                const { data } = supabase.storage.from('deals').getPublicUrl(fileName);
                return data.publicUrl;
            })();

            // Race the upload against the timeout
            const result = await Promise.race([uploadPromise, timeoutPromise]);
            
            if (result) {
                logger.info('✅ Image uploaded successfully:', result);
            }
            return result;
        } catch (error: any) {
            console.error('❌ Failed to upload image to Supabase:', error.message || error);
            // Fallback: we return null, the UI will handle local preview (Base64)
            return null; 
        }
    }
};
