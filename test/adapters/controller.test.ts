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

// Mock adapter modules that import gi:// so they don't break loading
vi.mock('../../src/adapters/monitor-adapter.js', () => ({ MonitorAdapter: vi.fn() }));
vi.mock('../../src/adapters/shell-adapter.js', () => ({ ShellAdapter: vi.fn() }));
vi.mock('../../src/adapters/window-event-adapter.js', () => ({ WindowEventAdapter: vi.fn() }));
vi.mock('../../src/adapters/clone-adapter.js', () => ({ CloneAdapter: vi.fn() }));
vi.mock('../../src/adapters/window-adapter.js', () => ({ WindowAdapter: vi.fn() }));
vi.mock('../../src/adapters/focus-adapter.js', () => ({ FocusAdapter: vi.fn() }));
vi.mock('../../src/adapters/keybinding-adapter.js', () => ({ KeybindingAdapter: vi.fn() }));
vi.mock('../../src/adapters/overview-input-adapter.js', () => ({ OverviewInputAdapter: vi.fn() }));
vi.mock('../../src/adapters/conflict-detector.js', () => ({ ConflictDetector: vi.fn() }));
vi.mock('../../src/adapters/state-persistence.js', () => ({ StatePersistence: vi.fn() }));
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
import { createMockControllerPorts } from './mock-ports.js';

function createMockSettings(): any {
    return {
        get_int: vi.fn().mockReturnValue(8),
        get_string: vi.fn().mockReturnValue(''),
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
            expect(ports.clone.init).toHaveBeenCalledWith(0, 1080);
            expect(ports.clone.syncWorkspaces).toHaveBeenCalled();
        });

        it('configures window adapter with monitor geometry', () => {
            controller.enable();
            expect(ports.window.setWorkAreaY).toHaveBeenCalledWith(0);
            expect(ports.window.setMonitorWidth).toHaveBeenCalledWith(1920);
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

        it('hides GNOME overview', () => {
            controller.enable();
            expect(ports.shell.hideOverview).toHaveBeenCalled();
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
