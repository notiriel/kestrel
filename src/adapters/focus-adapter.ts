import type { WindowId } from '../domain/types.js';
import type { FocusPort } from '../ports/focus-port.js';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class FocusAdapter implements FocusPort {
    private _windows: Map<WindowId, Meta.Window> = new Map();
    private _focusChangedId: number | null = null;

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
            console.error('[PaperFlow] Failed to activate window:', e);
            this._windows.delete(windowId);
        }
    }

    connectFocusChanged(callback: (windowId: WindowId) => void): void {
        this._focusChangedId = global.display.connect('notify::focus-window', () => {
            try {
                const focusedWindow = global.display.get_focus_window();
                if (!focusedWindow) return;
                // Use stable sequence for lookup — avoids Proxy identity mismatch
                const windowId = String(focusedWindow.get_stable_sequence()) as WindowId;
                if (!this._windows.has(windowId)) return;
                callback(windowId);
            } catch (e) {
                console.error('[PaperFlow] Error in focus-changed handler:', e);
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
