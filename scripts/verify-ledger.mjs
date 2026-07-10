// Walks the ledger chain from seq 1, recomputing every entry_hash from its
// stored payload + prev_hash and comparing against what's stored -- proves
// the chain hasn't been tampered with or corrupted, independent of trusting
// the DB's own bytes.
//
// Usage: node scripts/verify-ledger.mjs
// Exit 0 + "LEDGER OK (n entries)" if every hash matches (or the chain is
// empty); exit 1 at the first broken seq otherwise.

import { asc } from 'drizzle-orm';
import { getDatabase, schema } from '../packages/db/dist/index.js';
import { computeEntryHash, LEDGER_GENESIS_PREV_HASH } from '../apps/api/dist/ledger.js';
import { databaseUrl } from '../apps/api/dist/context.js';

async function main() {
  const db = await getDatabase(databaseUrl());
  const rows = await db.select().from(schema.ledgerEntries).orderBy(asc(schema.ledgerEntries.seq));

  let expectedPrevHash = LEDGER_GENESIS_PREV_HASH;
  for (const row of rows) {
    if (row.prevHash !== expectedPrevHash) {
      console.error(`LEDGER BROKEN at seq ${row.seq}: prev_hash mismatch (expected ${expectedPrevHash}, got ${row.prevHash})`);
      process.exit(1);
    }
    const recomputed = computeEntryHash(expectedPrevHash, row.payload);
    if (recomputed !== row.entryHash) {
      console.error(`LEDGER BROKEN at seq ${row.seq}: entry_hash mismatch (expected ${recomputed}, got ${row.entryHash})`);
      process.exit(1);
    }
    expectedPrevHash = row.entryHash;
  }

  console.log(`LEDGER OK (${rows.length} entries)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('verify-ledger failed:', err.message);
  process.exit(1);
});
