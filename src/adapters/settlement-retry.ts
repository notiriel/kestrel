import type { WorldUpdate } from '../domain/world/types.js';
import type { World } from '../domain/world/world.js';
import { buildUpdate } from '../domain/world/world.js';
import type { WindowPort } from '../ports/window-port.js';
import type { SceneApplyOptions } from './world-holder.js';
import GLib from 'gi://GLib';

interface SettlementDeps {
    getWorld(): World | null;
    checkGuard(label: string): boolean;
    getWindowAdapter(): WindowPort | null;
    applyUpdate(update: WorldUpdate, options: SceneApplyOptions): void;
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
                this._performSettlement();
            } catch (e) {
                console.error('[Kestrel] Error in settlement retry:', e);
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    private _performSettlement(): void {
        const world = this._deps.getWorld();
        if (!world) return;
        if (!this._deps.checkGuard('settlement')) return;

        this._deps.applyUpdate(buildUpdate(world), { animate: false, nudgeUnsettled: true });

        if (this._deps.getWindowAdapter()?.hasUnsettledWindows()) {
            this._step++;
            this._scheduleNext();
        }
    }

    destroy(): void {
        this.cancel();
    }
}
