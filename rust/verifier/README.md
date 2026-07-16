# penumbra-verify

Verifier for Penumbra chess proof certificates (`.pnbcert`), fully offline by
default. A certificate claims a specific outcome (mate-in-*n*, a proven draw,
a dead fortress) for a specific position; this tool independently replays the
claimed line move-by-move against the position's legal moves and confirms
the terminal, without trusting whatever engine or prover produced the
certificate in the first place. Tablebase-backed terminals need either a
local Syzygy directory or (optionally, trading offline-ness for convenience)
a network tablebase endpoint — see `--syzygy`/`--tb-endpoint` below.

Certificate format: see [`docs/CERTIFICATE_FORMAT.md`](https://github.com/srikantlose/Penumbra/blob/master/docs/CERTIFICATE_FORMAT.md)
in the main repository.

## Install

```bash
cargo install penumbra-verify
```

## Usage

```bash
penumbra-verify verify path/to/certificate.pnbcert
```

Exits `0` and prints `Valid: true` if every move in the certificate's line is
legal and the claimed terminal (checkmate, stalemate, insufficient material,
or a Syzygy-confirmed tablebase result) actually holds. Exits non-zero and
prints `Valid: false` with a reason otherwise — including if a single byte of
the certificate is altered.

Flags:
- `--syzygy <dir>` — point at a local Syzygy tablebase directory to verify
  certificates whose terminal is a tablebase result rather than mate/stalemate.
  Omit for certificates that terminate in checkmate/stalemate/insufficient
  material, which need no tablebase at all.
- `--tb-endpoint <url>` — probe a Lichess-compatible tablebase HTTP API (e.g.
  `https://tablebase.lichess.ovh/standard`) instead of local files. Covers the
  same ≤7 men as `--syzygy` without the ~1GB table download, at the cost of a
  network round trip per tablebase terminal and trusting the remote service's
  answer rather than computing it yourself. Ignored if `--syzygy` is also given.
- `--offline` — explicit no-tablebase mode (same effect as omitting both
  `--syzygy` and `--tb-endpoint`; overrides either if also passed).
- `--structural-only` — check the certificate's shape and hashes without
  replaying the line; useful for quickly rejecting malformed input.
- `--assume-tb` — accept tablebase terminals on faith instead of probing.
  **Unsound** — only for inspecting a certificate's claims, never for actually
  trusting its result.

`penumbra-verify inspect path/to/certificate.pnbcert` prints a certificate's
contents (position, claimed line, terminal, hashes) without verifying anything,
for quick human inspection.

## Example

This repository ships example certificates under `rust/prover/examples/` (not
part of this published crate, but available in the source repository):

```bash
penumbra-verify verify morphy_mate_in_2.pnbcert
# Valid: true
```

Flip any byte in the file and the same command prints `Valid: false`.

## License

GPL-3.0-or-later. This crate links [`shakmaty`](https://crates.io/crates/shakmaty)
and [`shakmaty-syzygy`](https://crates.io/crates/shakmaty-syzygy), both
GPL-3.0-or-later, for move generation and tablebase probing. See
[`docs/gpl-compliance.md`](https://github.com/srikantlose/Penumbra/blob/master/docs/gpl-compliance.md)
in the main repository for the full rationale.
