"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { MagneticButton } from "./MagneticButton";

const LINKS = [
  { href: "#product", label: "Product" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#ecosystem", label: "Ecosystem" },
  { href: "#builders", label: "Builders" },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 transition-all"
      style={{
        background: scrolled ? "rgba(10,10,10,0.72)" : "transparent",
        backdropFilter: scrolled ? "blur(12px)" : "none",
        borderBottom: scrolled ? "1px solid var(--line-soft)" : "1px solid transparent",
      }}
    >
      <nav className="mx-auto flex h-16 max-w-[1180px] items-center gap-3 px-5">
        <Link href="/landing" className="flex items-center gap-2.5" aria-label="Adjudex">
          <Image src="/logo.png" alt="" width={30} height={30} priority className="rounded-[7px]" />
          <span className="text-[17px] font-bold tracking-tight" style={{ color: "var(--tx)" }}>
            adjudex
          </span>
        </Link>

        <div className="ml-6 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-[8px] px-3 py-2 text-[13.5px] transition-colors"
              style={{ color: "var(--t2)" }}
            >
              {l.label}
            </a>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link href="/" className="hidden text-[13.5px] sm:inline" style={{ color: "var(--t2)" }}>
            Markets
          </Link>
          <MagneticButton href="/" variant="primary" strength={0.25}>
            Launch app
          </MagneticButton>
        </div>
      </nav>
    </header>
  );
}
