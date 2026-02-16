import type { WindowId, WorkspaceId, LayoutState } from '../domain/types.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Meta from 'gi://Meta';

// GJS adds ease() to Clutter.Actor at runtime, but @girs types don't include it
interface Easeable {
    ease(params: Record<string, unknown>): void;
}

interface CloneEntry {
    wrapper: Clutter.Actor;
    clone: Clutter.Clone;
    metaWindow: Meta.Window;
    sourceActor: Meta.WindowActor;
    sizeChangedId: number;
    sourceDestroyId: number;
    sourceDestroyed: boolean;
    workspaceId: WorkspaceId;
    /** Layout target size — wrapper is capped to this when frame exceeds layout slot */
    layoutWidth: number;
    layoutHeight: number;
}

interface FloatCloneEntry {
    wrapper: Clutter.Actor;
    clone: Clutter.Clone;
    metaWindow: Meta.Window;
    sourceActor: Meta.WindowActor;
    positionChangedId: number;
    sizeChangedId: number;
    sourceDestroyId: number;
    sourceDestroyed: boolean;
}

interface WorkspaceContainer {
    container: Clutter.Actor;
    scrollContainer: Clutter.Actor;
}

const ANIMATION_DURATION = 250;
const FOCUS_BORDER_WIDTH = 3;
const FOCUS_BORDER_COLOR = '#4caf50';
const OVERVIEW_BG_COLOR = 'rgba(0,0,0,0.7)';

export interface OverviewTransform {
    readonly scale: number;
    readonly offsetX: number;
    readonly offsetY: number;
}

export class CloneAdapter {
    private _layer: Clutter.Actor | null = null;
    private _floatLayer: Clutter.Actor | null = null;
    private _workspaceStrip: Clutter.Actor | null = null;
    private _focusIndicator: St.Widget | null = null;
    private _workspaceContainers: Map<WorkspaceId, WorkspaceContainer> = new Map();
    /** Ordered list of workspace IDs matching domain workspace indices. */
    private _workspaceOrder: WorkspaceId[] = [];
    private _clones: Map<WindowId, CloneEntry> = new Map();
    private _floatClones: Map<WindowId, FloatCloneEntry> = new Map();
    private _workAreaY: number = 0;
    private _monitorHeight: number = 0;
    private _currentWorkspaceId: WorkspaceId | null = null;
    private _lastLayout: LayoutState | null = null;
    private _overviewActive: boolean = false;
    private _overviewBg: St.Widget | null = null;

    init(workAreaY: number, monitorHeight: number): void {
        this._workAreaY = workAreaY;
        this._monitorHeight = monitorHeight;

        this._layer = new Clutter.Actor({
            name: 'paperflow-layer',
            clip_to_allocation: true,
        });

        // Size the layer to match the monitor so clipping works
        const parent = global.window_group.get_parent()!;
        const stage = global.stage;
        this._layer.set_position(0, this._workAreaY);
        this._layer.set_size(stage.width, monitorHeight);

        this._workspaceStrip = new Clutter.Actor({ name: 'paperflow-strip' });
        this._layer.add_child(this._workspaceStrip);

        this._focusIndicator = new St.Widget({
            name: 'paperflow-focus-indicator',
            style: `border: ${FOCUS_BORDER_WIDTH}px solid ${FOCUS_BORDER_COLOR}; border-radius: 4px;`,
            visible: false,
            reactive: false,
        });
        this._layer.add_child(this._focusIndicator);

        parent.insert_child_above(this._layer, global.window_group);

        this._floatLayer = new Clutter.Actor({ name: 'paperflow-float-layer' });
        parent.insert_child_above(this._floatLayer, this._layer);

        console.log(`[PaperFlow] clone-adapter init: workAreaY=${workAreaY}, monitorHeight=${monitorHeight}, layer.position=(${this._layer.x},${this._layer.y})`);
    }

    updateWorkArea(workAreaY: number, monitorHeight?: number): void {
        this._workAreaY = workAreaY;
        if (monitorHeight !== undefined) {
            this._monitorHeight = monitorHeight;
        }
        if (this._layer) {
            this._layer.set_position(0, this._workAreaY);
            this._layer.set_size(global.stage.width, this._monitorHeight);
        }
        // Reposition workspace containers using current ordering
        for (let i = 0; i < this._workspaceOrder.length; i++) {
            const wc = this._workspaceContainers.get(this._workspaceOrder[i]!);
            if (!wc) continue;
            wc.container.set_position(0, i * this._monitorHeight);
            wc.container.set_size(global.stage.width, this._monitorHeight);
        }
    }

    private _getOrCreateWorkspaceContainer(wsId: WorkspaceId): WorkspaceContainer {
        const existing = this._workspaceContainers.get(wsId);
        if (existing) return existing;

        const container = new Clutter.Actor({
            name: `paperflow-ws-${wsId}`,
        });
        container.set_size(global.stage.width, this._monitorHeight);

        const scrollContainer = new Clutter.Actor({
            name: `paperflow-scroll-${wsId}`,
        });
        container.add_child(scrollContainer);

        this._workspaceStrip!.add_child(container);

        const wc: WorkspaceContainer = { container, scrollContainer };
        this._workspaceContainers.set(wsId, wc);
        return wc;
    }

    addClone(windowId: WindowId, metaWindow: Meta.Window, workspaceId: WorkspaceId): void {
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;
        if (!actor || !this._workspaceStrip) return;

        const wc = this._getOrCreateWorkspaceContainer(workspaceId);

        const wrapper = new Clutter.Actor({
            name: `paperflow-clone-${windowId}`,
            reactive: false,
            clip_to_allocation: true,
        });
        const clone = new Clutter.Clone({ source: actor });
        wrapper.add_child(clone);
        wc.scrollContainer.add_child(wrapper);

        // Listen for size changes to re-allocate clone geometry (PaperWM pattern).
        const sizeChangedId = metaWindow.connect('size-changed', () => {
            try {
                this._allocateClone(windowId);
                this._refreshFocusIndicatorForWindow(windowId);
            } catch (e) {
                console.error('[PaperFlow] Error in size-changed handler:', e);
            }
        });

        // Real WindowActors stay visible — they sit below the clone layer
        // in z-order so clones paint on top, but being visible means they
        // participate in Clutter pick() and receive mouse/keyboard input.

        // Track actor destruction
        const entry: CloneEntry = {
            wrapper, clone, metaWindow, sourceActor: actor,
            sizeChangedId, sourceDestroyId: 0, sourceDestroyed: false,
            workspaceId, layoutWidth: 0, layoutHeight: 0,
        };
        entry.sourceDestroyId = actor.connect('destroy', () => {
            entry.sourceDestroyed = true;
        });

        this._clones.set(windowId, entry);
    }

    removeClone(windowId: WindowId): void {
        const entry = this._clones.get(windowId);
        if (!entry) return;
        this._clones.delete(windowId);

        // Disconnect metaWindow signal
        try { entry.metaWindow.disconnect(entry.sizeChangedId); } catch { /* window already gone */ }

        if (!entry.sourceDestroyed) {
            entry.sourceActor.disconnect(entry.sourceDestroyId);
        }

        entry.wrapper.destroy();
    }

    addFloatClone(windowId: WindowId, metaWindow: Meta.Window): void {
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;
        if (!actor || !this._floatLayer) return;

        const wrapper = new Clutter.Actor({ name: `paperflow-float-${windowId}` });
        const clone = new Clutter.Clone({ source: actor });
        wrapper.add_child(clone);
        this._floatLayer.add_child(wrapper);

        // Position at the window's current screen position
        this._syncFloatClone(wrapper, clone, metaWindow);

        // Real actor stays visible for input (same as tiled clones)

        // Track position and size changes
        const positionChangedId = metaWindow.connect('position-changed', () => {
            try {
                this._syncFloatClone(wrapper, clone, metaWindow);
            } catch (e) {
                console.error('[PaperFlow] Error in float position-changed handler:', e);
            }
        });

        const sizeChangedId = metaWindow.connect('size-changed', () => {
            try {
                this._syncFloatClone(wrapper, clone, metaWindow);
            } catch (e) {
                console.error('[PaperFlow] Error in float size-changed handler:', e);
            }
        });

        const entry: FloatCloneEntry = {
            wrapper, clone, metaWindow, sourceActor: actor,
            positionChangedId, sizeChangedId,
            sourceDestroyId: 0, sourceDestroyed: false,
        };
        entry.sourceDestroyId = actor.connect('destroy', () => {
            entry.sourceDestroyed = true;
        });

        this._floatClones.set(windowId, entry);
    }

    removeFloatClone(windowId: WindowId): void {
        const entry = this._floatClones.get(windowId);
        if (!entry) return;
        this._floatClones.delete(windowId);

        try { entry.metaWindow.disconnect(entry.positionChangedId); } catch { /* already gone */ }
        try { entry.metaWindow.disconnect(entry.sizeChangedId); } catch { /* already gone */ }

        if (!entry.sourceDestroyed) {
            entry.sourceActor.disconnect(entry.sourceDestroyId);
        }

        entry.wrapper.destroy();
    }

    private _syncFloatClone(wrapper: Clutter.Actor, clone: Clutter.Clone, metaWindow: Meta.Window): void {
        let frame, buffer;
        try {
            frame = metaWindow.get_frame_rect();
            buffer = metaWindow.get_buffer_rect();
        } catch {
            return;
        }
        if (frame.width <= 0 || frame.height <= 0) return;

        wrapper.set_position(frame.x, frame.y);
        wrapper.set_size(frame.width, frame.height);

        const cloneOffX = buffer.x - frame.x;
        const cloneOffY = buffer.y - frame.y;
        clone.set_position(cloneOffX, cloneOffY);
        clone.set_size(buffer.width, buffer.height);
    }

    /**
     * Allocate the inner clone's offset and size based on frame/buffer rects.
     */
    private _allocateClone(windowId: WindowId): void {
        const entry = this._clones.get(windowId);
        if (!entry || entry.sourceDestroyed) return;

        let frame, buffer;
        try {
            frame = entry.metaWindow.get_frame_rect();
            buffer = entry.metaWindow.get_buffer_rect();
        } catch {
            return;
        }

        if (frame.width <= 0 || frame.height <= 0 ||
            buffer.width <= 0 || buffer.height <= 0) {
            return;
        }

        // Base offset: align frame origin with wrapper origin
        let cloneOffX = buffer.x - frame.x;
        let cloneOffY = buffer.y - frame.y;

        // When frame exceeds layout target (e.g. Chromium ignores resize request),
        // center the frame content within the layout slot so clipping is symmetric.
        if (entry.layoutWidth > 0 && frame.width > entry.layoutWidth) {
            cloneOffX += Math.round((entry.layoutWidth - frame.width) / 2);
        }
        if (entry.layoutHeight > 0 && frame.height > entry.layoutHeight) {
            cloneOffY += Math.round((entry.layoutHeight - frame.height) / 2);
        }

        entry.clone.set_position(cloneOffX, cloneOffY);
        entry.clone.set_size(buffer.width, buffer.height);

        // Wrapper is always layout-target sized (clip_to_allocation handles overflow).
        // When layout is not yet set, fall back to frame size.
        const wrapperW = entry.layoutWidth > 0 ? entry.layoutWidth : frame.width;
        const wrapperH = entry.layoutHeight > 0 ? entry.layoutHeight : frame.height;
        entry.wrapper.set_size(wrapperW, wrapperH);
    }

    /**
     * Reparent a clone's wrapper from one workspace scroll container to another.
     * Must be called before syncWorkspaces to prevent the source container
     * from being wrongly pruned.
     */
    moveCloneToWorkspace(windowId: WindowId, targetWsId: WorkspaceId): void {
        const entry = this._clones.get(windowId);
        if (!entry) return;

        const targetWc = this._getOrCreateWorkspaceContainer(targetWsId);
        const oldParent = entry.wrapper.get_parent();
        if (oldParent) {
            oldParent.remove_child(entry.wrapper);
        }
        targetWc.scrollContainer.add_child(entry.wrapper);
        entry.workspaceId = targetWsId;
    }

    applyLayout(layout: LayoutState, animate: boolean): void {
        this._lastLayout = layout;
        const duration = animate ? ANIMATION_DURATION : 0;
        const easeMode = Clutter.AnimationMode.EASE_OUT_QUAD;

        // Animate workspace strip Y for workspace switching
        if (this._workspaceStrip) {
            const targetY = -layout.workspaceIndex * this._monitorHeight;
            if (duration > 0) {
                (this._workspaceStrip as unknown as Easeable).ease({
                    y: targetY,
                    duration,
                    mode: easeMode,
                });
            } else {
                this._workspaceStrip.set_position(0, targetY);
            }
        }
        if (this._workspaceOrder[layout.workspaceIndex]) {
            this._currentWorkspaceId = this._workspaceOrder[layout.workspaceIndex]!;
        }

        // Animate workspace containers to their correct Y positions.
        // After syncWorkspaces re-indexes, containers keep their old Y;
        // this animates them into place (e.g. workspace below slides up).
        for (let i = 0; i < this._workspaceOrder.length; i++) {
            const wc = this._workspaceContainers.get(this._workspaceOrder[i]!);
            if (!wc) continue;
            const targetContainerY = i * this._monitorHeight;
            if (duration > 0) {
                (wc.container as unknown as Easeable).ease({
                    y: targetContainerY,
                    duration,
                    mode: easeMode,
                });
            } else {
                wc.container.set_position(0, targetContainerY);
            }
        }

        // Scroll ALL workspace containers to the same scrollX —
        // the viewport is a single camera over the 2D world, so all
        // workspaces must move horizontally together.
        for (const wc of this._workspaceContainers.values()) {
            if (duration > 0) {
                (wc.scrollContainer as unknown as Easeable).ease({
                    x: -layout.scrollX,
                    duration,
                    mode: easeMode,
                });
            } else {
                wc.scrollContainer.set_position(-layout.scrollX, 0);
            }
        }

        // Position clone wrappers — only animate position.
        // Wrapper size is owned by _allocateClone (frame_rect capped to layout target).
        for (const wl of layout.windows) {
            const entry = this._clones.get(wl.windowId);
            if (!entry) continue;

            entry.layoutWidth = wl.width;
            entry.layoutHeight = wl.height;
            this._allocateClone(wl.windowId);

            if (duration > 0) {
                (entry.wrapper as unknown as Easeable).ease({
                    x: wl.x,
                    y: wl.y,
                    duration,
                    mode: easeMode,
                });
            } else {
                entry.wrapper.set_position(wl.x, wl.y);
            }
        }

        // Position focus indicator on the active workspace
        this._updateFocusIndicator(layout, duration, easeMode);
    }

    private _updateFocusIndicator(
        layout: LayoutState,
        duration: number,
        easeMode: Clutter.AnimationMode,
    ): void {
        if (!this._focusIndicator) return;

        if (!layout.focusedWindowId) {
            this._focusIndicator.visible = false;
            return;
        }

        const focusedLayout = layout.windows.find(
            w => w.windowId === layout.focusedWindowId,
        );
        if (!focusedLayout) {
            this._focusIndicator.visible = false;
            return;
        }

        this._focusIndicator.visible = true;

        // Convert from scroll-container-relative to layer-relative coordinates.
        // Use layout target dimensions — wrapper is always layout-sized.
        const x = focusedLayout.x - layout.scrollX - FOCUS_BORDER_WIDTH;
        const y = focusedLayout.y - FOCUS_BORDER_WIDTH;
        const width = focusedLayout.width + FOCUS_BORDER_WIDTH * 2;
        const height = focusedLayout.height + FOCUS_BORDER_WIDTH * 2;

        if (duration > 0) {
            (this._focusIndicator as unknown as Easeable).ease({
                x, y, width, height,
                duration,
                mode: easeMode,
            });
        } else {
            this._focusIndicator.set_position(x, y);
            this._focusIndicator.set_size(width, height);
        }
    }

    /**
     * Refresh the focus indicator if the given window is currently focused.
     * Called from size-changed handler after _allocateClone updates wrapper size.
     */
    private _refreshFocusIndicatorForWindow(windowId: WindowId): void {
        if (!this._lastLayout || this._lastLayout.focusedWindowId !== windowId) return;
        this._updateFocusIndicator(this._lastLayout, 0, Clutter.AnimationMode.EASE_OUT_QUAD);
    }

    /**
     * Snap active workspace's scroll container to a position without animation.
     */
    setScroll(scrollX: number): void {
        if (!this._currentWorkspaceId) return;
        const wc = this._workspaceContainers.get(this._currentWorkspaceId);
        wc?.scrollContainer.set_position(-scrollX, 0);
    }

    /**
     * Snap a specific workspace's scroll container to a position without animation.
     * Used before workspace switch to sync the arriving workspace to the departing one's position.
     */
    setScrollForWorkspace(wsId: WorkspaceId, scrollX: number): void {
        const wc = this._workspaceContainers.get(wsId);
        if (!wc) return;
        wc.scrollContainer.set_position(-scrollX, 0);
    }

    /**
     * Reconcile workspace containers to match the domain's workspace list.
     * Creates containers for new workspaces, removes containers for pruned ones.
     * Workspace IDs are stable across pruning, so no re-indexing ambiguity.
     */
    syncWorkspaces(workspaces: readonly { readonly id: WorkspaceId }[]): void {
        if (!this._workspaceStrip) return;

        const validIds = new Set(workspaces.map(ws => ws.id));

        // Remove containers for workspaces that no longer exist
        for (const [id, wc] of this._workspaceContainers) {
            if (!validIds.has(id)) {
                wc.container.destroy();
                this._workspaceContainers.delete(id);
            }
        }

        // Ensure containers exist for all workspaces
        for (const ws of workspaces) {
            this._getOrCreateWorkspaceContainer(ws.id);
        }

        // Update ordering — applyLayout uses this for Y positioning
        this._workspaceOrder = workspaces.map(ws => ws.id);
    }

    /**
     * Animate viewport scroll from current position to target.
     */
    animateViewport(targetScrollX: number): void {
        if (!this._currentWorkspaceId) return;
        const wc = this._workspaceContainers.get(this._currentWorkspaceId);
        if (!wc) return;
        (wc.scrollContainer as unknown as Easeable).ease({
            x: -targetScrollX,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    /**
     * Enter overview: scale workspace strip to show all workspaces,
     * add dark background, reposition focus indicator.
     */
    enterOverview(transform: OverviewTransform, layout: LayoutState, numWorkspaces: number): void {
        if (!this._layer || !this._workspaceStrip) return;
        this._overviewActive = true;

        // Dark background behind the strip
        if (!this._overviewBg) {
            this._overviewBg = new St.Widget({
                name: 'paperflow-overview-bg',
                style: `background-color: ${OVERVIEW_BG_COLOR};`,
                reactive: false,
                x: 0,
                y: 0,
                width: this._layer.width,
                height: this._layer.height,
            });
            this._layer.insert_child_below(this._overviewBg, this._workspaceStrip);
        }
        this._overviewBg.visible = true;

        // Temporarily remove clip so scaled-down strip is visible
        this._layer.set_clip(-1, -1, global.stage.width + 2, this._monitorHeight + 2);

        // Animate strip to overview position
        const stripY = transform.offsetY;
        (this._workspaceStrip as unknown as Easeable).ease({
            scale_x: transform.scale,
            scale_y: transform.scale,
            x: transform.offsetX,
            y: stripY,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // Reset all scroll containers to x=0 (show all windows from left edge)
        for (const wc of this._workspaceContainers.values()) {
            (wc.scrollContainer as unknown as Easeable).ease({
                x: 0,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        // Update focus indicator for overview coordinates
        this._updateOverviewFocus(layout, layout.workspaceIndex, transform);
    }

    /**
     * Exit overview: restore strip to normal scale and positioning.
     */
    exitOverview(layout: LayoutState): void {
        if (!this._layer || !this._workspaceStrip) return;
        this._overviewActive = false;

        // Hide background
        if (this._overviewBg) {
            this._overviewBg.visible = false;
        }

        // Restore strip to normal
        const targetY = -layout.workspaceIndex * this._monitorHeight;
        (this._workspaceStrip as unknown as Easeable).ease({
            scale_x: 1,
            scale_y: 1,
            x: 0,
            y: targetY,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // Restore clip
        this._layer.remove_clip();

        // Restore scroll positions
        for (const wc of this._workspaceContainers.values()) {
            (wc.scrollContainer as unknown as Easeable).ease({
                x: -layout.scrollX,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        // Restore normal focus indicator
        this._updateFocusIndicator(layout, ANIMATION_DURATION, Clutter.AnimationMode.EASE_OUT_QUAD);
    }

    /**
     * Update focus indicator position during overview navigation.
     * The focus indicator is a layer child (not inside the scaled strip),
     * so we compute its position in layer-local coordinates.
     */
    updateOverviewFocus(layout: LayoutState, wsIndex: number, transform: OverviewTransform): void {
        if (!this._overviewActive) return;
        this._updateOverviewFocus(layout, wsIndex, transform);
    }

    private _updateOverviewFocus(
        layout: LayoutState,
        wsIndex: number,
        transform: OverviewTransform,
    ): void {
        if (!this._focusIndicator) return;

        const focusedLayout = layout.windows.find(
            w => w.windowId === layout.focusedWindowId,
        );
        if (!focusedLayout) {
            this._focusIndicator.visible = false;
            return;
        }

        this._focusIndicator.visible = true;

        const { scale, offsetX, offsetY } = transform;
        const x = focusedLayout.x * scale + offsetX - FOCUS_BORDER_WIDTH;
        const y = (wsIndex * this._monitorHeight + focusedLayout.y) * scale + offsetY - FOCUS_BORDER_WIDTH;
        const width = focusedLayout.width * scale + FOCUS_BORDER_WIDTH * 2;
        const height = focusedLayout.height * scale + FOCUS_BORDER_WIDTH * 2;

        (this._focusIndicator as unknown as Easeable).ease({
            x, y, width, height,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    destroy(): void {
        // Stop all running animations and clean up workspace containers
        for (const wc of this._workspaceContainers.values()) {
            wc.scrollContainer.remove_all_transitions();
            wc.container.remove_all_transitions();
        }
        this._focusIndicator?.remove_all_transitions();
        this._workspaceStrip?.remove_all_transitions();

        for (const entry of this._clones.values()) {
            entry.wrapper.remove_all_transitions();
            try { entry.metaWindow.disconnect(entry.sizeChangedId); } catch { /* window already gone */ }
            if (!entry.sourceDestroyed) {
                entry.sourceActor.disconnect(entry.sourceDestroyId);
            }
        }
        this._clones.clear();

        for (const entry of this._floatClones.values()) {
            entry.wrapper.remove_all_transitions();
            try { entry.metaWindow.disconnect(entry.positionChangedId); } catch { /* already gone */ }
            try { entry.metaWindow.disconnect(entry.sizeChangedId); } catch { /* already gone */ }
            if (!entry.sourceDestroyed) {
                entry.sourceActor.disconnect(entry.sourceDestroyId);
            }
        }
        this._floatClones.clear();

        if (this._overviewBg) {
            this._overviewBg.destroy();
            this._overviewBg = null;
        }

        if (this._floatLayer) {
            this._floatLayer.destroy();
            this._floatLayer = null;
        }
        if (this._layer) {
            this._layer.destroy();
            this._layer = null;
            this._workspaceStrip = null;
            this._workspaceContainers.clear();
            this._workspaceOrder = [];
        }
    }
}
