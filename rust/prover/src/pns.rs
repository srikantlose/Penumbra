//! Proof-number search (PNS) over AND/OR trees.
//!
//! Given a position and a claiming side, PNS proves whether that side has a
//! forced win. The search tree alternates:
//!   - **OR nodes**  (claiming side to move): proved if *any* child is proved;
//!     the side needs one winning move.
//!   - **AND nodes** (opponent to move): proved only if *every* legal reply is
//!     proved; the certificate must cover all of them.
//!
//! Terminals are recognised directly (no external tablebase needed):
//!   - opponent checkmated -> win for the claiming side (proved leaf);
//!   - claiming side checkmated, or any stalemate / insufficient-material draw
//!     -> not a win (disproved leaf).
//!
//! Because a forced mate makes monotonic progress toward a checkmate, the proof
//! tree is finite and acyclic, so the extracted certificate satisfies the
//! verifier's acyclicity requirement for `win` claims.

use serde::{Deserialize, Serialize};
use shakmaty::fen::Fen;
use shakmaty::zobrist::{Zobrist64, ZobristHash};
use shakmaty::{CastlingMode, Chess, Color, EnPassantMode, Move, Position};

use crate::certificate::{Certificate, Claim, Dependencies, Metadata, MoveEdge, Node, Terminal};
use crate::time::now_rfc3339;

/// Sentinel for a proved (proof number 0 side) / disproved (disproof number 0
/// side) resource. Kept well below `u32::MAX` so saturating sums never overflow.
const INF: u32 = 1_000_000_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProofSearchConfig {
  pub max_nodes: usize,
  pub time_limit_ms: u64,
  pub tablebase_path: Option<String>,
}

impl Default for ProofSearchConfig {
  fn default() -> Self {
    ProofSearchConfig {
      max_nodes: 2_000_000,
      time_limit_ms: 30_000,
      tablebase_path: None,
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProofSearchResult {
  pub proven: bool,
  pub nodes_explored: usize,
  pub elapsed_ms: u128,
  pub claim_value: String,
}

/// Outcome of a proof attempt: a summary plus, when proved, the certificate.
#[derive(Debug)]
pub struct ProveOutcome {
  pub result: ProofSearchResult,
  pub certificate: Option<Certificate>,
}

/// Terminal classification from the claiming side's perspective.
#[derive(Clone, Copy, PartialEq)]
enum Term {
  Win,
  Loss,
  Draw,
}

struct PnsNode {
  pos: Chess,
  is_or: bool,
  pn: u32,
  dn: u32,
  expanded: bool,
  terminal: Option<Term>,
  children: Vec<usize>,
  moves: Vec<Move>,
  parent: Option<usize>,
}

pub struct ProofNumberSearch {
  config: ProofSearchConfig,
}

impl ProofNumberSearch {
  pub fn new(config: ProofSearchConfig) -> Self {
    ProofNumberSearch { config }
  }

  /// Backwards-compatible summary entry point (defaults the claim side to the
  /// side to move).
  pub fn search(&self, fen: &str) -> Result<ProofSearchResult, String> {
    Ok(self.prove(fen, None)?.result)
  }

  /// Prove that `claim_side` (default: side to move) has a forced win from
  /// `fen`. On success the returned outcome carries a ready-to-serialize
  /// certificate.
  pub fn prove(&self, fen: &str, claim_side: Option<Color>) -> Result<ProveOutcome, String> {
    let pos = parse_fen(fen)?;
    let side = claim_side.unwrap_or_else(|| pos.turn());

    let start = std::time::Instant::now();
    let mut solver = Solver::new(pos, side, &self.config);
    let proven = solver.run(start);

    let result = ProofSearchResult {
      proven,
      nodes_explored: solver.arena.len(),
      elapsed_ms: start.elapsed().as_millis(),
      claim_value: "win".to_string(),
    };

    let certificate = if proven {
      Some(solver.build_certificate(fen, side))
    } else {
      None
    };

    Ok(ProveOutcome {
      result,
      certificate,
    })
  }
}

struct Solver<'a> {
  arena: Vec<PnsNode>,
  side: Color,
  config: &'a ProofSearchConfig,
}

impl<'a> Solver<'a> {
  fn new(root_pos: Chess, side: Color, config: &'a ProofSearchConfig) -> Self {
    let mut solver = Solver {
      arena: Vec::new(),
      side,
      config,
    };
    let root = solver.make_leaf(root_pos, None);
    solver.arena.push(root);
    solver
  }

  /// Build an unexpanded leaf, evaluating it immediately for terminal status.
  fn make_leaf(&self, pos: Chess, parent: Option<usize>) -> PnsNode {
    let is_or = pos.turn() == self.side;
    let (pn, dn, terminal) = match evaluate(&pos, self.side) {
      Some(Term::Win) => (0, INF, Some(Term::Win)),
      Some(other) => (INF, 0, Some(other)),
      None => (1, 1, None),
    };
    PnsNode {
      pos,
      is_or,
      pn,
      dn,
      expanded: false,
      terminal,
      children: Vec::new(),
      moves: Vec::new(),
      parent,
    }
  }

  fn run(&mut self, start: std::time::Instant) -> bool {
    loop {
      let root = &self.arena[0];
      if root.pn == 0 {
        return true;
      }
      if root.dn == 0 {
        return false;
      }
      if self.arena.len() >= self.config.max_nodes {
        return false;
      }
      if start.elapsed().as_millis() as u64 >= self.config.time_limit_ms {
        return false;
      }

      let mpn = self.select_most_proving(0);
      // A terminal leaf is never the most-proving node while the root is
      // unsolved; guard defensively regardless.
      if self.arena[mpn].terminal.is_some() {
        return self.arena[0].pn == 0;
      }
      self.expand(mpn);
      self.backup(mpn);
    }
  }

  /// Descend from `idx` following the resource that determines each node's
  /// number until reaching a leaf (a node with no children).
  fn select_most_proving(&self, mut idx: usize) -> usize {
    while !self.arena[idx].children.is_empty() {
      let node = &self.arena[idx];
      idx = if node.is_or {
        *node
          .children
          .iter()
          .min_by_key(|&&c| self.arena[c].pn)
          .expect("expanded node has children")
      } else {
        *node
          .children
          .iter()
          .min_by_key(|&&c| self.arena[c].dn)
          .expect("expanded node has children")
      };
    }
    idx
  }

  /// Generate all legal children of a non-terminal leaf.
  fn expand(&mut self, idx: usize) {
    let pos = self.arena[idx].pos.clone();
    for mv in pos.legal_moves() {
      let child_pos = pos.clone().play(&mv).expect("legal move plays");
      let child = self.make_leaf(child_pos, Some(idx));
      let child_idx = self.arena.len();
      self.arena.push(child);
      self.arena[idx].children.push(child_idx);
      self.arena[idx].moves.push(mv);
    }
    self.arena[idx].expanded = true;
  }

  /// Recompute proof/disproof numbers from `idx` up to the root.
  fn backup(&mut self, idx: usize) {
    let mut cur = idx;
    loop {
      let node = &self.arena[cur];
      let (pn, dn) = if node.children.is_empty() {
        (node.pn, node.dn)
      } else if node.is_or {
        let pn = node
          .children
          .iter()
          .map(|&c| self.arena[c].pn)
          .min()
          .unwrap();
        let dn = sat_sum(node.children.iter().map(|&c| self.arena[c].dn));
        (pn, dn)
      } else {
        let pn = sat_sum(node.children.iter().map(|&c| self.arena[c].pn));
        let dn = node
          .children
          .iter()
          .map(|&c| self.arena[c].dn)
          .min()
          .unwrap();
        (pn, dn)
      };

      self.arena[cur].pn = pn;
      self.arena[cur].dn = dn;

      match self.arena[cur].parent {
        Some(parent) => cur = parent,
        None => break,
      }
    }
  }

  fn build_certificate(&self, fen: &str, side: Color) -> Certificate {
    let mut nodes = Vec::new();
    let mut next_id = 1usize;
    let root_id = self.emit(0, &mut nodes, &mut next_id);

    Certificate {
      format_version: "0.1".to_string(),
      claim: Claim {
        fen: fen.to_string(),
        zobrist: zobrist_hex(&self.arena[0].pos),
        value: "win".to_string(),
        side: color_name(side).to_string(),
      },
      rules: "standard".to_string(),
      root_id,
      nodes,
      dependencies: Dependencies::default(),
      metadata: Metadata {
        producer: "penumbra-prover 0.1".to_string(),
        timestamp: now_rfc3339(),
        contributors: None,
        work_units: None,
      },
    }
  }

  /// Emit the proved subtree rooted at `idx` into `nodes`, returning its id.
  /// OR nodes emit one proved move; AND nodes emit every legal move (all proved).
  fn emit(&self, idx: usize, nodes: &mut Vec<Node>, next_id: &mut usize) -> String {
    let node = &self.arena[idx];
    let id = if idx == 0 {
      "root".to_string()
    } else {
      let s = format!("n{}", *next_id);
      *next_id += 1;
      s
    };
    let zobrist = zobrist_hex(&node.pos);
    let to_move = color_name(node.pos.turn()).to_string();

    if node.terminal.is_some() {
      nodes.push(Node {
        id: id.clone(),
        zobrist,
        to_move,
        kind: "terminal".to_string(),
        moves: Vec::new(),
        terminal: Some(Terminal {
          terminal_type: "checkmate".to_string(),
          value: Some("win".to_string()),
        }),
      });
      return id;
    }

    if node.is_or {
      let choice = node
        .children
        .iter()
        .position(|&c| self.arena[c].pn == 0)
        .expect("proved OR node has a proved child");
      let child_id = self.emit(node.children[choice], nodes, next_id);
      nodes.push(Node {
        id: id.clone(),
        zobrist,
        to_move,
        kind: "or-node".to_string(),
        moves: vec![MoveEdge {
          uci: node.moves[choice]
            .to_uci(CastlingMode::Standard)
            .to_string(),
          child_id,
        }],
        terminal: None,
      });
    } else {
      let mut edges = Vec::with_capacity(node.children.len());
      for (i, &child) in node.children.iter().enumerate() {
        let child_id = self.emit(child, nodes, next_id);
        edges.push(MoveEdge {
          uci: node.moves[i].to_uci(CastlingMode::Standard).to_string(),
          child_id,
        });
      }
      nodes.push(Node {
        id: id.clone(),
        zobrist,
        to_move,
        kind: "and-node".to_string(),
        moves: edges,
        terminal: None,
      });
    }

    id
  }
}

fn parse_fen(fen: &str) -> Result<Chess, String> {
  Fen::from_ascii(fen.as_bytes())
    .map_err(|e| format!("invalid FEN: {e}"))?
    .into_setup()
    .position::<Chess>(CastlingMode::Standard)
    .map_err(|e| format!("illegal position: {e}"))
}

/// Classify a position as a terminal from the claiming side's perspective, or
/// `None` if play continues.
fn evaluate(pos: &Chess, side: Color) -> Option<Term> {
  if pos.is_checkmate() {
    return Some(if pos.turn() == side {
      Term::Loss
    } else {
      Term::Win
    });
  }
  if pos.is_stalemate() || pos.is_insufficient_material() {
    return Some(Term::Draw);
  }
  None
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

/// Sum of proof/disproof numbers, saturating at `INF` to avoid overflow across
/// wide move lists.
fn sat_sum<I: Iterator<Item = u32>>(iter: I) -> u32 {
  let mut sum: u64 = 0;
  for value in iter {
    sum += value as u64;
    if sum >= INF as u64 {
      return INF;
    }
  }
  sum as u32
}
