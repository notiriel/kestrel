import Clutter from 'gi://Clutter';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

/**
 * Animate actor props with ease, or set them directly when duration is 0.
 * Replaces the repeated `if (duration > 0) { ease } else { set_position }` pattern.
 */
export function easeOrSet(
    actor: Clutter.Actor,
    props: Record<string, number>,
    duration: number,
    mode: Clutter.AnimationMode,
    onComplete?: () => void,
): void {
    if (duration > 0) {
        const easeParams: Record<string, unknown> = { ...props, duration, mode };
        if (onComplete) easeParams.onComplete = onComplete;
        (actor as unknown as Easeable).ease(easeParams);
    } else {
        for (const [key, value] of Object.entries(props)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (actor as any)[key] = value;
        }
        onComplete?.();
    }
}
