//! Cross-implementation check: packages/core's TypeScript Polyglot Zobrist
//! implementation and shakmaty (this crate's Rust dependency) must hash
//! every position identically, since certificates are stamped with
//! shakmaty's hash but the web/API/db side keys everything on the TS one.
//!
//! This test and `packages/core/src/zobrist/zobrist.test.ts` load the same
//! fixture file -- if either implementation drifts, one of the two suites
//! fails.

use serde::Deserialize;
use shakmaty::fen::Fen;
use shakmaty::zobrist::{Zobrist64, ZobristHash};
use shakmaty::{CastlingMode, Chess, EnPassantMode};

#[derive(Deserialize)]
struct Vector {
  label: String,
  fen: String,
  zobrist_hex: String,
}

#[test]
fn shakmaty_matches_committed_zobrist_vectors() {
  let json = std::fs::read_to_string("../../packages/core/test-fixtures/zobrist-vectors.json")
    .expect("fixture should exist");
  let vectors: Vec<Vector> = serde_json::from_str(&json).expect("fixture should be valid json");

  assert!(!vectors.is_empty());

  for v in &vectors {
    let pos = Fen::from_ascii(v.fen.as_bytes())
      .unwrap_or_else(|e| panic!("{}: invalid FEN {}: {e}", v.label, v.fen))
      .into_setup()
      .position::<Chess>(CastlingMode::Standard)
      .unwrap_or_else(|e| panic!("{}: illegal position {}: {e}", v.label, v.fen));

    let hash: Zobrist64 = pos.zobrist_hash(EnPassantMode::Legal);
    let computed = format!("0x{:016x}", hash.0);

    assert_eq!(
      computed, v.zobrist_hex,
      "{}: fen {} hashed to {}, fixture declares {}",
      v.label, v.fen, computed, v.zobrist_hex
    );
  }
}
