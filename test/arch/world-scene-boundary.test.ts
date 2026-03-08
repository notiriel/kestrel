import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve, join } from 'path';

/**
 * Architecture boundary test: world/ files (except world.ts, the aggregate root)
 * must NOT import from ../scene/. Only world.ts may call into the scene layer
 * (computeScene, computeFocusedWindowPosition) to produce WorldUpdate.
 */

const WORLD_DIR = resolve(__dirname, '../../src/domain/world');

describe('world/scene boundary', () => {
    it('world files (except world.ts) do not import from scene/', () => {
        // types.ts is allowed: WorldUpdate references SceneModel as a type-only import
        const files = readdirSync(WORLD_DIR).filter(f => f.endsWith('.ts') && f !== 'world.ts' && f !== 'types.ts');
        const violations: string[] = [];

        for (const file of files) {
            const content = readFileSync(join(WORLD_DIR, file), 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                if (lines[i]!.match(/from\s+['"]\.\.\/scene\//)) {
                    violations.push(`${file}:${i + 1}: ${lines[i]!.trim()}`);
                }
            }
        }

        expect(violations).toEqual([]);
    });
});
