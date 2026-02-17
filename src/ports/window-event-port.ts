import type { WindowId } from '../domain/types.js';

export interface WindowEventCallbacks {
    onWindowReady: (windowId: WindowId, metaWindow: unknown) => void;
    onWindowDestroyed: (windowId: WindowId) => void;
    onFloatWindowReady: (windowId: WindowId, metaWindow: unknown) => void;
    onFloatWindowDestroyed: (windowId: WindowId) => void;
    onWindowFullscreenChanged: (windowId: WindowId, isFullscreen: boolean) => void;
    onWindowMaximized: (windowId: WindowId) => void;
}

export interface WindowEventPort {
    connect(callbacks: WindowEventCallbacks): void;
    enumerateExisting(): void;
    destroy(): void;
}
