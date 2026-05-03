export const validationService = {
    isValidPhone: (phone: string): boolean => {
        // Saudi format: 05XXXXXXXX (10 digits)
        const regex = /^05\d{8}$/;
        return regex.test(phone);
    },

    isValidEmail: (email: string): boolean => {
        const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return regex.test(email);
    },

    sanitizeText: (text: string, maxLength: number = 500): string => {
        if (!text) return '';
        // Basic HTML tag removal to prevent simple XSS
        let sanitized = text.replace(/<[^>]*>?/gm, '');
        // Trim and limit length
        return sanitized.trim().substring(0, maxLength);
    },

    isValidPrice: (price: string | number): boolean => {
        const num = Number(price);
        return !isNaN(num) && num > 0 && num < 1000000;
    },

    isValidQuantity: (qty: string | number): boolean => {
        const num = Number(qty);
        return !isNaN(num) && Number.isInteger(num) && num > 0 && num < 10000;
    },

    isValidUrl: (url: string): boolean => {
        if (!url) return true; // Optional URLs
        try {
            new URL(url);
            return true;
        } catch {
            return false;
        }
    }
};
