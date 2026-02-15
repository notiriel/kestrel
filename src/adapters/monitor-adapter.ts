import type { MonitorInfo } from '../domain/types.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class MonitorAdapter {
    private _signalId: number | null = null;

    readPrimaryMonitor(): MonitorInfo {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) {
            return { count: 1, totalWidth: 1920, totalHeight: 1080, slotWidth: 960, workAreaY: 0 };
        }
        const count = Main.layoutManager.monitors.length;
        const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
        const totalWidth = monitor.width;
        // On some systems (e.g. Parallels VMs), the GNOME panel doesn't create
        // a strut, so workArea.y == monitor.y.  Fall back to reading panel height.
        let workAreaY = workArea.y - monitor.y;
        const panelHeight = Main.panel?.height ?? 0;
        if (workAreaY === 0 && panelHeight > 0) {
            workAreaY = panelHeight;
        }
        const totalHeight = monitor.height - workAreaY;
        const slotWidth = Math.floor(totalWidth / (count * 2));
        console.log(`[PaperFlow] monitor: monitor(${monitor.x},${monitor.y},${monitor.width}x${monitor.height}) workArea(${workArea.x},${workArea.y},${workArea.width}x${workArea.height}) → totalWidth=${totalWidth} totalHeight=${totalHeight} slotWidth=${slotWidth} workAreaY=${workAreaY}`);
        return { count, totalWidth, totalHeight, slotWidth, workAreaY };
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
