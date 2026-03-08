import type { WindowId } from '../domain/world/types.js';
import type { SceneModel } from '../domain/scene/scene.js';

export interface WindowPort {
    setWorkAreaY(workAreaY: number): void;
    setMonitorBounds(minX: number, totalWidth: number): void;
    track(windowId: WindowId, metaWindow: unknown): void;
    untrack(windowId: WindowId): void;
    setWindowFullscreen(windowId: WindowId, isFullscreen: boolean): void;
    applyScene(scene: SceneModel, nudgeUnsettled?: boolean): void;
    hasUnsettledWindows(): boolean;
    destroy(): void;
}
