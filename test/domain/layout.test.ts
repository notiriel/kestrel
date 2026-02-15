import { describe, it, expect } from 'vitest';
import type { PaperFlowConfig, MonitorInfo, WindowId } from '../../src/domain/types.js';
import { computeLayout } from '../../src/domain/layout.js';
import type { WorkspaceId } from '../../src/domain/types.js';
import { createWorkspace, addWindow } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';
import type { World } from '../../src/domain/world.js';
import { createViewport } from '../../src/domain/viewport.js';

const config: PaperFlowConfig = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3 };
const monitor: MonitorInfo = {
    count: 1,
    totalWidth: 1920,
    totalHeight: 1050,
    slotWidth: 960,
    workAreaY: 30,
};

function wid(n: number): WindowId {
    return `win-${n}` as WindowId;
}

function wsId(n: number): WorkspaceId {
    return `ws-${n}` as WorkspaceId;
}

function makeWorld(wsFactory: () => ReturnType<typeof createWorkspace>, overrides: Partial<World> = {}): World {
    return {
        workspaces: [wsFactory()],
        viewport: createViewport(monitor.totalWidth),
        focusedWindow: null,
        config,
        monitor,
        ...overrides,
    };
}

describe('computeLayout', () => {
    it('returns empty layout for empty workspace', () => {
        const world = makeWorld(() => createWorkspace(wsId(0)));
        const layout = computeLayout(world);
        expect(layout.windows).toHaveLength(0);
        expect(layout.scrollX).toBe(0);
        expect(layout.focusedWindowId).toBeNull();
    });

    it('positions a single window correctly', () => {
        const world = makeWorld(() => {
            let ws = createWorkspace(wsId(0));
            ws = addWindow(ws, createTiledWindow(wid(1)));
            return ws;
        });
        const layout = computeLayout(world);

        expect(layout.windows).toHaveLength(1);
        const win = layout.windows[0]!;
        expect(win.windowId).toBe(wid(1));
        expect(win.x).toBe(8);
        expect(win.y).toBe(11);
        // width = 1 * 960 - 8 (gap) = 952
        expect(win.width).toBe(952);
        // height = 1050 - (8+3)*2 = 1028
        expect(win.height).toBe(1028);
        expect(win.visible).toBe(true);
    });

    it('positions two windows side by side with gap', () => {
        const world = makeWorld(() => {
            let ws = createWorkspace(wsId(0));
            ws = addWindow(ws, createTiledWindow(wid(1)));
            ws = addWindow(ws, createTiledWindow(wid(2)));
            return ws;
        });
        const layout = computeLayout(world);

        expect(layout.windows).toHaveLength(2);
        const [w1, w2] = layout.windows;

        expect(w1!.x).toBe(8);
        expect(w1!.width).toBe(952);

        // Second window after first + gap: 8 + 952 + 8 = 968
        expect(w2!.x).toBe(968);
        expect(w2!.width).toBe(952);
    });

    it('handles double-width window', () => {
        const world = makeWorld(() => {
            let ws = createWorkspace(wsId(0));
            ws = addWindow(ws, createTiledWindow(wid(1), 2));
            return ws;
        });
        const layout = computeLayout(world);

        const win = layout.windows[0]!;
        // width = 2 * 960 - 8 = 1912
        expect(win.width).toBe(1912);
    });

    it('marks off-screen windows as not visible', () => {
        // 3 windows, each 952px wide. Third starts at 1928px.
        // Viewport is 1920px wide, scrollX=0 → third window is off-screen.
        const world = makeWorld(
            () => {
                let ws = createWorkspace(wsId(0));
                ws = addWindow(ws, createTiledWindow(wid(1)));
                ws = addWindow(ws, createTiledWindow(wid(2)));
                ws = addWindow(ws, createTiledWindow(wid(3)));
                return ws;
            },
        );
        const layout = computeLayout(world);

        expect(layout.windows[0]!.visible).toBe(true);
        // Second window: x=971, right=1923 — partially visible (right edge > 1920)
        expect(layout.windows[1]!.visible).toBe(true);
        // Third window: x=1931, right=2883 — left edge 1931 >= viewport end 1920
        expect(layout.windows[2]!.visible).toBe(false);
    });

    it('marks scrolled-past windows as not visible', () => {
        const world = makeWorld(
            () => {
                let ws = createWorkspace(wsId(0));
                ws = addWindow(ws, createTiledWindow(wid(1)));
                ws = addWindow(ws, createTiledWindow(wid(2)));
                ws = addWindow(ws, createTiledWindow(wid(3)));
                return ws;
            },
            { viewport: { workspaceIndex: 0, scrollX: 971, widthPx: 1920 } },
        );
        const layout = computeLayout(world);

        // First window: x=11, right=963 → right(963) > scrollX(971) is false
        expect(layout.windows[0]!.visible).toBe(false);
        expect(layout.windows[1]!.visible).toBe(true);
        expect(layout.windows[2]!.visible).toBe(true);
    });

    it('includes scrollX and focusedWindowId in layout', () => {
        const world = makeWorld(
            () => {
                let ws = createWorkspace(wsId(0));
                ws = addWindow(ws, createTiledWindow(wid(1)));
                return ws;
            },
            {
                viewport: { workspaceIndex: 0, scrollX: 100, widthPx: 1920 },
                focusedWindow: wid(1),
            },
        );
        const layout = computeLayout(world);
        expect(layout.scrollX).toBe(100);
        expect(layout.focusedWindowId).toBe(wid(1));
    });
});
