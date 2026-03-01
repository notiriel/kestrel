import St from 'gi://St';
import Clutter from 'gi://Clutter';

export const STATUS_ICONS: Record<string, string> = {
    'working': '\u{1F7E2}',    // 🟢
    'needs-input': '\u{1F534}', // 🔴
    'done': '\u{1F7E0}',       // 🟠
};

interface IndicatorBox {
    box: St.BoxLayout;
    label: St.Label;
    statusDot: St.Label;
}

/** Build the indicator box with workspace label and status dot. */
export function buildIndicatorBox(): IndicatorBox {
    const box = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });
    const label = new St.Label({ text: 'Kestrel', y_align: Clutter.ActorAlign.CENTER });
    box.add_child(label);
    const statusDot = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER, style: 'padding-left: 4px; font-size: 10px;' });
    box.add_child(statusDot);
    return { box, label, statusDot };
}
