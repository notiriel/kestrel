import type { OverlayNotification } from '../domain/notification-types.js';
import type { NotificationCardDelegate, VisitableCardOptions } from './notification-adapter-types.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

// Kestrel brand palette
const SURFACE = '#0a0f0c';
const BORDER = '#1c2b2c';
const TEXT = '#e8ede9';
const TEXT_DIM = '#9ca8a0';
const ACCENT = '#62af85';

const CARD_WIDTH = 400;

export class NotificationCard implements NotificationCardDelegate {
    readonly actor: St.BoxLayout;
    readonly expandWrapper: Clutter.Actor;
    readonly msgLabel: St.Label;
    readonly progressBar: St.Widget | null = null;

    constructor(notification: OverlayNotification, options: VisitableCardOptions) {
        // Card root
        this.actor = new St.BoxLayout({
            vertical: true,
            style: `background-color: ${SURFACE}; border: 1px solid ${BORDER}; border-radius: 12px; padding: 14px 16px;`,
            reactive: true,
            width: CARD_WIDTH,
            opacity: 0,
        });

        // Header row
        const header = new St.BoxLayout({
            style: 'spacing: 8px;',
            x_expand: true,
        });

        if (notification.workspaceName) {
            const wsLabel = new St.Label({
                text: notification.workspaceName,
                style: `font-weight: bold; font-size: 13px; color: ${TEXT};`,
                x_align: Clutter.ActorAlign.START,
            });
            wsLabel.clutter_text.ellipsize = 3;
            header.add_child(wsLabel);
        }

        const titleLabel = new St.Label({
            text: notification.title,
            style: `font-size: 11px; color: ${TEXT_DIM};`,
            x_expand: true,
            x_align: notification.workspaceName ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
        });
        titleLabel.clutter_text.ellipsize = 3;
        header.add_child(titleLabel);
        this.actor.add_child(header);

        // Message
        this.msgLabel = new St.Label({
            text: notification.message || '',
            style: `font-size: 12px; color: ${TEXT_DIM}; margin-top: 6px;`,
            x_expand: true,
        });
        this.msgLabel.clutter_text.line_wrap = false;
        this.msgLabel.clutter_text.ellipsize = 3;
        this.actor.add_child(this.msgLabel);

        // Expand wrapper
        this.expandWrapper = new Clutter.Actor({
            clip_to_allocation: true,
            height: 0,
            x_expand: true,
        });

        const expandContent = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 0;',
        });

        // Notification buttons: Visit, Dismiss
        const buttonRow = new St.BoxLayout({
            style: 'spacing: 6px; margin-top: 10px;',
            x_expand: true,
        });
        buttonRow.add_child(this._makeButton('Visit', ACCENT, `rgba(98,175,133,0.08)`, `rgba(98,175,133,0.2)`, () => {
            if (notification.sessionId && options.onVisitSession) {
                options.onVisitSession(notification.sessionId);
            }
            options.onRespond(notification.id, 'visit');
        }));
        buttonRow.add_child(this._makeButton('Dismiss', TEXT_DIM, `transparent`, BORDER, () => {
            options.onRespond(notification.id, 'dismiss');
        }));
        expandContent.add_child(buttonRow);

        this.expandWrapper.add_child(expandContent);
        this.actor.add_child(this.expandWrapper);
    }

    destroy(): void {
        // No timers to clean up
    }

    private _makeButton(label: string, color: string, bgColor: string, borderColor: string, onClick: () => void): St.Button {
        const btn = new St.Button({
            label,
            style: `font-size: 12px; font-weight: bold; color: ${color}; background-color: ${bgColor}; border-radius: 8px; padding: 8px 16px; border: 1px solid ${borderColor};`,
            reactive: true,
            can_focus: true,
            x_expand: true,
        });
        btn.connect('clicked', () => {
            try {
                onClick();
            } catch (e) {
                console.error('[Kestrel] Error in notification button click:', e);
            }
        });
        return btn;
    }
}
