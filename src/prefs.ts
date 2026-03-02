import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { createColorRow } from './prefs/color-row.js';
import { createShortcutRow } from './prefs/shortcut-row.js';
import { createAppChooserRow } from './prefs/app-chooser-row.js';
import { createGroupResetButton, showFullResetDialog } from './prefs/reset-helpers.js';

export default class KestrelPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window: Adw.PreferencesWindow): void {
        const settings = this.getSettings();
        const destroyCallbacks: (() => void)[] = [];

        window.add(this._buildLayoutPage(settings, destroyCallbacks));
        window.add(this._buildKeybindingsPage(settings, destroyCallbacks));
        window.add(this._buildQuakePage(settings, destroyCallbacks));
        window.add(this._buildAdvancedPage(settings, window, destroyCallbacks));

        window.connect('close-request', () => {
            destroyCallbacks.forEach(fn => fn());
            return false;
        });
    }

    // ── Page 1: Layout ──────────────────────────────────────────────

    private _buildLayoutPage(settings: Gio.Settings, destroys: (() => void)[]): Adw.PreferencesPage {
        const page = new Adw.PreferencesPage({
            title: 'Layout',
            icon_name: 'preferences-desktop-display-symbolic',
        });

        // Tiling group
        const tilingKeys = ['column-count', 'gap-size', 'edge-gap'];
        const tilingReset = createGroupResetButton(settings, tilingKeys);
        destroys.push(tilingReset.destroy);

        const tilingGroup = new Adw.PreferencesGroup({
            title: 'Tiling',
            description: 'Column layout and spacing',
        });
        tilingGroup.set_header_suffix(tilingReset.button);
        page.add(tilingGroup);

        const columnsRow = Adw.SpinRow.new_with_range(1, 6, 1);
        columnsRow.title = 'Columns';
        columnsRow.subtitle = 'Number of columns per viewport';
        settings.bind('column-count', columnsRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        tilingGroup.add(columnsRow);

        const gapRow = Adw.SpinRow.new_with_range(0, 64, 1);
        gapRow.title = 'Gap Size';
        gapRow.subtitle = 'Space between windows in pixels';
        settings.bind('gap-size', gapRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        tilingGroup.add(gapRow);

        const edgeGapRow = Adw.SpinRow.new_with_range(0, 64, 1);
        edgeGapRow.title = 'Edge Gap';
        edgeGapRow.subtitle = 'Space at screen edges in pixels';
        settings.bind('edge-gap', edgeGapRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        tilingGroup.add(edgeGapRow);

        // Focus Indicator group
        const focusKeys = ['focus-border-width', 'focus-border-radius', 'focus-border-color', 'focus-background-color'];
        const focusReset = createGroupResetButton(settings, focusKeys);
        destroys.push(focusReset.destroy);

        const focusGroup = new Adw.PreferencesGroup({
            title: 'Focus Indicator',
            description: 'Appearance of the focused window border',
        });
        focusGroup.set_header_suffix(focusReset.button);
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

        const borderColor = createColorRow(settings, 'focus-border-color', 'Border Color', 'Color of the focus indicator border');
        destroys.push(borderColor.destroy);
        focusGroup.add(borderColor.row);

        const bgColor = createColorRow(settings, 'focus-background-color', 'Background Color', 'Background color behind the focused window');
        destroys.push(bgColor.destroy);
        focusGroup.add(bgColor.row);

        return page;
    }

    // ── Page 2: Keybindings ─────────────────────────────────────────

    private _buildKeybindingsPage(settings: Gio.Settings, destroys: (() => void)[]): Adw.PreferencesPage {
        const page = new Adw.PreferencesPage({
            title: 'Keybindings',
            icon_name: 'input-keyboard-symbolic',
        });

        const groups: { title: string; keys: { key: string; label: string }[] }[] = [
            {
                title: 'Navigation',
                keys: [
                    { key: 'focus-right', label: 'Focus Right' },
                    { key: 'focus-left', label: 'Focus Left' },
                    { key: 'focus-down', label: 'Focus Down' },
                    { key: 'focus-up', label: 'Focus Up' },
                ],
            },
            {
                title: 'Window Management',
                keys: [
                    { key: 'move-left', label: 'Move Left' },
                    { key: 'move-right', label: 'Move Right' },
                    { key: 'move-down', label: 'Move Down' },
                    { key: 'move-up', label: 'Move Up' },
                    { key: 'toggle-size', label: 'Toggle Size' },
                    { key: 'join-stack', label: 'Join/Unstack' },
                    { key: 'close-window', label: 'Close Window' },
                    { key: 'new-window', label: 'New Window' },
                ],
            },
            {
                title: 'Workspaces',
                keys: [
                    { key: 'force-workspace-up', label: 'Force Workspace Up' },
                    { key: 'force-workspace-down', label: 'Force Workspace Down' },
                ],
            },
            {
                title: 'Panels & Overlays',
                keys: [
                    { key: 'kestrel-toggle-overview', label: 'Toggle Overview' },
                    { key: 'toggle-help', label: 'Toggle Help' },
                    { key: 'toggle-notifications', label: 'Toggle Notifications' },
                ],
            },
        ];

        for (const groupDef of groups) {
            const groupKeys = groupDef.keys.map(k => k.key);
            const groupReset = createGroupResetButton(settings, groupKeys);
            destroys.push(groupReset.destroy);

            const group = new Adw.PreferencesGroup({ title: groupDef.title });
            group.set_header_suffix(groupReset.button);
            page.add(group);

            for (const { key, label } of groupDef.keys) {
                const shortcut = createShortcutRow(settings, key, label);
                destroys.push(shortcut.destroy);
                group.add(shortcut.row);
            }
        }

        return page;
    }

    // ── Page 3: Quake Console ───────────────────────────────────────

    private _buildQuakePage(settings: Gio.Settings, destroys: (() => void)[]): Adw.PreferencesPage {
        const page = new Adw.PreferencesPage({
            title: 'Quake Console',
            icon_name: 'utilities-terminal-symbolic',
        });

        // General group
        const generalKeys = ['quake-prelaunch', 'quake-width-percent', 'quake-height-percent'];
        const generalReset = createGroupResetButton(settings, generalKeys);
        destroys.push(generalReset.destroy);

        const generalGroup = new Adw.PreferencesGroup({
            title: 'General',
            description: 'Quake console dimensions and behavior',
        });
        generalGroup.set_header_suffix(generalReset.button);
        page.add(generalGroup);

        const prelaunchRow = new Adw.SwitchRow({
            title: 'Pre-launch Apps',
            subtitle: 'Launch configured apps on startup for instant access',
        });
        settings.bind('quake-prelaunch', prelaunchRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(prelaunchRow);

        const widthRow = Adw.SpinRow.new_with_range(20, 100, 5);
        widthRow.title = 'Width';
        widthRow.subtitle = 'Window width as percentage of screen';
        settings.bind('quake-width-percent', widthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(widthRow);

        const heightRow = Adw.SpinRow.new_with_range(20, 100, 5);
        heightRow.title = 'Height';
        heightRow.subtitle = 'Window height as percentage of screen';
        settings.bind('quake-height-percent', heightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        generalGroup.add(heightRow);

        // Slot groups
        for (let i = 1; i <= 5; i++) {
            const appKey = `quake-slot-${i}`;
            const toggleKey = `quake-slot-${i}-toggle`;
            const slotKeys = [appKey, toggleKey];
            const slotReset = createGroupResetButton(settings, slotKeys);
            destroys.push(slotReset.destroy);

            const slotGroup = new Adw.PreferencesGroup({ title: `Slot ${i}` });
            slotGroup.set_header_suffix(slotReset.button);
            page.add(slotGroup);

            const appChooser = createAppChooserRow(settings, appKey, 'Application');
            destroys.push(appChooser.destroy);
            slotGroup.add(appChooser.row);

            const shortcut = createShortcutRow(settings, toggleKey, 'Keybinding');
            destroys.push(shortcut.destroy);
            slotGroup.add(shortcut.row);
        }

        return page;
    }

    // ── Page 4: Advanced ────────────────────────────────────────────

    private _buildAdvancedPage(
        settings: Gio.Settings,
        window: Adw.PreferencesWindow,
        _destroys: (() => void)[],
    ): Adw.PreferencesPage {
        const page = new Adw.PreferencesPage({
            title: 'Advanced',
            icon_name: 'applications-engineering-symbolic',
        });

        const diagGroup = new Adw.PreferencesGroup({
            title: 'Diagnostics',
        });
        page.add(diagGroup);

        const debugRow = new Adw.SwitchRow({
            title: 'Debug Mode',
            subtitle: 'Enable verbose logging and DBus debug interface',
        });
        settings.bind('debug-mode', debugRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        diagGroup.add(debugRow);

        const resetRow = new Adw.ActionRow({
            title: 'Reset All Settings',
            subtitle: 'Restore all settings to their default values',
        });
        const resetButton = new Gtk.Button({
            label: 'Reset…',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        resetButton.connect('clicked', () => {
            showFullResetDialog(settings, window);
        });
        resetRow.add_suffix(resetButton);
        resetRow.activatable_widget = resetButton;
        diagGroup.add(resetRow);

        return page;
    }
}
