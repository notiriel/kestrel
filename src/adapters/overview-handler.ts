import type { WindowId, WorkspaceColorId, WorldUpdate } from '../domain/world/types.js';
import { nextWorkspaceColor } from '../domain/world/types.js';
import type { SceneModel } from '../domain/scene/scene.js';
import type { World } from '../domain/world/world.js';
import { setFocus, filterWorkspaces, renameCurrentWorkspace, setCurrentWorkspaceColor, switchToWorkspace } from '../domain/world/world.js';
import { computeScene } from '../domain/scene/scene.js';
import { focusRight, focusLeft, focusDown, focusUp } from '../domain/world/navigation.js';
import { moveLeft, moveRight } from '../domain/world/window-operations.js';
import { enterOverview, exitOverview, cancelOverview, focusModeFromOverview } from '../domain/world/overview.js';
import { appendFilter, backspaceFilter, clearFilter, updateFilteredIndices, startRename, finishRename, cancelRename, OVERVIEW_LABEL_WIDTH } from '../domain/world/overview-state.js';
import { computeOverviewTransform, computeMaxWorkspaceWidth } from '../domain/scene/layout.js';
import type { OverviewRenderPort, CloneRenderPort, OverviewTransform, OverviewFilterPort, CloneLifecyclePort } from '../ports/clone-port.js';
import type { WindowPort } from '../ports/window-port.js';
import type { SceneApplyOptions } from './world-holder.js';
import type { OverviewInputAdapter } from './input/overview-input-adapter.js';

export interface OverviewDeps {
    getWorld(): World | null;
    setWorld(world: World): void;
    applyUpdate(update: WorldUpdate, options: SceneApplyOptions): void;
    focusWindow(windowId: WindowId | null): void;
    getCloneAdapter(): (OverviewRenderPort & CloneRenderPort & Partial<OverviewFilterPort> & Pick<CloneLifecyclePort, 'syncWorkspaces'>) | null;
    getWindowAdapter(): WindowPort | null;
    createOverviewInputAdapter(): OverviewInputAdapter;
    notifyOverviewEnter?(transform: OverviewTransform): void;
    notifyOverviewExit?(): void;
    onOverviewEnter?(): void;
    onOverviewExit?(): void;
    onFocusMode?(): void;
}

export class OverviewHandler {
    private _deps: OverviewDeps;
    private _overviewTransform: OverviewTransform | null = null;
    private _overviewInputAdapter: OverviewInputAdapter | null = null;

    // Drag state
    private _dragSubject: WindowId | null = null;
    private _preDragWorld: World | null = null;

    constructor(deps: OverviewDeps) {
        this._deps = deps;
    }

    get isActive(): boolean {
        return this._overviewTransform !== null;
    }

    get overviewTransform(): OverviewTransform | null {
        return this._overviewTransform;
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

        const update = enterOverview(world);

        const numWs = this._countNonEmpty(update.world);
        this._overviewTransform = this._computeTransform(update.world, numWs);
        this._notifyEnter(this._overviewTransform, update.scene, numWs);

        // applyUpdate after enter setup so scene subscribers see isActive=true
        this._deps.applyUpdate(update, { animate: true });

        this._activateOverviewInput();
    }

    private _countNonEmpty(world: World): number {
        return world.workspaces.filter(ws => ws.columns.length > 0).length || 1;
    }

    private _notifyEnter(transform: OverviewTransform, scene: SceneModel, numWs: number): void {
        this._deps.getCloneAdapter()?.enterOverview(transform, scene, numWs, () => {
            this._deps.notifyOverviewEnter?.(transform);
        });
        this._deps.onOverviewEnter?.();
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
            onColorPick: () => this._handleColorPick(),
            onFocusMode: () => this.handleFocusMode(),
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
        this._deps.applyUpdate(update, { animate: false });
    }

    private _navigateFilteredVertical(world: World, direction: string): boolean {
        const filteredIndices = world.overviewInteractionState.filteredIndices;
        if (filteredIndices.length === 0) return false;
        if (direction !== 'up' && direction !== 'down') return false;

        const currentWsIndex = world.viewport.workspaceIndex;
        const currentPos = filteredIndices.indexOf(currentWsIndex);
        const targetPos = this._computeFilteredTarget(filteredIndices, currentPos, direction);

        const targetWsIndex = filteredIndices[targetPos]!;
        if (targetWsIndex !== currentWsIndex) {
            this._switchToFilteredWorkspace(world, targetWsIndex);
        }
        return true;
    }

    private _computeFilteredTarget(filteredIndices: number[], currentPos: number, direction: string): number {
        if (direction === 'up') {
            return currentPos <= 0
                ? filteredIndices.length - 1
                : currentPos - 1;
        }
        return currentPos >= filteredIndices.length - 1
            ? 0
            : currentPos + 1;
    }

    private _switchToFilteredWorkspace(world: World, targetWsIndex: number): void {
        const update = switchToWorkspace(world, targetWsIndex);
        this._deps.applyUpdate(update, { animate: false });
    }

    handleConfirm(animate: boolean = true): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;

            this._dragSubject = null;
            this._preDragWorld = null;

            const update = exitOverview(world);
            this._exitVisual(update.scene, animate);
            // applyUpdate after exit visual so scene subscribers see isActive=false
            this._deps.applyUpdate(update, { animate });
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

        if (this._cancelActiveOverviewAction(world)) return;
        if (this._cancelDrag()) return;
        this._cancelNormal(world);
    }

    private _cancelActiveOverviewAction(world: World): boolean {
        return this._cancelRename(world) || this._cancelFilter(world);
    }

    private _cancelRename(world: World): boolean {
        if (!world.overviewInteractionState.renaming) return false;
        this._deps.setWorld({ ...world, overviewInteractionState: cancelRename(world.overviewInteractionState) });
        this._overviewInputAdapter?.setKeyPassthrough(false);
        this._deps.getCloneAdapter()?.cancelRename?.();
        return true;
    }

    private _cancelFilter(world: World): boolean {
        if (world.overviewInteractionState.filterText.length === 0) return false;
        this._deps.setWorld({ ...world, overviewInteractionState: clearFilter(world.overviewInteractionState) });
        this._applyFilter();
        return true;
    }

    private _cancelDrag(): boolean {
        if (this._dragSubject === null || !this._preDragWorld) return false;
        const revertWorld = this._preDragWorld;
        this._dragSubject = null;
        this._preDragWorld = null;
        const scene = computeScene(revertWorld);
        this._deps.applyUpdate({ world: revertWorld, scene }, { animate: false });
        return true;
    }

    private _cancelNormal(world: World): void {
        const update = cancelOverview(world);
        this._exitVisual(update.scene);
        // applyUpdate after exit visual so scene subscribers see isActive=false
        this._deps.applyUpdate(update, { animate: true });
    }

    handleFocusMode(): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;

            const update = focusModeFromOverview(world);
            if (!update) return;

            this._exitVisual(update.scene);
            this._deps.applyUpdate(update, { animate: true });
            this._deps.onFocusMode?.();
        } catch (e) {
            console.error('[Kestrel] Error handling overview focus mode:', e);
        }
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
        this._deps.applyUpdate(update, { animate: false });
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

        return (x - offsetX) / scale - OVERVIEW_LABEL_WIDTH;
    }

    private _checkDragSwap(world: World, reverseX: number): void {
        const wsIndex = world.viewport.workspaceIndex;
        const wsId = world.workspaces[wsIndex]?.id;
        if (!wsId) return;
        const scene = computeScene(world);
        const wsClones = scene.clones.filter(c => c.workspaceId === wsId);
        const subjectIdx = wsClones.findIndex(c => c.windowId === this._dragSubject);
        if (subjectIdx < 0) return;

        if (this._checkSwapRight(world, wsClones, subjectIdx, reverseX)) return;
        this._checkSwapLeft(world, wsClones, subjectIdx, reverseX);
    }

    private _checkSwapRight(world: World, wsClones: readonly { x: number; width: number }[], idx: number, reverseX: number): boolean {
        if (idx >= wsClones.length - 1) return false;
        const neighbor = wsClones[idx + 1]!;
        if (reverseX <= neighbor.x + neighbor.width / 2) return false;
        const update = moveRight(world);
        this._deps.applyUpdate(update, { animate: false });
        return true;
    }

    private _checkSwapLeft(world: World, wsClones: readonly { x: number; width: number }[], idx: number, reverseX: number): boolean {
        if (idx <= 0) return false;
        const neighbor = wsClones[idx - 1]!;
        if (reverseX >= neighbor.x + neighbor.width / 2) return false;
        const update = moveLeft(world);
        this._deps.applyUpdate(update, { animate: false });
        return true;
    }

    private _handleDragEnd(_x: number, _y: number): void {
        try {
            this._dragSubject = null;
            this._preDragWorld = null;
        } catch (e) {
            console.error('[Kestrel] Error handling drag end:', e);
        }
    }

    private _hitTest(world: World, x: number, y: number): WindowId | null {
        if (!this._overviewTransform) return null;
        const { scale, offsetX, offsetY } = this._overviewTransform;


        const reverseX = (x - offsetX) / scale - OVERVIEW_LABEL_WIDTH;
        const reverseY = (y - offsetY) / scale;
        const visualSlot = Math.floor(reverseY / world.monitor.totalHeight);

        const realWsIndex = this._resolveWorkspaceIndex(world, visualSlot);
        if (realWsIndex === null) return null;

        const localY = reverseY - visualSlot * world.monitor.totalHeight;
        return this._hitTestWindows(world, realWsIndex, reverseX, localY);
    }

    private _resolveWorkspaceIndex(world: World, visualSlot: number): number | null {
        const filteredIndices = world.overviewInteractionState.filteredIndices;
        if (filteredIndices.length > 0) {
            return this._resolveFilteredSlot(filteredIndices, visualSlot);
        }
        return this._resolveUnfilteredSlot(world, visualSlot);
    }

    private _resolveFilteredSlot(filteredIndices: number[], visualSlot: number): number | null {
        if (visualSlot < 0 || visualSlot >= filteredIndices.length) return null;
        return filteredIndices[visualSlot]!;
    }

    private _resolveUnfilteredSlot(world: World, visualSlot: number): number | null {
        const count = world.workspaces.filter(ws => ws.columns.length > 0).length;
        if (visualSlot < 0 || visualSlot >= count) return null;
        return visualSlot;
    }

    private _hitTestWindows(world: World, wsIndex: number, rx: number, localY: number): WindowId | null {
        const wsClones = this._getClonesForWorkspace(world, wsIndex);
        for (const clone of wsClones) {
            if (this._isInsideWindow(clone, rx, localY)) return clone.windowId;
        }
        return null;
    }

    private _getClonesForWorkspace(world: World, wsIndex: number): SceneModel['clones'] {
        const wsId = world.workspaces[wsIndex]?.id;
        if (!wsId) return [];
        return computeScene(world).clones.filter(c => c.workspaceId === wsId);
    }

    private _isInsideWindow(win: { x: number; y: number; width: number; height: number }, rx: number, localY: number): boolean {
        return rx >= win.x && rx <= win.x + win.width &&
            localY >= win.y && localY <= win.y + win.height;
    }

    private _handleTextInput(text: string): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;
            const newState = appendFilter(world.overviewInteractionState, text);
            if (newState === world.overviewInteractionState) return;
            this._deps.setWorld({ ...world, overviewInteractionState: newState });
            this._applyFilter();
        } catch (e) {
            console.error('[Kestrel] Error handling text input:', e);
        }
    }

    private _handleBackspace(): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;
            const newState = backspaceFilter(world.overviewInteractionState);
            if (newState === world.overviewInteractionState) return;
            this._deps.setWorld({ ...world, overviewInteractionState: newState });
            this._applyFilter();
        } catch (e) {
            console.error('[Kestrel] Error handling backspace:', e);
        }
    }

    private _applyFilter(): void {
        const world = this._deps.getWorld();
        if (!world || !this._overviewTransform) return;

        if (world.overviewInteractionState.filterText.length === 0) {
            this._clearFilterView(world);
            return;
        }
        this._applyFilterMatches(world);
    }

    private _clearFilterView(world: World): void {
        this._deps.setWorld({ ...world, overviewInteractionState: updateFilteredIndices(world.overviewInteractionState, []) });
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
        const scene = computeScene(world);
        this._deps.getCloneAdapter()?.updateOverviewFocus(
            scene, world.viewport.workspaceIndex, transform,
        );
    }

    private _applyFilterMatches(world: World): void {
        const filterText = world.overviewInteractionState.filterText;
        const matches = filterWorkspaces(world, filterText);
        const indices = matches.map(m => m.wsIndex);
        this._deps.setWorld({ ...world, overviewInteractionState: updateFilteredIndices(world.overviewInteractionState, indices) });
        this._deps.getCloneAdapter()?.updateFilterIndicator?.(filterText);

        if (indices.length === 0) {
            this._renderEmptyFilterResult(world);
            return;
        }
        this._applyFilteredLayout(world, indices);
    }

    private _renderEmptyFilterResult(world: World): void {
        const cloneAdapter = this._deps.getCloneAdapter();
        cloneAdapter?.applyOverviewFilter?.(
            [], this._overviewTransform!, world.viewport.workspaceIndex,
        );
    }

    private _applyFilteredLayout(world: World, filteredIndices: number[]): void {
        const transform = this._computeTransform(world, filteredIndices.length);
        this._overviewTransform = transform;
        this._jumpToFirstMatchIfNeeded(world, filteredIndices);
        this._renderFilteredOverview(transform, filteredIndices);
    }

    private _jumpToFirstMatchIfNeeded(world: World, filteredIndices: number[]): void {
        if (filteredIndices.includes(world.viewport.workspaceIndex)) return;
        const update = switchToWorkspace(world, filteredIndices[0]!);
        this._deps.applyUpdate(update, { animate: false });
    }

    private _renderFilteredOverview(transform: OverviewTransform, filteredIndices: number[]): void {
        const currentWorld = this._deps.getWorld()!;
        const cloneAdapter = this._deps.getCloneAdapter();
        cloneAdapter?.applyOverviewFilter?.(
            filteredIndices, transform, currentWorld.viewport.workspaceIndex,
        );
        const scene = computeScene(currentWorld);
        cloneAdapter?.updateOverviewFocus(scene, currentWorld.viewport.workspaceIndex, transform);
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
        if (world.overviewInteractionState.renaming) return;

        this._deps.setWorld({ ...world, overviewInteractionState: startRename(world.overviewInteractionState) });
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
        const world = this._deps.getWorld();
        if (world) {
            this._deps.setWorld({ ...world, overviewInteractionState: finishRename(world.overviewInteractionState) });
        }
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

    private _handleColorPick(): void {
        try {
            this._cycleWorkspaceColor();
        } catch (e) {
            console.error('[Kestrel] Error handling color pick:', e);
        }
    }

    /** Cycle workspace color through the palette: null → blue → purple → … → coral → null */
    private _cycleWorkspaceColor(): void {
        const world = this._deps.getWorld();
        if (!world || !this._overviewTransform) return;

        const wsIndex = world.viewport.workspaceIndex;
        const current = world.workspaces[wsIndex]?.color ?? null;
        const next = nextWorkspaceColor(current);
        const w = setCurrentWorkspaceColor(world, next);
        this._deps.setWorld(w);
        this._applyColorCycleVisual(w, wsIndex, next);
    }

    private _applyColorCycleVisual(w: World, wsIndex: number, color: WorkspaceColorId): void {
        const scene = computeScene(w);
        const adapter = this._deps.getCloneAdapter();
        adapter?.updateOverviewFocus(scene, wsIndex, this._overviewTransform!);
        adapter?.showColorPicker?.(wsIndex, color, this._overviewTransform!);
    }

    private _exitVisual(scene: SceneModel, animate: boolean = true): void {
        this._overviewInputAdapter?.deactivate();
        this._overviewInputAdapter = null;
        this._clearFilterUI();
        this._applyExitClone(scene, animate);
        this._notifyExit();
        // Clear transform so isActive becomes false before applyUpdate broadcasts
        this._overviewTransform = null;
    }

    /** Clear filter UI elements without touching domain state (already cleared by exitOverview/cancelOverview) */
    private _clearFilterUI(): void {
        this._clearFilterIndicator();
        this._clearOverviewPopups();
    }

    private _clearFilterIndicator(): void {
        this._deps.getCloneAdapter()?.updateFilterIndicator?.('');
    }

    private _clearOverviewPopups(): void {
        this._clearClonePopups();
        this._overviewInputAdapter?.setKeyPassthrough?.(false);
    }

    private _clearClonePopups(): void {
        this._deps.getCloneAdapter()?.cancelRename?.();
        this._deps.getCloneAdapter()?.hideColorPicker?.();
    }

    private _applyExitClone(scene: SceneModel, animate: boolean): void {
        this._deps.getCloneAdapter()?.exitOverview(scene, animate);
        this._deps.getCloneAdapter()?.applyScene(scene, animate);
    }

    private _notifyExit(): void {
        this._deps.notifyOverviewExit?.();
        this._deps.onOverviewExit?.();
    }

    private _computeTransform(world: World, numWorkspaces: number): OverviewTransform {
        const maxWsWidth = computeMaxWorkspaceWidth(world);
        return computeOverviewTransform(
            world.monitor.totalWidth, world.monitor.totalHeight,
            numWorkspaces, maxWsWidth,
        );
    }

    destroy(): void {
        this._clearFilterUI();
        this._overviewInputAdapter?.destroy();
        this._overviewInputAdapter = null;
        this._overviewTransform = null;
        this._dragSubject = null;
        this._preDragWorld = null;
    }
}
