import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Architecture boundary test: adapters should NOT contain widget construction,
 * animation code, or styling. Those belong in ui-components/.
 *
 * This test scans all adapter files for forbidden patterns and flags violations.
 * Adapters that still need UI extraction are listed in KNOWN_VIOLATIONS and
 * tracked separately — they should be migrated over time.
 */

const ADAPTERS_DIR = resolve(__dirname, '../../src/adapters');

/** Patterns that should NOT appear in adapter files (except in known violations). */
const FORBIDDEN = [
    { pattern: /\bnew St\./, label: 'St widget construction' },
    { pattern: /\bnew Clutter\./, label: 'Clutter actor construction' },
    { pattern: /\bnew Graphene\./, label: 'Graphene construction' },
    { pattern: /\bGObject\.registerClass\b/, label: 'GObject.registerClass' },
    { pattern: /\bnew PanelMenu\./, label: 'PanelMenu widget' },
    { pattern: /\bnew PopupMenu\./, label: 'PopupMenu widget' },
    { pattern: /\.ease\(\{/, label: '.ease() animation' },
    { pattern: /\beaseOrSet\(/, label: 'easeOrSet() animation' },
    { pattern: /\.style\s*=(?!=)/, label: '.style assignment' },
];

/** Lines matching these patterns are exempt from checking. */
function isExemptLine(line: string): boolean {
    const trimmed = line.trim();
    // Import lines
    if (/^\s*import\s/.test(trimmed)) return true;
    // Comment lines
    if (/^\s*\/\//.test(trimmed)) return true;
    // Gio.Settings, Gio.File etc. — infrastructure, not UI
    if (/new Gio\./.test(trimmed)) return true;
    return false;
}

/**
 * Adapters that still contain UI code pending extraction.
 * Each entry documents which forbidden patterns remain and why.
 * As UI is extracted, remove entries from this list.
 */
const KNOWN_VIOLATIONS: Record<string, string> = {
    // CloneAdapter: widget creation, animation, GObject subclass — pending CloneRenderer extraction
    'clone-adapter.ts': 'Pending CloneRenderer extraction (Phase 2b)',
    // Notification overlay: animation and Graphene — pending builder extraction
    'notification-overlay-adapter.ts': 'Pending animation extraction to builders',
    // Focus mode: Clutter.Clone creation and animation — pending builder extraction
    'notification-focus-mode.ts': 'Pending builder extraction',
    // Panel indicator: PanelMenu/PopupMenu construction — pending builder extraction
    'panel-indicator-adapter.ts': 'Pending builder extraction',
    // Float clone manager: Clutter actor creation — pending builder extraction
    'float-clone-manager.ts': 'Pending builder extraction',
    // Conflict detector: messageTray Source/Notification — pending builder extraction
    'conflict-detector.ts': 'Pending builder extraction',
    // Status overlay: .style assignments — pending extraction to status-badge-builders
    'status-overlay-adapter.ts': 'Pending style extraction to builders',
};

function getAdapterFiles(): string[] {
    return readdirSync(ADAPTERS_DIR)
        .filter(f => f.endsWith('.ts'))
        .sort();
}

function scanFile(filePath: string): { line: number; label: string; text: string }[] {
    const src = readFileSync(filePath, 'utf-8');
    const lines = src.split('\n');
    const violations: { line: number; label: string; text: string }[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (isExemptLine(line)) continue;

        for (const { pattern, label } of FORBIDDEN) {
            if (pattern.test(line)) {
                violations.push({ line: i + 1, label, text: line.trim() });
            }
        }
    }

    return violations;
}

describe('adapter-ui boundary', () => {
    const adapterFiles = getAdapterFiles();

    // Test clean adapters: files NOT in KNOWN_VIOLATIONS must have zero forbidden patterns
    const cleanFiles = adapterFiles.filter(f => !KNOWN_VIOLATIONS[f]);

    for (const file of cleanFiles) {
        it(`${file} contains no UI code`, () => {
            const violations = scanFile(resolve(ADAPTERS_DIR, file));
            if (violations.length > 0) {
                const details = violations
                    .map(v => `  line ${v.line}: [${v.label}] ${v.text}`)
                    .join('\n');
                expect.fail(
                    `${file} contains ${violations.length} UI violation(s):\n${details}\n` +
                    `Move widget construction, animation, and styling to ui-components/.`,
                );
            }
        });
    }

    // Document known violations — these tests pass but serve as a migration tracker
    for (const [file, reason] of Object.entries(KNOWN_VIOLATIONS)) {
        it(`${file} has known UI violations (${reason})`, () => {
            const filePath = resolve(ADAPTERS_DIR, file);
            try {
                const violations = scanFile(filePath);
                // If violations are cleared, the entry should be removed from KNOWN_VIOLATIONS
                if (violations.length === 0) {
                    expect.fail(
                        `${file} no longer has UI violations — remove it from KNOWN_VIOLATIONS`,
                    );
                }
            } catch {
                // File may not exist (already moved) — that's fine
            }
        });
    }
});
