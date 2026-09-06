/**
 * Patterns that must not appear in a public repository.
 *
 * These are deliberately narrow. This project is a penetration-testing tool: its
 * documentation, tests, and fixtures legitimately contain private addresses,
 * CIDR ranges, loopback discussion, and lab target IPs. A rule broad enough to
 * catch "any private IP" would fire on all of that, and a check that cries wolf
 * gets switched off — which is worse than no check at all.
 *
 * So the rules key on the distinction that actually holds here: lab and example
 * addressing lives in 10.x, while the maintainer's own infrastructure lives in
 * the home-LAN ranges. Account names paired with a host are near-zero-noise in
 * either case.
 *
 * Every rule below was validated against the full tracked tree: two findings at
 * the commit that leaked, zero on every other revision.
 */

export interface Rule {
  readonly name: string
  readonly pattern: RegExp
  readonly why: string
}

export const RULES: readonly Rule[] = [
  {
    name: 'ssh-target',
    // The account@host may sit anywhere on the line, not just straight after the
    // command: `scp local.js admin@box:C:/dst` puts a source path in between.
    // Bounded so the match cannot wander across an entire long line.
    pattern: /\b(?:ssh|scp|rsync)\b.{0,120}?\b[A-Za-z0-9._-]+@[A-Za-z0-9._-]+/,
    why: 'names an account and host together; keep connection details out-of-band',
  },
  {
    name: 'privileged-account',
    pattern: /\b(?:admin|root|Administrator)@[A-Za-z0-9._-]+/,
    why: 'names a privileged account on a specific host',
  },
  {
    name: 'account-prose',
    pattern: /\b(?:SSH|ssh)\s+as\s+[`"']?(?:admin|root|Administrator)\b/,
    why: 'names a privileged account in prose',
  },
  {
    name: 'home-lan-address',
    pattern: /\b(?:192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/,
    why: 'a home-LAN address identifies real infrastructure (10.x lab ranges are fine)',
  },
  {
    name: 'ssh-key-path',
    pattern: /~?\/?\.ssh\/id_[A-Za-z0-9_]+/,
    why: 'names a private key location',
  },
]

/**
 * Inline escape hatch.
 *
 * Present so the check can be overruled deliberately and visibly, on the line
 * itself, rather than by disabling the job. A reviewer sees the marker in the
 * diff and can ask why.
 */
export const ALLOW_MARKER = 'pentrackr-allow-infra'

/**
 * File-level escape hatch, for a file that *discusses* these patterns rather
 * than containing real infrastructure — this scanner's own fixtures, most
 * obviously.
 *
 * The traceability tool needed exactly the same hatch for exactly the same
 * reason, and both were discovered the same way: the gate's first real run
 * flagged the gate's own tests. A tool that recognizes a pattern will always
 * contain that pattern somewhere.
 */
export const ALLOW_FILE_MARKER = 'pentrackr-allow-infra-file'
