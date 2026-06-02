import Link from "next/link";
import { Bot, Check, Clock, ExternalLink } from "lucide-react";
import { AgentMark } from "./agent-mark";

type ActivityProof = {
  transactionHash?: string;
  chainId?: number;
};

export type Activity =
  | ({ kind: "bet"; side: "yes" | "no"; handle: string; market: string; amount: number; ago: string } & ActivityProof)
  | ({ kind: "ai-lp"; side: "yes" | "no"; handle: string; market: string; amount: number; ago: string } & ActivityProof)
  | ({ kind: "claim"; handle: string; market: string; amount: number; ago: string } & ActivityProof)
  | ({ kind: "refund"; handle: string; market: string; amount: number; ago: string } & ActivityProof)
  | ({ kind: "resolution"; side: "yes" | "no"; market: string; ago: string } & ActivityProof);

function initialsFromHandle(handle: string): string {
  const trimmed = handle.replace(/[^a-zA-Z]/g, "");
  return (trimmed.slice(0, 2) || "??").toUpperCase();
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "yes" | "no";
}) {
  const tones: Record<string, string> = {
    neutral: "bg-[#232323] border-[#2a2a2a] text-gray-300",
    accent: "bg-[#CCE9E7]/8 border-[#CCE9E7]/25 text-[#CCE9E7]",
    yes: "bg-[#10b981]/8 border-[#10b981]/25 text-[#10b981]",
    no: "bg-[#ef4444]/8 border-[#ef4444]/25 text-[#ef4444]",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 h-5 px-1.5 rounded-[3px] border text-[10.5px] font-medium whitespace-nowrap font-mono tabular-nums tracking-tight ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function CapsLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-gray-500">
      {children}
    </span>
  );
}

export function AILPIndicator({ count }: { count: number }) {
  if (count === 0) {
    return (
      <Pill tone="neutral">
        <Bot className="w-3 h-3 opacity-60" strokeWidth={1.8} />
        <span className="font-mono tabular-nums">0 LPs</span>
      </Pill>
    );
  }
  return (
    <Pill tone="accent">
      <Bot className="w-3 h-3" strokeWidth={1.8} />
      <span className="font-mono tabular-nums">{count} LPs</span>
    </Pill>
  );
}

export function ResolutionTimer({
  ms,
  resolved,
  showIcon = false,
}: {
  ms: number;
  resolved?: boolean;
  showIcon?: boolean;
}) {
  if (resolved) {
    return (
      <span className="font-mono text-xs text-gray-500 inline-flex items-center gap-1">
        <Check className="w-3 h-3" strokeWidth={2} /> Resolved
      </span>
    );
  }
  const d = Math.floor(ms / 86400e3);
  const h = Math.floor((ms % 86400e3) / 3600e3);
  const m = Math.floor((ms % 3600e3) / 60e3);
  const tone =
    ms < 3600e3
      ? "text-[#ef4444]"
      : ms < 6 * 3600e3
        ? "text-[#f59e0b]"
        : "text-gray-300";
  const text =
    d > 0
      ? `${d}d ${h.toString().padStart(2, "0")}h`
      : h > 0
        ? `${h}h ${m.toString().padStart(2, "0")}m`
        : `${m}m`;
  return (
    <span
      className={`font-mono tabular-nums text-xs inline-flex items-center gap-1 ${tone}`}
    >
      {showIcon && <Clock className="w-3 h-3 opacity-60" strokeWidth={1.8} />}
      {text}
    </span>
  );
}

export function AgentBadge({
  handle,
  initials,
  rep,
  id,
}: {
  handle: string;
  initials: string;
  rep: number;
  id?: string;
}) {
  const inner = (
    <span className="inline-flex items-center gap-1.5 h-6 pl-0.5 pr-2 rounded-full bg-[#232323] border border-[#2a2a2a] hover:border-[#3a3a3a] transition-colors">
      <AgentMark initials={initials} size={20} emphasis="accent" />
      <span className="font-mono text-[11px] text-white">{handle}</span>
      <span className="font-mono tabular-nums text-[10.5px] text-[#CCE9E7]">
        {rep}
      </span>
    </span>
  );
  if (id) return <Link href={`/agent/${encodeURIComponent(id)}`}>{inner}</Link>;
  return inner;
}

export function ActivityFeedItem({ item }: { item: Activity }) {
  const proofHref = txUrl(item.chainId, item.transactionHash);
  if (item.kind === "resolution") {
    return (
      <div className="flex gap-3 py-2.5 border-b border-[#2a2a2a] last:border-b-0">
        <div className="w-6 h-6 rounded-full bg-[#10b981]/12 border border-[#10b981]/30 text-[#10b981] flex items-center justify-center flex-shrink-0">
          <Check className="w-3 h-3" strokeWidth={2.5} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs">
            <span
              className={`font-mono font-bold text-[10px] uppercase tracking-wider mr-1.5 ${
                item.side === "yes" ? "text-[#10b981]" : "text-[#ef4444]"
              }`}
            >
              {item.side}
            </span>
            <span className="text-gray-400">resolved</span>
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
            <span className="truncate">{item.market}</span>
            <span>-</span>
            <span className="font-mono">{item.ago}</span>
            {proofHref && <ProofLink href={proofHref} />}
          </div>
        </div>
      </div>
    );
  }

  const isAi = item.kind === "ai-lp";
  const isClaim = item.kind === "claim";
  const isRefund = item.kind === "refund";

  return (
    <div className="flex gap-3 py-2.5 border-b border-[#2a2a2a] last:border-b-0">
      {isAi ? (
        <AgentMark
          initials={initialsFromHandle(item.handle)}
          size={24}
          emphasis="accent"
        />
      ) : isClaim || isRefund ? (
        <span className="w-6 h-6 rounded-full bg-[#CCE9E7]/12 border border-[#CCE9E7]/30 flex items-center justify-center text-[#CCE9E7] flex-shrink-0">
          <Check className="w-3 h-3" strokeWidth={2.4} />
        </span>
      ) : (
        <span className="w-6 h-6 rounded-full bg-[#232323] border border-[#2a2a2a] flex items-center justify-center font-mono text-[9px] text-gray-400 tracking-wider flex-shrink-0">
          {item.handle.slice(2, 4).toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          <span className="font-mono text-white text-[12px]">{item.handle}</span>
          <span className="text-gray-500">{isAi ? "LP" : isClaim ? "claimed" : isRefund ? "refunded" : "bet"}</span>
          {!isClaim && !isRefund && (
            <span
              className={`font-mono font-bold text-[9.5px] uppercase tracking-wider px-1.5 rounded ${
                item.side === "yes"
                  ? "bg-[#10b981]/15 text-[#10b981]"
                  : "bg-[#ef4444]/15 text-[#ef4444]"
              }`}
            >
              {item.side}
            </span>
          )}
          <span className="font-mono tabular-nums text-white text-[12px] font-semibold">
            ${item.amount.toLocaleString()}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-gray-500">
          <span className="truncate">{item.market}</span>
          <span>-</span>
          <span className="font-mono">{item.ago}</span>
          {proofHref && <ProofLink href={proofHref} />}
        </div>
      </div>
    </div>
  );
}

function ProofLink({ href }: { href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-[4px] border border-[#2a2a2a] px-1.5 py-0.5 font-mono text-[10px] text-[#7ef4c8] hover:border-[#3a3a3a] hover:text-white"
      aria-label="Open transaction proof"
    >
      tx <ExternalLink className="h-2.5 w-2.5" />
    </a>
  );
}

function txUrl(chainId?: number, transactionHash?: string): string | undefined {
  if (!transactionHash) return undefined;
  const rhcChainId = Number(process.env.NEXT_PUBLIC_RHC_CHAIN_ID);
  const explorer =
    chainId === 46630 || (rhcChainId && chainId === rhcChainId)
      ? process.env.NEXT_PUBLIC_RHC_EXPLORER_URL
      : process.env.NEXT_PUBLIC_ARBITRUM_EXPLORER_URL || "https://sepolia.arbiscan.io";
  if (!explorer) return undefined;
  return `${explorer.replace(/\/$/, "")}/tx/${encodeURIComponent(transactionHash)}`;
}

export function CategoryChips({
  active,
  onChange,
  categories,
}: {
  active: string;
  onChange: (c: string) => void;
  categories: readonly string[];
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {categories.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          className={`h-7 px-3 rounded-[4px] border text-[12px] font-medium transition-colors whitespace-nowrap ${
            active === c
              ? "bg-white text-black border-white"
              : "bg-[#1f1f1f] text-gray-400 border-[#262626] hover:text-white hover:border-[#3a3a3a]"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}

