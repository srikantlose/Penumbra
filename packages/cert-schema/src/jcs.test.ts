import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canonicalizeJSON, computeCertificateSHA256, parseHexHash, verifyCertificateIntegrity } from './jcs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');

interface HashVector {
  file: string;
  sha256: string;
}

test('canonicalizeJSON sorts object keys regardless of input order', () => {
  const a = canonicalizeJSON({ b: 1, a: 2, c: { z: 1, y: 2 } });
  const b = canonicalizeJSON({ a: 2, c: { y: 2, z: 1 }, b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":2,"b":1,"c":{"y":2,"z":1}}');
});

test('canonicalizeJSON preserves array order', () => {
  assert.equal(canonicalizeJSON({ list: [3, 1, 2] }), '{"list":[3,1,2]}');
});

test('matches the Rust verifier (rust/verifier/src/hash.rs) on every committed example certificate', () => {
  const fixturePath = join(__dirname, '..', 'test-fixtures', 'hash-vectors.json');
  const vectors: HashVector[] = JSON.parse(readFileSync(fixturePath, 'utf8'));
  assert.ok(vectors.length > 0);

  for (const v of vectors) {
    const cert = JSON.parse(readFileSync(join(repoRoot, v.file), 'utf8'));
    const hash = computeCertificateSHA256(cert);
    assert.equal(hash, v.sha256, `${v.file}: computed ${hash}, fixture declares ${v.sha256}`);
  }
});

test('verifyCertificateIntegrity accepts the correct hash and rejects a wrong one', () => {
  const fixturePath = join(__dirname, '..', 'test-fixtures', 'hash-vectors.json');
  const [first]: HashVector[] = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const cert = JSON.parse(readFileSync(join(repoRoot, first.file), 'utf8'));

  assert.equal(verifyCertificateIntegrity(cert, first.sha256), true);
  assert.equal(verifyCertificateIntegrity(cert, '0x' + '00'.repeat(32)), false);
});

test('parseHexHash decodes a 0x-prefixed hex string to bytes', () => {
  const bytes = parseHexHash('0xdeadbeef');
  assert.equal(bytes.toString('hex'), 'deadbeef');
});

test('parseHexHash rejects a string without the 0x prefix', () => {
  assert.throws(() => parseHexHash('deadbeef'));
});
