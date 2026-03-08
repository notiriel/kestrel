import type { WindowId } from '../../domain/world/types.js';
import type { SceneModel, RealWindowScene } from '../../domain/scene/scene.js';
import type { WindowPort } from '../../ports/window-port.js';
import { safeDisconnect } from '../signal-utils.js';
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
    /** True when the window is fullscreen — skip positioning */
    fullscreen: boolean;
}

export class WindowAdapter implements WindowPort {
    private _windows: Map<WindowId, TrackedWindow> = new Map();
    private _workAreaY: number = 0;
    private _monitorMinX: number = 0;
    private _monitorTotalWidth: number = 0;
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

    setMonitorBounds(minX: number, totalWidth: number): void {
        this._monitorMinX = minX;
        this._monitorTotalWidth = totalWidth;
    }

    track(windowId: WindowId, metaWindow: Meta.Window): void {
        const { sizeChangedId, positionChangedId } = this._connectWindowSignals(windowId, metaWindow);
        this._windows.set(windowId, {
            metaWindow, sizeChangedId, positionChangedId,
            targetX: 0, targetY: 0, targetWidth: 0, targetHeight: 0,
            actualX: 0, actualY: 0, offscreen: false, fullscreen: false,
        });

        // Real window actors are always hidden — the clone layer handles
        // all visual rendering. Actors remain at opacity=0 so they're
        // invisible but still receive Wayland input (click-through).
        this._setActorOpacity(metaWindow, 0);
    }

    private _connectWindowSignals(windowId: WindowId, metaWindow: Meta.Window): { sizeChangedId: number; positionChangedId: number } {
        const sizeChangedId = metaWindow.connect('size-changed', () => {
            try {
                this._onSizeChanged(windowId);
            } catch (e) {
                console.debug('[Kestrel] Error in window size-changed handler:', e);
            }
        });
        const positionChangedId = metaWindow.connect('position-changed', () => {
            try {
                this._onPositionChanged(windowId);
            } catch (e) {
                console.debug('[Kestrel] Error in window position-changed handler:', e);
            }
        });
        return { sizeChangedId, positionChangedId };
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

    setWindowFullscreen(windowId: WindowId, isFullscreen: boolean): void {
        const tracked = this._windows.get(windowId);
        if (isFullscreen) {
            this._enterFullscreen(windowId, tracked);
        } else {
            this._exitFullscreen(windowId, tracked);
        }
    }

    private _enterFullscreen(_windowId: WindowId, tracked: TrackedWindow | undefined): void {
        if (!tracked) return;
        tracked.fullscreen = true;
        if (tracked.offscreen) {
            tracked.offscreen = false;
            try { tracked.metaWindow.unminimize(); } catch { /* already gone */ }
        }
        this._setActorOpacity(tracked.metaWindow, 255);
    }

    private _exitFullscreen(_windowId: WindowId, tracked: TrackedWindow | undefined): void {
        if (!tracked) return;
        tracked.fullscreen = false;
        this._setActorOpacity(tracked.metaWindow, 0);
    }

    applyScene(scene: SceneModel, nudgeUnsettled: boolean = false): void {
        const onscreenWindowIds = new Set<WindowId>();

        for (const rw of scene.realWindows) {
            if (rw.minimized) continue;
            onscreenWindowIds.add(rw.windowId);
            this._applyRealWindow(rw, nudgeUnsettled);
        }

        this._minimizeOffWorkspaceWindows(onscreenWindowIds);
    }

    private _applyRealWindow(rw: RealWindowScene, nudgeUnsettled: boolean): void {
        const tracked = this._windows.get(rw.windowId);
        if (!tracked) return;
        if (tracked.fullscreen) {
            this._restoreIfOffscreen(tracked);
            return;
        }
        this._positionWindowFromScene(tracked, rw, nudgeUnsettled);
    }

    private _restoreIfOffscreen(tracked: TrackedWindow): void {
        if (!tracked.offscreen) return;
        tracked.offscreen = false;
        try { tracked.metaWindow.unminimize(); } catch { /* already gone */ }
    }

    private _ensureUnmaximized(tracked: TrackedWindow): void {
        if (tracked.metaWindow.maximized_horizontally || tracked.metaWindow.maximized_vertically) {
            tracked.metaWindow.unmaximize(Meta.MaximizeFlags.BOTH);
        }
    }

    private _positionWindowFromScene(
        tracked: TrackedWindow,
        rw: RealWindowScene,
        nudgeUnsettled: boolean,
    ): void {
        try {
            // Mutter ignores move_resize_frame() on maximized windows —
            // force unmaximize before positioning as a safety net.
            this._ensureUnmaximized(tracked);

            // RealWindowScene has pre-computed screen coordinates
            this._updateTarget(tracked, rw.x, rw.y, rw.width, rw.height);
            this._restoreFromOffscreen(tracked);
            this._applyMoveResize(tracked, rw.x, rw.y, rw.width, rw.height, nudgeUnsettled);
        } catch (e) {
            console.debug('[Kestrel] move_resize_frame skipped (dead window?):', e);
        }
    }

    /**
     * Restore a minimized offscreen window. The shell adapter's unminimize
     * interception handles suppressing GNOME's animation and calling
     * completed_unminimize through GNOME's natural completion path, which
     * is required for Mutter to properly restore Wayland pointer input routing.
     */
    private _restoreFromOffscreen(tracked: TrackedWindow): void {
        if (!tracked.offscreen) return;
        tracked.offscreen = false;
        try {
            tracked.metaWindow.unminimize();
        } catch { /* already gone */ }
    }

    /** Store target position/size for signal handlers and set initial actual position. */
    private _updateTarget(tracked: TrackedWindow, x: number, y: number, width: number, height: number): void {
        tracked.targetX = x;
        tracked.targetY = y;
        tracked.targetWidth = width;
        tracked.targetHeight = height;
        tracked.actualX = x;
        tracked.actualY = y;
    }

    /**
     * Issue the actual move/resize Mutter calls for a window, with optional
     * nudge to force a fresh Wayland configure event.
     */
    private _applyMoveResize(
        tracked: TrackedWindow,
        screenX: number, screenY: number,
        width: number, height: number,
        nudgeUnsettled: boolean,
    ): void {
        const frame = tracked.metaWindow.get_frame_rect();
        const needsResize = frame.width !== width || frame.height !== height;

        this._adjusting = true;
        try {
            // Pass user_op=true so Mutter's constraint solver skips
            // constrain_fully_onscreen and constrain_to_single_monitor,
            // allowing windows to be positioned offscreen for scrolling.
            if (needsResize) {
                this._resizeWindow(tracked, screenX, screenY, width, height, nudgeUnsettled);
            } else {
                tracked.metaWindow.move_frame(true, screenX, screenY);
            }

            // Compensate if the window is already oversized from a prior
            // refused resize (e.g. Chromium). Check current frame since
            // move_resize_frame is async and may not have taken effect yet.
            this._compensateOversized(tracked);
        } finally {
            this._adjusting = false;
        }
    }

    /**
     * Resize a window, optionally nudging by 1px first to force Mutter to
     * emit a fresh Wayland configure event for apps that ignore the initial one.
     */
    private _resizeWindow(
        tracked: TrackedWindow,
        screenX: number, screenY: number,
        width: number, height: number,
        nudge: boolean,
    ): void {
        if (nudge) {
            tracked.metaWindow.move_resize_frame(true, screenX, screenY, width - 1, height - 1);
        }
        tracked.metaWindow.move_resize_frame(true, screenX, screenY, width, height);
    }

    /**
     * Minimize tracked windows not in the current layout (other workspaces).
     * Minimization hides windows and removes them from Wayland keyboard focus.
     * The unminimize path is NOT intercepted — GNOME's default handler runs
     * its full animation + completed_unminimize call, which is required for
     * Mutter to properly restore Wayland pointer input routing.
     */
    private _minimizeOffWorkspaceWindows(layoutWindowIds: Set<WindowId>): void {
        for (const [windowId, tracked] of this._windows) {
            if (layoutWindowIds.has(windowId) || tracked.offscreen || tracked.fullscreen) continue;
            this._minimizeWindow(tracked);
        }
    }

    private _minimizeWindow(tracked: TrackedWindow): void {
        try {
            tracked.offscreen = true;
            tracked.metaWindow.minimize();
        } catch {
            // Window already gone
        }
    }

    /**
     * Get a tracked window if it's active (not adjusting, has targets set, and is onscreen).
     * Returns null if the window should be skipped in signal handlers.
     */
    private _getActiveTracked(windowId: WindowId): TrackedWindow | null {
        if (this._adjusting) return null;
        const tracked = this._windows.get(windowId);
        if (!tracked || tracked.targetWidth === 0 || tracked.offscreen) return null;
        return tracked;
    }

    /**
     * When a window settles at a new size (async Wayland resize response),
     * re-position at target.
     */
    private _onSizeChanged(windowId: WindowId): void {
        const tracked = this._getActiveTracked(windowId);
        if (!tracked) return;

        this._adjusting = true;
        try {
            // Re-issue resize request so Mutter remembers our target.
            tracked.metaWindow.move_resize_frame(true,
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
        const tracked = this._getActiveTracked(windowId);
        if (!tracked) return;

        const frame = tracked.metaWindow.get_frame_rect();
        if (frame.x !== tracked.actualX || frame.y !== tracked.actualY) {
            this._adjusting = true;
            try {
                tracked.metaWindow.move_frame(true, tracked.actualX, tracked.actualY);
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

        tracked.metaWindow.move_frame(true, tracked.actualX, tracked.actualY);
    }

    /**
     * Check if any tracked window's frame size doesn't match its layout target.
     * Used by the controller to detect when async Wayland configures have settled.
     */
    hasUnsettledWindows(): boolean {
        for (const tracked of this._windows.values()) {
            if (this._isWindowUnsettled(tracked)) return true;
        }
        return false;
    }

    /**
     * Check if a single tracked window's frame size doesn't match its layout target.
     */
    private _isWindowUnsettled(tracked: TrackedWindow): boolean {
        if (tracked.targetWidth === 0) return false;
        try {
            const frame = tracked.metaWindow.get_frame_rect();
            return frame.width !== tracked.targetWidth || frame.height !== tracked.targetHeight;
        } catch {
            // Window gone
            return false;
        }
    }

    getWindowStates(): Map<WindowId, { frameX: number; frameY: number; frameWidth: number; frameHeight: number; offscreen: boolean; fullscreen: boolean }> {
        const states = new Map<WindowId, { frameX: number; frameY: number; frameWidth: number; frameHeight: number; offscreen: boolean; fullscreen: boolean }>();
        for (const [windowId, tracked] of this._windows) {
            try {
                const frame = tracked.metaWindow.get_frame_rect();
                states.set(windowId, {
                    frameX: frame.x,
                    frameY: frame.y,
                    frameWidth: frame.width,
                    frameHeight: frame.height,
                    offscreen: tracked.offscreen,
                    fullscreen: tracked.fullscreen,
                });
            } catch {
                // Window already gone
            }
        }
        return states;
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
