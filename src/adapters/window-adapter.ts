import type { WindowId, LayoutState } from '../domain/types.js';
import Meta from 'gi://Meta';

interface TrackedWindow {
    metaWindow: Meta.Window;
    sizeChangedId: number;
    positionChangedId: number;
    /** Target layout slot position/size */
    targetX: number;
    targetY: number;
    targetWidth: number;
    targetHeight: number;
}

export class WindowAdapter {
    private _windows: Map<WindowId, TrackedWindow> = new Map();
    private _workAreaY: number = 0;
    private _adjusting: boolean = false;

    setWorkAreaY(workAreaY: number): void {
        this._workAreaY = workAreaY;
    }

    track(windowId: WindowId, metaWindow: Meta.Window): void {
        const sizeChangedId = metaWindow.connect('size-changed', () => {
            try {
                this._onSizeChanged(windowId);
            } catch (e) {
                console.debug('[PaperFlow] Error in window size-changed handler:', e);
            }
        });
        const positionChangedId = metaWindow.connect('position-changed', () => {
            try {
                this._onPositionChanged(windowId);
            } catch (e) {
                console.debug('[PaperFlow] Error in window position-changed handler:', e);
            }
        });
        this._windows.set(windowId, {
            metaWindow, sizeChangedId, positionChangedId,
            targetX: 0, targetY: 0, targetWidth: 0, targetHeight: 0,
        });
    }

    untrack(windowId: WindowId): void {
        const tracked = this._windows.get(windowId);
        if (tracked) {
            try { tracked.metaWindow.disconnect(tracked.sizeChangedId); } catch { /* already gone */ }
            try { tracked.metaWindow.disconnect(tracked.positionChangedId); } catch { /* already gone */ }
            try {
                const actor = tracked.metaWindow.get_compositor_private() as Meta.WindowActor | null;
                actor?.remove_clip();
            } catch { /* already gone */ }
            this._windows.delete(windowId);
        }
    }

    applyLayout(layout: LayoutState): void {
        for (const wl of layout.windows) {
            const tracked = this._windows.get(wl.windowId);
            if (!tracked) continue;
            try {
                // Subtract scrollX so real windows match their visual clone positions
                const screenX = wl.x - layout.scrollX;
                // Layout Y is workArea-relative; add workAreaY to convert to stage coords
                const screenY = wl.y + this._workAreaY;

                // Store target for position-changed and size-changed handlers
                tracked.targetX = screenX;
                tracked.targetY = screenY;
                tracked.targetWidth = wl.width;
                tracked.targetHeight = wl.height;

                const frame = tracked.metaWindow.get_frame_rect();
                const needsResize = frame.width !== wl.width || frame.height !== wl.height;

                this._adjusting = true;
                try {
                    if (needsResize) {
                        // Size changed — use move_resize_frame to request new size.
                        tracked.metaWindow.move_resize_frame(false,
                            screenX, screenY, wl.width, wl.height);
                    } else {
                        // Size unchanged — use move_frame to avoid unnecessary
                        // Wayland configure events (PaperWM pattern).
                        tracked.metaWindow.move_frame(false, screenX, screenY);
                    }
                } finally {
                    this._adjusting = false;
                }

                this._applyClip(tracked);
            } catch (e) {
                console.debug('[PaperFlow] move_resize_frame skipped (dead window?):', e);
                this.untrack(wl.windowId);
            }
        }
    }

    /**
     * When a window settles at a new size (async Wayland resize response),
     * re-position at target and re-clip.
     */
    private _onSizeChanged(windowId: WindowId): void {
        if (this._adjusting) return;

        const tracked = this._windows.get(windowId);
        if (!tracked || tracked.targetWidth === 0) return;

        // Re-issue move_resize_frame so Mutter remembers our target position.
        this._adjusting = true;
        try {
            tracked.metaWindow.move_resize_frame(false,
                tracked.targetX, tracked.targetY,
                tracked.targetWidth, tracked.targetHeight);
        } finally {
            this._adjusting = false;
        }

        this._applyClip(tracked);
    }

    /**
     * Correct drift when Mutter repositions a window (e.g. async configure
     * response overwrites our position). PaperWM uses the same pattern.
     */
    private _onPositionChanged(windowId: WindowId): void {
        if (this._adjusting) return;

        const tracked = this._windows.get(windowId);
        if (!tracked || tracked.targetWidth === 0) return;

        const frame = tracked.metaWindow.get_frame_rect();
        if (frame.x !== tracked.targetX || frame.y !== tracked.targetY) {
            this._adjusting = true;
            try {
                tracked.metaWindow.move_frame(false, tracked.targetX, tracked.targetY);
            } finally {
                this._adjusting = false;
            }
        }

        this._applyClip(tracked);
    }

    /**
     * Clip the WindowActor to the layout slot bounds.
     * Hides oversized window overflow and CSD shadows.
     * No centering — content is top-left aligned matching the clone's
     * _allocateClone offset, so both render identical pixels at each
     * screen position (prevents double-vision with semi-transparent content).
     * PaperWM uses the same actor.set_clip() pattern.
     */
    private _applyClip(tracked: TrackedWindow): void {
        const actor = tracked.metaWindow.get_compositor_private() as Meta.WindowActor | null;
        if (!actor) return;

        const buffer = tracked.metaWindow.get_buffer_rect();
        const clipX = tracked.targetX - buffer.x;
        const clipY = tracked.targetY - buffer.y;
        actor.set_clip(clipX, clipY, tracked.targetWidth, tracked.targetHeight);
    }

    showAll(): void {
        // Real actor visibility is restored by CloneAdapter.destroy()
    }

    destroy(): void {
        for (const tracked of this._windows.values()) {
            try { tracked.metaWindow.disconnect(tracked.sizeChangedId); } catch { /* already gone */ }
            try { tracked.metaWindow.disconnect(tracked.positionChangedId); } catch { /* already gone */ }
            try {
                const actor = tracked.metaWindow.get_compositor_private() as Meta.WindowActor | null;
                actor?.remove_clip();
            } catch { /* already gone */ }
        }
        this._windows.clear();
    }
}
