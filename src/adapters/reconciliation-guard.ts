export class ReconciliationGuard {
    private _timestamps: number[] = [];
    private _softThreshold: number;
    private _hardThreshold: number;
    private _windowMs: number;
    private _cooldownUntil = 0;
    private _cooldownMs: number;

    constructor(
        softThreshold = 10,
        hardThreshold = 20,
        windowMs = 500,
        cooldownMs = 1000,
    ) {
        this._softThreshold = softThreshold;
        this._hardThreshold = hardThreshold;
        this._windowMs = windowMs;
        this._cooldownMs = cooldownMs;
    }

    /**
     * Call at the start of every reconciliation handler.
     * Returns true if safe to proceed, false if circuit breaker tripped.
     */
    check(label: string): boolean {
        const now = Date.now();
        if (now < this._cooldownUntil) return false;

        const count = this._pruneAndRecord(now);

        if (count >= this._hardThreshold) {
            this._tripCircuitBreaker(now, count, label);
            return false;
        }

        if (count >= this._softThreshold) {
            console.warn(
                `[Kestrel] Loop warning: ${count} reconciliations in ${this._windowMs}ms (trigger: ${label})`,
            );
        }

        return true;
    }

    private _pruneAndRecord(now: number): number {
        this._timestamps = this._timestamps.filter(t => now - t < this._windowMs);
        this._timestamps.push(now);
        return this._timestamps.length;
    }

    private _tripCircuitBreaker(now: number, count: number, label: string): void {
        console.error(
            `[Kestrel] CIRCUIT BREAKER: ${count} reconciliations in ${this._windowMs}ms (trigger: ${label}). Blocking for ${this._cooldownMs}ms.`,
        );
        this._cooldownUntil = now + this._cooldownMs;
        this._timestamps = [];
    }

    destroy(): void {
        this._timestamps = [];
        this._cooldownUntil = 0;
    }
}
