import type { WorldUpdate } from './types.js';
import type { World } from './world.js';
import { currentWorkspace, buildUpdate, adjustViewport } from './world.js';
import { windowNeighbor, slotIndexOf, windowAtSlot } from './workspace.js';

function focusHorizontal(world: World, delta: -1 | 1): WorldUpdate {
    if (!world.focusedWindow) return buildUpdate(world);

    const ws = currentWorkspace(world);
    const focused = ws.windows.find(w => w.id === world.focusedWindow);
    if (focused?.fullscreen) return buildUpdate(world);

    const neighbor = windowNeighbor(ws, world.focusedWindow, delta);
    if (!neighbor) return buildUpdate(world);

    return buildUpdate(adjustViewport({ ...world, focusedWindow: neighbor.id }));
}

/** Move focus to the next window (right). */
export function focusRight(world: World): WorldUpdate { return focusHorizontal(world, 1); }

/** Move focus to the previous window (left). */
export function focusLeft(world: World): WorldUpdate { return focusHorizontal(world, -1); }

/** Move focus to the workspace below. */
export function focusDown(world: World): WorldUpdate {
    const targetIndex = world.viewport.workspaceIndex + 1;
    if (targetIndex >= world.workspaces.length) return buildUpdate(world);
    return focusVertical(world, targetIndex);
}

/** Move focus to the workspace above. */
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
