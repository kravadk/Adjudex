import Link from "next/link";
import { WifiOff } from "lucide-react";

export default function OfflinePage() {
  return (
    <div className="px-[22px] py-12 max-w-[720px] mx-auto">
      <div className="panel p-6">
        <div
          className="mb-4 grid h-11 w-11 place-items-center rounded-[8px] border"
          style={{ borderColor: "var(--line)", color: "var(--accent-bright)" }}
        >
          <WifiOff className="h-5 w-5" />
        </div>
        <h1
          className="text-[24px] font-semibold tracking-[-0.02em]"
          style={{ color: "var(--tx)" }}
        >
          PariAI is offline
        </h1>
        <p className="mt-3 text-[13px] leading-relaxed" style={{ color: "var(--t2)" }}>
          The app shell is available, but live markets, portfolio, balances,
          transactions, and resolution proof require the backend, indexer, and
          chain RPC. PariAI does not show cached trading state as current data.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/" className="btn primary">
            Retry dashboard
          </Link>
          <Link href="/docs" className="btn">
            Open docs
          </Link>
        </div>
      </div>
    </div>
  );
}
