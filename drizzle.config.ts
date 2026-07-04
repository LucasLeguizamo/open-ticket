import { defineConfig } from "drizzle-kit";

// Drizzle Kit is the SOLE OWNER of the schema (architecture-review C4/A6).
// Supabase only hosts Postgres: do not use its table editor or its own migrations.
export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgres://postgres:test@localhost:54329/openticket_test",
  },
});
