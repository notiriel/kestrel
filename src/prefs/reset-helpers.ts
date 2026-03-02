import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

const ALL_RESETTABLE_KEYS = [
    'gap-size',
    'edge-gap',
    'column-count',
    'focus-border-width',
    'focus-border-radius',
    'focus-border-color',
    'focus-background-color',
    'focus-right',
    'focus-left',
    'focus-down',
    'focus-up',
    'move-left',
    'move-right',
    'move-down',
    'move-up',
    'toggle-size',
    'join-stack',
    'close-window',
    'new-window',
    'force-workspace-up',
    'force-workspace-down',
    'kestrel-toggle-overview',
    'toggle-help',
    'toggle-notifications',
    'quake-prelaunch',
    'quake-width-percent',
    'quake-height-percent',
    'quake-slot-1',
    'quake-slot-2',
    'quake-slot-3',
    'quake-slot-4',
    'quake-slot-5',
    'quake-slot-1-toggle',
    'quake-slot-2-toggle',
    'quake-slot-3-toggle',
    'quake-slot-4-toggle',
    'quake-slot-5-toggle',
    'debug-mode',
];

function isModified(settings: Gio.Settings, key: string): boolean {
    const current = settings.get_value(key);
    const defaultVal = settings.get_default_value(key);
    if (!defaultVal) return false;
    return !current.equal(defaultVal);
}

export function createPerRowResetButton(settings: Gio.Settings, key: string): { button: Gtk.Button; destroy: () => void } {
    const button = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: 'Reset to default',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'circular'],
        visible: isModified(settings, key),
    });

    button.connect('clicked', () => {
        settings.reset(key);
    });

    const signalId = settings.connect(`changed::${key}`, () => {
        button.visible = isModified(settings, key);
    });

    return {
        button,
        destroy: () => settings.disconnect(signalId),
    };
}

export function createGroupResetButton(settings: Gio.Settings, keys: string[]): { button: Gtk.Button; destroy: () => void } {
    const anyModified = () => keys.some(k => isModified(settings, k));

    const button = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: 'Reset group to defaults',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'circular'],
        visible: anyModified(),
    });

    button.connect('clicked', () => {
        for (const key of keys) {
            settings.reset(key);
        }
    });

    const signalIds = keys.map(key =>
        settings.connect(`changed::${key}`, () => {
            button.visible = anyModified();
        })
    );

    return {
        button,
        destroy: () => signalIds.forEach(id => settings.disconnect(id)),
    };
}

export function showFullResetDialog(settings: Gio.Settings, window: Adw.PreferencesWindow): void {
    const dialog = new Adw.AlertDialog({
        heading: 'Reset All Settings?',
        body: 'This will reset all Kestrel settings to their defaults. Your window layout will be preserved.',
    });
    dialog.add_response('cancel', 'Cancel');
    dialog.add_response('reset', 'Reset');
    dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
    dialog.set_default_response('cancel');
    dialog.set_close_response('cancel');

    dialog.connect('response', (_dialog: Adw.AlertDialog, response: string) => {
        if (response === 'reset') {
            for (const key of ALL_RESETTABLE_KEYS) {
                settings.reset(key);
            }
        }
    });

    dialog.present(window);
}
