import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

/** Crea una conexión explícita (tests / scripts). */
export function createDb(connectionString: string, maxConnections = 10): Db {
  const pool = new Pool({ connectionString, max: maxConnections });
  return drizzle(pool, { schema });
}

let _db: Db | undefined;

/** Singleton lazy para la app — no conecta en build time. */
export function getDb(): Db {
  if (!_db) {
    const url = process.env.DATABASE_URL;
    if (!url)
      throw new Error("DATABASE_URL no está configurada (ver README paso 3)");
    _db = createDb(url);
  }
  return _db;
}
