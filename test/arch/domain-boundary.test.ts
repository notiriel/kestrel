import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Architecture boundary test: adapters must go through domain functions
 * that return WorldUpdate, never assemble world state directly.
 *
 * Allowed domain imports in controller:
 *   - Functions returning WorldUpdate (addWindow, removeWindow, setFocus,
 *     updateMonitor, focusRight, focusLeft, focusDown, focusUp, etc.)
 *   - buildUpdate — but ONLY in debugState (read-only introspection)
 *   - createWorld — initial construction in enable()
 *   - Type imports (World, WindowId, etc.)
 *
 * Forbidden patterns in controller:
 *   - Importing adjustViewport (internal; domain functions call it themselves)
 *   - Importing currentWorkspace (internal query, not a state transition)
 *   - Spreading world state: { ...this._world, ... } or { ...world, ... }
 *     (means the adapter is assembling new state instead of calling the domain)
 */

const CONTROLLER_PATH = resolve(__dirname, '../../src/adapters/controller.ts');

function controllerSource(): string {
    return readFileSync(CONTROLLER_PATH, 'utf-8');
}

describe('domain boundary: controller', () => {
    it('does not import adjustViewport', () => {
        const src = controllerSource();
        expect(src).not.toMatch(/\badjustViewport\b/);
    });

    it('does not import currentWorkspace', () => {
        const src = controllerSource();
        expect(src).not.toMatch(/\bcurrentWorkspace\b/);
    });

    it('does not spread world state to create new state', () => {
        const src = controllerSource();
        // Match `{ ...this._world` or `{ ...world` — signs of inline state assembly
        const spreadPattern = /\{\s*\.\.\.(?:this\._world|world)\b/g;
        const matches = [...src.matchAll(spreadPattern)];
        expect(matches).toEqual([]);
    });

    it('only uses buildUpdate in debugState', () => {
        const src = controllerSource();
        const lines = src.split('\n');
        const violations: string[] = [];

        let inDebugState = false;
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            // Track when we enter/leave debugState method
            if (line.includes('debugState(')) inDebugState = true;
            if (inDebugState && line.match(/^\s{4}\}/)) inDebugState = false;

            // Skip import lines and debugState body
            if (line.match(/^\s*import\b/)) continue;
            if (inDebugState) continue;

            if (line.includes('buildUpdate')) {
                violations.push(`line ${i + 1}: ${line.trim()}`);
            }
        }
        expect(violations).toEqual([]);
    });
});
