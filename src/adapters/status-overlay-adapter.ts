import type { WindowId } from '../domain/types.js';
import type { OverviewTransform } from '../ports/clone-port.js';
import { safeDisconnect } from './signal-utils.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

export type ClaudeStatus = 'working' | 'needs-input' | 'done';

const STATUS_COLORS: Record<ClaudeStatus, string> = {
    'working': '#4CAF50',
    'needs-input': '#F44336',
    'done': '#FF9800',
};

const ICON_SIZE = 75;
const ICON_PADDING = 10;
const PROBE_PATTERN = /^paper_flow_probe_(.+)$/;

interface TitleSignalEntry {
    metaWindow: { disconnect(id: number): void; get_title(): string | null };
    signalId: number;
}

interface ClonePosition {
    x: number;
    y: number;
    width: number;
    height: number;
    wsIndex: number;
}

export class StatusOverlayAdapter {
    private _sessionToWindowId: Map<string, WindowId> = new Map();
    private _windowStatus: Map<WindowId, ClaudeStatus> = new Map();
    private _overlays: Map<WindowId, St.Icon> = new Map();
    private _titleSignals: Map<WindowId, TitleSignalEntry> = new Map();
    private _layer: Clutter.Actor | null = null;
    private _iconGFile: Gio.File | null = null;
    private _overviewActive: boolean = false;

    init(layer: Clutter.Actor, extensionDataDir: string): void {
        this._layer = layer;
        this._iconGFile = Gio.File.new_for_path(`${extensionDataDir}/claude-logo-symbolic.svg`);
    }

    watchWindow(windowId: WindowId, metaWindow: { connect(signal: string, cb: () => void): number; disconnect(id: number): void; get_title(): string | null }): void {
        const signalId = metaWindow.connect('notify::title', () => {
            try {
                this._onTitleChanged(windowId, metaWindow);
            } catch (e) {
                console.error('[PaperFlow] Error in title change handler:', e);
            }
        });
        this._titleSignals.set(windowId, { metaWindow, signalId });

        // Check current title immediately in case it's already a probe
        this._onTitleChanged(windowId, metaWindow);
    }

    unwatchWindow(windowId: WindowId): void {
        const entry = this._titleSignals.get(windowId);
        if (entry) {
            safeDisconnect(entry.metaWindow, entry.signalId);
            this._titleSignals.delete(windowId);
        }

        // Clean up session→window mappings that point to this window
        for (const [sessionId, wId] of this._sessionToWindowId) {
            if (wId === windowId) {
                this._sessionToWindowId.delete(sessionId);
            }
        }

        this._windowStatus.delete(windowId);

        const overlay = this._overlays.get(windowId);
        if (overlay) {
            overlay.destroy();
            this._overlays.delete(windowId);
        }
    }

    setWindowStatus(sessionId: string, status: string): void {
        const windowId = this._sessionToWindowId.get(sessionId);
        if (!windowId) {
            console.log(`[PaperFlow] setWindowStatus: unknown session ${sessionId}`);
            return;
        }

        if (status === 'end') {
            this._sessionToWindowId.delete(sessionId);
            this._windowStatus.delete(windowId);
            const overlay = this._overlays.get(windowId);
            if (overlay) {
                overlay.destroy();
                this._overlays.delete(windowId);
            }
            return;
        }

        const validStatus = status as ClaudeStatus;
        if (!STATUS_COLORS[validStatus]) {
            console.log(`[PaperFlow] setWindowStatus: unknown status ${status}`);
            return;
        }

        this._windowStatus.set(windowId, validStatus);

        // If overview is active, update overlay color immediately
        const overlay = this._overlays.get(windowId);
        if (overlay && this._overviewActive) {
            overlay.style = `color: ${STATUS_COLORS[validStatus]}; -st-icon-style: symbolic;`;
        }
    }

    /** Look up which window a Claude session is running in. */
    getWindowForSession(sessionId: string): WindowId | null {
        return this._sessionToWindowId.get(sessionId) ?? null;
    }

    /** Get a read-only view of windowId → ClaudeStatus for aggregation. */
    getWindowStatusMap(): ReadonlyMap<WindowId, ClaudeStatus> {
        return this._windowStatus;
    }

    enterOverview(
        transform: OverviewTransform,
        clonePositions: Map<WindowId, ClonePosition>,
    ): void {
        if (!this._layer || !this._iconGFile) return;
        this._overviewActive = true;

        const { scale, offsetX, offsetY } = transform;

        for (const [windowId, status] of this._windowStatus) {
            const pos = clonePositions.get(windowId);
            if (!pos) continue;

            let overlay = this._overlays.get(windowId);
            if (!overlay) {
                const gicon = new Gio.FileIcon({ file: this._iconGFile });
                overlay = new St.Icon({
                    gicon: gicon as any,
                    icon_size: ICON_SIZE,
                    style: `color: ${STATUS_COLORS[status]}; -st-icon-style: symbolic;`,
                    reactive: false,
                });
                this._layer.add_child(overlay);
                this._overlays.set(windowId, overlay);
            } else {
                overlay.style = `color: ${STATUS_COLORS[status]}; -st-icon-style: symbolic;`;
            }

            // Position at top-right of the clone in overview coordinates
            const x = (pos.x + pos.width - ICON_SIZE - ICON_PADDING) * scale + offsetX;
            const y = (pos.wsIndex * this._layer.height + pos.y + ICON_PADDING) * scale + offsetY;

            overlay.set_position(Math.round(x), Math.round(y));
            overlay.set_size(Math.round(ICON_SIZE * scale), Math.round(ICON_SIZE * scale));
            overlay.visible = true;
        }
    }

    exitOverview(): void {
        this._overviewActive = false;
        for (const overlay of this._overlays.values()) {
            overlay.visible = false;
        }
    }

    destroy(): void {
        for (const entry of this._titleSignals.values()) {
            safeDisconnect(entry.metaWindow, entry.signalId);
        }
        this._titleSignals.clear();

        for (const overlay of this._overlays.values()) {
            overlay.destroy();
        }
        this._overlays.clear();

        this._sessionToWindowId.clear();
        this._windowStatus.clear();
        this._layer = null;
        this._iconGFile = null;
    }

    private _onTitleChanged(windowId: WindowId, metaWindow: { get_title(): string | null }): void {
        const title = metaWindow.get_title();
        if (!title) return;

        const match = PROBE_PATTERN.exec(title);
        if (match) {
            const sessionId = match[1]!;
            this._sessionToWindowId.set(sessionId, windowId);
            if (!this._windowStatus.has(windowId)) {
                this._windowStatus.set(windowId, 'done');
            }
        }
    }
}
