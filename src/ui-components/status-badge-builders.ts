import St from 'gi://St';
import Gio from 'gi://Gio';

import type { ClaudeStatus } from '../domain/notification-types.js';

export const STATUS_COLORS: Record<ClaudeStatus, string> = {
    'working': '#4CAF50',
    'needs-input': '#F44336',
    'done': '#FF9800',
};

const ICON_SIZE = 75;

/** Create a status badge icon for a Claude session overlay. */
export function buildStatusIcon(
    gFile: Gio.File,
    status: ClaudeStatus,
): St.Icon {
    const gicon = new Gio.FileIcon({ file: gFile });
    return new St.Icon({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        gicon: gicon as any,
        icon_size: ICON_SIZE,
        style: buildStatusStyle(status),
        reactive: false,
    });
}

/** Build the style string for a status badge. */
export function buildStatusStyle(status: ClaudeStatus): string {
    return `color: ${STATUS_COLORS[status]}; -st-icon-style: symbolic;`;
}
