import type { WindowId, LayoutState, WorldUpdate } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { setFocus } from '../domain/world.js';
import { focusRight, focusLeft, focusDown, focusUp } from '../domain/navigation.js';
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
}

export class OverviewHandler {
    private _deps: OverviewDeps;
    private _preOverviewState: { focusedWindow: WindowId | null; viewport: { workspaceIndex: number; scrollX: number } } | null = null;
    private _overviewTransform: OverviewTransform | null = null;
    private _overviewInputAdapter: OverviewInputAdapter | null = null;

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
            console.error('[PaperFlow] Error handling toggle overview:', e);
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

        this._overviewInputAdapter = this._deps.createOverviewInputAdapter();
        this._overviewInputAdapter.activate({
            onNavigate: (dir) => this._handleNavigate(dir),
            onConfirm: () => this.handleConfirm(),
            onCancel: () => this.handleCancel(),
            onClick: (x, y) => this._handleClick(x, y),
        });

        console.log('[PaperFlow] Entered overview');
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
            console.error('[PaperFlow] Error handling overview navigate:', e);
        }
    }

    handleConfirm(): void {
        try {
            const world = this._deps.getWorld();
            if (!world) return;

            const update = exitOverview(world);
            this._deps.setWorld(update.world);

            this._exitVisual(update.layout);
            console.log('[PaperFlow] Exited overview (confirm)');
        } catch (e) {
            console.error('[PaperFlow] Error handling overview confirm:', e);
        }
    }

    handleCancel(): void {
        try {
            const world = this._deps.getWorld();
            if (!world || !this._preOverviewState) return;

            const update = cancelOverview(
                world,
                this._preOverviewState.focusedWindow,
                this._preOverviewState.viewport.workspaceIndex,
                this._preOverviewState.viewport.scrollX,
            );
            this._deps.setWorld(update.world);

            this._exitVisual(update.layout);
            console.log('[PaperFlow] Exited overview (cancel)');
        } catch (e) {
            console.error('[PaperFlow] Error handling overview cancel:', e);
        }
    }

    private _handleClick(x: number, y: number): void {
        try {
            const world = this._deps.getWorld();
            if (!world || !this._overviewTransform) return;

            const { scale, offsetX, offsetY } = this._overviewTransform;
            const monitor = world.monitor;

            const reverseX = (x - offsetX) / scale;
            const reverseY = (y - offsetY) / scale;

            const wsIndex = Math.floor(reverseY / monitor.totalHeight);
            const nonEmptyCount = world.workspaces.filter(ws => ws.windows.length > 0).length;
            if (wsIndex < 0 || wsIndex >= nonEmptyCount) return;

            const localY = reverseY - wsIndex * monitor.totalHeight;
            const wsLayout = computeLayoutForWorkspace(world, wsIndex);

            let hitWindowId: WindowId | null = null;
            for (const win of wsLayout.windows) {
                if (reverseX >= win.x && reverseX <= win.x + win.width &&
                    localY >= win.y && localY <= win.y + win.height) {
                    hitWindowId = win.windowId;
                    break;
                }
            }

            if (!hitWindowId) return;

            const update = setFocus(world, hitWindowId);
            this._deps.setWorld(update.world);
            this.handleConfirm();
        } catch (e) {
            console.error('[PaperFlow] Error handling overview click:', e);
        }
    }

    private _exitVisual(layout: LayoutState): void {
        this._overviewInputAdapter?.deactivate();
        this._overviewInputAdapter = null;

        this._deps.getCloneAdapter()?.exitOverview(layout);
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

        const scaleX = monitor.totalWidth / maxWsWidth;
        const scaleY = monitor.totalHeight / stripHeight;
        const scale = Math.min(scaleX, scaleY, 1);

        const scaledWidth = maxWsWidth * scale;
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
    }
}
