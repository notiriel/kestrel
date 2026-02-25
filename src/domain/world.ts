import type {
    WindowId,
    WorkspaceId,
    KestrelConfig,
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
import { fuzzyMatch } from './fuzzy-match.js';

export interface World {
    readonly workspaces: readonly Workspace[];
    readonly viewport: Viewport;
    readonly focusedWindow: WindowId | null;
    readonly config: KestrelConfig;
    readonly monitor: MonitorInfo;
    readonly overviewActive: boolean;
}

let workspaceCounter = 0;

function nextWorkspaceId(): WorkspaceId {
    return `ws-${workspaceCounter++}` as WorkspaceId;
}

/** Reset workspace ID counter. Called by createWorld() to ensure fresh IDs each enable cycle. */
export function resetWorkspaceCounter(): void {
    workspaceCounter = 0;
}

export function createWorld(config: KestrelConfig, monitor: MonitorInfo): World {
    resetWorkspaceCounter();
    return {
        workspaces: [createWorkspace(nextWorkspaceId())],
        viewport: createViewport(monitor.totalWidth),
        focusedWindow: null,
        config,
        monitor,
        overviewActive: false,
    };
}

export function updateConfig(world: World, config: KestrelConfig): WorldUpdate {
    const newWorld: World = { ...world, config };
    return buildUpdate(adjustViewport(newWorld));
}

export function updateMonitor(world: World, monitor: MonitorInfo): WorldUpdate {
    const newWorld: World = {
        ...world,
        monitor,
        viewport: { ...world.viewport, widthPx: monitor.totalWidth },
    };
    return buildUpdate(adjustViewport(newWorld));
}

/** Find a window across all workspaces. Returns workspace index and window, or null. */
export function findWindowInWorld(world: World, windowId: WindowId): { wsIndex: number; window: TiledWindow } | null {
    for (let i = 0; i < world.workspaces.length; i++) {
        const win = world.workspaces[i]!.windows.find(w => w.id === windowId);
        if (win) return { wsIndex: i, window: win };
    }
    return null;
}

/** Get the workspace ID at a given index. */
export function wsIdAt(world: World, index: number): WorkspaceId | null {
    return world.workspaces[index]?.id ?? null;
}

/** Find which workspace contains a window and return its ID. */
export function findWorkspaceIdForWindow(world: World, windowId: WindowId): WorkspaceId | null {
    const result = findWindowInWorld(world, windowId);
    return result ? world.workspaces[result.wsIndex]!.id : null;
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
 * When minimal is false (default), includes edge-gap padding.
 * When minimal is true, only scrolls when window extends past viewport edge
 * (used by addWindow so opening a window doesn't push existing visible ones).
 */
export function adjustViewport(world: World, minimal: boolean = false): World {
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

    if (minimal) {
        // Only scroll when window extends past viewport edge (not for padding)
        if (winRight > newScrollX + viewport.widthPx) {
            newScrollX = winRight + edgeGap - viewport.widthPx;
        }
        if (winLeft < newScrollX) {
            newScrollX = winLeft - edgeGap;
        }
    } else {
        // Ensure focused window + edge gap padding is visible in viewport
        if (winRight + edgeGap > viewport.scrollX + viewport.widthPx) {
            newScrollX = winRight + edgeGap - viewport.widthPx;
        }
        if (winLeft - edgeGap < newScrollX) {
            newScrollX = winLeft - edgeGap;
        }
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
    const found = findWindowInWorld(world, windowId);
    const targetWsIndex = found ? found.wsIndex : world.viewport.workspaceIndex;

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
    return buildUpdate(adjustViewport(newWorld, true));
}

export function removeWindow(world: World, windowId: WindowId): WorldUpdate {
    const found = findWindowInWorld(world, windowId);
    if (!found) return buildUpdate(world);
    const wsIndex = found.wsIndex;

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

function setWindowFullscreen(world: World, windowId: WindowId, isFullscreen: boolean): WorldUpdate {
    const found = findWindowInWorld(world, windowId);
    if (!found) return buildUpdate(world);

    const { wsIndex, window: win } = found;
    const newWin = { ...win, fullscreen: isFullscreen };
    const newWs = wsReplaceWindow(world.workspaces[wsIndex]!, windowId, newWin);
    const workspaces = world.workspaces.map((w, idx) => idx === wsIndex ? newWs : w);
    const newWorld: World = {
        ...world,
        workspaces,
        ...(isFullscreen ? { focusedWindow: windowId } : {}),
    };
    return buildUpdate(adjustViewport(newWorld));
}

export function enterFullscreen(world: World, windowId: WindowId): WorldUpdate {
    return setWindowFullscreen(world, windowId, true);
}

export function exitFullscreen(world: World, windowId: WindowId): WorldUpdate {
    return setWindowFullscreen(world, windowId, false);
}

/**
 * When the current workspace becomes empty after a window close,
 * move viewport to an adjacent populated workspace.
 * Prefers the workspace below; falls back to above.
 * Uses slot-based targeting from the removed window's position.
 */
function navigateFromEmptyWorkspace(world: World, sourceSlot: number): World {
    const wsIndex = world.viewport.workspaceIndex;

    // Search in a direction for the first populated workspace
    const searchDirection = (start: number, end: number, step: number): World | null => {
        for (let i = start; step > 0 ? i < end : i >= end; i += step) {
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
        return null;
    };

    // Try below first, then above
    return searchDirection(wsIndex + 1, world.workspaces.length, 1)
        ?? searchDirection(wsIndex - 1, 0, -1)
        ?? world;
}

/**
 * Set a window's slotSpan to 2 (maximize → wide tile).
 * Finds the window across all workspaces.
 */
export function widenWindow(world: World, windowId: WindowId): WorldUpdate {
    const found = findWindowInWorld(world, windowId);
    if (!found) return buildUpdate(world);

    const { wsIndex, window: win } = found;
    if (win.slotSpan === 2) return buildUpdate(world); // already wide
    const newWin = { ...win, slotSpan: 2 as const };
    const newWs = wsReplaceWindow(world.workspaces[wsIndex]!, windowId, newWin);
    const workspaces = world.workspaces.map((w, idx) => idx === wsIndex ? newWs : w);
    const newWorld: World = { ...world, workspaces };
    return buildUpdate(adjustViewport(newWorld));
}

/** Rename the current workspace. Pass null to clear the name. */
export function renameCurrentWorkspace(world: World, name: string | null): World {
    const ws = currentWorkspace(world);
    return replaceCurrentWorkspace(world, { ...ws, name });
}

/**
 * Filter workspaces by fuzzy matching on name.
 * Returns matching workspace indices sorted by score descending.
 */
export function filterWorkspaces(world: World, query: string): { wsIndex: number; score: number }[] {
    if (!query) return [];
    const results: { wsIndex: number; score: number }[] = [];
    const len = world.workspaces.length;

    for (let i = 0; i < len; i++) {
        const name = world.workspaces[i]!.name;
        if (!name) continue;
        const match = fuzzyMatch(query, name);
        if (match) {
            const positionalBonus = (1 - i / len) * 0.1;
            results.push({ wsIndex: i, score: match.score + positionalBonus });
        }
    }

    results.sort((a, b) => b.score - a.score);
    return results;
}

/** Find a workspace by case-insensitive substring match on name. Returns wsIndex or -1. */
export function findWorkspaceByName(world: World, query: string): number {
    const q = query.toLowerCase();
    for (let i = 0; i < world.workspaces.length; i++) {
        const name = world.workspaces[i]!.name;
        if (name && name.toLowerCase().includes(q)) return i;
    }
    return -1;
}

/** Switch viewport to a specific workspace index. No-op if out of bounds. */
export function switchToWorkspace(world: World, wsIndex: number): WorldUpdate {
    if (wsIndex < 0 || wsIndex >= world.workspaces.length) return buildUpdate(world);
    const targetWs = world.workspaces[wsIndex]!;
    const newFocus = targetWs.windows[0]?.id ?? null;
    const newWorld: World = {
        ...world,
        viewport: { ...world.viewport, workspaceIndex: wsIndex, scrollX: 0 },
        focusedWindow: newFocus,
    };
    return buildUpdate(adjustViewport(newWorld));
}

export interface RestoreWorkspaceData {
    readonly windows: readonly TiledWindow[];
    readonly name: string | null;
}

/**
 * Restore a world from saved state (e.g. after screen lock disable/enable cycle).
 * Creates workspaces with pre-populated windows, restores viewport and focus.
 */
export function restoreWorld(
    config: KestrelConfig,
    monitor: MonitorInfo,
    workspaceData: readonly RestoreWorkspaceData[],
    viewportWorkspaceIndex: number,
    viewportScrollX: number,
    focusedWindow: WindowId | null,
): World {
    let workspaces: Workspace[] = workspaceData.map((data) => {
        const ws = createWorkspace(nextWorkspaceId(), data.name);
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
