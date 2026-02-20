import type { WindowId } from '../domain/types.js';

export interface FocusPort {
    track(windowId: WindowId, metaWindow: unknown): void;
    untrack(windowId: WindowId): void;
    focus(windowId: WindowId | null): void;
    getMetaWindow(windowId: WindowId): unknown | undefined;
    openNewWindow(windowId: WindowId): void;
    connectFocusChanged(callback: (windowId: WindowId) => void): void;
    destroy(): void;
}
