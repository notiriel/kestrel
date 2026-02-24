import type { OverlayNotification } from '../domain/notification-types.js';
import type { NotificationCardDelegate, CardOptions } from './notification-adapter-types.js';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

// Kestrel brand palette
const SURFACE = '#0a0f0c';
const BORDER = '#1c2b2c';
const TEXT = '#e8ede9';
const TEXT_DIM = '#9ca8a0';
const ACCENT = '#62af85';
const GREEN = '#7dd6a4';
const RED = '#c95a5a';
const BLUE = '#5a8ec9';

const CARD_WIDTH = 400;
const PERMISSION_TIMEOUT_SECS = 600;
const PROGRESS_TICK_SECS = 10;

export class PermissionCard implements NotificationCardDelegate {
    readonly actor: St.BoxLayout;
    readonly expandWrapper: Clutter.Actor;
    readonly msgLabel: St.Label;
    readonly progressBar: St.Widget | null;

    private _progressTimeoutId: number | null = null;

    constructor(notification: OverlayNotification, options: CardOptions) {
        // Card root
        this.actor = new St.BoxLayout({
            vertical: true,
            style: `background-color: ${SURFACE}; border: 1px solid ${BORDER}; border-radius: 12px; padding: 14px 16px;`,
            reactive: true,
            width: CARD_WIDTH,
            opacity: 0,
        });

        // Header row: workspace name (bold) left, title right
        const header = new St.BoxLayout({
            style: 'spacing: 8px;',
            x_expand: true,
        });

        if (notification.workspaceName) {
            const wsLabel = new St.Label({
                text: notification.workspaceName,
                style: `font-weight: bold; font-size: 13px; color: ${TEXT};`,
                x_align: Clutter.ActorAlign.START,
            });
            wsLabel.clutter_text.ellipsize = 3; // Pango.EllipsizeMode.END
            header.add_child(wsLabel);
        }

        const titleLabel = new St.Label({
            text: notification.title,
            style: `font-size: 11px; color: ${TEXT_DIM};`,
            x_expand: true,
            x_align: notification.workspaceName ? Clutter.ActorAlign.END : Clutter.ActorAlign.START,
        });
        titleLabel.clutter_text.ellipsize = 3;
        header.add_child(titleLabel);
        this.actor.add_child(header);

        // Message
        this.msgLabel = new St.Label({
            text: notification.message || '',
            style: `font-size: 12px; color: ${TEXT_DIM}; margin-top: 6px;`,
            x_expand: true,
        });
        this.msgLabel.clutter_text.line_wrap = false;
        this.msgLabel.clutter_text.ellipsize = 3;
        this.actor.add_child(this.msgLabel);

        // Expand wrapper
        this.expandWrapper = new Clutter.Actor({
            clip_to_allocation: true,
            height: 0,
            x_expand: true,
        });

        const expandContent = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'padding: 0;',
        });

        // Command block
        if (notification.command) {
            const cmdBlock = new St.Label({
                text: `$ ${notification.command}`,
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
            options.onRespond(notification.id, 'deny');
        }));
        buttonRow.add_child(this._makeButton('Allow', GREEN, `rgba(125,214,164,0.08)`, `rgba(125,214,164,0.2)`, () => {
            options.onRespond(notification.id, 'allow');
        }));
        buttonRow.add_child(this._makeButton('Always', BLUE, `rgba(90,142,201,0.08)`, `rgba(90,142,201,0.2)`, () => {
            options.onRespond(notification.id, 'always');
        }));
        buttonRow.add_child(this._makeButton('Dismiss', TEXT_DIM, `transparent`, BORDER, () => {
            options.onRespond(notification.id, 'ask');
        }));
        expandContent.add_child(buttonRow);

        this.expandWrapper.add_child(expandContent);
        this.actor.add_child(this.expandWrapper);

        // Progress bar
        this.progressBar = new St.Widget({
            style: `background-color: ${ACCENT}; border-radius: 0 0 12px 12px; margin-top: 4px;`,
            height: 3,
            x_expand: true,
            pivot_point: new Graphene.Point({ x: 0, y: 0.5 }),
        });
        this.actor.add_child(this.progressBar);

        // Progress timer
        let elapsed = 0;
        const totalTicks = PERMISSION_TIMEOUT_SECS / PROGRESS_TICK_SECS;
        const bar = this.progressBar;

        const firstFraction = Math.max(0, 1 - 1 / totalTicks);
        (bar as unknown as Easeable).ease({
            scale_x: firstFraction,
            duration: PROGRESS_TICK_SECS * 1000,
            mode: Clutter.AnimationMode.LINEAR,
        });

        this._progressTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, PROGRESS_TICK_SECS, () => {
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

    destroy(): void {
        if (this._progressTimeoutId !== null) {
            GLib.source_remove(this._progressTimeoutId);
            this._progressTimeoutId = null;
        }
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
                console.error('[Kestrel] Error in permission button click:', e);
            }
        });
        return btn;
    }
}
