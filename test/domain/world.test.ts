import { describe, it, expect, beforeEach } from 'vitest';
import type { WindowId, PaperFlowConfig, MonitorInfo } from '../../src/domain/types.js';
import { createWorld, addWindow, removeWindow } from '../../src/domain/world.js';
import type { World } from '../../src/domain/world.js';

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

describe('World', () => {
    let world: World;

    beforeEach(() => {
        world = createWorld(config, monitor);
    });

    it('starts with one empty workspace and no focus', () => {
        expect(world.workspaces).toHaveLength(1);
        expect(world.workspaces[0]!.windows).toHaveLength(0);
        expect(world.focusedWindow).toBeNull();
    });

    describe('addWindow', () => {
        it('adds a window to the current workspace', () => {
            const { world: w } = addWindow(world, wid(1));
            expect(w.workspaces[0]!.windows).toHaveLength(1);
            expect(w.workspaces[0]!.windows[0]!.id).toBe(wid(1));
        });

        it('focuses the new window', () => {
            const { world: w } = addWindow(world, wid(1));
            expect(w.focusedWindow).toBe(wid(1));
        });

        it('appends windows in order', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3 } = addWindow(w2, wid(3));
            const ids = w3.workspaces[0]!.windows.map(w => w.id);
            expect(ids).toEqual([wid(1), wid(2), wid(3)]);
        });

        it('always focuses the most recently added window', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            expect(w2.focusedWindow).toBe(wid(2));
        });

        it('does not mutate the original world', () => {
            addWindow(world, wid(1));
            expect(world.workspaces[0]!.windows).toHaveLength(0);
            expect(world.focusedWindow).toBeNull();
        });
    });

    describe('removeWindow', () => {
        it('removes a window from the workspace', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3 } = removeWindow(w2, wid(1));
            expect(w3.workspaces[0]!.windows).toHaveLength(1);
            expect(w3.workspaces[0]!.windows[0]!.id).toBe(wid(2));
        });

        it('focuses next window when focused window is removed', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            const { world: w3 } = addWindow(w2, wid(3));
            // Focus is on wid(3). Remove wid(2) — focus stays on wid(3)
            // But let's test removing the focused window
            // w3.focusedWindow === wid(3), which is last. Remove it → focus wid(2)
            const { world: w4 } = removeWindow(w3, wid(3));
            expect(w4.focusedWindow).toBe(wid(2));
        });

        it('focuses previous window when removing last window in list', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            // w2.focusedWindow === wid(2), remove it → focus wid(1)
            const { world: w3 } = removeWindow(w2, wid(2));
            expect(w3.focusedWindow).toBe(wid(1));
        });

        it('sets focus to null when removing the only window', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = removeWindow(w1, wid(1));
            expect(w2.focusedWindow).toBeNull();
        });

        it('keeps focus unchanged when removing a non-focused window', () => {
            const { world: w1 } = addWindow(world, wid(1));
            const { world: w2 } = addWindow(w1, wid(2));
            // Focus is on wid(2). Remove wid(1).
            const { world: w3 } = removeWindow(w2, wid(1));
            expect(w3.focusedWindow).toBe(wid(2));
        });

        it('does not mutate the original world', () => {
            const { world: w1 } = addWindow(world, wid(1));
            removeWindow(w1, wid(1));
            expect(w1.workspaces[0]!.windows).toHaveLength(1);
        });
    });
});
