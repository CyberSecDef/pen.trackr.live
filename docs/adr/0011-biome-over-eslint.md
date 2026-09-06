# 0011 — Biome instead of ESLint and Prettier

**Status:** Accepted (5 September 2026)

## Context

Every package inherits the lint and format toolchain, and CI runs it on three
operating systems. The project is maintained by one person part-time.

## Decision

Biome, as a single tool for both linting and formatting.

## Consequences

- One dependency, one config file, no plugin ecosystem to keep current, and no
  periodic flat-config migration. On a part-time budget, maintenance avoided is
  the point.
- CI lint time is a rounding error rather than a minute per OS.
- Some ESLint rules have no Biome equivalent yet. If a needed rule is genuinely
  missing, ESLint can be added alongside for that rule rather than replacing
  Biome wholesale.
- One friction point already met: Biome's `useLiteralKeys` prefers
  `process.env.FOO` over bracket access, which is fine under the TypeScript
  settings in use.

## Alternatives rejected

**ESLint plus Prettier.** The conventional choice with a larger rule ecosystem,
rejected for its config surface and maintenance overhead relative to the value it
adds on a codebase with one maintainer.
