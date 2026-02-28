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
        this._wmMinimizeId = this._connectWmSignal('minimize', 'completed_minimize');
        this._wmUnminimizeId = this._connectWmSignal('unminimize', 'completed_unminimize');
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
