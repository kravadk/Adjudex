import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";

// 404 fallback. Caught by Next.js when no route segment matches and no
// nested not-found boundary exists. Keeps Adjudex shell so the user can
// recover (back home, browse markets) without a dead-end.
export const metadata = {
  title: "Not found",
};

export default function NotFound() {
  return (
    <div className="min-h-[60vh] grid place-items-center px-6">
      <div className="flex flex-col items-center text-center gap-6 max-w-md">
        <Image
          src="/logo.png"
          alt=""
          width={88}
          height={88}
          priority
          className="rounded-[14px]"
        />
        <div className="flex flex-col gap-1.5">
          <span
            className="text-[10.5px] font-mono uppercase tracking-[0.18em]"
            style={{ color: "var(--accent-bright, #3b6ffa)" }}
          >
            404 · Verdict not found
          </span>
          <h1
            className="text-[28px] font-bold tracking-[-0.01em]"
            style={{ color: "var(--tx, #fafafa)" }}
          >
            This market doesn&apos;t exist
          </h1>
          <p
            className="text-[14px] mt-1 leading-relaxed"
            style={{ color: "var(--t2, #a3a3a3)" }}
          >
            The page you tried to reach was never indexed, has been
            removed, or the link broke during a rebrand. Pick a route
            from below to keep going.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/"
            className="btn primary inline-flex items-center gap-1.5"
            style={{ height: 36, padding: "0 14px", fontSize: 13 }}
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back home
          </Link>
          <Link
            href="/feed"
            className="btn ghost inline-flex items-center gap-1.5"
            style={{ height: 36, padding: "0 14px", fontSize: 13 }}
          >
            <Compass className="w-3.5 h-3.5" />
            Browse feed
          </Link>
        </div>
      </div>
    </div>
  );
}
