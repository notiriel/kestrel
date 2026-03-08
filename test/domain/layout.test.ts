import { describe, it, expect } from 'vitest';
import type { KestrelConfig, MonitorInfo, WindowId } from '../../src/domain/world/types.js';
import { computeWindowPositions } from '../../src/domain/scene/layout.js';
import type { WorkspaceId } from '../../src/domain/world/types.js';
import { createWorkspace, addColumn, createColumn } from '../../src/domain/world/workspace.js';
import { createTiledWindow } from '../../src/domain/world/window.js';

const config: KestrelConfig = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(125,214,164,0.05)', columnCount: 2, quakeSlots: [], quakeWidthPercent: 80, quakeHeightPercent: 80 };
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
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        const positions = computeWindowPositions(ws, config, monitor, { scrollX: 0, widthPx: 1920 });

        expect(positions).toHaveLength(1);
        const win = positions[0]!;
        expect(win.windowId).toBe(wid(1));
        expect(win.x).toBe(8);
        expect(win.y).toBe(11);
        expect(win.width).toBe(952);
        expect(win.height).toBe(1028);
        expect(win.visible).toBe(true);
        expect(win.fullscreen).toBe(false);
    });

    it('positions two windows side by side with gap', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));
        const positions = computeWindowPositions(ws, config, monitor, { scrollX: 0, widthPx: 1920 });

        expect(positions).toHaveLength(2);
        const [w1, w2] = positions;

        expect(w1!.x).toBe(8);
        expect(w1!.width).toBe(952);

        expect(w2!.x).toBe(968);
        expect(w2!.width).toBe(952);
    });

    it('handles double-width column', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1)), 2));
        const positions = computeWindowPositions(ws, config, monitor, { scrollX: 0, widthPx: 1920 });

        const win = positions[0]!;
        expect(win.width).toBe(1912);
    });

    it('marks off-screen windows as not visible', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(3))));
        const positions = computeWindowPositions(ws, config, monitor, { scrollX: 0, widthPx: 1920 });

        expect(positions[0]!.visible).toBe(true);
        expect(positions[1]!.visible).toBe(true);
        expect(positions[2]!.visible).toBe(false);
    });

    it('marks scrolled-past windows as not visible', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(3))));
        const positions = computeWindowPositions(ws, config, monitor, { scrollX: 971, widthPx: 1920 });

        expect(positions[0]!.visible).toBe(false);
        expect(positions[1]!.visible).toBe(true);
        expect(positions[2]!.visible).toBe(true);
    });

    it('marks all windows visible when viewport is null', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(1))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(2))));
        ws = addColumn(ws, createColumn(createTiledWindow(wid(3))));
        const positions = computeWindowPositions(ws, config, monitor, null);

        for (const pos of positions) {
            expect(pos.visible).toBe(true);
        }
    });

    it('splits height for stacked windows in a column', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, {
            windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2))],
            slotSpan: 1,
        });
        const positions = computeWindowPositions(ws, config, monitor, { scrollX: 0, widthPx: 1920 });

        expect(positions).toHaveLength(2);
        const [w1, w2] = positions;

        // Both have same x and width
        expect(w1!.x).toBe(8);
        expect(w2!.x).toBe(8);
        expect(w1!.width).toBe(952);
        expect(w2!.width).toBe(952);

        // Height split: totalWindowHeight=1028, stackCount=2, gapSize=8
        // totalStackSpace = 1028 - 8 = 1020, baseHeight = floor(1020/2) = 510
        expect(w1!.height).toBe(510);
        expect(w2!.height).toBe(510);

        // y positions: w1 at effectiveEdge (11), w2 at 11 + 510 + 8 = 529
        expect(w1!.y).toBe(11);
        expect(w2!.y).toBe(529);
    });

    it('handles three stacked windows in a column', () => {
        let ws = createWorkspace(wsId(0));
        ws = addColumn(ws, {
            windows: [createTiledWindow(wid(1)), createTiledWindow(wid(2)), createTiledWindow(wid(3))],
            slotSpan: 1,
        });
        const positions = computeWindowPositions(ws, config, monitor, { scrollX: 0, widthPx: 1920 });

        expect(positions).toHaveLength(3);
        // totalStackSpace = 1028 - 2*8 = 1012, baseHeight = floor(1012/3) = 337
        // last window gets remainder: 1012 - 337*2 = 338
        expect(positions[0]!.height).toBe(337);
        expect(positions[1]!.height).toBe(337);
        expect(positions[2]!.height).toBe(338); // remainder goes to last

        // Each y spaced by baseHeight + gap = 337 + 8 = 345
        expect(positions[0]!.y).toBe(11);
        expect(positions[1]!.y).toBe(11 + 345);
        expect(positions[2]!.y).toBe(11 + 2 * 345);
    });
});
