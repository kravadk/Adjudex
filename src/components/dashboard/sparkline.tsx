type Props = {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  strokeWidth?: number;
};

export function Sparkline({
  values,
  width = 80,
  height = 22,
  color = "#CCE9E7",
  fill = false,
  strokeWidth = 1.25,
}: Props) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  const points = values.map(
    (v, i) => [i * stepX, height - ((v - min) / span) * height] as const,
  );
  const d = points
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(" ");
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      {fill && (
        <path
          d={`${d} L${width} ${height} L0 ${height} Z`}
          fill={color}
          opacity={0.08}
        />
      )}
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
