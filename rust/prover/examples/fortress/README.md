# Fortress seed certificates

Ten `at_least_draw` certificates produced by `penumbra-prove --claim at_least_draw --syzygy
tablebases/syzygy/3-4-5`, spanning the three tiers from `docs/ROADMAP.md` Stage 2.4. Every
tablebase-dependent one verifies `Valid: true` with `--syzygy` and `Valid: false` without it
(soundness by default); the ones with no tablebase dependency (pure stalemate/transposition
proofs) verify clean either way, since there's nothing for `--syzygy` to gate.

**Validation protocol:** every candidate FEN was checked against
`https://tablebase.lichess.ovh/standard?fen=...` before proving (`category` must be `draw`, or
for Tier C's 8-10 man positions — beyond Lichess's own 7-man table range — cross-checked via its
per-move heuristic evaluation instead; see the Tier C notes below). Candidates that didn't
validate were discarded in favor of the next in the family.

To reproduce the verification:

```powershell
cargo build --workspace
./target/debug/penumbra-verify.exe verify rust/prover/examples/fortress/<name>.pnbcert --syzygy tablebases/syzygy/3-4-5
```

## Tier A — machinery smoke (root ≤5 men, resolves at the root)

| File | FEN | Claim side | Search nodes | Cert nodes | Terminal | Provenance |
|---|---|---|---|---|---|---|
| `tierA_kpk_dead_draw` | `8/8/8/8/8/2k5/2P5/2K5 b - - 0 1` | black | 1 | 1 | 1× tablebase (draw) | endpoint-validated (`category: draw`) — defender's king holds the square directly in front of the pawn |
| `tierA_wrong_bishop_rook_pawn` | `7k/8/6KP/8/8/8/8/1B6 b - - 0 1` | black | 1 | 1 | 1× tablebase (draw) | endpoint-validated (`category: draw`, `dtz: 0`) — light-squared bishop can't control the dark h8 promotion corner |
| `tierA_stalemate_at_root` | `6k1/6P1/6K1/8/8/8/1B6/8 b - - 0 1` | black | 1 | 1 | 1× stalemate | endpoint-validated (`category: draw`, `stalemate: true`) — black king on g8 has every escape square covered by the king and the pawn's diagonal reach, without being in check |
| `tierA_vancura_krpvkr` | `6k1/8/6PK/8/8/r7/8/1R6 b - - 0 1` | black | 1 | 1 | 1× tablebase (draw) | endpoint-validated (`category: draw`, `dtz: 0`) — Vancura-position rook holds off the king+rook+pawn |

## Tier B — shallow trees over tablebase terminals (6 men, liquidates within a few plies)

| File | FEN | Claim side | Search nodes | Cert nodes | Terminal breakdown | Provenance |
|---|---|---|---|---|---|---|
| `tierB_ocb_blockade_1` | `8/8/3k4/3p4/3P4/3K4/8/1B4b1 w - - 0 1` | white | 126 | 19 | 9× tablebase | endpoint-validated root (`category: draw`); opposite-colored-bishop pawn blockade — every capture line liquidates into the 3-4-5-man tables |
| `tierB_ocb_blockade_2` | `8/3k4/3p4/3P4/8/3K4/1B4b1/8 w - - 0 1` | white | 3725 | 47 | 22× tablebase | endpoint-validated root (`category: draw`); same OCB blockade pattern, different king files — wider proof tree |
| `tierB_triple_pawn_liquidation` | `7k/5ppp/5PPP/8/8/8/8/K7 w - - 0 1` | white | 20 | 5 | 1× tablebase | adjacent-file triple pawn chain — diagonal captures are available (unlike the Tier C chains below) and liquidate straight into a 5-man tablebase draw |

## Tier C — genuine fortress cycles (8-10 men, closes via repetition, not material)

Pawns are on non-adjacent files (b/d/f, or every other file), so **no capture is ever legal for
either side** — the only legal moves are king shuffles, and the proof closes purely by returning
to an already-seen position. These sit beyond Lichess's 7-man table coverage, so validation used
its per-move heuristic (`dtc`/`category` per candidate move) instead of a whole-position
category: the proof's own root move must land on that heuristic's `"category": "draw"` reply.

| File | FEN | Claim side | Search nodes | Cert nodes | Terminal breakdown | Provenance |
|---|---|---|---|---|---|---|
| `tierC_triple_pawn_fortress` | `k7/1p1p1p2/1P1P1P2/8/8/8/8/7K w - - 0 1` | white | 61,859 | 35 | 9× transposition | **showcase.** Lichess's own per-move breakdown for this exact position lists `h1g1` (the proof's root move) as `"category": "draw"`, `dtc: 0`, while the alternatives `h1g2`/`h1h2` are `"maybe-loss"` — independent confirmation that the proof's move choice, not just its destination, is the correct one |
| `tierC_quad_pawn_fortress` | `7k/p1p1p1p1/P1P1P1P1/8/8/8/8/K7 w - - 0 1` | white | 47 | 23 | 7× transposition | showcase — four locked pawn pairs (10 men total), same non-adjacent-file cage pattern |
| `tierC_opposite_corners` | `k6K/1p1p1p2/1P1P1P2/8/8/8/8/8 w - - 0 1` | white | 62 | 16 | 2× transposition, 1× stalemate | showcase — kings in opposite corners; one branch of the proof closes via stalemate instead of a repeat |

## Notes

- No certificate emits `dtm` — Syzygy tables give DTZ (distance to zeroing), not DTM, and the two
  are not interchangeable (see `docs/CERTIFICATE_FORMAT.md`).
- The Tier C certificates verify `Valid: true` even without `--syzygy`, since a certificate with
  zero tablebase terminals has nothing for that policy to gate.
