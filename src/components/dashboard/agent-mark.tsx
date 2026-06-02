type Props = {
  initials: string;
  size?: 20 | 24 | 28 | 32 | 40 | 56;
  emphasis?: "default" | "accent";
};

export function AgentMark({
  initials,
  size = 24,
  emphasis = "default",
}: Props) {
  const ring =
    emphasis === "accent"
      ? "border border-[#CCE9E7]/40"
      : "border border-[#2a2a2a]";
  const fontSize = size <= 24 ? 10 : size <= 32 ? 11 : 14;
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-[#1c1c1c] ${ring} font-mono font-semibold text-gray-300 tracking-wider flex-shrink-0`}
      style={{ width: size, height: size, fontSize }}
    >
      {initials}
    </span>
  );
}
