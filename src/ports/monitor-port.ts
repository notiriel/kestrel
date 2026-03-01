import type { MonitorInfo } from '../domain/types.js';

export interface MonitorPort {
    readPrimaryMonitor(columnCount: number): MonitorInfo;
    connectMonitorsChanged(columnCount: number, callback: (info: MonitorInfo) => void): void;
    destroy(): void;
}
