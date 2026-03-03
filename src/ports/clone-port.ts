import type { WindowId, WorkspaceId, WorkspaceColorId, KestrelConfig } from '../domain/types.js';
import type { SceneModel } from '../domain/scene.js';
import type { OverviewTransform } from '../domain/overview-state.js';

export type { OverviewTransform } from '../domain/overview-state.js';

/** Tiled clone lifecycle: create, remove, reparent, fullscreen visibility. */
export interface CloneLifecyclePort {
    init(workAreaY: number, monitorHeight: number, config?: KestrelConfig): void;
    updateWorkArea(workAreaY: number, monitorHeight?: number): void;
    updateConfig?(config: KestrelConfig): void;
    syncWorkspaces(workspaces: readonly { readonly id: WorkspaceId; readonly name?: string | null }[]): void;
    updateWorkspaceName?(wsId: WorkspaceId, name: string | null): void;
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
    applyScene(scene: SceneModel, animate: boolean): void;
    setScroll(scrollX: number): void;
    setScrollForWorkspace(wsId: WorkspaceId, scrollX: number): void;
    animateViewport(targetScrollX: number): void;
}

/** Overview mode rendering: enter, exit, focus updates. */
export interface OverviewRenderPort {
    enterOverview(transform: OverviewTransform, scene: SceneModel, numWorkspaces: number, onComplete?: () => void): void;
    exitOverview(scene: SceneModel, animate?: boolean): void;
    updateOverviewFocus(scene: SceneModel, wsIndex: number, transform: OverviewTransform): void;
}

/** Overview filter and rename rendering. All methods optional for backwards compatibility. */
export interface OverviewFilterPort {
    applyOverviewFilter?(visibleIndices: number[] | null, transform: OverviewTransform, currentWsIndex: number): void;
    updateFilterIndicator?(text: string): void;
    startRename?(wsIndex: number, currentName: string, transform: OverviewTransform, callback: (name: string | null) => void): void;
    cancelRename?(): void;
    startColorPick?(wsIndex: number, currentColor: WorkspaceColorId, transform: OverviewTransform, onComplete: (color: WorkspaceColorId) => void): void;
    handleColorPickClick?(stageX: number, stageY: number): boolean;
    cancelColorPick?(): void;
}

/** Composite interface for backwards compatibility — consumers should prefer narrow ports. */
export interface ClonePort extends CloneLifecyclePort, CloneRenderPort, OverviewRenderPort, OverviewFilterPort {
    addFloatClone(windowId: WindowId, metaWindow: unknown): void;
    removeFloatClone(windowId: WindowId): void;
}
