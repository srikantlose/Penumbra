//! Move-replay verification: the part of the spec's "Procedure" that the
//! original structural-only verifier skipped entirely.
//!
//! Structural checks (in `verifier.rs`) confirm the certificate is
//! well-formed JSON with plausible-looking zobrists and UCI strings. They
//! cannot tell a real proof from a fabricated one — nothing stops a node
//! from declaring a `checkmate` terminal on a non-mate position, or an
//! AND-node from covering only some of the opponent's replies. This module
//! replays the certificate against the claimed FEN with shakmaty and checks
//! every node against the actual position it claims to represent.
//!
//! Two claim kinds get different treatment for cycles: `win` certificates
//! are rejected earlier (structural `check_acyclic`) if the child_id graph
//! has a cycle at all, so this pass never has to handle one for `win`. For
//! `at_least_draw`, a move back to an ancestor node — or a dedicated
//! `transposition` terminal whose zobrist matches an ancestor's — is exactly
//! how the certificate format models a fortress: the defender can shuffle
//! forever inside a closed set of positions without ever being forced to a
//! loss. Every node reached via a shared `child_id` (DAG sharing, not
//! necessarily a cycle) is verified once and memoized.

use std::collections::HashSet;

use shakmaty::fen::Fen;
use shakmaty::uci::Uci;
use shakmaty::zobrist::{Zobrist64, ZobristHash};
use shakmaty::{CastlingMode, Chess, Color, EnPassantMode, Position};

use crate::verifier::{
  CertificateMove, CertificateNode, CertificateVerifier, TablebasePolicy, VerifyOptions,
  VerifyReport,
};

/// Traversal state threaded through the recursive replay. Bundled into one
/// struct so the recursive methods below take a handful of arguments
/// instead of one per piece of state.
struct SemanticCtx<'a> {
  claiming_side: Color,
  opts: &'a VerifyOptions,
  /// Node ids on the current root-to-here path (for cycle detection).
  path: HashSet<String>,
  /// Zobrists of nodes on the current path (for transposition-terminal
  /// matching — the terminal must echo an ancestor's exact position).
  path_zobrists: HashSet<String>,
  /// Node ids that have already passed every check (DAG sharing memo).
  verified: HashSet<String>,
}

impl CertificateVerifier {
  pub(crate) fn verify_semantic(&self, opts: &VerifyOptions, report: &mut VerifyReport) {
    let claiming_side = match self.certificate.claim.side.as_str() {
      "white" => Color::White,
      "black" => Color::Black,
      _ => return, // already flagged structurally
    };

    let root_pos = match parse_fen(&self.certificate.claim.fen) {
      Ok(pos) => pos,
      Err(e) => {
        report
          .errors
          .push(format!("claim FEN did not parse: {}", e));
        return;
      }
    };

    let computed = zobrist_hex(&root_pos);
    if computed != self.certificate.claim.zobrist {
      report.errors.push(format!(
        "claim zobrist mismatch: replaying the FEN hashes to {}, but the claim declares {}",
        computed, self.certificate.claim.zobrist
      ));
      return;
    }

    let mut ctx = SemanticCtx {
      claiming_side,
      opts,
      path: HashSet::new(),
      path_zobrists: HashSet::new(),
      verified: HashSet::new(),
    };

    self.verify_node(&self.certificate.root_id, root_pos, &mut ctx, report);
  }

  fn verify_node(
    &self,
    node_id: &str,
    pos: Chess,
    ctx: &mut SemanticCtx,
    report: &mut VerifyReport,
  ) {
    if ctx.verified.contains(node_id) {
      return;
    }

    let node = match self.nodes_by_id.get(node_id) {
      Some(n) => n,
      None => return, // already flagged structurally (missing child node)
    };

    let computed_zobrist = zobrist_hex(&pos);
    if node.zobrist != computed_zobrist {
      report.errors.push(format!(
        "node {} zobrist mismatch: the replayed position hashes to {}, but the node declares {}",
        node_id, computed_zobrist, node.zobrist
      ));
      return;
    }

    let expected_to_move = color_name(pos.turn());
    if node.to_move != expected_to_move {
      report.errors.push(format!(
        "node {} declares to_move={}, but the replayed position has {} to move",
        node_id, node.to_move, expected_to_move
      ));
      return;
    }

    match node.kind.as_str() {
      "terminal" => {
        self.verify_terminal(node_id, node, &pos, ctx, report);
      }
      "or-node" | "and-node" => {
        let is_or_node = node.kind == "or-node";
        let claiming_to_move = pos.turn() == ctx.claiming_side;
        if is_or_node != claiming_to_move {
          report.errors.push(format!(
            "node {} is an {} but it is {}'s move to play",
            node_id, node.kind, expected_to_move
          ));
        } else {
          ctx.path.insert(node_id.to_string());
          ctx.path_zobrists.insert(node.zobrist.clone());

          if is_or_node {
            self.verify_or_moves(node_id, node, &pos, ctx, report);
          } else {
            self.verify_and_moves(node_id, node, &pos, ctx, report);
          }

          ctx.path.remove(node_id);
          ctx.path_zobrists.remove(&node.zobrist);
        }
      }
      _ => {} // already flagged structurally (unrecognized kind)
    }

    ctx.verified.insert(node_id.to_string());
  }

  fn verify_or_moves(
    &self,
    node_id: &str,
    node: &CertificateNode,
    pos: &Chess,
    ctx: &mut SemanticCtx,
    report: &mut VerifyReport,
  ) {
    for mv in &node.moves {
      if let Some(child_pos) = resolve_move(node_id, mv, pos, report) {
        self.descend(&mv.child_id, child_pos, ctx, report);
      }
    }
  }

  /// AND-node coverage: the listed replies must be exactly the opponent's
  /// full legal move list — a proof that skips a reply hasn't covered it.
  fn verify_and_moves(
    &self,
    node_id: &str,
    node: &CertificateNode,
    pos: &Chess,
    ctx: &mut SemanticCtx,
    report: &mut VerifyReport,
  ) {
    let legal: HashSet<String> = pos
      .legal_moves()
      .iter()
      .map(|m| m.to_uci(CastlingMode::Standard).to_string())
      .collect();
    let listed: HashSet<String> = node.moves.iter().map(|m| m.uci.clone()).collect();

    let mut missing: Vec<&String> = legal.difference(&listed).collect();
    missing.sort();
    for uci in missing {
      report.errors.push(format!(
        "node {} is missing AND-node coverage for legal reply {}",
        node_id, uci
      ));
    }

    let mut extra: Vec<&String> = listed.difference(&legal).collect();
    extra.sort();
    for uci in extra {
      report.errors.push(format!(
        "node {} lists {} which is not a legal reply in this position",
        node_id, uci
      ));
    }

    for mv in &node.moves {
      if let Some(child_pos) = resolve_move(node_id, mv, pos, report) {
        self.descend(&mv.child_id, child_pos, ctx, report);
      }
    }
  }

  /// Recurse into a child, unless it is a cycle back to an ancestor on the
  /// current path. `win` certificates can never reach the cycle branch here
  /// (the structural `check_acyclic` gate already rejected them before the
  /// semantic pass runs); `at_least_draw` certificates may legitimately
  /// confine play to a closed set of positions.
  fn descend(
    &self,
    child_id: &str,
    child_pos: Chess,
    ctx: &mut SemanticCtx,
    report: &mut VerifyReport,
  ) {
    if ctx.path.contains(child_id) {
      if self.certificate.claim.value == "at_least_draw" {
        return;
      }
      report.errors.push(format!(
        "node {} closes a cycle, which is only valid in at_least_draw certificates",
        child_id
      ));
      return;
    }
    self.verify_node(child_id, child_pos, ctx, report);
  }

  fn verify_terminal(
    &self,
    node_id: &str,
    node: &CertificateNode,
    pos: &Chess,
    ctx: &SemanticCtx,
    report: &mut VerifyReport,
  ) {
    let terminal = match &node.terminal {
      Some(t) => t,
      None => {
        report
          .errors
          .push(format!("terminal node {} has no terminal info", node_id));
        return;
      }
    };

    match terminal.terminal_type.as_str() {
      "checkmate" => {
        if !pos.is_checkmate() {
          report.errors.push(format!(
            "terminal {} claims checkmate but the replayed position is not checkmate",
            node_id
          ));
          return;
        }
        if pos.turn() == ctx.claiming_side {
          report.errors.push(format!(
            "terminal {} is checkmate against the claiming side, not a win for it",
            node_id
          ));
          return;
        }
        if self.certificate.claim.value == "win" && pos.halfmoves() >= 100 {
          report.errors.push(format!(
            "terminal {} is reached at halfmove clock {}, exceeding the 50-move limit",
            node_id,
            pos.halfmoves()
          ));
        }
      }
      "stalemate" => {
        if !pos.is_stalemate() {
          report.errors.push(format!(
            "terminal {} claims stalemate but the replayed position is not stalemate",
            node_id
          ));
          return;
        }
        if self.certificate.claim.value == "win" {
          report.errors.push(format!(
            "terminal {} is a stalemate, which cannot prove a win",
            node_id
          ));
        }
      }
      "tablebase" => match ctx.opts.tb {
        TablebasePolicy::Forbid => {
          report.errors.push(format!(
            "terminal {} is a tablebase terminal but no tablebase source is configured (pass --syzygy or --assume-tb)",
            node_id
          ));
        }
        TablebasePolicy::Assume => {
          report.assumed_probes += 1;
        }
      },
      "transposition" => {
        if self.certificate.claim.value != "at_least_draw" {
          report.errors.push(format!(
            "terminal {} is a transposition, which is only valid in at_least_draw certificates",
            node_id
          ));
          return;
        }
        if !ctx.path_zobrists.contains(&node.zobrist) {
          report.errors.push(format!(
            "terminal {} claims a transposition but its position does not match any ancestor on the proof path",
            node_id
          ));
        }
      }
      other => {
        report.errors.push(format!(
          "terminal {} has an unrecognized terminal type '{}'",
          node_id, other
        ));
      }
    }
  }
}

fn resolve_move(
  node_id: &str,
  mv: &CertificateMove,
  pos: &Chess,
  report: &mut VerifyReport,
) -> Option<Chess> {
  let uci = match Uci::from_ascii(mv.uci.as_bytes()) {
    Ok(u) => u,
    Err(_) => {
      report.errors.push(format!(
        "node {} move '{}' is not valid UCI notation",
        node_id, mv.uci
      ));
      return None;
    }
  };
  let parsed = match uci.to_move(pos) {
    Ok(m) => m,
    Err(_) => {
      report.errors.push(format!(
        "node {} move '{}' is illegal in the replayed position",
        node_id, mv.uci
      ));
      return None;
    }
  };
  match pos.clone().play(&parsed) {
    Ok(child) => Some(child),
    Err(_) => {
      report.errors.push(format!(
        "node {} move '{}' could not be played",
        node_id, mv.uci
      ));
      None
    }
  }
}

fn parse_fen(fen: &str) -> Result<Chess, String> {
  Fen::from_ascii(fen.as_bytes())
    .map_err(|e| format!("invalid FEN: {e}"))?
    .into_setup()
    .position::<Chess>(CastlingMode::Standard)
    .map_err(|e| format!("illegal position: {e}"))
}

fn zobrist_hex(pos: &Chess) -> String {
  let hash: Zobrist64 = pos.zobrist_hash(EnPassantMode::Legal);
  format!("0x{:016x}", hash.0)
}

fn color_name(color: Color) -> &'static str {
  if color == Color::White {
    "white"
  } else {
    "black"
  }
}
