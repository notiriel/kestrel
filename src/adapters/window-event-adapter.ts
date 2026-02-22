import type { WindowId } from '../domain/types.js';
import type { WindowEventPort, WindowEventCallbacks } from '../ports/window-event-port.js';
import { safeDisconnect } from './signal-utils.js';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';

const FIRST_FRAME_TIMEOUT_MS = 2000;

export type { WindowEventCallbacks };

export { shouldTile };

// WM classes that should never be tiled (e.g. DING desktop icons)
const WM_CLASS_BLOCKLIST = ['gjs'];

function shouldTile(metaWindow: Meta.Window): boolean {
    if (metaWindow.get_window_type() !== Meta.WindowType.NORMAL) return false;
    if (metaWindow.is_above()) return false;
    if (metaWindow.get_transient_for() !== null) return false;
    if (metaWindow.is_skip_taskbar()) return false;
    const wmClass = metaWindow.get_wm_class();
    if (!wmClass || wmClass === 'null') return false;
    if (WM_CLASS_BLOCKLIST.includes(wmClass)) return false;
    return true;
}

function shouldFloat(metaWindow: Meta.Window): boolean {
    const type = metaWindow.get_window_type();
    const wmClass = metaWindow.get_wm_class();

    // Popup/menu/tooltip types always float — they must render above the clone
    // layer. These don't require a wm_class check since they're transient
    // surfaces that may not have one set yet.
    if (type === Meta.WindowType.POPUP_MENU ||
        type === Meta.WindowType.DROPDOWN_MENU ||
        type === Meta.WindowType.MENU ||
        type === Meta.WindowType.TOOLTIP ||
        type === Meta.WindowType.COMBO) return true;

    if (!wmClass || wmClass === 'null') return false;
    if (WM_CLASS_BLOCKLIST.includes(wmClass)) return false;

    // Dialog types always float
    if (type === Meta.WindowType.DIALOG ||
        type === Meta.WindowType.MODAL_DIALOG ||
        type === Meta.WindowType.UTILITY ||
        type === Meta.WindowType.SPLASHSCREEN ||
        type === Meta.WindowType.TOOLBAR) return true;

    // Normal windows that can't be tiled (transient, above, skip-taskbar) float.
    // skip-taskbar windows (e.g. ulauncher) must be floated so they render
    // above the clone layer; otherwise they're stuck behind it in window_group.
    if (type === Meta.WindowType.NORMAL) {
        if (metaWindow.is_above()) return true;
        if (metaWindow.get_transient_for() !== null) return true;
        if (metaWindow.is_skip_taskbar()) return true;
    }

    return false;
}

function getWindowId(metaWindow: Meta.Window): WindowId {
    return String(metaWindow.get_stable_sequence()) as WindowId;
}

export class WindowEventAdapter implements WindowEventPort {
    private _windowCreatedId: number | null = null;
    private _actorDestroyIds: Map<WindowId, number> = new Map();
    private _fullscreenSignalIds: Map<WindowId, { metaWindow: Meta.Window; signalId: number }> = new Map();
    private _maximizeSignalIds: Map<WindowId, { metaWindow: Meta.Window; signalId: number }> = new Map();
    private _timeoutIds: Set<number> = new Set();
    private _pendingWindows: Set<WindowId> = new Set();
    private _callbacks: WindowEventCallbacks | null = null;

    connect(callbacks: WindowEventCallbacks): void {
        this._callbacks = callbacks;
        const display = global.display;

        this._windowCreatedId = display.connect('window-created',
            (_display: Meta.Display, metaWindow: Meta.Window) => {
                try {
                    this._handleWindowCreated(metaWindow);
                } catch (e) {
                    console.error('[Kestrel] Error in window-created handler:', e);
                }
            },
        );
    }

    enumerateExisting(): void {
        const actors = global.get_window_actors();
        for (const actor of actors) {
            try {
                const metaWindow = (actor as Meta.WindowActor).get_meta_window();
                if (!metaWindow) continue;
                const windowId = getWindowId(metaWindow);
                if (shouldTile(metaWindow)) {
                    this._callbacks?.onWindowReady(windowId, metaWindow);
                    this._watchActorDestroy(actor as Meta.WindowActor, windowId, false, metaWindow);
                } else if (shouldFloat(metaWindow)) {
                    this._callbacks?.onFloatWindowReady(windowId, metaWindow);
                    this._watchActorDestroy(actor as Meta.WindowActor, windowId, true);
                }
            } catch (e) {
                console.error('[Kestrel] Error enumerating window:', e);
            }
        }
    }

    private _handleWindowCreated(metaWindow: Meta.Window): void {
        const windowId = getWindowId(metaWindow);
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;

        if (!actor) return;

        // Popup/menu/tooltip windows must be handled immediately — they're very
        // transient and waiting for first-frame would make them appear too late.
        const type = metaWindow.get_window_type();
        if (type === Meta.WindowType.POPUP_MENU ||
            type === Meta.WindowType.DROPDOWN_MENU ||
            type === Meta.WindowType.MENU ||
            type === Meta.WindowType.TOOLTIP ||
            type === Meta.WindowType.COMBO) {
            this._callbacks?.onFloatWindowReady(windowId, metaWindow);
            this._watchActorDestroy(actor, windowId, true);
            return;
        }

        // Guard against double-fire (first-frame + timeout)
        this._pendingWindows.add(windowId);

        // Defer tile/float classification to after first-frame, when window
        // properties (type, transient_for, wm_class) are finalized.
        const onReady = () => {
            if (!this._pendingWindows.delete(windowId)) return; // Already fired
            const tile = shouldTile(metaWindow);
            const float = !tile && shouldFloat(metaWindow);
            if (!tile && !float) return;
            if (tile) {
                this._callbacks?.onWindowReady(windowId, metaWindow);
                this._watchActorDestroy(actor, windowId, false, metaWindow);
            } else {
                this._callbacks?.onFloatWindowReady(windowId, metaWindow);
                this._watchActorDestroy(actor, windowId, true);
            }
        };

        // Wait for first-frame, with timeout fallback.
        // Use a fired flag to ensure we only disconnect once — calling
        // actor.disconnect() on an already-disconnected signal emits a
        // GLib C-level warning that JS try/catch cannot suppress.
        let firstFrameFired = false;
        const firstFrameId = actor.connect('first-frame', () => {
            if (firstFrameFired) return;
            firstFrameFired = true;
            actor.disconnect(firstFrameId);
            onReady();
        });

        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FIRST_FRAME_TIMEOUT_MS, () => {
            if (!firstFrameFired) {
                firstFrameFired = true;
                actor.disconnect(firstFrameId);
            }
            this._timeoutIds.delete(timeoutId);
            onReady();
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.add(timeoutId);
    }

    private _watchActorDestroy(actor: Meta.WindowActor, windowId: WindowId, isFloat: boolean, metaWindow?: Meta.Window): void {
        const destroyId = actor.connect('destroy', () => {
            try {
                this._actorDestroyIds.delete(windowId);
                this._disconnectTrackedSignal(this._fullscreenSignalIds, windowId);
                this._disconnectTrackedSignal(this._maximizeSignalIds, windowId);
                if (isFloat) {
                    this._callbacks?.onFloatWindowDestroyed(windowId);
                } else {
                    this._callbacks?.onWindowDestroyed(windowId);
                }
            } catch (e) {
                console.error('[Kestrel] Error in actor destroy handler:', e);
            }
        });
        this._actorDestroyIds.set(windowId, destroyId);

        // Track fullscreen changes for tiled windows
        if (!isFloat && metaWindow) {
            const signalId = metaWindow.connect('notify::fullscreen', () => {
                try {
                    this._callbacks?.onWindowFullscreenChanged(windowId, metaWindow.fullscreen);
                } catch (e) {
                    console.error('[Kestrel] Error in fullscreen handler:', e);
                }
            });
            this._fullscreenSignalIds.set(windowId, { metaWindow, signalId });

            // Track maximize changes — fire only when becoming maximized
            const maxSignalId = metaWindow.connect('notify::maximized-horizontally', () => {
                try {
                    if (metaWindow.maximized_horizontally) {
                        this._callbacks?.onWindowMaximized(windowId);
                    }
                } catch (e) {
                    console.error('[Kestrel] Error in maximize handler:', e);
                }
            });
            this._maximizeSignalIds.set(windowId, { metaWindow, signalId: maxSignalId });
        }
    }

    private _disconnectTrackedSignal(map: Map<WindowId, { metaWindow: Meta.Window; signalId: number }>, windowId: WindowId): void {
        const entry = map.get(windowId);
        if (entry) {
            safeDisconnect(entry.metaWindow, entry.signalId);
            map.delete(windowId);
        }
    }

    destroy(): void {
        if (this._windowCreatedId !== null) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }

        for (const timeoutId of this._timeoutIds) {
            GLib.source_remove(timeoutId);
        }
        this._timeoutIds.clear();

        for (const entry of this._fullscreenSignalIds.values()) {
            safeDisconnect(entry.metaWindow, entry.signalId);
        }
        this._fullscreenSignalIds.clear();

        for (const entry of this._maximizeSignalIds.values()) {
            safeDisconnect(entry.metaWindow, entry.signalId);
        }
        this._maximizeSignalIds.clear();

        // Note: actor destroy signals are cleaned up when actors are destroyed
        this._actorDestroyIds.clear();
        this._pendingWindows.clear();
        this._callbacks = null;
    }
}
