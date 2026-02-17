import type { WorldUpdate } from './types.js';
import type { World } from './world.js';
import {
    currentWorkspace,
    replaceCurrentWorkspace,
    buildUpdate,
    adjustViewport,
    pruneEmptyWorkspaces,
    ensureTrailingEmpty,
} from './world.js';
import {
    swapNeighbor,
    removeWindow,
    insertWindowAt,
    replaceWindow,
    slotIndexOf,
    windowAtSlot,
} from './workspace.js';

function moveHorizontal(world: World, delta: -1 | 1): WorldUpdate {
    if (!world.focusedWindow) return buildUpdate(world);

    const ws = currentWorkspace(world);
    const newWs = swapNeighbor(ws, world.focusedWindow, delta);
    if (newWs === ws) return buildUpdate(world);

    return buildUpdate(adjustViewport(replaceCurrentWorkspace(world, newWs)));
}

/** Swap the focused window with the one to its right. */
export function moveRight(world: World): WorldUpdate { return moveHorizontal(world, 1); }

/** Swap the focused window with the one to its left. */
export function moveLeft(world: World): WorldUpdate { return moveHorizontal(world, -1); }

/**
 * Move the focused window to the workspace below.
 * Uses slot-based targeting for insertion position.
 */
export function moveDown(world: World): WorldUpdate {
    if (!world.focusedWindow) return buildUpdate(world);

    const sourceWsIndex = world.viewport.workspaceIndex;
    const sourceWs = currentWorkspace(world);
    const targetWsIndex = sourceWsIndex + 1;

    // Can't move past the last workspace (trailing empty is allowed as target)
    if (targetWsIndex >= world.workspaces.length) return buildUpdate(world);

    return moveVertical(world, sourceWs, sourceWsIndex, targetWsIndex);
}

/**
 * Move the focused window to the workspace above.
 * Uses slot-based targeting for insertion position.
 */
export function moveUp(world: World): WorldUpdate {
    if (!world.focusedWindow) return buildUpdate(world);

    const sourceWsIndex = world.viewport.workspaceIndex;
    const sourceWs = currentWorkspace(world);
    const targetWsIndex = sourceWsIndex - 1;

    if (targetWsIndex < 0) return buildUpdate(world);

    return moveVertical(world, sourceWs, sourceWsIndex, targetWsIndex);
}

function moveVertical(
    world: World,
    sourceWs: ReturnType<typeof currentWorkspace>,
    sourceWsIndex: number,
    targetWsIndex: number,
): WorldUpdate {
    const windowId = world.focusedWindow!;
    const sourceSlot = slotIndexOf(sourceWs, windowId);
    const movedWindow = sourceWs.windows.find(w => w.id === windowId)!;

    // Remove from source
    const newSourceWs = removeWindow(sourceWs, windowId);

    // Find insertion point in target via slot matching
    let targetWs = world.workspaces[targetWsIndex]!;
    const targetWindow = windowAtSlot(targetWs, sourceSlot);
    let insertIdx: number;
    if (targetWindow) {
        insertIdx = targetWs.windows.findIndex(w => w.id === targetWindow.id);
    } else {
        insertIdx = targetWs.windows.length;
    }
    targetWs = insertWindowAt(targetWs, movedWindow, insertIdx);

    // Build new workspaces array
    const workspaces = world.workspaces.map((ws, i) => {
        if (i === sourceWsIndex) return newSourceWs;
        if (i === targetWsIndex) return targetWs;
        return ws;
    });

    let newWorld: World = {
        ...world,
        workspaces,
        viewport: { ...world.viewport, workspaceIndex: targetWsIndex, scrollX: 0 },
        focusedWindow: windowId,
    };

    newWorld = pruneEmptyWorkspaces(newWorld);
    newWorld = ensureTrailingEmpty(newWorld);
    return buildUpdate(adjustViewport(newWorld));
}

/**
 * Toggle the focused window's slotSpan between 1 and 2.
 */
export function toggleSize(world: World): WorldUpdate {
    if (!world.focusedWindow) return buildUpdate(world);

    const ws = currentWorkspace(world);
    const win = ws.windows.find(w => w.id === world.focusedWindow);
    if (!win) return buildUpdate(world);

    const newSpan: 1 | 2 = win.slotSpan === 1 ? 2 : 1;
    const newWindow = { ...win, slotSpan: newSpan };
    const newWs = replaceWindow(ws, win.id, newWindow);
    const newWorld = replaceCurrentWorkspace(world, newWs);
    return buildUpdate(adjustViewport(newWorld));
}
