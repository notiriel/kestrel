import { describe, it, expect } from 'vitest';
import type { WindowId, WorkspaceId, PaperFlowConfig, MonitorInfo } from '../../src/domain/types.js';
import { createWorld, addWindow, enterFullscreen, exitFullscreen, buildUpdate } from '../../src/domain/world.js';
import type { World } from '../../src/domain/world.js';
import { createWorkspace, addWindow as wsAddWindow } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';
import { computeLayout } from '../../src/domain/layout.js';
import { focusRight, focusLeft, focusDown, focusUp } from '../../src/domain/navigation.js';

const config: PaperFlowConfig = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(255,255,255,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(255,255,255,0.05)' };
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

            const { world: w, layout } = enterFullscreen(world, wid(1));

            // Window should be marked fullscreen in domain
            const win = w.workspaces[0]!.windows.find(w => w.id === wid(1));
            expect(win!.fullscreen).toBe(true);

            // Layout should give fullscreen window full monitor size
            const fsLayout = layout.windows.find(w => w.windowId === wid(1));
            expect(fsLayout!.x).toBe(0);
            expect(fsLayout!.y).toBe(0);
            expect(fsLayout!.width).toBe(1920);
            expect(fsLayout!.height).toBe(1080);
        });

        it('removes fullscreen window from the strip — remaining windows fill the gap', () => {
            let world = createWorld(config, monitor);
            ({ world } = addWindow(world, wid(1)));
            ({ world } = addWindow(world, wid(2)));
            ({ world } = addWindow(world, wid(3)));

            const { layout } = enterFullscreen(world, wid(1));

            // wid(2) should now be at the position wid(1) used to be (edgeGap)
            const w2Layout = layout.windows.find(w => w.windowId === wid(2));
            expect(w2Layout!.x).toBe(8); // edgeGap

            // wid(3) should follow wid(2)
            const w3Layout = layout.windows.find(w => w.windowId === wid(3));
            expect(w3Layout!.x).toBe(968); // 8 + 952 + 8
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

            // Enter fullscreen on wid(2)
            ({ world } = enterFullscreen(world, wid(2)));

            // Exit fullscreen
            const { world: w, layout } = exitFullscreen(world, wid(2));

            // wid(2) should be back to non-fullscreen
            const win = w.workspaces[0]!.windows.find(w => w.id === wid(2));
            expect(win!.fullscreen).toBe(false);

            // Strip should be restored: A at edgeGap, B after A, C after B
            const w1Layout = layout.windows.find(w => w.windowId === wid(1));
            const w2Layout = layout.windows.find(w => w.windowId === wid(2));
            const w3Layout = layout.windows.find(w => w.windowId === wid(3));
            expect(w1Layout!.x).toBe(8);
            expect(w2Layout!.x).toBe(968);
            expect(w3Layout!.x).toBe(1928);
        });
    });

    describe('navigation guards', () => {
        it('focusRight is a no-op when focused window is fullscreen', () => {
            let world = createWorld(config, monitor);
            ({ world } = addWindow(world, wid(1)));
            ({ world } = addWindow(world, wid(2)));
            ({ world } = enterFullscreen(world, wid(1)));

            const { world: w } = focusRight(world);
            expect(w.focusedWindow).toBe(wid(1)); // unchanged
        });

        it('focusLeft is a no-op when focused window is fullscreen', () => {
            let world = createWorld(config, monitor);
            ({ world } = addWindow(world, wid(1)));
            ({ world } = addWindow(world, wid(2)));
            ({ world } = enterFullscreen(world, wid(2)));

            const { world: w } = focusLeft(world);
            expect(w.focusedWindow).toBe(wid(2)); // unchanged
        });

        it('focusDown still works when focused window is fullscreen', () => {
            // Build a multi-workspace world
            const ws0 = wsAddWindow(
                wsAddWindow(createWorkspace(wsId(0)), createTiledWindow(wid(1))),
                createTiledWindow(wid(2)),
            );
            const ws1 = wsAddWindow(createWorkspace(wsId(1)), createTiledWindow(wid(3)));
            const trailing = createWorkspace(wsId(2));

            let world: World = {
                workspaces: [ws0, ws1, trailing],
                viewport: { workspaceIndex: 0, scrollX: 0, widthPx: monitor.totalWidth },
                focusedWindow: wid(1),
                config,
                monitor,
                overviewActive: false,
            };

            // Make wid(1) fullscreen
            ({ world } = enterFullscreen(world, wid(1)));

            // focusDown should still switch workspaces
            const { world: w } = focusDown(world);
            expect(w.viewport.workspaceIndex).toBe(1);
            expect(w.focusedWindow).toBe(wid(3));
        });

        it('focusUp still works when focused window is fullscreen', () => {
            const ws0 = wsAddWindow(createWorkspace(wsId(0)), createTiledWindow(wid(1)));
            const ws1 = wsAddWindow(createWorkspace(wsId(1)), createTiledWindow(wid(2)));
            const trailing = createWorkspace(wsId(2));

            let world: World = {
                workspaces: [ws0, ws1, trailing],
                viewport: { workspaceIndex: 1, scrollX: 0, widthPx: monitor.totalWidth },
                focusedWindow: wid(2),
                config,
                monitor,
                overviewActive: false,
            };

            ({ world } = enterFullscreen(world, wid(2)));

            const { world: w } = focusUp(world);
            expect(w.viewport.workspaceIndex).toBe(0);
            expect(w.focusedWindow).toBe(wid(1));
        });
    });

    describe('layout', () => {
        it('fullscreen window produces full-monitor-size layout entry', () => {
            let world = createWorld(config, monitor);
            ({ world } = addWindow(world, wid(1)));
            ({ world } = enterFullscreen(world, wid(1)));

            const layout = computeLayout(world);
            expect(layout.windows).toHaveLength(1);
            expect(layout.windows[0]!.width).toBe(1920);
            expect(layout.windows[0]!.height).toBe(1080);
            expect(layout.windows[0]!.x).toBe(0);
            expect(layout.windows[0]!.y).toBe(0);
            expect(layout.windows[0]!.visible).toBe(true);
        });

        it('other windows fill remaining space without gap for fullscreen window', () => {
            let world = createWorld(config, monitor);
            ({ world } = addWindow(world, wid(1)));
            ({ world } = addWindow(world, wid(2)));
            ({ world } = addWindow(world, wid(3)));
            ({ world } = enterFullscreen(world, wid(1)));

            const layout = computeLayout(world);

            // wid(2) should be at edgeGap (first strip position)
            const w2 = layout.windows.find(w => w.windowId === wid(2));
            expect(w2!.x).toBe(8);

            // wid(3) follows wid(2) — no gap reserved for the fullscreen window
            const w3 = layout.windows.find(w => w.windowId === wid(3));
            expect(w3!.x).toBe(968);
        });
    });
});
