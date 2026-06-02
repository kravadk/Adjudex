import { Pool, type QueryResultRow } from "pg";

let pool: Pool | null = null;

export function getDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required.");
  pool ??= new Pool({ connectionString });
  return pool;
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return getDatabase().query<T>(text, values);
}
