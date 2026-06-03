import { Reveal } from "./Reveal";
import { MagneticButton } from "./MagneticButton";

export function FinalCTA() {
  return (
    <section className="mx-auto max-w-[1180px] px-5 py-20">
      <Reveal>
        <div
          className="relative overflow-hidden rounded-[24px] border px-6 py-16 text-center"
          style={{ borderColor: "var(--line)", background: "linear-gradient(135deg, #0f0f0f, #141414)" }}
        >
          <div
            className="pointer-events-none absolute -top-24 left-1/2 h-[360px] w-[680px] -translate-x-1/2 rounded-full"
            style={{ background: "radial-gradient(closest-side, rgba(217,255,0,0.12), transparent)" }}
          />
          <div
            className="pointer-events-none absolute bottom-[-30%] right-[-5%] h-[360px] w-[360px] rounded-full"
            style={{ background: "radial-gradient(closest-side, rgba(59,111,250,0.16), transparent)" }}
          />
          <div className="relative">
            <h2 className="mx-auto max-w-[640px] text-[32px] font-semibold leading-tight tracking-[-0.02em] sm:text-[44px]" style={{ color: "var(--tx)" }}>
              Take the other side of the pool.
            </h2>
            <p className="mx-auto mt-4 max-w-[480px] text-[15px]" style={{ color: "var(--t2)" }}>
              Connect a wallet, grab testnet USDC, and place your first
              AI-resolved bet in under a minute.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <MagneticButton href="/" variant="primary">
                Launch app
              </MagneticButton>
              <MagneticButton href="/analytics/sponsors" variant="ghost" strength={0.2}>
                See traction
              </MagneticButton>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
