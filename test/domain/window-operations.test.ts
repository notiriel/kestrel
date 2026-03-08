import { describe, it, expect } from 'vitest';
import { createTodoState } from '../../src/domain/world/todo.js';
import type { KestrelConfig, MonitorInfo, WindowId, WorkspaceId } from '../../src/domain/world/types.js';
import { moveRight, moveLeft, moveDown, moveUp, toggleSize, toggleStack } from '../../src/domain/world/window-operations.js';
import { createWorkspace, addColumn, createColumn } from '../../src/domain/world/workspace.js';
import { createTiledWindow } from '../../src/domain/world/window.js';
import type { World } from '../../src/domain/world/world.js';
import { createNotificationState } from '../../src/domain/world/notification.js';
import { createOverviewInteractionState } from '../../src/domain/world/overview-state.js';

const config: KestrelConfig = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(125,214,164,0.05)', columnCount: 2, quakeSlots: [], quakeWidthPercent: 80, quakeHeightPercent: 80 };
const monitor: MonitorInfo = {
    count: 1,
    totalWidth: 1920,
    totalHeight: 1080,
    slotWidth: 960,
    workAreaY: 0,
    stageOffsetX: 0,
};

function wid(n: number): WindowId {
    return `win-${n}` as WindowId;
}

function wsId(n: number): WorkspaceId {
    return `ws-${n}` as WorkspaceId;
}

/** Helper: extract all window IDs from a workspace's columns */
function windowIds(ws: { columns: readonly { windows: readonly { id: WindowId }[] }[] }): WindowId[] {
    return ws.columns.flatMap(c => c.windows.map(w => w.id));
}

function makeWorld(windowIds_: number[], focusedIdx: number, scrollX = 0): World {
    let ws = createWorkspace(wsId(0));
    for (const id of windowIds_) {
        ws = addColumn(ws, createColumn(createTiledWindow(wid(id))));
    }
    return {
        workspaces: [ws],
        viewport: { workspaceIndex: 0, scrollX, widthPx: monitor.totalWidth },
        focusedWindow: windowIds_.length > 0 ? wid(windowIds_[focusedIdx]!) : null,
        config,
        monitor,
        overviewActive: false,
        overviewInteractionState: createOverviewInteractionState(),
        notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null], activeSlot: null },
        todoState: createTodoState(),
    };
}

function makeMultiWorld(
    workspaceWindows: number[][],
    focusedWsIndex: number,
    focusedWindowId: number | null,
): World {
    const workspaces = workspaceWindows.map((ids, i) => {
        let ws = createWorkspace(wsId(i));
        for (const id of ids) {
            ws = addColumn(ws, createColumn(createTiledWindow(wid(id))));
        }
        return ws;
    });
    return {
        workspaces,
        viewport: { workspaceIndex: focusedWsIndex, scrollX: 0, widthPx: monitor.totalWidth },
        focusedWindow: focusedWindowId !== null ? wid(focusedWindowId) : null,
        config,
        monitor,
        overviewActive: false,
        overviewInteractionState: createOverviewInteractionState(),
        notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null], activeSlot: null },
        todoState: createTodoState(),
    };
}

describe('moveRight', () => {
    it('swaps focused column with the one to its right', () => {
        const world = makeWorld([1, 2, 3], 0);
        const update = moveRight(world);
        const ids = windowIds(update.world.workspaces[0]!);
        expect(ids).toEqual([wid(2), wid(1), wid(3)]);
        expect(update.world.focusedWindow).toBe(wid(1));
    });

    it('is no-op at rightmost column', () => {
        const world = makeWorld([1, 2, 3], 2);
        const update = moveRight(world);
        const ids = windowIds(update.world.workspaces[0]!);
        expect(ids).toEqual([wid(1), wid(2), wid(3)]);
    });

    it('preserves focus after swap', () => {
        const world = makeWorld([1, 2], 0);
        const update = moveRight(world);
        expect(update.world.focusedWindow).toBe(wid(1));
    });

    it('adjusts viewport when swap moves column off-screen', () => {
        const world = makeWorld([1, 2, 3], 1);
        const update = moveRight(world);
        expect(update.world.focusedWindow).toBe(wid(2));
        expect(update.world.viewport.scrollX).toBe(968);
    });

    it('is no-op with no focused window', () => {
        const world = { ...makeWorld([1, 2], 0), focusedWindow: null };
        const update = moveRight(world);
        const ids = windowIds(update.world.workspaces[0]!);
        expect(ids).toEqual([wid(1), wid(2)]);
    });
});

describe('moveLeft', () => {
    it('swaps focused column with the one to its left', () => {
        const world = makeWorld([1, 2, 3], 1);
        const update = moveLeft(world);
        const ids = windowIds(update.world.workspaces[0]!);
        expect(ids).toEqual([wid(2), wid(1), wid(3)]);
        expect(update.world.focusedWindow).toBe(wid(2));
    });

    it('is no-op at leftmost column', () => {
        const world = makeWorld([1, 2, 3], 0);
        const update = moveLeft(world);
        const ids = windowIds(update.world.workspaces[0]!);
        expect(ids).toEqual([wid(1), wid(2), wid(3)]);
    });
});

describe('moveDown', () => {
    it('moves window to workspace below with slot-based insertion', () => {
        const world = makeMultiWorld([[1, 2], [3, 4], []], 0, 1);
        const update = moveDown(world);
        const ws0 = windowIds(update.world.workspaces[0]!);
        const ws1 = windowIds(update.world.workspaces[1]!);
        expect(ws0).toEqual([wid(2)]);
        expect(ws1).toEqual([wid(1), wid(3), wid(4)]);
        expect(update.world.focusedWindow).toBe(wid(1));
        expect(update.world.viewport.workspaceIndex).toBe(1);
    });

    it('moves window to empty trailing workspace', () => {
        const world = makeMultiWorld([[1, 2], []], 0, 1);
        const update = moveDown(world);
        const ws1Windows = windowIds(update.world.workspaces[1]!);
        expect(ws1Windows).toEqual([wid(1)]);
        expect(update.world.focusedWindow).toBe(wid(1));
    });

    it('prunes source workspace if it becomes empty', () => {
        const world = makeMultiWorld([[1], [2], []], 0, 1);
        const update = moveDown(world);
        expect(update.world.workspaces.length).toBe(2);
        const ws0 = windowIds(update.world.workspaces[0]!);
        expect(ws0).toEqual([wid(1), wid(2)]);
        expect(update.world.viewport.workspaceIndex).toBe(0);
    });

    it('is no-op at last workspace (trailing empty)', () => {
        const world = makeMultiWorld([[1, 2], []], 1, null);
        const update = moveDown(world);
        expect(update.world.viewport.workspaceIndex).toBe(1);
    });

    it('appends when target slot is past all columns in target workspace', () => {
        const world = makeMultiWorld([[1, 2], [3], []], 0, 2);
        const update = moveDown(world);
        const ws1 = windowIds(update.world.workspaces[1]!);
        expect(ws1).toEqual([wid(3), wid(2)]);
    });

    it('reorders within stack before moving to workspace', () => {
        // Column with [A, B], B focused. moveDown should reorder, not move to workspace.
        let ws0 = createWorkspace(wsId(0));
        ws0 = addColumn(ws0, { windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2))], slotSpan: 1 });
        const ws1 = createWorkspace(wsId(1));
        const world: World = {
            workspaces: [ws0, ws1],
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
            focusedWindow: wid(1), // top of stack
            config,
            monitor,
            overviewActive: false,
            overviewInteractionState: createOverviewInteractionState(),
            notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null], activeSlot: null },
        todoState: createTodoState(),
        };
        const update = moveDown(world);
        // Should reorder within stack
        expect(update.world.viewport.workspaceIndex).toBe(0);
        expect(update.world.workspaces[0]!.columns[0]!.windows.map(w => w.id)).toEqual([wid(2), wid(1)]);
    });
});

describe('moveUp', () => {
    it('moves window to workspace above with slot-based insertion', () => {
        const world = makeMultiWorld([[1, 2], [3, 4], []], 1, 3);
        const update = moveUp(world);
        const ws0 = windowIds(update.world.workspaces[0]!);
        const ws1 = windowIds(update.world.workspaces[1]!);
        expect(ws0).toEqual([wid(3), wid(1), wid(2)]);
        expect(ws1).toEqual([wid(4)]);
        expect(update.world.focusedWindow).toBe(wid(3));
        expect(update.world.viewport.workspaceIndex).toBe(0);
    });

    it('is no-op at top workspace', () => {
        const world = makeMultiWorld([[1, 2], []], 0, 1);
        const update = moveUp(world);
        expect(update.world.viewport.workspaceIndex).toBe(0);
        expect(update.world.focusedWindow).toBe(wid(1));
    });

    it('round-trip: moveDown then moveUp restores order', () => {
        const world = makeMultiWorld([[1, 2], [3, 4], []], 0, 1);
        const down = moveDown(world);
        expect(down.world.focusedWindow).toBe(wid(1));
        const up = moveUp(down.world);
        const ws0 = windowIds(up.world.workspaces[0]!);
        expect(ws0[0]).toBe(wid(1));
        expect(up.world.viewport.workspaceIndex).toBe(0);
    });
});

describe('toggleSize', () => {
    it('toggles column slotSpan from 1 to columnCount', () => {
        const world = makeWorld([1, 2], 0);
        const update = toggleSize(world);
        const col = update.world.workspaces[0]!.columns.find(c =>
            c.windows.some(w => w.id === wid(1)),
        );
        expect(col?.slotSpan).toBe(2); // columnCount is 2
    });

    it('toggles column slotSpan from columnCount back to 1', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1)), 2));
        const world: World = {
            workspaces: [ws],
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
            focusedWindow: wid(1),
            config,
            monitor,
            overviewActive: false,
            overviewInteractionState: createOverviewInteractionState(),
            notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null], activeSlot: null },
        todoState: createTodoState(),
        };
        const update = toggleSize(world);
        const col = update.world.workspaces[0]!.columns.find(c =>
            c.windows.some(w => w.id === wid(1)),
        );
        expect(col?.slotSpan).toBe(1);
    });

    it('adjusts viewport after resize', () => {
        const world = makeWorld([1, 2, 3], 2);
        const update = toggleSize(world);
        expect(update.world.viewport.scrollX).toBeGreaterThan(0);
    });

    it('is no-op with no focused window', () => {
        const world = { ...makeWorld([1, 2], 0), focusedWindow: null };
        const update = toggleSize(world);
        const col = update.world.workspaces[0]!.columns[0];
        expect(col?.slotSpan).toBe(1);
    });
});

describe('toggleStack', () => {
    it('stacks window with left neighbor', () => {
        const world = makeWorld([1, 2, 3], 1); // focus on wid(2)
        const update = toggleStack(world);
        // wid(2) should merge into col containing wid(1)
        expect(update.world.workspaces[0]!.columns).toHaveLength(2);
        expect(update.world.workspaces[0]!.columns[0]!.windows.map(w => w.id)).toEqual([wid(1), wid(2)]);
        expect(update.world.workspaces[0]!.columns[1]!.windows[0]!.id).toBe(wid(3));
    });

    it('unstacks window from multi-window column', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, { windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2))], slotSpan: 1 });
        ws = addColumn(ws, createColumn(createTiledWindow(wid(3))));
        const world: World = {
            workspaces: [ws],
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
            focusedWindow: wid(2),
            config,
            monitor,
            overviewActive: false,
            overviewInteractionState: createOverviewInteractionState(),
            notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null], activeSlot: null },
        todoState: createTodoState(),
        };
        const update = toggleStack(world);
        expect(update.world.workspaces[0]!.columns).toHaveLength(3);
        expect(windowIds(update.world.workspaces[0]!)).toEqual([wid(1), wid(2), wid(3)]);
    });

    it('is no-op when no left neighbor for stacking', () => {
        const world = makeWorld([1, 2], 0); // focus on leftmost
        const update = toggleStack(world);
        expect(update.world.workspaces[0]!.columns).toHaveLength(2);
    });
});

describe('overviewActive guard', () => {
    it('moveRight is no-op when overview is active', () => {
        const world = { ...makeWorld([1, 2, 3], 0), overviewActive: true };
        const update = moveRight(world);
        expect(update.world).toBe(world);
    });

    it('moveLeft is no-op when overview is active', () => {
        const world = { ...makeWorld([1, 2, 3], 2), overviewActive: true };
        const update = moveLeft(world);
        expect(update.world).toBe(world);
    });

    it('moveDown is no-op when overview is active', () => {
        const world = { ...makeMultiWorld([[1], [2], []], 0, 1), overviewActive: true };
        const update = moveDown(world);
        expect(update.world).toBe(world);
    });

    it('moveUp is no-op when overview is active', () => {
        const world = { ...makeMultiWorld([[1], [2], []], 1, 2), overviewActive: true };
        const update = moveUp(world);
        expect(update.world).toBe(world);
    });

    it('toggleSize is no-op when overview is active', () => {
        const world = { ...makeWorld([1, 2], 0), overviewActive: true };
        const update = toggleSize(world);
        expect(update.world).toBe(world);
    });

    it('toggleStack is no-op when overview is active', () => {
        const world = { ...makeWorld([1, 2], 1), overviewActive: true };
        const update = toggleStack(world);
        expect(update.world).toBe(world);
    });
});
