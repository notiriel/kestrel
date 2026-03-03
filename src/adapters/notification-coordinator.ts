import type { WindowId } from '../domain/types.js';
import { resolveWorkspaceColor } from '../domain/types.js';
import type { World } from '../domain/world.js';
import { workspaceNameForWindow, workspaceColorForWindow, updateNotificationState, updateNotificationInteractionState } from '../domain/world.js';
import type { ClaudeStatus } from '../domain/notification-types.js';
import {
    classifyPermissionPayload, parseAllowResponse, parseQuestion,
    addNotification, respondToNotification, getResponse as domainGetResponse,
    registerSession, setSessionStatus, clearSession,
    getWindowForSession as domainGetWindowForSession,
    getWindowStatusMap as domainGetWindowStatusMap,
    getPendingEntries as domainGetPendingEntries,
    createDomainNotification, formatQuestionTitle,
    selectQuestionOption as domainSelectQuestionOption,
    navigateQuestion as domainNavigateQuestion,
    setOtherText as domainSetOtherText,
} from '../domain/notification.js';
import type { DomainNotification, NotificationState } from '../domain/notification.js';
import {
    computeOverlayScene,
    expandStack, collapseStack, expandCard, collapseCard,
} from '../domain/notification-scene.js';
import type { OverviewTransform } from '../ports/clone-port.js';
import { StatusOverlayAdapter } from './output/status-overlay-adapter.js';
import { NotificationOverlayAdapter } from './output/notification-overlay-adapter.js';
import { KestrelDBusService } from './dbus-service.js';
import { NotificationFocusMode } from './notification-focus-mode.js';
import type Clutter from 'gi://Clutter';
import type Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

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
    getDiagnostics(): string;
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

        this._notificationOverlay = this._createNotificationOverlay();
        this._dbusService = this._createDbusService();
        this._notificationFocusMode = this._createFocusMode();
    }

    private _createNotificationOverlay(): NotificationOverlayAdapter {
        const overlay = new NotificationOverlayAdapter();
        overlay.onRespond = (id, action) => this._onOverlayRespond(id, action);
        overlay.onExpandStack = () => this._onExpandStack();
        overlay.onCollapseStack = () => this._onCollapseStack();
        overlay.onExpandCard = (id) => this._onExpandCard(id);
        overlay.onCollapseCard = (id) => this._onCollapseCard(id);
        overlay.onSelectOption = (id, qi, oi) => this._syncQuestionToDomain(id, ns => domainSelectQuestionOption(ns, id, qi, oi));
        overlay.onSetOtherText = (id, qi, text) => this._syncQuestionToDomain(id, ns => domainSetOtherText(ns, id, qi, text));
        overlay.init({
            onVisitSession: (sid) => this._deps.visitSession(sid),
            extensionPath: this._deps.extensionPath,
        });
        return overlay;
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
            getDiagnostics: () => this._deps.getDiagnostics(),
        });
    }

    private _createFocusMode(): NotificationFocusMode {
        const o = this._notificationOverlay, d = this._deps;
        return new NotificationFocusMode({
            getWorld: () => d.getWorld(), setWorld: (w) => d.setWorld(w),
            getPendingEntries: () => this._domainPendingEntries(),
            getWindowForSession: (sid) => this.getWindowForSession(sid),
            getMetaWindow: (wid) => d.getMetaWindow(wid) as Meta.Window | undefined,
            respondToEntry: (id, action) => o?.respond(id, action),
            visitSession: (sid) => d.visitSession(sid),
            getMonitor: () => d.getMonitor(),
            registerEntriesChanged: (cb) => { if (o) o.onEntriesChanged = cb; },
            unregisterEntriesChanged: () => { if (o) o.onEntriesChanged = null; },
            ...this._questionDeps(),
        });
    }

    private _domainPendingEntries(): Array<{ id: string; notification: import('../domain/notification-types.js').OverlayNotification }> {
        const world = this._deps.getWorld();
        if (!world) return [];
        return domainGetPendingEntries(world.notificationState).map(n => ({
            id: n.id, notification: this._domainToOverlay(n),
        }));
    }

    private _questionDeps() {
        const o = this._notificationOverlay, d = this._deps;
        return {
            getQuestionState: (id: string) => o?.getQuestionState(id) ?? null,
            getQuestionCard: (id: string) => o?.getQuestionCard(id) ?? null,
            questionNavigate: (id: string, delta: number) => {
                o?.questionNavigate(id, delta);
                this._syncQuestionToDomain(id, ns => domainNavigateQuestion(ns, id, delta));
            },
            questionSelectOption: (id: string, qi: number, oi: number) => o?.questionSelectOption(id, qi, oi),
            questionSend: (id: string) => o?.questionSend(id),
            questionDismiss: (id: string) => o?.questionDismiss(id),
            questionVisit: (id: string) => o?.questionVisit(id),
            extensionPath: d.extensionPath,
        };
    }

    /** Sync a question interaction operation to domain state. */
    private _syncQuestionToDomain(id: string, updater: (ns: NotificationState) => NotificationState): void {
        const world = this._deps.getWorld();
        if (!world || !world.notificationState.notifications.has(id)) return;
        const ns = updater(world.notificationState);
        this._deps.setWorld(updateNotificationState(world, ns));
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
        this._applyOverlayScene();
    }

    handlePermissionRequest(jsonPayload: string): string {
        try {
            const payload = JSON.parse(jsonPayload);
            const sessionId = String(payload.session_id ?? '');
            payload.workspace_name = this._workspaceNameForSession(sessionId);
            const id = `notif-${GLib.uuid_string_random()}`;
            const { focusModeWasActive } = this._classifyAndAddPermission(id, sessionId, payload);
            this._applyOverlayScene();
            this._enterFocusModeIfDomainActivated(focusModeWasActive);
            return JSON.stringify({ id });
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    private _classifyAndAddPermission(id: string, sessionId: string, payload: Record<string, unknown>): { focusModeWasActive: boolean } {
        const classification = classifyPermissionPayload(payload);
        const focusModeWasActive = this._isFocusModeActive();
        if (classification.isQuestion) {
            payload.title = formatQuestionTitle(classification.questions.length);
            payload.message = 'Session wants your input';
        }
        const type = classification.isQuestion ? 'question' : 'permission';
        const parsedQuestions = classification.isQuestion
            ? classification.questions.map(q => parseQuestion(q))
            : undefined;
        this._addToDomainState(id, sessionId, payload, type, parsedQuestions);
        return { focusModeWasActive };
    }

    handleNotification(jsonPayload: string): string {
        try {
            const payload = JSON.parse(jsonPayload);
            const sessionId = String(payload.session_id ?? '');
            payload.workspace_name = this._workspaceNameForSession(sessionId);
            const id = `notif-${GLib.uuid_string_random()}`;

            this._addToDomainState(id, sessionId, payload, 'notification');
            if (this._domainHasNotification(id)) {
                this._applyOverlayScene();
            }
            return JSON.stringify({ id });
        } catch (e) {
            return `{"error":"${String(e)}"}`;
        }
    }

    private _domainHasNotification(id: string): boolean {
        return this._deps.getWorld()?.notificationState.notifications.has(id) ?? false;
    }

    private _isFocusModeActive(): boolean {
        return this._deps.getWorld()?.notificationState.focusMode.active ?? false;
    }

    /** React to domain having activated focus mode during addNotification. */
    private _enterFocusModeIfDomainActivated(wasPreviouslyActive: boolean): void {
        if (!wasPreviouslyActive && this._isFocusModeActive()) {
            this._notificationFocusMode?.enter();
        }
    }

    private _addToDomainState(id: string, sessionId: string, payload: Record<string, unknown>, type: 'permission' | 'notification' | 'question', parsedQuestions?: import('../domain/notification.js').ParsedQuestion[]): void {
        const world = this._deps.getWorld();
        if (!world) return;
        const domainNotif = this._buildDomainNotification(id, sessionId, payload, type, parsedQuestions);
        const ns = addNotification(world.notificationState, domainNotif, world.focusedWindow);
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
        this._applyOverlayScene();
    }

    private _resolveResponse(id: string): string | null {
        const world = this._deps.getWorld();
        if (!world) return null;
        return domainGetResponse(world.notificationState, id);
    }

    // --- Expand/collapse callbacks from adapter ---

    private _onExpandStack(): void {
        const world = this._deps.getWorld();
        if (!world) return;
        const newState = expandStack(world.notificationInteractionState);
        this._deps.setWorld(updateNotificationInteractionState(world, newState));
        // Also expand the first card
        const pending = domainGetPendingEntries(world.notificationState);
        if (pending.length > 0) {
            this._onExpandCard(pending[0]!.id);
            return;
        }
        this._applyOverlayScene();
    }

    private _onCollapseStack(): void {
        const world = this._deps.getWorld();
        if (!world) return;
        const newState = collapseStack(world.notificationInteractionState);
        this._deps.setWorld(updateNotificationInteractionState(world, newState));
        // Collapse all card visuals
        for (const id of world.notificationState.notifications.keys()) {
            this._notificationOverlay?.collapseCardVisual(id);
        }
        this._applyOverlayScene();
    }

    private _onExpandCard(id: string): void {
        const world = this._deps.getWorld();
        if (!world) return;
        const newState = expandCard(world.notificationInteractionState, id);
        this._deps.setWorld(updateNotificationInteractionState(world, newState));
        this._notificationOverlay?.expandCardVisual(id);
        this._applyOverlayScene();
    }

    private _onCollapseCard(id: string): void {
        const world = this._deps.getWorld();
        if (!world) return;
        const newState = collapseCard(world.notificationInteractionState, id);
        this._deps.setWorld(updateNotificationInteractionState(world, newState));
        this._notificationOverlay?.collapseCardVisual(id);
        this._applyOverlayScene();
    }

    // --- Scene computation + application ---

    private _applyOverlayScene(): void {
        const world = this._deps.getWorld();
        if (!world || !this._notificationOverlay) return;

        // Gather expanded card heights from adapter
        const expandedHeights = new Map<string, number>();
        for (const id of world.notificationInteractionState.expandedCardIds) {
            expandedHeights.set(id, this._notificationOverlay.getExpandedCardHeight(id));
        }

        const monitor = this._deps.getMonitor();
        const panelHeight = this._getPanelHeight();
        const scene = computeOverlayScene(
            world.notificationState,
            world.notificationInteractionState,
            monitor,
            panelHeight,
            expandedHeights,
        );

        this._notificationOverlay.applyOverlayScene(scene, world.notificationState.notifications);
    }

    private _getPanelHeight(): number {
        try {
            return Main.panel.height ?? 32;
        } catch {
            return 32;
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

    /** Project domain notification to overlay notification format. */
    private _domainToOverlay(n: DomainNotification): import('../domain/notification-types.js').OverlayNotification {
        return {
            id: n.id,
            sessionId: n.sessionId,
            workspaceName: n.workspaceName,
            workspaceColor: this._resolveWorkspaceColorForSession(n.sessionId),
            type: n.type,
            title: n.title,
            message: n.message,
            command: n.command,
            toolName: n.toolName,
            timestamp: n.timestamp,
            questions: n.questions,
        };
    }

    private _resolveWorkspaceColorForSession(sessionId: string | undefined): string | undefined {
        if (!sessionId) return undefined;
        const world = this._deps.getWorld();
        if (!world) return undefined;
        const windowId = domainGetWindowForSession(world.notificationState, sessionId);
        if (!windowId) return undefined;
        const colorId = workspaceColorForWindow(world, windowId);
        if (colorId === null) return undefined;
        const resolved = resolveWorkspaceColor(colorId, world.config);
        return resolved.solid;
    }

    /** Build a domain notification from a payload. */
    private _buildDomainNotification(id: string, sessionId: string, payload: Record<string, unknown>, type: 'permission' | 'notification' | 'question', parsedQuestions?: import('../domain/notification.js').ParsedQuestion[]): DomainNotification {
        const opt = (k: string) => payload[k] ? String(payload[k]) : undefined;
        const defaultTitle = type === 'permission' ? 'Permission Request' : 'Notification';
        return createDomainNotification(id, sessionId, type, String(payload.title ?? defaultTitle), String(payload.message ?? ''), {
            workspaceName: opt('workspace_name'),
            command: opt('command'),
            toolName: opt('tool_name'),
            questions: parsedQuestions,
        });
    }
}
