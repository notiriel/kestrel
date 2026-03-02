import type { World } from '../../domain/world.js';
import { allWindows } from '../../domain/workspace.js';
import type { PanelIndicatorPort } from '../../ports/panel-indicator-port.js';
import type { ClaudeStatus } from '../../domain/notification-types.js';
import { STATUS_ICONS, buildIndicatorBox } from '../../ui-components/panel-indicator-builders.js';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

export class PanelIndicatorAdapter implements PanelIndicatorPort {
    private _indicator: InstanceType<typeof PanelMenu.Button> | null = null;
    private _label: St.Label | null = null;
    private _statusDot: St.Label | null = null;
    private _switchCallback: ((wsIndex: number) => void) | null = null;
    private _lastWorld: World | null = null;

    init(switchCallback: (wsIndex: number) => void): void {
        try {
            this._switchCallback = switchCallback;
            this._indicator = new PanelMenu.Button(0.0, 'Kestrel', false);

            this._buildIndicatorBox();
            this._connectMenuRebuild();

            Main.panel.addToStatusArea('kestrel', this._indicator);
        } catch (e) {
            console.error('[Kestrel] Error creating panel indicator:', e);
        }
    }

    private _buildIndicatorBox(): void {
        const { box, label, statusDot } = buildIndicatorBox();
        this._label = label;
        this._statusDot = statusDot;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (this._indicator as any).add_child(box);
    }

    private _connectMenuRebuild(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const menu = (this._indicator as any).menu;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        menu.connect('open-state-changed', (_menu: any, isOpen: boolean) => {
            if (isOpen && this._lastWorld) {
                this._rebuildMenu(this._lastWorld);
            }
        });
    }

    update(world: World): void {
        try {
            if (!this._indicator || !this._label) return;
            this._lastWorld = world;

            this._updateLabel(world);
            this._updateStatusDot(world);
        } catch (e) {
            console.error('[Kestrel] Error updating panel indicator:', e);
        }
    }

    private _updateLabel(world: World): void {
        const currentWs = world.workspaces[world.viewport.workspaceIndex];
        this._label!.text = currentWs?.name ?? `WS ${world.viewport.workspaceIndex + 1}`;
    }

    private _updateStatusDot(world: World): void {
        if (!this._statusDot) return;
        const currentStatus = this._aggregateStatus(world, world.viewport.workspaceIndex);
        this._statusDot.text = currentStatus ? (STATUS_ICONS[currentStatus] ?? '') : '';
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
        } catch (e) {
            console.error('[Kestrel] Error destroying panel indicator:', e);
        }
    }

    private _rebuildMenu(world: World): void {
        if (!this._indicator) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const menu = (this._indicator as any).menu as InstanceType<typeof PopupMenu.PopupMenu>;
        menu.removeAll();

        for (let i = 0; i < world.workspaces.length; i++) {
            const ws = world.workspaces[i]!;
            if (ws.columns.length === 0) continue;
            this._addWorkspaceMenuItem(menu, world, ws, i);
        }
    }

    private _addWorkspaceMenuItem(
        menu: InstanceType<typeof PopupMenu.PopupMenu>, world: World,
        ws: World['workspaces'][number], wsIndex: number,
    ): void {
        const isCurrent = wsIndex === world.viewport.workspaceIndex;
        const name = ws.name ?? `WS ${wsIndex + 1}`;
        const claudeStatus = this._aggregateStatus(world, wsIndex);
        const statusIcon = claudeStatus ? ` ${STATUS_ICONS[claudeStatus] ?? ''}` : '';
        const currentMark = isCurrent ? '\u{25CF} ' : '  ';
        const label = `${currentMark}${name}    ${allWindows(ws).length}${statusIcon}`;

        const item = new PopupMenu.PopupMenuItem(label);
        item.connect('activate', () => {
            try { this._switchCallback?.(wsIndex); }
            catch (e) { console.error('[Kestrel] Error switching workspace from panel:', e); }
        });
        menu.addMenuItem(item);
    }

    private _aggregateStatus(
        world: World,
        wsIndex: number,
    ): ClaudeStatus | null {
        const ws = world.workspaces[wsIndex];
        if (!ws) return null;

        const statusMap = world.notificationState.windowStatuses;
        const statuses = allWindows(ws).map(w => statusMap.get(w.id)).filter(Boolean) as ClaudeStatus[];
        return this._highestPriority(statuses);
    }

    private _highestPriority(statuses: ClaudeStatus[]): ClaudeStatus | null {
        const priority: Record<string, number> = { 'needs-input': 3, 'working': 2, 'done': 1 };
        let best: ClaudeStatus | null = null;
        let bestPriority = 0;
        for (const s of statuses) {
            const p = priority[s] ?? 0;
            if (p > bestPriority) { best = s; bestPriority = p; }
        }
        return best;
    }
}
