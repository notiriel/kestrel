import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

interface MouseInputDeps {
    getWorld(): { overviewActive: boolean } | null;
    isOverviewActive(): boolean;
    onScrollHorizontal(direction: 'left' | 'right'): void;
    onScrollVertical(direction: 'up' | 'down'): void;
}

/**
 * Super+Scroll handler for normal (non-overview) mode.
 * Discrete scroll: each click triggers one navigation.
 * Smooth scroll (trackpad): accumulates dx/dy independently, fires at threshold 1.0.
 */
export class MouseInputAdapter {
    private _deps: MouseInputDeps;
    private _scrollId: number = 0;
    private _smoothDx: number = 0;
    private _smoothDy: number = 0;
    private _idleResetId: number = 0;
    private _active: boolean = false;

    constructor(deps: MouseInputDeps) {
        this._deps = deps;
    }

    activate(): void {
        if (this._active) return;
        this._active = true;

        this._scrollId = global.stage.connect('scroll-event',
            (_actor: Clutter.Actor, event: Clutter.Event) => {
                try {
                    return this._handleScroll(event);
                } catch (e) {
                    console.error('[Kestrel] Error in scroll handler:', e);
                    return Clutter.EVENT_PROPAGATE;
                }
            },
        );
    }

    deactivate(): void {
        if (!this._active) return;
        this._active = false;

        if (this._scrollId) {
            global.stage.disconnect(this._scrollId);
            this._scrollId = 0;
        }
        this._resetAccumulators();
    }

    destroy(): void {
        this.deactivate();
    }

    private _handleScroll(event: Clutter.Event): typeof Clutter.EVENT_STOP | typeof Clutter.EVENT_PROPAGATE {
        // Only handle when Super is held
        const state = event.get_state();
        if (!(state & Clutter.ModifierType.MOD4_MASK)) {
            return Clutter.EVENT_PROPAGATE;
        }

        // Don't handle during overview
        if (this._deps.isOverviewActive()) {
            return Clutter.EVENT_PROPAGATE;
        }

        const world = this._deps.getWorld();
        if (!world) return Clutter.EVENT_PROPAGATE;

        const direction = event.get_scroll_direction();

        if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            this._handleSmoothScroll(dx, dy);
        } else {
            this._handleDiscreteScroll(direction);
        }

        return Clutter.EVENT_STOP;
    }

    private _handleDiscreteScroll(direction: Clutter.ScrollDirection): void {
        switch (direction) {
            case Clutter.ScrollDirection.UP:
                this._deps.onScrollVertical('down');
                break;
            case Clutter.ScrollDirection.DOWN:
                this._deps.onScrollVertical('up');
                break;
            case Clutter.ScrollDirection.LEFT:
                this._deps.onScrollHorizontal('right');
                break;
            case Clutter.ScrollDirection.RIGHT:
                this._deps.onScrollHorizontal('left');
                break;
        }
    }

    private _handleSmoothScroll(dx: number, dy: number): void {
        this._smoothDx += dx;
        this._smoothDy += dy;

        this._smoothDx = this._drainAxis(this._smoothDx,
            () => this._deps.onScrollHorizontal('left'),
            () => this._deps.onScrollHorizontal('right'));

        this._smoothDy = this._drainAxis(this._smoothDy,
            () => this._deps.onScrollVertical('up'),
            () => this._deps.onScrollVertical('down'));

        this._scheduleIdleReset();
    }

    private _drainAxis(value: number, onPositive: () => void, onNegative: () => void): number {
        while (Math.abs(value) >= 1.0) {
            if (value > 0) {
                onPositive();
                value -= 1.0;
            } else {
                onNegative();
                value += 1.0;
            }
        }
        return value;
    }

    private _scheduleIdleReset(): void {
        if (this._idleResetId) {
            GLib.source_remove(this._idleResetId);
            this._idleResetId = 0;
        }
        this._idleResetId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
            this._smoothDx = 0;
            this._smoothDy = 0;
            this._idleResetId = 0;
            return GLib.SOURCE_REMOVE;
        });
    }

    private _resetAccumulators(): void {
        this._smoothDx = 0;
        this._smoothDy = 0;
        if (this._idleResetId) {
            GLib.source_remove(this._idleResetId);
            this._idleResetId = 0;
        }
    }
}
