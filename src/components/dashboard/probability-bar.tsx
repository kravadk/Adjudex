type Props = {
  yesPct: number;
  size?: "sm" | "md" | "lg";
  showLabels?: boolean;
  changePct?: number;
};

export function ProbabilityBar({
  yesPct,
  size = "md",
  showLabels,
  changePct,
}: Props) {
  const yes = Math.max(0, Math.min(1, yesPct));
  const no = 1 - yes;
  const h = size === "sm" ? 6 : size === "lg" ? 16 : 9;
  const positive = (changePct ?? 0) >= 0;

  return (
    <div className="w-full">
      {showLabels && (
        <div className="flex items-center justify-between mb-1 font-mono text-[10.5px]">
          <span className="text-[#d9ff00] font-semibold tabular-nums">
            YES {Math.round(yes * 100)}%
          </span>
          {typeof changePct === "number" && (
            <span
              className="text-[9.5px] tabular-nums"
              style={{ color: positive ? "#10b981" : "#ef4444" }}
            >
              {positive ? "+" : ""}
              {changePct.toFixed(1)}%
            </span>
          )}
          <span className="text-[#3b6ffa] font-semibold tabular-nums">
            NO {Math.round(no * 100)}%
          </span>
        </div>
      )}
      <div
        className="relative w-full rounded-[3px] overflow-hidden bg-[#1c1c1c]"
        style={{ height: h }}
      >
        <div
          className="absolute inset-y-0 left-0 bg-[#d9ff00]"
          style={{ width: `${yes * 100}%` }}
        />
        <div
          className="absolute inset-y-0 right-0 bg-[#3b6ffa]"
          style={{ width: `${no * 100}%`, opacity: 0.92 }}
        />
        <div
          className="absolute inset-y-0 w-px bg-[#0a0a0a]"
          style={{ left: `${yes * 100}%` }}
        />
      </div>
    </div>
  );
}
