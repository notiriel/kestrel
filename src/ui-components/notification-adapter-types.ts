import type { QuestionDefinition } from '../domain/notification-types.js';
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

/** Shared card construction options */
export interface CardOptions {
    extensionPath: string;
    onRespond: (id: string, action: string) => void;
}

/** Options for cards that can visit a session */
export interface VisitableCardOptions extends CardOptions {
    onVisitSession?: (sessionId: string) => void;
}
