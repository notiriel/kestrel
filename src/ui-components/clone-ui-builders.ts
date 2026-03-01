import St from 'gi://St';
import Clutter from 'gi://Clutter';

const OVERVIEW_BG_COLOR = 'rgba(0,0,0,0.7)';

/** Create the dark overlay background for overview mode. */
export function buildOverviewBackground(layerWidth: number, layerHeight: number): St.Widget {
    return new St.Widget({
        name: 'kestrel-overview-bg',
        style: `background-color: ${OVERVIEW_BG_COLOR};`,
        reactive: true,
        x: 0,
        y: 0,
        width: layerWidth,
        height: layerHeight,
    });
}

/** Create the filter indicator pill shown during overview text filter. */
export function buildFilterIndicator(): St.BoxLayout {
    const indicator = new St.BoxLayout({
        name: 'kestrel-filter-indicator',
        style: 'background-color: rgba(0,0,0,0.8); border-radius: 20px; padding: 8px 16px; color: white;',
        x_align: Clutter.ActorAlign.CENTER,
        y_align: Clutter.ActorAlign.START,
    });

    const icon = new St.Label({ text: '\u{1F50D} ', style: 'font-size: 14px;' });
    indicator.add_child(icon);

    const label = new St.Label({ name: 'kestrel-filter-text', text: '', style: 'font-size: 14px;' });
    indicator.add_child(label);

    return indicator;
}

/** Create the text entry for workspace renaming in overview mode. */
export function buildRenameEntry(currentName: string): St.Entry {
    return new St.Entry({
        name: 'kestrel-rename-entry',
        text: currentName,
        style: 'font-size: 14px; background-color: rgba(0,0,0,0.9); color: white; border: 2px solid rgba(125,214,164,0.8); border-radius: 6px; padding: 4px 8px; min-width: 200px;',
    });
}

/** Create a rotated workspace name label for overview mode. */
export function buildWorkspaceLabel(monitorHeight: number): St.Label {
    const nameLabel = new St.Label({
        text: '',
        style_class: 'kestrel-ws-label',
        y_align: Clutter.ActorAlign.CENTER,
        visible: false,
    });
    nameLabel.rotation_angle_z = -90;
    nameLabel.set_position(4, monitorHeight / 2);
    return nameLabel;
}

/** Build the CSS style string for the focus indicator border. */
export function buildFocusIndicatorStyle(
    borderWidth: number,
    borderColor: string,
    borderRadius: number,
    bgColor: string,
): string {
    return `border: ${borderWidth}px solid ${borderColor}; border-radius: ${borderRadius}px; background-color: ${bgColor};`;
}

/** Create the focus indicator widget. */
export function buildFocusIndicator(style: string): St.Widget {
    return new St.Widget({
        name: 'kestrel-focus-indicator',
        style,
        visible: false,
        reactive: false,
    });
}
