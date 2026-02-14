import type { WindowId } from './types.js';

export interface TiledWindow {
    readonly id: WindowId;
    readonly slotSpan: 1 | 2;
}

export function createTiledWindow(id: WindowId, slotSpan: 1 | 2 = 1): TiledWindow {
    return { id, slotSpan };
}
