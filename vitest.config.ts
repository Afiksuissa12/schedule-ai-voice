import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node environment only: this slice is a service + test-proven core, not a UI app.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Builds the SQLite schema template once, before any worker starts.
    globalSetup: ['tests/helpers/globalSetup.ts'],
    // Each test FILE gets its own isolated SQLite database (see tests/helpers/testDb.ts),
    // so files may run in parallel, but we keep a modest cap to stay friendly on small CI boxes.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    // Schema application for a fresh test database can take a moment on first run.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    reporters: ['default'],
  },
});
