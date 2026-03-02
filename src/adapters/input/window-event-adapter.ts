import type { WindowId } from '../../domain/types.js';
import type { WindowEventPort, WindowEventCallbacks } from '../../ports/window-event-port.js';
import { safeDisconnect } from '../signal-utils.js';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';

const FIRST_FRAME_TIMEOUT_MS = 2000;

// WM classes that should never be tiled (e.g. DING desktop icons)
const WM_CLASS_BLOCKLIST = ['gjs'];

function isFloatWindowType(type: Meta.WindowType): boolean {
    return type === Meta.WindowType.POPUP_MENU ||
        type === Meta.WindowType.DROPDOWN_MENU ||
        type === Meta.WindowType.MENU ||
        type === Meta.WindowType.TOOLTIP ||
        type === Meta.WindowType.COMBO;
}

function isDialogType(type: Meta.WindowType): boolean {
    return type === Meta.WindowType.DIALOG ||
        type === Meta.WindowType.MODAL_DIALOG ||
        type === Meta.WindowType.UTILITY ||
        type === Meta.WindowType.SPLASHSCREEN ||
        type === Meta.WindowType.TOOLBAR;
}

function isNonTileable(metaWindow: Meta.Window): boolean {
    return metaWindow.is_above() ||
        metaWindow.get_transient_for() !== null ||
        metaWindow.is_skip_taskbar();
}

function isBlockedWmClass(wmClass: string | null): boolean {
    return !wmClass || wmClass === 'null' || WM_CLASS_BLOCKLIST.includes(wmClass);
}

function shouldTile(metaWindow: Meta.Window): boolean {
    if (metaWindow.get_window_type() !== Meta.WindowType.NORMAL) return false;
    if (isNonTileable(metaWindow)) return false;
    if (isBlockedWmClass(metaWindow.get_wm_class())) return false;
    return true;
}

function isFloatableType(type: Meta.WindowType): boolean {
    return isDialogType(type) || isFloatWindowType(type);
}

function shouldFloat(metaWindow: Meta.Window): boolean {
    const type = metaWindow.get_window_type();

    // Popup/menu/tooltip types always float — they must render above the clone
    // layer. These don't require a wm_class check since they're transient
    // surfaces that may not have one set yet.
    if (isFloatWindowType(type)) return true;
    if (isBlockedWmClass(metaWindow.get_wm_class())) return false;

    // Dialog/utility/splash types float; normal non-tileable windows float
    if (isFloatableType(type)) return true;
    return type === Meta.WindowType.NORMAL && isNonTileable(metaWindow);
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
                this._enumerateActor(actor as Meta.WindowActor);
            } catch (e) {
                console.error('[Kestrel] Error enumerating window:', e);
            }
        }
    }

    private _enumerateActor(actor: Meta.WindowActor): void {
        const metaWindow = actor.get_meta_window();
        if (!metaWindow) return;
        const windowId = getWindowId(metaWindow);
        this._classifyAndRegisterExisting(metaWindow, windowId, actor);
    }

    private _classifyAndRegisterExisting(metaWindow: Meta.Window, windowId: WindowId, actor: Meta.WindowActor): void {
        if (shouldTile(metaWindow)) {
            this._callbacks?.onWindowReady(windowId, metaWindow);
            this._watchActorDestroy(actor, windowId, false, metaWindow);
        } else if (shouldFloat(metaWindow)) {
            this._callbacks?.onFloatWindowReady(windowId, metaWindow);
            this._watchActorDestroy(actor, windowId, true);
        }
    }

    private _handleWindowCreated(metaWindow: Meta.Window): void {
        const windowId = getWindowId(metaWindow);
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;
        if (!actor) return;

        if (this._handleImmediateFloat(metaWindow, windowId, actor)) return;

        this._pendingWindows.add(windowId);
        this._waitForFirstFrame(actor, windowId, () => {
            this._classifyAndRegister(metaWindow, windowId, actor);
        });
    }

    private _handleImmediateFloat(metaWindow: Meta.Window, windowId: WindowId, actor: Meta.WindowActor): boolean {
        if (!isFloatWindowType(metaWindow.get_window_type())) return false;
        this._callbacks?.onFloatWindowReady(windowId, metaWindow);
        this._watchActorDestroy(actor, windowId, true);
        return true;
    }

    private _classifyAndRegister(metaWindow: Meta.Window, windowId: WindowId, actor: Meta.WindowActor): void {
        if (!this._pendingWindows.delete(windowId)) return;
        this._classifyAndRegisterExisting(metaWindow, windowId, actor);
    }

    private _waitForFirstFrame(actor: Meta.WindowActor, _windowId: WindowId, onReady: () => void): void {
        // Use a fired flag to ensure we only disconnect once — calling
        // actor.disconnect() on an already-disconnected signal emits a
        // GLib C-level warning that JS try/catch cannot suppress.
        let fired = false;
        const firstFrameId = actor.connect('first-frame', () => {
            if (fired) return;
            fired = true;
            actor.disconnect(firstFrameId);
            onReady();
        });

        const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FIRST_FRAME_TIMEOUT_MS, () => {
            if (!fired) {
                fired = true;
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
                this._handleActorDestroyed(windowId, isFloat);
            } catch (e) {
                console.error('[Kestrel] Error in actor destroy handler:', e);
            }
        });
        this._actorDestroyIds.set(windowId, destroyId);

        if (!isFloat && metaWindow) {
            this._connectFullscreenSignal(windowId, metaWindow);
            this._connectMaximizeSignal(windowId, metaWindow);
        }
    }

    private _handleActorDestroyed(windowId: WindowId, isFloat: boolean): void {
        this._actorDestroyIds.delete(windowId);
        this._disconnectTrackedSignal(this._fullscreenSignalIds, windowId);
        this._disconnectTrackedSignal(this._maximizeSignalIds, windowId);
        if (isFloat) {
            this._callbacks?.onFloatWindowDestroyed(windowId);
        } else {
            this._callbacks?.onWindowDestroyed(windowId);
        }
    }

    private _connectFullscreenSignal(windowId: WindowId, metaWindow: Meta.Window): void {
        const signalId = metaWindow.connect('notify::fullscreen', () => {
            try {
                this._callbacks?.onWindowFullscreenChanged(windowId, metaWindow.fullscreen);
            } catch (e) {
                console.error('[Kestrel] Error in fullscreen handler:', e);
            }
        });
        this._fullscreenSignalIds.set(windowId, { metaWindow, signalId });
    }

    private _connectMaximizeSignal(windowId: WindowId, metaWindow: Meta.Window): void {
        const signalId = metaWindow.connect('notify::maximized-horizontally', () => {
            try {
                if (metaWindow.maximized_horizontally) {
                    this._callbacks?.onWindowMaximized(windowId);
                }
            } catch (e) {
                console.error('[Kestrel] Error in maximize handler:', e);
            }
        });
        this._maximizeSignalIds.set(windowId, { metaWindow, signalId });
    }

    private _disconnectTrackedSignal(map: Map<WindowId, { metaWindow: Meta.Window; signalId: number }>, windowId: WindowId): void {
        const entry = map.get(windowId);
        if (entry) {
            safeDisconnect(entry.metaWindow, entry.signalId);
            map.delete(windowId);
        }
    }

    destroy(): void {
        this._disconnectWindowCreated();
        this._clearAllSignals();
        this._actorDestroyIds.clear();
        this._pendingWindows.clear();
        this._callbacks = null;
    }

    private _disconnectWindowCreated(): void {
        if (this._windowCreatedId !== null) {
            global.display.disconnect(this._windowCreatedId);
            this._windowCreatedId = null;
        }
    }

    private _clearAllSignals(): void {
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
    }
}
