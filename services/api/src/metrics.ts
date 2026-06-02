// Minimal in-process Prometheus exposition. Avoids a hard dep on
// prom-client so the service stays small; once we go multi-instance
// (S3) we should swap for prom-client + a sidecar that aggregates.
//
// Metric shape:
//   pariai_requests_total{method,route,status}     counter
//   pariai_request_duration_ms_sum{route}          counter (sum)
//   pariai_request_duration_ms_count{route}        counter
//   pariai_errors_total{kind}                      counter
//   pariai_indexer_lag_blocks{chain}               gauge (set via setGauge)
//   pariai_db_pool_size                            gauge
//   pariai_uptime_seconds                          gauge (auto, monotonic)

const SERVICE = process.env.SERVICE_NAME ?? "api";
const STARTED_AT = Date.now();

type LabelMap = Record<string, string | number>;

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const durationSum = new Map<string, number>();
const durationCount = new Map<string, number>();

function key(name: string, labels?: LabelMap): string {
  if (!labels) return name;
  const pairs = Object.entries(labels)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${JSON.stringify(String(v))}`)
    .sort()
    .join(",");
  return pairs ? `${name}{${pairs}}` : name;
}

export function incCounter(name: string, labels?: LabelMap, by = 1): void {
  const k = key(name, labels);
  counters.set(k, (counters.get(k) ?? 0) + by);
}

export function setGauge(name: string, value: number, labels?: LabelMap): void {
  gauges.set(key(name, labels), value);
}

export function observeDuration(
  name: string,
  ms: number,
  labels?: LabelMap,
): void {
  const k = key(name, labels);
  durationSum.set(k, (durationSum.get(k) ?? 0) + ms);
  durationCount.set(k, (durationCount.get(k) ?? 0) + 1);
}

// Render Prometheus text exposition format. NOTE: route cardinality
// must stay bounded — always pass a NORMALIZED route template (e.g.
// "/api/markets/:id"), never the raw URL with literal ids.
export function renderMetrics(): string {
  const lines: string[] = [];
  lines.push(`# HELP pariai_uptime_seconds Service uptime in seconds.`);
  lines.push(`# TYPE pariai_uptime_seconds gauge`);
  lines.push(
    `pariai_uptime_seconds{service=${JSON.stringify(SERVICE)}} ${(
      (Date.now() - STARTED_AT) /
      1000
    ).toFixed(0)}`,
  );

  if (counters.size) {
    lines.push(`# TYPE pariai_requests_total counter`);
    lines.push(`# TYPE pariai_errors_total counter`);
    for (const [k, v] of counters.entries()) {
      lines.push(`${k} ${v}`);
    }
  }

  if (durationSum.size) {
    lines.push(`# TYPE pariai_request_duration_ms summary`);
    for (const [k, v] of durationSum.entries()) {
      lines.push(`${k}_sum ${v}`);
      lines.push(`${k}_count ${durationCount.get(k) ?? 0}`);
    }
  }

  if (gauges.size) {
    for (const [k, v] of gauges.entries()) {
      lines.push(`${k} ${v}`);
    }
  }

  return lines.join("\n") + "\n";
}

// Reset (test-only). NOT exposed via HTTP.
export function _resetMetricsForTests(): void {
  counters.clear();
  gauges.clear();
  durationSum.clear();
  durationCount.clear();
}
