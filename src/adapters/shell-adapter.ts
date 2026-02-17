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
            console.error('[PaperFlow] Error hiding overview:', e);
        }
    }

    interceptWmAnimations(): void {
        this._wmDestroyId = global.window_manager.connect('destroy',
            (shellWm: any, actor: Meta.WindowActor) => {
                try {
                    shellWm.completed_destroy(actor);
                } catch (e) {
                    console.error('[PaperFlow] Error completing destroy:', e);
                }
            },
        );

        this._wmMinimizeId = global.window_manager.connect('minimize',
            (shellWm: any, actor: Meta.WindowActor) => {
                try {
                    shellWm.completed_minimize(actor);
                } catch (e) {
                    console.error('[PaperFlow] Error completing minimize:', e);
                }
            },
        );

        this._wmUnminimizeId = global.window_manager.connect('unminimize',
            (shellWm: any, actor: Meta.WindowActor) => {
                try {
                    shellWm.completed_unminimize(actor);
                } catch (e) {
                    console.error('[PaperFlow] Error completing unminimize:', e);
                }
            },
        );
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
