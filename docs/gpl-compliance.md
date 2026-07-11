# GPL Compliance Notes

This document records why parts of Penumbra are GPL-3.0-or-later, which
distribution surfaces that touches, and what obligations each surface carries.
It's the reference `docs/DEVELOPMENT.md`'s Licenses section points to.

## Why the verifier and prover are GPL

`rust/verifier` (`penumbra-verify`) and `rust/prover` (`penumbra-prover`) both
depend directly on `shakmaty` and `shakmaty-syzygy` for move generation and
Syzygy tablebase probing. Both crates are licensed **GPL-3.0-or-later**
upstream. GPL is copyleft: any binary that statically or dynamically links a
GPL-licensed crate must itself be distributed under a GPL-compatible license.
That makes an Apache-2.0 verifier legally incorrect the moment it links
`shakmaty` — the docs originally claimed Apache-2.0 for the verifier before
this was caught (see `docs/ROADMAP.md`'s decision log, 2026-07-08 GPL
finding); this doc and the per-crate `license` fields correct that.

The alternative — swapping `shakmaty`/`shakmaty-syzygy` for a permissively
licensed move generator and losing the matched Syzygy probing code — was
considered and rejected as disproportionately expensive for a certificate
verifier whose entire value proposition is auditability. GPL doesn't reduce
auditability; anyone can still read, build, and independently verify the
source. So the resolution is: license the crates that actually link GPL code
as GPL, and keep everything else (the spec, the schema, the fog methodology)
under the original permissive license.

## What's GPL-3.0-or-later vs. Apache-2.0 vs. private

| Component | License | Why |
|---|---|---|
| `rust/verifier` (`penumbra-verify`) | GPL-3.0-or-later | Links `shakmaty` + `shakmaty-syzygy` directly |
| `rust/prover` (`penumbra-prover`) | GPL-3.0-or-later | Links `shakmaty` + `shakmaty-syzygy` directly |
| `packages/cert-schema` | Apache-2.0 | Pure schema/types package, no GPL dependency |
| `docs/CERTIFICATE_FORMAT.md` (certificate spec) | Apache-2.0 | A spec document, not code that links anything |
| Fog Index methodology/spec (`docs/FOG_INDEX_METHODOLOGY.md`) | Apache-2.0 | A spec document, not code that links anything |
| Everything else (`apps/*`, `services/*`, other `packages/*`) | UNLICENSED (private) | Application code, not published |

Only `penumbra-verify` and `penumbra-prover` link GPL crates, so only those two
carry the GPL obligation. Nothing else in the workspace touches `shakmaty` or
`shakmaty-syzygy`, so copyleft doesn't propagate further up the stack —
`apps/api` and `apps/web` talk to the verifier/prover as separate OS processes
(spawned binaries), not as linked libraries, which is the same "mere
aggregation" boundary described below for the chess engines.

## Engine binaries: separate processes, not redistributed code

Stockfish and Lc0 (see `docs/ENGINES.md` for exact pins) are themselves
GPL-licensed engines, orchestrated by `services/analysis` over the UCI
protocol. Two things keep this outside the scope of Penumbra's own license
obligations:

1. **Separate processes, not linked code.** `services/analysis` spawns
   Stockfish/Lc0 as subprocesses and talks to them over stdin/stdout (UCI
   text protocol). There's no linking, no shared address space, no compiled
   dependency — this is the classic "mere aggregation" case GPL §5 and the
   FSF's own GPL FAQ describe as not triggering copyleft on the calling
   program. `apps/api`/`services/analysis` remain free to stay UNLICENSED.
2. **We don't redistribute the binaries ourselves.** `scripts/fetch-engines.mjs`
   downloads the exact pinned Stockfish and Lc0 releases directly from their
   own official upstream GitHub release pages and lczero.org's own network
   storage (URLs and hashes in `docs/ENGINES.md`) at build/setup time. Penumbra
   never bundles, modifies, or re-hosts a copy of either binary — anyone
   running the fetch script gets the unmodified upstream artifact straight
   from its own publisher, under whatever terms that publisher already
   attaches to it.

If that changes in the future — e.g. bundling a prebuilt engine binary inside
a Penumbra release archive — the GPL source-availability obligation (below)
would then apply to that bundle specifically, since redistributing an
unmodified GPL binary still requires either shipping or offering its
corresponding source.

## Source availability

GPL-3.0 §6 requires that anyone who receives a GPL-licensed binary can also
get the corresponding source, under the same license, for no more than the
cost of distribution. For Penumbra's own GPL components this is already
satisfied structurally rather than needing a separate offer letter:

- `rust/verifier` and `rust/prover` source lives in this same public GitHub
  repository the binaries are built from and (once published, per Stage 7's
  crates.io/GitHub-release tasks) distributed alongside. A GitHub release
  binary's corresponding source is the tagged commit it was built from, in the
  same public repo — no separate source offer is needed when source and
  binary are already co-published in the same place.
- For Stockfish/Lc0, we don't redistribute the binary at all (previous
  section), so there's no Penumbra-side source-availability obligation for
  them — a recipient gets the engine straight from its own upstream, which
  already carries its own GPL source availability.

## Practical checklist for anyone changing this later

- Adding a new dependency to `rust/verifier` or `rust/prover`: check its
  license before adding it. If it's permissive (MIT/Apache-2.0/BSD), no
  change needed — the crate stays GPL-3.0-or-later regardless, since that's
  already the floor set by `shakmaty`. If it's a *stronger* copyleft (e.g.
  AGPL), that would need a fresh decision, not a silent inherit.
- Adding a GPL dependency to anything under `apps/*`, `services/*`, or a
  `packages/*` that's meant to stay Apache-2.0/UNLICENSED: don't — that
  would propagate copyleft to code this project deliberately keeps permissive
  or private. Route the GPL-dependent logic through a separate process
  boundary (like the verifier/prover binaries, or the engine subprocess
  model) instead of linking it directly.
- Re-pinning or bundling engine binaries differently than "fetched from
  upstream at setup time" (e.g. shipping one inside a release archive):
  re-read the "Engine binaries" section above first — that's the point at
  which a source-offer obligation would actually start applying to Penumbra
  itself.
