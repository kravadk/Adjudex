import { Pool, type QueryResult, type QueryResultRow } from "pg";

let pool: Pool | null = null;

export function getDatabase() {
  // Prefer the pooler URL (e.g. Neon's pgBouncer endpoint) for runtime
  // queries — it tolerates higher connection burst rates. Migrations
  // can use DATABASE_URL directly if needed (call sites set it
  // explicitly via env before running).
  const connectionString =
    process.env.DATABASE_POOL_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL (or DATABASE_POOL_URL) is required.");
  }
  pool ??= new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? "10"),
  });
  return pool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return getDatabase().query<T>(text, values);
}

export type QueryExecutor = <T extends QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<T>>;

export async function transaction<T>(fn: (execute: QueryExecutor) => Promise<T>) {
  const client = await getDatabase().connect();
  const execute: QueryExecutor = (text, values = []) => client.query(text, values);
  try {
    await client.query("BEGIN");
    const result = await fn(execute);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closeDatabase() {
  await pool?.end();
  pool = null;
}
