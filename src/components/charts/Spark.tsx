"use client";

interface SparkProps {
  pts: number[];
  color: string;
  w?: number;
  h?: number;
  fill?: boolean;
  sw?: number;
}

export function Spark({
  pts,
  color,
  w = 130,
  h = 38,
  fill = true,
  sw = 1.75,
}: SparkProps) {
  // Need at least two finite points to draw a line; otherwise render an empty
  // (correctly-sized) box so the layout holds without emitting NaN coordinates.
  const valid = pts.filter((v) => Number.isFinite(v));
  if (valid.length < 2) {
    return (
      <svg
        width={w}
        height={h}
        style={{ display: "block", overflow: "visible" }}
      />
    );
  }

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const rng = max - min || 1;
  const step = w / (valid.length - 1);
  const Y = (v: number) => h - 4 - ((v - min) / rng) * (h - 8);
  const line = valid
    .map(
      (v, i) =>
        `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${Y(v).toFixed(1)}`,
    )
    .join(" ");
  const area = `${line} L${w},${h} L0,${h} Z`;
  const id = "sp" + Math.round(min * 1000) + color.replace(/[^a-z0-9]/gi, "");

  return (
    <svg width={w} height={h} style={{ display: "block", overflow: "visible" }}>
      {fill && (
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={area} fill={`url(#${id})`} />}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={w} cy={Y(valid[valid.length - 1])} r="2.4" fill={color} />
    </svg>
  );
}
