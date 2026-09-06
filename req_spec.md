# Pen Trackr — Software Requirements Specification

*Authorized Engagement Evidence and Operator Platform*

This specification defines the complete product: a local core service with VS Code, web, and TUI clients; a tamper-evident ledger; an evidence store; an intelligence plane; and a reporting engine for authorized penetration testing and adversary-simulation engagements. Product name is baselined as Pen Trackr.

| Document type | Software Requirements Specification (SRS) |
|----|----|
| Version | 0.2 — Interview-baselined |
| Date | 5 September 2026 |
| Status | Baselined against stakeholder answers of 5 September 2026. Open questions in §30 are closed. |
| Classification | Internal / Sensitive — describes a system that will store engagement secrets and evidence |
| Intended readers | Product owner, architects, operators, legal/compliance reviewers |

Purpose of this revision. v0.1 allocated every originating capability to a requirement ID. v0.2 applies the interview decisions: product name, single-user laptop deployment, three clients on one core, optional legal templates, lab mode, lossless ingest, supervised-exec path, dual-module licensing, and the remaining locked constraints. Section 30 records those answers.

## Table of Contents

- [1. Introduction](#1-introduction)
  - [1.1 Purpose](#11-purpose)
  - [1.2 Problem statement](#12-problem-statement)
  - [1.3 Goals](#13-goals)
  - [1.4 Non-goals / out of scope for the product](#14-non-goals-out-of-scope-for-the-product)
  - [1.5 Intended use and legal boundary](#15-intended-use-and-legal-boundary)
  - [1.6 Definitions](#16-definitions)
- [2. Product overview](#2-product-overview)
  - [2.1 Product summary](#21-product-summary)
  - [2.2 Design principles (normative)](#22-design-principles-normative)
  - [2.3 Four-plane architecture](#23-four-plane-architecture)
  - [2.4 System context](#24-system-context)
  - [2.5 Licensing topology (dual module)](#25-licensing-topology-dual-module)
- [3. Users, roles, and engagement lifecycle](#3-users-roles-and-engagement-lifecycle)
  - [3.1 Roles](#31-roles)
  - [3.2 Engagement states](#32-engagement-states)
- [4. Operator cockpit and user interface](#4-operator-cockpit-and-user-interface)
  - [4.1 Clients and interaction model](#41-clients-and-interaction-model)
  - [4.2 Project switcher](#42-project-switcher)
  - [4.3 Sidebar navigation](#43-sidebar-navigation)
  - [4.4 UI requirements](#44-ui-requirements)
- [5. Built-in terminals and command ledger](#5-built-in-terminals-and-command-ledger)
  - [5.1 Terminals](#51-terminals)
  - [5.2 Unmanaged / raw mode](#52-unmanaged-raw-mode)
  - [5.3 Command ledger fields](#53-command-ledger-fields)
  - [5.4 Command requirements](#54-command-requirements)
- [6. Manual activity logging](#6-manual-activity-logging)
- [7. Engagement metadata (pre-engagement)](#7-engagement-metadata-pre-engagement)
- [8. Scope engine and safety guardrails](#8-scope-engine-and-safety-guardrails)
  - [8.1 Verdicts](#81-verdicts)
  - [8.2 Guardrail objects](#82-guardrail-objects)
- [9. Network traffic](#9-network-traffic)
- [10. Discovered asset inventory](#10-discovered-asset-inventory)
  - [10.1 Hosts](#101-hosts)
  - [10.2 Services](#102-services)
  - [10.3 Web application surface](#103-web-application-surface)
  - [10.4 Active Directory](#104-active-directory)
  - [10.5 Cloud](#105-cloud)
  - [10.6 Wireless and physical](#106-wireless-and-physical)
- [11. Credentials, secrets, and captured loot](#11-credentials-secrets-and-captured-loot)
  - [11.1 Secrets vault](#111-secrets-vault)
  - [11.2 Loot](#112-loot)
- [12. Vulnerabilities and findings](#12-vulnerabilities-and-findings)
- [13. Access obtained, sessions, and attack-chain tracking](#13-access-obtained-sessions-and-attack-chain-tracking)
- [14. Changes made to targets — cleanup ledger](#14-changes-made-to-targets-cleanup-ledger)
- [15. Evidence artifacts, screenshots, recordings, file manifest](#15-evidence-artifacts-screenshots-recordings-file-manifest)
- [16. Tasks, hypotheses, research processes, scratchpads](#16-tasks-hypotheses-research-processes-scratchpads)
- [17. Checklists, coverage, timeline, and QA metrics](#17-checklists-coverage-timeline-and-qa-metrics)
- [18. Cross-engagement correlation](#18-cross-engagement-correlation)
- [19. Detection feedback (purple team)](#19-detection-feedback-purple-team)
- [20. Reporting, templates, and distribution](#20-reporting-templates-and-distribution)
- [21. Script generation and scan-output ingest](#21-script-generation-and-scan-output-ingest)
- [22. Local and API model integration, agents, prompt management](#22-local-and-api-model-integration-agents-prompt-management)
  - [22.1 Integration surface](#221-integration-surface)
  - [22.2 Multi-agent research](#222-multi-agent-research)
- [23. Custom plugins](#23-custom-plugins)
- [24. Platform security, tamper-evidence, and redaction pipeline](#24-platform-security-tamper-evidence-and-redaction-pipeline)
  - [24.1 Tamper-evidence](#241-tamper-evidence)
  - [24.2 Redaction as a first-class pipeline](#242-redaction-as-a-first-class-pipeline)
  - [24.3 Encryption and isolation](#243-encryption-and-isolation)
- [25. Logical data model and event taxonomy](#25-logical-data-model-and-event-taxonomy)
  - [25.1 Core entities](#251-core-entities)
  - [25.2 Minimum event types (ledger)](#252-minimum-event-types-ledger)
- [26. Non-functional requirements](#26-non-functional-requirements)
- [27. Delivery phases](#27-delivery-phases)
  - [27.1 MVP — usable on a real external + web engagement](#271-mvp-usable-on-a-real-external-web-engagement)
  - [27.2 V2 — correlation, plugins, supervised exec](#272-v2-correlation-plugins-supervised-exec)
  - [27.3 V3 — optional organization features](#273-v3-optional-organization-features)
- [28. Acceptance criteria (MVP)](#28-acceptance-criteria-mvp)
- [29. Source-brief traceability](#29-source-brief-traceability)
- [30. Interview record — closed 5 September 2026](#30-interview-record-closed-5-september-2026)
  - [30.1 Product identity and users](#301-product-identity-and-users)
  - [30.2 Legal and operational envelope](#302-legal-and-operational-envelope)
  - [30.3 Command runner](#303-command-runner)
  - [30.4 AC tracking](#304-ac-tracking)
  - [30.5 AI](#305-ai)
  - [30.6 Secrets, reports, stack](#306-secrets-reports-stack)
  - [30.7 Still optional later (do not block v0.2)](#307-still-optional-later-do-not-block-v02)
- [31. Residual engineering assumptions (not contradicted by interview)](#31-residual-engineering-assumptions-not-contradicted-by-interview)

## 1. Introduction

### 1.1 Purpose

This SRS specifies Pen Trackr, a local-first single-user platform that records, constrains, correlates, and reports authorized offensive-security work. The platform is an engagement operating system: a core service on the operator laptop plus VS Code, web, and TUI cockpits; a ledger that proves what happened; a vault that holds loot under policy; and a factory that emits audience-specific reports.

The platform is not an exploit framework and not a command-and-control server. It wraps, ingests, correlates, and reports. Attack tools remain external. That boundary is a requirement, not a slogan.

### 1.2 Problem statement

Professional engagements already produce a flood of artifacts: shell history, scanner XML, proxy projects, BloodHound graphs, screenshots, loot files, tickets, and notes. Those artifacts rarely share a primary key. When a client asks whether a tester caused an outage, whether a credential was reused, or whether a persistence mechanism was removed, the answer is reconstructed by hand. Scope is audited after the fact. Redaction is a Word pass. Cleanup is a memory test.

Pen Trackr exists so that every command, manual action, packet flow, screenshot, secret, finding, session, and target change is an event in one hash-chained ledger, scoped before execution, redactable by audience, and exportable as evidence.

### 1.3 Goals

- Prove what the team did, what they did not do, what they found, and what they put back.

- Make the daily operator environment faster than an unmanaged terminal plus a wiki.

- Enforce Rules of Engagement and scope at execution time, not review time.

- Treat secrets, PII, and proof-of-access as privileged objects with access logs.

- Keep dead ends, not only successful paths, so methodology and reporting stay honest.

- Let local and API-hosted models draft, classify, and warn. Supervised execution (propose → operator approve → runner executes) is allowed; silent autonomous execution against targets is not.

- Support multiple concurrent engagements with instant project switching.

- Run on the operator’s personal laptop, on every common desktop OS, through VS Code, a local web UI, and a TUI.

- Export and re-import complete case files, and ingest artifacts produced outside Pen Trackr without loss of the raw bytes.

### 1.4 Non-goals / out of scope for the product

- Implementing exploits, payload generation, or a C2 protocol.

- Providing a general-purpose hacking tutorial or unauthorized-testing workflow.

- Replacing Burp, ZAP, Nmap, BloodHound, NetExec, Impacket, or cloud CLIs. Pen Trackr integrates and records them.

- Being the system of record for the client’s vulnerability management program after handoff — export is required; ongoing client VM is optional later.

- Fully autonomous multi-day agent execution against live targets (supervised single-command or single-script approval is in scope).

- Multi-user / multi-tenant collaboration on one running instance (data model may keep role names; MVP is one human on one laptop).

- Records-retention policy engine, legal-hold clocks, and automatic destruction schedules — explicitly out of scope.

- Bundled exploits, payloads, C2, or phishing-campaign engines.

- Any product coupling to Cyber Trackr. That system may be used only as an external research reference.

### 1.5 Intended use and legal boundary

Pen Trackr is designed for professional testers and purple-team operators. Authorization letters, SOWs, NDAs, and Rules of Engagement are first-class optional documents. None of them are required to create a project, enter Lab mode, or run the command runner. The product shall ship templates for all four so an operator can fill them when a client engagement needs them. The UI shall not pretend that filling a template constitutes legal authorization. Scope and RoE fields, when present, still drive the scope engine; when absent, the engine treats targets as unconstrained except for operator-defined excludes.

### 1.6 Definitions

| Term | Meaning |
|----|----|
| Engagement / Project | A bounded authorized test with its own ledger, scope, keys, and file tree. Projects are selectable and switchable. |
| Ledger | Append-only, hash-chained event log that is the source of truth for the engagement. |
| Projection | Queryable view rebuilt from the ledger (assets, findings, sessions, etc.). |
| Command event | One invocation captured by the wrapped terminal or an imported tool run. |
| Manual activity | Operator-declared action not captured as argv (browser open, form fill, registry export). |
| Loot | Retrieved files, dumps, screenshots, and other objects taken from or about targets. |
| Secret | Credential, hash, token, key, ticket, or cookie stored under vault policy. |
| Scope verdict | Allow, allow-with-warning, or block for a proposed command or target set. |
| Risk class | passive recon / active scan / exploit attempt / post-ex / persistence / destructive. |
| Cleanup item | A change made on a target that must be reversed or explicitly accepted as residual. |
| Attack chain (AC) | Ordered path of techniques across assets and identities. Baselined meaning: attack chain only. Access-control changes on targets live in the cleanup ledger, not under the AC name. |
| Intelligence plane | Local/API model integrations (Codex, Claude, others), prompts, agents, scratchpads. Draft by default; supervised runner may execute an operator-approved proposal. |
| Case file | Exportable project package containing ledger, blobs, manifests, and metadata sufficient to re-import on another Pen Trackr instance. |
| Lab mode | Project type for practice and tool development. No legal artifacts required. Runner is live. UI banners the mode. |
| Core service | Local process exposing the API that VS Code, web, and TUI clients share. |
| RoE | Rules of Engagement. |
| SOW | Statement of Work. |

## 2. Product overview

### 2.1 Product summary

Pen Trackr is a single-user laptop product. A local core service owns the ledger, vault, runner, parsers, and plugins. Three clients attach to that service: a VS Code extension (primary cockpit), a local web interface, and a terminal UI. An operator opens an engagement project in any client, works in terminals, drops evidence, tracks tasks, runs checklists, and lets parsers turn scan output into inventory and findings. Codex and Claude adapters sit beside the work as research and writing assistants; a supervised path can turn an approved proposal into a managed command. At close, Pen Trackr emits reports and a signed case-file export. Case files and foreign artifacts can be imported without dropping raw bytes.

### 2.2 Design principles (normative)

- Ledger first. If it is not an event, it did not happen.

- Projections are disposable. History is not.

- Scope gates execution. Review is not a substitute for a block.

- Dead ends are first-class. Do not prune failed hypotheses from the timeline or graph.

- Redaction is a pipeline with profiles, not a last-minute find-and-replace.

- Secrets are metadata-first. Plaintext reveal is an auditable act.

- The cockpit must feel like a normal terminal or operators will bypass it.

- AI proposes. Policy and humans dispose. Models do not own destructive or out-of-scope actions.

- Cleanup is part of the engagement, not an afterthought.

- Tamper-evidence is a legal requirement of the ledger, not an optional hardening flag.

### 2.3 Four-plane architecture

- Ledger plane — append-only events, hashes, signatures, engagement-scoped encryption.

- Projection plane — assets, services, web surface, AD, cloud, creds, findings, sessions, cleanup, timeline, graph.

- Operator plane — three clients (VS Code extension, web UI, TUI) sharing one API: project switcher, terminals where the client can host them, tasks, scratchpads, checklists, plugins, reports.

- Intelligence plane — prompt library, templates, multi-agent research, Codex and Claude adapters, optional other APIs.

Clients never write business truth except by appending events through the core API. Plugins and agents that skip the ledger are non-conformant.

### 2.4 System context

External actors and systems: the single operator; attack-host OS (Linux, Windows, macOS); wrapped local shells; scanners and proxies; browser; VS Code; a local browser for the web UI; a terminal for the TUI; Codex and Claude local/desktop tools; optional remote model APIs; on-disk blob store; optional SIEM export from a client for later purple-team join; report consumers.

### 2.5 Licensing topology (dual module)

Pen Trackr is dual-module. The open core includes the local service, ledger, runner, default parsers, VS Code/web/TUI clients, prompt library mechanics, and case import/export. A separate optional module (closed or separately licensed) may add house report packs, extra firm parsers, or private prompt packs. The core shall function fully without the closed module. No closed module may be required to read an open-core case file.

## 3. Users, roles, and engagement lifecycle

### 3.1 Roles

| Role | Capabilities (minimum) |
|----|----|
| Operator | Create/select projects they own or are assigned; run commands; log manual activity; manage tasks; attach evidence; draft findings; use prompts/agents per policy. |
| Lead | All operator rights plus RoE/scope edit after start (itself an event), finding approval, report release, cleanup verification sign-off, user assignment. |
| Reviewer | Read projections, review findings and reports, cannot execute commands or reveal secrets unless granted. |
| Vault officer | Reveal secrets, export unredacted packs, configure redaction profiles. Default: same as Lead on a solo install. |
| System | Ingest parsers, scope engine, hash chain, backup, model adapters — all actions attributed as system-with-operator-context. |

Baselined deployment is personal-laptop single user. Lead, Reviewer, and Vault officer are capability modes on that one operator (confirm-to-reveal still applies). Multi-user assignment is not an MVP feature.

### 3.2 Engagement states

- Draft — metadata being assembled. Runner is available. Legal artifacts are optional.

- Lab — practice/research project; bannered in every client; no legal artifacts expected.

- Active — operator has marked the project live. If a testing window or RoE exists, those constraints apply; otherwise the runner is unconstrained except for explicit excludes.

- Paused / Blackout — only if a window or RoE was provided.

- Closing — operator-declared wrap-up; new persistence/destructive classes warn by default.

- Closed — runner disabled; ledger sealable; case file exportable. No retention clock is enforced by the product.

## 4. Operator cockpit and user interface

### 4.1 Clients and interaction model

Pen Trackr has one core and three first-class clients. Feature parity is required for project switch, ledger browse, tasking, findings, scope check, and report generate. Terminal embedding is native in VS Code and the TUI; the web UI shall provide an xterm-class session attached to the same runner or deep-link into VS Code/TUI for interactive shells.

VS Code extension (primary cockpit): activity bar, collapsible sidebar, editor/tab group, integrated terminals, command palette, status bar. Web interface: same information architecture in a local browser against the core service. TUI: keyboard-first panels for laptop/SSH-to-self use when a GUI is unavailable.

All clients are themeable (dark, light, high-contrast at minimum). Themes shall not hide severity or scope-block colors.

### 4.2 Project switcher

The operator shall switch among discrete pentest projects without restarting the application. Switching shall: flush and persist the current project; unload secrets from memory; load the target project’s projections; reconnect terminals to that project’s runner context; and record a project-switch event. A project list shall show name, client, state, window, and unread findings/tasks.

### 4.3 Sidebar navigation

The sidebar shall be collapsible and individually selectable. Default sections:

- Engagement — metadata, RoE, scope, roster, contacts, legal

- Ledger — command and manual activity stream with filters

- Tasks — individual task trackers, hypotheses, owners, status

- Scratchpads — linked notes, research processes

- Checklists — methodology coverage

- Assets — hosts, services, web, AD, cloud, wireless/physical

- Loot — files, dumps, screenshots, retrieved objects

- Secrets — credentials vault (metadata view by default)

- Findings — vulnerabilities and verification state

- Sessions — shells, RDP, beacons ingested as session objects

- Cleanup — target-change ledger and residual report

- Guardrails — lockouts, out-of-scope attempts, availability events

- Evidence — artifacts, chain of custody, recordings

- Traffic — pcap/proxy/DNS indexes

- Timeline — unified time view

- Graph — attack path / AC visualization

- Purple — detection feedback when client data exists

- Reports — versions, redaction profiles, distribution

- Coverage — QA metrics and untested areas

- Prompts — local prompt management and templates

- Agents — research agent runs and traces

- Scripts — generated scripts library with approval state

- Plugins — installed extensions

- Files — engagement file manifest

### 4.4 UI requirements

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-UI-001** | Themeable workbench (dark/light/high-contrast + user theme pack) in every client that can render themes. | MVP | User |
| **FR-UI-002** | Collapsible sidebar with the navigation set in §4.3. Unused modules can be hidden per project type but not deleted from the information model. TUI uses an equivalent panel list. | MVP | User |
| **FR-UI-003** | Instant switch between selectable pentest projects; state isolated per project; same project visible from all attached clients. | MVP | User |
| **FR-UI-004** | Command palette (VS Code and web) and TUI command prompt for navigation, snippets, manual-activity types, and scope check. | MVP | Derived |
| **FR-UI-005** | Status bar / TUI footer shows active project, mode (Lab/Active/…), scope engine status, recording state, clock-skew warning, model-backend status. | MVP | Derived |
| **FR-UI-006** | Split views: ledger + asset; finding + evidence; graph + timeline (GUI clients). | V2 | Derived |
| **FR-UI-007** | Keyboard-first operation for logging and terminal focus in all three clients. | MVP | Derived |
| **FR-UI-008** | Accessibility: high-contrast theme, focus rings, text scaling in GUI clients. | V2 | Derived |
| **FR-UI-009** | VS Code extension is a first-class client of the local core service. | MVP | User |
| **FR-UI-010** | Local web interface is a first-class client of the same core service. | MVP | User |
| **FR-UI-011** | TUI is a first-class client of the same core service. | MVP | User |
| **FR-UI-012** | Core service binds to localhost by default. Exposing it beyond loopback is an explicit, warned setting. | MVP | Derived |

## 5. Built-in terminals and command ledger

### 5.1 Terminals

Pen Trackr shall embed terminals comparable to VS Code integrated terminals: multiple tabs, split panes, PTY, copy/paste, scrollback, Unicode, and configurable shells (bash, zsh, pwsh, cmd as available). Each terminal belongs to one engagement and one session ID.

A managed runner shall sit between the PTY and the OS so that Pen Trackr can observe argv when possible, attach start/end timestamps, collect exit codes, and invoke the scope engine. When a command cannot be intercepted cleanly (raw TUI, nested SSH), the runner shall still record a session slice and prompt for target/risk classification rather than drop the event.

### 5.2 Unmanaged / raw mode

Operators will sometimes need a raw shell. Raw mode is allowed on every project state. It shall be bannered as RAW / BEST-EFFORT LOGGED. The runner shall still record start, stop, operator, working directory, session ID, and whatever argv/TTY bytes it can observe without breaking the PTY. When argv cannot be intercepted, the event is marked capture=partial. Pen Trackr shall never pretend a raw session was fully captured. Raw mode is not disabled on Active or Lab projects.

### 5.3 Command ledger fields

The command ledger is the Autopsy-style filesystem layer. Every other object should be able to point at a command ID or a manual-activity ID. Per command the system shall record:

- Verbatim command line with all arguments

- Operator identity

- Attack host hostname and OS

- Source IP and interface

- Start time, end time, duration

- Timezone of attack host

- Measured clock skew against a configured reference and, when available, the target

- Exit code and disposition: success / fail / timeout / killed / unknown

- Full stdout and stderr, timestamped per line when the runner can provide it

- Working directory

- Relevant environment class: proxy settings, whether tokens/creds were injected, virtualenv/PATH notes — not raw secret values

- Tool name, version, and binary hash when resolvable

- Targets touched, parsed from the command and from output

- Automatic scope check result for every parsed target

- Risk classification: passive recon / active scan / exploit attempt / post-ex / persistence / destructive

- Session ID linking the command to a specific shell or ingested C2/beacon session

- Hypothesis or finding ID that prompted the command

- Dead-end flag and short rationale when marked

- Optional full TTY recording reference

- Optional screen-recording reference for GUI tools launched from the runner

### 5.4 Command requirements

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-CMD-001** | Integrated multi-tab PTY terminals bound to the active project. | MVP | User |
| **FR-CMD-002** | Command ledger with every field listed in §5.3. Fields that cannot be filled shall be explicit nulls, never silent omissions. | MVP | User |
| **FR-CMD-003** | Line-timestamped stdout/stderr capture for managed commands. | MVP | User |
| **FR-CMD-004** | Tool identity + version + binary hash resolution from PATH. | MVP | User |
| **FR-CMD-005** | Target parser registry per known tool family, with a generic fallback parser. | MVP | User |
| **FR-CMD-006** | Pre-exec scope verdict; block or warn according to policy and risk class. | MVP | User |
| **FR-CMD-007** | Risk class auto-suggest from tool/argv with operator override (override is an event). | MVP | User |
| **FR-CMD-008** | Link command → hypothesis/finding/task. | MVP | User |
| **FR-CMD-009** | TTY session recording optional per terminal; stored as hashed blob. | V2 | User |
| **FR-CMD-010** | GUI tool screen recording optional; hashed and bound to command/session. | V2 | User |
| **FR-CMD-011** | Import historical shell logs (e.g., existing runlog.sh) into the ledger with provenance “imported.” Raw imported bytes are preserved. | MVP | User |
| **FR-CMD-012** | Timeout disposition and kill from UI. | V2 | Derived |
| **FR-CMD-013** | Raw mode allowed always; best-effort logging as specified in §5.2; capture=partial when argv cannot be parsed. | MVP | User |
| **FR-CMD-014** | MVP runner wraps the local interactive shell only. Remote SSH is a session type to ingest or note, not a required wrapper in MVP. | MVP | User |

## 6. Manual activity logging

Not everything is a command line. The platform shall provide cheap, first-class manual activity events so the ledger remains complete when the operator uses a browser, RDP GUI, or offline action.

Built-in activity types shall include at least: opened browser; navigated to URL; filled out form; submitted form; captured screenshot; captured registry key(s); captured configuration file; exported file from target; copied data from RDP/GUI; performed physical action; made client phone/email contact; noted observation with no tool.

Each manual event shall carry operator, timestamp, timezone, targets, scope verdict, risk class, linked task/hypothesis, free-text note, and optional attachments (screenshot, file, registry export).

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-MAN-001** | Manual activity logger with typed actions listed in §6, plus user-definable types per plugin. | MVP | User |
| **FR-MAN-002** | One-hotkey or palette action to log the current type without leaving the terminal. | MVP | Derived |
| **FR-MAN-003** | Registry-key and conf-file capture attaches the file to loot + file manifest and links the manual event. | MVP | User |
| **FR-MAN-004** | Browser-open and form-fill events can be produced automatically when a controlled browser is used; otherwise operator-declared. | V2 | User |

## 7. Engagement metadata (pre-engagement)

No legal artifact is required to create a project, use Lab mode, or run commands. Templates shall be provided for every metadata object below so a client engagement can be documented when the operator chooses.

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-ENG-001** | Client name, engagement ID, internal code name. | MVP | User |
| **FR-ENG-002** | SOW/contract reference with document attachment. Optional. Ship a SOW template. | MVP | User |
| **FR-ENG-003** | NDA attachment and effective dates. Optional. Ship an NDA template. | MVP | User |
| **FR-ENG-004** | Authorization letter attachment. Optional. Ship an authorization-letter template. Not a gate on the runner. | MVP | User |
| **FR-ENG-005** | Rules of Engagement: permitted techniques, forbidden techniques, blackout windows, destructive-action policy. Optional. Ship a RoE template. When present, the scope engine honors it. | MVP | User |
| **FR-ENG-006** | Scope definition: in-scope CIDRs, IPs, domains, URLs, ASNs, cloud accounts/subscriptions/tenants, repos, mobile apps. | MVP | User |
| **FR-ENG-007** | Explicit exclusions with the same object types as scope. | MVP | User |
| **FR-ENG-008** | Testing window: authorized start/stop, timezone, after-hours permissions. | MVP | User |
| **FR-ENG-009** | Assessment types in play: external, internal, web app, API, AD, cloud, red team as usable MVP types. Wireless, physical, and social engineering exist as documented enums and UI placeholders only — no dedicated modules in MVP. | MVP | User |
| **FR-ENG-010** | Team roster and operator identities mapped to platform users. | MVP | User |
| **FR-ENG-011** | Every source IP the team will originate from; used in traffic correlation and client deconfliction. | MVP | User |
| **FR-ENG-012** | Client escalation and deconfliction contacts with 24/7 flags. | MVP | User |
| **FR-ENG-013** | Legal jurisdiction and data-handling requirements (residency, retention, PII/PHI/PCI rules). | MVP | User |
| **FR-ENG-014** | Destructive-action policy machine-readable: forbid / require dual-control / allow-in-window. | MVP | User |
| **FR-ENG-015** | Lab mode project type: bannered, no legal artifacts expected, runner live, same ledger as any other project. | MVP | User |
| **FR-ENG-016** | Shipped document templates: authorization letter, SOW/contract cover, NDA, RoE, scope worksheet, escalation contact sheet. | MVP | User |

## 8. Scope engine and safety guardrails

Scope enforcement happens at execution time. The scope list shall gate commands before they run. This is a defining property of the product.

### 8.1 Verdicts

- Allow — all parsed targets in scope, risk class permitted now.

- Allow with warning — ambiguous parse, adjacent subdomain, or risk class requires acknowledgment.

- Block — out-of-scope target, blackout window, forbidden technique, or destructive class without authorization.

### 8.2 Guardrail objects

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-SCP-001** | Pre-exec evaluation of parsed targets against include/exclude lists (CIDR, IP, host, FQDN, URL, ASN, cloud ID, repo). | MVP | User |
| **FR-SCP-002** | Blackout-window enforcement using engagement timezone. | MVP | User |
| **FR-SCP-003** | Risk-class policy matrix per engagement (which classes are allowed in which states). | MVP | User |
| **FR-SCP-004** | Out-of-scope attempt events: store the command, targets, verdict, and whether it was blocked or overridden. | MVP | User |
| **FR-SCP-005** | RoE violation flag in real time on the status bar and ledger. | MVP | User |
| **FR-SAF-001** | Availability events: service crash, host reboot, session drop observed or reported. | V2 | User |
| **FR-SAF-002** | Account lockout tracking against observed or declared domain policy; pre-check before spray-class commands. | V2 | User |
| **FR-SAF-003** | Throttle and rate-limit settings actually applied per target, recorded as config events. | V2 | User |
| **FR-SAF-004** | Volume of data accessed or exfiltrated — bytes and record counts when knowable; otherwise operator estimate with flag. | V2 | User |
| **FR-SAF-005** | Sensitive data encountered (PII/PHI/PCI) categorized and counted, ideally without copying payload into the ledger body. | V2 | User |
| **FR-SAF-006** | Destructive actions blocked by policy and logged as attempts even when blocked. | MVP | User |
| **FR-SAF-007** | Dual-control confirmation for persistence and destructive classes when policy requires it. | V2 | Derived |

## 9. Network traffic

Full packet capture and proxy history are first-class evidence, stored as blobs with indexes in the projection plane. TLS session keys, when captured by an authorized intercepting proxy under RoE, make HTTPS reviewable after the fact. The platform records and correlates; it does not invent a new intercept stack in MVP.

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-NET-001** | Ingest full pcap of tester-originated traffic per engagement as hashed blobs + flow index. | V2 | User |
| **FR-NET-002** | Proxy history ingest (Burp/ZAP-style): request/response pair with headers, bodies (size-capped), timing, issuing tool. | V2 | User |
| **FR-NET-003** | TLS session-key material ingest from authorized proxy/sslkeylog so stored HTTPS can be reviewed; keys stored in the vault, not in plaintext indexes. | V2 | User |
| **FR-NET-004** | DNS query log issued by the tester, correlated to commands where possible. | V2 | User |
| **FR-NET-005** | Correlation binding each packet flow back to the command or manual activity that generated it (time + source IP + dest). | V2 | User |
| **FR-NET-006** | Source-IP roster from FR-ENG-011 used to filter tester-originated traffic. | V2 | User |

## 10. Discovered asset inventory

### 10.1 Hosts

Per host: IP, hostnames, FQDN, MAC, NetBIOS name, domain membership, OS and build, uptime, patch level, latency, route, first/last seen, discovering command IDs.

### 10.2 Services

Per service: port, protocol, state, product, version, full banner; TLS certificate details (CN, SANs, issuer, validity, key size, signature algorithm, fingerprint) and certificate reuse across hosts; SMB signing and NTLM info; SSH host keys and accepted auth methods; HTTP server headers, detected technologies, WAF presence, missing security headers.

### 10.3 Web application surface

Every URL and endpoint; discovery source (crawl, wordlist, JS parsing, sitemap, robots.txt); accepted HTTP methods; parameters with type and reflection behavior; forms; authentication flows; session token format and entropy notes; cookies with flags; virtual hosts and subdomains; API schemas (OpenAPI, WSDL, GraphQL, gRPC reflection); JS files and source maps with embedded endpoints or keys (keys promoted to Secrets).

### 10.4 Active Directory

Domain, forest, functional level, trusts, DCs, users, groups, computers, OUs, GPOs, ACLs and DACLs, delegation rights, SPNs, password policy, kerberoastable and AS-REP-roastable accounts, certificate templates and CA configuration with ESC condition flags. Ingest from BloodHound/Sharphound-style and similar exports rather than reimplementing collection.

### 10.5 Cloud

Accounts, regions, storage buckets and permissions, IAM roles and trust policies, metadata service reachability, exposed functions and secrets stores. Ingest from authorized CLIs and scout-style outputs.

### 10.6 Wireless and physical

Where in scope: SSIDs, BSSIDs, encryption, associated clients; badge systems; entry points. Typically operator-entered or specialized-tool ingest.

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-AST-001** | Host inventory with all fields in §10.1; merge on IP/MAC/hostname with provenance history. | MVP | User |
| **FR-AST-002** | Service inventory with all fields in §10.2, including TLS reuse graph. | MVP | User |
| **FR-AST-003** | Web surface model with all fields in §10.3. | V2 | User |
| **FR-AST-004** | AD model with all fields in §10.4 via ingest + manual enrichment. | V2 | User |
| **FR-AST-005** | Cloud model with all fields in §10.5 via ingest + manual enrichment. | V2 | User |
| **FR-AST-006** | Wireless, physical, and social-engineering inventory types exist as documented enums and placeholder records only until a later module. No dedicated collection UI in MVP. | V3 | User |
| **FR-AST-007** | Every inventory object stores first-seen command/manual ID and last-refreshed command ID. | MVP | User |

## 11. Credentials, secrets, and captured loot

### 11.1 Secrets vault

Highest-sensitivity store. Default UI shows type, realm, identity, location, method, reuse count — not plaintext. Reveal is a privileged, logged event.

Per credential: type (password, hash with hash type, API key, bearer token, SSH key, certificate, Kerberos ticket, session cookie); owning identity and realm; exact discovery location (host, file path or URL) plus the command that found it; acquisition method (cleartext capture, memory dump, database dump, cracked, sprayed, leaked in a share); crack metadata (wordlist, rule set, time to crack, resulting plaintext reference); validation matrix (which services it was tested against, result, timestamp); reuse graph (every other host, service, and identity the same secret unlocks); redaction policy per output channel; full access log of who viewed it; rotation status once reported.

### 11.2 Loot

Loot is not only secrets. Retrieved files, dumps, screenshots of access, user.txt/root.txt equivalents, exported registry hives, and conf files live in loot, referenced by the file manifest, hashed, classified, and bound to a command or manual event.

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-SEC-001** | Secrets object with every field in §11.1. | MVP | User |
| **FR-SEC-002** | Metadata-first UI; plaintext/hash reveal requires role + reason + audit event. | MVP | Derived |
| **FR-SEC-003** | Reuse graph across hosts/services/identities inside the engagement. | V2 | User |
| **FR-SEC-004** | Validation matrix updates when a command tests a secret (parsed or declared). | V2 | User |
| **FR-SEC-005** | Crack metadata fields when cracking is in RoE and performed in lab. | V2 | User |
| **FR-SEC-006** | Per-channel redaction policy on each secret. | MVP | User |
| **FR-SEC-007** | Rotation status and client-notification date. | V2 | User |
| **FR-LOOT-001** | Loot register for retrieved files, dumps, markers, registry exports, conf files. | MVP | User |
| **FR-LOOT-002** | Auto-promote embedded keys in JS/source maps/conf files into Secrets with pointer back to loot. | V2 | User |

## 12. Vulnerabilities and findings

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-FND-001** | Finding ID, title, vulnerability class (CWE), affected assets. | MVP | User |
| **FR-FND-002** | CVSS vector and score, plus business-context-adjusted severity when they diverge. | MVP | User |
| **FR-FND-003** | CVE and advisory references; public exploit availability flag (link only, no exploit bundle). | MVP | User |
| **FR-FND-004** | Discovery method; scanner-reported vs manually verified. | MVP | User |
| **FR-FND-005** | Exploitation status: identified / attempted-failed / attempted-succeeded / not attempted, with reason. | MVP | User |
| **FR-FND-006** | Confidence level; false-positive disposition with justification. | MVP | User |
| **FR-FND-007** | Reproduction steps with pointers to exact log lines, packets, and screenshots. | MVP | User |
| **FR-FND-008** | Impact, likelihood, risk justification. | MVP | User |
| **FR-FND-009** | Remediation guidance, estimated effort, retest status. | MVP | User |
| **FR-FND-010** | Control mappings: NIST 800-53, CIS, ISO 27001, PCI DSS, OWASP ASVS/Top 10, MITRE ATT&CK technique IDs. | V2 | User |
| **FR-FND-011** | Deduplication and merge history when multiple tools report the same issue. | V2 | User |
| **FR-FND-012** | Finding cannot reach “verified” without at least one evidence pointer. | MVP | Derived |

## 13. Access obtained, sessions, and attack-chain tracking

AC tracking is baselined as Attack Chain only: the ordered path of techniques across assets and identities. Access obtained remains the session model in this section. ACL-like and account changes stay in the cleanup ledger and are not branded AC.

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-SES-001** | Session object: type (shell, WinRM, SSH, RDP, web shell, C2 beacon ingested), target, user context, integrity/privilege level, PID when known. | V2 | User |
| **FR-SES-002** | Open time, close time, duration, how obtained (command/manual IDs). | V2 | User |
| **FR-SES-003** | Every command executed inside the session linked to the session ID. | V2 | User |
| **FR-SES-004** | Privilege escalations: from-context → to-context, technique used. | V2 | User |
| **FR-SES-005** | Lateral movement events: source host → destination host, technique, credential used. | V2 | User |
| **FR-SES-006** | Tokens and tickets acquired linked to Secrets. | V2 | User |
| **FR-SES-007** | Pivots and tunnels — SOCKS proxies, port forwards, ports and lifetimes. | V2 | User |
| **FR-AC-001** | Attack-chain graph: nodes are assets and identities; edges are techniques; ATT&CK mapped per edge. | V2 | User |
| **FR-AC-002** | Blast-radius calculation from any compromised node using current inventory + edges. | V3 | User |
| **FR-AC-003** | Dead ends preserved on the graph and timeline; not pruned. | V2 | User |
| **FR-AC-004** | Script-generated or operator-drawn chain can be pinned to a finding or report figure. | V2 | User |

## 14. Changes made to targets — cleanup ledger

No forensic analog is more operationally important. At engagement close the platform emits an uncleaned-artifacts report — anything still present on client systems, handed over explicitly rather than forgotten.

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-CLN-001** | Record every file written to a target: path, hash, size, purpose. | MVP | User |
| **FR-CLN-002** | Record every file modified, with original content preserved for restoration when captured. | MVP | User |
| **FR-CLN-003** | Accounts created or modified; group memberships granted. | MVP | User |
| **FR-CLN-004** | Registry keys and values changed (ties to manual registry capture). | MVP | User |
| **FR-CLN-005** | Services, scheduled tasks, and cron jobs created. | MVP | User |
| **FR-CLN-006** | Firewall rules altered. | V2 | User |
| **FR-CLN-007** | DNS records created (including ADIDNS-style cases). | V2 | User |
| **FR-CLN-008** | Certificate templates created or modified (including ESC1-style cases). | V2 | User |
| **FR-CLN-009** | Database rows inserted or updated. | V2 | User |
| **FR-CLN-010** | Processes left running; persistence mechanisms installed. | MVP | User |
| **FR-CLN-011** | Each entry carries created-at, cleaned-up-at, verifier identity, and verification method. | MVP | User |
| **FR-CLN-012** | Close-out uncleaned-artifacts report generated from open cleanup items. | MVP | User |
| **FR-CLN-013** | Operator can declare a residual as accepted-by-client with ticket/email reference. | MVP | Derived |

## 15. Evidence artifacts, screenshots, recordings, file manifest

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-EVD-001** | Screenshots hashed and bound to the command or manual event and session that produced them. | MVP | User |
| **FR-EVD-002** | Hotkey/drop-zone screenshot capture into the active project. | MVP | Derived |
| **FR-EVD-003** | Terminal and screen recordings as hashed blobs with start/end and session ID. | V2 | User |
| **FR-EVD-004** | Retrieved files with hash, original path, retrieval time, and retrieving event ID. | MVP | User |
| **FR-EVD-005** | Memory dumps, database dumps, and configuration files stored inside the project blob store as classified loot (not external-volume pointers). | MVP | User |
| **FR-EVD-006** | Proof-of-access markers (user.txt/root.txt equivalent) as a typed loot class. | MVP | User |
| **FR-EVD-007** | Chain of custody on all evidence: collected by whom, when, storage location, encryption state, every subsequent access, retention and destruction date. | MVP | User |
| **FR-MANIFEST-001** | Engagement file manifest listing every stored blob and project file: path, hash, size, class, created-by event, redaction class, retention. | MVP | User |
| **FR-MANIFEST-002** | Manifest export (JSON/CSV) for legal hold and archive. | MVP | User |
| **FR-EVD-008** | Auto-capture of terminal logs as described in FR-CMD-\*; optional auto-screenshot on scope-block and on finding-verify actions. | V2 | User |

## 16. Tasks, hypotheses, research processes, scratchpads

Individual task trackers keep the engagement from becoming an unsearchable note pile. A task may be a hypothesis (“this host speaks old TLS and may share a cert”), a methodology step, a report action, or a cleanup action.

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-TSK-001** | Task objects: title, owner, state (inbox/doing/blocked/dead-end/done), due window, linked assets, priority. | MVP | User |
| **FR-TSK-002** | Hypothesis field: predicted outcome, result, dead-end rationale. | MVP | User |
| **FR-TSK-003** | Tasks link to commands, evidence, findings, and scratchpads. | MVP | User |
| **FR-TSK-004** | Per-operator personal board plus engagement board. | MVP | User |
| **FR-SCR-001** | Scratchpads: markdown notes stored in-project, linkable to task/asset/finding. | MVP | User |
| **FR-SCR-002** | Research process records: question, sources consulted, conclusion, leftover questions — suitable for agent and human research. | MVP | User |
| **FR-SCR-003** | Scratchpads shall not be a backdoor for storing unredacted secrets; paste detection warns and offers vault promotion. | MVP | Derived |

## 17. Checklists, coverage, timeline, and QA metrics

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-CHK-001** | Checklist engine supporting bundled methodologies: operator 8-phase model, PTES, OWASP WSTG, plus custom packs. | MVP | User |
| **FR-CHK-002** | Checklist items map to tasks and can auto-complete when specified event types exist (e.g., port-scan class command against an in-scope subnet). | V2 | Derived |
| **FR-COV-001** | Percentage of in-scope assets actually touched; ports scanned; endpoints tested. | V2 | User |
| **FR-COV-002** | Time allocated per phase and per operator from ledger timestamps. | V2 | User |
| **FR-COV-003** | Explicitly enumerated untested areas, feeding the report caveats section directly. | MVP | User |
| **FR-TL-001** | One unified timeline carrying commands, manual activities, sessions, findings, target changes, evidence, scope verdicts. | MVP | User |
| **FR-TL-002** | Timeline filters: host, identity, operator, risk class, finding, dead-end only. | MVP | User |
| **FR-TL-003** | Export timeline as JSON and as a report figure. | V2 | Derived |

## 18. Cross-engagement correlation

Analogous to Autopsy’s Central Repository, pointed at offensive data. Requires a higher-level store outside a single engagement, with strict client isolation unless a lab/org policy allows correlation.

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-X-001** | Same credential or hash appearing across multiple hosts, clients, or engagements (org-policy gated). | V3 | User |
| **FR-X-002** | Shared certificate and SSH key fingerprints indicating cloned images. | V3 | User |
| **FR-X-003** | Same vulnerable software version fleet-wide. | V3 | User |
| **FR-X-004** | Recurring findings — reported last test, still open — with regression detection. | V3 | User |
| **FR-X-005** | Client trending: mean time to remediate, findings-per-asset over time. | V3 | User |
| **FR-X-006** | Known false positives per scanner, suppressed automatically with audit. | V3 | User |
| **FR-X-007** | Technique effectiveness statistics — which attack paths actually work in practice, aggregated without leaking client secrets. | V3 | User |

## 19. Detection feedback (purple team)

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-PUR-001** | Ingest client-shared SIEM/EDR alert exports and join to tester actions by timestamp and host. | V3 | User |
| **FR-PUR-002** | Time-to-detect and time-to-respond per technique. | V3 | User |
| **FR-PUR-003** | Techniques that went entirely undetected. | V3 | User |
| **FR-PUR-004** | EDR/AV evasion attempt outcomes as operator-declared or parser-declared events (no built-in evasion library). | V3 | User |
| **FR-PUR-005** | Timestamp correlation view between tester action and defender alert, using recorded clock skew. | V3 | User |

## 20. Reporting, templates, and distribution

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-RPT-001** | Report versions, revision history, and author per section. | MVP | User |
| **FR-RPT-002** | Which findings appear in which deliverable. | MVP | User |
| **FR-RPT-003** | Redaction profiles — client copy vs internal copy vs executive summary — applied as a pipeline. | MVP | User |
| **FR-RPT-004** | Client feedback, disputed findings, and dispositions. | V2 | User |
| **FR-RPT-005** | Per-finding retest results. | V2 | User |
| **FR-RPT-006** | Distribution log: who received the report, when, through what channel. | MVP | User |
| **FR-RPT-007** | Built-in templates for technical report, executive summary, cleanup letter, uncleaned-artifacts appendix. Optional house-template slot so an operator can add a FireFlow/Cap-style pack without making it mandatory. | MVP | User |
| **FR-RPT-008** | Export DOCX, PDF, and structured JSON. Markdown source retained in-project. | MVP | Derived |
| **FR-RPT-009** | Finding writeups pull evidence pointers and refuse to render “verified” without them for the client profile. | MVP | Derived |
| **FR-RPT-010** | Caveats section auto-fed from untested-area coverage objects. | MVP | User |

## 21. Script generation and scan-output ingest

Script generation means the platform can draft operator scripts (recon wrappers, parser snippets, report glue) into a project scripts library. Scripts are artifacts. They are not silently executed against targets. Generated scripts require review state: drafted / approved / rejected. Approved scripts may be launched through the managed terminal so they inherit ledger capture.

Lossless ingest is a product rule. Every imported scan, log, screenshot, dump, proxy export, case file, and foreign artifact shall be stored as the original bytes (hashed) in the manifest before any parser runs. Parse failure must not discard the raw object. Parsers may be lossy in their projections; the store may not.

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-SCRP-001** | Scripts library per project: generated or imported, with review state and hash. | MVP | User |
| **FR-SCRP-002** | Generation via template or model; output written to library, not auto-exec. | MVP | User |
| **FR-SCRP-003** | Approved script run goes through the command runner and ledger. | MVP | Derived |
| **FR-ING-001** | Pluggable ingest for scan outputs into hosts/services/findings/web/AD/cloud projections. | MVP | User |
| **FR-ING-002** | Raw object preserved hashed in the manifest even if parse fails. Nothing ingested is lossy at the blob layer. | MVP | User |
| **FR-ING-003** | Parser version recorded on ingest events for replay when parsers improve. | MVP | Derived |
| **FR-ING-004** | Unknown file types are still catalogued (name, hash, size, source) and opened with the OS handler; they are never dropped. | MVP | User |
| **FR-CASE-001** | Export a complete case file (ledger, blobs, vault ciphertext, templates-in-use, plugin list) as a single portable package. | MVP | User |
| **FR-CASE-002** | Import a Pen Trackr case file into another project or instance; hash chain verified on import. | MVP | User |
| **FR-CASE-003** | Import external artifacts from other cases or tools (directories, zips, individual files) as lossless loot/ingest with provenance “external.” | MVP | User |
| **FR-CASE-004** | Case export excludes plaintext vault material by default and includes it only under an explicit unredacted-export action. | MVP | Derived |

## 22. Local and API model integration, agents, prompt management

### 22.1 Integration surface

MVP adapters shall include Claude and Codex. Additional adapters are pluggable. The platform shall not hard-depend on a single vendor. Sending engagement context to a hosted API is allowed and shall default to the redaction profile with a non-blocking suggestion to review what will leave the laptop. It is not a hard prohibition.

Capabilities expected of adapters: complete a prompt with project context; stream tokens into a scratchpad; propose a command or finding draft; run a named agent graph. Context packaging shall honor redaction profiles. Secrets are never included in prompts unless the operator explicitly expands a reveal-into-prompt action (logged).

### 22.2 Multi-agent research

Named agent roles, initially:

- Scope / RoE copilot — command touches X, X is excluded / blackout.

- Evidence binder — attach log lines, packets, shots to a finding.

- Finding writer — CWE, CVSS, reproduction from bound evidence, control mappings.

- Coverage auditor — checklist vs ledger.

- Cleanup accountant — dirty items still open.

- Report renderer — section drafts per audience profile.

- Researcher — structured research process records from questions and allowed sources.

Autonomous multi-step execution against live targets is out of scope. Supervised execution is in scope: an agent proposes a command or approved script, the operator ticks accept, the managed runner executes, and the ledger records proposer=agent and approver=operator.

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-AI-001** | MVP adapters: Claude and Codex (local/desktop and API as each vendor provides). Other adapters via the same interface. | MVP | User |
| **FR-AI-002** | Per-project and per-profile API credential storage in the OS keychain or platform vault — never in plaintext project files. | MVP | Derived |
| **FR-AI-003** | Context packager applies the active redaction profile before any model call and shows a suggestion summarizing what will be sent. Hosted APIs are allowed. | MVP | User |
| **FR-AI-004** | Multi-agent runs with traces stored as research-process + agent-trace events. | V2 | User |
| **FR-AI-005** | Agents write drafts (findings, tasks, scripts, report sections), not authorized ledger facts, until an operator accepts. | MVP | Derived |
| **FR-AI-006** | Supervised runner: agent or template proposes a command/script; operator approves; managed runner executes; ledger stores both identities. | V2 | User |
| **FR-AI-007** | Offline mode: all operator-plane features work with models disabled. | MVP | Derived |
| **FR-AI-008** | No silent/unattended execution loop against targets. | MVP | Derived |
| **FR-PMT-001** | Local prompt management: versioned prompt files in-project and in a user library. | MVP | User |
| **FR-PMT-002** | Prompt templates parameterized by object type (finding, host, report section, RoE check). | MVP | User |
| **FR-PMT-003** | Prompts treated like code: diffable, reviewable, pinable to methodology packs. | MVP | Derived |

## 23. Custom plugins

Plugins extend parsers, target extractors, risk-class hints, sidebar views, report sections, manual-activity types, and model tools. They shall not receive secret-read or command-exec capability unless the operator grants a capability flag per plugin per engagement.

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-PLG-001** | Plugin manifest: name, version, hash, requested capabilities, tool families handled, language (TypeScript/JavaScript or Python). | V2 | User |
| **FR-PLG-002** | Capability flags: parse, ui-view, manual-type, report-section, suggest-command, read-secrets, exec. Last two default deny. | V2 | Derived |
| **FR-PLG-003** | Signed or hashed plugin install with user confirmation. | V2 | Derived |
| **FR-PLG-004** | First-party plugins for nmap, generic JSON/XML, screenshot drop, markdown report, runlog import. | MVP | Derived |
| **FR-PLG-005** | Failed plugin must not crash the workbench; errors become ledger system events. | V2 | Derived |
| **FR-PLG-006** | Plugin SDKs shipped for both TypeScript and Python against the same core API. | V2 | User |
| **FR-PLG-007** | Closed-module plugins load only when that module is installed; open-core case files remain readable without them. | V2 | User |

## 24. Platform security, tamper-evidence, and redaction pipeline

### 24.1 Tamper-evidence

The ledger is potential legal evidence in a dispute over whether a tester caused an outage. It shall be append-only with hash-chained entries and signed at intervals. Operators must be able to prove what they did and what they did not do.

### 24.2 Redaction as a first-class pipeline

Every credential, token, and PII item needs a per-output disclosure policy. Manual “handling notes” are insufficient as the only control. The pipeline evaluates object class + audience profile and emits redacted views. Attempts to copy unredacted secrets out of profile follow the vault access log.

### 24.3 Encryption and isolation

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **FR-SECPL-001** | Append-only ledger; updates are compensating events, never in-place edits of history. | MVP | User |
| **FR-SECPL-002** | Hash chain over events; interval signatures (local key in OS keystore / hardware if present). | MVP | User |
| **FR-SECPL-003** | Engagement-at-rest encryption for vault and evidence blobs. | MVP | Derived |
| **FR-SECPL-004** | Project isolation: switching projects unloads plaintext secrets from memory within a bounded time. | MVP | Derived |
| **FR-SECPL-005** | Redaction pipeline with named profiles and object-level policy. | MVP | User |
| **FR-SECPL-006** | Vault access log immutable in the ledger. | MVP | User |
| **FR-SECPL-007** | Export of a signed ledger bundle for legal hold. | V2 | Derived |
| **FR-SECPL-008** | Backup is encrypted; backup restore is an event in a new meta-log. | V2 | Derived |
| **FR-SECPL-009** | No telemetry of engagement content to the vendor in a self-hosted/local-first build. | MVP | Derived |
| **FR-SECPL-010** | Threat model document for the workbench itself shipped with the product. | V2 | Derived |

## 25. Logical data model and event taxonomy

### 25.1 Core entities

Engagement, Operator, ArtifactDocument (SOW/NDA/auth letter), ScopeObject, ScopeExclusion, TimeWindow, CommandEvent, ManualActivityEvent, Session, Host, Service, WebEndpoint, IdentityAccount, CloudObject, WirelessObject, PhysicalObject, Secret, LootItem, Finding, FindingMerge, CleanupItem, EvidenceItem, FileManifestEntry, TrafficFlow, ProxyExchange, Task, Scratchpad, ResearchProcess, Checklist, ChecklistItem, CoverageGap, TimelineIndex, AttackEdge, PurpleJoin, Report, ReportVersion, DistributionEvent, Prompt, PromptTemplate, AgentRun, ScriptItem, Plugin, GuardrailEvent.

### 25.2 Minimum event types (ledger)

- engagement.created / updated / state-changed

- scope.object-added / excluded / evaluated

- command.proposed / allowed / warned / blocked / started / finished

- manual.logged

- session.opened / closed / ingested

- asset.discovered / updated / merged

- secret.created / revealed / validated / rotated

- loot.added

- finding.drafted / accepted / merged / status-changed

- cleanup.recorded / verified / residual-accepted

- evidence.added / accessed / exported / destroyed

- traffic.ingested / flow-correlated

- task.changed / hypothesis-resolved

- report.generated / distributed

- agent.ran / draft-accepted / draft-rejected

- plugin.installed / capability-granted

- guardrail.violation / availability-event / lockout-risk

- project.switched / ledger.sealed / backup.restored

Every event carries: event_id, prev_hash, this_hash, ts_utc, ts_local, tz, operator_id, engagement_id, payload schema version.

## 26. Non-functional requirements

| ID | Requirement | Phase | Source |
|----|----|----|----|
| **NFR-001** | Local-first single-user: one operator laptop shall run MVP without a required cloud control plane or second human. | MVP | User |
| **NFR-002** | Air-gap operable with models and remote APIs disabled. | MVP | Derived |
| **NFR-003** | Command capture overhead shall not make a normal shell feel broken; target \< 20 ms start delay for unmanaged-feeling mode on typical hardware, excluding scope-parse of huge argv. | MVP | Derived |
| **NFR-004** | Projects with 100k command events remain filterable in the ledger UI. | V2 | Derived |
| **NFR-005** | Evidence blobs streamed from disk; not loaded entirely into RAM. | MVP | Derived |
| **NFR-006** | Crash of a plugin or terminal tab shall not lose already-finished ledger events. | MVP | Derived |
| **NFR-007** | Documented backup/restore of a project directory + key material. | MVP | Derived |
| **NFR-008** | MVP runs on Linux, Windows, and macOS. All three are first-class. Feature gaps per OS shall be listed in release notes, not used to drop a platform. | MVP | User |
| **NFR-011** | No product-enforced retention, destruction clock, or legal-hold scheduler. Operators manage retention outside the tool. Export remains available. | MVP | User |
| **NFR-012** | Nothing bundled: no exploit payloads, no C2 client/server, no phishing engine, no weaponized templates. | MVP | User |
| **NFR-013** | No functional dependency on Cyber Trackr. Optional use of public control catalogs for research only. | MVP | User |
| **NFR-014** | Dual-module: open core is sufficient to operate; closed module is additive. | MVP | User |
| **NFR-009** | Deterministic export: two exports of a sealed ledger with the same key verify the same chain. | MVP | Derived |
| **NFR-010** | Time handling: store UTC plus local plus tz name; show both; record NTP offset when available. | MVP | User |

## 27. Delivery phases

### 27.1 MVP — usable on a real external + web engagement

Local core service on Linux, Windows, and macOS. VS Code extension + web UI + TUI attached to localhost. Lab mode. Optional legal templates (none required). Project switcher. Wrapped local terminal + raw best-effort logging. Command ledger. Manual activity. File manifest. Screenshots. In-project dumps. Loot + secrets vault. Findings. Tasks/scratchpads. Checklists. Timeline. Cleanup residual report. Report templates plus optional house-template slot. Claude and Codex adapters with suggested redaction. Lossless ingest. Case file export/import and external artifact import. Hash-chained ledger. Dual-module core functional without closed pack.

### 27.2 V2 — correlation, plugins, supervised exec

Proxy/pcap ingest and command↔flow correlation; TLS key vaulting; session objects; attack-chain graph with dead ends; AD/cloud specialized projections; TTY/GUI recording; TS and Python plugin SDKs; multi-agent traces; supervised propose-approve-execute runner; lockout/throttle guardrails; control mappings; coverage percentages.

### 27.3 V3 — optional organization features

Cross-engagement correlation if the operator imports multiple case files; purple-team joins; wireless/physical/social modules behind the documented enums; blast radius. Multi-user remains out of scope unless a later charter changes §3.

## 28. Acceptance criteria (MVP)

1.  Create two projects, switch between them, and demonstrate isolated ledgers and unloaded secrets.

2.  Create a Lab-mode project with no legal documents and run a command. Create a second project, attach optional RoE/scope from templates, exclude a host, and see a block event only on that project.

3.  Open the same project from the VS Code extension, the web UI, and the TUI against one core service.

4.  Export a case file and import it as a new project. Import an external zip of artifacts; raw files remain in the manifest even if unparsed.

5.  Open a raw terminal; confirm a capture=partial (or better) ledger event exists.

6.  Run a managed command; verify every required command-ledger field is populated or explicitly null.

7.  Log manual activities: opened browser, filled form, captured registry keys, captured conf file; see them on the timeline and manifest.

8.  Drop a screenshot and a retrieved file; hashes present; bound to an event.

9.  Store a secret as metadata; reveal once; access log shows the reveal; client report redacts it; internal profile can include it under policy.

10. Create a finding with reproduction pointers into log lines and the screenshot; generate technical and executive outputs from the same data.

11. Record a file written on a lab target; close engagement; uncleaned-artifacts report lists it until verified clean.

12. Import an nmap-style scan and a historical runlog; assets and commands appear with provenance imported.

13. Run a local or API model prompt from a template against redacted context; output lands in a scratchpad as a draft.

14. Seal the ledger and verify the hash chain.

15. Apply a theme and collapse/expand every sidebar section listed for MVP.

## 29. Source-brief traceability

This section exists so nothing from the originating request is only “implied.”

| Originating item | Lives in |
|----|----|
| Built-in terminals like VS Code | §5, FR-CMD-001 |
| Integrations with local AI (Codex, Claude) and API calling | §22, FR-AI-001 |
| Auto-captures logs | FR-CMD-002/003, FR-EVD-008 |
| Evidence | §15 |
| Screenshots | FR-EVD-001/002 |
| Multiple agents | §22.2, FR-AI-004 |
| Research processes | FR-SCR-002 |
| Scratchpads | FR-SCR-001 |
| Individual task trackers | §16, FR-TSK-\* |
| Script generation | §21, FR-SCRP-\* |
| AC tracking (attack chain) | §13, FR-AC-\* |
| VS Code + web + TUI clients | FR-UI-009/010/011 |
| Case export / import / external artifacts | FR-CASE-001–004 |
| Lab mode | FR-ENG-015 |
| Optional legal templates | FR-ENG-016 |
| Claude + Codex adapters | FR-AI-001 |
| Supervised exec path | FR-AI-006 |
| Lossless ingest | FR-ING-002/004 |
| Cross-platform MVP | NFR-008 |
| Dual module | NFR-014, §2.5 |
| Nothing bundled | NFR-012 |
| Captured loot | §11.2, FR-LOOT-\* |
| Various scan outputs | FR-ING-\* |
| Checklists | FR-CHK-\* |
| Timelines | FR-TL-\* |
| Manifest for files | FR-MANIFEST-\* |
| Manual activity: browser, form, registry, conf | §6, FR-MAN-\* |
| Local prompt management | FR-PMT-001 |
| Templates | FR-PMT-002, FR-RPT-007 |
| Reports | §20 |
| Custom plugins | §23 |
| Themeable interface | FR-UI-001 |
| Collapsible sidebar navigation | FR-UI-002, §4.3 |
| Selectable switchable projects | FR-UI-003 |
| §1 Engagement metadata (all bullets) | §7 FR-ENG-001–015 |
| §2 Operator activity / command ledger (all bullets) | §5.3, FR-CMD-\* |
| §3 Network traffic (all bullets) | §9 |
| §4 Asset inventory (hosts/services/web/AD/cloud/wireless/physical) | §10 |
| §5 Credentials and secrets (all bullets) | §11 |
| §6 Vulnerabilities and findings (all bullets) | §12 |
| §7 Access and sessions (all bullets) | §13 |
| §8 Cleanup ledger (all bullets including ADIDNS/ESC examples) | §14 |
| §9 Safety and impact guardrails | §8.2 FR-SAF-\* |
| §10 Evidence artifacts + chain of custody | §15 |
| §11 Cross-engagement correlation | §18 |
| §12 Timeline and attack path graph + dead ends + blast radius | FR-TL-\*, FR-AC-\* |
| §13 Purple team detection feedback | §19 |
| §14 Reporting state | §20 |
| §15 Coverage and QA metrics | §17 |
| Tamper-evidence / hash chain / interval signatures | FR-SECPL-001/002 |
| Redaction as pipeline / audience profiles | FR-SECPL-005, FR-RPT-003 |
| Scope enforcement at execution time | §8, FR-SCP-001 |

## 30. Interview record — closed 5 September 2026

The v0.1 questions are closed. Answers below are normative for this baseline. Residual items that were not asked remain listed at the end as still-open only if they do not block implementation.

### 30.1 Product identity and users

- Name: Pen Trackr.

- Deployment: personal laptop, single user.

- MVP OS: everywhere — Linux, Windows, macOS.

- Case files may leave the laptop via export. Import of Pen Trackr case files and of external artifacts from other cases is required. No shared multi-user server in MVP.

### 30.2 Legal and operational envelope

- No legal artifact is required (auth letter, SOW, NDA, RoE). Templates for all shall be provided.

- Lab mode is required.

- Retention policy is out of scope for this product.

- Social engineering, wireless, and physical: documented enums for later, not MVP modules.

### 30.3 Command runner

- Wrapping the local interactive shell is sufficient for MVP.

- Raw mode is allowed always, with best-effort monitoring/logging.

- Ingest is lossless at the blob layer for every tool family. Parsers may be incomplete; raw bytes are not discarded.

### 30.4 AC tracking

- AC means attack chain.

### 30.5 AI

- Mandatory adapters: Claude and Codex.

- Hosted API use is allowed. Redaction-before-send is a suggestion, not a hard rule.

- Supervised path is required (propose → operator tick → runner executes). Planned for V2 but committed.

### 30.6 Secrets, reports, stack

- Dumps live inside the project store.

- House report template is optional, offered, not mandatory.

- Primary GUI stack: VS Code extension.

- Also required: web interface and TUI, same core API.

- Plugins: TypeScript and Python.

- Licensing: dual module (open core + optional closed pack).

- Not related to Cyber Trackr. Public catalogs may be used for research.

- Nothing bundled: no payloads, C2, or phishing engine.

### 30.7 Still optional later (do not block v0.2)

- Dedicated UI fields for historical ADIDNS/ESC1 cases vs generic cleanup rows.

- Store engine (SQLite assumed until changed).

## 31. Residual engineering assumptions (not contradicted by interview)

- SQLite + content-addressed blob directory per project until a later store decision.

- Core service on localhost; VS Code / web / TUI are clients.

- Capability modes (reveal confirm) exist even though there is only one human user.

- No hosted control plane.

*End of SRS v0.2. Next useful addendum is an event-schema appendix (JSON field lists) if requested.*
