import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { buildHelpCard } from './help-builders.js';
import type { ShortcutSection } from './help-builders.js';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

const ANIMATION_DURATION = 200;

const SHORTCUTS: ShortcutSection[] = [
    {
        heading: 'Navigation',
        entries: [
            ['Super + Left / Right', 'Focus window'],
            ['Super + Up / Down', 'Focus workspace'],
        ],
    },
    {
        heading: 'Window Management',
        entries: [
            ['Super + Shift + Left / Right', 'Move window'],
            ['Super + Shift + Up / Down', 'Move to workspace'],
            ['Super + F', 'Toggle window size'],
            ['Super + N', 'New window'],
            ['Super + Backspace', 'Close window'],
        ],
    },
    {
        heading: 'Workspaces',
        entries: [
            ['Super + <', 'Switch workspace'],
            ['Super + Shift + <', 'Rename workspace'],
        ],
    },
    {
        heading: 'System',
        entries: [
            ['Super + -', 'Overview'],
            ['Super + W / E / R / T / Z', 'Quake console slots 1–5'],
            ['Super + .', 'Notifications'],
            ["Super + '", 'This help'],
        ],
    },
];

export class HelpOverlayAdapter {
    private _backdrop: St.Widget | null = null;
    private _container: St.BoxLayout | null = null;
    private _visible: boolean = false;
    private _extensionPath: string;

    constructor(extensionPath: string) {
        this._extensionPath = extensionPath;
    }

    toggle(): void {
        if (this._visible) {
            this._hide();
        } else {
            this._show();
        }
    }

    destroy(): void {
        try {
            this._removeChrome();
            this._visible = false;
        } catch (e) {
            console.error('[Kestrel] Error destroying help overlay:', e);
        }
    }

    private _show(): void {
        if (this._visible) return;
        this._visible = true;

        this._build();
        this._animateIn();
    }

    private _animateIn(): void {
        if (!this._backdrop) return;
        this._backdrop.visible = true;
        this._backdrop.opacity = 0;
        (this._backdrop as unknown as Easeable).ease({
            opacity: 255,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    private _hide(): void {
        if (!this._visible) return;
        this._visible = false;

        if (!this._backdrop) return;
        (this._backdrop as unknown as Easeable).ease({
            opacity: 0,
            duration: ANIMATION_DURATION,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => this._onHideComplete(),
        });
    }

    private _onHideComplete(): void {
        try {
            this._removeChrome();
        } catch (e) {
            console.error('[Kestrel] Error hiding help overlay:', e);
        }
    }

    private _removeChrome(): void {
        if (this._backdrop) {
            Main.layoutManager.removeChrome(this._backdrop);
            this._backdrop.destroy();
            this._backdrop = null;
            this._container = null;
        }
    }

    private _build(): void {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        this._backdrop = this._createBackdrop(monitor);
        this._container = buildHelpCard(this._extensionPath, SHORTCUTS);
        this._wireCardEvents();

        this._backdrop.add_child(this._container);
        this._addToChrome();
        this._centerCard(monitor);
    }

    private _createBackdrop(monitor: { x: number; y: number; width: number; height: number }): St.Widget {
        const backdrop = new St.Widget({
            style: 'background-color: rgba(0, 0, 0, 0.6);',
            reactive: true,
            width: monitor.width,
            height: monitor.height,
        });
        backdrop.set_position(monitor.x, monitor.y);
        this._wireBackdropEvents(backdrop);
        return backdrop;
    }

    private _wireBackdropEvents(backdrop: St.Widget): void {
        backdrop.connect('button-press-event', () => {
            this._hide();
            return Clutter.EVENT_STOP;
        });
        backdrop.connect('key-press-event', (_a: Clutter.Actor, event: Clutter.Event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._hide();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    private _wireCardEvents(): void {
        if (!this._container) return;
        this._container.connect('button-press-event', () => Clutter.EVENT_STOP);
    }

    private _addToChrome(): void {
        if (!this._backdrop) return;
        Main.layoutManager.addTopChrome(this._backdrop, {
            affectsStruts: false,
            trackFullscreen: false,
        });
    }

    private _centerCard(monitor: { width: number; height: number }): void {
        if (!this._container) return;
        const cardWidth = 520;
        const cardHeight = 420;
        this._container.set_position(
            Math.round((monitor.width - cardWidth) / 2),
            Math.round((monitor.height - cardHeight) / 2),
        );
    }
}
