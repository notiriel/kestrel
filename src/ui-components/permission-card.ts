import type { OverlayNotification } from '../domain/notification-types.js';
import type { NotificationCardDelegate, CardOptions } from './notification-adapter-types.js';
import Clutter from 'gi://Clutter';
import type St from 'gi://St';
import GLib from 'gi://GLib';
import { buildCardSkeleton } from './card-builders.js';
import { buildCommandBlock, buildPermissionButtons, buildProgressBar } from './card-builders.js';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

const PERMISSION_TIMEOUT_SECS = 600;
const PROGRESS_TICK_SECS = 10;
const TOTAL_TICKS = PERMISSION_TIMEOUT_SECS / PROGRESS_TICK_SECS;

function easeBar(bar: St.Widget, fraction: number): void {
    (bar as unknown as Easeable).ease({
        scale_x: fraction,
        duration: PROGRESS_TICK_SECS * 1000,
        mode: Clutter.AnimationMode.LINEAR,
    });
}

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

        if (notification.command) {
            skeleton.expandContent.add_child(buildCommandBlock(notification.command));
        }

        const respond = (action: string): void => { options.onRespond(notification.id, action); };
        skeleton.expandContent.add_child(buildPermissionButtons(
            () => respond('deny'), () => respond('allow'),
            () => respond('always'), () => respond('ask'),
        ));

        this.progressBar = buildProgressBar();
        this.actor.add_child(this.progressBar);
        this._startProgressTimer(this.progressBar);
    }

    private _startProgressTimer(bar: St.Widget): void {
        let elapsed = 0;
        easeBar(bar, Math.max(0, 1 - 1 / TOTAL_TICKS));

        this._progressTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, PROGRESS_TICK_SECS, () => {
            try {
                elapsed++;
                easeBar(bar, Math.max(0, 1 - (elapsed + 1) / TOTAL_TICKS));
                return elapsed + 1 >= TOTAL_TICKS ? GLib.SOURCE_REMOVE : GLib.SOURCE_CONTINUE;
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
