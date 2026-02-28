import type { WindowId, WorkspaceId, LayoutState, KestrelConfig } from '../domain/types.js';
import type { ClonePort, OverviewTransform } from '../ports/clone-port.js';
import { safeDisconnect } from './signal-utils.js';
import { FloatCloneManager } from './float-clone-manager.js';
import { easeOrSet } from './animation-helpers.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Meta from 'gi://Meta';

// GJS adds ease() to Clutter.Actor at runtime, but @girs types don't include it
interface Easeable {
    ease(params: Record<string, unknown>): void;
}

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
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
/** Horizontal space reserved for workspace name label in overview mode */
const OVERVIEW_LABEL_WIDTH = 56;

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
    private _filterIndicator: St.BoxLayout | null = null;
    private _filteredPositionMap: Map<number, number> = new Map(); // real wsIndex → visual position
    private _renameEntry: St.Entry | null = null;
    private _renameKeyPressId: number = 0;
    private _renameCallback: ((name: string | null) => void) | null = null;
    private _renameWsIndex: number = -1;
    private _focusBorderWidth: number = 3;
    private _focusBorderColor: string = 'rgba(125,214,164,0.8)';
    private _focusBorderRadius: number = 8;
    private _focusBgColor: string = 'rgba(125,214,164,0.05)';

    init(workAreaY: number, monitorHeight: number, config?: KestrelConfig): void {
        this._workAreaY = workAreaY;
        this._monitorHeight = monitorHeight;
        if (config) this._applyConfig(config);
        this._createLayer(monitorHeight);
        this._floatCloneManager.init(this._layer!);
    }

    private _applyConfig(config: KestrelConfig): void {
        this._focusBorderWidth = config.focusBorderWidth;
        this._focusBorderColor = config.focusBorderColor;
        this._focusBorderRadius = config.focusBorderRadius;
        this._focusBgColor = config.focusBgColor;
    }

    private _createLayer(monitorHeight: number): void {
        this._layer = new Clutter.Actor({ name: 'kestrel-layer', clip_to_allocation: true });
        this._layer.set_position(0, this._workAreaY);
        this._layer.set_size(global.stage.width, monitorHeight);

        this._workspaceStrip = new Clutter.Actor({ name: 'kestrel-strip' });
        this._layer.add_child(this._workspaceStrip);

        this._focusIndicator = new St.Widget({
            name: 'kestrel-focus-indicator',
            style: this._buildFocusStyle(),
            visible: false,
            reactive: false,
        });
        this._layer.add_child(this._focusIndicator);

        const parent = global.window_group.get_parent()!;
        parent.insert_child_above(this._layer, global.window_group);
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
        return this._createWorkspaceContainer(wsId);
    }

    private _createWorkspaceContainer(wsId: WorkspaceId): WorkspaceContainer {
        const container = new Clutter.Actor({ name: `kestrel-ws-${wsId}` });
        container.set_size(global.stage.width, this._monitorHeight);

        const scrollContainer = new Clutter.Actor({ name: `kestrel-scroll-${wsId}` });
        container.add_child(scrollContainer);
        this._workspaceStrip!.add_child(container);

        const nameLabel = this._createWorkspaceLabel();
        container.add_child(nameLabel);

        const wc: WorkspaceContainer = { container, scrollContainer, nameLabel };
        this._workspaceContainers.set(wsId, wc);
        return wc;
    }

    private _createWorkspaceLabel(): St.Label {
        const nameLabel = new St.Label({
            text: '',
            style_class: 'kestrel-ws-label',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        nameLabel.rotation_angle_z = -90;
        nameLabel.set_position(4, this._monitorHeight / 2);
        return nameLabel;
    }

    addClone(windowId: WindowId, metaWindow: Meta.Window, workspaceId: WorkspaceId): void {
        const actor = metaWindow.get_compositor_private() as Meta.WindowActor | null;
        if (!actor || !this._workspaceStrip) return;

        const wc = this._getOrCreateWorkspaceContainer(workspaceId);
        const { wrapper, clone } = this._createCloneActors(windowId, actor);
        wc.scrollContainer.add_child(wrapper);

        const sizeChangedId = this._connectCloneSizeChanged(windowId, metaWindow);
        const entry = this._buildCloneEntry(
            wrapper, clone, metaWindow, actor, sizeChangedId, workspaceId,
        );
        this._clones.set(windowId, entry);
    }

    private _createCloneActors(windowId: WindowId, actor: Meta.WindowActor): { wrapper: Clutter.Actor; clone: Clutter.Clone } {
        const wrapper = new Clutter.Actor({
            name: `kestrel-clone-${windowId}`,
            reactive: false,
            clip_to_allocation: true,
        });
        const clone = new Clutter.Clone({ source: actor });
        wrapper.add_child(clone);
        return { wrapper, clone };
    }

    private _connectCloneSizeChanged(windowId: WindowId, metaWindow: Meta.Window): number {
        return metaWindow.connect('size-changed', () => {
            try {
                this._allocateClone(windowId);
                this._refreshFocusIndicatorForWindow(windowId);
            } catch (e) {
                console.error('[Kestrel] Error in size-changed handler:', e);
            }
        });
    }

    private _buildCloneEntry(
        wrapper: Clutter.Actor, clone: Clutter.Clone,
        metaWindow: Meta.Window, actor: Meta.WindowActor,
        sizeChangedId: number, workspaceId: WorkspaceId,
    ): CloneEntry {
        const entry: CloneEntry = {
            wrapper, clone, metaWindow, sourceActor: actor,
            sizeChangedId, sourceDestroyId: 0, sourceDestroyed: false,
            workspaceId, layoutWidth: 0, layoutHeight: 0,
        };
        entry.sourceDestroyId = actor.connect('destroy', () => {
            entry.sourceDestroyed = true;
        });
        return entry;
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

    private _hasValidDimensions(rect: Rect): boolean {
        return rect.width > 0 && rect.height > 0;
    }

    /**
     * Get frame and buffer rects for a clone entry, returning null if invalid.
     */
    private _getFrameAndBuffer(entry: CloneEntry): { frame: Rect; buffer: Rect } | null {
        let frame, buffer;
        try {
            frame = entry.metaWindow.get_frame_rect();
            buffer = entry.metaWindow.get_buffer_rect();
        } catch {
            return null;
        }

        if (!this._hasValidDimensions(frame) || !this._hasValidDimensions(buffer)) {
            return null;
        }

        return { frame, buffer };
    }

    /**
     * Compute clone offset: base offset to align frame with wrapper, plus
     * centering adjustment when frame exceeds layout target.
     */
    private _computeCloneOffset(
        frame: Rect, buffer: Rect,
        layoutWidth: number, layoutHeight: number,
    ): { offX: number; offY: number } {
        let offX = buffer.x - frame.x;
        let offY = buffer.y - frame.y;

        if (layoutWidth > 0 && frame.width > layoutWidth) {
            offX += Math.round((layoutWidth - frame.width) / 2);
        }
        if (layoutHeight > 0 && frame.height > layoutHeight) {
            offY += Math.round((layoutHeight - frame.height) / 2);
        }

        return { offX, offY };
    }

    /**
     * Wrapper size: use layout target if set, otherwise fall back to frame size.
     */
    private _wrapperSize(layoutDim: number, frameDim: number): number {
        return layoutDim > 0 ? layoutDim : frameDim;
    }

    /**
     * Allocate the inner clone's offset and size based on frame/buffer rects.
     */
    private _allocateClone(windowId: WindowId): void {
        const entry = this._clones.get(windowId);
        if (!entry || entry.sourceDestroyed) return;

        const rects = this._getFrameAndBuffer(entry);
        if (!rects) return;

        const { frame, buffer } = rects;
        const { offX, offY } = this._computeCloneOffset(frame, buffer, entry.layoutWidth, entry.layoutHeight);

        entry.clone.set_position(offX, offY);
        entry.clone.set_size(buffer.width, buffer.height);
        entry.wrapper.set_size(
            this._wrapperSize(entry.layoutWidth, frame.width),
            this._wrapperSize(entry.layoutHeight, frame.height),
        );
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

        this._animateWorkspaceStrip(layout, duration, easeMode);
        this._animateContainerPositions(duration, easeMode);
        this._animateScrollPositions(layout, duration, easeMode);
        this._animateCloneWrappers(layout, duration, easeMode);
        this._updateFocusIndicator(layout, duration, easeMode);
    }

    private _animateWorkspaceStrip(layout: LayoutState, duration: number, easeMode: Clutter.AnimationMode): void {
        if (this._workspaceStrip) {
            easeOrSet(this._workspaceStrip, { y: -layout.workspaceIndex * this._monitorHeight }, duration, easeMode);
        }
        if (this._workspaceOrder[layout.workspaceIndex]) {
            this._currentWorkspaceId = this._workspaceOrder[layout.workspaceIndex]!;
        }
    }

    private _animateContainerPositions(duration: number, easeMode: Clutter.AnimationMode): void {
        for (let i = 0; i < this._workspaceOrder.length; i++) {
            const wc = this._workspaceContainers.get(this._workspaceOrder[i]!);
            if (!wc) continue;
            easeOrSet(wc.container, { y: i * this._monitorHeight }, duration, easeMode);
        }
    }

    private _animateScrollPositions(layout: LayoutState, duration: number, easeMode: Clutter.AnimationMode): void {
        for (const wc of this._workspaceContainers.values()) {
            easeOrSet(wc.scrollContainer, { x: -layout.scrollX }, duration, easeMode);
        }
    }

    private _animateCloneWrappers(layout: LayoutState, duration: number, easeMode: Clutter.AnimationMode): void {
        for (const wl of layout.windows) {
            const entry = this._clones.get(wl.windowId);
            if (!entry) continue;

            entry.layoutWidth = wl.width;
            entry.layoutHeight = wl.height;
            this._allocateClone(wl.windowId);
            easeOrSet(entry.wrapper, { x: wl.x, y: wl.y }, duration, easeMode);
        }
    }

    private _updateFocusIndicator(layout: LayoutState, duration: number, easeMode: Clutter.AnimationMode): void {
        if (!this._focusIndicator) return;

        const rect = this._computeFocusRect(layout);
        if (!rect) {
            this._focusIndicator.visible = false;
            return;
        }

        this._focusIndicator.visible = true;
        easeOrSet(this._focusIndicator, rect, duration, easeMode);
    }

    private _computeFocusRect(layout: LayoutState): { x: number; y: number; width: number; height: number } | null {
        if (!layout.focusedWindowId) return null;

        const focusedLayout = layout.windows.find(w => w.windowId === layout.focusedWindowId);
        if (!focusedLayout) return null;

        return {
            x: focusedLayout.x - layout.scrollX - this._focusBorderWidth,
            y: focusedLayout.y - this._focusBorderWidth,
            width: focusedLayout.width + this._focusBorderWidth * 2,
            height: focusedLayout.height + this._focusBorderWidth * 2,
        };
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

        this._removeStaleWorkspaces(new Set(workspaces.map(ws => ws.id)));

        for (const ws of workspaces) {
            const wc = this._getOrCreateWorkspaceContainer(ws.id);
            wc.nameLabel.text = ws.name ?? '';
        }

        this._workspaceOrder = workspaces.map(ws => ws.id);
    }

    private _removeStaleWorkspaces(validIds: Set<WorkspaceId>): void {
        for (const [id, wc] of this._workspaceContainers) {
            if (!validIds.has(id)) {
                wc.container.destroy();
                this._workspaceContainers.delete(id);
            }
        }
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

    enterOverview(transform: OverviewTransform, layout: LayoutState, _numWorkspaces: number): void {
        if (!this._layer || !this._workspaceStrip) return;
        this._overviewActive = true;
        this._hideSourceActors();
        this._ensureOverviewBg();
        this._layer.set_clip(-1, -1, global.stage.width + 2, this._monitorHeight + 2);
        this._animateEnterStrip(transform);
        this._showWorkspaceLabels();
        this._updateOverviewFocus(layout, layout.workspaceIndex, transform);
    }

    private _hideSourceActors(): void {
        for (const entry of this._clones.values()) {
            if (!entry.sourceDestroyed) entry.sourceActor.visible = false;
        }
    }

    private _ensureOverviewBg(): void {
        if (!this._overviewBg) {
            this._overviewBg = new St.Widget({
                name: 'kestrel-overview-bg',
                style: `background-color: ${OVERVIEW_BG_COLOR};`,
                reactive: false,
                x: 0,
                y: 0,
                width: this._layer!.width,
                height: this._layer!.height,
            });
            this._layer!.insert_child_below(this._overviewBg, this._workspaceStrip!);
        }
        this._overviewBg.visible = true;
    }

    private _animateEnterStrip(transform: OverviewTransform): void {
        (this._workspaceStrip! as unknown as Easeable).ease({
            scale_x: transform.scale,
            scale_y: transform.scale,
            x: transform.offsetX,
            y: transform.offsetY,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    private _showWorkspaceLabels(): void {
        for (const wc of this._workspaceContainers.values()) {
            (wc.scrollContainer as unknown as Easeable).ease({
                x: OVERVIEW_LABEL_WIDTH,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            wc.nameLabel.visible = true;
        }
    }

    exitOverview(layout: LayoutState, animate: boolean = true): void {
        if (!this._layer || !this._workspaceStrip) return;
        this._overviewActive = false;

        this._cleanupOverviewState();

        const duration = animate ? ANIMATION_DURATION : 0;
        const easeMode = Clutter.AnimationMode.EASE_OUT_QUAD;
        const targetY = -layout.workspaceIndex * this._monitorHeight;

        this._animateExitStrip(targetY, duration, easeMode);
        this._layer.remove_clip();
        this._animateExitScroll(layout, duration, easeMode);
        this._updateFocusIndicator(layout, duration, easeMode);
    }

    private _cleanupOverviewState(): void {
        this._filteredPositionMap.clear();
        if (this._filterIndicator) {
            this._filterIndicator.visible = false;
        }
        this.cancelRename();
        for (const wc of this._workspaceContainers.values()) {
            wc.container.visible = true;
        }
        if (this._overviewBg) {
            this._overviewBg.visible = false;
        }
    }

    private _animateExitStrip(targetY: number, duration: number, easeMode: Clutter.AnimationMode): void {
        const showWindowActors = (): void => {
            for (const entry of this._clones.values()) {
                if (!entry.sourceDestroyed) entry.sourceActor.visible = true;
            }
        };
        easeOrSet(this._workspaceStrip!, { scale_x: 1, scale_y: 1, x: 0, y: targetY }, duration, easeMode, showWindowActors);
    }

    private _animateExitScroll(layout: LayoutState, duration: number, easeMode: Clutter.AnimationMode): void {
        for (const wc of this._workspaceContainers.values()) {
            easeOrSet(wc.scrollContainer, { x: -layout.scrollX }, duration, easeMode);
            wc.nameLabel.visible = false;
        }
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

        const focusedLayout = layout.windows.find(w => w.windowId === layout.focusedWindowId);
        if (!focusedLayout) {
            this._focusIndicator.visible = false;
            return;
        }

        this._focusIndicator.visible = true;
        const rect = this._computeOverviewFocusRect(focusedLayout, wsIndex, transform);
        (this._focusIndicator as unknown as Easeable).ease({
            ...rect,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    private _computeOverviewFocusRect(
        focusedLayout: { x: number; y: number; width: number; height: number },
        wsIndex: number,
        transform: OverviewTransform,
    ): { x: number; y: number; width: number; height: number } {
        const { scale, offsetX, offsetY } = transform;
        const visualPos = this._filteredPositionMap.size > 0
            ? (this._filteredPositionMap.get(wsIndex) ?? wsIndex)
            : wsIndex;
        return {
            x: (focusedLayout.x + OVERVIEW_LABEL_WIDTH) * scale + offsetX - this._focusBorderWidth,
            y: (visualPos * this._monitorHeight + focusedLayout.y) * scale + offsetY - this._focusBorderWidth,
            width: focusedLayout.width * scale + this._focusBorderWidth * 2,
            height: focusedLayout.height * scale + this._focusBorderWidth * 2,
        };
    }

    getLayer(): Clutter.Actor | null {
        return this._layer;
    }

    applyOverviewFilter(
        visibleIndices: number[] | null,
        transform: OverviewTransform,
        _currentWsIndex: number,
    ): void {
        if (!this._workspaceStrip || !this._layer) return;

        this._filteredPositionMap.clear();

        if (visibleIndices === null) {
            this._clearOverviewFilter(transform);
            return;
        }

        this._positionFilteredWorkspaces(visibleIndices, transform);
    }

    private _clearOverviewFilter(transform: OverviewTransform): void {
        for (let i = 0; i < this._workspaceOrder.length; i++) {
            const wc = this._workspaceContainers.get(this._workspaceOrder[i]!);
            if (!wc) continue;
            wc.container.visible = true;
            (wc.container as unknown as Easeable).ease({
                y: i * this._monitorHeight,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
        this._easeStripToTransform(transform);
    }

    private _positionFilteredWorkspaces(visibleIndices: number[], transform: OverviewTransform): void {
        const visibleSet = new Set(visibleIndices);

        this._hideNonMatchingWorkspaces(visibleSet);

        for (let visualPos = 0; visualPos < visibleIndices.length; visualPos++) {
            const wsIndex = visibleIndices[visualPos]!;
            const wc = this._workspaceContainers.get(this._workspaceOrder[wsIndex]!);
            if (!wc) continue;

            wc.container.visible = true;
            this._filteredPositionMap.set(wsIndex, visualPos);
            (wc.container as unknown as Easeable).ease({
                y: visualPos * this._monitorHeight,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        this._easeStripToTransform(transform);
    }

    private _hideNonMatchingWorkspaces(visibleSet: Set<number>): void {
        for (let i = 0; i < this._workspaceOrder.length; i++) {
            if (!visibleSet.has(i)) {
                const wc = this._workspaceContainers.get(this._workspaceOrder[i]!);
                if (wc) wc.container.visible = false;
            }
        }
    }

    private _easeStripToTransform(transform: OverviewTransform): void {
        (this._workspaceStrip! as unknown as Easeable).ease({
            scale_x: transform.scale,
            scale_y: transform.scale,
            x: transform.offsetX,
            y: transform.offsetY,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    updateFilterIndicator(text: string): void {
        if (!this._layer) return;

        if (!text || text.length === 0) {
            this._hideFilterIndicator();
            return;
        }

        this._ensureFilterIndicator();
        this._updateFilterText(text);
        this._positionFilterIndicator();
    }

    private _hideFilterIndicator(): void {
        if (this._filterIndicator) this._filterIndicator.visible = false;
    }

    private _ensureFilterIndicator(): void {
        if (!this._filterIndicator) this._createFilterIndicator();
        this._filterIndicator!.visible = true;
    }

    private _updateFilterText(text: string): void {
        const textLabel = this._filterIndicator!.get_child_at_index(1) as St.Label;
        if (textLabel) textLabel.text = text;
    }

    private _createFilterIndicator(): void {
        this._filterIndicator = new St.BoxLayout({
            name: 'kestrel-filter-indicator',
            style: 'background-color: rgba(0,0,0,0.8); border-radius: 20px; padding: 8px 16px; color: white;',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.START,
        });

        const icon = new St.Label({ text: '\u{1F50D} ', style: 'font-size: 14px;' });
        this._filterIndicator.add_child(icon);

        const label = new St.Label({ name: 'kestrel-filter-text', text: '', style: 'font-size: 14px;' });
        this._filterIndicator.add_child(label);

        this._layer!.add_child(this._filterIndicator);
    }

    private _positionFilterIndicator(): void {
        this._filterIndicator!.set_position(
            Math.round((this._layer!.width - this._filterIndicator!.width) / 2),
            12,
        );
    }

    startRename(
        wsIndex: number,
        currentName: string,
        transform: OverviewTransform,
        callback: (name: string | null) => void,
    ): void {
        if (!this._layer) return;
        this.cancelRename();

        this._renameCallback = callback;
        this._renameWsIndex = wsIndex;

        const wsId = this._workspaceOrder[wsIndex];
        if (!wsId) return;
        const wc = this._workspaceContainers.get(wsId);
        if (!wc) return;

        wc.nameLabel.visible = false;
        this._createRenameEntry(currentName, transform, wsIndex);
        this._connectRenameKeypress(wsIndex);
        this._renameEntry!.grab_key_focus();
    }

    private _createRenameEntry(currentName: string, transform: OverviewTransform, wsIndex: number): void {
        this._renameEntry = new St.Entry({
            name: 'kestrel-rename-entry',
            text: currentName,
            style: 'font-size: 14px; background-color: rgba(0,0,0,0.9); color: white; border: 2px solid rgba(125,214,164,0.8); border-radius: 6px; padding: 4px 8px; min-width: 200px;',
        });

        const visualPos = this._filteredPositionMap.get(wsIndex) ?? wsIndex;
        const containerY = visualPos * this._monitorHeight;
        const entryX = transform.offsetX + 8;
        const entryY = transform.offsetY + containerY * transform.scale + (this._monitorHeight * transform.scale) / 2 - 12;

        this._renameEntry.set_position(entryX, entryY);
        this._layer!.add_child(this._renameEntry);

        const clutterText = this._renameEntry.get_clutter_text();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (clutterText as any).set_selection(0, currentName.length);
    }

    private _connectRenameKeypress(wsIndex: number): void {
        const clutterText = this._renameEntry!.get_clutter_text();
        this._renameKeyPressId = clutterText.connect('key-press-event',
            (_actor: Clutter.Actor, event: Clutter.Event) => {
                return this._handleRenameKey(event, wsIndex);
            },
        );
    }

    private _handleRenameKey(event: Clutter.Event, wsIndex: number): boolean {
        try {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
                this._finishRename(this._renameEntry!.get_text(), wsIndex);
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Escape) {
                this._finishRename(null, wsIndex);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        } catch (e) {
            console.error('[Kestrel] Error in rename key handler:', e);
            return Clutter.EVENT_PROPAGATE;
        }
    }

    cancelRename(): void {
        if (!this._renameEntry) return;
        this._finishRename(null, this._renameWsIndex);
    }

    private _finishRename(name: string | null, wsIndex: number): void {
        this._cleanupRenameEntry();
        this._restoreNameLabel(wsIndex);

        const cb = this._renameCallback;
        this._renameCallback = null;
        this._renameWsIndex = -1;
        cb?.(name);
    }

    private _cleanupRenameEntry(): void {
        if (!this._renameEntry) return;
        if (this._renameKeyPressId) {
            const clutterText = this._renameEntry.get_clutter_text();
            clutterText.disconnect(this._renameKeyPressId);
            this._renameKeyPressId = 0;
        }
        this._renameEntry.destroy();
        this._renameEntry = null;
    }

    private _restoreNameLabel(wsIndex: number): void {
        const wsId = this._workspaceOrder[wsIndex];
        if (!wsId) return;
        const wc = this._workspaceContainers.get(wsId);
        if (wc) wc.nameLabel.visible = true;
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
        this._stopAllTransitions();
        this._disconnectAllClones();
        this._floatCloneManager.destroy();
        this._destroyOverviewWidgets();

        if (this._layer) {
            this._layer.destroy();
            this._layer = null;
            this._workspaceStrip = null;
            this._workspaceContainers.clear();
            this._workspaceOrder = [];
        }
    }

    private _stopAllTransitions(): void {
        for (const wc of this._workspaceContainers.values()) {
            wc.scrollContainer.remove_all_transitions();
            wc.container.remove_all_transitions();
        }
        this._focusIndicator?.remove_all_transitions();
        this._workspaceStrip?.remove_all_transitions();
    }

    private _disconnectAllClones(): void {
        for (const entry of this._clones.values()) {
            entry.wrapper.remove_all_transitions();
            safeDisconnect(entry.metaWindow, entry.sizeChangedId);
            if (!entry.sourceDestroyed) {
                entry.sourceActor.disconnect(entry.sourceDestroyId);
                entry.sourceActor.visible = true;
            }
        }
        this._clones.clear();
    }

    private _destroyOverviewWidgets(): void {
        if (this._overviewBg) {
            this._overviewBg.destroy();
            this._overviewBg = null;
        }
        this.cancelRename();
        if (this._filterIndicator) {
            this._filterIndicator.destroy();
            this._filterIndicator = null;
        }
        this._filteredPositionMap.clear();
    }
}
