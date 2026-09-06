import { describe, expect, it } from 'vitest'
import {
  CHECKPOINT_DOMAIN,
  type CheckpointClaim,
  checkpointPreimage,
  generateSigningKeyPair,
  publicKeyOf,
  signCheckpoint,
  verifyCheckpointSignature,
} from '../src/signing.js'

/** @req FR-SECPL-002 */

const keys = generateSigningKeyPair()

const claim = (overrides: Partial<CheckpointClaim> = {}): CheckpointClaim => ({
  event_count: 3,
  head_hash: 'a'.repeat(64),
  prev_checkpoint_signature: null,
  ts_utc: '2026-09-05T21:00:00.000Z',
  public_key: keys.publicKey,
  ...overrides,
})

describe('key handling', () => {
  it('generates 32-byte hex keys', () => {
    expect(keys.privateKey).toMatch(/^[0-9a-f]{64}$/)
    expect(keys.publicKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it('derives the public key from the private key', () => {
    expect(publicKeyOf(keys.privateKey)).toBe(keys.publicKey)
  })

  it('generates distinct key pairs', () => {
    expect(generateSigningKeyPair().privateKey).not.toBe(keys.privateKey)
  })

  it.each([
    ['too short', 'ab'],
    ['not hex', 'z'.repeat(64)],
    ['uppercase', 'A'.repeat(64)],
  ])('rejects a private key that is %s', (_label, value) => {
    expect(() => publicKeyOf(value)).toThrow(TypeError)
  })
})

describe('checkpoint signing', () => {
  it('produces a 64-byte hex signature', () => {
    expect(signCheckpoint(claim(), keys.privateKey)).toMatch(/^[0-9a-f]{128}$/)
  })

  it('verifies its own signature', () => {
    expect(verifyCheckpointSignature(claim(), signCheckpoint(claim(), keys.privateKey))).toBe(true)
  })

  it('refuses to sign a claim naming a different public key', () => {
    // A checkpoint that verifies against a key nobody holds is indistinguishable
    // from a forgery later, so this is refused at signing time.
    const other = generateSigningKeyPair()
    expect(() => signCheckpoint(claim({ public_key: other.publicKey }), keys.privateKey)).toThrow(
      /does not match/,
    )
  })

  it('is domain separated', () => {
    const bytes = checkpointPreimage(claim())
    expect(new TextDecoder().decode(bytes.slice(0, CHECKPOINT_DOMAIN.length))).toBe(
      CHECKPOINT_DOMAIN,
    )
  })

  it('is deterministic for the same claim', () => {
    expect(signCheckpoint(claim(), keys.privateKey)).toBe(signCheckpoint(claim(), keys.privateKey))
  })
})

describe('checkpoint tamper detection', () => {
  const signature = signCheckpoint(claim(), keys.privateKey)

  it.each([
    ['event_count', { event_count: 2 }],
    ['head_hash', { head_hash: 'b'.repeat(64) }],
    ['ts_utc', { ts_utc: '2026-09-06T21:00:00.000Z' }],
    ['prev_checkpoint_signature', { prev_checkpoint_signature: 'c'.repeat(128) }],
  ])('rejects a claim whose %s was altered', (_field, change) => {
    expect(verifyCheckpointSignature(claim(change), signature)).toBe(false)
  })

  it('rejects a signature from a different key', () => {
    const other = generateSigningKeyPair()
    const forged = signCheckpoint(claim({ public_key: other.publicKey }), other.privateKey)
    expect(verifyCheckpointSignature(claim(), forged)).toBe(false)
  })

  it.each([
    ['empty', ''],
    ['short', 'ab'],
    ['non-hex', 'z'.repeat(128)],
  ])('rejects a %s signature without throwing', (_label, value) => {
    expect(verifyCheckpointSignature(claim(), value)).toBe(false)
  })

  it('rejects a malformed public key without throwing', () => {
    expect(verifyCheckpointSignature(claim({ public_key: 'nope' }), signature)).toBe(false)
  })

  it('rejects a flipped bit anywhere in the signature', () => {
    for (let i = 0; i < 128; i += 16) {
      const flipped =
        signature.slice(0, i) + (signature[i] === '0' ? '1' : '0') + signature.slice(i + 1)
      expect(verifyCheckpointSignature(claim(), flipped)).toBe(false)
    }
  })
})
