/**
 * PreLaunchSuite — the "before you go live with millions of users" tab.
 *
 * Five sections, every one designed to be safe on production:
 *  1. HealthCheckRunner — one-click ~30-point system check
 *  2. PaymentGatewaySetup — Moyasar (and friends) scaffold; saves
 *     publishable key + provider name; explicitly does NOT touch the
 *     secret key (that belongs in an edge function env var)
 *  3. TogglesAudit — every platform_setting with a human description
 *  4. LaunchChecklist — manual gates Nasser must verify himself
 *  5. LoadTestGuide — step-by-step instructions for k6 (we don't run
 *     real load tests against production from inside the app)
 */

import React, { useCallback, useEffect, useMemo, useState, memo } from 'react';
import { supabase } from '../../services/supabaseClient';
import { adminService } from '../../services/adminService';
import { useApp } from '../../context/AppContext';
import { Tooltip } from './Tooltip';
import { CopyButton } from './CopyButton';

// ============================================================
// Health Check Runner — ~30 checks, one click, color-coded report
// ============================================================
type CheckStatus = 'pending' | 'pass' | 'warn' | 'fail';

interface CheckResult {
    id: string;
    label: string;
    category: 'browser' | 'pwa' | 'db' | 'rpc' | 'storage' | 'realtime';
    status: CheckStatus;
    detail?: string;
    duration_ms?: number;
}

interface CheckDef {
    id: string;
    label: string;
    category: CheckResult['category'];
    run: () => Promise<{ status: CheckStatus; detail?: string }>;
}

// Resolve the *expected* cache name dynamically from sw.js — that way we
// don't have to bump a constant here every release. Cached for the lifetime
// of the page so it doesn't re-fetch on every health check rerun.
let _expectedCachePromise: Promise<string | null> | null = null;
async function getExpectedCacheName(): Promise<string | null> {
    if (_expectedCachePromise) return _expectedCachePromise;
    _expectedCachePromise = (async () => {
        try {
            const r = await fetch('/sw.js', { cache: 'no-store' });
            if (!r.ok) return null;
            const txt = await r.text();
            const m = txt.match(/taki-cache-v[\d.]+/);
            return m ? m[0] : null;
        } catch { return null; }
    })();
    return _expectedCachePromise;
}

const BUILD_CHECKS = (): CheckDef[] => [
    // ─── Browser environment ────────────────────────────────
    {
        id: 'browser-online',
        category: 'browser',
        label: 'الاتصال بالإنترنت',
        run: async () => ({
            status: navigator.onLine ? 'pass' : 'fail',
            detail: navigator.onLine ? 'متصل' : 'بدون اتصال',
        }),
    },
    {
        id: 'browser-secure-context',
        category: 'browser',
        label: 'HTTPS (Secure Context)',
        run: async () => ({
            status: window.isSecureContext ? 'pass' : 'fail',
            detail: window.isSecureContext ? 'مفعّل' : 'غير آمن — كثير من APIs ستفشل',
        }),
    },
    {
        id: 'browser-localstorage',
        category: 'browser',
        label: 'localStorage يعمل',
        run: async () => {
            try {
                const k = `__healthcheck_${Date.now()}`;
                localStorage.setItem(k, '1');
                localStorage.removeItem(k);
                return { status: 'pass' as const, detail: 'متاح' };
            } catch {
                return { status: 'fail' as const, detail: 'محجوب (privacy mode؟)' };
            }
        },
    },
    {
        id: 'browser-indexeddb',
        category: 'browser',
        label: 'IndexedDB متاح',
        run: async () => ({
            status: typeof indexedDB !== 'undefined' ? 'pass' : 'warn',
            detail: typeof indexedDB !== 'undefined' ? 'متاح' : 'غير مدعوم — قد يؤثر على بعض الميزات',
        }),
    },
    {
        id: 'browser-clipboard',
        category: 'browser',
        label: 'Clipboard API',
        run: async () => ({
            status: navigator.clipboard ? 'pass' : 'warn',
            detail: navigator.clipboard ? 'مدعوم' : 'سيستخدم fallback',
        }),
    },
    {
        id: 'browser-crypto',
        category: 'browser',
        label: 'WebCrypto API',
        run: async () => ({
            status: window.crypto?.subtle ? 'pass' : 'warn',
            detail: window.crypto?.subtle ? 'متاح' : 'بعض ميزات الأمان قد تتأثر',
        }),
    },
    {
        id: 'browser-geolocation',
        category: 'browser',
        label: 'Geolocation API',
        run: async () => ({
            status: 'geolocation' in navigator ? 'pass' : 'warn',
            detail: 'geolocation' in navigator ? 'متاح' : 'الخريطة لن تعمل',
        }),
    },
    {
        id: 'browser-notification',
        category: 'browser',
        label: 'Notification API',
        run: async () => {
            if (!('Notification' in window)) {
                return { status: 'warn' as const, detail: 'غير مدعوم — لن تصل تنبيهات push' };
            }
            return {
                status: Notification.permission === 'granted' ? 'pass'
                       : Notification.permission === 'denied' ? 'warn'
                       : 'warn',
                detail: `حالة الإذن: ${Notification.permission}`,
            };
        },
    },

    // ─── PWA ────────────────────────────────────────────────
    {
        id: 'pwa-sw',
        category: 'pwa',
        label: 'Service Worker مفعّل',
        run: async () => {
            if (!('serviceWorker' in navigator)) {
                return { status: 'fail' as const, detail: 'غير مدعوم' };
            }
            const reg = await navigator.serviceWorker.getRegistration();
            if (!reg) return { status: 'fail' as const, detail: 'غير مسجّل' };
            if (!navigator.serviceWorker.controller) {
                return { status: 'warn' as const, detail: 'مسجّل لكن لم يتولّى الصفحة بعد — حدّث الصفحة' };
            }
            return { status: 'pass' as const, detail: 'يتحكّم بالصفحة الآن' };
        },
    },
    {
        id: 'pwa-cache',
        category: 'pwa',
        label: 'كاش التطبيق محدّث',
        run: async () => {
            const expected = await getExpectedCacheName();
            if (!expected) return { status: 'warn' as const, detail: 'تعذّر قراءة CACHE_NAME من sw.js' };
            if (typeof caches === 'undefined') return { status: 'warn' as const, detail: 'Cache API غير متاح' };
            const names = await caches.keys();
            if (names.includes(expected)) return { status: 'pass' as const, detail: `${expected} ✓` };
            return { status: 'warn' as const, detail: `متوقّع ${expected} — قد يحتاج تحديث صفحة قسري` };
        },
    },
    {
        id: 'pwa-manifest',
        category: 'pwa',
        label: 'PWA Manifest يتم تحميله',
        run: async () => {
            try {
                const r = await fetch('/manifest.webmanifest', { method: 'GET' });
                if (r.ok) return { status: 'pass' as const, detail: `HTTP ${r.status}` };
                const r2 = await fetch('/manifest.json', { method: 'GET' });
                return r2.ok
                    ? { status: 'pass' as const, detail: 'manifest.json يعمل' }
                    : { status: 'warn' as const, detail: `لم يُعثر على manifest (${r.status}/${r2.status})` };
            } catch (e: any) {
                return { status: 'warn' as const, detail: e?.message ?? 'فشل التحميل' };
            }
        },
    },

    // ─── Database / Auth ────────────────────────────────────
    {
        id: 'db-connect',
        category: 'db',
        label: 'اتصال قاعدة البيانات',
        run: async () => {
            const start = performance.now();
            const { error } = await supabase.from('users').select('id', { head: true, count: 'exact' });
            const dur = Math.round(performance.now() - start);
            if (error) return { status: 'fail' as const, detail: error.message };
            return { status: 'pass' as const, detail: `${dur}ms` };
        },
    },
    {
        id: 'auth-session',
        category: 'db',
        label: 'جلسة المصادقة نشطة',
        run: async () => {
            const { data, error } = await supabase.auth.getSession();
            if (error) return { status: 'fail' as const, detail: error.message };
            if (!data.session) return { status: 'fail' as const, detail: 'لا توجد جلسة' };
            const expiresAt = data.session.expires_at ? new Date(data.session.expires_at * 1000) : null;
            const detail = expiresAt
                ? `تنتهي ${expiresAt.toLocaleString('ar-SA')}`
                : 'نشطة';
            return { status: 'pass' as const, detail };
        },
    },
    {
        id: 'db-is-admin',
        category: 'db',
        label: 'is_admin() تتعرّف عليك',
        run: async () => {
            const hc = await adminService.healthCheck();
            if (!hc) return { status: 'fail' as const, detail: 'الـRPC رفضت أو ما رجعت' };
            return { status: 'pass' as const, detail: `أنت الأدمن (${hc.admin_user_id?.slice(0, 8)}…)` };
        },
    },

    // ─── RPCs ───────────────────────────────────────────────
    {
        id: 'rpc-live-stats',
        category: 'rpc',
        label: 'RPC: الإحصائيات اللحظية',
        run: async () => {
            const start = performance.now();
            const r = await adminService.getLiveStats(5, false);
            const dur = Math.round(performance.now() - start);
            return r
                ? { status: 'pass' as const, detail: `${dur}ms` }
                : { status: 'fail' as const, detail: 'لم ترجع نتائج' };
        },
    },
    {
        id: 'rpc-search-users',
        category: 'rpc',
        label: 'RPC: بحث المستخدمين',
        run: async () => {
            const start = performance.now();
            const r = await adminService.searchUsers('', null, 1, 0);
            const dur = Math.round(performance.now() - start);
            return Array.isArray(r)
                ? { status: 'pass' as const, detail: `${dur}ms` }
                : { status: 'fail' as const, detail: 'فشل' };
        },
    },
    {
        id: 'rpc-bookings-timeline',
        category: 'rpc',
        label: 'RPC: مخطط الحجوزات',
        run: async () => {
            const start = performance.now();
            const r = await adminService.getBookingsTimeline(
                new Date(Date.now() - 24 * 3600 * 1000),
                new Date(),
                'hour',
            );
            const dur = Math.round(performance.now() - start);
            return Array.isArray(r)
                ? { status: 'pass' as const, detail: `${dur}ms · ${r.length} نقطة` }
                : { status: 'fail' as const, detail: 'فشل' };
        },
    },
    {
        id: 'rpc-investor-kpis',
        category: 'rpc',
        label: 'RPC: مقاييس المستثمر',
        run: async () => {
            const start = performance.now();
            const r = await adminService.getInvestorKpis(30);
            const dur = Math.round(performance.now() - start);
            return r
                ? { status: 'pass' as const, detail: `${dur}ms` }
                : { status: 'fail' as const, detail: 'فشل' };
        },
    },
    {
        id: 'rpc-recent-activity',
        category: 'rpc',
        label: 'RPC: النشاط الأخير',
        run: async () => {
            const start = performance.now();
            const r = await adminService.getRecentActivity(5);
            const dur = Math.round(performance.now() - start);
            return Array.isArray(r)
                ? { status: 'pass' as const, detail: `${dur}ms · ${r.length} حدث` }
                : { status: 'fail' as const, detail: 'فشل' };
        },
    },

    // ─── Storage ────────────────────────────────────────────
    {
        id: 'storage-list',
        category: 'storage',
        label: 'Storage: قائمة buckets',
        run: async () => {
            const start = performance.now();
            const { error } = await supabase.storage.from('deal-images').list('', { limit: 1 });
            const dur = Math.round(performance.now() - start);
            return error
                ? { status: 'warn' as const, detail: error.message }
                : { status: 'pass' as const, detail: `${dur}ms` };
        },
    },

    // ─── Realtime ───────────────────────────────────────────
    {
        id: 'realtime-connect',
        category: 'realtime',
        label: 'Realtime يتصل',
        run: async () => {
            return new Promise<{ status: CheckStatus; detail?: string }>((resolve) => {
                const start = performance.now();
                const ch = supabase.channel(`__healthcheck_${Date.now()}`);
                const timer = setTimeout(() => {
                    supabase.removeChannel(ch).catch(() => {});
                    resolve({ status: 'warn', detail: 'انتهت المهلة (5 ث)' });
                }, 5000);
                ch.subscribe((s) => {
                    if (s === 'SUBSCRIBED') {
                        clearTimeout(timer);
                        const dur = Math.round(performance.now() - start);
                        supabase.removeChannel(ch).catch(() => {});
                        resolve({ status: 'pass', detail: `${dur}ms` });
                    } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
                        clearTimeout(timer);
                        supabase.removeChannel(ch).catch(() => {});
                        resolve({ status: 'fail', detail: `حالة: ${s}` });
                    }
                });
            });
        },
    },
];

const CATEGORY_LABELS: Record<CheckResult['category'], { label: string; icon: string }> = {
    browser:  { label: 'المتصفّح',           icon: '🌐' },
    pwa:      { label: 'التطبيق التقدّمي',    icon: '📱' },
    db:       { label: 'قاعدة البيانات',       icon: '🗄️' },
    rpc:      { label: 'الوظائف الخادمية',    icon: '⚙️' },
    storage:  { label: 'التخزين',              icon: '🗂️' },
    realtime: { label: 'البث المباشر',         icon: '⚡' },
};

const STATUS_STYLE: Record<CheckStatus, { bg: string; text: string; icon: string }> = {
    pending: { bg: 'bg-[var(--gray-100)]', text: 'text-[var(--text-secondary)]', icon: '○' },
    pass:    { bg: 'bg-emerald-100',       text: 'text-emerald-800',              icon: '✓' },
    warn:    { bg: 'bg-amber-100',         text: 'text-amber-800',                icon: '!' },
    fail:    { bg: 'bg-red-100',           text: 'text-red-800',                  icon: '✕' },
};

const HealthCheckRunner: React.FC = () => {
    const defs = useMemo(() => BUILD_CHECKS(), []);
    const [results, setResults] = useState<CheckResult[]>(() =>
        defs.map((d) => ({ id: d.id, label: d.label, category: d.category, status: 'pending' as const })),
    );
    const [running, setRunning] = useState(false);
    const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

    const run = useCallback(async () => {
        if (running) return;
        setRunning(true);
        setResults(defs.map((d) => ({ id: d.id, label: d.label, category: d.category, status: 'pending' as const })));
        // Run all checks in parallel — the slow ones (realtime, RPCs) shouldn't
        // block the fast ones (browser APIs) sequentially.
        const promises = defs.map(async (d) => {
            const start = performance.now();
            try {
                const { status, detail } = await d.run();
                return {
                    id: d.id, label: d.label, category: d.category, status, detail,
                    duration_ms: Math.round(performance.now() - start),
                } as CheckResult;
            } catch (e: any) {
                return {
                    id: d.id, label: d.label, category: d.category,
                    status: 'fail' as const,
                    detail: e?.message ?? 'استثناء غير متوقّع',
                    duration_ms: Math.round(performance.now() - start),
                } as CheckResult;
            }
        });
        // Update incrementally as each completes.
        await Promise.all(promises.map(async (p, i) => {
            const r = await p;
            setResults((prev) => {
                const next = [...prev];
                next[i] = r;
                return next;
            });
        }));
        setRunning(false);
        setLastRunAt(new Date());
    }, [running, defs]);

    const summary = useMemo(() => {
        const done = results.filter((r) => r.status !== 'pending');
        const pass = results.filter((r) => r.status === 'pass').length;
        const warn = results.filter((r) => r.status === 'warn').length;
        const fail = results.filter((r) => r.status === 'fail').length;
        const pending = results.filter((r) => r.status === 'pending').length;
        return { total: results.length, done: done.length, pass, warn, fail, pending };
    }, [results]);

    const grouped = useMemo(() => {
        const map: Record<string, CheckResult[]> = {};
        for (const r of results) {
            (map[r.category] ??= []).push(r);
        }
        return map;
    }, [results]);

    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                <div>
                    <h3 className="text-xl font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                        🩺 فحص شامل للنظام
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 font-bold">
                        نقرة واحدة → {summary.total} فحص في كل الطبقات (المتصفّح، PWA، DB، RPCs، Storage، Realtime).
                    </p>
                </div>
                <button
                    onClick={run}
                    disabled={running}
                    className="px-5 h-11 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-extrabold rounded-xl text-sm shadow-md disabled:opacity-50 flex items-center gap-2"
                >
                    {running ? '⏳ جارٍ الفحص...' : '🩺 ابدأ الفحص الشامل'}
                </button>
            </div>

            {/* Summary strip */}
            <div className="grid grid-cols-4 gap-2 mb-4">
                <SummaryTile label="نجح" value={summary.pass} tone="emerald" />
                <SummaryTile label="تحذير" value={summary.warn} tone="amber" />
                <SummaryTile label="فشل" value={summary.fail} tone="red" />
                <SummaryTile label="معلّق" value={summary.pending} tone="gray" />
            </div>
            {lastRunAt && (
                <div className="text-[10px] text-[var(--gray-400)] font-bold mb-3 text-left">
                    آخر فحص: {lastRunAt.toLocaleString('ar-SA')}
                </div>
            )}

            {/* Results grouped by category */}
            <div className="space-y-3">
                {Object.entries(grouped).map(([cat, rows]) => {
                    const meta = CATEGORY_LABELS[cat as CheckResult['category']];
                    return (
                        <div key={cat}>
                            <div className="text-xs font-extrabold text-[var(--text-secondary)] mb-1.5 flex items-center gap-1.5">
                                <span>{meta.icon}</span>{meta.label}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                                {rows.map((r) => {
                                    const s = STATUS_STYLE[r.status];
                                    return (
                                        <div
                                            key={r.id}
                                            className="flex items-center gap-2 p-2 bg-[var(--body-bg)] rounded-lg"
                                        >
                                            <span className={`w-6 h-6 rounded flex items-center justify-center font-extrabold text-xs ${s.bg} ${s.text}`}>
                                                {s.icon}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-bold text-[var(--text-primary)] truncate">
                                                    {r.label}
                                                </div>
                                                {r.detail && (
                                                    <div className="text-[10px] text-[var(--text-secondary)] truncate">
                                                        {r.detail}
                                                    </div>
                                                )}
                                            </div>
                                            {r.duration_ms !== undefined && r.status !== 'pending' && (
                                                <span className="text-[10px] text-[var(--gray-400)] font-bold tabular-nums">{r.duration_ms}ms</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};

const SummaryTile: React.FC<{ label: string; value: number; tone: 'emerald' | 'amber' | 'red' | 'gray' }> = ({ label, value, tone }) => {
    const toneCls: Record<string, string> = {
        emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        amber: 'bg-amber-50 text-amber-700 border-amber-200',
        red: 'bg-red-50 text-red-700 border-red-200',
        gray: 'bg-[var(--body-bg)] text-[var(--text-secondary)] border-[var(--border-color)]',
    };
    return (
        <div className={`rounded-xl p-2.5 border text-center ${toneCls[tone]}`}>
            <div className="text-2xl font-extrabold tabular-nums">{value}</div>
            <div className="text-[10px] font-bold">{label}</div>
        </div>
    );
};

// ============================================================
// Payment Gateway Setup — Moyasar et al. (publishable key only)
// ============================================================
type GatewayProvider = 'moyasar' | 'paytabs' | 'hyperpay' | 'tap' | '';

const PROVIDERS: Array<{ value: GatewayProvider; label: string; recommended?: boolean; hint: string }> = [
    { value: 'moyasar',  label: 'Moyasar',  recommended: true, hint: 'الأشهر في السعودية — يدعم mada، Visa، Apple Pay، STC Pay' },
    { value: 'paytabs',  label: 'PayTabs',                     hint: 'سعودي/خليجي، رسوم تنافسية، دعم متعدد العملات' },
    { value: 'hyperpay', label: 'HyperPay',                    hint: 'إقليمي قوي، تكامل مرن، دعم enterprise' },
    { value: 'tap',      label: 'Tap',                         hint: 'كويتي/إقليمي، تجربة dev جيدة' },
];

const PaymentGatewaySetup: React.FC = () => {
    const { customAlert, customConfirm } = useApp();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [provider, setProvider] = useState<GatewayProvider>('');
    const [pubKey, setPubKey] = useState('');
    const [pubKeyHint, setPubKeyHint] = useState<string | null>(null);
    const [webhookUrl, setWebhookUrl] = useState('');
    const [stats, setStats] = useState<{ total: number; paid: number; failed: number }>({ total: 0, paid: 0, failed: 0 });

    const load = useCallback(async () => {
        setLoading(true);
        const s = await adminService.getPaymentGatewayStatus();
        if (s) {
            setEnabled(s.enabled);
            setProvider((s.provider || '') as GatewayProvider);
            setPubKeyHint(s.publishable_key_hint);
            setWebhookUrl(s.webhook_url);
            setStats({ total: s.attempts_total, paid: s.attempts_paid, failed: s.attempts_failed });
        }
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    const savePubKey = async () => {
        const key = pubKey.trim();
        if (!key) {
            await customAlert('⚠️ ألصق المفتاح العام أولاً');
            return;
        }
        // Protect Nasser from accidentally pasting a secret key. Moyasar
        // publishable keys start with pk_ and secret keys with sk_. Same
        // convention across most gateways.
        if (key.toLowerCase().startsWith('sk_')) {
            await customAlert(
                '⛔ يبدو أن هذا مفتاح سرّي (sk_). الصق المفتاح العام (pk_) فقط هنا.\n' +
                'المفتاح السرّي يجب أن يبقى في خادم Edge Function ولا يدخل المتصفّح أبداً.'
            );
            return;
        }
        setSaving(true);
        const res = await adminService.setPlatformSetting(
            'payment_gateway_publishable_key', key, 'Public payment gateway key',
        );
        setSaving(false);
        if (!res.success) {
            await customAlert('❌ ' + (res.error ?? 'تعذّر الحفظ'));
            return;
        }
        await customAlert('✅ تم حفظ المفتاح العام');
        setPubKey('');
        load();
    };

    const saveProvider = async (next: GatewayProvider) => {
        setSaving(true);
        const res = await adminService.setPlatformSetting(
            'payment_gateway_provider', next, 'Selected payment gateway',
        );
        setSaving(false);
        if (!res.success) {
            await customAlert('❌ ' + (res.error ?? 'تعذّر الحفظ'));
            return;
        }
        setProvider(next);
    };

    const toggleGateway = async () => {
        const target = !enabled;
        if (target) {
            // Strict pre-flight before enabling — we refuse to flip the switch
            // if there's no key + provider, because doing so blocks merchants
            // from publishing without giving them a real way to pay.
            if (!provider) {
                await customAlert('⛔ اختر بوابة دفع أولاً');
                return;
            }
            const status = await adminService.getPaymentGatewayStatus();
            if (!status?.has_publishable_key) {
                await customAlert('⛔ احفظ المفتاح العام (pk_…) أولاً قبل التفعيل');
                return;
            }
            const ok = await customConfirm(
                '⚠️ تنبيه قبل التفعيل:\n' +
                `• البوابة المختارة: ${provider}\n` +
                '• سيتم منع التجار غير المشتركين من نشر عروض جديدة\n' +
                '• يجب أن يكون لديك Edge Function للـ webhook منشورة وتعمل\n' +
                '• تأكّد من أنك اختبرت دفعة حقيقية على بطاقة test ووصلت webhook\n\n' +
                'متابعة التفعيل؟'
            );
            if (!ok) return;
        }
        setSaving(true);
        const res = await adminService.setPlatformSetting('payment_gateway_enabled', target);
        setSaving(false);
        if (!res.success) {
            await customAlert('❌ ' + (res.error ?? 'تعذّر التحديث'));
            return;
        }
        setEnabled(target);
        await customAlert(target ? '✅ تم تفعيل البوابة' : '✅ تم تعطيل البوابة (الموقع مجاني)');
    };

    if (loading) {
        return (
            <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
                <div className="h-32 bg-[var(--gray-100)] rounded-xl animate-pulse" />
            </section>
        );
    }

    const providerMeta = PROVIDERS.find((p) => p.value === provider);

    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                <div>
                    <h3 className="text-xl font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                        💳 إعداد بوابة الدفع
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 font-bold">
                        اربط بوابة دفع فعلية — تفاصيل آمنة، المفتاح السرّي لا يدخل المتصفّح
                    </p>
                </div>
                <div className={`px-3 py-1.5 rounded-xl text-xs font-extrabold ${
                    enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}>
                    {enabled ? '🟢 مفعّلة' : '🟡 معطّلة (مجاني للتجار)'}
                </div>
            </div>

            {/* Provider picker */}
            <div className="mb-4">
                <label className="block text-xs font-extrabold text-[var(--text-secondary)] mb-2">
                    1️⃣ اختر البوابة
                </label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {PROVIDERS.map((p) => (
                        <button
                            key={p.value}
                            onClick={() => saveProvider(p.value)}
                            disabled={saving}
                            className={`p-3 rounded-xl border-2 text-right transition-all relative ${
                                provider === p.value
                                    ? 'bg-emerald-50 border-emerald-500'
                                    : 'bg-[var(--body-bg)] border-[var(--border-color)] hover:border-emerald-300'
                            }`}
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className="font-extrabold text-sm">{p.label}</span>
                                {p.recommended && (
                                    <span className="text-[9px] bg-emerald-500 text-white px-1.5 py-0.5 rounded-full font-bold">
                                        مُوصى به
                                    </span>
                                )}
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)] leading-relaxed">{p.hint}</div>
                        </button>
                    ))}
                </div>
            </div>

            {/* Publishable key entry */}
            <div className="mb-4">
                <label className="block text-xs font-extrabold text-[var(--text-secondary)] mb-2">
                    2️⃣ المفتاح العام (Publishable Key)
                </label>
                {pubKeyHint && (
                    <div className="mb-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 font-bold">
                        ✓ المفتاح العام محفوظ: <span className="tabular-nums">{pubKeyHint}</span>
                    </div>
                )}
                <div className="flex gap-2">
                    <input
                        type="password"
                        value={pubKey}
                        onChange={(e) => setPubKey(e.target.value)}
                        placeholder="pk_test_… أو pk_live_…"
                        className="flex-1 px-3 py-2.5 bg-[var(--body-bg)] border border-[var(--border-color)] rounded-xl text-sm font-bold focus:border-emerald-500 outline-none tabular-nums"
                        dir="ltr"
                    />
                    <button
                        onClick={savePubKey}
                        disabled={saving || !pubKey.trim()}
                        className="px-4 bg-emerald-500 hover:bg-emerald-600 text-white font-extrabold rounded-xl text-sm disabled:opacity-50"
                    >
                        💾 حفظ
                    </button>
                </div>
                <p className="text-[11px] text-[var(--text-secondary)] mt-1.5 font-bold">
                    ⚠️ هذا المفتاح <strong>العام</strong> فقط (يبدأ بـ pk_). لا تلصق المفتاح السرّي هنا أبداً.
                </p>
            </div>

            {/* Webhook URL */}
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="text-xs font-extrabold text-amber-900 mb-1">
                    3️⃣ Webhook URL — يحتاج Edge Function منفصل (لم يُنشأ بعد)
                </div>
                <div className="flex items-center gap-1.5">
                    <code className="flex-1 text-xs bg-[var(--card-bg)] px-2 py-1.5 rounded font-mono truncate" dir="ltr">
                        {webhookUrl || `https://<project>.supabase.co/functions/v1/${provider || 'moyasar'}-webhook`}
                    </code>
                    {webhookUrl && <CopyButton value={webhookUrl} label="رابط webhook" size="sm" />}
                </div>
                <p className="text-[11px] text-amber-800 mt-1.5">
                    عند بناء الـEdge Function، ضع المفتاح السرّي (sk_…) كـenv variable داخله — لا تضعه في DB ولا في الواجهة.
                </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-[var(--body-bg)] rounded-xl p-3 text-center">
                    <div className="text-2xl font-extrabold tabular-nums">{stats.total}</div>
                    <div className="text-[10px] font-bold text-[var(--text-secondary)]">محاولات</div>
                </div>
                <div className="bg-emerald-50 rounded-xl p-3 text-center">
                    <div className="text-2xl font-extrabold tabular-nums text-emerald-700">{stats.paid}</div>
                    <div className="text-[10px] font-bold text-emerald-700">دُفعت ✓</div>
                </div>
                <div className="bg-red-50 rounded-xl p-3 text-center">
                    <div className="text-2xl font-extrabold tabular-nums text-red-700">{stats.failed}</div>
                    <div className="text-[10px] font-bold text-red-700">فشلت</div>
                </div>
            </div>

            {/* Toggle activation */}
            <button
                onClick={toggleGateway}
                disabled={saving}
                className={`w-full py-3 rounded-xl font-extrabold text-sm transition-all ${
                    enabled
                        ? 'bg-red-500 hover:bg-red-600 text-white'
                        : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 text-white shadow-md'
                } disabled:opacity-50`}
            >
                {enabled ? '⛔ تعطيل البوابة' : '🚀 تفعيل البوابة (بعد اكتمال الإعدادات)'}
            </button>

            {/* Help link */}
            {providerMeta && (
                <div className="mt-3 text-[11px] text-[var(--text-secondary)] font-bold">
                    💡 لتسجيل حساب وحصول المفاتيح من <strong>{providerMeta.label}</strong> اكتب اسم البوابة في Google وادخل موقعها الرسمي. تحتاج: سجل تجاري، ملف ضريبي، حساب بنكي.
                </div>
            )}
        </section>
    );
};

// ============================================================
// Toggles Audit — every platform setting in one place
// ============================================================
const TogglesAudit: React.FC = () => {
    const [settings, setSettings] = useState<Array<{ key: string; value: any; description: string | null; updated_at: string }>>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        const r = await adminService.listPlatformSettings();
        setSettings(r);
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xl font-extrabold text-[var(--text-primary)]">⚙️ كل الـSettings (للقراءة)</h3>
                <button onClick={load} className="text-xs font-bold text-emerald-600">🔄 تحديث</button>
            </div>
            <p className="text-xs text-[var(--text-secondary)] mb-3 font-bold">
                كل الإعدادات المخزّنة في platform_settings. للتعديل، استخدم الواجهات المخصّصة في تاب «الأدوات» أو «إدارة البائعين».
            </p>
            {loading ? (
                <div className="h-32 bg-[var(--gray-100)] rounded-xl animate-pulse" />
            ) : settings.length === 0 ? (
                <div className="text-center py-8 text-sm text-[var(--gray-400)] font-bold">لا توجد إعدادات</div>
            ) : (
                <div className="space-y-2">
                    {settings.map((s) => {
                        const val = s.value;
                        const isBool = typeof val === 'boolean';
                        const isStr = typeof val === 'string';
                        const display = isBool
                            ? (val ? '✓ مفعّل' : '✗ معطّل')
                            : isStr
                            ? (val || '— فارغ —')
                            : JSON.stringify(val);
                        return (
                            <div key={s.key} className="flex items-start gap-3 bg-[var(--body-bg)] rounded-xl p-3">
                                <div className="flex-1 min-w-0">
                                    <div className="font-extrabold text-sm text-[var(--text-primary)]">{s.key}</div>
                                    {s.description && (
                                        <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{s.description}</div>
                                    )}
                                </div>
                                <div className={`text-xs font-extrabold tabular-nums px-2 py-1 rounded ${
                                    isBool
                                        ? (val ? 'bg-emerald-100 text-emerald-700' : 'bg-[var(--gray-100)] text-[var(--text-secondary)]')
                                        : 'bg-[var(--card-bg)] text-[var(--text-primary)] border border-[var(--border-color)]'
                                }`} dir="ltr" style={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {display}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
};

// ============================================================
// Launch Checklist — explicit manual gates
// ============================================================
interface ChecklistItem {
    id: string;
    label: string;
    detail: string;
    status: 'ready' | 'needs_work' | 'manual';
    category: 'security' | 'legal' | 'tech' | 'business';
}

const LAUNCH_CHECKLIST: ChecklistItem[] = [
    // ───── Security (الأمان) ─────
    { id: 'rls',             category: 'security', status: 'ready',       label: 'RLS مفعّل على كل الجداول الحساسة',          detail: 'فحص الـHealth Check يتأكد منها' },
    { id: 'admin-rpc',       category: 'security', status: 'ready',       label: 'كل admin_* RPCs محمية بـis_admin()',       detail: 'مطبّق منذ v9.7' },
    { id: 'csp',             category: 'security', status: 'ready',       label: 'Content Security Policy صارمة',             detail: 'مفعّلة في index.html — تمنع XSS' },
    { id: 'https',           category: 'security', status: 'ready',       label: 'HTTPS مفروض على كل الطلبات',                detail: 'Vercel يفرضه افتراضياً' },
    { id: 'referrer',        category: 'security', status: 'ready',       label: 'Referrer policy آمن',                       detail: 'strict-origin-when-cross-origin' },
    { id: 'rate-limit',      category: 'security', status: 'manual',      label: 'Rate limiting على الـauth + RPCs',         detail: 'Supabase يوفّر إعدادات افتراضية — راجعها في Dashboard' },
    { id: 'pentest',         category: 'security', status: 'manual',      label: 'Penetration testing',                       detail: 'لإطلاق رسمي على نطاق واسع — استعن بمختبر معتمد' },
    { id: 'secrets',         category: 'security', status: 'ready',       label: 'لا توجد مفاتيح سرّية في الكود',             detail: 'Anon key فقط في الـclient، باقي المفاتيح في Vercel env' },

    // ───── Legal (قانوني) ─────
    { id: 'terms',           category: 'legal',    status: 'ready',       label: 'شروط الاستخدام',                            detail: '/terms — مسوّدة جاهزة، تحتاج مراجعة محامي' },
    { id: 'privacy',         category: 'legal',    status: 'ready',       label: 'سياسة الخصوصية (PDPL)',                     detail: '/privacy — متوافقة مبدئياً مع نظام حماية البيانات السعودي' },
    { id: 'refund',          category: 'legal',    status: 'ready',       label: 'سياسة الاسترداد',                           detail: '/refund — جاهزة' },
    { id: 'about',           category: 'legal',    status: 'ready',       label: 'صفحة «من نحن»',                              detail: '/about' },
    { id: 'contact',         category: 'legal',    status: 'ready',       label: 'صفحة «اتصل بنا»',                            detail: '/contact' },
    { id: 'crm',             category: 'business', status: 'manual',      label: 'وثيقة عمل حر أو سجل تجاري + بنك',           detail: 'مطلوب من بوابات الدفع — وثيقة العمل الحر تكفي لـMoyasar' },
    { id: 'maroof',          category: 'legal',    status: 'manual',      label: 'تسجيل في منصة «معروف»',                     detail: 'maroof.sa — يزيد ثقة المشتري' },
    { id: 'vat',             category: 'legal',    status: 'manual',      label: 'التسجيل في ضريبة القيمة المضافة',           detail: 'إلزامي إذا تجاوزت الإيرادات ٣٧٥ ألف ر.س في ١٢ شهراً — تابع العدّاد التلقائي في تبويب «الزكاة والضريبة»' },
    { id: 'zakat',           category: 'legal',    status: 'manual',      label: 'تسجيل الزكاة + الإقرار السنوي',             detail: 'كل سجل تجاري يُسجَّل لدى هيئة الزكاة والضريبة والجمارك ويقدّم إقراراً زكوياً خلال ١٢٠ يوماً من نهاية السنة المالية' },
    { id: 'tax-system',      category: 'legal',    status: 'ready',       label: 'نظام الزكاة والضريبة والفواتير',            detail: 'تبويب «الزكاة والضريبة» يحسب تلقائياً ويُصدر فواتير قابلة للطباعة (v12.15)' },

    // ───── Tech (تقني) ─────
    { id: 'sw',              category: 'tech',     status: 'ready',       label: 'Service Worker + cache versioning',         detail: 'CACHE_NAME يُرفع كل deploy' },
    { id: 'pwa',             category: 'tech',     status: 'ready',       label: 'PWA installable على iOS وأندرويد',         detail: 'manifest + viewport-fit=cover' },
    { id: 'realtime',        category: 'tech',     status: 'ready',       label: 'Realtime channels تعمل',                    detail: '3 قنوات + heartbeat + bfcache' },
    { id: 'backup',          category: 'tech',     status: 'ready',       label: 'النسخ الاحتياطي اليومي',                    detail: 'Supabase يأخذ snapshots تلقائية' },
    { id: 'analytics',       category: 'tech',     status: 'ready',       label: 'Analytics tracking داخلي',                   detail: 'activity_log + store_analytics_events موجودة' },
    { id: 'errorboundary',   category: 'tech',     status: 'ready',       label: 'Error Boundary لكل التطبيق',                detail: 'يلتقط الأخطاء + يمسح SW عند ChunkLoadError' },
    { id: '404',             category: 'tech',     status: 'ready',       label: 'صفحة 404 مخصصة',                            detail: 'NotFound.tsx — تظهر لأي رابط غير معروف' },
    { id: 'sitemap',         category: 'tech',     status: 'ready',       label: 'sitemap.xml + robots.txt',                  detail: 'منشوران في الجذر للـSEO' },
    { id: 'og',              category: 'tech',     status: 'ready',       label: 'Open Graph + Twitter Card',                 detail: 'بطاقات معاينة جميلة في WhatsApp/Twitter' },
    { id: 'sentry',          category: 'tech',     status: 'ready',       label: 'Error monitoring خارجي (Sentry)',           detail: 'مفعّل ويستقبل الأخطاء منذ v11.51 — يلتقط أخطاء المستخدمين لحظياً' },
    { id: 'uptime',          category: 'tech',     status: 'manual',      label: 'Uptime monitoring (UptimeRobot)',           detail: 'تنبيه فوري لو الموقع نزل' },
    { id: 'load-test',       category: 'tech',     status: 'manual',      label: 'Load test 1M طلب على staging',              detail: 'استخدم الدليل أسفل هذا التاب' },
    { id: 'lighthouse',      category: 'tech',     status: 'manual',      label: 'Lighthouse score ≥ 90',                     detail: 'Chrome DevTools → Lighthouse → audit موبايل' },
    { id: 'a11y',            category: 'tech',     status: 'manual',      label: 'Accessibility audit (a11y)',                detail: 'WCAG 2.1 AA — تستخدم axe DevTools' },
    { id: 'real-device',     category: 'tech',     status: 'manual',      label: 'اختبار على iPhone + Android حقيقيَين',     detail: 'محاكي ≠ جهاز فعلي — اختبر على الأقل آيفون قديم + أندرويد متوسط' },
    { id: 'cross-browser',   category: 'tech',     status: 'manual',      label: 'Cross-browser: Safari + Chrome + Firefox',  detail: 'Safari خاصة (iOS) له اختلافات' },

    // ───── Business (الأعمال) ─────
    { id: 'payment',         category: 'business', status: 'needs_work',  label: 'بوابة الدفع متكاملة فعلياً',                detail: 'الـUI جاهز — يحتاج مفاتيح Moyasar حقيقية' },
    { id: 'edge-fn',         category: 'business', status: 'needs_work',  label: 'Edge Function للـwebhook منشورة',          detail: 'تستقبل أحداث الدفع وتنشئ subscription_payment' },
    { id: 'pricing',         category: 'business', status: 'manual',      label: 'خطة تسعير واضحة للتجار',                   detail: 'إذا فعّلت الدفع — كم يدفع التاجر شهرياً؟ ما الباقات؟' },
    { id: 'support',         category: 'business', status: 'manual',      label: 'قناة دعم عملاء',                            detail: 'واتساب أو إيميل مخصّص — راجع response time SLA' },
    { id: 'onboarding',      category: 'business', status: 'manual',      label: 'دعوة 10-20 تاجر أولي',                     detail: 'لبدء الزخم — منصة marketplace بدون تجار = فارغة' },
    { id: 'social',          category: 'business', status: 'manual',      label: 'حسابات Twitter + Instagram + TikTok',      detail: 'لإعلانات التسويق ودعم المجتمع' },
    { id: 'launch-plan',     category: 'business', status: 'manual',      label: 'خطة إطلاق + مواد تسويقية',                  detail: 'صور + فيديو + بيان صحفي + لائحة media kit' },
    { id: 'app-store',       category: 'business', status: 'manual',      label: 'App Store + Play Store (PWA-only الآن)',   detail: 'PWA يكفي للبداية — Native لاحقاً' },
];

const CHECKLIST_CATEGORY_LABELS: Record<string, { label: string; icon: string }> = {
    security: { label: 'الأمان',     icon: '🔒' },
    legal:    { label: 'قانوني',     icon: '⚖️' },
    tech:     { label: 'تقني',       icon: '⚙️' },
    business: { label: 'الأعمال',    icon: '💼' },
};

const CHECKLIST_STATUS: Record<string, { label: string; cls: string; icon: string }> = {
    ready:      { label: 'جاهز',          cls: 'bg-emerald-100 text-emerald-700', icon: '✓' },
    needs_work: { label: 'يحتاج عمل',    cls: 'bg-amber-100 text-amber-700',     icon: '⚙' },
    manual:     { label: 'يدوي — أنت',  cls: 'bg-blue-100 text-blue-700',       icon: '👤' },
};

const LaunchChecklist: React.FC = () => {
    const summary = useMemo(() => {
        const ready = LAUNCH_CHECKLIST.filter((i) => i.status === 'ready').length;
        const work = LAUNCH_CHECKLIST.filter((i) => i.status === 'needs_work').length;
        const manual = LAUNCH_CHECKLIST.filter((i) => i.status === 'manual').length;
        return { ready, work, manual, total: LAUNCH_CHECKLIST.length };
    }, []);

    const grouped = useMemo(() => {
        const map: Record<string, ChecklistItem[]> = {};
        for (const item of LAUNCH_CHECKLIST) (map[item.category] ??= []).push(item);
        return map;
    }, []);

    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <h3 className="text-xl font-extrabold text-[var(--text-primary)] mb-1 flex items-center gap-2">
                📋 قائمة ما قبل الإطلاق
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-3 font-bold">
                التقييم الصادق: {summary.ready} جاهز / {summary.work} يحتاج عمل / {summary.manual} يحتاج قرار منك
            </p>
            <div className="grid grid-cols-3 gap-2 mb-4">
                <SummaryTile label="جاهز" value={summary.ready} tone="emerald" />
                <SummaryTile label="يحتاج عمل" value={summary.work} tone="amber" />
                <SummaryTile label="يدوي" value={summary.manual} tone="gray" />
            </div>
            <div className="space-y-3">
                {Object.entries(grouped).map(([cat, items]) => {
                    const meta = CHECKLIST_CATEGORY_LABELS[cat];
                    return (
                        <div key={cat}>
                            <div className="text-xs font-extrabold text-[var(--text-secondary)] mb-1.5 flex items-center gap-1.5">
                                <span>{meta.icon}</span> {meta.label}
                            </div>
                            <div className="space-y-1.5">
                                {items.map((it) => {
                                    const s = CHECKLIST_STATUS[it.status];
                                    return (
                                        <div key={it.id} className="flex items-start gap-2 bg-[var(--body-bg)] rounded-xl p-3">
                                            <span className={`flex-shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-xs font-extrabold ${s.cls}`}>
                                                {s.icon}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold text-sm text-[var(--text-primary)]">{it.label}</div>
                                                <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{it.detail}</div>
                                            </div>
                                            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded ${s.cls} flex-shrink-0`}>
                                                {s.label}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};

// ============================================================
// Load Test Guide — instructions for k6, NOT execution
// ============================================================
const LoadTestGuide: React.FC = () => {
    const k6Script = `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
    // Ramps up to 10,000 virtual users over 10 minutes, holds for 20.
    stages: [
        { duration: '5m',  target: 1000  },
        { duration: '5m',  target: 10000 },
        { duration: '20m', target: 10000 },
        { duration: '5m',  target: 0     },
    ],
    thresholds: {
        http_req_duration: ['p(95)<800'], // 95% under 800ms
        http_req_failed:   ['rate<0.01'], // less than 1% failure
    },
};

const STAGING_URL = 'https://staging-taki-test.vercel.app';

export default function () {
    // Mix of read-heavy traffic — browse home, view a deal.
    const home = http.get(\`\${STAGING_URL}/\`);
    check(home, { 'home 200': (r) => r.status === 200 });
    sleep(2);

    const deal = http.get(\`\${STAGING_URL}/deal/sample-id\`);
    check(deal, { 'deal 200': (r) => r.status === 200 });
    sleep(3);
}`;

    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <h3 className="text-xl font-extrabold text-[var(--text-primary)] mb-1 flex items-center gap-2">
                🚀 دليل اختبار الحمل (Load Testing)
            </h3>
            <p className="text-xs text-[var(--text-secondary)] mb-4 font-bold">
                لتجربة الموقع تحت ضغط مليون مستخدم. <strong>لا يُجرى على الإنتاج أبداً</strong> — يكسره.
            </p>

            <div className="space-y-3">
                <Step n={1} title="جهّز بيئة staging منفصلة">
                    أنشئ مشروع Supabase staging + نشر Vercel preview branch منفصل. الـDB بيانات synthetic فقط.
                </Step>
                <Step n={2} title="رقّ خطة Supabase إن لزم">
                    Free tier = 50 connections فقط. للحِمل الكبير: Pro ($25/شهر) أو Team. راجع <strong>Supabase Dashboard → Settings → Compute</strong>.
                </Step>
                <Step n={3} title="ثبّت k6 محلياً">
                    على Mac: <code className="bg-[var(--body-bg)] px-1.5 py-0.5 rounded text-xs font-mono">brew install k6</code>
                </Step>
                <Step n={4} title="السكربت (انسخه — استبدل STAGING_URL)">
                    <pre className="bg-slate-900 text-emerald-300 p-3 rounded-lg text-xs overflow-x-auto mt-2 font-mono leading-relaxed" dir="ltr">
                        <code>{k6Script}</code>
                    </pre>
                    <div className="mt-1">
                        <CopyButton value={k6Script} label="السكربت" size="sm" />
                    </div>
                </Step>
                <Step n={5} title="شغّل الاختبار">
                    <code className="bg-[var(--body-bg)] px-1.5 py-0.5 rounded text-xs font-mono" dir="ltr">k6 run --vus 10000 --duration 30m load-test.js</code>
                </Step>
                <Step n={6} title="راقب بالتوازي">
                    <ul className="list-disc pr-5 space-y-1 text-xs">
                        <li>Supabase Dashboard → Database → Performance (latency, query stats)</li>
                        <li>Vercel Dashboard → Analytics (function invocations, error rate)</li>
                        <li>k6 console: rps + p95 + error rate live</li>
                    </ul>
                </Step>
                <Step n={7} title="حلّل النتائج">
                    إن تجاوز p95 الحد المسموح، استخدم Supabase logs لإيجاد أبطأ query، ثم أضف index أو caching.
                </Step>
            </div>

            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                <div className="text-xs font-extrabold text-red-900">⛔ مهم</div>
                <div className="text-[11px] text-red-800 mt-0.5 font-bold leading-relaxed">
                    لا تشغّل k6 ضد الإنتاج <strong>taki-test-eight.vercel.app</strong> أبداً. ستستهلك حصة Supabase الشهرية + قد توقف الموقع للمستخدمين الحقيقيين.
                </div>
            </div>
        </section>
    );
};

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
    <div className="flex gap-3">
        <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-extrabold flex items-center justify-center text-sm">
            {n}
        </div>
        <div className="flex-1">
            <div className="font-extrabold text-sm text-[var(--text-primary)] mb-0.5">{title}</div>
            <div className="text-xs text-[var(--text-secondary)] leading-relaxed">{children}</div>
        </div>
    </div>
);

// ============================================================
// Recent Payment Attempts table — surface every checkout, success or fail
// ============================================================
const PaymentAttemptsTable: React.FC = () => {
    const [attempts, setAttempts] = useState<Awaited<ReturnType<typeof adminService.listPaymentAttempts>>>([]);
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        setAttempts(await adminService.listPaymentAttempts(30, 50));
        setLoading(false);
    }, []);

    useEffect(() => { load(); }, [load]);

    if (loading) {
        return (
            <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
                <h3 className="text-xl font-extrabold mb-3">💸 محاولات الدفع</h3>
                <div className="h-24 bg-[var(--gray-100)] rounded-xl animate-pulse" />
            </section>
        );
    }
    if (attempts.length === 0) {
        return (
            <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
                <h3 className="text-xl font-extrabold text-[var(--text-primary)] mb-2">💸 محاولات الدفع</h3>
                <p className="text-xs text-[var(--text-secondary)] font-bold">
                    لم تُسجَّل أي محاولة دفع بعد. ستظهر هنا فور أول checkout عبر البوابة.
                </p>
            </section>
        );
    }
    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <h3 className="text-xl font-extrabold text-[var(--text-primary)] mb-3">💸 محاولات الدفع — آخر 30 يوم</h3>
            <div className="space-y-1.5 max-h-80 overflow-y-auto">
                {attempts.map((a) => {
                    const tone =
                        a.status === 'paid'   ? 'bg-emerald-50 border-emerald-200 text-emerald-800' :
                        a.status === 'failed' ? 'bg-red-50 border-red-200 text-red-800' :
                                                 'bg-[var(--body-bg)] border-[var(--border-color)] text-[var(--text-secondary)]';
                    return (
                        <div key={a.id} className={`border rounded-lg p-2.5 flex items-center gap-2 ${tone}`}>
                            <div className="flex-1 min-w-0">
                                <div className="font-bold text-sm truncate">{a.merchant_shop ?? a.merchant_name ?? '—'}</div>
                                <div className="text-[10px] opacity-80">{a.gateway} · {new Date(a.created_at).toLocaleString('ar-SA')}</div>
                            </div>
                            <div className="text-left">
                                <div className="text-sm font-extrabold tabular-nums">{a.amount.toLocaleString('ar-SA')} ر.س</div>
                                <div className="text-[10px] font-bold">{a.status}</div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
};

// ============================================================
// Smoke Test Runner — fetches every public route to make sure the SPA
// shell + static files are reachable. Doesn't deep-test UI, but catches
// the most common "shipped a broken build" failure mode.
// ============================================================
interface SmokeResult {
    path: string;
    label: string;
    expectStatus: number;
    expectsHtml: boolean;
    status: 'pending' | 'pass' | 'warn' | 'fail';
    httpStatus?: number;
    duration_ms?: number;
    detail?: string;
}

const SMOKE_ROUTES: Array<Omit<SmokeResult, 'status'>> = [
    // SPA routes — should all return the same index.html shell (200)
    { path: '/',              label: 'الرئيسية',              expectStatus: 200, expectsHtml: true },
    { path: '/deals',         label: 'قائمة العروض',          expectStatus: 200, expectsHtml: true },
    { path: '/nearby',        label: 'العروض القريبة',        expectStatus: 200, expectsHtml: true },
    { path: '/register',      label: 'صفحة التسجيل',         expectStatus: 200, expectsHtml: true },
    { path: '/about',         label: 'من نحن',                expectStatus: 200, expectsHtml: true },
    { path: '/contact',       label: 'اتصل بنا',              expectStatus: 200, expectsHtml: true },
    { path: '/terms',         label: 'شروط الاستخدام',        expectStatus: 200, expectsHtml: true },
    { path: '/privacy',       label: 'سياسة الخصوصية',        expectStatus: 200, expectsHtml: true },
    { path: '/refund',        label: 'سياسة الاسترداد',       expectStatus: 200, expectsHtml: true },
    { path: '/seasonal',      label: 'عروض الموسم',           expectStatus: 200, expectsHtml: true },
    // Static files
    { path: '/sw.js',                 label: 'Service Worker',       expectStatus: 200, expectsHtml: false },
    { path: '/manifest.webmanifest',  label: 'PWA Manifest',         expectStatus: 200, expectsHtml: false },
    { path: '/robots.txt',            label: 'robots.txt (SEO)',     expectStatus: 200, expectsHtml: false },
    { path: '/sitemap.xml',           label: 'sitemap.xml (SEO)',    expectStatus: 200, expectsHtml: false },
];

const SmokeTestRunner: React.FC = () => {
    const [results, setResults] = useState<SmokeResult[]>(() =>
        SMOKE_ROUTES.map((r) => ({ ...r, status: 'pending' as const })),
    );
    const [running, setRunning] = useState(false);
    const [lastRunAt, setLastRunAt] = useState<Date | null>(null);

    const run = useCallback(async () => {
        if (running) return;
        setRunning(true);
        setResults(SMOKE_ROUTES.map((r) => ({ ...r, status: 'pending' as const })));
        const promises = SMOKE_ROUTES.map(async (route, i) => {
            const start = performance.now();
            try {
                const res = await fetch(route.path, { method: 'GET', cache: 'no-cache' });
                const dur = Math.round(performance.now() - start);
                if (res.status !== route.expectStatus) {
                    return {
                        ...route,
                        status: 'fail' as const,
                        httpStatus: res.status,
                        duration_ms: dur,
                        detail: `متوقّع ${route.expectStatus} لكن HTTP ${res.status}`,
                    };
                }
                // Check content-type matches expectation
                if (route.expectsHtml) {
                    const text = await res.text();
                    if (!/<div\s+id=["']root["']|<title|<html/i.test(text)) {
                        return {
                            ...route,
                            status: 'warn' as const,
                            httpStatus: res.status,
                            duration_ms: dur,
                            detail: 'الاستجابة ليست HTML تطبيق',
                        };
                    }
                }
                return {
                    ...route,
                    status: 'pass' as const,
                    httpStatus: res.status,
                    duration_ms: dur,
                    detail: 'OK',
                };
            } catch (e: any) {
                return {
                    ...route,
                    status: 'fail' as const,
                    duration_ms: Math.round(performance.now() - start),
                    detail: e?.message ?? 'فشل غير معروف',
                };
            }
        });
        await Promise.all(promises.map(async (p, i) => {
            const r = await p;
            setResults((prev) => {
                const next = [...prev];
                next[i] = r;
                return next;
            });
        }));
        setRunning(false);
        setLastRunAt(new Date());
    }, [running]);

    const summary = useMemo(() => {
        const pass = results.filter((r) => r.status === 'pass').length;
        const warn = results.filter((r) => r.status === 'warn').length;
        const fail = results.filter((r) => r.status === 'fail').length;
        const pending = results.filter((r) => r.status === 'pending').length;
        return { total: results.length, pass, warn, fail, pending };
    }, [results]);

    return (
        <section className="bg-[var(--card-bg)] rounded-2xl p-5 border border-[var(--border-color)] shadow-sm">
            <div className="flex items-start justify-between flex-wrap gap-3 mb-4">
                <div>
                    <h3 className="text-xl font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                        🧪 اختبار الصفحات (Smoke Test)
                    </h3>
                    <p className="text-xs text-[var(--text-secondary)] mt-1 font-bold">
                        نقرة → فحص كل صفحة + ملف ستاتيك ({results.length}) في التطبيق. يلتقط «أرسلت إصداراً مكسوراً».
                    </p>
                </div>
                <button
                    onClick={run}
                    disabled={running}
                    className="px-5 h-11 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-extrabold rounded-xl text-sm shadow-md disabled:opacity-50 flex items-center gap-2"
                >
                    {running ? '⏳ يفحص...' : '🧪 ابدأ اختبار الصفحات'}
                </button>
            </div>

            <div className="grid grid-cols-4 gap-2 mb-3">
                <SummaryTile label="نجح" value={summary.pass} tone="emerald" />
                <SummaryTile label="تحذير" value={summary.warn} tone="amber" />
                <SummaryTile label="فشل" value={summary.fail} tone="red" />
                <SummaryTile label="معلّق" value={summary.pending} tone="gray" />
            </div>
            {lastRunAt && (
                <div className="text-[10px] text-[var(--gray-400)] font-bold mb-3 text-left">
                    آخر فحص: {lastRunAt.toLocaleString('ar-SA')}
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {results.map((r) => {
                    const s = STATUS_STYLE[r.status];
                    return (
                        <div key={r.path} className="flex items-center gap-2 p-2 bg-[var(--body-bg)] rounded-lg">
                            <span className={`w-6 h-6 rounded flex items-center justify-center font-extrabold text-xs ${s.bg} ${s.text}`}>
                                {s.icon}
                            </span>
                            <div className="flex-1 min-w-0">
                                <div className="text-sm font-bold text-[var(--text-primary)] truncate">
                                    {r.label}
                                </div>
                                <div className="text-[10px] text-[var(--text-secondary)] truncate font-mono" dir="ltr">
                                    {r.path}
                                </div>
                            </div>
                            {r.duration_ms !== undefined && r.status !== 'pending' && (
                                <div className="flex flex-col items-end">
                                    {r.httpStatus !== undefined && (
                                        <span className="text-[10px] text-[var(--gray-400)] font-bold tabular-nums">
                                            HTTP {r.httpStatus}
                                        </span>
                                    )}
                                    <span className="text-[10px] text-[var(--gray-400)] font-bold tabular-nums">
                                        {r.duration_ms}ms
                                    </span>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
};

// ============================================================
// Master container
// ============================================================
export const PreLaunchSuite: React.FC = () => (
    <div className="space-y-5 animate-fade-in" dir="rtl">
        <div>
            <h2 className="text-2xl font-extrabold text-[var(--text-primary)] flex items-center gap-2">
                🚀 جاهزية الإطلاق
                <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-2 py-0.5 rounded-full">
                    Pre-Launch
                </span>
            </h2>
            <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                فحص شامل، إعداد بوابة، ومراجعة ما يلزم قبل فتح الموقع لملايين المستخدمين
            </p>
        </div>

        <HealthCheckRunner />
        <SmokeTestRunner />
        <PaymentGatewaySetup />
        <PaymentAttemptsTable />
        <LaunchChecklist />
        <TogglesAudit />
        <LoadTestGuide />
    </div>
);

export default PreLaunchSuite;
