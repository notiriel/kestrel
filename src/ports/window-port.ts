import type { WindowId, LayoutState } from '../domain/types.js';

export interface WindowPort {
    setWorkAreaY(workAreaY: number): void;
    setMonitorBounds(minX: number, totalWidth: number): void;
    track(windowId: WindowId, metaWindow: unknown): void;
    untrack(windowId: WindowId): void;
    setWindowFullscreen(windowId: WindowId, isFullscreen: boolean): void;
    applyLayout(layout: LayoutState, nudgeUnsettled?: boolean): void;
    hasUnsettledWindows(): boolean;
    destroy(): void;
}
