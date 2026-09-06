# 0008 — One redaction pipeline, three consumers, structured objects only

**Status:** Accepted (5 September 2026)
**Requirements:** FR-SECPL-005, FR-RPT-003, FR-RPT-009, FR-AI-003, FR-CASE-004

## Context

Credentials and PII need a per-output disclosure policy. Three separate
consumers can leak: report rendering, model context packaging, and case export.
Three implementations would mean three chances to get it wrong.

## Decision

One pipeline. A profile maps object class times audience to
`full | masked | omitted | reference-only`. All three consumers call it.

The renderer takes **structured objects, never pre-formatted strings**, so
redaction cannot be defeated by interpolation upstream of the pipeline.

## Consequences

- A canary fuzz suite plants known secrets in every object type and asserts zero
  appearances in any client-profile output. Real corpus credentials are used,
  because they are the exact shape of what must never reach a client.
- Sending context to a hosted model is allowed (FR-AI-003) and defaults to the
  active profile with a non-blocking summary of what will leave the laptop. It is
  a suggestion, not a prohibition — the SRS is explicit about that.
- Cost: report templates cannot take shortcuts with pre-rendered text. Worth it.

## Alternatives rejected

**Redact at render time per output format.** Each new format becomes a new leak
surface, and DOCX, PDF, and JSON would each need their own audit.

**Redact on write.** Destroys the internal copy the operator legitimately needs
(FR-RPT-003 distinguishes internal from client profiles).
