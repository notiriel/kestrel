import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the GNOME Shell Extension base class
const mockSettings = {
    get_int: vi.fn().mockReturnValue(8),
    get_string: vi.fn().mockReturnValue(''),
    get_boolean: vi.fn().mockReturnValue(false),
    set_string: vi.fn(),
    connect: vi.fn().mockReturnValue(1),
    disconnect: vi.fn(),
};
vi.mock('resource:///org/gnome/shell/extensions/extension.js', () => ({
    Extension: class {
        getSettings() { return mockSettings; }
        get path() { return '/test'; }
    },
}));

// Mock gi:// modules
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
        uuid_string_random: vi.fn().mockReturnValue('mock-uuid'),
    },
}));

// Mock adapter modules that import gi:// so they don't break loading.
function mockMethods(...names: string[]) {
    return Object.fromEntries(names.map(n => [n, vi.fn()]));
}

// Store the latest mock instance created by each constructor
const mockInstances: Record<string, any> = {};

vi.mock('../../src/adapters/input/monitor-adapter.js', () => ({
    MonitorAdapter: vi.fn().mockImplementation(() => {
        const inst = {
            readPrimaryMonitor: vi.fn().mockImplementation((_columnCount: number) => ({
                count: 1, totalWidth: 1920, totalHeight: 1080, slotWidth: 960, workAreaY: 0, stageOffsetX: 0,
            })),
            connectMonitorsChanged: vi.fn(),
            destroy: vi.fn(),
        };
        mockInstances.monitor = inst;
        return inst;
    }),
}));
vi.mock('../../src/adapters/shell-adapter.js', () => ({
    ShellAdapter: vi.fn().mockImplementation(() => {
        const inst = mockMethods('hideOverview', 'interceptWmAnimations', 'setQuakeWindowCheck', 'destroy');
        mockInstances.shell = inst;
        return inst;
    }),
}));
vi.mock('../../src/adapters/input/window-event-adapter.js', () => ({
    WindowEventAdapter: vi.fn().mockImplementation(() => {
        const inst = mockMethods('connect', 'enumerateExisting', 'destroy');
        mockInstances.windowEvent = inst;
        return inst;
    }),
}));
vi.mock('../../src/adapters/output/clone-adapter.js', () => ({
    CloneAdapter: vi.fn().mockImplementation(() => {
        const inst = {
            ...mockMethods(
                'init', 'updateWorkArea', 'updateConfig', 'syncWorkspaces', 'addClone', 'removeClone',
                'addFloatClone', 'removeFloatClone', 'moveCloneToWorkspace', 'setWindowFullscreen',
                'applyScene', 'setScroll', 'setScrollForWorkspace', 'animateViewport',
                'enterOverview', 'exitOverview', 'updateOverviewFocus', 'destroy',
            ),
            getLayer: vi.fn().mockReturnValue(null),
            getClonePositions: vi.fn().mockReturnValue(null),
        };
        mockInstances.clone = inst;
        return inst;
    }),
}));
vi.mock('../../src/adapters/output/window-adapter.js', () => ({
    WindowAdapter: vi.fn().mockImplementation(() => {
        const inst = {
            ...mockMethods('setWorkAreaY', 'setMonitorBounds', 'track', 'untrack', 'setWindowFullscreen', 'applyScene', 'destroy'),
            hasUnsettledWindows: vi.fn().mockReturnValue(false),
        };
        mockInstances.window = inst;
        return inst;
    }),
}));
vi.mock('../../src/adapters/output/focus-adapter.js', () => ({
    FocusAdapter: vi.fn().mockImplementation(() => {
        const inst = mockMethods('track', 'untrack', 'focus', 'focusInternal', 'getMetaWindow', 'openNewWindow', 'closeWindow', 'connectFocusChanged', 'destroy');
        mockInstances.focus = inst;
        return inst;
    }),
}));
vi.mock('../../src/adapters/input/keybinding-adapter.js', () => ({
    KeybindingAdapter: vi.fn().mockImplementation(() => {
        const inst = mockMethods('connect', 'destroy');
        mockInstances.keybinding = inst;
        return inst;
    }),
}));
vi.mock('../../src/adapters/input/overview-input-adapter.js', () => ({ OverviewInputAdapter: vi.fn() }));
vi.mock('../../src/adapters/input/conflict-detector.js', () => ({
    ConflictDetector: vi.fn().mockImplementation(() => {
        const inst = mockMethods('detectConflicts', 'destroy');
        mockInstances.conflictDetector = inst;
        return inst;
    }),
}));
function makeStatePersistenceMock(tryRestoreResult: any = null) {
    return () => {
        const inst = {
            readConfig: vi.fn().mockReturnValue({ gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(125,214,164,0.05)', columnCount: 2, quakeSlots: [], quakeWidthPercent: 80, quakeHeightPercent: 80 }),
            save: vi.fn(),
            tryRestore: vi.fn().mockReturnValue(tryRestoreResult),
        };
        mockInstances.statePersistence = inst;
        return inst;
    };
}
vi.mock('../../src/adapters/state-persistence.js', () => ({
    StatePersistence: vi.fn().mockImplementation(makeStatePersistenceMock()),
}));
vi.mock('../../src/adapters/notification-coordinator.js', () => ({
    NotificationCoordinator: vi.fn().mockImplementation(() => ({
        init: vi.fn(),
        destroy: vi.fn(),
        watchWindow: vi.fn(),
        unwatchWindow: vi.fn(),
        setWindowStatus: vi.fn(),
        handlePermissionRequest: vi.fn(),
        handleNotification: vi.fn(),
        getNotificationResponse: vi.fn(),
        toggle: vi.fn(),
        enterOverview: vi.fn(),
        exitOverview: vi.fn(),
        getWindowStatusMap: vi.fn().mockReturnValue(new Map()),
        getWindowForSession: vi.fn().mockReturnValue(null),
    })),
}));
vi.mock('../../src/adapters/output/panel-indicator-adapter.js', () => ({
    PanelIndicatorAdapter: vi.fn().mockImplementation(() => ({
        init: vi.fn(),
        update: vi.fn(),
        destroy: vi.fn(),
    })),
}));
vi.mock('../../src/ui-components/help-overlay.js', () => ({
    HelpOverlayAdapter: vi.fn().mockImplementation(() => ({
        toggle: vi.fn(),
        destroy: vi.fn(),
    })),
}));
vi.mock('../../src/adapters/input/mouse-input-adapter.js', () => ({
    MouseInputAdapter: vi.fn().mockImplementation(() => {
        const inst = mockMethods('activate', 'deactivate', 'destroy');
        mockInstances.mouseInput = inst;
        return inst;
    }),
}));
vi.mock('../../src/adapters/output/quake-window-adapter.js', () => ({
    QuakeWindowAdapter: vi.fn().mockImplementation(() => {
        const inst = {
            ...mockMethods('track', 'untrack', 'applyQuakeScene', 'launchApp', 'matchWindowToSlot', 'restoreFocus', 'destroy'),
            isTracked: vi.fn().mockReturnValue(false),
            isQuakeActor: vi.fn().mockReturnValue(false),
        };
        mockInstances.quake = inst;
        return inst;
    }),
}));
vi.mock('../../src/adapters/output/todo-overlay-adapter.js', () => ({
    TodoOverlayAdapter: vi.fn().mockImplementation(() => {
        const inst = {
            ...mockMethods('onWorldChanged', 'destroy', 'setCallbacks', 'saveItems'),
            loadItems: vi.fn().mockReturnValue([]),
        };
        mockInstances.todo = inst;
        return inst;
    }),
}));
vi.mock('../../src/adapters/safe-window.js', () => ({
    safeWindow: (w: unknown) => w,
    rawWindow: (w: unknown) => w,
}));

// Stub global for GNOME Shell env
(globalThis as any).global = {
    context: { unsafe_mode: false },
    _kestrel: null,
};

import KestrelExtension from '../../src/extension.js';
import { StatePersistence } from '../../src/adapters/state-persistence.js';
import { createWorld, addWindow } from '../../src/domain/world.js';
import type { WindowId } from '../../src/domain/types.js';

const MockedStatePersistence = vi.mocked(StatePersistence);

describe('KestrelExtension', () => {
    let ext: KestrelExtension;

    beforeEach(() => {
        // Reset mock instances
        for (const key of Object.keys(mockInstances)) delete mockInstances[key];
        ext = new KestrelExtension({} as any);
    });

    describe('enable()', () => {
        it('detects conflicts', () => {
            ext.enable();
            expect(mockInstances.conflictDetector.detectConflicts).toHaveBeenCalled();
        });

        it('reads monitor', () => {
            ext.enable();
            expect(mockInstances.monitor.readPrimaryMonitor).toHaveBeenCalled();
        });

        it('initializes clone adapter with monitor geometry', () => {
            ext.enable();
            expect(mockInstances.clone.init).toHaveBeenCalledWith(0, 1080, { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(125,214,164,0.05)', columnCount: 2, quakeSlots: [], quakeWidthPercent: 80, quakeHeightPercent: 80 });
            expect(mockInstances.clone.syncWorkspaces).toHaveBeenCalled();
        });

        it('configures window adapter with monitor geometry', () => {
            ext.enable();
            expect(mockInstances.window.setWorkAreaY).toHaveBeenCalledWith(0);
            expect(mockInstances.window.setMonitorBounds).toHaveBeenCalledWith(0, 1920);
        });

        it('connects keybindings', () => {
            ext.enable();
            expect(mockInstances.keybinding.connect).toHaveBeenCalledWith(
                mockSettings,
                expect.objectContaining({
                    onFocusRight: expect.any(Function),
                    onFocusLeft: expect.any(Function),
                    onToggleOverview: expect.any(Function),
                }),
            );
        });

        it('connects focus change listener', () => {
            ext.enable();
            expect(mockInstances.focus.connectFocusChanged).toHaveBeenCalledWith(expect.any(Function));
        });

        it('connects monitor change listener', () => {
            ext.enable();
            expect(mockInstances.monitor.connectMonitorsChanged).toHaveBeenCalledWith(2, expect.any(Function));
        });

        it('connects window events', () => {
            ext.enable();
            expect(mockInstances.windowEvent.connect).toHaveBeenCalledWith(
                expect.objectContaining({
                    onWindowReady: expect.any(Function),
                    onWindowDestroyed: expect.any(Function),
                }),
            );
        });

        it('intercepts WM animations', () => {
            ext.enable();
            expect(mockInstances.shell.interceptWmAnimations).toHaveBeenCalled();
        });

        it('enumerates existing windows', () => {
            ext.enable();
            expect(mockInstances.windowEvent.enumerateExisting).toHaveBeenCalled();
        });

        it('hides GNOME overview after delay', () => {
            vi.useFakeTimers();
            ext.enable();
            expect(mockInstances.shell.hideOverview).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1000);
            expect(mockInstances.shell.hideOverview).toHaveBeenCalled();
            vi.useRealTimers();
        });

        it('tries restoring saved state', () => {
            ext.enable();
            expect(mockInstances.statePersistence.tryRestore).toHaveBeenCalled();
        });

        it('reads config', () => {
            ext.enable();
            expect(mockInstances.statePersistence.readConfig).toHaveBeenCalled();
        });
    });

    describe('state restore on enable()', () => {
        it('applies restored world when tryRestore returns state', () => {
            const config = { gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(125,214,164,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(125,214,164,0.05)', columnCount: 2, quakeSlots: [], quakeWidthPercent: 80, quakeHeightPercent: 80 };
            const monitor = { count: 1, totalWidth: 1920, totalHeight: 1080, slotWidth: 960, workAreaY: 0, stageOffsetX: 0 };
            let restored = createWorld(config, monitor);
            restored = addWindow(restored, 'w-1' as WindowId).world;

            // Change tryRestore behavior before enable
            MockedStatePersistence.mockImplementation(makeStatePersistenceMock(restored));

            const ext2 = new KestrelExtension({} as any);
            ext2.enable();

            // syncWorkspaces called twice: once in init, once after restore
            expect(mockInstances.clone.syncWorkspaces).toHaveBeenCalledTimes(2);
            ext2.disable();

            // Restore the default mock
            MockedStatePersistence.mockImplementation(makeStatePersistenceMock());
        });
    });

    describe('window handlers', () => {
        let windowCallbacks: any;
        let focusCallback: (id: any) => void;
        let monitorCallback: (info: any) => void;

        beforeEach(() => {
            ext.enable();

            // Capture callbacks registered during enable()
            windowCallbacks = mockInstances.windowEvent.connect.mock.calls[0][0];
            focusCallback = mockInstances.focus.connectFocusChanged.mock.calls[0][0];
            monitorCallback = mockInstances.monitor.connectMonitorsChanged.mock.calls[0][1];
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

                expect(mockInstances.window.track).toHaveBeenCalledWith('w-1', meta);
                expect(mockInstances.focus.track).toHaveBeenCalledWith('w-1', meta);
                expect(mockInstances.clone.addClone).toHaveBeenCalled();
                expect(mockInstances.window.applyScene).toHaveBeenCalled();
                expect(mockInstances.clone.applyScene).toHaveBeenCalled();
                expect(mockInstances.focus.focusInternal).toHaveBeenCalledWith('w-1');
            });

            it('unmaximizes windows that were maximized', () => {
                const meta = mockMetaWindow({ maximized_horizontally: true });
                windowCallbacks.onWindowReady('w-1', meta);

                expect(meta.unmaximize).toHaveBeenCalledWith(3); // Meta.MaximizeFlags.BOTH
            });

            it('handles fullscreen windows on creation', () => {
                const meta = mockMetaWindow({ fullscreen: true });
                windowCallbacks.onWindowReady('w-1', meta);

                expect(mockInstances.clone.setWindowFullscreen).toHaveBeenCalledWith('w-1', true);
                expect(mockInstances.window.setWindowFullscreen).toHaveBeenCalledWith('w-1', true);
            });

            it('animates viewport when scroll changes', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());
                windowCallbacks.onWindowReady('w-2', mockMetaWindow());

                expect(mockInstances.clone.applyScene).toHaveBeenCalled();
            });
        });

        describe('_handleWindowDestroyed', () => {
            it('removes window from domain and untracks', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());
                windowCallbacks.onWindowDestroyed('w-1');

                expect(mockInstances.clone.removeClone).toHaveBeenCalledWith('w-1');
                expect(mockInstances.window.untrack).toHaveBeenCalledWith('w-1');
                expect(mockInstances.focus.untrack).toHaveBeenCalledWith('w-1');
            });
        });

        describe('_handleFullscreenChanged', () => {
            it('enters fullscreen', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());
                windowCallbacks.onWindowFullscreenChanged('w-1', true);

                expect(mockInstances.clone.setWindowFullscreen).toHaveBeenCalledWith('w-1', true);
                expect(mockInstances.window.setWindowFullscreen).toHaveBeenCalledWith('w-1', true);
            });

            it('exits fullscreen', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());
                windowCallbacks.onWindowFullscreenChanged('w-1', true);
                windowCallbacks.onWindowFullscreenChanged('w-1', false);

                expect(mockInstances.clone.setWindowFullscreen).toHaveBeenCalledWith('w-1', false);
                expect(mockInstances.window.setWindowFullscreen).toHaveBeenCalledWith('w-1', false);
            });
        });

        describe('_handleWindowMaximized', () => {
            it('widens window to 2-slot and unmaximizes', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());

                mockInstances.focus.getMetaWindow.mockReturnValue(mockMetaWindow());
                windowCallbacks.onWindowMaximized('w-1');

                expect(mockInstances.focus.getMetaWindow).toHaveBeenCalledWith('w-1');
                expect(mockInstances.window.applyScene).toHaveBeenCalled();
            });

            it('handles missing metaWindow gracefully', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());

                mockInstances.focus.getMetaWindow.mockReturnValue(undefined);
                expect(() => windowCallbacks.onWindowMaximized('w-1')).not.toThrow();
            });
        });

        describe('_handleExternalFocus', () => {
            it('updates focus when external focus changes', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());
                windowCallbacks.onWindowReady('w-2', mockMetaWindow());

                mockInstances.clone.applyScene.mockClear();

                focusCallback('w-1' as any);

                expect(mockInstances.clone.applyScene).toHaveBeenCalled();
            });

            it('no-ops when focus matches current', () => {
                windowCallbacks.onWindowReady('w-1', mockMetaWindow());

                mockInstances.clone.applyScene.mockClear();
                focusCallback('w-1' as any);

                expect(mockInstances.clone.applyScene).not.toHaveBeenCalled();
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

                expect(mockInstances.clone.updateWorkArea).toHaveBeenCalledWith(32, 1440);
                expect(mockInstances.window.setWorkAreaY).toHaveBeenCalledWith(32);
                expect(mockInstances.window.setMonitorBounds).toHaveBeenCalledWith(0, 2560);
                expect(mockInstances.window.applyScene).toHaveBeenCalled();
            });
        });

        describe('float windows', () => {
            it('adds float clone on float window ready', () => {
                const meta = mockMetaWindow();
                windowCallbacks.onFloatWindowReady('f-1', meta);

                expect(mockInstances.clone.addFloatClone).toHaveBeenCalledWith('f-1', meta);
            });

            it('removes float clone on float window destroyed', () => {
                windowCallbacks.onFloatWindowDestroyed('f-1');

                expect(mockInstances.clone.removeFloatClone).toHaveBeenCalledWith('f-1');
            });
        });
    });

    describe('enable() with default adapter constructors', () => {
        it('constructs and enables using default adapter constructors', () => {
            const ext2 = new KestrelExtension({} as any);
            ext2.enable();
            ext2.disable();
        });
    });

    describe('debugState()', () => {
        it('returns JSON state when world exists (debug mode)', () => {
            mockSettings.get_boolean.mockReturnValue(true);
            ext = new KestrelExtension({} as any);
            ext.enable();
            const result = (global as any)._kestrel.debugState();
            const parsed = JSON.parse(result);
            expect(parsed.world).toBeDefined();
            expect(parsed.scene).toBeDefined();
            ext.disable();
            mockSettings.get_boolean.mockReturnValue(false);
        });
    });

    describe('handlers after disable (null guards)', () => {
        let windowCallbacks: any;
        let focusCallback: (id: any) => void;
        let monitorCallback: (info: any) => void;

        beforeEach(() => {
            ext.enable();
            windowCallbacks = mockInstances.windowEvent.connect.mock.calls[0][0];
            focusCallback = mockInstances.focus.connectFocusChanged.mock.calls[0][0];
            monitorCallback = mockInstances.monitor.connectMonitorsChanged.mock.calls[0][1];
            ext.disable();
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
            ext.enable();
            windowCallbacks = mockInstances.windowEvent.connect.mock.calls[0][0];
            focusCallback = mockInstances.focus.connectFocusChanged.mock.calls[0][0];
            monitorCallback = mockInstances.monitor.connectMonitorsChanged.mock.calls[0][1];
        });

        it('windowReady catches errors', () => {
            mockInstances.clone.addClone.mockImplementation(() => { throw new Error('test'); });
            expect(() => windowCallbacks.onWindowReady('w-1', {
                get_title: () => 'T', get_wm_class: () => 'c',
                maximized_horizontally: false, maximized_vertically: false, fullscreen: false,
            })).not.toThrow();
        });

        it('windowDestroyed catches errors', () => {
            windowCallbacks.onWindowReady('w-1', {
                get_title: () => 'T', get_wm_class: () => 'c',
                maximized_horizontally: false, maximized_vertically: false, fullscreen: false,
            });
            mockInstances.clone.removeClone.mockImplementation(() => { throw new Error('test'); });
            expect(() => windowCallbacks.onWindowDestroyed('w-1')).not.toThrow();
        });

        it('fullscreenChanged catches errors', () => {
            windowCallbacks.onWindowReady('w-1', {
                get_title: () => 'T', get_wm_class: () => 'c',
                maximized_horizontally: false, maximized_vertically: false, fullscreen: false,
            });
            mockInstances.clone.setWindowFullscreen.mockImplementation(() => { throw new Error('test'); });
            expect(() => windowCallbacks.onWindowFullscreenChanged('w-1', true)).not.toThrow();
        });

        it('windowMaximized catches errors', () => {
            windowCallbacks.onWindowReady('w-1', {
                get_title: () => 'T', get_wm_class: () => 'c',
                maximized_horizontally: false, maximized_vertically: false, fullscreen: false,
            });
            mockInstances.clone.applyScene.mockImplementation(() => { throw new Error('test'); });
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
            mockInstances.clone.applyScene.mockImplementation(() => { throw new Error('test'); });
            expect(() => focusCallback('w-1')).not.toThrow();
        });

        it('monitorChange catches errors', () => {
            mockInstances.clone.updateWorkArea.mockImplementation(() => { throw new Error('test'); });
            expect(() => monitorCallback({ count: 1, totalWidth: 2560, totalHeight: 1440, slotWidth: 1280, workAreaY: 32, stageOffsetX: 0 })).not.toThrow();
        });
    });

    describe('disable()', () => {
        beforeEach(() => {
            ext.enable();
        });

        it('saves state', () => {
            ext.disable();
            expect(mockInstances.statePersistence.save).toHaveBeenCalled();
        });

        it('destroys shell adapter', () => {
            ext.disable();
            expect(mockInstances.shell.destroy).toHaveBeenCalled();
        });

        it('destroys window event adapter', () => {
            ext.disable();
            expect(mockInstances.windowEvent.destroy).toHaveBeenCalled();
        });

        it('destroys keybinding adapter', () => {
            ext.disable();
            expect(mockInstances.keybinding.destroy).toHaveBeenCalled();
        });

        it('destroys monitor adapter', () => {
            ext.disable();
            expect(mockInstances.monitor.destroy).toHaveBeenCalled();
        });

        it('destroys window adapter', () => {
            ext.disable();
            expect(mockInstances.window.destroy).toHaveBeenCalled();
        });

        it('destroys focus adapter', () => {
            ext.disable();
            expect(mockInstances.focus.destroy).toHaveBeenCalled();
        });

        it('destroys clone adapter', () => {
            ext.disable();
            expect(mockInstances.clone.destroy).toHaveBeenCalled();
        });

        it('destroys conflict detector', () => {
            ext.disable();
            expect(mockInstances.conflictDetector.destroy).toHaveBeenCalled();
        });
    });
});
