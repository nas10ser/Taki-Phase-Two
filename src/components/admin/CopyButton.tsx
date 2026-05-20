/**
 * CopyButton — one-tap clipboard for the admin
 *
 * Used next to phone numbers, emails, IDs in lists and modals. Falls
 * back to execCommand for older Safari. Shows a quick ✓ confirmation
 * so the admin knows the copy succeeded without a noisy alert.
 */

import React, { useState } from 'react';

interface CopyButtonProps {
    value: string;
    label?: string;
    size?: 'xs' | 'sm' | 'md';
    className?: string;
}

export const CopyButton: React.FC<CopyButtonProps> = ({
    value,
    label,
    size = 'sm',
    className = '',
}) => {
    const [copied, setCopied] = useState(false);

    const handleClick = async (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (!value) return;
        const text = String(value);
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.position = 'fixed';
                ta.style.left = '-9999px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                document.body.removeChild(ta);
            }
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
        } catch {
            // Silent failure — the admin can manually copy.
        }
    };

    const sizes = size === 'md' ? 'w-8 h-8 text-base' : size === 'sm' ? 'w-7 h-7 text-sm' : 'w-6 h-6 text-xs';

    return (
        <button
            type="button"
            onClick={handleClick}
            aria-label={label ? `نسخ ${label}` : 'نسخ'}
            title={copied ? '✓ تم النسخ' : `نسخ${label ? ' ' + label : ''}`}
            className={`${sizes} flex-shrink-0 inline-flex items-center justify-center rounded-lg transition-all ${
                copied
                    ? 'bg-emerald-100 text-emerald-700 scale-110'
                    : 'bg-[var(--gray-100)] hover:bg-[var(--gray-200)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:scale-95'
            } ${className}`}
            disabled={!value}
        >
            {copied ? '✓' : '⧉'}
        </button>
    );
};

export default CopyButton;
