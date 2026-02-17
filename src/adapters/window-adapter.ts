import type { WindowId, LayoutState } from '../domain/types.js';
import type { WindowPort } from '../ports/window-port.js';
import { safeDisconnect } from './signal-utils.js';
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

export class WindowAdapter implements WindowPort {
    private _windows: Map<WindowId, TrackedWindow> = new Map();
    private _workAreaY: number = 0;
    private _monitorWidth: number = 0;
    private _adjusting: boolean = false;

    private _setActorOpacity(metaWindow: Meta.Window, opacity: number): void {
        try {
            const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;
            if (actor) actor.set_opacity(opacity);
        } catch { /* actor not ready or already gone */ }
    }

    setWorkAreaY(workAreaY: number): void {
        this._workAreaY = workAreaY;
    }

    setMonitorWidth(monitorWidth: number): void {
        this._monitorWidth = monitorWidth;
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

        // Real window actors are always hidden — the clone layer handles
        // all visual rendering. Actors remain at opacity=0 so they're
        // invisible but still receive Wayland input (click-through).
        this._setActorOpacity(metaWindow, 0);
    }

    untrack(windowId: WindowId): void {
        const tracked = this._windows.get(windowId);
        if (tracked) {
            safeDisconnect(tracked.metaWindow, tracked.sizeChangedId);
            safeDisconnect(tracked.metaWindow, tracked.positionChangedId);
            try {
                if (tracked.offscreen) tracked.metaWindow.unminimize();
                this._setActorOpacity(tracked.metaWindow, 255);
            } catch { /* already gone */ }
            this._windows.delete(windowId);
        }
    }

    /** Set of window IDs currently fullscreen — skip positioning for these */
    private _fullscreenWindows: Set<WindowId> = new Set();

    setWindowFullscreen(windowId: WindowId, isFullscreen: boolean): void {
        const tracked = this._windows.get(windowId);
        if (isFullscreen) {
            this._fullscreenWindows.add(windowId);
            if (tracked?.offscreen) {
                tracked.offscreen = false;
                try { tracked.metaWindow.unminimize(); } catch { /* already gone */ }
            }
            if (tracked) this._setActorOpacity(tracked.metaWindow, 255);
        } else {
            this._fullscreenWindows.delete(windowId);
            if (tracked) this._setActorOpacity(tracked.metaWindow, 0);
        }
    }

    applyLayout(layout: LayoutState, nudgeUnsettled: boolean = false): void {
        // Collect window IDs present in this layout (current workspace)
        const layoutWindowIds = new Set(layout.windows.map(wl => wl.windowId));

        for (const wl of layout.windows) {
            const tracked = this._windows.get(wl.windowId);
            if (!tracked) continue;
            // Fullscreen windows are positioned by GNOME — don't fight them
            if (this._fullscreenWindows.has(wl.windowId)) {
                if (tracked.offscreen) {
                    tracked.offscreen = false;
                    try { tracked.metaWindow.unminimize(); } catch { /* already gone */ }
                }
                continue;
            }
            try {
                // Subtract scrollX so real windows match their visual clone positions
                let screenX = wl.x - layout.scrollX;
                // Layout Y is workArea-relative; add workAreaY to convert to stage coords
                const screenY = wl.y + this._workAreaY;

                // Clamp to monitor bounds — Mutter rejects positions that push
                // windows beyond the monitor edge on Wayland.
                if (this._monitorWidth > 0) {
                    screenX = Math.max(0, Math.min(screenX, this._monitorWidth - wl.width));
                }

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
                    this._setActorOpacity(tracked.metaWindow, 0);
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
            if (this._fullscreenWindows.has(windowId)) continue;
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
     * re-position at target.
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

    destroy(): void {
        for (const tracked of this._windows.values()) {
            safeDisconnect(tracked.metaWindow, tracked.sizeChangedId);
            safeDisconnect(tracked.metaWindow, tracked.positionChangedId);
            try {
                if (tracked.offscreen) tracked.metaWindow.unminimize();
                this._setActorOpacity(tracked.metaWindow, 255);
            } catch { /* already gone */ }
        }
        this._windows.clear();
    }
}
