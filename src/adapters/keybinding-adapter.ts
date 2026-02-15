import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export interface KeybindingCallbacks {
    onFocusRight: () => void;
    onFocusLeft: () => void;
    onFocusDown: () => void;
    onFocusUp: () => void;
    onMoveLeft: () => void;
    onMoveRight: () => void;
    onMoveDown: () => void;
    onMoveUp: () => void;
    onToggleSize: () => void;
}

/** Mutter setting whose default ('Super_L') opens the Activities Overview. */
const MUTTER_SCHEMA = 'org.gnome.mutter';
const OVERLAY_KEY = 'overlay-key';

/** Mutter keybindings that conflict with PaperFlow's Super+Arrow combos. */
const MUTTER_KB_SCHEMA = 'org.gnome.mutter.keybindings';
const CONFLICTING_MUTTER_KEYS = [
    'toggle-tiled-left',            // <Super>Left
    'toggle-tiled-right',           // <Super>Right
] as const;

/** WM keybindings that conflict with PaperFlow's Super+key combos. */
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
    private _savedMutterBindings: Map<string, string[]> = new Map();
    private _savedWmBindings: Map<string, string[]> = new Map();

    connect(settings: Gio.Settings, callbacks: KeybindingCallbacks): void {
        // Disable the Super overlay key so it doesn't open the Activities Overview
        // when Super+Arrow combos are released.
        try {
            const mutterSettings = new Gio.Settings({ schema_id: MUTTER_SCHEMA });
            this._savedOverlayKey = mutterSettings.get_string(OVERLAY_KEY);
            mutterSettings.set_string(OVERLAY_KEY, '');
            console.log(`[PaperFlow] Disabled overlay-key (was "${this._savedOverlayKey}")`);
        } catch (e) {
            console.error('[PaperFlow] Failed to disable overlay-key:', e);
        }

        // Disable conflicting Mutter keybindings (e.g. Super+Left/Right tiling)
        try {
            const mutterKbSettings = new Gio.Settings({ schema_id: MUTTER_KB_SCHEMA });
            for (const key of CONFLICTING_MUTTER_KEYS) {
                const saved = mutterKbSettings.get_strv(key);
                this._savedMutterBindings.set(key, saved);
                mutterKbSettings.set_strv(key, []);
                console.log(`[PaperFlow] Disabled ${key} (was ${JSON.stringify(saved)})`);
            }
        } catch (e) {
            console.error('[PaperFlow] Failed to disable Mutter keybindings:', e);
        }

        // Disable conflicting WM keybindings (e.g. Super+Tab app switcher)
        try {
            const wmSettings = new Gio.Settings({ schema_id: WM_SCHEMA });
            for (const key of CONFLICTING_WM_KEYS) {
                const saved = wmSettings.get_strv(key);
                this._savedWmBindings.set(key, saved);
                wmSettings.set_strv(key, []);
                console.log(`[PaperFlow] Disabled ${key} (was ${JSON.stringify(saved)})`);
            }
        } catch (e) {
            console.error('[PaperFlow] Failed to disable WM keybindings:', e);
        }

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
        ];

        for (const [name, handler] of bindings) {
            try {
                Main.wm.addKeybinding(
                    name,
                    settings,
                    Meta.KeyBindingFlags.NONE,
                    Shell.ActionMode.NORMAL,
                    handler,
                );
                this._bound.push(name);
            } catch (e) {
                console.error(`[PaperFlow] Failed to add keybinding ${name}:`, e);
            }
        }
    }

    destroy(): void {
        for (const name of this._bound) {
            try {
                Main.wm.removeKeybinding(name);
            } catch (e) {
                console.error(`[PaperFlow] Failed to remove keybinding ${name}:`, e);
            }
        }
        this._bound = [];

        // Restore the overlay key
        if (this._savedOverlayKey !== null) {
            try {
                const mutterSettings = new Gio.Settings({ schema_id: MUTTER_SCHEMA });
                mutterSettings.set_string(OVERLAY_KEY, this._savedOverlayKey);
                console.log(`[PaperFlow] Restored overlay-key to "${this._savedOverlayKey}"`);
            } catch (e) {
                console.error('[PaperFlow] Failed to restore overlay-key:', e);
            }
            this._savedOverlayKey = null;
        }

        // Restore conflicting Mutter keybindings
        if (this._savedMutterBindings.size > 0) {
            try {
                const mutterKbSettings = new Gio.Settings({ schema_id: MUTTER_KB_SCHEMA });
                for (const [key, saved] of this._savedMutterBindings) {
                    mutterKbSettings.set_strv(key, saved);
                    console.log(`[PaperFlow] Restored ${key} to ${JSON.stringify(saved)}`);
                }
            } catch (e) {
                console.error('[PaperFlow] Failed to restore Mutter keybindings:', e);
            }
            this._savedMutterBindings.clear();
        }

        // Restore conflicting WM keybindings
        if (this._savedWmBindings.size > 0) {
            try {
                const wmSettings = new Gio.Settings({ schema_id: WM_SCHEMA });
                for (const [key, saved] of this._savedWmBindings) {
                    wmSettings.set_strv(key, saved);
                    console.log(`[PaperFlow] Restored ${key} to ${JSON.stringify(saved)}`);
                }
            } catch (e) {
                console.error('[PaperFlow] Failed to restore WM keybindings:', e);
            }
            this._savedWmBindings.clear();
        }
    }
}
