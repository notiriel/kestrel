import type { WindowId } from './types.js';

export interface TiledWindow {
    readonly id: WindowId;
    readonly fullscreen: boolean;
}

export function createTiledWindow(id: WindowId, fullscreen: boolean = false): TiledWindow {
    return { id, fullscreen };
}
