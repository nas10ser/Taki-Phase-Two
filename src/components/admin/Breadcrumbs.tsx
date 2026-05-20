/**
 * Breadcrumbs — "You are here" path for the admin panel
 *
 * Tells a non-technical admin exactly where they are and lets them
 * jump back one level with a click. RTL-aware: the separator points
 * left (‹) because that's the "next" direction in Arabic reading.
 */

import React from 'react';

export interface Crumb {
    label: string;
    icon?: string;
    onClick?: () => void;
}

interface BreadcrumbsProps {
    items: Crumb[];
}

export const Breadcrumbs: React.FC<BreadcrumbsProps> = ({ items }) => {
    if (!items.length) return null;
    return (
        <nav
            aria-label="مسار التنقل"
            className="flex items-center gap-1 text-xs font-bold overflow-x-auto scrollbar-hide"
        >
            {items.map((item, i) => {
                const isLast = i === items.length - 1;
                const content = (
                    <>
                        {item.icon && <span className="ml-1">{item.icon}</span>}
                        <span className="truncate max-w-[160px]">{item.label}</span>
                    </>
                );
                return (
                    <React.Fragment key={i}>
                        {item.onClick && !isLast ? (
                            <button
                                onClick={item.onClick}
                                className="px-2 py-1 rounded-lg text-[var(--text-secondary)] hover:bg-[var(--gray-100)] hover:text-[var(--text-primary)] transition-colors flex items-center whitespace-nowrap"
                            >
                                {content}
                            </button>
                        ) : (
                            <span
                                className={`px-2 py-1 flex items-center whitespace-nowrap ${
                                    isLast
                                        ? 'text-[var(--text-primary)]'
                                        : 'text-[var(--text-secondary)]'
                                }`}
                            >
                                {content}
                            </span>
                        )}
                        {!isLast && (
                            <span aria-hidden className="text-[var(--gray-400)] text-base leading-none">
                                ‹
                            </span>
                        )}
                    </React.Fragment>
                );
            })}
        </nav>
    );
};

export default Breadcrumbs;
