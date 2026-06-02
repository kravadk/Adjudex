// Avatar-stack for market cards (S6.A) — social-proof preview of up to
// 3 most recent traders on a market, plus an overflow chip with the
// total bettor count.
//
// We don't fetch identicon images from a third-party (no DiceBear /
// Boring Avatars CDN call per card) — instead we derive a deterministic
// 2-char "initials" + 2-color radial-gradient from the address hash.
// This keeps every market-card render zero-network and avoids leaking
// trader addresses to a third-party service.

const PALETTE = [
  "#10b981", // green
  "#28a0f0", // arbitrum blue
  "#a78bfa", // violet
  "#f59e0b", // amber
  "#ef4444", // red
  "#22d3ee", // cyan
  "#ec4899", // pink
  "#84cc16", // lime
];

// FNV-1a, 32-bit. Deterministic, fast, no crypto needed.
function hashAddress(address: string): number {
  let h = 0x811c9dc5;
  const s = address.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function colorsFor(address: string): { from: string; to: string; initial: string } {
  const h = hashAddress(address);
  const from = PALETTE[h % PALETTE.length];
  const to = PALETTE[(h >>> 4) % PALETTE.length];
  // Use the first two hex chars after 0x as deterministic "initials".
  const stripped = address.replace(/^0x/i, "").toUpperCase();
  const initial = stripped.slice(0, 2) || "??";
  return { from, to, initial };
}

type Props = {
  addresses: ReadonlyArray<string>;
  totalCount: number;
  size?: 18 | 22 | 26;
};

export function TraderStack({ addresses, totalCount, size = 22 }: Props) {
  // Defensive — server might omit the field on legacy rows.
  if (!addresses || addresses.length === 0) return null;
  // Take up to 3 — the LATERAL subquery already caps at 3, but UI
  // tolerates a longer feed.
  const visible = addresses.slice(0, 3);
  const overflow = Math.max(0, totalCount - visible.length);
  const overlap = Math.round(size * 0.32);

  return (
    <div className="inline-flex items-center" aria-label={`${totalCount} traders`}>
      <div className="flex items-center">
        {visible.map((address, i) => {
          const { from, to, initial } = colorsFor(address);
          return (
            <span
              key={address}
              className="grid place-items-center rounded-full border font-mono font-semibold flex-shrink-0"
              style={{
                width: size,
                height: size,
                fontSize: size <= 22 ? 8 : 9,
                background: `linear-gradient(135deg, ${from}, ${to})`,
                color: "#0a0a0a",
                borderColor: "var(--win-bg)",
                marginLeft: i === 0 ? 0 : -overlap,
                zIndex: visible.length - i,
                letterSpacing: "0.02em",
              }}
              title={address}
            >
              {initial}
            </span>
          );
        })}
      </div>
      {overflow > 0 && (
        <span
          className="ml-1.5 inline-flex items-center rounded-full px-1.5 text-[10px] font-mono tabular-nums"
          style={{
            height: size,
            background: "#211f1e",
            color: "var(--t3)",
            border: "1px solid #34312e",
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
