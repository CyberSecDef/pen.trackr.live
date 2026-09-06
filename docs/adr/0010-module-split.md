# 0010 — Open core in this repository, closed pack separate

**Status:** Accepted (5 September 2026)
**Requirements:** NFR-014, FR-PLG-007, section 2.5

## Context

Pen Trackr is dual-module: an open core plus an optional separately licensed
pack adding house report templates, extra firm parsers, or private prompt packs.
The core must function fully alone, and no closed module may ever be required to
read an open-core case file.

## Decision

The open core lives here under Apache-2.0. The closed pack is a **separate
repository** shipping plugins into the host defined by ADR 0006. Nothing in
`packages/` may branch on the pack's presence.

A CI job builds open-core-only and runs the full case-file read suite.

## Consequences

- NFR-014 and FR-PLG-007 are proven by a build, not asserted in a README.
- The plugin capability system carries the entire commercial boundary, which
  keeps that boundary from leaking into core code as feature flags.
- Apache-2.0 for the core: explicit patent grant, and a trademark clause
  protecting the Trackr name. As sole copyright holder the author can license the
  closed pack however they choose.

## Alternatives rejected

**Feature flags in one repository.** The open build would carry dead code paths
for closed features, and "open core is sufficient" becomes a claim nobody tests.

**AGPL for the core.** Network copyleft has almost nothing to bite on in
local-first laptop software, and it would create real friction for the plugin
ecosystem and for firms writing private in-house parsers.
