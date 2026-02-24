import type { OverlayNotification, QuestionDefinition } from '../domain/notification-types.js';
import type { NotificationCardDelegate, VisitableCardOptions, QuestionState } from './notification-adapter-types.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Graphene from 'gi://Graphene';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

// Kestrel brand palette
const SURFACE = '#0a0f0c';
const SURFACE_HOVER = '#0f1612';
const BORDER = '#1c2b2c';
const TEXT = '#e8ede9';
const TEXT_DIM = '#9ca8a0';
const TEXT_MUTED = '#6b7a6f';
const ACCENT = '#62af85';
const GREEN = '#7dd6a4';
const RED = '#c95a5a';
const WARNING = '#f59e0b';

const QUESTION_CARD_WIDTH = 600;
const FOCUS_MODE_CARD_WIDTH = 480;
const ANIMATION_DURATION = 300;
const AUTO_ADVANCE_DELAY = 300;
const PERMISSION_TIMEOUT_SECS = 600;

interface ParsedOption {
    label: string;
    rawLabel: string;
    description: string;
    isRecommended: boolean;
}

interface ParsedQuestion {
    question: string;
    header: string;
    options: ParsedOption[];
    multiSelect: boolean;
}

export class QuestionCard implements NotificationCardDelegate {
    readonly actor: St.BoxLayout;
    readonly expandWrapper: Clutter.Actor;
    readonly msgLabel: St.Label;
    readonly progressBar: St.Widget | null;

    private _notification: OverlayNotification;
    private _options: VisitableCardOptions;
    private _questions: ParsedQuestion[];
    private _currentPage: number = 0;
    private _answers: Map<number, string[]> = new Map();
    private _otherTexts: Map<number, string> = new Map();
    private _otherActive: Map<number, boolean> = new Map();
    private _pageContainer: St.BoxLayout;
    private _footerBar: St.BoxLayout;
    private _timerLabel: St.Label;
    private _timeoutBar: St.Widget;
    private _timeoutOverlay: St.Widget | null = null;
    private _autoAdvanceTimeoutId: number | null = null;
    private _timerTimeoutId: number | null = null;
    private _pulseTimeoutId: number | null = null;
    private _remainingSeconds: number;
    private _timedOut: boolean = false;
    private _extensionPath: string;
    private _focusMode: boolean = false;
    private _workspaceName: string | undefined;
    private _title: string;
    private _titleLabel: St.Label;

    constructor(notification: OverlayNotification, options: VisitableCardOptions, focusMode?: boolean) {
        this._notification = notification;
        this._options = options;
        this._extensionPath = options.extensionPath;
        this._remainingSeconds = PERMISSION_TIMEOUT_SECS;
        this._workspaceName = notification.workspaceName;
        this._title = notification.title;
        this._focusMode = focusMode ?? false;

        // Parse questions
        this._questions = (notification.questions ?? []).map(q => this._parseQuestion(q));

        // Card root — clip_to_allocation only in overlay mode (for collapse animation);
        // focus mode uses fixed positioning where clipping would hide content.
        this.actor = new St.BoxLayout({
            vertical: true,
            style: `background-color: ${SURFACE}; border: 1px solid ${BORDER}; border-radius: 12px; padding: 0;`,
            reactive: true,
            width: this._focusMode ? FOCUS_MODE_CARD_WIDTH : QUESTION_CARD_WIDTH,
            opacity: this._focusMode ? 255 : 0,
            clip_to_allocation: !this._focusMode,
        });

        // Timeout bar track at top
        const timeoutTrack = new St.Widget({
            style: 'background-color: rgba(255,255,255,0.04);',
            height: 3,
            x_expand: true,
        });
        this._timeoutBar = new St.Widget({
            style: `background-color: ${ACCENT};`,
            height: 3,
            x_expand: true,
            pivot_point: new Graphene.Point({ x: 0, y: 0.5 }),
        });
        timeoutTrack.add_child(this._timeoutBar);
        this.actor.add_child(timeoutTrack);

        // Header
        const headerBox = new St.BoxLayout({
            style: `padding: 14px 18px 10px; border-bottom: 1px solid ${BORDER};`,
            x_expand: true,
        });

        // Question icon
        const iconBg = new St.Bin({
            style: `background-color: rgba(98,175,133,0.08); border: 1px solid rgba(98,175,133,0.15); border-radius: 7px; min-width: 28px; min-height: 28px;`,
            child: new St.Icon({
                gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this._extensionPath}/data/question-icon.svg`) }) as any,
                icon_size: 14,
                style: `color: ${ACCENT};`,
            }),
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(iconBg);

        this._titleLabel = new St.Label({
            text: this._title,
            style: `font-size: 13px; font-weight: bold; color: ${TEXT_DIM}; margin-left: 10px;`,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(this._titleLabel);

        // Workspace label (right-aligned, monospace)
        if (this._workspaceName) {
            const wsLabel = new St.Label({
                text: this._workspaceName,
                style: `font-family: monospace; font-size: 11px; color: ${TEXT_DIM}; margin-right: 8px;`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            headerBox.add_child(wsLabel);
        }

        // Timer pill
        this._timerLabel = new St.Label({
            text: `${this._remainingSeconds}s`,
            style: `font-family: monospace; font-size: 12px; font-weight: bold; color: ${TEXT_MUTED}; background-color: rgba(255,255,255,0.03); padding: 4px 10px; border-radius: 20px; border: 1px solid ${BORDER}; min-width: 48px; text-align: center;`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        headerBox.add_child(this._timerLabel);
        this.actor.add_child(headerBox);

        // Message (hidden in collapsed view, shown as part of card)
        this.msgLabel = new St.Label({
            text: notification.message || '',
            style: `font-size: 12px; color: ${TEXT_DIM}; padding: 0 18px; margin-top: 6px;`,
            x_expand: true,
            visible: this._focusMode ? !!notification.message : false,
        });
        this.msgLabel.clutter_text.line_wrap = this._focusMode;
        this.msgLabel.clutter_text.ellipsize = this._focusMode ? 0 : 3;
        this.actor.add_child(this.msgLabel);

        // Expand wrapper — must be St.BoxLayout (not raw Clutter.Actor) so children
        // with x_expand actually get allocated the full card width.
        // In focus mode, height is set to -1 (natural) so content shows immediately.
        this.expandWrapper = new St.BoxLayout({
            vertical: true,
            clip_to_allocation: !this._focusMode,
            height: this._focusMode ? -1 : 0,
            x_expand: true,
        });

        const expandContent = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 0;',
        });

        // Page container (question pages rendered here)
        this._pageContainer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 16px 18px 8px;',
        });
        expandContent.add_child(this._pageContainer);

        // Footer: step dots + nav buttons
        this._footerBar = new St.BoxLayout({
            style: `padding: 12px 18px 14px; border-top: 1px solid ${BORDER};`,
            x_expand: true,
        });
        expandContent.add_child(this._footerBar);

        this.expandWrapper.add_child(expandContent);
        this.actor.add_child(this.expandWrapper);

        // No bottom progress bar for question cards — we have the top timeout bar instead
        this.progressBar = null;

        // Build initial page
        this._rebuildPage();

        // Start timer (only for overlay cards — focus mode cards are display-only)
        if (!this._focusMode) {
            this._startTimer();
        }
    }

    // --- Public API for focus mode ---

    get currentPage(): number { return this._currentPage; }
    get answers(): ReadonlyMap<number, readonly string[]> { return this._answers; }
    get questions(): readonly ParsedQuestion[] { return this._questions; }
    get focusMode(): boolean { return this._focusMode; }

    /** Copy answer/navigation state from the source (overlay) card and rebuild. */
    syncState(source: QuestionCard): void {
        this._currentPage = source._currentPage;
        this._answers = new Map(source._answers);
        this._otherTexts = new Map(source._otherTexts);
        this._otherActive = new Map(source._otherActive);
        this._rebuildPage();
    }

    get questionState(): QuestionState {
        return {
            currentPage: this._currentPage,
            answers: this._answers,
            otherActive: this._otherActive,
            questions: this._notification.questions ?? [],
            pageContainer: this._pageContainer,
            navBar: this._footerBar,
            autoAdvanceTimeoutId: this._autoAdvanceTimeoutId,
        };
    }

    navigate(delta: number): void {
        const totalPages = this._questions.length + 1;
        const newPage = Math.max(0, Math.min(totalPages - 1, this._currentPage + delta));
        if (newPage === this._currentPage) return;
        const direction = delta > 0 ? 'forward' : 'back';
        this._currentPage = newPage;
        this._rebuildPage(direction);
    }

    selectOption(questionIndex: number, optionIndex: number): void {
        const qDef = this._questions[questionIndex];
        if (!qDef) return;

        // optionIndex === qDef.options.length means "Other"
        const isOther = optionIndex === qDef.options.length;
        const current = [...(this._answers.get(questionIndex) ?? [])];

        if (isOther) {
            // Select "Other", deselect everything else
            this._otherActive.set(questionIndex, true);
            const otherText = this._otherTexts.get(questionIndex) ?? '';
            this._answers.set(questionIndex, otherText ? [otherText] : []);
        } else if (qDef.multiSelect) {
            const label = qDef.options[optionIndex].label;
            // Deselect "Other" when picking a regular option
            this._otherActive.delete(questionIndex);
            this._otherTexts.delete(questionIndex);
            if (current.includes(label)) {
                this._answers.set(questionIndex, current.filter(l => l !== label));
            } else {
                // Remove any "Other" answer
                const regularLabels = qDef.options.map(o => o.label);
                const filtered = current.filter(l => regularLabels.includes(l));
                this._answers.set(questionIndex, [...filtered, label]);
            }
        } else {
            if (optionIndex < 0 || optionIndex >= qDef.options.length) return;
            const label = qDef.options[optionIndex].label;
            // Deselect "Other" when picking a regular option
            this._otherActive.delete(questionIndex);
            this._otherTexts.delete(questionIndex);
            this._answers.set(questionIndex, [label]);
        }

        this._rebuildPage();

        // Auto-advance for single-select (not for "Other")
        if (!qDef.multiSelect && !isOther && this._currentPage < this._questions.length) {
            this._scheduleAutoAdvance();
        }
    }

    setOtherText(questionIndex: number, text: string): void {
        this._otherTexts.set(questionIndex, text);
        if (text.trim()) {
            this._answers.set(questionIndex, [text.trim()]);
        } else {
            this._answers.set(questionIndex, []);
        }
        this._rebuildPage();
    }

    send(): void {
        if (this._timedOut) return;
        const answersObj: Record<string, string> = {};
        for (const [qIdx, labels] of this._answers) {
            if (qIdx < this._questions.length) {
                answersObj[this._questions[qIdx].question] = labels.join(', ');
            }
        }
        this._options.onRespond(this._notification.id, `allow:${JSON.stringify(answersObj)}`);
    }

    dismiss(): void {
        this._options.onRespond(this._notification.id, 'allow');
    }

    visit(): void {
        if (this._notification.sessionId && this._options.onVisitSession) {
            this._options.onVisitSession(this._notification.sessionId);
        }
        this._options.onRespond(this._notification.id, 'allow');
    }

    destroy(): void {
        if (this._autoAdvanceTimeoutId !== null) {
            GLib.source_remove(this._autoAdvanceTimeoutId);
            this._autoAdvanceTimeoutId = null;
        }
        if (this._timerTimeoutId !== null) {
            GLib.source_remove(this._timerTimeoutId);
            this._timerTimeoutId = null;
        }
        if (this._pulseTimeoutId !== null) {
            GLib.source_remove(this._pulseTimeoutId);
            this._pulseTimeoutId = null;
        }
    }

    // --- Private ---

    private _parseQuestion(q: QuestionDefinition): ParsedQuestion {
        const options: ParsedOption[] = q.options.map(opt => {
            const isRecommended = /\(Recommended\)\s*$/i.test(opt.label);
            const cleanLabel = opt.label.replace(/\s*\(Recommended\)\s*$/i, '').trim();
            return {
                label: cleanLabel,
                rawLabel: opt.label,
                description: opt.description,
                isRecommended,
            };
        });
        return {
            question: q.question,
            header: q.header,
            options,
            multiSelect: q.multiSelect,
        };
    }

    private _rebuildPage(direction?: 'forward' | 'back'): void {
        // Clear existing content
        this._pageContainer.destroy_all_children();
        this._footerBar.destroy_all_children();

        const totalPages = this._questions.length + 1;
        const isSubmitPage = this._currentPage >= this._questions.length;

        if (isSubmitPage) {
            this._buildSummaryPage();
        } else {
            this._buildQuestionPage(this._currentPage);
        }

        this._buildFooter(totalPages);

        // Re-measure expand wrapper if parent is tracking
        this._remeasureExpandWrapper();
    }

    private _buildQuestionPage(pageIndex: number): void {
        const q = this._questions[pageIndex];
        const selected = this._answers.get(pageIndex) ?? [];
        const otherText = this._otherTexts.get(pageIndex) ?? '';
        const isOtherSelected = this._otherActive.get(pageIndex) === true;

        // Badge: HEADER · Q1/N
        const badge = new St.Label({
            text: `${q.header.toUpperCase()} \u00b7 Q${pageIndex + 1}/${this._questions.length}`,
            style: `font-family: monospace; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.08em; color: ${ACCENT}; background-color: rgba(98,175,133,0.08); padding: 4px 10px; border-radius: 4px; margin-bottom: 10px;`,
        });
        this._pageContainer.add_child(badge);

        // Question text
        const qLabel = new St.Label({
            text: q.question,
            style: `font-size: 16px; font-weight: bold; color: ${TEXT}; margin-bottom: 6px;`,
            x_expand: true,
        });
        qLabel.clutter_text.line_wrap = true;
        this._pageContainer.add_child(qLabel);

        // Hint
        const hint = new St.Label({
            text: q.multiSelect ? 'Select one or more options' : 'Select one option',
            style: `font-size: 12px; color: ${TEXT_MUTED}; margin-bottom: 14px;`,
        });
        this._pageContainer.add_child(hint);

        // Options
        for (let i = 0; i < q.options.length; i++) {
            const opt = q.options[i];
            const isSelected = selected.includes(opt.label);
            this._pageContainer.add_child(this._buildOptionRow(
                opt, isSelected, q.multiSelect, pageIndex, i,
            ));
        }

        // "Other" option
        this._buildOtherOption(q, pageIndex, isOtherSelected, otherText);
    }

    private _buildOptionRow(
        opt: ParsedOption,
        isSelected: boolean,
        multiSelect: boolean,
        qIndex: number,
        optIndex: number,
    ): St.BoxLayout {
        // Determine styling
        let bgColor = 'rgba(26,28,42,0.5)';
        let borderColor = 'rgba(255,255,255,0.08)';

        if (opt.isRecommended && isSelected) {
            bgColor = 'rgba(125,214,164,0.12)';
            borderColor = 'rgba(125,214,164,0.3)';
        } else if (opt.isRecommended) {
            bgColor = 'rgba(125,214,164,0.04)';
            borderColor = 'rgba(125,214,164,0.2)';
        } else if (isSelected) {
            bgColor = 'rgba(98,175,133,0.1)';
            borderColor = 'rgba(98,175,133,0.4)';
        }

        const row = new St.BoxLayout({
            style: `background-color: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;`,
            reactive: true,
            x_expand: true,
        });

        // Shortcut badge in focus mode
        if (this._focusMode) {
            const badge = new St.Label({
                text: `(${optIndex + 1})`,
                style: `font-family: monospace; font-size: 11px; font-weight: bold; color: ${TEXT_MUTED}; background-color: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; margin-right: 8px; min-width: 28px; text-align: center;`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            row.add_child(badge);
        }

        // Radio/checkbox indicator
        const indicatorSvg = this._getIndicatorSvg(multiSelect, isSelected, opt.isRecommended);
        const indicatorIcon = new St.Icon({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this._extensionPath}/data/${indicatorSvg}`) }) as any,
            icon_size: 18,
            style: `color: ${isSelected ? (opt.isRecommended ? GREEN : ACCENT) : TEXT_MUTED}; margin-right: 10px; margin-top: 1px;`,
        });
        row.add_child(indicatorIcon);

        // Content column
        const content = new St.BoxLayout({
            vertical: true,
            x_expand: true,
        });

        // Label row with recommended tag
        const labelRow = new St.BoxLayout({
            style: 'spacing: 8px;',
            x_expand: true,
        });
        const label = new St.Label({
            text: opt.label,
            style: `font-size: 14px; font-weight: bold; color: ${TEXT};`,
        });
        labelRow.add_child(label);

        if (opt.isRecommended) {
            const tag = new St.Label({
                text: 'RECOMMENDED',
                style: `font-family: monospace; font-size: 9px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.06em; color: ${GREEN}; background-color: rgba(125,214,164,0.1); padding: 2px 7px; border-radius: 3px;`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            labelRow.add_child(tag);
        }
        content.add_child(labelRow);

        if (opt.description) {
            const desc = new St.Label({
                text: opt.description,
                style: `font-size: 12px; color: ${TEXT_DIM}; margin-top: 3px;`,
                x_expand: true,
            });
            desc.clutter_text.line_wrap = true;
            content.add_child(desc);
        }
        row.add_child(content);

        // Hover effects
        row.connect('enter-event', () => {
            if (!isSelected) {
                row.style = `background-color: rgba(34,36,56,0.6); border: 1px solid rgba(255,255,255,0.12); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;`;
            }
        });
        row.connect('leave-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            const related = event.get_related();
            if (related && row.contains(related)) return;
            row.style = `background-color: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;`;
        });

        // Click handler
        row.connect('button-press-event', () => {
            this.selectOption(qIndex, optIndex);
            return Clutter.EVENT_STOP;
        });

        return row;
    }

    private _buildOtherOption(q: ParsedQuestion, qIndex: number, isSelected: boolean, otherText: string): void {
        const bgColor = isSelected ? 'rgba(98,175,133,0.1)' : 'rgba(26,28,42,0.5)';
        const borderColor = isSelected ? 'rgba(98,175,133,0.4)' : 'rgba(255,255,255,0.08)';

        const row = new St.BoxLayout({
            vertical: true,
            style: `background-color: ${bgColor}; border: 1px solid ${borderColor}; border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;`,
            reactive: true,
            x_expand: true,
        });

        const topRow = new St.BoxLayout({
            x_expand: true,
        });

        // Shortcut badge in focus mode
        if (this._focusMode) {
            const badge = new St.Label({
                text: `(${q.options.length + 1})`,
                style: `font-family: monospace; font-size: 11px; font-weight: bold; color: ${TEXT_MUTED}; background-color: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; margin-right: 8px; min-width: 28px; text-align: center;`,
                y_align: Clutter.ActorAlign.CENTER,
            });
            topRow.add_child(badge);
        }

        const indicatorSvg = this._getIndicatorSvg(q.multiSelect, isSelected, false);
        const indicatorIcon = new St.Icon({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this._extensionPath}/data/${indicatorSvg}`) }) as any,
            icon_size: 18,
            style: `color: ${isSelected ? ACCENT : TEXT_MUTED}; margin-right: 10px; margin-top: 1px;`,
        });
        topRow.add_child(indicatorIcon);

        const label = new St.Label({
            text: 'Other',
            style: `font-size: 14px; font-weight: bold; color: ${TEXT};`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        topRow.add_child(label);
        row.add_child(topRow);

        // Text entry (visible when selected)
        if (isSelected) {
            const entry = new St.Entry({
                hint_text: 'Type your answer\u2026',
                text: otherText,
                style: `font-size: 13px; color: ${TEXT}; background-color: rgba(10,15,12,0.8); border: 1px solid ${BORDER}; border-radius: 6px; padding: 8px 12px; margin-top: 8px; margin-left: 28px;`,
                x_expand: true,
            });

            entry.clutter_text.connect('text-changed', () => {
                try {
                    const text = entry.get_text();
                    this.setOtherText(qIndex, text);
                } catch (e) {
                    console.error('[Kestrel] Error in other text changed:', e);
                }
            });

            row.add_child(entry);

            // Focus the entry
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                try {
                    (global.stage as any).set_key_focus(entry.clutter_text);
                } catch { /* may be gone */ }
                return GLib.SOURCE_REMOVE;
            });
        }

        // Click handler
        row.connect('button-press-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            // Don't handle if clicking inside the entry
            const source = event.get_source();
            if (source instanceof St.Entry || (source as Clutter.Actor)?.get_parent?.() instanceof St.Entry) {
                return Clutter.EVENT_PROPAGATE;
            }
            this.selectOption(qIndex, q.options.length); // "Other" index
            return Clutter.EVENT_STOP;
        });

        this._pageContainer.add_child(row);
    }

    private _buildSummaryPage(): void {
        // Summary badge
        const badge = new St.Label({
            text: 'REVIEW \u00b7 SUMMARY',
            style: `font-family: monospace; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.08em; color: ${GREEN}; background-color: rgba(125,214,164,0.08); padding: 4px 10px; border-radius: 4px; margin-bottom: 10px;`,
        });
        this._pageContainer.add_child(badge);

        const title = new St.Label({
            text: 'Review your answers',
            style: `font-size: 16px; font-weight: bold; color: ${TEXT}; margin-bottom: 6px;`,
        });
        this._pageContainer.add_child(title);

        const hint = new St.Label({
            text: 'Click "Edit" to go back and change an answer',
            style: `font-size: 12px; color: ${TEXT_MUTED}; margin-bottom: 14px;`,
        });
        this._pageContainer.add_child(hint);

        // Summary items
        for (let i = 0; i < this._questions.length; i++) {
            const q = this._questions[i];
            const selected = this._answers.get(i) ?? [];
            const answerText = selected.length > 0 ? selected.join(', ') : '\u2014';

            const item = new St.BoxLayout({
                vertical: true,
                style: `background-color: rgba(26,28,42,0.5); border: 1px solid rgba(255,255,255,0.08); border-radius: 6px; padding: 12px 14px; margin-bottom: 10px;`,
                x_expand: true,
            });

            const headerText = new St.Label({
                text: q.header.toUpperCase(),
                style: `font-family: monospace; font-size: 10px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.06em; color: ${TEXT_MUTED}; margin-bottom: 4px;`,
            });
            item.add_child(headerText);

            const questionText = new St.Label({
                text: q.question,
                style: `font-size: 13px; color: ${TEXT_DIM}; margin-bottom: 6px;`,
                x_expand: true,
            });
            questionText.clutter_text.line_wrap = true;
            item.add_child(questionText);

            const answerLabel = new St.Label({
                text: answerText,
                style: `font-size: 14px; font-weight: bold; color: ${selected.length > 0 ? ACCENT : RED};`,
            });
            item.add_child(answerLabel);

            // Edit link
            const editLink = new St.Label({
                text: 'Edit \u2197',
                style: `font-size: 11px; color: ${TEXT_MUTED}; margin-top: 4px;`,
                reactive: true,
            });
            editLink.connect('enter-event', () => {
                editLink.style = `font-size: 11px; color: ${ACCENT}; margin-top: 4px;`;
            });
            editLink.connect('leave-event', () => {
                editLink.style = `font-size: 11px; color: ${TEXT_MUTED}; margin-top: 4px;`;
            });
            const pageTarget = i;
            editLink.connect('button-press-event', () => {
                this._currentPage = pageTarget;
                this._rebuildPage('back');
                return Clutter.EVENT_STOP;
            });
            item.add_child(editLink);

            this._pageContainer.add_child(item);
        }
    }

    private _buildFooter(totalPages: number): void {
        const isSubmitPage = this._currentPage >= this._questions.length;

        // Step dots (left side)
        const dotsBox = new St.BoxLayout({
            style: 'spacing: 6px;',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        for (let i = 0; i < totalPages; i++) {
            const isCurrent = i === this._currentPage;
            const isAnswered = i < this._questions.length && (this._answers.get(i) ?? []).length > 0;
            const isSummary = i === this._questions.length;

            let dotStyle: string;
            if (isCurrent) {
                const color = isSummary ? GREEN : ACCENT;
                dotStyle = `background-color: ${color}; border-radius: 3px; min-width: 18px; min-height: 6px;`;
            } else if (isAnswered) {
                dotStyle = `background-color: ${ACCENT}; border-radius: 50%; min-width: 6px; min-height: 6px; opacity: 153;`;
            } else {
                dotStyle = `background-color: ${TEXT_MUTED}; border-radius: 50%; min-width: 6px; min-height: 6px; opacity: 76;`;
            }

            const dot = new St.Widget({
                style: dotStyle,
                reactive: true,
            });
            const targetPage = i;
            dot.connect('button-press-event', () => {
                this._currentPage = targetPage;
                this._rebuildPage(targetPage < this._currentPage ? 'back' : 'forward');
                return Clutter.EVENT_STOP;
            });
            dotsBox.add_child(dot);
        }
        this._footerBar.add_child(dotsBox);

        // Nav buttons (right side)
        const navBox = new St.BoxLayout({
            style: 'spacing: 8px;',
            x_align: Clutter.ActorAlign.END,
        });

        if (isSubmitPage) {
            // Abort button
            navBox.add_child(this._makeNavButton(
                this._focusMode ? '(2) Abort' : 'Abort', 'abort', () => {
                    this.dismiss();
                }));

            // Submit button
            const allAnswered = this._questions.every((_, i) => (this._answers.get(i) ?? []).length > 0);
            navBox.add_child(this._makeNavButton(
                this._focusMode ? '(1) Submit' : 'Submit', 'submit', () => {
                    if (allAnswered) this.send();
                }, !allAnswered));

            // Visit button (focus mode only, on submit page)
            if (this._focusMode) {
                navBox.add_child(this._makeNavButton('(3) Visit', 'ghost', () => {
                    this.visit();
                }));
            }
        } else {
            // Back button (hidden on first page)
            if (this._currentPage > 0) {
                navBox.add_child(this._makeNavButton('Back', 'ghost', () => {
                    this.navigate(-1);
                }));
            }

            // Next/Review button
            const isLastQuestion = this._currentPage === this._questions.length - 1;
            const hasAnswer = (this._answers.get(this._currentPage) ?? []).length > 0;
            navBox.add_child(this._makeNavButton(
                isLastQuestion ? 'Review' : 'Next',
                'primary',
                () => { this.navigate(1); },
                !hasAnswer,
            ));
        }
        this._footerBar.add_child(navBox);
    }

    private _makeNavButton(label: string, variant: 'ghost' | 'primary' | 'submit' | 'abort', onClick: () => void, disabled?: boolean): St.Button {
        let style: string;
        switch (variant) {
            case 'primary':
                style = disabled
                    ? `font-size: 13px; font-weight: bold; color: rgba(255,255,255,0.35); background-color: rgba(98,175,133,0.35); border-radius: 6px; padding: 7px 18px; border: 1px solid rgba(98,175,133,0.35);`
                    : `font-size: 13px; font-weight: bold; color: #fff; background-color: ${ACCENT}; border-radius: 6px; padding: 7px 18px; border: 1px solid ${ACCENT};`;
                break;
            case 'submit':
                style = disabled
                    ? `font-size: 13px; font-weight: bold; color: rgba(10,15,12,0.35); background-color: rgba(125,214,164,0.35); border-radius: 6px; padding: 7px 18px; border: 1px solid rgba(125,214,164,0.35);`
                    : `font-size: 13px; font-weight: bold; color: ${SURFACE}; background-color: ${GREEN}; border-radius: 6px; padding: 7px 18px; border: 1px solid ${GREEN};`;
                break;
            case 'abort':
                style = `font-size: 13px; font-weight: bold; color: ${RED}; background-color: rgba(201,90,90,0.06); border-radius: 6px; padding: 7px 18px; border: 1px solid rgba(201,90,90,0.25);`;
                break;
            default: // ghost
                style = `font-size: 13px; font-weight: bold; color: ${TEXT_DIM}; background-color: transparent; border-radius: 6px; padding: 7px 18px; border: 1px solid rgba(255,255,255,0.08);`;
                break;
        }

        const btn = new St.Button({
            label,
            style,
            reactive: !disabled,
            can_focus: !disabled,
        });

        if (!disabled) {
            btn.connect('clicked', () => {
                try {
                    onClick();
                } catch (e) {
                    console.error('[Kestrel] Error in question nav button:', e);
                }
            });
        }

        return btn;
    }

    private _getIndicatorSvg(multiSelect: boolean, isSelected: boolean, _isRecommended: boolean): string {
        if (multiSelect) {
            return isSelected ? 'checkbox-checked.svg' : 'checkbox-unchecked.svg';
        }
        return isSelected ? 'radio-checked.svg' : 'radio-unchecked.svg';
    }

    private _scheduleAutoAdvance(): void {
        if (this._autoAdvanceTimeoutId !== null) {
            GLib.source_remove(this._autoAdvanceTimeoutId);
        }
        this._autoAdvanceTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, AUTO_ADVANCE_DELAY, () => {
            this._autoAdvanceTimeoutId = null;
            if (this._currentPage < this._questions.length) {
                this._currentPage++;
                this._rebuildPage('forward');
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    private _startTimer(): void {
        this._timerTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            try {
                this._remainingSeconds--;
                if (this._remainingSeconds <= 0) {
                    this._onTimeout();
                    return GLib.SOURCE_REMOVE;
                }

                // Update bar
                const fraction = this._remainingSeconds / PERMISSION_TIMEOUT_SECS;
                (this._timeoutBar as unknown as Easeable).ease({
                    scale_x: fraction,
                    duration: 1000,
                    mode: Clutter.AnimationMode.LINEAR,
                });

                // Update timer label
                this._timerLabel.text = `${this._remainingSeconds}s`;

                // Update colors based on remaining time
                if (this._remainingSeconds <= 5) {
                    this._timeoutBar.style = `background-color: ${RED};`;
                    this._timerLabel.style = `font-family: monospace; font-size: 12px; font-weight: bold; color: ${RED}; background-color: rgba(239,68,68,0.08); padding: 4px 10px; border-radius: 20px; border: 1px solid rgba(239,68,68,0.3); min-width: 48px; text-align: center;`;
                    // Start pulsing
                    if (this._pulseTimeoutId === null) {
                        let pulseState = false;
                        this._pulseTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
                            try {
                                pulseState = !pulseState;
                                this._timeoutBar.opacity = pulseState ? 153 : 255;
                            } catch {
                                return GLib.SOURCE_REMOVE;
                            }
                            return GLib.SOURCE_CONTINUE;
                        });
                    }
                } else if (this._remainingSeconds <= 15) {
                    this._timeoutBar.style = `background-color: ${WARNING};`;
                    this._timerLabel.style = `font-family: monospace; font-size: 12px; font-weight: bold; color: ${WARNING}; background-color: rgba(245,158,11,0.06); padding: 4px 10px; border-radius: 20px; border: 1px solid rgba(245,158,11,0.25); min-width: 48px; text-align: center;`;
                }

                return GLib.SOURCE_CONTINUE;
            } catch {
                return GLib.SOURCE_REMOVE;
            }
        });
    }

    private _onTimeout(): void {
        this._timedOut = true;

        // Stop pulse
        if (this._pulseTimeoutId !== null) {
            GLib.source_remove(this._pulseTimeoutId);
            this._pulseTimeoutId = null;
        }

        // Show timeout overlay
        this._timeoutOverlay = new St.Widget({
            style: `background-color: rgba(10,15,12,0.92); border-radius: 12px;`,
            reactive: true,
            x_expand: true,
            y_expand: true,
        });

        const overlayContent = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });

        const clockIcon = new St.Icon({
            gicon: new Gio.FileIcon({ file: Gio.File.new_for_path(`${this._extensionPath}/data/timeout-clock.svg`) }) as any,
            icon_size: 28,
            style: `color: ${TEXT_DIM}; margin-bottom: 8px;`,
            x_align: Clutter.ActorAlign.CENTER,
        });
        overlayContent.add_child(clockIcon);

        overlayContent.add_child(new St.Label({
            text: 'Time expired',
            style: `font-size: 15px; font-weight: bold; color: ${TEXT_DIM}; text-align: center;`,
            x_align: Clutter.ActorAlign.CENTER,
        }));

        overlayContent.add_child(new St.Label({
            text: 'The request has been automatically aborted.',
            style: `font-size: 12px; color: ${TEXT_MUTED}; text-align: center;`,
            x_align: Clutter.ActorAlign.CENTER,
        }));

        this._timeoutOverlay.add_child(overlayContent);

        // Add overlay on top of everything in the card
        this.actor.add_child(this._timeoutOverlay);

        // Position overlay to cover the whole card
        this._timeoutOverlay.set_position(0, 0);
        this._timeoutOverlay.set_size(this.actor.width, this.actor.height);

        // Fade in
        this._timeoutOverlay.opacity = 0;
        (this._timeoutOverlay as unknown as Easeable).ease({
            opacity: 255,
            duration: 300,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        // Auto-dismiss after timeout
        this.dismiss();
    }

    private _remeasureExpandWrapper(): void {
        if (this._focusMode) {
            // In focus mode, expandWrapper uses natural height (-1) — no override needed.
            return;
        }

        const inner = this.expandWrapper.get_first_child();
        if (!inner) return;

        if (this.expandWrapper.height > 0) {
            const [, natHeight] = inner.get_preferred_height(-1);
            (this.expandWrapper as unknown as Easeable).ease({
                height: natHeight,
                duration: 200,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }
}
