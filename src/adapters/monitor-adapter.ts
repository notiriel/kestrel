import type { MonitorInfo } from '../domain/types.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class MonitorAdapter {
    private _signalId: number | null = null;

    readPrimaryMonitor(): MonitorInfo {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) {
            return { count: 1, totalWidth: 1920, totalHeight: 1080, slotWidth: 960 };
        }
        const count = Main.layoutManager.monitors.length;
        const totalWidth = monitor.width;
        const totalHeight = monitor.height;
        const slotWidth = Math.floor(totalWidth / (count * 2));
        return { count, totalWidth, totalHeight, slotWidth };
    }

    connectMonitorsChanged(callback: (info: MonitorInfo) => void): void {
        this._signalId = Main.layoutManager.connect('monitors-changed', () => {
            callback(this.readPrimaryMonitor());
        });
    }

    destroy(): void {
        if (this._signalId !== null) {
            Main.layoutManager.disconnect(this._signalId);
            this._signalId = null;
        }
    }
}
