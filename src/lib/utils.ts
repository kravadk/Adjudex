export function cn(
  ...classes: Array<string | undefined | null | false | 0>
): string {
  return classes.filter(Boolean).join(" ");
}

export function formatUsd(amount: number, decimals = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
}

export function formatUsdCompact(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d ago`;
}

export type CountdownSeverity = "normal" | "warning" | "urgent" | "expired";

export function formatCountdown(deadlineIso: string): {
  text: string;
  severity: CountdownSeverity;
} {
  const ms = new Date(deadlineIso).getTime() - Date.now();
  if (ms <= 0) return { text: "Resolved", severity: "expired" };
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  let text = "";
  if (days > 0) text = `${days}d ${String(hours).padStart(2, "0")}h`;
  else if (hours > 0) text = `${hours}h ${String(minutes).padStart(2, "0")}m`;
  else text = `${minutes}m`;
  let severity: CountdownSeverity = "normal";
  if (ms < 3_600_000) severity = "urgent";
  else if (ms < 21_600_000) severity = "warning";
  return { text, severity };
}

export function shortenAddress(addr: string, head = 4, tail = 3): string {
  if (addr.length <= head + tail + 2) return addr;
  return `${addr.slice(0, 2 + head)}...${addr.slice(-tail)}`;
}
