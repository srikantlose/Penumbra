use std::path::{Path, PathBuf};

use penumbra_verify::{CertificateVerifier, TablebasePolicy, VerifyOptions};

fn load(path: &str) -> String {
  std::fs::read_to_string(path).expect("fixture should exist")
}

fn structural_only() -> VerifyOptions {
  VerifyOptions {
    semantic: false,
    tb: TablebasePolicy::Forbid,
  }
}

fn syzygy_dir() -> PathBuf {
  Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tablebases/syzygy/3-4-5")
}

/// The kqpk fixture predates semantic verification: its zobrists and moves
/// are hand-faked placeholders that only ever needed to *look* right. It
/// still exercises the structural checks (shape, coverage bookkeeping,
/// acyclicity) that don't require a real position to replay.
#[test]
fn golden_kqpk_passes_structural_checks() {
  let json = load("tests/golden/kqpk.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier
    .verify_with(&structural_only())
    .expect("verify should not error");

  assert!(
    report.valid,
    "expected valid certificate, got errors: {:?}",
    report.errors
  );
  assert!(report.errors.is_empty());
  assert_eq!(report.node_count, 9);
  assert_eq!(report.terminal_count, 7);
  assert_eq!(report.claim, "win white");
}

/// The honest counterpart to the above: the same fixture is not a real
/// proof (its zobrists don't correspond to the FEN, and none of its moves
/// were ever legally played), so the default, sound `verify()` must reject
/// it. This is the correct outcome, not a regression.
#[test]
fn golden_kqpk_fails_semantic_checks() {
  let json = load("tests/golden/kqpk.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier.verify().expect("verify should not error");

  assert!(!report.valid);
  assert!(!report.errors.is_empty());
}

#[test]
fn golden_backrank_mate_in_one_passes_semantic_checks() {
  let json = load("tests/golden/backrank_mate_in_1.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier.verify().expect("verify should not error");

  assert!(
    report.valid,
    "expected valid certificate, got errors: {:?}",
    report.errors
  );
  assert_eq!(report.claim, "win white");
}

#[test]
fn golden_morphy_mate_in_two_passes_semantic_checks() {
  let json = load("tests/golden/morphy_mate_in_2.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier.verify().expect("verify should not error");

  assert!(
    report.valid,
    "expected valid certificate, got errors: {:?}",
    report.errors
  );
  assert_eq!(report.node_count, 16);
  assert_eq!(report.terminal_count, 7);
}

#[test]
fn mutation_missing_child_node_fails() {
  let json = load("tests/mutations/missing_child_node.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier.verify().expect("verify should not error");

  assert!(!report.valid);
  assert!(report
    .errors
    .iter()
    .any(|e| e.contains("Missing child node")));
}

#[test]
fn mutation_cycle_in_win_fails() {
  let json = load("tests/mutations/cycle_in_win.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier.verify().expect("verify should not error");

  assert!(!report.valid);
  assert!(report
    .errors
    .iter()
    .any(|e| e.contains("Acyclic check failed")));
}

#[test]
fn mutation_illegal_uci_fails_semantic_check() {
  let json = load("tests/mutations/illegal_uci.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier.verify().expect("verify should not error");

  assert!(!report.valid);
  assert!(
    report
      .errors
      .iter()
      .any(|e| e.contains("illegal in the replayed position")),
    "{:?}",
    report.errors
  );
}

#[test]
fn mutation_missing_and_branch_fails_coverage_check() {
  let json = load("tests/mutations/missing_and_branch.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier.verify().expect("verify should not error");

  assert!(!report.valid);
  assert!(
    report
      .errors
      .iter()
      .any(|e| e.contains("missing AND-node coverage")),
    "{:?}",
    report.errors
  );
}

#[test]
fn mutation_wrong_node_zobrist_fails_semantic_check() {
  let json = load("tests/mutations/wrong_node_zobrist.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier.verify().expect("verify should not error");

  assert!(!report.valid);
  assert!(
    report.errors.iter().any(|e| e.contains("zobrist mismatch")),
    "{:?}",
    report.errors
  );
}

#[test]
fn mutation_fake_checkmate_terminal_fails_semantic_check() {
  let json = load("tests/mutations/fake_checkmate_terminal.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier.verify().expect("verify should not error");

  assert!(!report.valid);
  assert!(
    report.errors.iter().any(|e| e.contains("not checkmate")),
    "{:?}",
    report.errors
  );
}

#[test]
fn structural_only_mode_skips_semantic_errors() {
  // The same fake-checkmate fixture passes when semantic replay is turned
  // off — structural-only mode is explicitly weaker, by design.
  let json = load("tests/mutations/fake_checkmate_terminal.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier
    .verify_with(&structural_only())
    .expect("verify should not error");

  assert!(
    report.valid,
    "expected valid certificate, got errors: {:?}",
    report.errors
  );
}

#[test]
fn rejects_unsupported_format_version() {
  let json = load("tests/golden/kqpk.json").replace("\"0.1\"", "\"9.9\"");
  let result = CertificateVerifier::load_from_json(&json);

  assert!(result.is_err());
}

/// A real `at_least_draw` certificate (KPvK, defender's king holding the
/// square directly in front of the pawn -- confirmed `category: draw` at
/// https://tablebase.lichess.ovh/standard?fen=8/8/8/8/8/2k5/2P5/2K5%20b%20-%20-%200%201),
/// produced by `penumbra-prove --claim at_least_draw --syzygy`. Skips if the
/// tablebases (~1 GB, not part of the repo) aren't present on disk.
#[test]
fn golden_kpvk_fortress_draw_verifies_with_syzygy() {
  let dir = syzygy_dir();
  if !dir.exists() {
    eprintln!("skipping: no tablebases at {}", dir.display());
    return;
  }

  let json = load("tests/golden/kpvk_fortress_draw.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier
    .verify_with(&VerifyOptions {
      semantic: true,
      tb: TablebasePolicy::Syzygy(dir),
    })
    .expect("verify should not error");

  assert!(report.valid, "errors: {:?}", report.errors);
  assert_eq!(report.claim, "at_least_draw black");
  assert!(report.probe_count >= 1);
}

/// Same fixture with the terminal's declared value flipped from `draw` to
/// `win`. A real Syzygy probe must catch the lie.
#[test]
fn mutation_tablebase_value_flip_fails_with_syzygy() {
  let dir = syzygy_dir();
  if !dir.exists() {
    eprintln!("skipping: no tablebases at {}", dir.display());
    return;
  }

  let json = load("tests/mutations/tablebase_value_flip.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier
    .verify_with(&VerifyOptions {
      semantic: true,
      tb: TablebasePolicy::Syzygy(dir),
    })
    .expect("verify should not error");

  assert!(!report.valid);
  assert!(
    report
      .errors
      .iter()
      .any(|e| e.contains("tablebase probe failed") && e.contains("declares value")),
    "{:?}",
    report.errors
  );
}
