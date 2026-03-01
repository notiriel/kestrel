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
    swapColumnNeighbor,
    removeWindow,
    insertColumnAt,
    replaceColumnSlotSpan,
    slotIndexOf,
    columnAtSlot,
    columnOf,
    positionInColumn,
    reorderInColumn,
    stackWindowInto,
    unstackWindow,
    createColumn,
    findWindowInWorkspace,
} from './workspace.js';

function moveHorizontal(world: World, delta: -1 | 1): WorldUpdate {
    if (!world.focusedWindow) return buildUpdate(world);

    const ws = currentWorkspace(world);
    const newWs = swapColumnNeighbor(ws, world.focusedWindow, delta);
    if (newWs === ws) return buildUpdate(world);

    return buildUpdate(adjustViewport(replaceCurrentWorkspace(world, newWs)));
}

/** Swap the focused column with the one to its right. */
export function moveRight(world: World): WorldUpdate { return moveHorizontal(world, 1); }

/** Swap the focused column with the one to its left. */
export function moveLeft(world: World): WorldUpdate { return moveHorizontal(world, -1); }

/**
 * Move down. Within a stack: reorder window down.
 * At bottom of stack: move to workspace below.
 */
export function moveDown(world: World): WorldUpdate {
    if (!world.focusedWindow) return buildUpdate(world);

    const ws = currentWorkspace(world);
    const found = columnOf(ws, world.focusedWindow);
    if (found && found.column.windows.length > 1) {
        const pos = positionInColumn(found.column, world.focusedWindow);
        if (pos < found.column.windows.length - 1) {
            // Reorder within stack
            const newWs = reorderInColumn(ws, world.focusedWindow, 1);
            return buildUpdate(adjustViewport(replaceCurrentWorkspace(world, newWs)));
        }
    }

    // At bottom of stack or single window — move to workspace below
    const sourceWsIndex = world.viewport.workspaceIndex;
    const sourceWs = currentWorkspace(world);
    const targetWsIndex = sourceWsIndex + 1;
    if (targetWsIndex >= world.workspaces.length) return buildUpdate(world);

    return moveVertical(world, sourceWs, sourceWsIndex, targetWsIndex);
}

/**
 * Move up. Within a stack: reorder window up.
 * At top of stack: move to workspace above.
 */
export function moveUp(world: World): WorldUpdate {
    if (!world.focusedWindow) return buildUpdate(world);

    const ws = currentWorkspace(world);
    const found = columnOf(ws, world.focusedWindow);
    if (found && found.column.windows.length > 1) {
        const pos = positionInColumn(found.column, world.focusedWindow);
        if (pos > 0) {
            // Reorder within stack
            const newWs = reorderInColumn(ws, world.focusedWindow, -1);
            return buildUpdate(adjustViewport(replaceCurrentWorkspace(world, newWs)));
        }
    }

    // At top of stack or single window — move to workspace above
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
    const movedWindow = findWindowInWorkspace(sourceWs, windowId)!;

    // Remove from source
    const newSourceWs = removeWindow(sourceWs, windowId);

    // Find insertion point in target via slot matching
    let targetWs = world.workspaces[targetWsIndex]!;
    const targetCol = columnAtSlot(targetWs, sourceSlot);
    let insertIdx: number;
    if (targetCol) {
        // Find the index of the target column
        insertIdx = targetWs.columns.indexOf(targetCol);
    } else {
        insertIdx = targetWs.columns.length;
    }
    const newColumn = createColumn(movedWindow);
    targetWs = insertColumnAt(targetWs, newColumn, insertIdx);

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
 * Toggle the focused column's slotSpan between 1 and config.columnCount.
 */
export function toggleSize(world: World): WorldUpdate {
    if (!world.focusedWindow) return buildUpdate(world);

    const ws = currentWorkspace(world);
    const found = columnOf(ws, world.focusedWindow);
    if (!found) return buildUpdate(world);

    const col = found.column;
    const maxSpan = world.config.columnCount;
    const newSpan = col.slotSpan === 1 ? maxSpan : 1;
    const newWs = replaceColumnSlotSpan(ws, found.columnIndex, newSpan);
    const newWorld = replaceCurrentWorkspace(world, newWs);
    return buildUpdate(adjustViewport(newWorld));
}

/**
 * Toggle stack: if focused window is in a single-window column, stack with left neighbor.
 * If in a multi-window column, unstack (pop out to own column).
 */
export function toggleStack(world: World): WorldUpdate {
    if (!world.focusedWindow) return buildUpdate(world);

    const ws = currentWorkspace(world);
    const found = columnOf(ws, world.focusedWindow);
    if (!found) return buildUpdate(world);

    let newWs;
    if (found.column.windows.length === 1) {
        // Stack with left neighbor
        if (found.columnIndex === 0) return buildUpdate(world); // no left neighbor
        newWs = stackWindowInto(ws, world.focusedWindow, found.columnIndex - 1);
    } else {
        // Unstack
        newWs = unstackWindow(ws, world.focusedWindow);
    }

    if (newWs === ws) return buildUpdate(world);
    const newWorld = replaceCurrentWorkspace(world, newWs);
    return buildUpdate(adjustViewport(newWorld));
}
