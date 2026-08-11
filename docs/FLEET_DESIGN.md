# Fleet: Work-Unit Federation — Design Proposal

**Status: proposal, not a decision.** This document exists to give the repo owner something
concrete to approve, redirect, or reject — it is not an implementation plan and nothing in it is
committed to. No application code was written or changed to produce it. Where reasonable people
could disagree, the tradeoff is flagged rather than resolved.

`docs/ROADMAP.md`'s Deferred section has carried "Work-unit federation ('Fleet')" since Stage 2,
with the same reason attached every time it came up again: "no existing code/infra, and needs a
concrete multi-contributor scenario to design against." Two of Fleet's prerequisites shipped this
session (transposition-dedup + the real `PNBC` container, then Ed25519 signatures) specifically
*as* bounded slices of that backlog item, each scoped down until a real scenario existed. This
document is the scenario, written against the codebase as it exists today — not against an
idealized future one.

## 1. Why now

Signing (`docs/CERTIFICATE_FORMAT.md` §"Signing (provenance, not soundness)", shipped
2026-08-11) is the piece that actually unblocks Fleet. Before it, "a contributor submits a
certificate" had no answer to "submits it as *whom*" — nothing in this codebase could distinguish
one anonymous JSON file from another. Now a keypair is an identity
(`penumbra-prove keygen --out-prefix <path>` writes `<path>.seed`/`<path>.pub`) and a signature is
non-repudiable proof that a specific file came from a specific key
(`penumbra-prove prove ... --sign-key <path>.seed`, checked via
`penumbra-verify verify ... --trust-key <path>.pub`). That is exactly the primitive "who
contributed this proof" needs, and it already exists, tested, and shipped — Fleet doesn't need to
invent an identity system, only wire the existing one into a new write path.

## 2. What "Fleet" already is in this repo

Grepping the whole tree for "Fleet" turns up only reservations, never an implementation:

- `docs/CERTIFICATE_FORMAT.md`: `metadata.contributors` (optional `string[]`) and
  `metadata.work_units` (optional `string[]`) are documented fields, explicitly called out as
  "outside the verification boundary" — the verifier ignores them entirely.
- `packages/cert-schema/src/types.ts`'s `CertificateMetadata` and `rust/prover/src/certificate.rs`
  / `rust/verifier/src/verifier.rs`'s `CertificateMetadata` struct both carry
  `contributors: Option<Vec<String>>` / `work_units: Option<Vec<String>>` — but
  `rust/prover/src/pns.rs`'s `emit()` hardcodes `contributors: None, work_units: None` on every
  certificate it produces. **There is no CLI flag today that sets either field.** Every certificate
  this project has ever produced has both fields empty.
- `PROGRESS.md`'s two most recent entries (the `PNBC` container and Ed25519 signing) both describe
  themselves as pieces "scoped down from the full 'Fleet federation' backlog item," and both
  restate the same blocker this document resolves.

No work-unit table, no submission endpoint, no claim/lease logic, nothing in `apps/web` — Fleet is
a name and two empty JSON fields, nothing else.

## 3. The concrete scenario

### 3.1 Where would the work actually come from?

The task brief that prompted this document suggested `missed_proofs`/`proof_entry_ply` as a
source of "positions that need a human/contributor-run prover." Having read
`services/analysis/src/pipeline/proofEntry.ts` and `analyzeGame.ts` closely, that's not quite what
they do, and it's worth correcting before building a scenario on it:

- **`detectProofEntryPly`** walks a game's positions and returns the first ply where
  `isPositionProven` is already true — i.e. where an *existing* `proofs` row or a cached
  ≤7-piece tablebase probe (`packages/db/src/truth.ts`'s `deriveTruthStatus`) already certifies
  the position. It reports where existing truth enters the game; it does not identify positions
  lacking truth.
- **`detectMissedProofs`** finds plies where a legal alternative move led to a position with an
  *existing* proof of a win for the mover (`findProvenWinningMoves` in `analyzeGame.ts`, which
  only consults `schema.proofs` and `schema.tbProbes`) that the human didn't play. It flags human
  blunders relative to already-known truth — again, it presupposes a proof already exists
  somewhere, it doesn't surface positions that need one.

Both are archaeology over *existing* certificates and tablebase coverage, not gap-detectors for
missing ones. So they are not, as written, a source of Fleet work units.

There is a real, related signal nearby, though, and it's worth naming precisely because it's
almost the thing the brief was reaching for: **a game whose `analyses.proofEntryPly` stays `null`
all the way through a real checkmate, at a piece count above 7, is a game where the entire mating
sequence was never machine-certified as forced.** The game record shows moves that led to mate,
but that isn't a forced-win proof — proving it requires showing every opponent reply at every
AND-node also loses, which is exactly what `penumbra-prove` computes and the played game doesn't
demonstrate on its own. This is a legitimate, well-defined query
(`analyses.proof_entry_ply IS NULL` joined to a game whose last position has no legal moves and
more than 7 pieces) that nothing currently runs. It's flagged in §9 as a real v2 candidate-source,
not built into v1 (see §3.2 for why).

Two more things worth being explicit about, because they change how big a deal Fleet actually is:

- **Nothing in `services/analysis` ever invokes `penumbra-prove`.** Grepping
  `services/analysis/src` for `penumbra-prove`/`penumbra_prove` returns nothing. The TypeScript
  analysis pipeline computes Fog scores and tablebase-probe truth; it has zero code path that
  produces a new certificate. The only two ways a `.pnbcert` has ever been created in this
  project's history are the developer running `penumbra-prove` by hand (the 13 committed examples
  in `rust/prover/examples/`) and `scripts/publish-proofs.mjs` re-publishing those same committed
  files. **There is currently no automated or distributed way for the certificate corpus to grow
  at all.** Fleet isn't an optimization on top of an existing distributed-proving system — it
  would be the first one.
- The fortress work in `rust/prover/examples/fortress/README.md` is itself a real, already-lived
  example of what a Fleet work unit looks like in practice: a hand-curated candidate FEN, a
  validation step against an external oracle (Lichess's tablebase endpoint, or its per-move
  heuristic for the 8–10 man Tier C positions beyond 7-man coverage), a claim
  (`at_least_draw`/side), and a `penumbra-prove --claim ... --syzygy ...` run that either succeeds
  or gets discarded in favor of the next candidate in the family. That entire workflow was done by
  one person, by hand, in one session. Fleet's job is to let that same workflow happen with a
  candidate list published for others and a submission endpoint instead of a local file write.

### 3.2 The chosen scenario

**External contributors run `penumbra-prove` locally against a published list of open work units,
sign their output certificate with their own keypair, and submit it to a new `apps/api` endpoint,
which independently re-verifies it (exactly like any other certificate) before it lands in the
existing ledger with `metadata.contributors` populated.**

Work units for v1 are **hand-curated fortress/forced-mate candidates**, published the same way the
existing `fortress/README.md` table already documents them — a FEN, a claim, and (where relevant)
an external-oracle validation note — just moved from a static markdown table nobody but the
developer can extend into a small DB table with a public read endpoint. This is deliberately the
narrowest real slice:

- It reuses a workflow that has already been exercised end-to-end by a real person in this repo
  (Tier A/B/C fortress seeding), so there's no new *kind* of work being invented, only a new
  *source* of contributors for an existing kind of work.
- It sidesteps the missed_proofs/proof_entry_ply correction above entirely — v1 doesn't need
  automatic work-unit generation to be useful; a short hand-picked list is enough to validate the
  concept end-to-end, same as the ten fortress seeds were hand-picked.
- It's honest about the current state of the pipeline: since nothing auto-generates proof attempts
  today, *any* mechanism that gets a second human proving positions is net-new capability, not a
  distribution optimization on an existing one.

The real-game-derived gap detector from §3.1 is a plausible **second** work-unit source (v2, not
required to validate the scenario) — flagged explicitly in §9 as a decision only the repo owner
can make, because it also raises a question v1 avoids: automatically generated candidates aren't
pre-filtered for provability the way a human curator filters a fortress family (the Tier C section
of the fortress README describes real dead ends — families that "blow the 500k–2M node search
budget without proving anything" — that were discarded before ever reaching a committed file).
Publishing every `proofEntryPly IS NULL` game as a work unit would likely publish a lot of
practically-unprovable middlegame FENs alongside the tractable ones.

## 4. Work-unit definition and assignment

A work unit is minimal and close to what a fortress README row already is:

```
id            bigserial, primary key
fen           text, the position to prove (full FEN, matching claim.fen's format)
claim_value   varchar(20): 'win' | 'at_least_draw'
claim_side    varchar(10): 'white' | 'black'
notes         text, nullable — why this is interesting (mirrors the fortress README's
              "Provenance" column: "endpoint-validated category: draw", "beyond Lichess's
              7-man range, cross-validated via per-move heuristic", etc.)
status        varchar(20): 'open' | 'claimed' | 'proved' -- default 'open'
created_at    timestamp, defaultNow()
```

Every field here is either already a certificate field (`fen`, `claim_value`/`claim_side` mirror
`CertificateClaim.value`/`.side` in `packages/cert-schema/src/types.ts`) or already a convention
this schema uses elsewhere (`varchar(20)` status enums like `proofs.status`, `text` notes like
`games.pgn`).

**Claiming.** The honest tradeoff: a claim/lease system adds real value (avoids two contributors
burning CPU-hours on the same position) but also real complexity (timeouts, what happens to an
abandoned claim, whether an unclaimed submission should even be rejected). Two things make this
less urgent than it looks:

- **Duplicate work isn't corrupting, only wasteful.** `publishProof()` is already idempotent on
  `proofs.certificate_sha256`'s unique index (`apps/api/src/ledger.ts`) — if two contributors
  submit *byte-identical* proof trees for the same claim, the second submission is a no-op
  (`alreadyPublished: true`, no second ledger entry). The more likely case — two contributors find
  *different* winning lines or different AND-node orderings for the same claim — produces two
  certificates with different SHA256 hashes, so both get published as two independent entries for
  the same underlying fact. That's redundant, not wrong; nothing about the ledger's soundness
  depends on there being exactly one proof per claim.
- **A lease still has to pick a timeout, and this project's own recent experience says that's
  genuinely hard to guess right.** The real calibration-run entry in `PROGRESS.md` ("Deferred /
  post-launch") measured a live search estimate off by more than 2× (~9 days assumed vs. ~23.6
  days measured) purely from throughput-scaling assumptions. Proof search times are at least as
  unpredictable — Tier B's two fortress certs needed 126 and 3,725 search nodes for visually
  similar positions; a genuine 8–10 man fortress can also blow past a multi-million-node budget
  and prove nothing at all (Tier C's README explicitly documents discarded candidates that did
  exactly that). Any fixed lease timeout is a guess, and guessing wrong in either direction is bad
  (too short: a contributor's still-running overnight search gets silently reassigned out from
  under them; too long: an abandoned claim blocks a work unit for days).

**Proposed v1 answer: skip claiming entirely.** Work units are just a public read-only list with a
status field flipped to `'proved'` once *any* accepted submission references them (see §6). A
contributor picks one, proves it on their own time, and submits whenever they're done — no lease,
no timeout, no reservation. If duplicate effort turns out to matter in practice once there's a real
contributor pool, a lightweight advisory "I'm working on this" marker (not a hard lock, since
nothing enforces it against a client that ignores it anyway) is a cheap follow-on. Building a real
lease/timeout system before there's evidence duplicate effort is actually happening is the kind of
premature complexity this document is trying to avoid.

## 5. Identity and trust

### 5.1 Registration: none proposed

No key-registration step. A contributor runs `penumbra-prove keygen --out-prefix mykey` once,
keeps `mykey.seed` private, and includes `mykey.pub` (or a fingerprint of it) as their
`metadata.contributors` label. The API never needs to have seen a key before accepting a
submission signed with it — this is the same posture `penumbra-verify --trust-key` already takes:
trust is supplied per-verification by whoever's checking, never baked into a registry the producer
controls. Concretely, this means Fleet submissions are **permissionless by construction**: anyone
can generate a keypair and submit, with no approval step, matching the project's own framing of
signatures as "did this file come from this key," never "is this key allowed to contribute."

This does mean `metadata.contributors` is a self-reported label, not a verified real-world
identity — a contributor could sign as `"anonymous-4f2a"` and there is no mechanism forcing
otherwise, nor should there be for v1 (see §7 on what's actually worth guarding against).

### 5.2 A real gap this surfaces: the prover CLI couldn't populate `contributors` — now fixed

**Done, 2026-08-11** (after this document was first drafted): `rust/prover/src/pns.rs` used to
hardcode `contributors: None` and `work_units: None` at certificate emission time (§2). This was a
real prerequisite for Fleet, not an API-side detail, so it was closed on its own — deliberately
scoped narrower than the rest of this proposal, since it's independently useful regardless of what
happens with the open questions in §9 (it's the CLI catching up to fields the format has reserved
since v0.1, not a commitment to anything else here). `penumbra-prove prove` now accepts
`--contributor <name>` (repeatable) and `--work-unit <id>`, threaded through `ProofSearchConfig`
into `build_certificate`. Verified both that the fields populate correctly and, empirically (not
just by reading the doc), that a certificate carrying them still verifies clean — metadata really
is outside the verification boundary in practice, not just on paper. `rust/prover/src/main.rs`,
`pns.rs`, `tests/prove_and_verify.rs`, `README.md`.

### 5.3 What `publishProof()` actually does today, and what has to change

Walking `apps/api/src/ledger.ts`'s `publishProof()` exactly as written:

1. Computes `certificateSha256` via `computeCertificateSHA256` (JCS canonicalization + SHA256,
   `packages/cert-schema`).
2. If a `proofs` row with that hash already exists, returns early (`alreadyPublished: true`) —
   the idempotency behavior described in §4.
3. Looks up the `positions` row by `epd` — **throws if it doesn't exist** ("cannot publish proof:
   no position found for epd ... — import/analyze it first"). Every certificate published so far
   has come through `scripts/publish-proofs.mjs`, whose own `ensurePosition()` helper
   upserts the position (via `normalizeEPD`/`computeZobristHash`/`getPieceCount` from
   `@penumbra/core`) before calling `publishProof` — because the fortress/example certs are
   synthetic prover fixtures, never previously imported from a real game. A Fleet work unit's FEN
   (a hand-picked fortress candidate) is exactly this same situation: it needs the identical
   upsert-before-publish step, not a new mechanism — `apps/api` already depends on `@penumbra/core`
   directly, so this is copy the four-line pattern, not build something new.
4. Uploads the certificate JSON to minio (`certs/<sha256>.pnbcert`) and, in one transaction,
   inserts the `proofs` row and appends a ledger entry via `appendLedgerEntryWith` (the
   `SELECT ... FOR UPDATE`-locked single-writer append described in `docs/ROADMAP.md` Stage 5).

**What's conspicuously absent from all four steps: nothing calls a verifier.** Neither
`publishProof()` nor its only current caller, `scripts/publish-proofs.mjs`, ever checks that the
certificate is actually a valid proof. `packages/cert-schema/src/validate.ts`'s
`validateCertificate` — the one function in this codebase that could plausibly gate this — is
purely structural (regex-checks a zobrist looks like a zobrist, checks a UCI move looks like a UCI
move, checks arrays are non-empty) and is not even imported by `ledger.ts` or
`publish-proofs.mjs`. It never replays a single move, never checks AND-node coverage, never checks
that a claimed checkmate is a real checkmate — it is exactly as shallow as the Rust verifier's
*structural-only* pass was before Stage 1.1 added semantic verification, except this shallow
version isn't even wired in.

This has been completely safe until now because the only thing that has ever called
`publishProof()` is a script publishing certificates the developer already ran through
`penumbra-verify` (real semantic verification, cycle detection, tablebase soundness — the whole
Stage 1/2 hardening pass) by hand before committing them. **A public Fleet submission endpoint
removes that human-in-the-loop trust step**, so it is the one piece of this proposal that is not
optional: **before any Fleet-submitted certificate reaches `publishProof()`, it must pass the same
real verification any other certificate would.**

### 5.4 Where that verification actually has to run

This is a genuine architectural fork, not a detail to wave past. The real semantic
verifier — move replay, AND-node coverage, checkmate/stalemate truth, cycle discipline, tablebase
soundness — exists **only** in `rust/verifier`. `apps/api` is TypeScript with no Rust runtime, and
this project has an explicit, repeatedly-stated design invariant that verification logic is never
duplicated (`docs/ROADMAP.md` §1.1: "Two-crate independence... no shared code, ever" — stated about
the two Rust crates, but the underlying reason, avoiding two implementations of the same
soundness-critical logic silently drifting apart, applies at least as strongly to a hypothetical
third TypeScript implementation). The one narrow exception this project has ever made
(`rust/prover` calling `penumbra_verify::certificate_sha256` directly for signing, per
`PROGRESS.md`'s signing entry) was for hashing, a much smaller and more mechanical surface than
full semantic replay.

Two real options, both requiring the compiled `penumbra-verify` binary to be reachable from
wherever the submission endpoint runs:

- **(a) Shell out to `penumbra-verify` as a subprocess** from the new API route (spawn it against
  a temp file holding the submitted certificate, parse its exit code / `Valid: true|false` output,
  optionally `--trust-key` against the submitter's declared public key if the endpoint wants to
  double-check the signature server-side too). This has a real precedent in this codebase:
  `services/analysis`'s `UciClient` already spawns and manages external native subprocesses
  (Stockfish/Lc0) from Node, including Windows-safe kill handling. It reuses the exact,
  already-hardened verifier instead of writing a second one, at the cost of needing the compiled
  binary present in whatever environment runs `apps/api` (today: nowhere — there is no production
  deploy yet at all, per `docs/ROADMAP.md` Stage 7's "no real Hetzner/Cloudflare/R2 target exists
  yet"; even in local dev this means a documented build step, `cargo build --release -p
  penumbra-verify`, before the API can run).
- **(b) Write a second, independent semantic verifier in TypeScript.** Consistent with how this
  project already treats zobrist hashing and JCS canonicalization (two independent
  implementations, cross-checked via committed fixture vectors) — but semantic verification is a
  much larger, more soundness-critical surface than either of those, and the two-implementation
  pattern exists here specifically so *drift is caught by tests*, which only works if both sides
  stay comprehensively covered forever. This is real, options should not be dismissed out of hand,
  but it is a substantially bigger undertaking than (a) and duplicates work the Rust side already
  did carefully (Stage 1.1's semantic pass, Stage 2's tablebase soundness table).

This document leans toward (a) as the pragmatic v1 choice — reusing a released, tested binary
beats re-deriving its logic — but flags it explicitly in §9 as a decision the repo owner should
make deliberately, not one this proposal should quietly assume.

### 5.5 Reaffirming the no-special-trust-path principle

Whichever option §5.4 lands on, the verification a Fleet submission receives must be **the same
verification any other certificate receives** — full `verify_with` (semantic + cycle + tablebase,
per whatever `TablebasePolicy` the endpoint is configured with), not a lighter or heavier path
because the submitter has a "verified contributor" badge. This directly matches
`docs/CERTIFICATE_FORMAT.md`'s own stated design: soundness comes from the proof tree replaying
correctly, never from who produced it. Concretely: **the endpoint should not check the submitter's
signature as a substitute for verification, only as an attribution label alongside it.** A
signature says who to credit in `metadata.contributors`; it says nothing about whether the proof
is sound, and must never be treated as if it did. This also means there is no reason to require a
signature for verification purposes — an unsigned but valid submission is exactly as publishable
as a signed one (matching the certificate format's own "unsigned certificate is exactly as valid a
proof as a signed one" stance); a signature is required only if the contributor wants attribution.

## 6. API surface

### 6.1 New endpoints

Every existing `/v1` route today is read-only (`docs/DEVELOPMENT.md` §APIs lists exactly six GETs,
all confirmed against `apps/api/src/routes/*.ts`); the one existing mutating route,
`POST /bff/import`, lives under `/bff` (the web app's own server-side actions) and is gated by
`requireApiKey` — an internal convenience key, not a public credential model. A Fleet submission
endpoint would be **the first public mutating `/v1` route**, and its auth model is deliberately
different from `/bff/import`'s: gating it behind `X-API-Key` would defeat the permissionless goal
(§5.1) by requiring contributors to first obtain a project-issued key, which reintroduces exactly
the registration step this design avoids. Proposed instead:

```
GET /v1/fleet/work-units?status=open&limit=&offset=
  → { workUnits: [{ id, fen, claimValue, claimSide, notes, status, createdAt }], total }
  (zod schema, same list/pagination convention as proofListQuerySchema/proofListResponseSchema)

GET /v1/fleet/work-units/:id
  → single work unit, 404 if missing (same convention as GET /v1/proofs/:id)

POST /v1/fleet/submissions
  body: { certificate: <Certificate JSON, or base64 .pnbcert bytes>, workUnitId?: number }
  → 201 { proofId, certificateSha256, ledgerSeq, alreadyPublished, contributors }
  → 400 { error } on verification failure (mirrors errorResponseSchema)
  no requireApiKey preHandler -- anonymous, backstopped only by the existing 60/min per-IP
  rate limit already wired in server.ts's registerRateLimit
```

`workUnitId` is optional and advisory only (§4 — no claim to enforce): if given, and verification
succeeds, the work unit's `status` flips to `'proved'` and the ledger payload records which work
unit it closed. A submission with no `workUnitId` (someone proving something not on the list at
all) is still accepted — the work-unit list is a curated suggestion list, not an allowlist of what
may be proven, since nothing about verification cares where the FEN came from.

### 6.2 New DB tables and columns

Following `packages/db/src/schema.ts`'s existing conventions exactly (`bigserial` ids,
`bigint(..., {mode:'number'}).references(...)` for FKs, `varchar` length-bounded enums, `json` for
flexible payloads, an `index`/`uniqueIndex` per predictable query pattern):

```ts
export const workUnits = pgTable('work_units', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  fen: text('fen').notNull(),
  claimValue: varchar('claim_value', { length: 20 }).notNull(), // 'win' | 'at_least_draw'
  claimSide: varchar('claim_side', { length: 10 }).notNull(),   // 'white' | 'black'
  notes: text('notes'),
  status: varchar('status', { length: 20 }).notNull().default('open'), // 'open' | 'proved'
  provedByProofId: bigint('proved_by_proof_id', { mode: 'number' }).references(() => proofs.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  statusIdx: index('work_units_status_idx').on(table.status),
}));
```

One nullable addition to the existing `proofs` table, mirroring the existing nullable-FK pattern
already used for `ledgerEntries.proofId`:

```ts
workUnitId: bigint('work_unit_id', { mode: 'number' }).references(() => workUnits.id), // nullable
```

No schema change is needed to carry `contributors` into the ledger's historical record —
`ledgerEntries.payload` is already an untyped `json` column, and `publishProof()`'s payload object
literal (currently `{ type: 'proof_published', proof_sha256, claim, epd, published_at }`) just
gains a `contributors: certificate.metadata.contributors ?? null` field read straight off the
verified certificate. This is the one required change to `publishProof()` itself beyond the
verification gate in §5.3/§5.4 — small, additive, doesn't touch its existing idempotency or
transaction behavior.

Whether `proofs` (the queryable row, not just the ledger's JSON blob) should *also* get a
`contributors` column depends entirely on whether `GET /v1/proofs` needs to filter/display
attribution without parsing the minio-stored certificate JSON — a real product question, not an
engineering one, left to §9.

## 7. Abuse/spam considerations

A new anonymous public write endpoint is a new attack surface. Worth separating what's realistic
from what's premature:

**Worth guarding against in v1:**

- **Garbage/invalid submissions.** Fully handled by §5.3/§5.4's verification gate — an invalid
  certificate never reaches `publishProof()`, so it never touches the append-only ledger. The
  existing anonymous rate limit (60/min per IP, already global in `server.ts`) bounds how fast
  someone can hammer the endpoint with junk regardless.
- **Valid-but-pointless flooding.** Someone could submit thousands of *distinct* trivial
  certificates (any of this project's own back-rank-mate-in-1-style examples, or trivial
  hand-constructed positions) that pass verification and each get a unique
  `certificate_sha256`, so `publishProof()`'s idempotency doesn't stop them. This is the one real
  open risk worth the owner's attention: the ledger is append-only by explicit design invariant
  (`docs/ROADMAP.md` §1.1 — "inserts only, never an UPDATE or DELETE path in any service code"),
  so anything published this way is **permanent**. Whether this matters depends on what the ledger
  is *for* — if it's meant to be a curated historical record of interesting/hard proofs, trivial
  flooding degrades it; if it's meant to be an exhaustive fact database where triviality doesn't
  matter, it doesn't. This is a judgment call for §9, not something this document resolves.
- **Exact-duplicate resubmission.** Already handled — `certificate_sha256`'s unique index makes
  resubmitting someone else's exact file a no-op (`alreadyPublished: true`), not a re-attribution;
  the ledger entry (and its `contributors`) stay tied to whoever's submission landed first.

**Not worth guarding against in v1 (premature hardening):**

- **"Credit theft"** in any stronger sense than the above. If two different people independently
  produce two different valid proof trees for the same claim, both get published as two ledger
  entries — there's no mechanism (and arguably no need for one) to decide whose "counts more."
  Ledger sequence order already gives a natural, honest "who published first" answer without
  building anything new.
- **Reputation scoring, staking/deposits, proof-of-work on submission, CAPTCHA.** All standard
  answers to "public write endpoint abuse," none justified yet — there's no evidence of abuse
  because there's no endpoint yet, and every one of these adds real complexity (and, for
  staking/deposits, an entirely new payments concern this project has nothing resembling today).
  Revisit only if the rate limit + verification gate + append-only-forever tradeoff above proves
  insufficient in practice.

## 8. Phased first slice

**v1 — smallest real, end-to-end version:**

- `work_units` table (§6.2) + a hand-curated seed list (5–10 rows, same style as the fortress
  README — a few fortress candidates beyond the ten already shipped, or forced-mate positions from
  real imported games the developer picks by hand, exactly as Tier A/B/C were picked).
- `GET /v1/fleet/work-units` / `GET /v1/fleet/work-units/:id` — read-only, no auth (matches every
  other `/v1` GET).
- `POST /v1/fleet/submissions` — anonymous, rate-limited, gated on real verification per §5.3/§5.4
  before ever reaching `publishProof()`; on success, `metadata.contributors` flows into the ledger
  payload (§6.2) and the referenced work unit (if any) flips to `'proved'`.
- `--contributor`/`--work-unit` flags on `penumbra-prove prove` (§5.2) so a contributor's local
  run can actually populate the fields the format has reserved since v0.1.
- No new infrastructure beyond what's already running: same Postgres, same minio, same ledger
  transaction. The one new operational requirement is `penumbra-verify` being buildable/reachable
  wherever `apps/api` runs (§5.4) — worth calling out explicitly since there's no production
  deploy target yet at all (`docs/ROADMAP.md` Stage 7).

**Explicitly out of scope for v1:**

- Claim/lease timers (§4 — duplicate work is wasteful, not unsound; not worth the complexity yet).
- Automatic work-unit generation from `missed_proofs`/`proof_entry_ply` or any other pipeline
  signal (§3.1/§3.2 — the correction there stands: neither currently detects "unproven gaps," and
  even the derived heuristic that does needs a provability pre-filter a human curator provides for
  free today).
- Leaderboards, contributor reputation, any scoring beyond "this ledger entry's payload says who
  submitted it."
- Payment or reward of any kind.
- A dedicated Fleet page in `apps/web` — the two new GETs are enough to validate the concept via
  `curl`/a script, same as every other `/v1` route was before its web page existed; a `/fleet`
  route can follow the same "wire it to live data" pattern Stage 6 already established once there's
  something real to show.
- A `proofs.contributors` column for query/filter/display purposes (§6.2's open question) — the
  ledger payload carries it either way; promoting it to a first-class queryable column is a
  follow-on if `GET /v1/proofs` actually needs to filter or display it.

## 9. Open questions for the repo owner

- **Permissionless or invite-only to start?** This document defaults to permissionless (§5.1) as
  the design that actually needs no new infrastructure, but a small invite-only pilot (a handful
  of known people, keys shared out of band) is a legitimate, lower-risk way to test the mechanics
  before opening the submission endpoint to the public internet.
- **Is there an actual pool of contributors in mind, or is this speculative infrastructure right
  now?** This materially changes how much of §7's abuse-hardening is worth building before launch
  versus after seeing real traffic.
- **Should work units be hand-curated (as proposed for v1) or generated from a pipeline signal?**
  If the latter, is the `proofEntryPly IS NULL` + real-checkmate-above-7-men heuristic (§3.1) the
  right one, given it will surface a lot of practically unprovable middlegame positions alongside
  tractable endgame ones with no automatic way to tell them apart?
- **Shell out to `penumbra-verify` as a subprocess, or build a second TypeScript semantic
  verifier?** (§5.4) This is the single biggest implementation-cost decision in this whole
  proposal, and it's also the one place where getting it wrong has real soundness consequences —
  worth a deliberate answer rather than an implementer's default.
- **Does `proofs.certificate_sha256` uniqueness + ledger ordering fully answer "who gets credit"
  for a claim two contributors both prove independently, or does the owner want something
  stronger** (e.g. a work unit locking to `'proved'` on first accepted submission and rejecting
  later ones outright, rather than publishing both as this document proposes)?
- **Is v1's scope (§8) actually worth shipping now, or should Fleet wait until there's a real
  production deploy target** (`docs/ROADMAP.md` Stage 7 is still "no infra target yet" as of this
  writing), given the submission endpoint's only new operational dependency is having
  `penumbra-verify` reachable from wherever `apps/api` runs?
