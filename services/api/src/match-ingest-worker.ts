// Match-ingest worker. On an interval it pulls upcoming matches from every
// active feed (PandaScore / football-data / fixture), filters to the
// verticals we support (CS2, Dota2, football), and auto-deploys a soft
// market for each new one via the market-deployer. Mirrors the lifecycle
// shape of notification-worker (single-instance, unref'd, Sentry-wrapped).

import { getActiveMatchSources, type IngestMatch } from "./feeds";
import { autoPipelineConfigError } from "./feeds/chain";
import { deployMarketFromMatch } from "./market-deployer";
import { captureException } from "./sentry";
import { incCounter, setGauge } from "./metrics";

const DEFAULT_INTERVAL_MS = 300_000; // 5 min
let timer: NodeJS.Timeout | null = null;
let running = false;
let configWarned = false;

// Only these verticals become markets, even if a feed returns more.
function isSupported(match: IngestMatch): boolean {
  if (match.category === "esports") return match.game === "cs2" || match.game === "dota2";
  if (match.category === "sports") return match.sport === "football";
  return false;
}

export async function ingestOnce(): Promise<{ deployed: number; skipped: number; errors: number }> {
  const configError = autoPipelineConfigError();
  if (configError) {
    if (!configWarned) {
      console.warn(`[match-ingest] disabled: ${configError}`);
      configWarned = true;
    }
    return { deployed: 0, skipped: 0, errors: 0 };
  }
  configWarned = false;

  let deployed = 0;
  let skipped = 0;
  let errors = 0;

  for (const source of getActiveMatchSources()) {
    let matches: IngestMatch[] = [];
    try {
      matches = await source.fetchUpcoming();
    } catch (err) {
      errors += 1;
      void captureException(err, { component: "match-ingest", source: source.kind });
      continue;
    }
    for (const match of matches.filter(isSupported)) {
      try {
        const result = await deployMarketFromMatch(match);
        if (result.status === "deployed") {
          deployed += 1;
          incCounter("adjudex_markets_auto_created_total", {
            source: match.sourceKind,
            category: match.category,
          });
          console.log(
            `[match-ingest] deployed ${match.teamA} vs ${match.teamB} -> market ${result.marketId} (${result.poolAddress})`,
          );
        } else {
          skipped += 1;
        }
      } catch (err) {
        errors += 1;
        void captureException(err, {
          component: "match-ingest",
          source: source.kind,
          match: match.externalMatchId,
        });
      }
    }
  }

  setGauge("adjudex_match_ingest_last_deployed", deployed);
  setGauge("adjudex_match_ingest_last_errors", errors);
  return { deployed, skipped, errors };
}

export function startMatchIngestWorker(opts?: { intervalMs?: number }): void {
  if (timer) return;
  const intervalMs = opts?.intervalMs ?? Number(process.env.MATCH_INGEST_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const tick = () => {
    if (running) return;
    running = true;
    ingestOnce()
      .catch((err) => void captureException(err, { component: "match-ingest" }))
      .finally(() => {
        running = false;
      });
  };
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
}

export function stopMatchIngestWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
