/**
 * Focus mode domain operations — pure TypeScript, no gi:// imports.
 *
 * Manages keyboard-driven navigation through pending notification entries.
 * Simple enter/exit setters remain in notification.ts (used by addNotification).
 */

import type { NotificationState } from './notification.js';
import { getPendingEntries } from './notification.js';

/** Enter focus mode starting from a specific notification, including all pending entries. */
export function enterFocusModeForNotification(state: NotificationState, notificationId: string): NotificationState {
    const pending = getPendingEntries(state);
    if (pending.length === 0) return state;
    const entryIds = pending.map(n => n.id);
    const startIndex = Math.max(0, entryIds.indexOf(notificationId));
    return { ...state, focusMode: { active: true, entryIds, currentIndex: startIndex } };
}

/** Navigate within focus mode entries. Wraps around at both ends. */
export function navigateFocusMode(state: NotificationState, delta: number): NotificationState {
    const fm = state.focusMode;
    if (!fm.active || fm.entryIds.length <= 1) return state;
    const newIndex = ((fm.currentIndex + delta) % fm.entryIds.length + fm.entryIds.length) % fm.entryIds.length;
    return { ...state, focusMode: { ...fm, currentIndex: newIndex } };
}

/** Remove an entry from focus mode (e.g. after responding). Adjusts currentIndex. */
export function removeFromFocusMode(state: NotificationState, entryId: string): NotificationState {
    const fm = state.focusMode;
    const idx = fm.entryIds.indexOf(entryId);
    if (idx === -1) return state;
    const newEntryIds = fm.entryIds.filter(id => id !== entryId);
    const newIndex = Math.min(fm.currentIndex, Math.max(0, newEntryIds.length - 1));
    return { ...state, focusMode: { ...fm, entryIds: newEntryIds, currentIndex: newIndex } };
}

/** Sync focus mode entries with current pending IDs. Removes resolved, adds new. */
export function syncFocusModeEntries(state: NotificationState, currentPendingIds: string[]): NotificationState {
    const fm = state.focusMode;
    if (!fm.active) return state;
    const pendingSet = new Set(currentPendingIds);
    // Keep existing entries that are still pending, add new ones
    const kept = fm.entryIds.filter(id => pendingSet.has(id));
    for (const id of currentPendingIds) {
        if (!kept.includes(id)) kept.push(id);
    }
    const newIndex = Math.min(fm.currentIndex, Math.max(0, kept.length - 1));
    return { ...state, focusMode: { ...fm, entryIds: kept, currentIndex: newIndex } };
}
