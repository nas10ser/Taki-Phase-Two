/**
 * useEscClose — listen for Escape while a modal is active and call onClose.
 *
 * Adds the listener only when active=true so background pages don't
 * trap the key. Cleans up on unmount or when active flips to false.
 */

import { useEffect } from 'react';

export function useEscClose(active: boolean, onClose: () => void): void {
    useEffect(() => {
        if (!active) return;
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [active, onClose]);
}

export default useEscClose;
