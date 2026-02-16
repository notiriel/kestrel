import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export type OverviewDirection = 'left' | 'right' | 'up' | 'down';

export interface OverviewInputCallbacks {
    onNavigate: (direction: OverviewDirection) => void;
    onConfirm: () => void;
    onCancel: () => void;
}

/**
 * Modal input capture for overview mode.
 * Connects key-press-event on the global stage while in modal.
 * Arrow keys navigate, Enter confirms, Escape cancels.
 */
export class OverviewInputAdapter {
    private _grab: { ungrab: () => void } | null = null;
    private _keyPressId: number = 0;

    activate(callbacks: OverviewInputCallbacks): void {
        if (this._grab) return;

        // Push modal — returns a Clutter.Grab in GNOME 45+
        const grab = Main.pushModal(global.stage, {
            actionMode: Shell.ActionMode.ALL,
        });
        this._grab = grab;

        console.log(`[PaperFlow] pushModal result: seatState=${grab.get_seat_state()}`);

        // Listen on global stage for key events while modal
        this._keyPressId = global.stage.connect('key-press-event',
            (_actor: Clutter.Actor, event: Clutter.Event) => {
                try {
                    return this._handleKeyPress(event, callbacks);
                } catch (e) {
                    console.error('[PaperFlow] Error in overview key handler:', e);
                    return Clutter.EVENT_PROPAGATE;
                }
            },
        );
    }

    deactivate(): void {
        if (this._keyPressId) {
            global.stage.disconnect(this._keyPressId);
            this._keyPressId = 0;
        }

        if (this._grab) {
            // Defer popModal to avoid re-entrancy issues when called from key handler
            const grab = this._grab;
            this._grab = null;
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                try {
                    Main.popModal(grab);
                } catch (e) {
                    console.error('[PaperFlow] Error in popModal:', e);
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    destroy(): void {
        // Synchronous cleanup for extension disable
        if (this._keyPressId) {
            global.stage.disconnect(this._keyPressId);
            this._keyPressId = 0;
        }
        if (this._grab) {
            try {
                Main.popModal(this._grab);
            } catch (e) {
                console.error('[PaperFlow] Error in destroy popModal:', e);
            }
            this._grab = null;
        }
    }

    private _handleKeyPress(
        event: Clutter.Event,
        callbacks: OverviewInputCallbacks,
    ): typeof Clutter.EVENT_STOP | typeof Clutter.EVENT_PROPAGATE {
        const symbol = event.get_key_symbol();

        switch (symbol) {
            case Clutter.KEY_Left:
                callbacks.onNavigate('left');
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Right:
                callbacks.onNavigate('right');
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Up:
                callbacks.onNavigate('up');
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Down:
                callbacks.onNavigate('down');
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Return:
            case Clutter.KEY_KP_Enter:
                callbacks.onConfirm();
                return Clutter.EVENT_STOP;
            case Clutter.KEY_Escape:
                callbacks.onCancel();
                return Clutter.EVENT_STOP;
            default:
                return Clutter.EVENT_PROPAGATE;
        }
    }
}
