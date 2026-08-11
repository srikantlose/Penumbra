//! `penumbra-prove` — command-line front end to the proof-number search prover.
//!
//! Given a FEN and a claiming side, it searches for a forced mate and, on
//! success, writes a v0.1 `.pnbcert` certificate that `penumbra-verify` accepts.

use clap::{Args, Parser, Subcommand};
use penumbra_prover::{ClaimValue, ProofNumberSearch, ProofSearchConfig};
use shakmaty::Color;
use std::fs;
use std::path::{Path, PathBuf};
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
  Prove(Box<ProveArgs>),
  /// Generate a new Ed25519 signing keypair for `prove --sign-key`.
  Keygen {
    #[arg(
      long,
      help = "Writes <prefix>.seed (private, keep secret) and <prefix>.pub (public, safe to share -- this is what `penumbra-verify --trust-key` checks against)"
    )]
    out_prefix: PathBuf,
  },
}

// Boxed in `Commands::Prove` above (clippy::large_enum_variant): this struct
// carries far more fields than `Keygen`, so without the box every `Commands`
// value would pay for the largest variant's size.
#[derive(Args)]
struct ProveArgs {
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

  #[arg(
    long,
    help = "Path to a raw 32-byte Ed25519 seed (see `penumbra-prove keygen`); signs the written certificate (only applies with -o; ignored for stdout)"
  )]
  sign_key: Option<PathBuf>,

  #[arg(
    long,
    help = "Attribution only: a contributor to record in the certificate's metadata.contributors (repeatable; does not affect verification)"
  )]
  contributor: Vec<String>,

  #[arg(
    long,
    help = "Attribution only: a work-unit identifier to record as the certificate's metadata.work_units (does not affect verification)"
  )]
  work_unit: Option<String>,
}

fn main() -> ExitCode {
  let cli = Cli::parse();

  match cli.command {
    Commands::Prove(args) => run_prove(*args),
    Commands::Keygen { out_prefix } => run_keygen(&out_prefix),
  }
}

fn run_keygen(out_prefix: &Path) -> ExitCode {
  let (seed, public_key) = match penumbra_prover::sign::generate_keypair() {
    Ok(pair) => pair,
    Err(e) => {
      eprintln!("Error: {e}");
      return ExitCode::FAILURE;
    }
  };

  let seed_path = with_extension(out_prefix, "seed");
  let pub_path = with_extension(out_prefix, "pub");

  if let Err(e) = fs::write(&seed_path, seed) {
    eprintln!("Error: could not write {}: {e}", seed_path.display());
    return ExitCode::FAILURE;
  }
  if let Err(e) = fs::write(&pub_path, public_key) {
    eprintln!("Error: could not write {}: {e}", pub_path.display());
    return ExitCode::FAILURE;
  }

  eprintln!("Wrote {} (private, keep secret)", seed_path.display());
  eprintln!(
    "Wrote {} (public, pass to `penumbra-verify --trust-key`)",
    pub_path.display()
  );
  ExitCode::SUCCESS
}

fn with_extension(prefix: &Path, ext: &str) -> PathBuf {
  let mut path = prefix.to_path_buf();
  let file_name = path
    .file_name()
    .map(|n| format!("{}.{ext}", n.to_string_lossy()))
    .unwrap_or_else(|| format!("key.{ext}"));
  path.set_file_name(file_name);
  path
}

fn run_prove(args: ProveArgs) -> ExitCode {
  let ProveArgs {
    fen,
    side,
    out,
    max_nodes,
    time_ms,
    claim,
    syzygy,
    compress,
    sign_key,
    contributor,
    work_unit,
  } = args;

  if compress && out.is_none() {
    eprintln!("--compress has no effect without -o; stdout output is always plain JSON");
  }
  if sign_key.is_some() && out.is_none() {
    eprintln!("--sign-key has no effect without -o; stdout output is never signed");
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
    contributors: (!contributor.is_empty()).then_some(contributor),
    work_units: work_unit.map(|w| vec![w]),
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
      let signature = match sign_key {
        Some(key_path) => match sign_certificate(&key_path, &json) {
          Ok(sig) => Some(sig),
          Err(e) => {
            eprintln!("Error: {e}");
            return ExitCode::FAILURE;
          }
        },
        None => None,
      };
      let bytes = match penumbra_prover::encode_certificate_container(
        &json,
        compress,
        signature.as_deref(),
      ) {
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

/// Reads a raw 32-byte Ed25519 seed from `key_path` and signs `json`'s
/// `certificate_sha256` with it, returning the raw 64-byte signature.
fn sign_certificate(key_path: &Path, json: &str) -> Result<Vec<u8>, String> {
  let seed =
    fs::read(key_path).map_err(|e| format!("could not read {}: {e}", key_path.display()))?;
  let sha256 = penumbra_verify::certificate_sha256(json)
    .map_err(|e| format!("could not hash certificate: {e}"))?;
  penumbra_prover::sign::sign(&seed, sha256.as_bytes()).map(|sig| sig.to_vec())
}
