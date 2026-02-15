import type { WindowId, LayoutState } from '../domain/types.js';
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
    showId: number;
    sourceDestroyId: number;
    sourceDestroyed: boolean;
    workspaceIndex: number;
}

interface FloatCloneEntry {
    wrapper: Clutter.Actor;
    clone: Clutter.Clone;
    metaWindow: Meta.Window;
    sourceActor: Meta.WindowActor;
    positionChangedId: number;
    sizeChangedId: number;
    showId: number;
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

export class CloneAdapter {
    private _layer: Clutter.Actor | null = null;
    private _floatLayer: Clutter.Actor | null = null;
    private _workspaceStrip: Clutter.Actor | null = null;
    private _focusIndicator: St.Widget | null = null;
    private _workspaceContainers: Map<number, WorkspaceContainer> = new Map();
    private _clones: Map<WindowId, CloneEntry> = new Map();
    private _floatClones: Map<WindowId, FloatCloneEntry> = new Map();
    private _workAreaY: number = 0;
    private _monitorHeight: number = 0;
    private _currentWorkspaceIndex: number = 0;
    private _onCloneClicked: ((windowId: WindowId) => void) | null = null;

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

        // Create workspace 0
        this._getOrCreateWorkspaceContainer(0);

        parent.insert_child_above(this._layer, global.window_group);

        this._floatLayer = new Clutter.Actor({ name: 'paperflow-float-layer' });
        parent.insert_child_above(this._floatLayer, this._layer);

        console.log(`[PaperFlow] clone-adapter init: workAreaY=${workAreaY}, monitorHeight=${monitorHeight}, layer.position=(${this._layer.x},${this._layer.y})`);
    }

    connectCloneClicked(callback: (windowId: WindowId) => void): void {
        this._onCloneClicked = callback;
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
        // Reposition workspace containers
        for (const [idx, wc] of this._workspaceContainers) {
            wc.container.set_position(0, idx * this._monitorHeight);
            wc.container.set_size(global.stage.width, this._monitorHeight);
        }
    }

    private _getOrCreateWorkspaceContainer(wsIndex: number): WorkspaceContainer {
        const existing = this._workspaceContainers.get(wsIndex);
        if (existing) return existing;

        const container = new Clutter.Actor({
            name: `paperflow-ws-${wsIndex}`,
        });
        container.set_position(0, wsIndex * this._monitorHeight);
        container.set_size(global.stage.width, this._monitorHeight);

        const scrollContainer = new Clutter.Actor({
            name: `paperflow-scroll-${wsIndex}`,
        });
        container.add_child(scrollContainer);

        this._workspaceStrip!.add_child(container);

        const wc: WorkspaceContainer = { container, scrollContainer };
        this._workspaceContainers.set(wsIndex, wc);
        return wc;
    }

    addClone(windowId: WindowId, metaWindow: Meta.Window, workspaceIndex: number): void {
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;
        if (!actor || !this._workspaceStrip) return;

        const wc = this._getOrCreateWorkspaceContainer(workspaceIndex);

        const wrapper = new Clutter.Actor({
            name: `paperflow-clone-${windowId}`,
            reactive: true,
        });
        wrapper.connect('button-press-event', () => {
            try {
                this._onCloneClicked?.(windowId);
            } catch (e) {
                console.error('[PaperFlow] Error in clone click handler:', e);
            }
            return Clutter.EVENT_STOP;
        });
        const clone = new Clutter.Clone({ source: actor });
        wrapper.add_child(clone);
        wc.scrollContainer.add_child(wrapper);

        // Listen for size changes to re-allocate clone geometry (PaperWM pattern).
        const sizeChangedId = metaWindow.connect('size-changed', () => {
            try {
                this._allocateClone(windowId);
            } catch (e) {
                console.error('[PaperFlow] Error in size-changed handler:', e);
            }
        });

        // Hide the real WindowActor. Clutter.Clone can still paint a hidden source.
        actor.hide();
        const showId = actor.connect('show', () => {
            actor.hide();
        });

        // Track actor destruction
        const entry: CloneEntry = {
            wrapper, clone, metaWindow, sourceActor: actor,
            sizeChangedId, showId, sourceDestroyId: 0, sourceDestroyed: false,
            workspaceIndex,
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
            entry.sourceActor.disconnect(entry.showId);
            entry.sourceActor.disconnect(entry.sourceDestroyId);
            entry.sourceActor.show();
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

        // Hide the real actor (same pattern as tiled clones)
        actor.hide();
        const showId = actor.connect('show', () => {
            actor.hide();
        });

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
            positionChangedId, sizeChangedId, showId,
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
            entry.sourceActor.disconnect(entry.showId);
            entry.sourceActor.disconnect(entry.sourceDestroyId);
            entry.sourceActor.show();
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

        const cloneOffX = buffer.x - frame.x;
        const cloneOffY = buffer.y - frame.y;
        entry.clone.set_position(cloneOffX, cloneOffY);
        entry.clone.set_size(buffer.width, buffer.height);

        entry.wrapper.set_size(frame.width, frame.height);
    }

    applyLayout(layout: LayoutState, animate: boolean): void {
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
        this._currentWorkspaceIndex = layout.workspaceIndex;

        // Animate workspace containers to their correct Y positions.
        // After syncWorkspaces re-indexes, containers keep their old Y;
        // this animates them into place (e.g. workspace below slides up).
        for (const [idx, wc] of this._workspaceContainers) {
            const targetContainerY = idx * this._monitorHeight;
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

        // Position clone wrappers
        for (const wl of layout.windows) {
            const entry = this._clones.get(wl.windowId);
            if (!entry) continue;

            this._allocateClone(wl.windowId);

            // Y position is relative to the workspace container (no workAreaY offset needed,
            // since the layer itself is positioned at workAreaY)
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

        // Convert from scroll-container-relative to layer-relative coordinates
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
     * Snap active workspace's scroll container to a position without animation.
     */
    setScroll(scrollX: number): void {
        const wc = this._workspaceContainers.get(this._currentWorkspaceIndex);
        wc?.scrollContainer.set_position(-scrollX, 0);
    }

    /**
     * Snap a specific workspace's scroll container to a position without animation.
     * Used before workspace switch to sync the arriving workspace to the departing one's position.
     */
    setScrollForWorkspace(wsIndex: number, scrollX: number): void {
        const wc = this._getOrCreateWorkspaceContainer(wsIndex);
        wc.scrollContainer.set_position(-scrollX, 0);
    }

    /**
     * Reconcile workspace containers to match the domain's workspace count.
     * Removes empty containers for pruned workspaces and re-indexes the rest.
     */
    syncWorkspaces(workspaceCount: number): void {
        if (!this._workspaceStrip) return;

        // Collect containers sorted by current index
        const sorted = [...this._workspaceContainers.entries()]
            .sort(([a], [b]) => a - b);

        // Remove containers that have no clones (pruned workspaces)
        const keep: WorkspaceContainer[] = [];
        for (const [idx, wc] of sorted) {
            const hasClones = [...this._clones.values()]
                .some(e => e.workspaceIndex === idx);
            if (hasClones) {
                keep.push(wc);
            } else {
                wc.container.destroy();
            }
        }

        // Ensure we have enough containers (e.g. for trailing empty workspace)
        while (keep.length < workspaceCount) {
            const container = new Clutter.Actor({
                name: `paperflow-ws-${keep.length}`,
            });
            container.set_size(global.stage.width, this._monitorHeight);
            const scrollContainer = new Clutter.Actor({
                name: `paperflow-scroll-${keep.length}`,
            });
            container.add_child(scrollContainer);
            this._workspaceStrip.add_child(container);
            keep.push({ container, scrollContainer });
        }

        // Rebuild map with correct indices — but DON'T reposition containers.
        // applyLayout will animate them to their correct Y positions.
        this._workspaceContainers.clear();
        for (let i = 0; i < keep.length; i++) {
            this._workspaceContainers.set(i, keep[i]!);
        }

        // Update clone entries to match new indices
        for (const entry of this._clones.values()) {
            for (const [idx, wc] of this._workspaceContainers) {
                if (wc.scrollContainer === entry.wrapper.get_parent()) {
                    entry.workspaceIndex = idx;
                    break;
                }
            }
        }

        // Update current workspace index
        if (this._currentWorkspaceIndex >= keep.length) {
            this._currentWorkspaceIndex = keep.length - 1;
        }
    }

    /**
     * Animate viewport scroll from current position to target.
     */
    animateViewport(targetScrollX: number): void {
        const wc = this._workspaceContainers.get(this._currentWorkspaceIndex);
        if (!wc) return;
        (wc.scrollContainer as unknown as Easeable).ease({
            x: -targetScrollX,
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
                entry.sourceActor.disconnect(entry.showId);
                entry.sourceActor.disconnect(entry.sourceDestroyId);
                entry.sourceActor.show();
            }
        }
        this._clones.clear();

        for (const entry of this._floatClones.values()) {
            entry.wrapper.remove_all_transitions();
            try { entry.metaWindow.disconnect(entry.positionChangedId); } catch { /* already gone */ }
            try { entry.metaWindow.disconnect(entry.sizeChangedId); } catch { /* already gone */ }
            if (!entry.sourceDestroyed) {
                entry.sourceActor.disconnect(entry.showId);
                entry.sourceActor.disconnect(entry.sourceDestroyId);
                entry.sourceActor.show();
            }
        }
        this._floatClones.clear();

        if (this._floatLayer) {
            this._floatLayer.destroy();
            this._floatLayer = null;
        }
        if (this._layer) {
            this._layer.destroy();
            this._layer = null;
            this._workspaceStrip = null;
            this._workspaceContainers.clear();
        }
    }
}
