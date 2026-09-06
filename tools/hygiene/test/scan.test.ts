import { describe, expect, it } from 'vitest'
import { ALLOW_MARKER, RULES } from '../src/rules.js'
import { formatFindings, scanText } from '../src/scan.js'

/**
 * @req-ignore-file
 *
 * Fixtures below contain the exact strings the scanner looks for, including the
 * ones that leaked from this repository. The marker keeps the traceability gate
 * out of it; the hygiene scanner skips this file by its own allow marker on each
 * fixture line where needed.
 */

const scan = (text: string) => scanText('fixture.md', text)

describe('catches what actually leaked', () => {
  it('flags a home-LAN address in a table cell', () => {
    // The exact line that reached master.
    const line = '| D23 | Windows test host | **`baldr` (192.168.0.16)** — Windows 11 Pro |'
    const [finding] = scan(line)
    expect(finding?.rule).toBe('home-lan-address')
    expect(finding?.excerpt).toBe('192.168.0.16')
  })

  it('flags a privileged account named in prose', () => {
    const line = '| `baldr` | Real Windows hardware, reachable over SSH as `admin`. |'
    expect(scan(line)[0]?.rule).toBe('account-prose')
  })
})

describe('rules', () => {
  it.each([
    ['ssh admin@host.local', 'ssh-target'],
    ['scp file.txt operator@10.0.0.5:/tmp', 'ssh-target'],
    ['scp bench.cjs admin@baldr:C:/dev/repo/bench.cjs', 'ssh-target'],
    ['ssh -o BatchMode=yes operator@buildbox uptime', 'ssh-target'],
    ['rsync -av user@box:/data .', 'ssh-target'],
    ['connect to root@buildbox', 'privileged-account'],
    ['login as Administrator@dc01', 'privileged-account'],
    ['SSH as root', 'account-prose'],
    ['192.168.1.1', 'home-lan-address'],
    ['172.16.4.9', 'home-lan-address'],
    ['172.31.255.254', 'home-lan-address'],
    ['~/.ssh/id_ed25519', 'ssh-key-path'],
    ['/home/op/.ssh/id_rsa', 'ssh-key-path'],
  ])('flags %j as %s', (text, rule) => {
    expect(scan(text).map((f) => f.rule)).toContain(rule)
  })

  it('reports the line number', () => {
    expect(scan(['clean', 'clean', '192.168.5.5'].join('\n'))[0]?.line).toBe(3)
  })

  it('explains why, not just what', () => {
    expect(scan('192.168.5.5')[0]?.why).toMatch(/real infrastructure/)
  })
})

describe("does not fire on this project's legitimate content", () => {
  it.each([
    // Every one of these appears in the real repository.
    'Scope: 10.129.0.0/16 covers the lab range',
    'nmap -sV 10.129.51.242',
    'The core binds to 127.0.0.1 by default (FR-UI-012).',
    'localhost only, unless explicitly widened',
    'CIDR, IP, FQDN, URL, ASN, cloud ID, repo',
    'const address = "10.10.10.10"',
    'baldr — Windows 11 Pro (26200), real Windows hardware',
    'ssh integration hooks for bash/zsh/fish/PowerShell',
    'Import an nmap-style scan and a historical runlog',
    'proxy history ingest (Burp/ZAP-style)',
  ])('allows %j', (text) => {
    expect(scan(text)).toEqual([])
  })

  it('allows 10.x lab addressing, which is used throughout', () => {
    expect(scan('target 10.129.1.1 and 10.10.11.12')).toEqual([])
  })
})

describe('escape hatch', () => {
  it('respects the allow marker on the same line', () => {
    expect(scan(`192.168.0.16 ${ALLOW_MARKER}`)).toEqual([])
  })

  it('does not let the marker on one line excuse another', () => {
    const text = [`192.168.0.1 ${ALLOW_MARKER}`, '192.168.0.2'].join('\n')
    expect(scan(text)).toHaveLength(1)
    expect(scan(text)[0]?.line).toBe(2)
  })
})

describe('formatFindings', () => {
  it('reports cleanliness plainly', () => {
    expect(formatFindings([])).toBe('repository hygiene: clean')
  })

  it('names file, line, rule, and remedy', () => {
    const text = formatFindings(scan('192.168.0.16'))
    expect(text).toContain('fixture.md:1')
    expect(text).toContain('home-lan-address')
    expect(text).toContain(ALLOW_MARKER)
    expect(text).toContain('public')
  })

  it('lists every finding rather than only the first', () => {
    const text = formatFindings(scan(['192.168.0.1', 'ssh root@box'].join('\n')))
    expect(text).toContain('fixture.md:1')
    expect(text).toContain('fixture.md:2')
  })
})

describe('rule hygiene', () => {
  it('gives every rule a name and a reason', () => {
    for (const rule of RULES) {
      expect(rule.name).toMatch(/^[a-z-]+$/)
      expect(rule.why.length).toBeGreaterThan(10)
    }
  })

  it('uses no global regexes, which carry lastIndex state between calls', () => {
    // A /g pattern reused across lines skips matches unpredictably.
    for (const rule of RULES) expect(rule.pattern.global).toBe(false)
  })
})
