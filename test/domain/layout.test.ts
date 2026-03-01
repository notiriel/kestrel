import { describe, it, expect } from 'vitest';
import type { KestrelConfig, MonitorInfo, WindowId } from '../../src/domain/types.js';
import { computeWindowPositions } from '../../src/domain/layout.js';
import type { WorkspaceId } from '../../src/domain/types.js';
import { createWorkspace, addWindow } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';

const config: KestrelConfig = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(125,214,164,0.05)' };
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

describe('computeWindowPositions', () => {
    it('returns empty array for empty workspace', () => {
        const ws = createWorkspace(wsId(0));
        const positions = computeWindowPositions(ws, config, monitor, { scrollX: 0, widthPx: 1920 });
        expect(positions).toHaveLength(0);
    });

    it('positions a single window correctly', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1)));
        const positions = computeWindowPositions(ws, config, monitor, { scrollX: 0, widthPx: 1920 });

        expect(positions).toHaveLength(1);
        const win = positions[0]!;
        expect(win.windowId).toBe(wid(1));
        expect(win.x).toBe(8);
        expect(win.y).toBe(11);
        // width = 1 * 960 - 8 (gap) = 952
        expect(win.width).toBe(952);
        // height = 1050 - (8+3)*2 = 1028
        expect(win.height).toBe(1028);
        expect(win.visible).toBe(true);
        expect(win.fullscreen).toBe(false);
    });

    it('positions two windows side by side with gap', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1)));
        ws = addWindow(ws, createTiledWindow(wid(2)));
        const positions = computeWindowPositions(ws, config, monitor, { scrollX: 0, widthPx: 1920 });

        expect(positions).toHaveLength(2);
        const [w1, w2] = positions;

        expect(w1!.x).toBe(8);
        expect(w1!.width).toBe(952);

        // Second window after first + gap: 8 + 952 + 8 = 968
        expect(w2!.x).toBe(968);
        expect(w2!.width).toBe(952);
    });

    it('handles double-width window', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1), 2));
        const positions = computeWindowPositions(ws, config, monitor, { scrollX: 0, widthPx: 1920 });

        const win = positions[0]!;
        // width = 2 * 960 - 8 = 1912
        expect(win.width).toBe(1912);
    });

    it('marks off-screen windows as not visible', () => {
        // 3 windows, each 952px wide. Third starts at 1928px.
        // Viewport is 1920px wide, scrollX=0 → third window is off-screen.
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1)));
        ws = addWindow(ws, createTiledWindow(wid(2)));
        ws = addWindow(ws, createTiledWindow(wid(3)));
        const positions = computeWindowPositions(ws, config, monitor, { scrollX: 0, widthPx: 1920 });

        expect(positions[0]!.visible).toBe(true);
        // Second window: x=971, right=1923 — partially visible (right edge > 1920)
        expect(positions[1]!.visible).toBe(true);
        // Third window: x=1931, right=2883 — left edge 1931 >= viewport end 1920
        expect(positions[2]!.visible).toBe(false);
    });

    it('marks scrolled-past windows as not visible', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1)));
        ws = addWindow(ws, createTiledWindow(wid(2)));
        ws = addWindow(ws, createTiledWindow(wid(3)));
        const positions = computeWindowPositions(ws, config, monitor, { scrollX: 971, widthPx: 1920 });

        // First window: x=11, right=963 → right(963) > scrollX(971) is false
        expect(positions[0]!.visible).toBe(false);
        expect(positions[1]!.visible).toBe(true);
        expect(positions[2]!.visible).toBe(true);
    });

    it('marks all windows visible when viewport is null', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1)));
        ws = addWindow(ws, createTiledWindow(wid(2)));
        ws = addWindow(ws, createTiledWindow(wid(3)));
        const positions = computeWindowPositions(ws, config, monitor, null);

        for (const pos of positions) {
            expect(pos.visible).toBe(true);
        }
    });
});
