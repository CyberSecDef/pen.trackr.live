# 0005 — The core always talks to an agent; capture fidelity is recorded

**Status:** Accepted (5 September 2026)
**Requirements:** FR-CMD-001, FR-CMD-013, FR-CMD-014, NFR-003, NFR-008
**Supersedes assumption in:** SRS section 31 ("core service on localhost")

## Context

Commands run sometimes on the operator's laptop and sometimes on a Kali VM. The
SRS baseline (FR-CMD-014) requires only local shell wrapping for MVP, but real
use needs both.

## Decision

**The core always talks to an agent.** Locally that agent runs in-process;
remotely it is `pentrackr agent` on the attack host. One code path, one protocol,
no local-versus-remote branching.

Capture fidelity is recorded on every event, never assumed:

| Tier | Meaning |
|------|---------|
| `full` | The runner spawned the process. Real argv, exit code, per-line timestamps, tool hash. |
| `partial` | Interactive shell with shell integration. Argv from shell hooks; output from the PTY stream. |
| `session-only` | Raw mode, nested SSH, or hooks refused. Start, stop, cwd, session ID, raw bytes. Argv unknown, and said to be unknown. |

Remote agent properties: ships as a subcommand of the same binary; dials **out**
to the core so no inbound port opens on the attack host; holds nothing durable;
receives a compiled scope snapshot so verdicts evaluate locally at memory speed
while the authoritative event is still written on the laptop.

## Consequences

- Defining the agent boundary at M4 with an in-process implementation means the
  remote milestone adds a transport rather than forcing a redesign.
- Evidence and the ledger never persist on the attack host, so a burned VM loses
  nothing (FR-EVD-007).
- Pushing a compiled scope snapshot is what keeps NFR-003 satisfiable across a
  network hop. Without it, every command would pay a round trip.
- `cmd.exe` will likely be `session-only` on Windows because ConPTY exposes no
  argv. That is a documented gap in release notes, per NFR-008's instruction to
  list gaps rather than drop a platform.

## Alternatives rejected

**Core runs on the attack host, clients connect in.** Cheaper — no agent at all —
but evidence then lives on a machine that gets rebuilt, and a client engagement's
ledger should not be one `vagrant destroy` from gone.

**SSH tunnel with no agent.** Attractive for reusing existing trust, but shell
integration and tool hashing still need something executing on the far side.
