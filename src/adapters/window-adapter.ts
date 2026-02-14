import type { WindowId, LayoutState, WindowLayout } from '../domain/types.js';
import Meta from 'gi://Meta';

export class WindowAdapter {
    private _windows: Map<WindowId, Meta.Window> = new Map();

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
                metaWindow.move_resize_frame(false, wl.x, wl.y, wl.width, wl.height);
            } catch (e) {
                // move_resize_frame can be rejected — not critical since clones are the visual layer
                console.debug('[PaperFlow] move_resize_frame rejected:', e);
            }
        }
    }

    showAll(): void {
        // Restore normal GNOME positioning on disable — nothing to undo for 1b
        // since we don't hide real actors (the paperflow-layer occludes them)
    }

    destroy(): void {
        this._windows.clear();
    }
}
