import crypto from 'crypto';
import canonicalize from 'canonicalize';

/**
 * RFC 8785 (JSON Canonicalization Scheme) serialization. Certificate
 * identity is defined as SHA256 of this output, so it must be byte-for-byte
 * identical to what the Rust verifier computes (see
 * `rust/verifier/src/hash.rs`, which re-serializes a parsed `serde_json::Value`
 * -- key-sorted by construction -- rather than implementing JCS itself).
 *
 * v0.1 certificates only ever contain ASCII strings and integers, where
 * JCS's number/string canonicalization rules are trivially satisfied by any
 * sensible serializer; this restriction (documented in
 * docs/CERTIFICATE_FORMAT.md) is what lets two independently-written
 * canonicalizers agree without both implementing the full ECMAScript
 * number-formatting algorithm RFC 8785 mandates for the general case.
 */
export function canonicalizeJSON(obj: unknown): string {
  const result = canonicalize(obj);
  if (result === undefined) {
    throw new Error('Cannot canonicalize a value that serializes to undefined');
  }
  return result;
}

export function computeCertificateSHA256(cert: unknown): string {
  const canonical = canonicalizeJSON(cert);
  const hash = crypto.createHash('sha256').update(canonical).digest('hex');
  return '0x' + hash;
}

export function verifyCertificateIntegrity(cert: unknown, expectedHash: string): boolean {
  const computed = computeCertificateSHA256(cert);
  return computed === expectedHash;
}

export function parseHexHash(hex: string): Buffer {
  if (!hex.startsWith('0x')) {
    throw new Error('Hash must be hex string starting with 0x');
  }
  return Buffer.from(hex.slice(2), 'hex');
}
