"use client";

import Link from "next/link";
import { useRef, type ReactNode } from "react";

// CTA link that leans toward the cursor within its bounds (magnetic effect),
// snapping back on leave. Reduced-motion → no transform. Uses the app's .btn
// classes for styling so it matches the rest of the product.
export function MagneticButton({
  href,
  children,
  variant = "primary",
  strength = 0.35,
  className = "",
  external = false,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "ghost";
  strength?: number;
  className?: string;
  external?: boolean;
}) {
  const ref = useRef<HTMLAnchorElement | null>(null);

  function reduced() {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  function onMove(e: React.PointerEvent<HTMLAnchorElement>) {
    const el = ref.current;
    if (!el || reduced()) return;
    const rect = el.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    el.style.transform = `translate(${(dx * strength).toFixed(1)}px, ${(dy * strength).toFixed(1)}px)`;
  }
  function reset() {
    const el = ref.current;
    if (el) el.style.transform = "";
  }

  const cls = `btn ${variant} ${className}`;
  const style = { transition: "transform 0.18s cubic-bezier(0.22,0.61,0.36,1)" } as const;

  if (external) {
    return (
      <a ref={ref} href={href} target="_blank" rel="noreferrer" className={cls} style={style} onPointerMove={onMove} onPointerLeave={reset}>
        {children}
      </a>
    );
  }
  return (
    <Link ref={ref} href={href} className={cls} style={style} onPointerMove={onMove} onPointerLeave={reset}>
      {children}
    </Link>
  );
}
