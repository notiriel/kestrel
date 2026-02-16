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
    /** Actual position after compensating for oversized frames (e.g. Chromium) */
    actualX: number;
    actualY: number;
    /** True when the window has been moved offscreen (not on current workspace) */
    offscreen: boolean;
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
            actualX: 0, actualY: 0, offscreen: false,
        });
    }

    untrack(windowId: WindowId): void {
        const tracked = this._windows.get(windowId);
        if (tracked) {
            try { tracked.metaWindow.disconnect(tracked.sizeChangedId); } catch { /* already gone */ }
            try { tracked.metaWindow.disconnect(tracked.positionChangedId); } catch { /* already gone */ }
            try {
                if (tracked.offscreen) tracked.metaWindow.unminimize();
                const actor = tracked.metaWindow.get_compositor_private() as Meta.WindowActor | null;
                actor?.remove_clip();
            } catch { /* already gone */ }
            this._windows.delete(windowId);
        }
    }

    applyLayout(layout: LayoutState, nudgeUnsettled: boolean = false): void {
        // Collect window IDs present in this layout (current workspace)
        const layoutWindowIds = new Set(layout.windows.map(wl => wl.windowId));

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
                tracked.actualX = screenX;
                tracked.actualY = screenY;

                // Restore visibility if window was minimized on another workspace
                if (tracked.offscreen) {
                    tracked.offscreen = false;
                    tracked.metaWindow.unminimize();
                }

                const frame = tracked.metaWindow.get_frame_rect();
                const needsResize = frame.width !== wl.width || frame.height !== wl.height;

                this._adjusting = true;
                try {
                    if (needsResize) {
                        // When nudging, send a size that differs by 1px first to
                        // force Mutter to emit a fresh Wayland configure event.
                        // Some apps (e.g. Chromium) ignore the initial configure
                        // during startup; Mutter deduplicates identical size
                        // requests, so subsequent retries with the same size are
                        // silently dropped. The 1px nudge guarantees a new configure.
                        if (nudgeUnsettled) {
                            tracked.metaWindow.move_resize_frame(false,
                                screenX, screenY, wl.width - 1, wl.height - 1);
                        }
                        tracked.metaWindow.move_resize_frame(false,
                            screenX, screenY, wl.width, wl.height);
                    } else {
                        tracked.metaWindow.move_frame(false, screenX, screenY);
                    }

                    // Compensate if the window is already oversized from a prior
                    // refused resize (e.g. Chromium). Check current frame since
                    // move_resize_frame is async and may not have taken effect yet.
                    this._compensateOversized(tracked);
                } finally {
                    this._adjusting = false;
                }

                // Don't apply clip here — on Wayland, move_resize_frame() is
                // async so the buffer rect is still at the OLD position.
                // _applyClip reads the buffer rect, so calling it now would
                // produce a stale clip that makes the clone render nothing.
                // The position-changed / size-changed signal handlers already
                // call _applyClip() once the buffer settles.
            } catch (e) {
                console.debug('[PaperFlow] move_resize_frame skipped (dead window?):', e);
                this.untrack(wl.windowId);
            }
        }

        // Minimize tracked windows not in the current layout (other workspaces).
        // Minimization is the only reliable way to fully remove Wayland keyboard
        // focus — Mutter won't send wl_keyboard events to minimized windows.
        // Clutter.Clone still renders minimized (unmapped) actors via its
        // internal enable_paint_unmapped mechanism.
        for (const [windowId, tracked] of this._windows) {
            if (layoutWindowIds.has(windowId)) continue;
            if (tracked.offscreen) continue;
            try {
                tracked.offscreen = true;
                tracked.metaWindow.minimize();
            } catch {
                // Window already gone
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
        if (!tracked || tracked.targetWidth === 0 || tracked.offscreen) return;

        this._adjusting = true;
        try {
            // Re-issue resize request so Mutter remembers our target.
            tracked.metaWindow.move_resize_frame(false,
                tracked.targetX, tracked.targetY,
                tracked.targetWidth, tracked.targetHeight);

            // If window still refuses (e.g. Chromium), compensate position.
            this._compensateOversized(tracked);
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
        if (!tracked || tracked.targetWidth === 0 || tracked.offscreen) return;

        const frame = tracked.metaWindow.get_frame_rect();
        if (frame.x !== tracked.actualX || frame.y !== tracked.actualY) {
            this._adjusting = true;
            try {
                tracked.metaWindow.move_frame(false, tracked.actualX, tracked.actualY);
            } finally {
                this._adjusting = false;
            }
        }

        this._applyClip(tracked);
    }

    /**
     * When a window's frame exceeds the layout target (e.g. Chromium ignores
     * our resize request), shift the real window so the frame is centered on
     * the layout slot. This matches the clone-adapter's centering logic.
     */
    private _compensateOversized(tracked: TrackedWindow): void {
        const frame = tracked.metaWindow.get_frame_rect();
        const excessW = frame.width - tracked.targetWidth;
        const excessH = frame.height - tracked.targetHeight;

        if (excessW <= 0 && excessH <= 0) {
            // Frame fits within or matches layout slot — no compensation needed.
            tracked.actualX = tracked.targetX;
            tracked.actualY = tracked.targetY;
            return;
        }

        const compensateX = excessW > 0 ? Math.round(excessW / 2) : 0;
        const compensateY = excessH > 0 ? Math.round(excessH / 2) : 0;

        tracked.actualX = tracked.targetX - compensateX;
        tracked.actualY = tracked.targetY - compensateY;

        tracked.metaWindow.move_frame(false, tracked.actualX, tracked.actualY);
    }

    /**
     * Clip the WindowActor to the layout slot bounds.
     * The clip positions the visible region at targetX/targetY on screen,
     * matching the clone's wrapper position. The clone-adapter handles visual
     * centering for oversized frames — the real window clip only needs to
     * align the visible area for correct input hit-testing.
     */
    private _applyClip(tracked: TrackedWindow): void {
        const actor = tracked.metaWindow.get_compositor_private() as Meta.WindowActor | null;
        if (!actor) return;

        const buffer = tracked.metaWindow.get_buffer_rect();
        const clipX = tracked.targetX - buffer.x;
        const clipY = tracked.targetY - buffer.y;
        actor.set_clip(clipX, clipY, tracked.targetWidth, tracked.targetHeight);
    }

    /**
     * Check if any tracked window's frame size doesn't match its layout target.
     * Used by the controller to detect when async Wayland configures have settled.
     */
    hasUnsettledWindows(): boolean {
        for (const tracked of this._windows.values()) {
            if (tracked.targetWidth === 0) continue;
            try {
                const frame = tracked.metaWindow.get_frame_rect();
                if (frame.width !== tracked.targetWidth || frame.height !== tracked.targetHeight) {
                    return true;
                }
            } catch {
                // Window gone
            }
        }
        return false;
    }

    showAll(): void {
        // Real actor visibility is restored by CloneAdapter.destroy()
    }

    destroy(): void {
        for (const tracked of this._windows.values()) {
            try { tracked.metaWindow.disconnect(tracked.sizeChangedId); } catch { /* already gone */ }
            try { tracked.metaWindow.disconnect(tracked.positionChangedId); } catch { /* already gone */ }
            try {
                if (tracked.offscreen) tracked.metaWindow.unminimize();
                const actor = tracked.metaWindow.get_compositor_private() as Meta.WindowActor | null;
                actor?.remove_clip();
            } catch { /* already gone */ }
        }
        this._windows.clear();
    }
}
