import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isScannable } from '../src/files.js'
import { ALLOW_FILE_MARKER, ALLOW_MARKER, RULES } from '../src/rules.js'
import { formatFindings, scanText } from '../src/scan.js'

/**
 * @req-ignore-file
 * pentrackr-allow-infra-file
 *
 * Fixtures below contain the exact strings the scanner looks for, including the
 * ones that leaked from this repository. Two markers keep the two gates out of
 * it — a tool that recognizes a pattern will always contain that pattern
 * somewhere, and both gates learned this by flagging their own tests.
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
  it('skips a whole file carrying the file-level marker', () => {
    const text = [`// ${ALLOW_FILE_MARKER}`, '192.168.0.16', 'ssh root@box'].join('\n')
    expect(scan(text)).toEqual([])
  })

  it('honours the file marker wherever it appears in the file', () => {
    const text = ['192.168.0.16', `trailing ${ALLOW_FILE_MARKER}`].join('\n')
    expect(scan(text)).toEqual([])
  })

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

/**
 * Regression tests for a blind spot the scanner had in itself.
 *
 * The file-level exemption is a substring check, so the module defining the
 * marker exempted itself simply by containing its own constant. Two findings sat
 * in `rules.ts` unseen — and the first attempt to document the problem
 * reintroduced it, by quoting the marker inside the comment explaining not to
 * quote it.
 */
describe('the scanner does not exempt itself', () => {
  const readSource = (relative: string) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', relative), 'utf8')

  it('keeps the file marker out of the module that defines it', () => {
    // The property that matters. If this fails, rules.ts is invisible to the
    // scanner and anything written there is unchecked.
    expect(readSource('src/rules.ts').includes(ALLOW_FILE_MARKER)).toBe(false)
  })

  it.each(['src/rules.ts', 'src/scan.ts', 'src/cli.ts'])(
    'scans %s rather than skipping it',
    (file) => {
      expect(readSource(file).includes(ALLOW_FILE_MARKER)).toBe(false)
    },
  )

  it('finds nothing in its own sources', () => {
    for (const file of ['src/rules.ts', 'src/scan.ts', 'src/cli.ts']) {
      expect(scanText(file, readSource(file))).toEqual([])
    }
  })

  it('still assembles the documented marker values', () => {
    // Splitting the constant must not change what it means to a reader who
    // types the marker into a file by hand.
    expect(ALLOW_MARKER).toBe('pentrackr-allow-infra')
    expect(ALLOW_FILE_MARKER).toBe('pentrackr-allow-infra-file')
  })

  it('would flag the example that was hiding in rules.ts', () => {
    // Proof the exemption was masking something real, not merely theoretical.
    expect(scanText('rules.ts', 'command: `scp local.js admin@box:C:/dst`').length).toBeGreaterThan(
      0,
    )
  })
})

/**
 * The file-selection predicate decides what gets scanned at all, so a mistake
 * here silently shrinks coverage rather than producing a visible failure. It had
 * no tests until review pointed that out.
 */
describe('isScannable', () => {
  it.each([
    'a.md',
    'a.ts',
    'a.tsx',
    'a.mts',
    'a.cts',
    'a.js',
    'a.mjs',
    'a.cjs',
    'a.json',
    'a.yml',
    'a.yaml',
    'a.sh',
    'a.ps1',
  ])('scans %s', (file) => {
    expect(isScannable(file)).toBe(true)
  })

  it.each(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'bun.lockb'])(
    'skips the generated file %s',
    (file) => {
      expect(isScannable(file)).toBe(false)
    },
  )

  it('skips a lockfile nested in a subdirectory', () => {
    expect(isScannable('packages/cli/pnpm-lock.yaml')).toBe(false)
  })

  it('skips a lockfile given a Windows-style path', () => {
    expect(isScannable('packages\\cli\\pnpm-lock.yaml')).toBe(false)
  })

  it('still scans a hand-written yaml beside the lockfiles', () => {
    expect(isScannable('.github/workflows/ci.yml')).toBe(true)
  })

  it.each(['a.png', 'a.txt', 'a.lock', 'Makefile', 'a.rs'])('ignores %s', (file) => {
    expect(isScannable(file)).toBe(false)
  })

  it('does not skip a file merely because a lockfile name appears in its path', () => {
    // The check is on the basename, not the whole path.
    expect(isScannable('docs/pnpm-lock.yaml.md')).toBe(true)
  })
})

/**
 * Both scanners maintain their own generated-file list. Review flagged that two
 * independent lists invite drift — a new lockfile type excluded from one tool and
 * not the other. They stay separate, because a shared package for four strings
 * would couple two otherwise independent tools, but this asserts they agree, so
 * the drift the duplication risks fails a test rather than going unnoticed.
 */
describe('generated-file lists agree across the two scanners', () => {
  it('hygiene and trace skip the same set of generated files', () => {
    const traceSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../trace/src/annotations.ts'),
      'utf8',
    )
    const hygieneSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/files.ts'),
      'utf8',
    )

    const namesIn = (source: string) => {
      const block = /GENERATED_FILES = new Set\(\[([^\]]*)\]/s.exec(source)?.[1] ?? ''
      return [...block.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort()
    }

    expect(namesIn(hygieneSource)).toEqual(namesIn(traceSource))
    expect(namesIn(hygieneSource).length).toBeGreaterThan(0)
  })
})

/**
 * Regression for a trap this documentation walked into: the page describing the
 * exemption marker contained it, and so exempted itself.
 */
describe('documentation does not exempt itself', () => {
  it.each(['docs/testing.md', 'docs/pipeline.md'])('scans %s', (relative) => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    const source = readFileSync(join(repoRoot, relative), 'utf8')
    expect(source.includes(ALLOW_FILE_MARKER)).toBe(false)
  })
})
