import type { WorldUpdate } from './types.js';
import type { World } from './world.js';
import { currentWorkspace, buildUpdate, adjustViewport } from './world.js';
import { windowAfter, windowBefore, slotIndexOf, windowAtSlot } from './workspace.js';

/**
 * Move focus to the next window (right).
 * If the newly focused window is outside the viewport, scroll to reveal it.
 */
export function focusRight(world: World): WorldUpdate {
    if (!world.focusedWindow) return buildUpdate(world);

    const ws = currentWorkspace(world);
    const next = windowAfter(ws, world.focusedWindow);
    if (!next) return buildUpdate(world);

    const newWorld: World = { ...world, focusedWindow: next.id };
    return buildUpdate(adjustViewport(newWorld));
}

/**
 * Move focus to the previous window (left).
 * If the newly focused window is outside the viewport, scroll to reveal it.
 */
export function focusLeft(world: World): WorldUpdate {
    if (!world.focusedWindow) return buildUpdate(world);

    const ws = currentWorkspace(world);
    const prev = windowBefore(ws, world.focusedWindow);
    if (!prev) return buildUpdate(world);

    const newWorld: World = { ...world, focusedWindow: prev.id };
    return buildUpdate(adjustViewport(newWorld));
}

/**
 * Move focus to the workspace below.
 * Uses slot-based targeting to pick the window at the same horizontal position.
 */
export function focusDown(world: World): WorldUpdate {
    const targetIndex = world.viewport.workspaceIndex + 1;
    if (targetIndex >= world.workspaces.length) return buildUpdate(world);

    return focusVertical(world, targetIndex);
}

/**
 * Move focus to the workspace above.
 * Uses slot-based targeting to pick the window at the same horizontal position.
 */
export function focusUp(world: World): WorldUpdate {
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

    // Find target window via slot matching; if target slot is past all windows,
    // fall back to the last window in the workspace (nearest to the slot position)
    const targetWindow = windowAtSlot(targetWs, targetSlot)
        ?? targetWs.windows[targetWs.windows.length - 1]
        ?? undefined;
    const newFocus = targetWindow?.id ?? null;

    const newWorld: World = {
        ...world,
        viewport: { ...world.viewport, workspaceIndex: targetIndex, scrollX: 0 },
        focusedWindow: newFocus,
    };
    return buildUpdate(adjustViewport(newWorld));
}
