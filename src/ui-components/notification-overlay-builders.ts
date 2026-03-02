import St from 'gi://St';
import Clutter from 'gi://Clutter';

// Kestrel brand palette
const SURFACE_HOVER = '#0f1612';
const BORDER_HOVER = '#243138';
const ACCENT = '#62af85';

const CARD_WIDTH = 400;
export const QUESTION_CARD_WIDTH = 600;
export const CARD_RIGHT_OFFSET = QUESTION_CARD_WIDTH - CARD_WIDTH;

/** Create the notification overlay container. */
export function buildNotificationContainer(): St.Widget {
    return new St.Widget({
        style: 'padding: 0;',
        reactive: true,
        clip_to_allocation: false,
        layout_manager: new Clutter.FixedLayout(),
    });
}

/** Create the notification count badge. */
export function buildCountBadge(): St.Label {
    return new St.Label({
        text: '0',
        style: `background-color: ${ACCENT}; color: #fff; font-family: monospace; font-size: 11px; font-weight: bold; border-radius: 100px; padding: 2px 7px; min-width: 22px; text-align: center;`,
        visible: false,
        reactive: false,
    });
}

/** Build card style string for hovered or default state. */
export function buildCardStyle(hovered: boolean, hasInternalPadding: boolean): string {
    const padding = hasInternalPadding ? '0' : '14px 16px';
    if (hovered) {
        return `background-color: ${SURFACE_HOVER}; border: 1px solid ${BORDER_HOVER}; border-radius: 12px; padding: ${padding}; box-shadow: 0 6px 28px rgba(0,0,0,0.35);`;
    }
    return `background-color: #0a0f0c; border: 1px solid #1c2b2c; border-radius: 12px; padding: ${padding};`;
}
