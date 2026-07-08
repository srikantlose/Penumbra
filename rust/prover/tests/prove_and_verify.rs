//! End-to-end tests: prove a forced mate, serialize the certificate, then feed
//! it straight into `penumbra-verify`. A certificate the prover emits must be
//! one the verifier accepts.

use penumbra_prover::{ProofNumberSearch, ProofSearchConfig};
use penumbra_verify::CertificateVerifier;
use shakmaty::Color;

/// Prove `fen` for `side` and run the resulting certificate through the
/// verifier, returning the verifier's report.
fn prove_and_verify(
  fen: &str,
  side: Option<Color>,
) -> penumbra_verify::verifier::VerifyReport {
  let search = ProofNumberSearch::new(ProofSearchConfig::default());
  let outcome = search.prove(fen, side).expect("position parses");
  assert!(outcome.result.proven, "expected a forced win for {fen}");

  let cert = outcome.certificate.expect("proved search yields a certificate");
  let json = cert.to_json_pretty();

  let verifier = CertificateVerifier::load_from_json(&json).expect("cert loads");
  verifier.verify().expect("verification runs")
}

#[test]
fn back_rank_mate_in_one_verifies() {
  // 1.Ra8# — a lone rook delivers back-rank mate against the boxed-in king.
  let report = prove_and_verify("6k1/5ppp/8/8/8/8/8/R6K w - - 0 1", Some(Color::White));
  assert!(report.valid, "errors: {:?}", report.errors);
  assert_eq!(report.claim, "win white");
  assert!(report.terminal_count >= 1);
}

#[test]
fn morphy_mate_in_two_verifies() {
  // Morphy's celebrated study: 1.Ra6! and every black reply is mated —
  // 1...bxa6 2.b7#, otherwise the bishop must move and 2.Rxa7# follows.
  let report = prove_and_verify("kbK5/pp6/1P6/8/8/8/8/R7 w - - 0 1", Some(Color::White));
  assert!(report.valid, "errors: {:?}", report.errors);
  assert_eq!(report.claim, "win white");
  // One AND node covering all seven of black's replies, each ending in mate.
  assert_eq!(report.node_count, 16);
  assert_eq!(report.terminal_count, 7);
}

#[test]
fn two_rook_mate_in_two_verifies() {
  // Rook ladder: the king is driven to the back rank and mated on move two.
  let report = prove_and_verify("7k/8/8/8/8/8/R7/1R5K w - - 0 1", Some(Color::White));
  assert!(report.valid, "errors: {:?}", report.errors);
  assert!(report.terminal_count >= 1);
}

#[test]
fn black_can_also_be_the_claiming_side() {
  // Mirror of the back-rank mate with black to move: 1...Ra1#.
  let report = prove_and_verify("r6k/8/8/8/8/8/5PPP/6K1 b - - 0 1", Some(Color::Black));
  assert!(report.valid, "errors: {:?}", report.errors);
  assert_eq!(report.claim, "win black");
}

#[test]
fn no_certificate_for_a_dead_draw() {
  // Bare kings: insufficient material, so there is nothing to prove and no
  // certificate is produced.
  let search = ProofNumberSearch::new(ProofSearchConfig::default());
  let outcome = search
    .prove("8/8/8/8/8/8/8/K6k w - - 0 1", Some(Color::White))
    .expect("position parses");
  assert!(!outcome.result.proven);
  assert!(outcome.certificate.is_none());
}

#[test]
fn invalid_fen_is_reported() {
  let search = ProofNumberSearch::new(ProofSearchConfig::default());
  let err = search.prove("not a fen", None).unwrap_err();
  assert!(err.contains("FEN"), "unexpected error: {err}");
}
