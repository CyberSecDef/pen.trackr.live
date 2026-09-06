# CI/CD pipeline

Two workflows, nine required checks, and a rule that nothing reaches `master`
except through a pull request that passed them.

## What runs

| Workflow | Job | Enforces |
|---|---|---|
| `ci` | `check (ubuntu \| windows \| macos)` | Lint and format, typecheck, tests with coverage thresholds, requirement traceability, repository hygiene |
| `ci` | `package (ubuntu \| windows \| macos)` | The release bundle assembles and the packaged binary runs |
| `security` | `secret scan` | gitleaks over full history |
| `security` | `dependency audit` | `pnpm audit --audit-level moderate` |
| `security` | `repository hygiene` | No internal infrastructure details (see `docs/testing.md`) |
| `canary` | `node 26 (next LTS)` | The suite on the Node version this project will move to — **not required** |

All three operating systems are required, not advisory. NFR-008 makes them
equally first class, and five of the seven CI failures this project has had were
Windows-only — a matrix that is allowed to fail is a matrix that will.

## Branch protection

`master` requires a pull request and all nine checks. Administrators may bypass
it deliberately; that is a hatch for the maintainer, not a routine path.

Branches are cheap: work on one, open a pull request, merge when green.

## When the dependency audit fails and there is no fix

This will happen. An advisory lands upstream, no patched version exists yet, and
every pull request goes red through no fault of its author. Decide the response
now rather than at the moment it is blocking you:

1. **Prefer upgrading.** Most advisories have a fix within days; check whether a
   transitive pin resolves it before doing anything else.
2. **If there is genuinely no fix**, add the advisory to
   `pnpm.auditConfig.ignoreGhsas` in `package.json` — pnpm's own mechanism, so no
   wiring is needed in the workflow. `package.json` is strict JSON and cannot
   carry a comment, so record the reasoning in the section below this one, in the
   commit that adds the entry: the advisory ID, why it does not apply here, and
   the date to re-check. An exception with an expiry is a decision; an exception
   without one is a leak.

   *Current exceptions: none.*
3. **Do not weaken `--audit-level`.** Lowering the threshold to clear one
   advisory silently un-gates every future advisory at that severity, which is
   the failure mode this note exists to prevent.

The gate stays blocking on development dependencies too. "It is only a dev
dependency" is precisely the reasoning that lets a toolchain rot, and this
project ships a tool whose value is that it does not overstate its own hygiene.

The weekly schedule exists so advisories published after a merge surface on
their own rather than ambushing whoever opens the next pull request.

## Actions are pinned to commit SHAs

Tags are mutable. A repository that runs `some-action@v2` runs whatever that tag
points at today, including a third-party action with access to the runner. The
blast radius here is small — the repository is public and the token is
`contents: read` — so this is less a live risk than a matter of a security tool
modelling the practice it would recommend.

Dependabot moves the pins weekly. Pinning without an update path is how a
repository ends up running a two-year-old action.

**Minor and patch updates are grouped; majors are left ungrouped, one pull
request per dependency.** The first configuration grouped everything, and the
first batch it produced was four simultaneous major bumps as a single
accept-or-reject pull request. That batch was coherent — all four were the Node
20 runtime deprecation — but the shape was luck. Four unrelated breaking changes
would have arrived identically, with the only choices being all or nothing.

Ungrouped is not the same as sequential: several major pull requests can be open
at once. What changed is that each can now be taken or refused on its own merits,
not that they arrive one after another.

**`@types/node` major updates are ignored outright.** Those types describe a
runtime, so they must track the runtime rather than float ahead of it. The first
npm batch proposed `@types/node` 26 against a Node 22 runtime, which would have
had TypeScript accept APIs that do not exist where the code actually runs — a
mismatch the compiler cannot warn about, since the types are the thing being
trusted. Moving to a new Node major is a deliberate act that changes `.nvmrc`,
`engines`, and these types together.

When a major bump does arrive, green CI is necessary but not sufficient. Check
that the action still *does* its work: an action that passes because it silently
stopped doing anything is worse than one that fails. For the v2-to-v3
gitleaks-action bump that meant confirming the log still reported commits
scanned and a version, not just a green tick.

## Job timeouts

Every job has `timeout-minutes: 20`. The default is 360, so a hung test would
burn six hours across six jobs. Not hypothetical: a counter-saturation test in
this project looped forever locally before it was fixed.

## Test runtime, and when to act on it

Measured 6 September 2026, on the first green run after the M1 fixes:

| | Windows | Linux |
|---|---|---|
| Slowest file (`packages/ledger/test/store.test.ts`) | 29.5s | 1.4s |
| Whole suite, wall clock | 30.5s | ~1s |

The four slowest files sum to about 81 seconds but the suite finishes in 30.5,
so vitest is parallelising across workers and the wall clock is bounded by the
single slowest file rather than the total. The slowest individual test is around
half a second, so nothing is near the 60-second per-test timeout — that ceiling
is not masking a hang.

The twenty-fold gap is fsync cost. The ledger runs `synchronous = FULL`, so every
append is a real disk sync: roughly 20ms on a CI runner's shared storage against
2ms on real Windows hardware (`docs/testing.md`).

**Threshold: revisit if Windows suite wall clock crosses 5 minutes.**

Thirty seconds against a 20-minute job timeout is comfortable, and the store
gains tests in every milestone from M2 through M5, so this grows roughly with the
number of appends. The point of naming a number is to notice it as a trend rather
than as a surprise.

Two apparent fixes are the wrong ones, recorded here so they are not rediscovered
as good ideas:

- **Weakening `synchronous = FULL` for tests.** A suite that passes by exercising
  a configuration the product never runs in is worse than a slow suite. This was
  already declined once, when the per-test timeout was raised instead.
- **Adding a batch-append API to make tests faster.** That shapes production code
  around the test harness, and the durability property being tested is precisely
  the per-append sync.

Splitting the slowest file helps less than it appears: the next file is already
24.6 seconds, so the wall clock would only fall to about 25. If the threshold is
ever crossed, the honest levers are reducing the number of appends in tests that
are not about durability, or accepting a longer Windows job.

## Why `package` depends on `check`, and what that hid

The packaging jobs declare `needs: check`, so a red `check` skips them entirely.
That is the right resource trade — a build error would fail both jobs and print
the same error twice — but it has a cost that was paid once already.

At M1 the CLI gained a workspace dependency and the bundle did not learn to
carry it. `check` was red for three consecutive runs on unrelated Windows
problems, so `package` was skipped each time, and the broken bundle surfaced
only when `check` finally went green: `ERR_MODULE_NOT_FOUND` on all three
operating systems at once. Packaging correctness was verifiable only by running
packaging.

Two things address that, and neither is restructuring the workflow:

- **Branch protection requires all three `package` contexts.** A skipped job
  never reports its context, so the pull request cannot merge — the masking is
  bounded to red branches and can never reach `master`.
- **The decision of what to bundle is unit-tested** (`scripts/lib/bundle-plan.mjs`,
  `scripts/test/`), separately from the copying. That class of defect now fails
  in `check`, in milliseconds, whether or not `package` is reachable. The tests
  were verified against the original defect: reintroducing it fails three of them.

The general lesson is worth keeping: a job behind a `needs:` gate verifies
nothing while the gate is closed, so anything it alone can catch wants a cheap
equivalent upstream.

## The Node canary

`canary.yml` runs the full check on Node 26, the next LTS, while the project
still ships on Node 22.

It is **not** a required status check. It fails visibly, so a break is a task
rather than a footnote, but it never blocks a merge: the product runs on the
version in `.nvmrc`, and a problem in a future runtime is information rather than
a reason to stop work.

It earned the slot before it existed. Running the suite on Node 26 by hand, while
working out when to move off Node 22, produced 19 failures from an Ed25519 key
import that built a JWK with a fabricated public half — 32 zero bytes standing in
for a public key we do not hold. Node 22 accepts that; Node 26 rejects it, and
Node 26 is right. Every test passed on the version we pin, so nothing in the
suite was wrong and nothing would have surfaced it.

**A red canary is a task.** Fix it, or record why it is acceptable and when it
will be revisited. A canary left red is worse than no canary, because it teaches
everyone to ignore a signal that was installed precisely to be noticed.

### Node version plan

| | |
|---|---|
| Now | Node 22 (`.nvmrc`), Maintenance since Oct 2025, end-of-life **30 April 2027** |
| Skip | Node 24 — enters Maintenance 20 October 2026, six weeks after this was written |
| Target | **Node 26**, Active LTS from 28 October 2026, supported to April 2029 |

Node 24 is deliberately skipped: adopting it now would mean taking a version
about to leave Active LTS, and migrating twice. Moving 22 to 26 once, shortly
after 26 becomes Active LTS, is one migration instead of two — and the canary is
what makes that a formality rather than a scramble.
