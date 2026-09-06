# 0001 — TypeScript everywhere for core and clients

**Status:** Accepted (5 September 2026)
**Requirements:** NFR-003, NFR-008, FR-UI-009/010/011, FR-PLG-006

## Context

The core service owns the ledger, hash chain, crypto, blob store, PTY runner,
scope engine, parsers, and plugin host. It must run on Linux, Windows, and macOS
as equal citizens (NFR-008) and must not make a wrapped shell feel broken
(NFR-003).

The project is maintained by one person on an evenings-and-weekends budget.

## Decision

TypeScript on Node 22 LTS for the core service, every client, and the CLI.

Second languages are constrained:

- **Python** is a plugin SDK target only (FR-PLG-006). Plugins are subprocesses,
  so an open-core build with no Python installed must still run fine.
- **Go** is held in reserve for exactly one purpose: if `node-pty` plus shell
  integration cannot deliver acceptable argv capture on Windows, a small static
  `ptyhelper` binary replaces that layer behind a stable interface.

## Consequences

Good:

- `node-pty` is the best PTY binding available, because VS Code's terminals
  depend on it. Windows ConPTY support is battle-tested by millions of users
  rather than by us.
- The VS Code extension shares types with the core across no FFI boundary.
- One `pnpm test` covers the entire system.
- A maintainer who can read every line has a bus factor above zero, which for a
  solo project outweighs any runtime advantage.

Bad, and accepted knowingly:

- **No single portable binary.** Native addons (`node-pty`, `better-sqlite3`)
  mean distribution is a per-OS bundle. See ADR 0009.
- **Zeroization cannot be guaranteed.** The GC may copy buffers, so FR-SECPL-004
  is satisfied by discipline rather than by the type system. See ADR 0007.
- Startup latency and memory floor are higher than a compiled core. Mitigated by
  keeping the scope check off the network and out of the allocator's way, and by
  a benchmark gate in CI from M4.

## Alternatives rejected

**Rust.** Genuinely better on the things this product cannot compromise: one
static binary per OS, no GC pause in the runner's synchronous path, real
zeroization, memory control for streaming multi-gigabyte evidence. Rejected
because the maintainer does not read Rust, and an unmaintainable core is a worse
outcome than a slower one.

**Go.** A middle path — single binary, simpler than Rust — but its PTY story on
Windows is materially worse than `node-pty`, and it would split the codebase
across two languages for the whole life of the project rather than for one
component.
