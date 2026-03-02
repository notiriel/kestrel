import type { WindowId } from '../domain/types.js';
import type { World } from '../domain/world.js';
import type { OverviewTransform } from '../ports/clone-port.js';
import { safeDisconnect } from './signal-utils.js';
import { buildStatusIcon, buildStatusStyle, STATUS_COLORS } from '../ui-components/status-badge-builders.js';
import { computeStatusBadgeScenes, type StatusBadgeScene } from '../domain/notification-scene.js';
import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';

import type { ClaudeStatus } from '../domain/notification-types.js';

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
            overlay.style = buildStatusStyle(validStatus);
        }
    }

    enterOverview(
        transform: OverviewTransform,
        clonePositions: Map<WindowId, ClonePosition>,
    ): void {
        const badges = this._computeBadges(transform, clonePositions);
        for (const badge of badges) {
            this._applyBadgeScene(badge);
        }
    }

    private _computeBadges(transform: OverviewTransform, clonePositions: Map<WindowId, ClonePosition>): readonly StatusBadgeScene[] {
        if (!this._layer || !this._iconGFile) return [];
        const world = this._getWorld?.();
        if (!world) return [];
        return computeStatusBadgeScenes(world.notificationState, clonePositions, transform, this._layer.height);
    }

    private _applyBadgeScene(badge: StatusBadgeScene): void {
        const overlay = this._getOrCreateOverlay(badge.windowId, badge.status);
        overlay.set_position(badge.x, badge.y);
        overlay.set_size(badge.size, badge.size);
        overlay.visible = badge.visible;
    }

    private _getOrCreateOverlay(windowId: WindowId, status: ClaudeStatus): St.Icon {
        let overlay = this._overlays.get(windowId);
        if (!overlay) {
            overlay = buildStatusIcon(this._iconGFile!, status);
            this._layer!.add_child(overlay);
            this._overlays.set(windowId, overlay);
        } else {
            overlay.style = buildStatusStyle(status);
        }
        return overlay;
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
