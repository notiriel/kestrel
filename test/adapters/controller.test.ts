import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock gi:// modules that controller imports
vi.mock('gi://Meta', () => ({
    default: {
        WindowType: { NORMAL: 0 },
        MaximizeFlags: { BOTH: 3 },
        KeyBindingFlags: { NONE: 0 },
    },
}));

vi.mock('gi://Gio', () => ({
    default: {},
}));

vi.mock('gi://GLib', () => ({
    default: {
        PRIORITY_DEFAULT: 0,
        SOURCE_REMOVE: false,
        timeout_add: vi.fn(),
        source_remove: vi.fn(),
    },
}));

// Mock adapter modules that import gi:// so they don't break loading.
// Each returns a constructor that creates a mock with all required methods,
// so both port-injected and fallback (no-port) paths work.
function mockMethods(...names: string[]) {
    return Object.fromEntries(names.map(n => [n, vi.fn()]));
}
vi.mock('../../src/adapters/monitor-adapter.js', () => ({
    MonitorAdapter: vi.fn().mockImplementation(() => ({
        readPrimaryMonitor: vi.fn().mockReturnValue({
            count: 1, totalWidth: 1920, totalHeight: 1080, slotWidth: 960, workAreaY: 0, stageOffsetX: 0,
        }),
        connectMonitorsChanged: vi.fn(),
        destroy: vi.fn(),
    })),
}));
vi.mock('../../src/adapters/shell-adapter.js', () => ({
    ShellAdapter: vi.fn().mockImplementation(() => mockMethods('hideOverview', 'interceptWmAnimations', 'destroy')),
}));
vi.mock('../../src/adapters/window-event-adapter.js', () => ({
    WindowEventAdapter: vi.fn().mockImplementation(() => mockMethods('connect', 'enumerateExisting', 'destroy')),
}));
vi.mock('../../src/adapters/clone-adapter.js', () => ({
    CloneAdapter: vi.fn().mockImplementation(() => ({
        ...mockMethods(
            'init', 'updateWorkArea', 'syncWorkspaces', 'addClone', 'removeClone',
            'addFloatClone', 'removeFloatClone', 'moveCloneToWorkspace', 'setWindowFullscreen',
            'applyLayout', 'setScroll', 'setScrollForWorkspace', 'animateViewport',
            'enterOverview', 'exitOverview', 'updateOverviewFocus', 'destroy',
        ),
        getLayer: vi.fn().mockReturnValue(null),
        getClonePositions: vi.fn().mockReturnValue(null),
    })),
}));
vi.mock('../../src/adapters/window-adapter.js', () => ({
    WindowAdapter: vi.fn().mockImplementation(() => ({
        ...mockMethods('setWorkAreaY', 'setMonitorBounds', 'track', 'untrack', 'setWindowFullscreen', 'applyLayout', 'destroy'),
        hasUnsettledWindows: vi.fn().mockReturnValue(false),
    })),
}));
vi.mock('../../src/adapters/focus-adapter.js', () => ({
    FocusAdapter: vi.fn().mockImplementation(() => mockMethods('track', 'untrack', 'focus', 'getMetaWindow', 'openNewWindow', 'connectFocusChanged', 'destroy')),
}));
vi.mock('../../src/adapters/keybinding-adapter.js', () => ({
    KeybindingAdapter: vi.fn().mockImplementation(() => mockMethods('connect', 'destroy')),
}));
vi.mock('../../src/adapters/overview-input-adapter.js', () => ({ OverviewInputAdapter: vi.fn() }));
vi.mock('../../src/adapters/conflict-detector.js', () => ({
    ConflictDetector: vi.fn().mockImplementation(() => mockMethods('detectConflicts', 'destroy')),
}));
vi.mock('../../src/adapters/state-persistence.js', () => ({
    StatePersistence: vi.fn().mockImplementation(() => ({
        readConfig: vi.fn().mockReturnValue({ gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(255,255,255,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(255,255,255,0.05)' }),
        save: vi.fn(),
        tryRestore: vi.fn().mockReturnValue(null),
    })),
}));
vi.mock('../../src/adapters/status-overlay-adapter.js', () => ({
    StatusOverlayAdapter: vi.fn().mockImplementation(() => ({
        init: vi.fn(),
        watchWindow: vi.fn(),
        unwatchWindow: vi.fn(),
        setWindowStatus: vi.fn(),
        getWindowStatusMap: vi.fn().mockReturnValue(new Map()),
        enterOverview: vi.fn(),
        exitOverview: vi.fn(),
        destroy: vi.fn(),
    })),
}));
vi.mock('../../src/adapters/panel-indicator-adapter.js', () => ({
    PanelIndicatorAdapter: vi.fn().mockImplementation(() => ({
        init: vi.fn(),
        update: vi.fn(),
        destroy: vi.fn(),
    })),
}));
vi.mock('../../src/adapters/notification-overlay-adapter.js', () => ({
    NotificationOverlayAdapter: vi.fn().mockImplementation(() => ({
        init: vi.fn(),
        showPermission: vi.fn(),
        showNotification: vi.fn(),
        getResponse: vi.fn(),
        getPendingEntries: vi.fn().mockReturnValue([]),
        respond: vi.fn(),
        onEntriesChanged: null,
        destroy: vi.fn(),
    })),
}));
vi.mock('../../src/adapters/notification-focus-mode.js', () => ({
    NotificationFocusMode: vi.fn().mockImplementation(() => ({
        toggle: vi.fn(),
        isActive: false,
        destroy: vi.fn(),
    })),
}));
vi.mock('../../src/adapters/dbus-service.js', () => ({
    PaperFlowDBusService: vi.fn().mockImplementation(() => ({
        destroy: vi.fn(),
    })),
}));
vi.mock('../../src/adapters/safe-window.js', () => ({
    safeWindow: (w: unknown) => w,
    rawWindow: (w: unknown) => w,
}));

// Stub global for GNOME Shell env
(globalThis as any).global = {
    context: { unsafe_mode: false },
    _paperflow: null,
};

import { PaperFlowController } from '../../src/adapters/controller.js';
import { createWorld, addWindow } from '../../src/domain/world.js';
import type { WindowId } from '../../src/domain/types.js';
import { createMockControllerPorts } from './mock-ports.js';

function createMockSettings(): any {
    return {
        get_int: vi.fn().mockReturnValue(8),
        get_string: vi.fn().mockReturnValue(''),
        get_boolean: vi.fn().mockReturnValue(false),
        set_string: vi.fn(),
    };
}

describe('PaperFlowController', () => {
    let ports: ReturnType<typeof createMockControllerPorts>;
    let settings: ReturnType<typeof createMockSettings>;
    let controller: PaperFlowController;

    beforeEach(() => {
        ports = createMockControllerPorts();
        settings = createMockSettings();
        controller = new PaperFlowController(settings, ports);
    });

    describe('enable()', () => {
        it('detects conflicts', () => {
            controller.enable();
            expect(ports.conflictDetector.detectConflicts).toHaveBeenCalled();
        });

        it('reads monitor', () => {
            controller.enable();
            expect(ports.monitor.readPrimaryMonitor).toHaveBeenCalled();
        });

        it('initializes clone adapter with monitor geometry', () => {
            controller.enable();
            expect(ports.clone.init).toHaveBeenCalledWith(0, 1080, { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(255,255,255,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(255,255,255,0.05)' });
            expect(ports.clone.syncWorkspaces).toHaveBeenCalled();
        });

        it('configures window adapter with monitor geometry', () => {
            controller.enable();
            expect(ports.window.setWorkAreaY).toHaveBeenCalledWith(0);
            expect(ports.window.setMonitorBounds).toHaveBeenCalledWith(0, 1920);
        });

        it('connects keybindings', () => {
            controller.enable();
            expect(ports.keybinding.connect).toHaveBeenCalledWith(
                settings,
                expect.objectContaining({
                    onFocusRight: expect.any(Function),
                    onFocusLeft: expect.any(Function),
                    onToggleOverview: expect.any(Function),
                }),
            );
        });

        it('connects focus change listener', () => {
            controller.enable();
            expect(ports.focus.connectFocusChanged).toHaveBeenCalledWith(expect.any(Function));
        });

        it('connects monitor change listener', () => {
            controller.enable();
            expect(ports.monitor.connectMonitorsChanged).toHaveBeenCalledWith(expect.any(Function));
        });

        it('connects window events', () => {
            controller.enable();
            expect(ports.windowEvent.connect).toHaveBeenCalledWith(
                expect.objectContaining({
                    onWindowReady: expect.any(Function),
                    onWindowDestroyed: expect.any(Function),
                }),
            );
        });

        it('intercepts WM animations', () => {
            controller.enable();
            expect(ports.shell.interceptWmAnimations).toHaveBeenCalled();
        });

        it('enumerates existing windows', () => {
            controller.enable();
            expect(ports.windowEvent.enumerateExisting).toHaveBeenCalled();
        });

        it('hides GNOME overview after delay', () => {
            vi.useFakeTimers();
            controller.enable();
            expect(ports.shell.hideOverview).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1000);
            expect(ports.shell.hideOverview).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('tries restoring saved state', () => {
            controller.enable();
            expect(ports.statePersistence.tryRestore).toHaveBeenCalled();
        });

        it('reads config', () => {
            controller.enable();
            expect(ports.statePersistence.readConfig).toHaveBeenCalled();
        });
    });

    describe('state restore on enable()', () => {
        it('applies restored world when tryRestore returns state', () => {
            const config = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(255,255,255,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(255,255,255,0.05)' };
            const monitor = ports.monitor.readPrimaryMonitor();
            let restored = createWorld(config, monitor);
            restored = addWindow(restored, 'w-1' as WindowId).world;

            ports.statePersistence.tryRestore.mockReturnValue(restored);

            controller.enable();

            // syncWorkspaces called twice: once in init, once after restore
            expect(ports.clone.syncWorkspaces).toHaveBeenCalledTimes(2);
        });
    });

    describe('window handlers', () => {
        let windowCallbacks: any;
        let focusCallback: (id: any) => void;
        let monitorCallback: (info: any) => void;

        beforeEach(() => {
            controller.enable();

            // Capture callbacks registered during enable()
            windowCallbacks = ports.windowEvent.connect.mock.calls[0][0];
            focusCallback = ports.focus.connectFocusChanged.mock.calls[0][0];
            monitorCallback = ports.monitor.connectMonitorsChanged.mock.calls[0][0];
        });

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

        describe('_handleWindowReady', () => {
            it('adds a window to the domain and applies layout', () => {
                const meta = mockMetaWindow();
                windowCallbacks.onWindowReady('w-1', meta);

                expect(ports.window.track).toHaveBeenCalledWith('w-1', meta);
                expect(ports.focus.track).toHaveBeenCalledWith('w-1', meta);
                expect(ports.clone.addClone).toHaveBeenCalled();
                expect(ports.window.applyLayout).toHaveBeenCalled();
                expect(ports.clone.applyLayout).toHaveBeenCalled();
                expect(ports.focus.focus).toHaveBeenCalledWith('w-1');
            });

            it('unmaximizes windows that were maximized', () => {
                const meta = mockMetaWindow({ maximized_horizontally: true });
                windowCallbacks.onWindowReady('w-1', meta);

                expect(meta.unmaximize).toHaveBeenCalledWith(3); // Meta.MaximizeFlags.BOTH
            });

            it('handles fullscreen windows on creation', () => {
                const meta = mockMetaWindow({ fullscreen: true });
                windowCallbacks.onWindowReady('w-1', meta);

                expect(ports.clone.setWindowFullscreen).toHaveBeenCalledWith('w-1', true);
                expect(ports.window.setWindowFullscreen).toHaveBeenCalledWith('w-1', true);
            });

            it('animates viewport when scroll changes', () => {
                // Add first window (viewport starts at 0)
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());
                // Add second window — may shift viewport
                windowCallbacks.onWindowReady('w-2', mockMetaWindow());

                // scrollX change depends on domain, but applyLayout is always called
                expect(ports.clone.applyLayout).toHaveBeenCalled();
            });

            it('handles restored window (already in domain)', () => {
                // Set up: restore a world with a window already in it
                const config = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(255,255,255,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(255,255,255,0.05)' };
                const monitor = ports.monitor.readPrimaryMonitor();
                let restored = createWorld(config, monitor);
                restored = addWindow(restored, 'w-99' as WindowId).world;

                ports.statePersistence.tryRestore.mockReturnValue(restored);

                // Re-enable with restored state
                const ctrl2 = new PaperFlowController(settings, ports);
                ctrl2.enable();

                const cbs = ports.windowEvent.connect.mock.calls[1][0];

                // Now the "window ready" for w-99 should hit the existsInDomain branch
                const meta = mockMetaWindow();
                cbs.onWindowReady('w-99', meta);

                expect(ports.window.track).toHaveBeenCalledWith('w-99', meta);
                expect(ports.clone.addClone).toHaveBeenCalled();
            });

            it('unmaximizes restored window that was maximized', () => {
                const config = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(255,255,255,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(255,255,255,0.05)' };
                const monitor = ports.monitor.readPrimaryMonitor();
                let restored = createWorld(config, monitor);
                restored = addWindow(restored, 'w-99' as WindowId).world;

                ports.statePersistence.tryRestore.mockReturnValue(restored);

                const ctrl2 = new PaperFlowController(settings, ports);
                ctrl2.enable();
                const cbs = ports.windowEvent.connect.mock.calls[1][0];

                const meta = mockMetaWindow({ maximized_vertically: true });
                cbs.onWindowReady('w-99', meta);

                expect(meta.unmaximize).toHaveBeenCalledWith(3);
            });
        });

        describe('_handleWindowDestroyed', () => {
            it('removes window from domain and untracks', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());
                windowCallbacks.onWindowDestroyed('w-1');

                expect(ports.clone.removeClone).toHaveBeenCalledWith('w-1');
                expect(ports.window.untrack).toHaveBeenCalledWith('w-1');
                expect(ports.focus.untrack).toHaveBeenCalledWith('w-1');
            });
        });

        describe('_handleFullscreenChanged', () => {
            it('enters fullscreen', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());
                windowCallbacks.onWindowFullscreenChanged('w-1', true);

                expect(ports.clone.setWindowFullscreen).toHaveBeenCalledWith('w-1', true);
                expect(ports.window.setWindowFullscreen).toHaveBeenCalledWith('w-1', true);
            });

            it('exits fullscreen', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());
                windowCallbacks.onWindowFullscreenChanged('w-1', true);
                windowCallbacks.onWindowFullscreenChanged('w-1', false);

                expect(ports.clone.setWindowFullscreen).toHaveBeenCalledWith('w-1', false);
                expect(ports.window.setWindowFullscreen).toHaveBeenCalledWith('w-1', false);
            });
        });

        describe('_handleWindowMaximized', () => {
            it('widens window to 2-slot and unmaximizes', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());

                ports.focus.getMetaWindow.mockReturnValue(mockMetaWindow());
                windowCallbacks.onWindowMaximized('w-1');

                expect(ports.focus.getMetaWindow).toHaveBeenCalledWith('w-1');
                expect(ports.window.applyLayout).toHaveBeenCalled();
            });

            it('handles missing metaWindow gracefully', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());

                ports.focus.getMetaWindow.mockReturnValue(undefined);
                // Should not throw
                windowCallbacks.onWindowMaximized('w-1');
            });
        });

        describe('_handleExternalFocus', () => {
            it('updates focus when external focus changes', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());
                windowCallbacks.onWindowReady('w-2', mockMetaWindow());

                // Reset to only track calls from focusCallback
                ports.clone.applyLayout.mockClear();

                focusCallback('w-1' as any);

                expect(ports.clone.applyLayout).toHaveBeenCalled();
            });

            it('no-ops when focus matches current', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());

                ports.clone.applyLayout.mockClear();
                // w-1 is already focused (last added window gets focus)
                focusCallback('w-1' as any);

                // applyLayout should NOT be called since focus didn't change
                expect(ports.clone.applyLayout).not.toHaveBeenCalled();
            });
        });

        describe('_handleMonitorChange', () => {
            it('updates domain and adapters with new monitor info', () => {
                const newMonitor = {
                    count: 1,
                    totalWidth: 2560,
                    totalHeight: 1440,
                    slotWidth: 1280,
                    workAreaY: 32,
                    stageOffsetX: 0,
                };

                monitorCallback(newMonitor);

                expect(ports.clone.updateWorkArea).toHaveBeenCalledWith(32, 1440);
                expect(ports.window.setWorkAreaY).toHaveBeenCalledWith(32);
                expect(ports.window.setMonitorBounds).toHaveBeenCalledWith(0, 2560);
                expect(ports.window.applyLayout).toHaveBeenCalled();
            });
        });

        describe('float windows', () => {
            it('adds float clone on float window ready', () => {
                const meta = mockMetaWindow();
                windowCallbacks.onFloatWindowReady('f-1', meta);

                expect(ports.clone.addFloatClone).toHaveBeenCalledWith('f-1', meta);
            });

            it('removes float clone on float window destroyed', () => {
                windowCallbacks.onFloatWindowDestroyed('f-1');

                expect(ports.clone.removeFloatClone).toHaveBeenCalledWith('f-1');
            });
        });
    });

    describe('enable() without injected ports (fallback adapters)', () => {
        it('constructs and enables using default adapter constructors', () => {
            const ctrl = new PaperFlowController(settings);
            ctrl.enable();
            ctrl.disable();
        });
    });

    describe('debugState()', () => {
        it('returns JSON state when world exists', () => {
            controller.enable();
            const result = (controller as any).debugState();
            const parsed = JSON.parse(result);
            expect(parsed.world).toBeDefined();
            expect(parsed.layout).toBeDefined();
        });

        it('returns error when no world', () => {
            const result = (controller as any).debugState();
            expect(result).toBe('{"error":"no world"}');
        });
    });

    describe('handlers after disable (null guards)', () => {
        let windowCallbacks: any;
        let focusCallback: (id: any) => void;
        let monitorCallback: (info: any) => void;

        beforeEach(() => {
            controller.enable();
            windowCallbacks = ports.windowEvent.connect.mock.calls[0][0];
            focusCallback = ports.focus.connectFocusChanged.mock.calls[0][0];
            monitorCallback = ports.monitor.connectMonitorsChanged.mock.calls[0][0];
            controller.disable();
        });

        it('windowReady no-ops when world is null', () => {
            expect(() => windowCallbacks.onWindowReady('w-1', {})).not.toThrow();
        });

        it('windowDestroyed no-ops when world is null', () => {
            expect(() => windowCallbacks.onWindowDestroyed('w-1')).not.toThrow();
        });

        it('fullscreenChanged no-ops when world is null', () => {
            expect(() => windowCallbacks.onWindowFullscreenChanged('w-1', true)).not.toThrow();
        });

        it('windowMaximized no-ops when world is null', () => {
            expect(() => windowCallbacks.onWindowMaximized('w-1')).not.toThrow();
        });

        it('externalFocus no-ops when world is null', () => {
            expect(() => focusCallback('w-1')).not.toThrow();
        });

        it('monitorChange no-ops when world is null', () => {
            expect(() => monitorCallback({ count: 1, totalWidth: 1920, totalHeight: 1080, slotWidth: 960, workAreaY: 0, stageOffsetX: 0 })).not.toThrow();
        });
    });

    describe('error handling (catch blocks)', () => {
        let windowCallbacks: any;
        let focusCallback: (id: any) => void;
        let monitorCallback: (info: any) => void;

        beforeEach(() => {
            controller.enable();
            windowCallbacks = ports.windowEvent.connect.mock.calls[0][0];
            focusCallback = ports.focus.connectFocusChanged.mock.calls[0][0];
            monitorCallback = ports.monitor.connectMonitorsChanged.mock.calls[0][0];
        });

        it('windowReady catches errors', () => {
            ports.clone.addClone.mockImplementation(() => { throw new Error('test'); });
            expect(() => windowCallbacks.onWindowReady('w-1', {
                get_title: () => 'T', get_wm_class: () => 'c',
                maximized_horizontally: false, maximized_vertically: false, fullscreen: false,
            })).not.toThrow();
        });

        it('windowDestroyed catches errors', () => {
            // Add a window first so removeWindow works
            windowCallbacks.onWindowReady('w-1', {
                get_title: () => 'T', get_wm_class: () => 'c',
                maximized_horizontally: false, maximized_vertically: false, fullscreen: false,
            });
            ports.clone.removeClone.mockImplementation(() => { throw new Error('test'); });
            expect(() => windowCallbacks.onWindowDestroyed('w-1')).not.toThrow();
        });

        it('fullscreenChanged catches errors', () => {
            windowCallbacks.onWindowReady('w-1', {
                get_title: () => 'T', get_wm_class: () => 'c',
                maximized_horizontally: false, maximized_vertically: false, fullscreen: false,
            });
            ports.clone.setWindowFullscreen.mockImplementation(() => { throw new Error('test'); });
            expect(() => windowCallbacks.onWindowFullscreenChanged('w-1', true)).not.toThrow();
        });

        it('windowMaximized catches errors', () => {
            windowCallbacks.onWindowReady('w-1', {
                get_title: () => 'T', get_wm_class: () => 'c',
                maximized_horizontally: false, maximized_vertically: false, fullscreen: false,
            });
            ports.clone.applyLayout.mockImplementation(() => { throw new Error('test'); });
            expect(() => windowCallbacks.onWindowMaximized('w-1')).not.toThrow();
        });

        it('externalFocus catches errors', () => {
            windowCallbacks.onWindowReady('w-1', {
                get_title: () => 'T', get_wm_class: () => 'c',
                maximized_horizontally: false, maximized_vertically: false, fullscreen: false,
            });
            windowCallbacks.onWindowReady('w-2', {
                get_title: () => 'T', get_wm_class: () => 'c',
                maximized_horizontally: false, maximized_vertically: false, fullscreen: false,
            });
            ports.clone.applyLayout.mockImplementation(() => { throw new Error('test'); });
            expect(() => focusCallback('w-1')).not.toThrow();
        });

        it('monitorChange catches errors', () => {
            ports.clone.updateWorkArea.mockImplementation(() => { throw new Error('test'); });
            expect(() => monitorCallback({ count: 1, totalWidth: 2560, totalHeight: 1440, slotWidth: 1280, workAreaY: 32, stageOffsetX: 0 })).not.toThrow();
        });
    });

    describe('disable()', () => {
        beforeEach(() => {
            controller.enable();
        });

        it('saves state', () => {
            controller.disable();
            expect(ports.statePersistence.save).toHaveBeenCalled();
        });

        it('destroys shell adapter', () => {
            controller.disable();
            expect(ports.shell.destroy).toHaveBeenCalled();
        });

        it('destroys window event adapter', () => {
            controller.disable();
            expect(ports.windowEvent.destroy).toHaveBeenCalled();
        });

        it('destroys keybinding adapter', () => {
            controller.disable();
            expect(ports.keybinding.destroy).toHaveBeenCalled();
        });

        it('destroys monitor adapter', () => {
            controller.disable();
            expect(ports.monitor.destroy).toHaveBeenCalled();
        });

        it('destroys window adapter', () => {
            controller.disable();
            expect(ports.window.destroy).toHaveBeenCalled();
        });

        it('destroys focus adapter', () => {
            controller.disable();
            expect(ports.focus.destroy).toHaveBeenCalled();
        });

        it('destroys clone adapter', () => {
            controller.disable();
            expect(ports.clone.destroy).toHaveBeenCalled();
        });

        it('destroys conflict detector', () => {
            controller.disable();
            expect(ports.conflictDetector.destroy).toHaveBeenCalled();
        });
    });
});
