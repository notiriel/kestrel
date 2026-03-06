import { describe, it, expect } from 'vitest';
import { createTodoState } from '../../src/domain/todo.js';
import type { KestrelConfig, MonitorInfo, WindowId, WorkspaceId } from '../../src/domain/types.js';
import { enterOverview, exitOverview, cancelOverview } from '../../src/domain/overview.js';
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

function makeWorld(windowIds: number[], focusedIdx: number): World {
    let ws = createWorkspace(wsId(0));
    for (const id of windowIds) {
        ws = addColumn(ws, createColumn(createTiledWindow(wid(id))));
    }
    return {
        workspaces: [ws],
        viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
        focusedWindow: windowIds.length > 0 ? wid(windowIds[focusedIdx]!) : null,
        config,
        monitor,
        overviewActive: false,
        overviewInteractionState: createOverviewInteractionState(),
        notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null], activeSlot: null },
        todoState: createTodoState(),
    };
}

describe('enterOverview', () => {
    it('sets overviewActive to true', () => {
        const world = makeWorld([1, 2], 0);
        const update = enterOverview(world);
        expect(update.world.overviewActive).toBe(true);
    });

    it('preserves focus and viewport', () => {
        const world = makeWorld([1, 2], 1);
        const update = enterOverview(world);
        expect(update.world.focusedWindow).toBe(wid(2));
        expect(update.world.viewport.workspaceIndex).toBe(0);
    });

    it('saves pre-overview state into overviewInteractionState', () => {
        const world = {
            ...makeWorld([1, 2], 1),
            viewport: { workspaceIndex: 0, scrollX: 42, widthPx: monitor.totalWidth },
        };
        const update = enterOverview(world);
        const ois = update.world.overviewInteractionState;
        expect(ois.active).toBe(true);
        expect(ois.savedFocusedWindow).toBe(wid(2));
        expect(ois.savedWorkspaceIndex).toBe(0);
        expect(ois.savedScrollX).toBe(42);
        expect(ois.filterText).toBe('');
        expect(ois.filteredIndices).toEqual([]);
        expect(ois.renaming).toBe(false);
    });
});

describe('exitOverview', () => {
    it('sets overviewActive to false', () => {
        const world = { ...makeWorld([1, 2], 0), overviewActive: true };
        const update = exitOverview(world);
        expect(update.world.overviewActive).toBe(false);
    });

    it('preserves focus', () => {
        const world = { ...makeWorld([1, 2], 1), overviewActive: true };
        const update = exitOverview(world);
        expect(update.world.focusedWindow).toBe(wid(2));
    });

    it('clears overviewInteractionState', () => {
        const world = { ...makeWorld([1, 2], 0), overviewActive: true };
        const update = exitOverview(world);
        const ois = update.world.overviewInteractionState;
        expect(ois.active).toBe(false);
        expect(ois.savedFocusedWindow).toBeNull();
        expect(ois.savedWorkspaceIndex).toBe(0);
        expect(ois.savedScrollX).toBe(0);
    });

    it('adjusts viewport to focused window', () => {
        // 3 windows, focus on win-3 (off-screen right at scrollX=0)
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(3))));
        const world: World = {
            workspaces: [ws],
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
            focusedWindow: wid(3),
            config,
            monitor,
            overviewActive: true,
            overviewInteractionState: createOverviewInteractionState(),
            notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null], activeSlot: null },
        todoState: createTodoState(),
        };
        const update = exitOverview(world);
        // win-3 is off-screen at scrollX=0, so viewport should scroll to show it
        expect(update.world.viewport.scrollX).toBeGreaterThan(0);
    });
});

describe('enterOverview quake dismiss', () => {
    it('auto-dismisses quake overlay when entering overview', () => {
        const world = {
            ...makeWorld([1, 2], 0),
            quakeState: { slots: [wid(10), null, null, null, null], activeSlot: 0 },
        };
        const update = enterOverview(world);
        expect(update.world.quakeState.activeSlot).toBeNull();
        expect(update.world.quakeState.slots[0]).toBe(wid(10)); // preserves slots
    });

    it('preserves quake state when no active slot', () => {
        const world = makeWorld([1, 2], 0);
        const update = enterOverview(world);
        expect(update.world.quakeState.activeSlot).toBeNull();
    });
});

describe('cancelOverview', () => {
    it('restores pre-overview focus and viewport from interaction state', () => {
        const world = makeWorld([1, 2, 3], 0);
        // Enter overview first to populate interaction state
        const entered = enterOverview(world);
        // Simulate navigating to a different window/workspace during overview
        const navigated: World = {
            ...entered.world,
            focusedWindow: wid(3),
            viewport: { ...entered.world.viewport, workspaceIndex: 0, scrollX: 500 },
        };
        const update = cancelOverview(navigated);
        expect(update.world.overviewActive).toBe(false);
        expect(update.world.focusedWindow).toBe(wid(1)); // restored
        expect(update.world.viewport.scrollX).toBe(0); // restored
        expect(update.world.viewport.workspaceIndex).toBe(0); // restored
    });

    it('clears overviewInteractionState', () => {
        const world = makeWorld([1, 2], 0);
        const entered = enterOverview(world);
        const update = cancelOverview(entered.world);
        const ois = update.world.overviewInteractionState;
        expect(ois.active).toBe(false);
        expect(ois.savedFocusedWindow).toBeNull();
    });
});
