/**
 * CommandPalette — Cmd/Ctrl+K admin spotlight
 *
 * Type anything: a page name, a buyer's name/phone, a seller's shop,
 * or an action like "إضافة بانر" — and jump straight to it. This is
 * the discoverability layer for a non-technical admin who otherwise
 * has to remember which tab holds which feature.
 *
 * Keyboard: ArrowUp/Down to move, Enter to open, Esc to dismiss.
 * Mouse: hover to highlight, click to open.
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useHistory } from 'react-router-dom';
import { adminService, AdminUserRow } from '../../services/adminService';
import { useAdminRecents, RecentEntity } from '../../hooks/useAdminRecents';

export type AdminTab =
    | 'overview'
    | 'buyers'
    | 'sellers'
    | 'reports'
    | 'moderation'
    | 'analytics'
    | 'tools'
    | 'locations'
    | 'contests'
    | 'launch'
    | 'tax'
    | 'messages'
    | 'messaging'
    | 'admins';

interface CommandPaletteProps {
    open: boolean;
    onClose: () => void;
    onNavigate: (tab: AdminTab) => void;
    onQuickAction?: (id: string) => void;
}

type NavCommand = {
    kind: 'nav';
    id: string;
    label: string;
    icon: string;
    keywords: string;
    tab: AdminTab;
};
type ActionCommand = {
    kind: 'action';
    id: string;
    label: string;
    icon: string;
    keywords: string;
    subtitle?: string;
    run: () => void;
};
type UserCommand = {
    kind: 'user';
    id: string;
    user: AdminUserRow;
};
type RecentCommand = {
    kind: 'recent';
    id: string;
    recent: RecentEntity;
};
type Item = NavCommand | ActionCommand | UserCommand | RecentCommand;

export const CommandPalette: React.FC<CommandPaletteProps> = ({
    open,
    onClose,
    onNavigate,
    onQuickAction,
}) => {
    const [query, setQuery] = useState('');
    const [userMatches, setUserMatches] = useState<AdminUserRow[]>([]);
    const [selectedIdx, setSelectedIdx] = useState(0);
    const [searching, setSearching] = useState(false);
    const history = useHistory();
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const { recents } = useAdminRecents();

    // Static nav + action commands. Memoized so identity is stable for
    // dependency arrays.
    const navCommands: NavCommand[] = useMemo(() => [
        { kind: 'nav', id: 'nav-overview',  label: 'الرئيسية',         icon: '🏠', keywords: 'overview home dashboard رئيسية',                    tab: 'overview' },
        { kind: 'nav', id: 'nav-buyers',    label: 'إدارة المشترين',   icon: '🛒', keywords: 'buyers customers مشتري مشترين عميل',                tab: 'buyers' },
        { kind: 'nav', id: 'nav-sellers',   label: 'إدارة البائعين',   icon: '🏪', keywords: 'sellers merchants تاجر متاجر بائع اشتراك',          tab: 'sellers' },
        { kind: 'nav', id: 'nav-reports',   label: 'البلاغات والشكاوى', icon: '🚩', keywords: 'reports complaints بلاغ شكوى ابلاغ',                tab: 'reports' },
        { kind: 'nav', id: 'nav-moderation', label: 'الإنذارات (فلترة المحتوى)', icon: '🛡', keywords: 'moderation warnings nsfw filter انذار انذارات تحرش فلترة اباحي محتوى', tab: 'moderation' },
        { kind: 'nav', id: 'nav-analytics', label: 'التحليلات',        icon: '📊', keywords: 'analytics stats charts إحصائيات تقارير تحليلات',   tab: 'analytics' },
        { kind: 'nav', id: 'nav-tools',     label: 'أدوات الإدارة',    icon: '🛠️', keywords: 'tools settings banners campaigns بانر حملة اعدادات', tab: 'tools' },
        { kind: 'nav', id: 'nav-locations', label: 'المولات والأسواق', icon: '🏬', keywords: 'locations malls markets مول سوق مولات اسواق مواقع', tab: 'locations' },
        { kind: 'nav', id: 'nav-launch',    label: 'جاهزية الإطلاق',   icon: '🚀', keywords: 'launch prelaunch health check payment gateway اطلاق فحص دفع بوابة',  tab: 'launch' },
        { kind: 'nav', id: 'nav-tax',       label: 'الزكاة والضريبة',  icon: '🧾', keywords: 'tax vat zakat invoice زكاة ضريبة ضريبه فاتورة فواتير هيئة',           tab: 'tax' },
        { kind: 'nav', id: 'nav-messaging', label: 'الإشعارات والرسائل', icon: '📨', keywords: 'messaging notifications email templates اشعارات رسائل ايميل بريد قوالب تذكير اشتراك حجز', tab: 'messaging' },
    ], []);

    const actionCommands: ActionCommand[] = useMemo(() => [
        {
            kind: 'action', id: 'act-new-banner', icon: '🖼️',
            label: 'إضافة بانر إعلاني',
            subtitle: 'يفتح أدوات الإدارة → بانر جديد',
            keywords: 'banner add new بانر اضافة جديد اعلان',
            run: () => { onNavigate('tools'); onQuickAction?.('new-banner'); onClose(); },
        },
        {
            kind: 'action', id: 'act-new-campaign', icon: '📢',
            label: 'إنشاء حملة ترويجية',
            subtitle: 'يفتح أدوات الإدارة → حملة جديدة',
            keywords: 'campaign promotion new حملة ترويج جديد اعلان',
            run: () => { onNavigate('tools'); onQuickAction?.('new-campaign'); onClose(); },
        },
        {
            kind: 'action', id: 'act-view-reports', icon: '🚩',
            label: 'البلاغات المفتوحة',
            subtitle: 'انتقل لتاب البلاغات لمراجعتها',
            keywords: 'open reports complaints بلاغ مفتوح شكوى',
            run: () => { onNavigate('reports'); onClose(); },
        },
        {
            kind: 'action', id: 'act-live-stats', icon: '⚡',
            label: 'الإحصائيات اللحظية',
            subtitle: 'انتقل لتاب التحليلات',
            keywords: 'live stats real-time إحصائيات لحظية حية',
            run: () => { onNavigate('analytics'); onClose(); },
        },
        {
            kind: 'action', id: 'act-home', icon: '🏠',
            label: 'الخروج من لوحة الأدمن',
            subtitle: 'العودة للصفحة الرئيسية للتطبيق',
            keywords: 'exit home back خروج رجوع',
            run: () => { history.push('/'); onClose(); },
        },
    ], [onNavigate, onQuickAction, onClose, history]);

    // Reset state every time the palette opens.
    useEffect(() => {
        if (open) {
            setQuery('');
            setSelectedIdx(0);
            setUserMatches([]);
            window.setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    // Debounced user search (buyers + sellers). Triggers at 2+ chars to
    // avoid hammering the RPC on every keystroke.
    useEffect(() => {
        if (!open || query.trim().length < 2) {
            setUserMatches([]);
            return;
        }
        let alive = true;
        setSearching(true);
        const t = window.setTimeout(async () => {
            try {
                const [buyers, sellers] = await Promise.all([
                    adminService.searchUsers(query, 'buyer', 4, 0),
                    adminService.searchUsers(query, 'seller', 4, 0),
                ]);
                if (!alive) return;
                setUserMatches([...sellers, ...buyers]);
            } finally {
                if (alive) setSearching(false);
            }
        }, 250);
        return () => { alive = false; window.clearTimeout(t); };
    }, [query, open]);

    // Filtered nav/action by query.
    const q = query.trim().toLowerCase();
    const matchesQ = (c: NavCommand | ActionCommand) =>
        !q || c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q);
    const filteredNav = navCommands.filter(matchesQ);
    const filteredActions = actionCommands.filter(matchesQ);

    // Recents only show when the input is empty — once typing starts,
    // the search results take over so the list isn't cluttered.
    const showRecents = !q && recents.length > 0;

    // Flat ordered list (used for keyboard nav).
    const items: Item[] = useMemo(() => {
        const out: Item[] = [];
        if (showRecents) {
            recents.forEach((r) => out.push({ kind: 'recent', id: r.id, recent: r }));
        }
        filteredNav.forEach((c) => out.push(c));
        filteredActions.forEach((c) => out.push(c));
        userMatches.forEach((u) => out.push({ kind: 'user', id: u.id, user: u }));
        return out;
    }, [filteredNav, filteredActions, userMatches, showRecents, recents]);

    // Reset highlight when results change.
    useEffect(() => {
        setSelectedIdx(0);
    }, [query, userMatches.length]);

    const runItem = (it: Item) => {
        if (it.kind === 'nav') {
            onNavigate(it.tab);
            onClose();
        } else if (it.kind === 'action') {
            it.run();
        } else if (it.kind === 'user') {
            const u = it.user;
            if (u.user_type === 'seller') {
                history.push(`/store/${u.id}`);
            } else {
                history.push(`/admin?tab=buyers&q=${encodeURIComponent(u.name ?? u.id)}`);
            }
            onClose();
        } else if (it.kind === 'recent') {
            const r = it.recent;
            if (r.type === 'seller') {
                history.push(`/store/${r.id}`);
            } else {
                history.push(`/admin?tab=buyers&q=${encodeURIComponent(r.name)}`);
            }
            onClose();
        }
    };

    // Global keyboard handler (only mounted while palette is open).
    useEffect(() => {
        if (!open) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
                return;
            }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIdx((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const it = items[selectedIdx];
                if (it) runItem(it);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, items, selectedIdx]);

    // Scroll the highlighted row into view.
    useEffect(() => {
        if (!open || !listRef.current) return;
        const el = listRef.current.querySelector<HTMLElement>(`[data-cmd-idx="${selectedIdx}"]`);
        if (el) el.scrollIntoView({ block: 'nearest' });
    }, [selectedIdx, open]);

    if (!open) return null;

    let runningIdx = -1;
    const recentStart = runningIdx + 1;
    if (showRecents) runningIdx += recents.length;
    const navStart = runningIdx + 1;
    runningIdx += filteredNav.length;
    const actionStart = runningIdx + 1;
    runningIdx += filteredActions.length;
    const userStart = runningIdx + 1;

    return (
        <div
            className="fixed inset-0 bg-black/50 backdrop-blur-md z-[5000] flex items-start justify-center pt-[10vh] px-4 animate-fade-in"
            onClick={onClose}
        >
            <div
                className="bg-[var(--card-bg)] rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden border border-[var(--border-color)]"
                onClick={(e) => e.stopPropagation()}
                dir="rtl"
                role="dialog"
                aria-label="بحث سريع"
            >
                {/* Search input */}
                <div className="p-4 border-b border-[var(--border-color)] flex items-center gap-3">
                    <span className="text-2xl" aria-hidden>🔎</span>
                    <input
                        ref={inputRef}
                        type="text"
                        placeholder="اكتب أي شيء... صفحة، تاجر، مشتري، إجراء"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="flex-1 bg-transparent outline-none text-base font-bold text-[var(--text-primary)] placeholder:text-[var(--gray-400)]"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {searching && (
                        <span className="text-xs text-[var(--text-secondary)] font-bold">يبحث...</span>
                    )}
                    <kbd className="text-[10px] font-bold text-[var(--gray-400)] bg-[var(--gray-100)] px-2 py-1 rounded-md">
                        Esc
                    </kbd>
                </div>

                {/* Results */}
                <div
                    ref={listRef}
                    className="max-h-[60vh] overflow-y-auto p-2 space-y-1"
                >
                    {items.length === 0 ? (
                        <div className="text-center py-14 text-sm text-[var(--gray-400)] font-bold">
                            {q ? `لا نتائج لـ "${query}"` : 'ابدأ بالكتابة للبحث...'}
                        </div>
                    ) : (
                        <>
                            {showRecents && (
                                <>
                                    <CategoryHeader label="آخر ما فتحت" />
                                    {recents.map((r, i) => {
                                        const idx = recentStart + i;
                                        const active = idx === selectedIdx;
                                        const isSeller = r.type === 'seller';
                                        return (
                                            <CommandRow
                                                key={`recent-${r.id}`}
                                                idx={idx}
                                                active={active}
                                                icon="🕒"
                                                title={r.shop ?? r.name}
                                                subtitle={r.phone ?? (isSeller ? 'تاجر' : 'مشتري')}
                                                subtitleLtr={!!r.phone}
                                                badge={isSeller ? 'تاجر' : 'مشتري'}
                                                onHover={() => setSelectedIdx(idx)}
                                                onSelect={() => runItem({ kind: 'recent', id: r.id, recent: r })}
                                                accent={isSeller ? 'purple' : 'blue'}
                                            />
                                        );
                                    })}
                                </>
                            )}

                            {filteredNav.length > 0 && (
                                <CategoryHeader label="الصفحات" />
                            )}
                            {filteredNav.map((c, i) => {
                                const idx = navStart + i;
                                const active = idx === selectedIdx;
                                return (
                                    <CommandRow
                                        key={c.id}
                                        idx={idx}
                                        active={active}
                                        icon={c.icon}
                                        title={c.label}
                                        onHover={() => setSelectedIdx(idx)}
                                        onSelect={() => runItem(c)}
                                        accent="emerald"
                                    />
                                );
                            })}

                            {filteredActions.length > 0 && (
                                <CategoryHeader label="إجراءات سريعة" />
                            )}
                            {filteredActions.map((c, i) => {
                                const idx = actionStart + i;
                                const active = idx === selectedIdx;
                                return (
                                    <CommandRow
                                        key={c.id}
                                        idx={idx}
                                        active={active}
                                        icon={c.icon}
                                        title={c.label}
                                        subtitle={c.subtitle}
                                        onHover={() => setSelectedIdx(idx)}
                                        onSelect={() => runItem(c)}
                                        accent="amber"
                                    />
                                );
                            })}

                            {userMatches.length > 0 && (
                                <CategoryHeader label="المستخدمون" />
                            )}
                            {userMatches.map((u, i) => {
                                const idx = userStart + i;
                                const active = idx === selectedIdx;
                                const isSeller = u.user_type === 'seller';
                                return (
                                    <CommandRow
                                        key={u.id}
                                        idx={idx}
                                        active={active}
                                        icon={isSeller ? '🏪' : '🛒'}
                                        title={u.shop ?? u.name ?? '—'}
                                        subtitle={u.phone ?? u.email ?? '—'}
                                        subtitleLtr
                                        badge={isSeller ? 'تاجر' : 'مشتري'}
                                        onHover={() => setSelectedIdx(idx)}
                                        onSelect={() => runItem({ kind: 'user', id: u.id, user: u })}
                                        accent={isSeller ? 'purple' : 'blue'}
                                    />
                                );
                            })}
                        </>
                    )}
                </div>

                {/* Footer hints */}
                <div className="px-4 py-2.5 border-t border-[var(--border-color)] flex items-center justify-between gap-3 text-[10px] text-[var(--text-secondary)] font-bold bg-[var(--body-bg)]">
                    <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                            <kbd className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded px-1.5 py-0.5">↑</kbd>
                            <kbd className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded px-1.5 py-0.5">↓</kbd>
                            تنقل
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded px-1.5 py-0.5">↵</kbd>
                            فتح
                        </span>
                        <span className="flex items-center gap-1">
                            <kbd className="bg-[var(--card-bg)] border border-[var(--border-color)] rounded px-1.5 py-0.5">Esc</kbd>
                            خروج
                        </span>
                    </div>
                    <span className="opacity-70">⌘K للفتح في أي وقت</span>
                </div>
            </div>
        </div>
    );
};

// ============================================================
// Subcomponents
// ============================================================

const CategoryHeader: React.FC<{ label: string }> = ({ label }) => (
    <div className="px-3 pt-3 pb-1 text-[10px] font-bold text-[var(--gray-400)] uppercase tracking-wide">
        {label}
    </div>
);

const ACCENT: Record<string, string> = {
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    blue: 'bg-blue-50 text-blue-700',
    purple: 'bg-purple-50 text-purple-700',
};

interface CommandRowProps {
    idx: number;
    active: boolean;
    icon: string;
    title: string;
    subtitle?: string;
    subtitleLtr?: boolean;
    badge?: string;
    accent: 'emerald' | 'amber' | 'blue' | 'purple';
    onHover: () => void;
    onSelect: () => void;
}

const CommandRow: React.FC<CommandRowProps> = ({
    idx,
    active,
    icon,
    title,
    subtitle,
    subtitleLtr,
    badge,
    accent,
    onHover,
    onSelect,
}) => (
    <button
        type="button"
        data-cmd-idx={idx}
        onClick={onSelect}
        onMouseEnter={onHover}
        className={`w-full text-right px-3 py-2.5 rounded-xl flex items-center gap-3 transition-colors ${
            active ? ACCENT[accent] : 'hover:bg-[var(--gray-100)] text-[var(--text-primary)]'
        }`}
    >
        <span className="text-xl flex-shrink-0">{icon}</span>
        <div className="flex-1 min-w-0 text-right">
            <div className="font-bold text-sm truncate">{title}</div>
            {subtitle && (
                <div
                    className={`text-xs ${
                        active ? 'opacity-80' : 'text-[var(--text-secondary)]'
                    } truncate`}
                    dir={subtitleLtr ? 'ltr' : 'rtl'}
                >
                    {subtitle}
                </div>
            )}
        </div>
        {badge && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--gray-400)] flex-shrink-0">
                {badge}
            </span>
        )}
        {active && (
            <span className="text-[10px] font-bold opacity-80 flex-shrink-0">↵</span>
        )}
    </button>
);

export default CommandPalette;
