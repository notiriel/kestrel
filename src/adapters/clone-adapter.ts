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

const ANIMATION_DURATION = 250;
const FOCUS_BORDER_WIDTH = 3;
const FOCUS_BORDER_COLOR = '#4caf50';

export class CloneAdapter {
    private _layer: Clutter.Actor | null = null;
    private _floatLayer: Clutter.Actor | null = null;
    private _scrollContainer: Clutter.Actor | null = null;
    private _focusIndicator: St.Widget | null = null;
    private _clones: Map<WindowId, CloneEntry> = new Map();
    private _floatClones: Map<WindowId, FloatCloneEntry> = new Map();
    private _workAreaY: number = 0;

    init(workAreaY: number): void {
        this._workAreaY = workAreaY;
        this._layer = new Clutter.Actor({ name: 'paperflow-layer' });
        this._scrollContainer = new Clutter.Actor({ name: 'paperflow-scroll' });
        this._layer.add_child(this._scrollContainer);

        this._focusIndicator = new St.Widget({
            name: 'paperflow-focus-indicator',
            style: `border: ${FOCUS_BORDER_WIDTH}px solid ${FOCUS_BORDER_COLOR}; border-radius: 4px;`,
            visible: false,
            reactive: false,
        });
        this._scrollContainer.add_child(this._focusIndicator);

        const parent = global.window_group.get_parent()!;
        parent.insert_child_above(this._layer, global.window_group);

        this._floatLayer = new Clutter.Actor({ name: 'paperflow-float-layer' });
        parent.insert_child_above(this._floatLayer, this._layer);

        console.log(`[PaperFlow] clone-adapter init: workAreaY=${workAreaY}, layer.position=(${this._layer.x},${this._layer.y}), parent=${parent.name}, parent.position=(${parent.x},${parent.y})`);
    }

    updateWorkArea(workAreaY: number): void {
        this._workAreaY = workAreaY;
    }

    addClone(windowId: WindowId, metaWindow: Meta.Window): void {
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;
        if (!actor || !this._scrollContainer) return;

        const wrapper = new Clutter.Actor({ name: `paperflow-clone-${windowId}` });
        const clone = new Clutter.Clone({ source: actor });
        wrapper.add_child(clone);
        this._scrollContainer.add_child(wrapper);

        // Listen for size changes to re-allocate clone geometry (PaperWM pattern).
        // buffer_rect is only accurate AFTER the client processes the resize.
        const sizeChangedId = metaWindow.connect('size-changed', () => {
            try {
                this._allocateClone(windowId);
            } catch (e) {
                console.error('[PaperFlow] Error in size-changed handler:', e);
            }
        });

        // Hide the real WindowActor. Clutter.Clone can still paint a hidden
        // source. Intercept the 'show' signal to counter GNOME Shell's map
        // animation which calls actor.show() asynchronously (PaperWM pattern).
        actor.hide();
        const showId = actor.connect('show', () => {
            actor.hide();
        });

        // Track actor destruction so we never call methods on a freed C object
        // (try/catch cannot catch SIGSEGV from native calls on destroyed actors)
        const entry: CloneEntry = {
            wrapper, clone, metaWindow, sourceActor: actor,
            sizeChangedId, showId, sourceDestroyId: 0, sourceDestroyed: false,
        };
        entry.sourceDestroyId = actor.connect('destroy', () => {
            entry.sourceDestroyed = true;
        });

        this._clones.set(windowId, entry);

        // Keep focus indicator on top
        if (this._focusIndicator) {
            this._scrollContainer.set_child_above_sibling(this._focusIndicator, null);
        }
    }

    removeClone(windowId: WindowId): void {
        const entry = this._clones.get(windowId);
        if (!entry) return;
        this._clones.delete(windowId);

        // Disconnect metaWindow signal (Meta.Window outlives its actor)
        try { entry.metaWindow.disconnect(entry.sizeChangedId); } catch { /* window already gone */ }

        // Only touch sourceActor if it hasn't been destroyed — calling methods
        // on a destroyed Clutter actor causes a native SIGSEGV that JS can't catch
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
     * Also updates the wrapper size to match the actual frame rect,
     * since move_resize_frame() may not honor the exact requested size.
     *
     * Called from 'size-changed' signal AND from applyLayout.
     */
    private _allocateClone(windowId: WindowId): void {
        const entry = this._clones.get(windowId);
        if (!entry || entry.sourceDestroyed) return;

        let frame, buffer;
        try {
            frame = entry.metaWindow.get_frame_rect();
            buffer = entry.metaWindow.get_buffer_rect();
        } catch {
            return; // Window may be in a destroyed state
        }

        // Guard against invalid rects (window not yet fully realized)
        if (frame.width <= 0 || frame.height <= 0 ||
            buffer.width <= 0 || buffer.height <= 0) {
            return;
        }

        // Position inner clone so its frame area aligns with wrapper origin
        const cloneOffX = buffer.x - frame.x;
        const cloneOffY = buffer.y - frame.y;
        entry.clone.set_position(cloneOffX, cloneOffY);
        entry.clone.set_size(buffer.width, buffer.height);

        // Update wrapper to match actual frame size (Mutter may constrain)
        entry.wrapper.set_size(frame.width, frame.height);
    }

    applyLayout(layout: LayoutState, animate: boolean): void {
        const duration = animate ? ANIMATION_DURATION : 0;
        const easeMode = Clutter.AnimationMode.EASE_OUT_QUAD;

        // Scroll the container
        if (this._scrollContainer) {
            if (duration > 0) {
                (this._scrollContainer as unknown as Easeable).ease({
                    x: -layout.scrollX,
                    duration,
                    mode: easeMode,
                });
            } else {
                this._scrollContainer.set_position(-layout.scrollX, 0);
            }
        }

        // Position clone wrappers
        for (const wl of layout.windows) {
            const entry = this._clones.get(wl.windowId);
            if (!entry) continue;

            // Re-allocate clone geometry (shadow offset + wrapper sizing from frame rect)
            this._allocateClone(wl.windowId);

            const screenY = wl.y + this._workAreaY;
            if (duration > 0) {
                (entry.wrapper as unknown as Easeable).ease({
                    x: wl.x,
                    y: screenY,
                    duration,
                    mode: easeMode,
                });
            } else {
                entry.wrapper.set_position(wl.x, screenY);
            }
        }

        // Position focus indicator
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
        const x = focusedLayout.x - FOCUS_BORDER_WIDTH;
        const y = focusedLayout.y + this._workAreaY - FOCUS_BORDER_WIDTH;
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
     * Snap scroll container to a position without animation.
     */
    setScroll(scrollX: number): void {
        this._scrollContainer?.set_position(-scrollX, 0);
    }

    /**
     * Animate viewport scroll from current position to target.
     * Call after setScroll(oldScrollX) + applyLayout(_, false) to get a
     * smooth viewport transition while window positions snap immediately.
     */
    animateViewport(targetScrollX: number): void {
        if (!this._scrollContainer) return;
        (this._scrollContainer as unknown as Easeable).ease({
            x: -targetScrollX,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    destroy(): void {
        for (const entry of this._clones.values()) {
            try { entry.metaWindow.disconnect(entry.sizeChangedId); } catch { /* window already gone */ }
            if (!entry.sourceDestroyed) {
                entry.sourceActor.disconnect(entry.showId);
                entry.sourceActor.disconnect(entry.sourceDestroyId);
                entry.sourceActor.show();
            }
        }
        this._clones.clear();

        for (const entry of this._floatClones.values()) {
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
            this._scrollContainer = null;
            this._focusIndicator = null;
        }
    }
}
