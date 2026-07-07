use std::io;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum VerifyError {
  #[error("invalid certificate: {0}")]
  InvalidCertificate(String),

  #[error("unsupported format version: {0}")]
  UnsupportedFormatVersion(String),

  #[error("illegal move: {0}")]
  IllegalMove(String),

  #[error("missing AND-branch coverage")]
  IncompleteCoverage,

  #[error("invalid cycle in win certificate")]
  InvalidCycleInWin,

  #[error("tablebase probe failed: {0}")]
  TablebaseError(String),

  #[error("hash mismatch")]
  HashMismatch,

  #[error("IO error: {0}")]
  Io(#[from] io::Error),

  #[error("JSON error: {0}")]
  Json(#[from] serde_json::Error),

  #[error("decompression error: {0}")]
  Decompress(String),

  #[error("verification failed: {0}")]
  VerificationFailed(String),
}

impl VerifyError {
  pub fn exit_code(&self) -> i32 {
    match self {
      VerifyError::InvalidCertificate(_) => 2,
      VerifyError::UnsupportedFormatVersion(_) => 3,
      VerifyError::IllegalMove(_) => 4,
      VerifyError::IncompleteCoverage => 5,
      VerifyError::InvalidCycleInWin => 6,
      VerifyError::TablebaseError(_) => 7,
      VerifyError::HashMismatch => 8,
      VerifyError::Io(_) => 9,
      VerifyError::Json(_) => 10,
      VerifyError::Decompress(_) => 11,
      VerifyError::VerificationFailed(_) => 1,
    }
  }
}
