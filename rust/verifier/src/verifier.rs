use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

    let root_node = self
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

    for node in &self.certificate.nodes {
      if node.kind == "terminal" {
        report.terminal_count += 1;
      }
    }

    report.valid = report.terminal_count > 0;
    report.elapsed_ms = start.elapsed().as_millis();

    Ok(report)
  }

  pub fn get_claim(&self) -> &CertificateClaim {
    &self.certificate.claim
  }
}
