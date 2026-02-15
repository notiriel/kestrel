export default {
  entry: ['src/extension.ts', 'test/**/*.test.ts'],
  project: ['src/**/*.ts', 'test/**/*.ts'],
  ignore: ['src/ambient.d.ts'],
  ignoreDependencies: [
    '@girs/*',
    'gi',
    'resource',
  ],
  rules: {
    // Adapter callback interfaces are intentional API contracts
    types: 'warn',
  },
};
