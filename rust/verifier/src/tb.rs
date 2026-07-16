//! Syzygy tablebase probing for the semantic verifier.
//!
//! Independent of `rust/prover`'s oracle by design (see the workspace's
//! two-crate independence rule) -- same shape, separately written. Like the
//! prover's wrapper, this leans on `Tablebase::probe_wdl`, which already
//! folds the position's halfmove clock into its answer via DTZ, so no manual
//! 50-move-rule arithmetic is needed here either.

use std::path::Path;

use shakmaty::{Chess, Color, Position};
use shakmaty_syzygy::{AmbiguousWdl, Tablebase};

use crate::tb_endpoint::EndpointTbOracle;

/// Either tablebase probing source the semantic pass can be configured
/// with, behind one call shape (`semantic.rs` doesn't need to know which).
pub enum TbBackend {
  Local(TbOracle),
  Endpoint(EndpointTbOracle),
}

impl TbBackend {
  pub fn probe(&self, pos: &Chess, perspective: Color) -> Result<AmbiguousWdl, String> {
    match self {
      TbBackend::Local(oracle) => oracle.probe(pos, perspective),
      TbBackend::Endpoint(oracle) => oracle.probe(pos, perspective),
    }
  }
}

pub struct TbOracle {
  tb: Tablebase<Chess>,
  max_pieces: usize,
}

impl TbOracle {
  pub fn new(dir: &Path) -> Result<Self, String> {
    let mut tb = Tablebase::new();
    let added = tb
      .add_directory(dir)
      .map_err(|e| format!("could not read tablebase directory {}: {e}", dir.display()))?;
    if added == 0 {
      return Err(format!("no syzygy table files found in {}", dir.display()));
    }
    let max_pieces = tb.max_pieces();
    Ok(TbOracle { tb, max_pieces })
  }

  /// Probes the WDL value of `pos`, converted to `perspective`'s point of
  /// view. Errors (rather than returning `None`) because a verifier probe
  /// failure is always reportable: unlike the prover, which can just keep
  /// searching, a terminal the verifier can't confirm is a certificate it
  /// must reject.
  pub fn probe(&self, pos: &Chess, perspective: Color) -> Result<AmbiguousWdl, String> {
    if pos.castles().any() {
      return Err("position has castling rights; Syzygy tables are castling-free".to_string());
    }
    let pieces = pos.board().occupied().count();
    if pieces > self.max_pieces {
      return Err(format!(
        "position has {pieces} pieces, exceeding the loaded tables' {}-piece limit",
        self.max_pieces
      ));
    }
    let wdl = self
      .tb
      .probe_wdl(pos)
      .map_err(|e| format!("syzygy probe failed: {e}"))?;
    Ok(if pos.turn() == perspective { wdl } else { -wdl })
  }
}

/// Whether `wdl` (already converted to the claiming side's perspective)
/// justifies a `tablebase` terminal declaring `declared_value` under
/// `claim_value`. Mirrors the prover's `tb::outcome_for_claim` truth table --
/// re-derived independently here rather than shared, per the workspace's
/// two-crate rule.
pub fn wdl_matches(wdl: AmbiguousWdl, claim_value: &str, declared_value: &str) -> bool {
  use AmbiguousWdl::*;
  match (claim_value, declared_value) {
    ("win", "win") => matches!(wdl, Win),
    ("at_least_draw", "win") => matches!(wdl, Win),
    ("at_least_draw", "draw") => matches!(wdl, CursedWin | MaybeWin | Draw | BlessedLoss),
    // "win" claims can never soundly declare a tablebase "draw" terminal,
    // and MaybeLoss/Loss never justify either declared value.
    _ => false,
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn win_claim_only_accepts_unconditional_win() {
    assert!(wdl_matches(AmbiguousWdl::Win, "win", "win"));
    assert!(!wdl_matches(AmbiguousWdl::CursedWin, "win", "win"));
    assert!(!wdl_matches(AmbiguousWdl::MaybeWin, "win", "win"));
    assert!(!wdl_matches(AmbiguousWdl::Draw, "win", "win"));
    assert!(!wdl_matches(AmbiguousWdl::Win, "win", "draw"));
  }

  #[test]
  fn at_least_draw_claim_accepts_win_or_draw_leaning_values() {
    assert!(wdl_matches(AmbiguousWdl::Win, "at_least_draw", "win"));
    assert!(wdl_matches(
      AmbiguousWdl::CursedWin,
      "at_least_draw",
      "draw"
    ));
    assert!(wdl_matches(AmbiguousWdl::MaybeWin, "at_least_draw", "draw"));
    assert!(wdl_matches(AmbiguousWdl::Draw, "at_least_draw", "draw"));
    assert!(wdl_matches(
      AmbiguousWdl::BlessedLoss,
      "at_least_draw",
      "draw"
    ));
    assert!(!wdl_matches(
      AmbiguousWdl::MaybeLoss,
      "at_least_draw",
      "draw"
    ));
    assert!(!wdl_matches(AmbiguousWdl::Loss, "at_least_draw", "draw"));
    assert!(!wdl_matches(
      AmbiguousWdl::CursedWin,
      "at_least_draw",
      "win"
    ));
  }

  fn tablebases_dir() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tablebases/syzygy/3-4-5")
  }

  /// Same both-colors sign-flip check as the prover's oracle test, written
  /// independently against this crate's own wrapper.
  #[test]
  fn probe_perspective_matches_regardless_of_side_to_move() {
    let dir = tablebases_dir();
    if !dir.exists() {
      eprintln!("skipping: no tablebases at {}", dir.display());
      return;
    }
    let oracle = TbOracle::new(&dir).expect("load tables");

    let white_to_move: Chess = "4k3/8/8/8/8/8/8/4K1Q1 w - - 0 1"
      .parse::<shakmaty::fen::Fen>()
      .unwrap()
      .into_position(shakmaty::CastlingMode::Standard)
      .unwrap();
    let black_to_move: Chess = "4k3/8/8/8/8/8/8/4K1Q1 b - - 0 1"
      .parse::<shakmaty::fen::Fen>()
      .unwrap()
      .into_position(shakmaty::CastlingMode::Standard)
      .unwrap();

    assert_eq!(
      oracle.probe(&white_to_move, Color::White),
      Ok(AmbiguousWdl::Win)
    );
    assert_eq!(
      oracle.probe(&black_to_move, Color::White),
      Ok(AmbiguousWdl::Win)
    );
    assert_eq!(
      oracle.probe(&white_to_move, Color::Black),
      Ok(AmbiguousWdl::Loss)
    );
    assert_eq!(
      oracle.probe(&black_to_move, Color::Black),
      Ok(AmbiguousWdl::Loss)
    );
  }
}
