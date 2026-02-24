import type { WindowId, LayoutState, WorldUpdate } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { setFocus } from '../domain/world.js';
import { focusRight, focusLeft, focusDown, focusUp } from '../domain/navigation.js';
import { moveLeft, moveRight } from '../domain/window-operations.js';
import { enterOverview, exitOverview, cancelOverview } from '../domain/overview.js';
import { computeLayoutForWorkspace } from '../domain/layout.js';
import type { OverviewRenderPort, CloneRenderPort, OverviewTransform } from '../ports/clone-port.js';
import type { WindowPort } from '../ports/window-port.js';
import type { OverviewInputAdapter } from './overview-input-adapter.js';

export interface OverviewDeps {
    getWorld(): World | null;
    setWorld(world: World): void;
    focusWindow(windowId: WindowId | null): void;
    getCloneAdapter(): (OverviewRenderPort & CloneRenderPort) | null;
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

        this._overviewInputAdapter = this._deps.createOverviewInputAdapter();
        this._overviewInputAdapter.activate({
            onNavigate: (dir) => this._handleNavigate(dir),
            onConfirm: () => this.handleConfirm(),
            onCancel: () => this.handleCancel(),
            onClick: (x, y) => this._handleClick(x, y),
            onDragStart: (x, y) => this._handleDragStart(x, y),
            onDragMove: (x, y) => this._handleDragMove(x, y),
            onDragEnd: (x, y) => this._handleDragEnd(x, y),
        });

    }

    private _handleNavigate(direction: 'left' | 'right' | 'up' | 'down'): void {
        try {
            const world = this._deps.getWorld();
            if (!world || !this._overviewTransform) return;

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

        const wsIndex = Math.floor(reverseY / monitor.totalHeight);
        const nonEmptyCount = world.workspaces.filter(ws => ws.windows.length > 0).length;
        if (wsIndex < 0 || wsIndex >= nonEmptyCount) return null;

        const localY = reverseY - wsIndex * monitor.totalHeight;
        const wsLayout = computeLayoutForWorkspace(world, wsIndex);

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

    private _exitVisual(layout: LayoutState, animate: boolean = true): void {
        this._overviewInputAdapter?.deactivate();
        this._overviewInputAdapter = null;

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
        this._overviewInputAdapter?.destroy();
        this._overviewInputAdapter = null;
        this._preOverviewState = null;
        this._overviewTransform = null;
        this._dragSubject = null;
        this._preDragWorld = null;
    }
}
