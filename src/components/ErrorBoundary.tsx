import React, { Component, ErrorInfo, ReactNode } from "react";
import { captureError } from "../services/sentry";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  autoRecovering: boolean;
}

// A stale build trying to lazy-load a chunk that the new deploy renamed.
const isChunkError = (err?: Error | null): boolean =>
  err?.name === 'ChunkLoadError' ||
  /Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(err?.message ?? '');

// Guard so a genuinely broken build can't reload-loop forever. If we already
// auto-recovered within this window and STILL hit a chunk error, we stop and
// show the manual button instead of thrashing.
const RECOVER_KEY = 'TAKI_CHUNK_AUTO_RECOVER_AT';
const RECOVER_COOLDOWN_MS = 25_000;

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    componentStack: null,
    autoRecovering: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    // For a chunk error we've almost certainly just deployed — recover
    // automatically instead of parking the user on a manual "reload" screen,
    // UNLESS we already tried very recently (loop protection).
    let recentlyRecovered = false;
    try {
      const last = Number(sessionStorage.getItem(RECOVER_KEY) || '0');
      recentlyRecovered = Date.now() - last < RECOVER_COOLDOWN_MS;
    } catch { /* private mode */ }
    const autoRecovering = isChunkError(error) && !recentlyRecovered;
    return { hasError: true, error, componentStack: null, autoRecovering };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    // Chunk errors are an expected side effect of shipping a new build while
    // someone has the app open — not a real bug. Don't page Sentry for them.
    if (!isChunkError(error)) {
      captureError(error, { componentStack: errorInfo.componentStack });
    }
    this.setState({ componentStack: errorInfo.componentStack ?? null });

    if (this.state.autoRecovering) {
      try { sessionStorage.setItem(RECOVER_KEY, String(Date.now())); } catch { /* ignore */ }
      // Purge caches + swap the service worker, then reload to the fresh
      // build — the same thing the manual button did, just done for the user.
      this.handleHardRefresh();
    }
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, componentStack: null, autoRecovering: false });
  };

  private handleHardRefresh = async () => {
    // Clear caches + unregister SW so a stale chunk reference can't recur.
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch { /* best effort */ }
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      const err = this.state.error;
      const isChunkLoadError = isChunkError(err);

      // Silent auto-recovery in progress — show a calm "updating" splash
      // instead of the technical reload screen. handleHardRefresh() is
      // already clearing caches + reloading in the background. v12.06
      if (this.state.autoRecovering) {
        return (
          <div style={{ padding: 20, background: 'var(--body-bg)', color: 'var(--text-primary)', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', direction: 'rtl' }}>
            <div style={{ width: 46, height: 46, border: '4px solid var(--border-color)', borderTopColor: 'var(--primary)', borderRadius: '50%', animation: 'taki-eb-spin 0.9s linear infinite' }} />
            <style>{`@keyframes taki-eb-spin{to{transform:rotate(360deg)}}`}</style>
            <h1 style={{ fontSize: '1.25rem', marginTop: 22, fontWeight: 800 }}>جاري تحديث التطبيق…</h1>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: 8, maxWidth: 360 }}>
              وصلت نسخة جديدة — نحمّلها لك تلقائياً خلال لحظات.
            </p>
          </div>
        );
      }

      return (
        <div style={{ padding: 20, background: 'var(--body-bg)', color: 'var(--text-primary)', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', direction: 'rtl' }}>
          <div style={{ fontSize: '4rem', marginBottom: 12 }}>{isChunkLoadError ? '🔄' : '⚠️'}</div>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 10, fontWeight: 800 }}>
            {isChunkLoadError ? 'تحديث متاح — أعد التحميل' : 'حدث خطأ غير متوقع'}
          </h1>
          <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: 20, maxWidth: 480 }}>
            {isChunkLoadError
              ? 'الموقع تم تحديثه أثناء استخدامك. اضغط "إعادة التحميل" لمتابعة العمل بأحدث نسخة.'
              : 'نأسف على ذلك. يمكنك المتابعة من حيث توقفت أو إعادة تحميل الصفحة بالكامل.'}
          </p>
          <details style={{ background: 'var(--card-bg)', padding: 14, borderRadius: 12, width: '100%', maxWidth: 'min(600px, calc(100vw - 24px))', textAlign: 'right', border: '1px solid var(--border-color)', marginBottom: 16 }}>
            <summary style={{ cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
              🔍 تفاصيل تقنية (للنسخ)
            </summary>
            <pre style={{ marginTop: 10, fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--danger)' }}>
              {err?.toString() ?? '(no error)'}
            </pre>
            {this.state.componentStack && (
              <pre style={{ marginTop: 8, fontSize: '0.7rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-secondary)', maxHeight: 200, overflow: 'auto' }}>
                {this.state.componentStack}
              </pre>
            )}
          </details>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            {!isChunkLoadError && (
              <button
                onClick={this.handleReset}
                style={{ padding: '12px 24px', borderRadius: 12, border: '1.5px solid var(--border-color)', background: 'var(--card-bg)', color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer' }}
              >
                ↩️ متابعة
              </button>
            )}
            <button
              onClick={this.handleHardRefresh}
              style={{ padding: '12px 24px', borderRadius: 12, border: 'none', background: 'var(--primary)', color: 'white', fontSize: '0.9rem', fontWeight: 800, cursor: 'pointer' }}
            >
              🔄 إعادة تحميل كاملة
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
