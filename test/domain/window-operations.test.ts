import { describe, it, expect } from 'vitest';
import type { KestrelConfig, MonitorInfo, WindowId, WorkspaceId } from '../../src/domain/types.js';
import { moveRight, moveLeft, moveDown, moveUp, toggleSize } from '../../src/domain/window-operations.js';
import { createWorkspace, addWindow } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';
import type { World } from '../../src/domain/world.js';

const config: KestrelConfig = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(255,255,255,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(255,255,255,0.05)' };
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

function makeWorld(windowIds: number[], focusedIdx: number, scrollX = 0): World {
    let ws = createWorkspace(wsId(0));
    for (const id of windowIds) {
        ws = addWindow(ws, createTiledWindow(wid(id)));
    }
    return {
        workspaces: [ws],
        viewport: { workspaceIndex: 0, scrollX, widthPx: monitor.totalWidth },
        focusedWindow: windowIds.length > 0 ? wid(windowIds[focusedIdx]!) : null,
        config,
        monitor,
        overviewActive: false,
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
            ws = addWindow(ws, createTiledWindow(wid(id)));
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
    };
}

describe('moveRight', () => {
    it('swaps focused window with the one to its right', () => {
        const world = makeWorld([1, 2, 3], 0);
        const update = moveRight(world);
        const ids = update.world.workspaces[0]!.windows.map(w => w.id);
        expect(ids).toEqual([wid(2), wid(1), wid(3)]);
        expect(update.world.focusedWindow).toBe(wid(1));
    });

    it('is no-op at rightmost window', () => {
        const world = makeWorld([1, 2, 3], 2);
        const update = moveRight(world);
        const ids = update.world.workspaces[0]!.windows.map(w => w.id);
        expect(ids).toEqual([wid(1), wid(2), wid(3)]);
    });

    it('preserves focus after swap', () => {
        const world = makeWorld([1, 2], 0);
        const update = moveRight(world);
        expect(update.world.focusedWindow).toBe(wid(1));
    });

    it('adjusts viewport when swap moves window off-screen', () => {
        // 3 windows, focus on win-2 (middle), swap right → win-2 goes to index 2
        const world = makeWorld([1, 2, 3], 1);
        const update = moveRight(world);
        expect(update.world.focusedWindow).toBe(wid(2));
        // win-2 is now at position 2 (x=1928, right=2880)
        // Viewport should scroll to keep it visible
        expect(update.world.viewport.scrollX).toBe(968);
    });

    it('is no-op with no focused window', () => {
        const world = { ...makeWorld([1, 2], 0), focusedWindow: null };
        const update = moveRight(world);
        const ids = update.world.workspaces[0]!.windows.map(w => w.id);
        expect(ids).toEqual([wid(1), wid(2)]);
    });
});

describe('moveLeft', () => {
    it('swaps focused window with the one to its left', () => {
        const world = makeWorld([1, 2, 3], 1);
        const update = moveLeft(world);
        const ids = update.world.workspaces[0]!.windows.map(w => w.id);
        expect(ids).toEqual([wid(2), wid(1), wid(3)]);
        expect(update.world.focusedWindow).toBe(wid(2));
    });

    it('is no-op at leftmost window', () => {
        const world = makeWorld([1, 2, 3], 0);
        const update = moveLeft(world);
        const ids = update.world.workspaces[0]!.windows.map(w => w.id);
        expect(ids).toEqual([wid(1), wid(2), wid(3)]);
    });
});

describe('moveDown', () => {
    it('moves window to workspace below with slot-based insertion', () => {
        // ws0: [1, 2] focus on 1, ws1: [3, 4], ws2: []
        const world = makeMultiWorld([[1, 2], [3, 4], []], 0, 1);
        const update = moveDown(world);
        // win-1 was at slot 1, inserts before win-3 (slot 1) in ws1
        const ws0 = update.world.workspaces[0]!.windows.map(w => w.id);
        const ws1 = update.world.workspaces[1]!.windows.map(w => w.id);
        expect(ws0).toEqual([wid(2)]);
        expect(ws1).toEqual([wid(1), wid(3), wid(4)]);
        expect(update.world.focusedWindow).toBe(wid(1));
        expect(update.world.viewport.workspaceIndex).toBe(1);
    });

    it('moves window to empty trailing workspace', () => {
        const world = makeMultiWorld([[1, 2], []], 0, 1);
        const update = moveDown(world);
        // win-1 goes to what was the trailing empty
        const ws1Windows = update.world.workspaces[1]!.windows.map(w => w.id);
        expect(ws1Windows).toEqual([wid(1)]);
        expect(update.world.focusedWindow).toBe(wid(1));
    });

    it('prunes source workspace if it becomes empty', () => {
        // ws0: [1] (only window), ws1: [2], ws2: []
        const world = makeMultiWorld([[1], [2], []], 0, 1);
        const update = moveDown(world);
        // ws0 empties → pruned. ws1 becomes ws0.
        // win-1 inserted before win-2 at slot 1
        expect(update.world.workspaces.length).toBe(2); // one populated + trailing empty
        const ws0 = update.world.workspaces[0]!.windows.map(w => w.id);
        expect(ws0).toEqual([wid(1), wid(2)]);
        expect(update.world.viewport.workspaceIndex).toBe(0);
    });

    it('is no-op at last workspace (trailing empty)', () => {
        const world = makeMultiWorld([[1, 2], []], 1, null);
        const update = moveDown(world);
        expect(update.world.viewport.workspaceIndex).toBe(1);
    });

    it('appends when target slot is past all windows in target workspace', () => {
        // ws0: [1, 2] focus on 2 (slot 2), ws1: [3] (only slot 1), ws2: []
        const world = makeMultiWorld([[1, 2], [3], []], 0, 2);
        const update = moveDown(world);
        // slot 2 has no match in ws1 → append
        const ws1 = update.world.workspaces[1]!.windows.map(w => w.id);
        expect(ws1).toEqual([wid(3), wid(2)]);
    });

    it('handles double-width windows correctly', () => {
        // ws0 has a double-width win-1, ws1 has [2, 3], ws2: []
        let ws0 = createWorkspace(wsId(0));
        ws0 = addWindow(ws0, createTiledWindow(wid(1), 2));
        const world = makeMultiWorld([[], [2, 3], []], 0, 1);
        // Replace ws0 with our custom one
        const customWorld: World = { ...world, workspaces: [ws0, world.workspaces[1]!, world.workspaces[2]!] };
        const update = moveDown(customWorld);
        // win-1 (slotSpan 2) at slot 1, targets slot 1 in ws1 → before win-2
        const ws1 = update.world.workspaces[0]!.windows.map(w => w.id);
        expect(ws1).toContain(wid(1));
    });
});

describe('moveUp', () => {
    it('moves window to workspace above with slot-based insertion', () => {
        // ws0: [1, 2], ws1: [3, 4] focus on 3, ws2: []
        const world = makeMultiWorld([[1, 2], [3, 4], []], 1, 3);
        const update = moveUp(world);
        const ws0 = update.world.workspaces[0]!.windows.map(w => w.id);
        const ws1 = update.world.workspaces[1]!.windows.map(w => w.id);
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
        // win-1 should be back in ws0 at slot 1
        const ws0 = up.world.workspaces[0]!.windows.map(w => w.id);
        expect(ws0[0]).toBe(wid(1));
        expect(up.world.viewport.workspaceIndex).toBe(0);
    });
});

describe('toggleSize', () => {
    it('toggles slotSpan from 1 to 2', () => {
        const world = makeWorld([1, 2], 0);
        const update = toggleSize(world);
        const win = update.world.workspaces[0]!.windows.find(w => w.id === wid(1));
        expect(win?.slotSpan).toBe(2);
    });

    it('toggles slotSpan from 2 to 1', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1), 2));
        const world: World = {
            workspaces: [ws],
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
            focusedWindow: wid(1),
            config,
            monitor,
            overviewActive: false,
        };
        const update = toggleSize(world);
        const win = update.world.workspaces[0]!.windows.find(w => w.id === wid(1));
        expect(win?.slotSpan).toBe(1);
    });

    it('adjusts viewport after resize', () => {
        // 3 windows, focus on win-3 (rightmost), toggle to double width
        const world = makeWorld([1, 2, 3], 2);
        const update = toggleSize(world);
        const win = update.world.workspaces[0]!.windows.find(w => w.id === wid(3));
        expect(win?.slotSpan).toBe(2);
        // Viewport should scroll to keep the now-wider window visible
        expect(update.world.viewport.scrollX).toBeGreaterThan(0);
    });

    it('is no-op with no focused window', () => {
        const world = { ...makeWorld([1, 2], 0), focusedWindow: null };
        const update = toggleSize(world);
        const win = update.world.workspaces[0]!.windows.find(w => w.id === wid(1));
        expect(win?.slotSpan).toBe(1);
    });
});
