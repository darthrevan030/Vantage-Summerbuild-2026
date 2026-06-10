"use client";

interface Slice {
  label: string;
  value: number;
  color: string;
}

interface DonutProps {
  data: Slice[];
  size?: number;
  thickness?: number;
  gap?: number;
  highlight?: number;
  onSlice?: (i: number) => void;
  children?: React.ReactNode;
}

export function Donut({ data, size = 130, thickness = 20, gap = 2.5, highlight = -1, onSlice, children }: DonutProps) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = data.reduce((s, d) => s + d.value, 0);
  let acc = 0;

  return (
    <div style={{ position: "relative", width: `min(${size}px, 100%)`, aspectRatio: "1" }}>
      <svg width="100%" height="100%" viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)", display: "block" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--donut-track)" strokeWidth={thickness} />
        {data.map((d, i) => {
          const frac = d.value / total;
          const len = Math.max(c * frac - gap, 0.001);
          const off = -acc * c;
          acc += frac;
          const dim = highlight >= 0 && highlight !== i;
          return (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={highlight === i ? thickness + 3 : thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={off}
              strokeLinecap="butt"
              onClick={onSlice ? () => onSlice(i) : undefined}
              style={{
                opacity: dim ? 0.28 : 1,
                cursor: onSlice ? "pointer" : "default",
                transition: "opacity .25s, stroke-width .2s",
              }}
            />
          );
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center" }}>
        {children}
      </div>
    </div>
  );
}
