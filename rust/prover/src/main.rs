//! `penumbra-prove` — command-line front end to the proof-number search prover.
//!
//! Given a FEN and a claiming side, it searches for a forced mate and, on
//! success, writes a v0.1 `.pnbcert` certificate that `penumbra-verify` accepts.

use clap::{Parser, Subcommand};
use penumbra_prover::{ClaimValue, ProofNumberSearch, ProofSearchConfig};
use shakmaty::Color;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(name = "penumbra-prove")]
#[command(about = "Search for forced mates and emit Penumbra proof certificates", long_about = None)]
struct Cli {
  #[command(subcommand)]
  command: Commands,
}

#[derive(Subcommand)]
enum Commands {
  /// Prove a forced win from a position and write its certificate.
  Prove {
    #[arg(help = "Position to prove, in FEN")]
    fen: String,

    #[arg(long, value_parser = ["white", "black"], help = "Claiming side (defaults to side to move)")]
    side: Option<String>,

    #[arg(short, long, help = "Write the certificate here (defaults to stdout)")]
    out: Option<PathBuf>,

    #[arg(long, default_value_t = 2_000_000, help = "Search node budget")]
    max_nodes: usize,

    #[arg(long, default_value_t = 30_000, help = "Time budget in milliseconds")]
    time_ms: u64,

    #[arg(
      long,
      value_parser = ["win", "at_least_draw"],
      default_value = "win",
      help = "What to prove"
    )]
    claim: String,

    #[arg(
      long,
      help = "Path to a Syzygy tablebase directory (enables tablebase leaves)"
    )]
    syzygy: Option<PathBuf>,

    #[arg(
      long,
      default_value_t = false,
      help = "zstd-compress the written certificate (only applies with -o; ignored for stdout)"
    )]
    compress: bool,
  },
}

fn main() -> ExitCode {
  let cli = Cli::parse();

  match cli.command {
    Commands::Prove { .. } => run_prove(cli.command),
  }
}

fn run_prove(command: Commands) -> ExitCode {
  let Commands::Prove {
    fen,
    side,
    out,
    max_nodes,
    time_ms,
    claim,
    syzygy,
    compress,
  } = command;

  if compress && out.is_none() {
    eprintln!("--compress has no effect without -o; stdout output is always plain JSON");
  }
  let claim_side = match side.as_deref() {
    Some("white") => Some(Color::White),
    Some("black") => Some(Color::Black),
    Some(other) => {
      eprintln!("Error: unknown side '{other}' (expected white or black)");
      return ExitCode::FAILURE;
    }
    None => None,
  };

  let claim_value = match claim.as_str() {
    "win" => ClaimValue::Win,
    "at_least_draw" => ClaimValue::AtLeastDraw,
    other => {
      eprintln!("Error: unknown claim '{other}' (expected win or at_least_draw)");
      return ExitCode::FAILURE;
    }
  };

  let config = ProofSearchConfig {
    max_nodes,
    time_limit_ms: time_ms,
    tablebase_path: syzygy.map(|p| p.display().to_string()),
    claim: claim_value,
  };

  let search = ProofNumberSearch::new(config);
  let outcome = match search.prove(&fen, claim_side) {
    Ok(outcome) => outcome,
    Err(e) => {
      eprintln!("Error: {e}");
      return ExitCode::FAILURE;
    }
  };

  let r = &outcome.result;
  eprintln!(
    "proven={} nodes={} elapsed={}ms",
    r.proven, r.nodes_explored, r.elapsed_ms
  );

  let cert = match outcome.certificate {
    Some(cert) => cert,
    None => {
      eprintln!("No forced win found within the search budget.");
      return ExitCode::FAILURE;
    }
  };

  let json = cert.to_json_pretty();
  match out {
    Some(path) => {
      let bytes = match penumbra_prover::encode_certificate_container(&json, compress) {
        Ok(bytes) => bytes,
        Err(e) => {
          eprintln!("Error: could not encode certificate: {e}");
          return ExitCode::FAILURE;
        }
      };
      if let Err(e) = fs::write(&path, bytes) {
        eprintln!("Error: could not write {}: {e}", path.display());
        return ExitCode::FAILURE;
      }
      eprintln!("Wrote certificate to {}", path.display());
    }
    None => println!("{json}"),
  }

  ExitCode::SUCCESS
}
