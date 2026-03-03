import type { WindowId, WorkspaceId, WorkspaceColorId } from './types.js';
import type { TiledWindow } from './window.js';

/** A vertical column containing one or more stacked windows. */
export interface Column {
    readonly windows: readonly TiledWindow[];
    readonly slotSpan: number;
}

export interface Workspace {
    readonly id: WorkspaceId;
    readonly columns: readonly Column[];
    readonly name: string | null;
    readonly color: WorkspaceColorId;
}

export function createWorkspace(id: WorkspaceId, name?: string | null, color?: WorkspaceColorId): Workspace {
    const defaultName = `Workspace ${Number(String(id).replace('ws-', '')) + 1}`;
    return { id, columns: [], name: name === undefined ? defaultName : name, color: color ?? null };
}

export function createColumn(window: TiledWindow, slotSpan: number = 1): Column {
    return { windows: [window], slotSpan };
}

/** Append a new column to the workspace. */
export function addColumn(ws: Workspace, column: Column): Workspace {
    return { ...ws, columns: [...ws.columns, column] };
}

/** Remove a window from its column. Removes the column if it becomes empty. */
export function removeWindow(ws: Workspace, windowId: WindowId): Workspace {
    const columns: Column[] = [];
    for (const col of ws.columns) {
        const filtered = col.windows.filter(w => w.id !== windowId);
        if (filtered.length === col.windows.length) {
            columns.push(col);
        } else if (filtered.length > 0) {
            columns.push({ ...col, windows: filtered });
        }
        // else: column became empty, drop it
    }
    return { ...ws, columns };
}

/** Find which column contains a window and return column + index. */
export function columnOf(ws: Workspace, windowId: WindowId): { column: Column; columnIndex: number } | undefined {
    for (let i = 0; i < ws.columns.length; i++) {
        const col = ws.columns[i]!;
        if (col.windows.some(w => w.id === windowId)) {
            return { column: col, columnIndex: i };
        }
    }
    return undefined;
}

/** Get 0-based index of a window within its column's stack. */
export function positionInColumn(column: Column, windowId: WindowId): number {
    return column.windows.findIndex(w => w.id === windowId);
}

/** Get the neighboring column by delta: -1 = before, +1 = after. Returns first window in adjacent column. */
export function columnNeighbor(ws: Workspace, windowId: WindowId, delta: -1 | 1): TiledWindow | undefined {
    const found = columnOf(ws, windowId);
    if (!found) return undefined;
    const targetIdx = found.columnIndex + delta;
    if (targetIdx < 0 || targetIdx >= ws.columns.length) return undefined;
    return ws.columns[targetIdx]!.windows[0];
}

export function columnAfter(ws: Workspace, windowId: WindowId): TiledWindow | undefined {
    return columnNeighbor(ws, windowId, 1);
}

export function columnBefore(ws: Workspace, windowId: WindowId): TiledWindow | undefined {
    return columnNeighbor(ws, windowId, -1);
}

/** Returns the 1-based starting slot index of the column containing a window. */
export function slotIndexOf(ws: Workspace, windowId: WindowId): number {
    let slot = 1;
    for (const col of ws.columns) {
        if (col.windows.some(w => w.id === windowId)) return slot;
        slot += col.slotSpan;
    }
    return -1;
}

/** Swap the column containing the window with its neighbor by delta. */
export function swapColumnNeighbor(ws: Workspace, windowId: WindowId, delta: -1 | 1): Workspace {
    const found = columnOf(ws, windowId);
    if (!found) return ws;
    const idx = found.columnIndex;
    const targetIdx = idx + delta;
    if (targetIdx < 0 || targetIdx >= ws.columns.length) return ws;
    const columns = [...ws.columns];
    [columns[idx], columns[targetIdx]] = [columns[targetIdx]!, columns[idx]!];
    return { ...ws, columns };
}

/** Insert a column at the given index. */
export function insertColumnAt(ws: Workspace, column: Column, index: number): Workspace {
    const columns = [...ws.columns];
    columns.splice(index, 0, column);
    return { ...ws, columns };
}

/** Replace a window by ID inside its column (e.g. to change fullscreen state). */
export function replaceWindow(ws: Workspace, windowId: WindowId, newWindow: TiledWindow): Workspace {
    return {
        ...ws,
        columns: ws.columns.map(col => ({
            ...col,
            windows: col.windows.map(w => w.id === windowId ? newWindow : w),
        })),
    };
}

/** Replace a column's slotSpan. */
export function replaceColumnSlotSpan(ws: Workspace, columnIndex: number, newSpan: number): Workspace {
    return {
        ...ws,
        columns: ws.columns.map((col, i) => i === columnIndex ? { ...col, slotSpan: newSpan } : col),
    };
}

/** Finds the column whose slot range contains the given 1-based slot index. */
export function columnAtSlot(ws: Workspace, slotIndex: number): Column | undefined {
    let slot = 1;
    for (const col of ws.columns) {
        if (slotIndex >= slot && slotIndex < slot + col.slotSpan) return col;
        slot += col.slotSpan;
    }
    return undefined;
}

/** Merge a window's column into the target column (stack). */
export function stackWindowInto(ws: Workspace, windowId: WindowId, targetColumnIndex: number): Workspace {
    const found = columnOf(ws, windowId);
    if (!found) return ws;
    const sourceIdx = found.columnIndex;
    if (sourceIdx === targetColumnIndex) return ws;

    const sourceCol = ws.columns[sourceIdx]!;
    const targetCol = ws.columns[targetColumnIndex]!;

    // Extract the window from source column
    const window = sourceCol.windows.find(w => w.id === windowId);
    if (!window) return ws;

    const remainingSource = sourceCol.windows.filter(w => w.id !== windowId);
    const newTarget: Column = { ...targetCol, windows: [...targetCol.windows, window] };

    const columns = ws.columns
        .map((col, i) => {
            if (i === targetColumnIndex) return newTarget;
            if (i === sourceIdx) {
                return remainingSource.length > 0 ? { ...col, windows: remainingSource } : null;
            }
            return col;
        })
        .filter((col): col is Column => col !== null);

    return { ...ws, columns };
}

/** Pop a window out of its column into a new single-window column to the right. */
export function unstackWindow(ws: Workspace, windowId: WindowId): Workspace {
    const found = columnOf(ws, windowId);
    if (!found) return ws;
    if (found.column.windows.length <= 1) return ws; // nothing to unstack

    const window = found.column.windows.find(w => w.id === windowId);
    if (!window) return ws;

    const remaining = found.column.windows.filter(w => w.id !== windowId);
    const updatedSource: Column = { ...found.column, windows: remaining };
    const newColumn: Column = { windows: [window], slotSpan: 1 };

    const columns = [...ws.columns];
    columns[found.columnIndex] = updatedSource;
    columns.splice(found.columnIndex + 1, 0, newColumn);
    return { ...ws, columns };
}

/** Reorder a window within its column by delta (-1 = up, +1 = down). */
export function reorderInColumn(ws: Workspace, windowId: WindowId, delta: -1 | 1): Workspace {
    const found = columnOf(ws, windowId);
    if (!found) return ws;

    const pos = positionInColumn(found.column, windowId);
    const targetPos = pos + delta;
    if (targetPos < 0 || targetPos >= found.column.windows.length) return ws;

    const windows = [...found.column.windows];
    [windows[pos], windows[targetPos]] = [windows[targetPos]!, windows[pos]!];

    return {
        ...ws,
        columns: ws.columns.map((col, i) => i === found.columnIndex ? { ...col, windows } : col),
    };
}

/** Search all columns for a window by ID. */
export function findWindowInWorkspace(ws: Workspace, windowId: WindowId): TiledWindow | undefined {
    for (const col of ws.columns) {
        const win = col.windows.find(w => w.id === windowId);
        if (win) return win;
    }
    return undefined;
}

/** Check if workspace has any windows. */
export function hasWindows(ws: Workspace): boolean {
    return ws.columns.length > 0;
}

/** Get the first window in the workspace (first window of first column). */
export function firstWindow(ws: Workspace): TiledWindow | undefined {
    return ws.columns[0]?.windows[0];
}

/** Get the last window in the workspace (last window of last column). */
export function lastWindow(ws: Workspace): TiledWindow | undefined {
    const lastCol = ws.columns[ws.columns.length - 1];
    if (!lastCol) return undefined;
    return lastCol.windows[lastCol.windows.length - 1];
}

/** Flat list of all windows across all columns. */
export function allWindows(ws: Workspace): TiledWindow[] {
    return ws.columns.flatMap(c => [...c.windows]);
}
