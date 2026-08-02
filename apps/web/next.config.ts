import type { NextConfig } from 'next';

const config: NextConfig = {
  // packages/shared is consumed as TypeScript source, not a built artifact.
  transpilePackages: ['@salon/shared'],
  // Monorepo root, so Next traces files from the workspace root not apps/web.
  outputFileTracingRoot: new URL('../../', import.meta.url).pathname,
};

export default config;
