import type { WorldUpdate } from './types.js';
import type { World } from './world.js';
import { currentWorkspace, buildUpdate, adjustViewport } from './world.js';
import { columnOf, columnNeighbor, positionInColumn, slotIndexOf, columnAtSlot, findWindowInWorkspace } from './workspace.js';

function focusHorizontal(world: World, delta: -1 | 1): WorldUpdate {
    if (!world.focusedWindow) return buildUpdate(world);

    const ws = currentWorkspace(world);
    const found = columnOf(ws, world.focusedWindow);
    if (!found) return buildUpdate(world);

    // Block horizontal navigation from fullscreen windows
    const win = findWindowInWorkspace(ws, world.focusedWindow);
    if (win?.fullscreen) return buildUpdate(world);

    const neighbor = columnNeighbor(ws, world.focusedWindow, delta);
    if (!neighbor) return buildUpdate(world);

    // Position matching: focus the same vertical position in the target column
    const sourcePos = positionInColumn(found.column, world.focusedWindow);
    const targetColIdx = found.columnIndex + delta;
    const targetCol = ws.columns[targetColIdx]!;
    const clampedPos = Math.min(sourcePos, targetCol.windows.length - 1);
    const targetWindow = targetCol.windows[clampedPos] ?? targetCol.windows[0];

    if (!targetWindow) return buildUpdate(world);

    return buildUpdate(adjustViewport({ ...world, focusedWindow: targetWindow.id }));
}

/** Move focus to the next column (right). */
export function focusRight(world: World): WorldUpdate { return focusHorizontal(world, 1); }

/** Move focus to the previous column (left). */
export function focusLeft(world: World): WorldUpdate { return focusHorizontal(world, -1); }

/**
 * Move focus down. Within a stack: focus window below.
 * At bottom of stack (or single-window column): switch to workspace below.
 */
export function focusDown(world: World): WorldUpdate {
    if (!world.focusedWindow) {
        return forceWorkspaceDown(world);
    }

    const ws = currentWorkspace(world);
    const found = columnOf(ws, world.focusedWindow);
    if (found) {
        const pos = positionInColumn(found.column, world.focusedWindow);
        if (pos < found.column.windows.length - 1) {
            // Navigate within stack
            const target = found.column.windows[pos + 1]!;
            return buildUpdate(adjustViewport({ ...world, focusedWindow: target.id }));
        }
    }

    // At bottom of stack or single window — switch workspace
    return forceWorkspaceDown(world);
}

/**
 * Move focus up. Within a stack: focus window above.
 * At top of stack (or single-window column): switch to workspace above.
 */
export function focusUp(world: World): WorldUpdate {
    if (!world.focusedWindow) {
        return forceWorkspaceUp(world);
    }

    const ws = currentWorkspace(world);
    const found = columnOf(ws, world.focusedWindow);
    if (found) {
        const pos = positionInColumn(found.column, world.focusedWindow);
        if (pos > 0) {
            // Navigate within stack
            const target = found.column.windows[pos - 1]!;
            return buildUpdate(adjustViewport({ ...world, focusedWindow: target.id }));
        }
    }

    // At top of stack or single window — switch workspace
    return forceWorkspaceUp(world);
}

/** Always switch to workspace below, regardless of stack position. */
export function forceWorkspaceDown(world: World): WorldUpdate {
    const targetIndex = world.viewport.workspaceIndex + 1;
    if (targetIndex >= world.workspaces.length) return buildUpdate(world);
    return focusVertical(world, targetIndex);
}

/** Always switch to workspace above, regardless of stack position. */
export function forceWorkspaceUp(world: World): WorldUpdate {
    const targetIndex = world.viewport.workspaceIndex - 1;
    if (targetIndex < 0) return buildUpdate(world);
    return focusVertical(world, targetIndex);
}

function focusVertical(world: World, targetIndex: number): WorldUpdate {
    const targetWs = world.workspaces[targetIndex]!;

    // Determine slot index from current focus
    let targetSlot = 1;
    if (world.focusedWindow) {
        const ws = currentWorkspace(world);
        const slot = slotIndexOf(ws, world.focusedWindow);
        if (slot > 0) targetSlot = slot;
    }

    // Find target column via slot matching; if target slot is past all columns,
    // fall back to the first window of the last column
    const targetCol = columnAtSlot(targetWs, targetSlot);
    let targetWindow;
    if (targetCol) {
        // Position matching within the target column
        const sourceWs = currentWorkspace(world);
        const sourceFound = world.focusedWindow ? columnOf(sourceWs, world.focusedWindow) : undefined;
        const sourcePos = sourceFound ? positionInColumn(sourceFound.column, world.focusedWindow!) : 0;
        const clampedPos = Math.min(sourcePos, targetCol.windows.length - 1);
        targetWindow = targetCol.windows[clampedPos] ?? targetCol.windows[0];
    } else {
        // Fall back to last column's first window
        const lastCol = targetWs.columns[targetWs.columns.length - 1];
        targetWindow = lastCol?.windows[0];
    }
    const newFocus = targetWindow?.id ?? null;

    const newWorld: World = {
        ...world,
        viewport: { ...world.viewport, workspaceIndex: targetIndex, scrollX: 0 },
        focusedWindow: newFocus,
    };
    return buildUpdate(adjustViewport(newWorld));
}
