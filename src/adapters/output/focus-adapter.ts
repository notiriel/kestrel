import type { WindowId } from '../../domain/world/types.js';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class FocusAdapter {
    private _windows: Map<WindowId, Meta.Window> = new Map();
    private _focusChangedId: number | null = null;
    private _suppressCallback: boolean = false;

    track(windowId: WindowId, metaWindow: Meta.Window): void {
        this._windows.set(windowId, metaWindow);
    }

    untrack(windowId: WindowId): void {
        this._windows.delete(windowId);
    }

    getMetaWindow(windowId: WindowId): Meta.Window | undefined {
        return this._windows.get(windowId);
    }

    focus(windowId: WindowId | null): void {
        if (!windowId) return;
        const metaWindow = this._windows.get(windowId);
        if (!metaWindow) return;
        try {
            Main.activateWindow(metaWindow);
        } catch (e) {
            console.error('[Kestrel] Failed to activate window:', e);
            this._windows.delete(windowId);
        }
    }

    focusInternal(windowId: WindowId | null): void {
        if (!windowId) return;
        this._suppressCallback = true;
        this.focus(windowId);
        this._suppressCallback = false;
    }

    closeWindow(windowId: WindowId): void {
        const metaWindow = this._windows.get(windowId);
        if (!metaWindow) return;
        metaWindow.delete(global.get_current_time());
    }

    openNewWindow(windowId: WindowId): void {
        const metaWindow = this._windows.get(windowId);
        if (!metaWindow) return;
        const tracker = Shell.WindowTracker.get_default();
        const app = tracker.get_window_app(metaWindow);
        if (!app) {
            console.log('[Kestrel] No app found for focused window');
            return;
        }
        app.open_new_window(-1);
    }

    connectFocusChanged(callback: (windowId: WindowId) => void): void {
        this._focusChangedId = global.display.connect('notify::focus-window', () => {
            try {
                if (this._suppressCallback) return;
                const focusedWindow = global.display.get_focus_window();
                if (!focusedWindow) return;
                // Use stable sequence for lookup — avoids Proxy identity mismatch
                const windowId = String(focusedWindow.get_stable_sequence()) as WindowId;
                if (!this._windows.has(windowId)) return;
                callback(windowId);
            } catch (e) {
                console.error('[Kestrel] Error in focus-changed handler:', e);
            }
        });
    }

    destroy(): void {
        if (this._focusChangedId !== null) {
            global.display.disconnect(this._focusChangedId);
            this._focusChangedId = null;
        }
        this._windows.clear();
    }
}
