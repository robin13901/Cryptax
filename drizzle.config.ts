import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './packages/backend/src/db/schema.ts',
  out: './packages/backend/drizzle',
  dbCredentials: {
    url: './cryptax.db',
  },
});
