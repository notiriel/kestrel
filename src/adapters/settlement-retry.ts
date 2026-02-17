import type { WindowId } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { computeLayout } from '../domain/layout.js';
import type { WindowPort } from '../ports/window-port.js';
import type { CloneRenderPort } from '../ports/clone-port.js';
import GLib from 'gi://GLib';

export interface SettlementDeps {
    getWorld(): World | null;
    checkGuard(label: string): boolean;
    focusWindow(windowId: WindowId | null): void;
    getWindowAdapter(): WindowPort | null;
    getCloneAdapter(): CloneRenderPort | null;
}

const SETTLEMENT_DELAYS = [100, 150, 200, 300, 400, 500, 750, 1000];

export class SettlementRetry {
    private _deps: SettlementDeps;
    private _timerId: number | null = null;
    private _step: number = 0;

    constructor(deps: SettlementDeps) {
        this._deps = deps;
    }

    start(): void {
        this.cancel();
        this._step = 0;
        this._scheduleNext();
    }

    cancel(): void {
        if (this._timerId !== null) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
    }

    private _scheduleNext(): void {
        if (this._step >= SETTLEMENT_DELAYS.length) return;

        const delay = SETTLEMENT_DELAYS[this._step]!;
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timerId = null;
            try {
                const world = this._deps.getWorld();
                if (!world) return GLib.SOURCE_REMOVE;
                if (!this._deps.checkGuard('settlement')) return GLib.SOURCE_REMOVE;

                this._deps.focusWindow(world.focusedWindow);

                const layout = computeLayout(world);
                this._deps.getWindowAdapter()?.applyLayout(layout, true);
                this._deps.getCloneAdapter()?.applyLayout(layout, false);

                if (!this._deps.getWindowAdapter()?.hasUnsettledWindows()) {
                    return GLib.SOURCE_REMOVE;
                }

                this._step++;
                this._scheduleNext();
            } catch (e) {
                console.error('[PaperFlow] Error in settlement retry:', e);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy(): void {
        this.cancel();
    }
}
