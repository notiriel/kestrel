import type { ShellPort } from '../ports/shell-port.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import type Meta from 'gi://Meta';

export class ShellAdapter implements ShellPort {
    private _wmDestroyId: number | null = null;
    private _wmMinimizeId: number | null = null;
    private _wmUnminimizeId: number | null = null;

    hideOverview(): void {
        try {
            if (Main.overview.visible) {
                Main.overview.hide();
            }
        } catch (e) {
            console.error('[Kestrel] Error hiding overview:', e);
        }
    }

    interceptWmAnimations(): void {
        this._wmDestroyId = this._connectWmSignal('destroy', 'completed_destroy');
        this._wmMinimizeId = this._connectMinimize();
        this._wmUnminimizeId = this._connectUnminimize();
    }

    private _connectWmSignal(signal: string, completedMethod: string): number {
        return global.window_manager.connect(signal,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (shellWm: any, actor: Meta.WindowActor) => {
                try {
                    shellWm[completedMethod](actor);
                } catch (e) {
                    console.error(`[Kestrel] Error completing ${completedMethod}:`, e);
                }
            },
        );
    }

    /**
     * Intercept minimize: cancel GNOME Shell's default animation which
     * resets actor opacity to 255 in _minimizeWindowDone, then complete
     * the minimize immediately.
     */
    private _connectMinimize(): number {
        return global.window_manager.connect('minimize',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (shellWm: any, actor: Meta.WindowActor) => {
                try {
                    this._cancelGnomeAnimation(actor, '_minimizing');
                    shellWm.completed_minimize(actor);
                } catch (e) {
                    console.error('[Kestrel] Error completing minimize:', e);
                }
            },
        );
    }

    /**
     * Intercept unminimize: cancel GNOME Shell's default animation which
     * resets actor opacity to 255 in _unminimizeWindowDone, then complete
     * the unminimize immediately.
     */
    private _connectUnminimize(): number {
        return global.window_manager.connect('unminimize',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (shellWm: any, actor: Meta.WindowActor) => {
                try {
                    this._cancelGnomeAnimation(actor, '_unminimizing');
                    shellWm.completed_unminimize(actor);
                } catch (e) {
                    console.error('[Kestrel] Error completing unminimize:', e);
                }
            },
        );
    }

    /**
     * Remove actor from GNOME Shell WindowManager's animation tracking set
     * and stop its transitions so the animation's onStopped callback never
     * fires (which would reset opacity to 255).
     */
    private _cancelGnomeAnimation(actor: Meta.WindowActor, trackingSetName: string): void {
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const trackingSet = (Main.wm as any)[trackingSetName] as Set<Meta.WindowActor> | undefined;
            if (trackingSet?.delete(actor)) {
                actor.remove_all_transitions();
            }
        } catch { /* tracking set not available */ }
    }

    destroy(): void {
        if (this._wmDestroyId !== null) {
            global.window_manager.disconnect(this._wmDestroyId);
            this._wmDestroyId = null;
        }
        if (this._wmMinimizeId !== null) {
            global.window_manager.disconnect(this._wmMinimizeId);
            this._wmMinimizeId = null;
        }
        if (this._wmUnminimizeId !== null) {
            global.window_manager.disconnect(this._wmUnminimizeId);
            this._wmUnminimizeId = null;
        }
    }
}
