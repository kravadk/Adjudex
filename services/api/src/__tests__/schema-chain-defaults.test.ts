import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("schema chain identity", () => {
  it("does not default chain_id to Arbitrum for new writes", () => {
    const schema = readFileSync(resolve(process.cwd(), "services/api/db/schema.sql"), "utf8");

    expect(schema).not.toMatch(/chain_id\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+421614/i);
    expect(schema).not.toMatch(/UPDATE\s+\w+\s+SET\s+chain_id\s*=\s*421614/i);
    expect(schema).toContain("ALTER TABLE markets ALTER COLUMN chain_id DROP DEFAULT");
    expect(schema).toContain("ALTER TABLE import_deployments ALTER COLUMN chain_id DROP DEFAULT");
    expect(schema).toContain("ALTER TABLE auth_nonces ADD COLUMN IF NOT EXISTS chain_id INTEGER");
    expect(schema).toContain("ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS chain_id INTEGER");
    expect(schema).toContain("ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS domain TEXT");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS agent_reputation_history");
    expect(schema).toContain("transaction_hash TEXT");
  });
});
