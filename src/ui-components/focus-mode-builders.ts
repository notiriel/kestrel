import St from 'gi://St';
import Clutter from 'gi://Clutter';

// Kestrel brand palette
const SURFACE = '#0a0f0c';
const BORDER = '#1c2b2c';
const TEXT = '#e8ede9';
const TEXT_DIM = '#9ca8a0';
const ACCENT = '#62af85';
const GREEN = '#7dd6a4';
const RED = '#c95a5a';
const BLUE = '#5a8ec9';

const FOCUS_CARD_WIDTH = 600;

interface MonitorRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Dark semi-transparent backdrop for focus mode. */
export function buildFocusModeBackdrop(monitor: MonitorRect): St.Widget {
    return new St.Widget({
        name: 'kestrel-focus-backdrop',
        style: 'background-color: rgba(0,0,0,0.6);',
        reactive: true,
        x: monitor.x, y: monitor.y,
        width: monitor.width, height: monitor.height,
        opacity: 0,
    });
}

/** Left-half container for window preview clones. */
export function buildPreviewContainer(monitor: MonitorRect, halfW: number): Clutter.Actor {
    return new Clutter.Actor({
        name: 'kestrel-focus-preview',
        x: monitor.x, y: monitor.y,
        width: halfW, height: monitor.height,
    });
}

/** Right-half container for notification cards. */
export function buildCardContainer(halfW: number, monitorHeight: number): Clutter.Actor {
    return new Clutter.Actor({
        name: 'kestrel-focus-cards',
        x: halfW, y: 0,
        width: halfW, height: monitorHeight,
    });
}

/** "1 / 3" counter label. */
export function buildCounterLabel(): St.Label {
    return new St.Label({
        text: '',
        style: `font-family: monospace; font-size: 14px; color: ${TEXT_DIM}; text-align: center;`,
    });
}

/** Keyboard shortcut hints label. */
export function buildHintLabel(): St.Label {
    return new St.Label({
        text: '\u2191\u2193 navigate    1-4 act    \u2190\u2192 page    Esc close',
        style: `font-family: monospace; font-size: 12px; color: ${TEXT_DIM}; text-align: center;`,
    });
}

/** Simple focus card root container. */
export function buildFocusCardRoot(): St.BoxLayout {
    return new St.BoxLayout({
        vertical: true,
        style: `background-color: ${SURFACE}; border: 1px solid ${BORDER}; border-radius: 12px; padding: 18px 20px; box-shadow: 0 8px 32px rgba(0,0,0,0.5);`,
        width: FOCUS_CARD_WIDTH,
    });
}

/** Header row with title and optional workspace name. */
export function buildFocusCardHeader(title: string, workspaceName?: string): St.BoxLayout {
    const header = new St.BoxLayout({ style: 'spacing: 8px;', x_expand: true });
    header.add_child(new St.Label({
        text: title,
        style: `font-weight: bold; font-size: 14px; color: ${TEXT};`,
        x_expand: true, x_align: Clutter.ActorAlign.START,
    }));
    if (workspaceName) {
        header.add_child(new St.Label({
            text: workspaceName,
            style: `font-family: monospace; font-size: 11px; color: ${TEXT_DIM};`,
            x_align: Clutter.ActorAlign.END,
        }));
    }
    return header;
}

/** Message label with word-wrap. */
export function buildFocusCardMessage(message: string): St.Label {
    const msgLabel = new St.Label({
        text: message,
        style: `font-size: 13px; color: ${TEXT_DIM}; margin-top: 8px;`,
        x_expand: true,
    });
    msgLabel.clutter_text.line_wrap = true;
    msgLabel.clutter_text.ellipsize = 0;
    return msgLabel;
}

/** Monospace command block for permissions. */
export function buildFocusCardCommand(command: string): St.Label {
    const cmdBlock = new St.Label({
        text: `$ ${command}`,
        style: `font-family: monospace; font-size: 12px; color: ${ACCENT}; background-color: rgba(0,0,0,0.35); border-radius: 8px; padding: 8px 12px; margin-top: 12px; border: 1px solid rgba(255,255,255,0.03);`,
        x_expand: true,
    });
    cmdBlock.clutter_text.line_wrap = true;
    return cmdBlock;
}

/** Single action label (non-interactive display). */
function buildActionLabel(label: string, color: string, bgColor: string): St.Label {
    return new St.Label({
        text: label,
        style: `font-size: 13px; font-weight: bold; color: ${color}; background-color: ${bgColor}; border-radius: 8px; padding: 8px 16px; text-align: center;`,
        x_expand: true,
        x_align: Clutter.ActorAlign.CENTER,
    });
}

/** Permission action row: Allow, Always, Deny. */
export function buildPermissionActionRow(): St.BoxLayout {
    const row = new St.BoxLayout({ style: 'spacing: 8px; margin-top: 14px;', x_expand: true });
    row.add_child(buildActionLabel('(1) Allow', GREEN, 'rgba(125,214,164,0.12)'));
    row.add_child(buildActionLabel('(2) Always', BLUE, 'rgba(90,142,201,0.12)'));
    row.add_child(buildActionLabel('(3) Deny', RED, 'rgba(201,90,90,0.12)'));
    return row;
}

/** Notification action row: Visit, Dismiss. */
export function buildNotificationActionRow(): St.BoxLayout {
    const row = new St.BoxLayout({ style: 'spacing: 8px; margin-top: 14px;', x_expand: true });
    row.add_child(buildActionLabel('(1) Visit', ACCENT, 'rgba(98,175,133,0.12)'));
    row.add_child(buildActionLabel('(2) Dismiss', TEXT_DIM, 'transparent'));
    return row;
}

/** Placeholder label for unavailable previews. */
export function buildPlaceholderLabel(hasSession: boolean): St.Label {
    return new St.Label({
        text: hasSession ? 'No preview available' : 'No associated session',
        style: `font-size: 14px; color: ${TEXT_DIM}; text-align: center;`,
        width: 200, opacity: 0,
    });
}
