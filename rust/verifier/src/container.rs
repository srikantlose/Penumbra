//! Wire container for `.pnbcert` files: an optional `PNBC` magic prefix,
//! an optional `SIG1` signature sub-block, then either the canonical JSON
//! directly or a zstd-compressed frame of that JSON. Compression is
//! auto-detected from zstd's own frame magic, so no version negotiation is
//! needed between producer and verifier.
//!
//! Every certificate written before this container existed has no `PNBC`
//! prefix at all -- those files are treated as plain JSON, exactly as a raw
//! `fs::read_to_string` would have handled them, so old certificates remain
//! verifiable forever. Certificates written before the `SIG1` sub-block
//! existed have `PNBC` but no `SIG1` -- those decode with `signature: None`,
//! same as an unsigned certificate written today.
//!
//! Deliberately not stored in `SIG1`: the public key. If the container
//! carried its own public key, anyone could re-sign a tampered certificate
//! with a freshly generated keypair and it would "verify" against itself --
//! that proves nothing. The trusted public key has to come from outside the
//! file (the verifier's `--trust-key` flag), not from the file it's meant to
//! authenticate.

use crate::error::VerifyError;

const MAGIC: &[u8] = b"PNBC";
const ZSTD_FRAME_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];

const SIG_TAG: &[u8] = b"SIG1";
pub const ED25519_ALG_ID: u8 = 1;
pub const ED25519_SIGNATURE_LEN: usize = 64;

/// A certificate's canonical JSON plus, if the container had a `SIG1` block,
/// the raw signature bytes over `certificate_sha256(json)`. The caller is
/// responsible for actually checking it against a trusted public key --
/// decoding never does that on its own, since decoding doesn't know which
/// key should be trusted.
pub struct DecodedCertificate {
  pub json: String,
  pub signature: Option<Vec<u8>>,
}

/// Decode raw `.pnbcert` file bytes into the canonical JSON string plus an
/// optional signature.
pub fn decode_certificate_bytes(bytes: &[u8]) -> Result<DecodedCertificate, VerifyError> {
  let Some(after_magic) = bytes.strip_prefix(MAGIC) else {
    let json = String::from_utf8(bytes.to_vec()).map_err(|e| {
      VerifyError::InvalidCertificate(format!("certificate is not valid UTF-8: {e}"))
    })?;
    return Ok(DecodedCertificate {
      json,
      signature: None,
    });
  };

  let (signature, rest) = match after_magic.strip_prefix(SIG_TAG) {
    Some(after_tag) => {
      if after_tag.is_empty() {
        return Err(VerifyError::InvalidCertificate(
          "truncated SIG1 block: missing algorithm id".to_string(),
        ));
      }
      let (alg_id, after_alg) = (after_tag[0], &after_tag[1..]);
      if alg_id != ED25519_ALG_ID {
        return Err(VerifyError::InvalidCertificate(format!(
          "unknown signature algorithm id {alg_id}"
        )));
      }
      if after_alg.len() < ED25519_SIGNATURE_LEN {
        return Err(VerifyError::InvalidCertificate(
          "truncated SIG1 block: signature shorter than expected".to_string(),
        ));
      }
      let (sig_bytes, rest) = after_alg.split_at(ED25519_SIGNATURE_LEN);
      (Some(sig_bytes.to_vec()), rest)
    }
    None => (None, after_magic),
  };

  let payload: Vec<u8> = if rest.starts_with(&ZSTD_FRAME_MAGIC) {
    zstd::decode_all(rest).map_err(|e| VerifyError::Decompress(e.to_string()))?
  } else {
    rest.to_vec()
  };
  let json = String::from_utf8(payload)
    .map_err(|e| VerifyError::InvalidCertificate(format!("certificate is not valid UTF-8: {e}")))?;

  Ok(DecodedCertificate { json, signature })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn decodes_legacy_plaintext_with_no_magic() {
    let json = r#"{"format_version":"0.1"}"#;
    let decoded = decode_certificate_bytes(json.as_bytes()).unwrap();
    assert_eq!(decoded.json, json);
    assert!(decoded.signature.is_none());
  }

  #[test]
  fn decodes_magic_prefixed_plaintext() {
    let json = r#"{"format_version":"0.1"}"#;
    let mut bytes = MAGIC.to_vec();
    bytes.extend(json.as_bytes());
    let decoded = decode_certificate_bytes(&bytes).unwrap();
    assert_eq!(decoded.json, json);
    assert!(decoded.signature.is_none());
  }

  #[test]
  fn decodes_magic_prefixed_zstd() {
    let json = r#"{"format_version":"0.1","nodes":[]}"#;
    let compressed = zstd::encode_all(json.as_bytes(), 3).unwrap();
    let mut bytes = MAGIC.to_vec();
    bytes.extend(compressed);
    let decoded = decode_certificate_bytes(&bytes).unwrap();
    assert_eq!(decoded.json, json);
    assert!(decoded.signature.is_none());
  }

  #[test]
  fn decodes_signed_plaintext() {
    let json = r#"{"format_version":"0.1"}"#;
    let sig = vec![0xAB; ED25519_SIGNATURE_LEN];
    let mut bytes = MAGIC.to_vec();
    bytes.extend(SIG_TAG);
    bytes.push(ED25519_ALG_ID);
    bytes.extend(&sig);
    bytes.extend(json.as_bytes());
    let decoded = decode_certificate_bytes(&bytes).unwrap();
    assert_eq!(decoded.json, json);
    assert_eq!(decoded.signature, Some(sig));
  }

  #[test]
  fn decodes_signed_zstd() {
    let json = r#"{"format_version":"0.1","nodes":[]}"#;
    let sig = vec![0xCD; ED25519_SIGNATURE_LEN];
    let compressed = zstd::encode_all(json.as_bytes(), 3).unwrap();
    let mut bytes = MAGIC.to_vec();
    bytes.extend(SIG_TAG);
    bytes.push(ED25519_ALG_ID);
    bytes.extend(&sig);
    bytes.extend(compressed);
    let decoded = decode_certificate_bytes(&bytes).unwrap();
    assert_eq!(decoded.json, json);
    assert_eq!(decoded.signature, Some(sig));
  }

  #[test]
  fn rejects_unknown_signature_algorithm() {
    let mut bytes = MAGIC.to_vec();
    bytes.extend(SIG_TAG);
    bytes.push(99);
    bytes.extend(vec![0u8; ED25519_SIGNATURE_LEN]);
    bytes.extend(b"{}");
    assert!(decode_certificate_bytes(&bytes).is_err());
  }

  #[test]
  fn rejects_truncated_signature() {
    let mut bytes = MAGIC.to_vec();
    bytes.extend(SIG_TAG);
    bytes.push(ED25519_ALG_ID);
    bytes.extend(vec![0u8; 10]); // way short of ED25519_SIGNATURE_LEN
    assert!(decode_certificate_bytes(&bytes).is_err());
  }

  #[test]
  fn rejects_non_utf8_payload() {
    let mut bytes = MAGIC.to_vec();
    bytes.extend([0xff, 0xfe, 0xfd]);
    assert!(decode_certificate_bytes(&bytes).is_err());
  }
}
