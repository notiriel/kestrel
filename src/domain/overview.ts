import type { WorldUpdate } from './types.js';
import type { World } from './world.js';
import { buildUpdate, adjustViewport } from './world.js';
import { enterOverviewInteraction, exitOverviewInteraction, cancelOverviewInteraction } from './overview-state.js';

/**
 * Enter overview mode. Sets overviewActive flag and saves pre-overview state
 * (focus, viewport) into overviewInteractionState.
 */
export function enterOverview(world: World): WorldUpdate {
    const overviewInteractionState = enterOverviewInteraction(
        world.overviewInteractionState,
        world.focusedWindow,
        world.viewport.workspaceIndex,
        world.viewport.scrollX,
    );
    return buildUpdate({ ...world, overviewActive: true, overviewInteractionState });
}

/**
 * Exit overview mode (confirm). Clears overviewActive flag and interaction state,
 * adjusts viewport to ensure the currently focused window is visible.
 */
export function exitOverview(world: World): WorldUpdate {
    const overviewInteractionState = exitOverviewInteraction(world.overviewInteractionState);
    const newWorld = adjustViewport({ ...world, overviewActive: false, overviewInteractionState });
    return buildUpdate(newWorld);
}

/**
 * Cancel overview mode. Restores pre-overview focus and viewport state
 * from overviewInteractionState.
 */
export function cancelOverview(world: World): WorldUpdate {
    const { newState, savedFocusedWindow, savedWsIndex, savedScrollX } = cancelOverviewInteraction(
        world.overviewInteractionState,
    );
    return buildUpdate({
        ...world,
        overviewActive: false,
        overviewInteractionState: newState,
        focusedWindow: savedFocusedWindow,
        viewport: {
            ...world.viewport,
            workspaceIndex: savedWsIndex,
            scrollX: savedScrollX,
        },
    });
}
