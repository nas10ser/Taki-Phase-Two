/**
 * PromoteToAdminDialog v11.19 — granular permission picker shown when the
 * super admin promotes a buyer or seller to staff admin.
 *
 * Exposes a Promise-based API (`openPromoteDialog(name) → string[] | null`)
 * so callers don't need to host the dialog in their JSX. Returns the
 * selected permission keys on confirm, or null on cancel. The actual RPC
 * call (`admin_promote_user`) is the caller's responsibility — keeping the
 * dialog dumb makes it reusable for "edit permissions" flows later.
 *
 * Default selection: every "tab_*" perm + a sensible action subset
 * (reports, banners, campaigns). Finance and impersonate are OFF by default
 * — those are the permissions Nasser explicitly said should NOT be handed
 * out without thought.
 */
import React, { useState } from 'react';
import { createRoot, Root } from 'react-dom/client';

interface PermDef {
    key: string;
    label: string;
    description: string;
    group: 'tabs' | 'actions';
    defaultOn: boolean;
}

const PERMS: PermDef[] = [
    { key: 'tab_overview',  label: '🏠 الرئيسية',         description: 'نظرة عامة',                  group: 'tabs',    defaultOn: true  },
    { key: 'tab_buyers',    label: '🛒 المشترون',         description: 'تبويب المشترين',             group: 'tabs',    defaultOn: true  },
    { key: 'tab_sellers',   label: '🏪 البائعون',         description: 'تبويب البائعين',             group: 'tabs',    defaultOn: true  },
    { key: 'tab_reports',   label: '🚩 البلاغات والشكاوى', description: 'مراجعة البلاغات',            group: 'tabs',    defaultOn: true  },
    { key: 'tab_analytics', label: '📊 التحليلات',         description: 'مؤشرات لحظية',               group: 'tabs',    defaultOn: false },
    { key: 'tab_tools',     label: '🛠️ الأدوات',          description: 'البنرات والحملات والإعدادات', group: 'tabs',    defaultOn: true  },
    { key: 'tab_messages',  label: '💬 مراقبة الرسائل',    description: 'متابعة كل المحادثات لحظياً',   group: 'tabs',    defaultOn: false },
    { key: 'tab_launch',    label: '🚀 الإطلاق',           description: 'فحص شامل + بوابة الدفع + قائمة ما قبل الإطلاق', group: 'tabs', defaultOn: false },
    { key: 'action_impersonate',       label: '🔓 دخول كحساب آخر',        description: 'فتح جلسة كاملة كأي مستخدم',     group: 'actions', defaultOn: false },
    { key: 'action_manage_sponsors',   label: '🌟 الرعاة الرسميون',         description: 'منح/إلغاء صفة راعٍ وتحديد الاستهداف', group: 'actions', defaultOn: false },
    { key: 'action_moderate_messages', label: '🚨 حذف/إنذار في الرسائل',    description: 'حذف رسالة أو إنذار مستخدم',     group: 'actions', defaultOn: false },
    { key: 'action_view_finance',      label: '💰 الأمور المالية',          description: 'GMV / MRR / الإيرادات',          group: 'actions', defaultOn: false },
    { key: 'action_manage_users',      label: '✏️ تعديل حسابات المستخدمين', description: 'تغيير بيانات أو تعليق حسابات',  group: 'actions', defaultOn: false },
    { key: 'action_delete_deals',      label: '🗑️ حذف العروض',              description: 'حذف منشورات التجار',             group: 'actions', defaultOn: true  },
    { key: 'action_manage_seasonal',   label: '🌟 عروض الموسم',             description: 'تثبيت / إلغاء عروض الموسم',      group: 'actions', defaultOn: true  },
    { key: 'action_manage_campaigns',  label: '📣 الحملات الترويجية',       description: 'إنشاء / تعديل الحملات',           group: 'actions', defaultOn: true  },
    { key: 'action_manage_banners',    label: '🎨 البنرات الإعلانية',       description: 'بنرات الإعلانات',                group: 'actions', defaultOn: true  },
];

interface DialogProps {
    targetName: string;
    onResolve: (result: string[] | null) => void;
}

const Dialog: React.FC<DialogProps> = ({ targetName, onResolve }) => {
    const [perms, setPerms] = useState<Set<string>>(() => {
        const s = new Set<string>();
        PERMS.forEach(p => { if (p.defaultOn) s.add(p.key); });
        return s;
    });

    const toggle = (k: string) => {
        setPerms(prev => {
            const next = new Set(prev);
            if (next.has(k)) next.delete(k);
            else next.add(k);
            return next;
        });
    };

    const grantAll = () => setPerms(new Set(PERMS.map(p => p.key)));
    const clearAll = () => setPerms(new Set());

    const handleConfirm = () => onResolve(Array.from(perms));
    const handleCancel = () => onResolve(null);

    const tabs = PERMS.filter(p => p.group === 'tabs');
    const actions = PERMS.filter(p => p.group === 'actions');

    return (
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[5000] flex items-center justify-center p-4 animate-fade-in"
            onClick={handleCancel}
            dir="rtl"
        >
            <div
                className="bg-[var(--card-bg)] rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="sticky top-0 z-10 bg-gradient-to-l from-amber-500 to-orange-600 text-white p-5 rounded-t-3xl flex items-center justify-between">
                    <div className="min-w-0">
                        <div className="text-xs opacity-90 font-bold">ترقية لمسؤول</div>
                        <div className="text-lg font-extrabold truncate">{targetName}</div>
                    </div>
                    <button
                        onClick={handleCancel}
                        className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-xl flex-shrink-0"
                        aria-label="إلغاء"
                    >✕</button>
                </div>

                <div className="p-5">
                    <p className="text-sm text-[var(--text-secondary)] mb-3 leading-6">
                        اختر الصلاحيات التي تريد منحها لهذا المسؤول. تستطيع تعديلها لاحقاً من تبويب «المسؤولون».
                    </p>

                    <div className="flex gap-2 mb-4">
                        <button
                            onClick={grantAll}
                            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                        >✓ منح الكل</button>
                        <button
                            onClick={clearAll}
                            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[var(--gray-100)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:bg-[var(--gray-200)]"
                        >إلغاء الكل</button>
                    </div>

                    <div className="mb-4">
                        <div className="text-xs font-extrabold text-[var(--text-secondary)] mb-2 uppercase">التبويبات التي يراها</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {tabs.map(p => {
                                const on = perms.has(p.key);
                                return (
                                    <label
                                        key={p.key}
                                        className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition ${on ? 'bg-emerald-50 border-emerald-300' : 'bg-[var(--body-bg)] border-[var(--border-color)] hover:bg-[var(--gray-100)]'}`}
                                    >
                                        <input type="checkbox" checked={on} onChange={() => toggle(p.key)} className="mt-1 w-4 h-4 accent-emerald-500" />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-extrabold text-[var(--text-primary)]">{p.label}</div>
                                            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{p.description}</div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <div className="text-xs font-extrabold text-[var(--text-secondary)] mb-2 uppercase">الإجراءات</div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {actions.map(p => {
                                const on = perms.has(p.key);
                                const isSensitive = p.key === 'action_view_finance' || p.key === 'action_impersonate';
                                return (
                                    <label
                                        key={p.key}
                                        className={`flex items-start gap-2 p-2 rounded-lg border cursor-pointer transition ${
                                            on
                                                ? (isSensitive ? 'bg-amber-50 border-amber-400' : 'bg-blue-50 border-blue-300')
                                                : 'bg-[var(--body-bg)] border-[var(--border-color)] hover:bg-[var(--gray-100)]'
                                        }`}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={on}
                                            onChange={() => toggle(p.key)}
                                            className={`mt-1 w-4 h-4 ${isSensitive ? 'accent-amber-500' : 'accent-blue-500'}`}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-extrabold text-[var(--text-primary)]">
                                                {p.label}
                                                {isSensitive && (
                                                    <span className="ml-1 text-[9px] font-bold text-amber-600">حساس</span>
                                                )}
                                            </div>
                                            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">{p.description}</div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                </div>

                <div className="sticky bottom-0 p-4 bg-[var(--body-bg)] border-t border-[var(--border-color)] rounded-b-3xl flex gap-2">
                    <button
                        onClick={handleCancel}
                        className="flex-1 py-3 bg-[var(--card-bg)] border border-[var(--border-color)] text-[var(--text-secondary)] font-bold rounded-xl hover:bg-[var(--gray-100)]"
                    >إلغاء</button>
                    <button
                        onClick={handleConfirm}
                        className="flex-1 py-3 bg-gradient-to-l from-amber-500 to-orange-600 text-white font-extrabold rounded-xl hover:shadow-lg active:scale-[0.98]"
                    >👑 ترقية ومنح الصلاحيات</button>
                </div>
            </div>
        </div>
    );
};

/**
 * Imperatively open the promote dialog. Returns the selected permission
 * keys on confirm, or `null` on cancel. The dialog is mounted into a
 * detached container and unmounted on resolve to avoid leaking nodes.
 */
export default function openPromoteDialog(targetName: string): Promise<string[] | null> {
    return new Promise(resolve => {
        const container = document.createElement('div');
        document.body.appendChild(container);
        let root: Root | null = null;
        const cleanup = () => {
            if (root) root.unmount();
            if (container.parentNode) container.parentNode.removeChild(container);
        };
        const onResolve = (result: string[] | null) => {
            cleanup();
            resolve(result);
        };
        root = createRoot(container);
        root.render(<Dialog targetName={targetName} onResolve={onResolve} />);
    });
}
