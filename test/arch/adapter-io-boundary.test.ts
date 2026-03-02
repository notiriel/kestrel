import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Architecture boundary test: input adapters must not import from output/
 * and output adapters must not import from input/.
 *
 * Input adapters detect reality events and call the domain.
 * Output adapters are called by the domain (via WorldHolder) to render state.
 * They should never cross-reference each other.
 */

const INPUT_DIR = resolve(__dirname, '../../src/adapters/input');
const OUTPUT_DIR = resolve(__dirname, '../../src/adapters/output');

function getFiles(dir: string): string[] {
    return readdirSync(dir).filter(f => f.endsWith('.ts')).sort();
}

function getImportPaths(filePath: string): string[] {
    const src = readFileSync(filePath, 'utf-8');
    const imports: string[] = [];
    for (const line of src.split('\n')) {
        const match = line.match(/from\s+['"]([^'"]+)['"]/);
        if (match) imports.push(match[1]!);
    }
    return imports;
}

describe('adapter input/output boundary', () => {
    const inputFiles = getFiles(INPUT_DIR);
    const outputFiles = getFiles(OUTPUT_DIR);

    for (const file of inputFiles) {
        it(`input/${file} does not import from output/`, () => {
            const imports = getImportPaths(resolve(INPUT_DIR, file));
            const outputImports = imports.filter(p => p.includes('/output/') || p.startsWith('../output/'));
            if (outputImports.length > 0) {
                expect.fail(
                    `input/${file} imports from output adapters:\n` +
                    outputImports.map(p => `  ${p}`).join('\n') +
                    '\nInput adapters must not reference output adapters.',
                );
            }
        });
    }

    for (const file of outputFiles) {
        it(`output/${file} does not import from input/`, () => {
            const imports = getImportPaths(resolve(OUTPUT_DIR, file));
            const inputImports = imports.filter(p => p.includes('/input/') || p.startsWith('../input/'));
            if (inputImports.length > 0) {
                expect.fail(
                    `output/${file} imports from input adapters:\n` +
                    inputImports.map(p => `  ${p}`).join('\n') +
                    '\nOutput adapters must not reference input adapters.',
                );
            }
        });
    }
});
