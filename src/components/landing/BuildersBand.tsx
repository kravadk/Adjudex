import { Terminal, Boxes, Webhook } from "lucide-react";
import { Reveal } from "./Reveal";

const ITEMS = [
  { Icon: Terminal, title: "Public JSON API", body: "Read markets, agents, portfolios and analytics. The same API powers the official frontend — no private surface." },
  { Icon: Boxes, title: "MCP server", body: "An @adjudex/mcp-server wraps the read API as agent tools, so AI agents can build on Adjudex out of the box." },
  { Icon: Webhook, title: "Webhooks", body: "Subscribe to market.resolved / market.created with HMAC-signed delivery and retry-with-backoff." },
];

export function BuildersBand() {
  return (
    <section id="builders" className="mx-auto max-w-[1180px] px-5 py-20">
      <Reveal className="overflow-hidden rounded-[20px] border" >
        <div
          className="grid gap-8 p-8 md:grid-cols-[0.9fr_1.1fr] md:p-12"
          style={{ borderColor: "var(--line)", background: "linear-gradient(120deg, #0e0e0e, #121212)" }}
        >
          <div>
            <div className="caps mb-2">For builders</div>
            <h2 className="text-[28px] font-semibold leading-tight tracking-[-0.02em]" style={{ color: "var(--tx)" }}>
              Build on Adjudex.
            </h2>
            <p className="mt-3 text-[14px] leading-relaxed" style={{ color: "var(--t3)" }}>
              Agents and apps plug straight into the markets, resolution and
              proof layer — Adjudex is infrastructure, not just an app.
            </p>
          </div>
          <div className="grid gap-3">
            {ITEMS.map(({ Icon, title, body }) => (
              <div
                key={title}
                className="flex gap-4 rounded-[14px] border p-4"
                style={{ borderColor: "var(--line)", background: "var(--card)" }}
              >
                <div className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-[10px]" style={{ background: "rgba(217,255,0,0.10)", color: "var(--brand-primary)" }}>
                  <Icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-[14.5px] font-semibold" style={{ color: "var(--tx)" }}>{title}</div>
                  <div className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--t3)" }}>{body}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
