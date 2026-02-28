import type { WindowId } from '../domain/types.js';
import type { World } from '../domain/world.js';
import type { OverviewTransform } from '../ports/clone-port.js';
import { safeDisconnect } from './signal-utils.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import type { ClaudeStatus } from '../domain/notification-types.js';

const STATUS_COLORS: Record<ClaudeStatus, string> = {
    'working': '#4CAF50',
    'needs-input': '#F44336',
    'done': '#FF9800',
};

const ICON_SIZE = 75;
const ICON_PADDING = 10;
const PROBE_PATTERN = /^kestrel_probe_(.+)$/;

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
    private _overlays: Map<WindowId, St.Icon> = new Map();
    private _titleSignals: Map<WindowId, TitleSignalEntry> = new Map();
    private _layer: Clutter.Actor | null = null;
    private _iconGFile: Gio.File | null = null;
    private _getWorld: (() => World | null) | null = null;

    /** Callback invoked when a probe title is detected. Coordinator registers in domain. */
    onProbeDetected: ((sessionId: string, windowId: WindowId) => void) | null = null;

    init(layer: Clutter.Actor, extensionDataDir: string, getWorld: () => World | null): void {
        this._layer = layer;
        this._iconGFile = Gio.File.new_for_path(`${extensionDataDir}/claude-logo-symbolic.svg`);
        this._getWorld = getWorld;
    }

    watchWindow(windowId: WindowId, metaWindow: { connect(signal: string, cb: () => void): number; disconnect(id: number): void; get_title(): string | null }): void {
        const signalId = metaWindow.connect('notify::title', () => {
            try {
                this._onTitleChanged(windowId, metaWindow);
            } catch (e) {
                console.error('[Kestrel] Error in title change handler:', e);
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

        const overlay = this._overlays.get(windowId);
        if (overlay) {
            overlay.destroy();
            this._overlays.delete(windowId);
        }
    }

    setWindowStatus(sessionId: string, status: string): void {
        const world = this._getWorld?.();
        if (!world) return;

        const windowId = world.notificationState.sessionWindows.get(sessionId);
        if (!windowId) {
            console.log(`[Kestrel] setWindowStatus: unknown session ${sessionId}`);
            return;
        }

        if (status === 'end') {
            this._clearOverlay(windowId);
            return;
        }

        this._applyOverlayStatus(windowId, status);
    }

    private _clearOverlay(windowId: WindowId): void {
        const overlay = this._overlays.get(windowId);
        if (overlay) {
            overlay.destroy();
            this._overlays.delete(windowId);
        }
    }

    private _applyOverlayStatus(windowId: WindowId, status: string): void {
        const validStatus = status as ClaudeStatus;
        if (!STATUS_COLORS[validStatus]) {
            console.log(`[Kestrel] setWindowStatus: unknown status ${status}`);
            return;
        }

        const overlay = this._overlays.get(windowId);
        if (overlay) {
            overlay.style = `color: ${STATUS_COLORS[validStatus]}; -st-icon-style: symbolic;`;
        }
    }

    enterOverview(
        transform: OverviewTransform,
        clonePositions: Map<WindowId, ClonePosition>,
    ): void {
        if (!this._layer || !this._iconGFile) return;
        const statuses = this._getWorldStatuses();
        if (!statuses) return;

        for (const [windowId, status] of statuses) {
            this._showStatusOverlay(windowId, status, clonePositions, transform);
        }
    }

    private _getWorldStatuses(): ReadonlyMap<WindowId, ClaudeStatus> | null {
        return this._getWorld?.()?.notificationState.windowStatuses ?? null;
    }

    private _showStatusOverlay(
        windowId: WindowId, status: ClaudeStatus,
        clonePositions: Map<WindowId, ClonePosition>,
        transform: OverviewTransform,
    ): void {
        const pos = clonePositions.get(windowId);
        if (!pos) return;
        const overlay = this._getOrCreateOverlay(windowId, status);
        this._positionOverlay(overlay, pos, transform);
    }

    private _getOrCreateOverlay(windowId: WindowId, status: ClaudeStatus): St.Icon {
        let overlay = this._overlays.get(windowId);
        if (!overlay) {
            const gicon = new Gio.FileIcon({ file: this._iconGFile! });
            overlay = new St.Icon({
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                gicon: gicon as any,
                icon_size: ICON_SIZE,
                style: `color: ${STATUS_COLORS[status]}; -st-icon-style: symbolic;`,
                reactive: false,
            });
            this._layer!.add_child(overlay);
            this._overlays.set(windowId, overlay);
        } else {
            overlay.style = `color: ${STATUS_COLORS[status]}; -st-icon-style: symbolic;`;
        }
        return overlay;
    }

    private _positionOverlay(overlay: St.Icon, pos: ClonePosition, transform: OverviewTransform): void {
        const { scale, offsetX, offsetY } = transform;
        const x = (pos.x + pos.width - ICON_SIZE - ICON_PADDING) * scale + offsetX;
        const y = (pos.wsIndex * this._layer!.height + pos.y + ICON_PADDING) * scale + offsetY;

        overlay.set_position(Math.round(x), Math.round(y));
        overlay.set_size(Math.round(ICON_SIZE * scale), Math.round(ICON_SIZE * scale));
        overlay.visible = true;
    }

    exitOverview(): void {
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

        this._layer = null;
        this._iconGFile = null;
        this._getWorld = null;
    }

    private _onTitleChanged(windowId: WindowId, metaWindow: { get_title(): string | null }): void {
        const title = metaWindow.get_title();
        if (!title) return;

        const match = PROBE_PATTERN.exec(title);
        if (match) {
            const sessionId = match[1]!;
            // Notify coordinator to register in domain
            this.onProbeDetected?.(sessionId, windowId);
        }
    }
}
