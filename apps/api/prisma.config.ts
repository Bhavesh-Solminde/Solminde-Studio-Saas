import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 config. Migrations use DIRECT_URL (port 5432, unpooled) because DDL
 * cannot run through Supavisor's transaction pooler. The runtime client uses
 * DATABASE_URL (port 6543, pooled) via the pg adapter — see src/prisma.service.ts.
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
