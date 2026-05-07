import React, { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    componentStack: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, componentStack: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack ?? null });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
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
      const isChunkLoadError = err?.name === 'ChunkLoadError' ||
        /Loading chunk|Failed to fetch dynamically imported module/i.test(err?.message ?? '');
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
          <details style={{ background: 'var(--card-bg)', padding: 14, borderRadius: 12, maxWidth: '90%', width: 600, textAlign: 'right', border: '1px solid var(--border-color)', marginBottom: 16 }}>
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
