import "server-only";

import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { SQL } from "drizzle-orm";
import { env } from "@/lib/env";
import * as schema from "./schema";

// Use Neon HTTP driver for neon.tech URLs, standard pg for local Postgres.
// This lets contributors run a local Postgres via docker-compose without Neon.
const url = env.DATABASE_URL;
export const db = url.includes("neon.tech")
  ? drizzleNeon(url, { schema })
  : drizzlePg(url, { schema });

/**
 * Run a raw SQL query and return its rows as `T[]`.
 *
 * Both drivers return untyped rows, so a shape assertion at the driver
 * boundary is unavoidable; this helper is the one sanctioned place for it.
 * Keep `T` in sync with the SELECT list at the call site.
 */
export async function executeRows<T>(query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as unknown as T[];
}
