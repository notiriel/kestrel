import type { NotificationPort, NotificationInitOptions } from '../ports/notification-port.js';
import type { OverlayNotification, QuestionDefinition } from '../domain/notification-types.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

const CARD_WIDTH = 400;
const QUESTION_CARD_WIDTH = 600;
const CARD_MARGIN = 12;
const CARD_RIGHT_OFFSET = QUESTION_CARD_WIDTH - CARD_WIDTH; // Right-align normal cards in wide container
const COLLAPSED_H = 62;
const STACK_OFFSET_Y = 4;
const STACK_SCALE_STEP = 0.05;
const STACK_OPACITY_STEP = 0.05;
const ANIMATION_DURATION = 300;
const AUTO_ADVANCE_DELAY = 300;

// Colors from the design proposal
const SURFACE = '#1a1a1f';
const SURFACE_HOVER = '#1f1f25';
const BORDER = '#2a2a32';
const BORDER_HOVER = '#3a3a44';
const TEXT = '#e4e4e8';
const TEXT_DIM = '#7b7b86';
const ACCENT = '#c97f4a';
const GREEN = '#4a9e6e';
const RED = '#c95a5a';
const BLUE = '#5a8ec9';

const PERMISSION_TIMEOUT_SECS = 600; // 10 minutes
const PROGRESS_TICK_SECS = 10;

export interface QuestionState {
    currentPage: number;
    answers: Map<number, string[]>;
    questions: readonly QuestionDefinition[];
    pageContainer: St.BoxLayout | null;
    navBar: St.BoxLayout | null;
    autoAdvanceTimeoutId: number | null;
}

interface NotifEntry {
    notification: OverlayNotification;
    card: St.BoxLayout;
    expandWrapper: Clutter.Actor;
    msgLabel: St.Label;
    cardExpanded: boolean;
    response: string | null;
    progressBar: St.Widget | null;
    progressTimeoutId: number | null;
    questionState: QuestionState | null;
}

export class NotificationOverlayAdapter implements NotificationPort {
    private _container: St.Widget | null = null;
    private _entries: Map<string, NotifEntry> = new Map();
    private _responses: Map<string, string> = new Map();
    private _stackExpanded: boolean = false;
    private _countBadge: St.Label | null = null;
    private _onVisitSession: ((sessionId: string) => void) | null = null;
    private _focusSignalId: number = 0;

    /** Callback invoked when entries are added, removed, or responded to. */
    onEntriesChanged: (() => void) | null = null;

    init(options?: NotificationInitOptions): void {
        try {
            this._onVisitSession = options?.onVisitSession ?? null;

            this._container = new St.Widget({
                style: 'padding: 0;',
                reactive: true,
                clip_to_allocation: false,
                layout_manager: new Clutter.FixedLayout(),
            });

            this._container.connect('enter-event', () => {
                if (this._entries.size <= 1) return;
                this._stackExpanded = true;
                // Auto-expand the topmost card
                const first = this._entries.values().next().value as NotifEntry | undefined;
                if (first) this._expandCard(first);
                this._relayout();
            });
            this._container.connect('leave-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
                // Don't collapse when pointer moves to a child
                const related = (event as Clutter.Event).get_related();
                if (related && this._container!.contains(related)) return;

                this._stackExpanded = false;
                // Collapse any individually expanded cards
                for (const entry of this._entries.values()) {
                    this._collapseCard(entry);
                }
                this._relayout();
            });

            Main.layoutManager.addTopChrome(this._container, {
                affectsStruts: false,
                trackFullscreen: false,
            });

            // Position top-right — container is wide enough for expanded question cards
            // Normal cards are right-aligned within via translation_x offset
            this._container.width = QUESTION_CARD_WIDTH + CARD_MARGIN * 2;
            const monitor = Main.layoutManager.primaryMonitor;
            if (monitor) {
                this._container.set_position(
                    monitor.x + monitor.width - QUESTION_CARD_WIDTH - CARD_MARGIN * 2,
                    monitor.y + Main.panel.height + CARD_MARGIN,
                );
            }

            // Count badge
            this._countBadge = new St.Label({
                text: '0',
                style: `background-color: ${ACCENT}; color: #fff; font-family: monospace; font-size: 11px; font-weight: bold; border-radius: 100px; padding: 2px 7px; min-width: 22px; text-align: center;`,
                visible: false,
                reactive: false,
            });
            // Badge positioned absolute in top-right — we'll manage position in _relayout
            this._container.add_child(this._countBadge);

            // Follow focus: reposition to the monitor of the focused window
            this._focusSignalId = global.display.connect('notify::focus-window', () => {
                try {
                    const focusedWindow = global.display.focus_window;
                    if (!focusedWindow) return;
                    const monitorIndex = focusedWindow.get_monitor();
                    const monitor = global.display.get_monitor_geometry(monitorIndex);
                    if (monitor) {
                        this._repositionToMonitor(monitor);
                    }
                } catch (e) {
                    console.error('[Kestrel] Error repositioning notification overlay:', e);
                }
            });
        } catch (e) {
            console.error('[Kestrel] Error creating notification overlay:', e);
        }
    }

    showPermission(id: string, payload: Record<string, unknown>): void {
        try {
            this._dismissPreviousForSession(String(payload.session_id ?? ''));
            const notification: OverlayNotification = {
                id,
                sessionId: String(payload.session_id ?? ''),
                workspaceName: payload.workspace_name ? String(payload.workspace_name) : undefined,
                type: 'permission',
                title: String(payload.title ?? 'Permission Request'),
                message: String(payload.message ?? ''),
                command: payload.command ? String(payload.command) : undefined,
                toolName: payload.tool_name ? String(payload.tool_name) : undefined,
                timestamp: Date.now(),
            };

            const { card, expandWrapper, msgLabel, progressBar, progressTimeoutId } = this._buildCard(notification);
            this._entries.set(id, { notification, card, expandWrapper, msgLabel, cardExpanded: false, response: null, progressBar, progressTimeoutId, questionState: null });
            this._container?.insert_child_below(card, this._countBadge);
            this._updateCountBadge();
            this._relayout();
            this.onEntriesChanged?.();
        } catch (e) {
            console.error('[Kestrel] Error showing permission notification:', e);
        }
    }

    showNotification(id: string, payload: Record<string, unknown>): void {
        try {
            this._dismissPreviousForSession(String(payload.session_id ?? ''));
            const notification: OverlayNotification = {
                id,
                sessionId: String(payload.session_id ?? ''),
                workspaceName: payload.workspace_name ? String(payload.workspace_name) : undefined,
                type: 'notification',
                title: String(payload.title ?? 'Notification'),
                message: String(payload.message ?? ''),
                timestamp: Date.now(),
            };

            const { card, expandWrapper, msgLabel, progressBar, progressTimeoutId } = this._buildCard(notification);
            this._entries.set(id, { notification, card, expandWrapper, msgLabel, cardExpanded: false, response: null, progressBar, progressTimeoutId, questionState: null });
            this._container?.insert_child_below(card, this._countBadge);
            this._updateCountBadge();
            this._relayout();
            this.onEntriesChanged?.();
        } catch (e) {
            console.error('[Kestrel] Error showing notification:', e);
        }
    }

    showQuestion(id: string, payload: Record<string, unknown>): void {
        try {
            this._dismissPreviousForSession(String(payload.session_id ?? ''));

            const rawQuestions = payload.questions as readonly QuestionDefinition[] | undefined;
            if (!rawQuestions || rawQuestions.length === 0) {
                // Fallback to permission card if no questions
                this.showPermission(id, payload);
                return;
            }

            const notification: OverlayNotification = {
                id,
                sessionId: String(payload.session_id ?? ''),
                workspaceName: payload.workspace_name ? String(payload.workspace_name) : undefined,
                type: 'question',
                title: String(payload.title ?? 'Question'),
                message: String(payload.message ?? ''),
                questions: rawQuestions,
                timestamp: Date.now(),
            };

            const questionState: QuestionState = {
                currentPage: 0,
                answers: new Map(),
                questions: rawQuestions,
                pageContainer: null,
                navBar: null,
                autoAdvanceTimeoutId: null,
            };

            const { card, expandWrapper, msgLabel, progressBar, progressTimeoutId } = this._buildCard(notification);
            // Find the pageContainer and navBar that _buildCard created inside expandContent
            const expandContent = expandWrapper.get_first_child() as St.BoxLayout | null;
            if (expandContent) {
                const children = expandContent.get_children();
                // For question type: first child is pageContainer, second is navBar
                questionState.pageContainer = (children[0] as St.BoxLayout) ?? null;
                questionState.navBar = (children[1] as St.BoxLayout) ?? null;
            }

            const entry: NotifEntry = {
                notification, card, expandWrapper, msgLabel,
                cardExpanded: false, response: null,
                progressBar, progressTimeoutId,
                questionState,
            };
            this._entries.set(id, entry);

            // Build initial question page content
            this._rebuildQuestionPage(entry);

            this._container?.insert_child_below(card, this._countBadge);
            this._updateCountBadge();
            this._relayout();
            this.onEntriesChanged?.();
        } catch (e) {
            console.error('[Kestrel] Error showing question notification:', e);
        }
    }

    getResponse(id: string): string | null {
        // Check live entries first, then the response cache (for dismissed cards)
        const entry = this._entries.get(id);
        if (entry?.response) return entry.response;
        return this._responses.get(id) ?? null;
    }

    /** Get question state for an entry (for focus mode). */
    getQuestionState(id: string): QuestionState | null {
        return this._entries.get(id)?.questionState ?? null;
    }

    /** Navigate question pages. */
    questionNavigate(id: string, delta: number): void {
        const entry = this._entries.get(id);
        if (!entry?.questionState) return;
        const qs = entry.questionState;
        const totalPages = qs.questions.length + 1; // questions + submit page
        const newPage = Math.max(0, Math.min(totalPages - 1, qs.currentPage + delta));
        if (newPage === qs.currentPage) return;
        qs.currentPage = newPage;
        this._rebuildQuestionPage(entry);
    }

    /** Toggle option selection on a question page. */
    questionSelectOption(id: string, questionIndex: number, optionIndex: number): void {
        const entry = this._entries.get(id);
        if (!entry?.questionState) return;
        const qs = entry.questionState;
        const qDef = qs.questions[questionIndex];
        if (!qDef || optionIndex < 0 || optionIndex >= qDef.options.length) return;

        const label = qDef.options[optionIndex].label;
        const current = qs.answers.get(questionIndex) ?? [];

        if (qDef.multiSelect) {
            if (current.includes(label)) {
                qs.answers.set(questionIndex, current.filter(l => l !== label));
            } else {
                qs.answers.set(questionIndex, [...current, label]);
            }
        } else {
            qs.answers.set(questionIndex, [label]);
        }

        this._rebuildQuestionPage(entry);

        // Auto-advance for single-select after a short delay
        if (!qDef.multiSelect && qs.currentPage < qs.questions.length - 1) {
            if (qs.autoAdvanceTimeoutId !== null) {
                GLib.source_remove(qs.autoAdvanceTimeoutId);
            }
            qs.autoAdvanceTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTO_ADVANCE_DELAY, () => {
                qs.autoAdvanceTimeoutId = null;
                qs.currentPage++;
                this._rebuildQuestionPage(entry);
                return GLib.SOURCE_REMOVE;
            });
        } else if (!qDef.multiSelect && qs.currentPage === qs.questions.length - 1) {
            // Last question, auto-advance to submit page
            if (qs.autoAdvanceTimeoutId !== null) {
                GLib.source_remove(qs.autoAdvanceTimeoutId);
            }
            qs.autoAdvanceTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTO_ADVANCE_DELAY, () => {
                qs.autoAdvanceTimeoutId = null;
                qs.currentPage = qs.questions.length;
                this._rebuildQuestionPage(entry);
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    /** Format answers and respond with allow: prefix + answers JSON. */
    questionSend(id: string): void {
        const entry = this._entries.get(id);
        if (!entry?.questionState) return;
        const qs = entry.questionState;

        // Build answers map: question index → selected labels
        const answersObj: Record<string, string[]> = {};
        for (const [qIdx, labels] of qs.answers) {
            answersObj[String(qIdx)] = labels;
        }

        this._respond(id, `allow:${JSON.stringify(answersObj)}`);
    }

    /** Dismiss question (fall through to terminal UI). */
    questionDismiss(id: string): void {
        this._respond(id, 'allow');
    }

    /** Visit session + dismiss (fall through to terminal UI). */
    questionVisit(id: string): void {
        const entry = this._entries.get(id);
        if (entry?.notification.sessionId && this._onVisitSession) {
            this._onVisitSession(entry.notification.sessionId);
        }
        this._respond(id, 'allow');
    }

    /** Returns pending (unresponded) entries sorted by timestamp. */
    getPendingEntries(): Array<{ id: string; notification: OverlayNotification }> {
        const result: Array<{ id: string; notification: OverlayNotification }> = [];
        for (const [id, entry] of this._entries) {
            if (entry.response === null) {
                result.push({ id, notification: entry.notification });
            }
        }
        result.sort((a, b) => a.notification.timestamp - b.notification.timestamp);
        return result;
    }

    /** Respond to an entry (public wrapper for focus mode). */
    respond(id: string, action: string): void {
        this._respond(id, action);
    }

    destroy(): void {
        try {
            if (this._focusSignalId) {
                global.display.disconnect(this._focusSignalId);
                this._focusSignalId = 0;
            }

            for (const entry of this._entries.values()) {
                if (entry.progressTimeoutId !== null) {
                    GLib.source_remove(entry.progressTimeoutId);
                }
                entry.card.destroy();
            }
            this._entries.clear();

            if (this._countBadge) {
                this._countBadge.destroy();
                this._countBadge = null;
            }

            if (this._container) {
                Main.layoutManager.removeChrome(this._container);
                this._container.destroy();
                this._container = null;
            }
        } catch (e) {
            console.error('[Kestrel] Error destroying notification overlay:', e);
        }
    }

    private _buildCard(notif: OverlayNotification): { card: St.BoxLayout; expandWrapper: Clutter.Actor; msgLabel: St.Label; progressBar: St.Widget | null; progressTimeoutId: number | null } {
        const card = new St.BoxLayout({
            vertical: true,
            style: this._cardStyle(false),
            reactive: true,
            width: CARD_WIDTH,
            opacity: 0,
            translation_x: CARD_RIGHT_OFFSET + 60,
        });

        // Header row: workspace name (bold) left, title right
        const header = new St.BoxLayout({
            style: 'spacing: 8px;',
            x_expand: true,
        });

        if (notif.workspaceName) {
            const wsLabel = new St.Label({
                text: notif.workspaceName,
                style: `font-weight: bold; font-size: 13px; color: ${TEXT};`,
                x_align: Clutter.ActorAlign.START,
            });
            wsLabel.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
            header.add_child(wsLabel);
        }

        const titleLabel = new St.Label({
            text: notif.title,
            style: `font-size: 11px; color: ${TEXT_DIM};`,
            x_expand: true,
            x_align: notif.workspaceName ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
        });
        titleLabel.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
        header.add_child(titleLabel);
        card.add_child(header);

        // Message — truncated when collapsed, wrapped when expanded
        const msgLabel = new St.Label({
            text: notif.message || '',
            style: `font-size: 12px; color: ${TEXT_DIM}; margin-top: 6px;`,
            x_expand: true,
        });
        msgLabel.clutter_text.line_wrap = false;
        msgLabel.clutter_text.ellipsize = 3; // END
        card.add_child(msgLabel);

        // Expandable section — clip_to_allocation, height starts at 0
        const expandWrapper = new Clutter.Actor({
            clip_to_allocation: true,
            height: 0,
            x_expand: true,
        });

        const expandContent = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 0;',
        });

        if (notif.type === 'permission') {
            // Command block
            if (notif.command) {
                const cmdBlock = new St.Label({
                    text: `$ ${notif.command}`,
                    style: `font-family: monospace; font-size: 11px; color: ${ACCENT}; background-color: rgba(0,0,0,0.35); border-radius: 8px; padding: 7px 11px; margin-top: 10px; border: 1px solid rgba(255,255,255,0.03);`,
                    x_expand: true,
                });
                cmdBlock.clutter_text.ellipsize = 3;
                expandContent.add_child(cmdBlock);
            }

            // Permission buttons: Deny, Allow, Always, Dismiss
            const buttonRow = new St.BoxLayout({
                style: 'spacing: 6px; margin-top: 10px;',
                x_expand: true,
            });
            buttonRow.add_child(this._makeButton('Deny', RED, `rgba(201,90,90,0.08)`, `rgba(201,90,90,0.2)`, () => {
                this._respond(notif.id, 'deny');
            }));
            buttonRow.add_child(this._makeButton('Allow', GREEN, `rgba(74,158,110,0.08)`, `rgba(74,158,110,0.2)`, () => {
                this._respond(notif.id, 'allow');
            }));
            buttonRow.add_child(this._makeButton('Always', BLUE, `rgba(90,142,201,0.08)`, `rgba(90,142,201,0.2)`, () => {
                this._respond(notif.id, 'always');
            }));
            buttonRow.add_child(this._makeButton('Dismiss', TEXT_DIM, `transparent`, BORDER, () => {
                this._respond(notif.id, 'ask');
            }));
            expandContent.add_child(buttonRow);
        } else if (notif.type === 'question') {
            // Question card: placeholder for page content, built dynamically
            const pageContainer = new St.BoxLayout({
                vertical: true,
                x_expand: true,
                style: 'margin-top: 8px;',
            });
            expandContent.add_child(pageContainer);

            // Nav bar placeholder
            const navBar = new St.BoxLayout({
                style: 'spacing: 6px; margin-top: 10px;',
                x_expand: true,
                x_align: Clutter.ActorAlign.CENTER,
            });
            expandContent.add_child(navBar);
        } else {
            // Notification buttons: Visit, Dismiss
            const buttonRow = new St.BoxLayout({
                style: 'spacing: 6px; margin-top: 10px;',
                x_expand: true,
            });
            buttonRow.add_child(this._makeButton('Visit', ACCENT, `rgba(201,127,74,0.08)`, `rgba(201,127,74,0.2)`, () => {
                if (notif.sessionId && this._onVisitSession) {
                    this._onVisitSession(notif.sessionId);
                }
                this._respond(notif.id, 'visit');
            }));
            buttonRow.add_child(this._makeButton('Dismiss', TEXT_DIM, `transparent`, BORDER, () => {
                this._respond(notif.id, 'dismiss');
            }));
            expandContent.add_child(buttonRow);
        }

        expandWrapper.add_child(expandContent);
        card.add_child(expandWrapper);

        // Progress bar for permission and question cards (shows remaining timeout)
        // Animate scale_x (not width) — St's box layout overrides width on allocation
        let progressBar: St.Widget | null = null;
        let progressTimeoutId: number | null = null;
        if (notif.type === 'permission' || notif.type === 'question') {
            progressBar = new St.Widget({
                style: `background-color: ${ACCENT}; border-radius: 0 0 12px 12px; margin-top: 4px;`,
                height: 3,
                x_expand: true,
                pivot_point: new Graphene.Point({ x: 0, y: 0.5 }),
            });
            card.add_child(progressBar);

            let elapsed = 0;
            const totalTicks = PERMISSION_TIMEOUT_SECS / PROGRESS_TICK_SECS;
            const bar = progressBar;

            // Kick off the first segment immediately — scale_x works even before mapping
            const firstFraction = Math.max(0, 1 - 1 / totalTicks);
            (bar as unknown as Easeable).ease({
                scale_x: firstFraction,
                duration: PROGRESS_TICK_SECS * 1000,
                mode: Clutter.AnimationMode.LINEAR,
            });

            progressTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, PROGRESS_TICK_SECS, () => {
                try {
                    elapsed++;
                    const fraction = Math.max(0, 1 - (elapsed + 1) / totalTicks);
                    (bar as unknown as Easeable).ease({
                        scale_x: fraction,
                        duration: PROGRESS_TICK_SECS * 1000,
                        mode: Clutter.AnimationMode.LINEAR,
                    });
                    if (elapsed + 1 >= totalTicks) return GLib.SOURCE_REMOVE;
                    return GLib.SOURCE_CONTINUE;
                } catch {
                    return GLib.SOURCE_REMOVE;
                }
            });
        }

        // Individual card hover — expand/collapse (always for single card, or when stack is expanded)
        card.connect('enter-event', () => {
            if (this._entries.size > 1 && !this._stackExpanded) return;
            const entry = this._findEntryByCard(card);
            if (!entry) return;
            this._expandCard(entry);
            // Raise hovered card to front so it draws above siblings
            if (this._container) {
                this._container.set_child_above_sibling(card, null);
                // Keep badge on top
                if (this._countBadge) {
                    this._container.set_child_above_sibling(this._countBadge, null);
                }
            }
            this._relayout();
        });
        card.connect('leave-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            // Don't collapse when pointer moves to a child (e.g. a button)
            const related = event.get_related();
            if (related && card.contains(related)) return;

            const entry = this._findEntryByCard(card);
            if (!entry) return;
            this._collapseCard(entry);
            this._relayout();
        });

        return { card, expandWrapper, msgLabel, progressBar, progressTimeoutId };
    }

    private _makeButton(label: string, color: string, bgColor: string, borderColor: string, onClick: () => void): St.Button {
        const btn = new St.Button({
            label,
            style: `font-size: 12px; font-weight: bold; color: ${color}; background-color: ${bgColor}; border-radius: 8px; padding: 8px 16px; border: 1px solid ${borderColor};`,
            reactive: true,
            can_focus: true,
            x_expand: true,
        });
        btn.connect('clicked', () => {
            try {
                onClick();
            } catch (e) {
                console.error('[Kestrel] Error in notification button click:', e);
            }
        });
        return btn;
    }

    private _expandCard(entry: NotifEntry): void {
        if (entry.cardExpanded) return;
        entry.cardExpanded = true;
        // Change card styling to hover state
        entry.card.style = this._cardStyle(true);
        // Unwrap message
        entry.msgLabel.clutter_text.line_wrap = true;
        entry.msgLabel.clutter_text.ellipsize = 0; // NONE

        // Question cards expand wider — animate from right-aligned offset to x=0
        if (entry.notification.type === 'question') {
            (entry.card as unknown as Easeable).ease({
                width: QUESTION_CARD_WIDTH,
                translation_x: 0,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        // Animate expand wrapper height to natural height
        const inner = entry.expandWrapper.get_first_child();
        if (inner) {
            const [, natHeight] = inner.get_preferred_height(-1);
            (entry.expandWrapper as unknown as Easeable).ease({
                height: natHeight,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    private _collapseCard(entry: NotifEntry): void {
        if (!entry.cardExpanded) return;
        entry.cardExpanded = false;
        entry.card.style = this._cardStyle(false);
        entry.msgLabel.clutter_text.line_wrap = false;
        entry.msgLabel.clutter_text.ellipsize = 3; // END

        // Question cards shrink back to right-aligned offset
        if (entry.notification.type === 'question') {
            (entry.card as unknown as Easeable).ease({
                width: CARD_WIDTH,
                translation_x: CARD_RIGHT_OFFSET,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }

        (entry.expandWrapper as unknown as Easeable).ease({
            height: 0,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    private _findEntryByCard(card: St.BoxLayout): NotifEntry | undefined {
        for (const entry of this._entries.values()) {
            if (entry.card === card) return entry;
        }
        return undefined;
    }

    private _respond(id: string, action: string): void {
        const entry = this._entries.get(id);
        if (!entry) return;

        entry.response = action;
        // Cache response so it survives card dismissal (hooks poll after dismiss)
        this._responses.set(id, action);
        this._dismissCard(id);
        this.onEntriesChanged?.();
    }

    private _dismissPreviousForSession(sessionId: string): void {
        if (!sessionId) return;
        const toDismiss: string[] = [];
        for (const [id, entry] of this._entries) {
            if (entry.notification.sessionId === sessionId) {
                // Don't dismiss unanswered permission or question cards
                if ((entry.notification.type === 'permission' || entry.notification.type === 'question') && entry.response === null) continue;
                toDismiss.push(id);
            }
        }
        for (const id of toDismiss) {
            const entry = this._entries.get(id)!;
            this._cleanupEntryTimers(entry);
            this._entries.delete(id);

            (entry.card as unknown as Easeable).ease({
                translation_x: CARD_RIGHT_OFFSET + 60,
                opacity: 0,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    try {
                        entry.card.destroy();
                    } catch (e) {
                        console.error('[Kestrel] Error cleaning up dismissed card:', e);
                    }
                },
            });
        }
        if (toDismiss.length > 0) {
            this._updateCountBadge();
            this._relayout();
        }
    }

    private _dismissCard(id: string): void {
        const entry = this._entries.get(id);
        if (!entry) return;

        this._cleanupEntryTimers(entry);

        // Remove from entries BEFORE animating so _relayout won't override
        // the dismiss animation when the leave-event fires during card movement
        this._entries.delete(id);
        this._updateCountBadge();

        // Auto-expand the next topmost card
        const next = this._entries.values().next().value as NotifEntry | undefined;
        if (next) this._expandCard(next);

        this._relayout();

        (entry.card as unknown as Easeable).ease({
            translation_x: 60,
            scale_x: 0.96,
            scale_y: 0.96,
            opacity: 0,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                try {
                    entry.card.destroy();
                } catch (e) {
                    console.error('[Kestrel] Error cleaning up dismissed card:', e);
                }
            },
        });
    }

    private _updateCountBadge(): void {
        if (!this._countBadge) return;
        const count = this._entries.size;
        this._countBadge.text = String(count);
        this._countBadge.visible = count > 1;
    }

    private _relayout(): void {
        if (!this._container) return;

        const entries = Array.from(this._entries.values());
        const count = entries.length;

        if (this._stackExpanded) {
            // Expanded: all cards stacked vertically, each reactive
            let y = 0;
            for (let i = 0; i < count; i++) {
                const entry = entries[i]!;
                entry.card.reactive = true;
                let cardHeight = COLLAPSED_H;
                if (entry.cardExpanded) {
                    // Don't read entry.card.height — the expandWrapper ease animation
                    // may not have updated the St allocation yet, giving a stale value.
                    // Compute the target height from the expandWrapper content's natural height.
                    const inner = entry.expandWrapper.get_first_child();
                    const expandH = inner ? inner.get_preferred_height(-1)[1] : 0;
                    cardHeight = COLLAPSED_H + expandH;
                }

                // Right-align non-expanded cards; expanded question cards sit at x=0
                const isExpandedQuestion = entry.cardExpanded && entry.notification.type === 'question';
                const tx = isExpandedQuestion ? 0 : CARD_RIGHT_OFFSET;

                (entry.card as unknown as Easeable).ease({
                    translation_y: y,
                    translation_x: tx,
                    scale_x: 1,
                    scale_y: 1,
                    opacity: 255,
                    duration: ANIMATION_DURATION,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });

                y += cardHeight + STACK_OFFSET_Y;
            }

            // Update container height for input events
            this._container.height = y > 0 ? y : -1;
        } else {
            // Collapsed: stack with peek — first (oldest) card in front
            // Cards scale down by STACK_SCALE_STEP per depth, fade by STACK_OPACITY_STEP,
            // and their bottom borders are staggered by STACK_OFFSET_Y pixels.
            for (let i = count - 1; i >= 0; i--) {
                const entry = entries[i]!;
                // Only the front card (first) is reactive
                entry.card.reactive = (i === 0);

                const scale = Math.max(0, 1 - i * STACK_SCALE_STEP);
                const opacity = i > 4 ? 0 : Math.round(255 * Math.max(0, 1 - i * STACK_OPACITY_STEP));

                // Position so bottom borders stagger by STACK_OFFSET_Y each.
                // Front card (i=0): y=0, bottom at COLLAPSED_H.
                // Card i: scaled height = COLLAPSED_H * scale, so
                //   y = (COLLAPSED_H - COLLAPSED_H * scale) + i * STACK_OFFSET_Y
                // This aligns the scaled card's bottom edge STACK_OFFSET_Y * i below the front card's bottom.
                const scaledHeight = COLLAPSED_H * scale;
                const ty = (COLLAPSED_H - scaledHeight) + i * STACK_OFFSET_Y;

                const isExpandedQuestion = entry.cardExpanded && entry.notification.type === 'question';
                const tx = isExpandedQuestion ? 0 : CARD_RIGHT_OFFSET;

                // Pivot from top-center so scale shrinks towards top-right
                entry.card.pivot_point = new Graphene.Point({ x: 0.5, y: 0 });

                (entry.card as unknown as Easeable).ease({
                    translation_y: ty,
                    translation_x: tx,
                    scale_x: scale,
                    scale_y: scale,
                    opacity: Math.max(opacity, 0),
                    duration: ANIMATION_DURATION,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });

                // Raise each card to top; last iteration (i=0) ends up on top
                if (this._container) {
                    this._container.set_child_above_sibling(entry.card, null);
                }
            }
            // Keep badge on top of all cards
            if (this._countBadge && this._container) {
                this._container.set_child_above_sibling(this._countBadge, null);
            }

            const stackHeight = count > 0
                ? COLLAPSED_H + Math.min(count - 1, 4) * STACK_OFFSET_Y
                : 0;
            this._container.height = stackHeight > 0 ? stackHeight : -1;
        }

        // Position count badge top-right
        if (this._countBadge && this._countBadge.visible) {
            this._countBadge.set_position(CARD_RIGHT_OFFSET + CARD_WIDTH - 30, -10);
        }

        this._container.visible = count > 0;
    }

    private _repositionToMonitor(monitor: { x: number; y: number; width: number; height: number }): void {
        if (!this._container) return;
        this._container.set_position(
            monitor.x + monitor.width - QUESTION_CARD_WIDTH - CARD_MARGIN * 2,
            monitor.y + Main.panel.height + CARD_MARGIN,
        );
    }

    private _cleanupEntryTimers(entry: NotifEntry): void {
        if (entry.progressTimeoutId !== null) {
            GLib.source_remove(entry.progressTimeoutId);
            entry.progressTimeoutId = null;
        }
        if (entry.questionState?.autoAdvanceTimeoutId !== null && entry.questionState?.autoAdvanceTimeoutId !== undefined) {
            GLib.source_remove(entry.questionState.autoAdvanceTimeoutId);
            entry.questionState.autoAdvanceTimeoutId = null;
        }
    }

    private _rebuildQuestionPage(entry: NotifEntry): void {
        const qs = entry.questionState;
        if (!qs) return;

        const pageContainer = qs.pageContainer;
        const navBar = qs.navBar;
        if (!pageContainer || !navBar) return;

        // Clear existing content
        pageContainer.destroy_all_children();
        navBar.destroy_all_children();

        const totalPages = qs.questions.length + 1; // +1 for submit page
        const isSubmitPage = qs.currentPage >= qs.questions.length;

        if (isSubmitPage) {
            // Submit page: summary + action buttons
            const summaryLabel = new St.Label({
                text: 'Review answers:',
                style: `font-size: 12px; font-weight: bold; color: ${TEXT}; margin-bottom: 6px;`,
                x_expand: true,
            });
            pageContainer.add_child(summaryLabel);

            for (let i = 0; i < qs.questions.length; i++) {
                const qDef = qs.questions[i];
                const selected = qs.answers.get(i) ?? [];
                const answerText = selected.length > 0 ? selected.join(', ') : '(no answer)';
                const qSummary = new St.Label({
                    text: `${qDef.header}: ${answerText}`,
                    style: `font-size: 11px; color: ${selected.length > 0 ? TEXT_DIM : RED}; margin-left: 4px;`,
                    x_expand: true,
                });
                qSummary.clutter_text.ellipsize = 3;
                pageContainer.add_child(qSummary);
            }

            // Action buttons
            const buttonRow = new St.BoxLayout({
                style: 'spacing: 6px; margin-top: 10px;',
                x_expand: true,
            });

            const allAnswered = qs.questions.every((_, i) => (qs.answers.get(i) ?? []).length > 0);

            buttonRow.add_child(this._makeButton('Send', GREEN,
                allAnswered ? `rgba(74,158,110,0.08)` : `transparent`,
                allAnswered ? `rgba(74,158,110,0.2)` : BORDER,
                () => {
                    if (allAnswered) this.questionSend(entry.notification.id);
                }));
            buttonRow.add_child(this._makeButton('Dismiss', TEXT_DIM, `transparent`, BORDER, () => {
                this.questionDismiss(entry.notification.id);
            }));
            buttonRow.add_child(this._makeButton('Visit', ACCENT, `rgba(201,127,74,0.08)`, `rgba(201,127,74,0.2)`, () => {
                this.questionVisit(entry.notification.id);
            }));
            pageContainer.add_child(buttonRow);
        } else {
            // Question page
            const qDef = qs.questions[qs.currentPage];
            const selected = qs.answers.get(qs.currentPage) ?? [];

            const questionLabel = new St.Label({
                text: qDef.question,
                style: `font-size: 12px; font-weight: bold; color: ${TEXT}; margin-bottom: 8px;`,
                x_expand: true,
            });
            questionLabel.clutter_text.line_wrap = true;
            pageContainer.add_child(questionLabel);

            // Option chips
            for (let i = 0; i < qDef.options.length; i++) {
                const opt = qDef.options[i];
                const isSelected = selected.includes(opt.label);
                const optBtn = this._makeButton(
                    opt.label,
                    isSelected ? TEXT : TEXT_DIM,
                    isSelected ? `rgba(201,127,74,0.12)` : `transparent`,
                    isSelected ? ACCENT : BORDER,
                    () => {
                        this.questionSelectOption(entry.notification.id, qs.currentPage, i);
                    },
                );
                pageContainer.add_child(optBtn);

                // Description below option
                if (opt.description) {
                    const descLabel = new St.Label({
                        text: opt.description,
                        style: `font-size: 10px; color: ${TEXT_DIM}; margin: 2px 0 4px 16px;`,
                        x_expand: true,
                    });
                    descLabel.clutter_text.line_wrap = true;
                    pageContainer.add_child(descLabel);
                }
            }
        }

        // Nav bar: < [dots] >
        const leftArrow = new St.Label({
            text: qs.currentPage > 0 ? '\u25C0' : ' ',
            style: `font-size: 12px; color: ${qs.currentPage > 0 ? ACCENT : 'transparent'}; padding: 4px 8px;`,
            reactive: qs.currentPage > 0,
        });
        if (qs.currentPage > 0) {
            leftArrow.connect('button-press-event', () => {
                this.questionNavigate(entry.notification.id, -1);
                return Clutter.EVENT_STOP;
            });
        }
        navBar.add_child(leftArrow);

        // Page indicator dots
        for (let i = 0; i < totalPages; i++) {
            const isCurrentPage = i === qs.currentPage;
            const isAnswered = i < qs.questions.length && (qs.answers.get(i) ?? []).length > 0;
            const isSubmit = i === qs.questions.length;

            let dotText: string;
            let dotColor: string;
            if (isCurrentPage) {
                dotText = '\u25CF'; // filled circle
                dotColor = ACCENT;
            } else if (isAnswered) {
                dotText = '\u2713'; // checkmark
                dotColor = GREEN;
            } else if (isSubmit) {
                dotText = '\u25CB'; // empty circle
                dotColor = TEXT_DIM;
            } else {
                dotText = '\u25CB';
                dotColor = TEXT_DIM;
            }

            const dot = new St.Label({
                text: dotText,
                style: `font-size: 10px; color: ${dotColor}; padding: 4px 3px;`,
                reactive: true,
            });
            dot.connect('button-press-event', () => {
                qs.currentPage = i;
                this._rebuildQuestionPage(entry);
                return Clutter.EVENT_STOP;
            });
            navBar.add_child(dot);
        }

        const rightArrow = new St.Label({
            text: qs.currentPage < totalPages - 1 ? '\u25B6' : ' ',
            style: `font-size: 12px; color: ${qs.currentPage < totalPages - 1 ? ACCENT : 'transparent'}; padding: 4px 8px;`,
            reactive: qs.currentPage < totalPages - 1,
        });
        if (qs.currentPage < totalPages - 1) {
            rightArrow.connect('button-press-event', () => {
                this.questionNavigate(entry.notification.id, 1);
                return Clutter.EVENT_STOP;
            });
        }
        navBar.add_child(rightArrow);

        // Re-measure expand wrapper if card is expanded
        if (entry.cardExpanded) {
            const inner = entry.expandWrapper.get_first_child();
            if (inner) {
                const [, natHeight] = inner.get_preferred_height(-1);
                (entry.expandWrapper as unknown as Easeable).ease({
                    height: natHeight,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
            }
        }
    }

    private _cardStyle(hovered: boolean): string {
        if (hovered) {
            return `background-color: ${SURFACE_HOVER}; border: 1px solid ${BORDER_HOVER}; border-radius: 12px; padding: 14px 16px; box-shadow: 0 6px 28px rgba(0,0,0,0.35);`;
        }
        return `background-color: ${SURFACE}; border: 1px solid ${BORDER}; border-radius: 12px; padding: 14px 16px;`;
    }
}
