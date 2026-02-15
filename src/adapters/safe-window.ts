/**
 * Proxy wrapper for Meta.Window that prevents native SIGSEGV crashes.
 *
 * GJS Meta.Window references can outlive the underlying C GObject.
 * Calling any method on a dead GObject causes a native segfault that
 * try/catch cannot intercept — it kills the entire GNOME Shell session.
 *
 * This proxy intercepts every method call and checks liveness via
 * get_compositor_private() first. If dead, it throws a JS error
 * instead of segfaulting.
 */
import type Meta from 'gi://Meta';

const RAW = Symbol('SafeWindow.raw');

export function safeWindow(metaWindow: Meta.Window): Meta.Window {
    return new Proxy(metaWindow, {
        get(target, prop, receiver) {
            // Allow access to raw underlying object for identity checks
            if (prop === RAW) return target;

            const value = Reflect.get(target, prop, receiver);

            if (typeof value === 'function') {
                return function (this: unknown, ...args: unknown[]) {
                    // get_compositor_private is our liveness probe — always allow
                    if (prop !== 'get_compositor_private' &&
                        !target.get_compositor_private()) {
                        throw new Error(
                            `[PaperFlow] Dead Meta.Window: cannot call ${String(prop)}`,
                        );
                    }
                    return value.apply(target, args);
                };
            }

            return value;
        },
    });
}

/** Unwrap a safe-proxied window to the raw Meta.Window for identity comparisons. */
export function rawWindow(metaWindow: Meta.Window): Meta.Window {
    return (metaWindow as any)[RAW] ?? metaWindow;
}
