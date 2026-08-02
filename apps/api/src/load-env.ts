import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';

/**
 * The workspace keeps ONE .env at the repo root, not one per app.
 * `dotenv/config` resolves relative to cwd, which is apps/api when the API is
 * started through pnpm --filter, so it silently finds nothing and every
 * connection then fails with an opaque SASL error.
 *
 * Import this first, before anything that reads process.env.
 */
config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
