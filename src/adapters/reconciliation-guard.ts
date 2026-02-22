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

        this._timestamps = this._timestamps.filter(t => now - t < this._windowMs);
        this._timestamps.push(now);

        const count = this._timestamps.length;

        if (count >= this._hardThreshold) {
            console.error(
                `[Kestrel] CIRCUIT BREAKER: ${count} reconciliations in ${this._windowMs}ms (trigger: ${label}). Blocking for ${this._cooldownMs}ms.`,
            );
            this._cooldownUntil = now + this._cooldownMs;
            this._timestamps = [];
            return false;
        }

        if (count >= this._softThreshold) {
            console.warn(
                `[Kestrel] Loop warning: ${count} reconciliations in ${this._windowMs}ms (trigger: ${label})`,
            );
        }

        return true;
    }

    destroy(): void {
        this._timestamps = [];
        this._cooldownUntil = 0;
    }
}
