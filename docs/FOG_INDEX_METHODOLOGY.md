# Fog Index Methodology

## Overview

The **Fog Index** is a 0–100 metric quantifying the "unsolvedness" of a chess position. It is **explicitly an EVALUATED-tier metric** — an engine opinion with known error bars — and is never used to make claims about ground truth.

**Version:** 0.1  
**Formula:** `Fog = round(100 · g · (0.30·d + 0.25·v + 0.25·c + 0.20·t))`

## Key principles

1. **Deterministic and reproducible** — canonical engine settings, fixed search depths, single-threaded execution.
2. **Two-architecture disagreement as signal** — Stockfish (NNUE traditional eval) vs. Lc0 (neural net policy/value) fail differently; their disagreement is real epistemic signal about murky positions.
3. **Count-up, never divide** — Fog is an absolute score, not a percentage of chess solved. Scaling matters.
4. **Cached and invalidated on engine upgrade** — Engine fingerprints track every eval forever; formula updates compute lazily.

## Engine settings (canonical)

### Stockfish
- **Pin:** Exact release + NNUE net (e.g., Stockfish 16 + nn-62ef2d139a3d.nnue)
- **Options:** `Threads=1`, `Hash=256MB`, `MultiPV=4`, `UCI_ShowWDL=on`
- **Search:** Fixed-node ladder: **1M, 4M, 16M, 64M nodes** (single-threaded, deterministic)
- **Time:** ~60–90 seconds per position at 64M nodes

### Lc0
- **Pin:** Exact release + network weights (e.g., Lc0 0.31.0 + 42069 network)
- **Options:** `MultiPV=4`, GPU backend
- **Search:** Fixed **30k nodes** (policy+value net has no iterative deepening concept; node count is the throttle)
- **Time:** ~2–4 seconds per position

### Engine fingerprint
Hash all canonical settings (engine binary, net id, nodes, MultiPV, UCI options) into a **SHA256 fingerprint**. Every stored eval carries it. This allows:
- Recomputation when engines upgrade (new fingerprint = lazy recompute on next access).
- Eval archaeology (history preserved forever; upgrades create new rows in the table, not overwrites).
- Credible caching (same fen + fingerprint = byte-identical result).

## Components (each [0, 1])

### 1. Disagreement (`d`)

**Intuition:** Positions where Stockfish and Lc0 materially diverge are genuinely murky.

**Formula:**
```
wp_SF = (wins_SF + 0.5 · draws_SF) / total_SF
wp_Lc0 = (wins_Lc0 + 0.5 · draws_Lc0) / total_Lc0

d = clamp(|wp_SF − wp_Lc0| / 0.35, 0, 1)
```

**Notes:**
- Win probability (wp) = (W + 0.5·D) / (W+D+L); captures uncertainty.
- 0.35 threshold: ±17.5% disagreement in wp saturates the component.
- Engines can disagree on direction (SF says +2, Lc0 says −1) or magnitude; both are captured.

### 2. Depth volatility (`v`)

**Intuition:** Evals that swing wildly as search deepens are unstable.

**Formula:**
```
wp_ladder = [wp_SF at 1M, 4M, 16M, 64M nodes]
σ = std_dev(wp_ladder)

v = clamp(σ / 0.12, 0, 1)
```

**Notes:**
- 0.12 threshold: σ > 0.12 saturates (significant volatility).
- Captures horizon effects, weak pawn structures that improve under scrutiny, etc.

### 3. Move criticality (`c`)

**Intuition:** Positions with one forced move are more determined than those with eight playable options.

**Formula:**
```
k = count of Stockfish MultiPV moves within 0.06 wp of the best move at 64M nodes
   (capped by MultiPV=4, so k ∈ [1, 4])

c = (k − 1) / 3
```

**Notes:**
- k=1 (only move) → c=0 (forced, low fog).
- k=4 (four equally playable) → c=1 (deep fog).
- MultiPV=4 limitation in v0.1; refined to higher multipv in later versions.

### 4. Tablebase distance (`t`)

**Intuition:** Early middlegame is far from tablebase; endgames with few pieces are close.

**Formula:**
```
n = piece count
t = clamp((n − 7) / 9, 0, 1)
```

**Notes:**
- n=7 (tablebase boundary) → t=0.
- n=16 (all pieces on board) → t=1.
- Saturates at boundaries; gives resolution in the 8–16 piece band where most games live.

### 5. Proof gate (`g`)

**Intuition:** If a position is proven, stop computing fog (it's PROVEN status). If a child position is proven, defense is confined (lower fog).

**Formula:**
```
g = 0        if position is PROVEN (tablebase n≤7 or Ledger certificate)
g = 0.85     if ≥1 child position is PROVEN
g = 1        otherwise
```

**Notes:**
- Proof gate short-circuits evaluation; no engine run if proven.
- 0.85 value: defenders confined to non-losing line(s); still some complexity but bounded.

## Final score

```
weighted = 0.30·d + 0.25·v + 0.25·c + 0.20·t

Fog = round(100 · g · weighted)
```

Weights calibrated on training corpus to balance signals; revised per formula version.

## Calibration and percentiles

**Corpus:** 100,000 positions from Lichess elite database (plies 10–80, 2015–2025).

**CDF (v0.1):**
| Percentile | Score |
|---|---|
| 1st | 5 |
| 5th | 12 |
| 10th | 18 |
| 25th | 30 |
| 50th (median) | 45 |
| 75th | 62 |
| 90th | 78 |
| 95th | 87 |
| 99th | 94 |

**QA Set:** ~200 hand-curated positions with expected fog bands:
- Famous fortresses (known engine-fail positions): high fog (80–100).
- Forced tactics (e.g., back-rank mates): low fog (0–20).
- Quiet symmetric endings: low-mid fog (20–40).
- Imbalanced positions (two rooks vs. R+B+N): mid fog (40–60).

**Release gate:** QA set must land within expected bands before publishing a new formula version.

## Caching and invalidation

### Storage
- Table `fog_scores(position_id, formula_version, engine_fingerprint, score, components, percentile, created_at)`.
- Append-only; **never overwrite or delete** (eval archaeology depends on history).
- Query `current = SELECT * FROM fog_scores WHERE position_id=? AND formula_version=? AND engine_fingerprint=? ORDER BY created_at DESC LIMIT 1`.

### Invalidation
- **Engine upgrade:** New fingerprint → lazy recompute on next API call.
- **Formula change:** New formula_version → new rows; old data stays (backward-compatible archaeology).
- **Tablebase change:** Positions move from EVALUATED to PROVEN; new row with updated proof_gate.

### API response
Every Fog score includes:
```json
{
  "score": 45,
  "status": "EVALUATED",
  "components": { "d": 0.12, "v": 0.08, "c": 0.25, "t": 0.60, "g": 1.0 },
  "formula_version": "0.1",
  "engine_fingerprint": "0xabcd...",
  "percentile": 52.3,
  "computed_at": "2024-07-07T12:00:00Z"
}
```

## Versioning

Each formula version is independent:
- **v0.1** (current): Standard calibration.
- **v0.2** (future): May refine weights or add signals.
- **v1.0** (future): Major redesign.

Old versions remain queryable forever. Archives published per version.

## Limitations and honesty

1. **Not a solve metric.** Fog measures *engine uncertainty*, not game-theoretic truth. High Fog ≠ unsolved; Low Fog ≠ solved.
2. **Nondeterministic engines (SMP) not used.** Single-threaded fixed-node search is the only reproducible mode.
3. **Lc0 network variance.** Neural nets can drift; exact network weights pinned in the fingerprint.
4. **MultiPV=4 cap in v0.1.** Move criticality capped by MultiPV setting; refined later.
5. **Corpus bias.** Calibration on master-level games; may not transfer to endgame studies or compositions.

## Citing the Fog Index

**For journalists/commentators:**
> Position Foo is at Fog Index 94/100, meaning the world's strongest engines strongly disagree on its evaluation and its depth volatility is high — it's a deeply murky position.

**For researchers:**
> Fog Index v0.1 (Penumbra 2024) computed on position using Stockfish 16 + Lc0 0.31.0 with canonical settings [fingerprint]. See methodology [link].

---

## References

- **Polyglot zobrist:** https://www.chessprogramming.org/Zobrist-Hashing
- **Syzygy tablebases:** https://tablebase.lichess.org/
- **Stockfish source:** https://github.com/official-stockfish/Stockfish
- **Lc0 source:** https://github.com/LeelaChessZero/lc0
- **WDL (Wins-Draws-Losses):** https://www.chessprogramming.org/Multi-Cut
