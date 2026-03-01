import type { OverlayNotification } from '../domain/notification-types.js';
import type { NotificationCardDelegate, VisitableCardOptions } from './notification-adapter-types.js';
import St from 'gi://St';
import type Clutter from 'gi://Clutter';
import { ACCENT, TEXT_DIM, BORDER, buildCardSkeleton, makeButton } from './card-builders.js';

export class NotificationCard implements NotificationCardDelegate {
    readonly actor: St.BoxLayout;
    readonly expandWrapper: Clutter.Actor;
    readonly msgLabel: St.Label;
    readonly progressBar: St.Widget | null = null;

    constructor(notification: OverlayNotification, options: VisitableCardOptions) {
        const skeleton = buildCardSkeleton(notification);
        this.actor = skeleton.actor;
        this.expandWrapper = skeleton.expandWrapper;
        this.msgLabel = skeleton.msgLabel;

        // Notification buttons: Visit, Dismiss
        const buttonRow = new St.BoxLayout({
            style: 'spacing: 6px; margin-top: 10px;',
            x_expand: true,
        });
        buttonRow.add_child(makeButton('Visit', ACCENT, `rgba(98,175,133,0.08)`, `rgba(98,175,133,0.2)`, () => {
            if (notification.sessionId && options.onVisitSession) {
                options.onVisitSession(notification.sessionId);
            }
            options.onRespond(notification.id, 'visit');
        }));
        buttonRow.add_child(makeButton('Dismiss', TEXT_DIM, `transparent`, BORDER, () => {
            options.onRespond(notification.id, 'dismiss');
        }));
        skeleton.expandContent.add_child(buttonRow);
    }

    destroy(): void {
        // No timers to clean up
    }
}
