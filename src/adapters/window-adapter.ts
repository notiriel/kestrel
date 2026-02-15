import type { WindowId, LayoutState, WindowLayout } from '../domain/types.js';
import Meta from 'gi://Meta';

export class WindowAdapter {
    private _windows: Map<WindowId, Meta.Window> = new Map();
    private _workAreaY: number = 0;

    setWorkAreaY(workAreaY: number): void {
        this._workAreaY = workAreaY;
    }

    track(windowId: WindowId, metaWindow: Meta.Window): void {
        this._windows.set(windowId, metaWindow);
    }

    untrack(windowId: WindowId): void {
        this._windows.delete(windowId);
    }

    applyLayout(layout: LayoutState): void {
        for (const wl of layout.windows) {
            const metaWindow = this._windows.get(wl.windowId);
            if (!metaWindow) continue;
            try {
                // Subtract scrollX so real windows match their visual clone positions
                const screenX = wl.x - layout.scrollX;
                // Layout Y is workArea-relative; add workAreaY to convert to stage coords
                const screenY = wl.y + this._workAreaY;
                metaWindow.move_resize_frame(false, screenX, screenY, wl.width, wl.height);
            } catch (e) {
                console.debug('[PaperFlow] move_resize_frame skipped (dead window?):', e);
                this._windows.delete(wl.windowId);
            }
        }
    }

    showAll(): void {
        // Real actor visibility is restored by CloneAdapter.destroy()
    }

    destroy(): void {
        this._windows.clear();
    }
}
