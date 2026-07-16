//! Wire container for `.pnbcert` files written to disk: a `PNBC` magic
//! prefix followed by the canonical JSON, optionally zstd-compressed.
//!
//! Mirrors the decoder in `penumbra-verify`; kept as a small standalone
//! implementation here rather than a shared dependency, since the prover and
//! verifier are otherwise independent of each other.

const MAGIC: &[u8] = b"PNBC";

/// Encode `json` as a `.pnbcert` container: `PNBC` followed by the JSON
/// bytes, zstd-compressed when `compress` is set.
pub fn encode_certificate_container(json: &str, compress: bool) -> std::io::Result<Vec<u8>> {
  let mut out = MAGIC.to_vec();
  if compress {
    out.extend(zstd::encode_all(
      json.as_bytes(),
      zstd::DEFAULT_COMPRESSION_LEVEL,
    )?);
  } else {
    out.extend(json.as_bytes());
  }
  Ok(out)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn plaintext_container_round_trips_via_verifier_decoder() {
    let json = r#"{"format_version":"0.1"}"#;
    let bytes = encode_certificate_container(json, false).unwrap();
    assert_eq!(
      penumbra_verify::decode_certificate_bytes(&bytes).unwrap(),
      json
    );
  }

  #[test]
  fn compressed_container_round_trips_via_verifier_decoder() {
    let json = r#"{"format_version":"0.1","nodes":[]}"#;
    let bytes = encode_certificate_container(json, true).unwrap();
    assert_eq!(
      penumbra_verify::decode_certificate_bytes(&bytes).unwrap(),
      json
    );
  }
}
