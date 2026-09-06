# Testing across platforms

NFR-008 makes Linux, Windows, and macOS equally first class, which means a
change is not done until it is green on all three.

## Environments

| Environment | Role |
|---|---|
| Linux dev host | Primary. Fast iteration, full suite in under a second. |
| `baldr` — Windows 11 Pro (26200) | Real Windows hardware on the maintainer's local network, reachable over SSH. Node 22.23.2, matching CI exactly. |
| GitHub Actions | The gate. `ubuntu-latest`, `windows-latest`, `macos-latest`. |
| macOS | **CI only.** No hardware available, so macOS is verified by absence of failure rather than by observation. |

## Running the suite on `baldr`

Host address, account, and key are kept out of this repository — see
[What stays out of this repository](#what-stays-out-of-this-repository).

```powershell
$env:Path = "C:\tools\node-v22.23.2-win-x64;C:\Program Files\Git\cmd;$env:Path"
Set-Location C:\dev\pen.trackr.live
git fetch origin; git checkout <branch>
pnpm install --frozen-lockfile
pnpm run check
```

Node lives in `C:\tools\` as an extracted zip rather than an installer — no
registry writes, removable by deleting the folder. pnpm comes from corepack.

## Why a second machine, beyond platform coverage

Two findings came from `baldr` that CI did not produce:

**A different random seed.** The property test asserting decoder byte-idempotence
failed on `baldr`'s first run, on a generated `__proto__` map key. Twenty
thousand runs on Linux had not sampled it and CI had been green throughout. The
bug was real: `result[key] = value` for the key `__proto__` invokes the inherited
setter, so the key vanished and a stored event would fail its own hash
verification on read. Property tests are only as good as the seeds they happen
to draw, and a second machine draws different ones.

**A representative measurement.** Append latency was first recorded from a CI
runner at roughly 20 ms and written into the plan as a finding. Real hardware
measures 2.0 ms — CI runners have shared virtualized storage, and a number taken
from one is not a number about the product.

## What CI is still better at

`baldr` is a convenience, not a substitute. CI runs macOS, runs on a clean
checkout every time, and cannot be affected by state left behind on a machine
someone has been poking at. A change is merged on CI's verdict, not `baldr`'s.

## What stays out of this repository

This repository is public. Two categories never enter it, and both are judgement
calls rather than things a scanner will catch for you:

- **Real engagement or lab data.** The `htba` corpus used for parser fixtures
  contains genuine credentials and proof-of-access flags, so it is loaded from a
  local path at test time and never committed (plan.md §12).
- **Real infrastructure details.** Host addresses, account names, key paths, and
  network layout stay out — for the maintainer's own machines as much as for any
  client's. Naming a host is fine; saying how to reach it is not.

The second rule was added after the fact: an earlier version of this file named
the SSH account for the Windows host, and plan.md carried its LAN address. Both
were caught in review rather than by CI, because secret scanning matches
credential *patterns* and neither of those is one.

Three layers now enforce it, deliberately narrow so they do not cry wolf — 10.x
lab addressing appears legitimately throughout this project, so the rules key on
`user@host` forms, home-LAN ranges, and key paths instead:

| Layer | Runs | Binds |
|---|---|---|
| `pnpm run hygiene` | `pnpm run check`, and the `security` workflow | Every pull request, whoever or whatever wrote it |
| `.claude/hooks/hygiene-staged.sh` | Before a `git commit` in Claude Code | Commits made through Claude Code on this machine. Fail-open by design: CI is the real gate |
| `.claude/skills/pre-pr-review` | Loaded before opening a pull request | The judgement calls no pattern catches — overclaiming, unstated limitations, requirement-ID honesty |

A line that genuinely needs to keep such a detail can append
`pentrackr-allow-infra`, which puts the exception in the diff where a reviewer
sees it rather than in a config file where nobody does.

## The unlink retries in test teardown

Every test that creates a temporary ledger tears it down with
`rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })`.
Those retries were added while chasing an `EBUSY: unlink` failure on Windows CI,
on the reading that WAL sidecar files were racing teardown.

**That reading was wrong.** The retries did not fix it, which is what pointed at
the real cause: `LedgerStore` opened the database and then threw on a schema
version mismatch, leaking the handle, so the file was genuinely still open rather
than briefly locked. Fixing that fixed the failure.

The retries stayed anyway, and the justification recorded at the time — that WAL
sidecars do produce real races — was plausible but unverified. Measured since, on
real Windows hardware: the ledger suite passes **10 out of 10 runs with the
retries removed entirely**.

They are kept regardless, and it is worth being precise about why, because the
measurement does not say what it might appear to:

- The original failure happened on a **CI runner**, with shared virtualized
  storage and a virus scanner, not on the hardware the 10 runs used. Ten passes
  on a fast local disk is weak evidence about a slow shared one.
- Keeping them costs nothing at runtime when no race occurs.
- Removing them to tidy the code risks reintroducing an intermittent red build in
  the one environment not covered by the measurement, for no benefit.

So they are **precautionary, not proven necessary** — which is different from the
load-bearing fix, and a distinction worth keeping straight if someone later
wonders whether they can go.
