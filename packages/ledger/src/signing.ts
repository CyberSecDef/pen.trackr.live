import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto'
import { encode } from './cbor.js'

/**
 * Ed25519 signing over ledger checkpoints.
 *
 * @req FR-SECPL-002
 *
 * A hash chain proves that the events present have not been altered. It cannot
 * prove that no events are missing from the end (ADR 0012). A checkpoint is the
 * missing half: a signed statement that "at this moment the ledger held N
 * events whose head was H". Removing events afterwards contradicts a signature
 * the remover cannot forge.
 *
 * Checkpoints also chain to each other, so removing an inconvenient checkpoint
 * is itself detectable.
 *
 * KEY CUSTODY IS DEFERRED. This module takes keys as bytes. Storing them in the
 * OS keychain (ADR 0007) belongs with the service that has a project context to
 * scope them to, and pretending otherwise here would put key handling in the
 * wrong layer.
 */

export const CHECKPOINT_DOMAIN = 'pentrackr/checkpoint/1'

const DOMAIN_BYTES = new TextEncoder().encode(CHECKPOINT_DOMAIN)

export interface SigningKeyPair {
  /** Raw 32-byte Ed25519 private scalar, hex encoded. */
  readonly privateKey: string
  /** Raw 32-byte Ed25519 public key, hex encoded. */
  readonly publicKey: string
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function fromBase64url(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64url'))
}

function hexToBytes(hex: string, label: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new TypeError(`${label} must be 32 bytes of lowercase hex`)
  }
  return new Uint8Array(Buffer.from(hex, 'hex'))
}

export function generateSigningKeyPair(): SigningKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const priv = privateKey.export({ format: 'jwk' }) as { d?: string }
  const pub = publicKey.export({ format: 'jwk' }) as { x?: string }
  if (priv.d === undefined || pub.x === undefined) {
    throw new Error('unexpected Ed25519 key export shape')
  }
  return {
    privateKey: Buffer.from(fromBase64url(priv.d)).toString('hex'),
    publicKey: Buffer.from(fromBase64url(pub.x)).toString('hex'),
  }
}

/** Derives the public key from a private key, so a caller cannot pair them wrongly. */
export function publicKeyOf(privateKeyHex: string): string {
  const material = hexToBytes(privateKeyHex, 'private key')
  const key = createPrivateKey({
    format: 'jwk',
    key: { kty: 'OKP', crv: 'Ed25519', d: base64url(material), x: base64url(new Uint8Array(32)) },
  })
  const pub = createPublicKey(key).export({ format: 'jwk' }) as { x?: string }
  if (pub.x === undefined) throw new Error('unexpected Ed25519 key export shape')
  return Buffer.from(fromBase64url(pub.x)).toString('hex')
}

function privateKeyObject(privateKeyHex: string) {
  const material = hexToBytes(privateKeyHex, 'private key')
  return createPrivateKey({
    format: 'jwk',
    key: { kty: 'OKP', crv: 'Ed25519', d: base64url(material), x: base64url(new Uint8Array(32)) },
  })
}

function publicKeyObject(publicKeyHex: string) {
  const material = hexToBytes(publicKeyHex, 'public key')
  return createPublicKey({
    format: 'jwk',
    key: { kty: 'OKP', crv: 'Ed25519', x: base64url(material) },
  })
}

/** What a checkpoint asserts. Signed as canonical CBOR under a domain tag. */
export interface CheckpointClaim {
  readonly event_count: number
  readonly head_hash: string | null
  readonly prev_checkpoint_signature: string | null
  readonly ts_utc: string
  readonly public_key: string
}

export function checkpointPreimage(claim: CheckpointClaim): Uint8Array {
  const body = encode(claim as never)
  const out = new Uint8Array(DOMAIN_BYTES.length + body.length)
  out.set(DOMAIN_BYTES, 0)
  out.set(body, DOMAIN_BYTES.length)
  return out
}

export function signCheckpoint(claim: CheckpointClaim, privateKeyHex: string): string {
  const derived = publicKeyOf(privateKeyHex)
  if (derived !== claim.public_key) {
    // Refusing here prevents a checkpoint that verifies against a key nobody
    // holds, which would be indistinguishable from a forgery later.
    throw new TypeError('claim.public_key does not match the signing key')
  }
  const signature = sign(null, checkpointPreimage(claim), privateKeyObject(privateKeyHex))
  return signature.toString('hex')
}

export function verifyCheckpointSignature(claim: CheckpointClaim, signatureHex: string): boolean {
  if (!/^[0-9a-f]{128}$/.test(signatureHex)) return false
  try {
    return verify(
      null,
      checkpointPreimage(claim),
      publicKeyObject(claim.public_key),
      Buffer.from(signatureHex, 'hex'),
    )
  } catch {
    return false
  }
}
