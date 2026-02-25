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

            // Check liveness before accessing anything (except the probe itself)
            if (prop !== 'get_compositor_private' && !target.get_compositor_private()) {
                throw new Error(
                    `[Kestrel] Dead Meta.Window: cannot access ${String(prop)}`,
                );
            }

            // Get the value from the target (not the receiver) to avoid GObject getter issues
            const value = Reflect.get(target, prop, target);

            if (typeof value === 'function') {
                return function (this: unknown, ...args: unknown[]) {
                    return value.apply(target, args);
                };
            }

            return value;
        },
    });
}

