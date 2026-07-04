import { defineConfig } from "drizzle-kit";

// Drizzle Kit es el DUEÑO ÚNICO del schema (architecture-review C4/A6).
// Supabase solo hostea Postgres: no usar su editor de tablas ni migraciones propias.
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
