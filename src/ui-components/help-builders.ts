import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

import { BORDER, TEXT_DIM, ACCENT } from './card-builders.js';

// Palette values not exported from card-base
const SURFACE = '#0a0f0c';
const TEXT = '#e8ede9';

// Hero SVG viewBox is 243x117
const HERO_HEIGHT = 192;
const HERO_WIDTH = Math.round(HERO_HEIGHT * (243 / 117)); // ~400

interface ShortcutSection {
    heading: string;
    entries: Array<[string, string]>;
}

// --- Accelerator formatting helpers ---

const KEY_DISPLAY_MAP: Record<string, string> = {
    apostrophe: "'",
    period: '.',
    minus: '-',
    BackSpace: 'Backspace',
    Return: 'Enter',
    space: 'Space',
};

function formatAccelerator(accel: string): string {
    const modifiers: string[] = [];
    const modRe = /<([^>]+)>/g;
    let match;
    while ((match = modRe.exec(accel)) !== null) {
        modifiers.push(match[1]);
    }
    let key = accel.replace(/<[^>]+>/g, '');
    key = KEY_DISPLAY_MAP[key] ?? (key.length === 1 ? key.toUpperCase() : key);
    const parts = [...modifiers, key];
    return parts.join(' + ');
}

function readAccel(settings: Gio.Settings, key: string): string {
    const strv = settings.get_strv(key);
    if (!strv || strv.length === 0 || !strv[0]) return '(unbound)';
    return formatAccelerator(strv[0]);
}

function parseModsAndKey(formatted: string): { mods: string; key: string } {
    const idx = formatted.lastIndexOf(' + ');
    if (idx === -1) return { mods: '', key: formatted };
    return { mods: formatted.substring(0, idx), key: formatted.substring(idx + 3) };
}

function formatPair(settings: Gio.Settings, keyA: string, keyB: string): string {
    const a = readAccel(settings, keyA);
    const b = readAccel(settings, keyB);
    const pa = parseModsAndKey(a);
    const pb = parseModsAndKey(b);
    if (pa.mods && pa.mods === pb.mods) {
        return `${pa.mods} + ${pa.key} / ${pb.key}`;
    }
    return `${a} / ${b}`;
}

function formatQuakeGroup(settings: Gio.Settings): string {
    const keys = [1, 2, 3, 4].map(i => readAccel(settings, `quake-slot-${i}-toggle`));
    const parsed = keys.map(parseModsAndKey);
    const allSameMods = parsed.every(p => p.mods && p.mods === parsed[0].mods);
    if (allSameMods) {
        return `${parsed[0].mods} + ${parsed.map(p => p.key).join(' / ')}`;
    }
    return keys.join(', ');
}

/** Build the full help card data from live GSettings. */
export function buildHelpCardData(settings: Gio.Settings): { sections: ShortcutSection[]; dismissHint: string } {
    const sections: ShortcutSection[] = [
        {
            heading: 'Navigation',
            entries: [
                [formatPair(settings, 'focus-left', 'focus-right'), 'Focus window'],
                [formatPair(settings, 'focus-down', 'focus-up'), 'Focus workspace'],
            ],
        },
        {
            heading: 'Window Management',
            entries: [
                [formatPair(settings, 'move-left', 'move-right'), 'Move window'],
                [formatPair(settings, 'move-down', 'move-up'), 'Move to workspace'],
                [readAccel(settings, 'toggle-size'), 'Toggle window size'],
                [readAccel(settings, 'new-window'), 'New window'],
                [readAccel(settings, 'close-window'), 'Close window'],
            ],
        },
        {
            heading: 'Workspaces',
            entries: [
                ['F2 (in overview)', 'Rename workspace'],
                ['F3 (in overview)', 'Workspace color'],
            ],
        },
        {
            heading: 'System',
            entries: [
                [readAccel(settings, 'kestrel-toggle-overview'), 'Overview'],
                [formatQuakeGroup(settings), 'Quake console slots 1–4'],
                [readAccel(settings, 'workspace-todos-toggle'), 'Workspace TODOs'],
                [readAccel(settings, 'toggle-notifications'), 'Notifications'],
                [readAccel(settings, 'toggle-help'), 'This help'],
            ],
        },
    ];

    const helpKey = readAccel(settings, 'toggle-help');
    const dismissHint = `Press Escape, ${helpKey} or click outside to close`;

    return { sections, dismissHint };
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

function buildDismissHint(text: string): St.Label {
    return new St.Label({
        text,
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
    dismissHintText: string,
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
    card.add_child(buildDismissHint(dismissHintText));

    return card;
}
