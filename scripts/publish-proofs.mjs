// Publishes the committed example + fortress certs (rust/prover/examples/,
// including the fortress/ subdir) through publishProof -- idempotent on
// proofs.certificate_sha256's unique index, so re-running only publishes
// whatever hasn't been published yet. These are synthetic prover fixtures,
// not positions from any real imported game, so this script upserts each
// one's position row itself before publishing (mirrors analyzePosition.ts's
// own upsertPosition).
//
// Usage: node scripts/publish-proofs.mjs
// Exit 0 once every cert is published (or already was); exit 1 on any
// publish failure.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDatabase, schema } from '../packages/db/dist/index.js';
import { normalizeEPD, getPieceCount, computeZobristHash, zobristToHexString } from '../packages/core/dist/index.js';
import { publishProof } from '../apps/api/dist/ledger.js';
import { minioClient, databaseUrl } from '../apps/api/dist/context.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const examplesDir = path.join(repoRoot, 'rust', 'prover', 'examples');

function findCertFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...findCertFiles(full));
    } else if (entry.endsWith('.pnbcert')) {
      files.push(full);
    }
  }
  return files;
}

async function ensurePosition(db, fen) {
  const epd = normalizeEPD(fen);
  const zobrist = zobristToHexString(computeZobristHash(fen));
  const pieceCount = getPieceCount(fen);

  await db.insert(schema.positions).values({ epd, zobrist, pieceCount }).onConflictDoNothing({ target: schema.positions.epd });
  return epd;
}

async function main() {
  const db = await getDatabase(databaseUrl());
  const minio = minioClient();

  const certFiles = findCertFiles(examplesDir);
  console.log(`found ${certFiles.length} certificate(s) in ${path.relative(repoRoot, examplesDir)}`);

  for (const file of certFiles) {
    const certificate = JSON.parse(readFileSync(file, 'utf8'));
    const epd = await ensurePosition(db, certificate.claim.fen);
    const result = await publishProof(db, minio, epd, certificate);
    const label = path.relative(examplesDir, file);

    if (result.alreadyPublished) {
      console.log(`${label}: already published (proof ${result.proofId}, ${result.certificateSha256})`);
    } else {
      console.log(`${label}: published (proof ${result.proofId}, ledger seq ${result.ledgerSeq}, ${result.certificateSha256})`);
    }
  }

  console.log(`done: ${certFiles.length} certificate(s) processed`);
  process.exit(0);
}

main().catch((err) => {
  console.error('publish-proofs failed:', err.message);
  process.exit(1);
});
