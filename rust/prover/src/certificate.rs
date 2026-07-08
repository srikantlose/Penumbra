//! Certificate output types.
//!
//! These mirror the structures the verifier (`penumbra-verify`) reads, and
//! serialize to the v0.1 `.pnbcert` JSON format documented in
//! `docs/CERTIFICATE_FORMAT.md`. The prover only ever *produces* certificates,
//! so these types are serialize-only; the verifier owns the canonical
//! deserialization side.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct Certificate {
  pub format_version: String,
  pub claim: Claim,
  pub rules: String,
  pub root_id: String,
  pub nodes: Vec<Node>,
  pub dependencies: Dependencies,
  pub metadata: Metadata,
}

#[derive(Debug, Clone, Serialize)]
pub struct Claim {
  pub fen: String,
  pub zobrist: String,
  pub value: String,
  pub side: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Node {
  pub id: String,
  pub zobrist: String,
  pub to_move: String,
  pub kind: String,
  #[serde(skip_serializing_if = "Vec::is_empty")]
  pub moves: Vec<MoveEdge>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub terminal: Option<Terminal>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MoveEdge {
  pub uci: String,
  pub child_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Terminal {
  #[serde(rename = "type")]
  pub terminal_type: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct Dependencies {
  #[serde(skip_serializing_if = "Option::is_none")]
  pub tablebase: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Metadata {
  pub producer: String,
  pub timestamp: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub contributors: Option<Vec<String>>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub work_units: Option<Vec<String>>,
}

impl Certificate {
  pub fn to_json_pretty(&self) -> String {
    serde_json::to_string_pretty(self).expect("certificate serializes")
  }
}
