use crate::error::VerifyError;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateMetadata {
  pub producer: String,
  pub timestamp: String,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub contributors: Option<Vec<String>>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub work_units: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateNode {
  pub id: String,
  pub zobrist: String,
  pub to_move: String,
  pub kind: String,
  #[serde(default)]
  pub moves: Vec<CertificateMove>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub terminal: Option<CertificateTerminal>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateMove {
  pub uci: String,
  pub child_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateTerminal {
  #[serde(rename = "type")]
  pub terminal_type: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub value: Option<String>,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub dtm: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Certificate {
  pub format_version: String,
  pub claim: CertificateClaim,
  pub rules: String,
  pub root_id: String,
  pub nodes: Vec<CertificateNode>,
  pub dependencies: CertificateDependencies,
  pub metadata: CertificateMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateClaim {
  pub fen: String,
  pub zobrist: String,
  pub value: String,
  pub side: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateDependencies {
  #[serde(skip_serializing_if = "Option::is_none")]
  pub tablebase: Option<String>,
}

/// How the verifier should treat `tablebase` terminals.
///
/// `Forbid` (the default) is the sound choice: a certificate that leans on a
/// tablebase claim without a configured source is rejected rather than
/// trusted. `Assume` exists for inspecting/debugging certs before a real
/// tablebase is wired up. `Syzygy` actually probes the loaded tables and
/// checks the result against the terminal's declared value. `Endpoint`
/// probes a Lichess-compatible tablebase HTTP API instead of local files --
/// same soundness check, at the cost of trusting the remote service and
/// needing network access at verify time.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum TablebasePolicy {
  #[default]
  Forbid,
  Assume,
  Syzygy(PathBuf),
  Endpoint(String),
}

#[derive(Debug, Clone)]
pub struct VerifyOptions {
  /// Replay moves against the claimed FEN and check legality, AND-node
  /// coverage, and terminal truthfulness. Default on; the sound mode.
  pub semantic: bool,
  pub tb: TablebasePolicy,
}

impl Default for VerifyOptions {
  fn default() -> Self {
    VerifyOptions {
      semantic: true,
      tb: TablebasePolicy::Forbid,
    }
  }
}

pub struct VerifyReport {
  pub valid: bool,
  pub claim: String,
  pub node_count: usize,
  pub terminal_count: usize,
  pub probe_count: usize,
  /// Tablebase terminals accepted on faith under `TablebasePolicy::Assume`
  /// rather than actually probed. Nonzero means the report's validity is
  /// conditional on those claims being true.
  pub assumed_probes: usize,
  /// Whether the semantic (move-replay) pass ran.
  pub semantic: bool,
  /// `0x` + 64 lowercase hex: `SHA256(canonical_json)`, the certificate's
  /// identity per `docs/CERTIFICATE_FORMAT.md`. Empty if the certificate's
  /// JSON falls outside v0.1's canonical value domain (see
  /// `hash::certificate_sha256`) -- that failure is also pushed into
  /// `errors`, since an uncanonicalizable certificate has no well-defined
  /// identity.
  pub sha256: String,
  pub elapsed_ms: u128,
  pub errors: Vec<String>,
}

pub struct CertificateVerifier {
  pub(crate) certificate: Certificate,
  pub(crate) nodes_by_id: HashMap<String, CertificateNode>,
  raw_json: String,
}

impl CertificateVerifier {
  pub fn load_from_json(json: &str) -> Result<Self, VerifyError> {
    let certificate: Certificate = serde_json::from_str(json).map_err(VerifyError::Json)?;

    if certificate.format_version != crate::FORMAT_VERSION {
      return Err(VerifyError::UnsupportedFormatVersion(
        certificate.format_version,
      ));
    }

    let mut nodes_by_id = HashMap::new();
    for node in &certificate.nodes {
      nodes_by_id.insert(node.id.clone(), node.clone());
    }

    Ok(CertificateVerifier {
      certificate,
      nodes_by_id,
      raw_json: json.to_string(),
    })
  }

  /// Verify with the default options: semantic replay on, tablebase
  /// terminals forbidden unless a source is configured. This is the sound
  /// default — use `verify_with` to opt into structural-only or
  /// assumed-tablebase modes.
  pub fn verify(&self) -> Result<VerifyReport, VerifyError> {
    self.verify_with(&VerifyOptions::default())
  }

  pub fn verify_with(&self, opts: &VerifyOptions) -> Result<VerifyReport, VerifyError> {
    let start = std::time::Instant::now();

    let _root_node = self
      .nodes_by_id
      .get(&self.certificate.root_id)
      .ok_or_else(|| VerifyError::InvalidCertificate("root node not found".to_string()))?;

    let mut report = VerifyReport {
      valid: false,
      claim: format!(
        "{} {}",
        self.certificate.claim.value, self.certificate.claim.side
      ),
      node_count: self.certificate.nodes.len(),
      terminal_count: 0,
      probe_count: 0,
      assumed_probes: 0,
      semantic: opts.semantic,
      sha256: String::new(),
      elapsed_ms: 0,
      errors: vec![],
    };

    match crate::hash::certificate_sha256(&self.raw_json) {
      Ok(sha256) => report.sha256 = sha256,
      Err(e) => report.errors.push(e.to_string()),
    }

    // Count terminals
    for node in &self.certificate.nodes {
      if node.kind == "terminal" {
        report.terminal_count += 1;
      }
    }

    // Basic structural checks
    if self.certificate.rules != "standard" {
      report.errors.push("Unsupported rules set".to_string());
    }

    if !is_valid_zobrist(&self.certificate.claim.zobrist) {
      report
        .errors
        .push("Invalid zobrist hash in claim".to_string());
    }

    if !["win", "at_least_draw"].contains(&self.certificate.claim.value.as_str()) {
      report.errors.push("Invalid claim value".to_string());
    }

    if !["white", "black"].contains(&self.certificate.claim.side.as_str()) {
      report.errors.push("Invalid claim side".to_string());
    }

    // Validate node structure (moves, coverage, cycles)
    for (node_id, node) in &self.nodes_by_id {
      if !is_valid_zobrist(&node.zobrist) {
        report
          .errors
          .push(format!("Invalid zobrist in node {}", node_id));
      }

      if !["or-node", "and-node", "terminal"].contains(&node.kind.as_str()) {
        report
          .errors
          .push(format!("Invalid node kind in {}", node_id));
      }

      if node.kind != "terminal" && node.moves.is_empty() {
        report
          .errors
          .push(format!("Non-terminal node {} has no moves", node_id));
      }

      for mv in &node.moves {
        if !is_valid_uci(&mv.uci) {
          report.errors.push(format!(
            "Invalid UCI notation in node {}: {}",
            node_id, mv.uci
          ));
        }
        if !self.nodes_by_id.contains_key(&mv.child_id) {
          report.errors.push(format!(
            "Missing child node {} in move from {}",
            mv.child_id, node_id
          ));
        }
      }
    }

    // Check for cycles in win certificates (acyclic requirement)
    if self.certificate.claim.value == "win" {
      if let Err(e) = self.check_acyclic() {
        report.errors.push(format!("Acyclic check failed: {}", e));
      }
    }

    // The semantic (move-replay) pass only runs once every structural
    // invariant above holds — a certificate with a dangling child_id or a
    // malformed FEN has nothing meaningful to replay.
    if opts.semantic && report.errors.is_empty() {
      self.verify_semantic(opts, &mut report);
    }

    report.valid = report.errors.is_empty() && report.terminal_count > 0;
    report.elapsed_ms = start.elapsed().as_millis();

    Ok(report)
  }

  fn check_acyclic(&self) -> Result<(), String> {
    let mut visited = HashSet::new();
    let mut rec_stack = HashSet::new();

    let root_id = self.certificate.root_id.clone();
    self.dfs_check_acyclic(&root_id, &mut visited, &mut rec_stack)?;

    Ok(())
  }

  fn dfs_check_acyclic(
    &self,
    node_id: &str,
    visited: &mut HashSet<String>,
    rec_stack: &mut HashSet<String>,
  ) -> Result<(), String> {
    if rec_stack.contains(node_id) {
      return Err(format!("Cycle detected at node {}", node_id));
    }

    if visited.contains(node_id) {
      return Ok(());
    }

    visited.insert(node_id.to_string());
    rec_stack.insert(node_id.to_string());

    if let Some(node) = self.nodes_by_id.get(node_id) {
      for mv in &node.moves {
        self.dfs_check_acyclic(&mv.child_id, visited, rec_stack)?;
      }
    }

    rec_stack.remove(node_id);
    Ok(())
  }

  pub fn get_claim(&self) -> &CertificateClaim {
    &self.certificate.claim
  }
}

fn is_valid_zobrist(zobrist: &str) -> bool {
  zobrist.len() == 18
    && zobrist.starts_with("0x")
    && zobrist[2..].chars().all(|c| c.is_ascii_hexdigit())
}

fn is_valid_uci(uci: &str) -> bool {
  let chars: Vec<char> = uci.chars().collect();
  chars.len() >= 4
    && chars.len() <= 5
    && ('a'..='h').contains(&chars[0])
    && ('1'..='8').contains(&chars[1])
    && ('a'..='h').contains(&chars[2])
    && ('1'..='8').contains(&chars[3])
}
