import type { WindowId } from '../../domain/world/types.js';
import type { World } from '../../domain/world/world.js';
import type { OverviewTransform } from '../../ports/clone-port.js';
import { safeDisconnect } from '../signal-utils.js';
import { buildStatusPill, updateStatusPill } from '../../ui-components/status-badge-builders.js';
import { computeStatusBadgeScenes, type StatusBadgeScene } from '../../domain/scene/notification-scene.js';
import { formatElapsedTime } from '../../domain/elapsed-time.js';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';

import type { ClaudeStatus } from '../../domain/world/notification-types.js';

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
    private _pills: Map<WindowId, St.BoxLayout> = new Map();
    private _titleSignals: Map<WindowId, TitleSignalEntry> = new Map();
    private _layer: Clutter.Actor | null = null;
    private _getWorld: (() => World | null) | null = null;
    private _refreshTimerId: number | null = null;
    private _overviewTransform: OverviewTransform | null = null;
    private _overviewPositions: Map<WindowId, ClonePosition> | null = null;

    /** Callback invoked when a probe title is detected. Coordinator registers in domain. */
    onProbeDetected: ((sessionId: string, windowId: WindowId) => void) | null = null;

    init(layer: Clutter.Actor, _extensionDataDir: string, getWorld: () => World | null): void {
        this._layer = layer;
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
        this._clearOverlay(windowId);
    }

    private _clearOverlay(windowId: WindowId): void {
        const pill = this._pills.get(windowId);
        if (pill) {
            pill.destroy();
            this._pills.delete(windowId);
        }
    }

    enterOverview(
        transform: OverviewTransform,
        clonePositions: Map<WindowId, ClonePosition>,
    ): void {
        this._overviewTransform = transform;
        this._overviewPositions = clonePositions;
        this._refreshBadges();
        this._startRefreshTimer();
    }

    private _computeBadges(transform: OverviewTransform, clonePositions: Map<WindowId, ClonePosition>): readonly StatusBadgeScene[] {
        if (!this._layer) return [];
        const world = this._getWorld?.();
        if (!world) return [];
        return computeStatusBadgeScenes(world.notificationState, clonePositions, transform, this._layer.height);
    }

    private _applyBadgeScene(badge: StatusBadgeScene): void {
        const pill = this._getOrCreatePill(badge.windowId, badge.status);
        const elapsed = this._getElapsedText(badge.windowId);
        updateStatusPill(pill, badge.status, badge.message, elapsed);
        // Position pill so its top-center is at the scene's (x, y)
        const [, naturalWidth] = pill.get_preferred_width(-1);
        pill.set_position(badge.x - Math.round(naturalWidth / 2), badge.y);
        pill.visible = badge.visible;
    }

    private _getStatusTimestamp(windowId: WindowId): number | undefined {
        const world = this._getWorld?.();
        return world?.notificationState.windowStatusTimestamps.get(windowId);
    }

    private _getElapsedText(windowId: WindowId): string {
        const timestamp = this._getStatusTimestamp(windowId);
        if (!timestamp) return '';
        return formatElapsedTime(Date.now() - timestamp);
    }

    private _getOrCreatePill(windowId: WindowId, status: ClaudeStatus): St.BoxLayout {
        let pill = this._pills.get(windowId);
        if (!pill) {
            pill = buildStatusPill(status);
            this._layer!.add_child(pill);
            this._pills.set(windowId, pill);
        }
        return pill;
    }

    private _refreshBadges(): void {
        if (!this._overviewTransform || !this._overviewPositions) return;
        const badges = this._computeBadges(this._overviewTransform, this._overviewPositions);
        for (const badge of badges) {
            this._applyBadgeScene(badge);
        }
    }

    private _startRefreshTimer(): void {
        this._stopRefreshTimer();
        this._refreshTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            try {
                this._refreshBadges();
            } catch (e) {
                console.error('[Kestrel] Error refreshing badges:', e);
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    private _stopRefreshTimer(): void {
        if (this._refreshTimerId !== null) {
            GLib.source_remove(this._refreshTimerId);
            this._refreshTimerId = null;
        }
    }

    exitOverview(): void {
        this._stopRefreshTimer();
        this._overviewTransform = null;
        this._overviewPositions = null;
        for (const pill of this._pills.values()) {
            pill.visible = false;
        }
    }

    destroy(): void {
        this._stopRefreshTimer();
        for (const entry of this._titleSignals.values()) {
            safeDisconnect(entry.metaWindow, entry.signalId);
        }
        this._titleSignals.clear();
        for (const pill of this._pills.values()) pill.destroy();
        this._pills.clear();
        this._layer = null;
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
