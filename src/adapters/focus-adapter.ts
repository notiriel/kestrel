import type { WindowId } from '../domain/types.js';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class FocusAdapter {
    private _windows: Map<WindowId, Meta.Window> = new Map();

    track(windowId: WindowId, metaWindow: Meta.Window): void {
        this._windows.set(windowId, metaWindow);
    }

    untrack(windowId: WindowId): void {
        this._windows.delete(windowId);
    }

    focus(windowId: WindowId | null): void {
        if (!windowId) return;
        const metaWindow = this._windows.get(windowId);
        if (!metaWindow) return;
        try {
            Main.activateWindow(metaWindow);
        } catch (e) {
            console.error('[PaperFlow] Failed to activate window:', e);
        }
    }

    destroy(): void {
        this._windows.clear();
    }
}
