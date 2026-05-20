/**
 * LegalLayout — shared chrome for terms / privacy / refund / about / contact.
 *
 * Provides RTL, max-width, back button, last-updated banner, and a consistent
 * typography rhythm so every legal page looks like part of the same document
 * set. Each child page just supplies a title + children content.
 */

import React from 'react';
import { useHistory } from 'react-router-dom';

interface LegalLayoutProps {
    title: string;
    subtitle?: string;
    lastUpdated: string;
    draftNotice?: boolean;
    children: React.ReactNode;
}

export const LegalLayout: React.FC<LegalLayoutProps> = ({
    title,
    subtitle,
    lastUpdated,
    draftNotice = true,
    children,
}) => {
    const history = useHistory();
    return (
        <div className="min-h-screen bg-[var(--body-bg)] pb-24" dir="rtl">
            <div
                className="bg-[var(--card-bg)] border-b border-[var(--border-color)] sticky top-0 z-10 backdrop-blur"
                style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
            >
                <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
                    <button
                        onClick={() => (history.length > 1 ? history.goBack() : history.push('/'))}
                        className="w-10 h-10 rounded-xl bg-[var(--gray-100)] hover:bg-[var(--gray-200)] text-[var(--text-primary)] flex items-center justify-center font-extrabold text-lg"
                        aria-label="رجوع"
                    >
                        →
                    </button>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-base font-extrabold text-[var(--text-primary)] truncate">{title}</h1>
                        {subtitle && <p className="text-xs text-[var(--text-secondary)] truncate">{subtitle}</p>}
                    </div>
                </div>
            </div>

            <article className="max-w-3xl mx-auto px-4 py-6 space-y-4 text-[var(--text-primary)] leading-relaxed">
                {draftNotice && (
                    <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-3 text-xs font-bold">
                        ⚠️ <strong>مسوّدة:</strong> هذه الصياغة قاعدة مبدئية متوافقة مع المعايير السعودية ونظام حماية البيانات الشخصية (PDPL). يُنصح بمراجعتها من مستشار قانوني قبل الإطلاق التجاري الرسمي.
                    </div>
                )}
                <div className="text-[11px] text-[var(--text-secondary)] font-bold">
                    آخر تحديث: {lastUpdated}
                </div>
                {children}
            </article>
        </div>
    );
};

// ============================================================
// Small typography primitives — every legal page composes from these.
// ============================================================
export const Section: React.FC<{ n?: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
    <section className="space-y-2">
        <h2 className="text-lg font-extrabold text-[var(--text-primary)] mt-4">
            {n !== undefined ? `${n}. ` : ''}{title}
        </h2>
        <div className="space-y-2 text-sm">{children}</div>
    </section>
);

export const Paragraph: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <p className="text-sm leading-relaxed text-[var(--text-primary)]">{children}</p>
);

export const Bullets: React.FC<{ items: React.ReactNode[] }> = ({ items }) => (
    <ul className="list-disc pr-6 space-y-1.5 text-sm">
        {items.map((it, i) => <li key={i} className="leading-relaxed">{it}</li>)}
    </ul>
);

export default LegalLayout;
