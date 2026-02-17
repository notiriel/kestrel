import type { WindowId, WorkspaceId, LayoutState } from '../domain/types.js';

export interface OverviewTransform {
    readonly scale: number;
    readonly offsetX: number;
    readonly offsetY: number;
}

/** Tiled clone lifecycle: create, remove, reparent, fullscreen visibility. */
export interface CloneLifecyclePort {
    init(workAreaY: number, monitorHeight: number): void;
    updateWorkArea(workAreaY: number, monitorHeight?: number): void;
    syncWorkspaces(workspaces: readonly { readonly id: WorkspaceId }[]): void;
    addClone(windowId: WindowId, metaWindow: unknown, workspaceId: WorkspaceId): void;
    removeClone(windowId: WindowId): void;
    moveCloneToWorkspace(windowId: WindowId, targetWsId: WorkspaceId): void;
    setWindowFullscreen(windowId: WindowId, isFullscreen: boolean): void;
    destroy(): void;
}

/** Float clone lifecycle: create and remove floating window clones. */
export interface FloatClonePort {
    init(parentLayer: unknown): void;
    addFloatClone(windowId: WindowId, metaWindow: unknown): void;
    removeFloatClone(windowId: WindowId): void;
    destroy(): void;
}

/** Layout rendering: apply positions, scroll, animate. */
export interface CloneRenderPort {
    applyLayout(layout: LayoutState, animate: boolean): void;
    setScroll(scrollX: number): void;
    setScrollForWorkspace(wsId: WorkspaceId, scrollX: number): void;
    animateViewport(targetScrollX: number): void;
}

/** Overview mode rendering: enter, exit, focus updates. */
export interface OverviewRenderPort {
    enterOverview(transform: OverviewTransform, layout: LayoutState, numWorkspaces: number): void;
    exitOverview(layout: LayoutState): void;
    updateOverviewFocus(layout: LayoutState, wsIndex: number, transform: OverviewTransform): void;
}

/** Composite interface for backwards compatibility — consumers should prefer narrow ports. */
export interface ClonePort extends CloneLifecyclePort, CloneRenderPort, OverviewRenderPort {
    addFloatClone(windowId: WindowId, metaWindow: unknown): void;
    removeFloatClone(windowId: WindowId): void;
}
