import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { createPerRowResetButton } from './reset-helpers.js';

interface KeybindingDef {
    key: string;
    label: string;
}

const KEYBINDING_KEYS: KeybindingDef[] = [
    // Navigation
    { key: 'focus-right', label: 'Focus Right' },
    { key: 'focus-left', label: 'Focus Left' },
    { key: 'focus-down', label: 'Focus Down' },
    { key: 'focus-up', label: 'Focus Up' },
    // Window Management
    { key: 'move-left', label: 'Move Left' },
    { key: 'move-right', label: 'Move Right' },
    { key: 'move-down', label: 'Move Down' },
    { key: 'move-up', label: 'Move Up' },
    { key: 'toggle-size', label: 'Toggle Size' },
    { key: 'join-stack', label: 'Join/Unstack' },
    { key: 'close-window', label: 'Close Window' },
    { key: 'new-window', label: 'New Window' },
    // Workspaces
    { key: 'force-workspace-up', label: 'Force Workspace Up' },
    { key: 'force-workspace-down', label: 'Force Workspace Down' },
    // Panels & Overlays
    { key: 'kestrel-toggle-overview', label: 'Toggle Overview' },
    { key: 'toggle-help', label: 'Toggle Help' },
    { key: 'toggle-notifications', label: 'Toggle Notifications' },
    // Quake slots
    { key: 'quake-slot-1-toggle', label: 'Quake Slot 1' },
    { key: 'quake-slot-2-toggle', label: 'Quake Slot 2' },
    { key: 'quake-slot-3-toggle', label: 'Quake Slot 3' },
    { key: 'quake-slot-4-toggle', label: 'Quake Slot 4' },
    { key: 'quake-slot-5-toggle', label: 'Quake Slot 5' },
];

function isModifierOnly(keyval: number): boolean {
    return keyval === Gdk.KEY_Shift_L || keyval === Gdk.KEY_Shift_R ||
        keyval === Gdk.KEY_Control_L || keyval === Gdk.KEY_Control_R ||
        keyval === Gdk.KEY_Alt_L || keyval === Gdk.KEY_Alt_R ||
        keyval === Gdk.KEY_Super_L || keyval === Gdk.KEY_Super_R ||
        keyval === Gdk.KEY_Meta_L || keyval === Gdk.KEY_Meta_R ||
        keyval === Gdk.KEY_Hyper_L || keyval === Gdk.KEY_Hyper_R ||
        keyval === Gdk.KEY_ISO_Level3_Shift;
}

function findConflict(settings: Gio.Settings, currentKey: string, accel: string): string | null {
    for (const def of KEYBINDING_KEYS) {
        if (def.key === currentKey) continue;
        const strv = settings.get_strv(def.key);
        if (strv.length > 0 && strv[0] === accel) {
            return def.label;
        }
    }
    return null;
}

export function createShortcutRow(
    settings: Gio.Settings,
    key: string,
    title: string,
): { row: Adw.ActionRow; destroy: () => void } {
    const row = new Adw.ActionRow({ title });

    const reset = createPerRowResetButton(settings, key);

    const shortcutLabel = new Gtk.ShortcutLabel({
        valign: Gtk.Align.CENTER,
        disabled_text: 'Disabled',
    });

    const editingLabel = new Gtk.Label({
        label: 'Press a key combination…',
        css_classes: ['dim-label'],
        valign: Gtk.Align.CENTER,
        visible: false,
    });

    const editButton = new Gtk.Button({
        icon_name: 'document-edit-symbolic',
        tooltip_text: 'Edit shortcut',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'circular'],
    });

    const clearButton = new Gtk.Button({
        icon_name: 'edit-clear-symbolic',
        tooltip_text: 'Clear shortcut',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat', 'circular'],
    });

    row.add_suffix(reset.button);
    row.add_suffix(shortcutLabel);
    row.add_suffix(editingLabel);
    row.add_suffix(editButton);
    row.add_suffix(clearButton);

    // State
    let editing = false;
    let controller: Gtk.EventControllerKey | null = null;
    let warningTimeoutId = 0;
    const cleanups: (() => void)[] = [reset.destroy];

    function syncFromSettings(): void {
        const strv = settings.get_strv(key);
        const accel = strv.length > 0 ? strv[0] : '';
        shortcutLabel.accelerator = accel || '';
        clearButton.visible = accel !== '';
    }

    function stopEditing(): void {
        if (!editing) return;
        editing = false;
        editingLabel.visible = false;
        shortcutLabel.visible = true;
        editButton.sensitive = true;
        if (controller) {
            const win = row.get_root() as Gtk.Window | null;
            if (win) win.remove_controller(controller);
            controller = null;
        }
        row.remove_css_class('accent');
    }

    function startEditing(): void {
        if (editing) return;
        editing = true;
        shortcutLabel.visible = false;
        editingLabel.visible = true;
        editButton.sensitive = false;
        row.add_css_class('accent');

        controller = new Gtk.EventControllerKey();
        controller.connect('key-pressed', (_ctrl: Gtk.EventControllerKey, keyval: number, _keycode: number, state: Gdk.ModifierType) => {
            if (isModifierOnly(keyval)) return false;

            if (keyval === Gdk.KEY_Escape) {
                stopEditing();
                return true;
            }

            if (keyval === Gdk.KEY_BackSpace && state === 0) {
                settings.set_strv(key, []);
                stopEditing();
                return true;
            }

            const mask = state & Gtk.accelerator_get_default_mod_mask();
            const accel = Gtk.accelerator_name(keyval, mask);
            if (accel) {
                settings.set_strv(key, [accel]);

                const conflict = findConflict(settings, key, accel);
                if (conflict) {
                    row.subtitle = `Also used by: ${conflict}`;
                    if (warningTimeoutId) GLib.source_remove(warningTimeoutId);
                    warningTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                        row.subtitle = '';
                        warningTimeoutId = 0;
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }

            stopEditing();
            return true;
        });

        const win = row.get_root() as Gtk.Window | null;
        if (win) win.add_controller(controller);
    }

    syncFromSettings();

    editButton.connect('clicked', () => startEditing());
    clearButton.connect('clicked', () => {
        settings.set_strv(key, []);
    });
    row.activatable_widget = editButton;

    const changedId = settings.connect(`changed::${key}`, () => syncFromSettings());
    cleanups.push(() => settings.disconnect(changedId));

    return {
        row,
        destroy: () => {
            stopEditing();
            if (warningTimeoutId) {
                GLib.source_remove(warningTimeoutId);
                warningTimeoutId = 0;
            }
            cleanups.forEach(fn => fn());
        },
    };
}
