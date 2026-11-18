import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Globs (not fixed paths) so projects are picked up as their packages are created.
    // apps/web has no tests, so only apps with their own vitest.config are included.
    projects: ['packages/*', 'apps/*/vitest.config.ts'],
  },
});
