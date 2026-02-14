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

export function findWindow(ws: Workspace, windowId: WindowId): TiledWindow | undefined {
    return ws.windows.find(w => w.id === windowId);
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
