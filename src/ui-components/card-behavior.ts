/**
 * Card-type-specific behavior for overlay and focus mode rendering.
 * Replaces if/else branching on notification type with polymorphic dispatch.
 */
interface CardBehavior {
    /** Card width when expanded (overlay). */
    readonly expandedWidth: number;
    /** Card width when collapsed (overlay). */
    readonly collapsedWidth: number;
    /** Translation-X for collapsed state (overlay stacking). */
    readonly collapsedTranslationX: number;
    /** Whether the card uses custom internal padding (no outer padding). */
    readonly hasInternalPadding: boolean;
    /** Whether the card supports left/right page navigation (focus mode). */
    readonly supportsPageNavigation: boolean;
}

const CARD_WIDTH = 400;
const QUESTION_CARD_WIDTH = 600;
const CARD_RIGHT_OFFSET = QUESTION_CARD_WIDTH - CARD_WIDTH;

const permissionCardBehavior: CardBehavior = {
    expandedWidth: CARD_WIDTH,
    collapsedWidth: CARD_WIDTH,
    collapsedTranslationX: CARD_RIGHT_OFFSET,
    hasInternalPadding: false,
    supportsPageNavigation: false,
};

const notificationCardBehavior: CardBehavior = {
    expandedWidth: CARD_WIDTH,
    collapsedWidth: CARD_WIDTH,
    collapsedTranslationX: CARD_RIGHT_OFFSET,
    hasInternalPadding: false,
    supportsPageNavigation: false,
};

const questionCardBehavior: CardBehavior = {
    expandedWidth: QUESTION_CARD_WIDTH,
    collapsedWidth: CARD_WIDTH,
    collapsedTranslationX: CARD_RIGHT_OFFSET,
    hasInternalPadding: true,
    supportsPageNavigation: true,
};

export function getCardBehavior(type: string): CardBehavior {
    if (type === 'question') return questionCardBehavior;
    if (type === 'permission') return permissionCardBehavior;
    return notificationCardBehavior;
}
