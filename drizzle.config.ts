import type { Config } from 'drizzle-kit';

export default {
  schema: './packages/db/src/schema.ts',
  out: './packages/db/migrations',
  driver: 'pg',
  dbCredentials: {
    connectionString: process.env.DATABASE_URL || 'postgresql://penumbra:penumbra@localhost/penumbra',
  },
} satisfies Config;
