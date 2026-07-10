import crypto from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { schema, type Database } from '@penumbra/db';
import { canonicalizeJSON, computeCertificateSHA256, parseHexHash, type Certificate } from '@penumbra/cert-schema';
import type { Client as MinioClient } from 'minio';
import { PROOFS_BUCKET } from './context.js';

export const LEDGER_GENESIS_PREV_HASH = '0x' + '00'.repeat(32);

/**
 * entry_hash = '0x' + sha256(bytes(prev_hash) || sha256(canonicalizeJSON(payload)))
 * (docs/ROADMAP.md Stage 5 / docs/CERTIFICATE_FORMAT.md §Ledger). Pure and
 * DB-free by design so it's directly unit-testable against fixed payloads,
 * mirroring packages/db/src/truth.ts's deriveTruthStatus split.
 */
export function computeEntryHash(prevHash: string, payload: unknown): string {
  const payloadHash = crypto.createHash('sha256').update(canonicalizeJSON(payload)).digest();
  const combined = Buffer.concat([parseHexHash(prevHash), payloadHash]);
  return '0x' + crypto.createHash('sha256').update(combined).digest('hex');
}

type LedgerRow = typeof schema.ledgerEntries.$inferSelect;

/**
 * Locks the chain's tail row for the duration of the transaction (`SELECT
 * ... FOR UPDATE`) so concurrent appenders can't both read the same
 * prev_hash and fork the chain -- single-writer by construction, per
 * docs/ROADMAP.md Stage 5. Takes any drizzle executor (a Database or an
 * open transaction) so callers can fold it into a larger atomic write.
 */
async function appendLedgerEntryWith(db: Database, payload: unknown, proofId: number | null): Promise<LedgerRow> {
  const [tail] = await db
    .select({ entryHash: schema.ledgerEntries.entryHash })
    .from(schema.ledgerEntries)
    .orderBy(desc(schema.ledgerEntries.seq))
    .limit(1)
    .for('update');

  const prevHash = tail?.entryHash ?? LEDGER_GENESIS_PREV_HASH;
  const entryHash = computeEntryHash(prevHash, payload);

  const [row] = await db.insert(schema.ledgerEntries).values({ proofId, payload, prevHash, entryHash }).returning();
  return row;
}

/** Standalone append in its own transaction -- for callers with no other write to fold it into. */
export async function appendLedgerEntry(db: Database, payload: unknown, proofId: number | null = null): Promise<LedgerRow> {
  return db.transaction((tx) => appendLedgerEntryWith(tx, payload, proofId));
}

function mapClaimToProofFields(claim: Certificate['claim']): { value: string; bound: string | null } {
  if (claim.value === 'at_least_draw') return { value: 'draw', bound: 'at_least_draw' };
  return { value: claim.value, bound: null };
}

export async function ensureProofsBucket(minio: MinioClient): Promise<void> {
  const exists = await minio.bucketExists(PROOFS_BUCKET).catch(() => false);
  if (!exists) await minio.makeBucket(PROOFS_BUCKET);
}

export interface PublishProofResult {
  proofId: number;
  certificateSha256: string;
  ledgerSeq: number | null;
  alreadyPublished: boolean;
}

/**
 * Uploads the cert to minio, inserts the proofs row, and appends the
 * ledger entry -- idempotent on proofs.certificate_sha256's unique index,
 * so re-running scripts/publish-proofs.mjs against already-published certs
 * is a no-op. The proofs insert and ledger append share one transaction so
 * a crash between them can't leave a published-but-unledgered proof.
 */
export async function publishProof(db: Database, minio: MinioClient, epd: string, certificate: Certificate): Promise<PublishProofResult> {
  const certificateSha256 = computeCertificateSHA256(certificate);

  const [existing] = await db
    .select({ id: schema.proofs.id })
    .from(schema.proofs)
    .where(eq(schema.proofs.certificateSha256, certificateSha256))
    .limit(1);

  if (existing) {
    const [ledgerRow] = await db
      .select({ seq: schema.ledgerEntries.seq })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.proofId, existing.id))
      .limit(1);
    return { proofId: existing.id, certificateSha256, ledgerSeq: ledgerRow?.seq ?? null, alreadyPublished: true };
  }

  const [position] = await db
    .select({ id: schema.positions.id })
    .from(schema.positions)
    .where(eq(schema.positions.epd, epd))
    .limit(1);
  if (!position) {
    throw new Error(`cannot publish proof: no position found for epd "${epd}" -- import/analyze it first`);
  }

  const objectKey = `certs/${certificateSha256.slice(2)}.pnbcert`;
  await ensureProofsBucket(minio);
  const certBuffer = Buffer.from(JSON.stringify(certificate, null, 2), 'utf8');
  await minio.putObject(PROOFS_BUCKET, objectKey, certBuffer, certBuffer.length, { 'Content-Type': 'application/json' });

  const { value, bound } = mapClaimToProofFields(certificate.claim);
  const publishedAt = new Date();

  const { proofId, ledgerRow } = await db.transaction(async (tx) => {
    const [proofRow] = await tx
      .insert(schema.proofs)
      .values({
        positionId: position.id,
        claim: certificate.claim,
        value,
        bound,
        status: 'published',
        formatVersion: certificate.format_version,
        certificateObjectKey: objectKey,
        certificateSha256,
        publishedAt,
      })
      .returning();

    const ledgerRow = await appendLedgerEntryWith(
      tx,
      {
        type: 'proof_published',
        proof_sha256: certificateSha256,
        claim: certificate.claim,
        epd,
        published_at: publishedAt.toISOString(),
      },
      proofRow.id
    );

    return { proofId: proofRow.id, ledgerRow };
  });

  return { proofId, certificateSha256, ledgerSeq: ledgerRow.seq, alreadyPublished: false };
}
