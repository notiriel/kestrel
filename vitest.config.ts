import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/adapters/**', 'src/ports/**', 'src/ui-components/**', 'src/ambient.d.ts', 'src/extension.ts', 'src/prefs.ts', 'src/prefs/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
