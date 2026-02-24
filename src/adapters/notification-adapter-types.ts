import type { QuestionDefinition } from '../domain/notification-types.js';
import type St from 'gi://St';

export interface QuestionState {
    currentPage: number;
    answers: Map<number, string[]>;
    questions: readonly QuestionDefinition[];
    pageContainer: St.BoxLayout | null;
    navBar: St.BoxLayout | null;
    autoAdvanceTimeoutId: number | null;
}
