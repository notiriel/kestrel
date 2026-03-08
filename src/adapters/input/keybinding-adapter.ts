import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
interface KeybindingCallbacks {
    onFocusRight: () => void;
    onFocusLeft: () => void;
    onFocusDown: () => void;
    onFocusUp: () => void;
    onMoveLeft: () => void;
    onMoveRight: () => void;
    onMoveDown: () => void;
    onMoveUp: () => void;
    onToggleSize: () => void;
    onToggleOverview: () => void;
    onNewWindow: () => void;
    onToggleNotifications: () => void;
    onToggleHelp: () => void;
    onCloseWindow: () => void;
    onJoinStack: () => void;
    onForceWorkspaceUp: () => void;
    onForceWorkspaceDown: () => void;
    onQuakeSlot1: () => void;
    onQuakeSlot2: () => void;
    onQuakeSlot3: () => void;
    onQuakeSlot4: () => void;
    onWorkspaceTodosToggle: () => void;
}

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

export class KeybindingAdapter {
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
        this._disableOverlayKey();
        this._saveAndDisable(MUTTER_KB_SCHEMA, CONFLICTING_MUTTER_KEYS);
        this._saveAndDisable(SHELL_KB_SCHEMA, CONFLICTING_SHELL_KEYS);
        this._saveAndDisable(WM_SCHEMA, CONFLICTING_WM_KEYS);
        this._registerBindings(settings, callbacks);
    }

    private _disableOverlayKey(): void {
        try {
            const mutterSettings = new Gio.Settings({ schema_id: MUTTER_SCHEMA });
            this._savedOverlayKey = mutterSettings.get_string(OVERLAY_KEY);
            mutterSettings.set_string(OVERLAY_KEY, '');
        } catch (e) {
            console.error('[Kestrel] Failed to disable overlay-key:', e);
        }
    }

    private _registerBindings(settings: Gio.Settings, callbacks: KeybindingCallbacks): void {
        this._addBindings(settings, this._coreBindings(callbacks));
        this._addBindings(settings, this._stackBindings(callbacks));
        this._addBindings(settings, this._quakeBindings(callbacks));
        this._addBindings(settings, this._todoBindings(callbacks));
    }

    private _coreBindings(cb: KeybindingCallbacks): Array<[string, () => void]> {
        return [
            ['focus-right', cb.onFocusRight], ['focus-left', cb.onFocusLeft],
            ['focus-down', cb.onFocusDown], ['focus-up', cb.onFocusUp],
            ['move-left', cb.onMoveLeft], ['move-right', cb.onMoveRight],
            ['move-down', cb.onMoveDown], ['move-up', cb.onMoveUp],
            ['toggle-size', cb.onToggleSize], ['kestrel-toggle-overview', cb.onToggleOverview],
            ['new-window', cb.onNewWindow], ['toggle-notifications', cb.onToggleNotifications],
            ['toggle-help', cb.onToggleHelp], ['close-window', cb.onCloseWindow],
        ];
    }

    private _stackBindings(cb: KeybindingCallbacks): Array<[string, () => void]> {
        return [
            ['join-stack', cb.onJoinStack],
            ['force-workspace-up', cb.onForceWorkspaceUp],
            ['force-workspace-down', cb.onForceWorkspaceDown],
        ];
    }

    private _quakeBindings(cb: KeybindingCallbacks): Array<[string, () => void]> {
        return [
            ['quake-slot-1-toggle', cb.onQuakeSlot1],
            ['quake-slot-2-toggle', cb.onQuakeSlot2],
            ['quake-slot-3-toggle', cb.onQuakeSlot3],
            ['quake-slot-4-toggle', cb.onQuakeSlot4],
        ];
    }

    private _todoBindings(cb: KeybindingCallbacks): Array<[string, () => void]> {
        return [
            ['workspace-todos-toggle', cb.onWorkspaceTodosToggle],
        ];
    }

    private _addBindings(settings: Gio.Settings, bindings: Array<[string, () => void]>): void {
        for (const [name, handler] of bindings) {
            try {
                const action = Main.wm.addKeybinding(name, settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, handler);
                console.log(`[Kestrel] addKeybinding(${name}) → action=${action}`);
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
