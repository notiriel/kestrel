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

        this._preOverviewState = {
            focusedWindow: world.focusedWindow,
            viewport: {
                workspaceIndex: world.viewport.workspaceIndex,
                scrollX: world.viewport.scrollX,
            },
        };

        const update = enterOverview(world);
        this._deps.setWorld(update.world);

        const numWorkspaces = update.world.workspaces.filter(ws => ws.windows.length > 0).length || 1;
        this._overviewTransform = this._computeTransform(update.world, numWorkspaces);

        this._deps.getCloneAdapter()?.enterOverview(this._overviewTransform, update.layout, numWorkspaces);
        this._deps.notifyOverviewEnter?.(this._overviewTransform);
        this._deps.onOverviewEnter?.();

        // Clear filter/rename state
        this._filterText = '';
        this._filteredIndices = [];
        this._renameActive = false;

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

            if (this._filteredIndices.length > 0 && (direction === 'up' || direction === 'down')) {
                // Constrain vertical navigation to filtered workspaces
                const currentWsIndex = world.viewport.workspaceIndex;
                const currentFilteredPos = this._filteredIndices.indexOf(currentWsIndex);
                let targetFilteredPos: number;

                if (direction === 'up') {
                    targetFilteredPos = currentFilteredPos <= 0
                        ? this._filteredIndices.length - 1
                        : currentFilteredPos - 1;
                } else {
                    targetFilteredPos = currentFilteredPos >= this._filteredIndices.length - 1
                        ? 0
                        : currentFilteredPos + 1;
                }

                const targetWsIndex = this._filteredIndices[targetFilteredPos]!;
                if (targetWsIndex !== currentWsIndex) {
                    const update = switchToWorkspace(world, targetWsIndex);
                    const overviewWorld = { ...update.world, overviewActive: true };
                    this._deps.setWorld(overviewWorld);

                    const layout = computeLayoutForWorkspace(overviewWorld, targetWsIndex);
                    this._deps.getCloneAdapter()?.updateOverviewFocus(
                        layout,
                        targetWsIndex,
                        this._overviewTransform,
                    );
                }
                return;
            }

            const navFns: Record<string, (w: World) => WorldUpdate> = {
                left: focusLeft, right: focusRight, up: focusUp, down: focusDown,
            };
            const update = navFns[direction]!(world);
            this._deps.setWorld(update.world);

            this._deps.getCloneAdapter()?.updateOverviewFocus(
                update.layout,
                update.world.viewport.workspaceIndex,
                this._overviewTransform,
            );
        } catch (e) {
            console.error('[Kestrel] Error handling overview navigate:', e);
        }
    }

    handleConfirm(animate: boolean = true): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;

            // Clear drag state if active
            this._dragSubject = null;
            this._preDragWorld = null;

            // Clear filter state before exit
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
            const world = this._deps.getWorld();
            if (!world) return;

            // If rename is active, cancel rename first
            if (this._renameActive) {
                this._renameActive = false;
                this._overviewInputAdapter?.setKeyPassthrough(false);
                this._deps.getCloneAdapter()?.cancelRename?.();
                return;
            }

            // If filter is non-empty, clear filter first
            if (this._filterText.length > 0) {
                this._filterText = '';
                this._filteredIndices = [];
                this._applyFilter();
                return;
            }

            // If dragging, revert to pre-drag world and stay in overview
            if (this._dragSubject !== null && this._preDragWorld) {
                const revertWorld = this._preDragWorld;
                this._dragSubject = null;
                this._preDragWorld = null;

                this._deps.setWorld(revertWorld);

                // Re-render overview with reverted state
                if (this._overviewTransform) {
                    const wsIndex = revertWorld.viewport.workspaceIndex;
                    const layout = computeLayoutForWorkspace(revertWorld, wsIndex);
                    this._deps.getCloneAdapter()?.updateOverviewFocus(
                        layout,
                        wsIndex,
                        this._overviewTransform,
                    );
                }
                return;
            }

            // Normal cancel: restore pre-overview state and exit
            if (!this._preOverviewState) return;

            const update = cancelOverview(
                world,
                this._preOverviewState.focusedWindow,
                this._preOverviewState.viewport.workspaceIndex,
                this._preOverviewState.viewport.scrollX,
            );
            this._deps.setWorld(update.world);

            this._exitVisual(update.layout);
        } catch (e) {
            console.error('[Kestrel] Error handling overview cancel:', e);
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

            this._dragSubject = hitWindowId;
            this._preDragWorld = world;

            // Focus the drag subject
            const update = setFocus(world, hitWindowId);
            this._deps.setWorld(update.world);

            this._deps.getCloneAdapter()?.updateOverviewFocus(
                update.layout,
                update.world.viewport.workspaceIndex,
                this._overviewTransform,
            );
        } catch (e) {
            console.error('[Kestrel] Error handling drag start:', e);
        }
    }

    private _handleDragMove(x: number, y: number): void {
        try {
            const world = this._deps.getWorld();
            if (!world || !this._overviewTransform || !this._dragSubject) return;

            const { scale, offsetX, offsetY } = this._overviewTransform;
            const OVERVIEW_LABEL_WIDTH = 56;
            const reverseX = (x - offsetX) / scale - OVERVIEW_LABEL_WIDTH;

            const wsIndex = world.viewport.workspaceIndex;
            const wsLayout = computeLayoutForWorkspace(world, wsIndex);

            // Find drag subject position and its neighbors
            const subjectLayout = wsLayout.windows.find(w => w.windowId === this._dragSubject);
            if (!subjectLayout) return;

            const subjectIndex = wsLayout.windows.indexOf(subjectLayout);

            // Check right neighbor
            if (subjectIndex < wsLayout.windows.length - 1) {
                const rightNeighbor = wsLayout.windows[subjectIndex + 1];
                const rightMidpoint = rightNeighbor.x + rightNeighbor.width / 2;
                if (reverseX > rightMidpoint) {
                    const update = moveRight(world);
                    this._deps.setWorld(update.world);
                    this._renderOverviewUpdate(update);
                    return;
                }
            }

            // Check left neighbor
            if (subjectIndex > 0) {
                const leftNeighbor = wsLayout.windows[subjectIndex - 1];
                const leftMidpoint = leftNeighbor.x + leftNeighbor.width / 2;
                if (reverseX < leftMidpoint) {
                    const update = moveLeft(world);
                    this._deps.setWorld(update.world);
                    this._renderOverviewUpdate(update);
                    return;
                }
            }
        } catch (e) {
            console.error('[Kestrel] Error handling drag move:', e);
        }
    }

    private _handleDragEnd(_x: number, _y: number): void {
        try {
            this._dragSubject = null;
            this._preDragWorld = null;
            // No animation — user already saw the new layout during drag
            this.handleConfirm(false);
        } catch (e) {
            console.error('[Kestrel] Error handling drag end:', e);
        }
    }

    private _hitTest(world: World, x: number, y: number): WindowId | null {
        if (!this._overviewTransform) return null;

        const { scale, offsetX, offsetY } = this._overviewTransform;
        const monitor = world.monitor;

        const OVERVIEW_LABEL_WIDTH = 56;
        const reverseX = (x - offsetX) / scale - OVERVIEW_LABEL_WIDTH;
        const reverseY = (y - offsetY) / scale;

        const visualSlot = Math.floor(reverseY / monitor.totalHeight);

        // Map visual position back to real workspace index
        let realWsIndex: number;
        if (this._filteredIndices.length > 0) {
            if (visualSlot < 0 || visualSlot >= this._filteredIndices.length) return null;
            realWsIndex = this._filteredIndices[visualSlot]!;
        } else {
            const nonEmptyCount = world.workspaces.filter(ws => ws.windows.length > 0).length;
            if (visualSlot < 0 || visualSlot >= nonEmptyCount) return null;
            realWsIndex = visualSlot;
        }

        const localY = reverseY - visualSlot * monitor.totalHeight;
        const wsLayout = computeLayoutForWorkspace(world, realWsIndex);

        for (const win of wsLayout.windows) {
            if (reverseX >= win.x && reverseX <= win.x + win.width &&
                localY >= win.y && localY <= win.y + win.height) {
                return win.windowId;
            }
        }

        return null;
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
            if (this._renameActive) return; // Rename entry handles its own input
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

        const cloneAdapter = this._deps.getCloneAdapter();

        if (this._filterText.length === 0) {
            // Clear filter — restore all workspaces
            this._filteredIndices = [];
            const numWorkspaces = world.workspaces.filter(ws => ws.windows.length > 0).length || 1;
            const transform = this._computeTransform(world, numWorkspaces);
            this._overviewTransform = transform;

            cloneAdapter?.applyOverviewFilter?.(
                null,
                transform,
                world.viewport.workspaceIndex,
            );
            cloneAdapter?.updateFilterIndicator?.('');

            // Re-render overview
            const layout = computeLayoutForWorkspace(world, world.viewport.workspaceIndex);
            cloneAdapter?.updateOverviewFocus(layout, world.viewport.workspaceIndex, transform);
            return;
        }

        const matches = filterWorkspaces(world, this._filterText);
        this._filteredIndices = matches.map(m => m.wsIndex);

        cloneAdapter?.updateFilterIndicator?.(this._filterText);

        if (this._filteredIndices.length === 0) {
            // Zero matches — hide all, indicator stays
            cloneAdapter?.applyOverviewFilter?.(
                [],
                this._overviewTransform,
                world.viewport.workspaceIndex,
            );
            return;
        }

        // Recompute transform for filtered count
        const transform = this._computeTransform(world, this._filteredIndices.length);
        this._overviewTransform = transform;

        // If current workspace is filtered out, jump to first match
        if (!this._filteredIndices.includes(world.viewport.workspaceIndex)) {
            const targetWsIndex = this._filteredIndices[0]!;
            const update = switchToWorkspace(world, targetWsIndex);
            const overviewWorld = { ...update.world, overviewActive: true };
            this._deps.setWorld(overviewWorld);
        }

        const currentWorld = this._deps.getWorld()!;
        cloneAdapter?.applyOverviewFilter?.(
            this._filteredIndices,
            transform,
            currentWorld.viewport.workspaceIndex,
        );

        const layout = computeLayoutForWorkspace(currentWorld, currentWorld.viewport.workspaceIndex);
        cloneAdapter?.updateOverviewFocus(layout, currentWorld.viewport.workspaceIndex, transform);
    }

    private _handleRename(): void {
        try {
            const world = this._deps.getWorld();
            if (!world || !this._overviewTransform) return;
            if (this._renameActive) return;

            this._renameActive = true;
            this._overviewInputAdapter?.setKeyPassthrough(true);
            const wsIndex = world.viewport.workspaceIndex;
            const currentName = world.workspaces[wsIndex]?.name ?? '';

            this._deps.getCloneAdapter()?.startRename?.(
                wsIndex,
                currentName,
                this._overviewTransform,
                (newName: string | null) => {
                    this._renameActive = false;
                    this._overviewInputAdapter?.setKeyPassthrough(false);
                    if (newName !== null) {
                        const w = this._deps.getWorld();
                        if (w) {
                            const renamed = renameCurrentWorkspace(w, newName || null);
                            this._deps.setWorld(renamed);
                            this._deps.getCloneAdapter()?.syncWorkspaces(renamed.workspaces);
                        }
                    }
                },
            );
        } catch (e) {
            console.error('[Kestrel] Error handling rename:', e);
        }
    }

    private _clearFilter(): void {
        if (this._filterText.length > 0 || this._filteredIndices.length > 0) {
            this._filterText = '';
            this._filteredIndices = [];
            this._deps.getCloneAdapter()?.updateFilterIndicator?.('');
        }
        if (this._renameActive) {
            this._renameActive = false;
            this._overviewInputAdapter?.setKeyPassthrough(false);
            this._deps.getCloneAdapter()?.cancelRename?.();
        }
    }

    private _exitVisual(layout: LayoutState, animate: boolean = true): void {
        this._overviewInputAdapter?.deactivate();
        this._overviewInputAdapter = null;

        // Clear filter/rename visuals
        this._clearFilter();

        this._deps.getCloneAdapter()?.exitOverview(layout, animate);
        this._deps.getCloneAdapter()?.applyLayout(layout, animate);
        this._deps.notifyOverviewExit?.();
        this._deps.onOverviewExit?.();
        this._deps.getWindowAdapter()?.applyLayout(layout);
        this._deps.focusWindow(this._deps.getWorld()!.focusedWindow);

        this._preOverviewState = null;
        this._overviewTransform = null;
    }

    private _computeTransform(world: World, numWorkspaces: number): OverviewTransform {
        const monitor = world.monitor;
        const stripHeight = numWorkspaces * monitor.totalHeight;

        let maxWsWidth = monitor.totalWidth;
        for (const ws of world.workspaces) {
            if (ws.windows.length === 0) continue;
            const { gapSize, edgeGap } = world.config;
            let width = edgeGap;
            for (const win of ws.windows) {
                width += win.slotSpan * monitor.slotWidth - gapSize + gapSize;
            }
            width += edgeGap - gapSize;
            if (width > maxWsWidth) maxWsWidth = width;
        }

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
