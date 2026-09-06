import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: [
      'packages/*/test/**/*.test.ts',
      'tools/*/test/**/*.test.ts',
      'scripts/test/**/*.test.ts',
    ],
    // The ledger runs with synchronous = FULL, so every append is an fsync.
    // On Windows runners that is roughly 20ms each, which pushes the
    // long-chain tests past the 5s default. Raising the ceiling is right:
    // weakening the durability setting to make tests fast would mean testing a
    // configuration the product never runs in.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.ts', 'tools/*/src/**/*.ts'],
      // Entry points are exercised by the packaged smoke test in CI rather than
      // by unit tests; excluding them keeps the signal about logic, not wiring.
      exclude: ['**/cli.ts', '**/index.ts'],
      reporter: ['text', 'lcov'],
      // D20: a diagnostic floor, not a target. Raised as milestones land.
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
})
