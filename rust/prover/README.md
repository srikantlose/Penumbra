# penumbra-prover

Proof-number search (PNS) prover for Penumbra. Given a position and a claiming
side, it searches the AND/OR game tree for a **forced win** and, on success,
emits a v0.1 `.pnbcert` certificate that [`penumbra-verify`](../verifier) accepts.

## What it proves today

The prover produces **self-contained forced-mate certificates**: the proof tree
bottoms out in real checkmate terminals, so nothing outside the certificate
(no tablebase, no engine) is needed to check it. This is the core PNS
deliverable for M2 and exercises the full AND/OR machinery:

- **OR nodes** (claiming side to move) — proved if *any* one move wins; the
  certificate records the single winning move.
- **AND nodes** (opponent to move) — proved only if *every* legal reply is
  covered; the certificate records all of them.

`at_least_draw` / fortress claims are a follow-on: they need either Syzygy
tablebase terminals or repetition/50-move closure, which the search does not
yet model.

## Usage

```
penumbra-prove prove "<FEN>" [--side white|black] [-o out.pnbcert] [--compress]
                              [--max-nodes N] [--time-ms MS]
```

`--side` defaults to the side to move. Without `-o`, the certificate is written
to stdout as plain JSON; a one-line search summary (`proven=… nodes=… elapsed=…ms`)
always goes to stderr. Exit code is 0 when a win is proved, 1 otherwise.

With `-o`, the file is written as a `PNBC`-prefixed container (see
[`CERTIFICATE_FORMAT.md`](../../docs/CERTIFICATE_FORMAT.md#wire-format)); add
`--compress` to zstd-compress the payload inside that container. `penumbra-verify`
auto-detects either form, and still reads certificates with no `PNBC` prefix at
all (every one written before this container existed).

```sh
# Morphy's mate-in-two: 1.Ra6! and every black reply is mated.
penumbra-prove prove "kbK5/pp6/1P6/8/8/8/8/R7 w - - 0 1" -o morphy.pnbcert
penumbra-verify verify morphy.pnbcert
```

## Examples

Ready-made certificates live in [`examples/`](examples): a back-rank mate-in-one,
Morphy's mate-in-two (a single AND node covering all seven of black's replies),
and a two-rook mate. Each verifies clean.

## Tests

`cargo test -p penumbra-prover` runs the round-trip suite in
[`tests/prove_and_verify.rs`](tests/prove_and_verify.rs): it proves a set of
known mates, serializes each certificate, and feeds it through the verifier,
asserting the report is valid.
