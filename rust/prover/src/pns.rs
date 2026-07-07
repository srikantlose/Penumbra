use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProofSearchConfig {
  pub max_nodes: usize,
  pub time_limit_ms: u64,
  pub tablebase_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProofSearchResult {
  pub proven: bool,
  pub nodes_explored: usize,
  pub elapsed_ms: u128,
  pub claim_value: String,
}

pub struct ProofNumberSearch {
  config: ProofSearchConfig,
}

impl ProofNumberSearch {
  pub fn new(config: ProofSearchConfig) -> Self {
    ProofNumberSearch { config }
  }

  pub fn search(&self, _fen: &str) -> Result<ProofSearchResult, String> {
    Ok(ProofSearchResult {
      proven: false,
      nodes_explored: 0,
      elapsed_ms: 0,
      claim_value: "unknown".to_string(),
    })
  }
}
