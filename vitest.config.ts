import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: { compatibilityDate: '2026-08-01', bindings: { TEST_MIGRATIONS: migrations, REGISTRATION_KEY: 'test-registration-key' } },
      }),
    ],
    test: { setupFiles: ['./test/Setup.ts'] },
  };
});
