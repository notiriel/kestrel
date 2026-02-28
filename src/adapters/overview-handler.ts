import type { WindowId, LayoutState, WorldUpdate } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { setFocus, filterWorkspaces, renameCurrentWorkspace, switchToWorkspace } from '../domain/world.js';
import { focusRight, focusLeft, focusDown, focusUp } from '../domain/navigation.js';
import { moveLeft, moveRight } from '../domain/window-operations.js';
import { enterOverview, exitOverview, cancelOverview } from '../domain/overview.js';
import { computeLayoutForWorkspace } from '../domain/layout.js';
import type { OverviewRenderPort, CloneRenderPort, OverviewTransform, OverviewFilterPort, CloneLifecyclePort } from '../ports/clone-port.js';
import type { WindowPort } from '../ports/window-port.js';
import type { OverviewInputAdapter } from './overview-input-adapter.js';

export interface OverviewDeps {
    getWorld(): World | null;
    setWorld(world: World): void;
    focusWindow(windowId: WindowId | null): void;
    getCloneAdapter(): (OverviewRenderPort & CloneRenderPort & Partial<OverviewFilterPort> & Pick<CloneLifecyclePort, 'syncWorkspaces'>) | null;
    getWindowAdapter(): WindowPort | null;
    createOverviewInputAdapter(): OverviewInputAdapter;
    notifyOverviewEnter?(transform: OverviewTransform): void;
    notifyOverviewExit?(): void;
    onOverviewEnter?(): void;
    onOverviewExit?(): void;
}

export class OverviewHandler {
    private _deps: OverviewDeps;
    private _preOverviewState: { focusedWindow: WindowId | null; viewport: { workspaceIndex: number; scrollX: number } } | null = null;
    private _overviewTransform: OverviewTransform | null = null;
    private _overviewInputAdapter: OverviewInputAdapter | null = null;

    // Drag state
    private _dragSubject: WindowId | null = null;
    private _preDragWorld: World | null = null;

    // Filter state
    private _filterText: string = '';
    private _filteredIndices: number[] = []; // workspace indices sorted by score
    private _renameActive: boolean = false;

    constructor(deps: OverviewDeps) {
        this._deps = deps;
    }

    get isActive(): boolean {
        return this._overviewTransform !== null;
    }

    handleToggle(): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;

            if (world.overviewActive) {
                this.handleConfirm();
            } else {
                this._enter();
            }
        } catch (e) {
            console.error('[Kestrel] Error handling toggle overview:', e);
        }
    }

    private _enter(): void {
        const world = this._deps.getWorld();
        if (!world) return;

        this._savePreOverviewState(world);
        const update = enterOverview(world);
        this._deps.setWorld(update.world);

        const numWs = this._countNonEmpty(update.world);
        this._overviewTransform = this._computeTransform(update.world, numWs);
        this._notifyEnter(this._overviewTransform, update.layout, numWs);

        this._resetFilterState();
        this._activateOverviewInput();
    }

    private _countNonEmpty(world: World): number {
        return world.workspaces.filter(ws => ws.windows.length > 0).length || 1;
    }

    private _notifyEnter(transform: OverviewTransform, layout: LayoutState, numWs: number): void {
        this._deps.getCloneAdapter()?.enterOverview(transform, layout, numWs);
        this._deps.notifyOverviewEnter?.(transform);
        this._deps.onOverviewEnter?.();
    }

    private _savePreOverviewState(world: World): void {
        this._preOverviewState = {
            focusedWindow: world.focusedWindow,
            viewport: {
                workspaceIndex: world.viewport.workspaceIndex,
                scrollX: world.viewport.scrollX,
            },
        };
    }

    private _resetFilterState(): void {
        this._filterText = '';
        this._filteredIndices = [];
        this._renameActive = false;
    }

    private _activateOverviewInput(): void {
        this._overviewInputAdapter = this._deps.createOverviewInputAdapter();
        this._overviewInputAdapter.activate({
            onNavigate: (dir) => this._handleNavigate(dir),
            onConfirm: () => this.handleConfirm(),
            onCancel: () => this.handleCancel(),
            onClick: (x, y) => this._handleClick(x, y),
            onDragStart: (x, y) => this._handleDragStart(x, y),
            onDragMove: (x, y) => this._handleDragMove(x, y),
            onDragEnd: (x, y) => this._handleDragEnd(x, y),
            onTextInput: (text) => this._handleTextInput(text),
            onBackspace: () => this._handleBackspace(),
            onRename: () => this._handleRename(),
        });
    }

    private _handleNavigate(direction: 'left' | 'right' | 'up' | 'down'): void {
        try {
            const world = this._deps.getWorld();
            if (!world || !this._overviewTransform) return;

            if (this._navigateFilteredVertical(world, direction)) return;
            this._navigateStandard(world, direction);
        } catch (e) {
            console.error('[Kestrel] Error handling overview navigate:', e);
        }
    }

    private _navigateStandard(world: World, direction: string): void {
        const navFns: Record<string, (w: World) => WorldUpdate> = {
            left: focusLeft, right: focusRight, up: focusUp, down: focusDown,
        };
        const update = navFns[direction]!(world);
        this._deps.setWorld(update.world);
        this._renderOverviewUpdate(update);
    }

    private _navigateFilteredVertical(world: World, direction: string): boolean {
        if (this._filteredIndices.length === 0) return false;
        if (direction !== 'up' && direction !== 'down') return false;

        const currentWsIndex = world.viewport.workspaceIndex;
        const currentPos = this._filteredIndices.indexOf(currentWsIndex);
        const targetPos = this._computeFilteredTarget(currentPos, direction);

        const targetWsIndex = this._filteredIndices[targetPos]!;
        if (targetWsIndex !== currentWsIndex) {
            this._switchToFilteredWorkspace(world, targetWsIndex);
        }
        return true;
    }

    private _computeFilteredTarget(currentPos: number, direction: string): number {
        if (direction === 'up') {
            return currentPos <= 0
                ? this._filteredIndices.length - 1
                : currentPos - 1;
        }
        return currentPos >= this._filteredIndices.length - 1
            ? 0
            : currentPos + 1;
    }

    private _switchToFilteredWorkspace(world: World, targetWsIndex: number): void {
        const update = switchToWorkspace(world, targetWsIndex);
        const overviewWorld = { ...update.world, overviewActive: true };
        this._deps.setWorld(overviewWorld);

        const layout = computeLayoutForWorkspace(overviewWorld, targetWsIndex);
        this._deps.getCloneAdapter()?.updateOverviewFocus(
            layout, targetWsIndex, this._overviewTransform!,
        );
    }

    handleConfirm(animate: boolean = true): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;

            this._dragSubject = null;
            this._preDragWorld = null;
            this._clearFilter();

            const update = exitOverview(world);
            this._deps.setWorld(update.world);
            this._exitVisual(update.layout, animate);
        } catch (e) {
            console.error('[Kestrel] Error handling overview confirm:', e);
        }
    }

    handleCancel(): void {
        try {
            this._handleCancelInner();
        } catch (e) {
            console.error('[Kestrel] Error handling overview cancel:', e);
        }
    }

    private _handleCancelInner(): void {
        const world = this._deps.getWorld();
        if (!world) return;

        if (this._cancelRename()) return;
        if (this._cancelFilter()) return;
        if (this._cancelDrag()) return;
        this._cancelNormal(world);
    }

    private _cancelRename(): boolean {
        if (!this._renameActive) return false;
        this._renameActive = false;
        this._overviewInputAdapter?.setKeyPassthrough(false);
        this._deps.getCloneAdapter()?.cancelRename?.();
        return true;
    }

    private _cancelFilter(): boolean {
        if (this._filterText.length === 0) return false;
        this._filterText = '';
        this._filteredIndices = [];
        this._applyFilter();
        return true;
    }

    private _cancelDrag(): boolean {
        if (this._dragSubject === null || !this._preDragWorld) return false;
        const revertWorld = this._preDragWorld;
        this._dragSubject = null;
        this._preDragWorld = null;
        this._deps.setWorld(revertWorld);
        this._renderDragRevert(revertWorld);
        return true;
    }

    private _renderDragRevert(revertWorld: World): void {
        if (!this._overviewTransform) return;
        const wsIndex = revertWorld.viewport.workspaceIndex;
        const layout = computeLayoutForWorkspace(revertWorld, wsIndex);
        this._deps.getCloneAdapter()?.updateOverviewFocus(
            layout, wsIndex, this._overviewTransform,
        );
    }

    private _cancelNormal(world: World): void {
        if (!this._preOverviewState) return;
        const update = cancelOverview(
            world,
            this._preOverviewState.focusedWindow,
            this._preOverviewState.viewport.workspaceIndex,
            this._preOverviewState.viewport.scrollX,
        );
        this._deps.setWorld(update.world);
        this._exitVisual(update.layout);
    }

    private _handleClick(x: number, y: number): void {
        try {
            const world = this._deps.getWorld();
            if (!world || !this._overviewTransform) return;

            const hitWindowId = this._hitTest(world, x, y);
            if (!hitWindowId) return;

            const update = setFocus(world, hitWindowId);
            this._deps.setWorld(update.world);
            this.handleConfirm();
        } catch (e) {
            console.error('[Kestrel] Error handling overview click:', e);
        }
    }

    private _handleDragStart(x: number, y: number): void {
        try {
            const world = this._deps.getWorld();
            if (!world || !this._overviewTransform) return;

            const hitWindowId = this._hitTest(world, x, y);
            if (!hitWindowId) return;

            this._initDrag(world, hitWindowId);
        } catch (e) {
            console.error('[Kestrel] Error handling drag start:', e);
        }
    }

    private _initDrag(world: World, hitWindowId: WindowId): void {
        this._dragSubject = hitWindowId;
        this._preDragWorld = world;
        const update = setFocus(world, hitWindowId);
        this._deps.setWorld(update.world);
        this._renderOverviewUpdate(update);
    }

    private _handleDragMove(x: number, _y: number): void {
        try {
            const world = this._deps.getWorld();
            if (!world || !this._overviewTransform || !this._dragSubject) return;

            const reverseX = this._reverseMapX(x);
            this._checkDragSwap(world, reverseX);
        } catch (e) {
            console.error('[Kestrel] Error handling drag move:', e);
        }
    }

    private _reverseMapX(x: number): number {
        const { scale, offsetX } = this._overviewTransform!;
        const OVERVIEW_LABEL_WIDTH = 56;
        return (x - offsetX) / scale - OVERVIEW_LABEL_WIDTH;
    }

    private _checkDragSwap(world: World, reverseX: number): void {
        const wsIndex = world.viewport.workspaceIndex;
        const wsLayout = computeLayoutForWorkspace(world, wsIndex);
        const subjectLayout = wsLayout.windows.find(w => w.windowId === this._dragSubject);
        if (!subjectLayout) return;

        const idx = wsLayout.windows.indexOf(subjectLayout);
        if (this._checkSwapRight(world, wsLayout, idx, reverseX)) return;
        this._checkSwapLeft(world, wsLayout, idx, reverseX);
    }

    private _checkSwapRight(world: World, wsLayout: LayoutState, idx: number, reverseX: number): boolean {
        if (idx >= wsLayout.windows.length - 1) return false;
        const neighbor = wsLayout.windows[idx + 1];
        if (reverseX <= neighbor.x + neighbor.width / 2) return false;
        const update = moveRight(world);
        this._deps.setWorld(update.world);
        this._renderOverviewUpdate(update);
        return true;
    }

    private _checkSwapLeft(world: World, wsLayout: LayoutState, idx: number, reverseX: number): boolean {
        if (idx <= 0) return false;
        const neighbor = wsLayout.windows[idx - 1];
        if (reverseX >= neighbor.x + neighbor.width / 2) return false;
        const update = moveLeft(world);
        this._deps.setWorld(update.world);
        this._renderOverviewUpdate(update);
        return true;
    }

    private _handleDragEnd(_x: number, _y: number): void {
        try {
            this._dragSubject = null;
            this._preDragWorld = null;
            this.handleConfirm(false);
        } catch (e) {
            console.error('[Kestrel] Error handling drag end:', e);
        }
    }

    private _hitTest(world: World, x: number, y: number): WindowId | null {
        if (!this._overviewTransform) return null;
        const { scale, offsetX, offsetY } = this._overviewTransform;

        const OVERVIEW_LABEL_WIDTH = 56;
        const reverseX = (x - offsetX) / scale - OVERVIEW_LABEL_WIDTH;
        const reverseY = (y - offsetY) / scale;
        const visualSlot = Math.floor(reverseY / world.monitor.totalHeight);

        const realWsIndex = this._resolveWorkspaceIndex(world, visualSlot);
        if (realWsIndex === null) return null;

        const localY = reverseY - visualSlot * world.monitor.totalHeight;
        return this._hitTestWindows(world, realWsIndex, reverseX, localY);
    }

    private _resolveWorkspaceIndex(world: World, visualSlot: number): number | null {
        if (this._filteredIndices.length > 0) {
            return this._resolveFilteredSlot(visualSlot);
        }
        return this._resolveUnfilteredSlot(world, visualSlot);
    }

    private _resolveFilteredSlot(visualSlot: number): number | null {
        if (visualSlot < 0 || visualSlot >= this._filteredIndices.length) return null;
        return this._filteredIndices[visualSlot]!;
    }

    private _resolveUnfilteredSlot(world: World, visualSlot: number): number | null {
        const count = world.workspaces.filter(ws => ws.windows.length > 0).length;
        if (visualSlot < 0 || visualSlot >= count) return null;
        return visualSlot;
    }

    private _hitTestWindows(world: World, wsIndex: number, rx: number, localY: number): WindowId | null {
        const wsLayout = computeLayoutForWorkspace(world, wsIndex);
        for (const win of wsLayout.windows) {
            if (this._isInsideWindow(win, rx, localY)) return win.windowId;
        }
        return null;
    }

    private _isInsideWindow(win: { x: number; y: number; width: number; height: number }, rx: number, localY: number): boolean {
        return rx >= win.x && rx <= win.x + win.width &&
            localY >= win.y && localY <= win.y + win.height;
    }

    private _renderOverviewUpdate(update: WorldUpdate): void {
        if (!this._overviewTransform) return;
        this._deps.getCloneAdapter()?.updateOverviewFocus(
            update.layout,
            update.world.viewport.workspaceIndex,
            this._overviewTransform,
        );
    }

    private _handleTextInput(text: string): void {
        try {
            if (this._renameActive) return;
            this._filterText += text;
            this._applyFilter();
        } catch (e) {
            console.error('[Kestrel] Error handling text input:', e);
        }
    }

    private _handleBackspace(): void {
        try {
            if (this._renameActive) return;
            if (this._filterText.length === 0) return;
            this._filterText = this._filterText.slice(0, -1);
            this._applyFilter();
        } catch (e) {
            console.error('[Kestrel] Error handling backspace:', e);
        }
    }

    private _applyFilter(): void {
        const world = this._deps.getWorld();
        if (!world || !this._overviewTransform) return;

        if (this._filterText.length === 0) {
            this._clearFilterView(world);
            return;
        }
        this._applyFilterMatches(world);
    }

    private _clearFilterView(world: World): void {
        this._filteredIndices = [];
        const numWs = this._countNonEmpty(world);
        const transform = this._computeTransform(world, numWs);
        this._overviewTransform = transform;
        this._renderClearedFilter(world, transform);
    }

    private _renderClearedFilter(world: World, transform: OverviewTransform): void {
        const cloneAdapter = this._deps.getCloneAdapter();
        cloneAdapter?.applyOverviewFilter?.(null, transform, world.viewport.workspaceIndex);
        cloneAdapter?.updateFilterIndicator?.('');
        this._updateFocusForWorkspace(world, transform);
    }

    private _updateFocusForWorkspace(world: World, transform: OverviewTransform): void {
        const layout = computeLayoutForWorkspace(world, world.viewport.workspaceIndex);
        this._deps.getCloneAdapter()?.updateOverviewFocus(
            layout, world.viewport.workspaceIndex, transform,
        );
    }

    private _applyFilterMatches(world: World): void {
        const matches = filterWorkspaces(world, this._filterText);
        this._filteredIndices = matches.map(m => m.wsIndex);
        this._deps.getCloneAdapter()?.updateFilterIndicator?.(this._filterText);

        if (this._filteredIndices.length === 0) {
            this._renderEmptyFilterResult(world);
            return;
        }
        this._applyFilteredLayout(world);
    }

    private _renderEmptyFilterResult(world: World): void {
        const cloneAdapter = this._deps.getCloneAdapter();
        cloneAdapter?.applyOverviewFilter?.(
            [], this._overviewTransform!, world.viewport.workspaceIndex,
        );
    }

    private _applyFilteredLayout(world: World): void {
        const transform = this._computeTransform(world, this._filteredIndices.length);
        this._overviewTransform = transform;
        this._jumpToFirstMatchIfNeeded(world);
        this._renderFilteredOverview(transform);
    }

    private _jumpToFirstMatchIfNeeded(world: World): void {
        if (this._filteredIndices.includes(world.viewport.workspaceIndex)) return;
        const update = switchToWorkspace(world, this._filteredIndices[0]!);
        this._deps.setWorld({ ...update.world, overviewActive: true });
    }

    private _renderFilteredOverview(transform: OverviewTransform): void {
        const currentWorld = this._deps.getWorld()!;
        const cloneAdapter = this._deps.getCloneAdapter();
        cloneAdapter?.applyOverviewFilter?.(
            this._filteredIndices, transform, currentWorld.viewport.workspaceIndex,
        );
        const layout = computeLayoutForWorkspace(currentWorld, currentWorld.viewport.workspaceIndex);
        cloneAdapter?.updateOverviewFocus(layout, currentWorld.viewport.workspaceIndex, transform);
    }

    private _handleRename(): void {
        try {
            this._handleRenameInner();
        } catch (e) {
            console.error('[Kestrel] Error handling rename:', e);
        }
    }

    private _handleRenameInner(): void {
        const world = this._deps.getWorld();
        if (!world || !this._overviewTransform) return;
        if (this._renameActive) return;

        this._renameActive = true;
        this._overviewInputAdapter?.setKeyPassthrough(true);
        this._startRenameUI(world);
    }

    private _startRenameUI(world: World): void {
        const wsIndex = world.viewport.workspaceIndex;
        const currentName = world.workspaces[wsIndex]?.name ?? '';
        this._deps.getCloneAdapter()?.startRename?.(
            wsIndex, currentName, this._overviewTransform!,
            (newName) => this._onRenameComplete(newName),
        );
    }

    private _onRenameComplete(newName: string | null): void {
        this._renameActive = false;
        this._overviewInputAdapter?.setKeyPassthrough(false);
        if (newName !== null) this._applyRename(newName);
    }

    private _applyRename(newName: string): void {
        const w = this._deps.getWorld();
        if (!w) return;
        const renamed = renameCurrentWorkspace(w, newName || null);
        this._deps.setWorld(renamed);
        this._deps.getCloneAdapter()?.syncWorkspaces(renamed.workspaces);
    }

    private _clearFilter(): void {
        this._clearFilterText();
        this._cancelActiveRename();
    }

    private _clearFilterText(): void {
        if (this._filterText.length === 0 && this._filteredIndices.length === 0) return;
        this._filterText = '';
        this._filteredIndices = [];
        this._deps.getCloneAdapter()?.updateFilterIndicator?.('');
    }

    private _cancelActiveRename(): void {
        if (!this._renameActive) return;
        this._renameActive = false;
        this._overviewInputAdapter?.setKeyPassthrough(false);
        this._deps.getCloneAdapter()?.cancelRename?.();
    }

    private _exitVisual(layout: LayoutState, animate: boolean = true): void {
        this._overviewInputAdapter?.deactivate();
        this._overviewInputAdapter = null;
        this._clearFilter();
        this._applyExitLayout(layout, animate);
        this._preOverviewState = null;
        this._overviewTransform = null;
    }

    private _applyExitLayout(layout: LayoutState, animate: boolean): void {
        this._applyExitClone(layout, animate);
        this._notifyExit();
        this._deps.getWindowAdapter()?.applyLayout(layout);
        this._deps.focusWindow(this._deps.getWorld()!.focusedWindow);
    }

    private _applyExitClone(layout: LayoutState, animate: boolean): void {
        this._deps.getCloneAdapter()?.exitOverview(layout, animate);
        this._deps.getCloneAdapter()?.applyLayout(layout, animate);
    }

    private _notifyExit(): void {
        this._deps.notifyOverviewExit?.();
        this._deps.onOverviewExit?.();
    }

    private _computeTransform(world: World, numWorkspaces: number): OverviewTransform {
        const monitor = world.monitor;
        const stripHeight = numWorkspaces * monitor.totalHeight;
        const maxWsWidth = this._computeMaxWorkspaceWidth(world);

        const OVERVIEW_LABEL_WIDTH = 56;
        const totalWidth = maxWsWidth + OVERVIEW_LABEL_WIDTH;
        const scaleX = monitor.totalWidth / totalWidth;
        const scaleY = monitor.totalHeight / stripHeight;
        const scale = Math.min(scaleX, scaleY, 1);

        const scaledWidth = totalWidth * scale;
        const scaledHeight = stripHeight * scale;
        const offsetX = Math.round((monitor.totalWidth - scaledWidth) / 2);
        const offsetY = Math.round((monitor.totalHeight - scaledHeight) / 2);
        return { scale, offsetX, offsetY };
    }

    private _computeMaxWorkspaceWidth(world: World): number {
        let maxWsWidth = world.monitor.totalWidth;
        for (const ws of world.workspaces) {
            if (ws.windows.length === 0) continue;
            const w = this._computeWorkspaceWidth(world, ws);
            if (w > maxWsWidth) maxWsWidth = w;
        }
        return maxWsWidth;
    }

    private _computeWorkspaceWidth(world: World, ws: { windows: readonly { slotSpan: number }[] }): number {
        const { gapSize, edgeGap } = world.config;
        let width = edgeGap;
        for (const win of ws.windows) {
            width += win.slotSpan * world.monitor.slotWidth - gapSize + gapSize;
        }
        return width + edgeGap - gapSize;
    }

    destroy(): void {
        this._clearFilter();
        this._overviewInputAdapter?.destroy();
        this._overviewInputAdapter = null;
        this._preOverviewState = null;
        this._overviewTransform = null;
        this._dragSubject = null;
        this._preDragWorld = null;
        this._filterText = '';
        this._filteredIndices = [];
        this._renameActive = false;
    }
}
