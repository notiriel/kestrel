import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { createPerRowResetButton } from './reset-helpers.js';

export function createColorRow(
    settings: Gio.Settings,
    key: string,
    title: string,
    subtitle: string,
): { row: Adw.ActionRow; destroy: () => void } {
    const dialog = new Gtk.ColorDialog({ with_alpha: true });
    const button = new Gtk.ColorDialogButton({ dialog });

    const rgba = new Gdk.RGBA();
    rgba.parse(settings.get_string(key));
    button.set_rgba(rgba);

    let updating = false;
    const notifyId = button.connect('notify::rgba', () => {
        if (updating) return;
        const c = button.get_rgba();
        const css = `rgba(${Math.round(c.red * 255)},${Math.round(c.green * 255)},${Math.round(c.blue * 255)},${Math.round(c.alpha * 100) / 100})`;
        updating = true;
        settings.set_string(key, css);
        updating = false;
    });

    const changedId = settings.connect(`changed::${key}`, () => {
        if (updating) return;
        updating = true;
        const r = new Gdk.RGBA();
        r.parse(settings.get_string(key));
        button.set_rgba(r);
        updating = false;
    });

    button.valign = Gtk.Align.CENTER;

    const reset = createPerRowResetButton(settings, key);
    const row = new Adw.ActionRow({ title, subtitle });
    row.add_suffix(reset.button);
    row.add_suffix(button);

    return {
        row,
        destroy: () => {
            button.disconnect(notifyId);
            settings.disconnect(changedId);
            reset.destroy();
        },
    };
}
