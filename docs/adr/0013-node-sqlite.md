# 0013 — Node's built-in SQLite instead of better-sqlite3

**Status:** Accepted (5 September 2026)
**Amends:** the stack list in [0001](0001-typescript-core.md) and the packaging rationale in [0009](0009-distribution-and-reports.md)
**Requirements:** NFR-008, NFR-006

## Context

M1 shipped the store on `better-sqlite3`. Windows CI then failed on its first
run with that dependency present:

```
gyp ERR! find VS unknown version "undefined" found at
        "C:\Program Files\Microsoft Visual Studio\18\Enterprise"
gyp ERR! find VS could not find a version of Visual Studio 2017 or newer to use
```

No prebuilt binary matched the runner's Node ABI, so the package fell back to
compiling from source, and node-gyp 10 does not recognise Visual Studio 18.
Linux and macOS were green. This is precisely the native-addon risk ADR 0009
named, arriving at M1 rather than at packaging time.

Node 22.5 ships SQLite as `node:sqlite`. Before proposing a change, it was
verified against what the store actually requires: WAL journal mode,
`synchronous = FULL`, triggers with `RAISE(ABORT)`, named and variadic
parameters, blobs round-tripping as `Uint8Array`, transactions, rollback on
error, and a second connection observing committed rows.

## Decision

Use `node:sqlite`. Remove `better-sqlite3` and `@types/better-sqlite3`.

## Consequences

- **Windows builds without a C++ toolchain**, which matters beyond CI: NFR-008
  makes Windows first class, and requiring Visual Studio to install a laptop
  tool is a poor answer to that.
- One fewer dependency beneath the evidence ledger, and no compile step on any
  platform.
- All 395 tests passed after the migration with no changes to test logic, only
  to the API surface — which is itself evidence the two are equivalent for this
  workload.
- `node:sqlite` has no `db.transaction()` helper, so the store carries a
  five-line `inTransaction` wrapper. Rollback on throw is the point: a partially
  applied append would leave a chain whose head does not match its contents.
- Row values arrive as `SQLOutputValue`, so integer columns are coerced with
  `Number()` at the boundary rather than trusted.

## The cost, stated plainly

**`node:sqlite` is marked experimental in Node 22** and emits a warning on
first use. Experimental describes the JavaScript API surface, not the storage
engine — it is the same SQLite, statically linked into Node — but the surface
could shift between minor versions. The mitigations are that all use is behind
`LedgerStore`, and that the migration in the other direction took under an hour,
so this is reversible rather than a one-way door.

The CLI suppresses that one specific warning, by message, at its entry point. A
tool that prints an internal implementation warning on every invocation trains
its operator to ignore warnings, which is a bad habit to cultivate in software
whose other warnings concern scope violations.

## What this does not fix

`node-pty` at M4 is a native addon with no built-in alternative, so ADR 0009's
per-OS packaging matrix stands. This removes one native dependency, not the
category.

**Measured, 6 September 2026.** `node-pty`'s install script is
`node scripts/prebuild.js || node-gyp rebuild` — the same fall-back-to-compile
shape that broke Windows CI here, so the question was whether M4 reintroduces
the failure. It does not, today: on a Windows 11 machine with no Visual Studio,
`node-pty@1.1.0` installed in two seconds from a shipped prebuild and spawned a
working ConPTY (`cmd.exe`, exit 0, data flowing).

The distinction that matters is that better-sqlite3 fell through to `node-gyp`
because no prebuild matched, while node-pty's prebuild did. So the risk is
**deferred rather than eliminated**: a future Node ABI without a matching
prebuild returns the fallback and the same failure. `.nvmrc` pinning Node 22 is
what keeps that under our control rather than the runner image's.

## Alternatives rejected

**Patch the CI toolchain** — force a newer node-gyp so it recognises VS 18.
Keeps a mature and widely deployed library, but the fix breaks again whenever
runners update Visual Studio or the Node ABI changes, and it leaves a compile
step that every contributor and every Windows install must satisfy.

**Pin an older Windows runner image.** Defers the problem and accumulates
security debt in the CI image.
