import { describe, it, expect } from 'vitest';
import type { WindowId, WorkspaceId } from '../../src/domain/types.js';
import {
    createWorkspace, addColumn, createColumn, slotIndexOf, columnAtSlot,
    columnOf, positionInColumn, stackWindowInto, unstackWindow, reorderInColumn,
    allWindows,
} from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';

function wid(n: number): WindowId {
    return `win-${n}` as WindowId;
}

function wsId(n: number): WorkspaceId {
    return `ws-${n}` as WorkspaceId;
}

describe('slotIndexOf', () => {
    it('returns 1-based index for single-slot columns', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(3))));

        expect(slotIndexOf(ws, wid(1))).toBe(1);
        expect(slotIndexOf(ws, wid(2))).toBe(2);
        expect(slotIndexOf(ws, wid(3))).toBe(3);
    });

    it('accounts for double-slot columns', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1)), 2));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(3))));

        expect(slotIndexOf(ws, wid(1))).toBe(1);
        expect(slotIndexOf(ws, wid(2))).toBe(3);
        expect(slotIndexOf(ws, wid(3))).toBe(4);
    });

    it('returns -1 for unknown window', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        expect(slotIndexOf(ws, wid(99))).toBe(-1);
    });

    it('returns -1 for empty workspace', () => {
        const ws = createWorkspace(wsId(0));
        expect(slotIndexOf(ws, wid(1))).toBe(-1);
    });
});

describe('columnAtSlot', () => {
    it('finds column at exact slot', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(3))));

        expect(columnAtSlot(ws, 1)?.windows[0]!.id).toBe(wid(1));
        expect(columnAtSlot(ws, 2)?.windows[0]!.id).toBe(wid(2));
        expect(columnAtSlot(ws, 3)?.windows[0]!.id).toBe(wid(3));
    });

    it('finds double-width column when slot falls within its span', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1)), 2));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));

        expect(columnAtSlot(ws, 1)?.windows[0]!.id).toBe(wid(1));
        expect(columnAtSlot(ws, 2)?.windows[0]!.id).toBe(wid(1));
        expect(columnAtSlot(ws, 3)?.windows[0]!.id).toBe(wid(2));
    });

    it('returns undefined for slot beyond range', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        expect(columnAtSlot(ws, 5)).toBeUndefined();
    });

    it('returns undefined for empty workspace', () => {
        const ws = createWorkspace(wsId(0));
        expect(columnAtSlot(ws, 1)).toBeUndefined();
    });
});

describe('columnOf', () => {
    it('finds the column containing a window', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));

        const result = columnOf(ws, wid(2));
        expect(result).toBeDefined();
        expect(result!.columnIndex).toBe(1);
        expect(result!.column.windows[0]!.id).toBe(wid(2));
    });

    it('returns undefined for unknown window', () => {
        const ws = createWorkspace(wsId(0));
        expect(columnOf(ws, wid(99))).toBeUndefined();
    });
});

describe('positionInColumn', () => {
    it('returns 0-based index within a stack', () => {
        const col = {
            windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2)), createTiledWindow(wid(3))],
            slotSpan: 1,
        };
        expect(positionInColumn(col, wid(1))).toBe(0);
        expect(positionInColumn(col, wid(2))).toBe(1);
        expect(positionInColumn(col, wid(3))).toBe(2);
    });
});

describe('stackWindowInto', () => {
    it('merges a window into the left neighbor column', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(3))));

        ws = stackWindowInto(ws, wid(2), 0);
        expect(ws.columns).toHaveLength(2);
        expect(ws.columns[0]!.windows.map(w => w.id)).toEqual([wid(1), wid(2)]);
        expect(ws.columns[1]!.windows[0]!.id).toBe(wid(3));
    });
});

describe('unstackWindow', () => {
    it('pops a window out of its column into a new column', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, { windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2))], slotSpan: 1 });
        ws = addColumn(ws, createColumn(createTiledWindow(wid(3))));

        ws = unstackWindow(ws, wid(2));
        expect(ws.columns).toHaveLength(3);
        expect(ws.columns[0]!.windows.map(w => w.id)).toEqual([wid(1)]);
        expect(ws.columns[1]!.windows.map(w => w.id)).toEqual([wid(2)]);
        expect(ws.columns[2]!.windows.map(w => w.id)).toEqual([wid(3)]);
    });

    it('is no-op for single-window column', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        const result = unstackWindow(ws, wid(1));
        expect(result).toBe(ws);
    });
});

describe('reorderInColumn', () => {
    it('swaps window with neighbor below', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, { windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2))], slotSpan: 1 });

        ws = reorderInColumn(ws, wid(1), 1);
        expect(ws.columns[0]!.windows.map(w => w.id)).toEqual([wid(2), wid(1)]);
    });

    it('is no-op at boundary', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, { windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2))], slotSpan: 1 });

        const result = reorderInColumn(ws, wid(2), 1);
        expect(result).toBe(ws);
    });
});

describe('allWindows', () => {
    it('returns flat list of all windows', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, { windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2))], slotSpan: 1 });
        ws = addColumn(ws, createColumn(createTiledWindow(wid(3))));

        const ids = allWindows(ws).map(w => w.id);
        expect(ids).toEqual([wid(1), wid(2), wid(3)]);
    });
});
