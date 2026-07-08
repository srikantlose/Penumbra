// Live-database smoke test for the Stage 1.4 schema hardening: confirms the
// migrations actually apply, real FK constraints are enforced, and the
// append-only triggers actually block mutation -- not just that the SQL
// text looks right. Run against a fresh `docker-compose up -d postgres`
// with migrations applied (`pnpm run db:migrate`).
//
// Usage: node scripts/db-smoke.mjs
// Exit 0 + "DB SMOKE OK" on success, exit 1 with a message on any failure.

import { sql } from 'drizzle-orm';
import { getDatabase, schema } from '../packages/db/dist/index.js';

const databaseUrl =
  process.env.DATABASE_URL || 'postgresql://penumbra:penumbra@localhost:5432/penumbra';

async function expectToThrow(label, fn) {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error(`expected "${label}" to throw, but it succeeded`);
}

async function main() {
  const db = await getDatabase(databaseUrl);

  const [user] = await db
    .insert(schema.users)
    .values({ lichessId: `smoke-test-${Date.now()}` })
    .returning();

  const [game] = await db
    .insert(schema.games)
    .values({ source: 'manual', importedByUserId: user.id })
    .returning();

  const [position] = await db
    .insert(schema.positions)
    .values({
      epd: `smoke-test-epd-${Date.now()} w KQkq -`,
      zobrist: '0x0000000000000001',
      pieceCount: 32,
      firstSeenGameId: game.id,
    })
    .returning();

  const [evalRow] = await db
    .insert(schema.evals)
    .values({
      positionId: position.id,
      engine: 'stockfish',
      engineVersion: 'smoke-test',
      engineFingerprint: '0x' + '00'.repeat(32),
    })
    .returning();

  console.log('setup ok: user=%d game=%d position=%d eval=%d', user.id, game.id, position.id, evalRow.id);

  const updateErr = await expectToThrow('UPDATE evals', () =>
    db.execute(sql`UPDATE evals SET score_cp = 1 WHERE id = ${evalRow.id}`)
  );
  if (!/append-only/.test(String(updateErr.message))) {
    throw new Error(`UPDATE evals threw, but not the expected append-only error: ${updateErr.message}`);
  }
  console.log('append-only trigger blocks UPDATE evals: ok');

  const deleteErr = await expectToThrow('DELETE evals', () =>
    db.execute(sql`DELETE FROM evals WHERE id = ${evalRow.id}`)
  );
  if (!/append-only/.test(String(deleteErr.message))) {
    throw new Error(`DELETE evals threw, but not the expected append-only error: ${deleteErr.message}`);
  }
  console.log('append-only trigger blocks DELETE evals: ok');

  const fkErr = await expectToThrow('insert eval with bad position_id', () =>
    db.insert(schema.evals).values({
      positionId: 999999999,
      engine: 'stockfish',
      engineVersion: 'smoke-test',
      engineFingerprint: '0x' + '00'.repeat(32),
    })
  );
  if (!/foreign key/i.test(String(fkErr.message))) {
    throw new Error(`insert with bad position_id threw, but not an FK violation: ${fkErr.message}`);
  }
  console.log('foreign key constraint blocks orphaned eval: ok');

  console.log('DB SMOKE OK');
  process.exit(0);
}

main().catch((err) => {
  console.error('DB SMOKE FAILED:', err.message);
  process.exit(1);
});
