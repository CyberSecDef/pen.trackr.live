# Pen Trackr — Development Plan

**Plan version:** 0.9
**Against:** `req_spec.md` (SRS v0.2, interview-baselined 5 September 2026) — **frozen**. This plan carries every divergence; see §2.
**Status:** M0 and M1 complete — see the snapshot below. M2 is in progress; M2.1 behavior contracts are complete and M2.2 is next. Decision log at §14; milestone progress tracked inline in §6.

---

## 0. Where this stands

*Updated 9 September 2026, after M2.1 review; latest local test baseline below.*

| | |
|----|----|
| Milestones complete | **M0** (rails), **M1** (ledger spine) — 2 of 18 |
| Requirements closed | **5 of 216** — `FR-SECPL-001`, `FR-SECPL-002`, `NFR-006`, `NFR-009`, `NFR-010` |
| Tests | **539 in 17 files**, 98.35% statements, 93.39% branches, 100% functions, 98.47% lines |
| Platforms verified | Latest baseline: local Linux. M0/M1: Windows (CI + `baldr`), macOS (CI only) |
| ADRs | 15; decision history and amendments indexed in `docs/adr/README.md` |
| Next | **M2.2** — package boundaries and schemas; M2.1 contracts completed 9 September 2026 |

**What a reader should take from that:** the tamper-evidence layer is real and tested, and nothing else exists yet. Five of 216 requirements is the honest number, and it will stay small for several milestones — M2 through M5 build the spine, and none of them produce anything visible. The first milestone that feels like a product is M6.

**What was learned rather than built:**

- A library's claim about itself is worth exactly one test (`cbor-x` was approved, evaluated, and rejected on evidence).
- Three separate bugs were found by tests within minutes of writing the code they covered, and one more by running on a second machine. None would have been found by review.
- Two measurements written into this plan as fact turned out to be wrong — a requirement count estimated rather than counted, and an append latency taken from a CI runner rather than hardware. Both are corrected in place with the reasoning visible.

## 1. How I intend to build this

The SRS describes 31 subsystems and 216 numbered requirements (140 MVP, 62 V2, 14 V3 — measured by `tools/trace`, not estimated). Built breadth-first, that becomes a half-finished workbench with twelve 70%-done panels and no engagement ever run through it. Five rules:

1. **Spine first, panels second.** The ledger is the product; everything else produces or consumes events. Ledger, blob store, runner, and scope engine are a working vertical slice before any client gets a second sidebar section.
2. **The riskiest thing goes early.** Cross-platform PTY wrapping with argv observation (§5, NFR-003, NFR-008) is the hardest requirement and the one most likely to force an architecture change. It lands in M4.
3. **Every milestone is FR-gated.** Done means code, tests, and a traceability entry — not "works on my machine." `tools/trace` turns `req_spec.md` into a live coverage report.
4. **Every milestone ends somewhere stoppable.** On an evenings-and-weekends budget you will put this down for three weeks at a time. Each milestone ends at a committable, documented, resumable-cold state — no half-migrated schemas left overnight.
5. **V2/V3 gets modelled, not built.** Placeholder enums (FR-AST-006) get their data model and event types in MVP so the ledger never needs a breaking migration. No UI.

**The shortcut you already built.** `~/Git/htba` holds 1,801 artifacts across 10 HTB cases, produced by `automations/runlog.sh` — the exact tool FR-CMD-011 names as an import target. It is corpus, oracle, and design reference at once. §12 covers its use.

---

## 2. Deltas from SRS v0.2

The SRS is frozen as the baseline. Everything below diverges from it, deliberately, by your decision. This table is the audit trail.

| # | SRS says | Plan does | Why |
|----|----|----|----|
| Δ1 | §30.6, §4.1: VS Code is the primary GUI stack | Web UI first, TUI second, **VS Code last** (M16) | Build order, not product primacy — VS Code remains the intended primary cockpit, it just ships last. Side benefit: an API driven by two independent clients before the flagship cannot grow VS Code-shaped assumptions. |
| Δ2 | FR-CMD-014: "MVP runner wraps the local interactive shell only. Remote SSH is a session type to ingest or note, not a required wrapper" | Adds a **remote runner agent** (M13) | You run against a Kali VM as often as locally. This *exceeds* the MVP baseline, which is exactly why it sequences after the daily driver rather than blocking it. |
| Δ3 | §27.1: MVP includes all three clients | MVP scope **reordered, not reduced** | Every MVP-phase FR ID is still targeted. Sequencing changed so a usable tool arrives at M9 instead of M17. |
| Δ4 | FR-AI-001: adapters are Claude and Codex | Adds **Ollama** as a third adapter | Spec permits it ("additional adapters are pluggable"). Also makes NFR-002 air-gap mode *useful* rather than merely degraded — models still work offline. |
| Δ5 | FR-AI-001: "local/desktop and API as each vendor provides" | Both Claude and Codex driven as **CLI subprocesses**; no hosted Messages API in MVP | Compliant with the spec text. Better property: CLI invocations run through the managed runner, so the intelligence plane audits itself. |
| Δ6 | FR-SCRP-001/002: scripts library holds generated or imported scripts | Existing `htba` automations used as **inspiration only** — hardened first-party scripts authored here | Your call. `auto_nmap.sh` and `nmapAutomator.sh` are third-party and unaudited; a public repo shouldn't ship them, and a scripts library seeded with reviewed originals is worth more than one seeded with inherited shell. |
| Δ7 | FR-CASE-003: external artifact import | Cap imported as a **real demo project**, other nine as fixtures | Gives one populated project for exercising reports and UI against real data. |
| Δ8 | §31: "core service on localhost" | Core on the laptop; **agent dials out** from the attack host | Loopback default (FR-UI-012) still holds for the core API. The agent makes an outbound connection, so no inbound port is opened on the attack host. |
| Δ9 | §3.2: Paused / Blackout only if a window or RoE was provided | **Manual pause is available without RoE or testing windows.** Blackout remains tied to configured restrictions. | Maintainer decision, 9 Sep 2026: operators must be able to pause any live engagement independently of its paperwork. |

---

## 3. Reality check on scope versus cadence

You chose evenings and weekends (call it 7–8 hours a week), and separately chose a first-useful-slice that includes runlog parity, evidence handling, findings, report generation *and* the scope engine — plus a public repo from day one, DOCX alongside PDF and JSON, three model adapters, and a remote agent.

Those pull against each other, so here is the honest arithmetic rather than a shrug. Reaching **M9 — Daily Driver**, the point where you stop using `runlog.sh`, is roughly 490 hours. At 7.5 hours a week that is **12–15 months**. The full §28 MVP is about 900 hours — call it **two to two and a half years** at this cadence.

That second number is not a reason to abandon the scope; it is a reason to care a great deal about what order things get built in. Everything after M9 is incremental and independently useful, so the project delivers value continuously from month twelve rather than all at once at the end. M9 is the gate that matters.

Two levers exist if that number is wrong for you, and both are yours to pull, not mine:

- **Ship M6 as a checkpoint release** (~250 hours, 7–8 months): wrapped terminal, command ledger, evidence drop, scope engine, web UI. That is runlog parity plus scope — everything except findings and reports, which you'd keep writing in markdown by hand as you do today. You explicitly declined this smaller slice, so it is not the plan; it is the escape hatch if month eight arrives and you want to be *using* the thing.
- **Drop DOCX to V2** (~40–60 hours). Markdown and PDF cover personal and most client use. You asked for all three, so the plan builds all three.

I am not going to keep raising this. The plan below builds what you asked for, in the order that reaches your daily driver soonest.

---

## 4. Constraints that drive the architecture

| Constraint | Source | Consequence |
|----|----|----|
| One core service, many clients, feature parity | §2.3, §4.1, FR-UI-009/010/011 | No business logic in any client. All truth written through one API. Parity conformance suite is a first-class test target. |
| Append-only hash-chained ledger, legally defensible | §24.1, FR-SECPL-001/002 | No UPDATE/DELETE on the event table, ever. Corrections are compensating events. Projections rebuildable and disposable. |
| Scope gates execution, pre-exec | §2.2, §8, FR-CMD-006 | The scope engine is in the runner's synchronous path. Must be fast enough not to be felt (NFR-003) — including when the runner is remote (D5). |
| Raw mode always allowed, honestly labelled | §5.2, FR-CMD-013 | Capture fidelity is a recorded property (`full\|partial\|session-only`), never assumed. |
| Lossless ingest at the blob layer | §21, FR-ING-002/004 | Blob write precedes parse, separate transaction. A parser crash cannot lose bytes. |
| Secrets metadata-first; reveal is an event | §11.1, FR-SEC-002 | Plaintext never enters a projection, log line, prompt, or render without a prior reveal event. |
| Redaction is a pipeline with profiles | §24.2, FR-SECPL-005 | Reports, model prompts, and case export share one redaction path. |
| Local-first, air-gap operable | NFR-001/002, FR-AI-007 | Models behind an interface; every operator-plane feature has a models-disabled test path. Ollama (Δ4) means air-gap keeps AI. |
| Linux + Windows + macOS first class | NFR-008 | Three-OS CI from M0. Gaps documented, not used to drop a platform. |
| Dual module: open core sufficient alone | §2.5, NFR-014 | Closed-pack code lives outside the core tree, loads through the plugin capability system. |
| **Public repository from day one** | your decision | Secret scanning in CI from M0. The `htba` corpus never enters git. LICENSE, README, and threat model presentable from the first commit. |

---

## 5. Architecture decisions

ADRs in `docs/adr/`.

### D1 — TypeScript everywhere *(decided)*

Core, all clients, and CLI in TypeScript on Node 22 LTS. A language you cannot read is a bus factor of zero, and no runtime advantage outweighs that. It also buys `node-pty` — the best PTY binding in existence, because VS Code's terminals depend on it, so ConPTY is battle-tested by millions of users.

**Honest cost:** I originally recommended Rust for single-binary distribution. That property is gone; D9 handles the replacement, wired into CI from M0 so it never becomes an end-of-project surprise.

**Second languages:** Python is already required as a plugin SDK target (FR-PLG-006) — subprocess-hosted, never a core dependency. Go is held as one pre-agreed escape hatch: if `node-pty` plus shell integration cannot get argv on Windows, a static `ptyhelper` binary replaces that layer behind a stable interface.

**Stack:** pnpm workspaces + TS project references; Fastify (HTTP + WS); `better-sqlite3`; `node-pty`; `@noble/ciphers` + `node:crypto`; `@napi-rs/keyring` (not `keytar` — unmaintained); `@node-rs/argon2`; `cbor-x` canonical mode; Vitest; `tsup`; xterm.js (web); Ink (TUI); React + Vite (web).

### D2 — Storage: SQLite + content-addressed blobs, one directory per project

```
<project>/
  ledger.db                # append-only events + rebuildable projections (WAL)
  blobs/ab/cd/<sha256>     # content-addressed, immutable, sharded 2/2
  vault/                   # XChaCha20-Poly1305 sealed secret material
  files/                   # operator-visible tree (scratchpads, scripts, reports)
  project.toml             # identity, state, schema version
```

One directory = one portable unit, so case export (FR-CASE-001) is "seal, manifest, verify, archive" and backup (NFR-007) is a documented `cp -a` plus key material. Deliberately close to the `scans/ logs/ screenshots/ evidence/` convention you already use, which makes the M11 import nearly mechanical.

Projections live in the same file in tables marked derived, dropped and rebuilt from events on schema change. `pentrackr project rebuild` is supported and tested from day one — the proof that §2.2's "projections are disposable" is real.

### D3 — API: HTTP + WebSocket on loopback, token-authenticated, OpenAPI-described

REST for CRUD; WebSocket for the event stream, PTY bytes, and live scope verdicts. Loopback bind by default; wider binds are an explicit warned setting writing a config event (FR-UI-012). Token in the OS keychain.

`zod` schemas are the single source: OpenAPI, JSON Schema for the event appendix, the generated API client, and both plugin SDKs all derive from them, so they cannot drift.

### D4 — Event envelope and hash chain

```
event_id (UUIDv7)  prev_hash  this_hash  ts_utc  ts_local  tz
operator_id  engagement_id  schema_version  type  payload
```

`this_hash = SHA-256(canonical_cbor(envelope_without_this_hash) || prev_hash)`. Canonical CBOR rather than JSON so the chain isn't hostage to key ordering or float formatting — that's what makes NFR-009's deterministic export achievable. Canonical encoding is verified against RFC 8949 vectors in CI, because a library's "canonical mode" is a claim until tested.

Interval ed25519 signatures every N events and on seal; key in the OS keystore. `pentrackr verify` walks the chain and names the first divergent event.

### D5 — Runner, capture fidelity, and the agent boundary

**The key simplification: the core always talks to an agent.** Locally that agent runs in-process; remotely it is `pentrackr agent` on the attack host. One code path, one protocol, no "local mode versus remote mode" branching — which is what makes Δ2 affordable at all.

Three capture tiers, always recorded on the event:

- **`full`** — the runner spawned the process (scripts, agent-proposed commands, palette-launched tools). Real argv, exit code, per-line timestamped output, tool hash.
- **`partial`** — interactive shell with shell integration. Argv from shell hooks (bash/zsh `preexec`/`precmd` via injected rcfile, PowerShell prompt hook, fish event) — the technique VS Code already uses, which we can borrow directly since we're on the same runtime. Output from the PTY stream; nested TUIs are noise-filtered, not parsed.
- **`session-only`** — raw mode, nested SSH, hooks refused. Start, stop, cwd, session ID, raw TTY bytes. Argv unknown and *said to be unknown* (§5.2).

Windows is the risk: ConPTY exposes no argv. PowerShell profile hook is the mitigation; `cmd.exe` will likely be `session-only`, documented per NFR-008.

`runlog.sh` is a `full`-tier capture by this definition. **The MVP runner must be at least as good as the shell script you already wrote**, on three OSes. That's a concrete, testable bar.

**Remote agent design (M13):**

| Property | Decision |
|----|----|
| Ships as | `pentrackr agent` — same binary, no separate distribution or version-skew problem |
| Connection direction | Agent **dials out** to the core. No inbound port on the attack host. Pairing by one-time token. |
| Transport | mTLS, certificate pinned at pairing |
| Holds | Nothing durable. PTY spawn, shell integration, byte streaming, tool hashing, a bounded spool buffer |
| Does not hold | Ledger, vault, policy, evidence. All persist on the laptop — so a burned VM loses nothing (FR-EVD-007 custody) |
| Scope verdicts | The core pushes a **compiled scope snapshot** to the agent so verdicts evaluate locally at memory speed; the authoritative event is still written on the core. This is what keeps NFR-003 satisfiable across a network hop. |
| Version skew | Protocol version locked; mismatched agent refuses to run rather than degrading silently |

Clock skew (§5.3) is sampled against a configured NTP reference at session open and recorded per event (NFR-010) — and matters more with a remote agent, where laptop and attack host are genuinely different clocks.

### D6 — Plugin host: out-of-process, capability-gated

Plugins are subprocesses speaking JSON-RPC over stdio, never in the core's address space — that is what makes FR-PLG-005 (a failed plugin must not crash the workbench) structurally true rather than aspirational, and what lets TypeScript and Python plugins be genuinely equal citizens (FR-PLG-006).

FR-PLG-002 capabilities are enforced at the RPC boundary: a plugin without `read-secrets` cannot name the method. `exec` and `read-secrets` default deny, requiring a per-plugin per-engagement grant that writes `plugin.capability-granted`.

### D7 — Crypto and key handling

Per-project data key (XChaCha20-Poly1305) wrapping vault entries and evidence blobs (FR-SECPL-003), itself wrapped by an operator key in the OS keychain, with an Argon2id passphrase fallback for headless and air-gapped use. Signing key separate from encryption key.

Project switch zeroizes key material and writes `project.switched` (FR-SECPL-004). **JavaScript cannot guarantee zeroization** — the GC may copy buffers. Mitigation is honest scoping: secrets live only in `Buffer`s that are explicitly overwritten and dropped, never in `string`s, enforced by a lint rule and a heap-snapshot canary test after switch. The limit goes in the threat model (FR-SECPL-010) rather than being papered over.

### D8 — Redaction pipeline

One implementation, three consumers: report render, model context packaging, case export. A profile maps object class × audience → `full | masked | omitted | reference-only`. The renderer takes structured objects, never pre-formatted strings, so redaction can't be defeated by upstream interpolation. Canary fuzz suite plants known secrets in every object type and asserts zero appearances in any client-profile output — using real corpus credentials, which are exactly the shape of what must never reach a client.

### D9 — Distribution and report rendering

**Distribution.** Per-OS bundles from CI: Node SEA executable plus prebuilt native addons (`prebuildify` across Linux/macOS/Windows × x64/arm64), packaged as `.tar.gz`/`.zip` with a thin installer. Also npm-published for `npx pentrackr`. This is the concrete cost of D1 — solved, but not free, so it gets a CI job from M0.

**Reports.** Markdown source retained in-project (FR-RPT-008); PDF via **Typst** (single vendorable binary, no Chromium, no LaTeX, deterministic); DOCX via the `docx` package; JSON as direct serialization of finding objects. All three at MVP, per your call.

### D10 — Repository layout and the open/closed split

```
pen.trackr.live/
  req_spec.md  plan.md  LICENSE (Apache-2.0)  README.md
  docs/          adr/  threat-model.md  schemas/  templates/   # legal + report templates (FR-ENG-016)
  packages/
    ledger/      store/      scope/      runner/     agent/
    parse/       vault/      report/     ai/         plugin-host/
    server/      web/        tui/        cli/
  clients/
    vscode/                 # final stretch goal (M16)
    shared/                 # generated API client + shared components
  scripts/                  # hardened first-party operator scripts (Δ6)
  sdk/  ts/  python/
  tests/  conformance/  acceptance/  corpora/
  tools/  trace/            # req_spec.md -> FR coverage report
```

The closed module (§2.5) is a **separate repository** shipping plugins into this host. Nothing in `packages/` may branch on its presence; a CI job builds open-core-only and runs the case-file read suite to prove FR-PLG-007 and NFR-014.

---

## 6. Milestones

Sizes are relative effort; hour estimates are rough and exist only to make §3's arithmetic checkable.

### M0 — Rails (S, ~20h) — ✅ COMPLETE

Project rails: toolchain, CI, packaging, traceability, and the decision record.

| Phase | Task | Status |
|----|----|----|
| M0.1 | pnpm workspace, TypeScript project references, Biome, Vitest | ✅ |
| M0.2 | `@pentrackr/cli` — `pentrackr --version` with build identity | ✅ |
| M0.3 | `@pentrackr/trace` — requirement traceability extractor | ✅ |
| M0.4 | CI: three-OS matrix, secret scanning, dependency audit | ✅ |
| M0.5 | Per-OS release bundle + smoke test | ✅ |
| M0.6 | ADRs 0001–0011 | ✅ |
| M0.7 | Plan update, corrected baseline counts | ✅ |
| M0.8 | Pull request, CI green on three OSes | ✅ |

**Exit criteria and results:**

- *Green on three OSes* — lint, typecheck, 24 tests, and the traceability check run on `ubuntu-latest`, `windows-latest`, and `macos-latest`.
- *A real installable bundle from CI* — `pentrackr-<version>-<platform>-<arch>.tar.gz` assembled and smoke-tested (`--version`) on every OS, with the commit stamped into the bundled manifest.
- *Traceability baseline* — **216 requirements** (140 MVP, 62 V2, 14 V3), 0 claimed. The earlier "~180" was an estimate; 216 is measured and cross-checked against an independent grep.

**Findings worth carrying forward:**

- The Debian-packaged Node 22 on the development machine is built **without TypeScript support** (`ERR_NO_TYPESCRIPT`), so native type stripping is not available. Tooling runs compiled output instead. Relying on `--experimental-strip-types` would have been a portability trap.
- The traceability tool's coverage rule is deliberately asymmetric: claiming an ID without both an implementation and a test fails CI, and so does annotating an ID the SRS does not define, but leaving a requirement unclaimed does not. Only false claims break the build.
- Node single-executable packaging is **deferred**, not done. It buys little until native addons exist (M4), and claiming it now would be theatre. The tarball bundle is the real M0 deliverable.
- **The three-OS matrix earned its place immediately.** Its first real run failed on Windows only, on CRLF checkout, while Linux and macOS were green. Line-ending normalization is now enforced by `.gitattributes` — and this is a correctness property, not tidiness: a hash chain computed over content whose bytes vary by checkout platform would be indefensible. Had the matrix been deferred to M14 as originally tempting, this would have been found after the ledger was built on top of it.
- **The dependency audit also caught something real on its first run**: vitest 2.1.9 carried a critical advisory (GHSA-5xrq-8626-4rwp). Upgraded to vitest 5 with vite 7 pinned to satisfy the peer range. A security tool shipping known-vulnerable dependencies is not a defensible position, so `pnpm audit` stays a blocking gate rather than a warning.

### M1 — Ledger spine (M, ~40h) — ✅ COMPLETE — *the foundation*

| Phase | Task | Status |
|----|----|----|
| M1.1 | Deterministic CBOR encoder (RFC 8949 §4.2.1) + UUIDv7 generator | ✅ |
| M1.2 | Event envelope schemas + the §25.2 taxonomy (52 types) | ✅ |
| M1.3 | Hash chain: link, verify, first-divergence reporting | ✅ |
| M1.4 | Strict canonical CBOR decoder *(added mid-milestone)* | ✅ |
| M1.5 | SQLite store, append-only enforced by triggers | ✅ |
| M1.6 | Ed25519 interval checkpoints | ✅ |
| M1.7 | Projection framework with rebuild | ✅ |
| M1.8 | CLI: `verify`, `seal`, `log`, `keygen` | ✅ |

**Closes:** FR-SECPL-001, FR-SECPL-002, NFR-006, NFR-009, NFR-010, §25.2 taxonomy.

**Exit criteria and results:** arbitrary event sequences verify; a single-byte mutation anywhere is detected and localized to its index; re-encoding is byte-stable; an event is committed and visible to a second connection by the time `append()` returns.

**M1.4 was not in the original phase list.** Verifying a stored event means reconstructing it and recomputing its hash — which catches column corruption that hashing a stored blob would not — and that requires a decoder. Written strict: it rejects non-shortest heads, indefinite lengths, unsorted map keys, floats, tags, and trailing bytes, so storage becomes an independent second detector of modification rather than a channel that normalizes tampering away.

**Findings worth carrying forward:**

- **`cbor-x` was installed under D19 approval and then removed.** It is not canonical on three counts — preserves map insertion order, emits non-shortest map headers, encodes floats at full width. ADR 0004 anticipated exactly this ("a library's canonical mode is a claim until tested"), so the determinism test was written before anything depended on it. The encoder is now hand-written, ~250 lines, verified against RFC 8949 Appendix A.
- **A real encoding collision existed and was fixed.** `TextEncoder` maps unpaired surrogates to U+FFFD, so `'\uD800'` and `'\uD801'` — distinct strings — encoded to identical bytes. Two different events could share a hash preimage for one keystroke's effort. Ill-formed text is now refused.
- **Three bugs were found by tests in code I had just written**: the UUIDv7 generator reseeded its counter on a backwards clock step (producing duplicate identifiers under fixed entropy — reachable via NTP correction mid-engagement); the decoder read CBOR major-type-7 payload bytes instead of the additional-information bits, so float rejection never fired at all; and `verifyCheckpoints` accepted checkpoints signed by *any* key, so an attacker with write access could replace them wholesale.
- **The truncation gap is closed, and stated.** A hash chain cannot detect tail truncation — every remaining link stays intact. ADR 0012 documents it, a test asserts that a truncated chain still verifies, and checkpoints (M1.6) close it. `verify` says so in its own output when no checkpoints exist rather than reporting an unqualified "ok".
- **Three layers, kept distinct.** Triggers prevent accidents (a raw `sqlite3` shell is refused). The chain detects modification and reordering. Checkpoints detect deletion from the end. Conflating them is how a security tool ends up overstating what it proves, so each has its own tests, including one that drops the triggers and asserts the chain catches what gets through.
- **`better-sqlite3` was replaced by `node:sqlite` (D22, ADR 0013)** after it broke Windows CI: no prebuild matched, so it compiled from source, and node-gyp 10 cannot detect Visual Studio 18. Requiring a C++ toolchain to install a laptop tool is a poor answer to NFR-008's "Windows is first class". All 395 tests passed after the migration with no changes to test logic.
- **A bug survived M1 and was caught afterwards, by a different machine.** The decoder built maps with `result[key] = value`, which for the key `__proto__` invokes the inherited setter: the key vanished and the object's prototype was replaced. A stored event with such a payload would have failed its own hash verification on read — and that payload is not exotic here, since evidence of a prototype-pollution finding is a captured body containing exactly that key. The property test asserting byte-idempotence caught it on `baldr`'s first run; 20,000 runs on Linux never sampled it. Property tests are only as good as the seeds they draw, which is an argument for a second execution environment beyond platform coverage.
- **Append latency, measured on three environments** with `synchronous = FULL` (every append is an fsync): **0.27 ms** on the Linux dev host, **2.0 ms** on real Windows hardware (`baldr`), and roughly **20 ms** on a GitHub Actions Windows runner. The CI figure was recorded first and is *not* representative — shared virtualized storage, not a laptop. Against NFR-003's 20 ms budget the real number leaves ample headroom, so appending off the runner's hot path at M4 remains good design rather than a necessity. Recorded here because the first version of this note asserted the CI figure as fact, which would have distorted an M4 decision.

### M2 — Projects, states, core API (M, ~40h)

**Status: in progress; M2.1 complete, M2.2 next (9 September 2026).** Build an operable local core that can create and manage engagements, apply audited state changes, switch a shared project context, and serve authenticated HTTP and WebSocket clients. M2 is exercised through the CLI and API; the first graphical client remains M6.

The original ~40h estimate predates this breakdown. Retain it as the original estimate, not a commitment; re-estimate after M2.1 resolves the lifecycle and authentication choices. Work through the phases below in order, with tests alongside each implementation and one commit per phase (D18). Unchecked boxes are remaining work; resolving the planning questions does not mark their implementation complete.

**Starting point verified in this repository:** `packages/ledger` provides Zod envelope validation, generic CBOR-compatible payloads, 52 event names, UUIDv7, hash chaining, SQLite storage, checkpoints, and rebuildable projections. `packages/cli` exposes `verify`, `seal`, `log`, and `keygen`. There is no engagement model, project registry, HTTP server, keychain adapter, or API client yet. The ledger currently permits multiple engagement IDs in one database; project ownership must be enforced by the new service. Append and projection catch-up are separate transactions, so recovery and retry behavior need explicit tests.

**Review baseline (9 September 2026, local Linux, Node 22.22.1):** lint, typecheck, **539 tests in 17 files**, coverage thresholds, and traceability passed; hygiene passed when rerun outside the execution sandbox after its Git subprocess was blocked. Coverage: 98.35% statements, 93.39% branches, 100% functions, 98.47% lines. Traceability remains 5 of 216 requirements. This run does not re-verify Windows or macOS.

#### Scope and requirement accounting

The original blanket claim to close FR-ENG-001..015 and all of §28.1 was too broad for the dependencies available at M2. The following is the intended allocation, not a completion claim:

| Requirement | M2 deliverable | Remaining completion dependency |
|----|----|----|
| FR-ENG-001, 006..014 | Typed, validated, event-backed metadata and CRUD/query behavior; local operator identity and roster mapping | Target full closure in M2 for the metadata requirements. Scope execution, correlation, and dual-control enforcement belong to later subsystems. |
| FR-ENG-002..004 | Optional document metadata and attachment-reference contract; bundled SOW, NDA, and authorization templates | M3: attach, retain, retrieve, and verify actual document bytes. No fake successful attachments in M2. |
| FR-ENG-005 | Structured RoE, blackout windows, policy metadata, and RoE template | M5: execution actually honors RoE. |
| FR-ENG-015 | Lab creation, state/mode in API and CLI, no legal-document prerequisite, ordinary ledger | M4: live runner; M6/M10/M16: banners in each client. |
| FR-ENG-016 | Ship all six document templates; previously omitted from the milestone allocation | Target full closure in M2. |
| FR-UI-003 | Shared active context, isolated stores, audited switches, two independent API clients observing the same selection | M4/M7: terminal and secret lifecycle integration; M6/M10/M16: client switcher behavior. |
| FR-UI-012 | Loopback default; wider bind requires an explicit setting, warning, and configuration audit | Target full closure in M2. |
| NFR-001, NFR-002 | Installed core, CLI, authentication, and project operations work locally with external networking unavailable | Validate M2 behavior now; repeat against the complete MVP, including disabled model/remote integrations. |
| FR-SECPL-004; §28.1 | Switch cleanup hooks and project isolation tests | M7: bounded unloading of actual vault secrets. M2 does not close this requirement or all of §28.1. |

`tools/trace` checks the presence of implementation/test annotations, not behavioral completeness or the prose in this plan. At closeout, compare each proposed claim with the entire requirement text. Keep partial work documented here without creating paired annotations that falsely report full completion; changing the trace tool itself is not a prerequisite for M2.

#### M2.1 — Resolve the behavior contract — ✅ COMPLETE

- [x] Record the transition matrix for Draft, Lab, Active, Paused, Blackout, Closing, and Closed: permitted edges, reasons, preconditions, resume destination, repeat requests, and Closed reopening. Define whether Lab identity survives a temporary lifecycle state.
- [x] Resolve the three maintainer questions below and record the approved departure from SRS §3.2 in §2 (Δ9); decisions D26–D28 record the agreed scope.
- [x] Add implementation ADRs where needed, including the headless authentication extension to ADR 0003, without rewriting accepted ADRs.
- [x] Specify one active project shared by all attached clients (FR-UI-003), explicit project IDs on project operations, switch generation/revision checks for stale clients, and the behavior of concurrent requests during a switch.
- [x] Define the storage and API contracts: registry location, configurable project root, create versus register-existing behavior, removal semantics, supported schema versions, error format, and service configuration audit destination even before a project exists.

**Maintainer decisions (9 September 2026):** Closed projects support audited reopening; manual pause works without RoE/testing windows (Δ9). Removing a project only unregisters it and preserves all files; show the operator a warning that the directory and its contents remain. Headless Linux authentication without an OS keychain is required in M2. These scope questions are resolved; the contracts below define their behavior, and executable implementation remains in the later M2 phases.

**Results:** [M2 core behavior contract](docs/m2-core-contract.md), [ADR 0014](docs/adr/0014-project-lifecycle-and-core-ownership.md), and [ADR 0015](docs/adr/0015-headless-api-authentication.md) define the transitions, project layout and registration, local audit, explicit API routes/errors, context/revision preconditions, retry handling, recoverable destination-ledger switch audit, and desktop/headless credential lifecycle. The SRS and ADRs 0001–0013 are unchanged. This is completed design work, not a working server or additional requirement closure. Documentation links, diff whitespace, and repository hygiene are the phase checks; executable conformance tests arrive with implementation.

**Confirmed lifecycle rules:** The maintainer confirmed that Lab identity persists through pause/closure/reopening and Closed content edits require audited reopening. Blackout is a derived effective restriction layered over lifecycle; M5 evaluates it separately from M2.6's six-state enum.

**Review corrections to `c4d1c95`:** Contract v2 restores `closing_origin` on cancellation, including Draft/Paused paths and pauses of Closing; separates effective Blackout interactions from persisted transitions; and requires the owning core stopped for offline `verify`/`seal`/`log`, using the same exclusive lock implemented in M2.3. ADR 0015 now strips at most one terminal LF/CRLF from passphrase FD input. ADRs 0014/0015 carry dated review amendments at the maintainer's request. The contract is shortened, and the snapshot above uses the measured 539-test baseline.

**Handoff to M2.2:** derive strict schemas from the contract without a second handwritten OpenAPI source. Detailed credential-container algorithms/parameters are intentionally an M2.10 implementation ADR, and the portable ownership primitive is selected/tested in M2.3. The initial ~40h milestone estimate remains unvalidated: headless credential storage, recovery, and three-OS packaging need implementation evidence before a reliable replacement estimate can be recorded.

#### M2.2 — Establish package boundaries and contracts

- [ ] Add a project/domain workspace package and `packages/server`; wire TypeScript references, package exports, build order, test discovery, and runtime dependencies. Keep project/state rules independent of Fastify and clients; reuse `@pentrackr/ledger`.
- [ ] Define strict Zod request, response, event-payload, and configuration schemas with explicit versioning. Reject unknown fields and distinguish omitted patch fields from explicit clearing. Use named payload versions without changing M1 envelope/hash semantics.
- [ ] Define the JSON representation of ledger values that JSON cannot represent directly, including CBOR byte strings and big integers. Test lossless wire round-trips without changing the authoritative CBOR or its hashes.

#### M2.3 — Project directories, registry, and local identity

- [ ] Implement ADR 0002's project layout (`ledger.db`, `project.toml`, and reserved `blobs/`, `vault/`, `files/` directories). Treat metadata/state in `project.toml` as a recoverable mirror of ledger truth, not an independent editable source.
- [ ] Create projects with stable UUIDv7 identities and an `engagement.created` event; validate before side effects. Handle interrupted creation, existing/nonempty paths, duplicate IDs, permissions, and cleanup of only artifacts created by the failed operation.
- [ ] Implement register/list/open/unregister according to M2.1, including moved/missing directories and conflicting registrations. Rebuild cached list metadata from each registered project's ledger; keep local path registration separate from portable engagement truth.
- [ ] On unregister, show a warning that project files remain on disk, including the directory location and how to register it again. Return structured preservation/warning information through the API so every client can display it; test that unregister never deletes project files and that re-registration preserves identity and history.
- [ ] Persist one local operator identity and map roster entries to it where appropriate. Validate event attribution server-side; a client cannot supply another operator or engagement identity in an envelope.
- [ ] Enforce canonical path handling and one owning core per managed project; test symlink/path aliases, traversal attempts, competing opens, stale ownership after a crash, and Windows handle release. Opening an unknown project must not silently create an empty ledger through the current `openLedger()` behavior.
- [ ] Apply that same exclusive canonical-ledger guard to offline `verify`/`seal`/`log` before any database open. Require the owning core stopped; report `ledger_in_use` with exit 75 on contention. Hold core ownership across inactive registered projects until unregister/shutdown, and test core/CLI contention both ways before the server is introduced.

#### M2.4 — Engagement metadata model

- [ ] Model client/display name, immutable engagement ID, internal code name, assessment types, roster, source IPs, escalation/deconfliction contacts and 24/7 flags, jurisdiction, and data-handling requirements. Include the documented wireless/physical/social placeholder enums without adding modules.
- [ ] Model optional SOW/NDA/authorization metadata, NDA effective dates, and future document references. Store no attachment bytes or credentials in generic metadata; unsupported attachment operations must report that M3 support is required.
- [ ] Model scope inclusions and exclusions for every FR-ENG-006/007 type, including mobile apps; use stable scope-object IDs and explicit absent-versus-empty scope semantics. Validate syntax without DNS lookups or target contact; leave membership verdicts to M5.
- [ ] Model optional RoE, permitted/forbidden techniques, destructive policy (`forbid`, `require dual-control`, `allow-in-window`), testing windows, after-hours permissions, and blackout windows. Validate real dates, start/end ordering, IANA timezones, and DST ambiguity policy. Retention instructions are metadata, never an automatic destruction scheduler.
- [ ] Test minimal Draft/Lab projects with no legal material, field limits, malformed addresses/dates, duplicate identities, clearing optional fields, and metadata round-trips through canonical ledger payloads.

#### M2.5 — Event-backed mutations and projections

- [ ] Implement typed `engagement.created`, `engagement.updated`, `engagement.state-changed`, `scope.object-added`, and `scope.excluded` payloads. Specify correction/removal semantics for scope and other collections; add event types only when existing meanings are insufficient, preserving old events.
- [ ] Build engagement, scope, RoE/window, roster, and contact projections using `ProjectionRunner`. Validate payload versions during replay; refuse unsupported project history clearly rather than interpreting it under the newest schema.
- [ ] Route all business mutations through a service that checks engagement ownership and expected revision, appends durable events, catches projections up, and returns the committed revision/event identity. Prevent lost updates and define idempotency for retries after a committed event but lost response.
- [ ] Test stale revisions, conflicting writers, duplicate retries, append/projection failure boundaries, restart catch-up, and full projection rebuild. Compare rebuilt views and unchanged ledger hashes/checkpoints; expose repair errors instead of serving stale views as current.

#### M2.6 — Engagement state machine

- [ ] Implement the approved M2.1 matrix as a pure transition policy plus an audited service operation. Return allowed transitions and reasons to clients; keep this logic out of CLI/HTTP handlers.
- [ ] Preserve no-document creation and the SRS's Draft/Lab runner availability in the future runner contract. Represent Closed as runner-disabled and Closing's persistence/destructive behavior as policy information for M4/M5; do not claim execution enforcement yet.
- [ ] Persist `resume_state` and `closing_origin` per contract v2; cancellation restores the closing origin, including paused-Draft and paused-Closing detours. Use only the six persisted lifecycle states; Blackout is a separate effective restriction evaluated in M5. Closing/Closed must not require nonexistent reports, vaults, or cleanup projections; define hooks for M8/M9.
- [ ] Test every allowed and rejected transition, missing prerequisites, reason requirements, no-op/retry behavior, concurrent transitions, and restart/replay. Closing a project and signing a checkpoint remain distinct operations.

#### M2.7 — Project switching and isolation

- [ ] Implement a serialized switch lifecycle: prepare/validate target, drain or reject conflicting work, persist source, run disposal hooks, load target projections, audit the switch, publish the new shared context. Define bounded hook timeouts and failure outcomes.
- [ ] Specify which ledger(s) receive `project.switched`, correlation IDs, initial selection, same-project selection, and switching to/from an unavailable project. If both ledgers are written, implement recoverable steps; two independent SQLite databases are not one atomic transaction.
- [ ] Add explicit runner/vault lifecycle interfaces for M4/M7, with test doubles proving hook ordering and disposal failure behavior. Never redirect an in-flight mutation to the newly active project merely because the global selection changed.
- [ ] Test switching A→B→A with distinct metadata/events, failure at each boundary, restart after an interrupted switch, two clients racing a switch, and stale requests. Both ledgers must verify, clients must converge on one context, and old project subscriptions/caches must be detached according to the contract.

#### M2.8 — Core process and loopback boundary

- [ ] Build a configurable Fastify service with explicit start/stop, injectable dependencies, health/readiness, local discovery information, clean shutdown, and startup errors for invalid configuration or occupied ports. Publish readiness only after authentication and recovery succeed.
- [ ] Bind loopback by default; cover IPv4 and IPv6 behavior. A non-loopback bind requires explicit opt-in, a visible warning, and a durable configuration audit without putting tokens in the audit. Document transport expectations for wider exposure; agent pairing/mTLS remains M13.
- [ ] Enforce Host/Origin policy for HTTP and WS, narrowly configured browser origins, bounded request sizes, timeouts, and safe error/log output. Test hostile origins/hosts and unauthenticated requests as well as allowed native clients without Origin headers.

#### M2.9 — REST resources and query contract

- [ ] Implement versioned routes for project create/register/list/get/update/unregister, state transitions, active-context read/switch, metadata/scope queries, projection rebuild, and paginated ledger reads. Final route spellings and CLI names come from the M2.1 contract.
- [ ] Return project list name, client, state/mode, and window; report findings/task counts as unavailable until those projections exist instead of inventing zero counts. Define deterministic sorting and bounded pagination.
- [ ] Generate event IDs, timestamps, timezone fields, and operator attribution in the core. Accept domain commands, not arbitrary client-authored ledger envelopes; validate path/body identity agreement and revision preconditions.
- [ ] Standardize validation, authentication, not-found, conflict, unavailable-project, unsupported-version, and internal-error responses. Test requests through Fastify injection and a real loopback listener, including malformed bodies and methods that must not mutate state.

#### M2.10 — Authentication and credential lifecycle

- [ ] Implement an OS-keychain adapter under ADRs 0003/0007, with a test adapter and separate namespaces for API tokens versus signing/encryption keys. Verify the selected binding and prebuilt packaging on the supported OSes before relying on it.
- [ ] Generate, retrieve, rotate, and revoke high-entropy API credentials; authenticate HTTP and WS before exposing project data. Test missing/invalid credentials, keychain denial/lock, restart persistence, rotation, and invalidation of existing sessions.
- [ ] Specify secure handoff to CLI and future browser clients. Account for browser WebSocket authentication constraints; never place long-lived tokens in command arguments, query strings, committed files, project metadata, or logs. Test logs/errors for token disclosure.
- [ ] Implement explicit headless authentication mode without a desktop session, Secret Service, or OS-keychain dependency. Use the same authenticated HTTP/WS contract as desktop mode; keychain absence must never silently disable authentication. Keep API authentication separate from M7's engagement encryption and vault keys.
- [ ] Provide initialization and unlock commands for a passphrase-encrypted local API credential store outside project directories. Generate the API token with cryptographic randomness; protect it using authenticated encryption and a salted password KDF. Record the format/version, algorithm and parameter choices, bounded input/work limits, atomic updates, owner-only directory/file permissions, and tamper/wrong-passphrase behavior in the authentication ADR before implementation.
- [ ] Accept the unlock passphrase through a hidden terminal prompt for interactive SSH use or a dedicated inherited file descriptor for service-managed startup. Supply the client credential through the same explicit provider boundary. Never pass secrets in argv or persist plaintext credentials; unattended startup requires an external credential provider, not an embedded unlock key. Document how both the core and CLI authenticate, restart, rotate credentials, and recover from a lost passphrase by resetting local API credentials without changing project history.
- [ ] Test headless initialization, core startup, CLI HTTP access, WS authentication/reconnect, restart/unlock, rotation/revocation, wrong passphrases, malformed/tampered stores, unsafe permissions, missing credential input, and noninteractive failure without hanging for a prompt. Verify prompt/FD equivalence with no terminator, one LF, or one CRLF, preserved other whitespace, strict UTF-8, and raw/normalized size limits. Run installed-bundle integration with no desktop/keychain and no external network. Check that prompts, logs, errors, and audit records disclose neither tokens nor passphrases.

#### M2.11 — WebSocket events and context notifications

- [ ] Define versioned subscribe/unsubscribe, event, context-change, error, and resync messages with explicit project IDs and sequence cursors. Keep durable ledger events distinct from transient service/context notifications; no PTY protocol implementation before M4.
- [ ] Publish only committed events. Implement bounded replay followed by live delivery without a gap at the handoff; document duplicate handling and reconnect after a service restart. A cursor is scoped to one project, never reused across ledgers.
- [ ] Implement heartbeat/disconnect cleanup, backpressure and slow-client limits, invalid-cursor behavior, and switch subscription rules. Test two clients, reconnects, duplicate delivery, disconnect during a switch, unauthorized subscriptions, and absence of cross-project event leakage.

#### M2.12 — Generated contracts and usable CLI

- [ ] Generate OpenAPI and the M2 payload schema appendix from the Zod contracts; publish WS schemas/protocol documentation alongside them. Add deterministic generation/drift checks and a shared generated TypeScript API client usable by Node and future browser clients (ADR 0003).
- [ ] Extend `pentrackr` with core startup/status and project create/list/show/update/state/switch/register/unregister/rebuild commands. Support scriptable JSON output, clear exit codes, and schema-validated metadata input without putting tokens in argv.
- [ ] Make new business commands use the authenticated API. Preserve M1 command compatibility and regression-test M2.3's core-stopped rule for offline `verify`/`seal`/`log`; `keygen` requires no ledger ownership. Test the stop → offline maintenance → restart workflow in installed bundles.
- [ ] Exercise the generated client and CLI against a real temporary core: create two projects, edit metadata, transition, switch, query both histories, rebuild, stop, restart, and verify. Check help and failure output as well as successful operation.

#### M2.13 — Optional engagement templates

- [ ] Ship authorization letter, SOW/contract cover, NDA, RoE, scope worksheet, and escalation contact sheet under `docs/templates/`. Use clearly marked placeholders and match the metadata fields; filling a template is never an application authorization gate.
- [ ] Expose template list/read/copy through the CLI/API and include the files in release bundles. Copy into operator files without silently attaching them or overwriting existing work; document that attachment ingestion arrives in M3.
- [ ] Verify all six templates are available from an installed bundle, contain no real engagement/infrastructure data, and allow projects to proceed when none is used.

#### M2.14 — Integration, packaging, and closeout

- [ ] Run the M2 acceptance scenario below with synthetic fixtures; add crash/recovery and adversarial isolation tests alongside the relevant phases. Verify installed operation with external networking disabled, including credential retrieval and schema/template access.
- [ ] Extend bundle planning for new workspaces, transitive dependencies, static templates/schemas, and any platform-specific optional/native keychain packages. The current bundler walks `dependencies` and deduplicates by name; verify optional packages and conflicting dependency versions instead of assuming they are included correctly.
- [ ] Upgrade the packaged smoke test from `--version` to core startup, authenticated project operations, and shutdown. Run checks and packaging on Linux, Windows, and macOS; distinguish real keychain integration coverage from injected adapters and list any platform gap.
- [ ] Update README, operating/API documentation, ADR index, testing instructions, requirement annotations, and this milestone's actual results. Include data locations, recovery/rebuild, token rotation, wider-bind behavior, and remaining M3/M4/M5/M7 work. Preserve the frozen SRS.
- [ ] Run `pnpm run check`, the generated-contract drift check, and bundle smoke tests; review the diff for data leakage and unearned requirement claims. Prepare the milestone PR with per-phase commits and the required CI results (D18/D24); mark M2 complete only after its exit criteria pass.

**M2 exit criteria:**

1. From an installed bundle, start an authenticated local core without cloud access, including headless Linux with no OS keychain. Authenticate CLI and WS clients, restart/unlock the core, and rotate credentials in that environment. Create a minimal Lab project and a Draft project with distinct metadata, with no legal documents required.
2. Drive metadata edits and approved/rejected state transitions through the CLI/generated API client, including audited reopening and manual pause without RoE/windows. Successful mutations produce typed, attributed, verifiable events; rejected/stale requests do not alter project truth. Unregister a project, observe the files-preserved warning, and register it again with unchanged identity and history.
3. Connect two independent clients, switch A→B→A, and observe the same active context with correctly attributed `project.switched` history. Inject a failed switch and a restart; recover to a documented, consistent state with no write or subscription routed to the wrong project.
4. Rebuild projections and restart the service. Metadata, state, and scope match their pre-rebuild values, with unchanged historical hashes/checkpoints. Retried requests do not duplicate completed business operations.
5. Reject unauthenticated HTTP/WS access and disallowed hosts/origins; demonstrate token rotation, authenticated reconnect, replay, and slow-client handling. Default listeners are loopback; wider exposure is explicit, warned, and audited.
6. Generate reproducible API/schema artifacts and retrieve all six bundled templates. Three-OS checks and installed-bundle tests pass, with actual keychain coverage and any limitations stated.

**Handoff:** M3 adds document bytes and attachment verification; M4 consumes state/switch hooks for runner availability and terminal ownership; M5 enforces stored scope/RoE/window policies; M6 builds the graphical switcher; M7 implements and measures actual secret disposal. Full §28.1 and FR-UI-003 remain tracked across those integrations.

### M3 — Blob store, manifest, lossless ingest floor (M, ~30h)
Content-addressed store, file manifest, unknown-type cataloguing, external artifact import, manifest export.
**Closes:** FR-MANIFEST-001/002, FR-ING-002/004, FR-CASE-003, FR-EVD-005, NFR-005.
**Exit:** import an `htba` case wholesale — including the `.dll`, `.exe`, `.pyc`, `.zip` files no parser will ever understand; every byte in the manifest with a hash; parser failures are ledger events, not data loss.

### M4 — Runner, agent boundary, command ledger (L, ~80h) — *highest risk*
PTY on three OSes, shell integration for bash/zsh/fish/PowerShell, three capture tiers, full §5.3 field set with explicit nulls, tool identity/version/hash, clock skew, raw-mode banner, runlog import. **The agent interface is defined here with an in-process implementation** (D5), so M13 adds a transport rather than a redesign.
**Closes:** FR-CMD-001/002/003/004/011/013/014, NFR-003, NFR-010, FR-EVD-008 (partial).
**Exit:** every §5.3 field populated or explicitly null on each OS; a raw shell yields `capture=partial` or better; benchmark under the NFR-003 target; **and the runlog importer reconstructs Cap's 19-row `command_ledger.md` from raw logs with matching timestamps, durations, and exit codes.**

### M5 — Scope engine and guardrails (M, ~40h)
Scope and exclusion objects across all types, target parser registry with generic fallback, risk classification with override, three verdicts, blackout windows, out-of-scope attempt events, destructive policy, **compiled scope snapshots** for agent-local evaluation.
**Closes:** FR-SCP-001..005, FR-SAF-006, FR-CMD-005/006/007/008.
**Exit:** table-driven verdicts including IPv6, wildcard domains, CIDR boundaries; blocked commands produce full attempt events; the unconstrained path (§1.5) allows execution while honouring explicit excludes; replaying `htba` commands against `10.129.0.0/16` yields allow, against an empty scope yields block, zero misclassifications — acceptance item §28.2.

### M6 — Web UI, first client (L, ~80h) — *first usable*
xterm.js terminals over WebSocket to the runner, ledger browser with filters, project switcher, evidence drop zone, screenshot hotkey, themeable shell with the §4.3 sidebar.
**Closes:** FR-UI-001/002/004/005/007/010, FR-EVD-002.
**Exit:** own an HTB box entirely from the browser, producing a ledger at least as complete as `runlog.sh` for the same work. **Checkpoint release candidate** (§3).

### M7 — Vault, evidence, redaction (L, ~60h)
At-rest encryption, metadata-first secrets with the full §11.1 field set, reveal with reason and audit event, loot register, chain of custody, redaction profiles and pipeline.
**Closes:** FR-SEC-001/002/006, FR-LOOT-001, FR-EVD-001/004/005/006/007, FR-SECPL-003/004/005/006.
**Exit:** canary fuzz passes with zero plaintext escapes; reveal writes an immutable access-log event; importing Cap auto-classifies the FTP credential as a secret and the flag files as proof-of-access loot — acceptance items §28.8, §28.9.

### M8 — Findings and cleanup ledger (M, ~40h)
Full finding object, CVSS with business-adjusted severity, exploitation status, evidence-pointer gate on "verified", cleanup ledger, uncleaned-artifacts report. The finding schema is validated against the field set your FireFlow template already uses — if the model can't render that report, the model is wrong.
**Closes:** FR-FND-001..009, FR-FND-012, FR-CLN-001..005, FR-CLN-010..013.
**Exit:** no finding reaches verified without an evidence pointer; closing with an open cleanup item produces the residual report — acceptance item §28.11.

### M9 — Reporting (M, ~60h) — **DAILY DRIVER: retire `runlog.sh`**
Report versioning, redaction profiles as render profiles, Markdown + PDF + DOCX + JSON export, distribution log, four bundled templates plus the optional house-template slot.
**Closes:** FR-RPT-001/002/003/006/007/008/009/010.
**Exit:** regenerate the FireFlow report from the imported Cap-style data and diff against the hand-written original — differences must be improvements or formatting, never missing substance — acceptance item §28.10. **This is the switch-over point.**

### M10 — TUI, second client (M, ~40h)
Ink client against the generated API client; parity conformance suite runs one scripted scenario through both clients and diffs the event streams.
**Closes:** FR-UI-011, §4.1 parity.
**Exit:** identical ledgers from web and TUI driving the same scenario.

### M11 — Assets, parsers, Cap demo project (M, ~50h)
Host and service projections with merge-on-identity and provenance, first-party parsers (nmap XML/gnmap/normal, generic JSON/XML, screenshot drop, markdown report, runlog), parser versioning and replay, **Cap imported as a real demo project** (Δ7).
**Closes:** FR-AST-001/002/007, FR-ING-001/003, FR-PLG-004.
**Exit:** the corpus's 67 nmap XML, 66 gnmap, and 65 normal-output files parse into projections with snapshot tests; the 14 non-nmap XML files exercise the generic parser; re-running an improved parser over stored bytes updates projections without touching history — acceptance item §28.12.

### M12 — Operator workflow layer (M, ~50h)
Manual activity types with hotkey logging, tasks and hypotheses, scratchpads with paste detection and vault promotion, checklist engine with bundled methodology packs (your 8-phase model from `htba/modules/pen_tester`), timeline filters, coverage gaps.
**Closes:** FR-MAN-001/002/003, FR-TSK-001..004, FR-SCR-001/002/003, FR-CHK-001, FR-TL-001/002, FR-COV-003.
**Exit:** acceptance item §28.7.

### M13 — Remote runner agent (L, ~70h) *(Δ2)*
`pentrackr agent` per D5: outbound mTLS dial, one-time-token pairing, PTY and shell integration on the remote host, compiled scope snapshot, blob streaming to the laptop, protocol version lock.
**Closes:** extends FR-CMD-001/006/013 beyond the FR-CMD-014 baseline.
**Exit:** own an HTB box from a Kali VM with the cockpit and all evidence on the laptop; destroy the VM; the ledger, blobs, and report are complete and verifiable.

### M14 — Model adapters and prompts (M, ~50h)
Three adapters behind one interface: **Codex CLI** and **Claude Code CLI** on the `cli-subprocess` transport, **Ollama** on `http-local`. Context packager with redaction preview, keychain credentials, drafts-not-facts enforcement, versioned prompt library, offline mode.

CLI adapters get a property the API path doesn't: the CLI is a process, so it runs **through the managed runner** — every model invocation is a `full`-tier command event with argv, duration, and exit code. The intelligence plane audits itself, and V2's supervised-exec path (FR-AI-006) becomes the same code path as any other approved command.
**Closes:** FR-AI-001/002/003/005/007/008, FR-PMT-001/002/003.
**Exit:** a template prompt runs against redacted context through the `codex` CLI, lands in a scratchpad as a draft, and the invocation is visible in the command ledger; the operator plane is fully usable with models disabled; Ollama serves the same prompt with no network — acceptance item §28.13.

### M15 — Case export and import (M, ~40h)
Complete case package (ledger, blobs, vault ciphertext, templates, plugin list), import with chain verification, unredacted-export gate.
**Closes:** FR-CASE-001/002/004.
**Exit:** acceptance items §28.4, §28.14.

### M16 — VS Code extension (L, ~70h) *(Δ1 — final stretch goal)*
Activity bar, sidebar, terminals via `Pseudoterminal` proxy to the runner, ledger browser, palette, status bar.
**Closes:** FR-UI-009.
**Exit:** acceptance item §28.3 — one project open in all three clients against one core, identical ledgers.

### M17 — MVP hardening and acceptance (M, ~40h)
The §28 fifteen-item script automated across three OSes, installers, backup/restore docs, threat model, release notes with the per-OS gap list.
**Closes:** NFR-007, NFR-008 sign-off, NFR-012/013/014 audit, full MVP traceability.
**Exit:** MVP as §27.1 defines it, demonstrated on a real external + web engagement.

**Then:** V2 per §27.2 and V3 per §27.3. The corpus makes several V2 items unusually cheap — DanglingTree already holds BloodHound exports for FR-AST-004, and Cap holds a downloaded pcap analysed with tshark for FR-NET-001/002.

---

## 7. Critical path

```
M0 → M1 → M2 → M3 → M4 → M5 → M6 ──────────────── checkpoint (usable)
                                    ↓
                              M7 → M8 → M9 ─────── DAILY DRIVER (retire runlog.sh)
                                            ↓
        M10 ─┬─ M11 ─┬─ M12 ─┬─ M13 ─┬─ M14 ─┬─ M15 → M16 → M17
             └───────┴───────┴───────┴───────┘  (reorderable by real use)
```

M0–M9 are effectively sequential; each is substrate for the next. After M9 the order is negotiable against whatever daily use proves is missing — which is the entire point of getting there first.

---

## 8. Testing strategy

**Posture: test liberally.** Tests are written alongside code, not after it, and the default is that every exported function has direct unit tests covering its success path, its failure paths, and its boundaries. A module with no test file is treated as incomplete rather than as pending.

This is not thoroughness for its own sake. Three properties of this specific product make cheap tests unusually valuable:

- **The traceability gate needs them.** A requirement cannot reach `complete` without a test annotation (§6, M0.3), so testing is the mechanism by which work counts as done at all.
- **The ledger's value is its correctness.** A hash chain that is subtly wrong is worse than no hash chain, because it invites confidence it cannot support.
- **The cadence demands them.** On an evenings-and-weekends schedule with three-week gaps, a dense test suite is what lets a cold restart change code confidently instead of re-deriving why it worked.

Where behaviour is expressible as an invariant rather than an example — chain verification, canonical encoding, scope verdicts, redaction — property-based tests (`fast-check`) are preferred over example tables, and the example tables are kept as regression anchors for bugs actually found.

Coverage is measured and reported per milestone. It is a diagnostic for finding untested branches, not a target to be gamed: a line-coverage number can be driven up by tests that assert nothing, so the review question is always whether the failure modes are covered, not whether the percentage rose.

| Layer | Approach |
|----|----|
| Ledger | Property-based: arbitrary sequences, tamper detection, crash-during-append, deterministic re-export, RFC 8949 vectors. |
| Runner | Per-OS integration tests in CI; latency benchmark against NFR-003; fidelity matrix per shell per OS; the Cap ledger reconstruction oracle. |
| Agent | Kill-the-VM test: destroy the remote host mid-session, assert the ledger is intact and verifiable on the laptop. |
| Scope engine | Table-driven verdicts over an adversarial address corpus; a "no false allow" invariant; replay of real corpus commands. |
| Parsers | Golden corpus from `htba`, snapshot-tested; a lossless invariant test that crashes a parser on purpose and asserts the raw blob survives. |
| Vault/redaction | Canary fuzzing across every object type and output channel; zero escapes; heap-snapshot check after project switch. |
| Clients | Parity conformance suite: one scenario, every client, diffed event streams. |
| Acceptance | The §28 list, automated, three OSes, as the release gate. |
| Supply chain | Secret scanning and dependency audit on every commit (public repo). |
| Traceability | CI fails if claimed FR IDs lack `@req` annotations on both an implementation and a test. |

---

## 9. What gets modelled but not built in MVP

Per the SRS's own instruction, so no breaking migration is needed later: wireless/physical/social inventory (FR-AST-006), session and attack-edge entities (§13), traffic flow and proxy exchange (§9), purple-join (§19), cross-engagement correlation keys (§18), plugin manifest schema (§23). Event types and tables exist; UI does not.

---

## 10. Licensing

**Apache-2.0** for the open core *(decided)*. Permissive and corporate-friendly like MIT, but adds an explicit patent grant — which matters for a security tool firms run commercially, where MIT's silence becomes a procurement question — and a trademark clause that protects the "Trackr" name against forks. Fully compatible with the dual-module plan (§2.5); as sole copyright holder you can dual-license the closed pack however you like.

---

## 11. Risk register

| Risk | Impact | Mitigation |
|----|----|----|
| Windows argv capture unreliable under ConPTY | Core value weakens on a first-class OS | PowerShell profile hooks (the VS Code technique, same runtime); `cmd.exe` documented `session-only`; fidelity stated, not assumed. Prototyped M4. **Escape hatch: Go `ptyhelper`.** |
| `node-pty` reintroduces the M1 native-build failure at M4 | Windows CI breaks the way it did on `better-sqlite3` | **Measured, largely retired (ADR 0013).** On Windows with no C++ toolchain, node-pty installs from a shipped prebuild in seconds and spawns a working ConPTY. Its install script still falls back to `node-gyp`, so a future Node ABI without a prebuild would recur — `.nvmrc` pinning Node 22 keeps that under our control. |
| **Scope exceeds cadence** | Daily driver never arrives; project stalls at 70% | §3 states the arithmetic openly; M6 is a shippable checkpoint; milestones end resumable-cold so three-week gaps cost nothing. |
| Remote agent doubles the runner's surface | Δ2 eats the budget | Agent interface defined at M4 with an in-process implementation, so M13 adds transport, not redesign. Sequenced *after* the daily driver — FR-CMD-014 doesn't require it for MVP. |
| Node packaging with native addons | Release friction, broken installs | `prebuildify` matrix in CI from M0; npm fallback; installer smoke-tested on three OSes every release. |
| Runner overhead makes the shell feel wrong | Operators bypass the cockpit; §2.2 fails | Async append off the hot path, precompiled scope matchers, compiled snapshots on the agent, benchmark gate from M4. |
| Redaction leak in a client deliverable | The most damaging possible defect | Single pipeline, structured objects only, canary fuzzing with real corpus secrets, renderer refuses unbound "verified" claims (FR-RPT-009). |
| JS cannot guarantee zeroization | Weaker isolation than FR-SECPL-004 implies | Buffers not strings, explicit overwrite, lint rule, heap-snapshot test, honest statement of the limit in the threat model. |
| **Public repo leaks lab credentials** | Real secrets exposed permanently in git history | Corpus never committed (§12); fixtures load from a local path; secret scanning in CI from M0; only sanitized golden outputs enter git. |
| DOCX fidelity across platforms | Deliverables look wrong at the client | Golden-file tests for DOCX; PDF via Typst is deterministic; report render covered by the acceptance script. |
| Key loss locks you out of your own evidence | Unrecoverable data loss | Documented key backup (NFR-007), passphrase fallback, explicit non-recoverable warning at project creation. |
| Overclaiming what the hash chain proves | Credibility damage in a real dispute | Threat model (FR-SECPL-010) stating precisely what the chain does and does not establish. |

---

## 12. The `htba` corpus

`~/Git/htba` is the reference dataset. **Read-only to this project — no file in it is ever written, moved, or committed from here.** It currently holds 91 uncommitted modified files of your own; that is pre-existing and untouched.

**Contents:** 1,801 files across 10 HTB cases (Cap, Conversor, DanglingTree, Expressway, Facts, FireFlow, MonitorsFour, Overwatch, Soulmate, TwoMillion) plus module labs. By type: 238 `.log`, 144 `.txt`, 81 `.xml` (67 nmap), 66 `.gnmap`, 65 `.nmap`, 36 `.json`, 23 `.html`, plus binaries, BloodHound exports, and a pcap.

| Use | Detail |
|----|----|
| **Runlog import oracle** (M4) | `runlog.sh` writes two independent records of the same events — timestamped `.log` files and an append-only `command_ledger.md` table. **The table is therefore a correctness oracle**: import the logs, reconstruct the ledger, diff against the table. Stronger than any assertion I'd have written by hand. |
| **Parser golden corpus** (M11) | 198 nmap outputs in three formats is a better test set than anything I'd synthesise. Snapshot-tested. |
| **Demo project** (M11) | Cap imported as a real project (Δ7) for exercising reports and UI against real data. |
| **Report template source** (M8/M9) | `*_pentest_report.md` is the house template FR-RPT-007 refers to; its finding structure defines the fields the model must carry. |
| **Directory-convention reference** (D2) | `scans/ logs/ screenshots/ evidence/ credentials/ scope/ loot/ tools/` is a hand-maintained projection of what Pen Trackr generates. |
| **Checklist packs** (M12) | `modules/pen_tester` documents the 8-phase methodology FR-CHK-001 names. |
| **Redaction canaries** (D8/M7) | Real lab credentials and flags in argv and logs — precisely the shape of what must never reach a client profile. |
| **Script inspiration** (Δ6) | `auto_nmap.sh`, `nmapAutomator.sh`, `htb-vpn.sh`, `win_shell.ps1` inform hardened first-party scripts in `scripts/`. Not imported — authored fresh, reviewed, and shipped under our own licence. |
| **Unparseable-artifact test** (M3) | `.dll`, `.exe`, `.pyc`, `.zip`, `.ccache` prove FR-ING-004: catalogued, hashed, never dropped. |

**Handling rule.** Fixtures load from a configurable source path defaulting to `~/Git/htba`, with recorded SHA-256s so drift is detected. **The corpus is never committed** — it contains real credentials and flags, and this repository is public. Only sanitized golden outputs enter git.

---

## 13. Immediate next steps

1. `LICENSE` (Apache-2.0), `README.md`, and `.gitignore` — public-repo presentable from the first commit.
2. `docs/adr/0001-typescript-core.md` … `0010-module-split.md`, including the Rust-considered-and-rejected rationale so the reasoning survives.
3. `tools/trace` — traceability extractor, baseline coverage report against `req_spec.md`.
4. pnpm workspace skeleton, three-OS CI matrix, packaging job, secret scanning (M0).
5. A `node-pty` spike on Windows and macOS **before M1 finishes**, to de-risk D5 early enough to reach for the Go helper if needed.
6. Fixture harness pointing at `~/Git/htba`, Cap wired up as the M4 import oracle.
7. Initial commit on `master`.

---

## 14. Decision log

| # | Decision | Resolution | Date |
|----|----|----|----|
| D26 | Reopening and manual pause | **Closed projects support audited reopening. Manual pause works without RoE or testing windows** (Δ9). | 9 Sep 2026 (M2 planning) |
| D27 | Project removal | **Unregister only; all project files remain.** Show the operator a warning that files remain on disk. | 9 Sep 2026 (M2 planning) |
| D28 | Headless authentication | **Required in M2:** core and clients can authenticate on headless Linux without an OS keychain. The credential-store and unlock design is specified and tested in M2.10. | 9 Sep 2026 (M2 planning) |
| D1 | Core language | **TypeScript / Node 22 LTS** everywhere. Python as plugin SDK target; Go held as the PTY escape hatch. Rust considered and rejected on maintainability. | 5 Sep 2026 |
| D2 | Codex adapter | **CLI subprocess**, driving the `codex` app. Adapter interface carries `cli-subprocess` and `http-local` transports. | 5 Sep 2026 |
| D3 | Default branch | **`master`**, unchanged. | 5 Sep 2026 |
| D4 | Reference corpus | **`~/Git/htba`**, read-only, never committed. | 5 Sep 2026 |
| D5 | Open-core licence | **Apache-2.0**. | 5 Sep 2026 |
| D6 | Client build order | **Web UI → TUI → VS Code last.** VS Code remains the intended primary cockpit (Δ1). | 5 Sep 2026 |
| D7 | Remote execution | **Core on the laptop, thin agent on the attack host.** Agent dials out; evidence never persists remotely (Δ2, D5). | 5 Sep 2026 |
| D8 | Cadence | **Evenings and weekends** (~7.5 h/wk). Milestones end resumable-cold. | 5 Sep 2026 |
| D9 | First useful slice | **Runlog parity + evidence + scope engine + findings + reports** = M9, the daily driver. | 5 Sep 2026 |
| D10 | Repo visibility | **Public from day one.** Secret scanning from M0; corpus never committed. | 5 Sep 2026 |
| D11 | Report formats | **Markdown + PDF + DOCX + JSON at MVP**, per FR-RPT-008. | 5 Sep 2026 |
| D12 | Model backends | **Codex CLI, Claude Code CLI, Ollama.** No hosted Messages API in MVP (Δ4, Δ5). | 5 Sep 2026 |
| D13 | Existing automations | **Inspiration only** — hardened first-party scripts authored here (Δ6). | 5 Sep 2026 |
| D14 | Spec baseline | **SRS v0.2 frozen**; this plan carries all deltas (§2). | 5 Sep 2026 |
| D15 | Corpus backfill | **Cap as a real demo project**, other nine as fixtures (Δ7). | 5 Sep 2026 |
| D16 | Package naming | **`@pentrackr/*` scoped**; the CLI still publishes as plain `pentrackr`. npm org to be claimed before first publish. | 5 Sep 2026 (M0) |
| D17 | Lint and format | **Biome**, replacing ESLint + Prettier (ADR 0011). | 5 Sep 2026 (M0) |
| D18 | Commit granularity | **One commit per phase, one pull request per milestone.** | 5 Sep 2026 (M0) |
| D19 | Local installs | **Permitted on the development host, but notify and pause for approval first.** Applies to system packages and to project dependencies that build native code. | 5 Sep 2026 (M1) |
| D20 | Testing posture | **Test liberally** — every exported function gets direct unit tests; property-based tests for invariants; coverage measured per milestone as a diagnostic, not a target (§8). | 5 Sep 2026 (M1) |
| D22 | SQLite engine | **`node:sqlite`**, not `better-sqlite3`. Native compilation broke Windows CI at M1; ADR 0013 records the trade-off, including that the built-in API is experimental in Node 22. | 5 Sep 2026 (M1) |
| D25 | Node version | **Stay on Node 22 until Node 26 reaches Active LTS (28 Oct 2026), then move 22 → 26 in one step.** Node 24 is skipped: it enters Maintenance 20 Oct 2026, so adopting it would mean migrating twice. A non-blocking canary job runs the suite on Node 26 continuously (`docs/pipeline.md`). | 6 Sep 2026 |
| D24 | Branch protection | **`master` requires a pull request and all nine checks; administrators may bypass deliberately.** Work happens on branches. Without this the gates were advisory — seven pull requests were merged with nothing requiring them to be green. | 6 Sep 2026 |
| D23 | Windows test host | **`baldr`** — Windows 11 Pro 26200 on the maintainer's local network, Node 22.23.2 matching CI, reachable over SSH. Standing approval to install what testing needs. Connection details are deliberately not recorded here (see `docs/testing.md`). | 5 Sep 2026 (M1) |
| D21 | Signing key input | **Read from `PENTRACKR_SIGNING_KEY`, never from argv.** A key passed as an argument lands in shell history, `ps` output, and eventually this tool's own command ledger — the one it exists to protect. | 5 Sep 2026 (M1) |

---

## 15. MVP definition of done

The fifteen §28 acceptance items pass, automated, on Linux, Windows, and macOS; the traceability report shows every MVP-phase FR/NFR ID annotated with an implementation and a test; an open-core-only build reads a case file exported from a build with the closed pack; the Cap case round-trips from raw logs to a reconstructed ledger matching its hand-written `command_ledger.md`; a box is owned from a Kali VM with all evidence landing on the laptop and surviving the VM's destruction; and a real external + web engagement has been run end to end, producing both a client report and a cleanup letter.
