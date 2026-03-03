/**
 * Elapsed time formatting — pure TypeScript, no gi:// imports.
 *
 * Converts a millisecond duration into a compact human-readable string.
 */

/**
 * Format elapsed milliseconds into a compact string.
 *
 * - < 1 min: rounded seconds → "30s"
 * - < 10 min: half minutes → "1.5m"
 * - < 1 hr: rounded minutes → "23m"
 * - < 10 hr: half hours → "3.5h"
 * - < 24 hr: rounded hours → "8h"
 * - < 10 days: half days → "2.5d"
 * - ≥ 10 days: rounded days → "12d"
 */
export function formatElapsedTime(elapsedMs: number): string {
    if (elapsedMs < 0) return '0s';

    const seconds = elapsedMs / 1000;
    const minutes = seconds / 60;
    const hours = minutes / 60;
    const days = hours / 24;

    if (minutes < 1) {
        return `${Math.round(seconds)}s`;
    }
    if (minutes < 10) {
        const halfMinutes = Math.round(minutes * 2) / 2;
        return halfMinutes % 1 === 0 ? `${halfMinutes}m` : `${halfMinutes}m`;
    }
    if (hours < 1) {
        return `${Math.round(minutes)}m`;
    }
    if (hours < 10) {
        const halfHours = Math.round(hours * 2) / 2;
        return halfHours % 1 === 0 ? `${halfHours}h` : `${halfHours}h`;
    }
    if (days < 1) {
        return `${Math.round(hours)}h`;
    }
    if (days < 10) {
        const halfDays = Math.round(days * 2) / 2;
        return halfDays % 1 === 0 ? `${halfDays}d` : `${halfDays}d`;
    }
    return `${Math.round(days)}d`;
}
