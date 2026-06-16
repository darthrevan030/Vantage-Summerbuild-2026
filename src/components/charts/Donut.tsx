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
  onHover?: (i: number) => void;
  onLeave?: () => void;
  children?: React.ReactNode;
}

export function Donut({
  data,
  size = 130,
  thickness = 20,
  gap = 2.5,
  highlight = -1,
  onSlice,
  onHover,
  onLeave,
  children,
}: DonutProps) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = data.reduce((s, d) => s + d.value, 0);
  let acc = 0;

  // Compute cumulative fractions so we can find which slice the mouse is over
  const fracs: number[] = [];
  let running = 0;
  for (const d of data) {
    running += d.value / total;
    fracs.push(running);
  }

  /** Given a mouse event on the SVG, return the slice index under the cursor. */
  const sliceAtEvent = (e: React.MouseEvent<SVGElement>): number => {
    const svg = e.currentTarget.closest("svg")!;
    const rect = svg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    // SVG is rotated -90deg so angle 0 = top; compensate by adding 90deg
    let angle = Math.atan2(dy, dx) + Math.PI / 2;
    if (angle < 0) angle += 2 * Math.PI;
    const frac = angle / (2 * Math.PI);
    return fracs.findIndex((f) => frac < f);
  };

  const pad = 4; // padding so expanded stroke isn't clipped by viewBox edge
  const vbSize = size + pad * 2;

  return (
    <div
      style={{
        position: "relative",
        width: `min(${size}px, 100%)`,
        aspectRatio: "1",
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`${-pad} ${-pad} ${vbSize} ${vbSize}`}
        style={{ transform: "rotate(-90deg)", display: "block", overflow: "visible" }}
      >
        {/* Track ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--donut-track)"
          strokeWidth={thickness}
        />
        {/* Slice arcs */}
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
              style={{
                opacity: dim ? 0.28 : 1,
                transition: "opacity .25s, stroke-width .2s",
                pointerEvents: "none", // handled by hit area below
              }}
            />
          );
        })}
        {/* Invisible hit area. full donut ring, captures all mouse events */}
        {(onHover || onSlice) && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="transparent"
            strokeWidth={thickness + 8} // slightly wider for easy hover
            style={{ cursor: "pointer" }}
            onMouseMove={(e) => {
              const i = sliceAtEvent(e);
              if (i >= 0) onHover?.(i);
            }}
            onMouseLeave={onLeave}
            onClick={(e) => {
              const i = sliceAtEvent(e);
              if (i >= 0) onSlice?.(i);
            }}
          />
        )}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "grid",
          placeItems: "center",
          textAlign: "center",
          pointerEvents: "none",
        }}
      >
        {children}
      </div>
    </div>
  );
}