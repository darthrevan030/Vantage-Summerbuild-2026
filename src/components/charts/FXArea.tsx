"use client";

import { useState, useEffect, useRef } from "react";

interface FXAreaProps {
  data: Record<string, number>[];
  colors: Record<string, string>;
  keys: string[];
  labels?: string[];   // "YYYY-MM" strings, same length as data
  height?: number;
  valFmt?: (v: number) => string;
}

const MONS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function fmtYM(ym: string): string {
  const [yr, mo] = ym.split("-");
  return `${MONS[parseInt(mo) - 1]} ${yr.slice(2)}`;
}

export function FXArea({ data, colors, keys, labels, height = 230, valFmt }: FXAreaProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);

  useEffect(() => {
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const padL = valFmt ? 68 : 8, padR = 8, padT = 14, padB = 22;
  const iw = w - padL - padR;
  const ih = height - padT - padB;

  let lo = 0, hi = 0;
  keys.forEach((k) => data.forEach((d) => { lo = Math.min(lo, d[k]); hi = Math.max(hi, d[k]); }));
  lo *= 1.1; hi *= 1.1;
  const rng = hi - lo || 1;

  const X = (i: number) => padL + (i / Math.max(data.length - 1, 1)) * iw;
  const Y = (v: number) => padT + ih - ((v - lo) / rng) * ih;
  const zeroY = Y(0);

  const Y_TICKS = 4;
  const yTicks = Array.from({ length: Y_TICKS + 1 }, (_, g) => ({
    v: lo + (hi - lo) * (1 - g / Y_TICKS),
    y: padT + (g / Y_TICKS) * ih,
  }));

  const maxXTicks = Math.max(2, Math.floor(iw / 64));
  const xStep = Math.ceil((data.length - 1) / (maxXTicks - 1));
  const xTicks = data
    .map((d, i) => ({ i }))
    .filter(({ i }) => i % xStep === 0 || i === data.length - 1)
    .filter(({ i }, k, arr) => k === 0 || i - arr[k - 1].i >= xStep * 0.5);

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <svg width={w} height={height}>
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
            <line x1={padL} x2={w - padR} y1={t.y} y2={t.y} stroke="rgba(255,255,255,0.045)" strokeWidth="1" />
            {valFmt && (
              <text x={padL - 6} y={t.y + 4} fill="var(--text-muted)" fontSize="10" textAnchor="end" className="mono">
                {valFmt(t.v)}
              </text>
            )}
          </g>
        ))}

        {/* Zero line */}
        <line x1={padL} x2={w - padR} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.18)" strokeWidth="1" />

        {/* Data areas + lines */}
        {keys.map((k) => {
          const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(d[k]).toFixed(1)}`).join(" ");
          const areaPath = `${linePath} L${X(data.length - 1)},${zeroY} L${X(0)},${zeroY} Z`;
          return (
            <g key={k}>
              <path d={areaPath} fill={`url(#fx${k})`} />
              <path d={linePath} fill="none" stroke={colors[k]} strokeWidth="1.75" strokeLinejoin="round" />
            </g>
          );
        })}

        {/* X-axis date ticks */}
        {labels && xTicks.map(({ i }, k) => {
          if (!labels[i]) return null;
          const isFirst = k === 0;
          const isLast  = k === xTicks.length - 1;
          const anchor  = isFirst ? "start" : isLast ? "end" : "middle";
          return (
            <text key={k} x={X(i)} y={height - 6} fill="var(--text-muted)" fontSize="10" textAnchor={anchor} className="mono">
              {fmtYM(labels[i])}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
