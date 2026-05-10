// One shared 1-second interval that fans out to every subscriber.
// Replaces N private setIntervals across the deal-card grid (one timer for
// the whole page instead of one per card).
type Listener = () => void;

const listeners = new Set<Listener>();
let timerId: ReturnType<typeof setInterval> | null = null;

const ensureTimer = () => {
    if (timerId !== null) return;
    timerId = setInterval(() => {
        listeners.forEach(fn => {
            try { fn(); } catch {}
        });
    }, 1000);
};

export const subscribeTicker = (listener: Listener): (() => void) => {
    listeners.add(listener);
    ensureTimer();
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timerId !== null) {
            clearInterval(timerId);
            timerId = null;
        }
    };
};
