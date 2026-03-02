import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

type OverviewDirection = 'left' | 'right' | 'up' | 'down';

interface OverviewInputCallbacks {
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

const NAVIGATION_KEYS: ReadonlyMap<number, OverviewDirection> = new Map([
    [Clutter.KEY_Left, 'left'],
    [Clutter.KEY_Right, 'right'],
    [Clutter.KEY_Up, 'up'],
    [Clutter.KEY_Down, 'down'],
]);

const BLOCKED_MODS = Clutter.ModifierType.CONTROL_MASK |
    Clutter.ModifierType.MOD1_MASK |
    Clutter.ModifierType.MOD4_MASK;

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

        this._grab = Main.pushModal(global.stage, {
            actionMode: Shell.ActionMode.ALL,
        });
        this._connectKeyPress(callbacks);
        this._connectButtonPress();
        this._connectMotion(callbacks);
        this._connectButtonRelease(callbacks);
    }

    deactivate(): void {
        this._disconnectStageSignals();
        this._resetDragState();
        this._deferPopModal();
    }

    destroy(): void {
        this._disconnectStageSignals();
        this._resetDragState();
        this._syncPopModal();
    }

    private _connectKeyPress(callbacks: OverviewInputCallbacks): void {
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
    }

    private _connectButtonPress(): void {
        this._buttonPressId = global.stage.connect('button-press-event',
            (_actor: Clutter.Actor, event: Clutter.Event) => {
                try {
                    return this._handleButtonPress(event);
                } catch (e) {
                    console.error('[Kestrel] Error in overview press handler:', e);
                    return Clutter.EVENT_PROPAGATE;
                }
            },
        );
    }

    private _connectMotion(callbacks: OverviewInputCallbacks): void {
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
    }

    private _connectButtonRelease(callbacks: OverviewInputCallbacks): void {
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

    private _handleButtonPress(
        event: Clutter.Event,
    ): typeof Clutter.EVENT_STOP | typeof Clutter.EVENT_PROPAGATE {
        if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
        // Ignore Super+click — GNOME eats motion events when Super is held
        if (event.get_state() & Clutter.ModifierType.MOD4_MASK) return Clutter.EVENT_PROPAGATE;
        const [x, y] = event.get_coords();
        this._startX = x;
        this._startY = y;
        this._pendingClick = true;
        this._dragging = false;
        return Clutter.EVENT_STOP;
    }

    private _disconnectStageSignals(): void {
        this._disconnectSignal('_keyPressId');
        this._disconnectSignal('_buttonPressId');
        this._disconnectSignal('_motionId');
        this._disconnectSignal('_buttonReleaseId');
    }

    private _disconnectSignal(field: '_keyPressId' | '_buttonPressId' | '_motionId' | '_buttonReleaseId'): void {
        if (this[field]) {
            global.stage.disconnect(this[field]);
            this[field] = 0;
        }
    }

    private _resetDragState(): void {
        this._pendingClick = false;
        this._dragging = false;
    }

    private _deferPopModal(): void {
        if (!this._grab) return;

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

    private _syncPopModal(): void {
        if (!this._grab) return;

        try {
            Main.popModal(this._grab);
        } catch (e) {
            console.error('[Kestrel] Error in destroy popModal:', e);
        }
        this._grab = null;
    }

    private _checkDragThreshold(x: number, y: number): boolean {
        const dx = x - this._startX;
        const dy = y - this._startY;
        return dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD;
    }

    private _handlePendingMotion(
        x: number, y: number,
        callbacks: OverviewInputCallbacks,
    ): void {
        if (!this._checkDragThreshold(x, y)) return;

        this._pendingClick = false;
        this._dragging = true;
        callbacks.onDragStart?.(this._startX, this._startY);
    }

    private _handleMotion(
        event: Clutter.Event,
        callbacks: OverviewInputCallbacks,
    ): typeof Clutter.EVENT_STOP | typeof Clutter.EVENT_PROPAGATE {
        if (!this._pendingClick && !this._dragging) return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();

        if (this._pendingClick) {
            this._handlePendingMotion(x, y, callbacks);
            return Clutter.EVENT_STOP;
        }

        callbacks.onDragMove?.(x, y);
        return Clutter.EVENT_STOP;
    }

    private _handleButtonRelease(
        event: Clutter.Event,
        callbacks: OverviewInputCallbacks,
    ): typeof Clutter.EVENT_STOP | typeof Clutter.EVENT_PROPAGATE {
        if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;

        if (this._pendingClick) {
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
        if (this._keyPassthrough) {
            return this._handlePassthroughKey(event.get_key_symbol(), callbacks);
        }
        return this._handleNormalKey(event, callbacks);
    }

    private _handleNormalKey(
        event: Clutter.Event,
        callbacks: OverviewInputCallbacks,
    ): typeof Clutter.EVENT_STOP | typeof Clutter.EVENT_PROPAGATE {
        const symbol = event.get_key_symbol();
        const handled = this._handleNavigationKey(symbol, callbacks)
            || this._handleConfirmOrEscape(symbol, callbacks)
            || this._handleEditKey(symbol, event.get_state(), callbacks)
            || this._handlePrintableInput(event, callbacks);
        return handled ? Clutter.EVENT_STOP : Clutter.EVENT_PROPAGATE;
    }

    private _handlePassthroughKey(
        symbol: number,
        callbacks: OverviewInputCallbacks,
    ): typeof Clutter.EVENT_STOP | typeof Clutter.EVENT_PROPAGATE {
        if (symbol === Clutter.KEY_Escape) {
            callbacks.onCancel();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    private _handleNavigationKey(
        symbol: number,
        callbacks: OverviewInputCallbacks,
    ): boolean {
        const direction = NAVIGATION_KEYS.get(symbol);
        if (!direction) return false;

        callbacks.onNavigate(direction);
        return true;
    }

    private _handleConfirmOrEscape(
        symbol: number,
        callbacks: OverviewInputCallbacks,
    ): boolean {
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            callbacks.onConfirm();
            return true;
        }
        if (symbol === Clutter.KEY_Escape) {
            this._resetDragState();
            callbacks.onCancel();
            return true;
        }
        return false;
    }

    private _handleEditKey(
        symbol: number,
        state: number,
        callbacks: OverviewInputCallbacks,
    ): boolean {
        if (symbol === Clutter.KEY_BackSpace) {
            if (callbacks.onBackspace) callbacks.onBackspace();
            return true;
        }
        return this._handleRenameKey(symbol, state, callbacks);
    }

    private _handleRenameKey(
        symbol: number,
        state: number,
        callbacks: OverviewInputCallbacks,
    ): boolean {
        if (symbol !== Clutter.KEY_F2) return false;

        if (callbacks.onRename) callbacks.onRename();
        return true;
    }

    private _isPrintableChar(ch: string): boolean {
        return ch.length > 0 && ch !== '\0' && ch.charCodeAt(0) >= 32;
    }

    private _handlePrintableInput(
        event: Clutter.Event,
        callbacks: OverviewInputCallbacks,
    ): boolean {
        if (event.get_state() & BLOCKED_MODS) return false;

        const ch = event.get_key_unicode();
        if (!ch || !this._isPrintableChar(ch)) return false;

        if (callbacks.onTextInput) callbacks.onTextInput(ch);
        return true;
    }
}
