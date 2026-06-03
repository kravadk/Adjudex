import { Reveal } from "./Reveal";

const PARTNERS = [
  "Arbitrum",
  "Robinhood Chain",
  "GMX",
  "Dune",
  "ZeroDev",
  "Fhenix",
  "OpenZeppelin",
  "Reclaim zkTLS",
  "Chainlink",
];

export function LogoStrip() {
  return (
    <Reveal as="section" className="mx-auto max-w-[1180px] px-5 py-10">
      <p className="caps mb-5 text-center">Built on &amp; integrated with</p>
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
        {PARTNERS.map((p) => (
          <span
            key={p}
            className="text-[15px] font-semibold tracking-tight"
            style={{ color: "var(--t3)" }}
          >
            {p}
          </span>
        ))}
      </div>
    </Reveal>
  );
}
