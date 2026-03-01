import { describe, it, expect } from 'vitest';
import type { WindowId, WorkspaceId, KestrelConfig, MonitorInfo } from '../../src/domain/types.js';
import { createWorld, addWindow, enterFullscreen, exitFullscreen, buildUpdate } from '../../src/domain/world.js';
import type { World } from '../../src/domain/world.js';
import { createWorkspace, addColumn, createColumn, allWindows } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';
import { focusRight, focusLeft, focusDown, focusUp } from '../../src/domain/navigation.js';
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

describe('Fullscreen Step-Out', () => {
    describe('enterFullscreen', () => {
        it('marks window as fullscreen and gives it full-monitor layout', () => {
            let world = createWorld(config, monitor);
            ({ world } = addWindow(world, wid(1)));
            ({ world } = addWindow(world, wid(2)));

            const { world: w, scene } = enterFullscreen(world, wid(1));

            const win = allWindows(w.workspaces[0]!).find(w => w.id === wid(1));
            expect(win!.fullscreen).toBe(true);

            const fsClone = scene.clones.find(c => c.windowId === wid(1));
            expect(fsClone!.x).toBe(0);
            expect(fsClone!.y).toBe(0);
            expect(fsClone!.width).toBe(1920);
            expect(fsClone!.height).toBe(1080);

            const normalClone = scene.clones.find(c => c.windowId === wid(2));
            expect(normalClone).toBeDefined();
        });

        it('removes fullscreen window from the strip — remaining windows fill the gap', () => {
            let world = createWorld(config, monitor);
            ({ world } = addWindow(world, wid(1)));
            ({ world } = addWindow(world, wid(2)));
            ({ world } = addWindow(world, wid(3)));

            const { scene } = enterFullscreen(world, wid(1));

            const w2Clone = scene.clones.find(c => c.windowId === wid(2));
            expect(w2Clone!.x).toBe(8);

            const w3Clone = scene.clones.find(c => c.windowId === wid(3));
            expect(w3Clone!.x).toBe(968);
        });

        it('focuses the fullscreen window', () => {
            let world = createWorld(config, monitor);
            ({ world } = addWindow(world, wid(1)));
            ({ world } = addWindow(world, wid(2)));

            const { world: w } = enterFullscreen(world, wid(1));
            expect(w.focusedWindow).toBe(wid(1));
        });
    });

    describe('exitFullscreen', () => {
        it('restores window to its original strip position', () => {
            let world = createWorld(config, monitor);
            ({ world } = addWindow(world, wid(1)));
            ({ world } = addWindow(world, wid(2)));
            ({ world } = addWindow(world, wid(3)));

            ({ world } = enterFullscreen(world, wid(2)));

            const { world: w, scene } = exitFullscreen(world, wid(2));

            const win = allWindows(w.workspaces[0]!).find(w => w.id === wid(2));
            expect(win!.fullscreen).toBe(false);

            const w1Clone = scene.clones.find(c => c.windowId === wid(1));
            const w2Clone = scene.clones.find(c => c.windowId === wid(2));
            const w3Clone = scene.clones.find(c => c.windowId === wid(3));
            expect(w1Clone!.x).toBe(8);
            expect(w2Clone!.x).toBe(968);
            expect(w3Clone!.x).toBe(1928);
        });
    });

    describe('navigation guards', () => {
        it('focusRight is a no-op when focused window is fullscreen', () => {
            let world = createWorld(config, monitor);
            ({ world } = addWindow(world, wid(1)));
            ({ world } = addWindow(world, wid(2)));
            ({ world } = enterFullscreen(world, wid(1)));

            const { world: w } = focusRight(world);
            expect(w.focusedWindow).toBe(wid(1));
        });

        it('focusLeft is a no-op when focused window is fullscreen', () => {
            let world = createWorld(config, monitor);
            ({ world } = addWindow(world, wid(1)));
            ({ world } = addWindow(world, wid(2)));
            ({ world } = enterFullscreen(world, wid(2)));

            const { world: w } = focusLeft(world);
            expect(w.focusedWindow).toBe(wid(2));
        });

        it('focusDown still works when focused window is fullscreen', () => {
            let ws0 = createWorkspace(wsId(0));
            ws0 = addColumn(ws0, createColumn(createTiledWindow(wid(1))));
            ws0 = addColumn(ws0, createColumn(createTiledWindow(wid(2))));
            let ws1 = createWorkspace(wsId(1));
            ws1 = addColumn(ws1, createColumn(createTiledWindow(wid(3))));
            const trailing = createWorkspace(wsId(2));

            let world: World = {
                workspaces: [ws0, ws1, trailing],
                viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
                focusedWindow: wid(1),
                config,
                monitor,
                overviewActive: false,
                overviewInteractionState: createOverviewInteractionState(),
                notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null, null], activeSlot: null },
            };

            ({ world } = enterFullscreen(world, wid(1)));

            const { world: w } = focusDown(world);
            expect(w.viewport.workspaceIndex).toBe(1);
            expect(w.focusedWindow).toBe(wid(3));
        });

        it('focusUp still works when focused window is fullscreen', () => {
            let ws0 = createWorkspace(wsId(0));
            ws0 = addColumn(ws0, createColumn(createTiledWindow(wid(1))));
            let ws1 = createWorkspace(wsId(1));
            ws1 = addColumn(ws1, createColumn(createTiledWindow(wid(2))));
            const trailing = createWorkspace(wsId(2));

            let world: World = {
                workspaces: [ws0, ws1, trailing],
                viewport: { workspaceIndex: 1, scrollX: 0, widthPx: monitor.totalWidth },
                focusedWindow: wid(2),
                config,
                monitor,
                overviewActive: false,
                overviewInteractionState: createOverviewInteractionState(),
                notificationState: createNotificationState(),
        quakeState: { slots: [null, null, null, null, null], activeSlot: null },
            };

            ({ world } = enterFullscreen(world, wid(2)));

            const { world: w } = focusUp(world);
            expect(w.viewport.workspaceIndex).toBe(0);
            expect(w.focusedWindow).toBe(wid(1));
        });
    });

    describe('layout via scene', () => {
        it('fullscreen window produces full-monitor-size clone', () => {
            let world = createWorld(config, monitor);
            ({ world } = addWindow(world, wid(1)));
            ({ world } = enterFullscreen(world, wid(1)));

            const { scene } = buildUpdate(world);
            const fsClone = scene.clones.find(c => c.windowId === wid(1))!;
            expect(fsClone.width).toBe(1920);
            expect(fsClone.height).toBe(1080);
            expect(fsClone.x).toBe(0);
            expect(fsClone.y).toBe(0);
            expect(fsClone.visible).toBe(true);
        });

        it('other windows fill remaining space without gap for fullscreen window', () => {
            let world = createWorld(config, monitor);
            ({ world } = addWindow(world, wid(1)));
            ({ world } = addWindow(world, wid(2)));
            ({ world } = addWindow(world, wid(3)));
            ({ world } = enterFullscreen(world, wid(1)));

            const { scene } = buildUpdate(world);

            const w2 = scene.clones.find(c => c.windowId === wid(2));
            expect(w2!.x).toBe(8);

            const w3 = scene.clones.find(c => c.windowId === wid(3));
            expect(w3!.x).toBe(968);
        });
    });
});
