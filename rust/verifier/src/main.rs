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

    #[arg(long, help = "Path to a Syzygy tablebase directory")]
    syzygy: Option<PathBuf>,

    #[arg(
      long,
      help = "Tablebase HTTP endpoint URL for network WDL probing (e.g. https://tablebase.lichess.ovh/standard), covers up to 7 men; alternative to --syzygy, requires network access at verify time"
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

    #[arg(
      long,
      help = "Path to a raw 32-byte Ed25519 public key; if the certificate carries a signature, check it against this key"
    )]
    trust_key: Option<PathBuf>,

    #[arg(
      long,
      default_value_t = false,
      help = "Fail if the certificate has no signature, or --trust-key wasn't given (provenance, not soundness -- see docs/CERTIFICATE_FORMAT.md)"
    )]
    require_signature: bool,
  },
  Inspect {
    #[arg(help = "Path to certificate file (.pnbcert)")]
    cert_path: PathBuf,

    #[arg(
      long,
      help = "Path to a raw 32-byte Ed25519 public key to check the certificate's signature against"
    )]
    trust_key: Option<PathBuf>,
  },
}

fn main() -> ExitCode {
  let cli = Cli::parse();

  let result = match cli.command {
    Commands::Verify {
      cert_path,
      syzygy,
      tb_endpoint,
      offline,
      structural_only,
      assume_tb,
      trust_key,
      require_signature,
    } => {
      let tb = if offline {
        if syzygy.is_some() || tb_endpoint.is_some() || assume_tb {
          eprintln!(
            "--offline overrides --syzygy/--tb-endpoint/--assume-tb; verifying with no tablebase source"
          );
        }
        TablebasePolicy::Forbid
      } else if let Some(dir) = syzygy {
        if tb_endpoint.is_some() {
          eprintln!("--syzygy takes precedence over --tb-endpoint; ignoring --tb-endpoint");
        }
        TablebasePolicy::Syzygy(dir)
      } else if let Some(url) = tb_endpoint {
        TablebasePolicy::Endpoint(url)
      } else if assume_tb {
        TablebasePolicy::Assume
      } else {
        TablebasePolicy::Forbid
      };
      let opts = VerifyOptions {
        semantic: !structural_only,
        tb,
      };
      verify_certificate(&cert_path, &opts, trust_key.as_ref(), require_signature)
    }
    Commands::Inspect {
      cert_path,
      trust_key,
    } => inspect_certificate(&cert_path, trust_key.as_ref()),
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

/// Checks a decoded certificate's signature (if any) against `trust_key`
/// (if given), returning a human-readable status line and whether that
/// status should be treated as a failure under `require_signature`.
fn check_signature(
  decoded: &penumbra_verify::DecodedCertificate,
  sha256: &str,
  trust_key: Option<&PathBuf>,
  require_signature: bool,
) -> (String, bool) {
  match (&decoded.signature, trust_key) {
    (None, _) => ("absent".to_string(), require_signature),
    (Some(_), None) => (
      "present (no --trust-key given, not checked)".to_string(),
      require_signature,
    ),
    (Some(sig), Some(key_path)) => match fs::read(key_path) {
      Ok(public_key) => match penumbra_verify::sign::verify(&public_key, sha256.as_bytes(), sig) {
        Ok(()) => ("valid".to_string(), false),
        Err(e) => (format!("INVALID ({e})"), true),
      },
      Err(e) => (
        format!("<could not read trust key {}: {e}>", key_path.display()),
        true,
      ),
    },
  }
}

fn verify_certificate(
  path: &PathBuf,
  opts: &VerifyOptions,
  trust_key: Option<&PathBuf>,
  require_signature: bool,
) -> Result<bool, Box<dyn std::error::Error>> {
  let bytes = fs::read(path)?;
  let decoded = penumbra_verify::decode_certificate_bytes(&bytes)?;

  let verifier = CertificateVerifier::load_from_json(&decoded.json)?;
  let report = verifier.verify_with(opts)?;
  let (signature_status, signature_failed) =
    check_signature(&decoded, &report.sha256, trust_key, require_signature);

  println!("Certificate Verification Report");
  println!("==============================");
  println!("Valid: {}", report.valid && !signature_failed);
  println!("SHA256: {}", report.sha256);
  println!("Signature: {}", signature_status);
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

  Ok(report.valid && !signature_failed)
}

fn inspect_certificate(
  path: &PathBuf,
  trust_key: Option<&PathBuf>,
) -> Result<bool, Box<dyn std::error::Error>> {
  let bytes = fs::read(path)?;
  let decoded = penumbra_verify::decode_certificate_bytes(&bytes)?;

  let verifier = CertificateVerifier::load_from_json(&decoded.json)?;
  let claim = verifier.get_claim();

  println!("Certificate Inspection");
  println!("=====================");
  println!("FEN: {}", claim.fen);
  println!("Zobrist: {}", claim.zobrist);
  println!("Value: {}", claim.value);
  println!("Side: {}", claim.side);
  match penumbra_verify::certificate_sha256(&decoded.json) {
    Ok(sha256) => {
      println!("SHA256: {}", sha256);
      let (signature_status, _) = check_signature(&decoded, &sha256, trust_key, false);
      println!("Signature: {}", signature_status);
    }
    Err(e) => println!("SHA256: <unavailable: {}>", e),
  }

  Ok(true)
}
