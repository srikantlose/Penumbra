//! Cross-implementation check: packages/cert-schema's TypeScript RFC 8785
//! canonicalizer and this crate's `hash::certificate_sha256` must agree on
//! every certificate's identity hash. Both `jcs.test.ts` and this file load
//! the same fixture -- if either implementation drifts, one of the two
//! suites fails.

use penumbra_verify::certificate_sha256;
use serde::Deserialize;

#[derive(Deserialize)]
struct HashVector {
  file: String,
  sha256: String,
}

#[test]
fn matches_committed_cert_schema_hash_vectors() {
  let json = std::fs::read_to_string("../../packages/cert-schema/test-fixtures/hash-vectors.json")
    .expect("fixture should exist");
  let vectors: Vec<HashVector> = serde_json::from_str(&json).expect("fixture should be valid json");

  assert!(!vectors.is_empty());

  for v in &vectors {
    let cert_path = format!("../../{}", v.file);
    let cert_json = std::fs::read_to_string(&cert_path)
      .unwrap_or_else(|e| panic!("{}: could not read {cert_path}: {e}", v.file));

    let hash = certificate_sha256(&cert_json)
      .unwrap_or_else(|e| panic!("{}: certificate_sha256 failed: {e}", v.file));

    assert_eq!(
      hash, v.sha256,
      "{}: computed {}, fixture declares {}",
      v.file, hash, v.sha256
    );
  }
}
