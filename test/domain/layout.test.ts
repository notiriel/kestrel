import { describe, it, expect } from 'vitest';
import type { PaperFlowConfig, MonitorInfo, WindowId } from '../../src/domain/types.js';
import { computeLayout } from '../../src/domain/layout.js';
import type { Workspace } from '../../src/domain/workspace.js';
import { createWorkspace, addWindow } from '../../src/domain/workspace.js';
import type { WorkspaceId } from '../../src/domain/types.js';
import { createTiledWindow } from '../../src/domain/window.js';

const config: PaperFlowConfig = { gapSize: 8, edgeGap: 8 };
const monitor: MonitorInfo = {
    count: 1,
    totalWidth: 1920,
    totalHeight: 1080,
    slotWidth: 960,
};

function wid(n: number): WindowId {
    return `win-${n}` as WindowId;
}

function wsId(n: number): WorkspaceId {
    return `ws-${n}` as WorkspaceId;
}

describe('computeLayout', () => {
    it('returns empty layout for empty workspace', () => {
        const ws = createWorkspace(wsId(0));
        const layout = computeLayout(ws, config, monitor);
        expect(layout.windows).toHaveLength(0);
    });

    it('positions a single window correctly', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1)));
        const layout = computeLayout(ws, config, monitor);

        expect(layout.windows).toHaveLength(1);
        const win = layout.windows[0]!;
        expect(win.windowId).toBe(wid(1));
        // x starts at edgeGap
        expect(win.x).toBe(8);
        // y is edgeGap
        expect(win.y).toBe(8);
        // width = 1 * 960 - 8 (gap) - 8 (edgeGap) = 944
        expect(win.width).toBe(944);
        // height = 1080 - 8*2 = 1064
        expect(win.height).toBe(1064);
        expect(win.visible).toBe(true);
    });

    it('positions two windows side by side with gap', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1)));
        ws = addWindow(ws, createTiledWindow(wid(2)));
        const layout = computeLayout(ws, config, monitor);

        expect(layout.windows).toHaveLength(2);
        const [w1, w2] = layout.windows;

        // First window at edgeGap
        expect(w1!.x).toBe(8);
        expect(w1!.width).toBe(944);

        // Second window at edgeGap + 1*slotWidth
        expect(w2!.x).toBe(8 + 960);
        expect(w2!.width).toBe(944);
    });

    it('handles double-width window', () => {
        let ws = createWorkspace(wsId(0));
        ws = addWindow(ws, createTiledWindow(wid(1), 2));
        const layout = computeLayout(ws, config, monitor);

        const win = layout.windows[0]!;
        // width = 2 * 960 - 8 - 8 = 1904
        expect(win.width).toBe(1904);
    });
});
