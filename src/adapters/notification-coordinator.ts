import type { WindowId } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { workspaceNameForWindow, updateNotificationState } from '../domain/world.js';
import type { ClaudeStatus } from '../domain/notification-types.js';
import {
    classifyPermissionPayload, parseAllowResponse,
    addNotification, respondToNotification, getResponse as domainGetResponse,
    registerSession, setSessionStatus, clearSession,
    shouldSuppressNotification, getWindowForSession as domainGetWindowForSession,
    getWindowStatusMap as domainGetWindowStatusMap,
} from '../domain/notification.js';
import type { DomainNotification, NotificationState } from '../domain/notification.js';
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
    setWorld(world: World): void;
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
        this._statusOverlay.onProbeDetected = (sid, wid) => this.onProbeDetected(sid, wid);
        const layer = this._deps.getLayer();
        if (layer) {
            this._statusOverlay.init(layer, `${this._deps.extensionPath}/data`, () => this._deps.getWorld());
        }

        this._notificationOverlay = new NotificationOverlayAdapter();
        this._notificationOverlay.onRespond = (id, action) => this._onOverlayRespond(id, action);
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
        const o = this._notificationOverlay, d = this._deps;
        return new NotificationFocusMode({
            getWorld: () => d.getWorld(), setWorld: (w) => d.setWorld(w),
            getPendingEntries: () => o?.getPendingEntries() ?? [],
            getWindowForSession: (sid) => this.getWindowForSession(sid),
            getMetaWindow: (wid) => d.getMetaWindow(wid) as Meta.Window | undefined,
            respondToEntry: (id, action) => o?.respond(id, action),
            visitSession: (sid) => d.visitSession(sid),
            getMonitor: () => d.getMonitor(), isOverviewActive: () => d.isOverviewActive(),
            registerEntriesChanged: (cb) => { if (o) o.onEntriesChanged = cb; },
            unregisterEntriesChanged: () => { if (o) o.onEntriesChanged = null; },
            ...this._questionDeps(),
        });
    }

    private _questionDeps() {
        const o = this._notificationOverlay, d = this._deps;
        return {
            getQuestionState: (id: string) => o?.getQuestionState(id) ?? null,
            getQuestionCard: (id: string) => o?.getQuestionCard(id) ?? null,
            questionNavigate: (id: string, delta: number) => o?.questionNavigate(id, delta),
            questionSelectOption: (id: string, qi: number, oi: number) => o?.questionSelectOption(id, qi, oi),
            questionSend: (id: string) => o?.questionSend(id),
            questionDismiss: (id: string) => o?.questionDismiss(id),
            questionVisit: (id: string) => o?.questionVisit(id),
            extensionPath: d.extensionPath,
        };
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

    /** Set Claude session status for a window via domain state. */
    setWindowStatus(sessionId: string, status: string): void {
        const world = this._deps.getWorld();
        if (!world) return;

        let ns: NotificationState;
        if (status === 'end') {
            ns = clearSession(world.notificationState, sessionId);
        } else {
            const validStatus = status as ClaudeStatus;
            if (!['working', 'needs-input', 'done'].includes(validStatus)) {
                console.log(`[Kestrel] setWindowStatus: unknown status ${status}`);
                return;
            }
            ns = setSessionStatus(world.notificationState, sessionId, validStatus);
        }
        this._deps.setWorld(updateNotificationState(world, ns));

        // Also update the status overlay visuals
        this._statusOverlay?.setWindowStatus(sessionId, status);
    }

    handlePermissionRequest(jsonPayload: string): string {
        try {
            const payload = JSON.parse(jsonPayload);
            const sessionId = String(payload.session_id ?? '');
            payload.workspace_name = this._workspaceNameForSession(sessionId);
            const id = `notif-${GLib.uuid_string_random()}`;

            const classification = classifyPermissionPayload(payload);
            const type = classification.isQuestion ? 'question' : 'permission';
            this._addToDomainState(id, sessionId, payload, type);
            this._showPermissionUI(id, payload, classification);
            return JSON.stringify({ id });
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    private _showPermissionUI(id: string, payload: Record<string, unknown>, classification: ReturnType<typeof classifyPermissionPayload>): void {
        if (classification.isQuestion) {
            this._showAsQuestion(id, payload, classification.questions);
        } else {
            this._notificationOverlay?.showPermission(id, payload);
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
            const sessionId = String(payload.session_id ?? '');
            payload.workspace_name = this._workspaceNameForSession(sessionId);
            const id = `notif-${GLib.uuid_string_random()}`;

            if (this._shouldSuppressForFocused(sessionId)) return JSON.stringify({ id });
            this._addToDomainState(id, sessionId, payload, 'notification');
            this._notificationOverlay?.showNotification(id, payload);
            return JSON.stringify({ id });
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    private _shouldSuppressForFocused(sessionId: string): boolean {
        const world = this._deps.getWorld();
        return !!world && shouldSuppressNotification(world.notificationState, sessionId, world.focusedWindow);
    }

    private _addToDomainState(id: string, sessionId: string, payload: Record<string, unknown>, type: 'permission' | 'notification' | 'question'): void {
        const world = this._deps.getWorld();
        if (!world) return;
        const domainNotif = this._buildDomainNotification(id, sessionId, payload, type);
        const ns = addNotification(world.notificationState, domainNotif);
        this._deps.setWorld(updateNotificationState(world, ns));
    }

    getNotificationResponse(id: string): string {
        try {
            const response = this._resolveResponse(id);
            if (!response) return '{"pending":true}';
            return JSON.stringify(parseAllowResponse(response));
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    /** Sync response from overlay adapter into domain state. */
    private _onOverlayRespond(id: string, action: string): void {
        const world = this._deps.getWorld();
        if (!world) return;
        const ns = respondToNotification(world.notificationState, id, action);
        this._deps.setWorld(updateNotificationState(world, ns));
    }

    private _resolveResponse(id: string): string | null {
        const world = this._deps.getWorld();
        if (!world) return null;
        return domainGetResponse(world.notificationState, id);
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
        const world = this._deps.getWorld();
        if (!world) return new Map();
        return domainGetWindowStatusMap(world.notificationState);
    }

    getWindowForSession(sessionId: string): WindowId | null {
        const world = this._deps.getWorld();
        if (!world) return null;
        return domainGetWindowForSession(world.notificationState, sessionId);
    }

    // --- Private helpers ---

    /** Handle probe detection from status overlay — register session in domain. */
    onProbeDetected(sessionId: string, windowId: WindowId): void {
        const world = this._deps.getWorld();
        if (!world) return;
        const ns = registerSession(world.notificationState, sessionId, windowId);
        this._deps.setWorld(updateNotificationState(world, ns));
    }

    private _workspaceNameForSession(sessionId: string): string | null {
        const world = this._deps.getWorld();
        if (!world) return null;
        const windowId = domainGetWindowForSession(world.notificationState, sessionId);
        if (!windowId) return null;
        return workspaceNameForWindow(world, windowId);
    }

    /** Build a domain notification from a payload. */
    private _buildDomainNotification(id: string, sessionId: string, payload: Record<string, unknown>, type: 'permission' | 'notification' | 'question'): DomainNotification {
        const opt = (k: string) => payload[k] ? String(payload[k]) : undefined;
        const defaultTitle = type === 'permission' ? 'Permission Request' : 'Notification';
        return {
            id, sessionId, type, questions: [], status: 'pending', response: null, timestamp: Date.now(),
            workspaceName: opt('workspace_name'), title: String(payload.title ?? defaultTitle),
            message: String(payload.message ?? ''), command: opt('command'), toolName: opt('tool_name'),
            questionState: { currentPage: 0, answers: new Map(), otherTexts: new Map(), otherActive: new Map() },
        };
    }
}
