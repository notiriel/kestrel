import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { createPerRowResetButton } from './reset-helpers.js';

export function createAppChooserRow(
    settings: Gio.Settings,
    key: string,
    title: string,
): { row: Adw.ComboRow; destroy: () => void } {
    const apps = Gio.AppInfo.get_all()
        .filter(a => a.should_show())
        .sort((a, b) => (a.get_display_name() ?? '').localeCompare(b.get_display_name() ?? ''));

    const names = ['(None)', ...apps.map(a => a.get_display_name() ?? a.get_id() ?? 'Unknown')];
    const appIds = ['', ...apps.map(a => a.get_id() ?? '')];

    const model = new Gtk.StringList();
    for (const name of names) {
        model.append(name);
    }

    const reset = createPerRowResetButton(settings, key);

    const row = new Adw.ComboRow({ title, model });
    row.add_suffix(reset.button);

    let updating = false;

    function syncFromSettings(): void {
        const currentId = settings.get_string(key);
        if (!currentId) {
            row.selected = 0;
            row.subtitle = '';
            return;
        }
        const idx = appIds.indexOf(currentId);
        if (idx >= 0) {
            row.selected = idx;
            row.subtitle = currentId;
        } else {
            row.selected = 0;
            row.subtitle = '';
        }
    }

    syncFromSettings();

    const notifyId = row.connect('notify::selected', () => {
        if (updating) return;
        updating = true;
        const idx = row.selected;
        const id = appIds[idx] ?? '';
        settings.set_string(key, id);
        row.subtitle = id || '';
        updating = false;
    });

    const changedId = settings.connect(`changed::${key}`, () => {
        if (updating) return;
        updating = true;
        syncFromSettings();
        updating = false;
    });

    return {
        row,
        destroy: () => {
            row.disconnect(notifyId);
            settings.disconnect(changedId);
            reset.destroy();
        },
    };
}
