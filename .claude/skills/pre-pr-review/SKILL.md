---
name: pre-pr-review
description: Checklist to run before opening a pull request or pushing to master on pen.trackr.live. Covers what the automated gates cannot check — infrastructure details in documentation, corpus data, overclaiming in commit messages and PR descriptions, requirement-ID honesty, and ADR discipline. Triggers on: open a PR, create a pull request, ready to push, before merging, finishing a milestone, wrapping up a branch.
---

# Before opening a pull request

This repository is **public** and describes itself as tamper-evident. Both facts
raise the cost of a careless claim, and neither is something a linter checks.

## 1. Let the machines go first

```console
pnpm run check      # lint, typecheck, tests with coverage, traceability, hygiene
```

Do not hand-verify anything on that list. If `pnpm run hygiene` passes, the
infrastructure patterns are clear and you need not read the diff looking for
IP addresses. Spend the attention on what follows, which no script can judge.

## 2. Infrastructure details

The hygiene scanner catches known patterns: `user@host`, home-LAN ranges, key
paths. It cannot catch a sentence like *"the build box is the Dell in the rack
running Server 2022"*, or a screenshot, or a path revealing a directory layout.

Ask: **does this diff tell a stranger anything about a real machine they could
not have guessed?** If yes, generalize it. Naming a host is fine; saying how to
reach it is not.

This rule exists because it was broken: an SSH account name and a LAN address
reached master in `docs/testing.md` and `plan.md`, and were caught by a review
bot rather than by CI.

## 3. Corpus and engagement data

The `htba` fixtures hold genuine credentials and proof-of-access flags. They are
loaded from a local path at test time and **never committed**. Check that no test
inlines a real credential as a fixture value — sanitized derivatives only.

## 4. Claims

Read the commit messages and PR description as an adversary would.

- **Does a measurement name its environment?** A number from a CI runner is not
  a number about the product. This was got wrong once already: an append latency
  of ~20 ms was recorded as fact from a shared virtualized runner, when real
  hardware measures 2 ms.
- **Is "verified" earned?** Verified on Linux is not verified on three platforms.
  Say which.
- **Does a requirement ID claim match reality?** `pnpm run trace` proves an ID is
  annotated in both an implementation and a test. It cannot prove the
  implementation actually satisfies the requirement — that is your judgement, and
  claiming an ID you have only partly built is the easiest way to make the
  coverage number a lie.
- **Are the limitations stated?** This project's habit is to test what does *not*
  work and say so: a truncated chain still verifies, unpinned checkpoints accept
  a substituted key, triggers do not stop someone who can drop them. If this
  change has an equivalent gap, name it here rather than letting a reader assume
  it away.

## 5. Findings belong in the record

If a test caught a bug in code written minutes earlier, or a second machine found
what CI missed, **say so in the commit message**. Presenting smooth progress when
the reality was three failures and a correction teaches nobody anything, and it
quietly overstates how solid the result is.

The same applies in reverse: if something was fixed forward rather than properly,
or a measurement is from one machine only, that belongs in the text too.

## 6. Decisions

Did this change alter a decision recorded in `docs/adr/`? Then write a **new,
superseding ADR** — do not edit the old one. A reader must be able to see why the
previous choice looked right at the time. `plan.md` §14 gets a row; `plan.md` §2
gets an entry if the change diverges from the frozen SRS.

## 7. Then open it

One commit per phase, one PR per milestone (D18). The PR description should let
someone who was not here understand what changed, what it closes, and what it
does not.
