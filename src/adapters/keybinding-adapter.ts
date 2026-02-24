import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type { KeybindingPort, KeybindingCallbacks } from '../ports/keybinding-port.js';

export type { KeybindingCallbacks };

/** Mutter setting whose default ('Super_L') opens the Activities Overview. */
const MUTTER_SCHEMA = 'org.gnome.mutter';
const OVERLAY_KEY = 'overlay-key';

/** Mutter keybindings that conflict with Kestrel's Super+Arrow combos. */
const MUTTER_KB_SCHEMA = 'org.gnome.mutter.keybindings';
const CONFLICTING_MUTTER_KEYS = [
    'toggle-tiled-left',            // <Super>Left
    'toggle-tiled-right',           // <Super>Right
] as const;

/** Shell keybindings that conflict with Kestrel's Super+key combos. */
const SHELL_KB_SCHEMA = 'org.gnome.shell.keybindings';
const CONFLICTING_SHELL_KEYS = [
    'toggle-message-tray',          // <Super>m — conflicts with overview toggle
] as const;

/** WM keybindings that conflict with Kestrel's Super+key combos. */
const WM_SCHEMA = 'org.gnome.desktop.wm.keybindings';
const CONFLICTING_WM_KEYS = [
    'switch-applications',          // <Super>Tab
    'switch-applications-backward', // <Shift><Super>Tab
    'maximize',                     // <Super>Up
    'unmaximize',                   // <Super>Down
    'move-to-monitor-left',         // <Shift><Super>Left
    'move-to-monitor-right',        // <Shift><Super>Right
    'move-to-monitor-up',           // <Shift><Super>Up
    'move-to-monitor-down',         // <Shift><Super>Down
] as const;

export class KeybindingAdapter implements KeybindingPort {
    private _bound: string[] = [];
    private _savedOverlayKey: string | null = null;
    private _savedBindings: Array<{ schemaId: string; bindings: Map<string, string[]> }> = [];

    /** Save current strv values for keys and set them to empty. */
    private _saveAndDisable(schemaId: string, keys: readonly string[]): void {
        try {
            const settings = new Gio.Settings({ schema_id: schemaId });
            const bindings = new Map<string, string[]>();
            for (const key of keys) {
                const saved = settings.get_strv(key);
                bindings.set(key, saved);
                settings.set_strv(key, []);
            }
            this._savedBindings.push({ schemaId, bindings });
        } catch (e) {
            console.error(`[Kestrel] Failed to disable keybindings in ${schemaId}:`, e);
        }
    }

    /** Restore all saved bindings. */
    private _restoreAll(): void {
        for (const { schemaId, bindings } of this._savedBindings) {
            try {
                const settings = new Gio.Settings({ schema_id: schemaId });
                for (const [key, saved] of bindings) {
                    settings.set_strv(key, saved);
                }
            } catch (e) {
                console.error(`[Kestrel] Failed to restore keybindings in ${schemaId}:`, e);
            }
        }
        this._savedBindings = [];
    }

    connect(settings: Gio.Settings, callbacks: KeybindingCallbacks): void {
        // Disable the Super overlay key so it doesn't open the Activities Overview
        // when Super+Arrow combos are released.
        try {
            const mutterSettings = new Gio.Settings({ schema_id: MUTTER_SCHEMA });
            this._savedOverlayKey = mutterSettings.get_string(OVERLAY_KEY);
            mutterSettings.set_string(OVERLAY_KEY, '');
        } catch (e) {
            console.error('[Kestrel] Failed to disable overlay-key:', e);
        }

        this._saveAndDisable(MUTTER_KB_SCHEMA, CONFLICTING_MUTTER_KEYS);
        this._saveAndDisable(SHELL_KB_SCHEMA, CONFLICTING_SHELL_KEYS);
        this._saveAndDisable(WM_SCHEMA, CONFLICTING_WM_KEYS);

        const bindings: Array<[string, () => void]> = [
            ['focus-right', callbacks.onFocusRight],
            ['focus-left', callbacks.onFocusLeft],
            ['focus-down', callbacks.onFocusDown],
            ['focus-up', callbacks.onFocusUp],
            ['move-left', callbacks.onMoveLeft],
            ['move-right', callbacks.onMoveRight],
            ['move-down', callbacks.onMoveDown],
            ['move-up', callbacks.onMoveUp],
            ['toggle-size', callbacks.onToggleSize],
            ['kestrel-toggle-overview', callbacks.onToggleOverview],
            ['new-window', callbacks.onNewWindow],
            ['toggle-notifications', callbacks.onToggleNotifications],
            ['toggle-help', callbacks.onToggleHelp],
            ['close-window', callbacks.onCloseWindow],
            ['launch-workspace-switcher', callbacks.onLaunchWorkspaceSwitcher],
            ['launch-workspace-rename', callbacks.onLaunchWorkspaceRename],
        ];

        for (const [name, handler] of bindings) {
            try {
                const result = Main.wm.addKeybinding(
                    name,
                    settings,
                    Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.NORMAL,
                    handler,
                );
                this._bound.push(name);
            } catch (e) {
                console.error(`[Kestrel] Failed to add keybinding ${name}:`, e);
            }
        }
    }

    destroy(): void {
        for (const name of this._bound) {
            try {
                Main.wm.removeKeybinding(name);
            } catch (e) {
                console.error(`[Kestrel] Failed to remove keybinding ${name}:`, e);
            }
        }
        this._bound = [];

        // Restore the overlay key
        if (this._savedOverlayKey !== null) {
            try {
                const mutterSettings = new Gio.Settings({ schema_id: MUTTER_SCHEMA });
                mutterSettings.set_string(OVERLAY_KEY, this._savedOverlayKey);
            } catch (e) {
                console.error('[Kestrel] Failed to restore overlay-key:', e);
            }
            this._savedOverlayKey = null;
        }

        this._restoreAll();
    }
}
