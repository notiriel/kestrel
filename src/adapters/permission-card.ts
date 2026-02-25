import type { OverlayNotification } from '../domain/notification-types.js';
import type { NotificationCardDelegate, CardOptions } from './notification-adapter-types.js';
import Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import { ACCENT, TEXT_DIM, BORDER, buildCardSkeleton, makeButton } from './card-base.js';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

const GREEN = '#7dd6a4';
const RED = '#c95a5a';
const BLUE = '#5a8ec9';

const PERMISSION_TIMEOUT_SECS = 600;
const PROGRESS_TICK_SECS = 10;

export class PermissionCard implements NotificationCardDelegate {
    readonly actor: St.BoxLayout;
    readonly expandWrapper: Clutter.Actor;
    readonly msgLabel: St.Label;
    readonly progressBar: St.Widget | null;

    private _progressTimeoutId: number | null = null;

    constructor(notification: OverlayNotification, options: CardOptions) {
        const skeleton = buildCardSkeleton(notification);
        this.actor = skeleton.actor;
        this.expandWrapper = skeleton.expandWrapper;
        this.msgLabel = skeleton.msgLabel;

        // Command block
        if (notification.command) {
            const cmdBlock = new St.Label({
                text: `$ ${notification.command}`,
                style: `font-family: monospace; font-size: 11px; color: ${ACCENT}; background-color: rgba(0,0,0,0.35); border-radius: 8px; padding: 7px 11px; margin-top: 10px; border: 1px solid rgba(255,255,255,0.03);`,
                x_expand: true,
            });
            cmdBlock.clutter_text.ellipsize = 3;
            skeleton.expandContent.add_child(cmdBlock);
        }

        // Permission buttons: Deny, Allow, Always, Dismiss
        const buttonRow = new St.BoxLayout({
            style: 'spacing: 6px; margin-top: 10px;',
            x_expand: true,
        });
        buttonRow.add_child(makeButton('Deny', RED, `rgba(201,90,90,0.08)`, `rgba(201,90,90,0.2)`, () => {
            options.onRespond(notification.id, 'deny');
        }));
        buttonRow.add_child(makeButton('Allow', GREEN, `rgba(125,214,164,0.08)`, `rgba(125,214,164,0.2)`, () => {
            options.onRespond(notification.id, 'allow');
        }));
        buttonRow.add_child(makeButton('Always', BLUE, `rgba(90,142,201,0.08)`, `rgba(90,142,201,0.2)`, () => {
            options.onRespond(notification.id, 'always');
        }));
        buttonRow.add_child(makeButton('Dismiss', TEXT_DIM, `transparent`, BORDER, () => {
            options.onRespond(notification.id, 'ask');
        }));
        skeleton.expandContent.add_child(buttonRow);

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
}
