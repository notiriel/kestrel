import type { OverlayNotification } from '../domain/notification-types.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

// Kestrel brand palette
const SURFACE = '#0a0f0c';
export const BORDER = '#1c2b2c';
const TEXT = '#e8ede9';
export const TEXT_DIM = '#9ca8a0';
export const ACCENT = '#62af85';

const CARD_WIDTH = 400;

interface CardSkeleton {
    actor: St.BoxLayout;
    expandWrapper: Clutter.Actor;
    expandContent: St.BoxLayout;
    msgLabel: St.Label;
}

/** Build the shared card skeleton: root, header, message label, expand wrapper. */
export function buildCardSkeleton(notification: OverlayNotification): CardSkeleton {
    const actor = new St.BoxLayout({
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
    actor.add_child(header);

    // Message
    const msgLabel = new St.Label({
        text: notification.message || '',
        style: `font-size: 12px; color: ${TEXT_DIM}; margin-top: 6px;`,
        x_expand: true,
    });
    msgLabel.clutter_text.line_wrap = false;
    msgLabel.clutter_text.ellipsize = 3;
    actor.add_child(msgLabel);

    // Expand wrapper
    const expandWrapper = new Clutter.Actor({
        clip_to_allocation: true,
        height: 0,
        x_expand: true,
    });

    const expandContent = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style: 'padding: 0;',
    });

    expandWrapper.add_child(expandContent);
    actor.add_child(expandWrapper);

    return { actor, expandWrapper, expandContent, msgLabel };
}

/** Create a styled card button. */
export function makeButton(label: string, color: string, bgColor: string, borderColor: string, onClick: () => void): St.Button {
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
            console.error('[Kestrel] Error in card button click:', e);
        }
    });
    return btn;
}
