import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import Gdk from 'gi://Gdk';

export default class KestrelPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window: Adw.PreferencesWindow): void {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Kestrel',
            icon_name: 'preferences-desktop-display-symbolic',
        });
        window.add(page);

        // --- Layout group ---
        const layoutGroup = new Adw.PreferencesGroup({
            title: 'Layout',
            description: 'Window spacing and gaps',
        });
        page.add(layoutGroup);

        const gapRow = Adw.SpinRow.new_with_range(0, 64, 1);
        gapRow.title = 'Gap Size';
        gapRow.subtitle = 'Space between windows in pixels';
        settings.bind('gap-size', gapRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        layoutGroup.add(gapRow);

        const edgeGapRow = Adw.SpinRow.new_with_range(0, 64, 1);
        edgeGapRow.title = 'Edge Gap';
        edgeGapRow.subtitle = 'Space at screen edges in pixels';
        settings.bind('edge-gap', edgeGapRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        layoutGroup.add(edgeGapRow);

        // --- Focus Indicator group ---
        const focusGroup = new Adw.PreferencesGroup({
            title: 'Focus Indicator',
            description: 'Appearance of the focused window border',
        });
        page.add(focusGroup);

        const borderWidthRow = Adw.SpinRow.new_with_range(0, 16, 1);
        borderWidthRow.title = 'Border Width';
        borderWidthRow.subtitle = 'Width of the focus border in pixels';
        settings.bind('focus-border-width', borderWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        focusGroup.add(borderWidthRow);

        const borderRadiusRow = Adw.SpinRow.new_with_range(0, 32, 1);
        borderRadiusRow.title = 'Border Radius';
        borderRadiusRow.subtitle = 'Corner radius of the focus border in pixels';
        settings.bind('focus-border-radius', borderRadiusRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        focusGroup.add(borderRadiusRow);

        this._addColorRow(focusGroup, settings, 'focus-border-color', 'Border Color', 'Color of the focus indicator border');
        this._addColorRow(focusGroup, settings, 'focus-background-color', 'Background Color', 'Background color behind the focused window');
    }

    private _addColorRow(group: Adw.PreferencesGroup, settings: Gio.Settings, key: string, title: string, subtitle: string): void {
        const dialog = new Gtk.ColorDialog({ with_alpha: true });
        const button = new Gtk.ColorDialogButton({ dialog });

        // Initialize from current setting
        const rgba = new Gdk.RGBA();
        rgba.parse(settings.get_string(key));
        button.set_rgba(rgba);

        // Write back on change
        let updating = false;
        button.connect('notify::rgba', () => {
            if (updating) return;
            const c = button.get_rgba();
            const css = `rgba(${Math.round(c.red * 255)},${Math.round(c.green * 255)},${Math.round(c.blue * 255)},${Math.round(c.alpha * 100) / 100})`;
            updating = true;
            settings.set_string(key, css);
            updating = false;
        });

        // Sync if changed externally
        settings.connect(`changed::${key}`, () => {
            if (updating) return;
            updating = true;
            const r = new Gdk.RGBA();
            r.parse(settings.get_string(key));
            button.set_rgba(r);
            updating = false;
        });

        button.valign = Gtk.Align.CENTER;

        const row = new Adw.ActionRow({ title, subtitle });
        row.add_suffix(button);
        group.add(row);
    }
}
