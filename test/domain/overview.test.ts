import { describe, it, expect } from 'vitest';
import type { PaperFlowConfig, MonitorInfo, WindowId, WorkspaceId } from '../../src/domain/types.js';
import { enterOverview, exitOverview } from '../../src/domain/overview.js';
import { createWorkspace, addWindow } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';
import type { World } from '../../src/domain/world.js';

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

function makeWorld(windowIds: number[], focusedIdx: number): World {
    let ws = createWorkspace(wsId(0));
    for (const id of windowIds) {
        ws = addWindow(ws, createTiledWindow(wid(id)));
    }
    return {
        workspaces: [ws],
        viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
        focusedWindow: windowIds.length > 0 ? wid(windowIds[focusedIdx]!) : null,
        config,
        monitor,
        overviewActive: false,
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

    it('adjusts viewport to focused window', () => {
        // 3 windows, focus on win-3 (off-screen right at scrollX=0)
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1)));
        ws = addWindow(ws, createTiledWindow(wid(2)));
        ws = addWindow(ws, createTiledWindow(wid(3)));
        const world: World = {
            workspaces: [ws],
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
            focusedWindow: wid(3),
            config,
            monitor,
            overviewActive: true,
        };
        const update = exitOverview(world);
        // win-3 is off-screen at scrollX=0, so viewport should scroll to show it
        expect(update.world.viewport.scrollX).toBeGreaterThan(0);
    });
});
