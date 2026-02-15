import type { WorldUpdate } from './types.js';
import type { World } from './world.js';
import { currentWorkspace, buildUpdate, adjustViewport } from './world.js';
import { windowAfter, windowBefore } from './workspace.js';

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
