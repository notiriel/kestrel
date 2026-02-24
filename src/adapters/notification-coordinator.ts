import type { WindowId } from '../domain/types.js';
import type { World } from '../domain/world.js';
import type { ClaudeStatus } from '../domain/notification-types.js';
import type { OverviewTransform } from '../ports/clone-port.js';
import { StatusOverlayAdapter } from './status-overlay-adapter.js';
import { NotificationOverlayAdapter } from './notification-overlay-adapter.js';
import { KestrelDBusService } from './dbus-service.js';
import { NotificationFocusMode } from './notification-focus-mode.js';
import type Clutter from 'gi://Clutter';
import type Meta from 'gi://Meta';
import GLib from 'gi://GLib';

export interface NotificationCoordinatorDeps {
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
        // Status overlay for Claude session indicators
        this._statusOverlay = new StatusOverlayAdapter();
        const layer = this._deps.getLayer();
        if (layer) {
            this._statusOverlay.init(layer, `${this._deps.extensionPath}/data`);
        }

        // Notification overlay for Claude permission requests
        this._notificationOverlay = new NotificationOverlayAdapter();
        this._notificationOverlay.init({
            onVisitSession: (sessionId) => {
                this._deps.visitSession(sessionId);
            },
            extensionPath: this._deps.extensionPath,
        });

        // Export DBus service for hook scripts
        this._dbusService = new KestrelDBusService({
            handleNotification: (payload) => this.handleNotification(payload),
            handlePermissionRequest: (payload) => this.handlePermissionRequest(payload),
            setWindowStatus: (sessionId, status) => this.setWindowStatus(sessionId, status),
            getNotificationResponse: (id) => this.getNotificationResponse(id),
            listWorkspaces: () => this._deps.listWorkspaces(),
            switchToWorkspaceByName: (name) => this._deps.switchToWorkspaceByName(name),
            renameCurrentWorkspace: (name) => this._deps.renameCurrentWorkspace(name),
        });

        // Notification focus mode (Super+.)
        this._notificationFocusMode = new NotificationFocusMode({
            getPendingEntries: () => this._notificationOverlay?.getPendingEntries() ?? [],
            getWindowForSession: (sid) => this._statusOverlay?.getWindowForSession(sid) ?? null,
            getMetaWindow: (wid) => this._deps.getMetaWindow(wid) as Meta.Window | undefined,
            respondToEntry: (id, action) => this._notificationOverlay?.respond(id, action),
            visitSession: (sessionId) => {
                this._deps.visitSession(sessionId);
            },
            getMonitor: () => this._deps.getMonitor(),
            isOverviewActive: () => this._deps.isOverviewActive(),
            registerEntriesChanged: (cb) => {
                if (this._notificationOverlay) {
                    this._notificationOverlay.onEntriesChanged = cb;
                }
            },
            unregisterEntriesChanged: () => {
                if (this._notificationOverlay) {
                    this._notificationOverlay.onEntriesChanged = null;
                }
            },
            // Question support
            getQuestionState: (id) => this._notificationOverlay?.getQuestionState(id) ?? null,
            getQuestionCard: (id) => this._notificationOverlay?.getQuestionCard(id) ?? null,
            questionNavigate: (id, delta) => this._notificationOverlay?.questionNavigate(id, delta),
            questionSelectOption: (id, qi, oi) => this._notificationOverlay?.questionSelectOption(id, qi, oi),
            questionSend: (id) => this._notificationOverlay?.questionSend(id),
            questionDismiss: (id) => this._notificationOverlay?.questionDismiss(id),
            questionVisit: (id) => this._notificationOverlay?.questionVisit(id),
            extensionPath: this._deps.extensionPath,
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

            // Route AskUserQuestion to question card
            if (payload.tool_name === 'AskUserQuestion' && payload.tool_input?.questions) {
                payload.questions = payload.tool_input.questions;
                const qCount = Array.isArray(payload.tool_input.questions) ? payload.tool_input.questions.length : 0;
                payload.title = `Claude asks ${qCount} question${qCount !== 1 ? 's' : ''}`;
                payload.message = 'Session wants your input';
                this._notificationOverlay?.showQuestion(id, payload);
            } else {
                this._notificationOverlay?.showPermission(id, payload);
            }

            return JSON.stringify({ id });
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
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

            // Question cards respond with 'allow:{"0":["opt"]}' — parse the answers
            if (response.startsWith('allow:')) {
                const answersJson = response.slice(6);
                try {
                    const answers = JSON.parse(answersJson);
                    return JSON.stringify({ action: 'allow', answers });
                } catch {
                    return JSON.stringify({ action: 'allow' });
                }
            }

            return JSON.stringify({ action: response });
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
        for (let i = 0; i < world.workspaces.length; i++) {
            if (world.workspaces[i].windows.some(w => w.id === windowId)) {
                return world.workspaces[i].name ?? null;
            }
        }
        return null;
    }
}
