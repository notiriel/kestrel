import '@girs/gjs';
import '@girs/gjs/dom';
import '@girs/gnome-shell/ambient';
import '@girs/gnome-shell/extensions/global';

declare module 'gi://Adw' {
    export default import('@girs/adw-1').default;
}

declare module 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js' {
    import type Gio from 'gi://Gio';
    export class ExtensionPreferences {
        getSettings(): Gio.Settings;
        fillPreferencesWindow(window: import('gi://Adw').default.PreferencesWindow): void;
    }
}
