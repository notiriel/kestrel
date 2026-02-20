import type { WindowId, WorkspaceId } from './types.js';
import type { TiledWindow } from './window.js';

export interface Workspace {
    readonly id: WorkspaceId;
    readonly windows: readonly TiledWindow[];
    readonly name: string | null;
}

export function createWorkspace(id: WorkspaceId, name?: string | null): Workspace {
    const defaultName = `Workspace ${Number(String(id).replace('ws-', '')) + 1}`;
    return { id, windows: [], name: name === undefined ? defaultName : name };
}

export function addWindow(ws: Workspace, window: TiledWindow): Workspace {
    return { ...ws, windows: [...ws.windows, window] };
}

export function removeWindow(ws: Workspace, windowId: WindowId): Workspace {
    return { ...ws, windows: ws.windows.filter(w => w.id !== windowId) };
}

/** Get the neighboring window by delta: -1 = before, +1 = after */
export function windowNeighbor(ws: Workspace, windowId: WindowId, delta: -1 | 1): TiledWindow | undefined {
    const idx = ws.windows.findIndex(w => w.id === windowId);
    const targetIdx = idx + delta;
    if (idx === -1 || targetIdx < 0 || targetIdx >= ws.windows.length) return undefined;
    return ws.windows[targetIdx];
}

export function windowAfter(ws: Workspace, windowId: WindowId): TiledWindow | undefined {
    return windowNeighbor(ws, windowId, 1);
}

export function windowBefore(ws: Workspace, windowId: WindowId): TiledWindow | undefined {
    return windowNeighbor(ws, windowId, -1);
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

/** Swap a window with its neighbor by delta: -1 = prev, +1 = next */
export function swapNeighbor(ws: Workspace, windowId: WindowId, delta: -1 | 1): Workspace {
    const idx = ws.windows.findIndex(w => w.id === windowId);
    const targetIdx = idx + delta;
    if (idx === -1 || targetIdx < 0 || targetIdx >= ws.windows.length) return ws;
    const windows = [...ws.windows];
    [windows[idx], windows[targetIdx]] = [windows[targetIdx]!, windows[idx]!];
    return { ...ws, windows };
}

/** Swap a window with the one after it; return unchanged ws if at end. */
export function swapWithNext(ws: Workspace, windowId: WindowId): Workspace {
    return swapNeighbor(ws, windowId, 1);
}

/** Swap a window with the one before it; return unchanged ws if at start. */
export function swapWithPrev(ws: Workspace, windowId: WindowId): Workspace {
    return swapNeighbor(ws, windowId, -1);
}

/** Insert a window at the given index. */
export function insertWindowAt(ws: Workspace, window: TiledWindow, index: number): Workspace {
    const windows = [...ws.windows];
    windows.splice(index, 0, window);
    return { ...ws, windows };
}

/** Replace a window by ID (e.g. to change slotSpan). */
export function replaceWindow(ws: Workspace, windowId: WindowId, newWindow: TiledWindow): Workspace {
    return { ...ws, windows: ws.windows.map(w => w.id === windowId ? newWindow : w) };
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
