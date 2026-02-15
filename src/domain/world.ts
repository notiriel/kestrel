import type {
    WindowId,
    WorkspaceId,
    PaperFlowConfig,
    MonitorInfo,
    WorldUpdate,
} from './types.js';
import type { TiledWindow } from './window.js';
import { createTiledWindow } from './window.js';
import type { Workspace } from './workspace.js';
import {
    createWorkspace,
    addWindow as wsAddWindow,
    removeWindow as wsRemoveWindow,
    windowAfter,
    windowBefore,
} from './workspace.js';
import { createViewport, type Viewport } from './viewport.js';
import { computeLayout } from './layout.js';

export interface World {
    readonly workspaces: readonly Workspace[];
    readonly viewport: Viewport;
    readonly focusedWindow: WindowId | null;
    readonly config: PaperFlowConfig;
    readonly monitor: MonitorInfo;
}

let workspaceCounter = 0;

function nextWorkspaceId(): WorkspaceId {
    return `ws-${workspaceCounter++}` as WorkspaceId;
}

export function createWorld(config: PaperFlowConfig, monitor: MonitorInfo): World {
    return {
        workspaces: [createWorkspace(nextWorkspaceId())],
        viewport: createViewport(monitor.totalWidth),
        focusedWindow: null,
        config,
        monitor,
    };
}

export function withMonitor(world: World, monitor: MonitorInfo): World {
    return {
        ...world,
        monitor,
        viewport: { ...world.viewport, widthPx: monitor.totalWidth },
    };
}

export function currentWorkspace(world: World): Workspace {
    return world.workspaces[world.viewport.workspaceIndex]!;
}

function replaceCurrentWorkspace(world: World, ws: Workspace): World {
    const workspaces = world.workspaces.map((w, i) =>
        i === world.viewport.workspaceIndex ? ws : w,
    );
    return { ...world, workspaces };
}

export function buildUpdate(world: World): WorldUpdate {
    const layout = computeLayout(world);
    return { world, layout };
}

/**
 * Adjust viewport.scrollX so the focused window is fully visible.
 * Scrolls by minimum amount needed.
 */
export function adjustViewport(world: World): World {
    if (!world.focusedWindow) return world;

    const layout = computeLayout(world);
    const focusedLayout = layout.windows.find(
        w => w.windowId === world.focusedWindow,
    );
    if (!focusedLayout) return world;

    const { viewport, config: { edgeGap } } = world;
    const winLeft = focusedLayout.x;
    const winRight = focusedLayout.x + focusedLayout.width;

    let newScrollX = viewport.scrollX;

    // Ensure focused window + edge gap padding is visible in viewport
    if (winRight + edgeGap > viewport.scrollX + viewport.widthPx) {
        newScrollX = winRight + edgeGap - viewport.widthPx;
    }
    if (winLeft - edgeGap < newScrollX) {
        newScrollX = winLeft - edgeGap;
    }

    if (newScrollX === viewport.scrollX) return world;

    return {
        ...world,
        viewport: { ...viewport, scrollX: newScrollX },
    };
}

export function addWindow(world: World, windowId: WindowId): WorldUpdate {
    const ws = currentWorkspace(world);
    const tiledWindow = createTiledWindow(windowId);
    const newWs = wsAddWindow(ws, tiledWindow);
    const newWorld = replaceCurrentWorkspace(
        { ...world, focusedWindow: windowId },
        newWs,
    );
    return buildUpdate(adjustViewport(newWorld));
}

export function removeWindow(world: World, windowId: WindowId): WorldUpdate {
    const ws = currentWorkspace(world);

    // Determine new focus before removing
    let newFocus: WindowId | null = null;
    if (world.focusedWindow === windowId) {
        const after = windowAfter(ws, windowId);
        const before = windowBefore(ws, windowId);
        newFocus = after?.id ?? before?.id ?? null;
    } else {
        newFocus = world.focusedWindow;
    }

    const newWs = wsRemoveWindow(ws, windowId);
    const newWorld = replaceCurrentWorkspace(
        { ...world, focusedWindow: newFocus },
        newWs,
    );
    return buildUpdate(adjustViewport(newWorld));
}
