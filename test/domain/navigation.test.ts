import { describe, it, expect } from 'vitest';
import type { PaperFlowConfig, MonitorInfo, WindowId, WorkspaceId } from '../../src/domain/types.js';
import { focusRight, focusLeft, focusDown, focusUp } from '../../src/domain/navigation.js';
import { createWorkspace, addWindow } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';
import type { World } from '../../src/domain/world.js';
import { createViewport } from '../../src/domain/viewport.js';

const config: PaperFlowConfig = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3 };
const monitor: MonitorInfo = {
    count: 1,
    totalWidth: 1920,
    totalHeight: 1080,
    slotWidth: 960,
    workAreaY: 0,
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

describe('focusRight', () => {
    it('moves focus to next window', () => {
        const world = makeWorld([1, 2, 3], 0);
        const update = focusRight(world);
        expect(update.world.focusedWindow).toBe(wid(2));
    });

    it('is no-op at rightmost window', () => {
        const world = makeWorld([1, 2, 3], 2);
        const update = focusRight(world);
        expect(update.world.focusedWindow).toBe(wid(3));
    });

    it('is no-op with no focused window', () => {
        const world = { ...makeWorld([1, 2], 0), focusedWindow: null };
        const update = focusRight(world);
        expect(update.world.focusedWindow).toBeNull();
    });

    it('scrolls viewport when focused window is off-screen to the right', () => {
        // 3 windows. Focus on win-1 (first), move right to win-2.
        // win-2 starts at x=968, ends at 1920. With scrollX=0, right edge = viewport edge.
        // Move right again to win-3 at x=1928. This is off-screen.
        const world = makeWorld([1, 2, 3], 1); // focus on win-2
        const update = focusRight(world);
        expect(update.world.focusedWindow).toBe(wid(3));
        // win-3: x=1928, width=952, right=2880
        // scrollX should be: 2880 + 8 (edgeGap) - 1920 = 968
        expect(update.world.viewport.scrollX).toBe(968);
    });

    it('scrolls minimally to ensure edge gap when window is at viewport edge', () => {
        // win-2: x=968, right=1920. Right edge flush with viewport at scrollX=0.
        // Edge gap padding scrolls by 8px so win-2 has breathing room.
        const world = makeWorld([1, 2], 0);
        const update = focusRight(world);
        expect(update.world.focusedWindow).toBe(wid(2));
        expect(update.world.viewport.scrollX).toBe(8);
    });
});

describe('focusLeft', () => {
    it('moves focus to previous window', () => {
        const world = makeWorld([1, 2, 3], 1);
        const update = focusLeft(world);
        expect(update.world.focusedWindow).toBe(wid(1));
    });

    it('is no-op at leftmost window', () => {
        const world = makeWorld([1, 2, 3], 0);
        const update = focusLeft(world);
        expect(update.world.focusedWindow).toBe(wid(1));
    });

    it('scrolls viewport when focused window is off-screen to the left', () => {
        // 3 windows, scrolled right. Focus on win-3, move left to win-2.
        // Then move left again to win-1, which is off-screen.
        const world = makeWorld([1, 2, 3], 1, 960); // focus win-2, scrollX=960
        const update = focusLeft(world);
        expect(update.world.focusedWindow).toBe(wid(1));
        // win-1: x=8. scrollX should be 8 - 8 (edgeGap) = 0 to show edge gap.
        expect(update.world.viewport.scrollX).toBe(0);
    });

    it('does not scroll when focused window is already visible', () => {
        const world = makeWorld([1, 2], 1);
        const update = focusLeft(world);
        expect(update.world.focusedWindow).toBe(wid(1));
        expect(update.world.viewport.scrollX).toBe(0);
    });
});

/** Build a multi-workspace world for vertical navigation tests. */
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

describe('focusDown', () => {
    it('moves focus to workspace below with slot-based targeting', () => {
        const world = makeMultiWorld([[1, 2], [3, 4], []], 0, 1);
        const update = focusDown(world);
        expect(update.world.viewport.workspaceIndex).toBe(1);
        expect(update.world.focusedWindow).toBe(wid(3)); // slot 1 → slot 1
    });

    it('targets correct slot when moving down', () => {
        const world = makeMultiWorld([[1, 2], [3, 4], []], 0, 2);
        const update = focusDown(world);
        expect(update.world.viewport.workspaceIndex).toBe(1);
        expect(update.world.focusedWindow).toBe(wid(4)); // slot 2 → slot 2
    });

    it('targets double-width window spanning the slot', () => {
        // ws0: win-1 (1 slot), win-2 (1 slot) — focus on win-2 (slot 2)
        // ws1: win-3 (2 slots, spans 1-2)
        const ws0 = addWindow(
            addWindow(createWorkspace(wsId(0)), createTiledWindow(wid(1))),
            createTiledWindow(wid(2)),
        );
        const ws1 = addWindow(createWorkspace(wsId(1)), createTiledWindow(wid(3), 2));
        const empty = createWorkspace(wsId(2));
        const world: World = {
            workspaces: [ws0, ws1, empty],
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
            focusedWindow: wid(2),
            config,
            monitor,
            overviewActive: false,
        };
        const update = focusDown(world);
        expect(update.world.focusedWindow).toBe(wid(3)); // slot 2 hits double-width win-3
    });

    it('sets focus to null when entering empty workspace', () => {
        const world = makeMultiWorld([[1, 2], []], 0, 1);
        const update = focusDown(world);
        expect(update.world.viewport.workspaceIndex).toBe(1);
        expect(update.world.focusedWindow).toBeNull();
    });

    it('falls back to last window when target slot is past all windows', () => {
        // ws0: win-1 (slot 1), win-2 (slot 2) — focus on win-2
        // ws1: win-3 (slot 1 only)
        // slot 2 is past ws1's windows → should fall back to win-3
        const world = makeMultiWorld([[1, 2], [3], []], 0, 2);
        const update = focusDown(world);
        expect(update.world.viewport.workspaceIndex).toBe(1);
        expect(update.world.focusedWindow).toBe(wid(3));
    });

    it('is no-op at bottom workspace', () => {
        const world = makeMultiWorld([[1, 2], []], 1, null);
        const update = focusDown(world);
        expect(update.world.viewport.workspaceIndex).toBe(1);
    });
});

describe('focusUp', () => {
    it('moves focus to workspace above with slot-based targeting', () => {
        const world = makeMultiWorld([[1, 2], [3, 4], []], 1, 3);
        const update = focusUp(world);
        expect(update.world.viewport.workspaceIndex).toBe(0);
        expect(update.world.focusedWindow).toBe(wid(1)); // slot 1 → slot 1
    });

    it('is no-op at top workspace', () => {
        const world = makeMultiWorld([[1, 2], []], 0, 1);
        const update = focusUp(world);
        expect(update.world.viewport.workspaceIndex).toBe(0);
        expect(update.world.focusedWindow).toBe(wid(1));
    });

    it('round-trip: focusDown then focusUp returns to original', () => {
        const world = makeMultiWorld([[1, 2], [3, 4], []], 0, 2);
        const down = focusDown(world);
        expect(down.world.focusedWindow).toBe(wid(4)); // slot 2 → win-4
        const up = focusUp(down.world);
        expect(up.world.viewport.workspaceIndex).toBe(0);
        expect(up.world.focusedWindow).toBe(wid(2)); // slot 2 → win-2
    });
});
