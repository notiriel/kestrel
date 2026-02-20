import type { World } from '../domain/world.js';
import type { PanelIndicatorPort } from '../ports/panel-indicator-port.js';
import type { WindowId } from '../domain/types.js';
import type { ClaudeStatus } from './status-overlay-adapter.js';
import St from 'gi://St';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const STATUS_COLORS: Record<string, string> = {
    'working': '#4CAF50',
    'needs-input': '#F44336',
    'done': '#FF9800',
};

const STATUS_ICONS: Record<string, string> = {
    'working': '\u{1F7E2}',    // 🟢
    'needs-input': '\u{1F534}', // 🔴
    'done': '\u{1F7E0}',       // 🟠
};

export class PanelIndicatorAdapter implements PanelIndicatorPort {
    private _indicator: InstanceType<typeof PanelMenu.Button> | null = null;
    private _label: St.Label | null = null;
    private _statusDot: St.Label | null = null;
    private _switchCallback: ((wsIndex: number) => void) | null = null;
    private _lastWorld: World | null = null;
    private _lastStatusOverlay: { getWindowStatusMap(): ReadonlyMap<WindowId, ClaudeStatus> } | undefined = undefined;

    init(switchCallback: (wsIndex: number) => void): void {
        try {
            this._switchCallback = switchCallback;

            this._indicator = new PanelMenu.Button(0.0, 'PaperFlow', false);

            const box = new St.BoxLayout({ style_class: 'panel-status-indicators-box' });

            this._label = new St.Label({
                text: 'PaperFlow',
                y_align: Clutter.ActorAlign.CENTER,
            });
            box.add_child(this._label);

            this._statusDot = new St.Label({
                text: '',
                y_align: Clutter.ActorAlign.CENTER,
                style: 'padding-left: 4px; font-size: 10px;',
            });
            box.add_child(this._statusDot);

            (this._indicator as any).add_child(box);

            // Lazy menu rebuild: only rebuild when menu is opened
            const menu = (this._indicator as any).menu;
            menu.connect('open-state-changed', (_menu: any, isOpen: boolean) => {
                if (isOpen && this._lastWorld) {
                    this._rebuildMenu(this._lastWorld, this._lastStatusOverlay);
                }
            });

            Main.panel.addToStatusArea('paperflow', this._indicator);
        } catch (e) {
            console.error('[PaperFlow] Error creating panel indicator:', e);
        }
    }

    update(world: World, statusOverlay?: { getWindowStatusMap(): ReadonlyMap<WindowId, ClaudeStatus> }): void {
        try {
            if (!this._indicator || !this._label) return;

            this._lastWorld = world;
            this._lastStatusOverlay = statusOverlay;

            const currentWs = world.workspaces[world.viewport.workspaceIndex];
            const wsName = currentWs?.name ?? `WS ${world.viewport.workspaceIndex + 1}`;
            this._label.text = wsName;

            // Aggregate Claude status for current workspace
            const currentStatus = this._aggregateStatus(world, world.viewport.workspaceIndex, statusOverlay);
            if (this._statusDot) {
                this._statusDot.text = currentStatus ? (STATUS_ICONS[currentStatus] ?? '') : '';
            }
        } catch (e) {
            console.error('[PaperFlow] Error updating panel indicator:', e);
        }
    }

    destroy(): void {
        try {
            if (this._indicator) {
                this._indicator.destroy();
                this._indicator = null;
            }
            this._label = null;
            this._statusDot = null;
            this._switchCallback = null;
            this._lastWorld = null;
            this._lastStatusOverlay = undefined;
        } catch (e) {
            console.error('[PaperFlow] Error destroying panel indicator:', e);
        }
    }

    private _rebuildMenu(world: World, statusOverlay?: { getWindowStatusMap(): ReadonlyMap<WindowId, ClaudeStatus> }): void {
        if (!this._indicator) return;
        const menu = (this._indicator as any).menu as InstanceType<typeof PopupMenu.PopupMenu>;
        menu.removeAll();

        for (let i = 0; i < world.workspaces.length; i++) {
            const ws = world.workspaces[i]!;
            if (ws.windows.length === 0) continue;

            const isCurrent = i === world.viewport.workspaceIndex;
            const name = ws.name ?? `WS ${i + 1}`;
            const claudeStatus = this._aggregateStatus(world, i, statusOverlay);
            const statusIcon = claudeStatus ? ` ${STATUS_ICONS[claudeStatus] ?? ''}` : '';
            const currentMark = isCurrent ? '\u{25CF} ' : '  ';
            const label = `${currentMark}${name}    ${ws.windows.length}${statusIcon}`;

            const item = new PopupMenu.PopupMenuItem(label);
            const wsIndex = i;
            item.connect('activate', () => {
                try {
                    this._switchCallback?.(wsIndex);
                } catch (e) {
                    console.error('[PaperFlow] Error switching workspace from panel:', e);
                }
            });
            menu.addMenuItem(item);
        }
    }

    private _aggregateStatus(
        world: World,
        wsIndex: number,
        statusOverlay?: { getWindowStatusMap(): ReadonlyMap<WindowId, ClaudeStatus> },
    ): ClaudeStatus | null {
        if (!statusOverlay) return null;
        const ws = world.workspaces[wsIndex];
        if (!ws) return null;

        const statusMap = statusOverlay.getWindowStatusMap();
        let best: ClaudeStatus | null = null;
        const priority: Record<string, number> = { 'needs-input': 3, 'working': 2, 'done': 1 };

        for (const win of ws.windows) {
            const status = statusMap.get(win.id);
            if (status && (priority[status] ?? 0) > (priority[best ?? ''] ?? 0)) {
                best = status;
            }
        }
        return best;
    }
}
