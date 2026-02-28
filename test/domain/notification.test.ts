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
} from '../../src/domain/notification.js';
import type {
    NotificationState,
    DomainNotification,
    ParsedQuestion,
} from '../../src/domain/notification.js';

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
});
