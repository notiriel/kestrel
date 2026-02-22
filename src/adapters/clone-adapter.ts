import type { WindowId, WorkspaceId, LayoutState, KestrelConfig } from '../domain/types.js';
import type { ClonePort, OverviewTransform } from '../ports/clone-port.js';
import { safeDisconnect } from './signal-utils.js';
import { FloatCloneManager } from './float-clone-manager.js';
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

interface WorkspaceContainer {
    container: Clutter.Actor;
    scrollContainer: Clutter.Actor;
    nameLabel: St.Label;
}

const ANIMATION_DURATION = 250;
const OVERVIEW_BG_COLOR = 'rgba(0,0,0,0.7)';

export type { OverviewTransform };

export class CloneAdapter implements ClonePort {
    private _layer: Clutter.Actor | null = null;
    private _workspaceStrip: Clutter.Actor | null = null;
    private _focusIndicator: St.Widget | null = null;
    private _workspaceContainers: Map<WorkspaceId, WorkspaceContainer> = new Map();
    /** Ordered list of workspace IDs matching domain workspace indices. */
    private _workspaceOrder: WorkspaceId[] = [];
    private _clones: Map<WindowId, CloneEntry> = new Map();
    private _floatCloneManager: FloatCloneManager = new FloatCloneManager();
    private _workAreaY: number = 0;
    private _monitorHeight: number = 0;
    private _currentWorkspaceId: WorkspaceId | null = null;
    private _lastLayout: LayoutState | null = null;
    private _overviewActive: boolean = false;
    private _overviewBg: St.Widget | null = null;
    private _focusBorderWidth: number = 3;
    private _focusBorderColor: string = 'rgba(255,255,255,0.8)';
    private _focusBorderRadius: number = 8;
    private _focusBgColor: string = 'rgba(255,255,255,0.05)';

    init(workAreaY: number, monitorHeight: number, config?: KestrelConfig): void {
        this._workAreaY = workAreaY;
        this._monitorHeight = monitorHeight;

        if (config) {
            this._focusBorderWidth = config.focusBorderWidth;
            this._focusBorderColor = config.focusBorderColor;
            this._focusBorderRadius = config.focusBorderRadius;
            this._focusBgColor = config.focusBgColor;
        }

        this._layer = new Clutter.Actor({
            name: 'kestrel-layer',
            clip_to_allocation: true,
        });

        // Size the layer to match the monitor so clipping works
        const parent = global.window_group.get_parent()!;
        const stage = global.stage;
        this._layer.set_position(0, this._workAreaY);
        this._layer.set_size(stage.width, monitorHeight);

        this._workspaceStrip = new Clutter.Actor({ name: 'kestrel-strip' });
        this._layer.add_child(this._workspaceStrip);

        this._focusIndicator = new St.Widget({
            name: 'kestrel-focus-indicator',
            style: this._buildFocusStyle(),
            visible: false,
            reactive: false,
        });
        this._layer.add_child(this._focusIndicator);

        parent.insert_child_above(this._layer, global.window_group);

        this._floatCloneManager.init(this._layer);
    }

    updateConfig(config: KestrelConfig): void {
        this._focusBorderWidth = config.focusBorderWidth;
        this._focusBorderColor = config.focusBorderColor;
        this._focusBorderRadius = config.focusBorderRadius;
        this._focusBgColor = config.focusBgColor;
        if (this._focusIndicator) {
            this._focusIndicator.style = this._buildFocusStyle();
        }
        if (this._lastLayout) {
            this._updateFocusIndicator(this._lastLayout, 0, Clutter.AnimationMode.EASE_OUT_QUAD);
        }
    }

    private _buildFocusStyle(): string {
        return `border: ${this._focusBorderWidth}px solid ${this._focusBorderColor}; border-radius: ${this._focusBorderRadius}px; background-color: ${this._focusBgColor};`;
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
            name: `kestrel-ws-${wsId}`,
        });
        container.set_size(global.stage.width, this._monitorHeight);

        const scrollContainer = new Clutter.Actor({
            name: `kestrel-scroll-${wsId}`,
        });
        container.add_child(scrollContainer);

        this._workspaceStrip!.add_child(container);

        const nameLabel = new St.Label({
            text: '',
            style_class: 'kestrel-ws-label',
            y_align: Clutter.ActorAlign.START,
            visible: false,
        });
        nameLabel.rotation_angle_z = -90;
        // Position label at left edge; rotated -90 means text reads bottom-to-top
        nameLabel.set_position(4, 120);
        container.add_child(nameLabel);

        const wc: WorkspaceContainer = { container, scrollContainer, nameLabel };
        this._workspaceContainers.set(wsId, wc);
        return wc;
    }

    addClone(windowId: WindowId, metaWindow: Meta.Window, workspaceId: WorkspaceId): void {
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;
        if (!actor || !this._workspaceStrip) return;

        const wc = this._getOrCreateWorkspaceContainer(workspaceId);

        const wrapper = new Clutter.Actor({
            name: `kestrel-clone-${windowId}`,
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
                console.error('[Kestrel] Error in size-changed handler:', e);
            }
        });

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

        safeDisconnect(entry.metaWindow, entry.sizeChangedId);
        if (!entry.sourceDestroyed) {
            entry.sourceActor.disconnect(entry.sourceDestroyId);
        }

        entry.wrapper.destroy();
    }

    // --- Float clone delegation ---

    addFloatClone(windowId: WindowId, metaWindow: Meta.Window): void {
        this._floatCloneManager.addFloatClone(windowId, metaWindow);
    }

    removeFloatClone(windowId: WindowId): void {
        this._floatCloneManager.removeFloatClone(windowId);
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
     * Hide or show a clone wrapper when its window enters/exits fullscreen.
     */
    setWindowFullscreen(windowId: WindowId, isFullscreen: boolean): void {
        const entry = this._clones.get(windowId);
        if (!entry) return;
        entry.wrapper.visible = !isFullscreen;
    }

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

        // Scroll ALL workspace containers to the same scrollX
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
        const x = focusedLayout.x - layout.scrollX - this._focusBorderWidth;
        const y = focusedLayout.y - this._focusBorderWidth;
        const width = focusedLayout.width + this._focusBorderWidth * 2;
        const height = focusedLayout.height + this._focusBorderWidth * 2;

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
     */
    private _refreshFocusIndicatorForWindow(windowId: WindowId): void {
        if (!this._lastLayout || this._lastLayout.focusedWindowId !== windowId) return;
        this._updateFocusIndicator(this._lastLayout, 0, Clutter.AnimationMode.EASE_OUT_QUAD);
    }

    setScroll(scrollX: number): void {
        if (!this._currentWorkspaceId) return;
        const wc = this._workspaceContainers.get(this._currentWorkspaceId);
        wc?.scrollContainer.set_position(-scrollX, 0);
    }

    setScrollForWorkspace(wsId: WorkspaceId, scrollX: number): void {
        const wc = this._workspaceContainers.get(wsId);
        if (!wc) return;
        wc.scrollContainer.set_position(-scrollX, 0);
    }

    syncWorkspaces(workspaces: readonly { readonly id: WorkspaceId; readonly name?: string | null }[]): void {
        if (!this._workspaceStrip) return;

        const validIds = new Set(workspaces.map(ws => ws.id));

        for (const [id, wc] of this._workspaceContainers) {
            if (!validIds.has(id)) {
                wc.container.destroy();
                this._workspaceContainers.delete(id);
            }
        }

        for (const ws of workspaces) {
            const wc = this._getOrCreateWorkspaceContainer(ws.id);
            wc.nameLabel.text = ws.name ?? '';
        }

        this._workspaceOrder = workspaces.map(ws => ws.id);
    }

    updateWorkspaceName(wsId: WorkspaceId, name: string | null): void {
        const wc = this._workspaceContainers.get(wsId);
        if (!wc) return;
        wc.nameLabel.text = name ?? '';
    }

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

    enterOverview(transform: OverviewTransform, layout: LayoutState, numWorkspaces: number): void {
        if (!this._layer || !this._workspaceStrip) return;
        this._overviewActive = true;

        if (!this._overviewBg) {
            this._overviewBg = new St.Widget({
                name: 'kestrel-overview-bg',
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

        this._layer.set_clip(-1, -1, global.stage.width + 2, this._monitorHeight + 2);

        const stripY = transform.offsetY;
        (this._workspaceStrip as unknown as Easeable).ease({
            scale_x: transform.scale,
            scale_y: transform.scale,
            x: transform.offsetX,
            y: stripY,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        for (const wc of this._workspaceContainers.values()) {
            (wc.scrollContainer as unknown as Easeable).ease({
                x: 0,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            wc.nameLabel.visible = true;
        }

        this._updateOverviewFocus(layout, layout.workspaceIndex, transform);
    }

    exitOverview(layout: LayoutState): void {
        if (!this._layer || !this._workspaceStrip) return;
        this._overviewActive = false;

        if (this._overviewBg) {
            this._overviewBg.visible = false;
        }

        const targetY = -layout.workspaceIndex * this._monitorHeight;
        (this._workspaceStrip as unknown as Easeable).ease({
            scale_x: 1,
            scale_y: 1,
            x: 0,
            y: targetY,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._layer.remove_clip();

        for (const wc of this._workspaceContainers.values()) {
            (wc.scrollContainer as unknown as Easeable).ease({
                x: -layout.scrollX,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            wc.nameLabel.visible = false;
        }

        this._updateFocusIndicator(layout, ANIMATION_DURATION, Clutter.AnimationMode.EASE_OUT_QUAD);
    }

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
        const x = focusedLayout.x * scale + offsetX - this._focusBorderWidth;
        const y = (wsIndex * this._monitorHeight + focusedLayout.y) * scale + offsetY - this._focusBorderWidth;
        const width = focusedLayout.width * scale + this._focusBorderWidth * 2;
        const height = focusedLayout.height * scale + this._focusBorderWidth * 2;

        (this._focusIndicator as unknown as Easeable).ease({
            x, y, width, height,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    getLayer(): Clutter.Actor | null {
        return this._layer;
    }

    getClonePositions(): Map<WindowId, { x: number; y: number; width: number; height: number; wsIndex: number }> {
        const positions = new Map<WindowId, { x: number; y: number; width: number; height: number; wsIndex: number }>();
        for (const [windowId, entry] of this._clones) {
            const wsIndex = this._workspaceOrder.indexOf(entry.workspaceId);
            if (wsIndex < 0) continue;
            positions.set(windowId, {
                x: entry.wrapper.x,
                y: entry.wrapper.y,
                width: entry.wrapper.width,
                height: entry.wrapper.height,
                wsIndex,
            });
        }
        return positions;
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
            safeDisconnect(entry.metaWindow, entry.sizeChangedId);
            if (!entry.sourceDestroyed) {
                entry.sourceActor.disconnect(entry.sourceDestroyId);
            }
        }
        this._clones.clear();

        this._floatCloneManager.destroy();

        if (this._overviewBg) {
            this._overviewBg.destroy();
            this._overviewBg = null;
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
