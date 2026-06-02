import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getDatabase, closeDatabase } from "./db";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, "../db/schema.sql");
const schema = await readFile(schemaPath, "utf8");

await getDatabase().query(schema);
await closeDatabase();

console.log("Database schema applied.");
