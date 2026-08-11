//! Ed25519 signature verification for certificate authenticity.
//!
//! This is a provenance check, not a soundness check: an unsigned or
//! signature-rejected certificate can still be a perfectly valid proof --
//! structural and semantic verification (`verifier.rs`/`semantic.rs`) never
//! depend on who produced a certificate, only on whether its proof tree
//! actually holds. A signature only answers "did this specific file come
//! from the holder of this specific key," which matters for a `.pnbcert`
//! handed around outside the hash-chained ledger that already gives
//! tamper-evidence for anything queried through the API.

use ring::signature::{UnparsedPublicKey, ED25519};

pub const PUBLIC_KEY_LEN: usize = 32;

/// Verifies `signature` (raw 64 bytes) over `message` against `public_key`
/// (raw 32 bytes). `message` is expected to be the certificate's own
/// `certificate_sha256(json)` hex string, UTF-8 encoded -- the same value
/// already displayed by `inspect` and stored in the ledger, so signing
/// reuses the certificate's existing identity primitive rather than a new
/// one over the raw JSON or a re-hash of it.
pub fn verify(public_key: &[u8], message: &[u8], signature: &[u8]) -> Result<(), String> {
  if public_key.len() != PUBLIC_KEY_LEN {
    return Err(format!(
      "trust key must be {PUBLIC_KEY_LEN} raw bytes, got {}",
      public_key.len()
    ));
  }
  UnparsedPublicKey::new(&ED25519, public_key)
    .verify(message, signature)
    .map_err(|_| "signature does not match the given trust key".to_string())
}

#[cfg(test)]
mod tests {
  use super::*;
  use ring::rand::{SecureRandom, SystemRandom};
  use ring::signature::{Ed25519KeyPair, KeyPair};

  fn keypair() -> ([u8; 32], Ed25519KeyPair) {
    let rng = SystemRandom::new();
    let mut seed = [0u8; 32];
    rng.fill(&mut seed).unwrap();
    let key_pair = Ed25519KeyPair::from_seed_unchecked(&seed).unwrap();
    (seed, key_pair)
  }

  #[test]
  fn verifies_a_real_signature() {
    let (_seed, key_pair) = keypair();
    let mut public_key = [0u8; PUBLIC_KEY_LEN];
    public_key.copy_from_slice(key_pair.public_key().as_ref());

    let message = b"0xabc123";
    let sig = key_pair.sign(message);

    assert!(verify(&public_key, message, sig.as_ref()).is_ok());
  }

  #[test]
  fn rejects_a_tampered_message() {
    let (_seed, key_pair) = keypair();
    let mut public_key = [0u8; PUBLIC_KEY_LEN];
    public_key.copy_from_slice(key_pair.public_key().as_ref());

    let sig = key_pair.sign(b"0xabc123");

    assert!(verify(&public_key, b"0xabc124", sig.as_ref()).is_err());
  }

  #[test]
  fn rejects_a_signature_from_a_different_key() {
    let (_seed_a, key_pair_a) = keypair();
    let (_seed_b, key_pair_b) = keypair();
    let mut public_key_b = [0u8; PUBLIC_KEY_LEN];
    public_key_b.copy_from_slice(key_pair_b.public_key().as_ref());

    let sig = key_pair_a.sign(b"0xabc123");

    assert!(verify(&public_key_b, b"0xabc123", sig.as_ref()).is_err());
  }

  #[test]
  fn rejects_wrong_length_public_key() {
    let result = verify(&[0u8; 10], b"msg", &[0u8; 64]);
    assert!(result.is_err());
  }
}
