import { defineConfig } from 'drizzle-kit';

// Reads the compiled schema, so run `pnpm build` before `pnpm generate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './dist/schema/index.js',
  out: './migrations',
  strict: true,
});
