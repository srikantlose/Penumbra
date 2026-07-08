//! Certificate identity: `SHA256(canonical_json)`, per
//! `docs/CERTIFICATE_FORMAT.md`. Canonical form is RFC 8785 (JSON
//! Canonicalization Scheme, JCS).
//!
//! This does not implement JCS in general -- it relies on a narrower fact
//! that holds for every v0.1 certificate: `serde_json::Value`'s object type
//! is a `BTreeMap` by default (this crate never enables the `preserve_order`
//! feature), so re-serializing a parsed `Value` naturally produces
//! alphabetically-sorted keys with minimal separators. Combined with the
//! ASCII-string-and-integer-only restriction enforced by
//! `check_value_domain` below, that re-serialization is byte-identical to
//! full JCS -- the only cases JCS handles differently (non-integer number
//! formatting, non-ASCII string escaping) are exactly the cases this
//! function refuses to hash. The TypeScript side
//! (`packages/cert-schema/src/jcs.ts`) uses a real JCS library instead,
//! since it has no equivalent "the map already sorts itself" shortcut
//! available; `zobrist_vectors.rs`-style cross-implementation fixtures
//! (`packages/cert-schema/test-fixtures/hash-vectors.json`) assert the two
//! agree.

use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::error::VerifyError;

pub fn certificate_sha256(raw_json: &str) -> Result<String, VerifyError> {
  let value: Value = serde_json::from_str(raw_json).map_err(VerifyError::Json)?;
  check_value_domain(&value)?;

  let canonical = serde_json::to_string(&value).map_err(VerifyError::Json)?;
  let digest = Sha256::digest(canonical.as_bytes());
  Ok(format!("0x{digest:x}"))
}

/// v0.1 certificates only ever contain ASCII strings and integers. Floats
/// and non-ASCII strings are rejected rather than hashed, since those are
/// exactly the cases where "re-serialize a parsed Value" and "implement
/// RFC 8785" could disagree.
fn check_value_domain(value: &Value) -> Result<(), VerifyError> {
  match value {
    Value::Null | Value::Bool(_) => Ok(()),
    Value::Number(n) => {
      if n.is_f64() {
        Err(VerifyError::InvalidCertificate(format!(
          "certificate contains a non-integer number ({n}); only ASCII strings and integers are in the canonical value domain"
        )))
      } else {
        Ok(())
      }
    }
    Value::String(s) => {
      if s.is_ascii() {
        Ok(())
      } else {
        Err(VerifyError::InvalidCertificate(format!(
          "certificate contains a non-ASCII string ({s:?}); only ASCII strings and integers are in the canonical value domain"
        )))
      }
    }
    Value::Array(items) => items.iter().try_for_each(check_value_domain),
    Value::Object(map) => map.values().try_for_each(check_value_domain),
  }
}
