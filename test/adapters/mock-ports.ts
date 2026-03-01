import { vi } from 'vitest';
import type { ClonePort } from '../../src/ports/clone-port.js';
import type { WindowPort } from '../../src/ports/window-port.js';

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
        applyScene: vi.fn(),
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
        applyScene: vi.fn(),
        hasUnsettledWindows: vi.fn().mockReturnValue(false),
        destroy: vi.fn(),
    };
}


