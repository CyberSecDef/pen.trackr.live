# 0006 — Out-of-process, capability-gated plugin host

**Status:** Accepted (5 September 2026)
**Requirements:** FR-PLG-002, FR-PLG-005, FR-PLG-006, FR-PLG-007

## Context

Plugins extend parsers, target extractors, sidebar views, report sections,
manual-activity types, and model tools. They must exist in TypeScript and Python
(FR-PLG-006), and a failing plugin must not crash the workbench (FR-PLG-005).

## Decision

Plugins run as subprocesses speaking JSON-RPC over stdio. Never in the core's
address space. Capabilities (`parse`, `ui-view`, `manual-type`,
`report-section`, `suggest-command`, `read-secrets`, `exec`) are enforced at the
RPC boundary: a plugin without `read-secrets` cannot name the method.
`read-secrets` and `exec` default deny and require a per-plugin, per-engagement
grant that writes `plugin.capability-granted`.

## Consequences

- FR-PLG-005 becomes structurally true rather than aspirational. A plugin that
  segfaults takes down a subprocess and produces a ledger system event.
- TypeScript and Python plugins are genuinely equal citizens; neither is native
  and the other bolted on.
- Capability enforcement at a process boundary is real isolation, not a
  convention a plugin author could ignore.
- Cost: IPC serialization on every parse. Acceptable, because parsing happens on
  ingest rather than in the runner's synchronous path.

## Alternatives rejected

**In-process TypeScript plugins.** Faster and simpler, but one bad plugin then
crashes the workbench mid-engagement, and capability flags become advisory.

**WASM sandbox.** Excellent isolation, but excludes Python and most of the
parsing ecosystem worth reusing.
