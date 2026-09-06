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

/**
 * Regression tests for a key-import defect found by running on a newer Node.
 *
 * The private key was imported as a JWK OKP pair with 32 zero bytes standing in
 * for the public half we do not hold — a key object asserting a public key that
 * is not its own. Node 22 accepted it and Node 26 rejects it, which is the
 * correct behaviour of the two. Nineteen tests failed there while all passed
 * here, so this class of defect is invisible to a single-version test matrix.
 */
describe('private keys are imported without inventing a public half', () => {
  it('derives the same public key an independent generation produces', () => {
    // Passed even with the placeholder, because Node 22 ignored the bogus x.
    // Kept because it is still the property that must hold.
    const pair = generateSigningKeyPair()
    expect(publicKeyOf(pair.privateKey)).toBe(pair.publicKey)
  })

  it('produces signatures that verify under the derived public key', () => {
    const pair = generateSigningKeyPair()
    const signed = claim({ event_count: 1, public_key: publicKeyOf(pair.privateKey) })
    expect(verifyCheckpointSignature(signed, signCheckpoint(signed, pair.privateKey))).toBe(true)
  })

  it('round-trips an arbitrary seed rather than only generated ones', () => {
    // A seed we chose, not one Node produced, so the import path is exercised
    // on material that never existed as a KeyObject.
    const seed = 'ab'.repeat(32)
    expect(publicKeyOf(seed)).toMatch(/^[0-9a-f]{64}$/)
    expect(publicKeyOf(seed)).toBe(publicKeyOf(seed))
  })

  it('rejects a seed of the wrong length rather than padding it', () => {
    expect(() => publicKeyOf('ab'.repeat(16))).toThrow(TypeError)
  })
})
