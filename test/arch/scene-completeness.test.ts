import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Architecture boundary tests for scene model completeness.
 *
 * Scene models must be self-contained — adapters must never branch on domain
 * type enums to determine layout, styling, or behavior. If different types
 * need different rendering, add the computed value to the scene model.
 *
 * Also enforces: no duplicate exported names across domain/ and ui-components/
 * to prevent divergent copies of the same logic.
 */

const ADAPTERS_DIR = resolve(__dirname, '../../src/adapters');
const DOMAIN_DIR = resolve(__dirname, '../../src/domain');
const UI_COMPONENTS_DIR = resolve(__dirname, '../../src/ui-components');

// Domain type literal values that adapters must not branch on.
// Factory dispatch (choosing which class to instantiate) is exempt.
const DOMAIN_TYPE_LITERALS = [
    'question',
    'permission',
    'notification',
];

// Files where factory dispatch on type is legitimate (choosing which
// class to construct). These files may reference type literals only
// in constructor/factory functions, not for rendering decisions.
const FACTORY_DISPATCH_EXEMPTIONS: Record<string, string[]> = {
    'output/notification-overlay-adapter.ts': ['_createDelegate'],
    'notification-coordinator.ts': ['_buildDomainNotification'],
};

// Files with known violations pending extraction
const KNOWN_VIOLATIONS: Record<string, string> = {
    'notification-focus-mode.ts': 'Pending extraction — builds different card layouts per type',
};

function getAllTsFiles(dir: string, prefix = ''): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.ts')) {
            files.push(prefix + entry.name);
        } else if (entry.isDirectory()) {
            files.push(...getAllTsFiles(resolve(dir, entry.name), `${prefix}${entry.name}/`));
        }
    }
    return files.sort();
}

function findExemptLineRanges(lines: string[], exemptMethods: string[]): Set<number> {
    const exempt = new Set<number>();
    if (exemptMethods.length === 0) return exempt;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Check if this line declares an exempt method
        const isExemptDecl = exemptMethods.some(m => {
            const pattern = new RegExp(`\\b${m}\\s*\\(`);
            return pattern.test(line);
        });
        if (!isExemptDecl) continue;

        // Find the matching closing brace by tracking brace depth
        let depth = 0;
        let started = false;
        for (let j = i; j < lines.length; j++) {
            for (const ch of lines[j]!) {
                if (ch === '{') { depth++; started = true; }
                if (ch === '}') depth--;
            }
            exempt.add(j);
            if (started && depth <= 0) break;
        }
    }
    return exempt;
}

function findTypeBranchingViolations(filePath: string, relativeName: string): string[] {
    const src = readFileSync(filePath, 'utf-8');
    const lines = src.split('\n');
    const violations: string[] = [];
    const exemptMethods = FACTORY_DISPATCH_EXEMPTIONS[relativeName] ?? [];
    const exemptLines = findExemptLineRanges(lines, exemptMethods);

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const trimmed = line.trim();

        // Skip imports, comments, and exempt method bodies
        if (trimmed.startsWith('import ') || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
        if (exemptLines.has(i)) continue;

        // Check for type literal branching
        for (const typeLiteral of DOMAIN_TYPE_LITERALS) {
            const pattern = new RegExp(`===\\s*['"]${typeLiteral}['"]|['"]${typeLiteral}['"]\\s*===`);
            if (pattern.test(line)) {
                violations.push(`line ${i + 1}: branches on '${typeLiteral}': ${trimmed}`);
            }
        }
    }

    return violations;
}

describe('scene model completeness', () => {
    describe('adapters must not branch on domain type enums', () => {
        const adapterFiles = getAllTsFiles(ADAPTERS_DIR);
        const cleanFiles = adapterFiles.filter(f => !KNOWN_VIOLATIONS[f]);

        for (const file of cleanFiles) {
            it(`${file} does not branch on domain type literals`, () => {
                const violations = findTypeBranchingViolations(
                    resolve(ADAPTERS_DIR, file), file,
                );
                if (violations.length > 0) {
                    expect.fail(
                        `${file} branches on domain type literals:\n` +
                        violations.map(v => `  ${v}`).join('\n') + '\n' +
                        'Add the computed value to the scene model instead.',
                    );
                }
            });
        }

        for (const [file, reason] of Object.entries(KNOWN_VIOLATIONS)) {
            it(`${file} has known type-branching violations (${reason})`, () => {
                const violations = findTypeBranchingViolations(
                    resolve(ADAPTERS_DIR, file), file,
                );
                if (violations.length === 0) {
                    expect.fail(
                        `${file} no longer has type-branching violations — remove from KNOWN_VIOLATIONS`,
                    );
                }
            });
        }
    });

    describe('ui-components must not branch on domain type enums', () => {
        const uiFiles = getAllTsFiles(UI_COMPONENTS_DIR);

        for (const file of uiFiles) {
            it(`${file} does not branch on domain type literals`, () => {
                const violations = findTypeBranchingViolations(
                    resolve(UI_COMPONENTS_DIR, file), file,
                );
                if (violations.length > 0) {
                    expect.fail(
                        `${file} branches on domain type literals:\n` +
                        violations.map(v => `  ${v}`).join('\n') + '\n' +
                        'Add the computed value to the scene model instead.',
                    );
                }
            });
        }
    });
});

describe('no duplicate exports across domain and ui-components', () => {
    function getExportedNames(dir: string): Map<string, string> {
        const exports = new Map<string, string>();
        const files = getAllTsFiles(dir);
        for (const file of files) {
            const src = readFileSync(resolve(dir, file), 'utf-8');
            const regex = /export\s+(?:function|class|const|enum|interface|type)\s+(\w+)/g;
            let match;
            while ((match = regex.exec(src)) !== null) {
                exports.set(match[1]!, file);
            }
        }
        return exports;
    }

    it('domain and ui-components have no overlapping exported names', () => {
        const domainExports = getExportedNames(DOMAIN_DIR);
        const uiExports = getExportedNames(UI_COMPONENTS_DIR);
        const duplicates: string[] = [];

        for (const [name, domainFile] of domainExports) {
            const uiFile = uiExports.get(name);
            if (uiFile) {
                duplicates.push(`'${name}' exported from both domain/${domainFile} and ui-components/${uiFile}`);
            }
        }

        if (duplicates.length > 0) {
            expect.fail(
                'Duplicate exports across domain/ and ui-components/:\n' +
                duplicates.map(d => `  ${d}`).join('\n') + '\n' +
                'Shared logic must live in one layer. Domain types used by adapters should be exported from domain/.',
            );
        }
    });
});

