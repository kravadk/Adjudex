// Free indexing without a separate (paid) Render Background Worker: run the
// indexer as a child process of the API service. Gated by
// EMBEDDED_INDEXER_ENABLED=1. Failure is contained — if the child cannot start
// or crashes, the API keeps serving; indexing simply does not run (same as not
// deploying an indexer at all). The child reads the same INDEXER_* env as a
// standalone worker, inherited from the API process.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

let started = false;

export function startEmbeddedIndexer(): void {
  if (started) return;
  started = true;
  let entry: string;
  try {
    entry = fileURLToPath(new URL("../../indexer/src/index.ts", import.meta.url));
  } catch (err) {
    console.error("[embedded-indexer] could not resolve indexer entry", err);
    return;
  }
  // node --import tsx <indexer entry>: tsx is an API dependency, so its ESM
  // loader is available; the indexer file is then run as TypeScript.
  const child = spawn(process.execPath, ["--import", "tsx", entry], {
    stdio: "inherit",
    env: process.env,
  });
  child.on("error", (err) => {
    console.error("[embedded-indexer] spawn error (API unaffected):", err);
  });
  child.on("exit", (code, signal) => {
    console.warn(`[embedded-indexer] exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  });
}
