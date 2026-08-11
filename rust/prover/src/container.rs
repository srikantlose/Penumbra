//! Wire container for `.pnbcert` files written to disk: a `PNBC` magic
//! prefix, an optional `SIG1` signature sub-block, then the canonical JSON,
//! optionally zstd-compressed.
//!
//! Mirrors the decoder in `penumbra-verify`; kept as a small standalone
//! implementation here rather than a shared dependency. The prover does
//! depend on `penumbra-verify` now, but only for `certificate_sha256` (see
//! `crate::sign`) -- the prover and verifier's actual verification logic
//! stays independent of each other.

const MAGIC: &[u8] = b"PNBC";
const SIG_TAG: &[u8] = b"SIG1";
const ED25519_ALG_ID: u8 = 1;

/// Encode `json` as a `.pnbcert` container: `PNBC`, an optional `SIG1`
/// signature block, then the JSON bytes (zstd-compressed when `compress` is
/// set). `signature`, when given, must be a raw 64-byte Ed25519 signature
/// over `certificate_sha256(json)` -- see `crate::sign::sign`.
pub fn encode_certificate_container(
  json: &str,
  compress: bool,
  signature: Option<&[u8]>,
) -> std::io::Result<Vec<u8>> {
  let mut out = MAGIC.to_vec();
  if let Some(sig) = signature {
    out.extend(SIG_TAG);
    out.push(ED25519_ALG_ID);
    out.extend(sig);
  }
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
    let bytes = encode_certificate_container(json, false, None).unwrap();
    let decoded = penumbra_verify::decode_certificate_bytes(&bytes).unwrap();
    assert_eq!(decoded.json, json);
    assert!(decoded.signature.is_none());
  }

  #[test]
  fn compressed_container_round_trips_via_verifier_decoder() {
    let json = r#"{"format_version":"0.1","nodes":[]}"#;
    let bytes = encode_certificate_container(json, true, None).unwrap();
    let decoded = penumbra_verify::decode_certificate_bytes(&bytes).unwrap();
    assert_eq!(decoded.json, json);
    assert!(decoded.signature.is_none());
  }

  #[test]
  fn signed_container_round_trips_and_verifies() {
    let json = r#"{"format_version":"0.1"}"#;
    let (seed, public_key) = crate::sign::generate_keypair().unwrap();
    let sha256 = penumbra_verify::certificate_sha256(json).unwrap();
    let signature = crate::sign::sign(&seed, sha256.as_bytes()).unwrap();

    let bytes = encode_certificate_container(json, false, Some(&signature)).unwrap();
    let decoded = penumbra_verify::decode_certificate_bytes(&bytes).unwrap();

    assert_eq!(decoded.json, json);
    let carried_sig = decoded.signature.expect("signature present");
    assert!(penumbra_verify::sign::verify(&public_key, sha256.as_bytes(), &carried_sig).is_ok());
  }

  #[test]
  fn signed_compressed_container_round_trips_and_verifies() {
    let json = r#"{"format_version":"0.1","nodes":[]}"#;
    let (seed, public_key) = crate::sign::generate_keypair().unwrap();
    let sha256 = penumbra_verify::certificate_sha256(json).unwrap();
    let signature = crate::sign::sign(&seed, sha256.as_bytes()).unwrap();

    let bytes = encode_certificate_container(json, true, Some(&signature)).unwrap();
    let decoded = penumbra_verify::decode_certificate_bytes(&bytes).unwrap();

    assert_eq!(decoded.json, json);
    let carried_sig = decoded.signature.expect("signature present");
    assert!(penumbra_verify::sign::verify(&public_key, sha256.as_bytes(), &carried_sig).is_ok());
  }
}
