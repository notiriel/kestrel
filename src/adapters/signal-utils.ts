/**
 * Safely disconnect a GObject signal, suppressing errors if the object is already destroyed.
 */
export function safeDisconnect(obj: { disconnect(id: number): void }, id: number): void {
    try { obj.disconnect(id); } catch { /* object already destroyed */ }
}
