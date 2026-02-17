import type { WindowId } from '../domain/types.js';

export interface FocusPort {
    track(windowId: WindowId, metaWindow: unknown): void;
    untrack(windowId: WindowId): void;
    focus(windowId: WindowId | null): void;
    getMetaWindow(windowId: WindowId): unknown | undefined;
    connectFocusChanged(callback: (windowId: WindowId) => void): void;
    destroy(): void;
}
