import { describe, it, expect } from 'vitest';
import type { KestrelConfig, MonitorInfo, WindowId, WorkspaceId } from '../../src/domain/types.js';
import { computeWindowPositions } from '../../src/domain/layout.js';
import { computeScene, diffScene } from '../../src/domain/scene.js';
import type { SceneModel } from '../../src/domain/scene.js';
import { createWorkspace, addColumn, createColumn } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';
import type { World } from '../../src/domain/world.js';
import { createViewport } from '../../src/domain/viewport.js';
import { createNotificationState } from '../../src/domain/notification.js';
import { createOverviewInteractionState } from '../../src/domain/overview-state.js';

const config: KestrelConfig = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(125,214,164,0.05)', columnCount: 2 };
const monitor: MonitorInfo = {
    count: 1,
    totalWidth: 1920,
    totalHeight: 1050,
    slotWidth: 960,
    workAreaY: 30,
    stageOffsetX: 0,
};

function wid(n: number): WindowId {
    return `win-${n}` as WindowId;
}

function wsId(n: number): WorkspaceId {
    return `ws-${n}` as WorkspaceId;
}

function makeWorld(workspaces: ReturnType<typeof createWorkspace>[], overrides: Partial<World> = {}): World {
    return {
        workspaces,
        viewport: createViewport(monitor.totalWidth),
        focusedWindow: null,
        config,
        monitor,
        overviewActive: false,
        overviewInteractionState: createOverviewInteractionState(),
        notificationState: createNotificationState(),
        ...overrides,
    };
}

describe('computeScene', () => {
    it('single window: clone matches layout, real window offset by workAreaY', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        const world = makeWorld([ws], { focusedWindow: wid(1) });
        const scene = computeScene(world);

        expect(scene.clones).toHaveLength(1);
        expect(scene.realWindows).toHaveLength(1);

        const clone = scene.clones[0]!;
        const real = scene.realWindows[0]!;
        const positions = computeWindowPositions(ws, config, monitor, world.viewport);
        const wp = positions[0]!;

        expect(clone.x).toBe(wp.x);
        expect(clone.y).toBe(wp.y);
        expect(clone.width).toBe(wp.width);
        expect(clone.height).toBe(wp.height);
        expect(clone.visible).toBe(true);
        expect(clone.workspaceId).toBe(wsId(0));

        expect(real.x).toBe(wp.x);
        expect(real.y).toBe(wp.y + monitor.workAreaY);
        expect(real.width).toBe(wp.width);
        expect(real.height).toBe(wp.height);
        expect(real.opacity).toBe(0);
        expect(real.minimized).toBe(false);
    });

    it('real window x matches clone x when scrollX is 0', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));
        const world = makeWorld([ws], { focusedWindow: wid(1) });
        const scene = computeScene(world);

        for (let i = 0; i < scene.clones.length; i++) {
            expect(scene.realWindows[i]!.x).toBe(scene.clones[i]!.x);
        }
    });

    it('scrolled viewport: clone stays workspace-relative, real window shifts', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(3))));
        const scrollX = 500;
        const world = makeWorld([ws], {
            viewport: { workspaceIndex: 0, scrollX, widthPx: 1920 },
            focusedWindow: wid(2),
        });
        const scene = computeScene(world);
        const positions = computeWindowPositions(ws, config, monitor, world.viewport);

        for (let i = 0; i < scene.clones.length; i++) {
            expect(scene.clones[i]!.x).toBe(positions[i]!.x);
        }

        for (let i = 0; i < scene.realWindows.length; i++) {
            expect(scene.realWindows[i]!.x).toBe(positions[i]!.x - scrollX);
        }
    });

    it('off-workspace windows are minimized', () => {
        let ws0 = createWorkspace(wsId(0));
        ws0 = addColumn(ws0, createColumn(createTiledWindow(wid(1))));
        let ws1 = createWorkspace(wsId(1));
        ws1 = addColumn(ws1, createColumn(createTiledWindow(wid(2))));

        const world = makeWorld([ws0, ws1], {
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: 1920 },
            focusedWindow: wid(1),
        });
        const scene = computeScene(world);

        const rw1 = scene.realWindows.find(r => r.windowId === wid(1))!;
        const rw2 = scene.realWindows.find(r => r.windowId === wid(2))!;

        expect(rw1.minimized).toBe(false);
        expect(rw2.minimized).toBe(true);
    });

    it('fullscreen window has opacity 255', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1), true)));
        const world = makeWorld([ws], { focusedWindow: wid(1) });
        const scene = computeScene(world);

        const real = scene.realWindows[0]!;
        expect(real.opacity).toBe(255);
        expect(real.minimized).toBe(false);
    });

    it('focus indicator wraps focused window', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));
        const world = makeWorld([ws], { focusedWindow: wid(2) });
        const scene = computeScene(world);

        const positions = computeWindowPositions(ws, config, monitor, world.viewport);
        const focused = positions.find(w => w.windowId === wid(2))!;
        const fi = scene.focusIndicator;
        const bw = config.focusBorderWidth;

        expect(fi.visible).toBe(true);
        expect(fi.x).toBe(focused.x - world.viewport.scrollX - bw);
        expect(fi.y).toBe(focused.y - bw);
        expect(fi.width).toBe(focused.width + bw * 2);
        expect(fi.height).toBe(focused.height + bw * 2);
    });

    it('no focused window: focus indicator not visible', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        const world = makeWorld([ws]);
        const scene = computeScene(world);

        expect(scene.focusIndicator.visible).toBe(false);
    });

    it('workspace strip offset equals negative wsIndex times monitor height', () => {
        let ws0 = createWorkspace(wsId(0));
        ws0 = addColumn(ws0, createColumn(createTiledWindow(wid(1))));
        let ws1 = createWorkspace(wsId(1));
        ws1 = addColumn(ws1, createColumn(createTiledWindow(wid(2))));
        const ws2 = createWorkspace(wsId(2));

        const world = makeWorld([ws0, ws1, ws2], {
            viewport: { workspaceIndex: 1, scrollX: 0, widthPx: 1920 },
            focusedWindow: wid(2),
        });
        const scene = computeScene(world);

        expect(scene.workspaceStrip.y).toBe(-1 * monitor.totalHeight);
    });

    it('multi-workspace containers: each y equals index times monitor height', () => {
        let ws0 = createWorkspace(wsId(0));
        ws0 = addColumn(ws0, createColumn(createTiledWindow(wid(1))));
        let ws1 = createWorkspace(wsId(1));
        ws1 = addColumn(ws1, createColumn(createTiledWindow(wid(2))));
        const ws2 = createWorkspace(wsId(2));

        const world = makeWorld([ws0, ws1, ws2], {
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: 1920 },
            focusedWindow: wid(1),
        });
        const scene = computeScene(world);

        expect(scene.workspaceStrip.workspaces).toHaveLength(3);
        for (let i = 0; i < 3; i++) {
            expect(scene.workspaceStrip.workspaces[i]!.y).toBe(i * monitor.totalHeight);
            expect(scene.workspaceStrip.workspaces[i]!.workspaceId).toBe(wsId(i));
        }
    });

    it('empty workspace produces no clones or real windows', () => {
        let ws0 = createWorkspace(wsId(0));
        ws0 = addColumn(ws0, createColumn(createTiledWindow(wid(1))));
        const ws1 = createWorkspace(wsId(1));

        const world = makeWorld([ws0, ws1], {
            viewport: { workspaceIndex: 0, scrollX: 0, widthPx: 1920 },
            focusedWindow: wid(1),
        });
        const scene = computeScene(world);

        expect(scene.clones).toHaveLength(1);
        expect(scene.realWindows).toHaveLength(1);
        expect(scene.clones[0]!.workspaceId).toBe(wsId(0));

        expect(scene.workspaceStrip.workspaces).toHaveLength(2);
    });

    it('clone visible field included in scene', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        const world = makeWorld([ws], { focusedWindow: wid(1) });
        const scene = computeScene(world);

        expect(scene.clones[0]!.visible).toBe(true);
    });

    it('current workspace scrollX applied to its container', () => {
        let ws0 = createWorkspace(wsId(0));
        ws0 = addColumn(ws0, createColumn(createTiledWindow(wid(1))));
        let ws1 = createWorkspace(wsId(1));
        ws1 = addColumn(ws1, createColumn(createTiledWindow(wid(2))));

        const scrollX = 200;
        const world = makeWorld([ws0, ws1], {
            viewport: { workspaceIndex: 0, scrollX, widthPx: 1920 },
            focusedWindow: wid(1),
        });
        const scene = computeScene(world);

        expect(scene.workspaceStrip.workspaces[0]!.scrollX).toBe(scrollX);
        expect(scene.workspaceStrip.workspaces[1]!.scrollX).toBe(0);
    });
});

describe('diffScene', () => {
    function makeScene(overrides: Partial<SceneModel> = {}): SceneModel {
        return {
            clones: [],
            realWindows: [],
            focusIndicator: { visible: false, x: 0, y: 0, width: 0, height: 0 },
            workspaceStrip: { y: 0, workspaces: [] },
            ...overrides,
        };
    }

    it('identical scenes produce empty array', () => {
        const scene = makeScene({
            clones: [{ windowId: wid(1), workspaceId: wsId(0), x: 10, y: 20, width: 960, height: 500, visible: true }],
            realWindows: [{ windowId: wid(1), x: 10, y: 50, width: 960, height: 500, opacity: 0, minimized: false }],
            focusIndicator: { visible: true, x: 7, y: 17, width: 966, height: 506 },
            workspaceStrip: { y: 0, workspaces: [] },
        });
        expect(diffScene(scene, scene)).toEqual([]);
    });

    it('clone x difference produces single mismatch', () => {
        const expected = makeScene({
            clones: [{ windowId: wid(1), workspaceId: wsId(0), x: 10, y: 20, width: 960, height: 500, visible: true }],
        });
        const actual = makeScene({
            clones: [{ windowId: wid(1), workspaceId: wsId(0), x: 15, y: 20, width: 960, height: 500, visible: true }],
        });
        const result = diffScene(expected, actual);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ entity: 'clone', windowId: wid(1), field: 'x', expected: 10, actual: 15 });
    });

    it('missing clone in actual reported', () => {
        const expected = makeScene({
            clones: [{ windowId: wid(1), workspaceId: wsId(0), x: 10, y: 20, width: 960, height: 500, visible: true }],
        });
        const actual = makeScene({ clones: [] });
        const result = diffScene(expected, actual);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ entity: 'clone', windowId: wid(1), field: 'missing', expected: 'present', actual: 'absent' });
    });

    it('extra clone in actual reported', () => {
        const expected = makeScene({ clones: [] });
        const actual = makeScene({
            clones: [{ windowId: wid(1), workspaceId: wsId(0), x: 10, y: 20, width: 960, height: 500, visible: true }],
        });
        const result = diffScene(expected, actual);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ entity: 'clone', windowId: wid(1), field: 'extra', expected: 'absent', actual: 'present' });
    });

    it('focus indicator difference reported', () => {
        const expected = makeScene({
            focusIndicator: { visible: true, x: 7, y: 17, width: 966, height: 506 },
        });
        const actual = makeScene({
            focusIndicator: { visible: true, x: 7, y: 17, width: 970, height: 506 },
        });
        const result = diffScene(expected, actual);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ entity: 'focusIndicator', field: 'width', expected: 966, actual: 970 });
    });

    it('real window minimized difference reported', () => {
        const expected = makeScene({
            realWindows: [{ windowId: wid(1), x: 10, y: 50, width: 960, height: 500, opacity: 0, minimized: false }],
        });
        const actual = makeScene({
            realWindows: [{ windowId: wid(1), x: 10, y: 50, width: 960, height: 500, opacity: 0, minimized: true }],
        });
        const result = diffScene(expected, actual);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ entity: 'realWindow', windowId: wid(1), field: 'minimized', expected: false, actual: true });
    });

    it('workspace strip y difference reported', () => {
        const expected = makeScene({ workspaceStrip: { y: -1050, workspaces: [] } });
        const actual = makeScene({ workspaceStrip: { y: 0, workspaces: [] } });
        const result = diffScene(expected, actual);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({ entity: 'workspaceStrip', field: 'y', expected: -1050, actual: 0 });
    });

    it('multiple mismatches across entities', () => {
        const expected = makeScene({
            clones: [{ windowId: wid(1), workspaceId: wsId(0), x: 10, y: 20, width: 960, height: 500, visible: true }],
            realWindows: [{ windowId: wid(1), x: 10, y: 50, width: 960, height: 500, opacity: 0, minimized: false }],
            focusIndicator: { visible: true, x: 7, y: 17, width: 966, height: 506 },
        });
        const actual = makeScene({
            clones: [{ windowId: wid(1), workspaceId: wsId(0), x: 15, y: 20, width: 960, height: 500, visible: true }],
            realWindows: [{ windowId: wid(1), x: 15, y: 50, width: 960, height: 500, opacity: 0, minimized: false }],
            focusIndicator: { visible: true, x: 12, y: 17, width: 966, height: 506 },
        });
        const result = diffScene(expected, actual);
        expect(result).toHaveLength(3);
        expect(result.map(m => m.entity)).toContain('clone');
        expect(result.map(m => m.entity)).toContain('realWindow');
        expect(result.map(m => m.entity)).toContain('focusIndicator');
    });
});
