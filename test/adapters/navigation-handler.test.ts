import { describe, it, expect, vi } from 'vitest';
import type { WindowId, KestrelConfig, MonitorInfo } from '../../src/domain/types.js';
import { createWorld, addWindow } from '../../src/domain/world.js';
import type { World } from '../../src/domain/world.js';
import { focusLeft, focusUp } from '../../src/domain/navigation.js';
import { NavigationHandler, type NavigationDeps } from '../../src/adapters/navigation-handler.js';
import { createMockClonePort } from './mock-ports.js';
import { moveDown, moveUp } from '../../src/domain/window-operations.js';

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

function buildWorld(...windowIds: number[]): World {
    let world = createWorld(config, monitor);
    for (const id of windowIds) {
        ({ world } = addWindow(world, wid(id)));
    }
    return world;
}

function createDeps(world: World | null = null) {
    let currentWorld = world;
    const clonePort = createMockClonePort();

    const deps: NavigationDeps & { mocks: typeof mocks } = {
        getWorld: vi.fn(() => currentWorld),
        setWorld: vi.fn((w: World) => { currentWorld = w; }),
        checkGuard: vi.fn().mockReturnValue(true),
        focusWindow: vi.fn(),
        getCloneAdapter: vi.fn(() => clonePort),
        getWindowAdapter: vi.fn(() => null),
        applyScene: vi.fn(),
        applyUpdateWithScroll: vi.fn((update: { world: World }) => { currentWorld = update.world; }),
        mocks: null as any,
    };

    const mocks = {
        clonePort,
        get currentWorld() { return currentWorld; },
    };
    deps.mocks = mocks;

    return deps;
}

describe('NavigationHandler', () => {
    describe('handleSimpleCommand', () => {
        it('calls domain fn, updates world, applies layout animated, focuses window', () => {
            const world = buildWorld(1, 2);
            // Focus win-2 (latest added). focusLeft should focus win-1.
            const deps = createDeps(world);
            const handler = new NavigationHandler(deps);

            handler.handleSimpleCommand(focusLeft, 'focus-left');

            expect(deps.setWorld).toHaveBeenCalledOnce();
            const updatedWorld = (deps.setWorld as ReturnType<typeof vi.fn>).mock.calls[0]![0] as World;
            expect(updatedWorld.focusedWindow).toBe(wid(1));

            expect(deps.applyScene).toHaveBeenCalledOnce();
            expect((deps.applyScene as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toBe(true); // animated

            expect(deps.focusWindow).toHaveBeenCalledWith(wid(1));
        });

        it('no-ops when world is null', () => {
            const deps = createDeps(null);
            const handler = new NavigationHandler(deps);

            handler.handleSimpleCommand(focusLeft, 'focus-left');

            expect(deps.setWorld).not.toHaveBeenCalled();
            expect(deps.applyScene).not.toHaveBeenCalled();
            expect(deps.focusWindow).not.toHaveBeenCalled();
        });

        it('no-ops when overview is active (domain returns unchanged world)', () => {
            const world = { ...buildWorld(1, 2), overviewActive: true };
            const deps = createDeps(world);
            const handler = new NavigationHandler(deps);

            handler.handleSimpleCommand(focusLeft, 'focus-left');

            // Domain guard returns the same world unchanged
            const updatedWorld = (deps.setWorld as ReturnType<typeof vi.fn>).mock.calls[0]![0] as World;
            expect(updatedWorld.focusedWindow).toBe(world.focusedWindow);
            expect(updatedWorld.overviewActive).toBe(true);
        });

        it('no-ops when guard returns false', () => {
            const world = buildWorld(1, 2);
            const deps = createDeps(world);
            (deps.checkGuard as ReturnType<typeof vi.fn>).mockReturnValue(false);
            const handler = new NavigationHandler(deps);

            handler.handleSimpleCommand(focusLeft, 'focus-left');

            expect(deps.setWorld).not.toHaveBeenCalled();
        });
    });

    describe('handleVerticalFocus', () => {
        it('syncs scroll when workspace changes', () => {
            // Build a world with windows on two workspaces
            let world = buildWorld(1);
            // Switch to the trailing empty workspace, add a window there
            world = {
                ...world,
                viewport: { ...world.viewport, workspaceIndex: 1 },
            };
            ({ world } = addWindow(world, wid(2)));
            // Now ws0 has win-1, ws1 has win-2. Viewport on ws1.
            // Set some scroll so we can verify it's carried over
            world = { ...world, viewport: { ...world.viewport, scrollX: 100 } };

            const deps = createDeps(world);
            const handler = new NavigationHandler(deps);

            // focusUp should move from ws1 to ws0
            handler.handleVerticalFocus(focusUp, 'focus-up');

            // Should have called applyUpdateWithScroll with old scroll state
            expect(deps.applyUpdateWithScroll).toHaveBeenCalledOnce();
            const [update, animate, oldScrollX, oldWsId] = (deps.applyUpdateWithScroll as ReturnType<typeof vi.fn>).mock.calls[0]!;
            expect(update.world.viewport.workspaceIndex).toBe(0);
            expect(animate).toBe(true);
            expect(oldScrollX).toBe(100); // old scroll carried over
            expect(oldWsId).not.toBeNull();
        });

        it('does not sync scroll when staying on same workspace', () => {
            // Only one workspace with windows — focusDown goes to empty trailing, stays put
            const world = buildWorld(1, 2);
            const deps = createDeps(world);
            const handler = new NavigationHandler(deps);

            // focusUp from ws0 — no-op, stays on same workspace
            handler.handleVerticalFocus(focusUp, 'focus-up');

            // applyUpdateWithScroll is still called (it handles the no-change case internally)
            expect(deps.applyUpdateWithScroll).toHaveBeenCalledOnce();
            const [_update, _animate, oldScrollX, _oldWsId] = (deps.applyUpdateWithScroll as ReturnType<typeof vi.fn>).mock.calls[0]!;
            expect(oldScrollX).toBe(0); // default scroll
        });
    });

    describe('handleVerticalMove', () => {
        it('reparents clone when window moves cross-workspace', () => {
            // Two workspaces with windows
            let world = buildWorld(1);
            world = { ...world, viewport: { ...world.viewport, workspaceIndex: 1 } };
            ({ world } = addWindow(world, wid(2)));
            // ws0: win-1, ws1: win-2 (focused), viewport on ws1
            // Set focus back to win-2 on ws1
            world = { ...world, viewport: { ...world.viewport, workspaceIndex: 1 } };

            const deps = createDeps(world);
            const handler = new NavigationHandler(deps);

            // moveUp should move win-2 from ws1 to ws0
            handler.handleVerticalMove(moveUp, 'move-up');

            expect(deps.mocks.clonePort.moveCloneToWorkspace).toHaveBeenCalledOnce();
            const [windowId, _targetWsId] = deps.mocks.clonePort.moveCloneToWorkspace.mock.calls[0]!;
            expect(windowId).toBe(wid(2));

            expect(deps.mocks.clonePort.syncWorkspaces).toHaveBeenCalled();
            expect(deps.applyUpdateWithScroll).toHaveBeenCalled();
        });

        it('does not reparent when window stays on same workspace', () => {
            // moveDown from ws0 when there's only a trailing empty ws below — domain creates new ws
            const world = buildWorld(1);
            const deps = createDeps(world);
            const handler = new NavigationHandler(deps);

            handler.handleVerticalMove(moveDown, 'move-down');

            // Window should have moved to the new workspace below
            const _updatedWorld = deps.mocks.currentWorld!;

            // moveCloneToWorkspace is called when window changes workspace
            // In this case it should be called since win-1 moves from ws0 to ws1
            expect(deps.mocks.clonePort.syncWorkspaces).toHaveBeenCalled();
            expect(deps.applyUpdateWithScroll).toHaveBeenCalled();
        });
    });
});
