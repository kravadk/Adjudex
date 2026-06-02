"use client";

import { useEffect, useState } from "react";

// CSS-only confetti burst for celebration moments (claim success, big
// win, first bet). No npm dep — 30 inline-styled <span> particles with
// keyframe transforms. Self-cleans after 1500ms so it can be re-mounted
// per event without leaking timers.
//
// Honors prefers-reduced-motion: when reduced, renders nothing (callers
// already show a toast / status message — the visual is decorative).
//
// Usage:
//   <ConfettiBurst trigger={status === "success"} />
// or imperatively:
//   const [shown, setShown] = useState(false);
//   ... onSuccess(() => setShown(true))
//   <ConfettiBurst trigger={shown} onDone={() => setShown(false)} />

const PARTICLE_COUNT = 30;
const COLORS = [
  "#3b6ffa", // arbitrum blue
  "#10b981", // green
  "#a78bfa", // violet
  "#f59e0b", // amber
  "#ef4444", // red
  "#22d3ee", // cyan
  "#fde047", // yellow
];

type Particle = {
  id: number;
  left: number;       // percent
  delay: number;      // seconds
  duration: number;   // seconds
  drift: number;      // px
  rotate: number;     // deg
  size: number;       // px
  color: string;
  shape: "square" | "circle";
};

function buildParticles(seed: number): Particle[] {
  // Deterministic per render so React diffing stays stable, but each
  // mount of <ConfettiBurst> with a new key gets a different layout.
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    id: i,
    left: rand() * 100,
    delay: rand() * 0.18,
    duration: 0.9 + rand() * 0.7,
    drift: (rand() - 0.5) * 180,
    rotate: (rand() - 0.5) * 720,
    size: 6 + Math.round(rand() * 6),
    color: COLORS[Math.floor(rand() * COLORS.length)],
    shape: rand() > 0.5 ? "square" : "circle",
  }));
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ConfettiBurst({
  trigger,
  onDone,
}: {
  trigger: boolean;
  onDone?: () => void;
}) {
  const [active, setActive] = useState(false);
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    if (!trigger) return;
    if (prefersReducedMotion()) {
      onDone?.();
      return;
    }
    // Intentional: we translate the parent's `trigger` prop into a
    // self-contained animation lifecycle. setState inside the effect
    // is correct here — there's no external store to subscribe to.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeed(Date.now() >>> 0);
    setActive(true);
    const timer = window.setTimeout(() => {
      setActive(false);
      onDone?.();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [trigger, onDone]);

  if (!active) return null;
  const particles = buildParticles(seed);

  return (
    <>
      <style>{`
        @keyframes adjudex-confetti-fall {
          0% {
            transform: translate3d(0, -8%, 0) rotate(0deg);
            opacity: 1;
          }
          70% {
            opacity: 1;
          }
          100% {
            transform: translate3d(var(--drift, 0), 100vh, 0)
              rotate(var(--rotate, 720deg));
            opacity: 0;
          }
        }
      `}</style>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[60] overflow-hidden"
      >
        {particles.map((p) => (
          <span
            key={p.id}
            style={{
              position: "absolute",
              top: "-12px",
              left: `${p.left}%`,
              width: p.size,
              height: p.size,
              background: p.color,
              borderRadius: p.shape === "circle" ? "50%" : "2px",
              animation: `adjudex-confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
              ["--drift" as string]: `${p.drift}px`,
              ["--rotate" as string]: `${p.rotate}deg`,
            } as React.CSSProperties}
          />
        ))}
      </div>
    </>
  );
}
