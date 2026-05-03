import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
        '[TAKI] Missing Supabase environment variables. ' +
        'Set SUPABASE_URL and SUPABASE_ANON_KEY in your .env before starting the app.'
    );
}

export const supabaseConfig = {
    url: supabaseUrl,
    key: supabaseAnonKey
};

// Custom auth lock: serialise token-refresh attempts within this tab so a
// fresh request can never "steal" the lock from a still-running one. The
// default Web Locks adapter throws "another request stole it" when the
// browser revokes a stale lock; that warning was bubbling up to users via
// the deal-save error toast. A simple in-tab promise queue avoids it
// entirely without weakening security (cross-tab coordination still works
// through localStorage events).
let authQueue: Promise<unknown> = Promise.resolve();
const inTabLock = async <T,>(_name: string, _acquireTimeout: number, fn: () => Promise<T>): Promise<T> => {
    const run = authQueue.then(() => fn());
    authQueue = run.catch(() => undefined);
    return run;
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'sb-taki-auth',
        lock: inTabLock as any
    },
    realtime: {
        params: { eventsPerSecond: 10 }
    }
});

logger.log('🔗 Database Layer Initialized: Connected to Supabase');
