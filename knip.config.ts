export default {
  entry: ['src/extension.ts', 'src/prefs.ts', 'test/**/*.test.ts'],
  project: ['src/**/*.ts', 'test/**/*.ts'],
  ignore: ['src/ambient.d.ts'],
  ignoreDependencies: [
    '@girs/*',
    'gi',
    'resource',
  ],
};
