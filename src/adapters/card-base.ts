import type { OverlayNotification } from '../domain/notification-types.js';
import type St from 'gi://St';
import type Clutter from 'gi://Clutter';
import {
    CARD_WIDTH,
    buildCardRoot,
    buildCardHeader,
    buildCardMessage,
    buildExpandWrapper,
} from '../ui-components/card-builders.js';

export { BORDER, TEXT_DIM, ACCENT, makeButton } from '../ui-components/card-builders.js';

interface CardSkeleton {
    actor: St.BoxLayout;
    expandWrapper: Clutter.Actor;
    expandContent: St.BoxLayout;
    msgLabel: St.Label;
}

/** Build the shared card skeleton: root, header, message label, expand wrapper. */
export function buildCardSkeleton(notification: OverlayNotification): CardSkeleton {
    const actor = buildCardRoot(CARD_WIDTH);
    actor.add_child(buildCardHeader(notification.workspaceName, notification.title));
    const msgLabel = buildCardMessage(notification.message || '');
    actor.add_child(msgLabel);
    const { wrapper: expandWrapper, content: expandContent } = buildExpandWrapper();
    actor.add_child(expandWrapper);
    return { actor, expandWrapper, expandContent, msgLabel };
}
