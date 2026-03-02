import { describe, it, expect, beforeEach } from 'vitest';
import {
    createNotificationState,
    parseQuestion,
    addNotification,
    respondToNotification,
    dismissForSession,
    getResponse,
    getPendingEntries,
    navigateQuestion,
    selectQuestionOption,
    setOtherText,
    shouldAutoAdvance,
    formatQuestionResponse,
    parseAllowResponse,
    classifyPermissionPayload,
    registerSession,
    unregisterWindow,
    setSessionStatus,
    clearSession,
    dismissNotificationsForWindow,
    shouldSuppressNotification,
    getWindowForSession,
    getWindowStatusMap,
    getWorkspaceClaudeStatus,
    resolveKeyAction,
    canSubmitQuestion,
    enterFocusMode,
    exitFocusMode,
    navigateFocusMode,
    removeFromFocusMode,
    syncFocusModeEntries,
} from '../../src/domain/notification.js';
import type {
    NotificationState,
    DomainNotification,
    ParsedQuestion,
} from '../../src/domain/notification.js';
import type { WindowId } from '../../src/domain/types.js';
import { createWorkspace, createColumn, addColumn } from '../../src/domain/workspace.js';
import { createTiledWindow } from '../../src/domain/window.js';
import type { WorkspaceId } from '../../src/domain/types.js';

function makeDomainNotification(overrides: Partial<DomainNotification> = {}): DomainNotification {
    return {
        id: 'notif-1',
        sessionId: 'session-1',
        type: 'permission',
        title: 'Permission Request',
        message: 'Allow bash?',
        questions: [],
        status: 'pending',
        response: null,
        timestamp: 1000,
        questionState: {
            currentPage: 0,
            answers: new Map(),
            otherTexts: new Map(),
            otherActive: new Map(),
        },
        ...overrides,
    };
}

function makeQuestionNotification(overrides: Partial<DomainNotification> = {}): DomainNotification {
    const q1 = parseQuestion({
        question: 'What color?',
        header: 'Preferences',
        options: [
            { label: 'Red', description: 'A warm color' },
            { label: 'Blue (Recommended)', description: 'A cool color' },
        ],
        multiSelect: false,
    });
    const q2 = parseQuestion({
        question: 'What size?',
        header: 'Dimensions',
        options: [
            { label: 'Small', description: '' },
            { label: 'Large', description: '' },
        ],
        multiSelect: true,
    });
    return makeDomainNotification({
        type: 'question',
        title: 'Claude asks 2 questions',
        questions: [q1, q2],
        ...overrides,
    });
}

describe('Notification domain model', () => {
    let state: NotificationState;

    beforeEach(() => {
        state = createNotificationState();
    });

    // --- Lifecycle ---

    describe('lifecycle', () => {
        it('addNotification adds to state', () => {
            const notif = makeDomainNotification();
            const newState = addNotification(state, notif);
            expect(newState.notifications.size).toBe(1);
            expect(newState.notifications.get('notif-1')).toEqual(notif);
        });

        it('respondToNotification sets response and status', () => {
            state = addNotification(state, makeDomainNotification());
            const newState = respondToNotification(state, 'notif-1', 'allow');

            const notif = newState.notifications.get('notif-1')!;
            expect(notif.status).toBe('responded');
            expect(notif.response).toBe('allow');
            expect(newState.responses.get('notif-1')).toBe('allow');
        });

        it('dismissForSession removes non-interactive entries for same session', () => {
            const notifNotification = makeDomainNotification({
                id: 'notif-a',
                sessionId: 'sess-1',
                type: 'notification',
            });
            state = addNotification(state, notifNotification);
            const newState = dismissForSession(state, 'sess-1');
            expect(newState.notifications.size).toBe(0);
        });

        it('dismissForSession keeps pending permission entries', () => {
            const perm = makeDomainNotification({
                id: 'notif-perm',
                sessionId: 'sess-1',
                type: 'permission',
                status: 'pending',
            });
            const notifCard = makeDomainNotification({
                id: 'notif-card',
                sessionId: 'sess-1',
                type: 'notification',
            });
            state = addNotification(state, perm);
            state = addNotification(state, notifCard);
            const newState = dismissForSession(state, 'sess-1');
            expect(newState.notifications.size).toBe(1);
            expect(newState.notifications.has('notif-perm')).toBe(true);
        });

        it('getResponse returns response for responded notification', () => {
            state = addNotification(state, makeDomainNotification());
            state = respondToNotification(state, 'notif-1', 'deny');
            expect(getResponse(state, 'notif-1')).toBe('deny');
        });

        it('getPendingEntries returns sorted pending entries', () => {
            const a = makeDomainNotification({ id: 'a', timestamp: 3000 });
            const b = makeDomainNotification({ id: 'b', timestamp: 1000 });
            const c = makeDomainNotification({ id: 'c', timestamp: 2000, status: 'responded', response: 'allow' });
            state = addNotification(state, a);
            state = addNotification(state, b);
            state = addNotification(state, c);
            const pending = getPendingEntries(state);
            expect(pending.length).toBe(2);
            expect(pending[0].id).toBe('b');
            expect(pending[1].id).toBe('a');
        });
    });

    // --- Question parsing ---

    describe('parseQuestion', () => {
        it('strips (Recommended) suffix and sets isRecommended flag', () => {
            const parsed = parseQuestion({
                question: 'Pick one',
                header: 'Test',
                options: [
                    { label: 'Option A (Recommended)', description: 'desc A' },
                    { label: 'Option B', description: 'desc B' },
                ],
                multiSelect: false,
            });
            expect(parsed.options[0].label).toBe('Option A');
            expect(parsed.options[0].isRecommended).toBe(true);
            expect(parsed.options[1].label).toBe('Option B');
            expect(parsed.options[1].isRecommended).toBe(false);
        });

        it('preserves rawLabel with original text', () => {
            const parsed = parseQuestion({
                question: 'Pick one',
                header: 'Test',
                options: [
                    { label: 'Foo (Recommended)', description: '' },
                ],
                multiSelect: false,
            });
            expect(parsed.options[0].rawLabel).toBe('Foo (Recommended)');
            expect(parsed.options[0].label).toBe('Foo');
        });

        it('handles options without (Recommended)', () => {
            const parsed = parseQuestion({
                question: 'Pick one',
                header: 'Test',
                options: [
                    { label: 'Alpha', description: 'first' },
                    { label: 'Beta', description: 'second' },
                ],
                multiSelect: true,
            });
            expect(parsed.options.every(o => !o.isRecommended)).toBe(true);
            expect(parsed.multiSelect).toBe(true);
        });
    });

    // --- Question interaction ---

    describe('question interaction', () => {
        it('navigateQuestion clamps to valid range', () => {
            const notif = makeQuestionNotification(); // 2 questions => 3 pages (0,1,2)
            state = addNotification(state, notif);

            // Try to go below 0
            let newState = navigateQuestion(state, 'notif-1', -5);
            expect(newState.notifications.get('notif-1')!.questionState.currentPage).toBe(0);

            // Try to go beyond max (2 questions + 1 summary = 3 pages, max index 2)
            newState = navigateQuestion(state, 'notif-1', 10);
            expect(newState.notifications.get('notif-1')!.questionState.currentPage).toBe(2);
        });

        it('navigateQuestion moves forward and back', () => {
            const notif = makeQuestionNotification();
            state = addNotification(state, notif);

            state = navigateQuestion(state, 'notif-1', 1);
            expect(state.notifications.get('notif-1')!.questionState.currentPage).toBe(1);

            state = navigateQuestion(state, 'notif-1', -1);
            expect(state.notifications.get('notif-1')!.questionState.currentPage).toBe(0);
        });

        it('selectQuestionOption single-select replaces previous answer', () => {
            const notif = makeQuestionNotification();
            state = addNotification(state, notif);

            // Select first option on question 0 (single-select: Red/Blue)
            state = selectQuestionOption(state, 'notif-1', 0, 0);
            let answers = state.notifications.get('notif-1')!.questionState.answers;
            expect(answers.get(0)).toEqual(['Red']);

            // Select second option — should replace
            state = selectQuestionOption(state, 'notif-1', 0, 1);
            answers = state.notifications.get('notif-1')!.questionState.answers;
            expect(answers.get(0)).toEqual(['Blue']);
        });

        it('selectQuestionOption multi-select toggles', () => {
            const notif = makeQuestionNotification();
            state = addNotification(state, notif);

            // Question 1 is multi-select (Small/Large)
            state = selectQuestionOption(state, 'notif-1', 1, 0);
            let answers = state.notifications.get('notif-1')!.questionState.answers;
            expect(answers.get(1)).toEqual(['Small']);

            state = selectQuestionOption(state, 'notif-1', 1, 1);
            answers = state.notifications.get('notif-1')!.questionState.answers;
            expect(answers.get(1)).toEqual(['Small', 'Large']);

            // Toggle off Small
            state = selectQuestionOption(state, 'notif-1', 1, 0);
            answers = state.notifications.get('notif-1')!.questionState.answers;
            expect(answers.get(1)).toEqual(['Large']);
        });

        it('selectQuestionOption Other activates other mode', () => {
            const notif = makeQuestionNotification();
            state = addNotification(state, notif);

            // Select "Other" on question 0 (optionIndex === options.length === 2)
            state = selectQuestionOption(state, 'notif-1', 0, 2);
            const qs = state.notifications.get('notif-1')!.questionState;
            expect(qs.otherActive.get(0)).toBe(true);
            expect(qs.answers.get(0)).toEqual([]); // No text entered yet
        });

        it('setOtherText updates text and answers', () => {
            const notif = makeQuestionNotification();
            state = addNotification(state, notif);

            // Activate Other first
            state = selectQuestionOption(state, 'notif-1', 0, 2);

            // Set text
            state = setOtherText(state, 'notif-1', 0, 'Custom answer');
            const qs = state.notifications.get('notif-1')!.questionState;
            expect(qs.otherTexts.get(0)).toBe('Custom answer');
            expect(qs.answers.get(0)).toEqual(['Custom answer']);
        });
    });

    // --- Auto-advance ---

    describe('shouldAutoAdvance', () => {
        it('returns true for single-select non-Other', () => {
            const q: ParsedQuestion = {
                question: 'test',
                header: 'test',
                options: [{ label: 'A', rawLabel: 'A', description: '', isRecommended: false }],
                multiSelect: false,
            };
            expect(shouldAutoAdvance(q, false)).toBe(true);
        });

        it('returns false for multi-select', () => {
            const q: ParsedQuestion = {
                question: 'test',
                header: 'test',
                options: [{ label: 'A', rawLabel: 'A', description: '', isRecommended: false }],
                multiSelect: true,
            };
            expect(shouldAutoAdvance(q, false)).toBe(false);
        });

        it('returns false for Other selection', () => {
            const q: ParsedQuestion = {
                question: 'test',
                header: 'test',
                options: [{ label: 'A', rawLabel: 'A', description: '', isRecommended: false }],
                multiSelect: false,
            };
            expect(shouldAutoAdvance(q, true)).toBe(false);
        });
    });

    // --- Response formatting ---

    describe('response formatting', () => {
        it('formatQuestionResponse produces correct allow:JSON', () => {
            const notif = makeQuestionNotification();
            // Set some answers
            notif.questionState.answers.set(0, ['Red']);
            notif.questionState.answers.set(1, ['Small', 'Large']);

            const response = formatQuestionResponse(notif);
            expect(response).toBe('allow:{"What color?":"Red","What size?":"Small, Large"}');
        });

        it('formatQuestionResponse with multiple questions maps question text to answers', () => {
            const notif = makeQuestionNotification();
            notif.questionState.answers.set(0, ['Blue']);
            notif.questionState.answers.set(1, ['Small']);

            const response = formatQuestionResponse(notif);
            const parsed = JSON.parse(response.slice(6));
            expect(parsed['What color?']).toBe('Blue');
            expect(parsed['What size?']).toBe('Small');
        });

        it('parseAllowResponse parses valid allow:JSON', () => {
            const result = parseAllowResponse('allow:{"What color?":"Red"}');
            expect(result.action).toBe('allow');
            expect(result.answers).toEqual({ 'What color?': 'Red' });
        });

        it('parseAllowResponse handles plain allow', () => {
            const result = parseAllowResponse('allow');
            expect(result.action).toBe('allow');
            expect(result.answers).toBeUndefined();
        });
    });

    // --- Edge cases ---

    describe('edge cases', () => {
        it('respondToNotification is no-op for unknown id', () => {
            const newState = respondToNotification(state, 'unknown', 'allow');
            expect(newState).toBe(state);
        });

        it('navigateQuestion is no-op for unknown id', () => {
            const newState = navigateQuestion(state, 'unknown', 1);
            expect(newState).toBe(state);
        });

        it('selectQuestionOption out-of-bounds optionIndex on single-select is no-op', () => {
            const notif = makeQuestionNotification();
            state = addNotification(state, notif);
            // Question 0 has 2 options (indices 0,1). Index 2 is Other. Index -1 is invalid.
            const newState = selectQuestionOption(state, 'notif-1', 0, -1);
            expect(newState).toBe(state);
        });

        it('dismissForSession with empty sessionId is no-op', () => {
            state = addNotification(state, makeDomainNotification());
            const newState = dismissForSession(state, '');
            expect(newState.notifications.size).toBe(1);
        });

        it('parseAllowResponse handles non-allow response', () => {
            const result = parseAllowResponse('deny');
            expect(result.action).toBe('deny');
            expect(result.answers).toBeUndefined();
        });
    });

    // --- Payload classification ---

    describe('classifyPermissionPayload', () => {
        it('detects questions in AskUserQuestion payload', () => {
            const payload = {
                tool_name: 'AskUserQuestion',
                tool_input: {
                    questions: [
                        { question: 'Pick one', header: 'Test', options: [], multiSelect: false },
                    ],
                },
            };
            const result = classifyPermissionPayload(payload);
            expect(result.isQuestion).toBe(true);
            expect(result.questions.length).toBe(1);
        });

        it('returns false for payloads without questions', () => {
            const payload = {
                tool_name: 'bash',
                command: 'ls',
            };
            const result = classifyPermissionPayload(payload);
            expect(result.isQuestion).toBe(false);
            expect(result.questions.length).toBe(0);
        });

        it('returns false for AskUserQuestion with empty questions array', () => {
            const payload = {
                tool_name: 'AskUserQuestion',
                tool_input: {
                    questions: [],
                },
            };
            const result = classifyPermissionPayload(payload);
            expect(result.isQuestion).toBe(false);
            expect(result.questions.length).toBe(0);
        });
    });

    // --- Session/window management ---

    describe('session and window management', () => {
        const win1 = 'win-1' as WindowId;
        const win2 = 'win-2' as WindowId;

        it('registerSession maps session to window and sets initial done status', () => {
            const newState = registerSession(state, 'sess-1', win1);
            expect(newState.sessionWindows.get('sess-1')).toBe(win1);
            expect(newState.windowStatuses.get(win1)).toBe('done');
        });

        it('registerSession does not overwrite existing status', () => {
            let s = registerSession(state, 'sess-1', win1);
            s = setSessionStatus(s, 'sess-1', 'working');
            // Register another session to the same window
            s = registerSession(s, 'sess-2', win1);
            expect(s.windowStatuses.get(win1)).toBe('working');
        });

        it('unregisterWindow removes all sessions and status for a window', () => {
            let s = registerSession(state, 'sess-1', win1);
            s = registerSession(s, 'sess-2', win1);
            s = registerSession(s, 'sess-3', win2);

            const result = unregisterWindow(s, win1);
            expect(result.sessionWindows.has('sess-1')).toBe(false);
            expect(result.sessionWindows.has('sess-2')).toBe(false);
            expect(result.sessionWindows.has('sess-3')).toBe(true);
            expect(result.windowStatuses.has(win1)).toBe(false);
            expect(result.windowStatuses.has(win2)).toBe(true);
        });

        it('setSessionStatus updates window status via session lookup', () => {
            let s = registerSession(state, 'sess-1', win1);
            s = setSessionStatus(s, 'sess-1', 'working');
            expect(s.windowStatuses.get(win1)).toBe('working');
        });

        it('setSessionStatus is no-op for unknown session', () => {
            const result = setSessionStatus(state, 'unknown', 'working');
            expect(result).toBe(state);
        });

        it('clearSession removes session mapping and window status', () => {
            let s = registerSession(state, 'sess-1', win1);
            s = setSessionStatus(s, 'sess-1', 'working');
            const result = clearSession(s, 'sess-1');
            expect(result.sessionWindows.has('sess-1')).toBe(false);
            expect(result.windowStatuses.has(win1)).toBe(false);
        });

        it('clearSession is no-op for unknown session', () => {
            const result = clearSession(state, 'unknown');
            expect(result).toBe(state);
        });
    });

    describe('dismissNotificationsForWindow', () => {
        const win1 = 'win-1' as WindowId;
        const win2 = 'win-2' as WindowId;

        it('dismisses notification-type entries for all sessions of a window', () => {
            let s = registerSession(state, 'sess-1', win1);
            const notif = makeDomainNotification({
                id: 'n1', sessionId: 'sess-1', type: 'notification',
            });
            s = addNotification(s, notif);
            const result = dismissNotificationsForWindow(s, win1);
            expect(result.notifications.size).toBe(0);
        });

        it('keeps pending permission entries when dismissing for window', () => {
            let s = registerSession(state, 'sess-1', win1);
            const perm = makeDomainNotification({
                id: 'p1', sessionId: 'sess-1', type: 'permission', status: 'pending',
            });
            const notif = makeDomainNotification({
                id: 'n1', sessionId: 'sess-1', type: 'notification',
            });
            s = addNotification(s, perm);
            s = addNotification(s, notif);
            const result = dismissNotificationsForWindow(s, win1);
            expect(result.notifications.size).toBe(1);
            expect(result.notifications.has('p1')).toBe(true);
        });

        it('does not affect notifications for other windows', () => {
            let s = registerSession(state, 'sess-1', win1);
            s = registerSession(s, 'sess-2', win2);
            const n1 = makeDomainNotification({ id: 'n1', sessionId: 'sess-1', type: 'notification' });
            const n2 = makeDomainNotification({ id: 'n2', sessionId: 'sess-2', type: 'notification' });
            s = addNotification(s, n1);
            s = addNotification(s, n2);
            const result = dismissNotificationsForWindow(s, win1);
            expect(result.notifications.size).toBe(1);
            expect(result.notifications.has('n2')).toBe(true);
        });

        it('is no-op when no sessions map to the window', () => {
            const notif = makeDomainNotification({ id: 'n1', type: 'notification' });
            const s = addNotification(state, notif);
            const result = dismissNotificationsForWindow(s, win1);
            expect(result.notifications.size).toBe(1);
        });
    });

    describe('shouldSuppressNotification', () => {
        const win1 = 'win-1' as WindowId;
        const win2 = 'win-2' as WindowId;

        it('returns true when session window is focused', () => {
            const s = registerSession(state, 'sess-1', win1);
            expect(shouldSuppressNotification(s, 'sess-1', win1)).toBe(true);
        });

        it('returns false when session window is not focused', () => {
            const s = registerSession(state, 'sess-1', win1);
            expect(shouldSuppressNotification(s, 'sess-1', win2)).toBe(false);
        });

        it('returns false when no focused window', () => {
            const s = registerSession(state, 'sess-1', win1);
            expect(shouldSuppressNotification(s, 'sess-1', null)).toBe(false);
        });

        it('returns false for unknown session', () => {
            expect(shouldSuppressNotification(state, 'unknown', win1)).toBe(false);
        });
    });

    describe('getWindowForSession and getWindowStatusMap', () => {
        const win1 = 'win-1' as WindowId;

        it('getWindowForSession returns window for known session', () => {
            const s = registerSession(state, 'sess-1', win1);
            expect(getWindowForSession(s, 'sess-1')).toBe(win1);
        });

        it('getWindowForSession returns null for unknown session', () => {
            expect(getWindowForSession(state, 'unknown')).toBeNull();
        });

        it('getWindowStatusMap returns current statuses', () => {
            let s = registerSession(state, 'sess-1', win1);
            s = setSessionStatus(s, 'sess-1', 'working');
            const map = getWindowStatusMap(s);
            expect(map.get(win1)).toBe('working');
        });
    });

    // --- Focus mode ---

    describe('focus mode', () => {
        it('enterFocusMode sets active and populates entryIds', () => {
            const s = enterFocusMode(state, ['a', 'b', 'c']);
            expect(s.focusMode.active).toBe(true);
            expect(s.focusMode.entryIds).toEqual(['a', 'b', 'c']);
            expect(s.focusMode.currentIndex).toBe(0);
        });

        it('exitFocusMode clears all focus mode state', () => {
            let s = enterFocusMode(state, ['a', 'b']);
            s = exitFocusMode(s);
            expect(s.focusMode.active).toBe(false);
            expect(s.focusMode.entryIds).toEqual([]);
            expect(s.focusMode.currentIndex).toBe(0);
        });

        it('navigateFocusMode wraps forward', () => {
            let s = enterFocusMode(state, ['a', 'b', 'c']);
            s = navigateFocusMode(s, 1);
            expect(s.focusMode.currentIndex).toBe(1);
            s = navigateFocusMode(s, 1);
            expect(s.focusMode.currentIndex).toBe(2);
            s = navigateFocusMode(s, 1);
            expect(s.focusMode.currentIndex).toBe(0); // wrapped
        });

        it('navigateFocusMode wraps backward', () => {
            let s = enterFocusMode(state, ['a', 'b', 'c']);
            s = navigateFocusMode(s, -1);
            expect(s.focusMode.currentIndex).toBe(2); // wrapped
        });

        it('navigateFocusMode is no-op with single entry', () => {
            let s = enterFocusMode(state, ['a']);
            s = navigateFocusMode(s, 1);
            expect(s.focusMode.currentIndex).toBe(0);
        });

        it('removeFromFocusMode removes entry and adjusts index', () => {
            let s = enterFocusMode(state, ['a', 'b', 'c']);
            s = navigateFocusMode(s, 2); // index at 2
            s = removeFromFocusMode(s, 'c');
            expect(s.focusMode.entryIds).toEqual(['a', 'b']);
            expect(s.focusMode.currentIndex).toBe(1); // clamped
        });

        it('removeFromFocusMode is no-op for unknown entry', () => {
            const s = enterFocusMode(state, ['a', 'b']);
            const result = removeFromFocusMode(s, 'unknown');
            expect(result.focusMode.entryIds).toEqual(['a', 'b']);
        });

        it('syncFocusModeEntries adds new and removes resolved', () => {
            let s = enterFocusMode(state, ['a', 'b', 'c']);
            s = syncFocusModeEntries(s, ['b', 'd']); // a and c resolved, d is new
            expect(s.focusMode.entryIds).toEqual(['b', 'd']);
        });

        it('syncFocusModeEntries preserves order of existing entries', () => {
            let s = enterFocusMode(state, ['a', 'b', 'c']);
            s = syncFocusModeEntries(s, ['c', 'b', 'a']); // all still pending
            expect(s.focusMode.entryIds).toEqual(['a', 'b', 'c']); // original order preserved
        });
    });

    describe('addNotification auto-enters focus mode', () => {
        const win1 = 'win-1' as WindowId;
        const win2 = 'win-2' as WindowId;

        it('enters focus mode when permission arrives for focused window', () => {
            let s = registerSession(state, 'sess-1', win1);
            const notif = makeDomainNotification({ id: 'p1', sessionId: 'sess-1', type: 'permission' });
            s = addNotification(s, notif, win1);
            expect(s.focusMode.active).toBe(true);
            expect(s.focusMode.entryIds).toContain('p1');
        });

        it('enters focus mode when question arrives for focused window', () => {
            let s = registerSession(state, 'sess-1', win1);
            const notif = makeQuestionNotification({ id: 'q1', sessionId: 'sess-1' });
            s = addNotification(s, notif, win1);
            expect(s.focusMode.active).toBe(true);
            expect(s.focusMode.entryIds).toContain('q1');
        });

        it('does not enter focus mode for plain notifications', () => {
            let s = registerSession(state, 'sess-1', win1);
            const notif = makeDomainNotification({ id: 'n1', sessionId: 'sess-1', type: 'notification' });
            s = addNotification(s, notif, win1);
            expect(s.focusMode.active).toBe(false);
        });

        it('does not enter focus mode when session window is not focused', () => {
            let s = registerSession(state, 'sess-1', win1);
            const notif = makeDomainNotification({ id: 'p1', sessionId: 'sess-1', type: 'permission' });
            s = addNotification(s, notif, win2);
            expect(s.focusMode.active).toBe(false);
        });

        it('does not enter focus mode when no window is focused', () => {
            let s = registerSession(state, 'sess-1', win1);
            const notif = makeDomainNotification({ id: 'p1', sessionId: 'sess-1', type: 'permission' });
            s = addNotification(s, notif, null);
            expect(s.focusMode.active).toBe(false);
        });

        it('does not enter focus mode when already active', () => {
            let s = registerSession(state, 'sess-1', win1);
            s = enterFocusMode(s, ['existing']);
            const notif = makeDomainNotification({ id: 'p1', sessionId: 'sess-1', type: 'permission' });
            s = addNotification(s, notif, win1);
            // Focus mode stays active with original entries (not re-entered)
            expect(s.focusMode.entryIds).toEqual(['existing']);
        });

        it('does not enter focus mode when focusedWindowId not provided', () => {
            let s = registerSession(state, 'sess-1', win1);
            const notif = makeDomainNotification({ id: 'p1', sessionId: 'sess-1', type: 'permission' });
            s = addNotification(s, notif);
            expect(s.focusMode.active).toBe(false);
        });
    });

    describe('getWorkspaceClaudeStatus', () => {
        const win1 = 'win-1' as WindowId;
        const win2 = 'win-2' as WindowId;
        const wsid = 'ws-0' as WorkspaceId;

        it('returns null when no windows have status', () => {
            let ws = createWorkspace(wsid);
            ws = addColumn(ws, createColumn(createTiledWindow(win1)));
            expect(getWorkspaceClaudeStatus(state, ws)).toBeNull();
        });

        it('returns the highest priority status', () => {
            let s = registerSession(state, 'sess-1', win1);
            s = setSessionStatus(s, 'sess-1', 'done');
            s = registerSession(s, 'sess-2', win2);
            s = setSessionStatus(s, 'sess-2', 'needs-input');

            let ws = createWorkspace(wsid);
            ws = addColumn(ws, createColumn(createTiledWindow(win1)));
            ws = addColumn(ws, createColumn(createTiledWindow(win2)));
            expect(getWorkspaceClaudeStatus(s, ws)).toBe('needs-input');
        });

        it('returns working over done', () => {
            let s = registerSession(state, 'sess-1', win1);
            s = setSessionStatus(s, 'sess-1', 'working');
            let ws = createWorkspace(wsid);
            ws = addColumn(ws, createColumn(createTiledWindow(win1)));
            expect(getWorkspaceClaudeStatus(s, ws)).toBe('working');
        });
    });

    describe('resolveKeyAction', () => {
        it('maps permission keys correctly', () => {
            expect(resolveKeyAction('permission', 1)).toBe('allow');
            expect(resolveKeyAction('permission', 2)).toBe('always');
            expect(resolveKeyAction('permission', 3)).toBe('deny');
        });

        it('maps notification keys correctly', () => {
            expect(resolveKeyAction('notification', 1)).toBe('visit');
            expect(resolveKeyAction('notification', 2)).toBe('dismiss');
            expect(resolveKeyAction('notification', 3)).toBeNull();
        });
    });

    describe('canSubmitQuestion', () => {
        it('returns true when all questions have answers', () => {
            const notif = makeQuestionNotification();
            notif.questionState.answers.set(0, ['Red']);
            notif.questionState.answers.set(1, ['Small']);
            expect(canSubmitQuestion(notif)).toBe(true);
        });

        it('returns false when some questions have no answers', () => {
            const notif = makeQuestionNotification();
            notif.questionState.answers.set(0, ['Red']);
            // question 1 has no answer
            expect(canSubmitQuestion(notif)).toBe(false);
        });

        it('returns false when answers array is empty', () => {
            const notif = makeQuestionNotification();
            notif.questionState.answers.set(0, []);
            notif.questionState.answers.set(1, ['Small']);
            expect(canSubmitQuestion(notif)).toBe(false);
        });
    });

    describe('addNotification suppression', () => {
        const win1 = 'win-1' as WindowId;

        it('suppresses notification-type when session window is focused', () => {
            let s = registerSession(state, 'sess-1', win1);
            const notif = makeDomainNotification({
                id: 'n1', sessionId: 'sess-1', type: 'notification',
            });
            s = addNotification(s, notif, win1);
            expect(s.notifications.has('n1')).toBe(false);
        });

        it('does not suppress permission-type when session window is focused', () => {
            let s = registerSession(state, 'sess-1', win1);
            const notif = makeDomainNotification({
                id: 'p1', sessionId: 'sess-1', type: 'permission',
            });
            s = addNotification(s, notif, win1);
            expect(s.notifications.has('p1')).toBe(true);
        });

        it('does not suppress notification-type when different window is focused', () => {
            const win2 = 'win-2' as WindowId;
            let s = registerSession(state, 'sess-1', win1);
            const notif = makeDomainNotification({
                id: 'n1', sessionId: 'sess-1', type: 'notification',
            });
            s = addNotification(s, notif, win2);
            expect(s.notifications.has('n1')).toBe(true);
        });
    });

    describe('enterFocusMode overview guard', () => {
        it('is no-op when overviewActive is true', () => {
            const s = enterFocusMode(state, ['a', 'b'], true);
            expect(s.focusMode.active).toBe(false);
        });

        it('activates when overviewActive is false', () => {
            const s = enterFocusMode(state, ['a', 'b'], false);
            expect(s.focusMode.active).toBe(true);
        });
    });
});
