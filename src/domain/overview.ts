import type { WorldUpdate } from './types.js';
import type { World } from './world.js';
import { buildUpdate, adjustViewport } from './world.js';
import { enterOverviewInteraction, exitOverviewInteraction, cancelOverviewInteraction } from './overview-state.js';
import { isAgentWindow, getPendingEntries, enterFocusMode } from './notification.js';

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
    const quakeState = world.quakeState.activeSlot !== null
        ? { ...world.quakeState, activeSlot: null }
        : world.quakeState;
    return buildUpdate({ ...world, overviewActive: true, overviewInteractionState, quakeState });
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
 * Try to enter focus mode from overview. If the focused window is an agent window
 * with pending notifications, exits overview and enters focus mode. Otherwise returns null (noop).
 */
export function focusModeFromOverview(world: World): WorldUpdate | null {
    if (!world.overviewActive || !world.focusedWindow) return null;
    if (!isAgentWindow(world.notificationState, world.focusedWindow)) return null;

    // Collect session IDs for the focused window
    const ns = world.notificationState;
    const windowSessions = new Set<string>();
    for (const [sid, wid] of ns.sessionWindows) {
        if (wid === world.focusedWindow) windowSessions.add(sid);
    }

    // Filter pending entries to only those for this window's sessions
    const pendingIds = getPendingEntries(ns)
        .filter(n => windowSessions.has(n.sessionId))
        .map(n => n.id);
    if (pendingIds.length === 0) return null;

    const overviewInteractionState = exitOverviewInteraction(world.overviewInteractionState);
    const exited = adjustViewport({ ...world, overviewActive: false, overviewInteractionState });
    const notificationState = enterFocusMode(exited.notificationState, pendingIds);
    return buildUpdate({ ...exited, notificationState });
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
