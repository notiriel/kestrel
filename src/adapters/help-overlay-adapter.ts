import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

interface Easeable {
    ease(params: Record<string, unknown>): void;
}

// Kestrel brand palette (shared with notification-overlay-adapter)
const SURFACE = '#0a0f0c';
const BORDER = '#1c2b2c';
const TEXT = '#e8ede9';
const TEXT_DIM = '#9ca8a0';
const ACCENT = '#62af85';

const ANIMATION_DURATION = 200;
// Hero SVG viewBox is 243x117 — use TextureCache.load_file_async which
// preserves aspect ratio within the given available dimensions.
const HERO_HEIGHT = 192;
const HERO_WIDTH = Math.round(HERO_HEIGHT * (243 / 117)); // ~400

const SHORTCUTS: Array<{ heading: string; entries: Array<[string, string]> }> = [
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
            if (this._backdrop) {
                Main.layoutManager.removeChrome(this._backdrop);
                this._backdrop.destroy();
                this._backdrop = null;
            }
            this._container = null;
            this._visible = false;
        } catch (e) {
            console.error('[Kestrel] Error destroying help overlay:', e);
        }
    }

    private _show(): void {
        if (this._visible) return;
        this._visible = true;

        this._build();

        if (this._backdrop) {
            this._backdrop.visible = true;
            this._backdrop.opacity = 0;
            (this._backdrop as unknown as Easeable).ease({
                opacity: 255,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        }
    }

    private _hide(): void {
        if (!this._visible) return;
        this._visible = false;

        if (this._backdrop) {
            (this._backdrop as unknown as Easeable).ease({
                opacity: 0,
                duration: ANIMATION_DURATION,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onComplete: () => {
                    try {
                        if (this._backdrop) {
                            Main.layoutManager.removeChrome(this._backdrop);
                            this._backdrop.destroy();
                            this._backdrop = null;
                            this._container = null;
                        }
                    } catch (e) {
                        console.error('[Kestrel] Error hiding help overlay:', e);
                    }
                },
            });
        }
    }

    private _build(): void {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor) return;

        // Semi-transparent backdrop covering the full screen
        this._backdrop = new St.Widget({
            style: 'background-color: rgba(0, 0, 0, 0.6);',
            reactive: true,
            width: monitor.width,
            height: monitor.height,
        });
        this._backdrop.set_position(monitor.x, monitor.y);

        // Close on backdrop click
        this._backdrop.connect('button-press-event', () => {
            this._hide();
            return Clutter.EVENT_STOP;
        });

        // Close on Escape key
        this._backdrop.connect('key-press-event', (_actor: Clutter.Actor, event: Clutter.Event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this._hide();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Main card container
        this._container = new St.BoxLayout({
            vertical: true,
            style: `background-color: ${SURFACE}; border: 1px solid ${BORDER}; border-radius: 16px; padding: 28px 36px;`,
            reactive: true,
        });

        // Stop clicks on card from propagating to backdrop
        this._container.connect('button-press-event', () => {
            return Clutter.EVENT_STOP;
        });

        // Hero SVG — use TextureCache which preserves aspect ratio
        try {
            const svgPath = `${this._extensionPath}/data/kestrel-hero-dark.svg`;
            const file = Gio.File.new_for_path(svgPath);
            const scaleFactor = St.ThemeContext.get_for_stage(global.stage as any).scale_factor;
            const heroActor = St.TextureCache.get_default().load_file_async(
                file as any, HERO_WIDTH, HERO_HEIGHT, scaleFactor, 1.0,
            );
            heroActor.set_x_align(Clutter.ActorAlign.CENTER);
            // Wrap in St.Bin for margin support (Clutter.Actor has no style property)
            const heroWrapper = new St.Bin({
                child: heroActor,
                style: 'margin-bottom: 16px;',
                x_align: Clutter.ActorAlign.CENTER,
            });
            this._container.add_child(heroWrapper);
        } catch (e) {
            console.error('[Kestrel] Error loading hero SVG:', e);
        }

        // Title
        const title = new St.Label({
            text: 'Keyboard Shortcuts',
            style: `font-size: 18px; font-weight: bold; color: ${TEXT}; margin-bottom: 20px;`,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._container.add_child(title);

        // Two-column layout
        const columns = new St.BoxLayout({
            vertical: false,
            style: 'spacing: 40px;',
        });

        // Left column: Navigation + Window Management
        const leftCol = new St.BoxLayout({ vertical: true, style: 'spacing: 0px;' });
        this._addSection(leftCol, SHORTCUTS[0]);
        this._addSection(leftCol, SHORTCUTS[1]);
        columns.add_child(leftCol);

        // Right column: Workspaces + System
        const rightCol = new St.BoxLayout({ vertical: true, style: 'spacing: 0px;' });
        this._addSection(rightCol, SHORTCUTS[2]);
        this._addSection(rightCol, SHORTCUTS[3]);
        columns.add_child(rightCol);

        this._container.add_child(columns);

        // Dismiss hint
        const hint = new St.Label({
            text: "Press Escape, Super+' or click outside to close",
            style: `font-size: 11px; color: ${TEXT_DIM}; margin-top: 20px;`,
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._container.add_child(hint);

        this._backdrop.add_child(this._container);

        Main.layoutManager.addTopChrome(this._backdrop, {
            affectsStruts: false,
            trackFullscreen: false,
        });

        // Center the card on screen (after adding to chrome so allocation is computed)
        // Use fixed positioning since we know the monitor size
        const cardWidth = 520;
        const cardHeight = 420;
        this._container.set_position(
            Math.round((monitor.width - cardWidth) / 2),
            Math.round((monitor.height - cardHeight) / 2),
        );
    }

    private _addSection(
        parent: St.BoxLayout,
        section: { heading: string; entries: Array<[string, string]> },
    ): void {
        const heading = new St.Label({
            text: section.heading,
            style: `font-size: 13px; font-weight: bold; color: ${TEXT}; margin-top: 12px; margin-bottom: 8px;`,
        });
        parent.add_child(heading);

        for (const [key, desc] of section.entries) {
            const row = new St.BoxLayout({
                style: 'spacing: 16px; margin-bottom: 6px;',
                x_expand: true,
            });

            const keyLabel = new St.Label({
                text: key,
                style: `font-size: 12px; font-family: monospace; color: ${ACCENT}; min-width: 220px;`,
            });
            row.add_child(keyLabel);

            const descLabel = new St.Label({
                text: desc,
                style: `font-size: 12px; color: ${TEXT_DIM};`,
            });
            row.add_child(descLabel);

            parent.add_child(row);
        }
    }
}
