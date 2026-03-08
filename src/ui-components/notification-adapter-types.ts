import type { QuestionDefinition } from '../domain/world/notification-types.js';
import type St from 'gi://St';
import type Clutter from 'gi://Clutter';

export interface QuestionState {
    currentPage: number;
    answers: Map<number, string[]>;
    otherActive: ReadonlyMap<number, boolean>;
    questions: readonly QuestionDefinition[];
    pageContainer: St.BoxLayout | null;
    navBar: St.BoxLayout | null;
    autoAdvanceTimeoutId: number | null;
}

/** Delegate interface for card rendering. Each card type implements this. */
export interface NotificationCardDelegate {
    /** The root St.BoxLayout to add to the container */
    readonly actor: St.BoxLayout;
    /** The clipped expand wrapper (height animated by overlay adapter) */
    readonly expandWrapper: Clutter.Actor;
    /** The message label (line-wrap toggled on expand/collapse) */
    readonly msgLabel: St.Label;
    /** Progress/timeout bar widget (if applicable) */
    readonly progressBar: St.Widget | null;
    /** Clean up timers and signal connections */
    destroy(): void;
}

/** Card construction options */
export interface VisitableCardOptions {
    extensionPath: string;
    onRespond: (id: string, action: string) => void;
    onVisitSession?: (sessionId: string) => void;
    /** Called when a question option is selected (for syncing to domain state). */
    onSelectOption?: (id: string, questionIndex: number, optionIndex: number) => void;
    /** Called when "Other" text changes (for syncing to domain state). */
    onSetOtherText?: (id: string, questionIndex: number, text: string) => void;
}
