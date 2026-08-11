//! Ed25519 signing for certificate authenticity (not soundness -- see the
//! module comment in `penumbra_verify::sign` for why this is a provenance
//! layer on top of independent verification, not a replacement for it).
//!
//! Keys are raw 32-byte seeds/public keys, not PKCS#8: this is a single-key,
//! single-tool signing setup (one "Penumbra prover identity"), so the extra
//! format complexity PKCS#8 exists for (encryption, multi-algorithm
//! containers, interop with tools that expect it) buys nothing here.

use ring::rand::{SecureRandom, SystemRandom};
use ring::signature::{Ed25519KeyPair, KeyPair};

pub const SEED_LEN: usize = 32;
pub const PUBLIC_KEY_LEN: usize = 32;
pub const SIGNATURE_LEN: usize = 64;

/// Generates a fresh Ed25519 keypair: `(seed, public_key)`, both raw bytes.
/// The seed is the private key -- keep it secret; the public key is safe to
/// publish and is what `penumbra-verify --trust-key` checks against.
pub fn generate_keypair() -> Result<([u8; SEED_LEN], [u8; PUBLIC_KEY_LEN]), String> {
  let rng = SystemRandom::new();
  let mut seed = [0u8; SEED_LEN];
  rng
    .fill(&mut seed)
    .map_err(|_| "failed to generate a random seed".to_string())?;

  let key_pair = Ed25519KeyPair::from_seed_unchecked(&seed)
    .map_err(|e| format!("failed to derive keypair from seed: {e}"))?;
  let mut public_key = [0u8; PUBLIC_KEY_LEN];
  public_key.copy_from_slice(key_pair.public_key().as_ref());

  Ok((seed, public_key))
}

/// Signs `message` with the keypair derived from `seed`, returning the raw
/// 64-byte signature. `message` is expected to be the certificate's own
/// `certificate_sha256(json)` hex string, UTF-8 encoded (see
/// `penumbra_verify::sign::verify`'s doc comment).
pub fn sign(seed: &[u8], message: &[u8]) -> Result<[u8; SIGNATURE_LEN], String> {
  let key_pair =
    Ed25519KeyPair::from_seed_unchecked(seed).map_err(|e| format!("invalid signing key: {e}"))?;
  let signature = key_pair.sign(message);
  let mut out = [0u8; SIGNATURE_LEN];
  out.copy_from_slice(signature.as_ref());
  Ok(out)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn generated_keys_are_the_expected_length() {
    let (seed, public_key) = generate_keypair().unwrap();
    assert_eq!(seed.len(), SEED_LEN);
    assert_eq!(public_key.len(), PUBLIC_KEY_LEN);
  }

  #[test]
  fn two_generated_keypairs_differ() {
    let (seed_a, pub_a) = generate_keypair().unwrap();
    let (seed_b, pub_b) = generate_keypair().unwrap();
    assert_ne!(seed_a, seed_b);
    assert_ne!(pub_a, pub_b);
  }

  #[test]
  fn sign_round_trips_through_the_verifier_crate() {
    let (seed, public_key) = generate_keypair().unwrap();
    let message = b"0xdeadbeef";
    let signature = sign(&seed, message).unwrap();

    assert!(penumbra_verify::sign::verify(&public_key, message, &signature).is_ok());
  }

  #[test]
  fn sign_is_deterministic() {
    let (seed, _public_key) = generate_keypair().unwrap();
    let a = sign(&seed, b"same message").unwrap();
    let b = sign(&seed, b"same message").unwrap();
    assert_eq!(a, b);
  }
}
