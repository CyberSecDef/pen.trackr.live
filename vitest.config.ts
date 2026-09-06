import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'tools/*/test/**/*.test.ts'],
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
