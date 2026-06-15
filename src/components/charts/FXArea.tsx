"use client";

import { useState, useEffect, useRef } from "react";

interface FXAreaProps {
  data: Record<string, number>[];
  colors: Record<string, string>;
  keys: string[];
  labels?: string[]; // "YYYY-MM" or "YYYY-MM-DD" strings, same length as data
  height?: number;
  valFmt?: (v: number) => string;
}

const MONS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
// "YYYY-MM" → "Jun 26"; "YYYY-MM-DD" → "Jun 9" (current year) or "Jun 9 '25" (past years)
function fmtTick(label: string): string {
  const [yr, mo, dy] = label.split("-");
  if (!dy) return `${MONS[parseInt(mo) - 1]} ${yr.slice(2)}`;
  const monthDay = `${MONS[parseInt(mo) - 1]} ${parseInt(dy)}`;
  return parseInt(yr) === new Date().getFullYear()
    ? monthDay
    : `${monthDay} '${yr.slice(2)}`;
}

export function FXArea({
  data,
  colors,
  keys,
  labels,
  height = 230,
  valFmt,
}: FXAreaProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const padL = valFmt ? 68 : 8,
    padR = 8,
    padT = 14,
    padB = 22;
  const iw = w - padL - padR;
  const ih = height - padT - padB;

  let lo = 0,
    hi = 0;
  keys.forEach((k) =>
    data.forEach((d) => {
      lo = Math.min(lo, d[k]);
      hi = Math.max(hi, d[k]);
    }),
  );
  lo *= 1.1;
  hi *= 1.1;
  const rng = hi - lo || 1;

  const X = (i: number) => padL + (i / Math.max(data.length - 1, 1)) * iw;
  const Y = (v: number) => padT + ih - ((v - lo) / rng) * ih;
  const zeroY = Y(0);

  const Y_TICKS = 4;
  const yTicks = Array.from({ length: Y_TICKS + 1 }, (_, g) => ({
    v: lo + (hi - lo) * (1 - g / Y_TICKS),
    y: padT + (g / Y_TICKS) * ih,
  }));

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let i = Math.round(((x - padL) / iw) * (data.length - 1));
    i = Math.max(0, Math.min(data.length - 1, i));
    setHover(i);
  };

  const maxXTicks = Math.max(2, Math.floor(iw / 64));
  const xStep = Math.ceil((data.length - 1) / (maxXTicks - 1));
  const xTicks = data
    .map((d, i) => ({ i }))
    .filter(({ i }) => i % xStep === 0 || i === data.length - 1)
    .filter(({ i }, k, arr) => k === 0 || i - arr[k - 1].i >= xStep * 0.5);

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <svg
        width={w}
        height={height}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {keys.map((k) => (
            <linearGradient key={k} id={"fx" + k} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors[k]} stopOpacity="0.22" />
              <stop offset="100%" stopColor={colors[k]} stopOpacity="0" />
            </linearGradient>
          ))}
        </defs>

        {/* Y-axis grid + labels */}
        {yTicks.map((t, g) => (
          <g key={g}>
            <line
              x1={padL}
              x2={w - padR}
              y1={t.y}
              y2={t.y}
              stroke="rgba(255,255,255,0.045)"
              strokeWidth="1"
            />
            {valFmt && (
              <text
                x={padL - 6}
                y={t.y + 4}
                fill="var(--text-muted)"
                fontSize="10"
                textAnchor="end"
                className="font-mono"
              >
                {valFmt(t.v)}
              </text>
            )}
          </g>
        ))}

        {/* Zero line */}
        <line
          x1={padL}
          x2={w - padR}
          y1={zeroY}
          y2={zeroY}
          stroke="rgba(255,255,255,0.18)"
          strokeWidth="1"
        />

        {/* Data areas + lines */}
        {keys.map((k) => {
          const linePath = data
            .map(
              (d, i) =>
                `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(d[k]).toFixed(1)}`,
            )
            .join(" ");
          const areaPath = `${linePath} L${X(data.length - 1)},${zeroY} L${X(0)},${zeroY} Z`;
          return (
            <g key={k}>
              <path d={areaPath} fill={`url(#fx${k})`} />
              <path
                d={linePath}
                fill="none"
                stroke={colors[k]}
                strokeWidth="1.75"
                strokeLinejoin="round"
              />
            </g>
          );
        })}

        {/* X-axis date ticks */}
        {labels &&
          xTicks.map(({ i }, k) => {
            if (!labels[i]) return null;
            const isFirst = k === 0;
            const isLast = k === xTicks.length - 1;
            const anchor = isFirst ? "start" : isLast ? "end" : "middle";
            return (
              <text
                key={k}
                x={X(i)}
                y={height - 6}
                fill="var(--text-muted)"
                fontSize="10"
                textAnchor={anchor}
                className="font-mono"
              >
                {fmtTick(labels[i])}
              </text>
            );
          })}

        {/* Hover crosshair + per-series markers */}
        {hover != null && (
          <g>
            <line
              x1={X(hover)}
              x2={X(hover)}
              y1={padT}
              y2={padT + ih}
              stroke="var(--text-muted)"
              strokeWidth="1"
              strokeDasharray="3 3"
              opacity="0.5"
            />
            {keys.map((k) => (
              <circle
                key={k}
                cx={X(hover)}
                cy={Y(data[hover][k])}
                r="3.5"
                fill={colors[k]}
                stroke="var(--bg-base)"
                strokeWidth="2"
              />
            ))}
          </g>
        )}
      </svg>
      {hover != null && (
        <div
          className="pointer-events-none absolute z-[5] -translate-x-1/2 rounded-lg border border-gold-soft bg-base px-[11px] py-[7px] shadow-[0_6px_24px_rgba(0,0,0,.5)] light:bg-surface light:shadow-[0_4px_16px_rgba(0,0,0,0.12)]"
          style={{ left: Math.min(Math.max(X(hover), 70), w - 70), top: padT }}
        >
          {labels && labels[hover] && (
            <div className="font-ui text-[10px] uppercase tracking-[.06em] text-muted">
              {fmtTick(labels[hover])}
            </div>
          )}
          {keys.map((k) => (
            <div
              key={k}
              className="mt-0.5 flex items-center gap-1.5 font-mono text-[12px] font-semibold"
              style={{ color: colors[k] }}
            >
              <span
                className="inline-block size-2 rounded-[2px]"
                style={{ background: colors[k] }}
              />
              {k.toUpperCase()}{" "}
              {valFmt ? valFmt(data[hover][k]) : data[hover][k]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
