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
    onClick: (x: number, y: number) => void;
    onDragStart?: (x: number, y: number) => void;
    onDragMove?: (x: number, y: number) => void;
    onDragEnd?: (x: number, y: number) => void;
    onTextInput?: (text: string) => void;
    onBackspace?: () => void;
    onRename?: () => void;
}

const DRAG_THRESHOLD = 16;

/**
 * Modal input capture for overview mode.
 * Connects key-press-event on the global stage while in modal.
 * Arrow keys navigate, Enter confirms, Escape cancels.
 * Mouse: click to select, click+drag to reorder.
 */
export class OverviewInputAdapter {
    private _grab: { ungrab: () => void } | null = null;
    private _keyPressId: number = 0;
    private _buttonPressId: number = 0;
    private _motionId: number = 0;
    private _buttonReleaseId: number = 0;

    // Drag state
    private _pendingClick: boolean = false;
    private _dragging: boolean = false;
    private _startX: number = 0;
    private _startY: number = 0;

    /** When true, only Escape is handled; all other keys propagate (for St.Entry rename). */
    private _keyPassthrough: boolean = false;

    setKeyPassthrough(active: boolean): void {
        this._keyPassthrough = active;
    }

    activate(callbacks: OverviewInputCallbacks): void {
        if (this._grab) return;

        // Push modal — returns a Clutter.Grab in GNOME 45+
        const grab = Main.pushModal(global.stage, {
            actionMode: Shell.ActionMode.ALL,
        });
        this._grab = grab;

        // Listen on global stage for key events while modal
        this._keyPressId = global.stage.connect('key-press-event',
            (_actor: Clutter.Actor, event: Clutter.Event) => {
                try {
                    return this._handleKeyPress(event, callbacks);
                } catch (e) {
                    console.error('[Kestrel] Error in overview key handler:', e);
                    return Clutter.EVENT_PROPAGATE;
                }
            },
        );

        // Listen for mouse button press
        this._buttonPressId = global.stage.connect('button-press-event',
            (_actor: Clutter.Actor, event: Clutter.Event) => {
                try {
                    const button = event.get_button();
                    if (button !== 1) return Clutter.EVENT_PROPAGATE;
                    // Ignore Super+click — GNOME eats motion events when Super is held,
                    // preventing drag threshold from being reached
                    if (event.get_state() & Clutter.ModifierType.MOD4_MASK) return Clutter.EVENT_PROPAGATE;
                    const [x, y] = event.get_coords();
                    this._startX = x;
                    this._startY = y;
                    this._pendingClick = true;
                    this._dragging = false;
                    return Clutter.EVENT_STOP;
                } catch (e) {
                    console.error('[Kestrel] Error in overview press handler:', e);
                    return Clutter.EVENT_PROPAGATE;
                }
            },
        );

        // Listen for mouse motion (drag detection)
        this._motionId = global.stage.connect('motion-event',
            (_actor: Clutter.Actor, event: Clutter.Event) => {
                try {
                    return this._handleMotion(event, callbacks);
                } catch (e) {
                    console.error('[Kestrel] Error in overview motion handler:', e);
                    return Clutter.EVENT_PROPAGATE;
                }
            },
        );

        // Listen for mouse button release
        this._buttonReleaseId = global.stage.connect('button-release-event',
            (_actor: Clutter.Actor, event: Clutter.Event) => {
                try {
                    return this._handleButtonRelease(event, callbacks);
                } catch (e) {
                    console.error('[Kestrel] Error in overview release handler:', e);
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
        if (this._buttonPressId) {
            global.stage.disconnect(this._buttonPressId);
            this._buttonPressId = 0;
        }
        if (this._motionId) {
            global.stage.disconnect(this._motionId);
            this._motionId = 0;
        }
        if (this._buttonReleaseId) {
            global.stage.disconnect(this._buttonReleaseId);
            this._buttonReleaseId = 0;
        }

        this._pendingClick = false;
        this._dragging = false;

        if (this._grab) {
            // Defer popModal to avoid re-entrancy issues when called from key handler
            const grab = this._grab;
            this._grab = null;
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                try {
                    Main.popModal(grab);
                } catch (e) {
                    console.error('[Kestrel] Error in popModal:', e);
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
        if (this._buttonPressId) {
            global.stage.disconnect(this._buttonPressId);
            this._buttonPressId = 0;
        }
        if (this._motionId) {
            global.stage.disconnect(this._motionId);
            this._motionId = 0;
        }
        if (this._buttonReleaseId) {
            global.stage.disconnect(this._buttonReleaseId);
            this._buttonReleaseId = 0;
        }
        this._pendingClick = false;
        this._dragging = false;
        if (this._grab) {
            try {
                Main.popModal(this._grab);
            } catch (e) {
                console.error('[Kestrel] Error in destroy popModal:', e);
            }
            this._grab = null;
        }
    }

    private _handleMotion(
        event: Clutter.Event,
        callbacks: OverviewInputCallbacks,
    ): typeof Clutter.EVENT_STOP | typeof Clutter.EVENT_PROPAGATE {
        if (!this._pendingClick && !this._dragging) return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();

        if (this._pendingClick) {
            const dx = x - this._startX;
            const dy = y - this._startY;
            if (dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
                this._pendingClick = false;
                this._dragging = true;
                callbacks.onDragStart?.(this._startX, this._startY);
            }
            return Clutter.EVENT_STOP;
        }

        if (this._dragging) {
            callbacks.onDragMove?.(x, y);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    private _handleButtonRelease(
        event: Clutter.Event,
        callbacks: OverviewInputCallbacks,
    ): typeof Clutter.EVENT_STOP | typeof Clutter.EVENT_PROPAGATE {
        const button = event.get_button();
        if (button !== 1) return Clutter.EVENT_PROPAGATE;

        if (this._pendingClick) {
            // Never exceeded drag threshold — treat as normal click
            this._pendingClick = false;
            callbacks.onClick(this._startX, this._startY);
            return Clutter.EVENT_STOP;
        }

        if (this._dragging) {
            this._dragging = false;
            const [x, y] = event.get_coords();
            callbacks.onDragEnd?.(x, y);
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    private _handleKeyPress(
        event: Clutter.Event,
        callbacks: OverviewInputCallbacks,
    ): typeof Clutter.EVENT_STOP | typeof Clutter.EVENT_PROPAGATE {
        const symbol = event.get_key_symbol();
        const state = event.get_state();

        // In passthrough mode (rename active), only intercept Escape
        if (this._keyPassthrough) {
            if (symbol === Clutter.KEY_Escape) {
                callbacks.onCancel();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }

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
                if (this._dragging) {
                    // Cancel drag, not the whole overview
                    this._dragging = false;
                    this._pendingClick = false;
                    callbacks.onCancel();
                    return Clutter.EVENT_STOP;
                }
                callbacks.onCancel();
                return Clutter.EVENT_STOP;
            case Clutter.KEY_BackSpace:
                callbacks.onBackspace?.();
                return Clutter.EVENT_STOP;
            case Clutter.KEY_r:
            case Clutter.KEY_R:
                if (state & Clutter.ModifierType.MOD4_MASK) {
                    callbacks.onRename?.();
                    return Clutter.EVENT_STOP;
                }
                break;
            default:
                break;
        }

        // Check for printable character input (no Ctrl/Alt/Super modifiers)
        const blockedMods = Clutter.ModifierType.CONTROL_MASK |
            Clutter.ModifierType.MOD1_MASK |
            Clutter.ModifierType.MOD4_MASK;
        if (!(state & blockedMods)) {
            const ch = event.get_key_unicode();
            if (ch && ch.length > 0 && ch !== '\0' && ch.charCodeAt(0) >= 32) {
                callbacks.onTextInput?.(ch);
                return Clutter.EVENT_STOP;
            }
        }

        return Clutter.EVENT_PROPAGATE;
    }
}
