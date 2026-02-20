import type { MonitorInfo } from '../domain/types.js';
import type { MonitorPort } from '../ports/monitor-port.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class MonitorAdapter implements MonitorPort {
    private _signalId: number | null = null;

    readPrimaryMonitor(): MonitorInfo {
        const monitors = Main.layoutManager.monitors;
        if (!monitors || monitors.length === 0) {
            return { count: 1, totalWidth: 1920, totalHeight: 1080, slotWidth: 960, workAreaY: 0, stageOffsetX: 0 };
        }
        const count = monitors.length;

        // Compute combined geometry across all monitors
        let minX = Infinity;
        let maxX = -Infinity;
        let minHeight = Infinity;

        for (const m of monitors) {
            minX = Math.min(minX, m.x);
            maxX = Math.max(maxX, m.x + m.width);
            minHeight = Math.min(minHeight, m.height);
        }

        const stageOffsetX = minX;
        const totalWidth = maxX - minX;

        // Use primary monitor's work area for panel offset
        const primaryMonitor = Main.layoutManager.primaryMonitor;
        const workArea = primaryMonitor
            ? Main.layoutManager.getWorkAreaForMonitor(primaryMonitor.index)
            : null;

        let workAreaY = 0;
        if (primaryMonitor && workArea) {
            workAreaY = workArea.y - primaryMonitor.y;
        }
        // On some systems (e.g. Parallels VMs), the GNOME panel doesn't create
        // a strut, so workArea.y == monitor.y.  Fall back to reading panel height.
        const panelHeight = Main.panel?.height ?? 0;
        if (workAreaY === 0 && panelHeight > 0) {
            workAreaY = panelHeight;
        }

        const totalHeight = minHeight - workAreaY;
        const slotWidth = Math.floor(totalWidth / (count * 2));

        return { count, totalWidth, totalHeight, slotWidth, workAreaY, stageOffsetX };
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
