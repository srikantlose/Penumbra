//! End-to-end fortress round-trips: prove an `at_least_draw` claim, serialize
//! the certificate, then feed it into `penumbra-verify` with a real Syzygy
//! source configured. Guarded on the tablebases actually being present on
//! disk (`node scripts/fetch-syzygy.mjs`, ~1 GB, not part of the repo or CI)
//! -- these tests skip rather than fail when they're absent, same as any
//! other environment-dependent integration test.

use std::path::{Path, PathBuf};

use penumbra_prover::{ClaimValue, ProofNumberSearch, ProofSearchConfig};
use penumbra_verify::verifier::{TablebasePolicy, VerifyOptions};
use penumbra_verify::CertificateVerifier;
use shakmaty::Color;

fn tablebases_dir() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tablebases/syzygy/3-4-5")
}

/// Proves `fen` as `at_least_draw` for `side`, then verifies the resulting
/// certificate with `TablebasePolicy::Syzygy` pointed at the real tables.
/// Returns `None` if the tables aren't present (caller should skip).
fn prove_and_verify_with_syzygy(
  fen: &str,
  side: Color,
) -> Option<penumbra_verify::verifier::VerifyReport> {
  let dir = tablebases_dir();
  if !dir.exists() {
    eprintln!("skipping: no tablebases at {}", dir.display());
    return None;
  }

  let config = ProofSearchConfig {
    claim: ClaimValue::AtLeastDraw,
    tablebase_path: Some(dir.display().to_string()),
    ..ProofSearchConfig::default()
  };
  let search = ProofNumberSearch::new(config);
  let outcome = search.prove(fen, Some(side)).expect("position parses");
  assert!(
    outcome.result.proven,
    "expected at_least_draw to hold for {fen}"
  );

  let cert = outcome
    .certificate
    .expect("proved search yields a certificate");
  let json = cert.to_json_pretty();

  let verifier = CertificateVerifier::load_from_json(&json).expect("cert loads");
  let opts = VerifyOptions {
    semantic: true,
    tb: TablebasePolicy::Syzygy(dir),
  };
  Some(verifier.verify_with(&opts).expect("verification runs"))
}

#[test]
fn kpvk_dead_draw_verifies_with_syzygy() {
  // Black king directly in front of the pawn: the textbook dead draw.
  // https://tablebase.lichess.ovh/standard?fen=8/8/8/8/8/2k5/2P5/2K5%20b%20-%20-%200%201
  // confirms category=draw.
  let Some(report) = prove_and_verify_with_syzygy("8/8/8/8/8/2k5/2P5/2K5 b - - 0 1", Color::Black)
  else {
    return;
  };
  assert!(report.valid, "errors: {:?}", report.errors);
  assert_eq!(report.claim, "at_least_draw black");
  assert!(report.probe_count >= 1);
}

#[test]
fn kpvk_dead_draw_rejected_without_syzygy() {
  // The same certificate must fail closed when no tablebase source is
  // configured -- soundness by default (Forbid, not Assume).
  let dir = tablebases_dir();
  if !dir.exists() {
    eprintln!("skipping: no tablebases at {}", dir.display());
    return;
  }

  let config = ProofSearchConfig {
    claim: ClaimValue::AtLeastDraw,
    tablebase_path: Some(dir.display().to_string()),
    ..ProofSearchConfig::default()
  };
  let search = ProofNumberSearch::new(config);
  let outcome = search
    .prove("8/8/8/8/8/2k5/2P5/2K5 b - - 0 1", Some(Color::Black))
    .expect("position parses");
  let cert = outcome.certificate.expect("proved");
  let json = cert.to_json_pretty();

  let verifier = CertificateVerifier::load_from_json(&json).expect("cert loads");
  let report = verifier.verify().expect("verification runs");
  assert!(!report.valid);
  assert!(report
    .errors
    .iter()
    .any(|e| e.contains("no tablebase source is configured")));
}
