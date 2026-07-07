use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use crate::error::VerifyError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CertificateMetadata {
  pub format_version: String,
  pub producer: String,
  pub timestamp: String,
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

pub struct VerifyReport {
  pub valid: bool,
  pub claim: String,
  pub node_count: usize,
  pub terminal_count: usize,
  pub probe_count: usize,
  pub elapsed_ms: u128,
  pub errors: Vec<String>,
}

pub struct CertificateVerifier {
  certificate: Certificate,
  nodes_by_id: HashMap<String, CertificateNode>,
}

impl CertificateVerifier {
  pub fn load_from_json(json: &str) -> Result<Self, VerifyError> {
    let certificate: Certificate =
      serde_json::from_str(json).map_err(|e| VerifyError::Json(e))?;

    if certificate.format_version != "0.1" {
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
    })
  }

  pub fn verify(&self) -> Result<VerifyReport, VerifyError> {
    let start = std::time::Instant::now();

    let _root_node = self
      .nodes_by_id
      .get(&self.certificate.root_id)
      .ok_or_else(|| {
        VerifyError::InvalidCertificate("root node not found".to_string())
      })?;

    let mut report = VerifyReport {
      valid: false,
      claim: format!(
        "{} {}",
        self.certificate.claim.value, self.certificate.claim.side
      ),
      node_count: self.certificate.nodes.len(),
      terminal_count: 0,
      probe_count: 0,
      elapsed_ms: 0,
      errors: vec![],
    };

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
      report.errors.push("Invalid zobrist hash in claim".to_string());
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
        report.errors.push(format!("Invalid zobrist in node {}", node_id));
      }

      if !["or-node", "and-node", "terminal"].contains(&node.kind.as_str()) {
        report.errors.push(format!("Invalid node kind in {}", node_id));
      }

      if node.kind != "terminal" && node.moves.is_empty() {
        report.errors.push(format!("Non-terminal node {} has no moves", node_id));
      }

      for mv in &node.moves {
        if !is_valid_uci(&mv.uci) {
          report.errors.push(format!("Invalid UCI notation in node {}: {}", node_id, mv.uci));
        }
        if !self.nodes_by_id.contains_key(&mv.child_id) {
          report.errors.push(format!("Missing child node {} in move from {}", mv.child_id, node_id));
        }
      }
    }

    // Check for cycles in win certificates (acyclic requirement)
    if self.certificate.claim.value == "win" {
      if let Err(e) = self.check_acyclic() {
        report.errors.push(format!("Acyclic check failed: {}", e));
      }
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
  zobrist.len() == 18 && zobrist.starts_with("0x") && zobrist[2..].chars().all(|c| c.is_ascii_hexdigit())
}

fn is_valid_uci(uci: &str) -> bool {
  uci.len() >= 4 && uci.len() <= 5
    && uci.chars().nth(0).map_or(false, |c| c >= 'a' && c <= 'h')
    && uci.chars().nth(1).map_or(false, |c| c >= '1' && c <= '8')
    && uci.chars().nth(2).map_or(false, |c| c >= 'a' && c <= 'h')
    && uci.chars().nth(3).map_or(false, |c| c >= '1' && c <= '8')
}
