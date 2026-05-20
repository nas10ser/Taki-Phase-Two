/**
 * PinButton — toggle a user/seller as "pinned" in the admin panel.
 *
 * Visual: a small star icon in a circle. When pinned it's amber and
 * filled; when not, it's a gray outline. Click stops propagation so it
 * can be embedded inside list rows that are themselves clickable.
 */

import React from 'react';
import { Tooltip } from './Tooltip';

interface PinButtonProps {
    pinned: boolean;
    onToggle: () => void;
    size?: 'sm' | 'md';
    title?: string;
}

export const PinButton: React.FC<PinButtonProps> = ({
    pinned,
    onToggle,
    size = 'sm',
    title,
}) => {
    const dims = size === 'md' ? 'w-9 h-9 text-base' : 'w-7 h-7 text-sm';
    return (
        <Tooltip text={title ?? (pinned ? 'إزالة من المفضّلة' : 'إضافة للمفضّلة')}>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    onToggle();
                }}
                aria-label={pinned ? 'إزالة من المفضّلة' : 'إضافة للمفضّلة'}
                aria-pressed={pinned}
                className={`${dims} inline-flex items-center justify-center rounded-full transition-all active:scale-90 ${
                    pinned
                        ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                        : 'bg-transparent text-[var(--gray-400)] hover:bg-[var(--gray-100)] hover:text-amber-500'
                }`}
            >
                <span aria-hidden>{pinned ? '★' : '☆'}</span>
            </button>
        </Tooltip>
    );
};

export default PinButton;
