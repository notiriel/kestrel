import { vi } from 'vitest';
import type { ClonePort } from '../../src/ports/clone-port.js';
import type { WindowPort } from '../../src/ports/window-port.js';
import type { FocusPort } from '../../src/ports/focus-port.js';
import type { ShellPort } from '../../src/ports/shell-port.js';
import type { MonitorPort } from '../../src/ports/monitor-port.js';
import type { KeybindingPort } from '../../src/ports/keybinding-port.js';
import type { WindowEventPort } from '../../src/ports/window-event-port.js';
import type { ConflictDetectorPort } from '../../src/ports/conflict-detector-port.js';
import type { StatePersistencePort } from '../../src/ports/state-persistence-port.js';
import type { ControllerPorts } from '../../src/ports/controller-ports.js';
import type { MonitorInfo } from '../../src/domain/types.js';

type Mocked<T> = T & { [K in keyof T]: ReturnType<typeof vi.fn> };

export function createMockClonePort(): Mocked<ClonePort> {
    return {
        init: vi.fn(),
        updateWorkArea: vi.fn(),
        syncWorkspaces: vi.fn(),
        addClone: vi.fn(),
        removeClone: vi.fn(),
        addFloatClone: vi.fn(),
        removeFloatClone: vi.fn(),
        moveCloneToWorkspace: vi.fn(),
        setWindowFullscreen: vi.fn(),
        applyLayout: vi.fn(),
        setScroll: vi.fn(),
        setScrollForWorkspace: vi.fn(),
        animateViewport: vi.fn(),
        enterOverview: vi.fn(),
        exitOverview: vi.fn(),
        updateOverviewFocus: vi.fn(),
        destroy: vi.fn(),
    };
}

export function createMockWindowPort(): Mocked<WindowPort> {
    return {
        setWorkAreaY: vi.fn(),
        setMonitorBounds: vi.fn(),
        track: vi.fn(),
        untrack: vi.fn(),
        setWindowFullscreen: vi.fn(),
        applyLayout: vi.fn(),
        hasUnsettledWindows: vi.fn().mockReturnValue(false),
        destroy: vi.fn(),
    };
}

export function createMockShellPort(): Mocked<ShellPort> {
    return {
        hideOverview: vi.fn(),
        interceptWmAnimations: vi.fn(),
        destroy: vi.fn(),
    };
}

export function createMockFocusPort(): Mocked<FocusPort> {
    return {
        track: vi.fn(),
        untrack: vi.fn(),
        focus: vi.fn(),
        getMetaWindow: vi.fn(),
        connectFocusChanged: vi.fn(),
        destroy: vi.fn(),
    };
}

export function createMockMonitorPort(monitor?: MonitorInfo): Mocked<MonitorPort> {
    const defaultMonitor: MonitorInfo = monitor ?? {
        count: 1,
        totalWidth: 1920,
        totalHeight: 1080,
        slotWidth: 960,
        workAreaY: 0,
        stageOffsetX: 0,
    };
    return {
        readPrimaryMonitor: vi.fn().mockReturnValue(defaultMonitor),
        connectMonitorsChanged: vi.fn(),
        destroy: vi.fn(),
    };
}

export function createMockKeybindingPort(): Mocked<KeybindingPort> {
    return {
        connect: vi.fn(),
        destroy: vi.fn(),
    };
}

export function createMockWindowEventPort(): Mocked<WindowEventPort> {
    return {
        connect: vi.fn(),
        enumerateExisting: vi.fn(),
        destroy: vi.fn(),
    };
}

export function createMockConflictDetectorPort(): Mocked<ConflictDetectorPort> {
    return {
        detectConflicts: vi.fn(),
        destroy: vi.fn(),
    };
}

export function createMockStatePersistencePort(): Mocked<StatePersistencePort> {
    return {
        readConfig: vi.fn().mockReturnValue({ gapSize: 8, edgeGap: 8, focusBorderWidth: 3, focusBorderColor: 'rgba(255,255,255,0.8)', focusBorderRadius: 8, focusBgColor: 'rgba(255,255,255,0.05)' }),
        save: vi.fn(),
        tryRestore: vi.fn().mockReturnValue(null),
    };
}

export function createMockControllerPorts(): { [K in keyof ControllerPorts]: Mocked<ControllerPorts[K]> } {
    return {
        conflictDetector: createMockConflictDetectorPort(),
        monitor: createMockMonitorPort(),
        clone: createMockClonePort(),
        window: createMockWindowPort(),
        focus: createMockFocusPort(),
        shell: createMockShellPort(),
        keybinding: createMockKeybindingPort(),
        windowEvent: createMockWindowEventPort(),
        statePersistence: createMockStatePersistencePort(),
    };
}
