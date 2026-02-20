import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';

export default class PaperFlowPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window: Adw.PreferencesWindow): void {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'PaperFlow',
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

        const borderColorRow = new Adw.EntryRow({
            title: 'Border Color',
        });
        settings.bind('focus-border-color', borderColorRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        focusGroup.add(borderColorRow);

        const bgColorRow = new Adw.EntryRow({
            title: 'Background Color',
        });
        settings.bind('focus-background-color', bgColorRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        focusGroup.add(bgColorRow);
    }
}
