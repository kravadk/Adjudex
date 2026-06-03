"use client";

import { useRef, type ReactNode } from "react";

// Pointer-driven 3D tilt + a radial spotlight that follows the cursor.
// Pure transform/CSS-var writes (no React state, no re-render). Falls back to
// a static card under reduced-motion (we simply skip the transform).
export function TiltCard({
  children,
  className = "",
  max = 7,
}: {
  children: ReactNode;
  className?: string;
  max?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  function reduced() {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }

  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el || reduced()) return;
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const rx = (0.5 - py) * max * 2;
    const ry = (px - 0.5) * max * 2;
    el.style.transform = `perspective(900px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateZ(0)`;
    el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`);
    el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`);
  }

  function reset() {
    const el = ref.current;
    if (!el) return;
    el.style.transform = "";
  }

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className={className}
      style={{
        transition: "transform 0.2s cubic-bezier(0.22,0.61,0.36,1)",
        border: "1px solid var(--line)",
        backgroundColor: "var(--card)",
        backgroundImage:
          "radial-gradient(420px circle at var(--mx, 50%) var(--my, 0%), rgba(59,111,250,0.10), transparent 45%)",
      }}
    >
      {children}
    </div>
  );
}
