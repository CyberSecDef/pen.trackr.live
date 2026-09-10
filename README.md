# Pen Trackr

**An engagement operating system for authorized penetration testing.** Every command, manual action, screenshot, secret, finding, and target change becomes an event in one hash-chained ledger — scoped before execution, redactable by audience, and exportable as evidence.

> **Status: pre-alpha. The ledger spine works; nothing else does yet.**
> Two of eighteen milestones are complete. There is no terminal capture, no scope engine, no evidence store, and no user interface. What exists is the tamper-evident foundation the rest is built on, plus a CLI to exercise it. See [What works today](#what-works-today) for the honest boundary, and [Roadmap](#roadmap) for the rest.

---

## The problem

A professional engagement produces a flood of artifacts: shell history, scanner XML, proxy projects, BloodHound graphs, screenshots, loot, tickets, notes. They rarely share a primary key. So when a client asks whether you caused their outage, whether a credential was reused, or whether that persistence mechanism was actually removed, the answer gets reconstructed by hand from six places.

Scope gets audited after the fact. Redaction is a find-and-replace pass in Word. Cleanup is a memory test.

Pen Trackr exists so that none of those are true.

## What it does

- **Proves what happened.** An append-only, hash-chained ledger with interval signatures. Not a log file — a record that can be verified and that detects tampering down to the offending event.
- **Enforces scope at execution time.** Commands are evaluated against in-scope and excluded targets *before* they run. Out-of-scope attempts are recorded whether they were blocked or overridden. Review is not a substitute for a block.
- **Keeps evidence bound to causes.** Every screenshot, dump, and retrieved file points back to the command or manual action that produced it, with chain of custody.
- **Treats secrets as privileged objects.** Metadata-first by default; revealing plaintext is an audited event. Redaction is a pipeline with audience profiles, not a last-minute pass.
- **Remembers what you changed.** A cleanup ledger tracks every file written, account created, and service installed — and emits an uncleaned-artifacts report at close, so residuals are handed over deliberately rather than forgotten.
- **Keeps dead ends.** Failed hypotheses stay on the timeline and the graph. Methodology and reporting stay honest.
- **Never loses raw bytes.** Every imported scan, log, dump, and foreign artifact is stored hashed before any parser runs. Parsers may be lossy; the store may not.

## What it is not

This boundary is a requirement, not a disclaimer:

- **Not an exploit framework.** No bundled payloads, no exploit code, no weaponized templates.
- **Not a C2.** No beacon, no implant, no command-and-control protocol.
- **Not a phishing engine.**
- **Not a replacement** for Burp, ZAP, Nmap, BloodHound, NetExec, Impacket, or cloud CLIs. It integrates and records them. Attack tools stay external.
- **Not autonomous.** Models draft, classify, and warn. A supervised path lets an operator approve a proposed command before the managed runner executes it. Silent autonomous execution against targets is out of scope by design.

## Intended use

Pen Trackr is for professional testers and purple-team operators working under authorization, and for practitioners running lab and training environments.

Authorization letters, SOWs, NDAs, and Rules of Engagement are first-class documents, and templates ship with the product — but none are required to create a project or run a command, and the product does not pretend that filling in a template constitutes legal authorization. Scope and RoE, when supplied, drive the scope engine. Lab mode exists precisely so practice work does not have to pretend to be a client engagement.

**You are responsible for having authorization for whatever you point it at.**

## What works today

Two milestones are done: **M0** (toolchain, three-OS CI, packaging, requirement traceability) and **M1** (the ledger spine).

```console
$ pentrackr keygen
$ export PENTRACKR_SIGNING_KEY=<private key>
$ pentrackr seal engagement/ledger.db
sealed checkpoint 1
  events    5
  head      902bbd4b0bd8b8e17c4e0068d4a729c7ab1d8e05509a908127a5716179e59941

$ pentrackr verify engagement/ledger.db --public-key <public key>
chain ok: 5 events, head 902bbd4b0bd8b8e17c4e0068d4a729c7ab1d8e05509a908127a5716179e59941
checkpoints ok: 1 signed
```

Delete two events from the middle of that ledger and the chain reports which one broke and where. Delete two from the *end* and the chain still verifies — that is what hash chains do — but the signed checkpoint does not:

```console
chain ok: 3 events, head 72ee86d5769f88b87cc1db5f56d9aa51c71d45b93fcb0d427341fcd85fc877e8
checkpoints BROKEN at checkpoint 1
  truncated: signature attests 5 events but only 3 are present
```

Under the hood: a deterministic CBOR encoder verified against RFC 8949 test vectors, SHA-256 hash chaining with a versioned domain tag, Ed25519 checkpoints, an append-only SQLite store where immutability is enforced by database triggers rather than application convention, and a projection framework that can drop any derived view and rebuild it from events alone.

**Requirements closed so far:** `FR-SECPL-001`, `FR-SECPL-002`, `NFR-006`, `NFR-009`, `NFR-010` — 5 of 216. A requirement only counts as closed when both an implementation and a test are annotated with its ID, and CI fails on a claim that lacks either.

**Not yet built:** everything else. No command runner, no scope enforcement, no vault, no findings, no reports, no clients.

## Building and testing

```console
corepack enable pnpm
pnpm install
pnpm run check      # lint, typecheck, tests with coverage, traceability
```

Node 22 or newer. No C++ toolchain required on any platform — storage uses Node's built-in SQLite ([ADR 0013](docs/adr/0013-node-sqlite.md)).

904 tests pass on local Linux as of M2.2; Linux, Windows, and macOS remain the CI gate. See [docs/testing.md](docs/testing.md) for how each platform is covered, including which one is only covered by CI.

## Architecture

Four planes, one local core service, several clients:

| Plane | Holds |
|----|----|
| **Ledger** | Append-only events, hash chain, interval signatures, engagement-scoped encryption |
| **Projection** | Assets, services, web surface, AD, cloud, credentials, findings, sessions, cleanup, timeline, graph — all rebuildable from the ledger |
| **Operator** | Clients sharing one API: project switcher, terminals, tasks, scratchpads, checklists, reports |
| **Intelligence** | Prompt library, agent runs, model adapters. Drafts by default; supervised execution only with operator approval |

Clients never write business truth except by appending events through the core API. Projections are disposable; history is not.

**Design constraints:** local-first and air-gap operable · single operator, no cloud control plane · Linux, Windows, and macOS all first class · no telemetry of engagement content · open core sufficient on its own.

**Stack:** TypeScript on Node 22 · SQLite + content-addressed blob store, one directory per project · Fastify HTTP/WS on loopback · `node-pty` for terminals · web UI, TUI, and a VS Code extension against one API · plugins in TypeScript and Python, out-of-process and capability-gated.

Remote work uses a thin agent on the attack host that dials out to the core; the ledger, vault, and all evidence stay on the operator's laptop, so a destroyed VM loses nothing.

## Roadmap

Development is sequenced so the tool becomes usable long before it is complete.

| Phase | Milestones | Delivers | Status |
|----|----|----|----|
| Foundation | M0–M1 | Project rails, ledger spine | **done** |
| Foundation | M2–M5 | Projects and core API, blob store, command runner, scope engine | next |
| **Checkpoint** | M6 | Web UI — a usable cockpit with terminals, ledger, and evidence capture | |
| **Daily driver** | M7–M9 | Vault and redaction, findings and cleanup, report generation | |
| Breadth | M10–M15 | TUI, parsers and asset inventory, tasks and checklists, remote agent, model adapters, case export | |
| Stretch | M16 | VS Code extension | |
| MVP | M17 | Full acceptance across three operating systems | |

Full detail, including per-milestone exit criteria and honest effort estimates, is in [`plan.md`](plan.md).

## Repository contents

| Path | What it is |
|----|----|
| [`req_spec.md`](req_spec.md) | Software Requirements Specification v0.2 — 31 sections, 216 numbered requirements. Frozen as the baseline. |
| [`plan.md`](plan.md) | Development plan — architecture decisions, milestones with results, testing strategy, risk register, and every deliberate divergence from the SRS. |
| [`docs/adr/`](docs/adr/) | Thirteen architecture decision records. Immutable once accepted: a decision that turns out wrong gets a superseding record rather than an edit, so the reasoning stays readable. |
| [`docs/testing.md`](docs/testing.md) | How each platform is covered, and what CI is better at than a local machine. |
| `packages/ledger` | Event envelope, CBOR codec, hash chain, checkpoints, store, projections. |
| `packages/cli` | The `pentrackr` command. |
| `packages/project` | M2 domain schemas: identity metadata, lifecycle invariants, versioned payloads. |
| `packages/server` | M2 API/configuration schemas and lossless ledger JSON transport; no HTTP listener yet. |
| `tools/trace` | Turns `req_spec.md` into a coverage gate. |
| `LICENSE` | Apache-2.0 |

Requirements carry stable IDs (`FR-CMD-006`, `NFR-003`). Commits reference them, and CI will fail any milestone claiming an ID it has not annotated with both an implementation and a test.

## Licensing

Apache-2.0. The open core — service, ledger, runner, default parsers, clients, prompt mechanics, and case import/export — is fully functional on its own. A separately licensed module may later add house report packs, additional firm parsers, or private prompt packs; no such module will ever be required to read an open-core case file.

## Contributing

Not yet — there is no code to contribute to. Once M0 lands, issues and discussion are welcome.

---

*Pen Trackr is unaffiliated with, and has no functional dependency on, any other project sharing the `trackr.live` domain.*
