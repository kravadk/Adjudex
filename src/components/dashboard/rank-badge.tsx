type Props = { rank: number };

const TONE: Record<number, string> = {
  1: "bg-[#3a2a14] text-[#facc15] border-[#facc15]/30",
  2: "bg-[#2c2c2c] text-[#e2e8f0] border-[#e2e8f0]/25",
  3: "bg-[#2a201a] text-[#fb923c] border-[#fb923c]/30",
};

export function RankBadge({ rank }: Props) {
  const tone = TONE[rank] || "bg-[#232323] text-gray-400 border-[#2a2a2a]";
  return (
    <span
      className={`inline-flex items-center justify-center w-8 h-7 rounded-md border font-mono tabular-nums text-[12px] font-semibold ${tone}`}
    >
      #{rank}
    </span>
  );
}
