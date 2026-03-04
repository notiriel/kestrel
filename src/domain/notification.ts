/**
 * Notification domain model — pure TypeScript, no gi:// imports.
 *
 * Manages notification lifecycle, question interaction state, and response parsing.
 */

import type { WindowId } from './types.js';
import type { ClaudeStatus } from './notification-types.js';
import type { Workspace } from './workspace.js';
import { allWindows } from './workspace.js';

// --- Types ---
export type NotificationStatus = 'pending' | 'responded' | 'dismissed' | 'expired';
export type NotificationType = 'permission' | 'notification' | 'question';

export interface ParsedOption {
    label: string;
    rawLabel: string;
    description: string;
    isRecommended: boolean;
}

export interface ParsedQuestion {
    question: string;
    header: string;
    options: ParsedOption[];
    multiSelect: boolean;
}

export interface QuestionInteractionState {
    currentPage: number;
    answers: Map<number, string[]>;
    otherTexts: Map<number, string>;
    otherActive: Map<number, boolean>;
}

export interface DomainNotification {
    id: string;
    sessionId: string;
    workspaceName?: string;
    type: NotificationType;
    title: string;
    message: string;
    command?: string;
    toolName?: string;
    questions: ParsedQuestion[];
    status: NotificationStatus;
    response: string | null;
    timestamp: number;
    questionState: QuestionInteractionState;
}

export interface FocusModeState {
    active: boolean;
    entryIds: string[];
    currentIndex: number;
}

export interface NotificationState {
    notifications: Map<string, DomainNotification>;
    responses: Map<string, string>;
    sessionWindows: Map<string, WindowId>;
    windowStatuses: Map<WindowId, ClaudeStatus>;
    windowStatusTimestamps: Map<WindowId, number>;
    windowStatusMessages: Map<WindowId, string>;
    focusMode: FocusModeState;
}

// --- Saved status (persisted across enable/disable cycles) ---

export interface SavedWindowStatus {
    status: ClaudeStatus;
    message: string;
    timestamp: number;
}

// --- Factory ---

export function createNotificationState(): NotificationState {
    return {
        notifications: new Map(),
        responses: new Map(),
        sessionWindows: new Map(),
        windowStatuses: new Map(),
        windowStatusTimestamps: new Map(),
        windowStatusMessages: new Map(),
        focusMode: { active: false, entryIds: [], currentIndex: 0 },
    };
}

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

// --- Domain notification factory ---

/** Create a domain notification from structured inputs. Replaces inline construction in coordinator. */
export function createDomainNotification(
    id: string,
    sessionId: string,
    type: NotificationType,
    title: string,
    message: string,
    options?: {
        workspaceName?: string;
        command?: string;
        toolName?: string;
        questions?: ParsedQuestion[];
    },
): DomainNotification {
    return {
        id,
        sessionId,
        type,
        title,
        message,
        workspaceName: options?.workspaceName,
        command: options?.command,
        toolName: options?.toolName,
        questions: options?.questions ?? [],
        status: 'pending',
        response: null,
        timestamp: Date.now(),
        questionState: { currentPage: 0, answers: new Map(), otherTexts: new Map(), otherActive: new Map() },
    };
}

/** Format the title for a question notification based on question count. */
export function formatQuestionTitle(questionCount: number): string {
    return `Claude asks ${questionCount} question${questionCount !== 1 ? 's' : ''}`;
}

// --- Question parsing ---

/**
 * Parse a question definition, stripping "(Recommended)" suffix from option labels
 * and setting the isRecommended flag accordingly.
 */
export function parseQuestion(q: {
    question: string;
    header: string;
    options: ReadonlyArray<{ label: string; description: string }>;
    multiSelect: boolean;
}): ParsedQuestion {
    const options: ParsedOption[] = q.options.map(opt => {
        const isRecommended = /\(Recommended\)\s*$/i.test(opt.label);
        const cleanLabel = opt.label.replace(/\s*\(Recommended\)\s*$/i, '').trim();
        return {
            label: cleanLabel,
            rawLabel: opt.label,
            description: opt.description,
            isRecommended,
        };
    });
    return {
        question: q.question,
        header: q.header,
        options,
        multiSelect: q.multiSelect,
    };
}

// --- Lifecycle ---

export function addNotification(
    state: NotificationState,
    notification: DomainNotification,
    focusedWindowId?: WindowId | null,
): NotificationState {
    // Suppress fire-and-forget notifications when the session's window is focused
    if (
        notification.type === 'notification' &&
        focusedWindowId &&
        state.sessionWindows.get(notification.sessionId) === focusedWindowId
    ) {
        return state;
    }

    // Dismiss stale fire-and-forget notifications for this session before adding new one
    const dismissed = dismissForSession(state, notification.sessionId);
    const notifications = new Map(dismissed.notifications);
    notifications.set(notification.id, notification);
    let newState = { ...dismissed, notifications };

    // Auto-enter focus mode for interactive notifications on the focused window
    if (
        (notification.type === 'permission' || notification.type === 'question') &&
        !newState.focusMode.active &&
        focusedWindowId &&
        newState.sessionWindows.get(notification.sessionId) === focusedWindowId
    ) {
        const pendingIds = getPendingEntries(newState).map(n => n.id);
        newState = enterFocusMode(newState, pendingIds);
    }

    return newState;
}

export function respondToNotification(state: NotificationState, id: string, response: string): NotificationState {
    const existing = state.notifications.get(id);
    if (!existing) return state;

    const updated: DomainNotification = {
        ...existing,
        status: 'responded',
        response,
    };

    const notifications = new Map(state.notifications);
    notifications.set(id, updated);

    const responses = new Map(state.responses);
    responses.set(id, response);

    return { ...state, notifications, responses };
}

/**
 * Dismiss non-interactive (notification type) entries for the same session.
 * Keeps pending permission/question entries.
 */
export function dismissForSession(state: NotificationState, sessionId: string): NotificationState {
    if (!sessionId) return state;

    const notifications = new Map(state.notifications);
    for (const [id, notif] of notifications) {
        if (notif.sessionId !== sessionId) continue;
        // Keep pending permission/question entries
        if ((notif.type === 'permission' || notif.type === 'question') && notif.status === 'pending') continue;
        notifications.delete(id);
    }

    return { ...state, notifications };
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

/**
 * Dismiss non-interactive notifications for all sessions mapped to a window.
 * Used when focus changes to auto-dismiss "done" notifications.
 */
export function dismissNotificationsForWindow(state: NotificationState, windowId: WindowId): NotificationState {
    // Find all sessions for this window
    const sessions: string[] = [];
    for (const [sid, wid] of state.sessionWindows) {
        if (wid === windowId) sessions.push(sid);
    }
    if (sessions.length === 0) return state;

    let result = state;
    for (const sid of sessions) {
        result = dismissForSession(result, sid);
    }
    return result;
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

// --- Response lookup ---

export function getResponse(state: NotificationState, id: string): string | null {
    const notif = state.notifications.get(id);
    if (notif?.response) return notif.response;
    return state.responses.get(id) ?? null;
}

/** Returns notifications with status 'pending', sorted by timestamp ascending. */
export function getPendingEntries(state: NotificationState): DomainNotification[] {
    const pending: DomainNotification[] = [];
    for (const notif of state.notifications.values()) {
        if (notif.status === 'pending') {
            pending.push(notif);
        }
    }
    pending.sort((a, b) => a.timestamp - b.timestamp);
    return pending;
}

// --- Question interaction ---

/**
 * Navigate question pages. Clamps to [0, questions.length] (inclusive — last page is summary).
 */
export function navigateQuestion(state: NotificationState, id: string, delta: number): NotificationState {
    const notif = state.notifications.get(id);
    if (!notif) return state;

    const totalPages = notif.questions.length + 1; // +1 for summary page
    const newPage = Math.max(0, Math.min(totalPages - 1, notif.questionState.currentPage + delta));

    if (newPage === notif.questionState.currentPage) return state;

    const updated: DomainNotification = {
        ...notif,
        questionState: { ...notif.questionState, currentPage: newPage },
    };

    const notifications = new Map(state.notifications);
    notifications.set(id, updated);
    return { ...state, notifications };
}

/**
 * Select/toggle an option on a question page.
 * Handles single-select (replace), multi-select (toggle), and Other (optionIndex === options.length).
 */
export function selectQuestionOption(
    state: NotificationState,
    id: string,
    questionIndex: number,
    optionIndex: number,
): NotificationState {
    const notif = state.notifications.get(id);
    if (!notif) return state;

    const qDef = notif.questions[questionIndex];
    if (!qDef) return state;

    const qs = notif.questionState;
    const answers = new Map(qs.answers);
    const otherTexts = new Map(qs.otherTexts);
    const otherActive = new Map(qs.otherActive);

    const isOther = optionIndex === qDef.options.length;
    const current = [...(answers.get(questionIndex) ?? [])];

    if (isOther) {
        // Select "Other", deselect everything else
        otherActive.set(questionIndex, true);
        const otherText = otherTexts.get(questionIndex) ?? '';
        answers.set(questionIndex, otherText ? [otherText] : []);
    } else if (qDef.multiSelect) {
        const label = qDef.options[optionIndex].label;
        // Deselect "Other" when picking a regular option
        otherActive.delete(questionIndex);
        otherTexts.delete(questionIndex);
        if (current.includes(label)) {
            answers.set(questionIndex, current.filter(l => l !== label));
        } else {
            // Remove any "Other" answer
            const regularLabels = qDef.options.map(o => o.label);
            const filtered = current.filter(l => regularLabels.includes(l));
            answers.set(questionIndex, [...filtered, label]);
        }
    } else {
        if (optionIndex < 0 || optionIndex >= qDef.options.length) return state;
        const label = qDef.options[optionIndex].label;
        // Deselect "Other" when picking a regular option
        otherActive.delete(questionIndex);
        otherTexts.delete(questionIndex);
        answers.set(questionIndex, [label]);
    }

    const updated: DomainNotification = {
        ...notif,
        questionState: { ...qs, answers, otherTexts, otherActive },
    };

    const notifications = new Map(state.notifications);
    notifications.set(id, updated);
    return { ...state, notifications };
}

/** Update the "Other" text for a question and sync it into answers. */
export function setOtherText(
    state: NotificationState,
    id: string,
    questionIndex: number,
    text: string,
): NotificationState {
    const notif = state.notifications.get(id);
    if (!notif) return state;

    const qs = notif.questionState;
    const otherTexts = new Map(qs.otherTexts);
    const answers = new Map(qs.answers);

    otherTexts.set(questionIndex, text);
    if (text.trim()) {
        answers.set(questionIndex, [text.trim()]);
    } else {
        answers.set(questionIndex, []);
    }

    const updated: DomainNotification = {
        ...notif,
        questionState: { ...qs, otherTexts, answers },
    };

    const notifications = new Map(state.notifications);
    notifications.set(id, updated);
    return { ...state, notifications };
}

/** Whether a selection should auto-advance to the next page. True for single-select, non-Other. */
export function shouldAutoAdvance(question: ParsedQuestion, isOther: boolean): boolean {
    if (question.multiSelect) return false;
    if (isOther) return false;
    return true;
}

// --- Response formatting ---

/**
 * Format question answers into the "allow:{JSON}" response string.
 * JSON maps question text to comma-separated answer labels.
 */
export function formatQuestionResponse(notification: DomainNotification): string {
    const answersObj: Record<string, string> = {};
    for (const [qIdx, labels] of notification.questionState.answers) {
        if (qIdx < notification.questions.length) {
            answersObj[notification.questions[qIdx].question] = labels.join(', ');
        }
    }
    return `allow:${JSON.stringify(answersObj)}`;
}

/**
 * Parse an "allow:{JSON}" response string into structured data.
 * - "allow:{JSON}" -> { action: 'allow', answers: parsed JSON }
 * - "allow" -> { action: 'allow' }
 * - other -> { action: response }
 */
export function parseAllowResponse(response: string): { action: string; answers?: Record<string, string> } {
    if (response.startsWith('allow:')) {
        const answersJson = response.slice(6);
        try {
            const answers = JSON.parse(answersJson) as Record<string, string>;
            return { action: 'allow', answers };
        } catch {
            return { action: 'allow' };
        }
    }
    if (response === 'allow') {
        return { action: 'allow' };
    }
    return { action: response };
}

// --- Payload classification ---

/**
 * Classify a permission payload to determine if it contains questions.
 * Returns the detected questions array (empty if none).
 */
export function classifyPermissionPayload(payload: Record<string, unknown>): {
    isQuestion: boolean;
    questions: ReadonlyArray<{
        question: string;
        header: string;
        options: ReadonlyArray<{ label: string; description: string }>;
        multiSelect: boolean;
    }>;
} {
    if (
        payload.tool_name === 'AskUserQuestion' &&
        payload.tool_input &&
        typeof payload.tool_input === 'object' &&
        (payload.tool_input as Record<string, unknown>).questions
    ) {
        const raw = (payload.tool_input as Record<string, unknown>).questions;
        if (Array.isArray(raw) && raw.length > 0) {
            return { isQuestion: true, questions: raw as ReadonlyArray<{
                question: string;
                header: string;
                options: ReadonlyArray<{ label: string; description: string }>;
                multiSelect: boolean;
            }> };
        }
    }
    return { isQuestion: false, questions: [] };
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

// --- Key action mapping ---

/** Map a key number (1-3) to an action string based on notification type. */
export function resolveKeyAction(type: NotificationType, keyNumber: 1 | 2 | 3): string | null {
    if (type === 'permission') {
        const map: Record<number, string> = { 1: 'allow', 2: 'always', 3: 'deny' };
        return map[keyNumber] ?? null;
    }
    // notification type
    const map: Record<number, string | null> = { 1: 'visit', 2: 'dismiss', 3: null };
    return map[keyNumber] ?? null;
}

// --- Question validation ---

/** Check if all questions in a notification have at least one answer. */
export function canSubmitQuestion(notification: DomainNotification): boolean {
    return notification.questions.every(
        (_q, i) => (notification.questionState.answers.get(i) ?? []).length > 0,
    );
}

// --- Focus mode ---

/** Check if a window has a Claude session. */
export function isAgentWindow(state: NotificationState, windowId: WindowId): boolean {
    for (const [, wid] of state.sessionWindows) {
        if (wid === windowId) return true;
    }
    return false;
}

/** Enter focus mode with a list of entry IDs. No-op when overview is active. */
export function enterFocusMode(state: NotificationState, entryIds: string[], overviewActive: boolean = false): NotificationState {
    if (overviewActive) return state;
    return { ...state, focusMode: { active: true, entryIds: [...entryIds], currentIndex: 0 } };
}

/** Enter focus mode starting from a specific notification, including all pending entries. */
export function enterFocusModeForNotification(state: NotificationState, notificationId: string): NotificationState {
    const pending = getPendingEntries(state);
    if (pending.length === 0) return state;
    const entryIds = pending.map(n => n.id);
    const startIndex = Math.max(0, entryIds.indexOf(notificationId));
    return { ...state, focusMode: { active: true, entryIds, currentIndex: startIndex } };
}

/** Exit focus mode, clearing all focus mode state. */
export function exitFocusMode(state: NotificationState): NotificationState {
    return { ...state, focusMode: { active: false, entryIds: [], currentIndex: 0 } };
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
