# Architecture decision records

One file per decision. Numbered, immutable once accepted: a decision that turns
out wrong gets a new ADR that supersedes it, rather than an edit that erases the
reasoning. Anyone reading a superseded ADR should be able to see why it looked
right at the time.

Format: context, decision, consequences (including the bad ones), alternatives
rejected and why.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-typescript-core.md) | TypeScript everywhere for core and clients | Accepted |
| [0002](0002-sqlite-blob-store.md) | SQLite plus content-addressed blobs, one directory per project | Accepted |
| [0003](0003-loopback-api.md) | HTTP + WebSocket on loopback, OpenAPI from zod | Accepted |
| [0004](0004-event-envelope-hash-chain.md) | Canonical CBOR event envelope with a SHA-256 hash chain | Accepted |
| [0005](0005-runner-agent-boundary.md) | The core always talks to an agent; capture fidelity is recorded | Accepted |
| [0006](0006-plugin-host.md) | Out-of-process, capability-gated plugin host | Accepted |
| [0007](0007-crypto-key-handling.md) | Per-project data key, OS keychain, honest zeroization limits | Accepted |
| [0008](0008-redaction-pipeline.md) | One redaction pipeline, three consumers, structured objects only | Accepted |
| [0009](0009-distribution-and-reports.md) | Per-OS bundles; Typst for PDF, docx for Word | Accepted |
| [0010](0010-module-split.md) | Open core in this repository, closed pack separate | Accepted |
| [0011](0011-biome-over-eslint.md) | Biome instead of ESLint and Prettier | Accepted |
| [0012](0012-hash-preimage-construction.md) | Hash preimage: domain separation, no redundant suffix | Accepted (supersedes part of 0004) |
| [0013](0013-node-sqlite.md) | Node built-in SQLite instead of better-sqlite3 | Accepted (amends 0001, 0009) |
| [0014](0014-project-lifecycle-and-core-ownership.md) | Event-owned projects, shared selection, recoverable switching | Accepted (clarifies 0002, 0003) |
| [0015](0015-headless-api-authentication.md) | Explicit desktop/headless credential providers | Accepted (extends 0003) |
