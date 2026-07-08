//! Syzygy tablebase leaf oracle for the search.
//!
//! Thin wrapper around `shakmaty_syzygy::Tablebase`. The only nontrivial
//! logic here is `outcome_for_claim`: `Tablebase::probe_wdl` already folds
//! the position's actual halfmove clock into its answer (it returns an
//! `AmbiguousWdl`, computed via DTZ + halfmove count), so the 50-move-rule
//! bookkeeping the certificate format cares about is handled by the crate,
//! not re-derived here. What's left is a small per-claim truth table:
//! whether a given WDL value counts as proving `win` vs `at_least_draw`.
//!
//! `AmbiguousWdl::MaybeWin` / `MaybeLoss` (the DTZ-rounding edge case) are
//! treated conservatively: accepted only when every value they could stand
//! for would itself be an accept.

use std::io;
use std::path::Path;

use shakmaty::{Chess, Color, Position};
use shakmaty_syzygy::{AmbiguousWdl, Tablebase};

use crate::pns::ClaimValue;

pub struct TbOracle {
  tb: Tablebase<Chess>,
  max_pieces: usize,
}

impl TbOracle {
  pub fn new(dir: &Path) -> io::Result<Self> {
    let mut tb = Tablebase::new();
    let added = tb.add_directory(dir)?;
    if added == 0 {
      return Err(io::Error::new(
        io::ErrorKind::NotFound,
        format!("no syzygy table files found in {}", dir.display()),
      ));
    }
    let max_pieces = tb.max_pieces();
    Ok(TbOracle { tb, max_pieces })
  }

  pub fn max_pieces(&self) -> usize {
    self.max_pieces
  }

  /// Probes the WDL value of `pos`, converted to `perspective`'s point of
  /// view. Returns `None` if the position has castling rights, has more
  /// pieces than the loaded tables cover, or the probe otherwise fails
  /// (missing/corrupted table) -- in every case the caller should treat the
  /// leaf as unresolved rather than error out, since the search can keep
  /// expanding past it.
  pub fn probe(&self, pos: &Chess, perspective: Color) -> Option<AmbiguousWdl> {
    if pos.castles().any() {
      return None;
    }
    if pos.board().occupied().count() > self.max_pieces {
      return None;
    }
    let wdl = self.tb.probe_wdl(pos).ok()?;
    Some(if pos.turn() == perspective { wdl } else { -wdl })
  }
}

/// Whether `wdl` (already converted to the claiming side's perspective)
/// proves `claim`, and if so, which value the terminal should carry.
pub fn outcome_for_claim(wdl: AmbiguousWdl, claim: ClaimValue) -> Option<&'static str> {
  use AmbiguousWdl::*;
  match claim {
    ClaimValue::Win => match wdl {
      Win => Some("win"),
      // CursedWin/MaybeWin are draws-or-worse once the 50-move rule is
      // accounted for; Draw/BlessedLoss/MaybeLoss/Loss are never a win.
      _ => None,
    },
    ClaimValue::AtLeastDraw => match wdl {
      Win => Some("win"),
      CursedWin | MaybeWin | Draw | BlessedLoss => Some("draw"),
      // MaybeLoss is ambiguous between an outright Loss and a
      // 50-move-rule-saved BlessedLoss -- reject rather than guess.
      MaybeLoss | Loss => None,
    },
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn win_claim_truth_table() {
    assert_eq!(
      outcome_for_claim(AmbiguousWdl::Win, ClaimValue::Win),
      Some("win")
    );
    assert_eq!(
      outcome_for_claim(AmbiguousWdl::CursedWin, ClaimValue::Win),
      None
    );
    assert_eq!(
      outcome_for_claim(AmbiguousWdl::MaybeWin, ClaimValue::Win),
      None
    );
    assert_eq!(outcome_for_claim(AmbiguousWdl::Draw, ClaimValue::Win), None);
    assert_eq!(
      outcome_for_claim(AmbiguousWdl::BlessedLoss, ClaimValue::Win),
      None
    );
    assert_eq!(
      outcome_for_claim(AmbiguousWdl::MaybeLoss, ClaimValue::Win),
      None
    );
    assert_eq!(outcome_for_claim(AmbiguousWdl::Loss, ClaimValue::Win), None);
  }

  #[test]
  fn at_least_draw_claim_truth_table() {
    assert_eq!(
      outcome_for_claim(AmbiguousWdl::Win, ClaimValue::AtLeastDraw),
      Some("win")
    );
    assert_eq!(
      outcome_for_claim(AmbiguousWdl::CursedWin, ClaimValue::AtLeastDraw),
      Some("draw")
    );
    assert_eq!(
      outcome_for_claim(AmbiguousWdl::MaybeWin, ClaimValue::AtLeastDraw),
      Some("draw")
    );
    assert_eq!(
      outcome_for_claim(AmbiguousWdl::Draw, ClaimValue::AtLeastDraw),
      Some("draw")
    );
    assert_eq!(
      outcome_for_claim(AmbiguousWdl::BlessedLoss, ClaimValue::AtLeastDraw),
      Some("draw")
    );
    assert_eq!(
      outcome_for_claim(AmbiguousWdl::MaybeLoss, ClaimValue::AtLeastDraw),
      None
    );
    assert_eq!(
      outcome_for_claim(AmbiguousWdl::Loss, ClaimValue::AtLeastDraw),
      None
    );
  }

  fn tablebases_dir() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tablebases/syzygy/3-4-5")
  }

  /// The classic tablebase-wrapper bug is a sign flip: probing from the
  /// "wrong" perspective silently inverts win/loss. KQvK is unconditionally
  /// winning for White regardless of whose move it is, so probing the same
  /// game-theoretic truth from both perspectives, with both colors to move,
  /// pins the sign convention down in all four combinations.
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
      Some(AmbiguousWdl::Win)
    );
    assert_eq!(
      oracle.probe(&black_to_move, Color::White),
      Some(AmbiguousWdl::Win)
    );
    assert_eq!(
      oracle.probe(&white_to_move, Color::Black),
      Some(AmbiguousWdl::Loss)
    );
    assert_eq!(
      oracle.probe(&black_to_move, Color::Black),
      Some(AmbiguousWdl::Loss)
    );
  }
}
