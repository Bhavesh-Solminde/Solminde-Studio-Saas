import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// The workspace keeps one .env at the repo root, not per app.
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

/**
 * Prisma 7 config. Migrations use DIRECT_URL (session pooler, port 5432)
 * because DDL cannot run through the transaction pooler. The runtime client
 * uses DATABASE_URL (transaction pooler, 6543) via the pg adapter — see
 * src/prisma.service.ts.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
});
