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
2. **If there is genuinely no fix**, add a dated, reasoned entry to
   `.pnpm-audit-ignore` and reference it from the audit step, with the advisory
   ID, why it does not apply here, and the date to re-check. An exception with an
   expiry is a decision; an exception without one is a leak.
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
