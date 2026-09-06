# Pen Trackr

**An engagement operating system for authorized penetration testing.** Every command, manual action, screenshot, secret, finding, and target change becomes an event in one hash-chained ledger — scoped before execution, redactable by audience, and exportable as evidence.

> **Status: pre-alpha. There is no implementation yet.**
> This repository currently contains the requirements specification and the development plan. Code begins at M0. See [Roadmap](#roadmap) for what exists and what does not.

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

| Phase | Milestones | Delivers |
|----|----|----|
| Foundation | M0–M5 | Ledger spine, projects, blob store, command runner, scope engine |
| **Checkpoint** | M6 | Web UI — a usable cockpit with terminals, ledger, and evidence capture |
| **Daily driver** | M7–M9 | Vault and redaction, findings and cleanup, report generation |
| Breadth | M10–M15 | TUI, parsers and asset inventory, tasks and checklists, remote agent, model adapters, case export |
| Stretch | M16 | VS Code extension |
| MVP | M17 | Full acceptance across three operating systems |

Full detail, including per-milestone exit criteria and honest effort estimates, is in [`plan.md`](plan.md).

## Repository contents

| File | What it is |
|----|----|
| [`req_spec.md`](req_spec.md) | Software Requirements Specification v0.2 — 31 sections, 216 numbered requirements. Frozen as the baseline. |
| [`plan.md`](plan.md) | Development plan v0.3 — architecture decisions, milestones, testing strategy, risk register, and every deliberate divergence from the SRS. |
| `LICENSE` | Apache-2.0 |

Requirements carry stable IDs (`FR-CMD-006`, `NFR-003`). Commits reference them, and CI will fail any milestone claiming an ID it has not annotated with both an implementation and a test.

## Licensing

Apache-2.0. The open core — service, ledger, runner, default parsers, clients, prompt mechanics, and case import/export — is fully functional on its own. A separately licensed module may later add house report packs, additional firm parsers, or private prompt packs; no such module will ever be required to read an open-core case file.

## Contributing

Not yet — there is no code to contribute to. Once M0 lands, issues and discussion are welcome.

---

*Pen Trackr is unaffiliated with, and has no functional dependency on, any other project sharing the `trackr.live` domain.*
