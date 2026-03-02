import { describe, it, expect } from 'vitest';
import type { KestrelConfig, MonitorInfo, WindowId, WorkspaceId } from '../../src/domain/types.js';
import { focusRight, focusLeft, focusDown, focusUp, forceWorkspaceDown } from '../../src/domain/navigation.js';
import { createWorkspace, addColumn, createColumn } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';
import type { World } from '../../src/domain/world.js';
import { createNotificationState } from '../../src/domain/notification.js';
import { createOverviewInteractionState } from '../../src/domain/overview-state.js';

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

function makeWorld(windowIds: number[], focusedIdx: number, scrollX = 0): World {
    let ws = createWorkspace(wsId(0));
    for (const id of windowIds) {
        ws = addColumn(ws, createColumn(createTiledWindow(wid(id))));
    }
    return {
        workspaces: [ws],
        viewport: { workspaceIndex: 0, scrollX, widthPx: monitor.totalWidth },
        focusedWindow: windowIds.length > 0 ? wid(windowIds[focusedIdx]!) : null,
        config,
        monitor,
        overviewActive: false,
        overviewInteractionState: createOverviewInteractionState(),
        notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null, null], activeSlot: null },
    };
}

describe('focusRight', () => {
    it('moves focus to next column', () => {
        const world = makeWorld([1, 2, 3], 0);
        const update = focusRight(world);
        expect(update.world.focusedWindow).toBe(wid(2));
    });

    it('is no-op at rightmost column', () => {
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
        const world = makeWorld([1, 2, 3], 1);
        const update = focusRight(world);
        expect(update.world.focusedWindow).toBe(wid(3));
        expect(update.world.viewport.scrollX).toBe(968);
    });

    it('scrolls minimally to ensure edge gap when window is at viewport edge', () => {
        const world = makeWorld([1, 2], 0);
        const update = focusRight(world);
        expect(update.world.focusedWindow).toBe(wid(2));
        expect(update.world.viewport.scrollX).toBe(8);
    });
});

describe('focusLeft', () => {
    it('moves focus to previous column', () => {
        const world = makeWorld([1, 2, 3], 1);
        const update = focusLeft(world);
        expect(update.world.focusedWindow).toBe(wid(1));
    });

    it('is no-op at leftmost column', () => {
        const world = makeWorld([1, 2, 3], 0);
        const update = focusLeft(world);
        expect(update.world.focusedWindow).toBe(wid(1));
    });

    it('scrolls viewport when focused window is off-screen to the left', () => {
        const world = makeWorld([1, 2, 3], 1, 960);
        const update = focusLeft(world);
        expect(update.world.focusedWindow).toBe(wid(1));
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
        quakeState: { slots: [null, null, null, null, null], activeSlot: null },
    };
}

describe('focusDown', () => {
    it('moves focus to workspace below with slot-based targeting', () => {
        const world = makeMultiWorld([[1, 2], [3, 4], []], 0, 1);
        const update = focusDown(world);
        expect(update.world.viewport.workspaceIndex).toBe(1);
        expect(update.world.focusedWindow).toBe(wid(3));
    });

    it('targets correct slot when moving down', () => {
        const world = makeMultiWorld([[1, 2], [3, 4], []], 0, 2);
        const update = focusDown(world);
        expect(update.world.viewport.workspaceIndex).toBe(1);
        expect(update.world.focusedWindow).toBe(wid(4));
    });

    it('targets double-width column spanning the slot', () => {
        let ws0 = createWorkspace(wsId(0));
        ws0 = addColumn(ws0, createColumn(createTiledWindow(wid(1))));
        ws0 = addColumn(ws0, createColumn(createTiledWindow(wid(2))));
        let ws1 = createWorkspace(wsId(1));
        ws1 = addColumn(ws1, createColumn(createTiledWindow(wid(3)), 2));
        const empty = createWorkspace(wsId(2));
        const world: World = {
            workspaces: [ws0, ws1, empty],
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
            focusedWindow: wid(2),
            config,
            monitor,
            overviewActive: false,
            overviewInteractionState: createOverviewInteractionState(),
            notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null, null], activeSlot: null },
        };
        const update = focusDown(world);
        expect(update.world.focusedWindow).toBe(wid(3));
    });

    it('sets focus to null when entering empty workspace', () => {
        const world = makeMultiWorld([[1, 2], []], 0, 1);
        const update = focusDown(world);
        expect(update.world.viewport.workspaceIndex).toBe(1);
        expect(update.world.focusedWindow).toBeNull();
    });

    it('falls back to last column when target slot is past all columns', () => {
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

    it('navigates within stack before switching workspace', () => {
        // Column with stacked windows: focusDown moves within stack first
        let ws0 = createWorkspace(wsId(0));
        ws0 = addColumn(ws0, { windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2))], slotSpan: 1 });
        const ws1 = createWorkspace(wsId(1));
        const world: World = {
            workspaces: [ws0, ws1],
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
            focusedWindow: wid(1),
            config,
            monitor,
            overviewActive: false,
            overviewInteractionState: createOverviewInteractionState(),
            notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null, null], activeSlot: null },
        };
        const update = focusDown(world);
        // Should navigate within stack (wid(1) → wid(2)), not switch workspace
        expect(update.world.focusedWindow).toBe(wid(2));
        expect(update.world.viewport.workspaceIndex).toBe(0);
    });
});

describe('focusUp', () => {
    it('moves focus to workspace above with slot-based targeting', () => {
        const world = makeMultiWorld([[1, 2], [3, 4], []], 1, 3);
        const update = focusUp(world);
        expect(update.world.viewport.workspaceIndex).toBe(0);
        expect(update.world.focusedWindow).toBe(wid(1));
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
        expect(down.world.focusedWindow).toBe(wid(4));
        const up = focusUp(down.world);
        expect(up.world.viewport.workspaceIndex).toBe(0);
        expect(up.world.focusedWindow).toBe(wid(2));
    });

    it('navigates within stack before switching workspace', () => {
        let ws0 = createWorkspace(wsId(0));
        ws0 = addColumn(ws0, { windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2))], slotSpan: 1 });
        const ws1 = createWorkspace(wsId(1));
        const world: World = {
            workspaces: [ws0, ws1],
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
            focusedWindow: wid(2),
            config,
            monitor,
            overviewActive: false,
            overviewInteractionState: createOverviewInteractionState(),
            notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null, null], activeSlot: null },
        };
        const update = focusUp(world);
        expect(update.world.focusedWindow).toBe(wid(1));
        expect(update.world.viewport.workspaceIndex).toBe(0);
    });
});

describe('forceWorkspaceDown/Up', () => {
    it('always switches workspace even from middle of stack', () => {
        let ws0 = createWorkspace(wsId(0));
        ws0 = addColumn(ws0, { windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2))], slotSpan: 1 });
        let ws1 = createWorkspace(wsId(1));
        ws1 = addColumn(ws1, createColumn(createTiledWindow(wid(3))));
        const ws2 = createWorkspace(wsId(2));
        const world: World = {
            workspaces: [ws0, ws1, ws2],
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
            focusedWindow: wid(1), // top of stack
            config,
            monitor,
            overviewActive: false,
            overviewInteractionState: createOverviewInteractionState(),
            notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null, null], activeSlot: null },
        };
        const update = forceWorkspaceDown(world);
        expect(update.world.viewport.workspaceIndex).toBe(1);
        expect(update.world.focusedWindow).toBe(wid(3));
    });
});

describe('horizontal navigation with stacks', () => {
    it('position-matches when entering a stacked column', () => {
        // Two columns: col0 has [A, B], col1 has [C, D]
        // Focus on D (position 1 in col1), move left → should focus B (position 1 in col0)
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, { windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2))], slotSpan: 1 });
        ws = addColumn(ws, { windows: [createTiledWindow(wid(3)), createTiledWindow(wid(4))], slotSpan: 1 });
        const world: World = {
            workspaces: [ws],
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
            focusedWindow: wid(4),
            config,
            monitor,
            overviewActive: false,
            overviewInteractionState: createOverviewInteractionState(),
            notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null, null], activeSlot: null },
        };
        const update = focusLeft(world);
        expect(update.world.focusedWindow).toBe(wid(2));
    });

    it('clamps position when target column has fewer windows', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        ws = addColumn(ws, { windows: [createTiledWindow(wid(2)), createTiledWindow(wid(3)), createTiledWindow(wid(4))], slotSpan: 1 });
        const world: World = {
            workspaces: [ws],
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
            focusedWindow: wid(4), // position 2
            config,
            monitor,
            overviewActive: false,
            overviewInteractionState: createOverviewInteractionState(),
            notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null, null], activeSlot: null },
        };
        const update = focusLeft(world);
        // col0 has only 1 window, clamp to position 0
        expect(update.world.focusedWindow).toBe(wid(1));
    });
});

describe('overviewActive guard', () => {
    it('focusRight is no-op when overview is active', () => {
        const world = { ...makeWorld([1, 2, 3], 0), overviewActive: true };
        const update = focusRight(world);
        expect(update.world).toBe(world);
    });

    it('focusLeft is no-op when overview is active', () => {
        const world = { ...makeWorld([1, 2, 3], 2), overviewActive: true };
        const update = focusLeft(world);
        expect(update.world).toBe(world);
    });

    it('focusDown is no-op when overview is active', () => {
        const world = { ...makeMultiWorld([[1], [2], []], 0, 1), overviewActive: true };
        const update = focusDown(world);
        expect(update.world).toBe(world);
    });

    it('focusUp is no-op when overview is active', () => {
        const world = { ...makeMultiWorld([[1], [2], []], 1, 2), overviewActive: true };
        const update = focusUp(world);
        expect(update.world).toBe(world);
    });

    it('forceWorkspaceDown is no-op when overview is active', () => {
        const world = { ...makeMultiWorld([[1], [2], []], 0, 1), overviewActive: true };
        const update = forceWorkspaceDown(world);
        expect(update.world).toBe(world);
    });
});
