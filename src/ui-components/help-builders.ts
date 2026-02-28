import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

import { BORDER, TEXT_DIM, ACCENT } from '../adapters/card-base.js';

// Palette values not exported from card-base
const SURFACE = '#0a0f0c';
const TEXT = '#e8ede9';

// Hero SVG viewBox is 243x117
const HERO_HEIGHT = 192;
const HERO_WIDTH = Math.round(HERO_HEIGHT * (243 / 117)); // ~400

export interface ShortcutSection {
    heading: string;
    entries: Array<[string, string]>;
}

function buildHero(extensionPath: string): St.Bin | null {
    const svgPath = `${extensionPath}/data/kestrel-hero-dark.svg`;
    const file = Gio.File.new_for_path(svgPath);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const scaleFactor = St.ThemeContext.get_for_stage(global.stage as any).scale_factor;
    const heroActor = St.TextureCache.get_default().load_file_async(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        file as any, HERO_WIDTH, HERO_HEIGHT, scaleFactor, 1.0,
    );
    heroActor.set_x_align(Clutter.ActorAlign.CENTER);
    return new St.Bin({
        child: heroActor,
        style: 'margin-bottom: 16px;',
        x_align: Clutter.ActorAlign.CENTER,
    });
}

function buildTitle(): St.Label {
    return new St.Label({
        text: 'Keyboard Shortcuts',
        style: `font-size: 18px; font-weight: bold; color: ${TEXT}; margin-bottom: 20px;`,
        x_align: Clutter.ActorAlign.CENTER,
    });
}

function buildDismissHint(): St.Label {
    return new St.Label({
        text: "Press Escape, Super+' or click outside to close",
        style: `font-size: 11px; color: ${TEXT_DIM}; margin-top: 20px;`,
        x_align: Clutter.ActorAlign.CENTER,
    });
}

function buildColumns(sections: ShortcutSection[]): St.BoxLayout {
    const columns = new St.BoxLayout({ vertical: false, style: 'spacing: 40px;' });

    const mid = Math.ceil(sections.length / 2);
    const leftSections = sections.slice(0, mid);
    const rightSections = sections.slice(mid);

    const leftCol = new St.BoxLayout({ vertical: true, style: 'spacing: 0px;' });
    for (const s of leftSections) leftCol.add_child(buildShortcutSection(s));
    columns.add_child(leftCol);

    const rightCol = new St.BoxLayout({ vertical: true, style: 'spacing: 0px;' });
    for (const s of rightSections) rightCol.add_child(buildShortcutSection(s));
    columns.add_child(rightCol);

    return columns;
}

/** Build one shortcut section with heading and key-description rows. */
function buildShortcutSection(section: ShortcutSection): St.BoxLayout {
    const box = new St.BoxLayout({ vertical: true });

    const heading = new St.Label({
        text: section.heading,
        style: `font-size: 13px; font-weight: bold; color: ${TEXT}; margin-top: 12px; margin-bottom: 8px;`,
    });
    box.add_child(heading);

    for (const [key, desc] of section.entries) {
        const row = new St.BoxLayout({
            style: 'spacing: 16px; margin-bottom: 6px;',
            x_expand: true,
        });
        row.add_child(new St.Label({
            text: key,
            style: `font-size: 12px; font-family: monospace; color: ${ACCENT}; min-width: 220px;`,
        }));
        row.add_child(new St.Label({
            text: desc,
            style: `font-size: 12px; color: ${TEXT_DIM};`,
        }));
        box.add_child(row);
    }

    return box;
}

/** Build the main help card with hero, title, shortcut columns, and dismiss hint. */
export function buildHelpCard(
    extensionPath: string,
    sections: ShortcutSection[],
): St.BoxLayout {
    const card = new St.BoxLayout({
        vertical: true,
        style: `background-color: ${SURFACE}; border: 1px solid ${BORDER}; border-radius: 16px; padding: 28px 36px;`,
        reactive: true,
    });

    try {
        const hero = buildHero(extensionPath);
        if (hero) card.add_child(hero);
    } catch (e) {
        console.error('[Kestrel] Error loading hero SVG:', e);
    }

    card.add_child(buildTitle());
    card.add_child(buildColumns(sections));
    card.add_child(buildDismissHint());

    return card;
}
