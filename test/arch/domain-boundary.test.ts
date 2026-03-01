import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Architecture boundary test: the extension entry point must go through domain
 * functions that return WorldUpdate, never assemble world state directly.
 *
 * Allowed domain imports in extension.ts:
 *   - Functions returning WorldUpdate (addWindow, removeWindow, setFocus,
 *     updateMonitor, focusRight, focusLeft, focusDown, focusUp, etc.)
 *   - buildUpdate — but ONLY in _debugState (read-only introspection)
 *   - createWorld — initial construction in enable()
 *   - Type imports (World, WindowId, etc.)
 *
 * Forbidden patterns in extension.ts:
 *   - Importing adjustViewport (internal; domain functions call it themselves)
 *   - Importing currentWorkspace (internal query, not a state transition)
 *   - Spreading world state: { ...this._world, ... } or { ...world, ... }
 *     (means the adapter is assembling new state instead of calling the domain)
 */

const EXTENSION_PATH = resolve(__dirname, '../../src/extension.ts');

function extensionSource(): string {
    return readFileSync(EXTENSION_PATH, 'utf-8');
}

describe('domain boundary: extension', () => {
    it('does not import adjustViewport', () => {
        const src = extensionSource();
        expect(src).not.toMatch(/\badjustViewport\b/);
    });

    it('does not import currentWorkspace', () => {
        const src = extensionSource();
        expect(src).not.toMatch(/\bcurrentWorkspace\b/);
    });

    it('does not spread world state to create new state', () => {
        const src = extensionSource();
        // Match `{ ...this._world` or `{ ...world` — signs of inline state assembly
        const spreadPattern = /\{\s*\.\.\.(?:this\._world|world)\b/g;
        const matches = [...src.matchAll(spreadPattern)];
        expect(matches).toEqual([]);
    });

    it('only uses buildUpdate in _debugState and _getDiagnostics', () => {
        const src = extensionSource();
        const lines = src.split('\n');
        const violations: string[] = [];

        let inAllowed = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            // Track when we enter/leave allowed methods (read-only introspection)
            if (line.includes('_debugState(') || line.includes('_getDiagnostics(')) inAllowed = true;
            if (inAllowed && line.match(/^\s{4}\}/)) inAllowed = false;

            // Skip import lines and allowed method bodies
            if (line.match(/^\s*import\b/)) continue;
            if (inAllowed) continue;

            if (line.includes('buildUpdate')) {
                violations.push(`line ${i + 1}: ${line.trim()}`);
            }
        }
        expect(violations).toEqual([]);
    });
});
