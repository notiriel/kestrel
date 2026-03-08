import type { WindowId, KestrelConfig } from '../../domain/world/types.js';
import type { QuakeWindowScene } from '../../domain/scene/scene.js';
import Clutter from 'gi://Clutter';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { rawWindow } from '../safe-window.js';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

interface TrackedQuakeWindow {
    metaWindow: Meta.Window;
    actor: Meta.WindowActor;
}

const ANIM_DURATION = 250;
const SLIDE_OFFSET = 100;

export class QuakeWindowAdapter {
    private _tracked = new Map<WindowId, TrackedQuakeWindow>();
    private _wasVisible = false;
    private _kestrelLayer: Clutter.Actor | null = null;
    private _animClone: Clutter.Clone | null = null;
    private _animGeneration = 0;

    /** Set reference to the kestrel clone layer so quake actors can be raised above it. */
    setKestrelLayer(layer: Clutter.Actor): void {
        this._kestrelLayer = layer;
    }

    track(windowId: WindowId, metaWindow: Meta.Window): void {
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;
        if (!actor) return;
        this._tracked.set(windowId, { metaWindow, actor });
        metaWindow.make_above();
        metaWindow.minimize();
    }

    untrack(windowId: WindowId): void {
        const tracked = this._tracked.get(windowId);
        if (tracked) {
            try {
                tracked.metaWindow.unmake_above();
            } catch { /* window may already be destroyed */ }
        }
        this._tracked.delete(windowId);
    }

    isTracked(windowId: WindowId): boolean {
        return this._tracked.has(windowId);
    }

    /** Check if a Meta.WindowActor belongs to a tracked quake window. */
    isQuakeActor(actor: Meta.WindowActor): boolean {
        for (const tracked of this._tracked.values()) {
            if (tracked.actor === actor) return true;
        }
        return false;
    }

    applyQuakeScene(scene: QuakeWindowScene | null): void {
        if (scene?.visible) {
            this._wasVisible = this._showQuakeWindow(scene);
        } else if (this._wasVisible) {
            this._slideOutAll();
            this._wasVisible = false;
        }
    }

    private _showQuakeWindow(scene: QuakeWindowScene): boolean {
        const tracked = this._tracked.get(scene.windowId);
        if (!tracked) return false;

        // Hide any other quake window that was visible (switching slots)
        this._hideOtherQuakeWindows(scene.windowId);

        tracked.metaWindow.move_resize_frame(true, scene.x, scene.y, scene.width, scene.height);
        this._slideIn(tracked, scene);

        return true;
    }

    private _hideOtherQuakeWindows(activeWindowId: WindowId): void {
        for (const [id, tracked] of this._tracked.entries()) {
            if (id === activeWindowId || tracked.metaWindow.minimized) continue;
            tracked.metaWindow.minimize();
        }
    }

    /** Slide in using a clone for animation, then reveal the real window. */
    private _slideIn(tracked: TrackedQuakeWindow, scene: QuakeWindowScene): void {
        // Unminimize to make actor content available for cloning
        tracked.metaWindow.unminimize();
        tracked.actor.set_opacity(0);

        this._destroyAnimClone();
        const gen = ++this._animGeneration;
        const clone = this._createAnimClone(tracked.actor, scene);
        clone.set_opacity(0);
        clone.set_translation(0, -SLIDE_OFFSET, 0);

        (clone as unknown as Easeable).ease({
            opacity: 255,
            translation_y: 0,
            duration: ANIM_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._onSlideInComplete(tracked, gen),
        });
    }

    private _onSlideInComplete(tracked: TrackedQuakeWindow, gen: number): void {
        try {
            if (gen !== this._animGeneration) return;
            this._destroyAnimClone();
            this._raiseAboveKestrelLayer(tracked.actor);
            tracked.actor.set_opacity(255);
            Main.activateWindow(rawWindow(tracked.metaWindow));
        } catch { /* window may have been destroyed */ }
    }

    private _slideOutAll(): void {
        for (const tracked of this._tracked.values()) {
            if (tracked.metaWindow.minimized) continue;
            this._slideOut(tracked);
        }
    }

    /** Slide out using a clone for animation, then minimize the real window. */
    private _slideOut(tracked: TrackedQuakeWindow): void {
        const { metaWindow, actor } = tracked;
        const rect = metaWindow.get_frame_rect();

        this._lowerToWindowGroup(actor);
        actor.set_opacity(0);

        this._destroyAnimClone();
        const gen = ++this._animGeneration;
        const clone = this._createAnimCloneAt(actor, rect.x, rect.y, rect.width, rect.height);

        (clone as unknown as Easeable).ease({
            opacity: 0,
            translation_y: -SLIDE_OFFSET,
            duration: ANIM_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._onSlideOutComplete(metaWindow, gen),
        });
    }

    private _onSlideOutComplete(metaWindow: Meta.Window, gen: number): void {
        try {
            if (gen !== this._animGeneration) return;
            this._destroyAnimClone();
            metaWindow.minimize();
        } catch { /* window may have been destroyed */ }
    }

    /** Create an animation clone positioned from scene geometry. */
    private _createAnimClone(source: Meta.WindowActor, scene: QuakeWindowScene): Clutter.Clone {
        return this._createAnimCloneAt(source, scene.x, scene.y, scene.width, scene.height);
    }

    /** Create an animation clone at an absolute stage position. */
    private _createAnimCloneAt(source: Meta.WindowActor, x: number, y: number, width: number, height: number): Clutter.Clone {
        const clone = new Clutter.Clone({ source, width, height });
        clone.set_position(x, y);
        this._addAboveKestrelLayer(clone);
        this._animClone = clone;
        return clone;
    }

    private _destroyAnimClone(): void {
        if (!this._animClone) return;
        this._animClone.remove_all_transitions();
        this._animClone.destroy();
        this._animClone = null;
    }

    /** Add an actor to the stage above the kestrel layer. */
    private _addAboveKestrelLayer(actor: Clutter.Actor): void {
        if (!this._kestrelLayer) return;
        const stage = this._kestrelLayer.get_parent();
        if (!stage) return;
        stage.insert_child_above(actor, this._kestrelLayer);
    }

    /** Reparent WindowActor from window_group to stage, above the kestrel layer. */
    private _raiseAboveKestrelLayer(actor: Meta.WindowActor): void {
        if (!this._kestrelLayer) return;
        const stage = this._kestrelLayer.get_parent();
        if (!stage) return;
        // Remove from current parent if it's not already on the stage
        const currentParent = actor.get_parent();
        if (currentParent !== stage) {
            currentParent?.remove_child(actor);
            stage.insert_child_above(actor, this._kestrelLayer);
        } else {
            stage.set_child_above_sibling(actor, this._kestrelLayer);
        }
    }

    /** Return actor back to window_group. */
    private _lowerToWindowGroup(actor: Meta.WindowActor): void {
        const currentParent = actor.get_parent();
        if (currentParent === global.window_group) return;
        if (currentParent) {
            currentParent.remove_child(actor);
        }
        global.window_group.add_child(actor);
    }

    launchApp(appId: string): void {
        try {
            const appSystem = Shell.AppSystem.get_default();
            const app = appSystem.lookup_app(appId);
            if (app) {
                app.open_new_window(-1);
            } else {
                console.warn(`[Kestrel] Quake: app not found: ${appId}`);
            }
        } catch (e) {
            console.error(`[Kestrel] Quake: failed to launch ${appId}:`, e);
        }
    }

    matchWindowToSlot(metaWindow: Meta.Window, config: KestrelConfig): number | null {
        try {
            const app = Shell.WindowTracker.get_default().get_window_app(rawWindow(metaWindow));
            if (!app) return null;
            return this._findSlotForApp(app.get_id(), config);
        } catch (e) {
            console.error('[Kestrel] Quake: error matching window to slot:', e);
            return null;
        }
    }

    private _findSlotForApp(appId: string, config: KestrelConfig): number | null {
        for (let i = 0; i < config.quakeSlots.length; i++) {
            if (config.quakeSlots[i]?.appId === appId) return i;
        }
        return null;
    }

    /** Restore focus to the previously focused tiled window after quake dismissal. */
    restoreFocus(focusedWindowId: WindowId | null, focusInternal: (id: WindowId | null) => void): void {
        if (focusedWindowId) {
            focusInternal(focusedWindowId);
        }
    }

    destroy(): void {
        this._destroyAnimClone();
        for (const tracked of this._tracked.values()) {
            try {
                this._lowerToWindowGroup(tracked.actor);
                tracked.actor.set_opacity(255);
                tracked.metaWindow.unmake_above();
                if (tracked.metaWindow.minimized) {
                    tracked.metaWindow.unminimize();
                }
            } catch { /* window may already be destroyed */ }
        }
        this._tracked.clear();
        this._wasVisible = false;
        this._kestrelLayer = null;
    }
}
