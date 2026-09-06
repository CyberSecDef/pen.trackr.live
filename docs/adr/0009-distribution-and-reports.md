# 0009 — Per-OS bundles; Typst for PDF, docx for Word

**Status:** Accepted (5 September 2026)
**Requirements:** NFR-008, FR-RPT-008

## Context

ADR 0001 chose TypeScript, which forfeits the single-portable-binary property.
Reports must export as DOCX, PDF, and structured JSON, with markdown source
retained in-project.

## Decision

**Distribution:** per-OS bundles built in CI — compiled output plus, once native
addons exist, prebuilds via `prebuildify` across Linux, macOS, and Windows on
x64 and arm64. Published as archives with a thin installer, and to npm for
`npx pentrackr`. A Node single-executable build lands when native addons make it
worth the postject dance, not before.

**Reports:** markdown source retained in-project; PDF via **Typst** (a single
vendorable binary, no headless Chromium, no LaTeX installation, deterministic
output); DOCX via the `docx` package; JSON as direct serialization of finding
objects.

## Consequences

- Packaging is exercised in CI from M0, so it cannot become an end-of-project
  surprise. This is the specific failure mode the decision is guarding against.
- Typst being deterministic matters more than it first appears: a report that
  renders differently on two machines undermines the evidence claim the rest of
  the system is built on.
- DOCX fidelity is genuinely fiddly and gets golden-file tests.

## Alternatives rejected

**Headless Chromium for PDF.** Enormous dependency, non-deterministic output,
and a browser engine on an operator's laptop for report rendering is poor taste.

**LaTeX.** Deterministic but requires a multi-gigabyte install the operator
does not otherwise need.
