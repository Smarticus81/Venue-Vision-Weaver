import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { createDatabasePool } from "./pgPool";

export const pool = createDatabasePool();
export const db = drizzle(pool, { schema });

export * from "./schema";
