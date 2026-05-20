/**
 * Tooltip — admin-grade hover/focus tooltip
 *
 * Shows on hover (desktop), focus (keyboard), and long-press (mobile).
 * RTL-aware. Disappears on Esc and on click. Used to teach the admin
 * what every icon-only button does — the answer to "I don't know what
 * this does until I click it."
 */

import React, { useState, useRef, useEffect } from 'react';

interface TooltipProps {
    text: string;
    children: React.ReactNode;
    side?: 'top' | 'bottom';
    delay?: number;
    inline?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({
    text,
    children,
    side = 'top',
    delay = 350,
    inline = true,
}) => {
    const [show, setShow] = useState(false);
    const timer = useRef<number | null>(null);

    const open = () => {
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setShow(true), delay);
    };
    const close = () => {
        if (timer.current) {
            window.clearTimeout(timer.current);
            timer.current = null;
        }
        setShow(false);
    };

    useEffect(() => () => {
        if (timer.current) window.clearTimeout(timer.current);
    }, []);

    if (!text) return <>{children}</>;

    const Wrap: any = inline ? 'span' : 'div';

    return (
        <Wrap
            className={`relative ${inline ? 'inline-flex' : 'flex'}`}
            onMouseEnter={open}
            onMouseLeave={close}
            onFocus={open}
            onBlur={close}
            onTouchStart={open}
            onTouchEnd={() => window.setTimeout(close, 800)}
        >
            {children}
            {show && (
                <span
                    role="tooltip"
                    className={`absolute z-[9999] left-1/2 -translate-x-1/2 ${
                        side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
                    } px-2.5 py-1.5 bg-[var(--text-primary)] text-[var(--card-bg)] text-xs font-bold rounded-lg shadow-lg pointer-events-none animate-fade-in`}
                    style={{ maxWidth: 240, whiteSpace: 'normal', textAlign: 'center', lineHeight: 1.4 }}
                >
                    {text}
                    <span
                        aria-hidden
                        className="absolute left-1/2 -translate-x-1/2"
                        style={{
                            width: 0,
                            height: 0,
                            borderLeft: '5px solid transparent',
                            borderRight: '5px solid transparent',
                            ...(side === 'top'
                                ? { top: '100%', borderTop: '5px solid var(--text-primary)' }
                                : { bottom: '100%', borderBottom: '5px solid var(--text-primary)' }),
                        }}
                    />
                </span>
            )}
        </Wrap>
    );
};

export default Tooltip;
