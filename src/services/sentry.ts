import * as Sentry from '@sentry/react';

/**
 * Optional error monitoring (v11.44). Stays a complete no-op until a DSN is
 * provided via the `SENTRY_DSN` build env var (set it in Vercel ▸ Project ▸
 * Settings ▸ Environment Variables, then redeploy). Telemetry must never block
 * or crash the app, so every call is guarded.
 */
const DSN = (process.env.SENTRY_DSN || '').trim();
let enabled = false;

export function initSentry(): void {
    if (!DSN || enabled) return;
    try {
        Sentry.init({
            dsn: DSN,
            environment: process.env.NODE_ENV || 'production',
            tracesSampleRate: 0.1,
            // Scrub obvious PII from any captured request/headers before sending.
            sendDefaultPii: false,
        });
        enabled = true;
    } catch {
        /* never let monitoring break startup */
    }
}

export function captureError(err: unknown, context?: Record<string, unknown>): void {
    if (!enabled) return;
    try {
        Sentry.captureException(err, context ? { extra: context } : undefined);
    } catch {
        /* ignore */
    }
}

export const sentryEnabled = (): boolean => enabled;
