import type { WindowId, WorkspaceId } from './types.js';
import type { TiledWindow } from './window.js';

export interface Workspace {
    readonly id: WorkspaceId;
    readonly windows: readonly TiledWindow[];
    readonly name: string | null;
}

export function createWorkspace(id: WorkspaceId, name: string | null = null): Workspace {
    return { id, windows: [], name };
}

export function addWindow(ws: Workspace, window: TiledWindow): Workspace {
    return { ...ws, windows: [...ws.windows, window] };
}

export function removeWindow(ws: Workspace, windowId: WindowId): Workspace {
    return { ...ws, windows: ws.windows.filter(w => w.id !== windowId) };
}

export function windowAfter(ws: Workspace, windowId: WindowId): TiledWindow | undefined {
    const idx = ws.windows.findIndex(w => w.id === windowId);
    if (idx === -1 || idx >= ws.windows.length - 1) return undefined;
    return ws.windows[idx + 1];
}

export function windowBefore(ws: Workspace, windowId: WindowId): TiledWindow | undefined {
    const idx = ws.windows.findIndex(w => w.id === windowId);
    if (idx <= 0) return undefined;
    return ws.windows[idx - 1];
}

/** Returns the 1-based starting slot index of a window within its workspace. */
export function slotIndexOf(ws: Workspace, windowId: WindowId): number {
    let slot = 1;
    for (const w of ws.windows) {
        if (w.id === windowId) return slot;
        slot += w.slotSpan;
    }
    return -1;
}

/** Finds the window whose slot range contains the given 1-based slot index. */
export function windowAtSlot(ws: Workspace, slotIndex: number): TiledWindow | undefined {
    let slot = 1;
    for (const w of ws.windows) {
        if (slotIndex >= slot && slotIndex < slot + w.slotSpan) return w;
        slot += w.slotSpan;
    }
    return undefined;
}
