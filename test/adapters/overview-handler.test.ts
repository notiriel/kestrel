import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { WindowId, KestrelConfig, MonitorInfo } from '../../src/domain/types.js';
import { createWorld, addWindow } from '../../src/domain/world.js';
import type { World } from '../../src/domain/world.js';
import { OverviewHandler, type OverviewDeps } from '../../src/adapters/overview-handler.js';
import { createMockClonePort, createMockWindowPort } from './mock-ports.js';

const config: KestrelConfig = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(255,255,255,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(255,255,255,0.05)' };
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

function createMockInputAdapter() {
    return {
        activate: vi.fn(),
        deactivate: vi.fn(),
        destroy: vi.fn(),
    };
}

function createDeps(world: World | null = null) {
    let currentWorld = world;
    const clonePort = createMockClonePort();
    const windowPort = createMockWindowPort();
    const inputAdapter = createMockInputAdapter();

    const deps: OverviewDeps = {
        getWorld: vi.fn(() => currentWorld),
        setWorld: vi.fn((w: World) => { currentWorld = w; }),
        focusWindow: vi.fn(),
        getCloneAdapter: vi.fn(() => clonePort),
        getWindowAdapter: vi.fn(() => windowPort),
        createOverviewInputAdapter: vi.fn(() => inputAdapter),
    };

    return {
        deps,
        clonePort,
        windowPort,
        inputAdapter,
        get currentWorld() { return currentWorld; },
    };
}

describe('OverviewHandler', () => {
    describe('handleToggle', () => {
        it('enters overview when not active', () => {
            const { deps, clonePort, inputAdapter } = createDeps(buildWorld(1, 2));
            const handler = new OverviewHandler(deps);

            handler.handleToggle();

            expect(deps.setWorld).toHaveBeenCalled();
            expect(clonePort.enterOverview).toHaveBeenCalledOnce();
            expect(inputAdapter.activate).toHaveBeenCalledOnce();
            expect(handler.isActive).toBe(true);
        });

        it('confirms when already active', () => {
            const { deps, clonePort, windowPort, inputAdapter } = createDeps(buildWorld(1, 2));
            const handler = new OverviewHandler(deps);

            // Enter first
            handler.handleToggle();
            // Toggle again — should confirm (exit)
            handler.handleToggle();

            expect(clonePort.exitOverview).toHaveBeenCalledOnce();
            expect(inputAdapter.deactivate).toHaveBeenCalledOnce();
            expect(handler.isActive).toBe(false);
        });

        it('no-ops when world is null', () => {
            const { deps, clonePort } = createDeps(null);
            const handler = new OverviewHandler(deps);

            handler.handleToggle();

            expect(deps.setWorld).not.toHaveBeenCalled();
            expect(clonePort.enterOverview).not.toHaveBeenCalled();
        });
    });

    describe('enter', () => {
        it('saves pre-overview state', () => {
            const world = buildWorld(1, 2);
            // win-2 focused, scrollX=0, wsIndex=0
            const { deps, currentWorld: _ } = createDeps(world);
            const handler = new OverviewHandler(deps);

            handler.handleToggle(); // enter

            // After entering, domain should have overviewActive = true
            const setWorldCalls = (deps.setWorld as ReturnType<typeof vi.fn>).mock.calls;
            const updatedWorld = setWorldCalls[0]![0] as World;
            expect(updatedWorld.overviewActive).toBe(true);
        });

        it('calls enterOverview domain fn and clone enterOverview', () => {
            const { deps, clonePort } = createDeps(buildWorld(1, 2));
            const handler = new OverviewHandler(deps);

            handler.handleToggle();

            expect(clonePort.enterOverview).toHaveBeenCalledOnce();
            // First arg is the transform, second is layout, third is numWorkspaces
            const args = clonePort.enterOverview.mock.calls[0]!;
            expect(args[0]).toHaveProperty('scale');
            expect(args[0]).toHaveProperty('offsetX');
            expect(args[0]).toHaveProperty('offsetY');
            expect(typeof args[2]).toBe('number'); // numWorkspaces
        });

        it('activates input adapter with callbacks', () => {
            const { deps, inputAdapter } = createDeps(buildWorld(1));
            const handler = new OverviewHandler(deps);

            handler.handleToggle();

            expect(inputAdapter.activate).toHaveBeenCalledOnce();
            const callbacks = inputAdapter.activate.mock.calls[0]![0];
            expect(callbacks).toHaveProperty('onNavigate');
            expect(callbacks).toHaveProperty('onConfirm');
            expect(callbacks).toHaveProperty('onCancel');
            expect(callbacks).toHaveProperty('onClick');
        });
    });

    describe('navigate', () => {
        it('calls domain navigation and updates overview focus', () => {
            const { deps, clonePort, inputAdapter } = createDeps(buildWorld(1, 2));
            const handler = new OverviewHandler(deps);

            handler.handleToggle(); // enter
            clonePort.updateOverviewFocus.mockClear();

            // Trigger navigation via the callback
            const callbacks = inputAdapter.activate.mock.calls[0]![0];
            callbacks.onNavigate('left');

            expect(deps.setWorld).toHaveBeenCalled();
            expect(clonePort.updateOverviewFocus).toHaveBeenCalledOnce();
        });

        it('handles all four directions', () => {
            const { deps, clonePort, inputAdapter } = createDeps(buildWorld(1, 2));
            const handler = new OverviewHandler(deps);

            handler.handleToggle();
            const callbacks = inputAdapter.activate.mock.calls[0]![0];

            for (const dir of ['left', 'right', 'up', 'down'] as const) {
                clonePort.updateOverviewFocus.mockClear();
                callbacks.onNavigate(dir);
                // Should not throw, setWorld should be called each time
            }

            // setWorld called: 1 for enter + 4 for navigations = 5
            expect(deps.setWorld).toHaveBeenCalledTimes(5);
        });
    });

    describe('confirm', () => {
        it('exits overview and tears down visual', () => {
            const { deps, clonePort, windowPort, inputAdapter } = createDeps(buildWorld(1, 2));
            const handler = new OverviewHandler(deps);

            handler.handleToggle(); // enter
            handler.handleConfirm();

            // Domain should clear overviewActive
            const lastSetWorld = (deps.setWorld as ReturnType<typeof vi.fn>).mock.calls;
            const exitWorld = lastSetWorld[lastSetWorld.length - 1]![0] as World;
            expect(exitWorld.overviewActive).toBe(false);

            expect(clonePort.exitOverview).toHaveBeenCalledOnce();
            expect(windowPort.applyLayout).toHaveBeenCalledOnce();
            expect(inputAdapter.deactivate).toHaveBeenCalledOnce();
            expect(deps.focusWindow).toHaveBeenCalled();
            expect(handler.isActive).toBe(false);
        });
    });

    describe('cancel', () => {
        it('restores pre-overview state', () => {
            const world = buildWorld(1, 2);
            // Focus is on win-2, ws0, scrollX=0
            const { deps, clonePort, inputAdapter } = createDeps(world);
            const handler = new OverviewHandler(deps);

            handler.handleToggle(); // enter

            // Navigate to change focus
            const callbacks = inputAdapter.activate.mock.calls[0]![0];
            callbacks.onNavigate('left'); // should focus win-1

            handler.handleCancel();

            // After cancel, should restore original focus and viewport
            const lastSetWorld = (deps.setWorld as ReturnType<typeof vi.fn>).mock.calls;
            const cancelWorld = lastSetWorld[lastSetWorld.length - 1]![0] as World;
            expect(cancelWorld.overviewActive).toBe(false);
            expect(cancelWorld.focusedWindow).toBe(wid(2)); // restored original focus
            expect(cancelWorld.viewport.workspaceIndex).toBe(0);

            expect(clonePort.exitOverview).toHaveBeenCalledOnce();
            expect(inputAdapter.deactivate).toHaveBeenCalledOnce();
            expect(handler.isActive).toBe(false);
        });
    });

    describe('click', () => {
        it('hit-tests window coordinates and confirms', () => {
            const world = buildWorld(1, 2);
            const { deps, clonePort, inputAdapter } = createDeps(world);
            const handler = new OverviewHandler(deps);

            handler.handleToggle();

            // Get the transform that was computed
            const transform = clonePort.enterOverview.mock.calls[0]![0];
            const { scale, offsetX, offsetY } = transform;

            // Compute click coordinates that map to win-1's area
            // win-1 is at x=8, y=0, width=952, height=1080 in layout coords
            // Click in the middle of win-1
            const clickX = 480 * scale + offsetX;
            const clickY = 540 * scale + offsetY;

            const callbacks = inputAdapter.activate.mock.calls[0]![0];
            callbacks.onClick(clickX, clickY);

            // Should have set focus and confirmed
            // setWorld called: enter + click setFocus + confirm exit = 3 calls
            expect(clonePort.exitOverview).toHaveBeenCalledOnce();
        });

        it('no-ops on click in empty space', () => {
            const world = buildWorld(1);
            const { deps, clonePort, inputAdapter } = createDeps(world);
            const handler = new OverviewHandler(deps);

            handler.handleToggle();

            const transform = clonePort.enterOverview.mock.calls[0]![0];
            const { scale, offsetX, offsetY } = transform;

            // Click way off to the right where no window exists
            const clickX = 5000 * scale + offsetX;
            const clickY = 540 * scale + offsetY;

            const callbacks = inputAdapter.activate.mock.calls[0]![0];
            callbacks.onClick(clickX, clickY);

            // exitOverview should NOT be called (no hit)
            expect(clonePort.exitOverview).not.toHaveBeenCalled();
        });
    });

    describe('destroy', () => {
        it('cleans up input adapter and state', () => {
            const { deps, inputAdapter } = createDeps(buildWorld(1));
            const handler = new OverviewHandler(deps);

            handler.handleToggle(); // enter
            handler.destroy();

            expect(inputAdapter.destroy).toHaveBeenCalledOnce();
            expect(handler.isActive).toBe(false);
        });
    });
});
