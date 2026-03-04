import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import type { ClaudeStatus } from '../domain/notification-types.js';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

const STATUS_COLORS: Record<ClaudeStatus, string> = {
    'working': '#4CAF50',
    'needs-input': '#F44336',
    'done': '#FF9800',
};

const DOT_COLORS: Record<ClaudeStatus, string> = {
    'working': '#2E7D32',
    'needs-input': '#B71C1C',
    'done': '#E65100',
};

const TEXT_COLORS: Record<ClaudeStatus, string> = {
    'working': '#0A3A0A',
    'needs-input': '#4A0000',
    'done': '#8B3800',
};

const ELAPSED_TEXT_COLORS: Record<ClaudeStatus, string> = {
    'working': '#0D4A0D',
    'needs-input': '#5C0000',
    'done': '#9E4200',
};

const GLOW_COLORS: Record<ClaudeStatus, string> = {
    'working': 'rgba(76, 175, 80, 0.6)',
    'needs-input': 'rgba(244, 67, 54, 0.6)',
    'done': 'rgba(255, 152, 0, 0.6)',
};

const PILL_HEIGHT = 28;
const PILL_PADDING_H = 10;
const DOT_SIZE = 10;
const DOT_MARGIN_RIGHT = 8;
const ELAPSED_MARGIN_LEFT = 12;
const PILL_BORDER_RADIUS = 14;
const MESSAGE_FONT_SIZE = 13;
const ELAPSED_FONT_SIZE = 13;

/** Create a pill-shaped status badge for a Claude session overlay. */
export function buildStatusPill(status: ClaudeStatus): St.BoxLayout {
    const color = STATUS_COLORS[status];
    const dotColor = DOT_COLORS[status];
    const textColor = TEXT_COLORS[status];
    const elapsedColor = ELAPSED_TEXT_COLORS[status];
    const glow = GLOW_COLORS[status];

    const pill = new St.BoxLayout({
        style: `
            background-color: ${color};
            border-radius: ${PILL_BORDER_RADIUS}px;
            padding: 0 ${PILL_PADDING_H}px;
            height: ${PILL_HEIGHT}px;
            box-shadow: 0 0 8px 4px ${glow};
        `,
        vertical: false,
        reactive: false,
        y_align: 2, // Clutter.ActorAlign.CENTER
    });

    const dot = new St.Widget({
        style: `
            background-color: ${dotColor};
            border-radius: ${DOT_SIZE / 2}px;
            min-width: ${DOT_SIZE}px;
            min-height: ${DOT_SIZE}px;
            margin-right: ${DOT_MARGIN_RIGHT}px;
        `,
        y_align: 2, // Clutter.ActorAlign.CENTER
    });
    pill.add_child(dot);

    const messageLabel = new St.Label({
        text: '',
        style: `
            color: ${textColor};
            font-size: ${MESSAGE_FONT_SIZE}px;
            font-weight: bold;
        `,
        y_align: 2, // Clutter.ActorAlign.CENTER
    });
    messageLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
    messageLabel.clutter_text.max_length = 40;
    pill.add_child(messageLabel);

    const elapsedLabel = new St.Label({
        text: '',
        style: `
            color: ${elapsedColor};
            font-size: ${ELAPSED_FONT_SIZE}px;
            margin-left: ${ELAPSED_MARGIN_LEFT}px;
        `,
        y_align: 2, // Clutter.ActorAlign.CENTER
    });
    pill.add_child(elapsedLabel);

    return pill;
}

/** Update pill contents and colors without recreating. */
export function updateStatusPill(
    pill: St.BoxLayout,
    status: ClaudeStatus,
    message: string,
    elapsed: string,
): void {
    const color = STATUS_COLORS[status];
    const dotColor = DOT_COLORS[status];
    const textColor = TEXT_COLORS[status];
    const elapsedColor = ELAPSED_TEXT_COLORS[status];
    const glow = GLOW_COLORS[status];

    pill.style = `
        background-color: ${color};
        border-radius: ${PILL_BORDER_RADIUS}px;
        padding: 0 ${PILL_PADDING_H}px;
        height: ${PILL_HEIGHT}px;
        box-shadow: 0 0 8px 4px ${glow};
    `;

    const dot = pill.get_child_at_index(0) as St.Widget;
    if (dot) {
        dot.style = `
            background-color: ${dotColor};
            border-radius: ${DOT_SIZE / 2}px;
            min-width: ${DOT_SIZE}px;
            min-height: ${DOT_SIZE}px;
            margin-right: ${DOT_MARGIN_RIGHT}px;
        `;
    }

    const messageLabel = pill.get_child_at_index(1) as St.Label;
    if (messageLabel) {
        messageLabel.text = message;
        messageLabel.style = `
            color: ${textColor};
            font-size: ${MESSAGE_FONT_SIZE}px;
            font-weight: bold;
        `;
    }

    const elapsedLabel = pill.get_child_at_index(2) as St.Label;
    if (elapsedLabel) {
        elapsedLabel.text = elapsed;
        elapsedLabel.style = `
            color: ${elapsedColor};
            font-size: ${ELAPSED_FONT_SIZE}px;
            margin-left: ${ELAPSED_MARGIN_LEFT}px;
        `;
    }

    // Pulse animation for needs-input status
    pill.remove_all_transitions();
    if (status === 'needs-input') {
        pill.opacity = 255;
        (pill as unknown as Easeable).ease({
            opacity: 140,
            duration: 800,
            mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
            repeatCount: -1,
            autoReverse: true,
        });
    } else {
        pill.opacity = 255;
    }
}
