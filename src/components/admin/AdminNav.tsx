/**
 * AdminNav — تنقّل لوحة الإدارة (v14.89)
 * ═══════════════════════════════════════════════════════════════════════════
 * 🪤 ما استُبدل: ثمانية عشر تبويباً في شريطٍ أفقيّ واحد. على جوّال ناصر
 *    يظهر منها ثلاثة، والبقيّة خلف تمريرٍ أفقيّ لا يقول إنه موجود — فالتبويب
 *    الرابع عشر عملياً غير مكتشَف. ولأن كلّ تبويبٍ كان يحمل تدرّجاً لونياً
 *    خاصّاً به، لم يكن في الشريط أي تسلسلٍ بصريّ يقول «هذا أهمّ من ذاك».
 *
 * ما حلّ محلّه — ثلاث طبقاتٍ يستعملها كل لوحة إدارةٍ جادّة:
 *   ١. **مجموعات ستّ** بدل ثمانية عشر تبويباً. (وهي على عرض ٣٧٥ بكسل لا
 *      تَسَعُ صفّاً واحداً كاملاً: مجموع تسمياتها ≈ ٥٣٠ بكسل مقابل ≈ ٣٤٧
 *      متاحة، فيُرى ٣–٤ منها والباقي بتمرير. تحسّنٌ حقيقيّ عن ٣ من ١٨،
 *      ولا يُدّعى أكثر ممّا قِيس.)
 *   ٢. **شريط المجموعة الحالية**: تبويباتها وحدها (٢–٤)، فالتنقّل القريب فوريّ.
 *   ٣. **لوحةٌ كاملة** بزرٍّ واحد، تعرض كلَّ الشاشات مرتّبةً تحت مجموعاتها —
 *      لمن يريد الانتقال البعيد. و⌘K لمن يعرف اسم وجهته.
 *
 * والأسماء كلّها من `src/data/adminNav.ts` — مصدرٌ واحد لا اثنان.
 */

import React, { memo, useEffect, useRef } from 'react';
import {
    ADMIN_GROUPS, ADMIN_TABS, ADMIN_TAB_BY_ID,
    AdminTabId, AdminGroupId, AdminTabDef,
} from '../../data/adminNav';

/**
 * شاراتُ الانتباه — عددٌ **لكل تبويب**، لا رقمٌ واحد باسم شاشةٍ بعينها.
 * 🪤 كانت الشارة خاصّيةً اسمها `reportsBadge` تمرّ في ثلاثة مكوّنات وتُقارَن
 *    بـ`t.id === 'reports'` حرفياً في كلٍّ منها — أي أن أيّ شاشةٍ ثانية تحتاج
 *    شارة تعني خاصّيةً رابعة وثلاثَ مقارناتٍ جديدة. الشارة الآن مفتاحُها هويّة
 *    التبويب، فالمُضيف يملأ ما يعرفه والشريط يعرضه بلا أسماء مكتوبة.
 * ولا يُملأ منها إلا ما للقارئ صلاحيةٌ عليه — فالعدد نفسه معلومة.
 */
export type AdminBadges = Partial<Record<AdminTabId, number>>;

/** مجموع شارات مجموعةٍ ما — نقطةٌ واحدة تقول «هنا ما ينتظرك». */
const groupBadgeCount = (g: AdminGroupId, badges: AdminBadges): number =>
    ADMIN_TABS.reduce((sum, t) => (t.group === g ? sum + (badges[t.id] ?? 0) : sum), 0);

// ═══════════════════════════════════════════════════════════════════════════
// شريط المجموعات
// ═══════════════════════════════════════════════════════════════════════════

export const AdminGroupBar = memo<{
    activeGroup: AdminGroupId;
    onPick: (g: AdminGroupId) => void;
    /** المجموعات التي فيها تبويبٌ واحد مسموحٌ على الأقل */
    allowed: Set<AdminGroupId>;
    /** ما ينتظر المراجعة في كل شاشة — يُجمَع هنا على مستوى المجموعة */
    badges?: AdminBadges;
}>(({ activeGroup, onPick, allowed, badges = {} }) => (
    <div role="tablist" aria-label="أقسام لوحة الإدارة" style={{ display: 'flex', gap: 4, overflowX: 'auto' }} className="scrollbar-hide">
        {ADMIN_GROUPS.filter((g) => allowed.has(g.id)).map((g) => {
            const on = g.id === activeGroup;
            const count = groupBadgeCount(g.id, badges);
            return (
                <button
                    key={g.id}
                    role="tab"
                    aria-selected={on}
                    onClick={() => onPick(g.id)}
                    title={g.hint}
                    className="adm-focusable"
                    style={{
                        position: 'relative',
                        flexShrink: 0,
                        display: 'inline-flex', alignItems: 'center', gap: 6,
                        padding: '7px 13px',
                        fontSize: '.82rem', fontWeight: 800,
                        borderRadius: 999,
                        border: `1px solid ${on ? 'transparent' : 'var(--adm-border)'}`,
                        background: on ? 'var(--adm-fg)' : 'var(--adm-surface)',
                        color: on ? 'var(--adm-surface)' : 'var(--adm-fg-2)',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'background .15s, color .15s',
                    }}
                >
                    <span aria-hidden="true">{g.icon}</span>
                    {g.label}
                    {count > 0 && (
                        <span
                            /* 🪤 لا «${n} بلاغاً»: العربية تُغيّر المعدود بالعدد
                               (٣ بلاغات · ١١ بلاغاً). الصيغة هنا بلا معدودٍ
                               فتصحّ لكل رقم. */
                            aria-label={`بانتظار المراجعة: ${count}`}
                            style={{
                                minWidth: 17, height: 17, padding: '0 4px', borderRadius: 999,
                                background: 'var(--adm-bad-fg)', color: '#fff',
                                fontSize: '.62rem', fontWeight: 900,
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                fontVariantNumeric: 'tabular-nums',
                            }}
                        >
                            {count > 99 ? '99+' : count}
                        </span>
                    )}
                </button>
            );
        })}
    </div>
));
AdminGroupBar.displayName = 'AdminGroupBar';

// ═══════════════════════════════════════════════════════════════════════════
// شريط تبويبات المجموعة الحالية
// ═══════════════════════════════════════════════════════════════════════════

export const AdminTabBar = memo<{
    tabs: AdminTabDef[];
    active: AdminTabId;
    onPick: (t: AdminTabId) => void;
    badges?: AdminBadges;
}>(({ tabs, active, onPick, badges = {} }) => {
    if (tabs.length <= 1) return null;
    return (
        <div role="tablist" aria-label="شاشات هذا القسم" style={{ display: 'flex', gap: 3, overflowX: 'auto' }} className="scrollbar-hide">
            {tabs.map((t) => {
                const on = t.id === active;
                const count = badges[t.id] ?? 0;
                return (
                    <button
                        key={t.id}
                        role="tab"
                        aria-selected={on}
                        onClick={() => onPick(t.id)}
                        title={t.hint}
                        className="adm-focusable"
                        style={{
                            position: 'relative',
                            flexShrink: 0,
                            display: 'inline-flex', alignItems: 'center', gap: 5,
                            padding: '6px 11px',
                            fontSize: '.79rem', fontWeight: on ? 800 : 700,
                            border: 'none',
                            borderBottom: `2px solid ${on ? 'var(--adm-accent)' : 'transparent'}`,
                            background: 'transparent',
                            color: on ? 'var(--adm-fg)' : 'var(--adm-fg-3)',
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                            borderRadius: 0,
                        }}
                    >
                        <span aria-hidden="true">{t.icon}</span>
                        {t.label}
                        {count > 0 && (
                            <span
                                aria-label={`بانتظار المراجعة: ${count}`}
                                style={{
                                    minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999,
                                    background: 'var(--adm-bad-bg)', color: 'var(--adm-bad-fg)',
                                    fontSize: '.6rem', fontWeight: 900,
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    fontVariantNumeric: 'tabular-nums',
                                }}
                            >
                                {count > 99 ? '99+' : count}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
});
AdminTabBar.displayName = 'AdminTabBar';

// ═══════════════════════════════════════════════════════════════════════════
// اللوحة الكاملة — كل الشاشات تحت مجموعاتها
// ═══════════════════════════════════════════════════════════════════════════

export const AdminNavPanel: React.FC<{
    open: boolean;
    onClose: () => void;
    active: AdminTabId;
    onPick: (t: AdminTabId) => void;
    canSee: (t: AdminTabDef) => boolean;
    badges?: AdminBadges;
}> = ({ open, onClose, active, onPick, canSee, badges = {} }) => {
    const panelRef = useRef<HTMLDivElement>(null);

    // Esc يغلق، والتركيز ينتقل داخل اللوحة عند فتحها.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        panelRef.current?.focus();
        return () => document.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'flex-start' }}
            role="dialog"
            aria-modal="true"
            aria-label="كل شاشات لوحة الإدارة"
        >
            <button
                aria-label="إغلاق القائمة"
                onClick={onClose}
                style={{ position: 'absolute', inset: 0, background: 'rgba(8, 15, 22, .55)', border: 'none', cursor: 'pointer' }}
            />
            <div
                ref={panelRef}
                tabIndex={-1}
                style={{
                    position: 'relative',
                    width: 'min(330px, 88vw)',
                    height: '100%',
                    overflowY: 'auto',
                    background: 'var(--adm-surface)',
                    borderInlineEnd: '1px solid var(--adm-border)',
                    padding: 'calc(env(safe-area-inset-top, 0px) + 16px) 14px 28px',
                    boxShadow: 'var(--adm-shadow-lift)',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                    <span style={{ fontSize: '.95rem', fontWeight: 900, color: 'var(--adm-fg)' }}>كل الشاشات</span>
                    <button
                        onClick={onClose}
                        aria-label="إغلاق"
                        className="adm-focusable"
                        style={{
                            width: 30, height: 30, borderRadius: 'var(--adm-r-sm)',
                            border: '1px solid var(--adm-border)', background: 'var(--adm-surface-2)',
                            color: 'var(--adm-fg-2)', cursor: 'pointer', fontSize: '.9rem', lineHeight: 1,
                        }}
                    >
                        ✕
                    </button>
                </div>

                {ADMIN_GROUPS.map((g) => {
                    const tabs = ADMIN_TABS.filter((t) => t.group === g.id && canSee(t));
                    if (!tabs.length) return null;
                    return (
                        <div key={g.id} style={{ marginBottom: 18 }}>
                            <div
                                style={{
                                    fontSize: '.67rem', fontWeight: 900, letterSpacing: '.08em',
                                    color: 'var(--adm-fg-3)', marginBottom: 7, paddingInlineStart: 4,
                                }}
                            >
                                {g.icon} {g.label}
                            </div>
                            <div style={{ display: 'grid', gap: 2 }}>
                                {tabs.map((t) => {
                                    const on = t.id === active;
                                    const count = badges[t.id] ?? 0;
                                    return (
                                        <button
                                            key={t.id}
                                            onClick={() => { onPick(t.id); onClose(); }}
                                            className="adm-focusable"
                                            style={{
                                                display: 'flex', alignItems: 'flex-start', gap: 9,
                                                padding: '9px 10px', textAlign: 'right', width: '100%',
                                                borderRadius: 'var(--adm-r-sm)', border: 'none', cursor: 'pointer',
                                                background: on ? 'var(--adm-accent-weak)' : 'transparent',
                                                color: 'var(--adm-fg)',
                                            }}
                                        >
                                            <span aria-hidden="true" style={{ fontSize: '.95rem', lineHeight: 1.5 }}>{t.icon}</span>
                                            <span style={{ flex: 1, minWidth: 0 }}>
                                                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{ fontSize: '.85rem', fontWeight: on ? 900 : 700 }}>{t.label}</span>
                                                    {count > 0 && (
                                                        <span
                                                            aria-label={`بانتظار المراجعة: ${count}`}
                                                            style={{
                                                                minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999,
                                                                background: 'var(--adm-bad-fg)', color: '#fff',
                                                                fontSize: '.6rem', fontWeight: 900,
                                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                            }}
                                                        >
                                                            {count > 99 ? '99+' : count}
                                                        </span>
                                                    )}
                                                </span>
                                                <span style={{ display: 'block', fontSize: '.72rem', color: 'var(--adm-fg-3)', lineHeight: 1.7, marginTop: 2 }}>
                                                    {t.hint}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

/** عنوان الشاشة الحالية — مصدره الكتالوج، فلا يُكتب في كل ملفٍّ مرّة. */
export const adminTabTitle = (id: AdminTabId): { label: string; hint: string; icon: string } => {
    const t = ADMIN_TAB_BY_ID[id];
    return t ? { label: t.label, hint: t.hint, icon: t.icon } : { label: '', hint: '', icon: '' };
};
