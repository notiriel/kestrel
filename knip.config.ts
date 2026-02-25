export default {
  entry: ['src/extension.ts', 'src/prefs.ts', 'test/**/*.test.ts'],
  project: ['src/**/*.ts', 'test/**/*.ts'],
  ignore: ['src/ambient.d.ts'],
  ignoreDependencies: [
    '@girs/*',
    '@vitest/coverage-v8',
    'gi',
    'resource',
  ],
  rules: {
    // Adapter callback/deps interfaces are intentional API contracts
    types: 'warn',
  },
};
