import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.property.test.ts'],
    exclude: ['node_modules', 'dist', 'cdk.out'],
  },
});
