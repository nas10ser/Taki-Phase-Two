export const CONFIG = {
    BOOKING_DURATION_MS: 2 * 60 * 60 * 1000, // 2 hours
    STORAGE_KEYS: {
        USER: 'taki_user_v2',
        USER_PROFILE: 'taki_user_profile',
        DEALS: 'taki_deals',
        BOOKINGS: 'taki_bookings',
        FAVORITES: 'taki_favorites',
        LANG: 'taki_lang',
        LOC: 'taki_loc',
        KEYWORDS: 'taki_keywords',
        NOTIFICATIONS: 'taki_notifs',
        STORE_PROFILES: 'taki_store_profiles',
        DARK_MODE: 'taki_dark',
        FOLLOWED_MERCHANTS: 'taki_followed',
        DATA_VERSION: 'taki_data_version',
        REGISTERED_ACCOUNTS: 'taki_registered_accounts',
        INITIALIZED: 'taki_initialized_v3',
        NOTIF_KEYWORDS: 'taki_notif_keywords',
        LAST_MARKETING_ALERTS: 'taki_last_marketing_alerts',
        LAST_SELLER_MAP_POS: 'taki_last_seller_map_pos',
    },
    APP_NAME: 'TAKI',
    VERSION: '5.0.0',

    // Bot Integration Config (for future Telegram & WhatsApp bot)
    BOT_CONFIG: {
        TELEGRAM: {
            WEBHOOK_URL: '', // Set when deploying: https://api.telegram.org/bot<TOKEN>/setWebhook
            BOT_USERNAME: '@taki_deals_bot',
            COMMANDS: ['/start', '/explore', '/publish', '/bookings', '/profile', '/help'],
        },
        WHATSAPP: {
            WEBHOOK_URL: '', // Set when deploying: WhatsApp Business API endpoint
            PHONE_NUMBER: '', // WhatsApp Business phone number
        },
        DEFAULT_LANGUAGE: 'ar',
        NEARBY_RADIUS_KM: 10,
    }
};
