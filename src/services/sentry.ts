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
            integrations: [
                // Session Replay — a privacy-safe "video" of what the user did
                // right before an error. maskAllText + blockAllMedia ensure names,
                // phones, prices and images are NEVER recorded — only the layout
                // and the actions (taps/navigation) are. (v11.52)
                Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
            ],
            // Capture 100% of sessions that hit an error (the ones worth watching)
            // + a light 10% sample of normal sessions for context.
            replaysOnErrorSampleRate: 1.0,
            replaysSessionSampleRate: 0.1,
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
