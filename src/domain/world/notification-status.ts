/**
 * Session/window status tracking — pure TypeScript, no gi:// imports.
 *
 * Manages Claude session → window mappings, window status badges,
 * and status persistence across enable/disable cycles.
 */

import type { WindowId } from './types.js';
import type { ClaudeStatus } from './notification-types.js';
import type { Workspace } from './workspace.js';
import { allWindows } from './workspace.js';
import type { NotificationState } from './notification.js';
import { dismissForSession } from './notification.js';

// --- Types ---

export interface SavedWindowStatus {
    status: ClaudeStatus;
    message: string;
    timestamp: number;
}

// --- Session/window management ---

/** Register a Claude session → window mapping and set initial 'done' status. */
export function registerSession(state: NotificationState, sessionId: string, windowId: WindowId): NotificationState {
    const sessionWindows = new Map(state.sessionWindows);
    sessionWindows.set(sessionId, windowId);
    const windowStatuses = new Map(state.windowStatuses);
    const windowStatusTimestamps = new Map(state.windowStatusTimestamps);
    if (!windowStatuses.has(windowId)) {
        windowStatuses.set(windowId, 'done');
        windowStatusTimestamps.set(windowId, Date.now());
    }
    return { ...state, sessionWindows, windowStatuses, windowStatusTimestamps };
}

/** Remove all sessions and status for a destroyed window. */
export function unregisterWindow(state: NotificationState, windowId: WindowId): NotificationState {
    const sessionWindows = new Map(state.sessionWindows);
    for (const [sid, wid] of sessionWindows) {
        if (wid === windowId) sessionWindows.delete(sid);
    }
    const windowStatuses = new Map(state.windowStatuses);
    windowStatuses.delete(windowId);
    const windowStatusTimestamps = new Map(state.windowStatusTimestamps);
    windowStatusTimestamps.delete(windowId);
    const windowStatusMessages = new Map(state.windowStatusMessages);
    windowStatusMessages.delete(windowId);
    return { ...state, sessionWindows, windowStatuses, windowStatusTimestamps, windowStatusMessages };
}

/** Update window status via session → window lookup. Resets message to "..." and dismisses stale notifications when working. */
export function setSessionStatus(state: NotificationState, sessionId: string, status: ClaudeStatus): NotificationState {
    const windowId = state.sessionWindows.get(sessionId);
    if (!windowId) return state;
    const currentStatus = state.windowStatuses.get(windowId);
    if (currentStatus === status) return state;
    const windowStatuses = new Map(state.windowStatuses);
    windowStatuses.set(windowId, status);
    const windowStatusTimestamps = new Map(state.windowStatusTimestamps);
    windowStatusTimestamps.set(windowId, Date.now());
    const windowStatusMessages = new Map(state.windowStatusMessages);
    windowStatusMessages.set(windowId, '...');
    let result = { ...state, windowStatuses, windowStatusTimestamps, windowStatusMessages };
    if (status !== 'done') {
        result = dismissForSession(result, sessionId);
    }
    return result;
}

/** Update the status message for a session's window. Does not change status or timestamp. */
export function setSessionMessage(state: NotificationState, sessionId: string, message: string): NotificationState {
    const windowId = state.sessionWindows.get(sessionId);
    if (!windowId) return state;
    const current = state.windowStatusMessages.get(windowId);
    if (current === message) return state;
    const windowStatusMessages = new Map(state.windowStatusMessages);
    windowStatusMessages.set(windowId, message);
    return { ...state, windowStatusMessages };
}

/** Remove session mapping and window status (for 'end' status). */
export function clearSession(state: NotificationState, sessionId: string): NotificationState {
    const windowId = state.sessionWindows.get(sessionId);
    if (!windowId) return state;
    const sessionWindows = new Map(state.sessionWindows);
    sessionWindows.delete(sessionId);
    const windowStatuses = new Map(state.windowStatuses);
    windowStatuses.delete(windowId);
    const windowStatusTimestamps = new Map(state.windowStatusTimestamps);
    windowStatusTimestamps.delete(windowId);
    const windowStatusMessages = new Map(state.windowStatusMessages);
    windowStatusMessages.delete(windowId);
    return { ...state, sessionWindows, windowStatuses, windowStatusTimestamps, windowStatusMessages };
}

/** True if the session's window is the currently focused window. */
export function shouldSuppressNotification(state: NotificationState, sessionId: string, focusedWindowId: WindowId | null): boolean {
    if (!focusedWindowId) return false;
    const windowId = state.sessionWindows.get(sessionId);
    return windowId === focusedWindowId;
}

/** Look up which window a session is mapped to. */
export function getWindowForSession(state: NotificationState, sessionId: string): WindowId | null {
    return state.sessionWindows.get(sessionId) ?? null;
}

/** Get the window → status map (read-only). */
export function getWindowStatusMap(state: NotificationState): ReadonlyMap<WindowId, ClaudeStatus> {
    return state.windowStatuses;
}

/** Check if a window has a Claude session. */
export function isAgentWindow(state: NotificationState, windowId: WindowId): boolean {
    for (const [, wid] of state.sessionWindows) {
        if (wid === windowId) return true;
    }
    return false;
}

// --- Persistence ---

/** Restore window status data into a notification state (e.g. after screen lock). */
export function restoreWindowStatuses(
    state: NotificationState,
    statuses: ReadonlyMap<WindowId, SavedWindowStatus>,
): NotificationState {
    if (statuses.size === 0) return state;
    const windowStatuses = new Map(state.windowStatuses);
    const windowStatusTimestamps = new Map(state.windowStatusTimestamps);
    const windowStatusMessages = new Map(state.windowStatusMessages);
    for (const [windowId, saved] of statuses) {
        windowStatuses.set(windowId, saved.status);
        windowStatusTimestamps.set(windowId, saved.timestamp);
        windowStatusMessages.set(windowId, saved.message);
    }
    return { ...state, windowStatuses, windowStatusTimestamps, windowStatusMessages };
}

/** Extract window status data for persistence. */
export function extractWindowStatuses(state: NotificationState): Map<WindowId, SavedWindowStatus> {
    const result = new Map<WindowId, SavedWindowStatus>();
    for (const [windowId, status] of state.windowStatuses) {
        result.set(windowId, {
            status,
            message: state.windowStatusMessages.get(windowId) ?? '...',
            timestamp: state.windowStatusTimestamps.get(windowId) ?? Date.now(),
        });
    }
    return result;
}

// --- Workspace status ---

/** Get the highest-priority Claude status across all windows in a workspace. */
export function getWorkspaceClaudeStatus(state: NotificationState, ws: Workspace): ClaudeStatus | null {
    const priority: Record<string, number> = { 'needs-input': 3, 'working': 2, 'done': 1 };
    let best: ClaudeStatus | null = null;
    for (const win of allWindows(ws)) {
        const status = state.windowStatuses.get(win.id);
        if (status && (priority[status] ?? 0) > (priority[best ?? ''] ?? 0)) {
            best = status;
        }
    }
    return best;
}
