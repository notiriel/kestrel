import type { MonitorInfo } from '../../domain/world/types.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export class MonitorAdapter {
    private _signalId: number | null = null;

    readPrimaryMonitor(columnCount: number): MonitorInfo {
        const monitors = Main.layoutManager.monitors;
        if (!monitors || monitors.length === 0) {
            return { count: 1, totalWidth: 1920, totalHeight: 1080, slotWidth: Math.floor(1920 / columnCount), workAreaY: 0, stageOffsetX: 0 };
        }

        const count = monitors.length;
        const { stageOffsetX, totalWidth, minHeight } = this._computeMonitorBounds(monitors);
        const workAreaY = this._computeWorkAreaY();
        const totalHeight = minHeight - workAreaY;
        const slotWidth = Math.floor(totalWidth / columnCount);

        return { count, totalWidth, totalHeight, slotWidth, workAreaY, stageOffsetX };
    }

    private _computeMonitorBounds(monitors: Array<{x: number; width: number; height: number}>): { stageOffsetX: number; totalWidth: number; minHeight: number } {
        let minX = Infinity;
        let maxX = -Infinity;
        let minHeight = Infinity;

        for (const m of monitors) {
            minX = Math.min(minX, m.x);
            maxX = Math.max(maxX, m.x + m.width);
            minHeight = Math.min(minHeight, m.height);
        }

        return { stageOffsetX: minX, totalWidth: maxX - minX, minHeight };
    }

    private _computeWorkAreaY(): number {
        const primaryMonitor = Main.layoutManager.primaryMonitor;
        const workArea = primaryMonitor
            ? Main.layoutManager.getWorkAreaForMonitor(primaryMonitor.index)
            : null;

        const offset = this._getWorkAreaOffset(primaryMonitor, workArea);
        return offset > 0 ? offset : (Main.panel?.height ?? 0);
    }

    private _getWorkAreaOffset(
        primaryMonitor: { y: number } | null,
        workArea: { y: number } | null,
    ): number {
        if (primaryMonitor && workArea) {
            return workArea.y - primaryMonitor.y;
        }
        return 0;
    }

    connectMonitorsChanged(columnCount: number, callback: (info: MonitorInfo) => void): void {
        this._signalId = Main.layoutManager.connect('monitors-changed', () => {
            callback(this.readPrimaryMonitor(columnCount));
        });
    }

    destroy(): void {
        if (this._signalId !== null) {
            Main.layoutManager.disconnect(this._signalId);
            this._signalId = null;
        }
    }
}
