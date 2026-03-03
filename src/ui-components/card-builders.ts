import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Graphene from 'gi://Graphene';

// Kestrel brand palette
const SURFACE = '#0a0f0c';
export const BORDER = '#1c2b2c';
const TEXT = '#e8ede9';
export const TEXT_DIM = '#9ca8a0';
export const ACCENT = '#62af85';
const CARD_WIDTH = 400;

/** Create the outer card box with surface styling. */
function buildCardRoot(width: number, accentColor?: string): St.BoxLayout {
    const borderLeft = accentColor ? `border-left: 2px solid ${accentColor};` : '';
    return new St.BoxLayout({
        vertical: true,
        style: `background-color: ${SURFACE}; border: 1px solid ${BORDER}; border-radius: 12px; padding: 14px 16px; ${borderLeft}`,
        reactive: true,
        width,
        opacity: 0,
    });
}

/** Header row with optional workspace label + title. */
function buildCardHeader(workspaceName: string | undefined, title: string): St.BoxLayout {
    const header = new St.BoxLayout({
        style: 'spacing: 8px;',
        x_expand: true,
    });

    if (workspaceName) {
        const wsLabel = new St.Label({
            text: workspaceName,
            style: `font-weight: bold; font-size: 13px; color: ${TEXT};`,
            x_align: Clutter.ActorAlign.START,
        });
        wsLabel.clutter_text.ellipsize = 3;
        header.add_child(wsLabel);
    }

    const titleLabel = new St.Label({
        text: title,
        style: `font-size: 11px; color: ${TEXT_DIM};`,
        x_expand: true,
        x_align: workspaceName ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
    });
    titleLabel.clutter_text.ellipsize = 3;
    header.add_child(titleLabel);

    return header;
}

/** Message label with ellipsis. */
function buildCardMessage(message: string): St.Label {
    const label = new St.Label({
        text: message,
        style: `font-size: 12px; color: ${TEXT_DIM}; margin-top: 6px;`,
        x_expand: true,
    });
    label.clutter_text.line_wrap = false;
    label.clutter_text.ellipsize = 3;
    return label;
}

/** Clipped expand wrapper + inner content box. */
function buildExpandWrapper(): { wrapper: Clutter.Actor; content: St.BoxLayout } {
    const wrapper = new Clutter.Actor({
        clip_to_allocation: true,
        height: 0,
        x_expand: true,
    });

    const content = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style: 'padding: 0;',
    });

    wrapper.add_child(content);
    return { wrapper, content };
}

/** Monospace command display block. */
export function buildCommandBlock(command: string): St.Label {
    const label = new St.Label({
        text: `$ ${command}`,
        style: `font-family: monospace; font-size: 11px; color: ${ACCENT}; background-color: rgba(0,0,0,0.35); border-radius: 8px; padding: 7px 11px; margin-top: 10px; border: 1px solid rgba(255,255,255,0.03);`,
        x_expand: true,
    });
    label.clutter_text.ellipsize = 3;
    return label;
}

/** Create a styled card button with click handler. */
export function makeButton(label: string, color: string, bgColor: string, borderColor: string, onClick: () => void): St.Button {
    const btn = new St.Button({
        label,
        style: `font-size: 12px; font-weight: bold; color: ${color}; background-color: ${bgColor}; border-radius: 8px; padding: 8px 16px; border: 1px solid ${borderColor};`,
        reactive: true,
        can_focus: true,
        x_expand: true,
    });
    btn.connect('clicked', () => {
        try { onClick(); } catch (e) { console.error('[Kestrel] Error in card button click:', e); }
    });
    return btn;
}

const GREEN = '#7dd6a4';
const RED = '#c95a5a';
const BLUE = '#5a8ec9';

/** 4-button permission row: Deny, Allow, Always, Dismiss. */
export function buildPermissionButtons(
    onDeny: () => void,
    onAllow: () => void,
    onAlways: () => void,
    onDismiss: () => void,
): St.BoxLayout {
    const row = new St.BoxLayout({
        style: 'spacing: 6px; margin-top: 10px;',
        x_expand: true,
    });

    const pairs: Array<[string, string, string, string, () => void]> = [
        ['Deny', RED, `rgba(201,90,90,0.08)`, `rgba(201,90,90,0.2)`, onDeny],
        ['Allow', GREEN, `rgba(125,214,164,0.08)`, `rgba(125,214,164,0.2)`, onAllow],
        ['Always', BLUE, `rgba(90,142,201,0.08)`, `rgba(90,142,201,0.2)`, onAlways],
        ['Dismiss', TEXT_DIM, `transparent`, BORDER, onDismiss],
    ];

    for (const [lbl, color, bg, border, handler] of pairs) {
        row.add_child(makeButton(lbl, color, bg, border, handler));
    }

    return row;
}

/** 3px accent progress bar with left-anchored pivot point. */
export function buildProgressBar(): St.Widget {
    return new St.Widget({
        style: `background-color: ${ACCENT}; border-radius: 0 0 12px 12px; margin-top: 4px;`,
        height: 3,
        x_expand: true,
        pivot_point: new Graphene.Point({ x: 0, y: 0.5 }),
    });
}

interface CardSkeleton {
    actor: St.BoxLayout;
    expandWrapper: Clutter.Actor;
    expandContent: St.BoxLayout;
    msgLabel: St.Label;
}

/** Build the shared card skeleton: root, header, message label, expand wrapper. */
export function buildCardSkeleton(notification: import('../domain/notification-types.js').OverlayNotification): CardSkeleton {
    const actor = buildCardRoot(CARD_WIDTH, notification.workspaceColor);
    actor.add_child(buildCardHeader(notification.workspaceName, notification.title));
    const msgLabel = buildCardMessage(notification.message || '');
    actor.add_child(msgLabel);
    const { wrapper: expandWrapper, content: expandContent } = buildExpandWrapper();
    actor.add_child(expandWrapper);
    return { actor, expandWrapper, expandContent, msgLabel };
}
