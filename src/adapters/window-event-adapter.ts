import type { WindowId } from '../domain/types.js';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';

const FIRST_FRAME_TIMEOUT_MS = 2000;

export interface WindowEventCallbacks {
    onWindowReady: (windowId: WindowId, metaWindow: Meta.Window) => void;
    onWindowDestroyed: (windowId: WindowId) => void;
}

function shouldTile(metaWindow: Meta.Window): boolean {
    if (metaWindow.get_window_type() !== Meta.WindowType.NORMAL) return false;
    if (metaWindow.is_above()) return false;
    if (metaWindow.get_transient_for() !== null) return false;
    return true;
}

function getWindowId(metaWindow: Meta.Window): WindowId {
    return String(metaWindow.get_stable_sequence()) as WindowId;
}

export class WindowEventAdapter {
    private _windowCreatedId: number | null = null;
    private _actorDestroyIds: Map<WindowId, number> = new Map();
    private _timeoutIds: Set<number> = new Set();
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
                if (metaWindow && shouldTile(metaWindow)) {
                    const windowId = getWindowId(metaWindow);
                    this._watchActorDestroy(actor as Meta.WindowActor, windowId);
                    this._callbacks?.onWindowReady(windowId, metaWindow);
                }
            } catch (e) {
                console.error('[PaperFlow] Error enumerating window:', e);
            }
        }
    }

    private _handleWindowCreated(metaWindow: Meta.Window): void {
        if (!shouldTile(metaWindow)) return;

        const windowId = getWindowId(metaWindow);
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;

        if (!actor) return;

        // Wait for first-frame, with timeout
        const firstFrameId = actor.connect('first-frame', () => {
            actor.disconnect(firstFrameId);
            this._watchActorDestroy(actor, windowId);
            this._callbacks?.onWindowReady(windowId, metaWindow);
        });

        // Timeout fallback
        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FIRST_FRAME_TIMEOUT_MS, () => {
            try {
                actor.disconnect(firstFrameId);
            } catch {
                // Already disconnected
            }
            this._timeoutIds.delete(timeoutId);
            this._watchActorDestroy(actor, windowId);
            this._callbacks?.onWindowReady(windowId, metaWindow);
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.add(timeoutId);
    }

    private _watchActorDestroy(actor: Meta.WindowActor, windowId: WindowId): void {
        const destroyId = actor.connect('destroy', () => {
            try {
                this._actorDestroyIds.delete(windowId);
                this._callbacks?.onWindowDestroyed(windowId);
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
        this._callbacks = null;
    }
}
