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

function currentWorkspace(world: World): Workspace {
    return world.workspaces[world.viewport.workspaceIndex]!;
}

function replaceCurrentWorkspace(world: World, ws: Workspace): World {
    const workspaces = world.workspaces.map((w, i) =>
        i === world.viewport.workspaceIndex ? ws : w,
    );
    return { ...world, workspaces };
}

function buildUpdate(world: World): WorldUpdate {
    const ws = currentWorkspace(world);
    const layout = computeLayout(ws, world.config, world.monitor);
    return { world, layout };
}

export function addWindow(world: World, windowId: WindowId): WorldUpdate {
    const ws = currentWorkspace(world);
    const tiledWindow = createTiledWindow(windowId);
    const newWs = wsAddWindow(ws, tiledWindow);
    const newWorld = replaceCurrentWorkspace(
        { ...world, focusedWindow: windowId },
        newWs,
    );
    return buildUpdate(newWorld);
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
    return buildUpdate(newWorld);
}
