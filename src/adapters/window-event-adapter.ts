import type { WindowId } from '../domain/types.js';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';

const FIRST_FRAME_TIMEOUT_MS = 2000;

export interface WindowEventCallbacks {
    onWindowReady: (windowId: WindowId, metaWindow: Meta.Window) => void;
    onWindowDestroyed: (windowId: WindowId) => void;
    onFloatWindowReady: (windowId: WindowId, metaWindow: Meta.Window) => void;
    onFloatWindowDestroyed: (windowId: WindowId) => void;
}

export { shouldTile };

// WM classes that should never be tiled (e.g. DING desktop icons)
const WM_CLASS_BLOCKLIST = ['gjs'];

function shouldTile(metaWindow: Meta.Window): boolean {
    if (metaWindow.get_window_type() !== Meta.WindowType.NORMAL) return false;
    if (metaWindow.is_above()) return false;
    if (metaWindow.get_transient_for() !== null) return false;
    if (metaWindow.is_skip_taskbar()) return false;
    const wmClass = metaWindow.get_wm_class();
    if (wmClass && WM_CLASS_BLOCKLIST.includes(wmClass)) return false;
    return true;
}

function shouldFloat(metaWindow: Meta.Window): boolean {
    const type = metaWindow.get_window_type();
    const wmClass = metaWindow.get_wm_class();
    if (wmClass && WM_CLASS_BLOCKLIST.includes(wmClass)) return false;
    if (metaWindow.is_skip_taskbar()) return false;

    // Dialog types always float
    if (type === Meta.WindowType.DIALOG ||
        type === Meta.WindowType.MODAL_DIALOG ||
        type === Meta.WindowType.UTILITY) return true;

    // Normal windows that can't be tiled (transient, above) float
    if (type === Meta.WindowType.NORMAL) {
        if (metaWindow.is_above()) return true;
        if (metaWindow.get_transient_for() !== null) return true;
    }

    return false;
}

function getWindowId(metaWindow: Meta.Window): WindowId {
    return String(metaWindow.get_stable_sequence()) as WindowId;
}

export class WindowEventAdapter {
    private _windowCreatedId: number | null = null;
    private _actorDestroyIds: Map<WindowId, number> = new Map();
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
                    console.error('[PaperFlow] Error in window-created handler:', e);
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
                    this._watchActorDestroy(actor as Meta.WindowActor, windowId, false);
                } else if (shouldFloat(metaWindow)) {
                    this._callbacks?.onFloatWindowReady(windowId, metaWindow);
                    this._watchActorDestroy(actor as Meta.WindowActor, windowId, true);
                }
            } catch (e) {
                console.error('[PaperFlow] Error enumerating window:', e);
            }
        }
    }

    private _handleWindowCreated(metaWindow: Meta.Window): void {
        const tile = shouldTile(metaWindow);
        const float = !tile && shouldFloat(metaWindow);
        if (!tile && !float) return;

        const windowId = getWindowId(metaWindow);
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;

        if (!actor) return;

        // Guard against double-fire (first-frame + timeout)
        this._pendingWindows.add(windowId);

        const onReady = () => {
            if (!this._pendingWindows.delete(windowId)) return; // Already fired
            if (tile) {
                this._callbacks?.onWindowReady(windowId, metaWindow);
                this._watchActorDestroy(actor, windowId, false);
            } else {
                this._callbacks?.onFloatWindowReady(windowId, metaWindow);
                this._watchActorDestroy(actor, windowId, true);
            }
        };

        // Wait for first-frame, with timeout
        const firstFrameId = actor.connect('first-frame', () => {
            actor.disconnect(firstFrameId);
            onReady();
        });

        // Timeout fallback
        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FIRST_FRAME_TIMEOUT_MS, () => {
            try {
                actor.disconnect(firstFrameId);
            } catch {
                // Already disconnected
            }
            this._timeoutIds.delete(timeoutId);
            onReady();
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.add(timeoutId);
    }

    private _watchActorDestroy(actor: Meta.WindowActor, windowId: WindowId, isFloat: boolean): void {
        const destroyId = actor.connect('destroy', () => {
            try {
                this._actorDestroyIds.delete(windowId);
                if (isFloat) {
                    this._callbacks?.onFloatWindowDestroyed(windowId);
                } else {
                    this._callbacks?.onWindowDestroyed(windowId);
                }
            } catch (e) {
                console.error('[PaperFlow] Error in actor destroy handler:', e);
            }
        });
        this._actorDestroyIds.set(windowId, destroyId);
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

        // Note: actor destroy signals are cleaned up when actors are destroyed
        this._actorDestroyIds.clear();
        this._pendingWindows.clear();
        this._callbacks = null;
    }
}
