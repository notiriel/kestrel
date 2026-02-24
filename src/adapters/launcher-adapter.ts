import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

/**
 * Launches ULauncher with a pre-filled query.
 *
 * Opens ULauncher via its session DBus interface, then types the query
 * using a Clutter virtual keyboard device (works on Wayland).
 */
export class LauncherAdapter {
    private _device: Clutter.VirtualInputDevice | null = null;
    private _timeoutId: number = 0;

    launch(query: string): void {
        try {
            GLib.spawn_command_line_async(
                'dbus-send --session --type=method_call --dest=net.launchpad.ulauncher /net/launchpad/ulauncher net.launchpad.ulauncher.toggle_window',
            );
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                this._timeoutId = 0;
                try {
                    this._typeText(query);
                } catch (e) {
                    console.error('[Kestrel] Error typing ULauncher query:', e);
                }
                return GLib.SOURCE_REMOVE;
            });
        } catch (e) {
            console.error('[Kestrel] Error launching ULauncher:', e);
        }
    }

    private _typeText(text: string): void {
        if (!this._device) {
            const seat = Clutter.get_default_backend().get_default_seat();
            this._device = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        }
        const timeUs = GLib.get_monotonic_time();
        for (const char of text) {
            const keyval = char.charCodeAt(0);
            this._device.notify_keyval(timeUs, keyval, Clutter.KeyState.PRESSED);
            this._device.notify_keyval(timeUs, keyval, Clutter.KeyState.RELEASED);
        }
    }

    destroy(): void {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._device = null;
    }
}
