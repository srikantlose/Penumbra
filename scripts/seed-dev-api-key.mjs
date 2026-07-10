// Creates (or reuses) a local-dev API key so apps/web's server-side BFF
// calls (POST /bff/import) have something to authenticate with. Key
// issuance has no public endpoint by design (docs/ROADMAP.md Stage 5 --
// keys are provisioned out of band); this is that out-of-band step for a
// local dev environment. Idempotent: re-running finds the existing "web-dev"
// key by name and prints a reminder instead of minting a second one (the
// raw key is only ever shown once, at creation).
//
// Usage: node scripts/seed-dev-api-key.mjs
// Prints PENUMBRA_API_KEY=pnb_... to paste into apps/web/.env.local.

import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDatabase, schema } from '../packages/db/dist/index.js';
import { hashApiKey } from '../apps/api/dist/plugins/auth.js';
import { databaseUrl } from '../apps/api/dist/context.js';

const KEY_NAME = 'web-dev';

async function main() {
  const db = await getDatabase(databaseUrl());

  const [existing] = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.name, KEY_NAME)).limit(1);
  if (existing) {
    console.log(`a "${KEY_NAME}" api key already exists (id ${existing.id}) -- the raw key was only`);
    console.log('printed once at creation; if you lost it, delete this row and re-run this script.');
    process.exit(0);
  }

  const [user] = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  if (!user) {
    console.error('no users row exists yet -- import at least one game first (creates one via imports).');
    process.exit(1);
  }

  const rawKey = 'pnb_' + crypto.randomBytes(32).toString('hex');
  await db.insert(schema.apiKeys).values({
    userId: user.id,
    keyHash: hashApiKey(rawKey),
    name: KEY_NAME,
  });

  console.log('created a local-dev api key. Paste this into apps/web/.env.local:');
  console.log(`PENUMBRA_API_KEY=${rawKey}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('seed-dev-api-key failed:', err.message);
  process.exit(1);
});
