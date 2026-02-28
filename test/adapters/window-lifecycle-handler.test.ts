import { describe, it, expect, vi } from 'vitest';

vi.mock('gi://Meta', () => ({
    default: {
        WindowType: { NORMAL: 0 },
        MaximizeFlags: { BOTH: 3 },
    },
}));

vi.mock('../../src/adapters/safe-window.js', () => ({
    safeWindow: (w: unknown) => w,
}));

import { WindowLifecycleHandler, type WindowLifecycleDeps } from '../../src/adapters/window-lifecycle-handler.js';
import { createWorld, addWindow } from '../../src/domain/world.js';
import type { WindowId } from '../../src/domain/types.js';
import type { World } from '../../src/domain/world.js';

const CONFIG = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(125,214,164,0.05)' };
const MONITOR = { count: 1, totalWidth: 1920, totalHeight: 1080, slotWidth: 960, workAreaY: 0, stageOffsetX: 0 };

function mockMetaWindow(overrides: any = {}) {
    return {
        get_title: () => 'Test',
        get_wm_class: () => 'test',
        maximized_horizontally: false,
        maximized_vertically: false,
        fullscreen: false,
        unmaximize: vi.fn(),
        ...overrides,
    };
}

function createMockDeps(world: World): { deps: WindowLifecycleDeps; mocks: Record<string, any> } {
    let currentWorld = world;
    const mocks = {
        setWorld: vi.fn((w: World) => { currentWorld = w; }),
        checkGuard: vi.fn().mockReturnValue(true),
        applyLayout: vi.fn(),
        applyUpdateWithScroll: vi.fn(),
        focusWindow: vi.fn(),
        log: vi.fn(),
        cloneAdapter: {
            init: vi.fn(), updateWorkArea: vi.fn(), syncWorkspaces: vi.fn(),
            addClone: vi.fn(), removeClone: vi.fn(), moveCloneToWorkspace: vi.fn(),
            setWindowFullscreen: vi.fn(), applyLayout: vi.fn(), setScroll: vi.fn(),
            setScrollForWorkspace: vi.fn(), animateViewport: vi.fn(), destroy: vi.fn(),
        },
        windowAdapter: {
            setWorkAreaY: vi.fn(), setMonitorBounds: vi.fn(),
            track: vi.fn(), untrack: vi.fn(), setWindowFullscreen: vi.fn(),
            applyLayout: vi.fn(), hasUnsettledWindows: vi.fn().mockReturnValue(false), destroy: vi.fn(),
        },
        focusAdapter: {
            track: vi.fn(), untrack: vi.fn(), focus: vi.fn(), focusInternal: vi.fn(),
            getMetaWindow: vi.fn(), openNewWindow: vi.fn(), closeWindow: vi.fn(),
            connectFocusChanged: vi.fn(), destroy: vi.fn(),
        },
        startSettlement: vi.fn(),
        watchWindow: vi.fn(),
        unwatchWindow: vi.fn(),
    };

    const deps: WindowLifecycleDeps = {
        getWorld: () => currentWorld,
        setWorld: mocks.setWorld,
        checkGuard: mocks.checkGuard,
        applyLayout: mocks.applyLayout,
        applyUpdateWithScroll: mocks.applyUpdateWithScroll,
        focusWindow: mocks.focusWindow,
        log: mocks.log,
        getCloneAdapter: () => mocks.cloneAdapter,
        getWindowAdapter: () => mocks.windowAdapter,
        getFocusAdapter: () => mocks.focusAdapter,
        startSettlement: mocks.startSettlement,
        watchWindow: mocks.watchWindow,
        unwatchWindow: mocks.unwatchWindow,
    };

    return { deps, mocks };
}

describe('WindowLifecycleHandler', () => {
    describe('handleWindowReady', () => {
        it('adds a new window to the domain and applies layout', () => {
            const world = createWorld(CONFIG, MONITOR);
            const { deps, mocks } = createMockDeps(world);
            const handler = new WindowLifecycleHandler(deps);

            handler.handleWindowReady('w-1' as WindowId, mockMetaWindow() as any);

            expect(mocks.windowAdapter.track).toHaveBeenCalledWith('w-1', expect.anything());
            expect(mocks.focusAdapter.track).toHaveBeenCalledWith('w-1', expect.anything());
            expect(mocks.cloneAdapter.addClone).toHaveBeenCalled();
            expect(mocks.setWorld).toHaveBeenCalled();
            expect(mocks.applyLayout).toHaveBeenCalled();
            expect(mocks.focusWindow).toHaveBeenCalledWith('w-1');
            expect(mocks.startSettlement).toHaveBeenCalled();
        });

        it('watches window for notifications', () => {
            const world = createWorld(CONFIG, MONITOR);
            const { deps, mocks } = createMockDeps(world);
            const handler = new WindowLifecycleHandler(deps);
            const meta = mockMetaWindow();

            handler.handleWindowReady('w-1' as WindowId, meta as any);

            expect(mocks.watchWindow).toHaveBeenCalledWith('w-1', meta);
        });

        it('handles restored window (already in domain)', () => {
            let world = createWorld(CONFIG, MONITOR);
            world = addWindow(world, 'w-99' as WindowId).world;
            const { deps, mocks } = createMockDeps(world);
            const handler = new WindowLifecycleHandler(deps);

            handler.handleWindowReady('w-99' as WindowId, mockMetaWindow() as any);

            expect(mocks.windowAdapter.track).toHaveBeenCalledWith('w-99', expect.anything());
            expect(mocks.cloneAdapter.addClone).toHaveBeenCalled();
            expect(mocks.applyLayout).toHaveBeenCalledWith(expect.anything(), false);
            expect(mocks.startSettlement).toHaveBeenCalled();
        });

        it('unmaximizes maximized windows', () => {
            const world = createWorld(CONFIG, MONITOR);
            const { deps } = createMockDeps(world);
            const handler = new WindowLifecycleHandler(deps);
            const meta = mockMetaWindow({ maximized_horizontally: true });

            handler.handleWindowReady('w-1' as WindowId, meta as any);

            expect(meta.unmaximize).toHaveBeenCalledWith(3);
        });

        it('handles fullscreen windows on creation', () => {
            const world = createWorld(CONFIG, MONITOR);
            const { deps, mocks } = createMockDeps(world);
            const handler = new WindowLifecycleHandler(deps);
            const meta = mockMetaWindow({ fullscreen: true });

            handler.handleWindowReady('w-1' as WindowId, meta as any);

            expect(mocks.cloneAdapter.setWindowFullscreen).toHaveBeenCalledWith('w-1', true);
            expect(mocks.windowAdapter.setWindowFullscreen).toHaveBeenCalledWith('w-1', true);
        });

        it('no-ops when world is null', () => {
            const { deps, mocks } = createMockDeps(null as any);
            (deps as any).getWorld = () => null;
            const handler = new WindowLifecycleHandler(deps);

            expect(() => handler.handleWindowReady('w-1' as WindowId, mockMetaWindow() as any)).not.toThrow();
            expect(mocks.watchWindow).not.toHaveBeenCalled();
        });

        it('no-ops when guard fails', () => {
            const world = createWorld(CONFIG, MONITOR);
            const { deps, mocks } = createMockDeps(world);
            mocks.checkGuard.mockReturnValue(false);
            const handler = new WindowLifecycleHandler(deps);

            handler.handleWindowReady('w-1' as WindowId, mockMetaWindow() as any);

            expect(mocks.cloneAdapter.addClone).not.toHaveBeenCalled();
        });

        it('unmaximizes restored window that was maximized', () => {
            let world = createWorld(CONFIG, MONITOR);
            world = addWindow(world, 'w-99' as WindowId).world;
            const { deps } = createMockDeps(world);
            const handler = new WindowLifecycleHandler(deps);
            const meta = mockMetaWindow({ maximized_vertically: true });

            handler.handleWindowReady('w-99' as WindowId, meta as any);

            expect(meta.unmaximize).toHaveBeenCalledWith(3);
        });
    });

    describe('handleWindowDestroyed', () => {
        it('removes window and applies update with scroll', () => {
            let world = createWorld(CONFIG, MONITOR);
            world = addWindow(world, 'w-1' as WindowId).world;
            const { deps, mocks } = createMockDeps(world);
            const handler = new WindowLifecycleHandler(deps);

            handler.handleWindowDestroyed('w-1' as WindowId);

            expect(mocks.cloneAdapter.removeClone).toHaveBeenCalledWith('w-1');
            expect(mocks.windowAdapter.untrack).toHaveBeenCalledWith('w-1');
            expect(mocks.focusAdapter.untrack).toHaveBeenCalledWith('w-1');
            expect(mocks.unwatchWindow).toHaveBeenCalledWith('w-1');
            expect(mocks.cloneAdapter.syncWorkspaces).toHaveBeenCalled();
            expect(mocks.applyUpdateWithScroll).toHaveBeenCalled();
        });

        it('no-ops when world is null', () => {
            const { deps, mocks } = createMockDeps(null as any);
            (deps as any).getWorld = () => null;
            const handler = new WindowLifecycleHandler(deps);

            expect(() => handler.handleWindowDestroyed('w-1' as WindowId)).not.toThrow();
            expect(mocks.cloneAdapter.removeClone).not.toHaveBeenCalled();
        });
    });

    describe('handleFullscreenChanged', () => {
        it('enters fullscreen', () => {
            let world = createWorld(CONFIG, MONITOR);
            world = addWindow(world, 'w-1' as WindowId).world;
            const { deps, mocks } = createMockDeps(world);
            const handler = new WindowLifecycleHandler(deps);

            handler.handleFullscreenChanged('w-1' as WindowId, true);

            expect(mocks.cloneAdapter.setWindowFullscreen).toHaveBeenCalledWith('w-1', true);
            expect(mocks.windowAdapter.setWindowFullscreen).toHaveBeenCalledWith('w-1', true);
            expect(mocks.setWorld).toHaveBeenCalled();
            expect(mocks.applyLayout).toHaveBeenCalled();
            expect(mocks.focusWindow).toHaveBeenCalled();
        });

        it('exits fullscreen', () => {
            let world = createWorld(CONFIG, MONITOR);
            world = addWindow(world, 'w-1' as WindowId).world;
            const { deps, mocks } = createMockDeps(world);
            const handler = new WindowLifecycleHandler(deps);

            handler.handleFullscreenChanged('w-1' as WindowId, false);

            expect(mocks.cloneAdapter.setWindowFullscreen).toHaveBeenCalledWith('w-1', false);
            expect(mocks.windowAdapter.setWindowFullscreen).toHaveBeenCalledWith('w-1', false);
        });

        it('no-ops when guard fails', () => {
            let world = createWorld(CONFIG, MONITOR);
            world = addWindow(world, 'w-1' as WindowId).world;
            const { deps, mocks } = createMockDeps(world);
            mocks.checkGuard.mockReturnValue(false);
            const handler = new WindowLifecycleHandler(deps);

            handler.handleFullscreenChanged('w-1' as WindowId, true);

            expect(mocks.cloneAdapter.setWindowFullscreen).not.toHaveBeenCalled();
        });
    });

    describe('handleWindowMaximized', () => {
        it('widens window and unmaximizes', () => {
            let world = createWorld(CONFIG, MONITOR);
            world = addWindow(world, 'w-1' as WindowId).world;
            const { deps, mocks } = createMockDeps(world);
            const metaWindow = mockMetaWindow();
            mocks.focusAdapter.getMetaWindow.mockReturnValue(metaWindow);
            const handler = new WindowLifecycleHandler(deps);

            handler.handleWindowMaximized('w-1' as WindowId);

            expect(mocks.focusAdapter.getMetaWindow).toHaveBeenCalledWith('w-1');
            expect(metaWindow.unmaximize).toHaveBeenCalledWith(3);
            expect(mocks.setWorld).toHaveBeenCalled();
            expect(mocks.applyLayout).toHaveBeenCalled();
            expect(mocks.focusWindow).toHaveBeenCalled();
            expect(mocks.startSettlement).toHaveBeenCalled();
        });

        it('handles missing metaWindow gracefully', () => {
            let world = createWorld(CONFIG, MONITOR);
            world = addWindow(world, 'w-1' as WindowId).world;
            const { deps, mocks } = createMockDeps(world);
            mocks.focusAdapter.getMetaWindow.mockReturnValue(undefined);
            const handler = new WindowLifecycleHandler(deps);

            expect(() => handler.handleWindowMaximized('w-1' as WindowId)).not.toThrow();
            expect(mocks.setWorld).toHaveBeenCalled();
        });

        it('no-ops when world is null', () => {
            const { deps, mocks } = createMockDeps(null as any);
            (deps as any).getWorld = () => null;
            const handler = new WindowLifecycleHandler(deps);

            expect(() => handler.handleWindowMaximized('w-1' as WindowId)).not.toThrow();
            expect(mocks.focusAdapter.getMetaWindow).not.toHaveBeenCalled();
        });
    });
});
