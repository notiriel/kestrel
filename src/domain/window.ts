import type { WindowId } from './types.js';

export interface TiledWindow {
    readonly id: WindowId;
    readonly slotSpan: 1 | 2;
    readonly fullscreen: boolean;
}

export function createTiledWindow(id: WindowId, slotSpan: 1 | 2 = 1, fullscreen: boolean = false): TiledWindow {
    return { id, slotSpan, fullscreen };
}
