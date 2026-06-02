import Image from "next/image";

// Global loading state. Next.js renders this whenever a route segment is
// suspended (data fetching, dynamic params, etc.). Branded so the user
// always sees Adjudex identity, never a blank flash.
export default function Loading() {
  return (
    <div
      className="min-h-[60vh] grid place-items-center"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <Image
            src="/logo.png"
            alt=""
            width={72}
            height={72}
            priority
            className="rounded-[12px]"
          />
          <span
            aria-hidden
            className="absolute inset-0 rounded-[12px] animate-pulse"
            style={{
              boxShadow: "0 0 32px 4px rgba(217, 255, 0, 0.35)",
            }}
          />
        </div>
        <span
          className="text-[11px] font-mono uppercase tracking-[0.18em]"
          style={{ color: "var(--t3, #6b7280)" }}
        >
          Loading
        </span>
      </div>
    </div>
  );
}
