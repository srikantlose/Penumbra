use clap::{Parser, Subcommand};
use penumbra_verify::CertificateVerifier;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(name = "penumbra-verify")]
#[command(about = "Verify Penumbra chess proof certificates", long_about = None)]
struct Cli {
  #[command(subcommand)]
  command: Commands,
}

#[derive(Subcommand)]
enum Commands {
  Verify {
    #[arg(help = "Path to certificate file (.pnbcert)")]
    cert_path: PathBuf,

    #[arg(long, help = "Path to Syzygy tablebase directory (offline mode)")]
    syzygy: Option<PathBuf>,

    #[arg(long, help = "Tablebase endpoint URL")]
    tb_endpoint: Option<String>,

    #[arg(long, default_value_t = false, help = "Run in offline mode")]
    offline: bool,
  },
  Inspect {
    #[arg(help = "Path to certificate file (.pnbcert)")]
    cert_path: PathBuf,
  },
}

fn main() -> ExitCode {
  let cli = Cli::parse();

  let result = match cli.command {
    Commands::Verify {
      cert_path,
      syzygy: _,
      tb_endpoint: _,
      offline: _,
    } => verify_certificate(&cert_path),
    Commands::Inspect { cert_path } => inspect_certificate(&cert_path),
  };

  match result {
    Ok(valid) => {
      if valid {
        ExitCode::SUCCESS
      } else {
        ExitCode::FAILURE
      }
    }
    Err(e) => {
      eprintln!("Error: {}", e);
      ExitCode::FAILURE
    }
  }
}

fn verify_certificate(path: &PathBuf) -> Result<bool, Box<dyn std::error::Error>> {
  let content = fs::read_to_string(path)?;

  let verifier = CertificateVerifier::load_from_json(&content)?;
  let report = verifier.verify()?;

  println!("Certificate Verification Report");
  println!("==============================");
  println!("Valid: {}", report.valid);
  println!("Claim: {}", report.claim);
  println!("Nodes: {}", report.node_count);
  println!("Terminals: {}", report.terminal_count);
  println!("Probes: {}", report.probe_count);
  println!("Elapsed: {}ms", report.elapsed_ms);

  if !report.errors.is_empty() {
    println!("\nErrors:");
    for error in &report.errors {
      println!("  - {}", error);
    }
  }

  Ok(report.valid)
}

fn inspect_certificate(path: &PathBuf) -> Result<bool, Box<dyn std::error::Error>> {
  let content = fs::read_to_string(path)?;

  let verifier = CertificateVerifier::load_from_json(&content)?;
  let claim = verifier.get_claim();

  println!("Certificate Inspection");
  println!("=====================");
  println!("FEN: {}", claim.fen);
  println!("Zobrist: {}", claim.zobrist);
  println!("Value: {}", claim.value);
  println!("Side: {}", claim.side);

  Ok(true)
}
