import type { WindowId, WorldUpdate } from './types.js';
import type { World } from './world.js';
import { buildUpdate, adjustViewport } from './world.js';

/**
 * Enter overview mode. Sets overviewActive flag.
 * The adapter uses this to scale down the workspace strip.
 */
export function enterOverview(world: World): WorldUpdate {
    return buildUpdate({ ...world, overviewActive: true });
}

/**
 * Exit overview mode (confirm). Clears overviewActive flag and adjusts viewport
 * to ensure the currently focused window is visible.
 */
export function exitOverview(world: World): WorldUpdate {
    const newWorld = adjustViewport({ ...world, overviewActive: false });
    return buildUpdate(newWorld);
}

/**
 * Cancel overview mode. Restores pre-overview focus and viewport state.
 */
export function cancelOverview(
    world: World,
    savedFocusedWindow: WindowId | null,
    savedWorkspaceIndex: number,
    savedScrollX: number,
): WorldUpdate {
    return buildUpdate({
        ...world,
        overviewActive: false,
        focusedWindow: savedFocusedWindow,
        viewport: {
            ...world.viewport,
            workspaceIndex: savedWorkspaceIndex,
            scrollX: savedScrollX,
        },
    });
}
