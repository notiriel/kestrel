import type { WindowId } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { workspaceNameForWindow } from '../domain/world.js';
import type { ClaudeStatus } from '../domain/notification-types.js';
import { classifyPermissionPayload, parseAllowResponse } from '../domain/notification.js';
import type { OverviewTransform } from '../ports/clone-port.js';
import { StatusOverlayAdapter } from './status-overlay-adapter.js';
import { NotificationOverlayAdapter } from './notification-overlay-adapter.js';
import { KestrelDBusService } from './dbus-service.js';
import { NotificationFocusMode } from './notification-focus-mode.js';
import type Clutter from 'gi://Clutter';
import type Meta from 'gi://Meta';
import GLib from 'gi://GLib';

interface NotificationCoordinatorDeps {
    getWorld(): World | null;
    extensionPath: string;
    getLayer(): Clutter.Actor | null;
    visitSession(sessionId: string): void;
    getMetaWindow(windowId: WindowId): unknown | undefined;
    isOverviewActive(): boolean;
    getMonitor(): { x: number; y: number; width: number; height: number };
    listWorkspaces(): string;
    switchToWorkspaceByName(name: string): string;
    renameCurrentWorkspace(name: string): string;
}

export class NotificationCoordinator {
    private _deps: NotificationCoordinatorDeps;
    private _statusOverlay: StatusOverlayAdapter | null = null;
    private _notificationOverlay: NotificationOverlayAdapter | null = null;
    private _dbusService: KestrelDBusService | null = null;
    private _notificationFocusMode: NotificationFocusMode | null = null;

    constructor(deps: NotificationCoordinatorDeps) {
        this._deps = deps;
    }

    init(): void {
        this._statusOverlay = new StatusOverlayAdapter();
        const layer = this._deps.getLayer();
        if (layer) {
            this._statusOverlay.init(layer, `${this._deps.extensionPath}/data`);
        }

        this._notificationOverlay = new NotificationOverlayAdapter();
        this._notificationOverlay.init({
            onVisitSession: (sid) => this._deps.visitSession(sid),
            extensionPath: this._deps.extensionPath,
        });

        this._dbusService = this._createDbusService();
        this._notificationFocusMode = this._createFocusMode();
    }

    private _createDbusService(): KestrelDBusService {
        return new KestrelDBusService({
            handleNotification: (payload) => this.handleNotification(payload),
            handlePermissionRequest: (payload) => this.handlePermissionRequest(payload),
            setWindowStatus: (sessionId, status) => this.setWindowStatus(sessionId, status),
            getNotificationResponse: (id) => this.getNotificationResponse(id),
            listWorkspaces: () => this._deps.listWorkspaces(),
            switchToWorkspaceByName: (name) => this._deps.switchToWorkspaceByName(name),
            renameCurrentWorkspace: (name) => this._deps.renameCurrentWorkspace(name),
        });
    }

    private _createFocusMode(): NotificationFocusMode {
        const o = this._notificationOverlay, s = this._statusOverlay, d = this._deps;
        return new NotificationFocusMode({
            getPendingEntries: () => o?.getPendingEntries() ?? [],
            getWindowForSession: (sid) => s?.getWindowForSession(sid) ?? null,
            getMetaWindow: (wid) => d.getMetaWindow(wid) as Meta.Window | undefined,
            respondToEntry: (id, action) => o?.respond(id, action),
            visitSession: (sid) => d.visitSession(sid),
            getMonitor: () => d.getMonitor(), isOverviewActive: () => d.isOverviewActive(),
            registerEntriesChanged: (cb) => { if (o) o.onEntriesChanged = cb; },
            unregisterEntriesChanged: () => { if (o) o.onEntriesChanged = null; },
            getQuestionState: (id) => o?.getQuestionState(id) ?? null,
            getQuestionCard: (id) => o?.getQuestionCard(id) ?? null,
            questionNavigate: (id, delta) => o?.questionNavigate(id, delta),
            questionSelectOption: (id, qi, oi) => o?.questionSelectOption(id, qi, oi),
            questionSend: (id) => o?.questionSend(id), questionDismiss: (id) => o?.questionDismiss(id),
            questionVisit: (id) => o?.questionVisit(id), extensionPath: d.extensionPath,
        });
    }

    destroy(): void {
        this._dbusService?.destroy();
        this._dbusService = null;

        this._notificationFocusMode?.destroy();
        this._notificationFocusMode = null;

        this._notificationOverlay?.destroy();
        this._notificationOverlay = null;

        this._statusOverlay?.destroy();
        this._statusOverlay = null;
    }

    // --- Window lifecycle hooks ---

    watchWindow(windowId: WindowId, metaWindow: { connect(signal: string, cb: () => void): number; disconnect(id: number): void; get_title(): string | null }): void {
        this._statusOverlay?.watchWindow(windowId, metaWindow);
    }

    unwatchWindow(windowId: WindowId): void {
        this._statusOverlay?.unwatchWindow(windowId);
    }

    // --- DBus handlers ---

    /** Set Claude session status for a window. Returns true if panel update needed. */
    setWindowStatus(sessionId: string, status: string): void {
        this._statusOverlay?.setWindowStatus(sessionId, status);
    }

    handlePermissionRequest(jsonPayload: string): string {
        try {
            const payload = JSON.parse(jsonPayload);
            payload.workspace_name = this._workspaceNameForSession(String(payload.session_id ?? ''));
            const id = `notif-${GLib.uuid_string_random()}`;

            const classification = classifyPermissionPayload(payload);
            if (classification.isQuestion) {
                this._showAsQuestion(id, payload, classification.questions);
            } else {
                this._notificationOverlay?.showPermission(id, payload);
            }

            return JSON.stringify({ id });
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    private _showAsQuestion(id: string, payload: Record<string, unknown>, questions: ReturnType<typeof classifyPermissionPayload>['questions']): void {
        payload.questions = questions;
        const qCount = questions.length;
        payload.title = `Claude asks ${qCount} question${qCount !== 1 ? 's' : ''}`;
        payload.message = 'Session wants your input';
        this._notificationOverlay?.showQuestion(id, payload);
    }

    handleNotification(jsonPayload: string): string {
        try {
            const payload = JSON.parse(jsonPayload);
            payload.workspace_name = this._workspaceNameForSession(String(payload.session_id ?? ''));
            const id = `notif-${GLib.uuid_string_random()}`;
            this._notificationOverlay?.showNotification(id, payload);
            return JSON.stringify({ id });
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    getNotificationResponse(id: string): string {
        try {
            const response = this._notificationOverlay?.getResponse(id);
            if (!response) return '{"pending":true}';

            return JSON.stringify(parseAllowResponse(response));
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    // --- Keybinding ---

    toggle(): void {
        this._notificationFocusMode?.toggle();
    }

    // --- Overview hooks ---

    enterOverview(transform: OverviewTransform, positions: Map<WindowId, { x: number; y: number; width: number; height: number; wsIndex: number }>): void {
        this._statusOverlay?.enterOverview(transform, positions);
    }

    exitOverview(): void {
        this._statusOverlay?.exitOverview();
    }

    // --- Panel indicator support ---

    getWindowStatusMap(): ReadonlyMap<WindowId, ClaudeStatus> {
        return this._statusOverlay?.getWindowStatusMap() ?? new Map();
    }

    getWindowForSession(sessionId: string): WindowId | null {
        return this._statusOverlay?.getWindowForSession(sessionId) ?? null;
    }

    // --- Private helpers ---

    private _workspaceNameForSession(sessionId: string): string | null {
        const world = this._deps.getWorld();
        if (!world || !this._statusOverlay) return null;
        const windowId = this._statusOverlay.getWindowForSession(sessionId);
        if (!windowId) return null;
        return workspaceNameForWindow(world, windowId);
    }
}
