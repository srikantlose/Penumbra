//! Network tablebase probing: an alternative to `tb::TbOracle`'s local
//! Syzygy files for `TablebasePolicy::Endpoint`. Same terminal-checking
//! contract (probe a WDL, compare against the certificate's declared
//! value), but over HTTP against a Lichess-compatible tablebase API instead
//! of files loaded from disk -- trades the ~1GB 3-4-5-man download for a
//! network round trip per terminal, and shifts trust from "the verifier
//! computed this from tables it controls" to "this remote service answered
//! honestly." Still far stronger than `--assume-tb`, which trusts the
//! certificate's own producer.
//!
//! The endpoint already resolves the DTZ/halfmove-clock arithmetic
//! `tb::TbOracle` gets from `Tablebase::probe_wdl` -- Lichess's `category`
//! field is reported directly in `AmbiguousWdl`'s own seven-value vocabulary
//! (`win`/`cursed-win`/`draw`/`blessed-loss`/`loss`/`maybe-win`/`maybe-loss`,
//! plus `unknown` for no-coverage), so this module is just the string
//! mapping and the HTTP call, not a reimplementation of the tablebase math.

use std::time::Duration;

use serde::Deserialize;
use shakmaty::fen::Fen;
use shakmaty::{Chess, Color, EnPassantMode, Position};
use shakmaty_syzygy::AmbiguousWdl;
use ureq::Agent;

/// The well-known public endpoint this flag is named after. Any
/// Lichess-API-compatible service (a self-hosted mirror, say) works too --
/// the flag takes an arbitrary URL, not just this one.
pub const LICHESS_TABLEBASE_ENDPOINT: &str = "https://tablebase.lichess.ovh/standard";

/// Matches Lichess's own coverage limit -- probing above this is guaranteed
/// to come back `unknown`, so reject client-side instead of spending a
/// round trip to learn that.
const MAX_PIECES: usize = 7;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

pub struct EndpointTbOracle {
  base_url: String,
  agent: Agent,
}

#[derive(Deserialize)]
struct TablebaseResponse {
  category: Option<String>,
}

impl EndpointTbOracle {
  pub fn new(base_url: String) -> Self {
    let config = Agent::config_builder()
      .timeout_global(Some(REQUEST_TIMEOUT))
      .build();
    EndpointTbOracle {
      base_url,
      agent: config.into(),
    }
  }

  /// Probes the WDL value of `pos`, converted to `perspective`'s point of
  /// view. Mirrors `tb::TbOracle::probe`'s signature and guards exactly so
  /// the two backends are interchangeable behind `TbBackend`.
  pub fn probe(&self, pos: &Chess, perspective: Color) -> Result<AmbiguousWdl, String> {
    if pos.castles().any() {
      return Err(
        "position has castling rights; tablebase positions are castling-free".to_string(),
      );
    }
    let pieces = pos.board().occupied().count();
    if pieces > MAX_PIECES {
      return Err(format!(
        "position has {pieces} pieces, exceeding the tablebase endpoint's {MAX_PIECES}-piece limit"
      ));
    }

    let fen = Fen::from_position(pos.clone(), EnPassantMode::Legal).to_string();
    let response: TablebaseResponse = self
      .agent
      .get(&self.base_url)
      .query("fen", &fen)
      .call()
      .map_err(|e| format!("tablebase endpoint request failed: {e}"))?
      .body_mut()
      .read_json()
      .map_err(|e| format!("tablebase endpoint returned invalid json: {e}"))?;

    let category = response
      .category
      .ok_or_else(|| "tablebase endpoint response had no category field".to_string())?;
    let wdl = category_to_wdl(&category)?;
    Ok(if pos.turn() == perspective { wdl } else { -wdl })
  }
}

fn category_to_wdl(category: &str) -> Result<AmbiguousWdl, String> {
  use AmbiguousWdl::*;
  match category {
    "win" => Ok(Win),
    "cursed-win" => Ok(CursedWin),
    "draw" => Ok(Draw),
    "blessed-loss" => Ok(BlessedLoss),
    "loss" => Ok(Loss),
    "maybe-win" => Ok(MaybeWin),
    "maybe-loss" => Ok(MaybeLoss),
    "unknown" => Err("tablebase endpoint has no data for this position".to_string()),
    other => Err(format!(
      "tablebase endpoint returned an unrecognized category '{other}'"
    )),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn category_to_wdl_covers_every_documented_value() {
    assert_eq!(category_to_wdl("win"), Ok(AmbiguousWdl::Win));
    assert_eq!(category_to_wdl("cursed-win"), Ok(AmbiguousWdl::CursedWin));
    assert_eq!(category_to_wdl("draw"), Ok(AmbiguousWdl::Draw));
    assert_eq!(
      category_to_wdl("blessed-loss"),
      Ok(AmbiguousWdl::BlessedLoss)
    );
    assert_eq!(category_to_wdl("loss"), Ok(AmbiguousWdl::Loss));
    assert_eq!(category_to_wdl("maybe-win"), Ok(AmbiguousWdl::MaybeWin));
    assert_eq!(category_to_wdl("maybe-loss"), Ok(AmbiguousWdl::MaybeLoss));
  }

  #[test]
  fn category_to_wdl_rejects_unknown_and_garbage() {
    assert!(category_to_wdl("unknown").is_err());
    assert!(category_to_wdl("not-a-real-category").is_err());
  }
}
