//! Wire container for `.pnbcert` files: an optional `PNBC` magic prefix,
//! followed by either the canonical JSON directly or a zstd-compressed frame
//! of that JSON. Compression is auto-detected from zstd's own frame magic,
//! so no version negotiation is needed between producer and verifier.
//!
//! Every certificate written before this container existed has no `PNBC`
//! prefix at all -- those files are treated as plain JSON, exactly as a raw
//! `fs::read_to_string` would have handled them, so old certificates remain
//! verifiable forever.

use crate::error::VerifyError;

const MAGIC: &[u8] = b"PNBC";
const ZSTD_FRAME_MAGIC: [u8; 4] = [0x28, 0xB5, 0x2F, 0xFD];

/// Decode raw `.pnbcert` file bytes into the canonical JSON string.
pub fn decode_certificate_bytes(bytes: &[u8]) -> Result<String, VerifyError> {
  let payload: Vec<u8> = match bytes.strip_prefix(MAGIC) {
    Some(rest) if rest.starts_with(&ZSTD_FRAME_MAGIC) => {
      zstd::decode_all(rest).map_err(|e| VerifyError::Decompress(e.to_string()))?
    }
    Some(rest) => rest.to_vec(),
    None => bytes.to_vec(),
  };
  String::from_utf8(payload)
    .map_err(|e| VerifyError::InvalidCertificate(format!("certificate is not valid UTF-8: {e}")))
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn decodes_legacy_plaintext_with_no_magic() {
    let json = r#"{"format_version":"0.1"}"#;
    assert_eq!(decode_certificate_bytes(json.as_bytes()).unwrap(), json);
  }

  #[test]
  fn decodes_magic_prefixed_plaintext() {
    let json = r#"{"format_version":"0.1"}"#;
    let mut bytes = MAGIC.to_vec();
    bytes.extend(json.as_bytes());
    assert_eq!(decode_certificate_bytes(&bytes).unwrap(), json);
  }

  #[test]
  fn decodes_magic_prefixed_zstd() {
    let json = r#"{"format_version":"0.1","nodes":[]}"#;
    let compressed = zstd::encode_all(json.as_bytes(), 3).unwrap();
    let mut bytes = MAGIC.to_vec();
    bytes.extend(compressed);
    assert_eq!(decode_certificate_bytes(&bytes).unwrap(), json);
  }

  #[test]
  fn rejects_non_utf8_payload() {
    let mut bytes = MAGIC.to_vec();
    bytes.extend([0xff, 0xfe, 0xfd]);
    assert!(decode_certificate_bytes(&bytes).is_err());
  }
}
