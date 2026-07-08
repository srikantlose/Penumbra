use clap::{Parser, Subcommand};
use penumbra_verify::{CertificateVerifier, TablebasePolicy, VerifyOptions};
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

    #[arg(
      long,
      help = "Path to Syzygy tablebase directory (wired up in the fortress track, Stage 2)"
    )]
    syzygy: Option<PathBuf>,

    #[arg(
      long,
      help = "Tablebase endpoint URL (not implemented yet; use --syzygy)"
    )]
    tb_endpoint: Option<String>,

    #[arg(
      long,
      default_value_t = false,
      help = "Run in offline mode (equivalent to omitting --syzygy)"
    )]
    offline: bool,

    #[arg(
      long,
      default_value_t = false,
      help = "Skip move replay; only check certificate shape"
    )]
    structural_only: bool,

    #[arg(
      long,
      default_value_t = false,
      help = "Accept tablebase terminals on faith instead of probing (unsound; for inspection only)"
    )]
    assume_tb: bool,
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
      tb_endpoint,
      offline: _,
      structural_only,
      assume_tb,
    } => {
      if tb_endpoint.is_some() {
        eprintln!("--tb-endpoint is not implemented yet; use --syzygy (Stage 2) instead");
      }
      let opts = VerifyOptions {
        semantic: !structural_only,
        tb: if assume_tb {
          TablebasePolicy::Assume
        } else {
          TablebasePolicy::Forbid
        },
      };
      verify_certificate(&cert_path, &opts)
    }
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

fn verify_certificate(
  path: &PathBuf,
  opts: &VerifyOptions,
) -> Result<bool, Box<dyn std::error::Error>> {
  let content = fs::read_to_string(path)?;

  let verifier = CertificateVerifier::load_from_json(&content)?;
  let report = verifier.verify_with(opts)?;

  println!("Certificate Verification Report");
  println!("==============================");
  println!("Valid: {}", report.valid);
  println!("SHA256: {}", report.sha256);
  println!("Claim: {}", report.claim);
  println!("Nodes: {}", report.node_count);
  println!("Terminals: {}", report.terminal_count);
  println!(
    "Mode: {}",
    if report.semantic {
      "semantic"
    } else {
      "structural-only"
    }
  );
  println!("Probes: {}", report.probe_count);
  if report.assumed_probes > 0 {
    println!(
      "Assumed (unverified) tablebase terminals: {}",
      report.assumed_probes
    );
  }
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
  match penumbra_verify::certificate_sha256(&content) {
    Ok(sha256) => println!("SHA256: {}", sha256),
    Err(e) => println!("SHA256: <unavailable: {}>", e),
  }

  Ok(true)
}
