//! Proof-number search (PNS) over AND/OR trees.
//!
//! Given a position and a claiming side, PNS proves whether that side has a
//! forced win, or (in `at_least_draw` mode) can force at least a draw. The
//! search tree alternates:
//!   - **OR nodes**  (claiming side to move): proved if *any* child is proved;
//!     the side needs one move that holds.
//!   - **AND nodes** (opponent to move): proved only if *every* legal reply is
//!     proved; the certificate must cover all of them.
//!
//! Terminals:
//!   - opponent checkmated -> proved for both claim kinds;
//!   - claiming side checkmated -> disproved for both claim kinds;
//!   - stalemate -> disproved for `win` (no mate delivered), proved for
//!     `at_least_draw`;
//!   - a Syzygy probe (when `tablebase_path` is configured) -> see
//!     `tb::outcome_for_claim` for the per-claim WDL truth table;
//!   - a move back to a position already on the current path -> disproved
//!     for `win` (so win certs stay acyclic exactly as before), a
//!     `transposition` terminal for `at_least_draw` (a closed fortress loop
//!     the defender can shuffle inside forever).
//!
//! A `win` proof makes monotonic progress toward checkmate, so its tree is
//! finite and acyclic by construction -- the verifier's acyclicity
//! requirement for `win` claims falls out for free. `at_least_draw` proofs
//! are explicitly allowed to close cycles via the `transposition` terminal.

use serde::{Deserialize, Serialize};
use shakmaty::fen::Fen;
use shakmaty::zobrist::{Zobrist64, ZobristHash};
use shakmaty::{CastlingMode, Chess, Color, EnPassantMode, Move, Position};

use crate::certificate::{Certificate, Claim, Dependencies, Metadata, MoveEdge, Node, Terminal};
use crate::tb::{outcome_for_claim, TbOracle};
use crate::time::now_rfc3339;

/// Sentinel for a proved (proof number 0 side) / disproved (disproof number 0
/// side) resource. Kept well below `u32::MAX` so saturating sums never overflow.
const INF: u32 = 1_000_000_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClaimValue {
  #[default]
  Win,
  AtLeastDraw,
}

impl ClaimValue {
  fn as_str(self) -> &'static str {
    match self {
      ClaimValue::Win => "win",
      ClaimValue::AtLeastDraw => "at_least_draw",
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProofSearchConfig {
  pub max_nodes: usize,
  pub time_limit_ms: u64,
  pub tablebase_path: Option<String>,
  #[serde(default)]
  pub claim: ClaimValue,
}

impl Default for ProofSearchConfig {
  fn default() -> Self {
    ProofSearchConfig {
      max_nodes: 2_000_000,
      time_limit_ms: 30_000,
      tablebase_path: None,
      claim: ClaimValue::Win,
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

/// Terminal classification. Only the "proved" variants (everything except
/// `CheckmateLoss`, `InsufficientMaterial`, and `TablebaseFail`) ever reach
/// `emit` -- a disproved leaf can never be part of a proved subtree.
#[derive(Clone, Copy, PartialEq)]
enum Term {
  CheckmateWin,
  CheckmateLoss,
  Stalemate,
  /// Fails a `win` claim. Never classified under `at_least_draw`: that path
  /// leaves the position unresolved instead, so it either lands on a real
  /// Syzygy draw or gets closed by a transposition terminal.
  InsufficientMaterial,
  TablebaseWin,
  TablebaseDraw,
  TablebaseFail,
  Transposition,
}

struct PnsNode {
  pos: Chess,
  zobrist: String,
  is_or: bool,
  pn: u32,
  dn: u32,
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

  /// Prove `self.config.claim` for `claim_side` (default: side to move) from
  /// `fen`. On success the returned outcome carries a ready-to-serialize
  /// certificate.
  pub fn prove(&self, fen: &str, claim_side: Option<Color>) -> Result<ProveOutcome, String> {
    let pos = parse_fen(fen)?;
    let side = claim_side.unwrap_or_else(|| pos.turn());

    let tb = match &self.config.tablebase_path {
      Some(path) => Some(
        TbOracle::new(std::path::Path::new(path))
          .map_err(|e| format!("failed to load syzygy tables from {path}: {e}"))?,
      ),
      None => None,
    };

    let start = std::time::Instant::now();
    let mut solver = Solver::new(pos, side, &self.config, tb.as_ref());
    let proven = solver.run(start);

    let result = ProofSearchResult {
      proven,
      nodes_explored: solver.arena.len(),
      elapsed_ms: start.elapsed().as_millis(),
      claim_value: self.config.claim.as_str().to_string(),
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
  tb: Option<&'a TbOracle>,
}

impl<'a> Solver<'a> {
  fn new(
    root_pos: Chess,
    side: Color,
    config: &'a ProofSearchConfig,
    tb: Option<&'a TbOracle>,
  ) -> Self {
    let mut solver = Solver {
      arena: Vec::new(),
      side,
      config,
      tb,
    };
    let root = solver.make_leaf(root_pos, None);
    solver.arena.push(root);
    solver
  }

  /// Classify a position as a terminal from the claiming side's perspective
  /// under the configured claim, or `None` if play continues.
  fn evaluate(&self, pos: &Chess) -> Option<Term> {
    if pos.is_checkmate() {
      return Some(if pos.turn() == self.side {
        Term::CheckmateLoss
      } else {
        Term::CheckmateWin
      });
    }
    if pos.is_stalemate() {
      return Some(Term::Stalemate);
    }
    if self.config.claim == ClaimValue::Win && pos.is_insufficient_material() {
      return Some(Term::InsufficientMaterial);
    }
    if let Some(tb) = self.tb {
      if pos.board().occupied().count() <= tb.max_pieces() && !pos.castles().any() {
        if let Some(wdl) = tb.probe(pos, self.side) {
          return Some(match outcome_for_claim(wdl, self.config.claim) {
            Some("win") => Term::TablebaseWin,
            Some("draw") => Term::TablebaseDraw,
            Some(_) => unreachable!("outcome_for_claim only returns \"win\" or \"draw\""),
            None => Term::TablebaseFail,
          });
        }
      }
    }
    None
  }

  /// Build an unexpanded leaf, evaluating it immediately for terminal status.
  fn make_leaf(&self, pos: Chess, parent: Option<usize>) -> PnsNode {
    let is_or = pos.turn() == self.side;
    let zobrist = zobrist_hex(&pos);
    let (pn, dn, terminal) = match self.evaluate(&pos) {
      Some(term @ (Term::CheckmateWin | Term::TablebaseWin | Term::TablebaseDraw)) => {
        (0, INF, Some(term))
      }
      Some(Term::Stalemate) if self.config.claim == ClaimValue::AtLeastDraw => {
        (0, INF, Some(Term::Stalemate))
      }
      Some(other) => (INF, 0, Some(other)),
      None => (1, 1, None),
    };
    PnsNode {
      pos,
      zobrist,
      is_or,
      pn,
      dn,
      terminal,
      children: Vec::new(),
      moves: Vec::new(),
      parent,
    }
  }

  /// A proved terminal representing a closed loop back to an ancestor
  /// position. Only ever created for `at_least_draw` claims.
  fn make_transposition_leaf(&self, pos: Chess, parent: Option<usize>) -> PnsNode {
    let zobrist = zobrist_hex(&pos);
    PnsNode {
      is_or: pos.turn() == self.side,
      pos,
      zobrist,
      pn: 0,
      dn: INF,
      terminal: Some(Term::Transposition),
      children: Vec::new(),
      moves: Vec::new(),
      parent,
    }
  }

  /// Whether `zobrist` matches `idx` or any of its ancestors.
  fn path_contains_zobrist(&self, idx: usize, zobrist: &str) -> bool {
    let mut cur = Some(idx);
    while let Some(i) = cur {
      if self.arena[i].zobrist == zobrist {
        return true;
      }
      cur = self.arena[i].parent;
    }
    false
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

  /// Generate all legal children of a non-terminal leaf. Under
  /// `at_least_draw`, a child whose zobrist repeats an ancestor becomes a
  /// `transposition` terminal instead of an ordinary continuation -- see the
  /// module doc comment.
  fn expand(&mut self, idx: usize) {
    let pos = self.arena[idx].pos.clone();
    for mv in pos.legal_moves() {
      let child_pos = pos.clone().play(&mv).expect("legal move plays");

      let child = if self.config.claim == ClaimValue::AtLeastDraw
        && self.path_contains_zobrist(idx, &zobrist_hex(&child_pos))
      {
        self.make_transposition_leaf(child_pos, Some(idx))
      } else {
        self.make_leaf(child_pos, Some(idx))
      };

      let child_idx = self.arena.len();
      self.arena.push(child);
      self.arena[idx].children.push(child_idx);
      self.arena[idx].moves.push(mv);
    }
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

    let has_tablebase_terminal = nodes.iter().any(|n| {
      n.terminal
        .as_ref()
        .is_some_and(|t| t.terminal_type == "tablebase")
    });

    Certificate {
      format_version: "0.1".to_string(),
      claim: Claim {
        fen: fen.to_string(),
        zobrist: zobrist_hex(&self.arena[0].pos),
        value: self.config.claim.as_str().to_string(),
        side: color_name(side).to_string(),
      },
      rules: "standard".to_string(),
      root_id,
      nodes,
      dependencies: Dependencies {
        tablebase: has_tablebase_terminal.then(|| "syzygy".to_string()),
      },
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
    let zobrist = node.zobrist.clone();
    let to_move = color_name(node.pos.turn()).to_string();

    if let Some(term) = node.terminal {
      let (terminal_type, value) = match term {
        Term::CheckmateWin => ("checkmate", "win"),
        Term::Stalemate => ("stalemate", "draw"),
        Term::TablebaseWin => ("tablebase", "win"),
        Term::TablebaseDraw => ("tablebase", "draw"),
        Term::Transposition => ("transposition", "draw"),
        Term::CheckmateLoss | Term::InsufficientMaterial | Term::TablebaseFail => {
          unreachable!("disproved terminal can never be part of a proved subtree")
        }
      };
      nodes.push(Node {
        id: id.clone(),
        zobrist,
        to_move,
        kind: "terminal".to_string(),
        moves: Vec::new(),
        terminal: Some(Terminal {
          terminal_type: terminal_type.to_string(),
          value: Some(value.to_string()),
          dtm: None,
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
