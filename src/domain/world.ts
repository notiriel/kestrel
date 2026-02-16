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
    replaceWindow as wsReplaceWindow,
    windowAfter,
    windowBefore,
    slotIndexOf,
    windowAtSlot,
} from './workspace.js';
import { createViewport, type Viewport } from './viewport.js';
import { computeLayout } from './layout.js';

export interface World {
    readonly workspaces: readonly Workspace[];
    readonly viewport: Viewport;
    readonly focusedWindow: WindowId | null;
    readonly config: PaperFlowConfig;
    readonly monitor: MonitorInfo;
    readonly overviewActive: boolean;
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
        overviewActive: false,
    };
}

export function updateMonitor(world: World, monitor: MonitorInfo): WorldUpdate {
    const newWorld: World = {
        ...world,
        monitor,
        viewport: { ...world.viewport, widthPx: monitor.totalWidth },
    };
    return buildUpdate(adjustViewport(newWorld));
}

export function currentWorkspace(world: World): Workspace {
    return world.workspaces[world.viewport.workspaceIndex]!;
}

export function replaceCurrentWorkspace(world: World, ws: Workspace): World {
    const workspaces = world.workspaces.map((w, i) =>
        i === world.viewport.workspaceIndex ? ws : w,
    );
    return { ...world, workspaces };
}

export function buildUpdate(world: World): WorldUpdate {
    const layout = computeLayout(world);
    return { world, layout };
}

/** Ensure there is always exactly one empty workspace at the bottom. */
export function ensureTrailingEmpty(world: World): World {
    const last = world.workspaces[world.workspaces.length - 1];
    if (!last || last.windows.length > 0) {
        return {
            ...world,
            workspaces: [...world.workspaces, createWorkspace(nextWorkspaceId())],
        };
    }
    return world;
}

/** Remove empty workspaces except the trailing one. Adjust viewport if needed. */
export function pruneEmptyWorkspaces(world: World): World {
    const workspaces: Workspace[] = [];
    let newWsIndex = world.viewport.workspaceIndex;
    let removedBeforeCurrent = 0;

    for (let i = 0; i < world.workspaces.length; i++) {
        const ws = world.workspaces[i]!;
        const isLast = i === world.workspaces.length - 1;
        // Keep non-empty workspaces and the trailing empty one
        if (ws.windows.length > 0 || isLast) {
            workspaces.push(ws);
        } else {
            // Track if we removed a workspace before the current viewport
            if (i < world.viewport.workspaceIndex) {
                removedBeforeCurrent++;
            }
        }
    }

    newWsIndex -= removedBeforeCurrent;
    // Clamp to valid range
    if (newWsIndex >= workspaces.length) {
        newWsIndex = workspaces.length - 1;
    }
    if (newWsIndex < 0) newWsIndex = 0;

    // If current workspace changed, adjust focus
    let focusedWindow = world.focusedWindow;
    const currentWs = workspaces[newWsIndex];
    if (currentWs && focusedWindow) {
        const exists = currentWs.windows.some(w => w.id === focusedWindow);
        if (!exists) {
            focusedWindow = currentWs.windows[0]?.id ?? null;
        }
    }

    return {
        ...world,
        workspaces,
        viewport: { ...world.viewport, workspaceIndex: newWsIndex },
        focusedWindow,
    };
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

/**
 * Set focus to a specific window and adjust viewport.
 * Used for click-to-focus and external focus sync.
 * Switches workspace if the window lives on a different one.
 */
export function setFocus(world: World, windowId: WindowId): WorldUpdate {
    // Find which workspace contains the target window
    let targetWsIndex = world.viewport.workspaceIndex;
    for (let i = 0; i < world.workspaces.length; i++) {
        if (world.workspaces[i]!.windows.some(w => w.id === windowId)) {
            targetWsIndex = i;
            break;
        }
    }

    const newWorld: World = {
        ...world,
        focusedWindow: windowId,
        viewport: { ...world.viewport, workspaceIndex: targetWsIndex },
    };
    return buildUpdate(adjustViewport(newWorld));
}

export function addWindow(world: World, windowId: WindowId, slotSpan: 1 | 2 = 1): WorldUpdate {
    const ws = currentWorkspace(world);
    const tiledWindow = createTiledWindow(windowId, slotSpan);
    const newWs = wsAddWindow(ws, tiledWindow);
    let newWorld = replaceCurrentWorkspace(
        { ...world, focusedWindow: windowId },
        newWs,
    );
    newWorld = ensureTrailingEmpty(newWorld);
    return buildUpdate(adjustViewportMinimal(newWorld));
}

/**
 * Like adjustViewport but only scrolls when the focused window is actually
 * off-screen (not merely missing edge-gap padding). Used by addWindow so
 * that opening a new window doesn't push existing visible windows out.
 */
function adjustViewportMinimal(world: World): World {
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

    // Only scroll when window extends past viewport edge (not for padding)
    if (winRight > newScrollX + viewport.widthPx) {
        newScrollX = winRight + edgeGap - viewport.widthPx;
    }
    if (winLeft < newScrollX) {
        newScrollX = winLeft - edgeGap;
    }

    if (newScrollX === viewport.scrollX) return world;

    return {
        ...world,
        viewport: { ...viewport, scrollX: newScrollX },
    };
}

export function removeWindow(world: World, windowId: WindowId): WorldUpdate {
    // Find which workspace contains this window
    let wsIndex = -1;
    for (let i = 0; i < world.workspaces.length; i++) {
        if (world.workspaces[i]!.windows.some(w => w.id === windowId)) {
            wsIndex = i;
            break;
        }
    }
    if (wsIndex === -1) return buildUpdate(world);

    const ws = world.workspaces[wsIndex]!;
    const isCurrentWorkspace = wsIndex === world.viewport.workspaceIndex;
    const removedSlot = slotIndexOf(ws, windowId);

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
    const workspaces = world.workspaces.map((w, i) =>
        i === wsIndex ? newWs : w,
    );
    let newWorld: World = { ...world, workspaces, focusedWindow: newFocus };

    // If current workspace just emptied, navigate to an adjacent populated workspace
    if (isCurrentWorkspace && newWs.windows.length === 0 && newFocus === null) {
        newWorld = navigateFromEmptyWorkspace(newWorld, removedSlot);
    }

    newWorld = pruneEmptyWorkspaces(newWorld);
    newWorld = ensureTrailingEmpty(newWorld);
    return buildUpdate(adjustViewport(newWorld));
}

export function enterFullscreen(world: World, windowId: WindowId): WorldUpdate {
    // Find which workspace contains this window
    for (let i = 0; i < world.workspaces.length; i++) {
        const ws = world.workspaces[i]!;
        const win = ws.windows.find(w => w.id === windowId);
        if (win) {
            const newWin = { ...win, fullscreen: true };
            const newWs = wsReplaceWindow(ws, windowId, newWin);
            const workspaces = world.workspaces.map((w, idx) => idx === i ? newWs : w);
            const newWorld: World = { ...world, workspaces, focusedWindow: windowId };
            return buildUpdate(adjustViewport(newWorld));
        }
    }
    return buildUpdate(world);
}

export function exitFullscreen(world: World, windowId: WindowId): WorldUpdate {
    // Find which workspace contains this window
    for (let i = 0; i < world.workspaces.length; i++) {
        const ws = world.workspaces[i]!;
        const win = ws.windows.find(w => w.id === windowId);
        if (win) {
            const newWin = { ...win, fullscreen: false };
            const newWs = wsReplaceWindow(ws, windowId, newWin);
            const workspaces = world.workspaces.map((w, idx) => idx === i ? newWs : w);
            const newWorld: World = { ...world, workspaces };
            return buildUpdate(adjustViewport(newWorld));
        }
    }
    return buildUpdate(world);
}

/**
 * When the current workspace becomes empty after a window close,
 * move viewport to an adjacent populated workspace.
 * Prefers the workspace below; falls back to above.
 * Uses slot-based targeting from the removed window's position.
 */
function navigateFromEmptyWorkspace(world: World, sourceSlot: number): World {
    const wsIndex = world.viewport.workspaceIndex;

    // Try workspace below first (skip trailing empty)
    for (let i = wsIndex + 1; i < world.workspaces.length; i++) {
        const ws = world.workspaces[i]!;
        if (ws.windows.length > 0) {
            const target = windowAtSlot(ws, sourceSlot)
                ?? ws.windows[ws.windows.length - 1];
            return {
                ...world,
                viewport: { ...world.viewport, workspaceIndex: i, scrollX: 0 },
                focusedWindow: target?.id ?? null,
            };
        }
    }

    // Try workspace above
    for (let i = wsIndex - 1; i >= 0; i--) {
        const ws = world.workspaces[i]!;
        if (ws.windows.length > 0) {
            const target = windowAtSlot(ws, sourceSlot)
                ?? ws.windows[ws.windows.length - 1];
            return {
                ...world,
                viewport: { ...world.viewport, workspaceIndex: i, scrollX: 0 },
                focusedWindow: target?.id ?? null,
            };
        }
    }

    // No populated workspace — stay on trailing empty
    return world;
}

/**
 * Set a window's slotSpan to 2 (maximize → wide tile).
 * Finds the window across all workspaces.
 */
export function widenWindow(world: World, windowId: WindowId): WorldUpdate {
    for (let i = 0; i < world.workspaces.length; i++) {
        const ws = world.workspaces[i]!;
        const win = ws.windows.find(w => w.id === windowId);
        if (win) {
            if (win.slotSpan === 2) return buildUpdate(world); // already wide
            const newWin = { ...win, slotSpan: 2 as const };
            const newWs = wsReplaceWindow(ws, windowId, newWin);
            const workspaces = world.workspaces.map((w, idx) => idx === i ? newWs : w);
            const newWorld: World = { ...world, workspaces };
            return buildUpdate(adjustViewport(newWorld));
        }
    }
    return buildUpdate(world);
}

export interface RestoreWorkspaceData {
    readonly windows: readonly TiledWindow[];
}

/**
 * Restore a world from saved state (e.g. after screen lock disable/enable cycle).
 * Creates workspaces with pre-populated windows, restores viewport and focus.
 */
export function restoreWorld(
    config: PaperFlowConfig,
    monitor: MonitorInfo,
    workspaceData: readonly RestoreWorkspaceData[],
    viewportWorkspaceIndex: number,
    viewportScrollX: number,
    focusedWindow: WindowId | null,
): World {
    let workspaces: Workspace[] = workspaceData.map((data, i) => {
        const ws = createWorkspace(nextWorkspaceId());
        return { ...ws, windows: data.windows };
    });

    // Validate focus — ensure the focused window actually exists
    if (focusedWindow) {
        const exists = workspaces.some(ws => ws.windows.some(w => w.id === focusedWindow));
        if (!exists) focusedWindow = null;
    }

    // Clamp viewport index
    if (viewportWorkspaceIndex >= workspaces.length) {
        viewportWorkspaceIndex = Math.max(0, workspaces.length - 1);
    }

    let world: World = {
        workspaces,
        viewport: { workspaceIndex: viewportWorkspaceIndex, scrollX: viewportScrollX, widthPx: monitor.totalWidth },
        focusedWindow,
        config,
        monitor,
        overviewActive: false,
    };

    world = pruneEmptyWorkspaces(world);
    world = ensureTrailingEmpty(world);
    return world;
}
