import type { MonitorInfo } from '../domain/types.js';

export interface MonitorPort {
    readPrimaryMonitor(): MonitorInfo;
    connectMonitorsChanged(callback: (info: MonitorInfo) => void): void;
    destroy(): void;
}
