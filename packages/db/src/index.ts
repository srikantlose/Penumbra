export * from './schema.js';

import { drizzle } from 'drizzle-orm/node-postgres';
import { Client } from 'pg';
import * as schema from './schema.js';

export type Database = Awaited<ReturnType<typeof getDatabase>>;

export async function getDatabase(databaseUrl: string) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  return drizzle(client, { schema });
}

export { schema };
