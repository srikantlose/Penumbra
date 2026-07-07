use penumbra_verify::CertificateVerifier;

fn load(path: &str) -> String {
  std::fs::read_to_string(path).expect("fixture should exist")
}

#[test]
fn golden_kqpk_verifies_clean() {
  let json = load("tests/golden/kqpk.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier.verify().expect("verify should not error");

  assert!(report.valid, "expected valid certificate, got errors: {:?}", report.errors);
  assert!(report.errors.is_empty());
  assert_eq!(report.node_count, 9);
  assert_eq!(report.terminal_count, 7);
  assert_eq!(report.claim, "win white");
}

#[test]
fn mutation_missing_child_node_fails() {
  let json = load("tests/mutations/missing_child_node.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier.verify().expect("verify should not error");

  assert!(!report.valid);
  assert!(report.errors.iter().any(|e| e.contains("Missing child node")));
}

#[test]
fn mutation_cycle_in_win_fails() {
  let json = load("tests/mutations/cycle_in_win.json");
  let verifier = CertificateVerifier::load_from_json(&json).expect("valid json");
  let report = verifier.verify().expect("verify should not error");

  assert!(!report.valid);
  assert!(report.errors.iter().any(|e| e.contains("Acyclic check failed")));
}

#[test]
fn rejects_unsupported_format_version() {
  let json = load("tests/golden/kqpk.json").replace("\"0.1\"", "\"9.9\"");
  let result = CertificateVerifier::load_from_json(&json);

  assert!(result.is_err());
}
