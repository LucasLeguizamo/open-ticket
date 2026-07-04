import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/** Creates an explicit connection (tests / scripts). */
export function createDb(connectionString: string, maxConnections = 10): Db {
  const pool = new Pool({ connectionString, max: maxConnections });
  return drizzle(pool, { schema });
}

let _db: Db | undefined;

/** Lazy singleton for the app — does not connect at build time. */
export function getDb(): Db {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see README step 3)");
    _db = createDb(url);
  }
  return _db;
}
