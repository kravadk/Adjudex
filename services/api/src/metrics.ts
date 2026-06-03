// Minimal in-process Prometheus exposition. Avoids a hard dep on
// prom-client so the service stays small; once we go multi-instance
// (S3) we should swap for prom-client + a sidecar that aggregates.
//
// Metric shape:
//   adjudex_requests_total{method,route,status}     counter
//   adjudex_request_duration_ms_sum{route}          counter (sum)
//   adjudex_request_duration_ms_count{route}        counter
//   adjudex_errors_total{kind}                      counter
//   adjudex_indexer_lag_blocks{chain}               gauge (set via setGauge)
//   adjudex_db_pool_size                            gauge
//   adjudex_uptime_seconds                          gauge (auto, monotonic)

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
  lines.push(`# HELP adjudex_uptime_seconds Service uptime in seconds.`);
  lines.push(`# TYPE adjudex_uptime_seconds gauge`);
  lines.push(
    `adjudex_uptime_seconds{service=${JSON.stringify(SERVICE)}} ${(
      (Date.now() - STARTED_AT) /
      1000
    ).toFixed(0)}`,
  );

  if (counters.size) {
    lines.push(`# TYPE adjudex_requests_total counter`);
    lines.push(`# TYPE adjudex_errors_total counter`);
    for (const [k, v] of counters.entries()) {
      lines.push(`${k} ${v}`);
    }
  }

  if (durationSum.size) {
    lines.push(`# TYPE adjudex_request_duration_ms summary`);
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

// CloudWatch Embedded Metric Format. App Runner ships stdout to CloudWatch
// Logs, which auto-extracts EMF lines into metrics under the given namespace —
// no AWS SDK or credentials needed. Gated on CLOUDWATCH_EMF so local/dev runs
// stay quiet. Emitted with NO dimensions (`Dimensions: [[]]`) so the metric
// lands at the namespace level that infra/aws/ops-alarms.yaml alarms watch
// (Adjudex / WebhookFailures, ResolutionFailures, RpcLagBlocks).
const EMF_NAMESPACE = process.env.CLOUDWATCH_NAMESPACE ?? "Adjudex";
const EMF_ENABLED = process.env.CLOUDWATCH_EMF === "1";

export function emitCloudWatchMetric(
  name: string,
  value: number,
  unit: "Count" | "None" | "Milliseconds" = "Count",
): void {
  if (!EMF_ENABLED) return;
  const line = JSON.stringify({
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        { Namespace: EMF_NAMESPACE, Dimensions: [[]], Metrics: [{ Name: name, Unit: unit }] },
      ],
    },
    service: SERVICE,
    [name]: value,
  });
  process.stdout.write(`${line}\n`);
}

// Reset (test-only). NOT exposed via HTTP.
export function _resetMetricsForTests(): void {
  counters.clear();
  gauges.clear();
  durationSum.clear();
  durationCount.clear();
}
